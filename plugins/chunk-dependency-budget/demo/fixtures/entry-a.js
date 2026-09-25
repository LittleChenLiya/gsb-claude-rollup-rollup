import { sharedValue } from './shared.js';
export const valueA = sharedValue + '-a';
export const loadLazy = () => import('./lazy.js');
