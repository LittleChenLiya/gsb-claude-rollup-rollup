module.exports = defineTest({
	description:
		'throws when two emitted assets differ only in ASCII casing with strict-portable file names',
	options: {
		plugins: [
			{
				name: 'emits-readme',
				generateBundle(_options, bundle) {
					bundle['Readme.txt'] = {
						type: 'asset',
						fileName: 'Readme.txt',
						names: [],
						needsCodeReference: false,
						originalFileNames: [],
						source: 'readme'
					};
				}
			},
			{
				name: 'emits-uppercase-readme',
				generateBundle(_options, bundle) {
					bundle['README.txt'] = {
						type: 'asset',
						fileName: 'README.txt',
						names: [],
						needsCodeReference: false,
						originalFileNames: [],
						source: 'uppercase readme'
					};
				}
			}
		],
		output: {
			fileNames: 'strict-portable'
		}
	},
	generateError: {
		code: 'FILE_NAME_CASE_CONFLICT',
		message:
			'The output files "README.txt" and "Readme.txt" differ only in the casing of their file names. File names that are identical when their ASCII characters are lower-cased cannot coexist on case-insensitive file systems.',
		url: 'https://rollupjs.org/configuration-options/#output-filenames'
	}
});
