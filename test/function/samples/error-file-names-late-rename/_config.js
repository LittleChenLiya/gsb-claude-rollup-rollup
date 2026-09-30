module.exports = defineTest({
	description:
		'throws when a plugin renames a finalized chunk to a reserved name in generateBundle',
	options: {
		plugins: [
			{
				name: 'late-rename',
				generateBundle(_options, bundle) {
					bundle['main.js'].fileName = 'CON.js';
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
			'The output file name "CON.js" is not portable: "CON.js" is a reserved Windows file name.',
		url: 'https://rollupjs.org/configuration-options/#output-filenames'
	}
});
