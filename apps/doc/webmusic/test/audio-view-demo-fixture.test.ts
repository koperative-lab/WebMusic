// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import ts from 'typescript';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../../../packages/audio/src/core';
import {computePeaks} from '../../../../packages/audio/src/analyze/core/peaks';
import {acquireAudioViewFixture, whenDemoVisible} from '../src/components/audio-view-fixture';
import {mountDemos} from '../src/components/demo-lifecycle';
import {mountPlaygrounds} from '../src/components/playground-client';

const mocks = vi.hoisted(() => ({decode: vi.fn(), disposeDecode: vi.fn(), analyze: vi.fn(), disposeAnalysis: vi.fn()}));
vi.mock('@webmusic/audio/play', () => ({createDecoderWorker: () => ({decodeFromUrl: mocks.decode, dispose: mocks.disposeDecode})}));
vi.mock('@webmusic/audio/analyze', () => ({createAnalysisWorker: () => ({analyze: mocks.analyze, dispose: mocks.disposeAnalysis})}));
vi.mock('@webmusic/audio', async () => import('../../../../packages/audio/src/core'));

const releases: Array<() => void> = [];
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const spectrum = {times: new Float32Array([0]), frequencies: new Float32Array([0]), magnitudes: new Float32Array([1]), binsPerFrame: 1};
const clip = createAudioClip({sampleRate: 8, channelData: [new Float32Array([.25, .5, -.75, -1]), new Float32Array([-.25, .75, -.5, 1])]});
function fixture(url = '/fixture.wav') {
  const value = acquireAudioViewFixture(url);
  releases.push(() => value.release());
  return value;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.decode.mockResolvedValue(clip);
  mocks.analyze.mockImplementation(async (input, options) => ({
    peaks: computePeaks(input.channels(), input.sampleRate, {baseSamplesPerPeak: 2}),
    loudness: {rms: 0, truePeakDb: 0, integratedLufs: 0},
    ...(options.tasks.includes('spectrogram') ? {spectrogram: spectrum} : {}),
  }));
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  document.body.replaceChildren();
  await flush();
  vi.unstubAllGlobals();
});

describe('Audio View shared demo fixture', () => {
  it('does no work on acquire and shares one worker decode/pyramid without eager spectral requests', async () => {
    const first = fixture();
    const second = fixture();
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
    const [firstClip, secondClip, firstPeaks, secondPeaks] = await Promise.all([first.clip(), second.clip(), first.peaks(), second.peaks()]);
    expect(firstClip).toBe(secondClip);
    expect(firstPeaks).toBe(secondPeaks);
    expect(mocks.decode).toHaveBeenCalledOnce();
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(mocks.analyze.mock.calls[0][1].tasks).toEqual(['peaks']);
    expect(mocks.disposeDecode).toHaveBeenCalledOnce();
    first.release();
    expect(mocks.disposeAnalysis).not.toHaveBeenCalled();
    second.release(); second.release();
    expect(mocks.disposeAnalysis).toHaveBeenCalledOnce();
  });

  it('shares lazy spectra by channel and resolution without decoding again', async () => {
    const first = fixture(); const second = fixture();
    await first.peaks();
    const [a, b] = await Promise.all([first.spectrum(), second.spectrum()]);
    expect(a).toBe(b);
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    await first.spectrum('left', true);
    expect(mocks.analyze.mock.calls[2][1]).toEqual({tasks: ['spectrogram'], fftSize: 1024, hopSize: 256});
    expect(mocks.decode).toHaveBeenCalledOnce();
  });

  it('reorders the existing L/R peaks and computes Mid/Side only when requested', async () => {
    const value = fixture();
    const peaks = await value.peaks(['right', 'left']);
    const source = clip.channels()!;
    expect(peaks).toEqual(computePeaks([source[1], source[0]], clip.sampleRate, {baseSamplesPerPeak: 2}));
    expect(mocks.analyze).toHaveBeenCalledOnce();
    const mid = await value.peaks(['mid']);
    expect(mid).toEqual(computePeaks([Float32Array.from(source[0], (v, i) => (v + source[1][i]) / 2)], clip.sampleRate, {baseSamplesPerPeak: 2}));
    expect(await value.peaks(['mid'])).toBe(mid);
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
  });

  it('aborts the last borrower and rejects late decode before starting analysis', async () => {
    let resolve!: (value: typeof clip) => void;
    mocks.decode.mockReturnValue(new Promise((yes) => { resolve = yes; }));
    const value = fixture();
    const pending = value.peaks();
    const rejection = expect(pending).rejects.toMatchObject({name: 'AbortError'});
    value.release();
    expect(mocks.decode.mock.calls[0][2].signal.aborted).toBe(true);
    expect(mocks.disposeDecode).toHaveBeenCalledOnce();
    resolve(clip);
    await rejection;
    expect(mocks.analyze).not.toHaveBeenCalled();
    mocks.decode.mockResolvedValue(clip);
    expect(await fixture().clip()).toBe(clip);
    expect(mocks.decode).toHaveBeenCalledTimes(2);
  });
});

