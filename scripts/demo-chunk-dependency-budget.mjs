// Demonstrates the chunkDependencyBudget plugin against the built dist artifact:
// a passing build, a failing build, and the on-disk state after each.
// Run with: node scripts/demo-chunk-dependency-budget.mjs
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chunkDependencyBudget, rollup } = require('../dist/rollup.js');

const demoRoot = fileURLToPath(new URL('./demo-chunk-dependency-budget-output', import.meta.url));

const modules = {
	entry1: `import { sharedValue } from 'shared';
import('lazy').then(({ lazyValue }) => console.log(lazyValue));
export const out1 = sharedValue + '-1';`,
	entry2: `import { sharedValue } from 'shared';
import('lazy').then(({ lazyValue }) => console.log(lazyValue));
export const out2 = sharedValue + '-2';`,
	lazy: `export const lazyValue = 'loaded on demand';`,
	shared: `export const sharedValue = 'shared across entries';`
};

const loader = {
	load: id => modules[id],
	name: 'demo-loader',
	resolveId: id => (id in modules ? id : null)
};

async function buildScenario(name, budgets) {
	const outputDirectory = path.join(demoRoot, name);
	const reports = [];
	const bundle = await rollup({
		input: ['entry1', 'entry2'],
		plugins: [loader, chunkDependencyBudget({ budgets, onReport: report => reports.push(report) })]
	});
	try {
		await bundle.write({ dir: outputDirectory, format: 'es' });
		console.log(`\n=== ${name}: build passed ===`);
		console.log(JSON.stringify(reports[0], null, 2));
		console.log(`files on disk: ${readdirSync(outputDirectory).join(', ')}`);
	} catch (error) {
		console.log(`\n=== ${name}: build failed as expected ===`);
		console.log(error.message);
		console.log(
			existsSync(outputDirectory)
				? `files on disk: ${readdirSync(outputDirectory).join(', ')}`
				: 'files on disk: none (output directory was never created)'
		);
	} finally {
		await bundle.close();
	}
}

rmSync(demoRoot, { force: true, recursive: true });
await buildScenario('within-budget', { entry1: 100_000, entry2: 100_000 });
await buildScenario('over-budget', { entry1: 120, entry2: 100_000 });
