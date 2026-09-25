# Rollup Input Lock Plugin

An optional Rollup plugin that locks the inputs of a build. When recording, it collects a content digest of every input that actually participates in the compilation — local modules loaded from disk, virtual modules provided by plugins, and emitted static assets — and writes a stable manifest. When verifying, a later build is checked against that manifest and fails if any input is missing, changed, or unexpected.

## Usage

```js
// rollup.config.js
import { inputLock } from './plugin/input-lock/index.js';

export default {
	input: 'src/main.js',
	output: { dir: 'dist', format: 'es' },
	plugins: [inputLock({ mode: 'record' })]
};
```

- `mode: 'record'` (default) writes the manifest after the build.
- `mode: 'verify'` checks the build against the existing manifest and aborts the build on the first violation report. A failed verification prevents any bundle from being written for that build.

### Options

| Option | Default | Description |
| --- | --- | --- |
| `manifest` | `'rollup-input-lock.json'` | Manifest file path, resolved against `root`. |
| `mode` | `'record'` | `'record'` to write the manifest, `'verify'` to check it. |
| `root` | `process.cwd()` | Project root that module paths are made relative to. |

Place the plugin first in your `plugins` array so it observes module content before other plugins transform it.

## How inputs are captured

Modules are hashed in a pre-order `transform` hook. At that point every `load` hook has already run — including plugin `load` hooks that provide virtual modules — and no `transform` hook has modified the code yet. The plugin therefore hashes what actually enters the compilation, not just what sits on disk. Emitted assets are hashed from their final `source` in `generateBundle`.

When a build has several outputs, all outputs share a single input record: modules are recorded once, and assets are deduplicated by name across outputs.

## Manifest protocol

The manifest is a JSON document with sorted keys, two-space indentation and a trailing newline, so it is byte-stable across repeated builds and independent of the absolute directory the project lives in:

```json
{
	"assets": {
		"logo.txt": "93bc4d91…"
	},
	"modules": {
		"\u0000virtual:message": "181c42b3…",
		"src/main.js": "aa06d8d8…"
	},
	"version": 1
}
```

- `version` is the manifest format version, currently `1`.
- `modules` maps a module key to the SHA-256 hex digest of its post-`load` content. The key is the project-relative POSIX path for modules loaded from disk, or the stable logical id provided by the resolving plugin for virtual modules (for example `\0virtual:message`).
- `assets` maps the asset's emitted `name` to the SHA-256 hex digest of its final source.

## Verification errors

Verification reports the three violation categories separately in a single error with `pluginCode` `'INPUT_LOCK_VIOLATION'`:

- **missing inputs** — recorded in the manifest but not loaded by the build
- **changed inputs** — loaded, but the content digest differs from the manifest
- **extra inputs** — loaded by the build but not recorded in the manifest

```text
Input lock verification failed.
missing inputs (recorded in the manifest but not loaded):
  - src/old-module.js
changed inputs (loaded content does not match the manifest):
  -  virtual:message
extra inputs (loaded but not recorded in the manifest):
  - src/new-module.js
```

Because the error is raised during the build (modules) or output generation (assets), no bundle is written for a rejected build.

## Demo

```sh
node plugin/input-lock/demo/run-demo.mjs
```

The demo records a manifest for a small project (disk modules, a virtual module, a dynamic import and an emitted asset), verifies an unchanged build, then tampers with the virtual module content and shows the build being rejected with the logical module id in the report. It finishes in a few seconds and cleans up all generated files.

## Tests

```sh
npx mocha test/misc/index.js --grep input-lock
```
