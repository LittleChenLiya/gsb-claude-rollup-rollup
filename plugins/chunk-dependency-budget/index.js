'use strict';

const UNKNOWN_EXTERNAL_COST = 'unknown';

function getUtf8ByteLength(code) {
	return Buffer.byteLength(code, 'utf8');
}

function compareLabels(first, second) {
	return first < second ? -1 : first > second ? 1 : 0;
}

function getComponentLabel(component) {
	return component.chunkFileNames.length === 1
		? component.chunkFileNames[0]
		: `[${component.chunkFileNames.join(', ')}]`;
}

function computeStronglyConnectedComponents(chunkFileNames, getStaticDependencies) {
	const indexByChunk = new Map();
	const lowLinkByChunk = new Map();
	const chunkStack = [];
	const onStack = new Set();
	const components = [];
	let nextIndex = 0;

	for (const root of chunkFileNames) {
		if (indexByChunk.has(root)) continue;
		const workStack = [{ dependencyPosition: 0, fileName: root }];
		indexByChunk.set(root, nextIndex);
		lowLinkByChunk.set(root, nextIndex);
		nextIndex++;
		chunkStack.push(root);
		onStack.add(root);

		while (workStack.length > 0) {
			const frame = workStack[workStack.length - 1];
			const dependencies = getStaticDependencies(frame.fileName);
			if (frame.dependencyPosition < dependencies.length) {
				const dependency = dependencies[frame.dependencyPosition];
				frame.dependencyPosition++;
				if (!indexByChunk.has(dependency)) {
					indexByChunk.set(dependency, nextIndex);
					lowLinkByChunk.set(dependency, nextIndex);
					nextIndex++;
					chunkStack.push(dependency);
					onStack.add(dependency);
					workStack.push({ dependencyPosition: 0, fileName: dependency });
				} else if (onStack.has(dependency)) {
					lowLinkByChunk.set(
						frame.fileName,
						Math.min(lowLinkByChunk.get(frame.fileName), indexByChunk.get(dependency))
					);
				}
			} else {
				workStack.pop();
				if (workStack.length > 0) {
					const parent = workStack[workStack.length - 1].fileName;
					lowLinkByChunk.set(
						parent,
						Math.min(lowLinkByChunk.get(parent), lowLinkByChunk.get(frame.fileName))
					);
				}
				if (lowLinkByChunk.get(frame.fileName) === indexByChunk.get(frame.fileName)) {
					const componentChunks = [];
					let member;
					do {
						member = chunkStack.pop();
						onStack.delete(member);
						componentChunks.push(member);
					} while (member !== frame.fileName);
					componentChunks.sort();
					components.push(componentChunks);
				}
			}
		}
	}
	return components;
}

