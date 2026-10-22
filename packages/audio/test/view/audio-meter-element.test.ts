// @vitest-environment jsdom

import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  AudioMeterElement,
  defineAudioMeterElement,
} from '../../src/view/element/audio-meter';
import type {
  AudioMeterController,
  AudioMeterControllerOptions,
} from '../../src/view/headless/meter';

/** Records the options the element hands to the controller factory hook. */
class ProbeAudioMeterElement extends AudioMeterElement {
  built: AudioMeterControllerOptions[] = [];

  protected override createMeterController(
    options: AudioMeterControllerOptions,
  ): AudioMeterController {
    this.built.push(options);
    return super.createMeterController(options);
  }
}

beforeAll(() => {
  defineAudioMeterElement('test-audio-meter');
  if (!customElements.get('probe-audio-meter')) {
    customElements.define('probe-audio-meter', ProbeAudioMeterElement);
  }
});

/** A recording 2D context, so the stage's synchronous first paint can run under jsdom. */
function fakeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<string, unknown> = {canvas};
  return new Proxy(state, {
    get(target, key) {
      if (key === 'then') return undefined;
      if (key in target) return target[key as string];
      return () => undefined;
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return fakeContext(this);
  } as never);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function node() {
  return {connect: vi.fn(), disconnect: vi.fn()};
}

type FakeAnalyser = ReturnType<typeof node> & {
  fftSize: number;
  smoothingTimeConstant: number;
  frequencyBinCount: number;
  minDecibels: number;
  maxDecibels: number;
  context: unknown;
  getByteTimeDomainData: ReturnType<typeof vi.fn>;
  getByteFrequencyData: ReturnType<typeof vi.fn>;
  getFloatTimeDomainData: ReturnType<typeof vi.fn>;
  getFloatFrequencyData: ReturnType<typeof vi.fn>;
};

/** A context that can build the owned tap and the stereo branch. */
function ownedContext(sample = 0) {
  const gains: ReturnType<typeof node>[] = [];
  const splitters: ReturnType<typeof node>[] = [];
  const analysers: FakeAnalyser[] = [];
  const context = {
    sampleRate: 48_000,
    createGain: vi.fn(() => {
      const gain = node();
      gains.push(gain);
      return gain;
    }),
    createChannelSplitter: vi.fn(() => {
      const splitter = node();
      splitters.push(splitter);
      return splitter;
    }),
    createAnalyser: vi.fn(() => {
      const analyser: FakeAnalyser = {
        ...node(),
        fftSize: 4,
        smoothingTimeConstant: 0,
        frequencyBinCount: 8,
        minDecibels: -100,
        maxDecibels: -30,
        context,
        getByteTimeDomainData: vi.fn((buffer: Uint8Array) => buffer.fill(128)),
        getByteFrequencyData: vi.fn((buffer: Uint8Array) => buffer.fill(128)),
        getFloatTimeDomainData: vi.fn((buffer: Float32Array) => buffer.fill(sample)),
        getFloatFrequencyData: vi.fn((buffer: Float32Array) => buffer.fill(-60)),
      };
      analysers.push(analyser);
      return analyser;
    }),
  };
  return {context: context as unknown as BaseAudioContext, gains, splitters, analysers};
}

function externalAnalyser(): FakeAnalyser {
  const fixture = ownedContext(0.25);
  const analyser = fixture.context.createAnalyser() as unknown as FakeAnalyser;
  fixture.analysers.length = 0;
  return analyser;
}

/** Keep the presenter's paint loop from running across a test. */
function stubFrames(): void {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 3));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
}

