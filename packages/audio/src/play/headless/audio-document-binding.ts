import {
  AudioDocumentApplicationError, composeAudioPositionMaps, mapAudioPosition, createAudioSequence, retainAudioSequence, type AudioAssetLease,
  type AudioDocumentSource, type AudioDocumentSnapshot, type AudioPositionMap,
  type AudioDocumentRevision, type AudioDocumentPlaybackBinding, type AudioDocumentApplicationResult,
} from '../../core';
interface BindingHost {
  pause(): void;
  transport(): {sampleRate: number; seconds: number; loop: boolean | {start: number; end: number}};
  adopt(snapshot: AudioDocumentSnapshot, seconds: number, loop: boolean | {start: number; end: number}): void;
  notify(): void;
  onDetach(): void;
  report(error: unknown): void;
}

interface Attempt {
  readonly id: number;
  readonly target: AudioDocumentRevision;
  readonly promise: Promise<AudioDocumentApplicationResult>;
  readonly resolve: (result: AudioDocumentApplicationResult) => void;
  result?: AudioDocumentApplicationResult;
  lease?: AudioAssetLease;
}

/** One borrowed document attachment. No editor, graph, synth, clock or history ownership. */
export class AudioDocumentBinding {
  private source?: AudioDocumentSource;
  private unsubscribe?: () => void;
  private generation = 0;
  private serial = 0;
  private disposed = false;
  private requested?: AudioDocumentSnapshot;
  private applied?: AudioDocumentRevision;
  private map?: AudioPositionMap;
  private attempt?: Attempt;
  private positionIntent?: number;
  private stopIntent = false;
  private initialLoop?: {target: AudioDocumentRevision; value: boolean | {start: number; end: number}};
  private positionAffinity: 'left' | 'right' = 'right';
  private state: AudioDocumentPlaybackBinding = Object.freeze({status: 'empty', attempt: 0, documentCoordinates: false});

  constructor(private readonly host: BindingHost) {}
  getSource(): AudioDocumentSource | undefined { return this.source; }
  getState(): AudioDocumentPlaybackBinding { return this.state; }

  assertPlayable(): void {
    if (this.disposed) throw new AudioDocumentApplicationError('disposed', 'AudioPlayer has been disposed.');
    if (this.source && this.state.status !== 'ready') {
      throw new AudioDocumentApplicationError('not-ready', 'The requested document revision is not ready for playback.');
    }
  }

  /** Position commands during preparation remain tagged to the last applied timeline. */
  recordPositionIntent(seconds: number, stop = false): void {
    this.positionAffinity = 'right';
    if (this.source && this.state.status !== 'ready') { this.positionIntent = seconds; this.stopIntent = stop; }
  }

  recordLoopIntent(loop: boolean | {start: number; end: number}): void {
    if (!this.applied && this.requested) this.initialLoop = {target: freezeTarget(this.requested), value: loop};
  }

  setSource(source: AudioDocumentSource | undefined): void {
    if (this.disposed) throw new AudioDocumentApplicationError('disposed', 'AudioPlayer has been disposed.');
    if (source === this.source) return;
    if (source !== undefined && (!source || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function')) {
      throw new AudioDocumentApplicationError('invalid-source', 'Expected a AudioDocumentSource');
    }
    const generation = ++this.generation;
    this.supersede();
    if (generation !== this.generation || this.disposed) return;
    const previousUnsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    this.source = source;
    this.requested = undefined;
    this.map = undefined;
    this.positionIntent = undefined; this.stopIntent = false; this.positionAffinity = 'right'; this.initialLoop = undefined;
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
      if (typeof unsubscribe !== 'function') throw new AudioDocumentApplicationError('invalid-source', 'Document subscription must return cleanup');
      if (generation !== this.generation || this.disposed) this.release(unsubscribe);
      else this.unsubscribe = unsubscribe;
    } catch (error) {
      if (generation === this.generation && !this.disposed) this.sourceError(error);
    }
  }

