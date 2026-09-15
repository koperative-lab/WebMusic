import {afterEach, describe, expect, it, vi} from 'vitest';
import * as audioFacade from '../../src/play/headless/audio';
import {createReverbNode} from '../../src/play/headless/audio-utils';
import {createOscillatorSynth, OscillatorSynth} from '../../src/play/headless/oscillator-synth';
import {
  createScorePlayer,
  createScorePlayerFromUrl,
  playScore,
  playScoreFromUrl,
  ScorePlayer,
} from '../../src/play/headless/score-player';
import {createSoundfontSynth, SoundfontSynth} from '../../src/play/headless/soundfont-synth';
import {SpessaSynthSynth} from '../../src/play/headless/synth';

function synthContext() {
  const param = () => ({
    value: 1,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });
  const gains: Array<{gain: ReturnType<typeof param>; connect: ReturnType<typeof vi.fn>}> = [];
  const oscillators: Array<{stop: ReturnType<typeof vi.fn>}> = [];
  const bufferSources: Array<{stop: ReturnType<typeof vi.fn>}> = [];
  const node = <T extends object>(properties: T) => ({
    connect: vi.fn((destination: unknown) => destination),
    disconnect: vi.fn(),
    ...properties,
  });
  const context = {
    currentTime: 0,
    createGain: () => {
      const gain = node({gain: param()});
      gains.push(gain);
      return gain;
    },
    createOscillator: () => {
      const oscillator = node({
        frequency: param(),
        detune: param(),
        start: vi.fn(),
        stop: vi.fn(),
      });
      oscillators.push(oscillator);
      return oscillator;
    },
    createBiquadFilter: () => node({frequency: param(), Q: param()}),
    createBufferSource: () => {
      const source = node({
        buffer: null,
        playbackRate: {value: 1},
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      });
      bufferSources.push(source);
      return source;
    },
    decodeAudioData: vi.fn(async () => ({length: 1, numberOfChannels: 1} as AudioBuffer)),
  } as unknown as AudioContext;
  return {context, gains, oscillators, bufferSources};
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('headless audio module boundaries', () => {
  it('keeps the historical audio module as a stable compatibility facade', () => {
    expect(audioFacade.ScorePlayer).toBe(ScorePlayer);
    expect(audioFacade.Player).toBe(ScorePlayer);
    expect(audioFacade.createScorePlayer).toBe(createScorePlayer);
    expect(audioFacade.createScorePlayerFromUrl).toBe(createScorePlayerFromUrl);
    expect(audioFacade.playScore).toBe(playScore);
    expect(audioFacade.playScoreFromUrl).toBe(playScoreFromUrl);
  });

  it('re-exports each synth and audio helper from its focused module', () => {
    expect(audioFacade.OscillatorSynth).toBe(OscillatorSynth);
    expect(audioFacade.createOscillatorSynth).toBe(createOscillatorSynth);
    expect(audioFacade.SoundfontSynth).toBe(SoundfontSynth);
    expect(audioFacade.createSoundfontSynth).toBe(createSoundfontSynth);
    expect(audioFacade.createReverbNode).toBe(createReverbNode);
  });

  it('lets the built-in synths opt into and retract future clock-scheduled voices', () => {
    const {context, gains, oscillators} = synthContext();
    const oscillator = new OscillatorSynth(context);
    expect(oscillator.supportsScheduledCancellation).toBe(true);

    const handle = oscillator.noteOn(60, 100, 1, 0.5);
    oscillator.cancelScheduledNote(handle, 0.25);

    expect(oscillators[0].stop).toHaveBeenLastCalledWith(0.25);
    expect(gains[1].gain.cancelScheduledValues).toHaveBeenCalledWith(0.25);
    expect(gains[1].gain.setValueAtTime).toHaveBeenCalledWith(0, 0.25);

    const retimedHandle = oscillator.noteOn(61, 100, 1, 0.5);
    oscillator.retimeScheduledNote(retimedHandle, 2);
    // The synth owns the release tail, so its source ends after the logical
    // endpoint rather than retaining the old 1.5-second hard stop.
    expect(oscillators[1].stop).toHaveBeenLastCalledWith(2.08);

    const fallback = {
      supportsScheduledCancellation: true,
      noteOn: vi.fn(() => 'fallback-voice'),
      noteOffById: vi.fn(),
      cancelScheduledNote: vi.fn(),
      retimeScheduledNote: vi.fn(),
    };
    const soundfont = new SoundfontSynth(context, {fallback});
    expect(soundfont.supportsScheduledCancellation).toBe(true);
    const fallbackHandle = soundfont.noteOn(61, 100, 1, 0.5);
    soundfont.cancelScheduledNote(fallbackHandle, 0.25);
    expect(fallback.cancelScheduledNote).toHaveBeenCalledWith('fallback-voice', 0.25);
    const secondFallbackHandle = soundfont.noteOn(62, 100, 1, 0.5);
    soundfont.retimeScheduledNote(secondFallbackHandle, 2);
    expect(fallback.retimeScheduledNote).toHaveBeenCalledWith('fallback-voice', 2);
  });

  it('hard-stops oscillator sources at release completion and immediately on dispose', () => {
    const {context, oscillators} = synthContext();
    const oscillator = new OscillatorSynth(context, {releaseSeconds: 0.1});

    oscillator.noteOn(60, 100, 0, 3600);
    oscillator.noteOff(60, 0.5);
    expect(oscillators[0].stop).toHaveBeenLastCalledWith(0.6);

    const exact = oscillator.noteOn(61, 100, 0, 3600);
    oscillator.noteOffById(exact, 0.75);
    expect(oscillators[1].stop).toHaveBeenLastCalledWith(0.85);

    oscillator.noteOn(62, 100, 1, 3600);
    oscillator.dispose();
    for (const source of oscillators) expect(source.stop).toHaveBeenLastCalledWith(0);
  });

  it('hard-stops soundfont sources, clears buffers, and blocks late preload writes', async () => {
    class FakeAudioBuffer {
      readonly length = 1;
      readonly numberOfChannels = 1;
    }
    vi.stubGlobal('AudioBuffer', FakeAudioBuffer);
    const first = synthContext();
    const fallback = {noteOn: vi.fn(), dispose: vi.fn()};
    const soundfont = new SoundfontSynth(first.context, {
      fallback,
      releaseSeconds: 0.1,
      samples: {60: new FakeAudioBuffer() as unknown as AudioBuffer},
    });
    await soundfont.preload();

    const handle = soundfont.noteOn(60, 100, 0, 3600);
    soundfont.noteOffById(handle, 0.5);
    expect(first.bufferSources[0].stop).toHaveBeenLastCalledWith(0.6);
    soundfont.noteOn(60, 100, 1, 3600);
    soundfont.dispose();
    for (const source of first.bufferSources) expect(source.stop).toHaveBeenLastCalledWith(0);
    expect((soundfont as unknown as {buffers: Map<number, AudioBuffer>}).buffers.size).toBe(0);

    const second = synthContext();
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })));
    const loading = new SoundfontSynth(second.context, {
      fallback: {noteOn: vi.fn(), dispose: vi.fn()},
      samples: {60: '/late.wav'},
    });
    const pending = loading.preload();
    await Promise.resolve();
    loading.dispose();
    resolveFetch(new Response(new Uint8Array([1])));
    await expect(pending).resolves.toBeUndefined();
    expect(second.context.decodeAudioData).not.toHaveBeenCalled();
    expect((loading as unknown as {buffers: Map<number, AudioBuffer>}).buffers.size).toBe(0);
  });

  it('keeps sample handles disjoint from arbitrary fallback handles', async () => {
    class FakeAudioBuffer {
      readonly length = 1;
      readonly numberOfChannels = 1;
    }
    vi.stubGlobal('AudioBuffer', FakeAudioBuffer);
    const {context, bufferSources} = synthContext();
    const fallback = {
      noteOn: vi.fn(() => 'sf1'),
      noteOff: vi.fn(),
      noteOffById: vi.fn(),
      dispose: vi.fn(),
    };
    const soundfont = new SoundfontSynth(context, {
      fallback,
      samples: {60: new FakeAudioBuffer() as unknown as AudioBuffer},
    });

    const fallbackHandle = soundfont.noteOn(61, 100, 0, 1);
    await soundfont.preload();
    const sampleHandle = soundfont.noteOn(60, 100, 0, 1);
    expect(sampleHandle).not.toBe(fallbackHandle);

    soundfont.noteOffById(fallbackHandle, 0.25);
    expect(fallback.noteOffById).toHaveBeenCalledWith('sf1', 0.25);
    expect(bufferSources[0].stop).toHaveBeenCalledTimes(1);

    soundfont.noteOff(60, 0.5);
    expect(bufferSources[0].stop).toHaveBeenLastCalledWith(0.58);
    expect(fallback.noteOff).toHaveBeenCalledWith(60, 0.5);
    soundfont.dispose();
  });

  it('quiets already-issued Spessa notes when the adapter is disposed', () => {
    vi.useFakeTimers();
    const synth = {noteOn: vi.fn(), noteOff: vi.fn()};
    const adapter = new SpessaSynthSynth(synth, 2, {currentTime: 0} as AudioContext);

    adapter.noteOn(60, 100, 0);
    vi.runOnlyPendingTimers();
    expect(synth.noteOn).toHaveBeenCalledWith(2, 60, 100);

    adapter.noteOff(60, 10);
    adapter.dispose();
    expect(synth.noteOff).toHaveBeenCalledWith(2, 60);
    expect(synth.noteOff).toHaveBeenCalledTimes(1);
    vi.runAllTimers();
    expect(synth.noteOff).toHaveBeenCalledTimes(1);
  });

  it('compensates a Spessa note-on that commits before the adopted synth throws', () => {
    vi.useFakeTimers();
    const noteOnError = new Error('adopted synth failed after starting voice');
    let sounding = false;
    const synth = {
      noteOn: vi.fn(() => {
        sounding = true;
        throw noteOnError;
      }),
      noteOff: vi.fn(() => {
        sounding = false;
      }),
    };
    const adapter = new SpessaSynthSynth(synth, 3, {currentTime: 0} as AudioContext);

    adapter.noteOn(67, 110, 0);
    expect(() => vi.runOnlyPendingTimers()).toThrow(noteOnError);

    expect(synth.noteOn).toHaveBeenCalledWith(3, 67, 110);
    expect(synth.noteOff).toHaveBeenCalledWith(3, 67);
    expect(sounding).toBe(false);
    expect((adapter as unknown as {activeNotes: Map<number, number>}).activeNotes.size).toBe(0);

    adapter.dispose();
    expect(synth.noteOff).toHaveBeenCalledTimes(1);
  });

  it('retains an ambiguous Spessa attack until a later dispose releases it', () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const noteOnError = new Error('adopted synth failed after attack');
    let offAttempts = 0;
    const synth = {
      noteOn: vi.fn(() => {
        throw noteOnError;
      }),
      noteOff: vi.fn(() => {
        offAttempts += 1;
        if (offAttempts < 3) throw new Error(`release attempt ${offAttempts} failed`);
      }),
    };
    const adapter = new SpessaSynthSynth(synth, 4, {currentTime: 0} as AudioContext);
    const activeNotes = (adapter as unknown as {activeNotes: Map<number, number>}).activeNotes;

    adapter.noteOn(69, 100, 0);
    expect(() => vi.runOnlyPendingTimers()).toThrow(noteOnError);
    expect(activeNotes.get(69)).toBe(1);

    adapter.dispose();
    expect(activeNotes.get(69)).toBe(1);
    adapter.dispose();
    expect(activeNotes.size).toBe(0);
    expect(synth.noteOff).toHaveBeenCalledTimes(3);
    vi.runAllTimers();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
