import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {InteractivePlayer} from '../../src/play/headless/interactive-player';

const load = vi.hoisted(() => vi.fn());
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: load}));

function score(midi: number): Score {
  const builder = new ScoreBuilder();
  const part = PartId('part');
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  builder.addPart({id: part, name: 'Part'});
  for (let beat = 0; beat < 4; beat += 1) {
    builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.fromMidi(midi + beat),
      onsetQuarters: new Rational(beat), duration: Duration.quarter(), voice: VoiceId('voice'),
    });
  }
  return builder.build();
}

function pending() {
  let resolve!: (value: Score) => void;
  const promise = new Promise<Score>((done) => { resolve = done; });
  return {promise, resolve};
}

afterEach(() => { load.mockReset(); });

describe('InteractivePlayer source identity', () => {
  it('replaces the active same-id source and removes the actual replacement', () => {
    const player = new InteractivePlayer();
    player.addSource('piece', score(60)).seekBeat(2);
    player.addSource('piece', score(72));
    expect(player.position.beat).toBe(0);
    expect(player.peek().map((note) => note.midi)).toEqual([72]);
    player.removeSource('piece');
    expect(player.activeSourceId).toBeUndefined();
    expect(player.advance()).toEqual([]);
    player.dispose();
  });

  it('rewinds the selected source when carry is explicitly false', () => {
    const player = new InteractivePlayer();
    player.addSource('a', score(60)).addSource('b', score(72));
    player.select('b').seekBeat(3).select('a').select('b', {carry: false});
    expect(player.position.beat).toBe(0);
    expect(player.peek().map((note) => note.midi)).toEqual([72]);
    player.dispose();
  });

  it.each(['replacement', 'removal'] as const)('does not resurrect a pending URL after synchronous %s', async (action) => {
    const response = pending();
    load.mockReturnValue(response.promise);
    const player = new InteractivePlayer();
    const loading = player.addSourceFromUrl('piece', 'old.mid');
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    const signal = load.mock.calls[0][1].signal as AbortSignal;
    if (action === 'replacement') player.addSource('piece', score(72));
    else player.removeSource('piece');
    response.resolve(score(60)); // An injected loader may ignore AbortSignal.
    await loading;
    expect(signal.aborted).toBe(true);
    expect(player.peek().map((note) => note.midi)).toEqual(action === 'replacement' ? [72] : []);
    player.dispose();
  });

  it('keeps the latest same-id URL result when an older request finishes last', async () => {
    const first = pending();
    const second = pending();
    load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const player = new InteractivePlayer();
    const oldLoad = player.addSourceFromUrl('piece', 'old.mid');
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    const newLoad = player.addSourceFromUrl('piece', 'new.mid');
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    second.resolve(score(72));
    await newLoad;
    first.resolve(score(60));
    await oldLoad;
    expect(player.peek().map((note) => note.midi)).toEqual([72]);
    player.removeSource('piece');
    expect(player.peek()).toEqual([]);
    player.dispose();
  });
});
