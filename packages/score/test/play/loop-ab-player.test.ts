// Node-safe tests for the headless LoopPlayer / AbPlayer orchestration classes
// (the DOM-free counterparts of the former <loop-player> / <ab-player>). They
// construct without a Web Audio context — we assert the loop-region wiring and
// the A/B switching logic by spying on the underlying engines.
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {LoopPlayer, createLoopPlayer, AbPlayer, createAbPlayer} from '../../src/play/headless';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Exercise the real wrapper and scheduler with an explicitly advanced audio clock. */
function installAudioClock() {
  let now = 0;
  const node = () => ({gain: {value: 1}, connect() {}, disconnect() {}});
  const context = {
    get currentTime() { return now; },
    state: 'running',
    destination: node(),
    createGain: node,
    createStereoPanner: () => ({...node(), pan: {value: 0}}),
    resume: async () => undefined,
    close: async () => undefined,
  };
  vi.stubGlobal('AudioContext', function () { return context; });
  return (durationMs: number) => {
    for (let elapsed = 0; elapsed < durationMs; elapsed += 10) {
      now += 0.01;
      vi.advanceTimersByTime(10);
    }
  };
}

/** One whole note in a 4/4 measure at 120bpm → 2.0s nominal. */
function buildScore(title = 'Loop Test', pitch = 'C4', tempoUnit = 1): Score {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .setMetadata({title})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120, unit: tempoUnit})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: partId, name: 'Piano', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });
  builder.addNote(partId, {
    id: builder.newNoteId(),
    pitch: Pitch.parse(pitch),
    onsetQuarters: Rational.ZERO,
    duration: Duration.whole(),
    voice,
  });
  return builder.build();
}

describe('LoopPlayer', () => {
  it('constructs without a Web Audio context and exposes its engine', () => {
    const lp = new LoopPlayer(buildScore());
    expect(lp.player).toBeDefined();
    expect(lp.duration).toBeGreaterThan(0);
    expect(lp.loop).toBe(true);
    expect(lp.loopIn).toBeCloseTo(0.25);
    expect(lp.loopOut).toBeCloseTo(0.75);
    lp.dispose();
  });

  it('honours constructor options', () => {
    const lp = new LoopPlayer(buildScore(), {loopIn: 0.1, loopOut: 0.6, loop: false, loopCount: 4});
    expect(lp.loopIn).toBeCloseTo(0.1);
    expect(lp.loopOut).toBeCloseTo(0.6);
    expect(lp.loop).toBe(false);
    expect(lp.loopCount).toBe(4);
    lp.dispose();
  });

  it('arms the loop region in real seconds when on, clears it when off', () => {
    const lp = new LoopPlayer(buildScore());
    const setLoop = vi.spyOn(lp.player, 'setLoop');
    const clearLoop = vi.spyOn(lp.player, 'clearLoop');

    lp.setLoopRegion(0.25, 0.75);
    expect(setLoop).toHaveBeenLastCalledWith(0.25 * lp.duration, 0.75 * lp.duration);

    lp.loop = false;
    expect(clearLoop).toHaveBeenCalled();

    setLoop.mockClear();
    lp.loop = true;
    expect(setLoop).toHaveBeenLastCalledWith(0.25 * lp.duration, 0.75 * lp.duration);
    lp.dispose();
  });

  it('setLoopRegion clamps to 0..1 and keeps in ≤ out', () => {
    const lp = new LoopPlayer(buildScore());
    lp.setLoopRegion(-1, 2); // clamps to [0, 1]
    expect(lp.loopIn).toBe(0);
    expect(lp.loopOut).toBe(1);

    lp.setLoopRegion(0.8, 0.2); // swapped → ordered
    expect(lp.loopIn).toBeCloseTo(0.2);
    expect(lp.loopOut).toBeCloseTo(0.8);
    lp.dispose();
  });

  it('seekFraction seeks the engine to fraction × duration', () => {
    const lp = new LoopPlayer(buildScore());
    const seek = vi.spyOn(lp.player, 'seek');
    lp.seekFraction(0.5);
    expect(seek).toHaveBeenLastCalledWith(0.5 * lp.duration);
    lp.dispose();
  });

  it('does not mistake an explicit backward seek for a finite loop wrap', () => {
    const lp = new LoopPlayer(buildScore(), {loopIn: 0, loopOut: 1, loopCount: 1});
    const clearLoop = vi.spyOn(lp.player, 'clearLoop');

    lp.seekFraction(0.75);
    lp.seekFraction(0.25);

    expect(clearLoop).not.toHaveBeenCalled();
    lp.dispose();
  });

  it('does not consume a finite repeat when a live region edit moves the playhead backward', async () => {
    vi.useFakeTimers();
    const advance = installAudioClock();
    const lp = new LoopPlayer(buildScore(), {
      synth: {noteOn() {}, noteOff() {}},
      loopIn: 0,
      loopOut: 1,
      loopCount: 1,
    });
    const clearLoop = vi.spyOn(lp.player, 'clearLoop');
    try {
      await lp.play();
      advance(1200);
      expect(lp.player.progress).toBeGreaterThan(0.5);

      lp.setLoopRegion(0, 0.25);
      advance(100);
      expect(lp.player.progress).toBeLessThan(0.25);
      expect(clearLoop).not.toHaveBeenCalled();

      advance(300);
      expect(clearLoop).toHaveBeenCalledTimes(1);
    } finally {
      lp.dispose();
    }
  });

  it('createLoopPlayer is a factory for the class', () => {
    const lp = createLoopPlayer(buildScore());
    expect(lp).toBeInstanceOf(LoopPlayer);
    lp.dispose();
  });
});

