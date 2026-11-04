// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import ts from 'typescript';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountDemos, type DemoScope} from '../src/components/demo-lifecycle';

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/components/elements/ScoreEditingDemo.astro'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)![1];
const code = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
const registrations: Array<() => void> = [];
const urlMethods = ['createObjectURL', 'revokeObjectURL'].map((name) => [name, Object.getOwnPropertyDescriptor(URL, name)] as const);
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {resolve = yes;});
  return {promise, resolve};
}
function editor() {
  let snapshot = {content: {notes: []}, contentId: 'initial', documentId: 'document', documentRevision: 0, status: 'ready'};
  return {
    getSnapshot: () => snapshot,
    getState: () => ({document: snapshot, dirty: true}),
    subscribeState: vi.fn((listener: () => void) => {listener(); return vi.fn();}),
    markSaved: vi.fn(),
    dispose: vi.fn(),
    replace: () => {snapshot = {...snapshot, contentId: 'changed', documentRevision: 1};},
  };
}
type Editor = ReturnType<typeof editor>;
async function mount(notation = false, initial: 'ready' | 'pending' = 'ready') {
  document.body.innerHTML = `<div data-wm-pg><section data-editing-demo data-editing-src="example.mid" ${notation ? 'data-editing-notation' : ''}>
    <score-player data-editing-player></score-player><score-view data-editing-roll></score-view><score-view data-editing-staff></score-view>
    <p data-editing-status></p><p data-editing-result>Ready to edit.</p>
    <input data-editing-import type="file"><button data-editing-export></button><button data-editing-restore></button>
    ${notation ? '<button data-editing-export-notation></button>' : ''}
  </section></div>`;
  const player = Object.assign(document.querySelector('[data-editing-player]')!, {documentBinding: undefined as unknown, editor: undefined as unknown});
  const views = [...document.querySelectorAll('score-view')].map((view) => Object.assign(view, {editor: undefined as unknown}));
  const first = editor();
  const configured = deferred<Editor>();
  const headless = {
    loadScoreEditor: vi.fn<(...args: unknown[]) => Promise<Editor>>(() => configured.promise),
    createScoreEditor: vi.fn<(...args: unknown[]) => Editor>(() => editor()),
  };
  const io = {loadScore: vi.fn<(...args: unknown[]) => Promise<unknown>>(), serializeMIDI: vi.fn(() => new Uint8Array([1])), serializeMusicXML: vi.fn(() => '<score-partwise />'),
    DEFAULT_LOAD_SCORE_LIMITS: {maxInputBytes: 32},
    assertScoreInputByteLength: (size: number, max: number) => {if (size > max) throw new Error('input limit');},
  };
  const modules: Record<string, unknown> = {
    '@webmusic/score/play/element': {defineScorePlayerElement() {}},
    '@webmusic/score/view/element': {defineScoreViewElement() {}},
    '@webmusic/score/view/headless': headless,
    '@webmusic/score/io': io,
    '../playground-client': {PLAYGROUND_RESET_EVENT: 'webmusic:playground-reset'},
    '../demo-lifecycle': {mountDemos: (selector: string, setup: (root: HTMLElement, scope: DemoScope) => void) => registrations.push(mountDemos(selector, setup))},
  };
  new Function('require', 'exports', code)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  }, {});
  if (initial === 'ready') { configured.resolve(first); await flush(); }
  const upload = document.querySelector<HTMLInputElement>('[data-editing-import]')!;
  const choose = (file: {size: number; name: string; arrayBuffer(): Promise<ArrayBuffer>}) => {
    Object.defineProperty(upload, 'files', {configurable: true, value: [file]});
    upload.dispatchEvent(new Event('change'));
  };
  return {first, configured, headless, player, views, io, choose, result: document.querySelector('[data-editing-result]')!};
}
afterEach(async () => {
  for (const stop of registrations.splice(0)) stop();
  document.body.replaceChildren(); await flush(); vi.restoreAllMocks();
  for (const [name, descriptor] of urlMethods) {
    if (descriptor) Object.defineProperty(URL, name, descriptor);
    else Reflect.deleteProperty(URL, name);
  }
});

