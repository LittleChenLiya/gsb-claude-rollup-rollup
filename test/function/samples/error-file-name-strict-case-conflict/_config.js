module.exports = defineTest({
	description:
		'strict-portable file name strategy reports both sources when two emitted files differ only by ASCII case',
	options: {
		output: {
			fileNameStrategy: 'strict-portable',
			format: 'es'
		},
		plugins: [
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
