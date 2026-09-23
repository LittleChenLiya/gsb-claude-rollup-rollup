import chokidar, { type FSWatcher } from 'chokidar';
import { platform } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';
import type { ChangeEvent, ChokidarOptions } from '../rollup/types';
import type { Task } from './watch';

export type WatchDirectoryFilter = (relativePath: string) => boolean;

export class FileWatcher {
	private readonly chokidarOptions: ChokidarOptions;
	private readonly directoryWatcher: FSWatcher;
	private readonly task: Task;
	private readonly transformWatchers = new Map<string, FSWatcher>();
	private readonly watchedDirectories = new Map<string, Set<WatchDirectoryFilter>>();
	private readonly watcher: FSWatcher;

	constructor(task: Task, chokidarOptions: ChokidarOptions) {
		this.chokidarOptions = chokidarOptions;
		this.task = task;
		this.watcher = this.createWatcher(null);
		this.directoryWatcher = this.createDirectoryWatcher();
	}

	close(): void {
		this.watcher.close();
		this.directoryWatcher.close();
		for (const watcher of this.transformWatchers.values()) {
			watcher.close();
		}
	}

	unwatchDirectory(directory: string, filter: WatchDirectoryFilter): void {
		const filters = this.watchedDirectories.get(directory);
		if (filters) {
			filters.delete(filter);
			if (filters.size === 0) {
				this.watchedDirectories.delete(directory);
				this.directoryWatcher.unwatch(directory);
			}
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

	watchDirectory(directory: string, filter: WatchDirectoryFilter): void {
		const filters = this.watchedDirectories.get(directory);
		if (filters) {
			filters.add(filter);
		} else {
			this.watchedDirectories.set(directory, new Set([filter]));
			this.directoryWatcher.add(directory);
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

	private createDirectoryWatcher(): FSWatcher {
		const task = this.task;
		const handleDirectoryChange = (id: string, event: ChangeEvent) => {
			for (const [directory, filters] of this.watchedDirectories) {
				const relativePath = relative(directory, id);
				if (
					relativePath === '..' ||
					relativePath.startsWith('..' + sep) ||
					isAbsolute(relativePath)
				)
					continue;
				const posixPath = relativePath.split(sep).join('/');
				for (const filter of filters) {
					if (filter(posixPath)) {
						task.invalidate(id, { event });
						return;
					}
				}
			}
		};
		const handleDirectoryStructureChange = (id: string, event: ChangeEvent) => {
			for (const directory of this.watchedDirectories.keys()) {
				if (id === directory || id.startsWith(directory + sep)) {
					task.invalidate(id, { event });
					return;
				}
			}
		};
		return chokidar
			.watch([], {
				followSymlinks: false,
				...this.chokidarOptions,
				disableGlobbing: true,
				ignoreInitial: true
			})
			.on('add', id => handleDirectoryChange(id, 'create'))
			.on('change', id => handleDirectoryChange(id, 'update'))
			.on('unlink', id => handleDirectoryChange(id, 'delete'))
			.on('addDir', id => handleDirectoryStructureChange(id, 'create'))
			.on('unlinkDir', id => handleDirectoryStructureChange(id, 'delete'));
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
