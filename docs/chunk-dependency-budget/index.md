---
title: Chunk Dependency Budgets
---

# {{ $frontmatter.title }}

[[toc]]

Rollup ships an optional `chunkDependencyBudget` plugin that checks, for each entry point, how many bytes of code a user has to download and parse before the entry can start executing. It inspects the final output chunk graph, so everything other plugins did to the code is already accounted for.

```js
// rollup.config.js
import { chunkDependencyBudget } from 'rollup';

export default {
	input: ['src/main.js', 'src/admin.js'],
	output: { dir: 'dist', format: 'es' },
	plugins: [
		chunkDependencyBudget({
			budgets: {
				main: 50_000,
				admin: 120_000
			}
		})
	]
};
```

## What is measured

For every entry chunk, the plugin walks the graph of **statically** imported chunks and sums their sizes. Sizes are the UTF-8 byte counts of the final generated code, i.e. after all `renderChunk` hooks of other plugins have run. The details:

- **Each chunk is counted once**, even if it is reachable via several import paths or shared between entries.
- **Circular chunk imports** are compressed into strongly connected components first. A cycle of chunks is counted once as a single component, and report paths never recurse into a cycle.
- **Dynamic `import()` edges** do not contribute to the synchronous total. They are listed separately per entry under `dynamicImports`.
- **External modules** are not counted as zero cost. They are listed under `externalImports` to mark that their cost is unknown to this build.
- **Entries without a configured budget** are still analyzed and reported with `status: "unchecked"`.

## When the check runs

The plugin only uses the [`generateBundle`](../plugin-development/index.md#generatebundle) hook. At that point, all chunk post-processing (`renderChunk`) has finished, but nothing has been written to disk yet. If a budget is exceeded, the plugin throws an error with `pluginCode: "CHUNK_BUDGET_EXCEEDED"`, which aborts the build before any output file of the failed build is created.

## Options

### budgets

Type: `Record<string, number>`

Maps entry chunk names (the `name` of the entry, e.g. `main` for `input: 'src/main.js'` or the key used in an object `input`) to the maximum allowed number of synchronously reachable UTF-8 bytes.

### onReport

Type: `(report: ChunkDependencyBudgetReport, outputOptions: OutputOptions) => void`

Called once per generated output with the full analysis, also when all budgets pass. When one build generates several outputs, each output gets its own independent report. The report is deterministic: entries, components, dynamic imports and external imports are sorted, so serializing it with `JSON.stringify` yields a stable result across repeated checks of the same build.

```ts
interface ChunkDependencyBudgetReport {
	entries: ChunkDependencyBudgetEntryReport[];
}

interface ChunkDependencyBudgetEntryReport {
	entry: string;
	fileName: string;
	budget: number | null;
	status: 'pass' | 'fail' | 'unchecked';
	totalBytes: number;
	exceededBy: number;
	components: { id: string; chunks: string[]; bytes: number }[];
	dynamicImports: { fileName: string; bytes: number }[];
	externalImports: string[];
	largestContribution: { path: string[]; bytes: number } | null;
}
```

## Failure output

When a budget is exceeded, the error message names every failing entry, by how many bytes it exceeds its budget, and the dependency path that contributes the most bytes. Circular chunks appear as a single combined component in such paths:

```text
Chunk dependency budget exceeded for 1 entry:
- "main" (main.js): 262 synchronously reachable bytes exceed the budget of 120 by 142 bytes. Largest contribution: main.js (187 bytes).
```

The full report is also available on the error via `error.meta.report`.

## Trying it out

After building Rollup (`npm run build:quick`), this repository contains a self-contained demo that runs a passing and a failing build and shows the on-disk state afterwards:

```shell
node scripts/demo-chunk-dependency-budget.mjs
```
