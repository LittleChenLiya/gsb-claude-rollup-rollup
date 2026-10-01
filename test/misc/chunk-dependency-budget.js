const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rollup = require('../../dist/rollup');
const { loader } = require('../testHelpers.js');

const { chunkDependencyBudget } = rollup;

const utf8Bytes = code => Buffer.byteLength(code, 'utf8');

const sharedFixture = {
	entry1: `import { sharedValue } from 'shared';
import('lazy').then(({ lazyValue }) => console.log(lazyValue));
export const out1 = sharedValue + '-1';`,
	entry2: `import { sharedValue } from 'shared';
import('lazy').then(({ lazyValue }) => console.log(lazyValue));
export const out2 = sharedValue + '-2';`,
	shared: `export const sharedValue = 'shared across entries';`,
	lazy: `export const lazyValue = 'loaded on demand';`
};

async function generateWithReport(inputOptions, outputOptions) {
	const reports = [];
	const { budgets, ...rollupInputOptions } = inputOptions;
	const bundle = await rollup.rollup({
		...rollupInputOptions,
		plugins: [
			...rollupInputOptions.plugins,
			chunkDependencyBudget({
				budgets,
				onReport: report => reports.push(report)
			})
		]
	});
	const { output } = await bundle.generate({ format: 'es', ...outputOptions });
	await bundle.close();
	assert.equal(reports.length, 1);
	return { output, report: reports[0] };
}

function bytesByFileName(output) {
	return new Map(
		output
			.filter(chunk => chunk.type === 'chunk')
			.map(chunk => [chunk.fileName, utf8Bytes(chunk.code)])
	);
}

