import { buildInfo } from 'virtual:build-info';
import { answer } from './dependency.js';

export async function run() {
	const { lazy } = await import('./lazy.js');
	console.log(answer, buildInfo, lazy);
}
