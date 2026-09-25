# chunk-dependency-budget

An optional Rollup plugin that enforces per-entry byte budgets on the **final output chunk graph**. For every entry chunk, it computes the strongly connected components (SCCs) of the static import graph and sums the UTF-8 byte size of every chunk that is synchronously reachable from that entry. Each chunk is counted exactly once per entry, no matter how many paths lead to it.

- **Synchronous budget**: only static `import` edges contribute to the budget. Cyclic chunk groups are compressed into strongly connected components first, so cyclic imports are counted once and reports never recurse endlessly.
- **Dynamic imports**: `import()` edges are listed separately per entry and never add to the synchronous byte total.
- **External modules**: externals are reported with a cost of `"unknown"` — they are never silently treated as zero bytes.
- **Final sizes**: sizes are measured as UTF-8 bytes of the final chunk code in `generateBundle` (registered with `order: 'post'`), so code added or removed by `renderChunk` post-processing of other plugins is reflected in the measurement.
- **Fails before writing**: the check runs in `generateBundle`, which Rollup invokes before anything is written to disk. A failed budget therefore leaves no new build artifacts behind.

## Usage

```js
// rollup.config.js
import { chunkDependencyBudget } from './plugins/chunk-dependency-budget/index.js';

export default {
	input: { app: 'src/app.js', admin: 'src/admin.js' },
	plugins: [
		chunkDependencyBudget({
			budgets: {
				app: 150_000, // keyed by entry name ...
				'src/admin.js': 200_000, // ... or facade module id ...
				default: 100_000 // ... with an optional fallback for all other entries
			},
			onReport(report, outputOptions) {
				console.log(JSON.stringify(report, null, 2));
			}
		})
	],
	output: { dir: 'dist', format: 'es' }
};
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `budgets` | `Record<string, number>` | Per-entry byte budgets. Keys are matched against the entry chunk name, then its facade module id, then its file name; `default` applies to all remaining entries. Entries without a matching budget are reported but never fail. |
| `onReport` | `(report, outputOptions) => void` | Optional hook called with the JSON-stable report for every output configuration, before any error is thrown. |
| `failOnError` | `boolean` (default `true`) | When `false`, budget violations are only reported via `onReport` and never fail the build. |

## Plugin hooks

- `generateBundle` (object hook with `order: 'post'`): builds the chunk graph from the final bundle, computes SCCs, measures UTF-8 byte sizes, evaluates budgets, emits the report via `onReport` and fails the build with a `CHUNK_BUDGET_EXCEEDED` error listing the exceeded amount and the largest contribution path per failing entry.
- `onReport` option callback: receives the deterministic, stably sorted report object. Running the same build repeatedly produces byte-identical `JSON.stringify` output, and multiple output configurations produce independent reports.

## Report format

```json
{
	"entries": [
		{
			"name": "app",
			"fileName": "app.js",
			"budget": 150000,
			"syncBytes": 120340,
			"exceededBy": 0,
			"status": "pass",
			"syncChunks": [
				{ "fileName": "app.js", "bytes": 40000, "component": "app.js" }
			],
			"dynamicChunks": ["lazy.js"],
			"externals": [{ "id": "react", "cost": "unknown" }],
			"heaviestPath": [
				{ "chunks": ["app.js"], "bytes": 40000 },
				{ "chunks": ["vendor-a.js", "vendor-b.js"], "bytes": 80340 }
			]
		}
	]
}
```

`heaviestPath` is the dependency path with the largest byte contribution. Cyclic chunk groups appear as a single component listing all member chunks (e.g. `["vendor-a.js", "vendor-b.js"]`), so the path is always finite.

## Demo

Requires a built `dist/` (`npm run build` or `npm run build:prepare`). Then, in well under 90 seconds:

```sh
npm run demo:chunk-budget
```

The demo builds two entries sharing one chunk plus one dynamic chunk three times and prints:

1. **PASS** — a generous budget passes and files are written to `demo/output/pass`.
2. **EXCEED** — a tiny budget fails with `CHUNK_BUDGET_EXCEEDED`, showing the exceeded byte count and the largest contribution path.
3. **DISK STATE** — the failed output directory contains no new artifacts, while the passing build's files remain on disk.
