import ExternalModule from '../ExternalModule';
import type Graph from '../Graph';
import Module from '../Module';
import type { InclusionReasonStep, ModuleInclusionReasons } from '../rollup/types';

type InclusionReasonStepKind = InclusionReasonStep['kind'];

interface RetainedImporter {
	importer: Module;
	kind: InclusionReasonStepKind;
}

const compareByModuleId = (first: RetainedImporter, second: RetainedImporter): number =>
	first.importer.id < second.importer.id ? -1 : first.importer.id > second.importer.id ? 1 : 0;

/**
 * Computes, for a given module id, why the module is part of the final bundle.
 *
 * The report contains all retained paths from an entry point to the module,
 * where each step of a path is a static import, a dynamic import or a
 * re-export. Only module relationships that survived tree-shaking are taken
 * into account: modules that have been completely removed from the bundle
 * never appear on a path unless they pass on a live re-export, and dynamic
 * import edges that have been removed are ignored as well.
 */
export default function getInclusionReasons(
	graph: Graph,
	moduleId: string
): ModuleInclusionReasons {
	const module = graph.modulesById.get(moduleId);
	if (!module) {
		return {
			moduleId,
			paths: [],
			reason: `The module "${moduleId}" is not part of the module graph. It was never resolved or loaded, so it cannot be part of the final bundle.`,
			status: 'unknown'
		};
	}
	if (module instanceof ExternalModule) {
		return {
			moduleId,
			paths: collectPaths(graph, module),
			reason: `The module "${moduleId}" is external. It is not included in the bundle itself but referenced as an external dependency.`,
			status: 'external'
		};
	}
	if (!module.isIncluded()) {
		return {
			moduleId,
			paths: [],
			reason: `The module "${moduleId}" was loaded but completely removed by tree-shaking. It is not part of the final bundle.`,
			status: 'not-included'
		};
	}
	const paths = collectPaths(graph, module);
	return {
		moduleId,
		paths,
		reason:
			paths.length > 0
				? `The module "${moduleId}" is included in the final bundle.`
				: `The module "${moduleId}" is included in the final bundle, but no retained import path from an entry point to it was found.`,
		status: 'included'
	};
}

function collectPaths(graph: Graph, target: Module | ExternalModule): InclusionReasonStep[][] {
	const paths: InclusionReasonStep[][] = [];
	const visit = (
		module: Module | ExternalModule,
		onPath: ReadonlySet<string>,
		suffix: InclusionReasonStep[]
	): void => {
		if (module instanceof Module && module.info.isEntry) {
			paths.push([{ kind: 'entry', moduleId: module.id }, ...suffix]);
		}
		for (const { importer, kind } of getRetainedImporters(graph, module, onPath)) {
			visit(importer, new Set(onPath).add(importer.id), [{ kind, moduleId: module.id }, ...suffix]);
		}
	};
	visit(target, new Set([target.id]), []);
	const seen = new Set<string>();
	const uniquePaths: InclusionReasonStep[][] = [];
	for (const path of paths.sort(compareSerialized)) {
		const serialized = JSON.stringify(path);
		if (!seen.has(serialized)) {
			seen.add(serialized);
			uniquePaths.push(path);
		}
	}
	return uniquePaths;
}

function compareSerialized(first: InclusionReasonStep[], second: InclusionReasonStep[]): number {
	const serializedFirst = JSON.stringify(first);
	const serializedSecond = JSON.stringify(second);
	return serializedFirst < serializedSecond ? -1 : serializedFirst > serializedSecond ? 1 : 0;
}

function getRetainedImporters(
	graph: Graph,
	module: Module | ExternalModule,
	onPath: ReadonlySet<string>
): RetainedImporter[] {
	const retainedImporters: RetainedImporter[] = [];
	for (const importerId of module.importers) {
		if (onPath.has(importerId)) continue;
		const importer = graph.modulesById.get(importerId);
		if (!(importer instanceof Module)) continue;
		if (importer.isIncluded()) {
			retainedImporters.push({
				importer,
				kind:
					importer.reexportsFromModule(module) && !importer.importsFromModule(module)
						? 'reexport'
						: 'static-import'
			});
		} else if (
			// Pure re-export modules usually do not contribute code to the
			// bundle themselves, but they still pass on the inclusion reason if
			// one of the variables they re-export from this module is included.
			importer.reexportsFromModule(module) &&
			importer.reexportsIncludedVariableFromModule(module)
		) {
			retainedImporters.push({ importer, kind: 'reexport' });
		}
	}
	if (module instanceof Module) {
		// This list only contains dynamic importers whose dynamic import edge
		// survived tree-shaking.
		for (const importer of module.includedDynamicImporters) {
			if (!onPath.has(importer.id)) {
				retainedImporters.push({ importer, kind: 'dynamic-import' });
			}
		}
	} else {
		for (const importerId of module.dynamicImporters) {
			if (onPath.has(importerId)) continue;
			const importer = graph.modulesById.get(importerId);
			if (importer instanceof Module && importer.isIncluded()) {
				retainedImporters.push({ importer, kind: 'dynamic-import' });
			}
		}
	}
	return retainedImporters.sort(compareByModuleId);
}
