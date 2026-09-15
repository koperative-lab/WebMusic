import {describe, expect, it} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {bufferToWav, renderScoreToBuffer} from '../../src/play';
import {type HeadlessSynth} from '../../src/play/headless';

function buildScore(pitches: string[], performedDurationSeconds?: number) {
  const b = new ScoreBuilder();
  const part = PartId('p');
  const voice = VoiceId('v');
  const ts = {numerator: 4, denominator: 4};
  b.setMetadata({title: 'Render'})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: ts});
  b.addPart({id: part, name: 'Part', staves: 1});
  b.addMeasure({id: MeasureId('m1'), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4), timeSignature: ts});
  pitches.forEach((p, i) => {
    b.addNote(part, {
      id: b.newNoteId(),
      pitch: Pitch.parse(p),
      onsetQuarters: new Rational(i),
      duration: Duration.quarter(),
      voice,
      performed: i === 0 && performedDurationSeconds !== undefined
        ? {onsetSec: 0, durationSec: performedDurationSeconds, velocity: 100}
        : undefined,
    });
  });
  return b.build();
}

function recordingSynth(): HeadlessSynth & {
  ons: number[];
  disposed: boolean;
  disconnected: boolean;
  routeCleaned: boolean;
} {
  const self = {
    ons: [] as number[],
    disposed: false,
    disconnected: false,
    routeCleaned: false,
    connect() {
      return () => {
        self.routeCleaned = true;
      };
    },
    disconnect() {
      self.disconnected = true;
    },
    noteOn: (midi: number) => self.ons.push(midi),
    noteOff() {},
    dispose() {
      self.disposed = true;
    },
  };
  return self;
}

/** Minimal OfflineAudioContext stand-in that records the rendered length. */
function installOfflineMock() {
  const node = () => ({gain: {value: 1}, connect: () => node(), disconnect() {}});
  let captured: {channels: number; length: number; sampleRate: number} | undefined;
  class MockOffline {
    destination = node();
    length: number;
    sampleRate: number;
    constructor(channels: number, length: number, sampleRate: number) {
      captured = {channels, length, sampleRate};
      this.length = length;
      this.sampleRate = sampleRate;
    }
    createGain() {
      return node();
    }
    createConvolver() {
      return {buffer: null, connect: () => node(), disconnect() {}};
    }
    createBuffer(channels: number, len: number) {
      return {numberOfChannels: channels, getChannelData: () => new Float32Array(len)};
    }
    async startRendering() {
      return {numberOfChannels: 2, sampleRate: this.sampleRate, length: this.length, getChannelData: () => new Float32Array(this.length)};
    }
  }
  const prev = (globalThis as Record<string, unknown>).OfflineAudioContext;
  (globalThis as Record<string, unknown>).OfflineAudioContext = MockOffline as unknown;
  return {
    restore: () => ((globalThis as Record<string, unknown>).OfflineAudioContext = prev),
    captured: () => captured,
  };
}

