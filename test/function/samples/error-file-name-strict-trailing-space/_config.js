module.exports = defineTest({
	description: 'strict-portable file name strategy rejects file names with a trailing space',
	options: {
		output: {
			fileNameStrategy: 'strict-portable',
			format: 'es'
		},
		plugins: [
			{
				name: 'trailing-space',
				generateBundle(_options, bundle) {
					bundle['data '] = {
						type: 'asset',
						fileName: 'data ',
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
			'The output file name "data " (from an unknown source) is not portable: no path segment may end with a "." or a space. Rename the file to use a portable name.'
	}
});
