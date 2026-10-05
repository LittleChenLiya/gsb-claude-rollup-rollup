// Local, dependency-free check for the optional warning merger. It exercises
// the actual implementation in src/utils/warningMerger.ts without requiring a
// built dist/ or the native parser (Node >= 22.6 strips the types natively).
//
// Run from the repository root:
//   node test/function/samples/warning-merger/local-check.mjs
import assert from 'node:assert/strict';
import { mergeWarnings } from '../../../../src/utils/warningMerger.ts';

// Simulates what Rollup's plugin log handler (src/utils/logHandler.ts) and
// the transform context (src/utils/transform.ts) do before a warning reaches
// "onwarn": the plugin name is attached, a custom code becomes "pluginCode"
// while "code" becomes PLUGIN_WARNING, and positional warnings receive the
// real module id plus a "loc".
const emitted = [];
const pluginContext = (plugin, id) => ({
	pluginHookRuns: 0,
	warn(log, pos) {
		const warning = { ...log };
		if (log.code && !log.pluginCode) warning.pluginCode = log.code;
		warning.code = 'PLUGIN_WARNING';
		warning.plugin = plugin;
		if (id) warning.id = id;
		if (pos != null) {
			warning.pos = pos;
			warning.loc = { column: pos, file: id, line: 1 };
		}
		emitted.push(warning);
	}
});

// The user's onwarn, wrapped in the merger
const received = [];
let onwarnCalls = 0;
const onwarn = mergeWarnings((warning, defaultHandler) => {
	onwarnCalls++;
	received.push(warning);
	defaultHandler(warning);
});
const printed = [];
const defaultHandler = warning => printed.push(String(warning.message));

// --- mini "build": each plugin hook runs exactly once -----------------------
const pluginA = pluginContext('plugin-a', '/project/main.js');
pluginA.pluginHookRuns++;
pluginA.warn({ code: 'TEST_WARNING', message: 'same message' }, 5);
pluginA.warn({ code: 'TEST_WARNING', message: 'same message' }, 5);
pluginA.warn({ code: 'TEST_WARNING', message: 'same message' }, 5);
// message is display text only: different message, same identity -> merged
pluginA.warn({ code: 'TEST_WARNING', message: 'different message, same identity' }, 5);
// different position -> independent
pluginA.warn({ code: 'TEST_WARNING', message: 'same message' }, 9);

const pluginB = pluginContext('plugin-b', '/project/main.js');
pluginB.pluginHookRuns++;
// same code, module, position and message, but a different plugin -> independent
pluginB.warn({ code: 'TEST_WARNING', message: 'same message' }, 5);

// anonymous plugin: Rollup assigns the synthetic name "at position <n>"
const anonymous = pluginContext('at position 3');
anonymous.pluginHookRuns++;
// no position -> conservative identity: merges only if the message matches
anonymous.warn({ code: 'ANON_WARNING', message: 'repeated anonymous warning' });
anonymous.warn({ code: 'ANON_WARNING', message: 'repeated anonymous warning' });
anonymous.warn({ code: 'ANON_WARNING', message: 'different anonymous warning' });

// core warning without any plugin identity and without a position
emitted.push({ code: 'EMPTY_BUNDLE', message: 'Generated an empty chunk' });
emitted.push({ code: 'EMPTY_BUNDLE', message: 'Generated an empty chunk' });

// same message at different positions must NOT merge
const pluginC = pluginContext('plugin-c', '/project/other.js');
pluginC.pluginHookRuns++;
pluginC.warn({ code: 'TEST_WARNING', message: 'identical text' }, 1);
pluginC.warn({ code: 'TEST_WARNING', message: 'identical text' }, 2);

for (const warning of emitted) onwarn(warning, defaultHandler);

// --- assertions -------------------------------------------------------------
// every plugin hook ran exactly once; merging never re-runs plugins
assert.equal(pluginA.pluginHookRuns + pluginB.pluginHookRuns + anonymous.pluginHookRuns + pluginC.pluginHookRuns, 4);

const summary = received.map(({ code, count, id, loc, message, plugin, pluginCode }) => ({
	code,
	pluginCode,
	plugin,
	id,
	position: loc ? `${loc.line}:${loc.column}` : undefined,
	count,
	message
}));

// onwarn executed exactly once per unique identity, in first-occurrence order
assert.equal(onwarnCalls, 8);
assert.deepEqual(
	summary.map(({ count, message, plugin, position }) => ({ count, message, plugin, position })),
	[
		// same position + same code three times (plus one more with a different
		// message) -> a single warning with count 4
		{ count: 4, message: 'same message', plugin: 'plugin-a', position: '1:5' },
		{ count: 1, message: 'same message', plugin: 'plugin-a', position: '1:9' },
		{ count: 1, message: 'same message', plugin: 'plugin-b', position: '1:5' },
		{ count: 2, message: 'repeated anonymous warning', plugin: 'at position 3', position: undefined },
		{ count: 1, message: 'different anonymous warning', plugin: 'at position 3', position: undefined },
		{ count: 2, message: 'Generated an empty chunk', plugin: undefined, position: undefined },
		// identical text at different positions stays independent
		{ count: 1, message: 'identical text', plugin: 'plugin-c', position: '1:1' },
		{ count: 1, message: 'identical text', plugin: 'plugin-c', position: '1:2' }
	]
);
// the default handler was only invoked for unique warnings
assert.equal(printed.length, 8);

console.log('local-check: all assertions passed');
console.log('onwarn calls:', onwarnCalls, '(emitted warnings:', emitted.length + ')');
console.log('merged warnings, in first-occurrence order:');
for (const warning of summary) {
	console.log(
		`  [count ${warning.count}] ${warning.plugin ?? '<core>'} ${warning.pluginCode ?? warning.code}` +
			`${warning.position ? ` at ${warning.position}` : ''}: ${warning.message}`
	);
}
