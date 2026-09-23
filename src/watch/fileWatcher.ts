import { createFilter } from '@rollup/pluginutils';
import chokidar, { type FSWatcher } from 'chokidar';
import { platform } from 'node:os';
import type { ChangeEvent, ChokidarOptions, WatchDirectoryRegistration } from '../rollup/types';
import { normalize, relative } from '../utils/path';
import type { Task } from './watch';

export function getWatchDirectoryKey(registration: WatchDirectoryRegistration): string {
	return JSON.stringify(registration, (_key, value: unknown) =>
		value instanceof RegExp ? value.toString() : value
	);
}

function createDirectoryFilter(registration: WatchDirectoryRegistration): (id: string) => boolean {
	return createFilter(registration.include, registration.exclude, { resolve: false });
}

interface DirectoryWatch {
	readonly filters: Map<string, (id: string) => boolean>;
	readonly watcher: FSWatcher;
}

export class FileWatcher {
	private readonly chokidarOptions: ChokidarOptions;
	private readonly directoryWatchers = new Map<string, DirectoryWatch>();
	private readonly task: Task;
	private readonly transformWatchers = new Map<string, FSWatcher>();
	private readonly watcher: FSWatcher;

	constructor(task: Task, chokidarOptions: ChokidarOptions) {
		this.chokidarOptions = chokidarOptions;
		this.task = task;
		this.watcher = this.createWatcher(null);
	}

	close(): void {
		this.watcher.close();
		for (const { watcher } of this.directoryWatchers.values()) {
			watcher.close();
		}
		this.directoryWatchers.clear();
		for (const watcher of this.transformWatchers.values()) {
			watcher.close();
		}
	}

	unwatch(id: string): void {
		this.watcher.unwatch(id);
		const transformWatcher = this.transformWatchers.get(id);
		if (transformWatcher) {
			this.transformWatchers.delete(id);
			transformWatcher.close();
		}
	}

	watch(id: string, isTransformDependency: boolean): void {
		if (isTransformDependency) {
			const watcher = this.transformWatchers.get(id) ?? this.createWatcher(id);
			watcher.add(id);
			this.transformWatchers.set(id, watcher);
		} else {
			this.watcher.add(id);
		}
	}

	unwatchDirectory(registration: WatchDirectoryRegistration): void {
		const directoryWatch = this.directoryWatchers.get(registration.directory);
		if (!directoryWatch) return;
		directoryWatch.filters.delete(getWatchDirectoryKey(registration));
		if (directoryWatch.filters.size === 0) {
			this.directoryWatchers.delete(registration.directory);
			directoryWatch.watcher.close();
		}
	}

	watchDirectory(registration: WatchDirectoryRegistration): void {
		const directoryWatch = this.directoryWatchers.get(registration.directory);
		if (directoryWatch) {
			directoryWatch.filters.set(
				getWatchDirectoryKey(registration),
				createDirectoryFilter(registration)
			);
		} else {
			this.directoryWatchers.set(registration.directory, {
				filters: new Map([
					[getWatchDirectoryKey(registration), createDirectoryFilter(registration)]
				]),
				watcher: this.createDirectoryWatcher(registration.directory)
			});
		}
	}

	private createDirectoryWatcher(directory: string): FSWatcher {
		const task = this.task;
		const handleDirectoryChange = (id: string, event: ChangeEvent) => {
			if (id === directory) {
				task.invalidate(id, { event });
			}
		};
		const handleFileChange = (id: string, event: ChangeEvent) => {
			const relativeId = normalize(relative(directory, id));
			const directoryWatch = this.directoryWatchers.get(directory);
			if (!directoryWatch) return;
			for (const filter of directoryWatch.filters.values()) {
				if (filter(relativeId)) {
					task.invalidate(id, { event });
					return;
				}
			}
		};
		return chokidar
			.watch(directory, {
				followSymlinks: false,
				...this.chokidarOptions
			})
			.on('add', id => handleFileChange(id, 'create'))
			.on('change', id => handleFileChange(id, 'update'))
			.on('unlink', id => handleFileChange(id, 'delete'))
			.on('addDir', id => handleDirectoryChange(id, 'create'))
			.on('unlinkDir', id => handleDirectoryChange(id, 'delete'));
	}

	private createWatcher(transformWatcherId: string | null): FSWatcher {
		const task = this.task;
		const isLinux = platform() === 'linux';
		const isFreeBSD = platform() === 'freebsd';
		const isTransformDependency = transformWatcherId !== null;
		const handleChange = (id: string, event: ChangeEvent) => {
			const changedId = transformWatcherId || id;
			if (isLinux || isFreeBSD) {
				// unwatching and watching fixes an issue with chokidar where on certain systems,
				// a file that was unlinked and immediately recreated would create a change event
				// but then no longer any further events
				watcher.unwatch(changedId);
				watcher.add(changedId);
			}
			task.invalidate(changedId, { event, isTransformDependency });
		};
		const watcher = chokidar
			.watch([], this.chokidarOptions)
			.on('add', id => handleChange(id, 'create'))
			.on('change', id => handleChange(id, 'update'))
			.on('unlink', id => handleChange(id, 'delete'));
		return watcher;
	}
}
