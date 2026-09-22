const assert = require('node:assert');
const rollup = require('../../dist/rollup');
const { loader } = require('../testHelpers.js');
const { moduleOwnershipManifest } = require('../../plugins/module-ownership-manifest/index.js');

function getManifest(output) {
	const manifestAsset = output.find(item => item.fileName === 'module-manifest.json');
	assert.ok(manifestAsset, 'manifest asset is emitted');
	return JSON.parse(manifestAsset.source);
}

function assertManifestFilesExist(manifest, output) {
	const fileNames = new Set(output.map(item => item.fileName));
	for (const fileName of [
		...Object.keys(manifest.chunks),
		...Object.keys(manifest.assets),
		...manifest.unknownAssets
	]) {
		assert.ok(fileNames.has(fileName), fileName + ' exists in the output');
	}
}

describe('module-ownership-manifest plugin', () => {
	it('generates independent manifests for multiple outputs including preserveModules', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [
				loader({
					main: 'import { shared } from "shared"; export const load = () => import("virtual:dyn"); export const result = shared;',
					shared: 'export const shared = "shared";'
				}),
				{
					name: 'virtual-module',
					resolveId(id) {
						if (id === 'virtual:dyn') return '\0virtual:dyn';
					},
					load(id) {
						if (id === '\0virtual:dyn') return 'export const dynamic = "dynamic";';
					}
				},
				moduleOwnershipManifest()
			]
		});

		const { output: hashedOutput } = await bundle.generate({
			format: 'es',
			entryFileNames: '[name]-[hash].js',
			chunkFileNames: 'chunks/[name]-[hash].js'
		});
		const { output: preservedOutput } = await bundle.generate({
			format: 'es',
			preserveModules: true
		});
		await bundle.close();

		const hashedManifest = getManifest(hashedOutput);
		const preservedManifest = getManifest(preservedOutput);
		assertManifestFilesExist(hashedManifest, hashedOutput);
		assertManifestFilesExist(preservedManifest, preservedOutput);

		assert.notDeepStrictEqual(
			Object.keys(hashedManifest.chunks),
			Object.keys(preservedManifest.chunks)
		);
		assert.ok(
			Object.keys(hashedManifest.chunks).every(fileName => !fileName.includes('[hash]')),
			'hashed output uses final file names'
		);
		assert.ok(preservedManifest.chunks['_virtual/main.js'], 'entry is preserved as its own chunk');
		assert.ok(
			preservedManifest.chunks['_virtual/shared.js'],
			'shared module is preserved as its own chunk'
		);
		assert.ok(
			Object.values(preservedManifest.chunks).some(chunk =>
				Object.prototype.hasOwnProperty.call(chunk.modules, '\0virtual:dyn')
			),
			'virtual module keeps its recognizable id'
		);
		assert.strictEqual(hashedManifest.totals.modules, 3);
		assert.strictEqual(preservedManifest.totals.modules, 3);

		const hashedEntry = Object.values(hashedManifest.entries)[0];
		assert.deepStrictEqual(hashedEntry.dynamicEdges.length, 1);
		const dynamicChunk = hashedManifest.chunks[hashedEntry.dynamicEdges[0].to];
		assert.ok(dynamicChunk.isDynamicEntry, 'dynamic edge points to the dynamic entry chunk');
		assert.deepStrictEqual(Object.keys(dynamicChunk.modules), ['\0virtual:dyn']);
	});

	it('references final hashed file names', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [
				loader({
					main: 'export const load = () => import("dynamic"); export const result = 1;',
					dynamic: 'export const dynamic = "dynamic";'
				}),
				{
					name: 'asset-emitter',
					transform(code, id) {
						if (id === 'main') {
							this.emitFile({ type: 'asset', name: 'notes.txt', source: 'notes' });
						}
					}
				},
				moduleOwnershipManifest()
			]
		});
		const { output } = await bundle.generate({
			format: 'es',
			assetFileNames: 'assets/[name]-[hash][extname]',
			chunkFileNames: 'chunks/[name]-[hash].js',
			entryFileNames: '[name]-[hash].js'
		});
		await bundle.close();

		const manifest = getManifest(output);
		assertManifestFilesExist(manifest, output);
		const serialized = JSON.stringify(manifest);
		assert.ok(!serialized.includes('[hash]'), 'no unresolved hash placeholders');
		assert.ok(!serialized.includes('!~'), 'no unresolved hash placeholders');
		assert.match(Object.keys(manifest.entries)[0], /^main-.+[.]js$/);
		const dynamicEdge = Object.values(manifest.entries)[0].dynamicEdges[0];
		assert.match(dynamicEdge.to, /^chunks\/dynamic-.+[.]js$/);
		const assetFileName = Object.keys(manifest.assets)[0];
		assert.match(assetFileName, /^assets\/notes-.+[.]txt$/);
		assert.strictEqual(manifest.assets[assetFileName].attributedTo, 'main');
	});

	it('does not keep stale records when a dynamic module is removed before a rebuild', async () => {
		const manifestPlugin = moduleOwnershipManifest();
		const files = {
			main: 'import { shared } from "shared"; export const load = () => import("dynamic"); export const result = shared;',
			shared: 'export const shared = "shared";',
			dynamic: 'export const dynamic = "dynamic";'
		};
		const build = () => rollup.rollup({ input: 'main', plugins: [loader(files), manifestPlugin] });

		const firstBundle = await build();
		const { output: firstOutput } = await firstBundle.generate({ format: 'es' });
		await firstBundle.close();
		const firstManifest = getManifest(firstOutput);
		assert.ok(
			Object.keys(firstManifest.chunks).some(fileName => fileName.startsWith('dynamic-')),
			'dynamic chunk is recorded initially'
		);

		delete files.dynamic;
		files.main = 'import { shared } from "shared"; export const result = shared;';
		const secondBundle = await build();
		const { output: secondOutput } = await secondBundle.generate({ format: 'es' });
		await secondBundle.close();
		const secondManifest = getManifest(secondOutput);

		assert.ok(
			!Object.keys(secondManifest.chunks).some(fileName => fileName.startsWith('dynamic-')),
			'no stale records of the removed dynamic module remain'
		);
		assert.ok(
			!Object.values(secondManifest.chunks).some(chunk =>
				Object.keys(chunk.modules).some(id => id.includes('dynamic'))
			),
			'no stale module records of the removed dynamic module remain'
		);
		assert.strictEqual(secondManifest.totals.modules, 2);
		assert.strictEqual(firstManifest.totals.modules, 3);
	});
});
