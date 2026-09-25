---
title: Locking Build Inputs
---

# {{ $frontmatter.title }}

[[toc]]

Rollup ships an optional input lock plugin in `plugin/input-lock/` of the repository. It records a content digest of every input that participates in a build — local modules, virtual modules provided by plugins, and emitted static assets — into a stable manifest, and can later verify that a build still uses exactly those inputs.

## Recording a manifest

```js
// rollup.config.js
import { inputLock } from './plugin/input-lock/index.js';

export default {
	input: 'src/main.js',
	output: { dir: 'dist', format: 'es' },
	plugins: [inputLock({ mode: 'record' })]
};
```

The recorded manifest (default `rollup-input-lock.json`) is a JSON document with sorted keys that maps project-relative module paths, stable logical ids of virtual modules, and asset names to SHA-256 content digests. Because only relative paths and logical ids are recorded, the manifest is byte-identical across repeated builds and across different absolute checkouts of the same project.

Modules are hashed after all `load` hooks have run and before any `transform` hook modifies the code, so the digest always covers the content that actually enters the compilation — including virtual modules that only exist in a plugin — and never just the file on disk.

## Verifying a build

```js
plugins: [inputLock({ mode: 'verify' })];
```

In verify mode, the build fails with an `INPUT_LOCK_VIOLATION` error when the loaded inputs do not match the manifest, and no bundle is written for the rejected build. Violations are reported in three separate categories:

- **missing inputs** — recorded in the manifest but not loaded by the build
- **changed inputs** — loaded, but the content digest differs from the manifest
- **extra inputs** — loaded by the build but not recorded in the manifest

When a build has several outputs, all of them share a single input record.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `manifest` | `'rollup-input-lock.json'` | Manifest file path, resolved against `root`. |
| `mode` | `'record'` | `'record'` to write the manifest, `'verify'` to check it. |
| `root` | `process.cwd()` | Project root that module paths are made relative to. |

See the README in `plugin/input-lock/` for the full manifest protocol and a runnable demo (`node plugin/input-lock/demo/run-demo.mjs`) that records a manifest, verifies an unchanged build, and rejects a tampered input.
