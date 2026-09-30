module.exports = defineTest({
	description: 'throws for a file name ending with a space with strict-portable file names',
	options: {
		plugins: [
			{
				name: 'test',
				generateBundle(_options, bundle) {
					bundle['bad '] = {
						type: 'asset',
						fileName: 'bad ',
						names: [],
						needsCodeReference: false,
						originalFileNames: [],
						source: 'trailing space'
					};
				}
			}
		],
		output: {
			fileNames: 'strict-portable'
		}
	},
	generateError: {
		code: 'INVALID_PORTABLE_FILE_NAME',
		message:
			'The output file name "bad " is not portable: path segments must not end with a dot or a space.',
		url: 'https://rollupjs.org/configuration-options/#output-filenames'
	}
});