function analyzeChunkGraph(chunks, budgets = {}) {
	const chunkFileNames = new Set(chunks.map(chunk => chunk.fileName));
	const chunkByFileName = new Map();
	for (const chunk of chunks) {
		chunkByFileName.set(chunk.fileName, {
			bytes: getUtf8ByteLength(chunk.code),
			dynamicImports: [...chunk.dynamicImports].sort(),
			externals: Object.keys(chunk.importedBindings || {})
				.filter(id => !chunkFileNames.has(id))
				.sort(),
			facadeModuleId: chunk.facadeModuleId,
			fileName: chunk.fileName,
			imports: [...chunk.imports].sort(),
			isEntry: chunk.isEntry,
			name: chunk.name
		});
	}

	const fileNames = [...chunkByFileName.keys()].sort();
	const getStaticDependencies = fileName =>
		(chunkByFileName.get(fileName)?.imports || []).filter(dependency =>
			chunkByFileName.has(dependency)
		);

	const componentByChunk = new Map();
	const components = computeStronglyConnectedComponents(fileNames, getStaticDependencies).map(
		(componentChunks, componentIndex) => {
			const component = {
				bytes: 0,
				chunkFileNames: componentChunks,
				cyclic: false,
				id: componentIndex
			};
			for (const fileName of componentChunks) {
				component.bytes += chunkByFileName.get(fileName).bytes;
				componentByChunk.set(fileName, componentIndex);
			}
			component.cyclic =
				componentChunks.length > 1 ||
				getStaticDependencies(componentChunks[0]).includes(componentChunks[0]);
			return component;
		}
	);

	const componentDependencies = components.map(component => {
		const dependencies = new Set();
		for (const fileName of component.chunkFileNames) {
			for (const dependency of getStaticDependencies(fileName)) {
				const dependencyComponent = componentByChunk.get(dependency);
				if (dependencyComponent !== component.id) {
					dependencies.add(dependencyComponent);
				}
			}
		}
		return [...dependencies].sort((first, second) =>
			compareLabels(getComponentLabel(components[first]), getComponentLabel(components[second]))
		);
	});

	const heaviestPathCache = new Map();
	const getHeaviestPath = componentId => {
		if (heaviestPathCache.has(componentId)) {
			return heaviestPathCache.get(componentId);
		}
		const component = components[componentId];
		let bestContinuation = null;
		for (const dependencyId of componentDependencies[componentId]) {
			const candidate = getHeaviestPath(dependencyId);
			if (
				!bestContinuation ||
				candidate.bytes > bestContinuation.bytes ||
				(candidate.bytes === bestContinuation.bytes &&
					compareLabels(candidate.label, bestContinuation.label) < 0)
			) {
				bestContinuation = candidate;
			}
		}
		const label = getComponentLabel(component);
		const path = bestContinuation ? [componentId, ...bestContinuation.path] : [componentId];
		const result = {
			bytes: component.bytes + (bestContinuation ? bestContinuation.bytes : 0),
			label: bestContinuation ? `${label} -> ${bestContinuation.label}` : label,
			path
		};
		heaviestPathCache.set(componentId, result);
		return result;
	};

	const entries = [];
	for (const fileName of fileNames) {
		const chunk = chunkByFileName.get(fileName);
		if (!chunk.isEntry) continue;

		const reachableComponents = new Set();
		const componentQueue = [componentByChunk.get(fileName)];
		while (componentQueue.length > 0) {
			const componentId = componentQueue.shift();
			if (reachableComponents.has(componentId)) continue;
			reachableComponents.add(componentId);
			componentQueue.push(...componentDependencies[componentId]);
		}

		const syncChunks = [];
		const dynamicChunks = new Set();
		const externals = new Set();
		let syncBytes = 0;
		for (const componentId of reachableComponents) {
			const component = components[componentId];
			syncBytes += component.bytes;
			for (const chunkFileName of component.chunkFileNames) {
				const reachableChunk = chunkByFileName.get(chunkFileName);
				syncChunks.push({
					bytes: reachableChunk.bytes,
					component: getComponentLabel(component),
					fileName: chunkFileName
				});
				for (const dynamicImport of reachableChunk.dynamicImports) {
					if (chunkByFileName.has(dynamicImport)) {
						dynamicChunks.add(dynamicImport);
					}
				}
				for (const external of reachableChunk.externals) {
					externals.add(external);
				}
			}
		}
		syncChunks.sort((first, second) => compareLabels(first.fileName, second.fileName));

		const budget =
			budgets[chunk.name] ??
			budgets[chunk.facadeModuleId] ??
			budgets[fileName] ??
			budgets.default ??
			null;
		const exceededBy = budget === null ? 0 : Math.max(0, syncBytes - budget);
		const heaviestPath = getHeaviestPath(componentByChunk.get(fileName));

		entries.push({
			budget,
			dynamicChunks: [...dynamicChunks].sort(),
			exceededBy,
			externals: [...externals].sort().map(id => ({ cost: UNKNOWN_EXTERNAL_COST, id })),
			fileName,
			heaviestPath: heaviestPath.path.map(componentId => ({
				bytes: components[componentId].bytes,
				chunks: components[componentId].chunkFileNames
			})),
			name: chunk.name,
			status: exceededBy > 0 ? 'fail' : 'pass',
			syncBytes,
			syncChunks
		});
	}
	entries.sort((first, second) => compareLabels(first.name, second.name));

	return { entries };
}

function formatExceededBudgets(failures) {
	const lines = failures.map(entry => {
		const pathLabel = entry.heaviestPath
			.map(component =>
				component.chunks.length === 1 ? component.chunks[0] : `[${component.chunks.join(', ')}]`
			)
			.join(' -> ');
		return (
			`Entry "${entry.name}" exceeds its chunk dependency budget by ${entry.exceededBy} bytes ` +
			`(budget: ${entry.budget}, actual: ${entry.syncBytes}). ` +
			`Largest contribution path: ${pathLabel}`
		);
	});
	return `Chunk dependency budget exceeded:\n${lines.join('\n')}`;
}

function analyzeBundle(bundle, budgets) {
	const chunks = [];
	for (const fileName of Object.keys(bundle)) {
		const output = bundle[fileName];
		if (output.type === 'chunk') {
			chunks.push(output);
		}
	}
	return analyzeChunkGraph(chunks, budgets);
}

function chunkDependencyBudget(options = {}) {
	const { budgets = {}, failOnError = true, onReport } = options;
	return {
		generateBundle: {
			handler(outputOptions, bundle) {
				const report = analyzeBundle(bundle, budgets);
				if (onReport) {
					onReport(report, outputOptions);
				}
				const failures = report.entries.filter(entry => entry.status === 'fail');
				if (failOnError && failures.length > 0) {
					this.error({
						code: 'CHUNK_BUDGET_EXCEEDED',
						message: formatExceededBudgets(failures)
					});
				}
			},
			order: 'post'
		},
		name: 'chunk-dependency-budget'
	};
}

module.exports = {
	analyzeChunkGraph,
	chunkDependencyBudget,
	formatExceededBudgets
};
