import type {
	ModuleManifest,
	ModuleManifestAsset,
	ModuleManifestChunk,
	ModuleManifestDynamicImportEdge,
	ModuleManifestEntry,
	ModuleManifestModule,
	ModuleManifestOptions,
	OutputAsset,
	OutputBundle,
	OutputChunk,
	Plugin
} from '../rollup/types';
import { isAbsolute, normalize, relative, resolve } from '../utils/path';

const DEFAULT_MANIFEST_FILE_NAME = 'module-manifest.json';

export default function moduleManifest(options: ModuleManifestOptions = {}): Plugin {
	const fileName = options.fileName ?? DEFAULT_MANIFEST_FILE_NAME;
	return {
		generateBundle(_outputOptions, bundle) {
			const manifest = buildModuleManifest(bundle, fileName, options.root ?? resolve());
			this.emitFile({
				fileName,
				source: JSON.stringify(manifest, null, 2) + '\n',
				type: 'asset'
			});
		},
		name: 'module-manifest'
	};
}

function toManifestModuleId(id: string, root: string): string {
	return isAbsolute(id) ? normalize(relative(root, id)) : id;
}

function buildModuleManifest(
	bundle: OutputBundle,
	manifestFileName: string,
	root: string
): ModuleManifest {
	const chunks: Record<string, ModuleManifestChunk> = Object.create(null);
	const assets: Record<string, ModuleManifestAsset> = Object.create(null);
	const entries: Record<string, ModuleManifestEntry> = Object.create(null);
	const dynamicImportEdges: ModuleManifestDynamicImportEdge[] = [];
	const unknownAssets: string[] = [];

	for (const [fileName, output] of Object.entries(bundle)) {
		if (fileName === manifestFileName) continue;
		if (output.type === 'asset') {
			assets[fileName] = getManifestAsset(output, root);
			if (assets[fileName].emittedBy.length === 0) {
				unknownAssets.push(fileName);
			}
		} else {
			chunks[fileName] = getManifestChunk(output, bundle, manifestFileName, root);
			for (const target of output.dynamicImports) {
				dynamicImportEdges.push({ from: fileName, to: target });
			}
		}
	}

	for (const [fileName, output] of Object.entries(bundle)) {
		if (fileName === manifestFileName || output.type !== 'chunk' || !output.isEntry) continue;
		entries[fileName] = getManifestEntry(fileName, output, chunks, root);
	}

	return {
		assets,
		chunks,
		dynamicImportEdges,
		entries,
		totals: getManifestTotals(chunks),
		unknown: { assets: unknownAssets.sort() },
		version: 1
	};
}

function getManifestAsset(output: OutputAsset, root: string): ModuleManifestAsset {
	return {
		emittedBy: (output.emittedByModuleIds ?? []).map(id => toManifestModuleId(id, root)).sort(),
		names: [...output.names],
		size: typeof output.source === 'string' ? output.source.length : output.source.byteLength
	};
}

function getManifestChunk(
	output: OutputChunk,
	bundle: OutputBundle,
	manifestFileName: string,
	root: string
): ModuleManifestChunk {
	const modules: Record<string, ModuleManifestModule> = Object.create(null);
	for (const [id, renderedModule] of Object.entries(output.modules)) {
		modules[toManifestModuleId(id, root)] = {
			originalLength: renderedModule.originalLength,
			renderedLength: renderedModule.renderedLength
		};
	}
	return {
		dynamicImports: [...output.dynamicImports],
		imports: [...output.imports],
		isDynamicEntry: output.isDynamicEntry,
		isEntry: output.isEntry,
		modules,
		referencedAssets: output.referencedFiles.filter(
			fileName => fileName !== manifestFileName && bundle[fileName]?.type === 'asset'
		)
	};
}

function getManifestEntry(
	entryFileName: string,
	output: OutputChunk,
	chunks: Record<string, ModuleManifestChunk>,
	root: string
): ModuleManifestEntry {
	const staticChunks = new Set<string>();
	const dynamicImports = new Set<string>();
	const pending = [entryFileName];
	while (pending.length > 0) {
		const fileName = pending.pop()!;
		if (staticChunks.has(fileName)) continue;
		staticChunks.add(fileName);
		const chunk = chunks[fileName];
		if (!chunk) continue;
		pending.push(...chunk.imports);
		for (const target of chunk.dynamicImports) {
			dynamicImports.add(target);
		}
	}
	return {
		dynamicImports: [...dynamicImports].sort(),
		facadeModuleId: output.facadeModuleId ? toManifestModuleId(output.facadeModuleId, root) : null,
		staticChunks: [...staticChunks].sort()
	};
}

function getManifestTotals(chunks: Record<string, ModuleManifestChunk>): ModuleManifest['totals'] {
	const countedModules = new Set<string>();
	let originalLength = 0;
	let renderedLength = 0;
	for (const chunk of Object.values(chunks)) {
		for (const [id, module] of Object.entries(chunk.modules)) {
			if (countedModules.has(id)) continue;
			countedModules.add(id);
			originalLength += module.originalLength;
			renderedLength += module.renderedLength;
		}
	}
	return { modules: countedModules.size, originalLength, renderedLength };
}