describe('renderScoreToBuffer', () => {
  it('schedules every note and renders a buffer sized to score + tail', async () => {
    const mock = installOfflineMock();
    try {
      const synth = recordingSynth();
      const buffer = await renderScoreToBuffer(buildScore(['C4', 'D4', 'E4', 'F4']), {
        synth,
        sampleRate: 1000,
        tailSeconds: 0.5,
      });
      // 4/4 measure at 120bpm = 2.0s, + 0.5s tail, at 1000Hz → ~2500 frames.
      expect(mock.captured()!.length).toBe(2500);
      expect(mock.captured()!.sampleRate).toBe(1000);
      expect(synth.ons).toEqual(['C4', 'D4', 'E4', 'F4'].map((p) => Pitch.parse(p).midi));
      expect(synth.disposed).toBe(false);
      expect(synth.disconnected).toBe(false);
      expect(synth.routeCleaned).toBe(true);
      expect(buffer.length).toBe(2500);
    } finally {
      mock.restore();
    }
  });

  it('disposes an injected synth only when ownership is explicitly transferred', async () => {
    const mock = installOfflineMock();
    try {
      const synth = recordingSynth();
      await renderScoreToBuffer(buildScore(['C4']), {
        synth,
        synthOwnership: 'owned',
        sampleRate: 1000,
        tailSeconds: 0,
      });

      expect(synth.disposed).toBe(true);
      expect(synth.disconnected).toBe(false);
      expect(synth.routeCleaned).toBe(false);
    } finally {
      mock.restore();
    }
  });

  it('preserves a sub-10ms logical gate for offline backends', async () => {
    const mock = installOfflineMock();
    try {
      const durations: number[] = [];
      const synth: HeadlessSynth = {
        connect() {},
        noteOn: (_midi, _velocity, _time, durationSeconds) => {
          durations.push(durationSeconds);
        },
      };

      await renderScoreToBuffer(buildScore(['C4'], 0.005), {
        synth,
        sampleRate: 1000,
        tailSeconds: 0,
      });

      expect(durations).toEqual([0.005]);
    } finally {
      mock.restore();
    }
  });

  it('throws a clear error when OfflineAudioContext is unavailable', async () => {
    const prev = (globalThis as Record<string, unknown>).OfflineAudioContext;
    delete (globalThis as Record<string, unknown>).OfflineAudioContext;
    try {
      await expect(renderScoreToBuffer(buildScore(['C4']))).rejects.toThrow(/OfflineAudioContext is not available/);
    } finally {
      (globalThis as Record<string, unknown>).OfflineAudioContext = prev;
    }
  });

  it('uses the same tie, grace, and transposition semantics as ScorePlayer', async () => {
    const mock = installOfflineMock();
    try {
      const builder = new ScoreBuilder();
      const part = PartId('clarinet');
      const voice = VoiceId('v');
      const timeSignature = {numerator: 4, denominator: 4};
      builder
        .addTempo({atQuarters: Rational.ZERO, bpm: 120})
        .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
      // Written D4 on a Bb clarinet sounds as C4.
      builder.addPart({id: part, name: 'Clarinet', transpose: {chromatic: -2}});
      builder.addMeasure({
        id: MeasureId('m1'),
        number: 1,
        onsetQuarters: Rational.ZERO,
        durationQuarters: new Rational(4),
        timeSignature,
      });
      builder.addNote(part, {
        id: builder.newNoteId(),
        pitch: Pitch.parse('C5'),
        onsetQuarters: Rational.ZERO,
        duration: Duration.quarter(),
        voice,
        grace: true,
      });
      builder.addNote(part, {
        id: builder.newNoteId(),
        pitch: Pitch.parse('D4'),
        onsetQuarters: Rational.ZERO,
        duration: Duration.quarter(),
        voice,
        tie: 'start',
      });
      builder.addNote(part, {
        id: builder.newNoteId(),
        pitch: Pitch.parse('D4'),
        onsetQuarters: Rational.ONE,
        duration: Duration.quarter(),
        voice,
        tie: 'stop',
      });

      let nextHandle = 0;
      const ons: Array<{midi: number; duration: number}> = [];
      const offs: Array<{handle: unknown; time: number}> = [];
      const synth: HeadlessSynth = {
        connect() {},
        noteOn: (midi, _velocity, _time, duration) => {
          ons.push({midi, duration});
          return ++nextHandle;
        },
        noteOffById: (handle, time) => offs.push({handle, time}),
      };

      await renderScoreToBuffer(builder.build(), {synth, sampleRate: 1000, tailSeconds: 0});

      expect(ons).toEqual([{midi: Pitch.parse('C4').midi, duration: 1}]);
      expect(offs).toEqual([{handle: 1, time: 1}]);
    } finally {
      mock.restore();
    }
  });
});

describe('bufferToWav', () => {
  it('encodes a 16-bit PCM WAV with a correct RIFF/WAVE header', async () => {
    const frames = 100;
    const fakeBuffer = {
      numberOfChannels: 2,
      sampleRate: 44100,
      length: frames,
      getChannelData: () => new Float32Array(frames),
    } as unknown as AudioBuffer;

    const blob = bufferToWav(fakeBuffer);
    expect(blob.type).toBe('audio/wav');

    const view = new DataView(await blob.arrayBuffer());
    const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(36)).toBe('data');
    expect(view.getUint16(22, true)).toBe(2); // channels
    expect(view.getUint32(24, true)).toBe(44100); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    // header (44) + frames * channels * 2 bytes
    expect(blob.size).toBe(44 + frames * 2 * 2);
  });
});
