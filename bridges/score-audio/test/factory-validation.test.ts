import {afterEach, describe, expect, expectTypeOf, it, vi} from 'vitest';
import {createAudioClip} from '@webmusic/audio';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, expandRepeats} from '@webmusic/score';
import {ScorePlayer} from '@webmusic/score/play/headless';
import {createSyncedPlayback, renderScoreToClip, type CreateSyncedPlaybackOptions} from '../src/sync';
import {assertRenderedClipAlignment} from '../src/render-provenance';
import {
  createAudioMasteredPlayback,
  scoreAsFollower,
  type CreateAudioMasteredPlaybackOptions,
} from '../src/audio-master';

const factories = [
  ['createSyncedPlayback', createSyncedPlayback],
  ['createAudioMasteredPlayback', createAudioMasteredPlayback],
] as const;

const rejectedOptions = [
  ['loop enabled', {loop: true}, /setLoop/],
  ['loop disabled', {loop: false}, /setLoop/],
  ['loop region', {loop: {start: 0, end: 1}}, /setLoop/],
  ['default rate', {rate: 1}, /setRate/],
  ['changed rate', {rate: 2}, /setRate/],
  ['media engine', {engine: 'media'}, /buffer engine/],
  ['automatic engine', {engine: 'auto'}, /buffer engine/],
  ['media adapter', {mediaAdapterFactory: () => null}, /mediaAdapterFactory/],
] as const;

afterEach(() => vi.unstubAllGlobals());

function stubOfflineContext() {
  vi.stubGlobal('OfflineAudioContext', class {
    readonly destination = {};
    constructor(
      readonly numberOfChannels: number,
      readonly length: number,
      readonly sampleRate: number,
    ) {}
    createGain() {
      return {connect() {}, disconnect() {}};
    }
    async startRendering() {
      return {
        numberOfChannels: this.numberOfChannels,
        length: this.length,
        sampleRate: this.sampleRate,
        getChannelData: () => new Float32Array(this.length),
      };
    }
  });
}

const silentSynth = {connect() {}, noteOn() {}, noteOff() {}};

function repeatedScore() {
  const builder = new ScoreBuilder();
  const partId = PartId('repeat-part');
  builder.addPart({id: partId, name: 'Repeated part'});
  builder.addMeasure({
    id: MeasureId('repeat-measure'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    repeat: {start: true, end: true},
  });
  builder.addNote(partId, {
    id: builder.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(),
    voice: VoiceId('repeat-voice'),
  });
  return builder.build();
}

describe('Bridge-rendered clip alignment', () => {
  it('shares exact-clip provenance across separately loaded Bridge modules', async () => {
    const score = new ScoreBuilder().build();
    const clip = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]});
    vi.resetModules();
    const {recordRenderProvenance} = await import('../src/render-provenance');
    recordRenderProvenance(clip, score, 2, false);

    expect(() => assertRenderedClipAlignment('createSyncedPlayback', score, clip)).toThrow(/tempo override/);
  });

  it('rejects a default positive tail in the Score-master factory before reading the context', async () => {
    stubOfflineContext();
    const score = new ScoreBuilder().build();
    const clip = await renderScoreToClip(score, {synth: silentSynth, reverb: false, sampleRate: 1000});
    const readContext = vi.fn(() => undefined);

    expect(() => createSyncedPlayback(score, clip, {
      get context() { return readContext(); },
    })).toThrow(/createAudioMasteredPlayback.*tailSeconds: 0/);
    expect(readContext).not.toHaveBeenCalled();
  });

  it.each(factories)('%s rejects a rendered tempo override before reading the context', async (_name, create) => {
    stubOfflineContext();
    const score = new ScoreBuilder().build();
    const clip = await renderScoreToClip(score, {
      synth: silentSynth, reverb: false, sampleRate: 1000, tempo: 240, tailSeconds: 0,
    });
    const readContext = vi.fn(() => undefined);

    expect(() => create(score, clip, {
      get context() { return readContext(); },
    })).toThrow(/tempo override.*sync.setRate/);
    expect(readContext).not.toHaveBeenCalled();
  });

  it.each(factories)('%s rejects a Bridge-rendered clip paired to another Score instance', async (_name, create) => {
    stubOfflineContext();
    const original = new ScoreBuilder().build();
    const clip = await renderScoreToClip(original, {
      synth: silentSynth, reverb: false, sampleRate: 1000, tailSeconds: 0,
    });
    const other = new ScoreBuilder().build();
    const readContext = vi.fn(() => undefined);

    expect(() => create(other, clip, {
      get context() { return readContext(); },
    })).toThrow(/different Score instance.*Render this score again/);
    expect(readContext).not.toHaveBeenCalled();
  });

  it.each(factories)('%s rejects player-only repeat expansion before acquiring a context', async (_name, create) => {
    stubOfflineContext();
    const score = repeatedScore();
    expect(expandRepeats(score).durationSeconds).toBeGreaterThan(score.durationSeconds);
    const clip = await renderScoreToClip(score, {
      synth: silentSynth, reverb: false, sampleRate: 1000, tailSeconds: 0,
    });
    const readContext = vi.fn(() => undefined);

    expect(() => create(score, clip, {
      scoreOptions: {expandRepeats: true},
      get context() { return readContext(); },
    })).toThrow(/expand repeats only in ScorePlayer.*expandRepeats\(score\)/);
    expect(readContext).not.toHaveBeenCalled();
  });

  it.each(factories)('%s preserves repeat expansion for an ordinary external clip', (_name, create) => {
    const score = repeatedScore();
    const clip = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(4000)]});
    const context = {currentTime: 0, state: 'running', close: vi.fn()} as unknown as AudioContext;
    const pair = create(score, clip, {context, scoreOptions: {expandRepeats: true}});
    pair.sync.dispose();
    expect(context.close).not.toHaveBeenCalled();
  });

  it.each(factories)('%s accepts a render made from the already expanded Score instance', async (_name, create) => {
    stubOfflineContext();
    const expanded = expandRepeats(repeatedScore());
    const clip = await renderScoreToClip(expanded, {
      synth: silentSynth, reverb: false, sampleRate: 1000, tailSeconds: 0,
    });
    const context = {currentTime: 0, state: 'running', close: vi.fn()} as unknown as AudioContext;
    const pair = create(expanded, clip, {context});
    pair.sync.dispose();
    expect(context.close).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Infinity])('rejects invalid render tempo %s before allocating offline audio', async (tempo) => {
    const createOffline = vi.fn();
    vi.stubGlobal('OfflineAudioContext', createOffline);
    await expect(renderScoreToClip(new ScoreBuilder().build(), {tempo})).rejects.toThrow(/tempo must be finite and > 0/);
    expect(createOffline).not.toHaveBeenCalled();
  });
});

