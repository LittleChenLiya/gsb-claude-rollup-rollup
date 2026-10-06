import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

// Allow importing Rollup's extensionless TypeScript sources directly
register('./ts-extension-loader.mjs', import.meta.url);

const { applySourcemapFileRename, AssetFileRenamePlan } = await import(
	'../../src/utils/assetFileRenames.ts'
);

const nothingTaken = () => false;

test('returns null when no rename plan is configured', () => {
	assert.equal(AssetFileRenamePlan.create(null), null);
	assert.equal(AssetFileRenamePlan.create(undefined), null);
	assert.equal(AssetFileRenamePlan.create({}), null);
});

test('rejects malformed plans', () => {
	for (const invalid of [
		'a.png',
		['a.png'],
		{ 'a.png': 5 },
		{ 'a.png': '' },
		{ '': 'b.png' },
		{ 'a.png': '../outside.png' },
		{ 'a.png': '/absolute.png' },
		{ 'a.png': './fragment.png' },
		{ '../a.png': 'b.png' }
	]) {
		assert.throws(
			() => AssetFileRenamePlan.create(invalid),
			error => error.code === 'ASSET_FILE_RENAME_INVALID',
			JSON.stringify(invalid)
		);
	}
});

test('rejects duplicate rename targets, ignoring case', () => {
	assert.throws(
		() => AssetFileRenamePlan.create({ 'a.png': 'same.png', 'b.png': 'same.png' }),
		error => error.code === 'ASSET_FILE_RENAME_CONFLICT'
	);
	assert.throws(
		() => AssetFileRenamePlan.create({ 'a.png': 'same.png', 'b.png': 'SAME.PNG' }),
		error => error.code === 'ASSET_FILE_RENAME_CONFLICT'
	);
});

test('rejects chained renames', () => {
	assert.throws(
		() => AssetFileRenamePlan.create({ 'a.png': 'b.png', 'b.png': 'c.png' }),
		error => error.code === 'ASSET_FILE_RENAME_INVALID'
	);
});

test('renames known files and tracks consumed sources', () => {
	const plan = AssetFileRenamePlan.create({ 'assets/a.png': 'images/a.png' });
	assert.equal(plan.getRenamedFileName('assets/a.png', nothingTaken), 'images/a.png');
	assert.equal(plan.getRenamedFileName('assets/other.png', nothingTaken), 'assets/other.png');
	assert.deepEqual(plan.getUnconsumedFileNames(), []);
});

test('reports unconsumed rename sources as unknown references', () => {
	const plan = AssetFileRenamePlan.create({ 'assets/a.png': 'images/a.png' });
	assert.deepEqual(plan.getUnconsumedFileNames(), ['assets/a.png']);
});

test('rejects rename targets that are already taken', () => {
	const plan = AssetFileRenamePlan.create({ 'assets/a.png': 'taken.png' });
	assert.throws(
		() => plan.getRenamedFileName('assets/a.png', fileName => fileName === 'taken.png'),
		error => error.code === 'ASSET_FILE_RENAME_CONFLICT'
	);
});

test('allows several assets with the same final name to merge into the renamed file', () => {
	const plan = AssetFileRenamePlan.create({ 'assets/a.png': 'images/a.png' });
	assert.equal(plan.getRenamedFileName('assets/a.png', nothingTaken), 'images/a.png');
	// A second asset with the same original file name merges into the already
	// renamed file instead of conflicting with it
	assert.equal(plan.getRenamedFileName('assets/a.png', () => true), 'images/a.png');
});

test('identity renames are allowed and do not reserve a target', () => {
	const plan = AssetFileRenamePlan.create({ 'assets/a.png': 'assets/a.png' });
	assert.equal(plan.getRenamedFileName('assets/a.png', nothingTaken), 'assets/a.png');
	assert.deepEqual(plan.getUnconsumedFileNames(), []);
});

test('source map files can only be renamed within their directory', () => {
	assert.equal(
		applySourcemapFileRename('assets/main.js.map', 'assets/main.renamed.js.map'),
		'assets/main.renamed.js.map'
	);
	assert.equal(applySourcemapFileRename('main.js.map', 'main.js.map'), 'main.js.map');
	assert.throws(
		() => applySourcemapFileRename('assets/main.js.map', 'maps/main.js.map'),
		error => error.code === 'ASSET_FILE_RENAME_UNSUPPORTED'
	);
});
