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
function mountWorkflow() {
  document.body.innerHTML = `<div data-wm-pg><section data-audio-edit-demo>
    <audio-document data-audio-edit-document src="example.wav"></audio-document>
    <audio-player data-audio-edit-player></audio-player><audio-view data-audio-edit-view></audio-view>
    <p data-audio-edit-status></p><p data-audio-edit-result>Ready to edit.</p>
    <input data-audio-edit-import type="file"><button data-audio-edit-process="normalize"></button>
    <button data-audio-edit-cancel></button><button data-audio-edit-export></button><button data-audio-edit-restore></button>
  </section></div>`;
  const owner = Object.assign(document.querySelector('[data-audio-edit-document]')!, {
    clip: undefined as unknown, editor: editor(), status: 'loading', reload: vi.fn<() => Promise<unknown>>(),
  });
  const player = Object.assign(document.querySelector('[data-audio-edit-player]')!, {documentBinding: undefined as unknown});
  const view = Object.assign(document.querySelector('[data-audio-edit-view]')!, {
    editor: owner.editor, interactionSession: owner.editor.createInteractionSession(),
  });
  const io = {loadClip: vi.fn<(...args: unknown[]) => Promise<unknown>>()};
  const edit = {createAudioRangeProcessor: vi.fn(), exportAudioSequenceWav: vi.fn<(...args: unknown[]) => Promise<ArrayBuffer>>()};
  runDemo('elements/AudioEditingDemo', {
    '@webmusic/audio/edit/element': {defineAudioDocumentElement() {}},
    '@webmusic/audio/play/element': {defineAudioPlayerElement() {}},
    '@webmusic/audio/view/element': {defineAudioViewElement() {}},
    '@webmusic/audio/play': io, '@webmusic/audio/edit': edit,
  });
  const upload = document.querySelector<HTMLInputElement>('[data-audio-edit-import]')!;
  const choose = (file: {name: string}) => {
    Object.defineProperty(upload, 'files', {configurable: true, value: [file]});
    upload.dispatchEvent(new Event('change'));
  };
  return {owner, view, player, io, edit, choose, result: document.querySelector('[data-audio-edit-result]')!};
}
afterEach(async () => {
  for (const stop of registrations.splice(0)) stop();
  document.body.replaceChildren(); await flush(); vi.restoreAllMocks();
  for (const [name, descriptor] of urlMethods) {
    if (descriptor) Object.defineProperty(URL, name, descriptor); else Reflect.deleteProperty(URL, name);
  }
});

describe('Audio editing workflow demo', () => {
  it('rejects processing a selection from another document binding', async () => {
    const {owner, view, result} = mountWorkflow();
    const button = document.querySelector<HTMLButtonElement>('[data-audio-edit-process]')!;
    view.editor = editor();
    button.click(); await flush();
    expect(owner.editor.processRange).not.toHaveBeenCalled();
    expect(result.textContent).toContain('Bind the waveform to this audio document');
    view.editor = owner.editor;
    view.interactionSession.getSnapshot = () => ({documentId: 'foreign', selection: {startFrame: 2, endFrame: 8}, disposed: false});
    button.click(); await flush();
    expect(owner.editor.processRange).not.toHaveBeenCalled();
    view.interactionSession.getSnapshot = () => ({documentId: 'document', selection: {startFrame: 2, endFrame: 8}, disposed: false});
    button.click(); await flush();
    expect(owner.editor.processRange).toHaveBeenCalledWith(expect.objectContaining({documentId: 'document', startFrame: 2, endFrame: 8}));
  });

  it.each(['direct', 'wrapped'])('clears a %s transient error only when the matching revision is ready', async format => {
    const {owner, player, io, choose, result} = mountWorkflow();
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
    owner.status = 'ready'; player.dispatchEvent(new Event('webaudio:documentstatechange'));
    expect(result.textContent).toBe('Imported selected.wav.');
  });

  it('aborts a pending import at Reset and ignores its late result', async () => {
    const {owner, io, choose, result} = mountWorkflow();
    const imported = deferred<unknown>(), reload = deferred<unknown>();
    io.loadClip.mockReturnValue(imported.promise); owner.reload.mockReturnValue(reload.promise);
    choose({name: 'selected.wav'});
    const options = io.loadClip.mock.calls[0][1] as {signal: AbortSignal};
    document.querySelector('[data-wm-pg]')!.dispatchEvent(new Event('webmusic:playground-reset'));
    expect(options.signal.aborted).toBe(true);
    imported.resolve({length: 30}); await flush();
    expect(owner.clip).toBeUndefined();
    expect(result.textContent).toBe('Reloading configured source.');
    reload.resolve({status: 'failed', error: new Error('decode failed')}); await flush();
    expect(result.textContent).toBe('Error: decode failed');
  });

  it('exports the retained snapshot without marking a newer root saved', async () => {
    const {owner, edit, result} = mountWorkflow();
    const bytes = deferred<ArrayBuffer>(); edit.exportAudioSequenceWav.mockReturnValue(bytes.promise);
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: vi.fn(() => 'blob:download')});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    document.querySelector<HTMLButtonElement>('[data-audio-edit-export]')!.click();
    owner.editor.replace(); bytes.resolve(new ArrayBuffer(44)); await flush();
    expect(owner.editor.markSaved).not.toHaveBeenCalled();
    expect(result.textContent).toContain('revision 0');
  });
});

