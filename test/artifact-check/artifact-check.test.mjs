import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { rollup } from 'rollup';
import artifactCheck from './artifact-check.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

// Lets fixture entries `import url from './file.txt'`, emitting the file as a
// real asset so it lands in the importing chunk's referencedFiles.
const assetUrlPlugin = {
	name: 'fixture-asset-url',
	resolveId(source, importer) {
		if (importer && source.endsWith('.txt')) {
			return `${path.resolve(path.dirname(importer), source)}?url`;
		}
		return null;
	},
	load(id) {
		if (id.endsWith('?url')) {
			const filePath = id.slice(0, -4);
			const referenceId = this.emitFile({
				type: 'asset',
				name: path.basename(filePath),
				originalFileName: filePath,
				source: fs.readFileSync(filePath)
			});
			return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
		}
		return null;
	}
};

const outputOptions = {
	assetFileNames: 'assets/[name]-[hash][extname]',
	chunkFileNames: 'chunks/[name]-[hash].js',
	dir: 'dist',
	entryFileNames: '[name].js',
	format: 'es'
};

async function buildWithReport(input, { external, plugins = [] } = {}) {
	let report;
	const bundle = await rollup({
		external,
		input,
		plugins: [assetUrlPlugin, ...plugins, artifactCheck({ onReport: report_ => (report = report_) })]
	});
	await bundle.generate(outputOptions);
	await bundle.close();
	return report;
}

test('closure of the basic fixture contains entry, dynamic chunk and referenced asset', async () => {
	const report = await buildWithReport(path.join(fixtures, 'basic', 'entry.js'));
	assert.equal(report.ok, true);
	assert.deepEqual(report.missing, []);
	assert.deepEqual(report.orphans, []);
	assert.deepEqual(report.externals, []);
	const entry = report.entries['entry.js'];
	assert.ok(entry, 'report lists the entry chunk');
	assert.deepEqual(
		entry.reachable.filter(fileName => !/^(chunks|assets)\//.test(fileName)),
		['entry.js']
	);
	assert.ok(
		entry.reachable.some(fileName => /^chunks\/lazy-.+\.js$/.test(fileName)),
		`dynamic chunk reachable, got ${entry.reachable}`
	);
	assert.ok(
		entry.reachable.some(fileName => /^assets\/asset-.+\.txt$/.test(fileName)),
		`referenced asset reachable, got ${entry.reachable}`
	);
	assert.equal(entry.reachable.length, 3);
});

test('deleting an emitted asset fails the check and locates source chunk and missing file', async () => {
	const deleteAssets = {
		name: 'delete-assets',
		generateBundle(options, bundle) {
			for (const [fileName, item] of Object.entries(bundle)) {
				if (item.type === 'asset') delete bundle[fileName];
			}
		}
	};
	let report;
	const bundle = await rollup({
		input: path.join(fixtures, 'basic', 'entry.js'),
		plugins: [assetUrlPlugin, deleteAssets, artifactCheck({ onReport: report_ => (report = report_) })]
	});
	await assert.rejects(bundle.generate(outputOptions), error => {
		assert.match(error.message, /chunk "entry\.js"/);
		assert.match(error.message, /missing file "assets\/asset-.+\.txt" via referencedFiles/);
		return true;
	});
	await bundle.close();
	assert.equal(report.ok, false);
	assert.deepEqual(report.externals, []);
	assert.equal(report.missing.length, 1);
	assert.equal(report.missing[0].from, 'entry.js');
	assert.match(report.missing[0].file, /^assets\/asset-.+\.txt$/);
	assert.equal(report.missing[0].kind, 'referencedFiles');
	assert.deepEqual(report.entries['entry.js'].missing, report.missing);
});

test('a missing local chunk is reported missing, never treated as external', async () => {
	const deleteDynamicChunks = {
		name: 'delete-dynamic-chunks',
		generateBundle(options, bundle) {
			for (const [fileName, item] of Object.entries(bundle)) {
				if (item.type === 'chunk' && item.isDynamicEntry) delete bundle[fileName];
			}
		}
	};
	let report;
	const bundle = await rollup({
		input: path.join(fixtures, 'basic', 'entry.js'),
		plugins: [assetUrlPlugin, deleteDynamicChunks, artifactCheck({ onReport: report_ => (report = report_) })]
	});
	await assert.rejects(bundle.generate(outputOptions), error => {
		assert.match(error.message, /chunk "entry\.js"/);
		assert.match(error.message, /missing file "chunks\/lazy-.+\.js" via dynamicImports/);
		return true;
	});
	await bundle.close();
	assert.equal(report.ok, false);
	assert.deepEqual(report.externals, []);
	assert.equal(report.missing.length, 1);
	assert.equal(report.missing[0].kind, 'dynamicImports');
});

test('circular dynamic imports terminate and pass the check', async () => {
	const report = await buildWithReport(path.join(fixtures, 'circular', 'main.js'));
	assert.equal(report.ok, true);
	assert.deepEqual(report.missing, []);
	assert.deepEqual(report.orphans, []);
	const entry = report.entries['main.js'];
	assert.ok(entry);
	assert.ok(entry.reachable.some(fileName => /^chunks\/x-.+\.js$/.test(fileName)));
	assert.ok(entry.reachable.some(fileName => /^chunks\/y-.+\.js$/.test(fileName)));
	assert.equal(entry.reachable.length, 3);
});

test('two entries get separate reachable sets sharing the common chunk', async () => {
	const report = await buildWithReport({
		one: path.join(fixtures, 'multi-entry', 'one.js'),
		two: path.join(fixtures, 'multi-entry', 'two.js')
	});
	assert.equal(report.ok, true);
	assert.deepEqual(report.orphans, []);
	const entries = Object.keys(report.entries).sort();
	assert.deepEqual(entries, ['one.js', 'two.js']);
	const sharedChunk = report.entries['one.js'].reachable.find(fileName =>
		/^chunks\/shared-.+\.js$/.test(fileName)
	);
	assert.ok(sharedChunk, `shared chunk reachable from one, got ${report.entries['one.js'].reachable}`);
	assert.deepEqual(report.entries['two.js'].reachable.sort(), ['two.js', sharedChunk].sort());
	assert.ok(
		report.entries['one.js'].reachable.some(fileName => /^chunks\/one-lazy-.+\.js$/.test(fileName))
	);
	assert.ok(
		!report.entries['two.js'].reachable.some(fileName => /^chunks\/one-lazy-.+\.js$/.test(fileName))
	);
});

test('externals come from the real module graph and are excluded from the check', async () => {
	const report = await buildWithReport(path.join(fixtures, 'external', 'entry.js'), {
		external: ['node:fs', 'left-pad']
	});
	assert.equal(report.ok, true);
	assert.deepEqual(report.externals, ['left-pad', 'node:fs']);
	assert.deepEqual(report.missing, []);
	assert.deepEqual(report.entries['entry.js'].reachable, ['entry.js']);
});
