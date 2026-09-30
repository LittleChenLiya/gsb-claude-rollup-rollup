module.exports = defineTest({
	description: 'throws for a Windows reserved file name with strict-portable file names',
	options: {
		plugins: [
			{
				name: 'test',
				generateBundle(_options, bundle) {
					bundle['CON.txt'] = {
						type: 'asset',
						fileName: 'CON.txt',
						names: [],
						needsCodeReference: false,
						originalFileNames: [],
						source: 'reserved'
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
			'The output file name "CON.txt" is not portable: "CON.txt" is a reserved Windows file name.',
		url: 'https://rollupjs.org/configuration-options/#output-filenames'
	}
});
