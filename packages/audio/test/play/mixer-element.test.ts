// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, type AudioClip} from '../../src/core';
import {AudioMixer, type AudioMixerOptions} from '../../src/play/headless/mixer';
import type {PlayerLike} from '../../src/play/headless/player';
import {AudioPlayer} from '../../src/play/headless/audio-player';
import {
  AudioMixerElement,
  defineAudioMixerElement,
} from '../../src/play/element/audio-mixer';

interface FakePlayer extends PlayerLike {
  calls: string[];
  volume: number;
  playing: boolean;
  fireEnd(): void;
}

/**
 * A structural PlayerLike: the desk's wiring (ids, gains, transport) is what
 * these tests are about, so no member needs a decoded buffer. `failPlay`
 * models the transport failure the engine reports through `error`.
 */
function fakePlayer(options: {failPlay?: boolean} = {}): FakePlayer {
  const calls: string[] = [];
  let endListener: (() => void) | null = null;
  return {
    calls,
    volume: 1,
    playing: false,
    play() {
      calls.push('play');
      return options.failPlay ? Promise.reject(new Error('no output device')) : Promise.resolve();
    },
    pause() {
      calls.push('pause');
      this.playing = false;
    },
    stop() {
      calls.push('stop');
      this.playing = false;
    },
    seek(seconds: number) {
      calls.push(`seek:${seconds}`);
    },
    setVolume(volume: number) {
      this.volume = volume;
    },
    on(event: string, listener: (data: unknown) => void) {
      if (event === 'end') endListener = listener as () => void;
      return () => {
        if (event === 'end') endListener = null;
      };
    },
    dispose() {
      calls.push('dispose');
    },
    fireEnd() {
      endListener?.();
    },
  };
}

function clip(seconds = 1): AudioClip {
  return createAudioClip({
    sampleRate: 1_000,
    channelData: [new Float32Array(seconds * 1_000)],
  });
}

/** Every AudioContext the code under test minted for itself. */
let contexts: StubAudioContext[] = [];

/**
 * The mixer mints an AudioContext the moment a clip member joins or transport
 * starts. jsdom has none, so a minimal constructor stands in.
 */
class StubAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {connect: vi.fn(), disconnect: vi.fn()};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createGain = vi.fn(() => ({connect: vi.fn(), disconnect: vi.fn(), gain: {value: 1}}));
  createStereoPanner = vi.fn(() => ({connect: vi.fn(), disconnect: vi.fn(), pan: {value: 0}}));
  createAnalyser = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    fftSize: 0,
    smoothingTimeConstant: 0,
  }));
  createBuffer = vi.fn((channels: number, length: number, sampleRate: number) => ({
    numberOfChannels: channels,
    length,
    sampleRate,
    duration: length / sampleRate,
    getChannelData: () => new Float32Array(length),
  }));
  createBufferSource = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    buffer: null,
    playbackRate: {value: 1},
    loop: false,
    onended: null,
    start: vi.fn(),
    stop: vi.fn(),
  }));
}

/** Records the options the element hands to its mixer factory hook. */
class ProbeAudioMixerElement extends AudioMixerElement {
  built: AudioMixerOptions[] = [];

  protected override createMixer(options: AudioMixerOptions): AudioMixer {
    this.built.push(options);
    return super.createMixer(options);
  }
}

defineAudioMixerElement();
customElements.define('probe-audio-mixer', ProbeAudioMixerElement);

const flush = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

function mount(tag = 'audio-mixer'): AudioMixerElement {
  const element = document.createElement(tag) as AudioMixerElement;
  document.body.append(element);
  return element;
}

/** The member strips, in desk order (the master fader lives outside them). */
function strips(element: AudioMixerElement): string[] {
  const labels = element.shadowRoot?.querySelectorAll('.wui-mixer__channels .wui-mixer__label');
  return [...(labels ?? [])].map((node) => node.textContent ?? '');
}

/**
 * The strip's level control is the UI Kit's shared fader — an ARIA slider drawn
 * from elements, so its level is `aria-valuenow` rather than a native `.value`.
 */
