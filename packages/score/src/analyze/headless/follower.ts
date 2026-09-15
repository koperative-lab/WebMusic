import {
  Rational,
  type Score,
  type ScorePlaybackNote,
  type ScorePlaybackReadiness,
  type ScorePlaybackSnapshot,
  type ScorePlaybackSource,
  type ScorePlaybackState,
} from '../../core';
import {createAnalysisSession, type AnalysisResult, type AnalysisSession, type AnalysisSessionOptions} from './session';
import {bindAnalysisPlayback, type AnalysisPlaybackBinding, type AnalysisPlaybackUpdate} from './playback-binding';
import {seekAnalysisPlayback, type AnalysisSeekOutcome} from './seek';
export type {AnalysisSeekOutcome} from './seek';

export interface AnalysisFollowerOptions {
  /** Explicit data takes precedence over a borrowed source. */
  score?: Score;
  playback?: ScorePlaybackSource;
  /** Fixed analysis options for this follower's lifetime. */
  analysis?: AnalysisSessionOptions;
}

export interface AnalysisFollowerState {
  readonly revision: number;
  readonly score?: Score;
  readonly result?: AnalysisResult;
  readonly readiness: ScorePlaybackReadiness | 'mismatched';
  readonly playbackState: ScorePlaybackState;
  readonly nominalSeconds: number | null;
  readonly quarters: number | null;
  readonly activeNotes: readonly ScorePlaybackNote[];
  readonly activeMidis: readonly number[];
  readonly error?: unknown;
}

export interface AnalysisFollower {
  readonly state: AnalysisFollowerState;
  /** Undefined removes the explicit override and resumes borrowing source data. */
  setScore(score: Score | undefined): void;
  /** Replaces only this follower's subscription; never stops the source. */
  setPlayback(playback: ScorePlaybackSource | undefined): void;
  /** Immediately delivers the current state, then ordered changes. */
  subscribe(listener: (state: AnalysisFollowerState) => void): () => void;
  seekNominal(seconds: number): Promise<AnalysisSeekOutcome>;
  seekQuarters(quarters: number): Promise<AnalysisSeekOutcome>;
  dispose(): void;
}

