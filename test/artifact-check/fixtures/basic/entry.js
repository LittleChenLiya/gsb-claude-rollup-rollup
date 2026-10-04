import assetUrl from './asset.txt';

export const url = assetUrl;

export function loadLazy() {
	return import('./lazy.js');
}

console.log('basic entry', url);
