// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const boundaries = vi.hoisted(() => ({runtime: vi.fn(), editor: vi.fn()}));
vi.mock('@webmusic/audio', () => ({createAudioClip: vi.fn(() => ({}))}));
vi.mock('@webmusic/bridge', () => ({createWebMusicProjectPlugins: () => []}));
vi.mock('@webmusic/kernel/module', () => ({
  ModuleAudioEnvironment: class {dispose = vi.fn();},
  ProjectPluginRegistry: class {register = vi.fn();},
  ModuleProjectRuntime: class {constructor() {return boundaries.runtime();}},
  createProjectEditorBinding: () => ({}),
  parseModuleProject: (value: unknown) => value,
  serializeModuleProject: JSON.stringify,
}));
vi.mock('@webmusic/ui/patch-editor', () => ({mountPatchEditor: boundaries.editor}));
import '../src/components/modular-project-demo-client';

const flush = async () => {for (let index = 0; index < 12; index++) await Promise.resolve();};
function deferred() {
  let resolve!: () => void, reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}
function makeRuntime() {
  const snapshot = {position: 0, rate: 1, paused: true, loop: null, participantCount: 2};
  return {
    session: {snapshot,
      seek: vi.fn(async (position: number) => {snapshot.position = position;}),
      setRate: vi.fn(async (rate: number) => {snapshot.rate = rate;}),
    },
    snapshot: () => ({modules: []}),
    exportProject: () => ({modules: [{id: 'lead', label: 'Melody'}]}),
    getMacro: () => undefined,
    getModule: () => undefined,
    subscribe: () => vi.fn(),
    restore: vi.fn(),
    dispose: vi.fn(),
  };
}
let runtime: ReturnType<typeof makeRuntime>;
let destroy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  runtime = makeRuntime(); destroy = vi.fn();
  boundaries.runtime.mockReturnValue(runtime);
  boundaries.editor.mockReturnValue({destroy});
});
afterEach(async () => {document.body.replaceChildren(); await flush(); vi.clearAllMocks();});

async function mount() {
  document.body.innerHTML = `<section data-project-demo>
    <button class="wui-btn" data-project-initialize>Open</button><div data-project-editor></div>
    <fieldset data-project-controls>
      <button data-project-play>Play</button><button data-project-pause>Pause</button><button data-project-stop>Stop</button>
      <input type="range" min="0" max="4" step="0.05" data-project-seek><output data-project-position></output>
      <select data-project-rate><option value="1">1</option><option value="1.25">1.25</option></select>
      <input type="checkbox" data-project-loop><input type="range" data-project-macro><output data-project-macro-value></output>
      <input data-project-name><output data-project-clock></output>
      <button data-project-save>Save</button><button data-project-load>Load</button><button data-project-export>Export</button>
      <input type="file" data-project-import><button data-project-missing>Missing</button><button data-project-recover>Recover</button><button data-project-reset>Reset</button>
    </fieldset><p data-project-feedback></p>
  </section><button data-outside>Outside</button>`;
  await flush();
  return document.querySelector<HTMLElement>('[data-project-demo]')!;
}
function change(input: HTMLInputElement | HTMLSelectElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', {bubbles: true}));
  input.dispatchEvent(new Event('change', {bubbles: true}));
}
function blurDisabled(control: HTMLInputElement | HTMLSelectElement) {
  // jsdom neither blurs on disable nor allows blur() in a disabled fieldset.
  const fieldset = control.closest('fieldset')!;
  fieldset.disabled = false; control.blur(); fieldset.disabled = true;
  expect(document.activeElement).toBe(document.body);
}

describe('modular project demo command focus', () => {
  it('hides and disables initialization and ignores synthetic reinitialization once ready', async () => {
    const root = await mount(), initialize = root.querySelector<HTMLButtonElement>('[data-project-initialize]')!;
    expect(initialize.hidden).toBe(true); expect(initialize.disabled).toBe(true);
    const name = root.querySelector<HTMLInputElement>('[data-project-name]')!;
    name.value = 'Edited melody'; name.focus();
    // dispatchEvent bypasses the browser's disabled-button click suppression.
    initialize.dispatchEvent(new MouseEvent('click', {bubbles: true})); await flush();
    expect(runtime.restore).not.toHaveBeenCalled();
    expect(name.value).toBe('Edited melody');
    expect(document.activeElement).toBe(name);
    expect(root.dataset.projectState).toBe('ready');
  });

  it('keeps the position range focused for consecutive keyboard-style seek changes', async () => {
    const root = await mount(), seek = root.querySelector<HTMLInputElement>('[data-project-seek]')!;
    seek.focus();
    for (const value of ['0.05', '0.1']) {
      change(seek, value);
      expect(root.querySelector('fieldset')!.disabled).toBe(true);
      blurDisabled(seek);
      await flush();
      expect(document.activeElement).toBe(seek);
      expect(root.querySelector('fieldset')!.disabled).toBe(false);
      expect(seek.value).toBe(value);
    }
    expect(runtime.session.seek.mock.calls).toEqual([[0.05], [0.1]]);
  });

  it('restores the focused speed select after a successful change', async () => {
    const root = await mount(), rate = root.querySelector<HTMLSelectElement>('[data-project-rate]')!;
    rate.focus(); change(rate, '1.25'); blurDisabled(rate); await flush();
    expect(runtime.session.setRate).toHaveBeenCalledWith(1.25);
    expect(document.activeElement).toBe(rate);
  });

  it('restores the initiating control on failure and keeps the error visible', async () => {
    const pending = deferred(); runtime.session.seek.mockReturnValueOnce(pending.promise);
    const root = await mount(), seek = root.querySelector<HTMLInputElement>('[data-project-seek]')!;
    seek.focus(); change(seek, '0.05'); blurDisabled(seek);
    pending.reject(new Error('Seek rejected')); await flush();
    expect(document.activeElement).toBe(seek);
    expect(root.querySelector('[data-project-feedback]')!.textContent).toBe('Seek rejected');
  });

  it.each([false, true])('retains outside focus after pending seek settlement (failed: %s)', async (failed) => {
    const pending = deferred(); runtime.session.seek.mockReturnValueOnce(pending.promise);
    const root = await mount(), seek = root.querySelector<HTMLInputElement>('[data-project-seek]')!;
    seek.focus(); change(seek, '0.05');
    const outside = document.querySelector<HTMLButtonElement>('[data-outside]')!; outside.focus();
    if (failed) pending.reject(new Error('Seek rejected')); else pending.resolve();
    await flush();
    expect(document.activeElement).toBe(outside);
  });

  it('does not restore focus after a pending demo has been removed', async () => {
    const pending = deferred(); runtime.session.seek.mockReturnValueOnce(pending.promise);
    const root = await mount(), seek = root.querySelector<HTMLInputElement>('[data-project-seek]')!;
    seek.focus(); change(seek, '0.05'); root.remove(); await flush();
    const outside = document.querySelector<HTMLButtonElement>('[data-outside]')!; outside.focus();
    pending.resolve(); await flush();
    expect(document.activeElement).toBe(outside);
    expect(runtime.dispose).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
  });
});
