module.exports = defineTest({
	description:
		'strict-portable file name strategy rejects Windows reserved file names in subdirectories',
	options: {
		output: {
			fileNameStrategy: 'strict-portable',
			format: 'es'
		},
		plugins: [
			{
				name: 'reserved-name',
				generateBundle(_options, bundle) {
					bundle['data/CON.log'] = {
						type: 'asset',
						fileName: 'data/CON.log',
						name: undefined,
						needsCodeReference: false,
						names: [],
						originalFileNames: [],
						source: 'injected'
					};
				}
			}
		]
	},
	generateError: {
		code: 'PORTABLE_FILE_NAME_VIOLATION',
		message:
			'The output file name "data/CON.log" (from an unknown source) is not portable: "CON.log" is a reserved file name on Windows. Rename the file to use a portable name.'
	}
});
