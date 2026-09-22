const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { moduleManifest, rollup } = require('../../dist/rollup');

const MANIFEST_FILE_NAME = 'manifest.json';

function memoryLoader(files) {
	return {
		name: 'memory-loader',
		resolveId(id, importer) {
			if (id in files) return id;
			if (importer && id.startsWith('.')) {
				const resolved = path.posix.join(path.posix.dirname(importer), id);
				if (resolved in files) return resolved;
			}
			return null;
		},
		load(id) {
			return id in files ? files[id] : null;
		}
	};
}

function emitAssetFromShared() {
	return {
		name: 'emit-asset-from-shared',
		transform(code, id) {
			if (id === 'shared.js') {
				this.emitFile({ name: 'shared.txt', source: 'from shared', type: 'asset' });
			}
		}
	};
}

function getManifest(output) {
	const manifestAsset = output.find(file => file.fileName === MANIFEST_FILE_NAME);
	assert.ok(manifestAsset, 'the manifest asset is emitted');
	return JSON.parse(manifestAsset.source);
}

const baseFiles = () => ({
	'main.js':
		'import { shared } from "./shared.js"; export const result = shared; export const load = () => import("./dynamic.js");',
	'second.js': 'import { shared } from "./shared.js"; export const second = shared;',
	'shared.js': 'export const shared = 42;',
	'dynamic.js': 'export const dynamic = "dynamic";'
});

const manifestPlugin = () => moduleManifest({ fileName: MANIFEST_FILE_NAME });

