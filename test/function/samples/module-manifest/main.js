import { shared } from './shared.js';

export const result = shared;

export function loadDynamic() {
	return import('./dynamic.js').then(({ dynamic }) => dynamic);
}
