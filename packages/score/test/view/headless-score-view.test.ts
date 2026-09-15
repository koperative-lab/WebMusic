import {describe, expect, it, vi} from 'vitest';
import {
  Duration,
  MeasureId,
  NoteId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  type Score,
  type ScorePlaybackSnapshot,
} from '../../src/core';
import {createScoreView} from '../../src/view/headless';
import type {ScoreViewOptions, ScoreViewState, ScoreViewTimeRange} from '../../src/view/api';

const publicTypeSmoke: {
  options: ScoreViewOptions;
  viewport: ScoreViewTimeRange;
  accept(state: ScoreViewState): ScoreViewState;
} = {
  options: {type: 'piano-roll'},
  viewport: {startTime: 0, endTime: 1},
  accept: (state) => state,
};

function buildScore(duplicateFirst = false): Score {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};

  builder
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: partId, name: 'Piano', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });
  for (const [pitch, onset] of [
    ['C4', 0],
    ['E4', 1],
    ['G4', 2],
  ] as const) {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(pitch),
      onsetQuarters: new Rational(onset),
      duration: Duration.quarter(),
      voice,
    });
  }
  if (duplicateFirst) {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice: VoiceId('piano-v2'),
    });
  }
  return builder.build();
}

describe('createScoreView', () => {
  it('keeps distinct part/note identity pairs separate even when IDs contain colons', () => {
    const builder = new ScoreBuilder();
    for (const [part, note, pitch] of [['a:b', 'c', 'C4'], ['a', 'b:c', 'E4']]) {
      builder.addPart({id: PartId(part), name: part});
      builder.addNote(PartId(part), {id: NoteId(note), pitch: Pitch.parse(pitch),
        onsetQuarters: Rational.ZERO, duration: Duration.whole(), voice: VoiceId('v')});
    }
    const score = builder.build();
    const view = createScoreView(score);
    view.updatePlayback({revision: 1, sourceRevision: 0, readiness: 'ready', state: 'playing',
      score, nominalSeconds: 0, nominalDurationSeconds: 2, transportSeconds: 0,
      transportDurationSeconds: 2, rate: 1, activeNotes: [{occurrenceId: 'one', partId: 'a:b', noteId: 'c',
        midi: 60, nominalStartSeconds: 0, nominalEndSeconds: 2}]});
    expect(view.state.activeNotes.map((note) => note.pitch)).toEqual([60]);
  });

  it('supersedes an older publication after a listener changes state', () => {
    const view = createScoreView(buildScore());
    const observed: number[] = [];
    view.subscribe((state) => { if (state.currentTime === 0.5) view.reset(); });
    view.subscribe((state) => observed.push(state.currentTime));
    expect(view.seek(0.5).currentTime).toBe(0);
    expect(observed).toEqual([0]);
  });

  it('honors unsubscribe and disposal during publication', () => {
    const view = createScoreView(buildScore());
    const later = vi.fn();
    const detachFirst = view.subscribe(() => { off(); });
    const off = view.subscribe(later);
    view.seek(0.5);
    expect(later).not.toHaveBeenCalled();
    detachFirst();
    view.subscribe(() => { view.dispose(); });
    view.subscribe(later);
    view.seek(1);
    expect(later).not.toHaveBeenCalled();
    expect(view.state.activeNotes).toEqual([]);
  });

  it('completes local disposal even when borrowed source cleanup throws', () => {
    const score = buildScore();
    const initial: ScorePlaybackSnapshot = {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'playing',
      score, nominalSeconds: 0, nominalDurationSeconds: 2, transportSeconds: 0,
      transportDurationSeconds: 2, rate: 1, activeNotes: []};
    const cleanup = vi.fn(() => { throw new Error('release failed'); });
    const view = createScoreView(score, {playback: {snapshot: () => initial,
      subscribe: (listener) => { listener(initial); return cleanup; }}});
    view.noteOn(60, 0);
    expect(() => view.dispose()).toThrow('release failed');
    expect(view.state.activeNotes).toEqual([]);
    expect(() => view.reset()).toThrow(/disposed/i);
    expect(() => view.dispose()).not.toThrow();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('leaves the current active state intact after rejecting a malformed playback time', () => {
    const score = buildScore();
    const view = createScoreView(score);
    view.seek(0);
    const before = view.state;
    expect(() => view.updatePlayback(playbackSnapshot(score, {nominalSeconds: Number.NaN}))).toThrow(RangeError);
    expect(view.state).toBe(before);
    expect(view.setType('staff').activeNotes).toEqual(before.activeNotes);
  });

  it('borrows ordered nominal snapshots and ignores late events after disposal', () => {
    const score = buildScore();
    const initial = playbackSnapshot(score, {revision: 3, nominalSeconds: 0.5, transportSeconds: 0.25, rate: 2});
    let emit!: (snapshot: ScorePlaybackSnapshot) => void;
    const cleanup = vi.fn();
    const seekNominal = vi.fn(async () => {});
    const view = createScoreView(score, {playback: {snapshot: () => initial, seekNominal,
      subscribe: (listener) => { emit = listener; listener(initial); return cleanup; }}});
    expect(view.state.currentTime).toBe(0.5);
    emit(playbackSnapshot(score, {revision: 2, nominalSeconds: 0}));
    expect(view.state.currentTime).toBe(0.5);
    view.seek(1);
    expect(seekNominal).not.toHaveBeenCalled();
    emit(playbackSnapshot(score, {revision: 4, readiness: 'unavailable', nominalSeconds: null}));
    expect(view.state.activeNotes).toEqual([]);
    expect(view.state.currentTime).toBe(1);
    view.dispose();
    const disposed = view.state;
    expect(() => emit(playbackSnapshot(score, {revision: 5}))).not.toThrow();
    expect(view.state).toBe(disposed);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('propagates initial subscription failure through the source cleanup contract', () => {
    const score = buildScore();
    const subscriptions = new Set<(snapshot: ScorePlaybackSnapshot) => void>();
    const invalid = playbackSnapshot(score, {nominalSeconds: Number.NaN});
    expect(() => createScoreView(score, {playback: {snapshot: () => invalid,
      subscribe: (listener) => {
        subscriptions.add(listener);
        try { listener(invalid); } catch (error) { subscriptions.delete(listener); throw error; }
        return () => { subscriptions.delete(listener); };
      }}})).toThrow(RangeError);
    expect(subscriptions.size).toBe(0);
  });

  it('publishes renderer-independent sequence, viewport and playback state', () => {
    const view = createScoreView(buildScore(), {
      type: 'staff',
      viewport: {startTime: 0.49, endTime: 0.51},
    });

    expect(view.state.type).toBe('staff');
    expect(publicTypeSmoke.accept(view.state)).toBe(view.state);
    expect(publicTypeSmoke.options.type).toBe('piano-roll');
    expect(publicTypeSmoke.viewport.endTime).toBe(1);
    expect(view.state.visibleNotes.map((note) => note.pitch)).toEqual([60, 64]);
    expect(Object.isFrozen(view.state)).toBe(true);
    expect(Object.isFrozen(view.state.visibleNotes)).toBe(true);

    const listener = vi.fn();
    const unsubscribe = view.subscribe(listener);
    const active = view.noteOn(64, 0.5);
    expect(active).toBe(view.sequence.notes[1]);
    expect(view.state.currentTime).toBe(0.5);
    expect(view.state.activeNotes).toEqual([view.sequence.notes[1]]);
    expect(listener).toHaveBeenCalledTimes(1);

    view.noteOff(64, 0.5);
    expect(view.state.activeNotes).toEqual([]);
    unsubscribe();
    view.seek(99);
    expect(view.state.currentTime).toBe(view.sequence.totalTime);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('changes view mode and window without creating any render surface', () => {
    const view = createScoreView(buildScore());
    expect(view.state.visibleNotes).toHaveLength(3);
    expect(view.state.visibleNotes).toBe(view.sequence.notes);

    expect(view.setType('waterfall').type).toBe('waterfall');
    expect(view.setViewport(0.75, 1.25).visibleNotes.map((note) => note.pitch)).toEqual([64, 67]);
    expect(view.clearViewport().visibleNotes).toBe(view.sequence.notes);
  });

  it('supports direct player-style end/reset operations', () => {
    const view = createScoreView(buildScore());
    view.noteOn(60, 0);
    view.noteOn(67, 1);
    expect(view.state.activeNotes.map((note) => note.pitch)).toEqual([67]);

    view.seek(1.25);
    expect(view.state.activeNotes.map((note) => note.pitch)).toEqual([67]);

    view.end();
    expect(view.state.currentTime).toBe(view.sequence.totalTime);
    expect(view.state.activeNotes).toEqual([]);

    view.noteOn(67, 1);
    view.reset();
    expect(view.state.currentTime).toBe(0);
    expect(view.state.activeNotes).toEqual([]);
  });

  it('activates and releases duplicate unisons at one onset together', () => {
    const view = createScoreView(buildScore(true));
    const first = view.noteOn(60, 0);
    expect(first?.pitch).toBe(60);
    expect(view.state.activeNotes.filter((note) => note.pitch === 60)).toHaveLength(2);

    view.noteOff(60, 0);
    expect(view.state.activeNotes).toEqual([]);
  });

  it('rejects invalid state and makes disposal explicit', () => {
    const view = createScoreView(buildScore());
    expect(() => view.setViewport(-1, 1)).toThrow(RangeError);
    expect(() => view.setViewport(2, 1)).toThrow(RangeError);
    expect(() => view.seek(Number.NaN)).toThrow(RangeError);
    expect(() => view.setType('grid' as never)).toThrow(RangeError);
    expect(() => view.noteOn(128, 0)).toThrow(RangeError);
    expect(() => view.noteOff(60, -1)).toThrow(RangeError);

    view.noteOn(60, 0);
    view.dispose();
    view.dispose();
    expect(view.state.activeNotes).toEqual([]);
    expect(() => view.reset()).toThrow(/disposed/i);
  });
});

function playbackSnapshot(score: Score, overrides: Partial<ScorePlaybackSnapshot> = {}): ScorePlaybackSnapshot {
  return {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'playing',
    score, nominalSeconds: 0, nominalDurationSeconds: 2, transportSeconds: 0,
    transportDurationSeconds: 2, rate: 1, activeNotes: [], ...overrides};
}