describe('<audio-meter> shared UI composition', () => {
  it('keeps its graph while type, theme and bars change only the display', () => {
    stubFrames();
    const fixture = ownedContext();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = fixture.context;
    const firstInput = element.input;
    document.body.append(element);

    const stage = element.shadowRoot?.querySelector('.wrap');
    expect(stage).not.toBeNull();
    expect(stage?.getAttribute('part')).toContain('wrap');
    expect(stage?.getAttribute('role')).toBe('img');
    expect(element.shadowRoot?.querySelector('canvas')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.frame')?.getAttribute('part')).toBe('frame');
    expect(fixture.context.createAnalyser).toHaveBeenCalledOnce();
    expect(element.type).toBe('vu');
    expect(element.snapshot?.type).toBe('vu');

    element.setAttribute('type', 'spectrum');
    element.setAttribute('bars', '7');
    element.setAttribute('theme', 'color');

    expect(element.input).toBe(firstInput);
    expect(fixture.context.createAnalyser).toHaveBeenCalledOnce();
    expect(element.shadowRoot?.querySelector('.wrap')).toBe(stage);
    expect(element.type).toBe('spectrum');
    expect(element.theme).toBe('color');
    expect(element.snapshot?.type).toBe('spectrum');
    expect(element.snapshot?.type === 'spectrum' && element.snapshot.bars).toBe(7);

    element.remove();
    expect(fixture.gains.every((gain) => gain.disconnect.mock.calls.length === 1)).toBe(true);
    expect(element.snapshot).toBeUndefined();
    document.body.append(element);
    expect(element.input).not.toBe(firstInput);
    expect(fixture.context.createAnalyser).toHaveBeenCalledTimes(2);
    expect(element.shadowRoot?.querySelectorAll('.frame')).toHaveLength(1);
    expect(element.shadowRoot?.querySelectorAll('.wrap')).toHaveLength(1);
  });

  it('never disconnects a borrowed analyser', () => {
    stubFrames();
    const external = externalAnalyser();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.analyser = external as unknown as AnalyserNode;
    document.body.append(element);
    element.remove();

    expect(external.disconnect).not.toHaveBeenCalled();
    expect(element.analyser).toBe(external);
  });

  it('shows waiting feedback without a source and clears it once one arrives', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    document.body.append(element);
    const status = element.shadowRoot?.querySelector<HTMLElement>('.wui-stage__status');
    expect(status?.hidden).toBe(false);
    expect(status?.querySelector<HTMLElement>('.wui-status')?.dataset.kind).toBe('waiting');
    expect(element.snapshot).toBeUndefined();

    element.context = ownedContext().context;
    expect(element.shadowRoot?.querySelector<HTMLElement>('.wui-stage__status')?.hidden).toBe(true);
    expect(element.snapshot?.type).toBe('vu');
  });
});

describe('<audio-meter> legacy CSS variable bridge', () => {
  const mappings = [
    ['--wm-meter-height', '--wameter-height'],
    ['--wm-meter-background', '--wameter-bg'],
    ['--wm-meter-track', '--wameter-track'],
    ['--wm-meter-fill', '--wameter-fill'],
    ['--wm-meter-peak', '--wameter-peak'],
  ] as const;

  /**
   * The element's own style node carries the outer surface, the frame height
   * and the token probe the painters read; it never redeclares a public token.
   */
  function bridges(element: AudioMeterElement): HTMLStyleElement[] {
    return [...(element.shadowRoot?.querySelectorAll('style') ?? [])].filter((style) =>
      (style.textContent ?? '').includes('--wm-audio-meter-surface-background'),
    );
  }

  it('reads legacy and semantic values without shadowing caller tokens', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = ownedContext().context;
    document.body.append(element);

    const bridge = bridges(element)[0]?.textContent ?? '';
    for (const [token, legacy] of mappings) {
      expect(bridge).toContain(`var(${legacy},`);
      expect(bridge).toContain(`var(${token},`);
      expect(bridge).not.toContain(`${token}:`);
    }
    expect(bridge).toContain('var(--wameter-track, var(--wm-meter-track,');
    expect(element.shadowRoot?.querySelector('.palette')).not.toBeNull();
  });

  it('keeps exactly one bridge node and one frame across display and source changes', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = ownedContext().context;
    document.body.append(element);
    const first = bridges(element)[0];
    const frame = element.shadowRoot?.querySelector('.frame');

    element.setAttribute('type', 'spectrogram');
    element.setAttribute('type', 'stereometer');
    element.context = ownedContext().context;
    element.setAttribute('type', 'vu');

    expect(bridges(element)).toEqual([first]);
    expect(element.shadowRoot?.querySelector('.frame')).toBe(frame);
    expect(element.shadowRoot?.querySelectorAll('.wui-stage')).toHaveLength(1);
    expect(element.shadowRoot?.querySelectorAll('.palette')).toHaveLength(1);
  });

  it('sizes the frame adaptively per type and preset until a height token takes over', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = ownedContext().context;
    document.body.append(element);
    const frame = element.shadowRoot!.querySelector<HTMLElement>('.frame')!;
    expect(frame.style.getPropertyValue('--wui-meter-aspect')).toBe('2.6');
    expect(frame.style.getPropertyValue('--wui-meter-max-height')).toBe('var(--wm-surface-md, 144px)');
    expect(frame.style.getPropertyValue('--wui-meter-height')).toBe('');
    element.setAttribute('type', 'stereometer');
    expect(frame.style.getPropertyValue('--wui-meter-aspect')).toBe('1.6');
    const bridge = bridges(element)[0]?.textContent ?? '';
    expect(bridge).toContain('aspect-ratio:var(--wui-meter-aspect,3)');
    expect(bridge).toContain('height:var(--wm-audio-meter-height,var(--wm-meter-height,var(--wameter-height,var(--wui-meter-height,auto))))');
    expect(bridge).toContain('max-height:var(--wm-audio-meter-height,var(--wm-meter-height,var(--wameter-height,var(--wui-meter-max-height,none))))');
    expect(bridge).toContain('min-height:var(--wm-audio-meter-min-height,var(--wm-meter-min-height,3rem))');
  });
});

