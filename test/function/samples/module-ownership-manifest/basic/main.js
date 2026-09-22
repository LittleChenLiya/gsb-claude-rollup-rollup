import { shared } from './shared.js';

export const loadDynamic = () => import('./dynamic.js');
export const result = shared;
