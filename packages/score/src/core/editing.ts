import {Score} from './model/Score';
import {Duration} from './primitives/Duration';
import {Rational} from './primitives/Rational';
import type {NoteId, PartId, VoiceId} from './types/ids';
import type {Alter, Step} from './types/pitch';

/** Exact, reduced quarters. No float or legacy tick conversion at the edit boundary. */
export type ScoreQuarterValue = readonly [number, number];

// Each length has at most one spelling here: base * (1, 3/2 or 7/4) keeps odd factors 1, 3 and 7 distinct.
const NOTATION_DURATIONS = [4, 2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 16]
  .flatMap((base) => [0, 1, 2].map((dots) => new Duration({base, dots})));

/**
 * The staff-entry spelling (whole through 64th base, zero to two dots, no
 * tuplet) of an exact quarter length, or undefined when none exists. Shared
 * by Edit operations and the staff input controller.
 * @internal
 */
export function spellNotationDuration(quarters: Rational): Duration | undefined {
  return NOTATION_DURATIONS.find((duration) => duration.quarters.eq(quarters));
}

export interface ScoreNoteInput {
  readonly id: NoteId;
  readonly partId: PartId;
  readonly pitch: {readonly step: Step; readonly alter: Alter; readonly octave: number};
  readonly onsetQuarters: ScoreQuarterValue;
  readonly durationQuarters: ScoreQuarterValue;
  readonly voice: VoiceId;
  readonly velocity?: number;
}

/** Authored duration spelling; staff entry supports whole through 64th notes. */
export interface ScoreNotationDuration {
  readonly base: ScoreQuarterValue;
  readonly dots?: number;
}

/** One measure-local, monophonic voice entry. Null pitch writes a real rest. */
export interface ScoreNotationEntry {
  readonly id: NoteId;
  readonly partId: PartId;
  readonly voice: VoiceId;
  readonly staff?: number;
  readonly onsetQuarters: ScoreQuarterValue;
  readonly duration: ScoreNotationDuration;
  readonly pitch: ScoreNoteInput['pitch'] | null;
  readonly velocity?: number;
}

export type ScoreEditOperation =
  | {readonly type: 'enter-notation'; readonly entry: ScoreNotationEntry}
  | {readonly type: 'insert-notes'; readonly notes: readonly ScoreNoteInput[]}
  | {readonly type: 'delete-notes'; readonly noteIds: readonly NoteId[]}
  | {readonly type: 'move-notes'; readonly noteIds: readonly NoteId[]; readonly deltaQuarters: ScoreQuarterValue}
  | {readonly type: 'resize-notes'; readonly noteIds: readonly NoteId[]; readonly durationQuarters: ScoreQuarterValue}
  | {readonly type: 'transpose-notes'; readonly noteIds: readonly NoteId[]; readonly semitones: number}
  | {readonly type: 'set-velocity'; readonly noteIds: readonly NoteId[]; readonly velocity: number | null}
  | {readonly type: 'quantize-notes'; readonly noteIds: readonly NoteId[]; readonly grid?: ScoreQuarterValue; readonly origin?: ScoreQuarterValue; readonly target?: 'onset' | 'duration' | 'both'};

export interface ScoreRevisionGuard {
  readonly documentId: string;
  readonly expectedRevision: number;
}

export interface ScoreEditCommand extends ScoreRevisionGuard {
  readonly version: 1;
  readonly label: string;
  readonly operations: readonly ScoreEditOperation[];
}

export type ScoreEditErrorCode =
  | 'invalid-command' | 'invalid-score' | 'unknown-note' | 'unknown-part'
  | 'duplicate-id' | 'unsupported-structure' | 'revision-conflict'
  | 'document-mismatch' | 'disposed' | 'reentrant-command' | 'history-disabled'
  | 'invalid-checkpoint' | 'transaction-aborted';

export class ScoreEditError extends Error {
  constructor(readonly code: ScoreEditErrorCode, message: string) {
    super(message);
    this.name = 'ScoreEditError';
  }
}

/** A serializable map; sequential clamps deliberately preserve lost-position information. */
export interface ScorePositionMap {
  readonly documentId: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly steps: readonly {
    readonly policy: 'preserve-quarter' | 'reset-origin';
    readonly maxQuarters: ScoreQuarterValue;
  }[];
}

export interface ScoreMappedPosition {
  readonly quarters: Rational;
  readonly clamped: boolean;
  readonly positionPolicy: 'preserve-quarter' | 'reset-origin';
}