describe('<audio-meter> sizing', () => {
  it('maps size presets onto the surface tiers and reflects the property', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('size', 'sm');
    element.context = ownedContext().context;
    document.body.append(element);
    const frame = element.shadowRoot!.querySelector<HTMLElement>('.frame')!;
    expect(element.size).toBe('sm');
    expect(frame.style.getPropertyValue('--wui-meter-max-height')).toBe('var(--wm-surface-sm, 72px)');
    element.size = 'lg';
    expect(element.getAttribute('size')).toBe('lg');
    expect(frame.style.getPropertyValue('--wui-meter-max-height')).toBe('var(--wm-surface-lg, 216px)');
    element.setAttribute('size', 'huge');
    expect(element.size).toBe('md');
    expect(frame.style.getPropertyValue('--wui-meter-max-height')).toBe('var(--wm-surface-md, 144px)');
  });

  it('fixes the height from the attribute, in pixels for a bare number, and restores the preset when cleared', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('size', 'lg');
    element.context = ownedContext().context;
    document.body.append(element);
    const frame = element.shadowRoot!.querySelector<HTMLElement>('.frame')!;
    element.setAttribute('height', '12rem');
    expect(element.height).toBe('12rem');
    expect(frame.style.getPropertyValue('--wui-meter-height')).toBe('12rem');
    expect(frame.style.getPropertyValue('--wui-meter-max-height')).toBe('12rem');
    element.height = 96;
    expect(element.getAttribute('height')).toBe('96');
    expect(frame.style.getPropertyValue('--wui-meter-height')).toBe('96px');
    expect(frame.style.getPropertyValue('--wui-meter-max-height')).toBe('96px');
    element.height = undefined;
    expect(element.hasAttribute('height')).toBe(false);
    expect(frame.style.getPropertyValue('--wui-meter-height')).toBe('');
    expect(frame.style.getPropertyValue('--wui-meter-max-height')).toBe('var(--wm-surface-lg, 216px)');
  });

  it('writes an explicit width onto the host and removes only what it wrote', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.style.setProperty('width', '50%');
    element.context = ownedContext().context;
    document.body.append(element);
    expect(element.style.getPropertyValue('width')).toBe('50%');
    element.setAttribute('width', '320');
    expect(element.width).toBe('320px');
    expect(element.style.getPropertyValue('width')).toBe('320px');
    element.width = '20rem';
    expect(element.style.getPropertyValue('width')).toBe('20rem');
    element.removeAttribute('width');
    expect(element.width).toBeUndefined();
    expect(element.style.getPropertyValue('width')).toBe('');
    const fluid = document.createElement('test-audio-meter') as AudioMeterElement;
    fluid.style.setProperty('width', '40%');
    document.body.append(fluid);
    expect(fluid.style.getPropertyValue('width')).toBe('40%');
  });

  it('keeps the graph and stage while the box changes', () => {
    stubFrames();
    const fixture = ownedContext();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = fixture.context;
    document.body.append(element);
    const stage = element.shadowRoot?.querySelector('.wrap');
    element.setAttribute('size', 'sm');
    element.setAttribute('height', '5rem');
    element.setAttribute('width', '240');
    expect(element.shadowRoot?.querySelector('.wrap')).toBe(stage);
    expect(fixture.context.createAnalyser).toHaveBeenCalledOnce();
    expect(fixture.gains.every((gain) => gain.disconnect.mock.calls.length === 0)).toBe(true);
  });
});

