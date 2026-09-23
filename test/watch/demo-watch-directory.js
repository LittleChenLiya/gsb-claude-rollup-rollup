/**
 * Manual demo for the addWatchDirectory plugin context function.
 *
 * Run with: node test/watch/demo-watch-directory.js
 *
 * The script prints every watcher event together with the current build
 * number and finishes in well under 90 seconds. It covers the full
 * acceptance flow:
 *
 * 1. A plugin exports the sorted names of all json files in a "data"
 *    directory that is registered via this.addWatchDirectory.
 * 2. Adding b.json triggers a rebuild, adding x.txt does not, deleting
 *    b.json restores the previous output.
 * 3. A failing plugin keeps the directory watches alive: c.json is created
 *    while the build is broken and is picked up by the recovery build once
 *    the plugin is fixed.
 * 4. One more change after the recovery proves the watches are fully
 *    functional again before the watcher is closed and the process exits
 *    on its own, proving no watch handles are left behind.
 */
const { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const rollup = require('../../dist/rollup');

const DEMO_DIR = path.join(__dirname, '..', '_tmp_demo_watch_directory');
const INPUT_DIR = path.join(DEMO_DIR, 'input');
const DATA_DIR = path.join(INPUT_DIR, 'data');
const FAIL_FILE = path.join(INPUT_DIR, 'fail');
const BUNDLE_FILE = path.join(DEMO_DIR, 'output', 'bundle.js');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const startTime = Date.now();
const log = message =>
	console.log('[' + String(Date.now() - startTime).padStart(5) + 'ms] ' + message);

rmSync(DEMO_DIR, { force: true, recursive: true });
mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(path.join(INPUT_DIR, 'main.js'), 'export { names } from "virtual:names";');
writeFileSync(path.join(DATA_DIR, 'a.json'), '{}');

const directoryPlugin = {
	name: 'directory-plugin',
	buildStart() {
		this.addWatchDirectory(DATA_DIR, { include: ['**/*.json'] });
	},
	resolveId(id) {
		if (id === 'virtual:names') {
			return id;
		}
	},
	load(id) {
		if (id === 'virtual:names') {
			const names = readdirSync(DATA_DIR)
				.filter(name => name.endsWith('.json'))
				.sort();
			return 'export const names = ' + JSON.stringify(names) + ';';
		}
	}
};

const failPlugin = {
	name: 'fail-plugin',
	buildStart() {
		if (existsSync(FAIL_FILE)) {
			this.error('expected failure while the fail marker exists');
		}
	}
};

let builds = 0;
let phase = 0;
const watcher = rollup.watch({
	input: path.join(INPUT_DIR, 'main.js'),
	plugins: [directoryPlugin, failPlugin],
	output: { exports: 'auto', file: BUNDLE_FILE, format: 'cjs' }
});

const timeout = setTimeout(() => {
	log('TIMEOUT: demo did not finish within 90 seconds');
	process.exit(1);
}, 90_000);

watcher.on('change', (id, { event }) => {
	log('change detected: ' + path.relative(DEMO_DIR, id) + ' (' + event + ')');
});

watcher.on('event', async event => {
	if (event.code === 'ERROR') {
		log('build #' + builds + ' failed: ' + event.error.message);
		if (phase === 3) {
			phase = 4;
			log('creating c.json while the build is broken');
			writeFileSync(path.join(DATA_DIR, 'c.json'), '{}');
			await wait(400);
			log('fixing the plugin and triggering recovery');
			rmSync(FAIL_FILE, { force: true });
			writeFileSync(path.join(DATA_DIR, 'c.json'), '{"updated":true}');
		}
		return;
	}
	log('event: ' + event.code);
	if (event.code !== 'BUNDLE_END') {
		return;
	}
	builds++;
	const { names } = require(BUNDLE_FILE);
	delete require.cache[require.resolve(BUNDLE_FILE)];
	log('build #' + builds + ' wrote names: ' + JSON.stringify(names));
	if (phase === 0) {
		phase = 1;
		log('adding b.json');
		writeFileSync(path.join(DATA_DIR, 'b.json'), '{}');
	} else if (phase === 1) {
		phase = 2;
		log('adding x.txt (must not trigger a rebuild)');
		writeFileSync(path.join(DATA_DIR, 'x.txt'), 'ignored');
		await wait(600);
		log('still at build #' + builds + ' after x.txt, deleting b.json');
		rmSync(path.join(DATA_DIR, 'b.json'));
	} else if (phase === 2) {
		phase = 3;
		log('breaking the plugin and triggering a failing build');
		writeFileSync(FAIL_FILE, '');
		writeFileSync(path.join(DATA_DIR, 'a.json'), '{"touched":true}');
	} else if (phase === 4) {
		phase = 5;
		log('recovered, triggering one more rebuild to prove watches still work');
		writeFileSync(path.join(DATA_DIR, 'd.json'), '{}');
	} else if (phase === 5) {
		log('closing the watcher, the process should now exit on its own');
		clearTimeout(timeout);
		await watcher.close();
		rmSync(DEMO_DIR, { force: true, recursive: true });
	}
});
