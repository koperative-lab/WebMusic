import React from 'react';
import {componentSurfaceStyle} from './surface';
import {createAnalysisSession, type AnalysisResult, type AnalysisSession} from '../analyze/headless';
import {
  createAnalysisWorker,
  type AnalysisWorkerClient,
  type AnalysisWorkerFactory,
  type AnalysisWorkerLike,
} from '../analyze/worker-client';
import type {Score} from '../core';
import {useOptionalScore} from './context';

export interface UseScoreAnalysisOptions {
  windowQuarters?: number;
  motifLength?: number;
  minOccurrences?: number;
}

/**
 * Analyze a score. By default the score comes from the enclosing
 * ScoreProvider; pass `score` explicitly to analyze outside a provider
 * (this is what `<AnalysisSummary score={...}>` does).
 *
 * Internally an incremental `AnalysisSession` is kept across renders: when
 * the score identity changes (an edit), only what the edit touched is
 * re-analyzed, so live re-analysis stays cheap even on large scores.
 */
export function useScoreAnalysis(options: UseScoreAnalysisOptions = {}, score?: Score) {
  const contextScore = useOptionalScore();
  const resolvedScore = score ?? contextScore;
  const {windowQuarters, motifLength = 4, minOccurrences = 2} = options;

  // The session lives in a ref (SSR-safe: refs work during server renders)
  // and is recreated only when the analysis options change. Score changes go
  // through session.update(), which is incremental and idempotent — calling
  // it again with the same score (e.g. StrictMode's double render) returns
  // the cached result, so the memo value stays referentially stable.
  const sessionRef = React.useRef<{session: AnalysisSession; optionsKey: string} | null>(null);

  const analysis = React.useMemo(() => {
    if (!resolvedScore) return null;
    const optionsKey = `${windowQuarters ?? ''}|${motifLength}|${minOccurrences}`;
    const current = sessionRef.current;
    if (!current || current.optionsKey !== optionsKey) {
      const session = createAnalysisSession(resolvedScore, {
        windowQuarters,
        motifLength,
        minOccurrences,
      });
      sessionRef.current = {session, optionsKey};
      return session.result;
    }
    return current.session.update(resolvedScore);
  }, [resolvedScore, windowQuarters, motifLength, minOccurrences]);

  if (!analysis) {
    throw new Error('useScoreAnalysis must be used inside ScoreProvider or be given a score');
  }

  return analysis;
}

export interface UseScoreAnalysisAsyncOptions extends UseScoreAnalysisOptions {
  /**
   * A ready-made Worker (or factory) running `@webmusic/score/analyze/worker`.
   * Defaults to the bundled worker entry; ignored by the in-process fallback.
   *
   * Ready-made Worker instances are compared by identity and replace the
   * current analysis client when they change. Factory function identity is
   * deliberately ignored so an inline factory does not recreate a Worker on
   * every render; change `workerKey` when the factory's target or
   * configuration changes.
   */
  worker?: AnalysisWorkerLike | AnalysisWorkerFactory;
  /**
   * Stable identity for factory-backed Worker configuration. Changing it
   * disposes the current client and creates a new one with the latest
   * `worker` factory. Objects used as keys should be memoized.
   */
  workerKey?: unknown;
}

export interface UseScoreAnalysisAsyncResult {
  /**
   * The analysis of the most recently analyzed score, or `null` until the
   * first analysis lands (and always `null` during SSR — analysis only runs
   * in effects).
   */
  result: AnalysisResult | null;
  /** True while the current score's analysis has not landed yet. */
  pending: boolean;
  /**
   * Failure from the current request, or `null` while idle/pending/successful.
   * A new request clears the previous error while retaining the latest
   * successful `result`.
   */
  error: Error | null;
}

type AnalysisWorkerKind = 'default' | 'factory' | 'instance';

interface AsyncAnalysisInputIdentity {
  readonly score: Score;
  readonly optionsKey: string;
  readonly workerKind: AnalysisWorkerKind;
  readonly workerInstance: AnalysisWorkerLike | null;
  readonly workerKey: unknown;
}

