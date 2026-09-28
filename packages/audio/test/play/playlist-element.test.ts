// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, type AudioClip} from '../../src/core';
import {
  AudioPlaylistElement,
  defineAudioPlaylistElement,
} from '../../src/play/element/audio-playlist';
import * as load from '../../src/play/api/load';
import {AudioPlayer} from '../../src/play/headless/audio-player';
import {AudioPlayerElement, defineAudioPlayerElement} from '../../src/play/element/audio-player';

function clip(seconds = 1): AudioClip {
  return createAudioClip({
    sampleRate: 1_000,
    channelData: [new Float32Array(seconds * 1_000)],
  });
}

/**
 * The element builds real AudioClipPlayers, which mint an AudioContext on
 * first play. jsdom has none, so a minimal constructor stands in — the tests
 * here are about queue wiring and DOM, not about audio output.
 */
function installAudioContext(): void {
  const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
  class StubAudioContext {
    state = 'running';
    currentTime = 0;
    destination = node();
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {});
    createGain = vi.fn(() => ({...node(), gain: {value: 1}}));
    createStereoPanner = vi.fn(() => ({...node(), pan: {value: 0}}));
    createAnalyser = vi.fn(() => ({...node(), fftSize: 0, smoothingTimeConstant: 0}));
    createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }));
    createBufferSource = vi.fn(() => ({
      ...node(),
      buffer: null,
      playbackRate: {value: 1},
      loop: false,
      loopStart: 0,
      loopEnd: 0,
      onended: null,
      start: vi.fn(),
      stop: vi.fn(),
    }));
  }
  vi.stubGlobal('AudioContext', StubAudioContext);
}

defineAudioPlaylistElement();
defineAudioPlayerElement();

const flush = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