function masterFaderLevel(element: AudioMixerElement): string | null {
  return element
    .shadowRoot!.querySelector<HTMLElement>('.wui-mixer__master .wui-mixer__input')!
    .getAttribute('aria-valuenow');
}

function soloButton(element: AudioMixerElement, index: number): HTMLButtonElement {
  return element.shadowRoot!.querySelectorAll<HTMLButtonElement>(
    '.wui-mixer__channels .wui-mixer__button.solo',
  )[index]!;
}

beforeEach(() => {
  contexts = [];
  vi.stubGlobal(
    'AudioContext',
    class extends StubAudioContext {
      constructor() {
        super();
        contexts.push(this);
      }
    },
  );
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<audio-mixer>', () => {
  it('registers once and is idempotent', () => {
    defineAudioMixerElement();
    expect(customElements.get('audio-mixer')).toBe(AudioMixerElement);
  });

  it('forwards an engine failure to the DOM as webaudio:error', async () => {
    const element = mount();
    const player = fakePlayer({failPlay: true});
    player.playing = true;
    const mixer = new AudioMixer();
    mixer.add({id: 'stem', player});
    element.mixer = mixer;
    const errors: unknown[] = [];
    element.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent<unknown>).detail);
    });

    // A seek while sounding restarts the stems together; the restart failing
    // is reachable only through the engine's `error` event.
    mixer.seek(4);
    await flush();

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe('no output device');
  });

  it('announces end and memberend, and repaints on both', () => {
    const element = mount();
    const drums = fakePlayer();
    const mixer = new AudioMixer();
    mixer.add({id: 'drums', player: drums});
    element.mixer = mixer;
    const seen: string[] = [];
    element.addEventListener('webaudio:memberend', () => seen.push('memberend'));
    element.addEventListener('webaudio:end', () => seen.push('end'));

    drums.fireEnd();

    expect(seen).toEqual(['memberend', 'end']);
  });

  it('shows a member added to a borrowed mixer after attach', () => {
    const element = mount();
    const mixer = new AudioMixer();
    mixer.add({id: 'drums', player: fakePlayer()});
    element.mixer = mixer;
    expect(strips(element)).toEqual(['drums']);

    // The Headless change subscription repaints without an Element command.
    mixer.add({id: 'bass', player: fakePlayer()});

    expect(strips(element)).toEqual(['drums', 'bass']);
  });

  it('repaints an external master change without a command round-trip', () => {
    const element = mount();
    const drums = fakePlayer();
    const mixer = new AudioMixer();
    mixer.add({id: 'drums', player: drums});
    element.mixer = mixer;
    expect(masterFaderLevel(element)).toBe('1');

    element.masterVolume = 0.25;

    expect(masterFaderLevel(element)).toBe('0.25');
    expect(drums.volume).toBeCloseTo(0.25);
  });

  it('drives the master fader from the master-volume attribute, in place', () => {
    const element = document.createElement('audio-mixer') as AudioMixerElement;
    const drums = fakePlayer();
    element.setAttribute('master-volume', '0.4');
    element.members = [{id: 'drums', player: drums}];
    document.body.append(element);

    expect(element.masterVolume).toBe(0.4);
    expect(drums.volume).toBeCloseTo(0.4);
    expect(masterFaderLevel(element)).toBe('0.4');

    const mixer = element.mixer;
    element.setAttribute('master-volume', '0.8');

    expect(drums.volume).toBeCloseTo(0.8);
    expect(masterFaderLevel(element)).toBe('0.8');
    // A live knob never costs the running graph.
    expect(element.mixer).toBe(mixer);
  });

  it('solos from the solo attribute and clears when it is removed', () => {
    const element = document.createElement('audio-mixer') as AudioMixerElement;
    const drums = fakePlayer();
    const vocal = fakePlayer();
    element.setAttribute('solo', 'vocal');
    element.members = [
      {id: 'drums', player: drums},
      {id: 'vocal', player: vocal},
    ];
    document.body.append(element);

    expect(drums.volume).toBe(0);
    expect(vocal.volume).toBe(1);
    expect(soloButton(element, 1).getAttribute('aria-pressed')).toBe('true');

    element.removeAttribute('solo');

    expect(drums.volume).toBe(1);
    expect(soloButton(element, 1).getAttribute('aria-pressed')).toBe('false');
  });

  it('starts the desk from the autoplay attribute', async () => {
    const element = document.createElement('audio-mixer') as AudioMixerElement;
    const drums = fakePlayer();
    element.setAttribute('autoplay', '');
    element.members = [{id: 'drums', player: drums}];
    document.body.append(element);
    await flush();

    expect(drums.calls).toContain('play');
  });

  it('round-trips the members it was given', () => {
    const element = mount();
    const specs = [
      {id: 'drums', player: fakePlayer()},
      {id: 'bass', player: fakePlayer()},
    ];
    element.members = specs;

    expect(element.members.map((spec) => spec.id)).toEqual(['drums', 'bass']);
    expect(Object.isFrozen(element.members)).toBe(true);
    // A copy, so a caller mutating its own array cannot desync the desk.
    specs.pop();
    expect(element.members).toHaveLength(2);

    element.members = undefined;
    expect(element.members).toEqual([]);
  });

  it('passes seek, add and remove through to the engine', () => {
    const element = mount();
    const drums = fakePlayer();
    const bass = fakePlayer();
    element.members = [{id: 'drums', player: drums}];

    element.seek(3);
    expect(drums.calls).toContain('seek:3');

    element.add({id: 'bass', player: bass, volume: 0.5});
    expect(strips(element)).toEqual(['drums', 'bass']);
    expect(element.members.map((spec) => spec.id)).toEqual(['drums', 'bass']);
    expect(element.mixer?.ids()).toEqual(['drums', 'bass']);

    element.remove('drums');
    expect(strips(element)).toEqual(['bass']);
    expect(element.members.map((spec) => spec.id)).toEqual(['bass']);
    // A borrowed player is never the desk's to dispose.
    expect(drums.calls).not.toContain('dispose');
  });

  it('still detaches itself when remove() is called with no id', () => {
    const element = mount();
    element.members = [{id: 'drums', player: fakePlayer()}];

    element.remove();

    expect(element.isConnected).toBe(false);
    expect(element.mixer).toBeUndefined();
  });

  it('lets a member join as an existing PlayerLike', () => {
    const element = mount();
    const borrowed = fakePlayer();
    element.members = [{id: 'guest', player: borrowed}];

    expect(element.mixer?.ids()).toEqual(['guest']);
    // No context is minted for a member that brings its own player.
    expect(contexts).toHaveLength(0);
  });

  it('builds the owned mixer on a shared context and destination', () => {
    const shared = new AudioContext();
    const sink = shared.createGain();
    const element = mount('probe-audio-mixer') as ProbeAudioMixerElement;
    element.audioContext = shared;
    element.destination = sink;
    element.masterVolume = 0.6;
    element.members = [{id: 'stem', clip: clip()}];

    expect(element.built).toHaveLength(1);
    expect(element.built[0]!.audioContext).toBe(shared);
    expect(element.built[0]!.destination).toBe(sink);
    expect(element.built[0]!.masterVolume).toBe(0.6);
    // One page, one clock: the desk must not have minted a second context.
    expect(contexts).toHaveLength(1);

    element.remove();
    expect(shared.close).not.toHaveBeenCalled();
  });

  it('reports a member spec carrying neither clip nor player, and keeps the rest', () => {
    const element = mount();
    const errors: unknown[] = [];
    element.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent<unknown>).detail);
    });

    element.members = [{id: 'empty'}, {id: 'drums', player: fakePlayer()}];

    expect(errors).toHaveLength(1);
    expect(strips(element)).toEqual(['drums']);
  });
});


