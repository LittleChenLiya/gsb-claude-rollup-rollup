import path from 'node:path';

const toPosix = fileName => fileName.replaceAll('\\', '/');

// References are resolved against the directory of the referencing output
// file; bare names are already relative to the output root.
const resolveReference = (fromFileName, reference) => {
	const normalized = toPosix(reference);
	if (normalized.startsWith('./') || normalized.startsWith('../')) {
		return path.posix.normalize(
			path.posix.join(path.posix.dirname(toPosix(fromFileName)), normalized)
		);
	}
	return path.posix.normalize(normalized);
};

// Read-only pre-deployment artifact check: walks the final OutputChunk
// imports/dynamicImports/referencedFiles graph without re-parsing any
// JavaScript, fails the build on missing local references and reports
// per-entry reachable sets plus resources unreachable from any entry.
export default function artifactCheck({ failOnMissing = true, onReport } = {}) {
	return {
		name: 'artifact-check',
		generateBundle(outputOptions, bundle) {
			const outputDir = path.resolve(
				outputOptions.dir || (outputOptions.file ? path.dirname(outputOptions.file) : '.')
			);
			const emittedFiles = new Set(Object.keys(bundle).map(toPosix));

			const externals = [];
			for (const moduleId of this.getModuleIds()) {
				const moduleInfo = this.getModuleInfo(moduleId);
				if (moduleInfo && moduleInfo.isExternal) {
					externals.push(moduleId);
				}
			}
			externals.sort();

			const references = new Map();
			const missing = [];
			const externalIds = new Set(externals);
			for (const item of Object.values(bundle)) {
				if (item.type !== 'chunk') continue;
				const from = toPosix(item.fileName);
				const targets = [];
				const collect = (fileNames, kind) => {
					for (const fileName of fileNames) {
						// chunk.imports also lists external module ids; those are
						// excluded based on the actual module graph, never by
						// guessing from file names
						if (externalIds.has(fileName)) continue;
						const resolved = resolveReference(from, fileName);
						targets.push(resolved);
						if (!emittedFiles.has(resolved)) {
							missing.push({ file: resolved, from, kind });
						}
					}
				};
				collect(item.imports, 'imports');
				collect(item.dynamicImports, 'dynamicImports');
				collect(item.referencedFiles, 'referencedFiles');
				references.set(from, targets);
			}

			const entries = {};
			const reachableFromAnyEntry = new Set();
			for (const item of Object.values(bundle)) {
				if (item.type !== 'chunk' || !item.isEntry) continue;
				const entryName = toPosix(item.fileName);
				const reachable = new Set([entryName]);
				const queue = [entryName];
				while (queue.length > 0) {
					const current = queue.shift();
					for (const target of references.get(current) || []) {
						if (!reachable.has(target)) {
							reachable.add(target);
							queue.push(target);
						}
					}
				}
				for (const fileName of reachable) reachableFromAnyEntry.add(fileName);
				entries[entryName] = {
					missing: missing.filter(({ from }) => reachable.has(from)),
					reachable: [...reachable].sort()
				};
			}

			const orphans = [...emittedFiles].filter(fileName => !reachableFromAnyEntry.has(fileName)).sort();

			const report = { entries, externals, missing, ok: missing.length === 0, orphans, outputDir };
			if (onReport) onReport(report);

			if (missing.length > 0 && failOnMissing) {
				this.error(
					`[artifact-check] ${missing.length} missing local artifact reference(s):\n` +
						missing
							.map(({ file, from, kind }) => `  - chunk "${from}" references missing file "${file}" via ${kind}`)
							.join('\n')
				);
			}
		}
	};
}
