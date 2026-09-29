const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const rollup = require('../../dist/rollup');

const loaderPlugin = {
	name: 'loader',
	resolveId: id => id,
	load: () => 'export default 42;'
};

const readmeUpperPlugin = {
	name: 'readme-upper',
	generateBundle() {
		this.emitFile({ fileName: 'README.txt', source: 'uppercase', type: 'asset' });
	}
};

const readmeLowerPlugin = {
	name: 'readme-lower',
	generateBundle() {
		this.emitFile({ fileName: 'Readme.txt', source: 'lowercase', type: 'asset' });
	}
};

async function withTemporaryDirectory(runTest) {
	const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'rollup-file-name-strategy-'));
	try {
		await runTest(directory);
	} finally {
		await fsp.rm(directory, { force: true, recursive: true });
	}
}

describe('fileNameStrategy: "strict-portable"', () => {
	it('reports both sources of case-folded file names and leaves no written files behind', async () => {
		await withTemporaryDirectory(async directory => {
			const bundle = await rollup.rollup({
				input: 'main',
				plugins: [loaderPlugin, readmeUpperPlugin, readmeLowerPlugin]
			});
			await assert.rejects(
				bundle.write({
					dir: directory,
					fileNameStrategy: 'strict-portable',
					format: 'es'
				}),
				error => {
					assert.strictEqual(error.code, 'PORTABLE_FILE_NAME_CONFLICT');
					assert.match(error.message, /"Readme\.txt"/);
					assert.match(error.message, /plugin "readme-lower"/);
					assert.match(error.message, /"README\.txt"/);
					assert.match(error.message, /plugin "readme-upper"/);
					return true;
				}
			);
			assert.deepStrictEqual(fs.readdirSync(directory), []);
		});
	});

	it('accepts hashed file names', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [
				loaderPlugin,
				{
					name: 'hashed-asset',
					buildStart() {
						this.emitFile({ name: 'data.txt', source: 'hashed', type: 'asset' });
					}
				}
			]
		});
		const { output } = await bundle.generate({
			assetFileNames: 'assets/[name]-[hash].txt',
			fileNameStrategy: 'strict-portable',
			format: 'es'
		});
		const asset = output.find(file => file.type === 'asset');
		assert.ok(asset, 'the hashed asset is part of the output');
		assert.match(asset.fileName, /^assets\/data-[-\w]+\.txt$/);
	});

	it('normalizes subdirectory separators and redundant segments for the case-fold check', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [
				loaderPlugin,
				{
					name: 'upper-asset',
					generateBundle() {
						this.emitFile({
							fileName: 'nested/../nested/README.txt',
							source: 'upper',
							type: 'asset'
						});
					}
				},
				{
					name: 'lower-asset',
					generateBundle() {
						this.emitFile({
							fileName: 'nested\\readme.txt',
							source: 'lower',
							type: 'asset'
						});
					}
				}
			]
		});
		await assert.rejects(
			bundle.generate({ fileNameStrategy: 'strict-portable', format: 'es' }),
			error => {
				assert.strictEqual(error.code, 'PORTABLE_FILE_NAME_CONFLICT');
				assert.match(error.message, /"nested\\readme\.txt"/);
				assert.match(error.message, /"nested\/\.\.\/nested\/README\.txt"/);
				return true;
			}
		);
	});

	it('rejects absolute file names', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [
				loaderPlugin,
				{
					name: 'absolute-asset',
					generateBundle(_options, outputBundle) {
						outputBundle['C:/Windows/win.ini'] = {
							fileName: 'C:/Windows/win.ini',
							name: undefined,
							needsCodeReference: false,
							names: [],
							originalFileNames: [],
							source: 'injected',
							type: 'asset'
						};
					}
				}
			]
		});
		await assert.rejects(
			bundle.generate({ fileNameStrategy: 'strict-portable', format: 'es' }),
			error => {
				assert.strictEqual(error.code, 'FILE_NAME_OUTSIDE_OUTPUT_DIRECTORY');
				assert.match(error.message, /C:[/\\]Windows[/\\]win\.ini/);
				return true;
			}
		);
	});

	it('checks file names renamed late by plugins in generateBundle', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [
				loaderPlugin,
				{
					name: 'late-rename',
					generateBundle(_options, outputBundle) {
						for (const output of Object.values(outputBundle)) {
							if (output.type === 'chunk') {
								const oldFileName = output.fileName;
								output.fileName = 'AUX.js';
								delete outputBundle[oldFileName];
								outputBundle['AUX.js'] = output;
							}
						}
					}
				}
			]
		});
		await assert.rejects(
			bundle.generate({ fileNameStrategy: 'strict-portable', format: 'es' }),
			error => {
				assert.strictEqual(error.code, 'PORTABLE_FILE_NAME_VIOLATION');
				assert.match(error.message, /"AUX\.js"/);
				assert.match(error.message, /reserved file name on Windows/);
				return true;
			}
		);
	});

	it('accepts legal Unicode file names', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [
				loaderPlugin,
				{
					name: 'unicode-assets',
					generateBundle() {
						this.emitFile({
							fileName: 'caf\u00e9.txt',
							source: 'combined',
							type: 'asset'
						});
						this.emitFile({
							fileName: 'CAF\u00c9.txt',
							source: 'uppercase combined',
							type: 'asset'
						});
					}
				}
			]
		});
		const { output } = await bundle.generate({
			fileNameStrategy: 'strict-portable',
			format: 'es'
		});
		assert.deepStrictEqual(
			output
				.filter(file => file.type === 'asset')
				.map(file => file.fileName)
				.sort(),
			['CAF\u00c9.txt', 'caf\u00e9.txt']
		);
	});

	it('checks each output configuration independently', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [
				loaderPlugin,
				{
					name: 'strict-output-plugin',
					generateBundle(_options, outputBundle) {
						if (_options.fileNameStrategy === 'strict-portable') {
							return;
						}
						outputBundle['AUX.txt'] = {
							fileName: 'AUX.txt',
							name: undefined,
							needsCodeReference: false,
							names: [],
							originalFileNames: [],
							source: 'only for unvalidated outputs',
							type: 'asset'
						};
					}
				}
			]
		});
		const portableOutput = await bundle.generate({
			fileNameStrategy: 'strict-portable',
			format: 'es'
		});
		assert.deepStrictEqual(
			portableOutput.output.map(file => file.fileName),
			['main.js']
		);
		const unvalidatedOutput = await bundle.generate({ format: 'es' });
		assert.deepStrictEqual(unvalidatedOutput.output.map(file => file.fileName).sort(), [
			'AUX.txt',
			'main.js'
		]);
	});

	it('checks concurrently generated output configurations independently', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [
				loaderPlugin,
				{
					name: 'case-conflict-in-strict-output',
					generateBundle(options) {
						if (options.fileNameStrategy === 'strict-portable') {
							this.emitFile({ fileName: 'README.txt', source: 'a', type: 'asset' });
							this.emitFile({ fileName: 'Readme.txt', source: 'b', type: 'asset' });
						}
					}
				}
			]
		});
		const [looseOutput, strictOutput] = await Promise.allSettled([
			bundle.generate({ format: 'es' }),
			bundle.generate({ fileNameStrategy: 'strict-portable', format: 'es' })
		]);
		assert.strictEqual(looseOutput.status, 'fulfilled');
		assert.strictEqual(strictOutput.status, 'rejected');
		assert.strictEqual(strictOutput.reason.code, 'PORTABLE_FILE_NAME_CONFLICT');
	});

	it('attributes assets emitted from transform hooks to the emitting plugin', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [
				{
					name: 'loader',
					resolveId: id => id,
					load: () => 'export default 42;'
				},
				{
					name: 'transform-upper',
					transform(code, id) {
						if (!id.endsWith('main')) {
							return null;
						}
						this.emitFile({ fileName: 'README.txt', source: 'upper', type: 'asset' });
						return code;
					}
				},
				{
					name: 'transform-lower',
					generateBundle() {
						this.emitFile({ fileName: 'Readme.txt', source: 'lower', type: 'asset' });
					}
				}
			]
		});
		await assert.rejects(
			bundle.generate({ fileNameStrategy: 'strict-portable', format: 'es' }),
			error => {
				assert.strictEqual(error.code, 'PORTABLE_FILE_NAME_CONFLICT');
				assert.match(error.message, /plugin "transform-upper"/);
				assert.match(error.message, /plugin "transform-lower"/);
				return true;
			}
		);
	});

	it('rejects unknown file name strategies', async () => {
		const bundle = await rollup.rollup({ input: 'main', plugins: [loaderPlugin] });
		await assert.rejects(bundle.generate({ fileNameStrategy: 'strict', format: 'es' }), error => {
			assert.strictEqual(error.code, 'INVALID_OPTION');
			assert.match(error.message, /output\.fileNameStrategy/);
			return true;
		});
	});
});
