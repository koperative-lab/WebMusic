import {observeScorePlayback, Rational, type Score, type ScorePlaybackReadiness, type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../../core';
import {createScoreMap, type ScoreMap, type ScoreMapCell, type ScoreMapMark, type ScoreMapOptions} from '../core/map';

export interface ScoreMapViewOptions extends ScoreMapOptions {
  /** Explicit data wins over the borrowed source. Omit to follow source replacement. */
  score?: Score;
  playback?: ScorePlaybackSource;
  /** Optional nominal-seconds command for an application adapter without a native source. */
  seekNominal?: (seconds: number) => void | Promise<void>;
}

export interface ScoreMapViewState {
  readonly score?: Score;
  readonly map?: {
    readonly durationQuarters: number;
    readonly cells: readonly Readonly<ScoreMapCell>[];
    readonly marks: readonly Readonly<ScoreMapMark>[];
  };
  readonly nominalSeconds: number;
  readonly quarters: number;
  readonly readiness: ScorePlaybackReadiness | 'unbound' | 'mismatched';
  readonly pending: boolean;
}

export type ScoreMapSeekOutcome = {
  readonly status: 'committed' | 'superseded';
  readonly nominalSeconds: number;
  readonly quarters: number;
} | {
  readonly status: 'failed';
  readonly nominalSeconds: number;
  readonly quarters: number;
  readonly error: unknown;
};

export type ScoreMapViewListener = (state: ScoreMapViewState) => void;

/** Whole-score navigation state. Owns projections/subscriptions, never playback or UI. */
export interface ScoreMapView {
  readonly state: ScoreMapViewState;
  setScore(score: Score | undefined): void;
  setPlayback(source: ScorePlaybackSource | undefined): void;
  configure(options: ScoreMapOptions): void;
  /** Apply an authoritative nominal position (e.g. from a legacy event adapter). */
  setPosition(seconds: number): void;
  /** Clamp the quarter position, delegate in nominal seconds, and report the outcome. */
  seekQuarters(quarters: number): Promise<ScoreMapSeekOutcome>;
  /** Immediately emits current state. Reentrant updates supersede older notifications. */
  subscribe(listener: ScoreMapViewListener): () => void;
  dispose(): void;
}

export function createScoreMapView(options: ScoreMapViewOptions = {}): ScoreMapView {
  let explicitScore = options.score;
  let source: ScorePlaybackSource | undefined;
  let playback: ScorePlaybackSnapshot | undefined;
  let mapOptions: ScoreMapOptions = {part: options.part, maxCells: options.maxCells, maxMarks: options.maxMarks};
  let score = explicitScore;
  let map = project(score, mapOptions);
  let seconds = 0;
  let pending = false;
  let generation = 0;
  let request = 0;
  let positionRevision = 0;
  let disposed = false;
  let unsubscribe: (() => void) | undefined;
  const listeners = new Set<ScoreMapViewListener>();
  let state = snapshot();

  function assertActive(): void {
    if (disposed) throw new Error('ScoreMapView has been disposed.');
  }
  function snapshot(): ScoreMapViewState {
    const readiness = playback && explicitScore && playback.score && playback.score !== explicitScore
      ? 'mismatched' : playback?.readiness ?? 'unbound';
    return Object.freeze({score, map, nominalSeconds: seconds,
      quarters: score?.timeMap.secondsToQuarters(seconds).toFloat() ?? 0, readiness, pending});
  }
  function publish(): void {
    const emitted = state = snapshot();
    for (const listener of [...listeners]) {
      if (disposed || state !== emitted) break;
      if (listeners.has(listener)) listener(emitted);
    }
  }
  function invalidate(): void {
    request += 1;
    pending = false;
  }
  function applyPlayback(next: ScorePlaybackSnapshot): void {
    if (playback && next.revision < playback.revision) return;
    const selected = explicitScore ?? (next.readiness === 'disposed' || next.readiness === 'unavailable' ? undefined : next.score);
    const projected = selected === score ? map : project(selected, mapOptions);
    const compatible = selected && selected === next.score && next.readiness === 'ready';
    const position = compatible && next.nominalSeconds !== null ? clampSeconds(next.nominalSeconds, selected) : 0;
    const replaced = playback && (playback.sourceRevision !== next.sourceRevision || playback.score !== next.score);
    if (replaced || next.readiness !== 'ready') invalidate();
    playback = next;
    score = selected;
    map = projected;
    seconds = position;
    positionRevision += 1;
    publish();
  }
  function outcome(status: 'committed' | 'superseded'): ScoreMapSeekOutcome {
    return Object.freeze({status, nominalSeconds: state.nominalSeconds, quarters: state.quarters});
  }
  const view: ScoreMapView = {
    get state() { return state; },
    setScore(next) {
      assertActive();
      const selected = next ?? (playback?.readiness === 'disposed' || playback?.readiness === 'unavailable' ? undefined : playback?.score);
      const projected = project(selected, mapOptions);
      explicitScore = next;
      score = selected;
      map = projected;
      invalidate();
      if (playback) applyPlayback(playback);
      else { seconds = 0; positionRevision += 1; publish(); }
    },
    setPlayback(next) {
      assertActive();
      const epoch = ++generation;
      invalidate();
      const release = unsubscribe;
      unsubscribe = undefined;
      source = undefined;
      playback = undefined;
      score = explicitScore;
      map = project(score, mapOptions);
      seconds = 0;
      positionRevision += 1;
      try { release?.(); } finally { publish(); }
      if (!next || disposed || epoch !== generation) return;
      source = next;
      let detach: () => void;
      try {
        detach = observeScorePlayback(next, (value) => {
          if (!disposed && epoch === generation) applyPlayback(value);
        });
      } catch (error) {
        if (!disposed && epoch === generation) {
          source = undefined;
          playback = undefined;
          score = explicitScore;
          map = project(score, mapOptions);
          seconds = 0;
          invalidate();
          publish();
        }
        throw error;
      }
      if (disposed || epoch !== generation) detach();
      else unsubscribe = detach;
    },
    configure(next) {
      assertActive();
      const copy = {...next};
      const projected = project(score, copy);
      mapOptions = copy;
      map = projected;
      publish();
    },
    setPosition(value) {
      assertActive();
      seconds = clampSeconds(value, score);
      positionRevision += 1;
      publish();
    },
    async seekQuarters(value) {
      if (disposed) return Object.freeze({status: 'failed', nominalSeconds: state.nominalSeconds,
        quarters: state.quarters, error: new Error('ScoreMapView has been disposed.')});
      const id = ++request;
      const epoch = generation;
      const selected = score;
      const owner = source;
      const beforePosition = positionRevision;
      const current = () => !disposed && id === request && epoch === generation && selected === score;
      try {
        assertActive();
        if (!Number.isFinite(value)) throw new RangeError('Score map position must be finite.');
        if (!selected) throw new Error('Score map has no score to navigate.');
        if (owner && (state.readiness !== 'ready' || playback?.score !== selected)) {
          throw new Error('Score map cannot navigate an unavailable or mismatched playback source.');
        }
        const quarters = Math.max(0, Math.min(map?.durationQuarters ?? 0, value));
        const nominal = selected.timeMap.quartersToSeconds(Rational.from(quarters));
        const command = owner ? owner.seekNominal?.bind(owner) : options.seekNominal;
        if (owner && !command) throw new Error('Score map playback source is read-only.');
        pending = true;
        publish();
        if (!current()) return outcome('superseded');
        const result = command?.(nominal);
        if (result) await result;
        if (!current()) return outcome('superseded');
        // A native owner may wrap a loop or clamp differently. Its observation
        // always wins over a requested cursor, including synchronous callbacks.
        if (owner) {
          const observed = owner.snapshot();
          if (!playback || observed.revision >= playback.revision) applyPlayback(observed);
        }
        if (!current()) return outcome('superseded');
        if (!owner && beforePosition === positionRevision) seconds = nominal;
        pending = false;
        publish();
        return outcome(current() ? 'committed' : 'superseded');
      } catch (error) {
        if (!current()) return outcome('superseded');
        // No optimistic position was committed, so rejection needs no invented
        // rollback and cannot overwrite a newer authoritative observation.
        pending = false;
        publish();
        if (!current()) return outcome('superseded');
        return Object.freeze({status: 'failed', nominalSeconds: state.nominalSeconds, quarters: state.quarters, error});
      }
    },
    subscribe(listener) {
      assertActive();
      listeners.add(listener);
      try { listener(state); } catch (error) { listeners.delete(listener); throw error; }
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      invalidate();
      const release = unsubscribe;
      unsubscribe = undefined;
      listeners.clear();
      state = snapshot();
      release?.();
    },
  };
  if (options.playback) view.setPlayback(options.playback);
  return view;
}

function clampSeconds(value: number, score: Score | undefined): number {
  if (!Number.isFinite(value)) throw new RangeError('Score map time must be finite.');
  return Math.max(0, Math.min(score?.durationSeconds ?? 0, value));
}

function project(score: Score | undefined, options: ScoreMapOptions): ScoreMapViewState['map'] {
  // Validate options even before data arrives.
  for (const value of [options.maxCells, options.maxMarks]) {
    if (value !== undefined && !Number.isFinite(value)) throw new RangeError('Score map budgets must be finite.');
  }
  if (!score) return undefined;
  const map: ScoreMap = createScoreMap(score, options);
  return Object.freeze({durationQuarters: map.durationQuarters,
    cells: Object.freeze(map.cells.map((cell) => Object.freeze(cell))),
    marks: Object.freeze(map.marks.map((mark) => Object.freeze(mark)))});
}
