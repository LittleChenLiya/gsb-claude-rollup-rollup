export function start() {
	return import('./x.js');
}
console.log('circular main');
