const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rollup } = require('../../dist/rollup.js');
const { chunkDependencyBudget } = require('../../plugins/chunk-dependency-budget/index.js');

function virtualModules(modules) {
	return {
		name: 'virtual-modules',
		resolveId(id) {
			return id in modules ? id : null;
		},
		load(id) {
			return id in modules ? modules[id] : null;
		}
	};
}

const SHARED_DYNAMIC_MODULES = {
	'entry-a': [
		"import { sharedValue } from 'shared';",
		"export const valueA = sharedValue + '-a';",
		"export const loadLazy = () => import('lazy');"
	].join('\n'),
	'entry-b': [
		"import { sharedValue } from 'shared';",
		"export const valueB = sharedValue + '-b';"
	].join('\n'),
	shared: "export const sharedValue = 'shared-content';",
	lazy: "export const lazyValue = 'lazy-content';"
};

function getUtf8Bytes(code) {
	return Buffer.byteLength(code, 'utf8');
}

async function generateWithBudget({
	modules,
	input,
	budgets,
	output,
	plugins = [],
	external,
	onLog,
	onReport
}) {
	const reports = [];
	const reportOutputOptions = [];
	const bundle = await rollup({
		external,
		input,
		onLog,
		plugins: [
			virtualModules(modules),
			...plugins,
			chunkDependencyBudget({
				budgets,
				onReport: (report, outputOptions) => {
					reports.push(report);
					reportOutputOptions.push(outputOptions);
					if (onReport) onReport(report, outputOptions);
				}
			})
		]
	});
	const result = await bundle.generate({
		chunkFileNames: '[name].js',
		format: 'es',
		...output
	});
	return { bundle, reports, reportOutputOptions, output: result.output };
}

function getChunksByName(output) {
	const chunksByName = new Map();
	for (const chunk of output) {
		if (chunk.type === 'chunk') {
			chunksByName.set(chunk.name, chunk);
		}
	}
	return chunksByName;
}

