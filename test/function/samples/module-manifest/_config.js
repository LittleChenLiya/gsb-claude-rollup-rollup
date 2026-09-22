const assert = require('node:assert/strict');
const { moduleManifest } = require('../../../../dist/rollup');

const MANIFEST_FILE_NAME = 'manifest.json';

function getManifest(bundle) {
	const manifestAsset = bundle[MANIFEST_FILE_NAME];
	assert.ok(manifestAsset, 'the manifest asset is emitted');
	assert.strictEqual(manifestAsset.type, 'asset');
	return JSON.parse(manifestAsset.source);
}

module.exports = defineTest({
	description: 'generates a module attribution manifest with final file names',
	options: {
		input: ['main.js', 'second.js'],
		plugins: [
			{
				name: 'emit-assets',
				buildStart() {
					this.emitFile({ fileName: 'unattributed.txt', source: 'unknown origin', type: 'asset' });
				},
				transform(code, id) {
					if (id.endsWith('shared.js')) {
						this.emitFile({ name: 'data.txt', source: 'from shared', type: 'asset' });
					}
					if (id.endsWith('main.js')) {
						this.emitFile({ name: 'data.txt', source: 'from main', type: 'asset' });
					}
				}
			},
			moduleManifest({ fileName: MANIFEST_FILE_NAME, root: __dirname }),
			{
				name: 'verify-manifest',
				generateBundle(options, bundle) {
					if (options.entryFileNames !== '[name].js') {
						// only verify the first output, the second output is checked
						// in the "bundle" config function below
						return;
					}
					const manifest = getManifest(bundle);

					assert.strictEqual(manifest.version, 1);

					// every file mentioned in the manifest exists in the bundle and
					// the manifest does not include itself
					const mentionedFiles = new Set([
						...Object.keys(manifest.chunks),
						...Object.keys(manifest.assets),
						...manifest.dynamicImportEdges.flatMap(({ from, to }) => [from, to]),
						...Object.values(manifest.entries).flatMap(entry => [
							...entry.staticChunks,
							...entry.dynamicImports
						])
					]);
					for (const fileName of mentionedFiles) {
						assert.notStrictEqual(fileName, MANIFEST_FILE_NAME);
						assert.ok(bundle[fileName], `manifest references existing file "${fileName}"`);
					}

					// entries and their statically reachable chunks
					assert.deepStrictEqual(Object.keys(manifest.entries).sort(), ['main.js', 'second.js']);
					const sharedChunkName = Object.keys(manifest.chunks).find(fileName =>
						Object.keys(manifest.chunks[fileName].modules).includes('shared.js')
					);
					assert.ok(sharedChunkName, 'a shared chunk exists');
					assert.match(sharedChunkName, /^chunks\/shared-[\w-]+\.js$/);
					assert.deepStrictEqual(
						manifest.entries['main.js'].staticChunks.sort(),
						['main.js', sharedChunkName].sort()
					);
					assert.deepStrictEqual(
						manifest.entries['second.js'].staticChunks.sort(),
						['second.js', sharedChunkName].sort()
					);
					assert.strictEqual(manifest.entries['main.js'].facadeModuleId, 'main.js');

					// per-module lengths
					const sharedModule = manifest.chunks[sharedChunkName].modules['shared.js'];
					assert.ok(sharedModule.originalLength > 0);
					assert.ok(sharedModule.renderedLength > 0);

					// dynamic import edges use the final hashed file name
					const dynamicChunkName = Object.keys(manifest.chunks).find(fileName =>
						fileName.startsWith('chunks/dynamic-')
					);
					assert.ok(dynamicChunkName, 'a hashed dynamic chunk exists');
					assert.deepStrictEqual(manifest.dynamicImportEdges, [
						{ from: 'main.js', to: dynamicChunkName }
					]);
					assert.deepStrictEqual(manifest.entries['main.js'].dynamicImports, [dynamicChunkName]);
					assert.deepStrictEqual(manifest.entries['second.js'].dynamicImports, []);

					// assets with the same name but different sources stay separate
					// and are attributed to the emitting modules
					const dataAssets = Object.values(manifest.assets)
						.filter(asset => asset.names.includes('data.txt'))
						.map(asset => asset.emittedBy);
					assert.deepStrictEqual(dataAssets.sort(), [['main.js'], ['shared.js']].sort());

					// unattributable assets end up in the unknown list
					assert.deepStrictEqual(manifest.unknown.assets, ['unattributed.txt']);
					assert.deepStrictEqual(manifest.assets['unattributed.txt'].emittedBy, []);

					// totals count each module only once even though the shared chunk
					// is reachable from both entries
					const modulesById = new Map();
					for (const chunk of Object.values(manifest.chunks)) {
						for (const [id, module] of Object.entries(chunk.modules)) {
							assert.ok(!modulesById.has(id), `module "${id}" appears in only one chunk`);
							modulesById.set(id, module);
						}
					}
					assert.strictEqual(manifest.totals.modules, 4);
					assert.strictEqual(manifest.totals.modules, modulesById.size);
					assert.strictEqual(
						manifest.totals.renderedLength,
						[...modulesById.values()].reduce((sum, module) => sum + module.renderedLength, 0)
					);
					assert.strictEqual(
						manifest.totals.originalLength,
						[...modulesById.values()].reduce((sum, module) => sum + module.originalLength, 0)
					);
				}
			}
		],
		output: {
			entryFileNames: '[name].js',
			chunkFileNames: 'chunks/[name]-[hash].js',
			assetFileNames: 'assets/[name]-[hash][extname]'
		}
	},
	async bundle(bundle) {
		// a second, independent output gets its own manifest with its own file names
		const { output } = await bundle.generate({
			entryFileNames: 'esm/[name].js',
			chunkFileNames: 'esm/[name]-[hash].js',
			format: 'es'
		});
		const manifest = JSON.parse(output.find(file => file.fileName === MANIFEST_FILE_NAME).source);
		assert.deepStrictEqual(Object.keys(manifest.entries).sort(), ['esm/main.js', 'esm/second.js']);
		assert.ok(
			Object.keys(manifest.chunks).every(fileName => fileName.startsWith('esm/')),
			'the second manifest only references files of the second output'
		);
	},
	exports(exports) {
		assert.strictEqual(exports.result, 42);
	}
});
