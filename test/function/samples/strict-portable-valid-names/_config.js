const assert = require('node:assert/strict');

const fileNamesAfterGenerateBundle = [];

module.exports = defineTest({
	description:
		'accepts hashed, normalized sub-directory and Unicode file names with strict-portable file names',
	options: {
		plugins: [
			{
				name: 'emits-additional-assets',
				generateBundle(_options, bundle) {
					this.emitFile({
						type: 'asset',
						name: 'readme.txt',
						source: 'in nested directory'
					});
					bundle['./nested//readme.txt'] = {
						type: 'asset',
						fileName: './nested//readme.txt',
						names: [],
						needsCodeReference: false,
						originalFileNames: [],
						source: 'nested'
					};
					bundle['caf\u00e9-\u4e2d\u6587.txt'] = {
						type: 'asset',
						fileName: 'caf\u00e9-\u4e2d\u6587.txt',
						names: [],
						needsCodeReference: false,
						originalFileNames: [],
						source: 'unicode'
					};
				}
			},
			{
				name: 'records-final-file-names',
				generateBundle(_options, bundle) {
					fileNamesAfterGenerateBundle.length = 0;
					for (const outputFile of Object.values(bundle)) {
						if (outputFile.type !== 'placeholder') {
							fileNamesAfterGenerateBundle.push(outputFile.fileName);
						}
					}
				}
			}
		],
		output: {
			assetFileNames: 'assets/[name]-[hash].txt',
			fileNames: 'strict-portable'
		}
	},
	exports() {
		assert.equal(fileNamesAfterGenerateBundle.length, 4);
		assert.ok(fileNamesAfterGenerateBundle.includes('main.js'));
		assert.ok(
			fileNamesAfterGenerateBundle.some(fileName =>
				/^assets\/readme-[A-Za-z0-9_-]+\.txt$/.test(fileName)
			)
		);
		assert.ok(fileNamesAfterGenerateBundle.includes('./nested//readme.txt'));
		assert.ok(fileNamesAfterGenerateBundle.includes('caf\u00e9-\u4e2d\u6587.txt'));
	}
});
