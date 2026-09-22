const assert = require('node:assert/strict');
const {
	moduleOwnershipManifest
} = require('../../../../../plugins/module-ownership-manifest/index.js');

module.exports = defineTest({
	description: 'emits a manifest with chunk graph, module lengths and asset origins',
	options: {
		input: { main: 'main.js', second: 'second.js' },
		plugins: [
			{
				name: 'asset-emitter',
				buildStart() {
					this.emitFile({ type: 'asset', name: 'orphan.txt', source: 'no module origin' });
				},
				transform(code, id) {
					if (id.endsWith('shared.js')) {
						this.emitFile({ type: 'asset', name: 'shared-notes.txt', source: 'notes' });
					}
				}
			},
			moduleOwnershipManifest({ root: __dirname }),
			{
				name: 'verify-manifest',
				generateBundle(outputOptions, bundle) {
					const manifest = JSON.parse(bundle['module-manifest.json'].source);

					for (const fileName of [
						...Object.keys(manifest.chunks),
						...Object.keys(manifest.assets),
						...manifest.unknownAssets
					]) {
						assert.ok(bundle[fileName], fileName + ' exists in the bundle');
					}
					assert.ok(!('module-manifest.json' in manifest.chunks));
					assert.ok(!('module-manifest.json' in manifest.assets));

					const entry = manifest.entries['main.js'];
					assert.ok(entry, 'entry chunk recorded');
					assert.strictEqual(entry.facadeModule, 'main.js');
					assert.deepStrictEqual(entry.staticChunks, ['chunks/shared.js', 'main.js']);
					assert.deepStrictEqual(entry.dynamicEdges, [
						{ from: 'main.js', to: 'chunks/dynamic.js' }
					]);
					assert.deepStrictEqual(manifest.entries['second.js'].staticChunks, [
						'chunks/shared.js',
						'second.js'
					]);

					const sharedChunk = manifest.chunks['chunks/shared.js'];
					assert.ok(sharedChunk, 'shared chunk recorded');
					assert.deepStrictEqual(Object.keys(sharedChunk.modules), ['shared.js']);
					assert.ok(sharedChunk.modules['shared.js'].originalLength > 0);
					assert.ok(sharedChunk.modules['shared.js'].renderedLength > 0);
					assert.ok(manifest.notes.renderedLength.includes('not the minified'));

					const uniqueModuleIds = new Set();
					let originalLength = 0;
					let renderedLength = 0;
					for (const chunk of Object.values(manifest.chunks)) {
						for (const [id, lengths] of Object.entries(chunk.modules)) {
							if (!uniqueModuleIds.has(id)) {
								uniqueModuleIds.add(id);
								originalLength += lengths.originalLength;
								renderedLength += lengths.renderedLength;
							}
						}
					}
					assert.strictEqual(manifest.totals.modules, 4);
					assert.strictEqual(manifest.totals.modules, uniqueModuleIds.size);
					assert.strictEqual(manifest.totals.originalLength, originalLength);
					assert.strictEqual(manifest.totals.renderedLength, renderedLength);

					assert.strictEqual(manifest.assets['assets/shared-notes.txt'].attributedTo, 'shared.js');
					assert.deepStrictEqual(manifest.assets['assets/shared-notes.txt'].emittedBy, [
						{ module: 'shared.js', plugin: 'asset-emitter' }
					]);
					assert.deepStrictEqual(manifest.unknownAssets, ['assets/orphan.txt']);
				}
			}
		],
		output: {
			assetFileNames: 'assets/[name][extname]',
			chunkFileNames: 'chunks/[name].js'
		}
	}
});
