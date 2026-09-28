// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  AudioRecorderElement,
  defineAudioRecorderElement,
  type AudioRecorderExportedDetail,
} from '../../src/play/element/audio-recorder';
import {AudioRecorder, type AudioRecorderOptions} from '../../src/play/headless/recorder';
import {parseWav} from '../../src/play/core/wav';
import {AudioPlayer} from '../../src/play/headless/audio-player';

/** What the fake hardware settles on, whatever `sample-rate` asks for. */
const CAPTURE_RATE = 48_000;

const contexts: FakeAudioContext[] = [];
const node = () => ({connect: vi.fn(), disconnect: vi.fn()});

/**
 * One stand-in for both halves of the element: the capture graph the
 * AudioRecorder builds (source → analyser → ScriptProcessor) and the playback
 * graph an AudioClipPlayer builds for the take. jsdom has no Web Audio at all.
 */
class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  // A requested rate is deliberately ignored, as a real device may do.
  sampleRate = CAPTURE_RATE;
  destination = node();
  processor = {
    ...node(),
    onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null,
  };
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createMediaStreamSource = vi.fn(() => node());
  createAnalyser = vi.fn(() => ({...node(), fftSize: 0, smoothingTimeConstant: 0}));
  createScriptProcessor = vi.fn(() => this.processor);
  createGain = vi.fn(() => ({...node(), gain: {value: 1}}));
  createStereoPanner = vi.fn(() => ({...node(), pan: {value: 0}}));
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

let getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>();

/** Push one PCM block through the capture tap of the newest context. */
function feed(frames: number, value = 0.5): void {
  const context = contexts[contexts.length - 1];
  context?.processor.onaudioprocess?.({
    inputBuffer: {
      length: frames,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(frames).fill(value),
    },
  } as unknown as AudioProcessingEvent);
}

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  // jsdom's Blob has no arrayBuffer(); FileReader is the portable path.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** Captures the option bag through the hook a subclass is meant to use. */
class ProbeRecorderElement extends AudioRecorderElement {
  lastOptions?: AudioRecorderOptions;

  protected override createRecorder(options: AudioRecorderOptions): AudioRecorder {
    this.lastOptions = options;
    return super.createRecorder(options);
  }
}

// Register the canonical tag used throughout the recorder lifecycle tests.
defineAudioRecorderElement();
customElements.define('audio-recorder-probe', ProbeRecorderElement);

function mount(attributes: Record<string, string> = {}): AudioRecorderElement {
  return append(
    document.createElement('audio-recorder') as AudioRecorderElement,
    attributes,
  );
}

function append<T extends HTMLElement>(element: T, attributes: Record<string, string>): T {
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(element);
  return element;
}

