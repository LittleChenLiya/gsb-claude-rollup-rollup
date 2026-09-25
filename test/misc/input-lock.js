const assert = require('node:assert/strict');
const { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const rollup = require('../../dist/rollup');
const inputLock = require('../../plugins/input-lock/index.js');

const FIXTURE_DIR = path.resolve(__dirname, '../../plugins/input-lock/fixtures/basic');
const MANIFEST_NAME = 'rollup.input-lock.json';

function createProject() {
	const directory = mkdtempSync(path.join(tmpdir(), 'rollup-input-lock-'));
	cpSync(FIXTURE_DIR, directory, { recursive: true });
	return directory;
}

function virtualBuildInfoPlugin(getContent) {
	return {
		name: 'virtual-build-info',
		resolveId(source) {
			return source === 'virtual:build-info' ? '\0virtual:build-info' : null;
		},
		load(id) {
			return id === '\0virtual:build-info'
				? 'export const buildInfo = ' + JSON.stringify(getContent()) + ';'
				: null;
		}
	};
}

function emitLogoPlugin(projectDir) {
	return {
		name: 'emit-logo',
		buildStart() {
			this.emitFile({
				type: 'asset',
				name: 'logo.svg',
				source: readFileSync(path.join(projectDir, 'assets/logo.svg'))
			});
		}
	};
}

async function buildProject(
	projectDir,
	{ mode, outputs = [{ format: 'es' }], virtualContent = 'v1' }
) {
	const bundle = await rollup.rollup({
		input: path.join(projectDir, 'src/main.js'),
		plugins: [
			inputLock({ mode, root: projectDir }),
			virtualBuildInfoPlugin(() => virtualContent),
			emitLogoPlugin(projectDir)
		]
	});
	try {
		for (const [index, output] of outputs.entries()) {
			await bundle.write({ ...output, dir: path.join(projectDir, 'dist-' + index) });
		}
	} finally {
		await bundle.close();
	}
}

function readManifest(projectDir) {
	return JSON.parse(readFileSync(path.join(projectDir, MANIFEST_NAME), 'utf8'));
}

async function getVerificationError(projectDir, options) {
	let error = null;
	try {
		await buildProject(projectDir, { ...options, mode: 'verify' });
	} catch (caught) {
		error = caught;
	}
	assert.ok(error, 'expected the verification build to fail');
	return error;
}

describe('input-lock plugin', () => {
	it('generates a stable manifest covering local modules, virtual modules, assets and dynamic imports', async () => {
		const projectDir = createProject();
		await buildProject(projectDir, { mode: 'generate' });
		const manifestPath = path.join(projectDir, MANIFEST_NAME);
		const firstManifest = readFileSync(manifestPath, 'utf8');
		const inputs = JSON.parse(firstManifest).inputs;
		assert.deepEqual(Object.keys(inputs), [
			'asset:logo.svg',
			'src/dependency.js',
			'src/lazy.js',
			'src/main.js',
			'virtual:build-info'
		]);
		assert.ok(!Object.keys(inputs).some(key => path.isAbsolute(key) || key.includes('..')));
		await buildProject(projectDir, { mode: 'generate' });
		assert.strictEqual(
			readFileSync(manifestPath, 'utf8'),
			firstManifest,
			'repeated builds must produce a byte-identical manifest'
		);
	});

	it('verifies an unchanged build, also from a different absolute directory', async () => {
		const projectDir = createProject();
		await buildProject(projectDir, { mode: 'generate' });
		await buildProject(projectDir, { mode: 'verify' });
		const movedDir = createProject();
		rmSync(movedDir, { force: true, recursive: true });
		cpSync(projectDir, movedDir, { recursive: true });
		await buildProject(movedDir, { mode: 'verify' });
	});

	it('rejects a changed virtual module, reports its logical id and writes no bundle', async () => {
		const projectDir = createProject();
		await buildProject(projectDir, { mode: 'generate' });
		rmSync(path.join(projectDir, 'dist-0'), { force: true, recursive: true });
		const error = await getVerificationError(projectDir, { virtualContent: 'tampered' });
		assert.strictEqual(error.pluginCode, 'INPUT_LOCK_VIOLATION');
		assert.match(error.message, /Changed inputs/);
		assert.match(error.message, /virtual:build-info/);
		assert.ok(!existsSync(path.join(projectDir, 'dist-0')), 'no bundle must be written on failure');
	});

	it('rejects a changed local module and reports its project-relative path', async () => {
		const projectDir = createProject();
		await buildProject(projectDir, { mode: 'generate' });
		writeFileSync(path.join(projectDir, 'src/dependency.js'), 'export const answer = 43;\n');
		const error = await getVerificationError(projectDir, {});
		assert.match(error.message, /Changed inputs/);
		assert.match(error.message, /src\/dependency\.js/);
	});

	it('reports missing and extra inputs separately', async () => {
		const projectDir = createProject();
		await buildProject(projectDir, { mode: 'generate' });
		writeFileSync(
			path.join(projectDir, 'src/main.js'),
			readFileSync(path.join(projectDir, 'src/main.js'), 'utf8').replace(
				"import { answer } from './dependency.js';",
				"import { extra } from './extra.js';"
			)
		);
		writeFileSync(path.join(projectDir, 'src/extra.js'), 'export const extra = 1;\n');
		const error = await getVerificationError(projectDir, {});
		assert.match(error.message, /Missing inputs[\s\S]*src\/dependency\.js/);
		assert.match(error.message, /Extra inputs[\s\S]*src\/extra\.js/);
	});

	it('rejects a changed emitted asset', async () => {
		const projectDir = createProject();
		await buildProject(projectDir, { mode: 'generate' });
		writeFileSync(
			path.join(projectDir, 'assets/logo.svg'),
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"/>\n'
		);
		const error = await getVerificationError(projectDir, {});
		assert.match(error.message, /Changed inputs/);
		assert.match(error.message, /asset:logo\.svg/);
	});

	it('shares one input record across multiple outputs', async () => {
		const projectDir = createProject();
		const outputs = [{ format: 'es' }, { format: 'cjs' }];
		await buildProject(projectDir, { mode: 'generate', outputs });
		const manifest = readManifest(projectDir);
		assert.ok(Object.keys(manifest.inputs).includes('virtual:build-info'));
		await buildProject(projectDir, { mode: 'verify', outputs });
	});
});
