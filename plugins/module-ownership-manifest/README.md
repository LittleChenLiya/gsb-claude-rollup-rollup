# rollup-plugin-module-ownership-manifest

An optional Rollup plugin that emits a **module ownership manifest** for each output: a JSON document describing which modules ended up in which chunks, how chunks reference each other, and which modules the assets emitted through the plugin API belong to.

## Usage

```js
const {
	moduleOwnershipManifest
} = require('rollup/plugins/module-ownership-manifest');

module.exports = {
	input: 'src/main.js',
	plugins: [moduleOwnershipManifest()],
	output: {
		dir: 'dist',
		format: 'es'
	}
};
```

### Options

- `fileName` (`string | (outputOptions) => string`, default `"module-manifest.json"`): file name of the emitted manifest asset. When several outputs write to the same directory, pass a function to give each output its own manifest name.
- `root` (`string`, default `process.cwd()`): project root. Module ids are reported relative to this directory. Virtual module ids (containing a null byte) and other non-absolute ids are kept verbatim so they remain recognizable.

## Manifest format

The manifest is generated in `generateBundle`, i.e. **after all final file names — including hashes — are known**, and only references final output file names. The manifest asset itself is emitted only after the manifest was computed, so it never lists itself, and because it is an asset with a fixed file name it cannot participate in chunk hash cycles. Each output gets its own independent manifest; no state is shared between outputs or rebuilds, so modules removed in a watch rebuild do not leave stale records behind.

- `version`: manifest format version, currently `1`.
- `root`: absolute project root that module paths are relative to.
- `notes.renderedLength`: the `renderedLength` caveat, kept next to the data.
- `entries`: maps every entry chunk file name to
  - `facadeModule`: project-relative id of the entry module.
  - `staticChunks`: transitive closure of statically reachable chunks (via `imports` and `implicitlyLoadedBefore`), including the entry itself.
  - `dynamicEdges`: dynamic import edges `{ from, to }` leaving the statically reachable chunks, using final output file names.
- `chunks`: maps every chunk file name to
  - `facadeModule`, `isEntry`, `isDynamicEntry`.
  - `imports` / `dynamicImports` / `implicitlyLoadedBefore`: final file names of referenced chunks.
  - `modules`: maps the project-relative id of each module in the chunk to its lengths (see below).
- `assets`: maps every asset file name to
  - `attributedTo`: project-relative id of the module the asset was emitted from via `this.emitFile`, or `null` when the origin is unknown or ambiguous.
  - `emittedBy`: raw provenance records `{ plugin, module }` reported by Rollup core.
- `unknownAssets`: file names of assets that could not be attributed to a single module. Assets are **never matched to modules by file name** — two files that happen to share a name are still treated as different resources; when in doubt, an asset lands in this list.
- `totals`: `{ chunks, assets, modules, originalLength, renderedLength }` summed over unique modules, so chunks shared between several entries are not counted twice.

### Module length fields

- `originalLength`: length of the original module source as loaded, before transformations are taken into account.
- `renderedLength`: length of the module's rendered code in the final chunk. **This is not the minified or compressed (e.g. gzipped) size.** It is measured before any minifier or compressor runs and must not be used for precise compressed-size attribution.

## Demo

From the repository root (requires `dist` to be built, e.g. via `npm run build:quick`):

```sh
npm run demo:module-manifest
```

This builds a small fixture — two entries sharing a module, one dynamic module, and an asset emitted via `this.emitFile` — then modifies and removes the dynamic module, builds again, and prints the difference between the two manifests. It completes in a few seconds.
