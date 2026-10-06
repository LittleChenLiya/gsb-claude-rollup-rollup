# Asset file rename tests

Local, self-contained Node tests for the explicit asset rename plan
(`output.assetFileRenames`, see `docs/configuration-options/index.md#output-assetfilerenames`
for the rename scope documentation).

- `unit.test.mjs` exercises the rename plan logic in
  `src/utils/assetFileRenames.ts` directly (plan validation, duplicate target
  and collision detection, merge handling, source map rename restrictions).
  It registers `ts-extension-loader.mjs`, a small resolution hook that allows
  importing Rollup's extensionless TypeScript sources in Node.
- `integration.test.mjs` runs real in-memory Rollup builds against
  `dist/rollup.js` and verifies that renamed assets keep all tracked
  references (`import.meta.ROLLUP_FILE_URL_*`, chunk `referencedFiles`,
  source map file name relations) loadable, that conflicting plans are
  rejected without publishing a new bundle, and that unknown references are
  reported as unsupported.

## Running

```sh
npm run build:cjs   # once, to produce dist/rollup.js for the integration tests
node --test test/asset-file-renames/
```

The unit tests import TypeScript sources directly and therefore require a
Node version with type stripping (Node >= 22.6) as well as installed
dependencies (`locate-character` is imported transitively via
`src/utils/logs.ts`).
