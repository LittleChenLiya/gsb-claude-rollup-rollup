const assert = require('node:assert');
const { dedupeWarnings } = require('../../../../../dist/rollup');

const received = [];

module.exports = defineTest({
	description: 'dedupeWarnings merges repeated warnings and counts occurrences',
	after() {
		// Five distinct warnings in first-occurrence order:
		// 1. alpha @ line 1 (emitted 3 times) -> count 3
		// 2. alpha @ line 2 (different location) -> count 1
		// 3. alpha without location, text "noloc" (emitted 2 times) -> count 2
		// 4. alpha without location, text "other" -> count 1
		// 5. beta @ line 1 (different plugin) -> count 1
		assert.deepEqual(
			received.map(warning => ({
				plugin: warning.plugin,
				line: warning.loc ? warning.loc.line : null,
				count: warning.count
			})),
			[
				{ plugin: 'alpha', line: 1, count: 3 },
				{ plugin: 'alpha', line: 2, count: 1 },
				{ plugin: 'alpha', line: null, count: 2 },
				{ plugin: 'alpha', line: null, count: 1 },
				{ plugin: 'beta', line: 1, count: 1 }
			]
		);
	},
	options: {
		// The test runner always supplies its own `onLog`, which shadows `onwarn`.
		// Forward warnings to the default handler so the wrapped `onwarn` runs.
		onLog(level, log, defaultHandler) {
			if (level === 'warn') defaultHandler(level, log);
		},
		onwarn: dedupeWarnings(warning => {
			received.push(warning);
		}),
		plugins: [
			{
				name: 'alpha',
				buildStart() {
					const id = 'main.js';
					const loc = { file: id, line: 1, column: 0 };
					// Same location, same code, same plugin: three occurrences -> count 3
					this.warn({ message: 'same', code: 'TEST', id, loc });
					this.warn({ message: 'same', code: 'TEST', id, loc });
					this.warn({ message: 'same', code: 'TEST', id, loc });
					// Different location: independent even though text and code match
					this.warn({ message: 'same', code: 'TEST', id, loc: { file: id, line: 2, column: 0 } });
					// No location, same text twice: conservative identity merges them
					this.warn({ message: 'noloc', code: 'TEST', id });
					this.warn({ message: 'noloc', code: 'TEST', id });
					// No location, different text: conservative identity keeps it independent
					this.warn({ message: 'other', code: 'TEST', id });
				}
			},
			{
				name: 'beta',
				buildStart() {
					const id = 'main.js';
					const loc = { file: id, line: 1, column: 0 };
					// Same location and code as alpha, but a different plugin: independent
					this.warn({ message: 'same', code: 'TEST', id, loc });
				}
			}
		]
	}
});
