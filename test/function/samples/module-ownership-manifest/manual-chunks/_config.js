const assert = require('node:assert/strict');
const path = require('node:path');
const {
	moduleOwnershipManifest
} = require('../../../../../plugins/module-ownership-manifest/index.js');

module.exports = defineTest({
	description: 'records manualChunks in the manifest',
	options: {
		input: 'main.js',
		plugins: [
			moduleOwnershipManifest({ root: __dirname }),
			{
				name: 'verify-manifest',
				generateBundle(outputOptions, bundle) {
					const manifest = JSON.parse(bundle['module-manifest.json'].source);
					const vendorChunk = manifest.chunks['chunks/vendor.js'];
					assert.ok(vendorChunk, 'manual chunk recorded');
					assert.deepStrictEqual(Object.keys(vendorChunk.modules), ['shared.js']);
					assert.deepStrictEqual(manifest.entries['main.js'].staticChunks, [
						'chunks/vendor.js',
						'main.js'
					]);
					assert.strictEqual(manifest.totals.modules, 2);
				}
			}
		],
		output: {
			chunkFileNames: 'chunks/[name].js',
			manualChunks: { vendor: [path.resolve(__dirname, 'shared.js')] }
		}
	}
});