function mount(html = ''): AudioPlaylistElement {
  const element = document.createElement('audio-playlist') as AudioPlaylistElement;
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

beforeEach(() => {
  installAudioContext();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<audio-playlist>', () => {
  it('registers once and is idempotent', () => {
    defineAudioPlaylistElement();
    expect(customElements.get('audio-playlist')).toBe(AudioPlaylistElement);
  });

  it('reads entries from light-DOM children', () => {
    const element = mount(
      '<li data-src="a.mp3">Intro</li><li data-src="b.mp3" data-id="verse">Verse</li>',
    );

    expect(element.entries.map((entry) => entry.id)).toEqual(['a.mp3', 'verse']);
    expect(element.entries[0]!.label).toBe('Intro');
    const rows = element.shadowRoot!.querySelectorAll('.wui-playlist__item');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Intro');
  });

  it('reads entries from a comma separated src attribute', () => {
    const element = document.createElement('audio-playlist') as AudioPlaylistElement;
    element.setAttribute('src', 'one.mp3, two.mp3');
    document.body.append(element);

    expect(element.entries.map((entry) => entry.id)).toEqual(['one.mp3', 'two.mp3']);
    // A row is never blank: the file name stands in for a missing label.
    expect(element.shadowRoot!.textContent).toContain('one.mp3');
  });

  it('lets an assigned entries property win over markup', () => {
    const element = mount('<li data-src="ignored.mp3">Ignored</li>');
    element.entries = [{id: 'x', label: 'Assigned', clip: clip()}];

    expect(element.entries.map((entry) => entry.id)).toEqual(['x']);
    expect(element.shadowRoot!.textContent).toContain('Assigned');
  });

  it('marks the current row and moves it on next()', async () => {
    const element = mount();
    element.entries = [
      {id: 'a', label: 'A', clip: clip()},
      {id: 'b', label: 'B', clip: clip()},
    ];
    await element.play();
    await flush();

    const rows = () => [...element.shadowRoot!.querySelectorAll('.wui-playlist__item')];
    expect(rows()[0]!.getAttribute('aria-current')).toBe('true');

    await element.next();
    await flush();
    expect(element.index).toBe(1);
    expect(rows()[1]!.getAttribute('aria-current')).toBe('true');
    expect(rows()[0]!.getAttribute('aria-current')).toBe('false');
  });

  it('dispatches trackchange and playlistend, never webaudio:end', async () => {
    const element = mount();
    const events: string[] = [];
    for (const name of ['trackchange', 'trackend', 'playlistend', 'end']) {
      element.addEventListener(`webaudio:${name}`, () => events.push(name));
    }
    element.entries = [{id: 'only', label: 'Only', clip: clip()}];

    await element.play();
    await flush();
    element.playlist!.dispose();

    expect(events).toContain('trackchange');
    // webaudio:end already means "one clip finished" on <audio-player>;
    // overloading it would make the two indistinguishable on one page.
    expect(events).not.toContain('end');
  });

  it('selects an entry when its row is clicked', async () => {
    const element = mount();
    element.entries = [
      {id: 'a', label: 'A', clip: clip()},
      {id: 'b', label: 'B', clip: clip()},
    ];
    await flush();

    const rows = [...element.shadowRoot!.querySelectorAll<HTMLElement>('.wui-playlist__item')];
    rows[1]!.click();
    await flush();

    expect(element.index).toBe(1);
  });

  it('plays and pauses from the presenter toggle', async () => {
    const element = mount();
    element.entries = [{id: 'a', label: 'A', clip: clip()}];
    await flush();

    const toggle = element.shadowRoot!.querySelector<HTMLButtonElement>('.wui-playlist__button.play')!;
    toggle.click();
    await flush();
    expect(element.playing).toBe(true);

    toggle.click();
    await flush();
    expect(element.playing).toBe(false);
  });

  it('announces a user seek with seconds and progress', async () => {
    const element = mount();
    const seeks: Array<{seconds: number; progress: number}> = [];
    element.addEventListener('webaudio:seek', (event) => {
      seeks.push((event as CustomEvent<{seconds: number; progress: number}>).detail);
    });
    element.entries = [{id: 'a', label: 'A', clip: clip(4)}];
    await element.play();
    await flush();

    const seek = element.shadowRoot!.querySelector<HTMLInputElement>('.wui-playlist__seek')!;
    seek.value = '500';
    seek.dispatchEvent(new Event('input'));
    await flush();

    expect(seeks).toHaveLength(1);
    expect(seeks[0]!.progress).toBe(0.5);
    expect(Number.isFinite(seeks[0]!.seconds)).toBe(true);
  });

  it('shows a failed entry as an error row', async () => {
    vi.spyOn(load, 'loadClipFromUrl').mockRejectedValue(new Error('404'));
    const element = mount();
    const errors: unknown[] = [];
    element.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent).detail);
    });
    element.entries = [{id: 'broken', label: 'Broken', src: 'missing.mp3'}];

    await element.play();
    await flush();

    const row = element.shadowRoot!.querySelector<HTMLElement>('.wui-playlist__item')!;
    expect(row.dataset.status).toBe('error');
    expect(errors).toHaveLength(1);
  });

  it('exposes the facade <audio-view> binds to', async () => {
    const element = mount();
    const source = clip(3);
    element.entries = [{id: 'a', label: 'A', clip: source}];
    await element.play();
    await flush();

    expect(element.clip).toBe(source);
    expect(element.duration).toBeGreaterThan(0);
    expect(typeof element.currentTime).toBe('number');
    expect(typeof element.seek).toBe('function');
    expect(element.activePlayer).toBeDefined();
  });

  it('applies volume in place without rebuilding the queue', async () => {
    const element = mount();
    element.entries = [{id: 'a', label: 'A', clip: clip()}];
    await element.play();
    await flush();
    const queue = element.playlist;

    element.setAttribute('volume', '0.3');
    await flush();

    expect(element.playlist).toBe(queue);
    expect(element.playing).toBe(true);
  });

  it('tears the queue down when disconnected', async () => {
    const element = mount();
    element.entries = [{id: 'a', label: 'A', clip: clip()}];
    await element.play();
    await flush();

    element.remove();
    expect(element.playlist).toBeUndefined();
    expect(element.playing).toBe(false);
  });

  it('constructs in Node without a document', () => {
    expect(() => new AudioPlaylistElement()).not.toThrow();
  });
});


