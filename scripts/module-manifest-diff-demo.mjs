// Demonstrates the moduleManifest plugin: runs two small builds where the
// second build modifies a shared module and removes a dynamic module, then
// prints the difference between the two emitted manifests.
// Run via "npm run demo:module-manifest".

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const distributionEntry = path.join(repoRoot, 'dist', 'rollup.js');
if (!existsSync(distributionEntry)) {
	console.log('dist/ is missing, building Rollup first (npm run build:quick)...');
	execSync('npm run build:quick', { cwd: repoRoot, stdio: 'inherit' });
}

const require = createRequire(import.meta.url);
/** @type {import('../dist/rollup.js')} */
const { moduleManifest, rollup } = require(distributionEntry);

const fixtureDir = path.join(repoRoot, 'test', '_tmp', 'module-manifest-demo');
const MANIFEST_FILE_NAME = 'module-manifest.json';

/** @type {import('../dist/rollup.js').Plugin} */
const emitAssetPlugin = {
	name: 'demo-emit-asset',
	transform(_code, id) {
		if (id.endsWith('shared.js')) {
			this.emitFile({ name: 'data.txt', source: 'asset emitted from shared.js', type: 'asset' });
		}
	}
};

/**
 * @param {Record<string, string>} files
* @returns {Promise<import('../dist/rollup.js').ModuleManifest>}
 */
async function buildAndReadManifest(files) {
	rmSync(fixtureDir, { force: true, recursive: true });
	mkdirSync(fixtureDir, { recursive: true });
	for (const [name, source] of Object.entries(files)) {
		writeFileSync(path.join(fixtureDir, name), source);
	}
	const bundle = await rollup({
		input: [path.join(fixtureDir, 'main.js'), path.join(fixtureDir, 'second.js')],
		plugins: [emitAssetPlugin, moduleManifest({ root: fixtureDir })]
	});
	const { output } = await bundle.generate({
		assetFileNames: 'assets/[name]-[hash][extname]',
		chunkFileNames: 'chunks/[name]-[hash].js',
		format: 'es'
	});
	const manifestAsset = output.find(file => file.fileName === MANIFEST_FILE_NAME);
	if (!manifestAsset || manifestAsset.type !== 'asset') {
		throw new Error('The manifest was not emitted.');
	}
	return JSON.parse(String(manifestAsset.source));
}

/**
 * Flattens a manifest into "path -> value" leaves for comparison.
 * @param {unknown} value
 * @param {string} prefix
 * @param {Map<string, unknown>} leaves
 * @returns {Map<string, unknown>}
 */
function flatten(value, prefix, leaves = new Map()) {
	if (Array.isArray(value)) {
		value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, leaves));
	} else if (value !== null && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			flatten(child, prefix ? `${prefix}.${key}` : key, leaves);
		}
	} else {
		leaves.set(prefix, value);
	}
	return leaves;
}

const firstBuild = {
	'dynamic.js': 'export const dynamic = "dynamic";\n',
	'main.js':
		'import { shared } from "./shared.js";\nexport const result = shared;\nexport const load = () => import("./dynamic.js");\n',
	'second.js': 'import { shared } from "./shared.js";\nexport const second = shared + 1;\n',
	'shared.js': 'export const shared = 42;\n'
};

const secondBuild = {
	// the shared module is modified and the dynamic module is removed
	'main.js': 'import { shared } from "./shared.js";\nexport const result = shared;\n',
	'second.js': firstBuild['second.js'],
	'shared.js': 'export const shared = 42;\nexport const extra = "added in the second build";\n'
};

console.log('Running first build...');
const firstManifest = await buildAndReadManifest(firstBuild);
console.log('Running second build (shared.js modified, dynamic.js removed)...');
const secondManifest = await buildAndReadManifest(secondBuild);
rmSync(fixtureDir, { force: true, recursive: true });

const firstLeaves = flatten(firstManifest, '');
const secondLeaves = flatten(secondManifest, '');
const allPaths = [...new Set([...firstLeaves.keys(), ...secondLeaves.keys()])].sort();
let differences = 0;
for (const manifestPath of allPaths) {
	const inFirst = firstLeaves.has(manifestPath);
	const inSecond = secondLeaves.has(manifestPath);
	if (inFirst && inSecond && firstLeaves.get(manifestPath) === secondLeaves.get(manifestPath)) {
		continue;
	}
	differences++;
	if (inFirst) console.log(`- ${manifestPath}: ${JSON.stringify(firstLeaves.get(manifestPath))}`);
	if (inSecond) console.log(`+ ${manifestPath}: ${JSON.stringify(secondLeaves.get(manifestPath))}`);
}
console.log(
	differences === 0
		? 'The manifests are identical.'
		: `${differences} difference(s) between the two manifests.`
);