describe('chunk-dependency-budget plugin', () => {
	it('counts a shared chunk once per entry and keeps dynamic imports out of the sync budget', async () => {
		const { bundle, reports, output } = await generateWithBudget({
			input: ['entry-a', 'entry-b'],
			modules: SHARED_DYNAMIC_MODULES
		});
		await bundle.close();

		assert.equal(reports.length, 1);
		const report = reports[0];
		assert.deepEqual(
			report.entries.map(entry => entry.name),
			['entry-a', 'entry-b']
		);

		const chunks = getChunksByName(output);
		const sharedBytes = getUtf8Bytes(chunks.get('shared').code);
		const lazyBytes = getUtf8Bytes(chunks.get('lazy').code);
		const entryABytes = getUtf8Bytes(chunks.get('entry-a').code);
		const entryBBytes = getUtf8Bytes(chunks.get('entry-b').code);

		const entryA = report.entries[0];
		assert.deepEqual(
			entryA.syncChunks.map(chunk => chunk.fileName),
			['entry-a.js', 'shared.js']
		);
		assert.equal(entryA.syncBytes, entryABytes + sharedBytes);
		assert.deepEqual(entryA.dynamicChunks, ['lazy.js']);
		assert.ok(!entryA.syncChunks.some(chunk => chunk.fileName === 'lazy.js'));
		assert.ok(entryA.syncBytes < entryABytes + sharedBytes + lazyBytes);

		const entryB = report.entries[1];
		assert.deepEqual(
			entryB.syncChunks.map(chunk => chunk.fileName),
			['entry-b.js', 'shared.js']
		);
		assert.equal(entryB.syncBytes, entryBBytes + sharedBytes);

		assert.deepEqual(
			entryA.heaviestPath.map(component => component.chunks),
			[['entry-a.js'], ['shared.js']]
		);
	});

	it('fails before writing and leaves no output on disk when the budget is exceeded', async () => {
		const reports = [];
		const bundle = await rollup({
			input: ['entry-a', 'entry-b'],
			plugins: [
				virtualModules(SHARED_DYNAMIC_MODULES),
				chunkDependencyBudget({
					budgets: { 'entry-a': 1 },
					onReport: report => reports.push(report)
				})
			]
		});
		const outputDirectory = path.join(
			os.tmpdir(),
			`rollup-chunk-budget-${process.pid}-${Date.now()}`
		);
		await assert.rejects(
			bundle.write({ chunkFileNames: '[name].js', dir: outputDirectory, format: 'es' }),
			error => {
				assert.equal(error.pluginCode, 'CHUNK_BUDGET_EXCEEDED');
				assert.match(
					error.message,
					/Entry "entry-a" exceeds its chunk dependency budget by \d+ bytes/
				);
				assert.match(error.message, /Largest contribution path: entry-a\.js -> shared\.js/);
				return true;
			}
		);
		await bundle.close();

		assert.equal(reports.length, 1);
		const entryA = reports[0].entries.find(entry => entry.name === 'entry-a');
		assert.equal(entryA.status, 'fail');
		assert.equal(entryA.exceededBy, entryA.syncBytes - 1);
		const entryB = reports[0].entries.find(entry => entry.name === 'entry-b');
		assert.equal(entryB.status, 'pass');

		assert.ok(
			!fs.existsSync(outputDirectory) || fs.readdirSync(outputDirectory).length === 0,
			'a failed budget check must not leave new output on disk'
		);
	});

	it('compresses cyclic chunks into strongly connected components in contribution paths', async () => {
		const modules = {
			entry: ["import { valueA } from 'mod-a';", 'export const entryValue = valueA;'].join('\n'),
			'mod-a': ["import { valueB } from 'mod-b';", "export const valueA = 'a' + valueB;"].join(
				'\n'
			),
			'mod-b': ["import { valueA } from 'mod-a';", "export const valueB = 'b' + valueA;"].join('\n')
		};
		const { bundle, reports, output } = await generateWithBudget({
			input: ['entry'],
			modules,
			onLog: () => {},
			output: {
				manualChunks(id) {
					if (id === 'mod-a') return 'chunk-a';
					if (id === 'mod-b') return 'chunk-b';
				}
			}
		});
		await bundle.close();

		const chunks = getChunksByName(output);
		const entry = reports[0].entries[0];
		assert.deepEqual(
			entry.syncChunks.map(chunk => chunk.fileName),
			['chunk-a.js', 'chunk-b.js', 'entry.js']
		);
		assert.equal(
			entry.syncBytes,
			getUtf8Bytes(chunks.get('entry').code) +
				getUtf8Bytes(chunks.get('chunk-a').code) +
				getUtf8Bytes(chunks.get('chunk-b').code)
		);

		const cyclicComponent = entry.heaviestPath.find(component => component.chunks.length > 1);
		assert.deepEqual(cyclicComponent.chunks, ['chunk-a.js', 'chunk-b.js']);
		assert.equal(
			cyclicComponent.bytes,
			getUtf8Bytes(chunks.get('chunk-a').code) + getUtf8Bytes(chunks.get('chunk-b').code)
		);
		assert.ok(entry.heaviestPath.length < 4, 'the SCC must be compressed into a single component');
	});

	it('measures chunk sizes as UTF-8 bytes, not string length', async () => {
		const modules = {
			entry: "export const greeting = '你好，世界 🌍🌍🌍';"
		};
		const { bundle, reports, output } = await generateWithBudget({
			input: ['entry'],
			modules
		});
		await bundle.close();

		const entryChunk = output.find(chunk => chunk.type === 'chunk' && chunk.isEntry);
		const entry = reports[0].entries[0];
		assert.ok(getUtf8Bytes(entryChunk.code) > entryChunk.code.length);
		assert.equal(entry.syncBytes, getUtf8Bytes(entryChunk.code));
		assert.notEqual(entry.syncBytes, entryChunk.code.length);
	});

	it('uses the final chunk code after renderChunk post-processing', async () => {
		const padding = `/*${'pad!'.repeat(25)}*/`;
		const { bundle, reports, output } = await generateWithBudget({
			input: ['entry-a', 'entry-b'],
			modules: SHARED_DYNAMIC_MODULES,
			plugins: [
				{
					name: 'pad-chunks',
					renderChunk: code => ({ code: code + padding })
				}
			]
		});
		await bundle.close();

		const chunks = getChunksByName(output);
		const entryA = reports[0].entries.find(entry => entry.name === 'entry-a');
		assert.equal(
			entryA.syncBytes,
			getUtf8Bytes(chunks.get('entry-a').code) + getUtf8Bytes(chunks.get('shared').code)
		);
		assert.ok(chunks.get('entry-a').code.trimEnd().endsWith(padding));
	});

	it('keeps reports independent across multiple output configurations', async () => {
		const reports = [];
		const formats = [];
		const bundle = await rollup({
			input: ['entry-a', 'entry-b'],
			plugins: [
				virtualModules(SHARED_DYNAMIC_MODULES),
				chunkDependencyBudget({
					budgets: { default: 100_000 },
					onReport: (report, outputOptions) => {
						reports.push(report);
						formats.push(outputOptions.format);
					}
				})
			]
		});
		await bundle.generate({ chunkFileNames: '[name].js', format: 'es' });
		const esReportJson = JSON.stringify(reports[0]);
		await bundle.generate({ chunkFileNames: '[name].js', format: 'cjs' });
		await bundle.close();

		assert.deepEqual(formats, ['es', 'cjs']);
		assert.equal(reports.length, 2);
		assert.equal(JSON.stringify(reports[0]), esReportJson, 'the first report must not be mutated');
		assert.notEqual(
			reports[0].entries[0].syncBytes,
			reports[1].entries[0].syncBytes,
			'each output configuration is measured against its own final code'
		);
	});

	it('marks external dependencies as unknown cost instead of zero', async () => {
		const modules = {
			entry: [
				"import { externalValue } from 'external-dep';",
				'export const value = externalValue;'
			].join('\n')
		};
		const { bundle, reports, output } = await generateWithBudget({
			external: id => id === 'external-dep',
			input: ['entry'],
			modules
		});
		await bundle.close();

		const entry = reports[0].entries[0];
		assert.deepEqual(entry.externals, [{ cost: 'unknown', id: 'external-dep' }]);
		const entryChunk = output.find(chunk => chunk.type === 'chunk' && chunk.isEntry);
		assert.equal(entry.syncBytes, getUtf8Bytes(entryChunk.code));
	});

	it('produces a stably sorted JSON report across repeated checks of the same build', async () => {
		const reports = [];
		const bundle = await rollup({
			input: ['entry-a', 'entry-b'],
			plugins: [
				virtualModules(SHARED_DYNAMIC_MODULES),
				chunkDependencyBudget({ onReport: report => reports.push(report) })
			]
		});
		const generateOptions = { chunkFileNames: '[name].js', format: 'es' };
		await bundle.generate(generateOptions);
		await bundle.generate(generateOptions);
		await bundle.close();

		assert.equal(reports.length, 2);
		assert.equal(JSON.stringify(reports[0]), JSON.stringify(reports[1]));

		const report = reports[0];
		const entryNames = report.entries.map(entry => entry.name);
		assert.deepEqual(entryNames, [...entryNames].sort());
		for (const entry of report.entries) {
			const chunkNames = entry.syncChunks.map(chunk => chunk.fileName);
			assert.deepEqual(chunkNames, [...chunkNames].sort());
			assert.deepEqual(entry.dynamicChunks, [...entry.dynamicChunks].sort());
			assert.deepEqual(
				entry.externals.map(external => external.id),
				entry.externals.map(external => external.id).sort()
			);
		}
	});
});