describe('<audio-playlist> live policy configuration', () => {
  it('keeps selection, player, position and cache through policy and ignored src changes', async () => {
    const element = mount();
    const first = clip(2);
    const second = clip(2);
    element.entries = [{id: 'a', clip: first}, {id: 'b', clip: second}];
    await element.select('b');
    await element.play();
    element.seek(0.4);
    const queue = element.playlist;
    const player = element.activePlayer;
    for (const [name, value] of [['loop', ''], ['prefetch', 'false'], ['skip-failed', 'false'],
      ['autoplay', 'false'], ['src', 'ignored.mp3']]) {
      element.setAttribute(name!, value!);
      expect(element.playlist).toBe(queue);
      expect(element.activePlayer).toBe(player);
      expect(element.index).toBe(1);
      expect(element.currentTime).toBeCloseTo(0.4);
      expect(element.playing).toBe(true);
      expect(queue?.clipOf('a')).toBe(first);
      expect(queue?.clipOf('b')).toBe(second);
    }
  });

  it('starts autoplay on the existing selection and routes rejection to the error event', async () => {
    const element = mount();
    element.entries = [{id: 'a', clip: clip()}, {id: 'b', clip: clip()}];
    await element.select('b');
    const queue = element.playlist!;
    element.setAttribute('autoplay', '');
    await flush();
    expect(element.playlist).toBe(queue);
    expect(element.index).toBe(1);
    expect(element.playing).toBe(true);
    element.setAttribute('autoplay', 'false');
    expect(element.playing).toBe(true);
    element.pause();
    const failure = new Error('autoplay blocked');
    vi.spyOn(queue, 'play').mockRejectedValue(failure);
    const errors: unknown[] = [];
    element.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    element.setAttribute('autoplay', '');
    await flush();
    expect(errors).toEqual([failure]);
    expect(element.playlist).toBe(queue);
  });
});


