import type {
	OutputBundle,
	OutputChunk,
	OutputOptions,
	Plugin,
	PluginContext
} from './rollup/types';

export interface ChunkDependencyBudgetComponent {
	/** The chunk file name, or all chunk file names of a cycle joined by " + ". */
	id: string;
	chunks: string[];
	bytes: number;
}

export interface ChunkDependencyBudgetDynamicImport {
	fileName: string;
	bytes: number;
}

export interface ChunkDependencyBudgetContribution {
	/** Component ids forming a path from the entry to the contributing component. */
	path: string[];
	bytes: number;
}

export interface ChunkDependencyBudgetEntryReport {
	entry: string;
	fileName: string;
	/** The configured synchronous byte budget, or null if the entry is unchecked. */
	budget: number | null;
	status: 'pass' | 'fail' | 'unchecked';
	/** Total UTF-8 bytes of all synchronously reachable chunks, each counted once. */
	totalBytes: number;
	exceededBy: number;
	/** Synchronously reachable strongly connected components, sorted by id. */
	components: ChunkDependencyBudgetComponent[];
	/** Dynamically imported chunks, listed for information but not budgeted. */
	dynamicImports: ChunkDependencyBudgetDynamicImport[];
	/** Statically imported external modules; their cost is unknown, not zero. */
	externalImports: string[];
	largestContribution: ChunkDependencyBudgetContribution | null;
}

export interface ChunkDependencyBudgetReport {
	entries: ChunkDependencyBudgetEntryReport[];
}

export interface ChunkDependencyBudgetOptions {
	/** Maximum synchronously reachable UTF-8 bytes per entry chunk name. */
	budgets?: Record<string, number>;
	onReport?: (report: ChunkDependencyBudgetReport, outputOptions: OutputOptions) => void;
}

interface ChunkNode {
	bytes: number;
	staticDependencies: string[];
	dynamicDependencies: string[];
	externalDependencies: string[];
}

const textEncoder = new TextEncoder();

export default function chunkDependencyBudget(options: ChunkDependencyBudgetOptions = {}): Plugin {
	const budgets = options.budgets ?? {};
	return {
		generateBundle(outputOptions, bundle) {
			const report = analyzeChunkGraph(bundle, budgets, moduleId => this.getModuleInfo(moduleId));
			options.onReport?.(report, outputOptions);
			const failures = report.entries.filter(entry => entry.status === 'fail');
			if (failures.length > 0) {
				this.error({
					code: 'CHUNK_BUDGET_EXCEEDED',
					message: [
						`Chunk dependency budget exceeded for ${failures.length} ${failures.length === 1 ? 'entry' : 'entries'}:`,
						...failures.map(formatFailure)
					].join('\n'),
					meta: { report }
				});
			}
		},
		name: 'chunk-dependency-budget'
	};
}

function formatFailure(entry: ChunkDependencyBudgetEntryReport): string {
	const contribution = entry.largestContribution
		? ` Largest contribution: ${entry.largestContribution.path.join(' -> ')} (${entry.largestContribution.bytes} bytes).`
		: '';
	return `- "${entry.entry}" (${entry.fileName}): ${entry.totalBytes} synchronously reachable bytes exceed the budget of ${entry.budget} by ${entry.exceededBy} bytes.${contribution}`;
}

function analyzeChunkGraph(
	bundle: OutputBundle,
	budgets: Record<string, number>,
	getModuleInfo: PluginContext['getModuleInfo']
): ChunkDependencyBudgetReport {
	const chunks = Object.values(bundle)
		.filter((output): output is OutputChunk => output.type === 'chunk')
		.sort(compareByFileName);
	const nodes = new Map<string, ChunkNode>();
	for (const chunk of chunks) {
		nodes.set(chunk.fileName, {
			bytes: textEncoder.encode(chunk.code).length,
			dynamicDependencies: chunk.dynamicImports.filter(
				fileName => bundle[fileName]?.type === 'chunk'
			),
			externalDependencies: getExternalDependencies(chunk, getModuleInfo),
			staticDependencies: chunk.imports
				.filter(fileName => bundle[fileName]?.type === 'chunk')
				.sort()
		});
	}
	const components = getStronglyConnectedComponents([...nodes.keys()], nodes)
		.map(componentChunks => ({
			bytes: componentChunks.reduce((sum, fileName) => sum + nodes.get(fileName)!.bytes, 0),
			chunks: componentChunks,
			id: componentChunks.join(' + ')
		}))
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const componentByChunk = new Map<string, number>();
	components.forEach((component, componentIndex) => {
		for (const fileName of component.chunks) {
			componentByChunk.set(fileName, componentIndex);
		}
	});
	const componentEdges = components.map((component, componentIndex) => [
		...new Set(
			component.chunks.flatMap(fileName =>
				nodes
					.get(fileName)!
					.staticDependencies.map(dependency => componentByChunk.get(dependency)!)
					.filter(dependency => dependency !== componentIndex)
			)
		)
	]);
	return {
		entries: chunks
			.filter(chunk => chunk.isEntry)
			.map(chunk =>
				analyzeEntry(chunk, budgets, nodes, components, componentByChunk, componentEdges)
			)
			.sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0))
	};
}

function compareByFileName(a: OutputChunk, b: OutputChunk): number {
	return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0;
}

function getExternalDependencies(
	chunk: OutputChunk,
	getModuleInfo: PluginContext['getModuleInfo']
): string[] {
	const externalDependencies = new Set<string>();
	for (const moduleId of chunk.moduleIds) {
		for (const importedId of getModuleInfo(moduleId)?.importedIds ?? []) {
			if (getModuleInfo(importedId)?.isExternal) {
				externalDependencies.add(importedId);
			}
		}
	}
	return [...externalDependencies].sort();
}

