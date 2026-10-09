// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, createRegion, type AudioClip} from '../../src/core';
import {
  AudioPlayerElement,
  defineAudioPlayerElement,
  type AudioPlayerSeekDetail,
} from '../../src/play/element/audio-player';
import {AudioPlayer, type AudioPlayerOptions, type AudioPlayerTransport} from '../../src/play/headless/audio-player';
import * as load from '../../src/play/api/load';

function clip(seconds = 1): AudioClip {
  return createAudioClip({
    sampleRate: 1_000,
    channelData: [new Float32Array(seconds * 1_000)],
  });
}

const contexts: StubAudioContext[] = [];

const node = () => ({connect: vi.fn(), disconnect: vi.fn()});

/**
 * The element builds a real AudioClipPlayer and now mints an AudioContext for
 * decoding, which jsdom has none of. This stand-in carries the buffer-engine
 * surface plus `decodeAudioData`, the branch decode.ts only takes when a
 * context is handed over.
 */
class StubAudioContext {
  state = 'running';
  currentTime = 0;
  destination = node();
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  decodeAudioData = vi.fn(async () => ({
    numberOfChannels: 1,
    length: 1_000,
    sampleRate: 1_000,
    duration: 1,
    getChannelData: () => new Float32Array(1_000),
  }));
  createGain = vi.fn(() => ({...node(), gain: {value: 1}}));
  createStereoPanner = vi.fn(() => ({...node(), pan: {value: 0}}));
  // `context` is what lets a borrowed player hand its own context back.
  createAnalyser = vi.fn(() => ({...node(), context: this, fftSize: 0, smoothingTimeConstant: 0}));
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
  constructor() {
    contexts.push(this);
  }
}

/** Captures what reaches the player constructor through the `createPlayer` hook. */
const built: AudioPlayerOptions[] = [];

class ProbeClipPlayerElement extends AudioPlayerElement {
  protected override createPlayer(source: AudioClip | undefined, options: AudioPlayerOptions): AudioPlayer {
    built.push(options);
    return super.createPlayer(source, options);
  }
}

defineAudioPlayerElement();
customElements.define('probe-clip-player', ProbeClipPlayerElement);

const flush = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 0));

