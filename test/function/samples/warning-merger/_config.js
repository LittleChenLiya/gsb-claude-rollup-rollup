const assert = require('node:assert');
const { mergeWarnings } = require('../../../../dist/rollup');

const received = [];
let handlerCalls = 0;

module.exports = defineTest({
	description:
		'mergeWarnings merges warnings by code, module id, position and plugin, keeping count',
	options: {
		// forward all logs to the default handler so that "onwarn" is invoked
		onLog: (level, log, defaultHandler) => defaultHandler(level, log),
		onwarn: mergeWarnings((warning, defaultHandler) => {
			handlerCalls++;
			received.push(warning);
			defaultHandler(warning);
		}),
		plugins: [
			{
				name: 'plugin-a',
				transform() {
					// same code, module, position and plugin: merged even though the
					// message differs, as the message is display text only
					this.warn({ code: 'TEST_WARNING', message: 'first message' }, 1);
					this.warn({ code: 'TEST_WARNING', message: 'first message' }, 1);
					this.warn({ code: 'TEST_WARNING', message: 'another message, same identity' }, 1);
					// different position: stays independent
					this.warn({ code: 'TEST_WARNING', message: 'first message' }, 2);
					return null;
				}
			},
			{
				name: 'plugin-b',
				transform() {
					// same code, module, position and message but a different plugin:
					// stays independent
					this.warn({ code: 'TEST_WARNING', message: 'first message' }, 1);
					return null;
				}
			},
			{
				// anonymous plugin: Rollup assigns the synthetic name "at position <n>"
				buildStart() {
					// no position: conservative identity, merges only if the message
					// matches as well
					this.warn({ code: 'ANON_WARNING', message: 'repeated anonymous warning' });
					this.warn({ code: 'ANON_WARNING', message: 'repeated anonymous warning' });
					this.warn({ code: 'ANON_WARNING', message: 'different anonymous warning' });
				}
			}
		]
	},
	after() {
		// onwarn ran exactly once per unique warning identity
		assert.strictEqual(handlerCalls, 5);
		assert.deepStrictEqual(
			received.map(({ count, id, loc, message, plugin, pluginCode }) => ({
				count,
				id: id && 'main.js',
				// the message of anonymous plugin warnings contains the synthetic
				// plugin name, which depends on the number of plugins
				message: message.replace(/^\[plugin at position \d+\] /, '[plugin <anonymous>] '),
				plugin: plugin.startsWith('at position') ? '<anonymous>' : plugin,
				pluginCode,
				position: loc && `${loc.line}:${loc.column}`
			})),
			[
				{
					count: 2,
					id: undefined,
					message: '[plugin <anonymous>] repeated anonymous warning',
					plugin: '<anonymous>',
					pluginCode: 'ANON_WARNING',
					position: undefined
				},
				{
					count: 1,
					id: undefined,
					message: '[plugin <anonymous>] different anonymous warning',
					plugin: '<anonymous>',
					pluginCode: 'ANON_WARNING',
					position: undefined
				},
				{
					count: 3,
					id: 'main.js',
					message: '[plugin plugin-a] main.js (1:1): first message',
					plugin: 'plugin-a',
					pluginCode: 'TEST_WARNING',
					position: '1:1'
				},
				{
					count: 1,
					id: 'main.js',
					message: '[plugin plugin-a] main.js (1:2): first message',
					plugin: 'plugin-a',
					pluginCode: 'TEST_WARNING',
					position: '1:2'
				},
				{
					count: 1,
					id: 'main.js',
					message: '[plugin plugin-b] main.js (1:1): first message',
					plugin: 'plugin-b',
					pluginCode: 'TEST_WARNING',
					position: '1:1'
				}
			]
		);
	}
});
