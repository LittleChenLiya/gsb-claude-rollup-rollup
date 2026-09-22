'use strict';

const path = require('node:path');

const PLUGIN_NAME = 'rollup-plugin-module-ownership-manifest';
const DEFAULT_FILE_NAME = 'module-manifest.json';

const RENDERED_LENGTH_NOTE =
	"renderedLength is the length of a module's rendered (bundled) code before any " +
	'minification or compression. It is not the minified or gzipped size and must not be ' +
	'used for precise compressed-size attribution.';

/**
 * @typedef {object} ModuleOwnershipManifestOptions
 * @property {string | ((outputOptions: object) => string)} [fileName]
 *   File name of the emitted manifest asset. Pass a function to derive a
 *   per-output name when several outputs share one directory.
 *   Defaults to "module-manifest.json".
 * @property {string} [root]
 *   Project root that module ids are reported relative to. Defaults to
 *   process.cwd(). Virtual module ids (containing a null byte) and other
 *   non-absolute ids are kept as-is so they remain recognizable.
 */

/**
 * The emitted manifest is a JSON document with these fields:
 *
 * - version: Manifest format version, currently 1.
 * - root: Absolute project root that module paths are relative to.
 * - notes.renderedLength: Caveat about the renderedLength field.
 * - entries: Maps every entry chunk file name to
 *   - facadeModule: project-relative id of the entry module
 *   - staticChunks: transitive closure of statically reachable chunks
 *     (via "imports" and "implicitlyLoadedBefore"), including the entry itself
 *   - dynamicEdges: dynamic import edges "{ from, to }" leaving the
 *     statically reachable chunks, using final output file names
 * - chunks: Maps every chunk file name to
 *   - facadeModule, isEntry, isDynamicEntry
 *   - imports / dynamicImports / implicitlyLoadedBefore: final file
 *     names of referenced chunks
 *   - modules: maps the project-relative id of each module in the chunk to
 *     its originalLength (length of the original module source) and
 *     renderedLength (length of the module's rendered code in this chunk;
 *     NOT the minified or compressed size)
 * - assets: Maps every asset file name to
 *   - attributedTo: project-relative id of the module the asset was emitted
 *     from, or null if the origin is unknown or ambiguous
 *   - emittedBy: raw provenance records "{ plugin, module }" reported by
 *     Rollup core
 * - unknownAssets: file names of assets that could not be attributed to a
 *   single module. Assets are never matched to modules by file name; when in
 *   doubt, they end up here.
 * - totals: { chunks, assets, modules, originalLength, renderedLength }
 *   summed over unique modules so that chunks shared between entries are not
 *   counted twice.
 *
 * The manifest is generated in "generateBundle", i.e. after all final file
 * names (including hashes) are known, and it always references final output
 * file names. The manifest asset itself is only emitted after the manifest
 * was computed, so it never contains itself, and because it is an asset with
 * a fixed file name, it cannot take part in chunk hash cycles.
 *
 * @param {ModuleOwnershipManifestOptions} [options]
 */
function moduleOwnershipManifest(options = {}) {
	const { fileName = DEFAULT_FILE_NAME, root = process.cwd() } = options;
	return {
		generateBundle(outputOptions, bundle) {
			const manifest = createManifest(bundle, path.resolve(root));
			this.emitFile({
				fileName: typeof fileName === 'function' ? fileName(outputOptions) : fileName,
				source: JSON.stringify(manifest, null, 2) + '\n',
				type: 'asset'
			});
		},
		name: PLUGIN_NAME
	};
}

function createManifest(bundle, root) {
	const chunks = {};
	for (const fileName of Object.keys(bundle).sort()) {
		const item = bundle[fileName];
		if (item.type !== 'chunk') continue;
		const modules = {};
		for (const id of Object.keys(item.modules).sort()) {
			const renderedModule = item.modules[id];
			modules[toProjectPath(id, root)] = {
				originalLength: renderedModule.originalLength,
				renderedLength: renderedModule.renderedLength
			};
		}
		chunks[fileName] = {
			dynamicImports: [...item.dynamicImports].sort(),
			facadeModule: item.facadeModuleId ? toProjectPath(item.facadeModuleId, root) : null,
			implicitlyLoadedBefore: [...item.implicitlyLoadedBefore].sort(),
			imports: [...item.imports].sort(),
			isDynamicEntry: item.isDynamicEntry,
			isEntry: item.isEntry,
			modules
		};
	}

	const entries = {};
	for (const [fileName, chunk] of Object.entries(chunks)) {
		if (!chunk.isEntry) continue;
		const staticChunks = collectStaticChunks(fileName, chunks);
		const dynamicEdges = [];
		for (const reachableFileName of staticChunks) {
			for (const target of chunks[reachableFileName].dynamicImports) {
				dynamicEdges.push({ from: reachableFileName, to: target });
			}
		}
		entries[fileName] = {
			dynamicEdges,
			facadeModule: chunk.facadeModule,
			staticChunks
		};
	}

	const assets = {};
	const unknownAssets = [];
	for (const fileName of Object.keys(bundle).sort()) {
		const item = bundle[fileName];
		if (item.type !== 'asset') continue;
		const emittedBy = deduplicateOrigins(
			(item.emittedBy || []).map(origin => ({
				module: origin.module ? toProjectPath(origin.module, root) : null,
				plugin: origin.plugin == null ? null : origin.plugin
			}))
		);
		const originModules = [...new Set(emittedBy.map(origin => origin.module).filter(Boolean))];
		const attributedTo = originModules.length === 1 ? originModules[0] : null;
		assets[fileName] = { attributedTo, emittedBy };
		if (attributedTo === null) {
			unknownAssets.push(fileName);
		}
	}

	const uniqueModules = new Map();
	for (const chunk of Object.values(chunks)) {
		for (const [id, lengths] of Object.entries(chunk.modules)) {
			if (!uniqueModules.has(id)) {
				uniqueModules.set(id, lengths);
			}
		}
	}
	let originalLength = 0;
	let renderedLength = 0;
	for (const lengths of uniqueModules.values()) {
		originalLength += lengths.originalLength;
		renderedLength += lengths.renderedLength;
	}

	return {
		assets,
		chunks,
		entries,
		notes: { renderedLength: RENDERED_LENGTH_NOTE },
		root,
		totals: {
			assets: Object.keys(assets).length,
			chunks: Object.keys(chunks).length,
			modules: uniqueModules.size,
			originalLength,
			renderedLength
		},
		unknownAssets,
		version: 1
	};
}

function collectStaticChunks(entryFileName, chunks) {
	const visited = new Set();
	const queue = [entryFileName];
	while (queue.length > 0) {
		const fileName = queue.shift();
		if (visited.has(fileName) || !chunks[fileName]) continue;
		visited.add(fileName);
		queue.push(...chunks[fileName].imports, ...chunks[fileName].implicitlyLoadedBefore);
	}
	return [...visited].sort();
}

function deduplicateOrigins(origins) {
	const seen = new Set();
	return origins.filter(origin => {
		const key = origin.plugin + '\0' + origin.module;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function toProjectPath(id, root) {
	if (id.includes('\0') || !path.isAbsolute(id)) {
		return id;
	}
	return path.relative(root, id).split(path.sep).join('/');
}

module.exports = { moduleOwnershipManifest };
