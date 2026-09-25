# rollup-plugin-input-lock

Locks the inputs of a Rollup build: during a normal build it records a content digest of every module and asset that actually participates in the compilation and writes a stable manifest. In verify mode, a later build is checked against that manifest and fails — without writing any bundle — if the inputs differ.

## Usage

```js
// rollup.config.js
const inputLock = require('rollup-plugin-input-lock');

module.exports = {
	input: 'src/main.js',
	plugins: [
		// place first so the lock runs after all load hooks but before any
		// other plugin's transform hook
		inputLock({ mode: process.env.LOCK_MODE || 'generate' })
	],
	output: { dir: 'dist', format: 'es' }
};
```

- `LOCK_MODE=generate rollup -c` — builds and (re)writes `rollup.input-lock.json`.
- `LOCK_MODE=verify rollup -c` — builds and fails if any input is missing, changed, or unexpected. No output is written on failure.

Try it via `node plugins/input-lock/demo.js`, which generates a manifest, verifies an unchanged build, and shows a tampered virtual module being rejected in a few seconds.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `mode` | `'generate'` | `'generate'` writes the manifest, `'verify'` checks against it. |
| `manifest` | `'rollup.input-lock.json'` | Manifest path, resolved against `root` unless absolute. |
| `root` | `process.cwd()` | Project root that local module paths are made relative to. |
| `algorithm` | `'sha256'` | Digest algorithm (any `node:crypto` hash). |
| `includeAssets` | `true` | Whether emitted assets are locked as well. |

## Locking semantics

The digest is taken in the plugin's `transform` hook, i.e. **after** all `load` hooks have produced the module source and **before** any other plugin transforms it (place the plugin first in the `plugins` array). This means the lock covers what plugins provide — virtual modules, generated code — and not merely what happens to be on disk. Emitted assets are locked from the final bundle in `generateBundle`.

Modules are transformed once per build even with multiple outputs, so all outputs of a build share a single input record and the manifest is written or verified exactly once, at the first output.

## Manifest protocol

The manifest is deterministic: keys are sorted, JSON is indented with two spaces, and identical inputs always produce a byte-identical file.

```json
{
	"algorithm": "sha256",
	"inputs": {
		"asset:logo.svg": "<hex digest>",
		"src/main.js": "<hex digest>",
		"virtual:build-info": "<hex digest>"
	},
	"version": 1
}
```

Input keys:

- **Local modules** — the project-relative POSIX path (`src/main.js`), so the manifest is portable across different absolute checkout directories.
- **Virtual modules** — the stable logical id the providing plugin returns from `resolveId`, with the conventional `\0` prefix stripped (`\0virtual:build-info` becomes `virtual:build-info`). Any resolved id that is not an absolute file system path is treated as a logical id and recorded verbatim, so plugins must return stable, content-independent ids.
- **Assets** — `asset:` plus the asset `name` given to `emitFile` (`asset:logo.svg`), which is stable even when the emitted file name contains a content hash.

## Verification failures

Verification fails with an `INPUT_LOCK_VIOLATION` error (exposed as `pluginCode` on the thrown error) whose message groups the problems into:

- **Missing inputs** — listed in the manifest but not loaded by this build.
- **Changed inputs** — loaded, but the content digest differs.
- **Extra inputs** — loaded but not listed in the manifest.

Because the error is raised during output generation, a failed verification prevents any bundle of this build from being written.
