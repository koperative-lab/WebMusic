import {PortListeners, type PortReadiness} from './port';

/**
 * Registered source payload schemas. Kernel names them but never imports their
 * types: each domain owns its payload (DEC-017, DEC-068). A new payload needs
 * a new schema ID.
 */
export const SOURCE_SCHEMAS = Object.freeze({
  score: 'webmusic.score',
  scoreDocument: 'webmusic.score-document',
  audioClip: 'webmusic.audio-clip',
  audioDocument: 'webmusic.audio-document',
} as const);

export type SourceReadiness = 'empty' | 'loading' | 'ready' | 'error';

/** One coherent observation. `value` is present only when `readiness` is `ready`. */
export interface SourceSnapshot<T> {
  readonly revision: number;
  readonly readiness: SourceReadiness;
  readonly value?: T;
  readonly error?: unknown;
}

/** Read side of the source family, as companions see it. */
export interface SourcePort<T = unknown> {
  readonly id: string;
  readonly family: 'source';
  readonly direction: 'output';
  readonly multiplicity: 'single';
  readonly schemaId: string;
  readonly schemaVersion: number;
  readonly readiness: PortReadiness;
  snapshot(): SourceSnapshot<T>;
  /** The listener receives each committed snapshot; it is not called on subscription. */
  subscribe(listener: (snapshot: SourceSnapshot<T>) => void): () => void;
}

export interface SourcePublisherOptions {
  id?: string;
  schemaVersion?: number;
  onListenerError?: (error: unknown) => void;
}

/**
 * Owner side of a source port. Each change commits a new revision before
 * listeners run, so a reentrant read sees the newest snapshot and a stale
 * asynchronous result can be rejected by comparing revisions.
 */
export class SourcePublisher<T> implements SourcePort<T> {
  readonly id: string;
  readonly family = 'source' as const;
  readonly direction = 'output' as const;
  readonly multiplicity = 'single' as const;
  readonly schemaId: string;
  readonly schemaVersion: number;
  readonly #listeners: PortListeners<SourceSnapshot<T>>;
  #snapshot: SourceSnapshot<T> = Object.freeze({revision: 0, readiness: 'empty'});
  #disposed = false;

  constructor(schemaId: string, options: SourcePublisherOptions = {}) {
    if (typeof schemaId !== 'string' || !schemaId.trim()) throw new TypeError('Source schemaId must be a nonempty string');
    const version = options.schemaVersion ?? 1;
    if (!Number.isInteger(version) || version < 1) throw new TypeError('Port schemaVersion must be a positive integer');
    this.schemaId = schemaId;
    this.schemaVersion = version;
    this.id = options.id ?? 'source';
    this.#listeners = new PortListeners(options.onListenerError);
    Object.freeze(this);
  }

  get disposed(): boolean { return this.#disposed; }
  get readiness(): PortReadiness { return this.#disposed ? 'detached' : 'ready'; }
  get revision(): number { return this.#snapshot.revision; }
  snapshot(): SourceSnapshot<T> { return this.#snapshot; }

  subscribe(listener: (snapshot: SourceSnapshot<T>) => void): () => void {
    if (this.#disposed) throw new Error('SourcePublisher is disposed');
    return this.#listeners.add(listener);
  }

  /** Mark a replacement as pending; returns the revision a later result must still match. */
  loading(): number { return this.#commit({readiness: 'loading'}); }
  ready(value: T): number { return this.#commit({readiness: 'ready', value}); }
  fail(error: unknown): number { return this.#commit({readiness: 'error', error}); }
  clear(): number { return this.#commit({readiness: 'empty'}); }

  /** Detach every consumer. The last snapshot stays readable; no further revision is published. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#listeners.clear();
  }

  #commit(next: Omit<SourceSnapshot<T>, 'revision'>): number {
    if (this.#disposed) throw new Error('SourcePublisher is disposed');
    const snapshot = Object.freeze({...next, revision: this.#snapshot.revision + 1});
    this.#snapshot = snapshot;
    this.#listeners.emit(snapshot);
    return snapshot.revision;
  }
}