describe('<audio-meter> live attributes', () => {
  it('renames the mounted presenter without destroying it', () => {
    stubFrames();
    const fixture = ownedContext();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('aria-label', 'Bus A');
    element.context = fixture.context;
    document.body.append(element);
    const presenter = element.shadowRoot?.querySelector('.wrap');
    expect(presenter?.getAttribute('aria-label')).toBe('Bus A');

    element.setAttribute('aria-label', 'Bus B');

    expect(element.shadowRoot?.querySelector('.wrap')).toBe(presenter);
    expect(presenter?.getAttribute('aria-label')).toBe('Bus B');
    expect(fixture.context.createAnalyser).toHaveBeenCalledOnce();
  });

  it('restores the type default name in place when the author name is cleared', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('aria-label', 'Bus A');
    element.context = ownedContext().context;
    document.body.append(element);
    const presenter = element.shadowRoot?.querySelector('.wrap');

    element.removeAttribute('aria-label');

    const renamed = element.shadowRoot?.querySelector('.wrap');
    expect(renamed).toBe(presenter);
    expect(renamed?.getAttribute('aria-label')).toBe('VU meter');
    element.setAttribute('type', 'spectrogram');
    expect(renamed?.getAttribute('aria-label')).toBe('Spectrogram');
    element.setAttribute('aria-label', 'Bus C');
    element.setAttribute('type', 'waveform');
    expect(renamed?.getAttribute('aria-label')).toBe('Bus C');
  });

  it('passes the tuning attributes to the controller and omits absent ones', () => {
    stubFrames();
    const fixture = ownedContext();
    const element = document.createElement('probe-audio-meter') as ProbeAudioMeterElement;
    element.setAttribute('fft-size', '256');
    element.setAttribute('smoothing-time-constant', '0.25');
    element.setAttribute('level-scale', '3');
    element.setAttribute('peak-decay', '0.05');
    element.context = fixture.context;
    document.body.append(element);

    expect(element.built).toEqual([
      {
        context: fixture.context,
        fftSize: 256,
        smoothingTimeConstant: 0.25,
        levelScale: 3,
        peakDecay: 0.05,
      },
    ]);
    expect(fixture.analysers[0]?.fftSize).toBe(256);
    expect(fixture.analysers[0]?.smoothingTimeConstant).toBe(0.25);

    const plain = document.createElement('probe-audio-meter') as ProbeAudioMeterElement;
    plain.context = fixture.context;
    document.body.append(plain);
    expect(plain.built).toEqual([{context: fixture.context}]);
  });

  it('updates tuning without replacing the controller or its audio ports', () => {
    stubFrames();
    const fixture = ownedContext();
    const element = document.createElement('probe-audio-meter') as ProbeAudioMeterElement;
    element.context = fixture.context;
    document.body.append(element);

    const input = element.input;
    const output = element.output;
    const source = node(); const destination = node();
    source.connect(input); output?.connect(destination as unknown as AudioNode);
    element.setAttribute('fft-size', '512');

    expect(element.built).toEqual([{context: fixture.context}]);
    expect(fixture.analysers.at(-1)?.fftSize).toBe(512);
    expect(fixture.context.createAnalyser).toHaveBeenCalledOnce();
    expect(element.input).toBe(input); expect(element.output).toBe(output);
    expect(fixture.gains.every(gain => gain.disconnect.mock.calls.length === 0)).toBe(true);
    expect(source.connect).toHaveBeenCalledWith(input);
    expect(output?.connect).toHaveBeenCalledWith(destination);
    element.removeAttribute('fft-size');
    expect(fixture.analysers[0]?.fftSize).toBe(1024);
    expect(element.input).toBe(input);
    expect(element.shadowRoot?.querySelector('.wrap')).not.toBeNull();
  });
});