/** Derived analysis and exact owner position, with no DOM, player or clock. */
export function createAnalysisFollower(options: AnalysisFollowerOptions = {}): AnalysisFollower {
  let explicit = options.score;
  let source: ScorePlaybackSource | undefined;
  let latestPlayback: ScorePlaybackSnapshot | undefined;
  let binding: AnalysisPlaybackBinding | undefined;
  let session: AnalysisSession | undefined;
  const analysisOptions = {...options.analysis};
  const listeners = new Set<(state: AnalysisFollowerState) => void>();
  let disposed = false;
  let generation = 0;
  let request = 0;
  let state: AnalysisFollowerState = Object.freeze({
    revision: 0, readiness: 'empty', playbackState: 'stopped', nominalSeconds: null, quarters: null,
    activeNotes: Object.freeze([]), activeMidis: Object.freeze([]),
  });

  function assertActive(): void {
    if (disposed) throw new Error('AnalysisFollower has been disposed.');
  }

  function publish(score: Score | undefined, playback?: ScorePlaybackSnapshot, update?: AnalysisPlaybackUpdate, localTime = 0): void {
    if (disposed) return;
    let result: AnalysisResult | undefined;
    let error = playback?.error;
    let readiness: AnalysisFollowerState['readiness'] = playback?.readiness ?? (score ? 'ready' : 'empty');
    try {
      if (score) {
        if (!session) session = createAnalysisSession(score, analysisOptions);
        result = session.update(score);
      } else session = undefined;
    } catch (failure) {
      session = undefined;
      error = failure;
      readiness = 'error';
    }
    if (update?.mismatched) readiness = 'mismatched';
    const compatible = readiness === 'ready';
    const nominalSeconds = compatible ? (playback ? playback.nominalSeconds : localTime) : null;
    const activeNotes = compatible ? update?.activeNotes ?? Object.freeze([]) : Object.freeze([]);
    const published: AnalysisFollowerState = Object.freeze({
      revision: state.revision + 1, score, result, readiness,
      playbackState: playback?.state ?? 'stopped', nominalSeconds,
      quarters: score && nominalSeconds !== null ? score.timeMap.secondsToQuarters(nominalSeconds).toFloat() : null,
      activeNotes, activeMidis: Object.freeze([...new Set(activeNotes.map((note) => note.midi))].sort((a, b) => a - b)),
      ...(error === undefined ? {} : {error}),
    });
    state = published;
    for (const listener of [...listeners]) {
      if (disposed || state !== published) break;
      if (listeners.has(listener)) listener(published);
    }
  }

  function setPlayback(next: ScorePlaybackSource | undefined): void {
    assertActive();
    if (source === next && binding) { binding.refresh(); return; }
    const ownGeneration = ++generation;
    request += 1;
    const old = binding;
    binding = undefined;
    source = next;
    latestPlayback = undefined;
    let cleanupFailure: {error: unknown} | undefined;
    let replacementFailure: {error: unknown} | undefined;
    try { old?.dispose(); } catch (error) { cleanupFailure = {error}; }
    try {
      if (!disposed && ownGeneration === generation) {
        if (!next) publish(explicit);
        else {
          const candidate = bindAnalysisPlayback(next, () => explicit, (update) => {
            if (disposed || ownGeneration !== generation) return;
            latestPlayback = update.playback;
            publish(update.score, update.playback, update);
          });
          if (disposed || ownGeneration !== generation) candidate.dispose();
          else binding = candidate;
        }
      }
    } catch (error) {
      replacementFailure = {error};
      if (!disposed && ownGeneration === generation) {
        source = undefined;
        latestPlayback = undefined;
        request += 1;
        publish(explicit);
      }
    }
    // A faulty old unsubscribe cannot strand the follower on the old score.
    // Finish the replacement, then report that cleanup failure to the caller.
    if (cleanupFailure && replacementFailure) throw Object.assign(
      new Error('AnalysisFollower cleanup and replacement failed.'),
      {errors: Object.freeze([cleanupFailure.error, replacementFailure.error])},
    );
    if (cleanupFailure) throw cleanupFailure.error;
    if (replacementFailure) throw replacementFailure.error;
  }

  async function seekNominal(seconds: number): Promise<AnalysisSeekOutcome> {
    const token = ++request;
    const ownGeneration = generation;
    const owner = source;
    const score = state.score;
    const sourceRevision = latestPlayback?.sourceRevision;
    const current = () => !disposed && token === request && ownGeneration === generation
      && source === owner && state.score === score && latestPlayback?.sourceRevision === sourceRevision;
    const failed = (error: unknown): AnalysisSeekOutcome => Object.freeze({status: 'failed', nominalSeconds: state.nominalSeconds, error});
    if (disposed) return failed(new Error('AnalysisFollower has been disposed.'));
    if (!Number.isFinite(seconds) || seconds < 0) return failed(new RangeError('Nominal seconds must be finite and non-negative.'));
    if (!score) return failed(new Error('No score is available.'));
    const target = Math.min(seconds, score.durationSeconds);
    try {
      if (!owner) {
        publish(score, undefined, undefined, target);
        return Object.freeze({status: current() ? 'committed' : 'superseded', nominalSeconds: state.nominalSeconds});
      }
      const outcome = await seekAnalysisPlayback(owner, score, target, current);
      if (!current()) return Object.freeze({status: 'superseded', nominalSeconds: state.nominalSeconds});
      if (outcome.status !== 'failed') binding?.refresh();
      if (!current()) return Object.freeze({status: 'superseded', nominalSeconds: state.nominalSeconds});
      return Object.freeze({...outcome, nominalSeconds: state.nominalSeconds});
    } catch (error) {
      return current() ? failed(error) : Object.freeze({status: 'superseded', nominalSeconds: state.nominalSeconds});
    }
  }

  const follower: AnalysisFollower = {
    get state() { return state; },
    setScore(score) {
      assertActive();
      if (explicit === score) return;
      explicit = score;
      request += 1;
      if (binding) binding.refresh();
      else if (source) setPlayback(source);
      else publish(explicit);
    },
    setPlayback,
    subscribe(listener) {
      assertActive();
      listeners.add(listener);
      try { listener(state); } catch (error) { listeners.delete(listener); throw error; }
      return () => listeners.delete(listener);
    },
    seekNominal,
    async seekQuarters(quarters) {
      if (!Number.isFinite(quarters) || quarters < 0) {
        request += 1;
        return Object.freeze({status: 'failed', nominalSeconds: state.nominalSeconds, error: new RangeError('Quarters must be finite and non-negative.')});
      }
      const score = state.score;
      return seekNominal(score ? score.timeMap.quartersToSeconds(Rational.from(Math.min(quarters, score.durationQuarters.toFloat()))) : 0);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      request += 1;
      const old = binding;
      binding = undefined;
      source = undefined;
      latestPlayback = undefined;
      explicit = undefined;
      session = undefined;
      listeners.clear();
      state = Object.freeze({revision: state.revision + 1, readiness: 'disposed', playbackState: 'stopped',
        nominalSeconds: null, quarters: null, activeNotes: Object.freeze([]), activeMidis: Object.freeze([])});
      old?.dispose();
    },
  };
  setPlayback(options.playback);
  return follower;
}