function getStronglyConnectedComponents(
	sortedNodes: string[],
	nodes: Map<string, ChunkNode>
): string[][] {
	const indexByNode = new Map<string, number>();
	const lowLinkByNode = new Map<string, number>();
	const nodesOnStack = new Set<string>();
	const stack: string[] = [];
	const components: string[][] = [];
	let nextIndex = 0;
	for (const root of sortedNodes) {
		if (indexByNode.has(root)) continue;
		indexByNode.set(root, nextIndex);
		lowLinkByNode.set(root, nextIndex);
		nextIndex++;
		stack.push(root);
		nodesOnStack.add(root);
		const work = [{ childIndex: 0, node: root }];
		while (work.length > 0) {
			const frame = work[work.length - 1];
			const children = nodes.get(frame.node)!.staticDependencies;
			if (frame.childIndex < children.length) {
				const child = children[frame.childIndex++];
				if (!indexByNode.has(child)) {
					indexByNode.set(child, nextIndex);
					lowLinkByNode.set(child, nextIndex);
					nextIndex++;
					stack.push(child);
					nodesOnStack.add(child);
					work.push({ childIndex: 0, node: child });
				} else if (nodesOnStack.has(child)) {
					lowLinkByNode.set(
						frame.node,
						Math.min(lowLinkByNode.get(frame.node)!, indexByNode.get(child)!)
					);
				}
			} else {
				work.pop();
				if (work.length > 0) {
					const parent = work[work.length - 1].node;
					lowLinkByNode.set(
						parent,
						Math.min(lowLinkByNode.get(parent)!, lowLinkByNode.get(frame.node)!)
					);
				}
				if (lowLinkByNode.get(frame.node) === indexByNode.get(frame.node)) {
					const component: string[] = [];
					let member: string;
					do {
						member = stack.pop()!;
						nodesOnStack.delete(member);
						component.push(member);
					} while (member !== frame.node);
					components.push(component.sort());
				}
			}
		}
	}
	return components;
}

interface ComponentInfo {
	id: string;
	chunks: string[];
	bytes: number;
}

function analyzeEntry(
	entryChunk: OutputChunk,
	budgets: Record<string, number>,
	nodes: Map<string, ChunkNode>,
	components: ComponentInfo[],
	componentByChunk: Map<string, number>,
	componentEdges: number[][]
): ChunkDependencyBudgetEntryReport {
	const reachableComponents = getReachableComponents(
		componentByChunk.get(entryChunk.fileName)!,
		componentEdges
	);
	const reachableChunks = reachableComponents.flatMap(index => components[index].chunks);
	const dynamicImports = [
		...new Set(reachableChunks.flatMap(fileName => nodes.get(fileName)!.dynamicDependencies))
	]
		.sort()
		.map(fileName => ({ bytes: nodes.get(fileName)?.bytes ?? 0, fileName }));
	const externalImports = [
		...new Set(reachableChunks.flatMap(fileName => nodes.get(fileName)!.externalDependencies))
	].sort();
	const totalBytes = reachableComponents.reduce((sum, index) => sum + components[index].bytes, 0);
	const budget = budgets[entryChunk.name] ?? null;
	return {
		budget,
		components: reachableComponents.map(index => components[index]),
		dynamicImports,
		entry: entryChunk.name,
		exceededBy: budget === null ? 0 : Math.max(0, totalBytes - budget),
		externalImports,
		fileName: entryChunk.fileName,
		largestContribution: getLargestContribution(
			componentByChunk.get(entryChunk.fileName)!,
			reachableComponents,
			components,
			componentEdges
		),
		status: budget === null ? 'unchecked' : totalBytes > budget ? 'fail' : 'pass',
		totalBytes
	};
}

function getReachableComponents(startComponent: number, componentEdges: number[][]): number[] {
	const reachable = new Set<number>([startComponent]);
	const queue = [startComponent];
	while (queue.length > 0) {
		for (const dependency of componentEdges[queue.shift()!]) {
			if (!reachable.has(dependency)) {
				reachable.add(dependency);
				queue.push(dependency);
			}
		}
	}
	return [...reachable].sort((a, b) => a - b);
}

function getLargestContribution(
	entryComponent: number,
	reachableComponents: number[],
	components: ComponentInfo[],
	componentEdges: number[][]
): ChunkDependencyBudgetContribution | null {
	let largest: ComponentInfo | null = null;
	for (const index of reachableComponents) {
		const component = components[index];
		if (
			largest === null ||
			component.bytes > largest.bytes ||
			(component.bytes === largest.bytes && component.id < largest.id)
		) {
			largest = component;
		}
	}
	if (largest === null) return null;
	const targetComponent = components.indexOf(largest);
	return {
		bytes: largest.bytes,
		path: findComponentPath(entryComponent, targetComponent, components, componentEdges)
	};
}

function findComponentPath(
	startComponent: number,
	targetComponent: number,
	components: ComponentInfo[],
	componentEdges: number[][]
): string[] {
	const parentByComponent = new Map<number, number>([[startComponent, -1]]);
	const queue = [startComponent];
	while (queue.length > 0 && !parentByComponent.has(targetComponent)) {
		const current = queue.shift()!;
		for (const dependency of componentEdges[current]) {
			if (!parentByComponent.has(dependency)) {
				parentByComponent.set(dependency, current);
				queue.push(dependency);
			}
		}
	}
	const path: string[] = [];
	for (let at = targetComponent; at !== -1; at = parentByComponent.get(at)!) {
		path.unshift(components[at].id);
	}
	return path;
}