beforeEach(() => {
  contexts.length = 0;
  getUserMedia = vi.fn(async () => ({getTracks: () => [{stop: vi.fn()}]}) as unknown as MediaStream);
  vi.stubGlobal('navigator', {mediaDevices: {getUserMedia}});
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('<audio-recorder>', () => {
  it('passes its attributes into the recorder constraints', async () => {
    const element = mount({'device-id': 'mic-2', 'echo-cancellation': 'false'});

    await element.start();

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {deviceId: 'mic-2', echoCancellation: false},
    });
    expect(element.recording).toBe(true);
    expect(element.recorder).toBeInstanceOf(AudioRecorder);
  });

  it('leaves echo cancellation to the engine when the attribute is absent', async () => {
    await mount().start();

    expect(getUserMedia).toHaveBeenCalledWith({audio: {echoCancellation: true}});
  });

  it('announces recordingstart before the take, and the take on stop', async () => {
    const element = mount();
    const seen: string[] = [];
    element.addEventListener('webaudio:recordingstart', () => seen.push('recordingstart'));
    element.addEventListener('webaudio:recorded', () => seen.push('recorded'));

    await element.start();
    expect(seen).toEqual(['recordingstart']);

    feed(256);
    const take = await element.stop();

    expect(seen).toEqual(['recordingstart', 'recorded']);
    expect(take?.length).toBe(256);
    expect(element.take).toBe(take);
    expect(element.recording).toBe(false);
    expect(element.recorder).toBeUndefined();
  });

  it('surfaces a breached recording limit as webaudio:error', async () => {
    // 0.001s × the documented 44100 fallback = 45 frames of headroom.
    const element = mount({'max-seconds': '0.001'});
    const errors: unknown[] = [];
    element.addEventListener('webaudio:error', (event) => {
      errors.push((event as CustomEvent<unknown>).detail);
    });

    await element.start();
    feed(128);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RangeError);
    expect((errors[0] as Error).message).toMatch(/maxRecordedFrames/);
    expect(element.recording).toBe(false);
    expect(element.recorder).toBeUndefined();
  });

  it('plays the take back and exports it as WAV', async () => {
    const element = mount();
    const exported: AudioRecorderExportedDetail[] = [];
    element.addEventListener('webaudio:exported', (event) => {
      exported.push((event as CustomEvent<AudioRecorderExportedDetail>).detail);
    });

    await element.start();
    feed(256, 0.5);
    const take = await element.stop();

    const play = element.shadowRoot?.querySelector<HTMLButtonElement>('.wui-recorder__play');
    expect(play?.disabled).toBe(false);
    expect(play?.getAttribute('aria-label')).toBe('Play take');
    await element.playTake();
    expect(element.playing).toBe(true);
    expect(play?.getAttribute('aria-label')).toBe('Stop playback');
    element.stopPlayback();
    expect(element.playing).toBe(false);
    expect(play?.getAttribute('aria-label')).toBe('Play take');

    const blob = element.exportTake();
    expect(blob?.type).toBe('audio/wav');
    expect(exported).toHaveLength(1);
    expect(exported[0]?.clip).toBe(take);
    expect(exported[0]?.format).toBe('wav');

    const decoded = parseWav(await readBlob(blob as Blob));
    expect(decoded.sampleRate).toBe(CAPTURE_RATE);
    expect(decoded.channelData[0]?.length).toBe(256);
    // 16-bit quantization, so the fed 0.5 comes back close but not identical.
    expect(decoded.channelData[0]?.[0]).toBeCloseTo(0.5, 4);
  });

  it('exports every take when auto-export is set', async () => {
    const element = mount({'auto-export': ''});
    const exported: AudioRecorderExportedDetail[] = [];
    element.addEventListener('webaudio:exported', (event) => {
      exported.push((event as CustomEvent<AudioRecorderExportedDetail>).detail);
    });

    await element.start();
    feed(64);
    const take = await element.stop();

    expect(exported).toHaveLength(1);
    expect(exported[0]?.clip).toBe(take);
    expect(exported[0]?.blob.size).toBe(44 + 64 * 2);
  });

  it('exports from the presenter button without a download URL', async () => {
    vi.stubGlobal('URL', undefined);
    const element = mount();
    const events: string[] = [];
    for (const name of ['exported', 'error']) {
      element.addEventListener(`webaudio:${name}`, () => events.push(name));
    }

    await element.start();
    feed(64);
    await element.stop();
    element.shadowRoot?.querySelector<HTMLButtonElement>('.wav')?.click();

    // A host without object URLs still serializes the take and
    // announced, only the browser download step is skipped.
    expect(events).toEqual(['exported']);
  });

  it('reports the take through the presenter status line', async () => {
    const element = mount();
    await element.start();
    feed(CAPTURE_RATE * 2);
    await element.stop();

    const status = element.shadowRoot?.querySelector('.wui-recorder__status');
    expect(status?.textContent).toBe('take 1: 0:02 · 48 kHz');
  });

  it('registers the canonical element idempotently', () => {
    expect(customElements.get('audio-recorder')).toBe(AudioRecorderElement);
    expect(mount().shadowRoot?.querySelector('.wui-recorder')).not.toBeNull();
    expect(() => defineAudioRecorderElement()).not.toThrow();
  });

  it('converts max-seconds with the rate it documents', async () => {
    const element = append(
      document.createElement('audio-recorder-probe') as ProbeRecorderElement,
      {'max-seconds': '2'},
    );

    // Nothing requested and no context has ever existed: AudioRecorder's own
    // 44100 fallback, never 48000.
    await element.start();
    expect(element.lastOptions).toEqual({maxRecordedFrames: 88_200});

    // Drop the engine without producing a take, so no rate is resolved yet.
    element.remove();
    document.body.append(element);
    element.setAttribute('sample-rate', '8000');
    await element.start();
    expect(element.lastOptions).toEqual({sampleRate: 8_000, maxRecordedFrames: 16_000});

    feed(64);
    await element.stop();
    expect(element.take?.sampleRate).toBe(CAPTURE_RATE);

    // A take has now proved what the hardware really gives, so the budget
    // follows it rather than the rate we keep requesting.
    await element.start();
    expect(element.lastOptions).toEqual({sampleRate: 8_000, maxRecordedFrames: 2 * CAPTURE_RATE});
  });

  it('releases the microphone and the take player on disconnect', async () => {
    const element = mount();
    await element.start();
    feed(64);
    await element.stop();
    await element.playTake();

    element.remove();

    expect(element.recording).toBe(false);
    expect(element.playing).toBe(false);
    expect(element.recorder).toBeUndefined();
    // The take is data, not a resource: it survives for a re-mounted element.
    expect(element.take).toBeDefined();
    for (const context of contexts) expect(context.close).toHaveBeenCalled();
  });

  it('constructs in Node without a document', () => {
    expect(() => new AudioRecorderElement()).not.toThrow();
  });
});

