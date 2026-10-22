import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

// Regression guard for the bundled output: these tests exercise the BUILT
// dist files, unlike the other suites which import src/. They catch entries
// that bundle to empty barrels (the esbuild static-enumeration class of bug
// that unit tests over src can never see) and subpath entries whose dist
// files drift from the exports map.
const distIndex = new URL('../dist/index.js', import.meta.url);
const hasDist = existsSync(distIndex);

const entry = (relative: string) => import(new URL(`../dist/${relative}`, import.meta.url).href);
const requireBuilt = createRequire(import.meta.url);

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

  it.each(['js', 'cjs'])('edit entries share Core values and execute a document transaction (%s)', async (extension) => {
    const load = (name: string) => extension === 'js' ? entry(`${name}.js`) : requireBuilt(fileURLToPath(new URL(`../dist/${name}.cjs`, import.meta.url)));
    const root = await load('index');
    const edit = await load('edit/index');
    const headless = await load('edit/headless/index');
    expect(edit.ScoreEditor).toBe(headless.ScoreEditor);
    expect(edit.ScoreEditError).toBe(root.ScoreEditError);
    const builder = new root.ScoreBuilder();
    builder.addPart({id: root.PartId('p'), name: 'Piano'});
    const score = builder.build();
    const editor = headless.createScoreEditor(score);
    expect(editor.transaction('Insert', (tx: {add(operation: unknown): void}) => tx.add({
      type: 'insert-notes', notes: [{id: root.NoteId('n'), partId: root.PartId('p'),
        pitch: {step: 'C', alter: 0, octave: 4}, onsetQuarters: [0, 1], durationQuarters: [1, 1], voice: root.VoiceId('v')}],
    })).status).toBe('committed');
    expect(editor.score.getNote(root.NoteId('n')).pitch.midi).toBe(60);
    expect(editor.undo().status).toBe('committed');
    expect(editor.score).toBe(score);
    editor.dispose();
  });

  it('view entries are populated', async () => {
    const view = await entry('view/index.js');
    expect(typeof view.scoreToNoteSequence).toBe('function');
    expect(Object.keys(await entry('view/headless/index.js')).length).toBeGreaterThan(0);
    expect(Object.keys(await entry('view/render/index.js')).length).toBeGreaterThan(0);
    expect(Object.keys(await entry('view/element/index.js')).length).toBeGreaterThan(0);
  });

  it.each(['js', 'cjs'])('staff input composes built Core, Edit and View values (%s)', async (extension) => {
    const load = (name: string) => extension === 'js' ? entry(`${name}.js`) : requireBuilt(fileURLToPath(new URL(`../dist/${name}.cjs`, import.meta.url)));
    const root = await load('index');
    const edit = await load('edit/headless/index');
    const view = await load('view/headless/index');
    const render = await load('view/render/index');
    expect(typeof render.mountStaffEditor).toBe('function');
    const builder = new root.ScoreBuilder();
    builder.addPart({id: root.PartId('staff-part'), name: 'Piano'});
    builder.addMeasure({id: root.MeasureId('bar'), number: 1, onsetQuarters: root.Rational.ZERO,
      durationQuarters: new root.Rational(4)});
    const editor = edit.createScoreEditor(builder.build());
    const editing = view.createScoreViewEditing(editor, {editable: true});
    const staff = view.createStaffViewEditing(editing);
    staff.setDuration([1, 1], 1);
    expect(staff.insertPitch('D').status).toBe('committed');
    expect(editor.score.notes[0].duration.quarters.toJSON()).toEqual([3, 2]);
    expect(editor.score.parts[0].notes.some((note: {rest: boolean}) => note.rest)).toBe(true);
    expect(staff.undo().status).toBe('committed');
    expect(editor.score.parts[0].notes).toHaveLength(0);
    staff.dispose(); editing.dispose(); editor.dispose();
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
