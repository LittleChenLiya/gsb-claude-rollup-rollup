const assert = require('node:assert');
const rollup = require('../../dist/rollup');
const { loader } = require('../testHelpers.js');

describe('getInclusionReasons', () => {
	it('reports retained paths for shared, dynamic, tree-shaken and unused modules', async () => {
		const bundle = await rollup.rollup({
			input: ['input1', 'input2'],
			plugins: [
				loader({
					dynamic: `export const dynamicValue = 'dynamic';\nconsole.log('dynamic side effect');`,
					input1: `import { sharedValue } from 'shared';\nimport { gone } from 'shaken';\nimport('dynamic');\nconsole.log('input1', sharedValue);`,
					input2: `import { sharedValue } from 'shared';\nconsole.log('input2', sharedValue);`,
					shaken: `export const gone = 'gone';`,
					shared: `export const sharedValue = 'shared';\nconsole.log('shared side effect');`,
					unused: `export const unused = 'unused';`
				})
			]
		});

		const { output } = await bundle.generate({ format: 'es' });
		const bundledModuleIds = new Set(output.flatMap(chunk => Object.keys(chunk.modules)));
		assert.ok(bundledModuleIds.has('shared'), 'shared is in the bundle');
		assert.ok(bundledModuleIds.has('dynamic'), 'dynamic is in the bundle');
		assert.ok(!bundledModuleIds.has('shaken'), 'shaken is not in the bundle');
		assert.ok(!bundledModuleIds.has('unused'), 'unused is not in the bundle');

		// a module statically imported by two entries
		const sharedReport = bundle.getInclusionReasons('shared');
		assert.deepStrictEqual(sharedReport, {
			moduleId: 'shared',
			paths: [
				[
					{ kind: 'entry', moduleId: 'input1' },
					{ kind: 'static-import', moduleId: 'shared' }
				],
				[
					{ kind: 'entry', moduleId: 'input2' },
					{ kind: 'static-import', moduleId: 'shared' }
				]
			],
			reason: 'The module "shared" is included in the final bundle.',
			status: 'included'
		});
		assert.ok(bundledModuleIds.has(sharedReport.moduleId), 'report matches the final bundle');

		// a module only pulled in via a dynamic import
		assert.deepStrictEqual(bundle.getInclusionReasons('dynamic'), {
			moduleId: 'dynamic',
			paths: [
				[
					{ kind: 'entry', moduleId: 'input1' },
					{ kind: 'dynamic-import', moduleId: 'dynamic' }
				]
			],
			reason: 'The module "dynamic" is included in the final bundle.',
			status: 'included'
		});

		// a module that was loaded but completely tree-shaken
		assert.deepStrictEqual(bundle.getInclusionReasons('shaken'), {
			moduleId: 'shaken',
			paths: [],
			reason:
				'The module "shaken" was loaded but completely removed by tree-shaking. It is not part of the final bundle.',
			status: 'not-included'
		});

		// a module that was never part of the module graph
		assert.deepStrictEqual(bundle.getInclusionReasons('unused'), {
			moduleId: 'unused',
			paths: [],
			reason:
				'The module "unused" is not part of the module graph. It was never resolved or loaded, so it cannot be part of the final bundle.',
			status: 'unknown'
		});

		await bundle.close();
	});

	it('terminates on cyclic imports and produces stable output', async () => {
		const bundle = await rollup.rollup({
			input: 'entry',
			plugins: [
				loader({
					cycleA: `import { b } from 'cycleB';\nexport const a = 'a';\nconsole.log(b);`,
					cycleB: `import { a } from 'cycleA';\nexport const b = 'b';\nconsole.log(a);`,
					entry: `import { a } from 'cycleA';\nconsole.log(a);`
				})
			]
		});

		const expectedCycleA = {
			moduleId: 'cycleA',
			paths: [
				[
					{ kind: 'entry', moduleId: 'entry' },
					{ kind: 'static-import', moduleId: 'cycleA' }
				]
			],
			reason: 'The module "cycleA" is included in the final bundle.',
			status: 'included'
		};
		assert.deepStrictEqual(bundle.getInclusionReasons('cycleA'), expectedCycleA);
		// repeated calls produce identical output
		assert.deepStrictEqual(bundle.getInclusionReasons('cycleA'), expectedCycleA);

		assert.deepStrictEqual(bundle.getInclusionReasons('cycleB'), {
			moduleId: 'cycleB',
			paths: [
				[
					{ kind: 'entry', moduleId: 'entry' },
					{ kind: 'static-import', moduleId: 'cycleA' },
					{ kind: 'static-import', moduleId: 'cycleB' }
				]
			],
			reason: 'The module "cycleB" is included in the final bundle.',
			status: 'included'
		});

		await bundle.close();
	});

	it('follows chains of pure re-exports', async () => {
		const bundle = await rollup.rollup({
			input: 'entry',
			plugins: [
				loader({
					barrel: `export { value } from 'middle';`,
					entry: `import { value } from 'barrel';\nconsole.log(value);`,
					middle: `export { value } from 'source';`,
					source: `export const value = 'value';`
				})
			]
		});

		assert.deepStrictEqual(bundle.getInclusionReasons('source'), {
			moduleId: 'source',
			paths: [
				[
					{ kind: 'entry', moduleId: 'entry' },
					{ kind: 'static-import', moduleId: 'barrel' },
					{ kind: 'reexport', moduleId: 'middle' },
					{ kind: 'reexport', moduleId: 'source' }
				]
			],
			reason: 'The module "source" is included in the final bundle.',
			status: 'included'
		});

		await bundle.close();
	});

	it('reports external modules as external with their retained paths', async () => {
		const bundle = await rollup.rollup({
			external: ['external-dep'],
			input: 'entry',
			plugins: [
				loader({
					entry: `import { externalValue } from 'external-dep';\nconsole.log(externalValue);`
				})
			]
		});

		assert.deepStrictEqual(bundle.getInclusionReasons('external-dep'), {
			moduleId: 'external-dep',
			paths: [
				[
					{ kind: 'entry', moduleId: 'entry' },
					{ kind: 'static-import', moduleId: 'external-dep' }
				]
			],
			reason:
				'The module "external-dep" is external. It is not included in the bundle itself but referenced as an external dependency.',
			status: 'external'
		});

		await bundle.close();
	});

	it('supports virtual modules provided by plugins', async () => {
		const bundle = await rollup.rollup({
			input: 'entry',
			plugins: [
				loader({
					entry: `import { virtualValue } from 'virtual';\nconsole.log(virtualValue);`
				}),
				{
					name: 'virtual-module',
					resolveId(id) {
						if (id === 'virtual') return '\0virtual';
						return null;
					},
					load(id) {
						if (id === '\0virtual') return `export const virtualValue = 'virtual';`;
						return null;
					}
				}
			]
		});

		assert.deepStrictEqual(bundle.getInclusionReasons('\0virtual'), {
			moduleId: '\0virtual',
			paths: [
				[
					{ kind: 'entry', moduleId: 'entry' },
					{ kind: 'static-import', moduleId: '\0virtual' }
				]
			],
			reason: 'The module "\0virtual" is included in the final bundle.',
			status: 'included'
		});

		await bundle.close();
	});
});
