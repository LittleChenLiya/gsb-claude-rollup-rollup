'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { rollup } = require('../../../dist/rollup.js');
const { chunkDependencyBudget } = require('../index.js');

const demoRoot = __dirname;
const fixtureDirectory = path.join(demoRoot, 'fixtures');
const passDirectory = path.join(demoRoot, 'output', 'pass');
const failDirectory = path.join(demoRoot, 'output', 'fail');

fs.rmSync(path.join(demoRoot, 'output'), { force: true, recursive: true });

function summarizeReport(report) {
	return report.entries.map(entry => ({
		dynamicChunks: entry.dynamicChunks,
		exceededBy: entry.exceededBy,
		externals: entry.externals,
		name: entry.name,
		status: entry.status,
		syncBytes: entry.syncBytes
	}));
}

async function runScenario(label, budgets, outputDirectory) {
	const bundle = await rollup({
		input: {
			'entry-a': path.join(fixtureDirectory, 'entry-a.js'),
			'entry-b': path.join(fixtureDirectory, 'entry-b.js')
		},
		plugins: [
			chunkDependencyBudget({
				budgets,
				onReport: report => console.log(label + ' report:', JSON.stringify(summarizeReport(report)))
			})
		]
	});
	let error = null;
	try {
		await bundle.write({ chunkFileNames: '[name].js', dir: outputDirectory, format: 'es' });
	} catch (writeError) {
		error = writeError;
	}
	await bundle.close();
	return error;
}

async function main() {
	const started = Date.now();

	console.log('--- 1/3 PASS: generous default budget ---');
	const passError = await runScenario('PASS', { default: 100_000 }, passDirectory);
	if (passError) throw passError;
	const passFiles = fs.readdirSync(passDirectory);
	console.log('PASS wrote files:', passFiles.join(', '));

	console.log('--- 2/3 EXCEED: tiny budget for entry-a ---');
	const failError = await runScenario('EXCEED', { 'entry-a': 50 }, failDirectory);
	if (!failError || failError.pluginCode !== 'CHUNK_BUDGET_EXCEEDED') {
		throw new Error('expected a CHUNK_BUDGET_EXCEEDED error');
	}
	console.log('EXCEED error:\n' + failError.message);

	console.log('--- 3/3 DISK STATE: failed build leaves no artifacts ---');
	const failArtifacts = fs.existsSync(failDirectory) ? fs.readdirSync(failDirectory) : [];
	console.log(
		'fail output directory:',
		fs.existsSync(failDirectory) ? 'exists, contents: ' + failArtifacts.join(', ') : 'not created'
	);
	if (failArtifacts.length > 0) {
		throw new Error('failed build left output artifacts on disk');
	}
	console.log('pass output directory contents:', passFiles.join(', '));

	console.log('\nAll scenarios completed in ' + (Date.now() - started) / 1000 + ' seconds.');
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