describe('<audio-mixer> shared Headless state', () => {
  function channelLevel(element: AudioMixerElement): string | null {
    return element.shadowRoot!.querySelector('.wui-mixer__channels .wui-mixer__input')!
      .getAttribute('aria-valuenow');
  }
  function mutedState(element: AudioMixerElement): string | null {
    return element.shadowRoot!.querySelector('.wui-mixer__button.mute')!.getAttribute('aria-pressed');
  }

  it('reads a borrowed mix without overwriting its initial settings', () => {
    const mixer = new AudioMixer({masterVolume: 0.6});
    const player = fakePlayer();
    mixer.add({id: 'a', player, volume: 0.3});
    mixer.mute('a');
    const element = mount();
    element.mixer = mixer;
    expect(masterFaderLevel(element)).toBe('0.6');
    expect(channelLevel(element)).toBe('0.3');
    expect(mutedState(element)).toBe('true');
    expect(element.masterVolume).toBe(0.6);
    expect(player.volume).toBe(0);
    element.remove();
    expect(mixer.ids()).toEqual(['a']);
    mixer.dispose();
  });

  it('updates two presenters from external and UI commands and detaches subscriptions', () => {
    const mixer = new AudioMixer();
    mixer.add({id: 'a', player: fakePlayer()});
    const first = mount();
    const second = mount();
    first.mixer = mixer;
    second.mixer = mixer;
    mixer.setVolume('a', 0.2);
    mixer.setMasterVolume(0.4);
    mixer.solo('a');
    for (const element of [first, second]) {
      expect(channelLevel(element)).toBe('0.2');
      expect(masterFaderLevel(element)).toBe('0.4');
      expect(soloButton(element, 0).getAttribute('aria-pressed')).toBe('true');
    }
    first.shadowRoot!.querySelector<HTMLButtonElement>('.wui-mixer__button.mute')!.click();
    expect(mutedState(second)).toBe('true');
    first.remove();
    mixer.remove('a');
    expect(strips(second)).toEqual([]);
    second.remove();
    mixer.dispose();
  });

  it('does not dispose its mixer when the same instance is assigned again', () => {
    const element = mount();
    element.members = [{id: 'a', player: fakePlayer()}];
    const owned = element.mixer!;
    element.mixer = owned;
    expect(owned.ids()).toEqual(['a']);
    element.remove();
    expect(owned.ids()).toEqual([]);
  });
});


