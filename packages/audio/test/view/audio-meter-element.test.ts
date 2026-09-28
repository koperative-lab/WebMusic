// @vitest-environment jsdom

import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
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

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function node() {
  return {connect: vi.fn(), disconnect: vi.fn()};
}

function ownedContext() {
  const gains: ReturnType<typeof node>[] = [];
  const analysers: Array<ReturnType<typeof node> & {
    fftSize: number;
    smoothingTimeConstant: number;
    frequencyBinCount: number;
    getByteTimeDomainData: ReturnType<typeof vi.fn>;
    getByteFrequencyData: ReturnType<typeof vi.fn>;
  }> = [];
  const context = {
    createGain: vi.fn(() => {
      const gain = node();
      gains.push(gain);
      return gain;
    }),
    createAnalyser: vi.fn(() => {
      const analyser = {
        ...node(),
        fftSize: 4,
        smoothingTimeConstant: 0,
        frequencyBinCount: 8,
        getByteTimeDomainData: vi.fn((buffer: Uint8Array) => buffer.fill(128)),
        getByteFrequencyData: vi.fn((buffer: Uint8Array) => buffer.fill(128)),
      };
      analysers.push(analyser);
      return analyser;
    }),
  } as unknown as BaseAudioContext;
  return {context, gains, analysers};
}

describe('<audio-meter> shared UI composition', () => {
  it('keeps its graph while mode and bars remount only the presenter', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 3));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const fixture = ownedContext();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = fixture.context;
    const firstInput = element.input;
    document.body.append(element);

    expect(element.shadowRoot?.querySelector('.wrap')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.track')).not.toBeNull();
    expect(element.shadowRoot?.querySelector('.wrap')?.getAttribute('part')).toContain('wrap');
    expect(fixture.context.createAnalyser).toHaveBeenCalledOnce();

    element.setAttribute('mode', 'spectrum');
    element.setAttribute('bars', '7');

    expect(element.input).toBe(firstInput);
    expect(fixture.context.createAnalyser).toHaveBeenCalledOnce();
    expect(element.shadowRoot?.querySelectorAll('.fbar')).toHaveLength(7);

    element.remove();
    expect(fixture.gains.every((gain) => gain.disconnect.mock.calls.length === 1)).toBe(true);
    document.body.append(element);
    expect(element.input).not.toBe(firstInput);
    expect(fixture.context.createAnalyser).toHaveBeenCalledTimes(2);
  });

  it('never disconnects a borrowed analyser', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 5));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const external = {
      ...node(),
      fftSize: 4,
      frequencyBinCount: 8,
      getByteTimeDomainData: vi.fn((buffer: Uint8Array) => buffer.fill(128)),
      getByteFrequencyData: vi.fn((buffer: Uint8Array) => buffer.fill(0)),
    } as unknown as AnalyserNode;
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.analyser = external;
    document.body.append(element);
    element.remove();

    expect(external.disconnect).not.toHaveBeenCalled();
    expect(element.analyser).toBe(external);
  });
});

/** Keep the presenter's paint loop from running across a test. */
function stubFrames(): void {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 3));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
}

describe('<audio-meter> legacy CSS variable bridge', () => {
  const mappings = [
    ['--wm-meter-height', '--wameter-height'],
    ['--wm-meter-background', '--wameter-bg'],
    ['--wm-meter-track', '--wameter-track'],
    ['--wm-meter-fill', '--wameter-fill'],
    ['--wm-meter-peak', '--wameter-peak'],
  ] as const;

  /**
   * The presenter's own stylesheet also mentions `--wameter-*` — it reads those
   * names directly; the element only supplies the canonical outer surface.
   */
  function bridges(element: AudioMeterElement): HTMLStyleElement[] {
    return [...(element.shadowRoot?.querySelectorAll('style') ?? [])].filter((style) =>
      (style.textContent ?? '').includes('--wm-audio-meter-surface-background'),
    );
  }

  it('delegates legacy and semantic values to UIKit without shadowing caller tokens', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = ownedContext().context;
    document.body.append(element);

    const bridge = bridges(element)[0]?.textContent ?? '';
    const css = [...(element.shadowRoot?.querySelectorAll('style') ?? [])]
      .map((style) => style.textContent ?? '').join('');
    for (const [token, legacy] of mappings) {
      expect(css).toContain(`var(${legacy},`);
      expect(css).toContain(`var(${token},`);
      expect(bridge).not.toContain(`${token}:`);
    }
  });

  it('keeps exactly one bridge node, last, across presenter remounts', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.context = ownedContext().context;
    document.body.append(element);
    const first = bridges(element)[0];

    element.setAttribute('mode', 'spectrum');
    element.setAttribute('bars', '9');
    element.setAttribute('mode', 'level');

    expect(bridges(element)).toEqual([first]);
    // The presenter appends its own style + root on every mount, so the bridge
    // is only reliably in effect while it stays behind them.
    expect(element.shadowRoot?.lastElementChild).toBe(first);
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

  it('restores the default name in place when the author name is cleared', () => {
    stubFrames();
    const element = document.createElement('test-audio-meter') as AudioMeterElement;
    element.setAttribute('aria-label', 'Bus A');
    element.context = ownedContext().context;
    document.body.append(element);
    const presenter = element.shadowRoot?.querySelector('.wrap');

    element.removeAttribute('aria-label');

    const renamed = element.shadowRoot?.querySelector('.wrap');
    expect(renamed).toBe(presenter);
    expect(renamed?.getAttribute('aria-label')).toBe('Audio level');
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
    const analyser = ownedContext().context.createAnalyser();
    const player = {
      analyser: analyser as AnalyserNode | undefined,
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
    first.player.analyser = next; first.emit('sourcechange');
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
    element.setAttribute('player', '#meter-owner'); element.analyser = direct;
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
      analyser: playerFixture().analyser,
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
    element.player = {analyser: playerFixture().analyser, on: () => releases[index++]!};
    const errors = vi.fn(); element.addEventListener('webaudio:error', errors);
    document.body.append(element); element.remove();
    expect(releases[0]).toHaveBeenCalledOnce();
    expect(releases[1]).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledOnce();
  });

});
