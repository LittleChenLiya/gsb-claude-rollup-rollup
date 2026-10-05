/**
 * Demo: dedupeWarnings.
 *
 * Runs a small rollup build whose plugin emits the same warning several times
 * at the same location, plus a few distinct warnings. Without `dedupeWarnings`
 * every occurrence would be forwarded to `onwarn`; with it, each distinct
 * warning is forwarded once and its `count` reflects how often it was emitted.
 *
 * Run from the repository root after building:
 *   npm run build:js
 *   node scripts/dedupe-warnings-demo.mjs
 */
import { dedupeWarnings, rollup } from '../dist/rollup.js';

const warnings = [];

const bundle = await rollup({
	input: 'virtual:entry',
	onwarn: dedupeWarnings(warning => warnings.push(warning)),
	plugins: [
		{
			load(id) {
				return id === 'virtual:entry' ? 'export default 1;' : null;
			},
			name: 'demo',
			resolveId(id) {
				return id === 'virtual:entry' ? id : null;
			},
			transform(code, id) {
				const loc = { column: 0, file: id, line: 1 };
				// Same location, same code, same plugin: three occurrences -> count 3
				this.warn({ code: 'TEST', id, loc, message: 'repeated warning' });
				this.warn({ code: 'TEST', id, loc, message: 'repeated warning' });
				this.warn({ code: 'TEST', id, loc, message: 'repeated warning' });
				// Different location: independent even though text and code match
				this.warn({
					code: 'TEST',
					id,
					loc: { column: 0, file: id, line: 2 },
					message: 'repeated warning'
				});
				// No location, same text twice: conservative identity merges them
				this.warn({ code: 'TEST', id, message: 'location-less warning' });
				this.warn({ code: 'TEST', id, message: 'location-less warning' });
				// No location, different text: conservative identity keeps it independent
				this.warn({ code: 'TEST', id, message: 'another location-less warning' });
				return null;
			}
		}
	]
});

await bundle.generate({ format: 'es' });

console.log(`onwarn was called ${warnings.length} time(s) for distinct warnings:`);
for (const warning of warnings) {
	const where = warning.loc
		? `${warning.loc.file}:${warning.loc.line}:${warning.loc.column}`
		: '(no location)';
	console.log(`  [count ${warning.count}] ${where}  ${warning.message}`);
}