describe('module-manifest', () => {
	it('generates independent manifests for multiple outputs', async () => {
		const bundle = await rollup({
			input: ['main.js', 'second.js'],
			plugins: [memoryLoader(baseFiles()), manifestPlugin()]
		});
		const esOutput = await bundle.generate({
			chunkFileNames: 'chunks/[name]-[hash].js',
			format: 'es'
		});
		const cjsOutput = await bundle.generate({
			chunkFileNames: 'cjs-chunks/[name].js',
			format: 'cjs'
		});
		const esManifest = getManifest(esOutput.output);
		const cjsManifest = getManifest(cjsOutput.output);

		assert.ok(
			Object.keys(esManifest.chunks).every(fileName => !fileName.startsWith('cjs-chunks/')),
			'the es manifest does not reference cjs chunks'
		);
		assert.ok(
			Object.keys(cjsManifest.chunks).every(fileName => !fileName.startsWith('chunks/')),
			'the cjs manifest does not reference es chunks'
		);
		assert.deepStrictEqual(
			Object.keys(esManifest.entries).sort(),
			['main.js', 'second.js'],
			'both entries are listed'
		);
		// both manifests describe the same modules independently
		const esModules = Object.values(esManifest.chunks).flatMap(chunk => Object.keys(chunk.modules));
		const cjsModules = Object.values(cjsManifest.chunks).flatMap(chunk =>
			Object.keys(chunk.modules)
		);
		assert.deepStrictEqual(esModules.sort(), cjsModules.sort());
	});

	it('removes stale modules, chunks and edges when a dynamic module is removed on rebuild', async () => {
		const files = baseFiles();
		const firstBundle = await rollup({
			input: ['main.js', 'second.js'],
			plugins: [memoryLoader(files), emitAssetFromShared(), manifestPlugin()]
		});
		const firstManifest = getManifest(
			(await firstBundle.generate({ chunkFileNames: 'chunks/[name].js', format: 'es' })).output
		);
		assert.deepStrictEqual(firstManifest.dynamicImportEdges, [
			{ from: 'main.js', to: 'chunks/dynamic.js' }
		]);
		assert.ok('dynamic.js' in firstManifest.chunks['chunks/dynamic.js'].modules);
		const firstTotals = firstManifest.totals;

		// modify main.js to drop the dynamic import and remove the dynamic module
		files['main.js'] = 'import { shared } from "./shared.js"; export const result = shared;';
		delete files['dynamic.js'];

		const secondBundle = await rollup({
			cache: firstBundle.cache,
			input: ['main.js', 'second.js'],
			plugins: [memoryLoader(files), emitAssetFromShared(), manifestPlugin()]
		});
		const secondManifest = getManifest(
			(await secondBundle.generate({ chunkFileNames: 'chunks/[name].js', format: 'es' })).output
		);

		assert.deepStrictEqual(secondManifest.dynamicImportEdges, []);
		assert.ok(!('chunks/dynamic.js' in secondManifest.chunks), 'the old chunk is gone');
		assert.ok(
			!Object.values(secondManifest.chunks).some(chunk => 'dynamic.js' in chunk.modules),
			'the removed module does not linger in any chunk'
		);
		assert.strictEqual(secondManifest.totals.modules, firstTotals.modules - 1);
		assert.ok(secondManifest.totals.originalLength < firstTotals.originalLength);

		// assets emitted from the transform hook keep their module attribution
		// even when the transform result comes from the cache
		const sharedAsset = Object.values(secondManifest.assets).find(asset =>
			asset.names.includes('shared.txt')
		);
		assert.ok(sharedAsset, 'the asset emitted from the cached transform is re-emitted');
		assert.deepStrictEqual(sharedAsset.emittedBy, ['shared.js']);
	});

	it('lists only files that exist in the written output', async () => {
		const outputDir = path.join(__dirname, '..', '_tmp', 'module-manifest');
		fs.rmSync(outputDir, { force: true, recursive: true });
		try {
			const bundle = await rollup({
				input: ['main.js', 'second.js'],
				plugins: [memoryLoader(baseFiles()), emitAssetFromShared(), manifestPlugin()]
			});
			await bundle.write({
				assetFileNames: 'assets/[name]-[hash][extname]',
				chunkFileNames: 'chunks/[name]-[hash].js',
				dir: outputDir,
				format: 'es'
			});
			const manifest = JSON.parse(
				fs.readFileSync(path.join(outputDir, MANIFEST_FILE_NAME), 'utf8')
			);
			const mentionedFiles = new Set([
				...Object.keys(manifest.chunks),
				...Object.keys(manifest.assets),
				...manifest.dynamicImportEdges.flatMap(({ from, to }) => [from, to]),
				...Object.values(manifest.entries).flatMap(entry => [
					...entry.staticChunks,
					...entry.dynamicImports
				])
			]);
			assert.ok(mentionedFiles.size > 0);
			for (const fileName of mentionedFiles) {
				assert.ok(
					fs.existsSync(path.join(outputDir, fileName)),
					`"${fileName}" from the manifest exists on disk`
				);
			}
		} finally {
			fs.rmSync(outputDir, { force: true, recursive: true });
		}
	});

	it('supports preserveModules and manualChunks', async () => {
		const preserveBundle = await rollup({
			input: ['main.js', 'second.js'],
			plugins: [memoryLoader(baseFiles()), manifestPlugin()]
		});
		const preserveManifest = getManifest(
			(
				await preserveBundle.generate({
					format: 'es',
					preserveModules: true
				})
			).output
		);
		assert.ok(preserveManifest.chunks['_virtual/main.js'], 'each module gets its own chunk');
		assert.ok(preserveManifest.chunks['_virtual/shared.js']);
		assert.deepStrictEqual(Object.keys(preserveManifest.chunks['_virtual/shared.js'].modules), [
			'shared.js'
		]);
		assert.ok(
			preserveManifest.entries['_virtual/main.js'].staticChunks.includes('_virtual/shared.js')
		);

		const manualBundle = await rollup({
			input: ['main.js', 'second.js'],
			plugins: [memoryLoader(baseFiles()), manifestPlugin()]
		});
		const manualManifest = getManifest(
			(
				await manualBundle.generate({
					chunkFileNames: 'chunks/[name].js',
					format: 'es',
					manualChunks: { vendor: ['shared.js'] }
				})
			).output
		);
		assert.deepStrictEqual(Object.keys(manualManifest.chunks['chunks/vendor.js'].modules), [
			'shared.js'
		]);
		assert.ok(manualManifest.entries['main.js'].staticChunks.includes('chunks/vendor.js'));
		assert.ok(manualManifest.entries['second.js'].staticChunks.includes('chunks/vendor.js'));
	});

	it('keeps virtual module ids identifiable and lists unknown assets', async () => {
		const bundle = await rollup({
			input: ['main.js'],
			plugins: [
				memoryLoader({ 'main.js': 'import "virtual:dep"; export const result = 1;' }),
				{
					name: 'virtual-dep',
					resolveId(id) {
						if (id === 'virtual:dep') return '\0virtual:dep';
					},
					load(id) {
						if (id === '\0virtual:dep') return 'globalThis.virtualDepIncluded = true;';
					}
				},
				{
					name: 'emit-from-build-start',
					buildStart() {
						this.emitFile({ fileName: 'unattributed.txt', source: 'x', type: 'asset' });
					}
				},
				manifestPlugin()
			]
		});
		const manifest = getManifest((await bundle.generate({ format: 'es' })).output);
		assert.ok(
			Object.values(manifest.chunks).some(chunk => '\0virtual:dep' in chunk.modules),
			'the virtual module keeps its identifiable id'
		);
		assert.deepStrictEqual(manifest.unknown.assets, ['unattributed.txt']);
		assert.deepStrictEqual(manifest.assets['unattributed.txt'].emittedBy, []);
	});
});
