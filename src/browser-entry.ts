import pkg from '../package.json' with { type: 'json' };

export const VERSION = pkg.version;
export { default as moduleManifest } from './plugins/moduleManifest';
export { defineConfig, default as rollup } from './rollup/rollup';
