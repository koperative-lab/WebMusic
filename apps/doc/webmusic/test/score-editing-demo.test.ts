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
    replace: () => {snapshot = {...snapshot, contentId: 'changed', documentRevision: 1};},
  };
}
function mount(notation = false) {
  document.body.innerHTML = `<div data-wm-pg><section data-editing-demo ${notation ? 'data-editing-notation' : ''}>
    <score-document data-editing-document src="example.mid"></score-document>
    <score-player data-editing-player></score-player><p data-editing-status></p><p data-editing-result>Ready to edit.</p>
    <input data-editing-import type="file"><button data-editing-export></button><button data-editing-restore></button>
    ${notation ? '<button data-editing-export-notation></button>' : ''}
  </section></div>`;
  const owner = Object.assign(document.querySelector('[data-editing-document]')!, {
    score: undefined as unknown, editor: editor(), status: 'loading', reload: vi.fn<() => Promise<unknown>>(),
  });
  const io = {loadScore: vi.fn<(...args: unknown[]) => Promise<unknown>>(), serializeMIDI: vi.fn(() => new Uint8Array([1])), serializeMusicXML: vi.fn(() => '<score-partwise />'),
    DEFAULT_LOAD_SCORE_LIMITS: {maxInputBytes: 32},
    assertScoreInputByteLength: (size: number, max: number) => {if (size > max) throw new Error('input limit');},
  };
  const modules: Record<string, unknown> = {
    '@webmusic/score/edit/element': {defineScoreDocumentElement() {}},
    '@webmusic/score/play/element': {defineScorePlayerElement() {}},
    '@webmusic/score/view/element': {defineScoreViewElement() {}},
    '@webmusic/score/io': io,
    '../playground-client': {PLAYGROUND_RESET_EVENT: 'webmusic:playground-reset'},
    '../demo-lifecycle': {mountDemos: (selector: string, setup: (root: HTMLElement, scope: DemoScope) => void) => registrations.push(mountDemos(selector, setup))},
  };
  new Function('require', 'exports', code)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  }, {});
  const upload = document.querySelector<HTMLInputElement>('[data-editing-import]')!;
  const choose = (file: {size: number; name: string; arrayBuffer(): Promise<ArrayBuffer>}) => {
    Object.defineProperty(upload, 'files', {configurable: true, value: [file]});
    upload.dispatchEvent(new Event('change'));
  };
  return {owner, io, choose, result: document.querySelector('[data-editing-result]')!};
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
  it('clears a transient binding error only after the current document is applied', () => {
    const {owner, result} = mount();
    const player = Object.assign(document.querySelector('[data-editing-player]')!, {documentBinding: {status: 'preparing', applied: undefined as unknown}});
    const error = Object.assign(new Error('Score editor is unavailable.'), {code: 'not-ready'});
    player.dispatchEvent(new CustomEvent('webscore:error', {bubbles: true, detail: {error}}));
    owner.status = 'ready'; owner.dispatchEvent(new Event('webscore:documentstatechange'));
    expect(result.textContent).toBe(error.message);
    player.documentBinding = {status: 'ready', applied: {documentId: 'other', documentRevision: 0}};
    player.dispatchEvent(new Event('webscore:documentstatechange'));
    expect(result.textContent).toBe(error.message);
    player.documentBinding.applied = {documentId: 'document', documentRevision: 0};
    player.dispatchEvent(new Event('webscore:documentstatechange'));
    expect(result.textContent).toBe('Ready to edit.');
  });

  it('preserves an import result when playback becomes ready after an earlier binding error', async () => {
    const {owner, io, choose, result} = mount();
    const player = Object.assign(document.querySelector('[data-editing-player]')!, {documentBinding: undefined as unknown});
    player.dispatchEvent(new CustomEvent('webscore:error', {bubbles: true,
      detail: {error: Object.assign(new Error('Score editor is unavailable.'), {code: 'not-ready'})}}));
    io.loadScore.mockResolvedValue({notes: ['new']});
    choose({size: 4, name: 'selected.mid', arrayBuffer: async () => new ArrayBuffer(4)}); await flush();
    owner.status = 'ready';
    player.documentBinding = {status: 'ready', applied: {documentId: 'document', documentRevision: 0}};
    player.dispatchEvent(new Event('webscore:documentstatechange'));
    expect(result.textContent).toBe('Imported selected.mid.');
  });

  it('keeps a selected import when the older URL becomes available during file reading', async () => {
    const {owner, io, choose, result} = mount();
    const bytes = deferred<ArrayBuffer>(); const imported = {notes: ['new']};
    io.loadScore.mockResolvedValue(imported);
    choose({size: 4, name: 'selected.mid', arrayBuffer: () => bytes.promise});
    owner.editor = editor(); owner.status = 'ready';
    owner.dispatchEvent(new Event('webmusic:sourcechange', {bubbles: true}));
    bytes.resolve(new ArrayBuffer(4)); await flush();
    expect(owner.score).toBe(imported);
    expect(result.textContent).toBe('Imported selected.mid.');
  });

  it('cancels parsing when a newer configured URL starts and ignores late results', async () => {
    const {owner, io, choose} = mount(); const pending = deferred<unknown>();
    io.loadScore.mockReturnValue(pending.promise);
    choose({size: 4, name: 'selected.mid', arrayBuffer: async () => new ArrayBuffer(4)});
    await flush();
    const options = io.loadScore.mock.calls[0][1] as {signal: AbortSignal};
    owner.setAttribute('src', 'replacement.mid'); owner.status = 'loading';
    owner.dispatchEvent(new Event('webscore:documentstatechange'));
    expect(options.signal.aborted).toBe(true);
    pending.resolve({notes: ['obsolete']}); await flush();
    expect(owner.score).toBeUndefined();
  });

  it('invalidates imports at Reset and reports a failed restore after settlement', async () => {
    const {owner, io, choose, result} = mount();
    const bytes = deferred<ArrayBuffer>(); const reload = deferred<unknown>();
    owner.reload.mockReturnValue(reload.promise);
    choose({size: 4, name: 'selected.mid', arrayBuffer: () => bytes.promise});
    document.querySelector('[data-wm-pg]')!.dispatchEvent(new Event('webmusic:playground-reset'));
    bytes.resolve(new ArrayBuffer(4)); await flush();
    expect(io.loadScore).not.toHaveBeenCalled();
    expect(result.textContent).toBe('Reloading the configured source.');
    reload.resolve({status: 'failed', error: new Error('download failed')}); await flush();
    expect(result.textContent).toBe('Error: download failed');
  });

  it('checks the input limit before reading a selected file', async () => {
    const {io, choose, result} = mount(); const read = vi.fn(async () => new ArrayBuffer(33));
    choose({size: 33, name: 'large.mid', arrayBuffer: read}); await flush();
    expect(read).not.toHaveBeenCalled(); expect(io.loadScore).not.toHaveBeenCalled();
    expect(result.textContent).toBe('input limit');
  });

  it('never marks a reentrantly changed root saved as though it was exported', () => {
    const {owner, io, result} = mount(); const snapshot = owner.editor.getSnapshot();
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: vi.fn(() => 'blob:download')});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => owner.editor.replace());
    document.querySelector<HTMLButtonElement>('[data-editing-export]')!.click();
    expect(io.serializeMIDI).toHaveBeenCalledWith(snapshot.content);
    expect(owner.editor.markSaved).not.toHaveBeenCalled();
    expect(result.textContent).toContain('revision 0');
  });

  it('keeps a notation document dirty on MIDI export and saves the same revision on MusicXML export', () => {
    const {owner, io, result} = mount(true);
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: vi.fn(() => 'blob:download')});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {downloads.push(this.download);});
    document.querySelector<HTMLButtonElement>('[data-editing-export]')!.click();
    expect(io.serializeMIDI).toHaveBeenCalledWith(owner.editor.getSnapshot().content);
    expect(owner.editor.markSaved).not.toHaveBeenCalled();
    expect(result.textContent).toContain('leaves the notation document unsaved');
    document.querySelector<HTMLButtonElement>('[data-editing-export-notation]')!.click();
    expect(io.serializeMusicXML).toHaveBeenCalledWith(owner.editor.getSnapshot().content, {ppq: 960});
    expect(owner.editor.markSaved).toHaveBeenCalledOnce();
    expect(downloads).toEqual(['edited-score.mid', 'edited-score.musicxml']);
    expect(result.textContent).toContain('MusicXML export requested for revision 0');
  });

  it('does not mark a replacement root saved by an earlier MusicXML export', () => {
    const {owner, result} = mount(true);
    Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: vi.fn(() => 'blob:download')});
    Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: vi.fn()});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => owner.editor.replace());
    document.querySelector<HTMLButtonElement>('[data-editing-export-notation]')!.click();
    expect(owner.editor.markSaved).not.toHaveBeenCalled();
    expect(result.textContent).toContain('MusicXML export requested for revision 0');
  });
});
