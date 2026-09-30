module.exports = defineTest({
	description: 'throws for a non-escaping ".." segment with strict-portable file names',
	options: {
		plugins: [
			{
				name: 'test',
				generateBundle(_options, bundle) {
					bundle['sub/../escaped.js'] = {
						type: 'asset',
						fileName: 'sub/../escaped.js',
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
		code: 'INVALID_PORTABLE_FILE_NAME',
		message:
			'The output file name "sub/../escaped.js" is not portable: it must not contain ".." segments, which can escape the output directory.',
		url: 'https://rollupjs.org/configuration-options/#output-filenames'
	}
});
