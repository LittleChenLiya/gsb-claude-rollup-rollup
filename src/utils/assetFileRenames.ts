import {
	error,
	logAssetFileRenameConflict,
	logAssetFileRenameDuplicateTarget,
	logAssetFileRenameInvalid,
	logAssetFileRenameUnsupportedSourcemapMove
} from './logs';
import type { OutputBundleWithPlaceholders } from './outputBundle';
import { lowercaseBundleKeys } from './outputBundle';
import { dirname } from './path';
import { isPathFragment } from './relativeId';

/**
 * Explicit asset rename plans ("output.assetFileRenames").
 *
 * A rename plan is a plain object that maps the *final* file name of an
 * emitted asset (after "output.assetFileNames" patterns and hashes have been
 * resolved) to a new literal file name. Renames are applied when the final
 * file name of an emitted file is formed, so that all references that Rollup
 * tracks explicitly stay in sync without rewriting arbitrary code strings:
 *
 * - `import.meta.ROLLUP_FILE_URL_<referenceId>` references and the
 *   `referencedFiles` of chunks resolve through the file emitter and therefore
 *   pick up the renamed file name automatically.
 * - Source map files emitted as assets keep their relation to the owning
 *   chunk (`sourcemapFileName` and the `sourceMappingURL` comment) because the
 *   rename is applied before those are finalized.
 *
 * Only explicitly identified emitted assets can be renamed. Rename sources
 * that do not match the final file name of an emitted asset are rejected as
 * unsupported, as are chunks, prebuilt chunks and external modules. If any
 * step of a rename plan fails, the whole generation fails and no new bundle
 * is produced.
 */

export type AssetFileRenames = Record<string, string>;

export class AssetFileRenamePlan {
	private readonly consumedFileNames = new Set<string>();
	private readonly sourceByLowercaseTarget = new Map<string, string>();
	private readonly renames: AssetFileRenames;

	private constructor(renames: AssetFileRenames) {
		this.renames = renames;
	}

	/**
	 * Validates a raw "output.assetFileRenames" option value and creates the
	 * corresponding plan. Returns `null` if no renames were configured. Throws
	 * for malformed plans, invalid rename targets, duplicate targets and
	 * chained renames before anything is renamed.
	 */
	public static create(option: unknown): AssetFileRenamePlan | null {
		if (option == null) {
			return null;
		}
		if (typeof option !== 'object' || Array.isArray(option)) {
			return error(
				logAssetFileRenameInvalid(
					'expected an object mapping emitted asset file names to their new file names'
				)
			);
		}
		const renames: AssetFileRenames = Object.create(null);
		const lowercaseSources = new Set<string>();
		const lowercaseTargets = new Set<string>();
		let hasRenames = false;
		for (const [fileName, renamedFileName] of Object.entries(option)) {
			if (fileName.length === 0 || isPathFragment(fileName)) {
				return error(
					logAssetFileRenameInvalid(
						`rename sources must be relative file names inside the output directory, received ${JSON.stringify(
							fileName
						)}`
					)
				);
			}
			if (
				typeof renamedFileName !== 'string' ||
				renamedFileName.length === 0 ||
				isPathFragment(renamedFileName)
			) {
				return error(
					logAssetFileRenameInvalid(
						`rename target for "${fileName}" must be a relative file name inside the output directory, received ${JSON.stringify(
							renamedFileName
						)}`
					)
				);
			}
			const lowercaseTarget = renamedFileName.toLowerCase();
			if (lowercaseTargets.has(lowercaseTarget)) {
				return error(logAssetFileRenameDuplicateTarget(renamedFileName));
			}
			lowercaseTargets.add(lowercaseTarget);
			lowercaseSources.add(fileName.toLowerCase());
			renames[fileName] = renamedFileName;
			hasRenames = true;
		}
		if (!hasRenames) {
			return null;
		}
		for (const [fileName, renamedFileName] of Object.entries(renames)) {
			if (renamedFileName !== fileName && lowercaseSources.has(renamedFileName.toLowerCase())) {
				return error(
					logAssetFileRenameInvalid(
						`rename target "${renamedFileName}" is itself renamed by the plan, chained renames are not supported`
					)
				);
			}
		}
		return new AssetFileRenamePlan(renames);
	}

	/**
	 * Returns the renamed file name for a final emitted file name, tracking
	 * which plan entries have been consumed. `isFileNameTaken` must report
	 * whether a file name is already used or reserved in the output bundle.
	 */
	public getRenamedFileName(
		fileName: string,
		isFileNameTaken: (fileName: string) => boolean
	): string {
		const renamedFileName = this.renames[fileName];
		if (renamedFileName === undefined) {
			return fileName;
		}
		this.consumedFileNames.add(fileName);
		if (renamedFileName === fileName) {
			return fileName;
		}
		const lowercaseTarget = renamedFileName.toLowerCase();
		const mergingSource = this.sourceByLowercaseTarget.get(lowercaseTarget);
		if (mergingSource === fileName) {
			// Several emitted assets can share the same final file name, in which
			// case they are merged into a single output file. The rename has already
			// been applied to that file.
			return renamedFileName;
		}
		if (mergingSource !== undefined || isFileNameTaken(renamedFileName)) {
			return error(logAssetFileRenameConflict(fileName, renamedFileName));
		}
		this.sourceByLowercaseTarget.set(lowercaseTarget, fileName);
		return renamedFileName;
	}

	/**
	 * Returns all rename sources that did not match the final file name of an
	 * emitted file. Any non-empty result is an error because only explicitly
	 * identified emitted files can be renamed.
	 */
	public getUnconsumedFileNames(): string[] {
		return Object.keys(this.renames).filter(fileName => !this.consumedFileNames.has(fileName));
	}
}

/**
 * Applies a rename plan to the file name of an emitted asset, moving any
 * previous placeholder reservation of the original file name in the bundle to
 * the renamed file.
 */
export function applyAssetFileRename(
	plan: AssetFileRenamePlan | null,
	fileName: string,
	bundle: OutputBundleWithPlaceholders
): string {
	if (!plan) {
		return fileName;
	}
	const renamedFileName = plan.getRenamedFileName(fileName, renamed =>
		bundle[lowercaseBundleKeys].has(renamed.toLowerCase())
	);
	if (renamedFileName !== fileName && bundle[fileName]?.type === 'placeholder') {
		// The original file name was only reserved by this asset, so the
		// reservation is moved to the renamed file
		delete bundle[fileName];
	}
	return renamedFileName;
}

/**
 * Applies a rename plan to the file name of a source map emitted for a chunk.
 * Source map files may only be renamed within their directory because moving
 * them across directories would invalidate the relative "sources" paths
 * inside the source map as well as the "sourceMappingURL" comment.
 */
export function applySourcemapFileRename(fileName: string, renamedFileName: string): string {
	if (renamedFileName !== fileName && dirname(renamedFileName) !== dirname(fileName)) {
		return error(logAssetFileRenameUnsupportedSourcemapMove(fileName, renamedFileName));
	}
	return renamedFileName;
}
