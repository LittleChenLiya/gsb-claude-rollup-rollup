import { readFileSync } from 'node:fs';
import leftPad from 'left-pad';

export const read = readFileSync;
export const pad = leftPad;
