import { getIncludedModules } from '../Bundle';
import ExternalModule from '../ExternalModule';
import type Graph from '../Graph';
import Module, { type IncludedDependencyEdge } from '../Module';
import type { InclusionReasonReport, InclusionReasonStep } from '../rollup/types';

const MAX_INCLUSION_PATHS = 100;

const KIND_PRIORITY: Record<IncludedDependencyEdge['kind'], number> = {
	'dynamic-import': 2,
	're-export': 1,
	'static-import': 0
};

interface Predecessor {
	importer: Module;
	kind: IncludedDependencyEdge['kind'];
}

export function getInclusionReasons(graph: Graph, targetId: string): InclusionReasonReport {
	const target = graph.modulesById.get(targetId);
	if (!target) {
		return {
			included: false,
			paths: [],
			reason: `"${targetId}" is not part of the final bundle because no module with this id was loaded during the build.`,
			target: targetId,
			truncated: false
		};
	}
	const includedModules = new Set(getIncludedModules(graph.modulesById));
	if (target instanceof Module && !includedModules.has(target)) {
		return {
			included: false,
			paths: [],
			reason: `"${targetId}" is not part of the final bundle. It was loaded during the build, but none of its statements are included in any chunk, so it was likely removed by tree-shaking.`,
			target: targetId,
			truncated: false
		};
	}
	const edgesByModule = new Map<Module, IncludedDependencyEdge[]>();
	const getRetainedEdges = (module: Module): IncludedDependencyEdge[] => {
		let edges = edgesByModule.get(module);
		if (!edges) {
			const kindByDependency = new Map<Module | ExternalModule, IncludedDependencyEdge['kind']>();
			for (const { dependency, kind } of module.getIncludedDependencyEdges()) {
				if (dependency instanceof Module && !includedModules.has(dependency)) continue;
				const previousKind = kindByDependency.get(dependency);
				if (!previousKind || KIND_PRIORITY[kind] < KIND_PRIORITY[previousKind]) {
					kindByDependency.set(dependency, kind);
				}
			}
			edges = [...kindByDependency.entries()]
				.map(([dependency, kind]) => ({ dependency, kind }))
				.sort(
					(edgeA, edgeB) =>
						(edgeA.dependency.id > edgeB.dependency.id ? 1 : -1) ||
						KIND_PRIORITY[edgeA.kind] - KIND_PRIORITY[edgeB.kind]
				);
			edgesByModule.set(module, edges);
		}
		return edges;
	};

	const depthByModule = new Map<Module | ExternalModule, number>();
	const predecessorsByModule = new Map<Module | ExternalModule, Predecessor[]>();
	const queue: Module[] = [];
	for (const entry of [...graph.entryModules, ...graph.implicitEntryModules]) {
		if (!depthByModule.has(entry)) {
			depthByModule.set(entry, 0);
			queue.push(entry);
		}
	}
	for (let index = 0; index < queue.length; index++) {
		const importer = queue[index];
		const importerDepth = depthByModule.get(importer)!;
		for (const { dependency, kind } of getRetainedEdges(importer)) {
			const existingDepth = depthByModule.get(dependency);
			if (existingDepth === undefined) {
				depthByModule.set(dependency, importerDepth + 1);
				predecessorsByModule.set(dependency, [{ importer, kind }]);
				if (dependency instanceof Module) queue.push(dependency);
			} else if (existingDepth === importerDepth + 1) {
				predecessorsByModule.get(dependency)!.push({ importer, kind });
			}
		}
	}

	const predecessors = predecessorsByModule.get(target);
	if (target instanceof ExternalModule && !predecessors) {
		return {
			included: false,
			paths: [],
			reason: `"${targetId}" is not part of the final bundle. It is an external module that is not referenced by any included module.`,
			target: targetId,
			truncated: false
		};
	}

	let truncated = false;
	const collectPaths = (module: Module | ExternalModule): InclusionReasonStep[][] => {
		if (depthByModule.get(module) === 0) {
			return [[{ imported: module.id, importer: null, kind: 'entry' }]];
		}
		const paths: InclusionReasonStep[][] = [];
		for (const { importer, kind } of predecessorsByModule.get(module) || []) {
			for (const prefix of collectPaths(importer)) {
				paths.push([...prefix, { imported: module.id, importer: importer.id, kind }]);
				if (paths.length >= MAX_INCLUSION_PATHS) {
					truncated = true;
					return paths;
				}
			}
		}
		return paths;
	};
	const paths = depthByModule.has(target) ? collectPaths(target) : [];
	return {
		included: true,
		paths,
		reason:
			paths.length > 0
				? null
				: `"${targetId}" is part of the final bundle but could not be traced back to an entry module via retained static imports, dynamic imports or re-exports.`,
		target: targetId,
		truncated
	};
}
