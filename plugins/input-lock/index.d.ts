import type { Plugin } from 'rollup';

export interface InputLockOptions {
	/** Hash algorithm passed to node:crypto createHash. Defaults to "sha256". */
	algorithm?: string;
	/** Whether emitted assets are locked as well. Defaults to true. */
	includeAssets?: boolean;
	/** Manifest path, resolved against root unless absolute. Defaults to "rollup.input-lock.json". */
	manifest?: string;
	/** "generate" writes the manifest, "verify" checks the build against it. Defaults to "generate". */
	mode?: 'generate' | 'verify';
	/** Project root that local module paths are made relative to. Defaults to process.cwd(). */
	root?: string;
}

export declare const MANIFEST_VERSION: number;

declare function inputLock(options?: InputLockOptions): Plugin;

export default inputLock;