export function createScorePositionMap(
  documentId: string, fromRevision: number, toRevision: number, extent: Rational,
  policy: 'preserve-quarter' | 'reset-origin' = 'preserve-quarter',
): ScorePositionMap {
  if (!documentId || !Number.isSafeInteger(fromRevision) || fromRevision < 0 ||
      !Number.isSafeInteger(toRevision) || toRevision <= fromRevision ||
      !(extent instanceof Rational) || extent.lt(Rational.ZERO) ||
      !['preserve-quarter', 'reset-origin'].includes(policy)) {
    throw new ScoreEditError('invalid-command', 'Invalid document position map');
  }
  return Object.freeze({documentId, fromRevision, toRevision, steps: Object.freeze([
    Object.freeze({policy, maxQuarters: Object.freeze(extent.toJSON())}),
  ])});
}

/** Compose a continuous revision chain; no history owner or unbounded log is required. */
export function composeScorePositionMaps(...maps: readonly ScorePositionMap[]): ScorePositionMap {
  if (!maps.length) throw new ScoreEditError('invalid-command', 'A position map chain cannot be empty');
  for (const [index, map] of maps.entries()) {
    validatePositionMap(map);
    if (map.documentId !== maps[0].documentId || (index && maps[index - 1].toRevision !== map.fromRevision)) {
      throw new ScoreEditError('revision-conflict', 'Position maps must belong to one continuous document revision chain');
    }
  }
  // These maps only preserve-and-clamp or reset. Compact their composition so
  // bindings can retain it independently of a bounded undo stack.
  const reset = maps.some((map) => map.steps.some((step) => step.policy === 'reset-origin'));
  const extent = maps.flatMap((map) => map.steps).reduce<Rational | undefined>((minimum, step) => {
    const value = Rational.from(step.maxQuarters);
    return !minimum || value.lt(minimum) ? value : minimum;
  }, undefined)!;
  return createScorePositionMap(maps[0].documentId, maps[0].fromRevision, maps[maps.length - 1].toRevision,
    extent, reset ? 'reset-origin' : 'preserve-quarter');
}

export function mapScorePosition(map: ScorePositionMap, position: Rational): ScoreMappedPosition {
  validatePositionMap(map);
  if (!(position instanceof Rational) || position.lt(Rational.ZERO)) {
    throw new ScoreEditError('invalid-command', 'Position must be nonnegative rational quarters');
  }
  let quarters = position;
  let clamped = false;
  let positionPolicy: ScoreMappedPosition['positionPolicy'] = 'preserve-quarter';
  for (const step of map.steps) {
    if (step.policy === 'reset-origin') {
      quarters = Rational.ZERO;
      clamped = false;
      positionPolicy = 'reset-origin';
    } else if (quarters.gt(Rational.from(step.maxQuarters))) {
      quarters = Rational.from(step.maxQuarters);
      clamped = true;
    }
  }
  return Object.freeze({quarters, clamped, positionPolicy});
}

function validatePositionMap(map: ScorePositionMap): void {
  if (!map || typeof map.documentId !== 'string' || !map.documentId ||
      !Number.isSafeInteger(map.fromRevision) || map.fromRevision < 0 ||
      !Number.isSafeInteger(map.toRevision) || map.toRevision <= map.fromRevision ||
      !Array.isArray(map.steps) || !map.steps.length) {
    throw new ScoreEditError('invalid-command', 'Invalid document position map');
  }
  for (const step of map.steps) {
    if (!step || !['preserve-quarter', 'reset-origin'].includes(step.policy) ||
        !Array.isArray(step.maxQuarters) || step.maxQuarters.length !== 2 ||
        !Number.isSafeInteger(step.maxQuarters[0]) || !Number.isSafeInteger(step.maxQuarters[1]) ||
        step.maxQuarters[0] < 0 || step.maxQuarters[1] <= 0) {
      throw new ScoreEditError('invalid-command', 'Invalid position map step');
    }
  }
}

export interface ScoreDocumentChange {
  readonly origin: 'edit' | 'undo' | 'redo' | 'restore';
  readonly label: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly operations: readonly ScoreEditOperation[];
  readonly affectedNoteIds: readonly NoteId[];
  readonly positionMap: ScorePositionMap;
}

export interface ScoreDocumentSnapshot {
  readonly documentId: string;
  readonly documentRevision: number;
  readonly contentId: string;
  readonly content: Score;
  readonly status: 'ready' | 'disposed';
  /** Last content transition; absent on the initial revision. */
  readonly change?: ScoreDocumentChange;
}

