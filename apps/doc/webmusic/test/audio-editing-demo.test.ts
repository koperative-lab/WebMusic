// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import ts from 'typescript';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountDemos, type DemoScope} from '../src/components/demo-lifecycle';

const registrations: Array<() => void> = [];
const flush = async () => {for (let index = 0; index < 12; index++) await Promise.resolve();};
const urlMethods = ['createObjectURL', 'revokeObjectURL'].map(name => [name, Object.getOwnPropertyDescriptor(URL, name)] as const);
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
  let snapshot = {content: {length: 16, sampleRate: 8000, segments: []}, assets: {}, contentId: 'initial',
    documentId: 'document', documentRevision: 0, status: 'ready'};
  const session = {getSnapshot: () => ({documentId: 'document', selection: {startFrame: 2, endFrame: 8}, disposed: false}),
    subscribe: vi.fn(() => vi.fn()), dispose: vi.fn()};
  return {
    getSnapshot: () => snapshot,
    getState: () => ({document: snapshot, dirty: true, processing: false, history: {undoCount: 0, redoCount: 0, historyOnlyBytes: 0}}),
    subscribeState: vi.fn((listener: () => void) => {listener(); return vi.fn();}),
    processRange: vi.fn(async (_request: unknown) => ({status: 'committed'})), cancelProcessing: vi.fn(),
    markSaved: vi.fn(), createInteractionSession: () => session, dispose: vi.fn(),
    createCheckpoint: vi.fn(() => ({release: vi.fn()})), restoreCheckpoint: vi.fn(),
    replace: () => {snapshot = {...snapshot, contentId: 'changed', documentRevision: 1};},
  };
}
type Editor = ReturnType<typeof editor>;
async function mountWorkflow(initial: 'ready' | 'pending' = 'ready') {
  document.body.innerHTML = `<div data-wm-pg><section data-audio-edit-demo data-audio-edit-src="example.wav">
    <audio-player data-audio-edit-player></audio-player><audio-view data-audio-edit-view></audio-view>
    <p data-audio-edit-status></p><p data-audio-edit-result>Ready to edit.</p>
    <input data-audio-edit-import type="file"><button data-audio-edit-process="normalize"></button>
    <button data-audio-edit-cancel></button><button data-audio-edit-export></button><button data-audio-edit-restore></button>
  </section></div>`;
  const player = Object.assign(document.querySelector('[data-audio-edit-player]')!, {documentBinding: undefined as unknown, editor: undefined as unknown});
  const view = Object.assign(document.querySelector('[data-audio-edit-view]')!, {editor: undefined as unknown, interactionSession: undefined as unknown as ReturnType<Editor['createInteractionSession']>});
  const first = editor();
  const configured = deferred<Editor>();
  const headless = {
    loadAudioClipEditor: vi.fn<(...args: unknown[]) => Promise<Editor>>(() => configured.promise),
    createAudioClipEditor: vi.fn<(...args: unknown[]) => Editor>(() => editor()),
  };
  const io = {
    loadClip: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    exportAudioSequenceWav: vi.fn<(...args: unknown[]) => Promise<ArrayBuffer>>(),
  };
  runDemo('elements/AudioEditingDemo', {
    '@webmusic/audio/play/element': {defineAudioPlayerElement() {}},
    '@webmusic/audio/view/element': {defineAudioViewElement() {}},
    '@webmusic/audio/view/headless': headless,
    '@webmusic/audio/view': {createAudioRangeProcessor: vi.fn((kind: string) => ({id: kind}))},
    '@webmusic/audio/play': io,
  });
  if (initial === 'ready') {
    configured.resolve(first); await flush();
    view.interactionSession = first.createInteractionSession();
  }
  const upload = document.querySelector<HTMLInputElement>('[data-audio-edit-import]')!;
  const choose = (file: {name: string}) => {
    Object.defineProperty(upload, 'files', {configurable: true, value: [file]});
    upload.dispatchEvent(new Event('change'));
  };
  return {first, configured, headless, view, player, io, choose, result: document.querySelector('[data-audio-edit-result]')!};
}
afterEach(async () => {
  for (const stop of registrations.splice(0)) stop();
  document.body.replaceChildren(); await flush(); vi.restoreAllMocks();
  for (const [name, descriptor] of urlMethods) {
    if (descriptor) Object.defineProperty(URL, name, descriptor); else Reflect.deleteProperty(URL, name);
  }
});

