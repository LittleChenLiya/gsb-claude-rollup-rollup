module.exports = defineTest({
	description: 'strict-portable file name strategy rejects path segments ending in a dot',
	options: {
		output: {
			fileNameStrategy: 'strict-portable',
			format: 'es'
		},
		plugins: [
			{
				name: 'trailing-dot',
				generateBundle(_options, bundle) {
					bundle['dir./file'] = {
						type: 'asset',
						fileName: 'dir./file',
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
			'The output file name "dir./file" (from an unknown source) is not portable: no path segment may end with a "." or a space. Rename the file to use a portable name.'
	}
});
