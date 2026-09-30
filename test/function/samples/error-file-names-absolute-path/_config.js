module.exports = defineTest({
	description: 'throws for an absolute file name with strict-portable file names',
	options: {
		plugins: [
			{
				name: 'test',
				generateBundle(_options, bundle) {
					bundle['/etc/escaped.js'] = {
						type: 'asset',
						fileName: '/etc/escaped.js',
						names: [],
						needsCodeReference: false,
						originalFileNames: [],
						source: 'escaped'
					};
				}
			}
		],
		output: {
			fileNames: 'strict-portable'
		}
	},
	generateError: {
		code: 'FILE_NAME_OUTSIDE_OUTPUT_DIRECTORY',
		message:
			'The output file name "/etc/escaped.js" is not contained in the output directory. Make sure all file names are relative paths without ".." segments.'
	}
});
