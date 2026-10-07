const assert = require('node:assert');
const rollup = require('../../dist/rollup');
const { loader } = require('../testHelpers.js');

function getBundleModuleIds(output) {
	const moduleIds = new Set();
	for (const chunk of output) {
		if (chunk.type === 'chunk') {
			for (const id of Object.keys(chunk.modules)) moduleIds.add(id);
		}
	}
	return moduleIds;
}

describe('getInclusionReasons', () => {
	it('reports retained paths from multiple entries including dynamic imports and excludes tree-shaken modules', async () => {
		const bundle = await rollup.rollup({
			input: ['input1', 'input2'],
			plugins: [
				loader({
					input1:
						'import { a } from "shared"; import { unused } from "unused"; import("dynamic"); console.log(a);',
					input2: 'import { b } from "shared"; console.log(b);',
					shared: 'import { d } from "deep"; export const a = d + "a"; export const b = d + "b";',
					deep: 'export const d = "d";',
					dynamic: 'console.log("dynamic"); export const dyn = "dyn";',
					unused: 'export const unused = "unused";'
				})
			]
		});
		const sharedReportBeforeGenerate = bundle.getInclusionReasons('shared');
		const { output } = await bundle.generate({ format: 'es' });
		const bundleModuleIds = getBundleModuleIds(output);

		assert.deepEqual(bundle.getInclusionReasons('shared'), {
			included: true,
			paths: [
				[
					{ imported: 'input1', importer: null, kind: 'entry' },
					{ imported: 'shared', importer: 'input1', kind: 'static-import' }
				],
				[
					{ imported: 'input2', importer: null, kind: 'entry' },
					{ imported: 'shared', importer: 'input2', kind: 'static-import' }
				]
			],
			reason: null,
			target: 'shared',
			truncated: false
		});
		// the report is stable and does not depend on whether output was generated
		assert.deepEqual(bundle.getInclusionReasons('shared'), sharedReportBeforeGenerate);

		assert.deepEqual(bundle.getInclusionReasons('deep').paths, [
			[
				{ imported: 'input1', importer: null, kind: 'entry' },
				{ imported: 'shared', importer: 'input1', kind: 'static-import' },
				{ imported: 'deep', importer: 'shared', kind: 'static-import' }
			],
			[
				{ imported: 'input2', importer: null, kind: 'entry' },
				{ imported: 'shared', importer: 'input2', kind: 'static-import' },
				{ imported: 'deep', importer: 'shared', kind: 'static-import' }
			]
		]);

		assert.deepEqual(bundle.getInclusionReasons('dynamic'), {
			included: true,
			paths: [
				[
					{ imported: 'input1', importer: null, kind: 'entry' },
					{ imported: 'dynamic', importer: 'input1', kind: 'dynamic-import' }
				]
			],
			reason: null,
			target: 'dynamic',
			truncated: false
		});

		// every module mentioned in a reported path is actually part of the final bundle
		for (const target of ['shared', 'deep', 'dynamic']) {
			const report = bundle.getInclusionReasons(target);
			assert.ok(report.paths.length > 0, 'expected paths for ' + target);
			for (const path of report.paths) {
				for (const step of path) {
					assert.ok(
						bundleModuleIds.has(step.imported),
						'expected ' + step.imported + ' of ' + target + ' report to be in the bundle'
					);
					if (step.importer !== null) {
						assert.ok(
							bundleModuleIds.has(step.importer),
							'expected ' + step.importer + ' of ' + target + ' report to be in the bundle'
						);
					}
				}
			}
		}

		// the tree-shaken module is neither in the bundle nor in any reported path
		assert.ok(!bundleModuleIds.has('unused'));
		const unusedReport = bundle.getInclusionReasons('unused');
		assert.equal(unusedReport.included, false);
		assert.deepEqual(unusedReport.paths, []);
		assert.match(unusedReport.reason, /tree-shaking/);
		await bundle.close();
	});

	it('terminates on circular dependencies with stable output', async () => {
		const bundle = await rollup.rollup({
			input: ['main'],
			onLog() {},
			plugins: [
				loader({
					main: 'import "a"; console.log("main");',
					a: 'import "b"; console.log("a");',
					b: 'import "a"; console.log("b");'
				})
			]
		});
		const reportForB = bundle.getInclusionReasons('b');
		assert.deepEqual(reportForB.paths, [
			[
				{ imported: 'main', importer: null, kind: 'entry' },
				{ imported: 'a', importer: 'main', kind: 'static-import' },
				{ imported: 'b', importer: 'a', kind: 'static-import' }
			]
		]);
		// the shortest path wins, the cycle is not unrolled
		assert.deepEqual(bundle.getInclusionReasons('a').paths, [
			[
				{ imported: 'main', importer: null, kind: 'entry' },
				{ imported: 'a', importer: 'main', kind: 'static-import' }
			]
		]);
		// repeated calls produce identical reports
		assert.deepEqual(bundle.getInclusionReasons('b'), reportForB);
		await bundle.close();
	});

	it('reports chains that only consist of re-exports', async () => {
		const bundle = await rollup.rollup({
			input: ['main'],
			plugins: [
				loader({
					main: 'import * as ns from "reexporter"; import * as star from "star"; console.log(ns, star);',
					reexporter: 'export { x } from "real";',
					real: 'export const x = "x";',
					star: 'export * from "real2";',
					real2: 'export const y = "y";'
				})
			]
		});
		assert.deepEqual(bundle.getInclusionReasons('real'), {
			included: true,
			paths: [
				[
					{ imported: 'main', importer: null, kind: 'entry' },
					{ imported: 'reexporter', importer: 'main', kind: 'static-import' },
					{ imported: 'real', importer: 'reexporter', kind: 're-export' }
				]
			],
			reason: null,
			target: 'real',
			truncated: false
		});
		assert.deepEqual(bundle.getInclusionReasons('real2').paths, [
			[
				{ imported: 'main', importer: null, kind: 'entry' },
				{ imported: 'star', importer: 'main', kind: 'static-import' },
				{ imported: 'real2', importer: 'star', kind: 're-export' }
			]
		]);
		await bundle.close();
	});

	it('reports external modules and explains unreferenced externals', async () => {
		const bundle = await rollup.rollup({
			external: ['external-dep', 'unused-external'],
			input: ['main'],
			onLog() {},
			plugins: [
				loader({
					main: 'import { e } from "external-dep"; import { u } from "proxy"; console.log(e);',
					proxy: 'export { u } from "unused-external";'
				})
			],
			treeshake: { moduleSideEffects: false }
		});
		assert.deepEqual(bundle.getInclusionReasons('external-dep'), {
			included: true,
			paths: [
				[
					{ imported: 'main', importer: null, kind: 'entry' },
					{ imported: 'external-dep', importer: 'main', kind: 'static-import' }
				]
			],
			reason: null,
			target: 'external-dep',
			truncated: false
		});
		const unreferencedReport = bundle.getInclusionReasons('unused-external');
		assert.equal(unreferencedReport.included, false);
		assert.deepEqual(unreferencedReport.paths, []);
		assert.match(unreferencedReport.reason, /external module/);
		await bundle.close();
	});

	it('reports virtual modules by their resolved id', async () => {
		const bundle = await rollup.rollup({
			input: ['main'],
			plugins: [
				loader({
					main: 'import { v } from "virtual-mod"; console.log(v);'
				}),
				{
					name: 'virtual-module',
					resolveId(id) {
						return id === 'virtual-mod' ? '\0virtual:mod' : null;
					},
					load(id) {
						return id === '\0virtual:mod' ? 'export const v = "virtual";' : null;
					}
				}
			]
		});
		assert.deepEqual(bundle.getInclusionReasons('\0virtual:mod'), {
			included: true,
			paths: [
				[
					{ imported: 'main', importer: null, kind: 'entry' },
					{ imported: '\0virtual:mod', importer: 'main', kind: 'static-import' }
				]
			],
			reason: null,
			target: '\0virtual:mod',
			truncated: false
		});
		await bundle.close();
	});

	it('clearly explains targets that are not part of the bundle', async () => {
		const bundle = await rollup.rollup({
			input: ['main'],
			plugins: [
				loader({
					main: 'console.log("main");'
				})
			]
		});
		const unknownReport = bundle.getInclusionReasons('never-loaded');
		assert.equal(unknownReport.included, false);
		assert.deepEqual(unknownReport.paths, []);
		assert.equal(unknownReport.truncated, false);
		assert.match(unknownReport.reason, /no module with this id was loaded/);

		// an entry module is traced back to itself
		assert.deepEqual(bundle.getInclusionReasons('main'), {
			included: true,
			paths: [[{ imported: 'main', importer: null, kind: 'entry' }]],
			reason: null,
			target: 'main',
			truncated: false
		});
		await bundle.close();
	});
});
