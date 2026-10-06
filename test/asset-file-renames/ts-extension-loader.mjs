// Resolution hook that allows importing Rollup's TypeScript sources (which
// use extensionless relative imports) directly in Node for unit tests.
export async function resolve(specifier, context, nextResolve) {
	if (
		(specifier.startsWith('./') || specifier.startsWith('../')) &&
		context.parentURL &&
		context.parentURL.includes('/src/')
	) {
		try {
			return await nextResolve(specifier, context);
		} catch {
			return nextResolve(`${specifier}.ts`, context);
		}
	}
	return nextResolve(specifier, context);
}