describe('<audio-recorder> reentrant error recovery', () => {
  it('allows retry from a permission error without old cleanup disposing the replacement', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('denied'));
    const element = mount();
    let retry: Promise<void> | undefined;
    element.addEventListener('webaudio:error', () => {
      expect(element.recording).toBe(false);
      expect(element.recorder).toBeUndefined();
      retry = element.start();
    }, {once: true});
    await element.start();
    await retry;
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(element.recording).toBe(true);
    expect(element.recorder?.isRecording).toBe(true);
    feed(64);
    expect((await element.stop())?.length).toBe(64);
  });

  it('commits idle state before a cap error and preserves the retry engine', async () => {
    const element = mount({'max-seconds': '0.001'});
    let retry: Promise<void> | undefined;
    element.addEventListener('webaudio:error', () => {
      expect(element.recording).toBe(false);
      expect(element.recorder).toBeUndefined();
      element.removeAttribute('max-seconds');
      retry = element.start();
    }, {once: true});
    await element.start();
    feed(128);
    await retry;
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(element.recording).toBe(true);
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
    expect(contexts[1]!.close).not.toHaveBeenCalled();
    feed(64);
    expect((await element.stop())?.length).toBe(64);
  });
});

it('reports invalid capture options before allowing an error-listener retry', async () => {
  const element = mount({'max-seconds': '10000000000000'});
  let retry: Promise<void> | undefined;
  const errors: unknown[] = [];
  element.addEventListener('webaudio:error', event => {
    errors.push((event as CustomEvent).detail);
    element.removeAttribute('max-seconds');
    retry = element.start();
  }, {once: true});
  await element.start();
  await retry;
  expect(errors).toHaveLength(1);
  expect(errors[0]).toBeInstanceOf(RangeError);
  expect(getUserMedia).toHaveBeenCalledOnce();
  expect(element.recording).toBe(true);
});


describe('recorder companion binding', () => {
  it('auditions through the central player and leaves borrowed playback alive on disconnect', async () => {
    const owner = new AudioPlayer();
    const element = mount();
    element.player = owner;
    await element.start();
    feed(256);
    const take = await element.stop();
    await element.playTake();
    expect(owner.clip).toBe(take);
    expect(owner.playing).toBe(true);
    expect(element.playing).toBe(true);
    const stop = vi.spyOn(owner, 'stop');
    const dispose = vi.spyOn(owner, 'dispose');
    element.remove();
    expect(stop).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
    expect(owner.playing).toBe(true);
    owner.dispose();
  });

  it('does not create an audition player while an explicit target is unresolved', async () => {
    const element = mount({player: '#missing-recorder-deck'});
    await element.start();
    feed(128);
    await element.stop();
    const count = contexts.length;
    await element.playTake();
    expect(contexts).toHaveLength(count);
    expect(element.playing).toBe(false);
    expect(element.shadowRoot!.querySelector<HTMLButtonElement>('.wui-recorder__play')!.disabled).toBe(true);
  });

  it('pauses the selected group before switching to the retained take', async () => {
    const owner = new AudioPlayer();
    const transport = {seconds: 1, duration: 4, playing: true, play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn()};
    owner.setTransport(transport);
    const element = mount();
    element.player = owner;
    await element.start(); feed(128); await element.stop();
    await element.playTake();
    expect(transport.pause).toHaveBeenCalledOnce();
    expect(transport.stop).not.toHaveBeenCalled();
    expect(owner.transport).toBeUndefined();
    expect(owner.clip).toBe(element.take);
    element.remove(); owner.dispose();
  });
});
