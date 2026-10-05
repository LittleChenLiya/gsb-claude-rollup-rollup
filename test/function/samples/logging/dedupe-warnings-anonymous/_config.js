const assert = require('node:assert');
const { dedupeWarnings } = require('../../../../../dist/rollup');

const received = [];

module.exports = defineTest({
	description: 'dedupeWarnings uses the position-based identity of anonymous plugins',
	after() {
		// The anonymous plugin is the first entry in the plugins array, so rollup
		// normalizes its name to "at position 1". Two warnings from it merge by
		// that identity; a warning from the named plugin stays independent.
		assert.deepEqual(
			received.map(warning => ({ plugin: warning.plugin, count: warning.count })),
			[
				{ plugin: 'at position 1', count: 2 },
				{ plugin: 'named', count: 1 }
			]
		);
	},
	options: {
		onLog(level, log, defaultHandler) {
			if (level === 'warn') defaultHandler(level, log);
		},
		onwarn: dedupeWarnings(warning => {
			received.push(warning);
		}),
		plugins: [
			{
				// Anonymous plugin: no `name` property.
				buildStart() {
					const id = 'main.js';
					const loc = { file: id, line: 1, column: 0 };
					this.warn({ message: 'anon', code: 'TEST', id, loc });
					this.warn({ message: 'anon', code: 'TEST', id, loc });
				}
			},
			{
				name: 'named',
				buildStart() {
					const id = 'main.js';
					const loc = { file: id, line: 1, column: 0 };
					this.warn({ message: 'named', code: 'TEST', id, loc });
				}
			}
		]
	}
});
