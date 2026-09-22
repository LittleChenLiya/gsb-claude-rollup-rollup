const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = defineTest({
	description: 'tracks which plugin and module emitted an asset via this.emitFile',
	options: {
		input: 'main.js',
		plugins: [
			{
				name: 'emitting-plugin',
				buildStart() {
					this.emitFile({ type: 'asset', name: 'from-build-start.txt', source: 'build start' });
				},
				transform(code, id) {
					if (id.endsWith('main.js') || id.endsWith('other.js')) {
						this.emitFile({ type: 'asset', name: 'shared-source.txt', source: 'same source' });
					}
				},
				generateBundle(options, bundle) {
					assert.deepStrictEqual(bundle['assets/from-build-start.txt'].emittedBy, [
						{ module: null, plugin: 'emitting-plugin' }
					]);
					const mergedOrigins = [...bundle['assets/shared-source.txt'].emittedBy].sort(
						(first, second) => first.module.localeCompare(second.module)
					);
					assert.deepStrictEqual(mergedOrigins, [
						{ module: path.resolve(__dirname, 'main.js'), plugin: 'emitting-plugin' },
						{ module: path.resolve(__dirname, 'other.js'), plugin: 'emitting-plugin' }
					]);
					assert.deepStrictEqual(bundle['main.js.map'].emittedBy, []);
				}
			}
		],
		output: {
			assetFileNames: 'assets/[name][extname]',
			sourcemap: true
		}
	}
});
