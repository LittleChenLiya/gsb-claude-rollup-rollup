import { shared } from './shared.js';

export function loadOneLazy() {
	return import('./one-lazy.js');
}

console.log('entry one', shared);
