'use strict';

// Demo: builds a small fixture twice with the module-ownership-manifest
// plugin and prints the difference between the two manifests. The second
// build modifies and removes the dynamic module, so its records must
// disappear from the manifest. Run from the repository root via
//   npm run demo:module-manifest

const fs = require('node:fs');
const path = require('node:path');
const { rollup } = require('../../../dist/rollup.js');
const { moduleOwnershipManifest } = require('../index.js');

const fixtureDirectory = path.join(__dirname, '.fixture-tmp');

function writeFixture({ withDynamic }) {
	fs.rmSync(fixtureDirectory, { force: true, recursive: true });
	fs.mkdirSync(fixtureDirectory, { recursive: true });
	fs.writeFileSync(path.join(fixtureDirectory, 'shared.js'), 'export const shared = "shared";\n');
	fs.writeFileSync(
		path.join(fixtureDirectory, 'entry-a.js'),
		'import { shared } from "./shared.js";\n' +
			(withDynamic ? 'export const loadDynamic = () => import("./dynamic.js");\n' : '') +
			'export const a = shared + "-a";\n'
	);
	fs.writeFileSync(
		path.join(fixtureDirectory, 'entry-b.js'),
		'import { shared } from "./shared.js";\nexport const b = shared + "-b";\n'
	);
	if (withDynamic) {
		fs.writeFileSync(
			path.join(fixtureDirectory, 'dynamic.js'),
			'export const dynamic = "dynamic";\n'
		);
	}
}

function assetEmitter() {
	return {
		name: 'demo-asset-emitter',
		transform(code, id) {
			if (id.endsWith('shared.js')) {
				this.emitFile({ name: 'shared-notes.txt', source: 'notes about shared', type: 'asset' });
			}
		}
	};
}

async function buildWithManifest() {
	const bundle = await rollup({
		input: {
			'entry-a': path.join(fixtureDirectory, 'entry-a.js'),
			'entry-b': path.join(fixtureDirectory, 'entry-b.js')
		},
		plugins: [assetEmitter(), moduleOwnershipManifest({ root: fixtureDirectory })]
	});
	const { output } = await bundle.generate({
		assetFileNames: 'assets/[name]-[hash][extname]',
		chunkFileNames: 'chunks/[name]-[hash].js',
		entryFileNames: '[name]-[hash].js',
		format: 'es'
	});
	await bundle.close();
	const manifestAsset = output.find(item => item.fileName === 'module-manifest.json');
	return JSON.parse(manifestAsset.source);
}

function diffValues(before, after, pathSegments, lines) {
	if (JSON.stringify(before) === JSON.stringify(after)) return;
	const label = pathSegments.join('.');
	if (
		before === null ||
		after === null ||
		typeof before !== 'object' ||
		typeof after !== 'object' ||
		Array.isArray(before) !== Array.isArray(after)
	) {
		lines.push('  ~ ' + label + ': ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after));
		return;
	}
	for (const key of Object.keys(before)) {
		if (!(key in after)) {
			lines.push('  - ' + label + '.' + key + ': ' + JSON.stringify(before[key]));
		}
	}
	for (const key of Object.keys(after)) {
		if (!(key in before)) {
			lines.push('  + ' + label + '.' + key + ': ' + JSON.stringify(after[key]));
		} else {
			diffValues(before[key], after[key], [...pathSegments, key], lines);
		}
	}
}

async function main() {
	let before;
	let after;
	try {
		writeFixture({ withDynamic: true });
		before = await buildWithManifest();
		writeFixture({ withDynamic: false });
		after = await buildWithManifest();
	} finally {
		fs.rmSync(fixtureDirectory, { force: true, recursive: true });
	}

	console.log('first build (with dynamic module):');
	console.log('  chunks: ' + Object.keys(before.chunks).join(', '));
	console.log('  totals: ' + JSON.stringify(before.totals));
	console.log('second build (dynamic module removed):');
	console.log('  chunks: ' + Object.keys(after.chunks).join(', '));
	console.log('  totals: ' + JSON.stringify(after.totals));
	const lines = [];
	diffValues(before, after, ['manifest'], lines);
	console.log('manifest diff:');
	console.log(lines.join('\n'));
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
