import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollup } from '../../../dist/rollup.js';
import inputLockModule from '../index.js';

const { inputLock } = inputLockModule;
const projectDir = fileURLToPath(new URL('project', import.meta.url));
const messageFile = join(projectDir, 'message.txt');
const manifestFile = join(projectDir, 'rollup-input-lock.json');
const outputDir = join(projectDir, 'dist');
const VIRTUAL_MODULE_ID = '\0virtual:message';

function virtualMessagePlugin() {
	return {
		load(id) {
			if (id === VIRTUAL_MODULE_ID) {
				return readFile(messageFile, 'utf8').then(
					message => `export const message = ${JSON.stringify(message.trim())};`
				);
			}
		},
		name: 'virtual-message',
		resolveId(id) {
			if (id === 'virtual:message') return VIRTUAL_MODULE_ID;
		}
	};
}

function logoAssetPlugin() {
	return {
		async buildStart() {
			this.emitFile({
				name: 'logo.txt',
				source: await readFile(join(projectDir, 'logo.txt')),
				type: 'asset'
			});
		},
		name: 'logo-asset'
	};
}

async function build(mode) {
	const bundle = await rollup({
		input: join(projectDir, 'src', 'main.js'),
		plugins: [virtualMessagePlugin(), logoAssetPlugin(), inputLock({ mode, root: projectDir })]
	});
	try {
		await bundle.write({ dir: outputDir, format: 'es' });
	} finally {
		await bundle.close();
	}
}

async function step(title, action) {
	console.log(`\n=== ${title} ===`);
	await action();
}

const startedAt = Date.now();
const originalMessage = await readFile(messageFile, 'utf8');
let failed = false;

try {
	await step('1/3 Record: generate the input lock manifest', async () => {
		await build('record');
		console.log(`wrote ${manifestFile}:`);
		console.log(await readFile(manifestFile, 'utf8'));
	});

	await step('2/3 Verify: an unchanged build passes', async () => {
		await build('verify');
		console.log('verification passed');
	});

	await step('3/3 Tamper: changed virtual module content is rejected', async () => {
		await writeFile(messageFile, 'tampered message\n');
		await rm(outputDir, { force: true, recursive: true });
		let error = null;
		try {
			await build('verify');
		} catch (buildError) {
			error = buildError;
		}
		if (!error) {
			throw new Error('expected the tampered build to be rejected');
		}
		console.log(`rejected as expected:`);
		console.log(error.message);
		if (!error.message.includes(VIRTUAL_MODULE_ID)) {
			throw new Error(`expected the error to report the logical id ${VIRTUAL_MODULE_ID}`);
		}
		if (existsSync(outputDir)) {
			throw new Error('a bundle was written even though verification failed');
		}
		console.log('no bundle was written for the rejected build');
	});
} catch (error) {
	failed = true;
	console.error(`\nDEMO FAILED: ${error.message}`);
} finally {
	await writeFile(messageFile, originalMessage);
	await rm(manifestFile, { force: true });
	await rm(outputDir, { force: true, recursive: true });
}

const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\ndemo finished in ${elapsedSeconds}s`);
process.exitCode = failed ? 1 : 0;
