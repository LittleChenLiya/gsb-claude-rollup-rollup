const assert = require('node:assert');
const { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const rollup = require('../../dist/rollup');
const { inputLock } = require('../../plugin/input-lock');

const FIXTURE_DIR = join(__dirname, 'fixtures', 'input-lock', 'project');
const VIRTUAL_MODULE_ID = '\0virtual:message';
const MANIFEST_FILE = 'rollup-input-lock.json';

function virtualMessagePlugin(projectDir) {
	return {
		name: 'virtual-message',
		resolveId(id) {
			if (id === 'virtual:message') return VIRTUAL_MODULE_ID;
		},
		load(id) {
			if (id === VIRTUAL_MODULE_ID) {
				const message = readFileSync(join(projectDir, 'message.txt'), 'utf8').trim();
				return `export const message = ${JSON.stringify(message)};`;
			}
		}
	};
}

function logoAssetPlugin(projectDir) {
	return {
		name: 'logo-asset',
		buildStart() {
			this.emitFile({
				type: 'asset',
				name: 'logo.txt',
				source: readFileSync(join(projectDir, 'logo.txt'))
			});
		}
	};
}

describe('input-lock plugin', () => {
	const createdDirectories = [];

	function createProject() {
		const projectDir = mkdtempSync(join(tmpdir(), 'rollup-input-lock-'));
		cpSync(FIXTURE_DIR, projectDir, { recursive: true });
		createdDirectories.push(projectDir);
		return projectDir;
	}

	async function buildProject(projectDir, mode, outputs = [{ dir: 'out', format: 'es' }]) {
		const bundle = await rollup.rollup({
			input: join(projectDir, 'src', 'main.js'),
			plugins: [
				virtualMessagePlugin(projectDir),
				logoAssetPlugin(projectDir),
				inputLock({ mode, root: projectDir })
			]
		});
		for (const output of outputs) {
			await bundle.write({ ...output, dir: join(projectDir, output.dir) });
		}
		await bundle.close();
	}

	function readManifest(projectDir) {
		return readFileSync(join(projectDir, MANIFEST_FILE), 'utf8');
	}

	async function getVerificationError(projectDir, outputs) {
		let error = null;
		try {
			await buildProject(projectDir, 'verify', outputs);
		} catch (buildError) {
			error = buildError;
		}
		return error;
	}

	after(() => {
		for (const dir of createdDirectories) {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it('records a manifest of modules and assets and verifies an unchanged build', async () => {
		const projectDir = createProject();
		await buildProject(projectDir, 'record');

		const manifest = JSON.parse(readManifest(projectDir));
		assert.strictEqual(manifest.version, 1);
		assert.deepStrictEqual(Object.keys(manifest.modules).sort(), [
			VIRTUAL_MODULE_ID,
			'src/dependency.js',
			'src/lazy.js',
			'src/main.js'
		]);
		assert.deepStrictEqual(Object.keys(manifest.assets), ['logo.txt']);
		for (const hash of Object.values(manifest.modules)) {
			assert.match(hash, /^[0-9a-f]{64}$/);
		}

		await buildProject(projectDir, 'verify');
	});

	it('produces a byte-identical manifest on repeated builds', async () => {
		const projectDir = createProject();
		await buildProject(projectDir, 'record');
		const firstManifest = readManifest(projectDir);
		await buildProject(projectDir, 'record');
		assert.strictEqual(readManifest(projectDir), firstManifest);
	});

	it('produces an identical manifest in a different absolute directory', async () => {
		const firstProjectDir = createProject();
		const secondProjectDir = createProject();
		await buildProject(firstProjectDir, 'record');
		await buildProject(secondProjectDir, 'record');
		assert.strictEqual(readManifest(firstProjectDir), readManifest(secondProjectDir));
	});

	it('fails verification when only virtual module content changes and reports its logical id', async () => {
		const projectDir = createProject();
		await buildProject(projectDir, 'record');

		writeFileSync(join(projectDir, 'message.txt'), 'tampered message\n');
		const error = await getVerificationError(projectDir, [{ dir: 'out-verify', format: 'es' }]);

		assert.ok(error, 'expected verification to fail');
		assert.strictEqual(error.pluginCode, 'INPUT_LOCK_VIOLATION');
		assert.ok(error.message.includes('changed inputs'), error.message);
		assert.ok(error.message.includes(VIRTUAL_MODULE_ID), error.message);
		assert.ok(!existsSync(join(projectDir, 'out-verify')), 'no bundle must be written on failure');
	});

	it('reports missing, changed and extra modules in separate categories', async () => {
		const changedProjectDir = createProject();
		await buildProject(changedProjectDir, 'record');
		writeFileSync(
			join(changedProjectDir, 'src', 'dependency.js'),
			"export const dependency = 'dep-2';\n"
		);
		const changedError = await getVerificationError(changedProjectDir);
		assert.ok(changedError.message.includes('changed inputs'), changedError.message);
		assert.ok(changedError.message.includes('src/dependency.js'), changedError.message);

		const missingProjectDir = createProject();
		await buildProject(missingProjectDir, 'record');
		writeFileSync(
			join(missingProjectDir, 'src', 'main.js'),
			"import { dependency } from './dependency.js';\nimport { message } from 'virtual:message';\n\nexport function run() {\n\treturn `${message} ${dependency}`;\n}\n"
		);
		const missingError = await getVerificationError(missingProjectDir);
		assert.ok(missingError.message.includes('missing inputs'), missingError.message);
		assert.ok(missingError.message.includes('src/lazy.js'), missingError.message);

		const extraProjectDir = createProject();
		await buildProject(extraProjectDir, 'record');
		writeFileSync(join(extraProjectDir, 'src', 'extra.js'), "export const extra = 'extra';\n");
		writeFileSync(
			join(extraProjectDir, 'src', 'dependency.js'),
			"import { extra } from './extra.js';\n\nexport const dependency = `dep-${extra}`;\n"
		);
		const extraError = await getVerificationError(extraProjectDir);
		assert.ok(extraError.message.includes('extra inputs'), extraError.message);
		assert.ok(extraError.message.includes('src/extra.js'), extraError.message);
		assert.ok(extraError.message.includes('changed inputs'), extraError.message);
		assert.ok(extraError.message.includes('src/dependency.js'), extraError.message);
	});

	it('fails verification when an emitted asset changes', async () => {
		const projectDir = createProject();
		await buildProject(projectDir, 'record');

		writeFileSync(join(projectDir, 'logo.txt'), 'logo-v2\n');
		const error = await getVerificationError(projectDir, [{ dir: 'out-verify', format: 'es' }]);

		assert.ok(error, 'expected verification to fail');
		assert.strictEqual(error.pluginCode, 'INPUT_LOCK_VIOLATION');
		assert.ok(error.message.includes('changed inputs'), error.message);
		assert.ok(error.message.includes('logo.txt'), error.message);
		assert.ok(!existsSync(join(projectDir, 'out-verify')), 'no bundle must be written on failure');
	});

	it('shares a single input record across multiple outputs', async () => {
		const projectDir = createProject();
		const outputs = [
			{ dir: 'out-es', format: 'es' },
			{ dir: 'out-cjs', format: 'cjs' }
		];
		await buildProject(projectDir, 'record', outputs);

		const manifest = JSON.parse(readManifest(projectDir));
		assert.strictEqual(Object.keys(manifest.modules).length, 4);
		assert.strictEqual(Object.keys(manifest.assets).length, 1);

		await buildProject(projectDir, 'verify', outputs);
	});
});
