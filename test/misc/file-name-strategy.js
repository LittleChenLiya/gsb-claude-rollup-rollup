const assert = require('node:assert');
const rollup = require('../../dist/rollup');

function createRecordingFs() {
	const writtenFiles = [];
	const createdDirectories = [];
	return {
		createdDirectories,
		fs: {
			async mkdir(dirName) {
				createdDirectories.push(dirName);
			},
			async readFile() {
				throw new Error('not implemented');
			},
			async writeFile(fileName) {
				writtenFiles.push(fileName);
			}
		},
		writtenFiles
	};
}

const caseConflictingReadmePlugins = [
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
];

function loaderPlugin() {
	return {
		name: 'loader',
		resolveId: () => 'main',
		load: () => 'export default 1;'
	};
}

describe('strict-portable file name strategy', () => {
	it('reports both case-conflicting file names and writes nothing', async () => {
		const { createdDirectories, fs, writtenFiles } = createRecordingFs();
		const bundle = await rollup.rollup({
			input: 'main',
			fs,
			plugins: [loaderPlugin(), ...caseConflictingReadmePlugins]
		});

		await assert.rejects(
			() =>
				bundle.write({
					dir: 'output',
					fileNames: 'strict-portable',
					format: 'es'
				}),
			error => {
				assert.equal(error.code, 'FILE_NAME_CASE_CONFLICT');
				assert.match(error.message, /README\.txt/);
				assert.match(error.message, /Readme\.txt/);
				return true;
			}
		);
		assert.deepEqual(writtenFiles, []);
		assert.deepEqual(createdDirectories, []);
	});

	it('checks each output independently', async () => {
		const bundle = await rollup.rollup({
			input: 'main',
			plugins: [loaderPlugin(), ...caseConflictingReadmePlugins]
		});

		const unvalidatedOutput = await bundle.generate({ format: 'es' });
		assert.deepEqual(
			unvalidatedOutput.output.map(({ fileName }) => fileName),
			['main.js', 'Readme.txt', 'README.txt']
		);

		await assert.rejects(
			() => bundle.generate({ fileNames: 'strict-portable', format: 'es' }),
			error => error.code === 'FILE_NAME_CASE_CONFLICT'
		);

		const bundleWithoutConflicts = await rollup.rollup({
			input: 'main',
			plugins: [loaderPlugin()]
		});
		const validatedOutput = await bundleWithoutConflicts.generate({
			fileNames: 'strict-portable',
			format: 'es'
		});
		assert.deepEqual(
			validatedOutput.output.map(({ fileName }) => fileName),
			['main.js']
		);
	});

	it('writes hashed and Unicode file names successfully', async () => {
		const { fs, writtenFiles } = createRecordingFs();
		const bundle = await rollup.rollup({
			input: 'main',
			fs,
			plugins: [
				loaderPlugin(),
				{
					name: 'emits-unicode-asset',
					generateBundle(_options, outputBundle) {
						outputBundle['caf\u00e9-\u4e2d\u6587.txt'] = {
							type: 'asset',
							fileName: 'caf\u00e9-\u4e2d\u6587.txt',
							names: [],
							needsCodeReference: false,
							originalFileNames: [],
							source: 'unicode'
						};
					}
				}
			]
		});

		await bundle.write({
			dir: 'output',
			entryFileNames: 'main-[hash].js',
			fileNames: 'strict-portable',
			format: 'es'
		});
		assert.equal(writtenFiles.length, 2);
		assert.match(writtenFiles[0], /main-[A-Za-z0-9_-]+\.js$/);
		assert.match(writtenFiles[1], /caf\u00e9-\u4e2d\u6587\.txt$/);
	});
});
