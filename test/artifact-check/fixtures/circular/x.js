export const x = 'x';
export function next() {
	return import('./y.js');
}