  wait(target: AudioDocumentRevision): Promise<AudioDocumentApplicationResult> {
    if (!validTarget(target)) return Promise.resolve(this.failed(target, new AudioDocumentApplicationError('unknown-revision', 'Invalid document revision target')));
    const requested = this.requested;
    if (!requested || this.disposed || target.documentId !== requested.documentId || target.documentRevision < requested.documentRevision) {
      return Promise.resolve(Object.freeze({status: 'superseded', target: freezeTarget(target), attempt: this.serial}));
    }
    if (target.documentRevision > requested.documentRevision) {
      return Promise.resolve(this.failed(target, new AudioDocumentApplicationError('unknown-revision', 'The requested document revision has not been observed')));
    }
    if (this.attempt) return this.attempt.promise;
    return Promise.resolve(this.failed(target, this.state.error ?? new AudioDocumentApplicationError('not-ready', 'Document source is unavailable')));
  }

  retry(): Promise<AudioDocumentApplicationResult> {
    if (!this.requested || !this.source || this.disposed || this.requested.status !== 'ready') {
      return Promise.resolve(this.failed(undefined, new AudioDocumentApplicationError(this.disposed ? 'disposed' : 'not-ready', 'No document revision is available to apply')));
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

  private receive(snapshot: AudioDocumentSnapshot): void {
    try {
      if (!validTarget(snapshot) || !snapshot.content || !snapshot.assets || !['ready', 'disposed'].includes(snapshot.status)) {
        throw new AudioDocumentApplicationError('invalid-snapshot', 'Invalid Audio document snapshot');
      }
      if (snapshot.status === 'disposed') {
        const generation = this.generation, requested = this.requested;
        this.supersede();
        if (this.disposed || generation !== this.generation || requested !== this.requested) return;
        this.requested = undefined;
        this.map = undefined;
        const state: AudioDocumentPlaybackBinding = Object.freeze({status: 'empty', attempt: this.serial, applied: this.applied, documentCoordinates: false});
        this.state = state;
        this.host.pause();
        if (this.disposed || generation !== this.generation || state !== this.state) return;
        this.host.notify();
        return;
      }
      const previous = this.requested;
      if (previous?.documentId === snapshot.documentId) {
        if (snapshot.documentRevision < previous.documentRevision) return;
        if (snapshot.documentRevision === previous.documentRevision) {
          if (snapshot.content !== previous.content) throw new AudioDocumentApplicationError('invalid-snapshot', 'Content changed without a document revision');
          return;
        }
      }
      // Retain the map chain independently of editor history and failed attempts.
      const change = snapshot.change?.positionMap;
      let map: AudioPositionMap | undefined;
      if (this.applied?.documentId === snapshot.documentId && change &&
          change.documentId === snapshot.documentId && change.toRevision === snapshot.documentRevision) {
        try {
          if (change.fromRevision === this.applied.documentRevision) map = composeAudioPositionMaps(change);
          else if (this.map && previous?.documentId === snapshot.documentId && change.fromRevision === previous.documentRevision) {
            map = composeAudioPositionMaps(this.map, change);
          }
        } catch { /* Missing/invalid chains explicitly reset rather than guessing. */ }
      }
      if (this.state.status === 'ready' || this.state.status === 'empty') this.positionIntent = undefined;
      this.map = map;
      this.requested = snapshot;
      this.start(snapshot);
    } catch (error) { this.sourceError(error); }
  }

  private start(snapshot: AudioDocumentSnapshot): Promise<AudioDocumentApplicationResult> {
    const generation = this.generation;
    this.supersede();
    if (generation !== this.generation || this.disposed || this.requested !== snapshot) {
      return Promise.resolve({status: 'superseded', target: freezeTarget(snapshot), attempt: this.serial});
    }
    let resolve!: Attempt['resolve'];
    const promise = new Promise<AudioDocumentApplicationResult>((done) => { resolve = done; });
    const attempt: Attempt = {id: ++this.serial, target: freezeTarget(snapshot), promise, resolve};
    this.attempt = attempt;
    let preparationError: unknown;
    try { attempt.lease = retainAudioSequence(snapshot.content, snapshot.assets); }
    catch (error) { preparationError = error; }
    if (!this.current(attempt, generation)) {
      this.release(() => attempt.lease?.release()); attempt.lease = undefined;
      return promise;
    }
    this.state = Object.freeze({status: 'preparing', attempt: attempt.id, requested: attempt.target,
      applied: this.applied, documentCoordinates: false});
    this.host.pause();
    if (!this.current(attempt, generation)) return promise;
    this.host.notify();
    if (!this.current(attempt, generation)) return promise;
    void Promise.resolve().then(() => {
      if (!this.current(attempt, generation)) return undefined;
      if (preparationError !== undefined) throw preparationError;
      const checked = createAudioSequence(snapshot.content, snapshot.assets);
      if (checked.length !== snapshot.content.length) throw new AudioDocumentApplicationError('invalid-snapshot', 'Sequence length disagrees with its segments');
      return snapshot;
    }).then((candidate) => {
      if (!candidate || !this.current(attempt, generation)) return;
      const transport = this.host.transport();
      const sameApplied = this.applied?.documentId === snapshot.documentId && this.applied.documentRevision === snapshot.documentRevision;
      const policy = !this.map && !sameApplied ? 'reset-origin' : 'preserve-frame';
      let positionPolicy: 'preserve-frame' | 'reset-origin' = policy;
      const mapped = (seconds: number, affinity: 'left' | 'right' = 'right', playhead = false): number => {
        if (policy === 'reset-origin') return 0;
        const frame = Math.max(0, Math.round(seconds * transport.sampleRate));
        const result = this.map ? mapAudioPosition(this.map, frame, affinity) : {frame, positionPolicy, deleted: false};
        if (playhead && result.deleted) this.positionAffinity = 'left';
        if (result.positionPolicy === 'reset-origin') positionPolicy = 'reset-origin';
        return Math.min(snapshot.content.length, result.frame) / snapshot.content.sampleRate;
      };
      const position = this.stopIntent ? 0 : mapped(this.positionIntent ?? transport.seconds, this.positionAffinity, true);
      let loop: boolean | {start: number; end: number} = false;
      if (policy !== 'reset-origin' && transport.loop) {
        if (transport.loop === true) loop = true;
        else {
          const start = mapped(transport.loop.start, 'right');
          const end = mapped(transport.loop.end, 'left');
          if (end > start) loop = {start, end};
        }
      }
      if (positionPolicy === 'reset-origin') loop = false;
      if (this.initialLoop?.target.documentId === snapshot.documentId &&
          this.initialLoop.target.documentRevision === snapshot.documentRevision) loop = this.initialLoop.value;
      this.host.adopt(candidate, position, loop);
      if (!this.current(attempt, generation)) return;
      this.applied = attempt.target;
      this.map = undefined;
      this.positionIntent = undefined; this.stopIntent = false; this.initialLoop = undefined;
      this.state = Object.freeze({status: 'ready', attempt: attempt.id, requested: attempt.target, applied: this.applied,
        positionPolicy, documentCoordinates: true});
      this.host.notify();
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
    const generation = this.generation, requested = this.requested;
    this.supersede();
    if (this.disposed || generation !== this.generation || requested !== this.requested) return;
    this.state = Object.freeze({status: 'error', attempt: this.serial, requested: this.requested && freezeTarget(this.requested),
      applied: this.applied, error, documentCoordinates: false});
    this.host.pause();
    this.host.notify();
  }
  private failed(target: AudioDocumentRevision | undefined, error: unknown): AudioDocumentApplicationResult {
    return Object.freeze({status: 'failed', target: target && freezeTarget(target), attempt: this.serial, error});
  }
  private current(attempt: Attempt, generation: number): boolean {
    return !this.disposed && this.generation === generation && this.attempt === attempt && !attempt.result;
  }
  private finish(attempt: Attempt, result: AudioDocumentApplicationResult): void {
    if (attempt.result) return;
    attempt.result = result;
    attempt.resolve(result);
    try { attempt.lease?.release(); } catch (error) { this.report(error); }
    attempt.lease = undefined;
  }
  private supersede(): void {
    const attempt = this.attempt; this.attempt = undefined;
    if (attempt) this.finish(attempt, Object.freeze({status: 'superseded', target: attempt.target, attempt: attempt.id}));
  }
  private report(error: unknown): void { try { this.host.report(error); } catch { /* observer failure cannot interrupt cleanup */ } }
  private release(unsubscribe?: () => void): void {
    try { unsubscribe?.(); } catch (error) { this.report(error); }
  }
}

function validTarget(target: AudioDocumentRevision): boolean {
  return !!target && typeof target.documentId === 'string' && !!target.documentId &&
    Number.isSafeInteger(target.documentRevision) && target.documentRevision >= 0;
}
function freezeTarget(target: AudioDocumentRevision): AudioDocumentRevision {
  return Object.freeze({documentId: target.documentId, documentRevision: target.documentRevision});
}

