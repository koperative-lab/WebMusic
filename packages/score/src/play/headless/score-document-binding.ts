import {
  Score, ScoreDocumentApplicationError, composeScorePositionMaps, validateScore,
  type ScoreDocumentSource, type ScoreDocumentSnapshot, type ScorePositionMap,
  type ScoreDocumentRevision, type ScoreDocumentPlaybackBinding, type ScoreDocumentApplicationResult,
} from '../../core';
import type {ScoreTimeline} from './score-timeline';

export interface PreparedScoreDocument {
  readonly score: Score;
  readonly timeline: ScoreTimeline;
  readonly preload?: Promise<void>;
}

interface BindingHost {
  readonly expanded: boolean;
  pause(): void;
  prepare(score: Score): PreparedScoreDocument | Promise<PreparedScoreDocument>;
  transport(): {score: Score; nominalSeconds: number; loop?: readonly [number, number]};
  adopt(candidate: PreparedScoreDocument, nominalSeconds: number, loop?: readonly [number, number]): void;
  notify(): void;
  /** Report the adopted position once; adoption moves it without a transport command. */
  publishPosition(): void;
  onDetach(): void;
  report(error: unknown): void;
}

interface Attempt {
  readonly id: number;
  readonly target: ScoreDocumentRevision;
  readonly promise: Promise<ScoreDocumentApplicationResult>;
  readonly resolve: (result: ScoreDocumentApplicationResult) => void;
  result?: ScoreDocumentApplicationResult;
}

/** One borrowed document attachment. No editor, graph, synth, clock or history ownership. */
export class ScoreDocumentBinding {
  private source?: ScoreDocumentSource;
  private unsubscribe?: () => void;
  private generation = 0;
  private serial = 0;
  private disposed = false;
  private requested?: ScoreDocumentSnapshot;
  private applied?: ScoreDocumentRevision;
  private map?: ScorePositionMap;
  private attempt?: Attempt;
  private positionIntent?: number;
  private state: ScoreDocumentPlaybackBinding = Object.freeze({status: 'empty', attempt: 0, documentCoordinates: false});

  constructor(private readonly host: BindingHost) {}
  getSource(): ScoreDocumentSource | undefined { return this.source; }
  getState(): ScoreDocumentPlaybackBinding { return this.state; }

  assertPlayable(): void {
    if (this.disposed) throw new ScoreDocumentApplicationError('disposed', 'ScorePlayer has been disposed.');
    if (this.source && this.state.status !== 'ready') {
      throw new ScoreDocumentApplicationError('not-ready', 'The requested document revision is not ready for playback.');
    }
  }

  /** Position commands during preparation remain tagged to the last applied timeline. */
  recordPositionIntent(nominalSeconds: number): void {
    if (this.source && this.state.status !== 'ready') this.positionIntent = nominalSeconds;
  }