describe('Audio editing workflow demo', () => {
  it('loads the configured URL with the demo processors and lends one editor to both elements', async () => {
    const {first, headless, view, player} = await mountWorkflow();
    expect(headless.loadAudioClipEditor).toHaveBeenCalledWith('example.wav', expect.objectContaining({
      processors: [{id: 'normalize'}, {id: 'reverse'}], signal: expect.any(AbortSignal),
    }));
    expect(player.editor).toBe(first);
    expect(view.editor).toBe(first);
    expect(document.querySelector('[data-audio-edit-status]')!.textContent).toContain('Document ready · 16 frames · revision 0');
  });

  it('rejects processing a selection from another document binding', async () => {
    const {first, view, result} = await mountWorkflow();
    const button = document.querySelector<HTMLButtonElement>('[data-audio-edit-process]')!;
    view.editor = editor();
    button.click(); await flush();
    expect(first.processRange).not.toHaveBeenCalled();
    expect(result.textContent).toContain('Bind the waveform to this audio document');
    view.editor = first;
    view.interactionSession.getSnapshot = () => ({documentId: 'foreign', selection: {startFrame: 2, endFrame: 8}, disposed: false});
    button.click(); await flush();
    expect(first.processRange).not.toHaveBeenCalled();
    view.interactionSession.getSnapshot = () => ({documentId: 'document', selection: {startFrame: 2, endFrame: 8}, disposed: false});
    button.click(); await flush();
    expect(first.processRange).toHaveBeenCalledWith(expect.objectContaining({documentId: 'document', startFrame: 2, endFrame: 8}));
  });

  it.each(['direct', 'wrapped'])('clears a %s transient error only when the matching revision is ready', async format => {
    const {player, io, choose, result} = await mountWorkflow();
    const error = Object.assign(new Error('Audio editor is unavailable.'), {code: 'not-ready'});
    const detail = format === 'direct' ? error : {error};
    player.dispatchEvent(new CustomEvent('webaudio:error', {bubbles: true, detail}));
    player.documentBinding = {status: 'ready', applied: {documentId: 'foreign', documentRevision: 0}};
    player.dispatchEvent(new Event('webaudio:documentstatechange'));
    expect(result.textContent).toBe(error.message);
    player.documentBinding = {status: 'ready', applied: {documentId: 'document', documentRevision: 0}};
    player.dispatchEvent(new Event('webaudio:documentstatechange'));
    expect(result.textContent).toBe('Ready to edit.');
    player.dispatchEvent(new CustomEvent('webaudio:error', {bubbles: true, detail}));
    io.loadClip.mockResolvedValue({length: 20}); choose({name: 'selected.wav'}); await flush();
    player.dispatchEvent(new Event('webaudio:documentstatechange'));
    expect(result.textContent).toBe('Imported selected.wav.');
  });

  it('replaces the editor on import and disposes the previous one after the elements detach from it', async () => {
    const {first, headless, view, player, io, choose, result} = await mountWorkflow();
    const clip = {length: 20}; io.loadClip.mockResolvedValue(clip);
    first.dispose.mockImplementation(() => {
      expect(player.editor).not.toBe(first); expect(view.editor).not.toBe(first);
    });
    choose({name: 'selected.wav'}); await flush();
    expect(headless.createAudioClipEditor).toHaveBeenCalledWith(clip, {processors: [{id: 'normalize'}, {id: 'reverse'}]});
    const imported = headless.createAudioClipEditor.mock.results[0].value as Editor;
    expect(player.editor).toBe(imported); expect(view.editor).toBe(imported);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(imported.dispose).not.toHaveBeenCalled();
    expect(result.textContent).toBe('Imported selected.wav.');
  });

  it('lets an import supersede the pending configured load and disposes its late editor', async () => {
    const {first, configured, headless, player, io, choose} = await mountWorkflow('pending');
    const options = headless.loadAudioClipEditor.mock.calls[0][1] as {signal: AbortSignal};
    io.loadClip.mockResolvedValue({length: 20}); choose({name: 'selected.wav'}); await flush();
    expect(options.signal.aborted).toBe(true);
    configured.resolve(first); await flush();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(player.editor).toBe(headless.createAudioClipEditor.mock.results[0].value);
  });

  it('aborts a pending import at Reset and reports a failed reload while keeping the current editor', async () => {
    const {first, headless, player, io, choose, result} = await mountWorkflow();
    const imported = deferred<unknown>();
    io.loadClip.mockReturnValue(imported.promise);
    choose({name: 'selected.wav'});
    const options = io.loadClip.mock.calls[0][1] as {signal: AbortSignal};
    let rejectReload!: (error: unknown) => void;
    headless.loadAudioClipEditor.mockReturnValueOnce(new Promise((_yes, no) => {rejectReload = no;}));
    document.querySelector('[data-wm-pg]')!.dispatchEvent(new Event('webmusic:playground-reset'));
    expect(options.signal.aborted).toBe(true);
    imported.resolve({length: 30}); await flush();
    expect(headless.createAudioClipEditor).not.toHaveBeenCalled();
    expect(result.textContent).toBe('Reloading configured source.');
    rejectReload(new Error('decode failed')); await flush();
    expect(result.textContent).toBe('Error: decode failed');
    expect(player.editor).toBe(first);
    expect(first.dispose).not.toHaveBeenCalled();
  });

  it('exports the retained snapshot without marking a newer root saved', async () => {
    const {first, io, result} = await mountWorkflow();
    const bytes = deferred<ArrayBuffer>(); io.exportAudioSequenceWav.mockReturnValue(bytes.promise);
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: vi.fn(() => 'blob:download')});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    document.querySelector<HTMLButtonElement>('[data-audio-edit-export]')!.click();
    first.replace(); bytes.resolve(new ArrayBuffer(44)); await flush();
    expect(first.markSaved).not.toHaveBeenCalled();
    expect(result.textContent).toContain('revision 0');
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
