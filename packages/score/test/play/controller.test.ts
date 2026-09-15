import {describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {PlayerController, ScorePlayer, type PlayerTimeUpdate} from '../../src/play/headless';

function scoreWithPerformedTail(): Score {
  const builder = new ScoreBuilder();
  const part = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};
  builder
    .setMetadata({title: 'Controller transport'})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: part, name: 'Piano', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });
  // The notated measure ends at 2s, while this captured performance rings for
  // 3s. The player's transport duration must be the performance duration.
  builder.addNote(part, {
    id: builder.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(),
    performed: {onsetSec: 0, durationSec: 3, velocity: 96},
    voice,
  });
  return builder.build();
}

describe('PlayerController transport bridge', () => {
  function stubPlayer() {
    return {
      on: vi.fn(() => vi.fn()),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      seek: vi.fn(),
      setTempo: vi.fn(),
      seconds: 0,
      currentTime: {seconds: 0},
      durationSeconds: 3,
      progress: 0,
    } as unknown as ScorePlayer;
  }

  it('does not rewind over a new play issued during stop', () => {
    const player = stubPlayer();
    const controller = new PlayerController(player, scoreWithPerformedTail());
    controller.play();
    controller.on('transportchange', ({playing}) => {
      if (!playing) {
        controller.seek(1);
        controller.play();
      }
    });
    controller.stop();
    expect(controller.playing).toBe(true);
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(1);
    controller.destroy();
  });

  it('does not rewind over a seek issued by the underlying pause callback', () => {
    const player = stubPlayer();
    const controller = new PlayerController(player, scoreWithPerformedTail());
    vi.mocked(player.pause).mockImplementation(() => controller.seek(1));
    controller.stop();
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(1);
    controller.destroy();
  });

  it('keeps the prior rate when a tempo write fails or a non-finite rate is rejected', () => {
    const player = stubPlayer();
    const controller = new PlayerController(player, scoreWithPerformedTail());
    controller.setRate(2);
    vi.mocked(player.setTempo).mockImplementation(() => { throw new Error('tempo unavailable'); });
    expect(() => controller.setRate(3)).toThrow('tempo unavailable');
    expect(controller.rate).toBe(2);
    expect(() => controller.setRate(NaN)).toThrow(RangeError);
    expect(() => controller.setRate(Infinity)).toThrow(RangeError);
    expect(controller.rate).toBe(2);
    controller.destroy();
  });

  it('keeps a newer reentrant rate when the outer tempo write throws', () => {
    const player = stubPlayer();
    const controller = new PlayerController(player, scoreWithPerformedTail());
    vi.mocked(player.setTempo).mockImplementationOnce(() => {
      controller.setRate(3);
      throw new Error('stale write failed');
    });
    expect(() => controller.setRate(2)).toThrow('stale write failed');
    expect(controller.rate).toBe(3);
    controller.destroy();
  });

  it('emits explicit transport state for external play, pause and end calls', () => {
    const score = scoreWithPerformedTail();
    const playerListeners = new Map<string, (payload: unknown) => void>();
    const player = {
      on: vi.fn((event: string, listener: (payload: unknown) => void) => {
        playerListeners.set(event, listener);
        return vi.fn();
      }),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      seek: vi.fn(),
      setTempo: vi.fn(),
      seconds: 0,
      currentTime: {seconds: 0},
      durationSeconds: 1,
      progress: 0,
    } as unknown as ScorePlayer;
    const controller = new PlayerController(player, score);
    const states: boolean[] = [];
    controller.on('transportchange', ({playing}) => states.push(playing));

    controller.play();
    controller.pause();
    controller.play();
    playerListeners.get('end')?.(score);

    expect(states).toEqual([true, false, true, false]);
    controller.destroy();
  });

  it('lets a re-entrant pause win over the play that emitted transportchange', () => {
    const score = scoreWithPerformedTail();
    const player = {
      on: vi.fn(() => vi.fn()),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      seek: vi.fn(),
      setTempo: vi.fn(),
      seconds: 0,
      currentTime: {seconds: 0},
      durationSeconds: 1,
      progress: 0,
    } as unknown as ScorePlayer;
    const controller = new PlayerController(player, score);
    let pauseOnce = true;
    controller.on('transportchange', ({playing}) => {
      if (playing && pauseOnce) {
        pauseOnce = false;
        controller.pause();
      }
    });

    controller.play();

    expect(controller.playing).toBe(false);
    expect(player.play).not.toHaveBeenCalled();
    expect(player.pause).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it('lets a re-entrant play win over the pause that emitted transportchange', () => {
    const score = scoreWithPerformedTail();
    const player = {
      on: vi.fn(() => vi.fn()),
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      seek: vi.fn(),
      setTempo: vi.fn(),
      seconds: 0,
      currentTime: {seconds: 0},
      durationSeconds: 1,
      progress: 0,
    } as unknown as ScorePlayer;
    const controller = new PlayerController(player, score);
    controller.play();
    vi.mocked(player.play).mockClear();
    let playOnce = true;
    controller.on('transportchange', ({playing}) => {
      if (!playing && playOnce) {
        playOnce = false;
        controller.play();
      }
    });

    controller.pause();

    expect(controller.playing).toBe(true);
    expect(player.pause).not.toHaveBeenCalled();
    expect(player.play).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it('ignores a stale play rejection after a newer play attempt starts', async () => {
    const score = scoreWithPerformedTail();
    let rejectFirst!: (error: unknown) => void;
    const first = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const player = {
      on: vi.fn(() => vi.fn()),
      play: vi.fn()
        .mockReturnValueOnce(first)
        .mockResolvedValueOnce(undefined),
      pause: vi.fn(),
      seek: vi.fn(),
      setTempo: vi.fn(),
      seconds: 0,
      currentTime: {seconds: 0},
      durationSeconds: 1,
      progress: 0,
    } as unknown as ScorePlayer;
    const controller = new PlayerController(player, score);
    const errors: unknown[] = [];
    controller.on('error', (error) => errors.push(error));

    controller.play();
    controller.pause();
    controller.play();
    await Promise.resolve();
    expect(controller.playing).toBe(true);

    rejectFirst(new Error('stale first attempt'));
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.playing).toBe(true);
    expect(errors).toEqual([]);
    controller.destroy();
  });

  it('reports subscriber failures separately from operational errors', () => {
    const score = scoreWithPerformedTail();
    const player = new ScorePlayer(score);
    const controller = new PlayerController(player, score);
    const failure = new Error('controller listener failed');
    const errors: unknown[] = [];
    const listenerErrors: unknown[] = [];
    const laterUpdate = vi.fn();
    controller.on('timeupdate', () => {
      throw failure;
    });
    controller.on('timeupdate', laterUpdate);
    controller.on('error', (error) => errors.push(error));
    controller.on('listenerError', (error) => listenerErrors.push(error));

    expect(() => player.seekFraction(0.5)).not.toThrow();
    expect(laterUpdate).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
    expect(listenerErrors).toEqual([
      expect.objectContaining({
        kind: 'listenerError',
        source: 'PlayerController',
        event: 'timeupdate',
        mode: 'throw',
        error: failure,
      }),
    ]);

    controller.destroy();
    player.dispose();
  });

  it('forwards explicit snapshots and never divides nominal time by a separate duration', () => {
    const score = scoreWithPerformedTail();
    const player = new ScorePlayer(score);
    const controller = new PlayerController(player, score);
    const updates: PlayerTimeUpdate[] = [];
    controller.on('timeupdate', (update) => updates.push(update));

    player.setRate(2);
    player.seekFraction(0.5);

    // Halfway through a three-second performance at 2x is 0.75 transport
    // seconds, while the score coordinate remains 1.5 nominal seconds.
    expect(controller.currentPosition.seconds).toBeCloseTo(1.5, 5);
    expect(controller.currentTime).toBeCloseTo(0.75, 5);
    expect(controller.duration).toBeCloseTo(1.5, 5);
    expect(controller.progress).toBeCloseTo(0.5, 5);
    expect(updates).toEqual([
      {
        nominalSeconds: 1.5,
        transportSeconds: 0.75,
        transportDurationSeconds: 1.5,
        progress: 0.5,
        seconds: 0.75,
        duration: 1.5,
      },
    ]);

    controller.destroy();
    player.dispose();
  });
});
