// @vitest-environment jsdom


import {describe, expect, it, vi} from 'vitest';
import {
  createTransportIcon,
  mountTransport,
  transportStateStyle,
  type TransportBinding,
  type TransportState,
  type TransportText,
} from '../src/transport';

class FakeTransport implements TransportBinding {
  state: TransportState = {playing: false, progress: 0, seconds: 0, duration: 60};
  readonly play = vi.fn(() => {
    this.state.playing = true;
    this.emit();
  });
  readonly pause = vi.fn(() => {
    this.state.playing = false;
    this.emit();
  });
  readonly seekFraction = vi.fn((progress: number) => {
    this.state.progress = progress;
    this.state.seconds = progress * 60;
    this.emit();
  });
  readonly subscribers = new Set<() => void>();

  snapshot(): TransportState {
    return this.state;
  }

  subscribe(notify: () => void): () => void {
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }

  emit(): void {
    this.subscribers.forEach((notify) => notify());
  }
}

describe('mountTransport', () => {
  it('shares state feedback with an inline transport and swapped volume controls', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const style = document.createElement('style');
    style.textContent = transportStateStyle;
    host.append(style);
    const binding = Object.assign(new FakeTransport(), {setVolume: vi.fn()});
    const handle = mountTransport(host, binding, {stylesheet: false, showVolume: 'fader', seekControl: 'surface'});
    binding.state.disabled = true;
    handle.update();
    expect(getComputedStyle(handle.controls.play).opacity).toBe('0.45');
    expect(getComputedStyle(handle.controls.track).opacity).toBe('0.45');
    expect(getComputedStyle(handle.controls.volume!).opacity).toBe('0.45');
    handle.setVolumeControl('knob');
    expect(getComputedStyle(handle.controls.volume!).opacity).toBe('0.45');
    binding.state.disabled = false;
    handle.update();
    expect(getComputedStyle(handle.controls.volume!).opacity).not.toBe('0.45');
    expect(handle.element.style.flexWrap).toBe('wrap');
    handle.destroy();
    expect(style.isConnected).toBe(true);
    host.remove();
  });

  it('renders accessible controls and follows binding state', () => {
    const host = document.createElement('div');
    const binding = new FakeTransport();
    const handle = mountTransport(host, binding, {label: 'Score', showTime: true});
    const play = host.querySelector('button')!;
    const seek = host.querySelector('input')!;

    expect(play.getAttribute('aria-label')).toBe('Play');
    expect(seek.getAttribute('aria-label')).toBe('Score seek');
    expect(seek.getAttribute('aria-valuetext')).toBe('0:00 of 1:00');

    play.click();
    expect(binding.play).toHaveBeenCalledTimes(1);
    expect(play.getAttribute('aria-label')).toBe('Pause');

    play.click();
    expect(binding.pause).toHaveBeenCalledTimes(1);
    expect(play.getAttribute('aria-label')).toBe('Play');

    seek.value = '750';
    seek.dispatchEvent(new Event('input', {bubbles: true}));
    expect(binding.seekFraction).toHaveBeenLastCalledWith(0.75);
    expect(seek.style.getPropertyValue('--wui-progress')).toBe('75.0%');
    expect(handle.element.classList.contains('wui-transport')).toBe(true);
  });

  it('exposes the rendered controls as a named public contract', () => {
    const host = document.createElement('div');
    const binding = new FakeTransport();
    const handle = mountTransport(host, binding, {showTime: true});

    expect(handle.controls.play).toBe(host.querySelector('button'));
    expect(handle.controls.track).toBe(host.querySelector('.wui-transport__track'));
    expect(handle.controls.seek).toBe(host.querySelector('input'));
    expect(handle.controls.time).toBe(host.querySelector('.wui-transport__time'));
    expect(handle.controls.track.contains(handle.controls.seek!)).toBe(true);
    handle.destroy();
  });

  it('owns an accessible surface seek control and compatibility fill', () => {
    const host = document.createElement('div');
    const binding = new FakeTransport();
    const handle = mountTransport(host, binding, {
      label: 'Preset',
      seekControl: 'surface',
      showTime: false,
      classNames: {fill: 'webscore-play-preset__progress-fill'},
      parts: {track: 'progress-track', seek: 'seek-surface', fill: 'progress-fill'},
    });
    const {track, fill} = handle.controls;

    expect(handle.controls.seek).toBeUndefined();
    expect(fill).toBeInstanceOf(HTMLSpanElement);
    expect(fill?.classList.contains('webscore-play-preset__progress-fill')).toBe(true);
    expect(fill?.getAttribute('part')).toContain('progress-fill');
    expect(track.getAttribute('part')).toContain('progress-track');
    expect(track.getAttribute('part')).toContain('seek-surface');
    expect(track.getAttribute('role')).toBe('slider');
    expect(track.getAttribute('aria-label')).toBe('Preset seek');

    binding.state.progress = .5;
    binding.state.seconds = 30;
    binding.emit();
    expect(fill?.style.width).toBe('50%');
    expect(track.style.getPropertyValue('--wui-progress')).toBe('50.0%');
    expect(track.getAttribute('aria-valuenow')).toBe('50');

    track.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    expect(binding.seekFraction).toHaveBeenLastCalledWith(1);

    binding.state.disabled = true;
    binding.emit();
    expect(track.getAttribute('aria-disabled')).toBe('true');
    expect(track.tabIndex).toBe(-1);
  });

  it('renders a volume slider only for a binding that can act on it', () => {
    const withoutVolume = new FakeTransport();
    const plainHost = document.createElement('div');
    mountTransport(plainHost, withoutVolume, {showVolume: true});
    // The flag alone is not enough: a slider nothing listens to is a lie.
    expect(plainHost.querySelector('.wui-transport__volume')).toBeNull();

    const binding = new FakeTransport();
    binding.state.volume = 0.5;
    const setVolume = vi.fn((level: number) => {
      binding.state.volume = level;
      binding.emit();
    });
    (binding as TransportBinding).setVolume = setVolume;

    const host = document.createElement('div');
    const handle = mountTransport(host, binding, {showVolume: true, volumeLabel: 'Level'});
    const volume = handle.controls.volume!;

    // The control is the kit's shared fader: an ARIA slider drawn from plain
    // elements, on the fader's own 0…1 scale.
    expect(volume.className).toBe('wui-fader wui-fader--horizontal wui-transport__volume');
    expect(volume.getAttribute('role')).toBe('slider');
    expect(volume.getAttribute('aria-label')).toBe('Level');
    expect(volume.getAttribute('aria-valuenow')).toBe('0.5');

    volume.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
    expect(setVolume).toHaveBeenCalledWith(1);
    expect(volume.getAttribute('aria-valuetext')).toBe('100%');

    // A snapshot change repaints the control while it is not being dragged.
    binding.state.volume = 0.2;
    binding.emit();
    expect(volume.getAttribute('aria-valuenow')).toBe('0.2');

    binding.state.disabled = true;
    binding.emit();
    expect(volume.getAttribute('aria-disabled')).toBe('true');

    handle.destroy();
  });

  it('lets a replacement mounted from the previous cleanup win the host', () => {
    const host = document.createElement('div');
    const first = mountTransport(host, new FakeTransport());
    let replacement: ReturnType<typeof mountTransport> | undefined;

    // Tearing a transport down runs caller code, and caller code is allowed to
    // mount the next one. Claiming the host before the teardown makes that
    // replacement the owner; the outer mount stops and never appends.
    const originalDestroy = first.destroy;
    first.destroy = () => {
      originalDestroy();
      replacement = mountTransport(host, new FakeTransport());
    };

    const superseded = mountTransport(host, new FakeTransport());

    expect(host.querySelectorAll('.wui-transport')).toHaveLength(1);
    expect(host.querySelector('.wui-transport')).toBe(replacement?.element);
    expect(superseded.element.isConnected).toBe(false);

    replacement?.destroy();
    expect(host.querySelector('.wui-transport')).toBeNull();
  });

  it('exports the canonical transport icon factory', () => {
    const play = createTransportIcon(document, false);
    const pause = createTransportIcon(document, true);
    expect(play.querySelector('path')).not.toBeNull();
    expect(pause.querySelectorAll('rect')).toHaveLength(2);
    expect(play.getAttribute('aria-hidden')).toBe('true');
    // Without this the glyph keeps the SVG default fill, which is invisible on
    // the button's own background wherever the stylesheet is not installed.
    expect(play.getAttribute('fill')).toBe('currentColor');
    expect(pause.getAttribute('fill')).toBe('currentColor');
  });

  it('suppresses the seek input and stylesheet and applies custom labels and icon', () => {
    const host = document.createElement('div');
    const binding = new FakeTransport();
    const icon = vi.fn((playing: boolean) => {
      const glyph = document.createElement('span');
      glyph.className = playing ? 'glyph-pause' : 'glyph-play';
      return glyph;
    });
    const handle = mountTransport(host, binding, {
      showTime: false,
      seek: false,
      stylesheet: false,
      playLabel: 'Start song',
      pauseLabel: 'Hold song',
      icon,
    });
    const play = handle.controls.play;

    expect(host.querySelector('style')).toBeNull();
    expect(host.querySelector('input')).toBeNull();
    expect(handle.controls.seek).toBeUndefined();
    expect(handle.controls.time).toBeUndefined();
    expect(handle.controls.track.childElementCount).toBe(0);
    expect(handle.element.style.getPropertyValue('padding')).toContain('--wm-transport-surface-padding');
    expect(handle.element.style.getPropertyValue('border')).toContain('--wm-transport-surface-border');
    expect(handle.element.style.getPropertyValue('background')).toContain('--wm-transport-surface-background');
    expect(play.getAttribute('aria-label')).toBe('Start song');
    expect(play.title).toBe('Start song');
    expect(play.firstElementChild?.className).toBe('glyph-play');

    play.click();
    expect(binding.play).toHaveBeenCalledTimes(1);
    expect(play.getAttribute('aria-label')).toBe('Hold song');
    expect(play.firstElementChild?.className).toBe('glyph-pause');

    binding.state.progress = 0.4;
    binding.emit();
    expect(handle.controls.track.style.getPropertyValue('--wui-progress')).toBe('40.0%');

    handle.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('falls back to the built-in icon and reports a throwing icon callback', () => {
    const host = document.createElement('div');
    const binding = new FakeTransport();
    const failure = new Error('icon failed');
    const onError = vi.fn();
    const handle = mountTransport(host, binding, {
      showTime: false,
      icon: () => {
        throw failure;
      },
      onError,
    });

    expect(onError).toHaveBeenCalledWith(failure);
    expect(handle.controls.play.querySelector('svg')).not.toBeNull();
    handle.destroy();
  });

  it('preserves compatibility hooks and never destroys the binding', () => {
    const host = document.createElement('div');
    const binding = new FakeTransport();
    const destroyBinding = vi.fn();
    Object.assign(binding, {destroy: destroyBinding});
    const handle = mountTransport(host, binding, {
      classNames: {root: 'bar', play: 'play', track: 'slider seek-wrap', seek: 'seek'},
      parts: {root: 'bar', play: 'button'},
      showTime: false,
    });

    expect(host.querySelector('.bar')).not.toBeNull();
    expect(host.querySelector('.slider.seek-wrap')).not.toBeNull();
    expect(host.querySelector('.seek')).not.toBeNull();
    expect(handle.element.getAttribute('part')).toContain('bar');

    handle.destroy();
    handle.destroy();
    expect(binding.subscribers.size).toBe(0);
    expect(destroyBinding).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
  });

  it('preserves unrelated host DOM and disposes a previous mount on remount', () => {
    const host = document.createElement('div');
    const existing = document.createElement('p');
    existing.textContent = 'Owned by the caller';
    host.append(existing);
    const first = new FakeTransport();
    const second = new FakeTransport();

    mountTransport(host, first, {showTime: false});
    const secondHandle = mountTransport(host, second, {showTime: false});

    expect(first.subscribers.size).toBe(0);
    expect(second.subscribers.size).toBe(1);
    expect(host.firstElementChild).toBe(existing);
    expect(host.querySelectorAll('.wui-transport')).toHaveLength(1);

    secondHandle.destroy();
    expect([...host.children]).toContain(existing);
    expect(host.querySelector('.wui-transport')).toBeNull();
  });

  it('finishes DOM cleanup and reports a throwing unsubscribe', () => {
    const host = document.createElement('div');
    const binding = new FakeTransport();
    const failure = new Error('unsubscribe failed');
    binding.subscribe = () => () => {
      throw failure;
    };
    const onError = vi.fn();
    const handle = mountTransport(host, binding, {onError});

    handle.destroy();

    expect(host.childElementCount).toBe(0);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('clamps invalid snapshots and isolates multiple instances', () => {
    const first = new FakeTransport();
    const second = new FakeTransport();
    first.state = {playing: false, progress: Number.POSITIVE_INFINITY};
    second.state = {playing: false, progress: 2};
    const firstHost = document.createElement('div');
    const secondHost = document.createElement('div');

    mountTransport(firstHost, first, {showTime: false});
    mountTransport(secondHost, second, {showTime: false});

    expect(firstHost.querySelector('input')?.value).toBe('0');
    expect(secondHost.querySelector('input')?.value).toBe('1000');
    secondHost.querySelector('button')?.click();
    expect(second.play).toHaveBeenCalledTimes(1);
    expect(first.play).not.toHaveBeenCalled();
  });

  it('repaints after an asynchronous seek settles without a notification', async () => {
    const host = document.createElement('div');
    const binding = new FakeTransport();
    let resolveSeek!: () => void;
    Object.defineProperty(binding, 'seekFraction', {
      value: vi.fn(
        (progress: number) =>
          new Promise<void>((resolve) => {
            resolveSeek = () => {
              binding.state.progress = progress;
              binding.state.seconds = progress * 60;
              resolve();
            };
          }),
      ),
    });
    mountTransport(host, binding);
    const seek = host.querySelector<HTMLInputElement>('input')!;

    seek.value = '750';
    seek.dispatchEvent(new Event('input', {bubbles: true}));
    seek.dispatchEvent(new Event('pointerup', {bubbles: true}));
    expect(seek.value).toBe('0');

    resolveSeek();
    await Promise.resolve();
    await Promise.resolve();

    expect(seek.value).toBe('750');
    expect(seek.getAttribute('aria-valuetext')).toBe('0:45 of 1:00');
  });
});

describe('transport capabilities and application text', () => {
  it('supports a minimal play/pause binding and reveals only reported data', () => {
    const host = document.createElement('div');
    let state: TransportState = {playing: false};
    const handle = mountTransport(host, {
      snapshot: () => state,
      play: () => { state = {...state, playing: true}; },
      pause: () => { state = {...state, playing: false}; },
    });
    expect(handle.controls.seek).toBeUndefined();
    expect(handle.controls.track.hidden).toBe(true);
    expect(handle.controls.time?.hidden).toBe(true);
    handle.controls.play.click();
    expect(handle.controls.play.getAttribute('aria-label')).toBe('Pause');
    state = {...state, progress: .4};
    handle.update();
    expect(handle.controls.track.hidden).toBe(false);
    expect(handle.controls.fill?.style.width).toBe('40%');
    expect(handle.controls.track.getAttribute('role')).toBe('progressbar');
    expect(handle.controls.time?.hidden).toBe(true);
    state = {...state, progress: undefined, seconds: 30, duration: 120};
    handle.update();
    expect(handle.controls.fill?.style.width).toBe('25%');
    expect(handle.controls.time?.hidden).toBe(false);
    expect(handle.controls.time?.textContent).toBe('0:30 / 2:00');
    handle.destroy();
  });

  it.each(['native', 'surface'] as const)('does not render unsupported %s seek', (seekControl) => {
    const handle = mountTransport(document.createElement('div'), {
      snapshot: () => ({playing: false, progress: .5}), play() {}, pause() {},
    }, {seekControl});
    expect(handle.controls.seek).toBeUndefined();
    expect(handle.controls.fill?.style.width).toBe('50%');
    expect(handle.controls.track.getAttribute('role')).toBe('progressbar');
    expect(handle.controls.track.tabIndex).toBe(-1);
    handle.destroy();
  });

  it.each(['native', 'surface'] as const)('refreshes application %s text without replacing focused controls', (seekControl) => {
    const host = document.createElement('div');
    document.body.append(host);
    const binding = Object.assign(new FakeTransport(), {setVolume: vi.fn()});
    binding.state = {playing: false, progress: .25, seconds: 15, duration: 60, volume: .4};
    let copy: TransportText = {};
    let unit = '';
    const handle = mountTransport(host, binding, {
      seekControl, showVolume: 'fader', getText: () => copy,
      formatters: {time: value => `${value}${unit}`, percent: value => `${Math.round(value * 100)}${unit}`},
    });
    const slider = handle.controls.seek ?? handle.controls.track;
    const volume = handle.controls.volume!;
    slider.focus();
    copy = {
      play: '播放', pause: '暂停', label: '播放器', seek: ({label}) => `${label}位置`,
      seekValue: ({elapsed, duration}) => `${elapsed}，共${duration}`,
      timeTotal: ({duration}) => ` · ${duration}`, volume: '音量',
    };
    unit = '单位';
    expect(handle.controls.play.getAttribute('aria-label')).toBe('Play');
    handle.update(); // The application owns the language notification.
    expect(document.activeElement).toBe(slider);
    expect(handle.controls.volume).toBe(volume);
    expect(handle.controls.play.getAttribute('aria-label')).toBe('播放');
    expect(slider.getAttribute('aria-label')).toBe('播放器位置');
    expect(slider.getAttribute('aria-valuetext')).toBe('15单位，共60单位');
    expect(handle.controls.time?.textContent).toBe('15单位 · 60单位');
    expect(volume.getAttribute('aria-label')).toBe('音量');
    expect(volume.getAttribute('aria-valuetext')).toBe('40单位');
    handle.controls.play.click();
    expect(handle.controls.play.getAttribute('aria-label')).toBe('暂停');
    handle.setVolumeControl('knob');
    expect(handle.controls.volume?.getAttribute('aria-label')).toBe('音量');
    expect(handle.controls.volume?.getAttribute('aria-valuetext')).toBe('40单位');
    handle.destroy();
    host.remove();
  });

  it('preserves native dragging and gives text callbacks raw preview values', () => {
    const binding = Object.assign(new FakeTransport(), {seekFraction: vi.fn()});
    let prefix = 'Position';
    const contexts: Array<{progress: number; seconds?: number; seeking: boolean}> = [];
    const handle = mountTransport(document.createElement('div'), binding, {getText: () => ({
      seekValue: values => { contexts.push(values); return `${prefix} ${values.progress}`; },
    })});
    const seek = handle.controls.seek!;
    seek.dispatchEvent(new Event('pointerdown'));
    seek.value = '700';
    seek.dispatchEvent(new Event('input'));
    prefix = '位置';
    handle.update();
    expect(seek.value).toBe('700');
    expect(seek.getAttribute('aria-valuetext')).toBe('位置 0.7');
    expect(contexts.at(-1)).toMatchObject({progress: .7, seconds: 42, seeking: true});
    handle.destroy();
  });

  it('uses final strings literally and preserves explicit legacy labels', () => {
    const handle = mountTransport(document.createElement('div'), new FakeTransport(), {
      playLabel: 'Audition', getText: () => ({play: 'Ignored', seek: '{literal}'}),
    });
    expect(handle.controls.play.getAttribute('aria-label')).toBe('Audition');
    expect(handle.controls.seek?.getAttribute('aria-label')).toBe('{literal}');
    handle.destroy();
  });

  it('releases a binding subscription returned after synchronous replacement', () => {
    const host = document.createElement('div');
    const release = vi.fn();
    let replacement: ReturnType<typeof mountTransport> | undefined;
    const binding = new FakeTransport();
    binding.subscribe = () => { replacement = mountTransport(host, new FakeTransport()); return release; };
    const stale = mountTransport(host, binding);
    expect(release).toHaveBeenCalledOnce();
    expect(host.querySelector('.wui-transport')).toBe(replacement?.element);
    stale.destroy();
    expect(release).toHaveBeenCalledOnce();
    replacement?.destroy();
  });

  it('falls back when text suppliers and formatters throw, and contains the error sink', () => {
    const failure = new Error('Application text failed');
    const onError = vi.fn(() => { throw new Error('sink'); });
    const handle = mountTransport(document.createElement('div'), new FakeTransport(), {
      getText: () => { throw failure; }, formatters: {time: () => { throw failure; }}, onError,
    });
    expect(handle.controls.play.getAttribute('aria-label')).toBe('Play');
    expect(handle.controls.time?.textContent).toBe('0:00 / 1:00');
    expect(onError).toHaveBeenCalledWith(failure);
    handle.destroy();
  });

  it.each(['fader', 'knob'] as const)('releases a %s returned after a mounting formatter replaces the transport', (showVolume) => {
    const host = document.createElement('div');
    let replacement: ReturnType<typeof mountTransport> | undefined;
    const stale = mountTransport(host, Object.assign(new FakeTransport(), {setVolume() {}}), {
      showVolume, formatters: {percent: () => { replacement ??= mountTransport(host, new FakeTransport()); return 'stale'; }},
    });
    expect(host.querySelectorAll('.wui-transport')).toHaveLength(1);
    expect(host.querySelector('.wui-transport')).toBe(replacement?.element);
    expect(host.querySelector('.wui-transport__volume')).toBeNull();
    stale.destroy();
    replacement?.destroy();
  });

  it('lets a text callback replace a mounting surface transport', () => {
    const host = document.createElement('div');
    let replacement: ReturnType<typeof mountTransport> | undefined;
    const stale = mountTransport(host, new FakeTransport(), {seekControl: 'surface', getText: () => {
      replacement ??= mountTransport(host, new FakeTransport());
      return {play: 'Stale'};
    }});
    expect(host.querySelectorAll('.wui-transport')).toHaveLength(1);
    expect(host.querySelector('.wui-transport')).toBe(replacement?.element);
    stale.destroy();
    replacement?.destroy();
  });

  it('refreshes read-only progress text and stops reading suppliers after destruction', () => {
    let label = 'Progress';
    const getText = vi.fn(() => ({progress: label, seekValue: ({progress}: {progress: number}) => `P${progress}`}));
    const handle = mountTransport(document.createElement('div'), {
      snapshot: () => ({playing: false, progress: .45}), play() {}, pause() {},
    }, {getText});
    label = '位置';
    handle.update();
    expect(handle.controls.track.getAttribute('aria-label')).toBe('位置');
    expect(handle.controls.track.getAttribute('aria-valuetext')).toBe('P0.45');
    handle.destroy();
    getText.mockClear();
    handle.update();
    expect(getText).not.toHaveBeenCalled();
  });
});

describe('transport caller-owned clock visibility', () => {
  it.each([true, false])('preserves explicit clock display across state and text updates (stylesheet: %s)', (stylesheet) => {
    let pause = 'Pause';
    const binding = Object.assign(new FakeTransport(), {setVolume() {}});
    const handle = mountTransport(document.createElement('div'), binding, {stylesheet, getText: () => ({pause})});
    const time = handle.controls.time!;
    const originalDisplay = time.style.display;
    time.style.display = 'none';
    handle.setVolumeControl('fader');
    binding.state.playing = true;
    binding.emit();
    pause = '暂停';
    handle.update();
    expect(time.style.display).toBe('none');
    time.style.display = originalDisplay;
    binding.emit();
    expect(time.style.display).toBe(originalDisplay);
    handle.destroy();
  });

  it('restores caller visibility after automatic hiding for missing data', () => {
    const binding = new FakeTransport();
    const handle = mountTransport(document.createElement('div'), binding, {stylesheet: false});
    const time = handle.controls.time!;
    const track = handle.controls.track;
    expect(time.style.display).toBe('flex');
    binding.state = {playing: false}; binding.emit();
    expect(time.hidden).toBe(true);
    expect(track.hidden).toBe(true);
    binding.state = {playing: false, seconds: 1, duration: 20}; binding.emit();
    expect(time.hidden).toBe(false);
    expect(time.style.display).toBe('flex');
    time.style.display = 'none'; track.style.display = 'grid';
    binding.state = {playing: false}; binding.emit();
    binding.state = {playing: false, seconds: 2, duration: 20}; binding.emit();
    expect(time.style.display).toBe('none');
    expect(track.style.display).toBe('grid');
    handle.destroy();
  });
});

describe('transport missing time in text callbacks', () => {
  it('keeps absent time values absent for progress-only bindings', () => {
    const contexts: Array<{seconds?: number; durationSeconds?: number; progress: number}> = [];
    const handle = mountTransport(document.createElement('div'), {
      snapshot: () => ({playing: false, progress: .5}), play() {}, pause() {},
    }, {getText: () => ({seekValue: values => { contexts.push(values); return 'Half'; }})});
    expect(contexts.at(-1)).toMatchObject({progress: .5, seconds: undefined, durationSeconds: undefined});
    expect(handle.controls.time?.hidden).toBe(true);
    expect(handle.controls.track.getAttribute('aria-valuetext')).toBe('Half');
    handle.destroy();
  });
});
