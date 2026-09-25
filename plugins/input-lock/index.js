'use strict';

const { createHash } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const MANIFEST_VERSION = 1;
const DEFAULT_MANIFEST_NAME = 'rollup.input-lock.json';
const DEFAULT_ALGORITHM = 'sha256';

function toPosixPath(filePath) {
	return filePath.split(path.sep).join('/');
}

// Virtual modules use a stable logical id (the id the providing plugin returns
// from resolveId, with the conventional \0 prefix stripped). Local modules are
// keyed by their project-relative path so the manifest is portable across
// absolute checkout locations.
function toInputKey(id, root) {
	const cleanId = id.replace(/\0/g, '');
	if (!path.isAbsolute(cleanId)) {
		return toPosixPath(cleanId);
	}
	return toPosixPath(path.relative(root, cleanId));
}

function hashContent(algorithm, content) {
	return createHash(algorithm).update(content).digest('hex');
}

function formatViolationReport(violations) {
	const lines = ['Input lock verification failed.'];
	const append = (label, keys) => {
		if (keys.length > 0) {
			lines.push(label + ':', ...keys.map(key => '  - ' + key));
		}
	};
	append('Missing inputs (listed in the manifest but not loaded)', violations.missing);
	append('Changed inputs (content differs from the manifest)', violations.changed);
	append('Extra inputs (loaded but not listed in the manifest)', violations.extra);
	return lines.join('\n');
}

function inputLock(options = {}) {
	const {
		algorithm = DEFAULT_ALGORITHM,
		includeAssets = true,
		manifest = DEFAULT_MANIFEST_NAME,
		mode = 'generate',
		root = process.cwd()
	} = options;

	if (mode !== 'generate' && mode !== 'verify') {
		throw new Error(
			'rollup-plugin-input-lock: Invalid mode "' + mode + '", expected "generate" or "verify".'
		);
	}

	const manifestPath = path.isAbsolute(manifest) ? manifest : path.resolve(root, manifest);

	let expectedInputs = null;
	let recordedInputs;
	let seenInputs;
	let changedInputs;
	let extraInputs;
	let settled;

	const recordInput = (key, digest) => {
		if (mode === 'generate') {
			recordedInputs.set(key, digest);
			return;
		}
		seenInputs.add(key);
		const expected = expectedInputs.get(key);
		if (expected === undefined) {
			extraInputs.push(key);
		} else if (expected !== digest) {
			changedInputs.push(key);
		}
	};

	return {
		buildStart() {
			recordedInputs = new Map();
			seenInputs = new Set();
			changedInputs = [];
			extraInputs = [];
			settled = false;
			if (mode === 'verify') {
				if (!existsSync(manifestPath)) {
					this.error(
						'rollup-plugin-input-lock: Cannot verify, manifest not found at "' +
							manifestPath +
							'". Run a build with mode: "generate" first.'
					);
				}
				const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
				if (parsed.version !== MANIFEST_VERSION) {
					this.error(
						'rollup-plugin-input-lock: Unsupported manifest version ' +
							parsed.version +
							' in "' +
							manifestPath +
							'", expected ' +
							MANIFEST_VERSION +
							'.'
					);
				}
				if (parsed.algorithm !== algorithm) {
					this.error(
						'rollup-plugin-input-lock: Manifest "' +
							manifestPath +
							'" uses algorithm "' +
							parsed.algorithm +
							'" but the plugin is configured with "' +
							algorithm +
							'".'
					);
				}
				expectedInputs = new Map(Object.entries(parsed.inputs));
			}
		},

		generateBundle(outputOptions, bundle) {
			if (includeAssets) {
				for (const [fileName, output] of Object.entries(bundle)) {
					if (output.type === 'asset') {
						recordInput(
							'asset:' + (output.name || fileName),
							hashContent(algorithm, output.source)
						);
					}
				}
			}
			// Modules are transformed once per build and shared by all outputs, so
			// the manifest is written/verified exactly once at the first output.
			if (settled) {
				return;
			}
			settled = true;
			if (mode === 'generate') {
				const inputs = Object.fromEntries(
					[...recordedInputs.entries()].sort(([first], [second]) => (first < second ? -1 : 1))
				);
				writeFileSync(
					manifestPath,
					JSON.stringify({ algorithm, inputs, version: MANIFEST_VERSION }, null, 2) + '\n'
				);
			} else {
				const missingInputs = [...expectedInputs.keys()].filter(key => !seenInputs.has(key));
				if (missingInputs.length > 0 || changedInputs.length > 0 || extraInputs.length > 0) {
					this.error({
						code: 'INPUT_LOCK_VIOLATION',
						message: formatViolationReport({
							changed: changedInputs.sort(),
							extra: extraInputs.sort(),
							missing: missingInputs.sort()
						})
					});
				}
			}
		},

		name: 'rollup-plugin-input-lock',

		// Runs after all load hooks and, when this plugin is placed first in the
		// plugins array, before any other transform hook, so the digest covers
		// exactly what plugins provided via load.
		transform(code, id) {
			recordInput(toInputKey(id, root), hashContent(algorithm, code));
			return null;
		}
	};
}

module.exports = inputLock;
module.exports.default = inputLock;
module.exports.MANIFEST_VERSION = MANIFEST_VERSION;
