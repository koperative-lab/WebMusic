import type {Score} from './model/Score';

/** One sounding occurrence; repeated notes and equal pitches have distinct IDs. */
export interface ScorePlaybackNote {
  readonly occurrenceId: string;
  readonly noteId: string;
  readonly partId: string;
  /** Sounding MIDI pitch, including instrument transposition. */
  readonly midi: number;
  readonly nominalStartSeconds: number;
  readonly nominalEndSeconds: number;
}

export type ScorePlaybackReadiness = 'empty' | 'loading' | 'ready' | 'unavailable' | 'error' | 'disposed';
export type ScorePlaybackState = 'stopped' | 'starting' | 'playing' | 'paused' | 'ended';

export interface ScoreDocumentRevision {
  readonly documentId: string;
  readonly documentRevision: number;
}

/** Requested content and the exact revision adopted by one native player. */
export interface ScoreDocumentPlaybackBinding {
  readonly status: 'empty' | 'preparing' | 'ready' | 'error';
  readonly attempt: number;
  readonly requested?: ScoreDocumentRevision;
  readonly applied?: ScoreDocumentRevision;
  readonly positionPolicy?: 'preserve-quarter' | 'reset-origin';
  /** True only for a ready, current, unexpanded authored document. */
  readonly documentCoordinates: boolean;
  readonly error?: unknown;
}

export type ScoreDocumentApplicationResult =
  | {readonly status: 'applied'; readonly target: ScoreDocumentRevision; readonly attempt: number; readonly positionPolicy: 'preserve-quarter' | 'reset-origin'}
  | {readonly status: 'superseded'; readonly target?: ScoreDocumentRevision; readonly attempt: number}
  | {readonly status: 'failed'; readonly target?: ScoreDocumentRevision; readonly attempt: number; readonly error: unknown};

export class ScoreDocumentApplicationError extends Error {
  constructor(readonly code: 'unknown-revision' | 'not-ready' | 'disposed' | 'invalid-source' | 'invalid-snapshot' | 'document-disposed' | 'source-conflict', message: string) {
    super(message);
    this.name = 'ScoreDocumentApplicationError';
  }
}

/** A coherent, immutable observation of one playback owner. */
export interface ScorePlaybackSnapshot {
  /** Monotonic publication revision, scoped to this source. */
  readonly revision: number;
  /** Changes when the selected source is replaced or becomes unavailable. */
  readonly sourceRevision: number;
  readonly readiness: ScorePlaybackReadiness;
  readonly state: ScorePlaybackState;
  readonly score?: Score;
  /** Unscaled score coordinates; null means that this capability is unavailable. */
  readonly nominalSeconds: number | null;
  readonly nominalDurationSeconds: number | null;
  readonly transportSeconds: number | null;
  readonly transportDurationSeconds: number | null;
  readonly rate: number | null;
  readonly activeNotes: readonly ScorePlaybackNote[];
  readonly error?: unknown;
  /** Applied document identity; absent for independent static playback. */
  readonly documentId?: string;
  readonly documentRevision?: number;
  readonly documentBinding?: ScoreDocumentPlaybackBinding;
}

/**
 * Borrowed, UI-independent playback observation. Subscribing synchronously
 * delivers the initial snapshot and then ordered changes. A reentrant mutation
 * supersedes an older pending notification; callbacks never receive a lower
 * revision after a higher one. Unsubscribing does not stop/dispose the owner.
 */
export interface ScorePlaybackSource {
  snapshot(): ScorePlaybackSnapshot;
  subscribe(listener: (snapshot: ScorePlaybackSnapshot) => void): () => void;
  /** Optional command capability, explicitly in unscaled score seconds. */
  seekNominal?(seconds: number): Promise<void>;
}

/** Observe the same source from Headless, framework or custom UI code. */
export function observeScorePlayback(
  source: ScorePlaybackSource,
  listener: (snapshot: ScorePlaybackSnapshot) => void,
): () => void {
  let revision = -1;
  let active = true;
  const unsubscribe = source.subscribe((snapshot) => {
    if (!active || snapshot.revision < revision) return;
    revision = snapshot.revision;
    listener(snapshot);
  });
  return () => {
    if (!active) return;
    active = false;
    unsubscribe();
  };
}