describe('optional Audio View demo activation', () => {
  it('waits offscreen, activates on keyboard focus once, and disconnects on removal', async () => {
    let callback!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(input: IntersectionObserverCallback) { callback = input; }
      observe = vi.fn(); disconnect = disconnect;
    });
    document.body.innerHTML = '<div data-optional><button>Focus demo</button></div>';
    const start = vi.fn(async () => {});
    releases.push(mountDemos('[data-optional]', (root, scope) => whenDemoVisible(root, scope, start)));
    expect(start).not.toHaveBeenCalled();
    document.querySelector('button')!.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
    callback([{isIntersecting: true}] as IntersectionObserverEntry[], {} as IntersectionObserver);
    expect(start).toHaveBeenCalledOnce();
    document.body.replaceChildren();
    await flush();
    callback([{isIntersecting: true}] as IntersectionObserverEntry[], {} as IntersectionObserver);
    expect(start).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalled();
  });

  it('does not activate after a pending offscreen scope is aborted', () => {
    let callback!: IntersectionObserverCallback;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(input: IntersectionObserverCallback) { callback = input; }
      observe = vi.fn(); disconnect = vi.fn();
    });
    document.body.innerHTML = '<div data-optional></div>';
    const start = vi.fn(async () => {});
    releases.push(mountDemos('[data-optional]', (root, scope) => whenDemoVisible(root, scope, start)));
    window.dispatchEvent(new Event('pagehide'));
    callback([{isIntersecting: true}] as IntersectionObserverEntry[], {} as IntersectionObserver);
    expect(start).not.toHaveBeenCalled();
  });
});

/** Run the actual Astro client wiring with the public Element boundaries mocked. */
function runDemo(name: string): void {
  const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/components', `${name}.astro`), 'utf8')
    .match(/<script>([\s\S]*?)<\/script>/)![1].replaceAll('import.meta.env.BASE_URL', "'/'");
  const code = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
  const modules: Record<string, unknown> = {
    '@webmusic/audio/play/element': {defineAudioPlayerElement() {}},
    '@webmusic/audio/view/element': {defineAudioViewElement() {}},
    './demo-lifecycle': {mountDemos: (...args: Parameters<typeof mountDemos>) => { releases.push(mountDemos(...args)); }},
    './audio-view-fixture': {acquireAudioViewFixture, whenDemoVisible},
    './playground-client': {PLAYGROUND_RESET_EVENT: 'webmusic:playground-reset'},
  };
  new Function('require', 'exports', code)((name: string) => {
    if (!(name in modules)) throw new Error(`Unexpected module ${name}`);
    return modules[name];
  }, {});
}