/** Nonvisual read-only input for future Play/View bindings. */
export interface ScoreDocumentSource {
  getSnapshot(): ScoreDocumentSnapshot;
  /** Registers before synchronously delivering the current snapshot. */
  subscribe(listener: (snapshot: ScoreDocumentSnapshot) => void): () => void;
}

/** Check the nonvisual Score port, including its current domain snapshot. */
export function isScoreDocumentSource(value: unknown): value is ScoreDocumentSource {
  try {
    if (!value || typeof value !== 'object') return false;
    const source = value as Partial<ScoreDocumentSource>;
    if (typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') return false;
    const snapshot = source.getSnapshot();
    return Boolean(snapshot && typeof snapshot.documentId === 'string' && snapshot.documentId &&
      typeof snapshot.contentId === 'string' && snapshot.contentId &&
      Number.isSafeInteger(snapshot.documentRevision) && snapshot.documentRevision >= 0 &&
      (snapshot.status === 'ready' || snapshot.status === 'disposed') && snapshot.content instanceof Score);
  } catch { return false; }
}

export interface ScoreEditorState {
  readonly document: ScoreDocumentSnapshot;
  readonly dirty: boolean;
  readonly history: {
    readonly enabled: boolean;
    readonly limit: number;
    readonly undoCount: number;
    readonly redoCount: number;
    readonly trimmedCount: number;
    readonly canUndo: boolean;
    readonly canRedo: boolean;
  };
}

export type ScoreEditFailure = {readonly status: 'failed'; readonly error: ScoreEditError};
export type ScoreEditResult =
  | {readonly status: 'committed'; readonly snapshot: ScoreDocumentSnapshot; readonly change: ScoreDocumentChange}
  | {readonly status: 'noop'; readonly snapshot: ScoreDocumentSnapshot}
  | ScoreEditFailure;

export interface ScoreEditTransaction {
  /** Captured defensively at add-time; unavailable after the callback returns. */
  add(operation: ScoreEditOperation): void;
}

export interface ScoreCheckpoint {
  readonly documentId: string;
  readonly contentId: string;
  readonly content: Score;
}

export interface ScoreInteractionSnapshot {
  /** The editor owning this session; consumers reject a foreign session. */
  readonly documentId: string;
  readonly selectedNoteIds: readonly NoteId[];
  readonly disposed: boolean;
  readonly draft?: {
    readonly documentRevision: number;
    readonly content: Score;
    readonly operations: readonly ScoreEditOperation[];
  };
}

export type ScoreDraftResult = {readonly status: 'preview'; readonly snapshot: ScoreInteractionSnapshot} | ScoreEditFailure;

export interface ScoreInteractionSession {
  getSnapshot(): ScoreInteractionSnapshot;
  subscribe(listener: (snapshot: ScoreInteractionSnapshot) => void): () => void;
  setSelection(noteIds: readonly NoteId[]): void;
  preview(operations: readonly ScoreEditOperation[]): ScoreDraftResult;
  commitDraft(label?: string): ScoreEditResult;
  cancelDraft(): void;
  dispose(): void;
}

/** Commands are separate from Play; possession of a read source grants no mutation authority. */
export interface ScoreEditorPort extends ScoreDocumentSource {
  getState(): ScoreEditorState;
  subscribeState(listener: (state: ScoreEditorState) => void): () => void;
  execute(command: ScoreEditCommand): ScoreEditResult;
  transaction(label: string, build: (transaction: ScoreEditTransaction) => void, guard?: ScoreRevisionGuard): ScoreEditResult;
  undo(guard?: ScoreRevisionGuard): ScoreEditResult;
  redo(guard?: ScoreRevisionGuard): ScoreEditResult;
  markSaved(): void;
  clearHistory(): void;
  createCheckpoint(): ScoreCheckpoint;
  restoreCheckpoint(checkpoint: ScoreCheckpoint, guard?: ScoreRevisionGuard): ScoreEditResult;
  createInteractionSession(): ScoreInteractionSession;
}

/** Editing consumers additionally require the complete command/session port. */
export function isScoreEditorPort(value: unknown): value is ScoreEditorPort {
  if (!isScoreDocumentSource(value)) return false;
  try {
    const editor = value as Partial<ScoreEditorPort>;
    return (['getState', 'subscribeState', 'execute', 'transaction', 'undo', 'redo',
      'markSaved', 'clearHistory', 'createCheckpoint', 'restoreCheckpoint',
      'createInteractionSession'] as const).every((key) => typeof editor[key] === 'function');
  } catch { return false; }
}