describe('chunkDependencyBudget', () => {
	it('counts chunks shared between entries only once and excludes dynamic imports from the synchronous total', async () => {
		const { output, report } = await generateWithReport({
			input: ['entry1', 'entry2'],
			plugins: [loader(sharedFixture)]
		});
		const bytes = bytesByFileName(output);
		assert.deepEqual(
			report.entries.map(entry => entry.entry),
			['entry1', 'entry2']
		);
		for (const entry of report.entries) {
			assert.equal(entry.status, 'unchecked');
			assert.equal(entry.budget, null);
			assert.equal(entry.dynamicImports.length, 1);
			assert.equal(entry.dynamicImports[0].fileName.startsWith('lazy-'), true);
			assert.equal(entry.dynamicImports[0].bytes, bytes.get(entry.dynamicImports[0].fileName));
			const componentChunks = entry.components.flatMap(component => component.chunks);
			assert.deepEqual(componentChunks, [...new Set(componentChunks)], 'chunks are counted once');
			const sharedChunks = componentChunks.filter(fileName => fileName.startsWith('shared-'));
			assert.equal(sharedChunks.length, 1);
			assert.equal(
				entry.totalBytes,
				bytes.get(entry.fileName) + bytes.get(sharedChunks[0]),
				'the shared chunk is counted exactly once and the dynamic chunk is excluded'
			);
			for (const component of entry.components) {
				assert.equal(
					component.bytes,
					component.chunks.reduce((sum, fileName) => sum + bytes.get(fileName), 0)
				);
			}
		}
	});

	it('passes when all budgets are met and fails with overage and the largest contribution path', async () => {
		const { report } = await generateWithReport({
			input: ['entry1', 'entry2'],
			plugins: [loader(sharedFixture)],
			budgets: { entry1: 100_000, entry2: 100_000 }
		});
		assert.deepEqual(
			report.entries.map(entry => entry.status),
			['pass', 'pass']
		);

		const failing = generateWithReport({
			input: ['entry1', 'entry2'],
			plugins: [loader(sharedFixture)],
			budgets: { entry1: 1 }
		});
		await assert.rejects(failing, error => {
			assert.equal(error.pluginCode, 'CHUNK_BUDGET_EXCEEDED');
			const entry1 = error.meta.report.entries.find(entry => entry.entry === 'entry1');
			assert.match(error.message, /exceed the budget of 1 by \d+ bytes/);
			assert.match(error.message, /Largest contribution: /);
			assert.ok(error.message.includes(entry1.largestContribution.path.join(' -> ')));
			assert.equal(entry1.exceededBy, entry1.totalBytes - 1);
			assert.equal(entry1.status, 'fail');
			assert.equal(
				error.meta.report.entries.find(entry => entry.entry === 'entry2').status,
				'unchecked'
			);
			return true;
		});
	});

	it('fails during generation so that no output is written to disk', async () => {
		const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollup-budget-'));
		const outputDirectory = path.join(temporaryDirectory, 'output');
		const bundle = await rollup.rollup({
			input: ['entry1', 'entry2'],
			plugins: [loader(sharedFixture), chunkDependencyBudget({ budgets: { entry1: 1 } })]
		});
		await assert.rejects(bundle.write({ dir: outputDirectory, format: 'es' }), error => {
			assert.equal(error.pluginCode, 'CHUNK_BUDGET_EXCEEDED');
			return true;
		});
		await bundle.close();
		assert.equal(fs.existsSync(outputDirectory), false, 'no failed artifacts are left on disk');
		fs.rmSync(temporaryDirectory, { force: true, recursive: true });
	});

	it('measures chunk sizes as UTF-8 bytes rather than string length', async () => {
		const unicodeFixture = {
			main: `import { emoji } from 'unicode';
export const out = emoji;`,
			unicode: `export const emoji = '😀😁😂😃😄';`
		};
		const { output, report } = await generateWithReport({
			input: 'main',
			plugins: [loader(unicodeFixture)]
		});
		const bytes = bytesByFileName(output);
		const entry = report.entries[0];
		const code = output.find(chunk => chunk.fileName === entry.fileName).code;
		assert.ok(utf8Bytes(code) > code.length, 'fixture contains multi-byte characters');
		assert.equal(entry.totalBytes, bytes.get(entry.fileName));

		const characterCount = code.length;
		const failing = generateWithReport({
			input: 'main',
			plugins: [loader(unicodeFixture)],
			budgets: { main: characterCount }
		});
		await assert.rejects(failing, error => {
			assert.equal(error.pluginCode, 'CHUNK_BUDGET_EXCEEDED');
			assert.ok(
				error.meta.report.entries[0].totalBytes > characterCount,
				'the budget is checked against UTF-8 bytes, not characters'
			);
			return true;
		});
	});

	it('compresses circular chunk imports into one component without recursing endlessly', async () => {
		const circularFixture = {
			main: `import { a } from 'cycleA';
export const out = a;`,
			cycleA: `import { b } from 'cycleB';
export const a = 'a-' + b;`,
			cycleB: `import { a } from 'cycleA';
export const b = 'b-' + a;`
		};
		const { output, report } = await generateWithReport(
			{
				input: 'main',
				onLog() {},
				plugins: [loader(circularFixture)]
			},
			{ chunkFileNames: '[name].js', manualChunks: { cycleA: ['cycleA'], cycleB: ['cycleB'] } }
		);
		const bytes = bytesByFileName(output);
		const entry = report.entries[0];
		const cycle = entry.components.find(component => component.chunks.length > 1);
		assert.deepEqual(cycle.chunks, ['cycleA.js', 'cycleB.js']);
		assert.equal(cycle.id, 'cycleA.js + cycleB.js');
		assert.equal(cycle.bytes, bytes.get('cycleA.js') + bytes.get('cycleB.js'));
		assert.equal(
			entry.totalBytes,
			bytes.get('main.js') + cycle.bytes,
			'the cycle is counted once, not per chunk per visit'
		);
		assert.ok(entry.largestContribution.path.length <= entry.components.length);
		assert.equal(entry.largestContribution.path[0], 'main.js');
	});

	it('accounts for size changes applied by other plugins in renderChunk', async () => {
		const padding = `/*${'x'.repeat(200)}*/`;
		const padder = {
			name: 'padder',
			renderChunk: code => code + padding
		};
		const { output, report } = await generateWithReport({
			input: ['entry1', 'entry2'],
			plugins: [loader(sharedFixture), padder]
		});
		const bytes = bytesByFileName(output);
		for (const entry of report.entries) {
			assert.equal(
				entry.totalBytes,
				entry.components.reduce((sum, component) => sum + component.bytes, 0)
			);
			for (const component of entry.components) {
				for (const fileName of component.chunks) {
					assert.ok(bytes.get(fileName) > 200, 'padding is part of the measured code');
				}
			}
		}
	});

	it('marks external imports as unknown cost instead of counting them as zero', async () => {
		const externalFixture = {
			main: `import { external } from 'external-dep';
export const out = external;`
		};
		const { output, report } = await generateWithReport({
			input: 'main',
			external: ['external-dep'],
			plugins: [loader(externalFixture)]
		});
		const bytes = bytesByFileName(output);
		const entry = report.entries[0];
		assert.deepEqual(entry.externalImports, ['external-dep']);
		assert.equal(
			entry.totalBytes,
			bytes.get(entry.fileName),
			'externals are listed separately and do not contribute bytes'
		);
	});

	it('keeps multiple outputs of one build independent and produces a stable sorted JSON report', async () => {
		const reports = [];
		const bundle = await rollup.rollup({
			input: ['entry1', 'entry2'],
			plugins: [
				loader(sharedFixture),
				chunkDependencyBudget({
					budgets: { entry1: 100_000, entry2: 100_000 },
					onReport: report => reports.push(JSON.stringify(report))
				})
			]
		});
		await bundle.generate({ format: 'es' });
		await bundle.generate({ format: 'es' });
		assert.equal(reports[0], reports[1], 'repeated checks of the same build are stable');

		await bundle.generate({
			format: 'es',
			plugins: [{ name: 'padder', renderChunk: code => code + '/*output-specific*/' }]
		});
		assert.notEqual(
			JSON.parse(reports[2]).entries[0].totalBytes,
			JSON.parse(reports[0]).entries[0].totalBytes,
			'output-specific plugins only affect their own output'
		);

		await bundle.generate({ format: 'es' });
		assert.equal(reports[3], reports[0], 'earlier outputs are not polluted by later ones');
		await bundle.close();

		const parsed = JSON.parse(reports[0]);
		assert.deepEqual(
			parsed.entries.map(entry => entry.entry),
			['entry1', 'entry2']
		);
		for (const entry of parsed.entries) {
			const componentIds = entry.components.map(component => component.id);
			assert.deepEqual(componentIds, [...componentIds].sort());
			const dynamicFileNames = entry.dynamicImports.map(dynamicImport => dynamicImport.fileName);
			assert.deepEqual(dynamicFileNames, [...dynamicFileNames].sort());
		}
	});
});