describe('AbPlayer', () => {
  it('converts the first source tempo unit to the quarter-note pull clock', async () => {
    vi.useFakeTimers();
    const ab = new AbPlayer({A: buildScore('Half-note tempo', 'C4', 2)}, {sound: {noteOn() {}}});
    vi.spyOn(ab.player, 'preload').mockResolvedValue();
    const advance = vi.spyOn(ab.player, 'advance').mockReturnValue([]);
    await ab.play();
    // Half note = 120 BPM means quarter note = 240 BPM = 0.25 seconds.
    vi.advanceTimersByTime(250);
    expect(advance).toHaveBeenCalledExactlyOnceWith({secondsPerBeat: 0.25});
    ab.dispose();
  });

  const sources = (): Record<string, Score> => ({
    A: buildScore('Major', 'C4'),
    B: buildScore('Minor', 'Eb4'),
  });

  it('registers the named arrangements and starts on the first', () => {
    const ab = new AbPlayer(sources());
    expect(ab.ids).toEqual(['A', 'B']);
    expect(ab.active).toBe('A');
    expect(ab.playing).toBe(false);
    ab.dispose();
  });

  it('select switches the active arrangement live and ignores no-ops', () => {
    const ab = new AbPlayer(sources());
    const select = vi.spyOn(ab.player, 'select');

    ab.select('B');
    expect(ab.active).toBe('B');
    expect(select).toHaveBeenLastCalledWith('B');

    select.mockClear();
    ab.select('B'); // already active → no-op
    ab.select('Z'); // unknown → no-op
    expect(select).not.toHaveBeenCalled();
    expect(ab.active).toBe('B');
    ab.dispose();
  });

  it('waits for InteractivePlayer preload before starting its metronome', async () => {
    const ab = new AbPlayer(sources());
    let resolve!: () => void;
    const pending = new Promise<void>((done) => {
      resolve = done;
    });
    const preload = vi.spyOn(ab.player, 'preload').mockReturnValue(pending);

    const start = ab.play();
    expect(preload).toHaveBeenCalledTimes(1);
    expect(ab.playing).toBe(false);

    resolve();
    await start;
    expect(ab.playing).toBe(true);
    ab.pause();
    ab.dispose();
  });

  it('honours a pause from a supplied sound during synchronous graph preparation', async () => {
    vi.useFakeTimers();
    installAudioClock();
    const connect = vi.fn(() => { ab.pause(); });
    const ab = new AbPlayer(sources(), {sound: {connect, noteOn() {}}});
    try {
      await ab.play();
      expect(connect).toHaveBeenCalledOnce();
      expect(ab.playing).toBe(false);
    } finally {
      ab.dispose();
    }
  });

  it('does not let a cancelled synchronous preparation hide an immediate retry', async () => {
    const ab = new AbPlayer(sources());
    const preload = vi.spyOn(ab.player, 'preload')
      .mockImplementationOnce(() => {
        ab.pause();
        return Promise.resolve();
      })
      .mockResolvedValue(undefined);
    try {
      const cancelled = ab.play();
      const retry = ab.play();
      expect(retry).not.toBe(cancelled);
      await Promise.all([cancelled, retry]);
      expect(preload).toHaveBeenCalledTimes(2);
      expect(ab.playing).toBe(true);
    } finally {
      ab.dispose();
    }
  });

  it('play() on an empty source set is a no-op', () => {
    const ab = new AbPlayer({});
    expect(ab.ids).toEqual([]);
    ab.play();
    expect(ab.playing).toBe(false);
    ab.dispose();
  });

  it('cannot restart or switch after disposal', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const ab = new AbPlayer(sources());
    const preload = vi.spyOn(ab.player, 'preload');
    const active = ab.active;

    try {
      ab.dispose();
      expect(() => ab.dispose()).not.toThrow();

      await expect(ab.play()).rejects.toThrow(/disposed/i);
      expect(preload).not.toHaveBeenCalled();
      expect(interval).not.toHaveBeenCalled();
      expect(() => ab.select('B')).toThrow(/disposed/i);
      expect(ab.active).toBe(active);
      expect(ab.playing).toBe(false);
    } finally {
      interval.mockRestore();
    }
  });

  it('cannot complete an in-flight start after disposal', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const ab = new AbPlayer(sources());
    let resolvePreload!: () => void;
    const preload = new Promise<void>((resolve) => {
      resolvePreload = resolve;
    });
    vi.spyOn(ab.player, 'preload').mockReturnValue(preload);

    try {
      const starting = ab.play();
      ab.dispose();
      resolvePreload();
      await starting;

      expect(interval).not.toHaveBeenCalled();
      expect(ab.playing).toBe(false);
    } finally {
      interval.mockRestore();
    }
  });

  it('createAbPlayer is a factory for the class', () => {
    const ab = createAbPlayer(sources(), {bpm: 90});
    expect(ab).toBeInstanceOf(AbPlayer);
    expect(ab.active).toBe('A');
    ab.dispose();
  });
});