describe('playlist companion binding', () => {
  it('unwraps the actual canonical Element and discovers a nested companion', async () => {
    const ownerElement = document.createElement('audio-player') as AudioPlayerElement;
    const element = document.createElement('audio-playlist') as AudioPlaylistElement;
    element.entries = [{id: 'a', clip: clip()}];
    ownerElement.append(element);
    document.body.append(ownerElement);
    await flush();
    expect(element.player).toBe(ownerElement.player);
    expect(ownerElement.player!.transport).toBe(element.playlist);
    expect(element.shadowRoot!.querySelector('.wui-playlist__bar')).toBeNull();
    await ownerElement.play();
    expect(element.playing).toBe(true);
    ownerElement.pause();
    expect(element.playing).toBe(false);
  });

  it('retries a target when its custom element upgrades', async () => {
    const target = document.createElement('late-companion-audio-player');
    target.id = 'late-upgrade-deck';
    document.body.append(target);
    const element = mount();
    element.setAttribute('player', '#late-upgrade-deck');
    expect(element.player).toBeUndefined();
    customElements.define('late-companion-audio-player', class extends AudioPlayerElement {});
    await flush();
    expect(element.player).toBe((target as AudioPlayerElement).player);
    expect(element.player!.transport).toBe(element.playlist);
  });

  it('selects entries through one central player without a second transport surface', async () => {
    const owner = new AudioPlayer();
    const element = document.createElement('audio-playlist') as AudioPlaylistElement;
    element.player = owner;
    const first = clip(2), second = clip(3);
    element.entries = [{id: 'a', clip: first}, {id: 'b', clip: second}];
    document.body.append(element);
    expect(owner.transport).toBe(element.playlist);
    expect(element.shadowRoot!.querySelector('.wui-playlist__bar')).toBeNull();
    await owner.play();
    expect(element.playing).toBe(true);
    expect(owner.clip).toBe(first);
    owner.pause();
    await element.select('b');
    expect(owner.clip).toBe(second);
    expect(owner.playing).toBe(false);
    const dispose = vi.spyOn(owner, 'dispose');
    element.remove();
    expect(owner.transport).toBeUndefined();
    expect(dispose).not.toHaveBeenCalled();
    owner.dispose();
  });

  it('publishes direct queue commands and paused source replacement through the owner', async () => {
    const owner = new AudioPlayer();
    const element = mount();
    element.player = owner;
    const first = clip(2), replacement = clip(4);
    element.entries = [{id: 'a', clip: first}];
    const states: boolean[] = [];
    const sources: Array<AudioClip | undefined> = [];
    owner.on('statechange', ({playing}) => states.push(playing));
    owner.on('sourcechange', ({clip: source}) => sources.push(source));
    await element.playlist!.play();
    expect(states.at(-1)).toBe(true);
    element.playlist!.pause();
    expect(states.at(-1)).toBe(false);
    element.entries = [{id: 'a', clip: replacement}];
    expect(sources.at(-1)).toBe(replacement);
    element.remove(); owner.dispose();
  });

  it('does not start standalone playback while an explicit target is missing', async () => {
    const element = document.createElement('audio-playlist') as AudioPlaylistElement;
    element.setAttribute('player', '#later-deck');
    element.setAttribute('autoplay', '');
    element.entries = [{id: 'a', clip: clip()}];
    document.body.append(element);
    await element.play();
    expect(element.playing).toBe(false);
    expect(element.activePlayer).toBeUndefined();
    expect(element.shadowRoot!.querySelector('.wui-playlist__bar')).toBeNull();
  });

  it('follows a unique late target, replacement, and playerchange without disposing borrowed owners', async () => {
    const element = document.createElement('audio-playlist') as AudioPlaylistElement;
    element.setAttribute('player', '#queue-deck');
    document.body.append(element);
    const first = new AudioPlayer(), second = new AudioPlayer(), third = new AudioPlayer();
    const target = document.createElement('div') as HTMLDivElement & {player: AudioPlayer};
    target.id = 'queue-deck'; target.player = first;
    document.body.append(target);
    await flush();
    expect(element.player).toBe(first);
    expect(first.transport).toBe(element.playlist);
    target.player = second;
    target.dispatchEvent(new CustomEvent('webaudio:playerchange'));
    expect(first.transport).toBeUndefined();
    expect(second.transport).toBe(element.playlist);
    const replacement = document.createElement('div') as HTMLDivElement & {player: AudioPlayer};
    replacement.id = target.id; replacement.player = third;
    target.replaceWith(replacement);
    await flush();
    expect(second.transport).toBeUndefined();
    expect(element.player).toBe(third);
    replacement.remove();
    await flush();
    expect(third.transport).toBeUndefined();
    expect(element.player).toBeUndefined();
    expect(element.shadowRoot!.querySelector('.wui-playlist__bar')).toBeNull();
    first.dispose(); second.dispose(); third.dispose();
  });

  it('never clears a newer transport when this companion disconnects', () => {
    const owner = new AudioPlayer();
    const element = mount();
    element.player = owner;
    const transport = {
      seconds: 0, duration: 0, playing: false,
      play() {}, pause() {}, stop() {}, seek() {},
    };
    owner.setTransport(transport);
    element.remove();
    expect(owner.transport).toBe(transport);
    owner.dispose();
  });

  it('does not choose among ambiguous selectors', async () => {
    const owner = new AudioPlayer();
    for (let index = 0; index < 2; index++) {
      const target = document.createElement('div') as HTMLDivElement & {player: AudioPlayer};
      target.className = 'ambiguous-deck'; target.player = owner;
      document.body.append(target);
    }
    const element = mount();
    element.setAttribute('player', '.ambiguous-deck');
    await flush();
    expect(element.player).toBeUndefined();
    expect(owner.transport).toBeUndefined();
    owner.dispose();
  });
});