describe('initial Score tempo validation', () => {
  it.each([0, -120, 20, 600, Number.NaN, Infinity])(
    'rejects Score-master scoreOptions.tempo %s before acquiring playback resources',
    (tempo) => {
      const score = new ScoreBuilder().build();
      const clip = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]});
      const readContext = vi.fn(() => undefined);
      expect(() => createSyncedPlayback(score, clip, {
        scoreOptions: {tempo},
        get context() { return readContext(); },
      })).toThrow(/scoreOptions.tempo.*0.25.*4/);
      expect(readContext).not.toHaveBeenCalled();
    },
  );

  it.each([30, 480])('accepts Score-master tempo at the shared rate boundary (%s BPM)', (tempo) => {
    const context = {currentTime: 0, state: 'running', close: vi.fn()} as unknown as AudioContext;
    const pair = createSyncedPlayback(
      new ScoreBuilder().build(),
      createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]}),
      {context, scoreOptions: {tempo}},
    );
    try {
      expect(pair.scorePlayer.rate).toBe(tempo / 120);
    } finally {
      pair.sync.dispose();
    }
  });

  it('rejects an initial Score tempo in the audio-master factory instead of silently replacing it', () => {
    const score = new ScoreBuilder().build();
    const clip = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]});
    const readContext = vi.fn(() => undefined);
    expect(() => createAudioMasteredPlayback(score, clip, {
      scoreOptions: {tempo: 240},
      get context() { return readContext(); },
    })).toThrow(/scoreOptions.tempo.*sync.setRate/);
    expect(readContext).not.toHaveBeenCalled();
  });
});

