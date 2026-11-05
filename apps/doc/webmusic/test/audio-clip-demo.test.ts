// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import ts from 'typescript';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountDemos, type DemoScope} from '../src/components/demo-lifecycle';

const registrations: Array<() => void> = [];
const flush = async () => {for (let index = 0; index < 24; index++) await Promise.resolve();};
const urlMethods = ['createObjectURL', 'revokeObjectURL'].map(name => [name, Object.getOwnPropertyDescriptor(URL, name)] as const);
afterEach(() => {
  // Each test owns its demo registrations; a leftover one would mount the next test's DOM too.
  for (const stop of registrations.splice(0)) stop();
  document.body.replaceChildren();
  for (const [name, descriptor] of urlMethods) {
    if (descriptor) Object.defineProperty(URL, name, descriptor); else delete (URL as unknown as Record<string, unknown>)[name];
  }
  vi.restoreAllMocks();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {resolve = yes;});
  return {promise, resolve};
}
function runDemo(file: string, modules: Record<string, unknown>) {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../src/components/${file}.astro`), 'utf8')
    .match(/<script>([\s\S]*?)<\/script>/)![1];
  const code = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  modules['../demo-lifecycle'] = {mountDemos: (selector: string, setup: (root: HTMLElement, scope: DemoScope) => void) =>
    registrations.push(mountDemos(selector, setup))};
  modules['../playground-client'] = {PLAYGROUND_RESET_EVENT: 'webmusic:playground-reset'};
  new Function('require', 'exports', code)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  }, {});
}
function editor() {
  let snapshot = {content: {length: 16, sampleRate: 8000, channelLayout: ['mono'], segments: []}, assets: {}, contentId: 'initial',
    documentId: 'document', documentRevision: 0, status: 'ready'};
  const session = {getSnapshot: () => ({documentId: 'document', selection: {startFrame: 2, endFrame: 8}, disposed: false}),
    subscribe: vi.fn(() => vi.fn()), dispose: vi.fn()};
  return {
    getSnapshot: () => snapshot,
    getState: () => ({document: snapshot, dirty: true, processing: false, history: {undoCount: 0, redoCount: 0, historyOnlyBytes: 0}}),
    subscribeState: vi.fn((listener: () => void) => {listener(); return vi.fn();}),
    processRange: vi.fn(async (_request: unknown) => ({status: 'committed'})), cancelProcessing: vi.fn(),
    markSaved: vi.fn(), clearHistory: vi.fn(), execute: vi.fn(), createInteractionSession: () => session, dispose: vi.fn(),
    createCheckpoint: vi.fn(() => ({release: vi.fn()})), restoreCheckpoint: vi.fn(),
    replace: () => {snapshot = {...snapshot, contentId: 'changed', documentRevision: 1};},
  };
}
type Editor = ReturnType<typeof editor>;
async function mountWorkflow(initial: 'ready' | 'pending' = 'ready') {
  document.body.innerHTML = `<div data-wm-pg><section data-clip-demo data-clip-src="example.wav">
    <audio-player data-clip-player></audio-player><audio-clip-view data-clip-view></audio-clip-view>
    <p data-clip-status hidden></p>
  </section></div>`;
  const player = Object.assign(document.querySelector('[data-clip-player]')!, {editor: undefined as unknown});
  const view = Object.assign(document.querySelector('[data-clip-view]')!, {editor: undefined as unknown});
  const first = editor();
  const configured = deferred<Editor>();
  const headless = {loadAudioClipEditor: vi.fn<(...args: unknown[]) => Promise<Editor>>(() => configured.promise)};
  runDemo('elements/AudioClipViewDemo', {
    '@webmusic/audio/play/element': {defineAudioPlayerElement() {}},
    '@webmusic/audio/view/element': {defineAudioClipViewElement() {}},
    '@webmusic/audio/view/headless': headless,
    '@webmusic/audio/view': {AUDIO_RANGE_PROCESSOR_KINDS: ['normalize', 'reverse', 'invert', 'remove-dc'],
      createAudioRangeProcessor: vi.fn((kind: string) => ({id: kind}))},
    '@webmusic/audio': {readAudioSequenceRange: vi.fn()},
    '@webmusic/audio/analyze': {detectTempo: vi.fn(async () => ({bpm: 96.4321, grid: {beats: [0.5, 1.12]}}))},
  });
  if (initial === 'ready') { configured.resolve(first); await flush(); }
  return {first, configured, headless, view, player, status: document.querySelector<HTMLElement>('[data-clip-status]')!};
}

describe('Audio clip editing demo', () => {
  it('loads Arabesque with every built-in processor and lends one editor to both elements', async () => {
    const {first, headless, view, player} = await mountWorkflow();
    expect(headless.loadAudioClipEditor).toHaveBeenCalledWith('example.wav', expect.objectContaining({
      processors: [{id: 'normalize'}, {id: 'reverse'}, {id: 'invert'}, {id: 'remove-dc'}], signal: expect.any(AbortSignal),
    }));
    // The estimated grid is the saved starting state, not an undoable edit.
    expect(first.execute).toHaveBeenCalledWith(expect.objectContaining({label: 'Detect tempo',
      operations: [{type: 'set-beat-grid', grid: {bpm: 96.43, anchorFrame: 4000, beatsPerBar: 4}}]}));
    expect(first.clearHistory).toHaveBeenCalled();
    expect(first.markSaved).toHaveBeenCalled();
    expect(player.editor).toBe(first);
    expect(view.editor).toBe(first);
  });

  it('reloads on Reset, disposing the replaced editor after both elements detach from it', async () => {
    const {first, headless, view, player} = await mountWorkflow();
    const next = editor();
    headless.loadAudioClipEditor.mockResolvedValueOnce(next);
    first.dispose.mockImplementation(() => { expect(player.editor).not.toBe(first); expect(view.editor).not.toBe(first); });
    document.querySelector('[data-wm-pg]')!.dispatchEvent(new Event('webmusic:playground-reset'));
    await flush();
    expect(player.editor).toBe(next); expect(view.editor).toBe(next);
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it('disposes a superseded load and reports a failed one without narration otherwise', async () => {
    const {first, configured, headless, player, status} = await mountWorkflow('pending');
    const options = headless.loadAudioClipEditor.mock.calls[0][1] as {signal: AbortSignal};
    headless.loadAudioClipEditor.mockRejectedValueOnce(new Error('decode failed'));
    document.querySelector('[data-wm-pg]')!.dispatchEvent(new Event('webmusic:playground-reset'));
    await flush();
    expect(options.signal.aborted).toBe(true);
    configured.resolve(first); await flush();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(player.editor).toBeUndefined();
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('decode failed');
  });

  it('detaches both elements and disposes the owned editor at teardown', async () => {
    const {first, view, player} = await mountWorkflow();
    for (const stop of registrations.splice(0)) stop();
    expect(player.editor).toBeUndefined(); expect(view.editor).toBeUndefined();
    expect(first.cancelProcessing).toHaveBeenCalled();
    expect(first.dispose).toHaveBeenCalledOnce();
  });
});

describe('Audio editor Headless demo', () => {
  it('resets Headless input and releases the old editor, session and checkpoint', async () => {
    document.body.innerHTML = `<section data-audio-editor-demo><p data-summary></p><ul data-segments></ul><p data-last></p>
      <p data-hl-feedback></p><input data-limit value="100"><textarea data-operations>[]</textarea>
      <button data-action="checkpoint"></button><button data-action="restore"></button></section>`;
    const first = editor(), next = editor();
    const create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(next);
    const clip = {sampleRate: 44100};
    const excerpt = vi.fn(async () => clip);
    runDemo('headless/AudioClipEditorHeadlessDemo', {
      '@webmusic/audio': {audioSegmentLength: () => 0},
      '@webmusic/audio/view/headless': {createAudioClipEditor: create},
      './arabesque-audio': {loadArabesqueAudioExcerpt: excerpt},
    });
    await flush();
    // The demo edits the opening second of the Arabesque No. 1 recording.
    expect(excerpt).toHaveBeenCalledWith(1);
    expect(create.mock.calls[0][0]).toBe(clip);
    document.querySelector<HTMLButtonElement>('[data-action="restore"]')!.click();
    expect(document.querySelector('[data-hl-feedback]')!.textContent).toBe('Keep a checkpoint first.');
    expect(first.restoreCheckpoint).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-action="checkpoint"]')!.click();
    const checkpoint = first.createCheckpoint.mock.results[0].value;
    const operations = document.querySelector<HTMLTextAreaElement>('[data-operations]')!; operations.value = 'invalid JSON';
    document.querySelector<HTMLInputElement>('[data-limit]')!.value = '3';
    document.querySelector('[data-audio-editor-demo]')!.dispatchEvent(new Event('wm:headless-reset'));
    await flush();
    expect(operations.value).toBe('[]');
    expect(create.mock.calls[1][1]).toEqual({history: {limit: 100}});
    expect(checkpoint.release).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(first.createInteractionSession().dispose).toHaveBeenCalledOnce();
    expect(next.dispose).not.toHaveBeenCalled();
  });
});