interface AsyncAnalysisRequestOwnership extends AsyncAnalysisInputIdentity {
  readonly requestId: number;
}

interface AsyncAnalysisState extends UseScoreAnalysisAsyncResult {
  /** Input and request generation allowed to publish this state. */
  readonly owner: AsyncAnalysisRequestOwnership | null;
}

/**
 * Like `useScoreAnalysis`, but runs the analysis off the main thread in a
 * Web Worker (via `createAnalysisWorker`). Where the sync hook blocks the
 * render until analysis finishes, this hook returns immediately with
 * `{result, pending, error}`: `result` is the latest finished analysis
 * (possibly of a previous score while `pending` is true), so UIs stay
 * responsive on large scores. Failures belonging to the current request end
 * `pending` and populate `error`; rejections from superseded or disposed
 * requests are ignored.
 *
 * The worker holds an incremental `AnalysisSession`, so score-identity
 * changes (edits) only ship the score JSON to the worker and re-analyze what
 * changed. Rapid successive edits are coalesced latest-wins: only the newest
 * score is analyzed, and `result` never shows data older than the last
 * delivered score. When `Worker` is unavailable (SSR, old runtimes) the hook
 * transparently falls back to an in-process session inside an effect.
 *
 * SSR-safe (no Worker created during render) and StrictMode-safe (the client
 * is disposed and recreated across the simulated unmount).
 */
