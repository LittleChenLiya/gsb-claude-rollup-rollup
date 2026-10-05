import type { RollupLog, WarningHandlerWithDefault } from '../rollup/types';

/**
 * Optional warning merger for `onwarn`.
 *
 * Wrap an `onwarn` handler with `dedupeWarnings` to collapse repeated warnings
 * into a single callback. The first occurrence of a warning is passed through to
 * the wrapped handler with `count` set to `1`; every further occurrence only
 * increments the `count` of that first warning object. The wrapped handler is
 * therefore invoked exactly once per distinct warning, plugins are not re-run
 * and the original warning objects are not otherwise modified.
 *
 * Warnings are considered identical when they share all of the following
 * identity axes:
 *
 * 1. `code` — the warning code.
 * 2. module identity — the real module IDs the warning refers to (`id`,
 *    `ids`, `exporter` and `reexporter`).
 * 3. source location — `loc.file:loc.line:loc.column`.
 * 4. plugin identity — the `plugin` name.
 *
 * The `message` is display text only and is deliberately excluded from the
 * identity as long as a source location is available: two warnings carrying the
 * same text at different locations must stay independent.
 *
 * Warnings without a source location cannot be distinguished by position, so
 * they use a more conservative identity that also includes the `message`. This
 * keeps location-less warnings from being merged unless everything, including
 * the message, matches.
 *
 * Identity of anonymous plugins: plugins without a `name` are normalized by
 * rollup to `at position N` (the 1-based position in the plugins array) before
 * any warning is emitted, so that position-based name is used as the plugin
 * identity. It is stable within a single build but changes when the plugin
 * array is reordered, so it is treated conservatively. Warnings emitted before
 * plugin names are normalized (e.g. during the `options` hook) carry no plugin
 * name and fall back to the empty identity.
 *
 * @example
 * const warnings = [];
 * const bundle = await rollup({
 *   input: 'src/main.js',
 *   onwarn: dedupeWarnings(warning => warnings.push(warning))
 * });
 * // warnings now contains each distinct warning once, ordered by first
 * // occurrence, with `count` reflecting how often it was emitted.
 */
export function dedupeWarnings(onwarn: WarningHandlerWithDefault): WarningHandlerWithDefault {
	const warningsByIdentity = new Map<string, RollupLog>();

	return (warning, defaultHandler) => {
		const identity = getWarningIdentity(warning);
		const existing = warningsByIdentity.get(identity);
		if (existing) {
			existing.count = (existing.count ?? 1) + 1;
			return;
		}
		warning.count = 1;
		warningsByIdentity.set(identity, warning);
		onwarn(warning, defaultHandler);
	};
}

/**
 * Builds the conservative identity key for a warning. See {@link dedupeWarnings}
 * for the rules that make up the key.
 */
function getWarningIdentity(warning: RollupLog): string {
	const code = warning.code ?? '';
	const module = getModuleIdentity(warning);
	const location = getLocationIdentity(warning);
	const plugin = getPluginIdentity(warning);
	// Warnings without a source location cannot be distinguished by position,
	// so use a more conservative identity that also includes the message.
	const message = warning.loc ? '' : `\u0000${warning.message ?? ''}`;
	return `${code}\u0000${module}\u0000${location}\u0000${plugin}${message}`;
}

function getModuleIdentity(warning: RollupLog): string {
	const parts: string[] = [];
	if (warning.id) parts.push(warning.id);
	if (warning.exporter) parts.push(warning.exporter);
	if (warning.reexporter) parts.push(warning.reexporter);
	if (warning.ids) parts.push(...warning.ids);
	return parts.join('\u0000');
}

function getLocationIdentity(warning: RollupLog): string {
	const { loc } = warning;
	if (!loc) return '';
	return `${loc.file ?? ''}:${loc.line}:${loc.column}`;
}

function getPluginIdentity(warning: RollupLog): string {
	// Anonymous plugins are normalized to "at position N" before any warning is
	// emitted, so the normalized name is their identity.
	return warning.plugin ?? '';
}
