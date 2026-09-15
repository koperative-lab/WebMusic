import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Options} from 'tsup';
import {expect, it} from 'vitest';

// Use the same esbuild installation as this workspace's declared tsup tool.
const require = createRequire(import.meta.url);
type BuildOptions = Parameters<NonNullable<Options['esbuildOptions']>>[0];
type Plugin = NonNullable<Options['esbuildPlugins']>[number];
const {build} = createRequire(require.resolve('tsup/package.json'))('esbuild') as {
  build(options: BuildOptions): Promise<unknown>;
};

it('keeps the optional SoundFont peer outside the script-tag IIFE', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webmusic-spessa-iife-'));
  try {
    const configFile = join(directory, 'tsup.config.mjs');
    const outDir = join(directory, 'dist');
    const sourceConfig = fileURLToPath(new URL('../../tsup.config.mjs', import.meta.url));
    // Load the maintained config through the actual tsup CLI, overriding only
    // the output directory and metadata. tsup bypasses its external plugin for
    // IIFEs, so mapping its options directly into esbuild misses real behavior.
    await writeFile(configFile, `
      export default async () => {
        const sourceConfig = ${JSON.stringify(sourceConfig)};
        const {default: configurations} = await import(sourceConfig);
        const iife = configurations.find((config) => config.format?.includes('iife'));
        if (!iife) throw Error('Missing Score IIFE configuration');
        return {...iife, outDir: ${JSON.stringify(outDir)}, metafile: true};
      };
    `);
    execFileSync(process.execPath, [require.resolve('tsup/dist/cli-default.js'), '--config', configFile], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const map = JSON.parse(await readFile(join(outDir, 'play/auto.global.js.map'), 'utf8')) as {sources: string[]};
    const metadata = JSON.parse(await readFile(join(outDir, 'metafile-iife.json'), 'utf8')) as {
      outputs: Record<string, {imports: {path: string; kind: string; external?: boolean}[]}>;
    };
    expect(map.sources.some((source) => source.endsWith('src/play/element/auto.ts'))).toBe(true);
    expect(map.sources.some((source) => source.endsWith('src/play/headless/sounds/spessa.ts'))).toBe(true);
    expect(map.sources.filter((source) => /node_modules\/(?:spessasynth_lib|spessasynth_core|stb-vorbis)\//.test(source))).toEqual([]);
    const imports = Object.values(metadata.outputs).flatMap((output) => output.imports);
    expect(imports).toContainEqual({path: 'spessasynth_lib', kind: 'dynamic-import', external: true});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}, 30_000);

it('bundles the optional SoundFont peer as a lazy module and loads it on connect', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'webmusic-spessa-bundle-'));
  try {
    const optionalPeer: Plugin = {
      name: 'test-spessasynth-peer',
      setup(bundle) {
        bundle.onResolve({filter: /^spessasynth_lib$/}, () => ({
          path: 'spessasynth_lib',
          namespace: 'test-peer',
        }));
        bundle.onLoad({filter: /.*/, namespace: 'test-peer'}, () => ({
          loader: 'js',
          contents: `
            const state = globalThis.spessaBundleTest;
            state.events.push('peer evaluated');
            export class WorkletSynthesizer {
              constructor(context) {
                if (state.workletContext !== context) throw Error('Worklet is not registered');
                state.events.push('synth created');
                this.isReady = Promise.resolve();
                this.soundBankManager = {addSoundBank: async (buffer, id) => {
                  state.events.push('bank loaded');
                  state.bank = {bytes: [...new Uint8Array(buffer)], id};
                }};
              }
              programChange(channel, program) { state.program = [channel, program]; }
              connect() { state.events.push('synth connected'); }
              destroy() { state.events.push('synth destroyed'); }
            }
          `,
        }));
      },
    };
    await build({
      entryPoints: [fileURLToPath(new URL('../../src/play/headless/sound.ts', import.meta.url))],
      outdir: directory,
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      outExtension: {'.js': '.mjs'},
      plugins: [optionalPeer],
      logLevel: 'silent',
    });

    // A native consumer outside the workspace cannot resolve the real peer.
    // The build must have emitted the lazy dependency rather than preserving
    // an ignored bare import. Its evaluation must still wait for connect().
    const runner = join(directory, 'consumer.mjs');
    await writeFile(runner, `
      import assert from 'node:assert/strict';
      const state = globalThis.spessaBundleTest = {events: []};
      const {Sound} = await import('./sound.mjs');
      assert.deepEqual(state.events, []);
      const context = {currentTime: 0, createGain() {
        return {context, gain: {value: 1}, connect() {}, disconnect() {}};
      }};
      const sound = Sound.soundfont2(new Uint8Array([1, 2, 3]).buffer, {
        channel: 3,
        program: 7,
        registerWorklet(context) {
          state.events.push('worklet registered');
          state.workletContext = context;
        },
      });
      assert.deepEqual(state.events, []);
      sound.connect({context});
      await sound.ready;
      assert.deepEqual(state.bank, {bytes: [1, 2, 3], id: 'main'});
      assert.deepEqual(state.program, [3, 7]);
      sound.dispose();
      console.log(JSON.stringify(state.events));
    `);
    const output = execFileSync(process.execPath, [runner], {encoding: 'utf8'});
    expect(JSON.parse(output)).toEqual([
      'peer evaluated',
      'worklet registered',
      'synth created',
      'bank loaded',
      'synth connected',
      'synth destroyed',
    ]);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