describe.each(factories)('%s clip option validation', (name, create) => {
  describe.each([false, true])('borrowed context: %s', (borrowed) => {
    it.each(rejectedOptions)('rejects %s before acquiring any playback resources', (_label, clipOptions, message) => {
      const context = {currentTime: 0, state: 'running', close: vi.fn()} as unknown as AudioContext;
      const createContext = vi.fn(function () { return context; });
      vi.stubGlobal('AudioContext', createContext);
      const readContext = vi.fn(() => borrowed ? context : undefined);
      const readScoreOptions = vi.fn(() => ({}));
      const score = new ScoreBuilder().build();
      const clip = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]});

      const construct = () => create(score, clip, {
        get context() { return readContext(); },
        get scoreOptions() { return readScoreOptions(); },
        clipOptions: clipOptions as never,
      });
      expect(construct).toThrow(RangeError);
      expect(construct).toThrow(message);
      expect(construct).toThrow(name);
      expect(readContext).not.toHaveBeenCalled();
      // Factory player construction cannot begin before its options are read.
      expect(readScoreOptions).not.toHaveBeenCalled();
      expect(createContext).not.toHaveBeenCalled();
      expect(context.close).not.toHaveBeenCalled();
    });

    it('rejects URL-only clips before acquiring any playback resources', () => {
      const context = {currentTime: 0, state: 'running', close: vi.fn()} as unknown as AudioContext;
      const createContext = vi.fn(function () { return context; });
      vi.stubGlobal('AudioContext', createContext);
      const readContext = vi.fn(() => borrowed ? context : undefined);
      const readScoreOptions = vi.fn(() => ({}));
      const clip = createAudioClip({
        sampleRate: 1000, sourceUrl: 'https://example.com/recording.wav',
        length: 1000, numberOfChannels: 1,
      });

      expect(() => create(new ScoreBuilder().build(), clip, {
        get context() { return readContext(); },
        get scoreOptions() { return readScoreOptions(); },
      })).toThrow(/decoded samples/);
      expect(readContext).not.toHaveBeenCalled();
      expect(readScoreOptions).not.toHaveBeenCalled();
      expect(createContext).not.toHaveBeenCalled();
      expect(context.close).not.toHaveBeenCalled();
    });
  });

  it.each([-1, Number.NaN, Infinity])(
    'rejects an invalid clip offset before acquiring playback resources (%s)',
    (clipOffsetSeconds) => {
      const createContext = vi.fn();
      vi.stubGlobal('AudioContext', createContext);
      const readContext = vi.fn(() => undefined);
      const readScoreOptions = vi.fn(() => ({}));
      const score = new ScoreBuilder().build();
      const clip = createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]});

      expect(() => create(score, clip, {
        clipOffsetSeconds,
        get context() { return readContext(); },
        get scoreOptions() { return readScoreOptions(); },
      })).toThrow(/clipOffsetSeconds must be finite and >= 0/);
      expect(readContext).not.toHaveBeenCalled();
      expect(readScoreOptions).not.toHaveBeenCalled();
      expect(createContext).not.toHaveBeenCalled();
    },
  );

  it('accepts explicit buffer selection and group-level loop configuration', () => {
    const context = {currentTime: 0, state: 'running', close: vi.fn()} as unknown as AudioContext;
    const pair = create(
      new ScoreBuilder().build(),
      createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]}),
      {
        context,
        loop: {startSeconds: 0.1, endSeconds: 0.5},
        clipOptions: {engine: 'buffer', volume: 0.5, pan: -0.25},
        driftCheckIntervalMs: 0,
      },
    );
    try {
      expect(pair.sync.loop).toEqual({startSeconds: 0.1, endSeconds: 0.5});
      pair.sync.setLoop(null);
      expect(pair.sync.loop).toBeNull();
    } finally {
      pair.sync.dispose();
    }
    expect(context.close).not.toHaveBeenCalled();
  });
});

it('publishes the same restricted clip option shape for both factory directions', () => {
  type Forward = NonNullable<CreateSyncedPlaybackOptions['clipOptions']>;
  type Reverse = NonNullable<CreateAudioMasteredPlaybackOptions['clipOptions']>;
  expectTypeOf<Forward>().toEqualTypeOf<Reverse>();
  expectTypeOf<Reverse>().not.toHaveProperty('loop');
  expectTypeOf<Reverse>().not.toHaveProperty('rate');
  expectTypeOf<Reverse>().not.toHaveProperty('mediaAdapterFactory');
  expectTypeOf<Reverse['engine']>().toEqualTypeOf<'buffer' | undefined>();
});

it.each([-1, Number.NaN, Infinity])(
  'rejects an invalid direct score-follower offset (%s)',
  (clipOffsetSeconds) => {
    const score = new ScoreBuilder().build();
    const scorePlayer = new ScorePlayer(score);
    try {
      expect(() => scoreAsFollower(scorePlayer, {clipOffsetSeconds}))
        .toThrow(/clipOffsetSeconds must be finite and >= 0/);
    } finally {
      scorePlayer.dispose();
    }
  },
);
