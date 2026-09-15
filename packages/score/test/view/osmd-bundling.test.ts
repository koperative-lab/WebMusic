import {execFileSync} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, it} from 'vitest';

const require = createRequire(import.meta.url);
const {build} = createRequire(require.resolve('tsup/package.json'))('esbuild') as typeof import('esbuild');

it('emits the optional OSMD peer as a lazy chunk and loads it only for rendering', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webmusic-osmd-bundle-'));
  try {
    await build({
      stdin: {
        contents: `export {ScoreBuilder} from './src/core';
          export {renderOSMDStaffVisualizer} from './src/view/render/osmd-staff';`,
        resolveDir: fileURLToPath(new URL('../..', import.meta.url)),
        loader: 'ts',
      },
      outdir: directory,
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      outExtension: {'.js': '.mjs'},
      logLevel: 'silent',
      plugins: [{
        name: 'test-osmd-peer',
        setup(bundle) {
          bundle.onResolve({filter: /^opensheetmusicdisplay$/}, () => ({path: 'osmd', namespace: 'test-peer'}));
          bundle.onLoad({filter: /.*/, namespace: 'test-peer'}, () => ({loader: 'js', contents: `
            const events = globalThis.osmdBundleEvents;
            events.push('peer evaluated');
            export class OpenSheetMusicDisplay {
              constructor() { events.push('constructed'); }
              async load(xml) { if (xml !== '<score-partwise/>') throw Error('wrong input'); events.push('loaded'); }
              render() { events.push('rendered'); }
              clear() { events.push('cleared'); }
            }
          `}));
        },
      }],
    });
    const runner = join(directory, 'consumer.mjs');
    await writeFile(runner, `
      import assert from 'node:assert/strict';
      globalThis.osmdBundleEvents = [];
      const {ScoreBuilder, renderOSMDStaffVisualizer} = await import('./stdin.mjs');
      assert.deepEqual(globalThis.osmdBundleEvents, []);
      const rendered = await renderOSMDStaffVisualizer(new ScoreBuilder().build(), {}, {musicXML: '<score-partwise/>'});
      rendered.dispose();
      console.log(JSON.stringify(globalThis.osmdBundleEvents));
    `);
    expect(JSON.parse(execFileSync(process.execPath, [runner], {encoding: 'utf8'}))).toEqual([
      'peer evaluated', 'constructed', 'loaded', 'rendered', 'cleared',
    ]);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
