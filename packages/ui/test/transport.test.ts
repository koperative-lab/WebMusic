// @vitest-environment jsdom

import {describe, expect, it, vi} from 'vitest';
import {
  createTransportIcon,
  mountTransport,
  transportStateStyle,
  type TransportBinding,
  type TransportState,
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