export function useScoreAnalysisAsync(
  options: UseScoreAnalysisAsyncOptions = {},
  score?: Score,
): UseScoreAnalysisAsyncResult {
  const contextScore = useOptionalScore();
  const resolvedScore = score ?? contextScore;
  const {windowQuarters, motifLength = 4, minOccurrences = 2, worker, workerKey} = options;
  const optionsKey = `${windowQuarters ?? ''}|${motifLength}|${minOccurrences}`;
  const workerKind: AnalysisWorkerKind =
    worker === undefined ? 'default' : typeof worker === 'function' ? 'factory' : 'instance';
  const workerInstance = workerKind === 'instance' ? (worker as AnalysisWorkerLike) : null;

  if (!resolvedScore) {
    throw new Error('useScoreAnalysisAsync must be used inside ScoreProvider or be given a score');
  }

  // Keep the latest factory available without using its render-time function
  // identity as a replacement signal. Ready-made Worker identity and the
  // explicit workerKey are tracked by the effect below.
  const workerRef = React.useRef(worker);
  workerRef.current = worker;

  const clientRef = React.useRef<{
    client: AnalysisWorkerClient;
    optionsKey: string;
    workerKind: AnalysisWorkerKind;
    workerInstance: AnalysisWorkerLike | null;
    workerKey: unknown;
    analyzed: boolean;
  } | null>(null);
  const requestIdRef = React.useRef(0);

  const [state, setState] = React.useState<AsyncAnalysisState>({
    result: null,
    pending: true,
    error: null,
    owner: null,
  });

  const currentInput: AsyncAnalysisInputIdentity = {
    score: resolvedScore,
    optionsKey,
    workerKind,
    workerInstance,
    workerKey,
  };

  React.useEffect(() => {
    let cancelled = false;
    const owner: AsyncAnalysisRequestOwnership = {
      ...currentInput,
      requestId: ++requestIdRef.current,
    };
    // Tag the state before starting work. React may not commit this update
    // until after the replacement render, so the return path below also
    // compares ownership synchronously and derives `pending` for that render.
    setState((previous) => ({
      ...previous,
      pending: true,
      error: null,
      owner,
    }));

    let entry = clientRef.current;
    const replaceClient =
      !entry ||
      entry.optionsKey !== optionsKey ||
      entry.workerKind !== workerKind ||
      entry.workerInstance !== workerInstance ||
      !Object.is(entry.workerKey, workerKey);

    try {
      if (replaceClient) {
        // Session options and Worker ownership are fixed for a client's
        // lifetime. Clear the ref before disposal so a synchronous failure
        // cannot leave a disposed client available to the next effect.
        clientRef.current = null;
        entry?.client.dispose();
        entry = {
          client: createAnalysisWorker(workerRef.current),
          optionsKey,
          workerKind,
          workerInstance,
          workerKey,
          analyzed: false,
        };
        clientRef.current = entry;
      }
      if (!entry) {
        throw new Error('Analysis client was not initialized');
      }
      const activeEntry = entry;

      const request = activeEntry.analyzed
        ? activeEntry.client.update(resolvedScore)
        : activeEntry.client.analyze(resolvedScore, {windowQuarters, motifLength, minOccurrences});
      activeEntry.analyzed = true;
      request.then(
        (result) => {
          if (!cancelled && clientRef.current === activeEntry) {
            setState((previous) =>
              previous.owner === owner
                ? {result, pending: false, error: null, owner}
                : previous,
            );
          }
        },
        (reason: unknown) => {
          if (!cancelled && clientRef.current === activeEntry) {
            setState((previous) =>
              previous.owner === owner
                ? {...previous, pending: false, error: errorFrom(reason)}
                : previous,
            );
          }
        },
      );
    } catch (reason) {
      if (!cancelled) {
        setState((previous) =>
          previous.owner === owner
            ? {...previous, pending: false, error: errorFrom(reason)}
            : previous,
        );
      }
    }
    return () => {
      cancelled = true;
    };
    // windowQuarters/motifLength/minOccurrences are folded into optionsKey.
    // Factory function identity is intentionally represented by workerKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedScore, optionsKey, workerKind, workerInstance, workerKey]);

  React.useEffect(
    () => () => {
      clientRef.current?.client.dispose();
      clientRef.current = null;
    },
    [],
  );

  if (!ownsAsyncAnalysisState(state.owner, currentInput)) {
    // `useEffect` runs after render. When any input changes, the state still
    // belongs to the previous render at this point; preserve its latest good
    // result, but never present it as a completed/error state for the new
    // score or configuration.
    return {result: state.result, pending: true, error: null};
  }
  return {result: state.result, pending: state.pending, error: state.error};
}

function ownsAsyncAnalysisState(
  owner: AsyncAnalysisRequestOwnership | null,
  input: AsyncAnalysisInputIdentity,
): boolean {
  return owner !== null &&
    owner.score === input.score &&
    owner.optionsKey === input.optionsKey &&
    owner.workerKind === input.workerKind &&
    owner.workerInstance === input.workerInstance &&
    Object.is(owner.workerKey, input.workerKey);
}

function errorFrom(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}

export interface AnalysisSummaryProps extends UseScoreAnalysisOptions {
  className?: string;
  score?: Score;
}

export function AnalysisSummary({score, className, ...options}: AnalysisSummaryProps) {
  return <AnalysisSummaryContent className={className} options={options} score={score} />;
}

function AnalysisSummaryContent({
  className,
  options,
  score,
}: {
  className?: string;
  options: UseScoreAnalysisOptions;
  score?: Score;
}) {
  const {key, chords, roman, motifs, issues} = useScoreAnalysis(options, score);
  return (
    <SummaryMarkup
      className={className}
      keyLabel={key.scores.length === 0 ? 'Unknown' : `${key.tonic} ${key.mode}`}
      chordCount={chords.length}
      firstRoman={roman[0]?.roman ?? 'none'}
      motifCount={motifs.length}
      issueCount={issues.length}
    />
  );
}

function SummaryMarkup({
  className,
  keyLabel,
  chordCount,
  firstRoman,
  motifCount,
  issueCount,
}: {
  className?: string;
  keyLabel: string;
  chordCount: number;
  firstRoman: string;
  motifCount: number;
  issueCount: number;
}) {
  return (
    <dl className={className} style={{...componentSurfaceStyle('analysis'), margin: 0}}>
      <div>
        <dt>Key</dt>
        <dd>{keyLabel}</dd>
      </div>
      <div>
        <dt>Chord segments</dt>
        <dd>{chordCount}</dd>
      </div>
      <div>
        <dt>First roman</dt>
        <dd>{firstRoman}</dd>
      </div>
      <div>
        <dt>Motifs</dt>
        <dd>{motifCount}</dd>
      </div>
      <div>
        <dt>Voice-leading issues</dt>
        <dd>{issueCount}</dd>
      </div>
    </dl>
  );
}
