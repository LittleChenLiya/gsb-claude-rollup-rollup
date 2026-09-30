import { error, logFileNameCaseConflict, logInvalidPortableFileName } from './logs';

// Matches Windows reserved device names such as CON, PRN, AUX, NUL, COM1..COM9
// and LPT1..LPT9, optionally followed by any extension like "con.txt".
const WINDOWS_RESERVED_NAME_REGEX = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

// ASCII-only case folding so that file names which refer to the same file on
// case-insensitive file systems are detected without treating unrelated
// Unicode code points as equal.
function foldCase(fileName: string): string {
	let folded = '';
	for (const character of fileName) {
		folded += character >= 'A' && character <= 'Z' ? character.toLowerCase() : character;
	}
	return folded;
}

function validatePortablePath(fileName: string): void {
	if (/^[a-zA-Z]:[/\\]/.test(fileName) || /^[a-zA-Z]:$/.test(fileName)) {
		return error(
			logInvalidPortableFileName(fileName, 'it must not contain a Windows drive letter')
		);
	}
	if (fileName.startsWith('/') || fileName.startsWith('\\')) {
		return error(logInvalidPortableFileName(fileName, 'it must be a relative path'));
	}

	for (const segment of fileName.split(/[/\\]/)) {
		if (segment === '.' || segment === '') {
			continue;
		}
		if (segment === '..') {
			return error(
				logInvalidPortableFileName(
					fileName,
					'it must not contain ".." segments, which can escape the output directory'
				)
			);
		}
		if (segment.endsWith('.') || segment.endsWith(' ')) {
			return error(
				logInvalidPortableFileName(fileName, 'path segments must not end with a dot or a space')
			);
		}
		if (WINDOWS_RESERVED_NAME_REGEX.test(segment)) {
			return error(
				logInvalidPortableFileName(fileName, `"${segment}" is a reserved Windows file name`)
			);
		}
	}
}

// Returns a normalized representation used for case-insensitive collision
// detection: directory separators are unified and "."/empty segments removed.
function normalizeForCollisionCheck(fileName: string): string {
	return fileName
		.replaceAll('\\', '/')
		.split('/')
		.filter(segment => segment !== '' && segment !== '.')
		.join('/');
}

export function validateFileNames(fileNames: readonly string[]): void {
	const foldedFileNames = new Map<string, string>();
	for (const fileName of fileNames) {
		validatePortablePath(fileName);
		const foldedFileName = foldCase(normalizeForCollisionCheck(fileName));
		const conflictingFileName = foldedFileNames.get(foldedFileName);
		if (conflictingFileName !== undefined) {
			return error(logFileNameCaseConflict(fileName, conflictingFileName));
		}
		foldedFileNames.set(foldedFileName, fileName);
	}
}
