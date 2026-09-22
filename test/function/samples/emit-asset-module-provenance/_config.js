const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = defineTest({
	description: 'tracks the emitting module of assets emitted via this.emitFile',
	options: {
		plugins: [
			{
				name: 'emit-assets',
				buildStart() {
					this.emitFile({ fileName: 'from-build-start.txt', source: 'x', type: 'asset' });
				},
				transform(code, id) {
					if (id.endsWith('main.js') || id.endsWith('dep.js')) {
						// same source and no explicit file name, so both emissions are
						// deduplicated into a single asset
						this.emitFile({ name: 'shared-source.txt', source: 'same source', type: 'asset' });
					}
					if (id.endsWith('main.js')) {
						this.emitFile({ fileName: 'from-transform.txt', source: 'x', type: 'asset' });
					}
				},
				generateBundle(options, bundle) {
					const mainId = path.join(__dirname, 'main.js');
					const dependencyId = path.join(__dirname, 'dep.js');
					assert.deepStrictEqual(bundle['from-transform.txt'].emittedByModuleIds, [mainId]);
					assert.deepStrictEqual(bundle['from-build-start.txt'].emittedByModuleIds, []);
					const deduplicatedAsset = Object.values(bundle).find(
						file => file.type === 'asset' && file.names.includes('shared-source.txt')
					);
					assert.ok(deduplicatedAsset, 'the deduplicated asset exists');
					assert.deepStrictEqual(
						deduplicatedAsset.emittedByModuleIds,
						[dependencyId, mainId].sort()
					);
				}
			}
		]
	},
	exports(exports) {
		assert.strictEqual(exports.result, 42);
	}
});