  setSource(source: ScoreDocumentSource | undefined): void {
    if (this.disposed) throw new ScoreDocumentApplicationError('disposed', 'ScorePlayer has been disposed.');
    if (source === this.source) return;
    if (source !== undefined && (!source || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function')) {
      throw new ScoreDocumentApplicationError('invalid-source', 'Expected a ScoreDocumentSource');
    }
    const generation = ++this.generation;
    this.supersede();
    const previousUnsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    this.source = source;
    this.requested = undefined;
    this.map = undefined;
    this.positionIntent = undefined;
    this.state = Object.freeze({status: 'empty', attempt: this.serial, applied: source ? this.applied : undefined,
      documentCoordinates: false});
    if (!source) this.applied = undefined;
    this.release(previousUnsubscribe);
    if (generation !== this.generation || this.disposed) return;
    this.host.pause();
    if (generation !== this.generation || this.disposed) return;
    if (!source) {
      this.host.onDetach();
      this.host.notify();
      return;
    }
    try {
      const unsubscribe = source.subscribe((snapshot) => {
        if (generation === this.generation && !this.disposed) this.receive(snapshot);
      });
      if (typeof unsubscribe !== 'function') throw new ScoreDocumentApplicationError('invalid-source', 'Document subscription must return cleanup');
      if (generation !== this.generation || this.disposed) this.release(unsubscribe);
      else this.unsubscribe = unsubscribe;
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.sourceError(error);
    }
  }

  wait(target: ScoreDocumentRevision): Promise<ScoreDocumentApplicationResult> {
    if (!validTarget(target)) return Promise.resolve(this.failed(target, new ScoreDocumentApplicationError('unknown-revision', 'Invalid document revision target')));
    const requested = this.requested;
    if (!requested || this.disposed || target.documentId !== requested.documentId || target.documentRevision < requested.documentRevision) {
      return Promise.resolve(Object.freeze({status: 'superseded', target: freezeTarget(target), attempt: this.serial}));
    }
    if (target.documentRevision > requested.documentRevision) {
      return Promise.resolve(this.failed(target, new ScoreDocumentApplicationError('unknown-revision', 'The requested document revision has not been observed')));
    }
    if (this.attempt) return this.attempt.promise;
    return Promise.resolve(this.failed(target, this.state.error ?? new ScoreDocumentApplicationError('not-ready', 'Document source is unavailable')));
  }

  retry(): Promise<ScoreDocumentApplicationResult> {
    if (!this.requested || !this.source || this.disposed || this.requested.status !== 'ready') {
      return Promise.resolve(this.failed(undefined, new ScoreDocumentApplicationError(this.disposed ? 'disposed' : 'not-ready', 'No document revision is available to apply')));
    }
    return this.start(this.requested);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation++;
    this.supersede();
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    this.source = undefined;
    this.requested = undefined;
    this.map = undefined;
    this.positionIntent = undefined;
    this.state = Object.freeze({...this.state, status: 'empty', documentCoordinates: false});
    this.release(unsubscribe);
  }

  private receive(snapshot: ScoreDocumentSnapshot): void {
    try {
      if (!validTarget(snapshot) || !(snapshot.content instanceof Score) || !['ready', 'disposed'].includes(snapshot.status)) {
        throw new ScoreDocumentApplicationError('invalid-snapshot', 'Invalid Score document snapshot');
      }
      if (snapshot.status === 'disposed') {
        this.supersede();
        this.requested = undefined;
        this.map = undefined;
        this.state = Object.freeze({status: 'empty', attempt: this.serial, applied: this.applied, documentCoordinates: false});
        this.host.pause();
        this.host.notify();
        return;
      }
      const previous = this.requested;
      if (previous?.documentId === snapshot.documentId) {
        if (snapshot.documentRevision < previous.documentRevision) return;
        if (snapshot.documentRevision === previous.documentRevision) {
          if (snapshot.content !== previous.content) throw new ScoreDocumentApplicationError('invalid-snapshot', 'Content changed without a document revision');
          return;
        }
      }
      // Retain the map chain independently of editor history and failed attempts.
      const change = snapshot.change?.positionMap;
      let map: ScorePositionMap | undefined;
      if (this.applied?.documentId === snapshot.documentId && change &&
          change.documentId === snapshot.documentId && change.toRevision === snapshot.documentRevision) {
        try {
          if (change.fromRevision === this.applied.documentRevision) map = composeScorePositionMaps(change);
          else if (this.map && previous?.documentId === snapshot.documentId && change.fromRevision === previous.documentRevision) {
            map = composeScorePositionMaps(this.map, change);
          }
        } catch { /* Missing/invalid chains explicitly reset rather than guessing. */ }
      }
      if (this.state.status === 'ready' || this.state.status === 'empty') this.positionIntent = undefined;
      this.map = map;
      this.requested = snapshot;
      this.start(snapshot);
    } catch (error) { this.sourceError(error); }
  }

  private start(snapshot: ScoreDocumentSnapshot): Promise<ScoreDocumentApplicationResult> {
    this.supersede();
    let resolve!: Attempt['resolve'];
    const promise = new Promise<ScoreDocumentApplicationResult>((done) => { resolve = done; });
    const attempt: Attempt = {id: ++this.serial, target: freezeTarget(snapshot), promise, resolve};
    this.attempt = attempt;
    const generation = this.generation;
    this.state = Object.freeze({status: 'preparing', attempt: attempt.id, requested: attempt.target,
      applied: this.applied, documentCoordinates: false});
    this.host.pause();
    if (!this.current(attempt, generation)) return promise;
    this.host.notify();
    if (!this.current(attempt, generation)) return promise;
    void Promise.resolve().then(() => {
      if (!this.current(attempt, generation)) return undefined;
      const issues = validateScore(snapshot.content);
      if (issues.length) throw new ScoreDocumentApplicationError('invalid-snapshot', issues.map((issue) => issue.message).join('; '));
      return this.host.prepare(snapshot.content);
    }).then((candidate) => {
      if (!candidate || !this.current(attempt, generation)) return;
      const transport = this.host.transport();
      const sameApplied = this.applied?.documentId === snapshot.documentId && this.applied.documentRevision === snapshot.documentRevision;
      const policy = this.host.expanded || (!this.map && !sameApplied) ? 'reset-origin' : 'preserve-quarter';
      const mapped = (seconds: number): number => {
        if (policy === 'reset-origin') return 0;
        const quarters = secondsToQuarters(transport.score, seconds);
        let mappedQuarters = quarters;
        for (const step of this.map?.steps ?? []) {
          mappedQuarters = step.policy === 'reset-origin' ? 0 : Math.min(mappedQuarters, step.maxQuarters[0] / step.maxQuarters[1]);
        }
        return quartersToSeconds(candidate.score, mappedQuarters);
      };
      const reset = policy === 'reset-origin' || this.map?.steps.some((step) => step.policy === 'reset-origin');
      const positionPolicy = reset ? 'reset-origin' : 'preserve-quarter';
      const position = mapped(this.positionIntent ?? transport.nominalSeconds);
      const mappedLoop = !reset && transport.loop ? [mapped(transport.loop[0]), mapped(transport.loop[1])] as const : undefined;
      const loop = mappedLoop && mappedLoop[1] > mappedLoop[0] ? mappedLoop : undefined;
      this.host.adopt(candidate, position, loop);
      if (!this.current(attempt, generation)) return;
      this.applied = attempt.target;
      this.map = undefined;
      this.positionIntent = undefined;
      this.state = Object.freeze({status: 'ready', attempt: attempt.id, requested: attempt.target, applied: this.applied,
        positionPolicy, documentCoordinates: !this.host.expanded});
      this.host.notify();
      if (!this.current(attempt, generation)) return;
      this.host.publishPosition();
      if (this.current(attempt, generation)) this.finish(attempt, Object.freeze({status: 'applied', target: attempt.target, attempt: attempt.id, positionPolicy}));
    }).catch((error: unknown) => {
      if (!this.current(attempt, generation)) return;
      this.state = Object.freeze({status: 'error', attempt: attempt.id, requested: attempt.target, applied: this.applied,
        error, documentCoordinates: false});
      this.finish(attempt, this.failed(attempt.target, error));
      this.host.notify();
    });
    return promise;
  }

  private sourceError(error: unknown): void {
    this.supersede();
    this.state = Object.freeze({status: 'error', attempt: this.serial, requested: this.requested && freezeTarget(this.requested),
      applied: this.applied, error, documentCoordinates: false});
    this.host.pause();
    this.host.notify();
  }
  private failed(target: ScoreDocumentRevision | undefined, error: unknown): ScoreDocumentApplicationResult {
    return Object.freeze({status: 'failed', target: target && freezeTarget(target), attempt: this.serial, error});
  }
  private current(attempt: Attempt, generation: number): boolean {
    return !this.disposed && this.generation === generation && this.attempt === attempt && !attempt.result;
  }
  private finish(attempt: Attempt, result: ScoreDocumentApplicationResult): void {
    if (attempt.result) return;
    attempt.result = result;
    attempt.resolve(result);
  }
  private supersede(): void {
    if (this.attempt) this.finish(this.attempt, Object.freeze({status: 'superseded', target: this.attempt.target, attempt: this.attempt.id}));
    this.attempt = undefined;
  }
  private release(unsubscribe?: () => void): void {
    try { unsubscribe?.(); } catch (error) { this.host.report(error); }
  }
}

function validTarget(target: ScoreDocumentRevision): boolean {
  return !!target && typeof target.documentId === 'string' && !!target.documentId &&
    Number.isSafeInteger(target.documentRevision) && target.documentRevision >= 0;
}
function freezeTarget(target: ScoreDocumentRevision): ScoreDocumentRevision {
  return Object.freeze({documentId: target.documentId, documentRevision: target.documentRevision});
}

// Transport positions are continuous seconds: do not quantize through the
// compatibility TimeMap inverse's 480-PPQ editing grid.
function secondsToQuarters(score: Score, seconds: number): number {
  const tempi = score.timeMap.tempi;
  let index = tempi.length - 1;
  while (index > 0 && score.timeMap.quartersToSeconds(tempi[index].atQuarters) > seconds) index--;
  const tempo = tempi[index];
  return tempo.atQuarters.toFloat() + (seconds - score.timeMap.quartersToSeconds(tempo.atQuarters)) * tempo.bpm * (tempo.unit ?? 1) / 60;
}
function quartersToSeconds(score: Score, quarters: number): number {
  const tempi = score.timeMap.tempi;
  let index = tempi.length - 1;
  while (index > 0 && tempi[index].atQuarters.toFloat() > quarters) index--;
  const tempo = tempi[index];
  return score.timeMap.quartersToSeconds(tempo.atQuarters) + (quarters - tempo.atQuarters.toFloat()) * 60 / (tempo.bpm * (tempo.unit ?? 1));
}
