import type {
	MergedRollupLog,
	MergedWarningHandler,
	RollupLog,
	WarningHandlerWithDefault
} from '../rollup/types';

/**
 * Computes the identity of a warning for merging. Two warnings are only
 * merged if all of the following are identical:
 *
 * 1. `code` — the warning code. For plugin warnings, the effective code is
 *    `pluginCode` (Rollup replaces `code` with `PLUGIN_WARNING`), so both
 *    are part of the identity.
 * 2. The real module id (`log.id`) the warning refers to. This is the actual
 *    resolved module id, never a generated chunk or file name.
 * 3. The source position — `loc` (file, line and column) if present,
 *    otherwise `pos`.
 * 4. The plugin identity (`log.plugin`). Named plugins are identified by
 *    their name. Anonymous plugins are identified by the synthetic name
 *    Rollup assigns them (`at position <n>`), so each anonymous plugin is
 *    its own identity and warnings from different anonymous plugins are
 *    never merged.
 *
 * `message` is display text only and never part of the identity: warnings
 * with different messages but the same identity still merge, and warnings
 * with the same message but different positions stay independent.
 *
 * Conservative fallback: if a warning has no source position (neither `loc`
 * nor `pos`) or no plugin identity at all (e.g. core Rollup warnings), we
 * cannot be sure that two warnings really describe the same issue. In that
 * case the `message` is included in the identity as well, so such warnings
 * only merge when their messages also match.
 */
const getWarningKey = ({ code, id, loc, message, plugin, pluginCode, pos }: RollupLog): string => {
	const hasPosition = loc != null || pos != null;
	const includeMessage = !hasPosition || plugin == null;
	return JSON.stringify([
		code ?? '',
		pluginCode == null ? '' : String(pluginCode),
		id ?? '',
		loc ? `${loc.file ?? ''}:${loc.line}:${loc.column}` : pos == null ? '' : `pos:${pos}`,
		plugin ?? '',
		includeMessage ? message : ''
	]);
};

/**
 * Creates an `onwarn` handler that merges duplicate warnings before
 * delegating to the provided handler.
 *
 * The wrapped handler is invoked exactly once per unique warning identity —
 * at the first occurrence — so first-occurrence order is preserved. Each
 * further occurrence of the same warning only increments the `count`
 * property of the warning object that was passed to the handler, it does
 * not invoke the handler again. As merging happens at the `onwarn` level,
 * plugins are not re-run. The default warning path is unchanged unless this
 * wrapper is used explicitly.
 */
export function mergeWarnings(onwarn: MergedWarningHandler): WarningHandlerWithDefault {
	const mergedWarnings = new Map<string, MergedRollupLog>();
	return (warning, defaultHandler) => {
		const key = getWarningKey(warning);
		const existing = mergedWarnings.get(key);
		if (existing) {
			existing.count++;
			return;
		}
		const mergedWarning = warning as MergedRollupLog;
		mergedWarning.count = 1;
		mergedWarnings.set(key, mergedWarning);
		onwarn(mergedWarning, defaultHandler);
	};
}