function mount(attributes: Record<string, string> = {}, tag = 'audio-player'): AudioPlayerElement {
  const element = document.createElement(tag) as AudioPlayerElement;
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

function transportOf(element: AudioPlayerElement): Element {
  const root = element.shadowRoot?.querySelector('.wui-transport');
  if (!root) throw new Error('transport not mounted');
  return root;
}

beforeEach(() => {
  contexts.length = 0;
  built.length = 0;
  vi.stubGlobal('AudioContext', StubAudioContext);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<audio-player>', () => {
  it('registers once and is idempotent', () => {
    defineAudioPlayerElement();
    expect(customElements.get('audio-player')).toBe(AudioPlayerElement);
  });

  it.each(['src', 'load'] as const)('shows waiting and %s loading without remounting transport controls', async (kind) => {
    let resolve!: (value: AudioClip) => void;
    const pending = new Promise<AudioClip>((done) => { resolve = done; });
    vi.spyOn(load, 'loadClipFromUrl').mockReturnValue(pending);
    vi.spyOn(load, 'loadClip').mockReturnValue(pending);
    const element = mount();
    const loadStates: boolean[] = [];
    element.addEventListener('webaudio:loadstatechange', (event) => loadStates.push((event as CustomEvent).detail.loading));
    const transport = transportOf(element);
    const button = transport.querySelector('button');
    const status = element.shadowRoot!.querySelector<HTMLElement>('[part~="status"]')!;
    expect(status.dataset.kind).toBe('waiting');
    expect(status.textContent).toBe('Waiting for an audio source');
    if (kind === 'src') element.setAttribute('src', '/pending.wav');
    const loading = kind === 'load' ? element.load(new ArrayBuffer(8)) : undefined;
    expect(element.loading).toBe(true);
    expect(status.dataset.kind).toBe('loading');
    expect(status.getAttribute('aria-busy')).toBe('true');
    resolve(clip(2));
    await loading;
    await flush();
    expect(element.loading).toBe(false);
    expect(element.loadError).toBeUndefined();
    expect(status.hidden).toBe(true);
    expect(status.hasAttribute('aria-busy')).toBe(false);
    expect(transportOf(element)).toBe(transport);
    expect(transport.querySelector('button')).toBe(button);
    expect(element.duration).toBe(2);
    expect(loadStates).toEqual([true, false]);
  });

  it('keeps replacement loading visible over the retained source and settles only the current request', async () => {
    const requests: Array<{resolve(value: AudioClip): void}> = [];
    vi.spyOn(load, 'loadClipFromUrl').mockImplementation(() => new Promise((resolve) => requests.push({resolve})));
    const element = mount();
    element.clip = clip(2);
    const transport = transportOf(element);
    element.setAttribute('src', '/old.wav');
    element.setAttribute('src', '/new.wav');
    const status = element.shadowRoot!.querySelector<HTMLElement>('[part~="status"]')!;
    expect(status.dataset.kind).toBe('loading');
    expect(element.duration).toBe(2);
    expect(transport.querySelector('button')?.disabled).toBe(false);
    requests[0]!.resolve(clip(3));
    await flush();
    expect(status.dataset.kind).toBe('loading');
    expect(element.duration).toBe(2);
    requests[1]!.resolve(clip(4));
    await flush();
    expect(status.hidden).toBe(true);
    expect(element.duration).toBe(4);
    expect(transportOf(element)).toBe(transport);
  });

  it('shows current load errors, clears them on source selection, and releases feedback on removal', async () => {
    vi.spyOn(load, 'loadClip').mockRejectedValue(new Error('Cannot decode audio'));
    const element = mount();
    const errors: unknown[] = [];
    element.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    await element.load(new ArrayBuffer(8));
    const status = element.shadowRoot!.querySelector<HTMLElement>('[part~="status"]')!;
    expect(status.dataset.kind).toBe('error');
    expect(status.getAttribute('role')).toBe('alert');
    expect(status.textContent).toBe('Cannot decode audio');
    expect(element.loading).toBe(false);
    expect(element.loadError?.message).toBe('Cannot decode audio');
    expect(errors).toHaveLength(1);
    element.clip = clip();
    expect(status.hidden).toBe(true);
    element.clip = undefined;
    expect(status.dataset.kind).toBe('waiting');
    element.remove();
    expect(element.shadowRoot!.querySelector('[part~="status"]')).toBeNull();
  });

  it.each([
    ['src', 'clip'], ['src', 'transport'], ['load', 'clip'], ['load', 'transport'],
  ] as const)('keeps a direct owner %s / %s choice ahead of an older browser load', async (loadKind, selection) => {
    let resolve!: (value: AudioClip) => void;
    const pendingClip = new Promise<AudioClip>((done) => { resolve = done; });
    const loadFromUrl = vi.spyOn(load, 'loadClipFromUrl').mockReturnValue(pendingClip);
    const loadInput = vi.spyOn(load, 'loadClip').mockReturnValue(pendingClip);
    const element = mount(loadKind === 'src' ? {src: 'old.wav'} : {});
    const pending = loadKind === 'load' ? element.load(new ArrayBuffer(8)) : undefined;
    const owner = element.player!;
    expect(owner).toBeInstanceOf(AudioPlayer);
    const take = clip(3);
    const group: AudioPlayerTransport = {
      seconds: 1, duration: 7, playing: false,
      play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
    };
    if (selection === 'clip') owner.setClip(take);
    else owner.setTransport(group);
    const options = loadKind === 'src' ? loadFromUrl.mock.calls[0]?.[1] : loadInput.mock.calls[0]?.[1];
    expect(options?.signal?.aborted).toBe(true);
    expect(element.loading).toBe(false);
    expect(element.loadError).toBeUndefined();
    resolve(clip(9));
    await pending;
    await flush();
    expect(element.player).toBe(owner);
    expect(owner.transport).toBe(selection === 'transport' ? group : undefined);
    expect(element.clip).toBe(selection === 'clip' ? take : undefined);
    expect(element.duration).toBe(selection === 'clip' ? 3 : 7);
  });

  it('does not restore a load cancelled by a source choice inside its readiness event', async () => {
    let resolve!: (value: AudioClip) => void;
    vi.spyOn(load, 'loadClip').mockReturnValue(new Promise((done) => { resolve = done; }));
    const element = mount();
    const selected = clip(4);
    element.addEventListener('webaudio:loadstatechange', (event) => {
      if ((event as CustomEvent).detail.loading) element.clip = selected;
    });
    const pending = element.load(new ArrayBuffer(8));
    expect(element.loading).toBe(false);
    expect(element.clip).toBe(selected);
    resolve(clip(9));
    await pending;
    expect(element.clip).toBe(selected);
    expect(element.loadError).toBeUndefined();
  });

  it('hands the decoder a context so the native decodeAudioData path can run', async () => {
    const loadFromUrl = vi.spyOn(load, 'loadClipFromUrl').mockResolvedValue(clip());
    mount({src: 'song.mp3'});
    await flush();

    const options = loadFromUrl.mock.calls[0]?.[1];
    expect(options?.context).toBeInstanceOf(StubAudioContext);
    expect(typeof options?.context?.decodeAudioData).toBe('function');
  });

  it('hands the same context to the imperative load() path', async () => {
    const loadInput = vi.spyOn(load, 'loadClip').mockResolvedValue(clip());
    const element = mount();
    await element.load(new ArrayBuffer(8));

    expect(loadInput.mock.calls[0]?.[1]?.context).toBeInstanceOf(StubAudioContext);
  });

  it('decodes and plays on ONE context, and closes it only on teardown', async () => {
    vi.spyOn(load, 'loadClipFromUrl').mockResolvedValue(clip());
    const element = mount({src: 'song.mp3'});
    await flush();
    await element.play();

    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.close).not.toHaveBeenCalled();

    element.remove();
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('decodes on a borrowed player context and never closes it', async () => {
    const external = new AudioPlayer(clip());
    // Reading the analyser builds that player's graph, so it owns a context.
    expect(external.analyser).toBeDefined();
    const loadInput = vi.spyOn(load, 'loadClip').mockResolvedValue(clip());
    const element = mount();
    element.player = external;

    await element.load(new ArrayBuffer(8));
    expect(loadInput.mock.calls[0]?.[1]?.context).toBe(contexts[0]);

    element.remove();
    expect(contexts[0]!.close).not.toHaveBeenCalled();
    external.dispose();
  });

  it('exposes borrowed source data and announces replacement before graph construction', () => {
    const element = mount();
    element.clip = clip(1);
    const external = new AudioPlayer(clip(2));
    const other = new AudioPlayer(clip(3));
    const changes: Array<{clip: AudioClip | undefined; revision: number}> = [];
    const disposed = vi.spyOn(external, 'dispose');
    element.addEventListener('webaudio:sourcechange', (event) => {
      changes.push((event as CustomEvent).detail);
    });

    element.player = external;
    expect(element.clip).toBe(external.clip);
    expect(element.duration).toBe(2);
    expect(external.clock).toBeUndefined();
    element.player = other;
    expect(element.clip).toBe(other.clip);
    element.player = undefined;
    expect(element.clip).toBeUndefined();
    expect(element.duration).toBe(0);
    expect(changes.map((change) => change.clip?.duration)).toEqual([2, 3, undefined]);
    expect(changes.map((change) => change.revision)).toEqual([3, 4, 5]);
    expect(disposed).not.toHaveBeenCalled();
    external.dispose();
    other.dispose();
  });

  it('clears retained data when no player has been built yet', () => {
    const element = document.createElement('audio-player') as AudioPlayerElement;
    element.clip = clip(2);
    expect(element.player).toBeUndefined();
    element.player = undefined;
    expect(element.clip).toBeUndefined();
    document.body.append(element);
    expect(element.player).toBeInstanceOf(AudioPlayer);
    expect(element.duration).toBe(0);
  });

  it('commits source selection before a listener replaces it again', () => {
    const element = mount();
    const first = new AudioPlayer(clip(2));
    const second = new AudioPlayer(clip(3));
    const sources: AudioClip[] = [];
    element.addEventListener('webaudio:sourcechange', () => {
      sources.push(element.clip!);
      if (element.player === first) element.player = second;
    });
    element.player = first;
    expect(element.player).toBe(second);
    expect(element.clip).toBe(second.clip);
    expect(sources).toEqual([first.clip, second.clip]);
    first.dispose();
    second.dispose();
  });

  it('does not dispose an owned player when assigning its current identity', () => {
    const element = mount();
    element.clip = clip();
    const current = element.player!;
    const dispose = vi.spyOn(current, 'dispose');
    element.player = current;
    expect(dispose).not.toHaveBeenCalled();
    element.remove();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('reports a rejected live loop edit without replacing the accepted loop', async () => {
    const element = mount();
    element.clip = clip(8);
    await element.play();
    element.setAttribute('loop', '2,6');
    const errors: unknown[] = [];
    element.addEventListener('webaudio:error', (event) => errors.push((event as CustomEvent).detail));
    element.setAttribute('loop', '9,10');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
    element.seek(7);
    expect(element.seconds).toBe(3);
  });

  it('selects an explicit clip on a borrowed central owner before mount', () => {
    const element = document.createElement('audio-player') as AudioPlayerElement;
    const external = new AudioPlayer(clip());
    const dispose = vi.spyOn(external, 'dispose');
    element.player = external;
    element.clip = clip(2);

    document.body.append(element);

    expect(element.player).toBeDefined();
    expect(element.player).toBe(external);
    expect(element.duration).toBe(2);
    expect(dispose).not.toHaveBeenCalled();
    external.dispose();
  });

  it('applies a loop change to the live player and keeps the playhead', async () => {
    const element = mount({controls: ''});
    element.clip = clip(8);
    const player = element.player;
    expect(player).toBeDefined();
    await element.play();
    element.seek(3);
    const before = element.currentTime;
    expect(before).toBeCloseTo(3, 6);

    const setLoop = vi.spyOn(player!, 'setLoop');
    element.setAttribute('loop', '2,6');

    expect(element.player).toBe(player);
    expect(setLoop).toHaveBeenCalledWith({start: 2, end: 6});
    expect(element.currentTime).toBeCloseTo(before, 6);
  });

  it('reads preserves-pitch as a boolean instead of by presence', () => {
    const off = mount({'preserves-pitch': 'false'}, 'probe-clip-player');
    off.clip = clip();
    expect(built.at(-1)?.preservesPitch).toBe(false);

    const on = mount({'preserves-pitch': ''}, 'probe-clip-player');
    on.clip = clip();
    expect(built.at(-1)?.preservesPitch).toBe(true);
  });

  it('applies a preserves-pitch change to the live player', () => {
    const element = mount({'preserves-pitch': ''});
    element.clip = clip();
    const setPreservesPitch = vi.spyOn(element.player!, 'setPreservesPitch');

    element.setAttribute('preserves-pitch', 'false');

    expect(setPreservesPitch).toHaveBeenCalledWith(false);
  });

  it('hides and shows the transport without remounting it', () => {
    const element = mount({controls: ''});
    const transport = transportOf(element);
    expect(element.hasAttribute('data-controls')).toBe(false);

    element.setAttribute('controls', 'false');
    expect(element.getAttribute('data-controls')).toBe('hidden');
    expect(transportOf(element)).toBe(transport);

    element.setAttribute('controls', '');
    expect(element.hasAttribute('data-controls')).toBe(false);
    expect(transportOf(element)).toBe(transport);
  });

  it('uses a supplied context instead of minting its own', async () => {
    const shared = new StubAudioContext() as unknown as AudioContext;
    const before = contexts.length;
    const element = mount({}, 'probe-clip-player');
    element.audioContext = shared;
    element.clip = clip();
    await flush();

    // Browsers cap contexts at roughly six, so a page with several elements
    // shares one — the same handle <audio-mixer> and <audio-playlist> take.
    expect(element.audioContext).toBe(shared);
    expect(built[built.length - 1]!.audioContext).toBe(shared);
    expect(contexts).toHaveLength(before);
  });

  it('never closes a supplied context on teardown', async () => {
    const shared = new StubAudioContext();
    const element = mount({}, 'probe-clip-player');
    element.audioContext = shared as unknown as AudioContext;
    element.clip = clip();
    await flush();

    element.remove();
    expect(shared.close).not.toHaveBeenCalled();
  });

  it('shows the transport when the attribute is absent', () => {
    // Not <audio> semantics: being the transport is this element's job, so an
    // absent attribute cannot blank every tag already on a page. Opting out
    // is explicit, and `controls="false"` is what it has always meant here.
    const element = mount();
    expect(element.hasAttribute('data-controls')).toBe(false);
  });

  it('routes pan to the player, at construction and live', () => {
    const element = mount({pan: '-0.5'}, 'probe-clip-player');
    element.clip = clip();
    expect(built.at(-1)?.pan).toBe(-0.5);

    const setPan = vi.spyOn(element.player!, 'setPan');
    element.setAttribute('pan', '0.75');
    expect(setPan).toHaveBeenCalledWith(0.75);
  });

  it('forwards a scheduled start time to the player', async () => {
    const element = mount();
    element.clip = clip();
    const play = vi.spyOn(element.player!, 'play').mockResolvedValue();

    await element.play(2.5);

    expect(play).toHaveBeenCalledWith(2.5);
  });

  it('warms the first-play path when preload is set', async () => {
    const element = mount({preload: ''});
    element.clip = clip();
    await flush();

    // preload() builds the graph the first play would otherwise build.
    expect(contexts[0]!.createBufferSource).not.toHaveBeenCalled();
    expect(contexts[0]!.createAnalyser).toHaveBeenCalled();
  });

  it('reconciles attributes changed while disconnected on the next mount', () => {
    const element = mount({}, 'probe-clip-player');
    element.clip = clip(4);
    element.remove();

    element.setAttribute('volume', '0.25');
    element.setAttribute('rate', '1.5');
    element.setAttribute('loop', '');
    document.body.append(element);

    const options = built.at(-1);
    expect(options?.volume).toBe(0.25);
    expect(options?.rate).toBe(1.5);
    expect(options?.loop).toBe(true);
  });

  it('reloads a src that changed while disconnected', async () => {
    const loadFromUrl = vi.spyOn(load, 'loadClipFromUrl').mockResolvedValue(clip());
    const element = mount({src: 'first.wav'});
    await flush();
    expect(loadFromUrl).toHaveBeenCalledTimes(1);

    element.remove();
    element.setAttribute('src', 'second.wav');
    document.body.append(element);
    await flush();

    expect(loadFromUrl).toHaveBeenCalledTimes(2);
    expect(loadFromUrl.mock.calls[1]?.[0]).toBe('second.wav');
  });

  it('reconciles a live knob a borrowed player missed while disconnected', () => {
    const element = mount();
    const external = new AudioPlayer(clip());
    element.player = external;
    const setVolume = vi.spyOn(external, 'setVolume');

    element.remove();
    element.setAttribute('volume', '0.3');
    document.body.append(element);

    expect(setVolume).toHaveBeenCalledWith(0.3);
    external.dispose();
  });

  it('applies volume and rate to a borrowed player it does not own', () => {
    const element = mount({volume: '0.4', rate: '1.5'});
    const external = new AudioPlayer(clip());
    const setVolume = vi.spyOn(external, 'setVolume');
    const setRate = vi.spyOn(external, 'setRate');
    const dispose = vi.spyOn(external, 'dispose');

    element.player = external;
    expect(setVolume).toHaveBeenCalledWith(0.4);
    expect(setRate).toHaveBeenCalledWith(1.5);

    element.setAttribute('volume', '0.9');
    expect(setVolume).toHaveBeenLastCalledWith(0.9);

    element.remove();
    expect(dispose).not.toHaveBeenCalled();
    external.dispose();
  });

  it('leaves a borrowed player alone for attributes that are absent', () => {
    const element = mount();
    const external = new AudioPlayer(clip(), {volume: 0.2});
    const setVolume = vi.spyOn(external, 'setVolume');

    element.player = external;

    expect(setVolume).not.toHaveBeenCalled();
    external.dispose();
  });

  it('announces a user seek with seconds, progress and the region it landed in', () => {
    const element = mount({controls: ''});
    const region = createRegion({label: 'Chorus', startSeconds: 1, endSeconds: 3});
    element.clip = createAudioClip({
      sampleRate: 1_000,
      channelData: [new Float32Array(4_000)],
      regions: [region],
    });
    const seeks: AudioPlayerSeekDetail[] = [];
    element.addEventListener('webaudio:seek', (event) => {
      seeks.push((event as CustomEvent<AudioPlayerSeekDetail>).detail);
    });

    const seek = element.shadowRoot!.querySelector<HTMLInputElement>('.wui-transport__seek')!;
    seek.value = '500';
    seek.dispatchEvent(new Event('input'));

    expect(seeks).toHaveLength(1);
    expect(seeks[0]!.progress).toBe(0.5);
    expect(seeks[0]!.seconds).toBeCloseTo(2, 6);
    expect(seeks[0]!.region).toBe(region);
  });

  it('stays silent for a programmatic seek, so a bound view cannot echo itself', () => {
    const element = mount({controls: ''});
    element.clip = clip(4);
    const seeks: unknown[] = [];
    element.addEventListener('webaudio:seek', (event) => seeks.push(event));

    element.seek(2);
    element.seekFraction(0.25);
    element.scrub(0.5);

    expect(seeks).toEqual([]);
  });

  it('exposes the engine surface the DOM could not reach', async () => {
    const element = mount();
    element.clip = clip(4);

    // No engine before the first play: the clock is not reachable yet.
    expect(element.clock).toBeUndefined();
    await element.play();
    expect(element.clock).toBeDefined();
    expect(element.analyser).toBeDefined();
    expect(element.duration).toBeCloseTo(4, 6);

    element.stop();
    expect(element.playing).toBe(false);
  });

  it('constructs in Node without a document', () => {
    expect(() => new AudioPlayerElement()).not.toThrow();
  });
});
