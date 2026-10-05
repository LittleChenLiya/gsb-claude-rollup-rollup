import pkg from '../package.json' with { type: 'json' };

export const VERSION = pkg.version;
export { defineConfig, default as rollup } from './rollup/rollup';
export { dedupeWarnings } from './utils/dedupeWarnings';
export { default as watch } from './watch/watch-proxy';