describe('Score editing workflow demo', () => {
  it('loads the configured URL and lends one editor to the player and both views', async () => {
    const {first, headless, player, views} = await mount();
    expect(headless.loadScoreEditor).toHaveBeenCalledWith('example.mid', {signal: expect.any(AbortSignal)});
    expect(player.editor).toBe(first);
    for (const view of views) expect(view.editor).toBe(first);
    expect(document.querySelector('[data-editing-status]')!.textContent).toContain('Document ready · 0 notes · revision 0');
  });

  it('clears a transient binding error only after the current document is applied', async () => {
    const {result} = await mount();
    const player = Object.assign(document.querySelector('[data-editing-player]')!, {documentBinding: {status: 'preparing', applied: undefined as unknown}});
    const error = Object.assign(new Error('Score editor is unavailable.'), {code: 'not-ready'});
    player.dispatchEvent(new CustomEvent('webscore:error', {bubbles: true, detail: {error}}));
    expect(result.textContent).toBe(error.message);
    player.documentBinding = {status: 'ready', applied: {documentId: 'other', documentRevision: 0}};
    player.dispatchEvent(new Event('webscore:documentstatechange'));
    expect(result.textContent).toBe(error.message);
    player.documentBinding.applied = {documentId: 'document', documentRevision: 0};
    player.dispatchEvent(new Event('webscore:documentstatechange'));
    expect(result.textContent).toBe('Ready to edit.');
  });

  it('preserves an import result when playback becomes ready after an earlier binding error', async () => {
    const {player, io, choose, result} = await mount();
    player.dispatchEvent(new CustomEvent('webscore:error', {bubbles: true,
      detail: {error: Object.assign(new Error('Score editor is unavailable.'), {code: 'not-ready'})}}));
    io.loadScore.mockResolvedValue({notes: ['new']});
    choose({size: 4, name: 'selected.mid', arrayBuffer: async () => new ArrayBuffer(4)}); await flush();
    player.documentBinding = {status: 'ready', applied: {documentId: 'document', documentRevision: 0}};
    player.dispatchEvent(new Event('webscore:documentstatechange'));
    expect(result.textContent).toBe('Imported selected.mid.');
  });

  it('replaces the editor on import and disposes the previous one after the elements detach from it', async () => {
    const {first, headless, player, views, io, choose, result} = await mount();
    const imported = {notes: ['new']}; io.loadScore.mockResolvedValue(imported);
    first.dispose.mockImplementation(() => {
      expect(player.editor).not.toBe(first);
      for (const view of views) expect(view.editor).not.toBe(first);
    });
    choose({size: 4, name: 'selected.mid', arrayBuffer: async () => new ArrayBuffer(4)}); await flush();
    expect(headless.createScoreEditor).toHaveBeenCalledWith(imported);
    const next = headless.createScoreEditor.mock.results[0].value as Editor;
    expect(player.editor).toBe(next);
    for (const view of views) expect(view.editor).toBe(next);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(result.textContent).toBe('Imported selected.mid.');
  });

  it('keeps a selected import when the configured URL finishes loading during file reading', async () => {
    const {first, configured, headless, player, io, choose, result} = await mount(false, 'pending');
    const bytes = deferred<ArrayBuffer>(); io.loadScore.mockResolvedValue({notes: ['new']});
    const options = headless.loadScoreEditor.mock.calls[0][1] as {signal: AbortSignal};
    choose({size: 4, name: 'selected.mid', arrayBuffer: () => bytes.promise});
    expect(options.signal.aborted).toBe(true);
    configured.resolve(first); await flush();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(player.editor).toBeUndefined();
    bytes.resolve(new ArrayBuffer(4)); await flush();
    expect(player.editor).toBe(headless.createScoreEditor.mock.results[0].value);
    expect(result.textContent).toBe('Imported selected.mid.');
  });

  it('cancels parsing when a reload starts and ignores late results', async () => {
    const {first, headless, player, io, choose} = await mount(); const pending = deferred<unknown>();
    io.loadScore.mockReturnValue(pending.promise);
    choose({size: 4, name: 'selected.mid', arrayBuffer: async () => new ArrayBuffer(4)});
    await flush();
    const options = io.loadScore.mock.calls[0][1] as {signal: AbortSignal};
    const reloaded = editor(); headless.loadScoreEditor.mockResolvedValueOnce(reloaded);
    document.querySelector<HTMLButtonElement>('[data-editing-restore]')!.click();
    expect(options.signal.aborted).toBe(true);
    pending.resolve({notes: ['obsolete']}); await flush();
    expect(headless.createScoreEditor).not.toHaveBeenCalled();
    expect(player.editor).toBe(reloaded);
    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it('invalidates imports at Reset and reports a failed restore while keeping the current editor', async () => {
    const {first, headless, player, io, choose, result} = await mount();
    const bytes = deferred<ArrayBuffer>();
    let rejectReload!: (error: unknown) => void;
    headless.loadScoreEditor.mockReturnValueOnce(new Promise((_yes, no) => {rejectReload = no;}));
    choose({size: 4, name: 'selected.mid', arrayBuffer: () => bytes.promise});
    document.querySelector('[data-wm-pg]')!.dispatchEvent(new Event('webmusic:playground-reset'));
    bytes.resolve(new ArrayBuffer(4)); await flush();
    expect(io.loadScore).not.toHaveBeenCalled();
    expect(result.textContent).toBe('Reloading the configured source.');
    rejectReload(new Error('download failed')); await flush();
    expect(result.textContent).toBe('Error: download failed');
    expect(player.editor).toBe(first);
    expect(first.dispose).not.toHaveBeenCalled();
  });

  it('checks the input limit before reading a selected file', async () => {
    const {io, choose, result} = await mount(); const read = vi.fn(async () => new ArrayBuffer(33));
    choose({size: 33, name: 'large.mid', arrayBuffer: read}); await flush();
    expect(read).not.toHaveBeenCalled(); expect(io.loadScore).not.toHaveBeenCalled();
    expect(result.textContent).toBe('input limit');
  });

  it('never marks a reentrantly changed root saved as though it was exported', async () => {
    const {first, io, result} = await mount(); const snapshot = first.getSnapshot();
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: vi.fn(() => 'blob:download')});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => first.replace());
    document.querySelector<HTMLButtonElement>('[data-editing-export]')!.click();
    expect(io.serializeMIDI).toHaveBeenCalledWith(snapshot.content);
    expect(first.markSaved).not.toHaveBeenCalled();
    expect(result.textContent).toContain('revision 0');
  });

  it('keeps a notation document dirty on MIDI export and saves the same revision on MusicXML export', async () => {
    const {first, io, result} = await mount(true);
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: vi.fn(() => 'blob:download')});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {downloads.push(this.download);});
    document.querySelector<HTMLButtonElement>('[data-editing-export]')!.click();
    expect(io.serializeMIDI).toHaveBeenCalledWith(first.getSnapshot().content);
    expect(first.markSaved).not.toHaveBeenCalled();
    expect(result.textContent).toContain('leaves the notation document unsaved');
    document.querySelector<HTMLButtonElement>('[data-editing-export-notation]')!.click();
    expect(io.serializeMusicXML).toHaveBeenCalledWith(first.getSnapshot().content, {ppq: 960});
    expect(first.markSaved).toHaveBeenCalledOnce();
    expect(downloads).toEqual(['edited-score.mid', 'edited-score.musicxml']);
    expect(result.textContent).toContain('MusicXML export requested for revision 0');
  });

  it('does not mark a replacement root saved by an earlier MusicXML export', async () => {
    const {first, result} = await mount(true);
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: vi.fn(() => 'blob:download')});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => first.replace());
    document.querySelector<HTMLButtonElement>('[data-editing-export-notation]')!.click();
    expect(first.markSaved).not.toHaveBeenCalled();
    expect(result.textContent).toContain('MusicXML export requested for revision 0');
  });

  it('detaches every element and disposes the owned editor at teardown', async () => {
    const {first, player, views} = await mount();
    for (const stop of registrations.splice(0)) stop();
    expect(player.editor).toBeUndefined();
    for (const view of views) expect(view.editor).toBeUndefined();
    expect(first.dispose).toHaveBeenCalledOnce();
  });
});
