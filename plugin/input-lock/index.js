const { createHash } = require('node:crypto');
const { existsSync, promises: fs, readFileSync } = require('node:fs');
const path = require('node:path');

const MANIFEST_VERSION = 1;

function hashContent(content) {
	return createHash('sha256').update(content).digest('hex');
}

function toPosixPath(filePath) {
	return filePath.replace(/\\/g, '/');
}

function getModuleKey(id, root) {
	if (path.isAbsolute(id)) {
		return toPosixPath(path.relative(root, id));
	}
	return id;
}

function getAssetKey(asset) {
	return asset.names.length > 0 ? asset.names[0] : asset.fileName;
}

function sortRecord(record) {
	return Object.fromEntries(
		[...record].sort(([firstKey], [secondKey]) =>
			firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0
		)
	);
}

function serializeManifest(modules, assets) {
	return (
		JSON.stringify(
			{
				assets: sortRecord(assets),
				modules: sortRecord(modules),
				version: MANIFEST_VERSION
			},
			null,
			2
		) + '\n'
	);
}

function formatInputList(inputs) {
	return inputs.map(input => `  - ${input}`).join('\n');
}

function formatViolationReport({ changed, extra, missing }) {
	const sections = [];
	if (missing.length > 0) {
		sections.push(
			`missing inputs (recorded in the manifest but not loaded):\n${formatInputList(missing)}`
		);
	}
	if (changed.length > 0) {
		sections.push(
			`changed inputs (loaded content does not match the manifest):\n${formatInputList(changed)}`
		);
	}
	if (extra.length > 0) {
		sections.push(
			`extra inputs (loaded but not recorded in the manifest):\n${formatInputList(extra)}`
		);
	}
	return `Input lock verification failed.\n${sections.join('\n')}`;
}

function inputLock(options = {}) {
	const { manifest = 'rollup-input-lock.json', mode = 'record', root = process.cwd() } = options;
	if (mode !== 'record' && mode !== 'verify') {
		throw new Error(`Invalid input lock mode "${mode}". Expected "record" or "verify".`);
	}
	const manifestPath = path.resolve(root, manifest);
	const recordedAssets = new Map();
	const recordedModules = new Map();
	const seenAssets = new Set();
	const seenModules = new Set();
	const changedAssets = [];
	const changedModules = [];
	const extraAssets = [];
	const extraModules = [];
	let expectedAssets = null;
	let expectedModules = null;
	let assetsVerified = false;
	let manifestWritten = false;

	function resetState() {
		recordedAssets.clear();
		recordedModules.clear();
		seenAssets.clear();
		seenModules.clear();
		changedAssets.length = 0;
		changedModules.length = 0;
		extraAssets.length = 0;
		extraModules.length = 0;
		assetsVerified = false;
		manifestWritten = false;
	}

	function compareInput(key, hash, expected, changedInputs, extraInputs) {
		if (!(key in expected)) {
			if (!extraInputs.includes(key)) extraInputs.push(key);
		} else if (expected[key] !== hash) {
			if (!changedInputs.includes(key)) changedInputs.push(key);
		}
	}

	async function writeManifest() {
		await fs.mkdir(path.dirname(manifestPath), { recursive: true });
		await fs.writeFile(manifestPath, serializeManifest(recordedModules, recordedAssets));
		manifestWritten = true;
	}

	return {
		buildEnd(error) {
			if (error || mode !== 'verify') return;
			const missingModules = Object.keys(expectedModules).filter(key => !seenModules.has(key));
			if (missingModules.length > 0 || changedModules.length > 0 || extraModules.length > 0) {
				this.error({
					code: 'INPUT_LOCK_VIOLATION',
					message: formatViolationReport({
						changed: changedModules,
						extra: extraModules,
						missing: missingModules
					})
				});
			}
		},

		buildStart() {
			resetState();
			if (mode !== 'verify') return;
			if (!existsSync(manifestPath)) {
				this.error({
					code: 'INPUT_LOCK_VIOLATION',
					message: `Input lock manifest not found at "${manifestPath}". Run a build with mode "record" first.`
				});
			}
			let parsed;
			try {
				parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
			} catch {
				this.error({
					code: 'INPUT_LOCK_VIOLATION',
					message: `Input lock manifest at "${manifestPath}" is not valid JSON.`
				});
			}
			if (
				!parsed ||
				parsed.version !== MANIFEST_VERSION ||
				typeof parsed.modules !== 'object' ||
				parsed.modules === null
			) {
				this.error({
					code: 'INPUT_LOCK_VIOLATION',
					message: `Input lock manifest at "${manifestPath}" has an unsupported format. Expected version ${MANIFEST_VERSION} with a "modules" record.`
				});
			}
			expectedModules = parsed.modules;
			expectedAssets =
				typeof parsed.assets === 'object' && parsed.assets !== null ? parsed.assets : {};
		},

		async closeBundle() {
			if (mode === 'record' && !manifestWritten) {
				await writeManifest();
			}
		},

		async generateBundle(_outputOptions, bundle) {
			for (const file of Object.values(bundle)) {
				if (file.type !== 'asset') continue;
				const key = getAssetKey(file);
				const hash = hashContent(file.source);
				if (mode === 'record') {
					if (!recordedAssets.has(key)) recordedAssets.set(key, hash);
				} else if (!assetsVerified) {
					seenAssets.add(key);
					compareInput(key, hash, expectedAssets, changedAssets, extraAssets);
				}
			}
			if (mode === 'record') {
				await writeManifest();
			} else if (!assetsVerified) {
				assetsVerified = true;
				const missingAssets = Object.keys(expectedAssets).filter(key => !seenAssets.has(key));
				if (missingAssets.length > 0 || changedAssets.length > 0 || extraAssets.length > 0) {
					this.error({
						code: 'INPUT_LOCK_VIOLATION',
						message: formatViolationReport({
							changed: changedAssets,
							extra: extraAssets,
							missing: missingAssets
						})
					});
				}
			}
		},

		name: 'input-lock',

		transform: {
			handler(code, id) {
				const key = getModuleKey(id, root);
				const hash = hashContent(code);
				if (mode === 'record') {
					if (!recordedModules.has(key)) recordedModules.set(key, hash);
				} else {
					seenModules.add(key);
					compareInput(key, hash, expectedModules, changedModules, extraModules);
				}
				return null;
			},
			order: 'pre'
		}
	};
}

module.exports = { inputLock };
module.exports.default = inputLock;
