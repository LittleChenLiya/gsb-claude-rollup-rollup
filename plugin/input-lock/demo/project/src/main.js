import { message } from 'virtual:message';
import { dependency } from './dependency.js';

export async function run() {
	const { lazy } = await import('./lazy.js');
	return `${message} ${dependency} ${lazy}`;
}