describe('actual Audio View demo wiring', () => {
  it('shows initial peaks without spectral work, then ignores superseded spectral completion', async () => {
    document.body.innerHTML = '<div data-wm-pg><div data-audio-view-demo><audio-player></audio-player><audio-view type="waveform" interactive drag-mode="scrub"></audio-view><p data-drag-help></p><p data-view-status></p></div></div>';
    const view = document.querySelector('audio-view')! as HTMLElement & {type: string; peaks?: unknown; spectrogram?: unknown};
    Object.defineProperty(view, 'type', {get: () => view.getAttribute('type'), set: (value) => view.setAttribute('type', value)});
    const player = document.querySelector('audio-player')! as HTMLElement & {stop(): void; clip?: unknown};
    player.stop = vi.fn();
    runDemo('AudioViewDemo');
    await flush();
    expect(mocks.decode.mock.calls[0][0]).toBe('/wav/Arabesque%20No.1.wav');
    expect(view.peaks).toBeDefined();
    expect(player.clip).toBe(clip);
    expect(mocks.analyze).toHaveBeenCalledOnce();
    expect(mocks.analyze.mock.calls[0][1].tasks).toEqual(['peaks']);
    const help = document.querySelector<HTMLElement>('[data-drag-help]')!;
    expect(help.textContent).toContain('left toward later audio');
    view.setAttribute('drag-mode', 'pan');
    await flush();
    expect(help.textContent).toContain('Playback is unchanged');
    view.setAttribute('scrollable', 'false');
    await flush();
    expect(help.textContent).toContain('Panning is disabled');
    view.setAttribute('annotate', '');
    await flush();
    expect(help.textContent).toContain('Annotation takes priority');
    expect(mocks.analyze).toHaveBeenCalledOnce();
    view.removeAttribute('annotate');
    let resolve!: (value: unknown) => void;
    mocks.analyze.mockReturnValueOnce(new Promise((yes) => { resolve = yes; }));
    view.type = 'spectrogram';
    await flush();
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    view.type = 'waveform';
    await flush();
    resolve({spectrogram: spectrum});
    await flush();
    expect(view.spectrogram).toBeUndefined();
    view.type = 'spectrogram';
    await flush();
    expect(view.spectrogram).toBe(spectrum);
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
  });

  it('keeps examples dormant offscreen and invalidates a pending main load on navigation', async () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    document.body.innerHTML = '<div data-wave-examples><audio-view data-wave-ex></audio-view><p data-wave-status></p></div>';
    runDemo('WaveformExamplesDemo');
    await flush();
    expect(mocks.decode).not.toHaveBeenCalled();
    const root = document.createElement('div');
    root.setAttribute('data-audio-view-demo', '');
    root.innerHTML = '<audio-player></audio-player><audio-view type="waveform"></audio-view><p data-view-status></p>';
    document.body.append(root);
    const player = root.querySelector('audio-player')! as HTMLElement & {stop(): void; clip?: unknown};
    player.stop = vi.fn();
    let resolve!: (value: typeof clip) => void;
    mocks.decode.mockReturnValue(new Promise((yes) => { resolve = yes; }));
    runDemo('AudioViewDemo');
    window.dispatchEvent(new Event('pagehide'));
    resolve(clip);
    await flush();
    expect(player.clip).toBeUndefined();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it('writes playback rate through the real attribute and resets custom multiband controls', async () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    document.body.innerHTML = `<div data-wm-pg data-target="audio-view"><div data-mm>
      <audio-player></audio-player><audio-view color-mode="multiband" interactive drag-mode="scrub"></audio-view><p data-drag-help></p><p data-mm-status></p>
      <div class="mm-seg" data-group="ch1"><button data-val="left"></button><button data-val="right"></button></div>
      <div class="mm-seg" data-group="ch2"><button data-val="off"></button><button data-val="left"></button></div>
      <div class="mm-seg" data-group="colormode"><button data-val="static"></button><button data-val="multiband"></button></div>
      <div class="mm-seg" data-group="history"><button data-val="0"></button><button data-val="2.5"></button></div>
      <input type="checkbox" data-ctl="loop"><input type="range" min="0.25" max="2" step="0.05" value="1" data-ctl="speed"><output data-speed></output>
      </div><select data-pg-attr="drag-mode" data-pg-kind="enum"><option value="">Default</option><option value="seek">seek</option><option value="scrub">scrub</option><option value="pan">pan</option><option value="none">none</option></select><button data-pg-reset>Reset</button></div>`;
    const player = document.querySelector('audio-player')! as HTMLElement & {stop(): void};
    player.stop = vi.fn();
    runDemo('MultibandWaveformDemo');
    mountPlaygrounds();
    const mode = document.querySelector<HTMLSelectElement>('[data-pg-attr="drag-mode"]')!;
    expect(mode.value).toBe('scrub');
    mode.value = 'pan'; mode.dispatchEvent(new Event('change', {bubbles: true}));
    await flush();
    expect(document.querySelector('[data-drag-help]')!.textContent).toContain('Playback is unchanged');
    const speed = document.querySelector<HTMLInputElement>('[data-ctl="speed"]')!;
    speed.value = '1.5'; speed.dispatchEvent(new Event('input', {bubbles: true}));
    expect(player.getAttribute('rate')).toBe('1.5');
    const history = document.querySelector<HTMLButtonElement>('[data-val="2.5"]')!;
    history.click();
    expect(document.querySelector('audio-view')!.getAttribute('history')).toBe('2.5');
    document.querySelector<HTMLButtonElement>('[data-pg-reset]')!.click();
    await flush();
    expect(mode.value).toBe('scrub');
    expect(document.querySelector('[data-drag-help]')!.textContent).toContain('left toward later audio');
    expect(player.hasAttribute('rate')).toBe(false);
    expect(speed.value).toBe('1');
    expect(document.querySelector('audio-view')!.hasAttribute('history')).toBe(false);
    expect(history.getAttribute('aria-pressed')).toBe('false');
    expect(player.stop).toHaveBeenCalledOnce();
  });
});