describe('Audio document demo controls', () => {
  it('replaces stale Reset feedback and preserves a detailed reload failure', async () => {
    document.body.innerHTML = `<div data-wm-pg><section data-audio-document-demo><audio-document></audio-document>
      <p data-summary></p><p data-result>committed</p></section><button data-action="reload"></button></div>`;
    const owner = Object.assign(document.querySelector('audio-document')!, {editor: editor(), status: 'ready', reload: vi.fn<() => Promise<unknown>>()});
    runDemo('elements/AudioDocumentPlayground', {'@webmusic/audio/edit/element': {defineAudioDocumentElement() {}}});
    const result = document.querySelector('[data-result]')!;
    const reset = deferred<unknown>(); owner.reload.mockReturnValue(reset.promise);
    document.querySelector('[data-wm-pg]')!.dispatchEvent(new Event('webmusic:playground-reset')); await flush();
    expect(result.textContent).toBe('Reloading the configured source.');
    reset.resolve({status: 'ready'}); await flush(); expect(result.textContent).toBe('Reload: ready');
    owner.reload.mockResolvedValue({status: 'failed', error: new Error('decoding failed')});
    document.querySelector<HTMLButtonElement>('[data-action="reload"]')!.click(); await flush();
    expect(result.textContent).toBe('Error: decoding failed');
  });

  it('resets Headless input and releases the old editor, session and checkpoint', () => {
    document.body.innerHTML = `<section data-audio-editor-demo><p data-summary></p><ul data-segments></ul><p data-last></p>
      <p data-hl-feedback></p><input data-limit value="100"><textarea data-operations>[]</textarea>
      <button data-action="checkpoint"></button><button data-action="restore"></button></section>`;
    const first = editor(), next = editor();
    const create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(next);
    runDemo('headless/AudioClipEditorHeadlessDemo', {
      '@webmusic/audio': {createAudioClip: (value: unknown) => value, audioSegmentLength: () => 0},
      '@webmusic/audio/edit/headless': {createAudioClipEditor: create},
    });
    document.querySelector<HTMLButtonElement>('[data-action="restore"]')!.click();
    expect(document.querySelector('[data-hl-feedback]')!.textContent).toBe('Keep a checkpoint first.');
    expect(first.restoreCheckpoint).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-action="checkpoint"]')!.click();
    const checkpoint = first.createCheckpoint.mock.results[0].value;
    const operations = document.querySelector<HTMLTextAreaElement>('[data-operations]')!; operations.value = 'invalid JSON';
    document.querySelector<HTMLInputElement>('[data-limit]')!.value = '3';
    document.querySelector('[data-audio-editor-demo]')!.dispatchEvent(new Event('wm:headless-reset'));
    expect(operations.value).toBe('[]');
    expect(create.mock.calls[1][1]).toEqual({history: {limit: 100}});
    expect(checkpoint.release).toHaveBeenCalledOnce();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(first.createInteractionSession().dispose).toHaveBeenCalledOnce();
    expect(next.dispose).not.toHaveBeenCalled();
  });
});
