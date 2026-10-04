# artifact-check

Read-only pre-deployment artifact check plugin. It validates that every local
artifact reference in the final output is complete and reports which resources
are unreachable from the entries.

The plugin never modifies the bundle: it does not re-parse JavaScript to guess
dependencies, it does not emit files and it does not delete orphaned resources.

## What it checks

In `generateBundle` it walks the final `OutputChunk` graph using only
`imports`, `dynamicImports` and `referencedFiles`:

- Every referenced local file must exist in the emitted bundle. Reference
  paths are resolved against the directory of the referencing output file
  (`./` / `../`) or the output root (bare names). Any missing local reference
  fails the build via `this.error`, naming the source chunk and the missing
  file. A missing local chunk is always a failure — it is never silently
  treated as external.
- External dependencies are taken from the actual module graph
  (`getModuleInfo(id).isExternal`), not from the output file names, and are
  excluded from the local-reference check. This matters because
  `OutputChunk.imports` also lists external module ids; only ids the module
  graph marks as external are skipped, so a missing local chunk can never
  masquerade as an external.
- Breadth-first traversal from each entry chunk (`isEntry`) yields one
  reachable set per entry; visited tracking makes circular references
  terminate normally.
- Emitted files not reachable from any entry are reported as `orphans` but
  are left untouched.

## Options

- `failOnMissing` (default `true`): error the build when a local reference is
  missing. When `false`, the failure is only visible in the report.
- `onReport(report)`: receives the closure report after each generate.

## Closure report format

`report.sample.json` contains a real report produced by building the
two-entry fixture:

```json
{
	"ok": true,
	"outputDir": "<absolute path of the output directory>",
	"entries": {
		"entry.js": {
			"reachable": ["assets/asset-<hash>.txt", "chunks/lazy-<hash>.js", "entry.js"],
			"missing": []
		}
	},
	"externals": ["left-pad", "node:fs"],
	"orphans": ["assets/unused-<hash>.txt"],
	"missing": [{ "from": "entry.js", "file": "assets/asset-<hash>.txt", "kind": "referencedFiles" }]
}
```

- `ok`: `true` when no local reference is missing.
- `outputDir`: absolute output directory that reference paths resolve against.
- `entries`: one key per entry chunk; `reachable` is the sorted set of emitted
  files reachable from that entry, `missing` the missing references
  originating from chunks in that entry's closure.
- `externals`: sorted external module ids from the real module graph.
- `orphans`: sorted emitted files unreachable from every entry (never
  deleted).
- `missing`: every missing local reference with the referencing chunk
  (`from`), the missing emitted file (`file`) and the reference `kind`
  (`imports` | `dynamicImports` | `referencedFiles`).

## Running the fixture tests

```sh
npm install
npm test
```

The tests only build the small fixtures under `fixtures/` (in memory, no
repository-wide build) using the npm `rollup` package:

- basic closure: entry + dynamic chunk + referenced asset all in the closure;
- a saboteur plugin deleting the emitted asset / the dynamic chunk makes the
  check fail, locating the source chunk and the missing file;
- circular dynamic imports terminate;
- two entries produce separate reachable sets over a shared chunk;
- externals are listed from the actual module graph.
