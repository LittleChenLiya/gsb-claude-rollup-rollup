import type { NormalizedOutputOptions } from '../rollup/types';
import {
	error,
	logFileNameOutsideOutputDirectory,
	logPortableFileNameConflict,
	logPortableFileNameViolation
} from './logs';
import type { OutputBundleWithPlaceholders } from './outputBundle';
import { isAbsolute } from './path';

const ASCII_UPPERCASE_REGEXP = /[A-Z]/g;
const RESERVED_WINDOWS_NAME_REGEXP = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const TRAILING_DOT_OR_SPACE_REGEXP = /[. ]$/;

type FileNameSourceGetter = (fileName: string) => string | undefined;

export function validateOutputBundleFileNames(
	bundle: OutputBundleWithPlaceholders,
	outputOptions: NormalizedOutputOptions,
	getFileNameSource: FileNameSourceGetter
): void {
	const { fileNameStrategy } = outputOptions;
	const foldedNameByKey = new Map<string, { fileName: string; source: string }>();
	for (const [bundleKey, entry] of Object.entries(bundle)) {
		const fileName = entry.type === 'placeholder' ? bundleKey : entry.fileName;
		if (isFileNameOutsideOutputDirectory(fileName)) {
			return error(logFileNameOutsideOutputDirectory(fileName));
		}
		if (fileName !== bundleKey && isFileNameOutsideOutputDirectory(bundleKey)) {
			return error(logFileNameOutsideOutputDirectory(bundleKey));
		}
		if (fileNameStrategy === 'strict-portable') {
			const source = getFileNameSource(fileName) ?? 'an unknown source';
			const normalizedPath = normalizePortablePath(fileName);
			const violation = getStrictPortableViolation(normalizedPath);
			if (violation) {
				return error(logPortableFileNameViolation(fileName, violation, source));
			}
			const foldedKey = normalizedPath!.replace(ASCII_UPPERCASE_REGEXP, asciiLetter =>
				asciiLetter.toLowerCase()
			);
			const conflictingFile = foldedNameByKey.get(foldedKey);
			if (conflictingFile) {
				return error(
					logPortableFileNameConflict(
						fileName,
						conflictingFile.fileName,
						source,
						conflictingFile.source
					)
				);
			}
			foldedNameByKey.set(foldedKey, { fileName, source });
		}
	}
}

function isFileNameOutsideOutputDirectory(fileName: string): boolean {
	const normalizedPath = normalizePortablePath(fileName);
	return isAbsolute(fileName) || normalizedPath === null || normalizedPath === '';
}

function getStrictPortableViolation(normalizedPath: string | null): string | undefined {
	if (normalizedPath === null) {
		return 'no path segment may resolve outside of the output directory with "..".';
	}
	for (const segment of normalizedPath.split('/')) {
		if (TRAILING_DOT_OR_SPACE_REGEXP.test(segment)) {
			return 'no path segment may end with a "." or a space.';
		}
		if (RESERVED_WINDOWS_NAME_REGEXP.test(segment)) {
			return `"${segment}" is a reserved file name on Windows.`;
		}
	}
}

function normalizePortablePath(fileName: string): string | null {
	const normalizedSegments: string[] = [];
	for (const segment of fileName.split(/[/\\]/)) {
		if (segment === '' || segment === '.') {
			continue;
		}
		if (segment === '..') {
			if (normalizedSegments.length === 0) {
				return null;
			}
			normalizedSegments.pop();
		} else {
			normalizedSegments.push(segment);
		}
	}
	return normalizedSegments.join('/');
}