describe('mixer companion binding', () => {
  it('uses the central transport and retains only mixer controls', async () => {
    const owner = new AudioPlayer();
    const element = mount();
    element.members = [{id: 'stem', clip: clip(3)}];
    element.player = owner;
    expect(owner.transport).toBe(element.mixer!.transport);
    expect(element.shadowRoot!.querySelector('.wui-mixer__transport')).toBeNull();
    expect(strips(element)).toEqual(['stem']);
    await owner.play();
    expect(owner.playing).toBe(true);
    owner.pause();
    expect(owner.playing).toBe(false);
    const dispose = vi.spyOn(owner, 'dispose');
    element.remove();
    expect(owner.transport).toBeUndefined();
    expect(dispose).not.toHaveBeenCalled();
    owner.dispose();
  });

  it('publishes direct mixer commands through the owner without another clock', async () => {
    const owner = new AudioPlayer();
    const element = mount();
    element.members = [{id: 'stem', clip: clip(3)}];
    element.player = owner;
    const states: boolean[] = [];
    owner.on('statechange', ({playing}) => states.push(playing));
    await element.mixer!.play();
    expect(states.at(-1)).toBe(true);
    element.mixer!.pause();
    expect(states.at(-1)).toBe(false);
    expect(owner.duration).toBe(3);
    owner.seek(0.5);
    expect(owner.seconds).toBeCloseTo(0.5);
    element.remove(); owner.dispose();
  });

  it('does not autoplay while its declared owner is missing', async () => {
    const element = document.createElement('audio-mixer') as AudioMixerElement;
    element.setAttribute('player', '#missing-mix-deck');
    element.setAttribute('autoplay', '');
    const source = fakePlayer();
    element.members = [{id: 'stem', player: source}];
    document.body.append(element);
    await flush();
    expect(source.calls).not.toContain('play');
    expect(element.shadowRoot!.querySelector('.wui-mixer__transport')).toBeNull();
  });

  it('borrows a caller-owned mixer and never disposes it on companion removal', () => {
    const owner = new AudioPlayer();
    const mixer = new AudioMixer();
    const dispose = vi.spyOn(mixer, 'dispose');
    const element = mount();
    element.mixer = mixer;
    element.player = owner;
    element.remove();
    expect(owner.transport).toBeUndefined();
    expect(dispose).not.toHaveBeenCalled();
    mixer.dispose(); owner.dispose();
  });
});
