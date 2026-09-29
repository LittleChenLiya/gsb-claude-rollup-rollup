const { loader } = require('../../../testHelpers.js');

module.exports = defineTest({
	description: 'strict-portable file name strategy reports both sources for ASCII case conflicts',
	options: {
		output: {
			fileNameStrategy: 'strict-portable',
			format: 'es'
		},
		plugins: [
			loader({ main: 'export default 42;' }),
			{
				name: 'readme-upper',
				generateBundle() {
					this.emitFile({
						fileName: 'README.txt',
						source: 'uppercase',
						type: 'asset'
					});
				}
			},
			{
				name: 'readme-lower',
				generateBundle() {
					this.emitFile({
						fileName: 'Readme.txt',
						source: 'lowercase',
						type: 'asset'
					});
				}
			}
		]
	},
	generateError: {
		code: 'PORTABLE_FILE_NAME_CONFLICT',
		message:
			'The output file names "Readme.txt" (from plugin "readme-lower") and "README.txt" (from plugin "readme-upper") are treated as the same file on case-insensitive file systems. Rename one of the files to use a distinct, portable name.'
	}
});