describe('<audio-meter> display types', () => {
  it('maps a legacy mode onto a type until type is set, and reflects type and theme properties', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('mode', 'spectrum');
    element.context = ownedContext().context;
    document.body.append(element);
    expect(element.type).toBe('spectrum');
    expect(element.snapshot?.type).toBe('spectrum');
    element.setAttribute('mode', 'level');
    expect(element.type).toBe('vu');
    element.type = 'waveform';
    expect(element.getAttribute('type')).toBe('waveform');
    expect(element.type).toBe('waveform');
    element.setAttribute('type', 'bogus');
    expect(element.type).toBe('vu');
    expect(element.theme).toBe('mono');
    element.theme = 'color';
    expect(element.getAttribute('theme')).toBe('color');
  });

  it('reads display attributes into the reduction without touching the graph', () => {
    stubFrames();
    const fixture = ownedContext(0.5);
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('type', 'oscilloscope');
    element.setAttribute('timebase-ms', '0.05');
    element.setAttribute('trigger', 'off');
    element.setAttribute('fft-size', '64');
    element.context = fixture.context;
    document.body.append(element);
    const input = element.input;
    const scope = element.snapshot;
    expect(scope?.type).toBe('oscilloscope');
    if (scope?.type !== 'oscilloscope') return;
    // 0.05 ms is raised to the 0.1 ms floor: 4.8 samples at 48 kHz, rounded, plus one.
    expect(scope.samples).toHaveLength(6);
    expect(scope.triggered).toBe(false);

    element.setAttribute('type', 'loudness');
    element.setAttribute('loudness-mode', 'rms-fast');
    const loud = element.snapshot;
    expect(loud?.type).toBe('loudness');
    if (loud?.type !== 'loudness') return;
    expect(loud.unit).toBe('dB');
    expect(loud.mode).toBe('rms-fast');
    expect(loud.value).toBeCloseTo(20 * Math.log10(0.5), 3);

    element.setAttribute('type', 'vu');
    element.setAttribute('reference-dbfs', '-12');
    const vu = element.snapshot;
    if (vu?.type !== 'vu') return;
    expect(vu.referenceDbfs).toBe(-12);
    // The loudness type attached and released its channel analysers; the owned
    // tap itself was never rebuilt.
    expect(element.input).toBe(input);
    expect(fixture.analysers[0]!.fftSize).toBe(64);
    expect(fixture.gains[0]!.disconnect).not.toHaveBeenCalled();
    expect(fixture.gains[1]!.disconnect).not.toHaveBeenCalled();
  });

  it('attaches the owned stereo branch only for stereometer and loudness and releases it on type change and removal', () => {
    stubFrames();
    const fixture = ownedContext(0.25);
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = fixture.context;
    document.body.append(element);
    expect(fixture.context.createChannelSplitter).not.toHaveBeenCalled();

    element.setAttribute('type', 'stereometer');
    expect(fixture.context.createChannelSplitter).toHaveBeenCalledOnce();
    expect(fixture.analysers).toHaveLength(3);
    const [tap, left, right] = fixture.analysers;
    const fanOut = fixture.gains[2]!;
    expect(tap!.connect).toHaveBeenCalledWith(fanOut);
    expect(fixture.splitters[0]!.connect).toHaveBeenCalledWith(left, 0);
    expect(fixture.splitters[0]!.connect).toHaveBeenCalledWith(right, 1);
    const snapshot = element.snapshot;
    expect(snapshot?.type).toBe('stereometer');
    if (snapshot?.type !== 'stereometer') return;
    expect(snapshot.stereo).toBe(true);
    expect(left!.getFloatTimeDomainData).toHaveBeenCalled();

    element.setAttribute('type', 'loudness');
    expect(fixture.context.createChannelSplitter).toHaveBeenCalledOnce();
    expect(element.snapshot?.type === 'loudness' && element.snapshot.stereo).toBe(true);

    element.setAttribute('type', 'vu');
    expect(tap!.disconnect).toHaveBeenCalledTimes(1);
    expect(tap!.disconnect).toHaveBeenCalledWith(fanOut);
    expect(fanOut.disconnect).toHaveBeenCalledOnce();
    expect(left!.disconnect).toHaveBeenCalledOnce();
    expect(right!.disconnect).toHaveBeenCalledOnce();

    element.setAttribute('type', 'stereometer');
    expect(fixture.context.createChannelSplitter).toHaveBeenCalledTimes(2);
    element.remove();
    // The branch is released before the owned tap is disposed: one selective
    // disconnect for the branch edge, then the tap's own full disconnect.
    expect(tap!.disconnect).toHaveBeenCalledTimes(3);
    expect(tap!.disconnect.mock.calls[1]).toEqual([fixture.gains[3]]);
    expect(tap!.disconnect.mock.calls[2]).toEqual([]);
  });

  it('fans a borrowed analyser out for the stereometer and removes only that edge on cleanup', () => {
    stubFrames();
    const external = externalAnalyser();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('type', 'stereometer');
    element.analyser = external as unknown as AnalyserNode;
    document.body.append(element);
    expect(external.connect).toHaveBeenCalledOnce();
    const fanOut = external.connect.mock.calls[0]![0];
    expect(element.snapshot?.type === 'stereometer' && element.snapshot.stereo).toBe(true);

    element.remove();
    expect(external.disconnect).toHaveBeenCalledOnce();
    expect(external.disconnect).toHaveBeenCalledWith(fanOut);
    document.body.append(element);
    expect(external.connect).toHaveBeenCalledTimes(2);
    element.analyser = undefined;
    expect(external.disconnect).toHaveBeenCalledTimes(2);
    expect(external.disconnect.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it('reports a failed stereo branch as an error while keeping the display live', () => {
    stubFrames();
    const fixture = ownedContext(0.25);
    vi.mocked(fixture.context.createChannelSplitter).mockImplementation(() => {
      throw new Error('splitter unavailable');
    });
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    const errors = vi.fn();
    element.addEventListener('webaudio:error', errors);
    element.context = fixture.context;
    document.body.append(element);
    element.setAttribute('type', 'stereometer');
    expect(errors).toHaveBeenCalledOnce();
    const snapshot = element.snapshot;
    expect(snapshot?.type).toBe('stereometer');
    if (snapshot?.type !== 'stereometer') return;
    expect(snapshot.stereo).toBe(false);
    expect(Array.from(snapshot.right)).toEqual(Array.from(snapshot.left));
  });

  it('paints with a palette resolved from its tokens and falls back to neutral defaults', () => {
    stubFrames();
    const fixture = ownedContext(0.25);
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = fixture.context;
    document.body.append(element);
    const probe = element.shadowRoot?.querySelector<HTMLElement>('.palette');
    expect(probe).not.toBeNull();
    expect(() => element.setAttribute('theme', 'color')).not.toThrow();
    expect(() => element.setAttribute('theme', 'mono')).not.toThrow();
    expect(element.snapshot?.type).toBe('vu');
  });
});

describe('<audio-meter> failed changes preserve the current route', () => {
  it('reports invalid tuning while preserving ports, presenter and previous settings', () => {
    stubFrames();
    const fixture = ownedContext();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = fixture.context; document.body.append(element);
    const input = element.input, output = element.output;
    const presenter = element.shadowRoot?.querySelector('.wrap');
    const errors = vi.fn(); element.addEventListener('webaudio:error', errors);
    element.setAttribute('fft-size', '1000');
    expect(errors).toHaveBeenCalledOnce();
    expect(fixture.analysers[0]?.fftSize).toBe(1024);
    expect(element.input).toBe(input); expect(element.output).toBe(output);
    expect(element.shadowRoot?.querySelector('.wrap')).toBe(presenter);
    expect(fixture.gains.every(gain => gain.disconnect.mock.calls.length === 0)).toBe(true);
  });

  it('constructs a candidate before releasing a working source and restores failed source assignment', () => {
    stubFrames();
    const fixture = ownedContext();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = fixture.context; document.body.append(element);
    const input = element.input, output = element.output;
    const invalid = ownedContext();
    vi.mocked(invalid.context.createAnalyser).mockImplementation(() => {throw new Error('unavailable');});
    expect(() => {element.context = invalid.context;}).toThrow('unavailable');
    expect(element.context).toBe(fixture.context);
    expect(element.input).toBe(input); expect(element.output).toBe(output);
    expect(fixture.gains.every(gain => gain.disconnect.mock.calls.length === 0)).toBe(true);
    expect(invalid.gains.every(gain => gain.disconnect.mock.calls.length === 1)).toBe(true);
  });
});


describe('<audio-meter> borrowed player binding', () => {
  function playerFixture() {
    const listeners = new Map<string, Set<() => void>>();
    const analyser = externalAnalyser();
    const player = {
      analyser: analyser as unknown as AnalyserNode | undefined,
      on(event: 'sourcechange' | 'load', listener: () => void) {
        const set = listeners.get(event) ?? new Set<() => void>();
        set.add(listener); listeners.set(event, set);
        return () => {set.delete(listener);};
      },
    };
    return {player, analyser, listeners, emit(event: string) {
      for (const listener of [...listeners.get(event) ?? []]) listener();
    }};
  }

  it('follows initial, replaced and cleared analyser without owning its graph', () => {
    stubFrames();
    const first = playerFixture();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.player = first.player;
    document.body.append(element);
    expect(element.analyser).toBe(first.analyser);
    expect(element.input).toBeUndefined();
    const next = playerFixture().analyser;
    first.player.analyser = next as unknown as AnalyserNode; first.emit('sourcechange');
    expect(element.analyser).toBe(next);
    expect(first.analyser.disconnect).not.toHaveBeenCalled();
    first.player.analyser = undefined; first.emit('sourcechange');
    expect(element.analyser).toBeUndefined();
    expect(next.disconnect).not.toHaveBeenCalled();
    element.remove();
    expect(first.listeners.get('sourcechange')?.size).toBe(0);
    expect(first.listeners.get('load')?.size).toBe(0);
  });

  it('releases old player subscriptions on rebind and resumes them on reconnect', () => {
    stubFrames();
    const first = playerFixture(), second = playerFixture();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.player = first.player; document.body.append(element);
    element.player = second.player;
    expect(first.listeners.get('sourcechange')?.size).toBe(0);
    first.emit('load');
    expect(element.analyser).toBe(second.analyser);
    element.remove();
    expect(second.listeners.get('load')?.size).toBe(0);
    document.body.append(element);
    expect(element.analyser).toBe(second.analyser);
    expect(second.listeners.get('load')?.size).toBe(1);
  });

  it('follows a late selector target, source replacement and target removal', async () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('player', '#meter-owner'); document.body.append(element);
    expect(element.analyser).toBeUndefined();
    const fixture = playerFixture();
    const target = Object.assign(document.createElement('div'), {player: fixture.player});
    target.id = 'meter-owner'; document.body.append(target);
    await Promise.resolve();
    expect(element.analyser).toBe(fixture.analyser);
    const next = playerFixture(); target.player = next.player;
    target.dispatchEvent(new Event('webaudio:sourcechange'));
    expect(element.analyser).toBe(next.analyser);
    target.remove(); await Promise.resolve();
    expect(element.analyser).toBeUndefined();
    expect(next.analyser.disconnect).not.toHaveBeenCalled();
  });

  it('keeps explicit input ahead of selector binding until the input is cleared', () => {
    stubFrames();
    const fixture = playerFixture();
    const target = Object.assign(document.createElement('div'), {player: fixture.player});
    target.id = 'meter-owner'; document.body.append(target);
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    const direct = playerFixture().analyser;
    element.setAttribute('player', '#meter-owner'); element.analyser = direct as unknown as AnalyserNode;
    document.body.append(element);
    expect(element.analyser).toBe(direct);
    element.analyser = undefined;
    expect(element.analyser).toBe(fixture.analyser);
    expect(direct.disconnect).not.toHaveBeenCalled();
  });

  it('does not retain an obsolete source after a reentrant player replacement', () => {
    stubFrames();
    const second = playerFixture();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    const first = {get analyser() {element.player = second.player; return undefined;}};
    element.player = first; document.body.append(element);
    expect(element.player).toBe(second.player);
    expect(element.analyser).toBe(second.analyser);
  });

  it('releases subscriptions registered during a reentrant owner replacement', () => {
    stubFrames();
    const second = playerFixture();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    const release = vi.fn();
    const first = {
      analyser: playerFixture().analyser as unknown as AnalyserNode,
      on: vi.fn(() => {element.player = second.player; return release;}),
    };
    element.player = first; document.body.append(element);
    expect(first.on).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(element.player).toBe(second.player);
    expect(element.analyser).toBe(second.analyser);
    expect(second.listeners.get('sourcechange')?.size).toBe(1);
    expect(second.listeners.get('load')?.size).toBe(1);
  });


  it('attempts every subscription release even when one fails', () => {
    stubFrames();
    const releases = [vi.fn(() => {throw new Error('release failed');}), vi.fn()];
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    let index = 0;
    element.player = {analyser: playerFixture().analyser as unknown as AnalyserNode, on: () => releases[index++]!};
    const errors = vi.fn(); element.addEventListener('webaudio:error', errors);
    document.body.append(element); element.remove();
    expect(releases[0]).toHaveBeenCalledOnce();
    expect(releases[1]).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledOnce();
  });

  it('keeps the stereo branch following a replaced player analyser', () => {
    stubFrames();
    const first = playerFixture();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('type', 'stereometer');
    element.player = first.player;
    document.body.append(element);
    expect(first.analyser.connect).toHaveBeenCalledOnce();
    const replacement = playerFixture().analyser;
    first.player.analyser = replacement as unknown as AnalyserNode;
    first.emit('sourcechange');
    expect(first.analyser.disconnect).toHaveBeenCalledOnce();
    expect(first.analyser.disconnect.mock.calls[0]).toHaveLength(1);
    expect(replacement.connect).toHaveBeenCalledOnce();
    expect(element.snapshot?.type === 'stereometer' && element.snapshot.stereo).toBe(true);
    element.remove();
    expect(replacement.disconnect).toHaveBeenCalledOnce();
    expect(replacement.disconnect.mock.calls[0]).toHaveLength(1);
  });
});

describe('<audio-meter> passive source feedback', () => {
  it.each(['vu', 'loudness', 'waveform', 'oscilloscope', 'spectrum', 'spectrogram', 'stereometer'] as const)(
    'keeps %s following owner loading, failure, ready silence and removal without borrowing ownership', async (type) => {
      stubFrames();
      const owner = Object.assign(document.createElement('div'), {
        loading: false, loadError: undefined as Error | undefined,
        analyser: undefined as AnalyserNode | undefined,
      });
      owner.id = 'meter-status-owner';
      document.body.append(owner);
      const element = document.createElement('test-audio-meter') as AudioMeterElement;
      element.type = type;
      element.setAttribute('player', '#meter-status-owner');
      document.body.append(element);
      const feedback = () => element.shadowRoot!.querySelector<HTMLElement>('.wui-status')!;
      expect(feedback().dataset.kind).toBe('waiting');
      owner.loading = true;
      owner.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
      expect(feedback().dataset.kind).toBe('loading');
      owner.loading = false;
      owner.loadError = new Error('Decode failed');
      owner.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
      expect(feedback().getAttribute('role')).toBe('alert');
      expect(feedback().textContent).toBe('Decode failed');
      const fixture = ownedContext();
      owner.loadError = undefined;
      owner.analyser = fixture.context.createAnalyser();
      fixture.analysers[0]!.getByteFrequencyData.mockImplementation((buffer: Uint8Array) => buffer.fill(0));
      fixture.analysers[0]!.getFloatFrequencyData.mockImplementation((buffer: Float32Array) => buffer.fill(-Infinity));
      owner.dispatchEvent(new CustomEvent('webaudio:sourcechange'));
      expect(feedback().hidden).toBe(true);
      expect(element.snapshot?.type).toBe(type);
      expect(element.snapshot?.silent).toBe(true);
      const stage = element.shadowRoot!.querySelector('.wrap');
      const analyser = element.analyser;
      // Native player load state can change while the analyser identity stays
      // the same. Redraw the existing stage without recreating the audio graph.
      owner.loading = true;
      owner.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
      expect(feedback().dataset.kind).toBe('loading');
      expect(element.shadowRoot!.querySelector('.wrap')).toBe(stage);
      expect(element.analyser).toBe(analyser);
      owner.loading = false;
      owner.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
      expect(feedback().hidden).toBe(true);
      expect(element.shadowRoot!.querySelector('.wrap')).toBe(stage);
      owner.remove();
      await Promise.resolve();
      expect(feedback().dataset.kind).toBe('waiting');
      // Stereo displays remove their own fan-out edge; no borrowed analyser
      // ever receives an unqualified disconnect that would cut the owner route.
      expect(fixture.analysers[0]!.disconnect.mock.calls.every((call) => call.length === 1)).toBe(true);
    },
  );

  it.each(['context', 'analyser'] as const)('keeps explicit %s ahead of native owner loading and errors', (source) => {
    stubFrames();
    const owner = Object.assign(document.createElement('div'), {
      loading: true, loadError: new Error('Owner unavailable'),
    });
    owner.id = 'meter-status-owner';
    document.body.append(owner);
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('player', '#meter-status-owner');
    const fixture = ownedContext();
    if (source === 'context') element.context = fixture.context;
    else element.analyser = fixture.context.createAnalyser();
    document.body.append(element);
    const feedback = () => element.shadowRoot!.querySelector<HTMLElement>('.wui-status')!;
    expect(feedback().hidden).toBe(true);
    owner.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
    expect(feedback().hidden).toBe(true);
    if (source === 'context') element.context = undefined;
    else element.analyser = undefined;
    expect(feedback().dataset.kind).toBe('loading');
    owner.loading = false;
    owner.dispatchEvent(new CustomEvent('webaudio:loadstatechange'));
    expect(feedback().getAttribute('role')).toBe('alert');
    expect(feedback().textContent).toBe('Owner unavailable');
  });
});
