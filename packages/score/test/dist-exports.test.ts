import {existsSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

// Regression guard for the bundled output: these tests exercise the BUILT
// dist files, unlike the other suites which import src/. They catch entries
// that bundle to empty barrels (the esbuild static-enumeration class of bug
// that unit tests over src can never see) and subpath entries whose dist
// files drift from the exports map.
const distIndex = new URL('../dist/index.js', import.meta.url);
const hasDist = existsSync(distIndex);

const entry = (relative: string) => import(new URL(`../dist/${relative}`, import.meta.url).href);

describe.skipIf(!hasDist)('@webmusic/score built dist', () => {
  it('root exposes the core model', async () => {
    const root = await entry('index.js');
    expect(typeof root.Score).toBe('function');
    expect(typeof root.ScoreBuilder).toBe('function');
  });

  it('io entries are populated', async () => {
    const io = await entry('io/index.js');
    expect(typeof io.parseMusicXML).toBe('function');
    expect(Object.keys(await entry('io/load.js')).length).toBeGreaterThan(0);
    expect(Object.keys(await entry('io/formats/index.js')).length).toBeGreaterThan(0);
    const workerClient = await entry('io/worker-client.js');
    expect(typeof workerClient.createParserWorker).toBe('function');
    expect(Object.keys(await entry('io/worker-protocol.js')).length).toBeGreaterThan(0);
  });

  it('view entries are populated', async () => {
    const view = await entry('view/index.js');
    expect(typeof view.scoreToNoteSequence).toBe('function');
    expect(Object.keys(await entry('view/headless/index.js')).length).toBeGreaterThan(0);
    expect(Object.keys(await entry('view/render/index.js')).length).toBeGreaterThan(0);
    expect(Object.keys(await entry('view/element/index.js')).length).toBeGreaterThan(0);
  });

  it('play entries are populated', async () => {
    const play = await entry('play/index.js');
    expect(Object.keys(play).length).toBeGreaterThan(0);
    const headless = await entry('play/headless/index.js');
    expect(typeof headless.ScorePlayer).toBe('function');
    expect(Object.keys(await entry('play/drivers.js')).length).toBeGreaterThan(0);
    expect(Object.keys(await entry('play/element/index.js')).length).toBeGreaterThan(0);
    expect(Object.keys(await entry('play/demos/index.js')).length).toBeGreaterThan(0);
  });

  it('analyze entries are populated', async () => {
    const analyze = await entry('analyze/index.js');
    expect(typeof analyze.detectKey).toBe('function');
    const headless = await entry('analyze/headless/index.js');
    expect(typeof headless.createAnalysisSession).toBe('function');
    const workerClient = await entry('analyze/worker-client.js');
    expect(typeof workerClient.createAnalysisWorker).toBe('function');
    expect(Object.keys(await entry('analyze/element/index.js')).length).toBeGreaterThan(0);
  });

  it('react entry is populated', async () => {
    expect(Object.keys(await entry('react/index.js')).length).toBeGreaterThan(0);
  });
});
