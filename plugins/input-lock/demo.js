// 90-second demo: generate a lock manifest, verify an unchanged build, and
// reject a tampered virtual module. Run with: node plugins/input-lock/demo.js
'use strict';

const { cpSync, mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { rollup } = require('../../dist/rollup.js');
const inputLock = require('./index.js');

const startedAt = Date.now();
const projectDir = mkdtempSync(path.join(tmpdir(), 'input-lock-demo-'));
cpSync(path.join(__dirname, 'fixtures/basic'), projectDir, { recursive: true });

let virtualContent = 'build-1';

const virtualBuildInfoPlugin = {
	load: id =>
		id === '\0virtual:build-info'
			? 'export const buildInfo = ' + JSON.stringify(virtualContent) + ';'
			: null,
	name: 'virtual-build-info',
	resolveId: source => (source === 'virtual:build-info' ? '\0virtual:build-info' : null)
};

const emitLogoPlugin = {
	buildStart() {
		this.emitFile({
			name: 'logo.svg',
			source: readFileSync(path.join(projectDir, 'assets/logo.svg')),
			type: 'asset'
		});
	},
	name: 'emit-logo'
};

async function build(mode) {
	const bundle = await rollup({
		input: path.join(projectDir, 'src/main.js'),
		plugins: [inputLock({ mode, root: projectDir }), virtualBuildInfoPlugin, emitLogoPlugin]
	});
	try {
		await bundle.write({ dir: path.join(projectDir, 'dist'), format: 'es' });
	} finally {
		await bundle.close();
	}
}

function step(message) {
	console.log('[' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's] ' + message);
}

async function main() {
	await build('generate');
	const manifest = JSON.parse(
		readFileSync(path.join(projectDir, 'rollup.input-lock.json'), 'utf8')
	);
	step('generate: manifest written with inputs: ' + Object.keys(manifest.inputs).join(', '));

	await build('verify');
	step('verify: unchanged build passed the input lock');

	virtualContent = 'tampered-build';
	try {
		await build('verify');
		throw new Error('demo failed: tampered build was not rejected');
	} catch (error) {
		if (error.pluginCode !== 'INPUT_LOCK_VIOLATION') throw error;
		step('verify: tampered virtual module rejected, no bundle written:\n' + error.message);
	}

	step('demo complete');
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
