import {
  observeScorePlayback,
  type Score,
  type ScorePlaybackNote,
  type ScorePlaybackSnapshot,
  type ScorePlaybackSource,
} from '../../core';

/** Internal nonvisual bridge shared by the public follower and DOM adapter. */
export interface AnalysisPlaybackUpdate {
  readonly playback: ScorePlaybackSnapshot;
  readonly previous?: ScorePlaybackSnapshot;
  readonly score?: Score;
  readonly mismatched: boolean;
  readonly activeNotes: readonly ScorePlaybackNote[];
  readonly reset: boolean;
  /** Reentrant source changes make the remainder of an older callback stale. */
  isCurrent(): boolean;
}

export interface AnalysisPlaybackBinding {
  refresh(): void;
  dispose(): void;
}

/** Occurrence reconciliation borrows the source's clock, score and lifecycle. */
export function bindAnalysisPlayback(
  source: ScorePlaybackSource,
  explicitScore: () => Score | undefined,
  update: (state: AnalysisPlaybackUpdate) => void,
): AnalysisPlaybackBinding {
  let disposed = false;
  let serial = 0;
  let revision = -1;
  let previous: ScorePlaybackSnapshot | undefined;
  let previousScore: Score | undefined;
  let release: (() => void) | undefined;
  const receive = (playback: ScorePlaybackSnapshot): void => {
    if (disposed || playback.revision < revision) return;
    revision = playback.revision;
    const generation = ++serial;
    const before = previous;
    const local = explicitScore();
    const available = playback.readiness !== 'unavailable' && playback.readiness !== 'disposed';
    const score = local ?? (available ? playback.score : undefined);
    const mismatched = Boolean(local && playback.score && local !== playback.score && available);
    const next = new Map(playback.readiness === 'ready' && !mismatched
      ? playback.activeNotes.map((note) => [`${playback.sourceRevision}:${note.occurrenceId}`, Object.freeze({...note})] as const)
      : []);
    const reset = Boolean(before && (before.sourceRevision !== playback.sourceRevision || before.score !== playback.score
      || previousScore !== score || (before.state !== 'stopped' && playback.state === 'stopped')
      || (before.readiness === 'ready' && playback.readiness !== 'ready')))
      || mismatched || playback.readiness === 'disposed';
    previous = playback;
    previousScore = score;
    update(Object.freeze({
      playback, previous: before, score, mismatched,
      activeNotes: Object.freeze([...next.values()]),
      reset,
      isCurrent: () => !disposed && generation === serial,
    }));
  };
  const binding: AnalysisPlaybackBinding = {
    refresh: () => receive(source.snapshot()),
    dispose() {
      if (disposed) return;
      disposed = true;
      serial += 1;
      previous = undefined;
      previousScore = undefined;
      const cleanup = release;
      release = undefined;
      cleanup?.();
    },
  };
  const unsubscribe = observeScorePlayback(source, receive);
  if (disposed) unsubscribe();
  else release = unsubscribe;
  return binding;
}
