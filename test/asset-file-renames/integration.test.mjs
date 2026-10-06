import assert from 'node:assert/strict';
import { test } from 'node:test';
import rollupModule from '../../dist/rollup.js';

const { rollup } = rollupModule;

// A small in-memory fixture: one entry chunk that references an emitted image
// asset via import.meta.ROLLUP_FILE_URL_<referenceId>
const PNG_SOURCE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageEntryPlugin() {
	let referenceId;
	return {
		name: 'image-entry-fixture',
		buildStart() {
			referenceId = this.emitFile({ type: 'asset', name: 'logo.png', source: PNG_SOURCE });
		},
		load(id) {
			if (id === 'entry') {
				return `import 'external-dep';\nexport const logoUrl = import.meta.ROLLUP_FILE_URL_${referenceId};\n`;
			}
			return null;
		},
		resolveId(id) {
			return id === 'entry' ? id : null;
		}
	};
}

const inputOptions = {
	external: ['external-dep'],
	input: 'entry',
	plugins: [imageEntryPlugin()]
};

const outputOptions = {
	assetFileNames: 'assets/[name][extname]',
	entryFileNames: 'main.js',
	format: 'es'
};

function getFiles(output) {
	return Object.fromEntries(output.map(file => [file.fileName, file]));
}

test('renamed assets keep loadable import.meta references and identical content', async () => {
	const bundle = await rollup(inputOptions);
	const { output } = await bundle.generate({
		...outputOptions,
		assetFileRenames: { 'assets/logo.png': 'images/renamed-logo.png' }
	});
	const files = getFiles(output);
	const chunk = files['main.js'];
	const asset = files['images/renamed-logo.png'];

	// the asset is emitted under its new name only, with unchanged content
	assert.ok(asset, 'renamed asset exists');
	assert.equal(files['assets/logo.png'], undefined);
	assert.deepEqual(new Uint8Array(asset.source), PNG_SOURCE);

	// chunk references resolve to the renamed file
	assert.deepEqual(chunk.referencedFiles, ['images/renamed-logo.png']);
	const reference = /new URL\('([^']+)', import\.meta\.url\)/.exec(chunk.code);
	assert.ok(reference, `chunk code contains an import.meta file reference:\n${chunk.code}`);
	// the actual reference must be loadable: resolving it against the chunk
	// location must point at an emitted file
	const resolvedReference = new URL(reference[1], `file:///${chunk.fileName}`).pathname.slice(1);
	assert.equal(resolvedReference, 'images/renamed-logo.png');
	assert.ok(files[resolvedReference], 'referenced file exists in the output');

	// external modules are never touched by the rename plan
	assert.deepEqual(chunk.imports, ['external-dep']);
	assert.ok(chunk.code.includes(`'external-dep'`));

	await bundle.close();
});

test('conflicting rename targets are rejected and the original bundle is kept', async () => {
	function twoAssetsPlugin() {
		return {
			name: 'two-assets-fixture',
			buildStart() {
				this.emitFile({ type: 'asset', name: 'one.png', source: 'one' });
				// an explicit fileName reserves its name as soon as it is emitted
				this.emitFile({ type: 'asset', fileName: 'assets/two.png', source: 'two' });
			},
			load(id) {
				return id === 'entry' ? 'export const value = 1;\n' : null;
			},
			resolveId(id) {
				return id === 'entry' ? id : null;
			}
		};
	}
	const bundle = await rollup({ input: 'entry', plugins: [twoAssetsPlugin()] });

	// two assets mapped to the same name are rejected before anything is emitted
	await assert.rejects(
		bundle.generate({
			...outputOptions,
			assetFileRenames: {
				'assets/one.png': 'images/same.png',
				'assets/two.png': 'images/same.png'
			}
		}),
		error => error.code === 'ASSET_FILE_RENAME_CONFLICT'
	);

	// a rename target colliding with an already reserved file name is rejected
	// as well ("assets/two.png" was emitted with an explicit fileName)
	await assert.rejects(
		bundle.generate({
			...outputOptions,
			assetFileRenames: { 'assets/one.png': 'assets/two.png' }
		}),
		error => error.code === 'ASSET_FILE_RENAME_CONFLICT'
	);

	// the original bundle is unaffected and can still be generated
	const { output } = await bundle.generate(outputOptions);
	const files = getFiles(output);
	assert.ok(files['assets/one.png']);
	assert.ok(files['assets/two.png']);
	assert.equal(files['images/same.png'], undefined);

	await bundle.close();
});

test('unknown rename references are reported as unsupported', async () => {
	const bundle = await rollup(inputOptions);

	// references to files that are never emitted are not supported
	await assert.rejects(
		bundle.generate({
			...outputOptions,
			assetFileRenames: { 'assets/ghost.png': 'images/ghost.png' }
		}),
		error =>
			error.code === 'ASSET_FILE_RENAME_UNKNOWN_REFERENCE' &&
			error.message.includes('not supported')
	);

	// chunks cannot be renamed either, only explicitly emitted assets
	await assert.rejects(
		bundle.generate({
			...outputOptions,
			assetFileRenames: { 'main.js': 'renamed-main.js' }
		}),
		error => error.code === 'ASSET_FILE_RENAME_UNKNOWN_REFERENCE'
	);

	// the original bundle is unaffected and can still be generated
	const { output } = await bundle.generate(outputOptions);
	assert.ok(getFiles(output)['assets/logo.png']);

	await bundle.close();
});

test('source map file name relations are kept in sync when renaming', async () => {
	const bundle = await rollup(inputOptions);
	const { output } = await bundle.generate({
		...outputOptions,
		assetFileRenames: { 'main.js.map': 'main.renamed.js.map' },
		sourcemap: true
	});
	const files = getFiles(output);
	const chunk = files['main.js'];
	const mapAsset = files['main.renamed.js.map'];

	assert.ok(mapAsset, 'renamed source map asset exists');
	assert.equal(files['main.js.map'], undefined);
	assert.equal(chunk.sourcemapFileName, 'main.renamed.js.map');
	assert.ok(
		chunk.code.trimEnd().endsWith('//# sourceMappingURL=main.renamed.js.map'),
		`chunk code points at the renamed source map:\n${chunk.code}`
	);
	// the source map itself still refers to the chunk and its original sources
	const map = JSON.parse(mapAsset.source);
	assert.ok(String(map.file).endsWith('main.js'));
	assert.ok(map.sources.length > 0);

	// moving a source map file to another directory is not supported
	await assert.rejects(
		bundle.generate({
			...outputOptions,
			assetFileRenames: { 'main.js.map': 'maps/main.js.map' },
			sourcemap: true
		}),
		error => error.code === 'ASSET_FILE_RENAME_UNSUPPORTED'
	);

	await bundle.close();
});
