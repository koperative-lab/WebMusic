import {
  ScoreEditError, createScorePositionMap,
  type ScoreCheckpoint, type ScoreDocumentChange, type ScoreDocumentSnapshot,
  type ScoreDraftResult, type ScoreEditCommand, type ScoreEditFailure, type ScoreEditOperation,
  type ScoreEditResult, type ScoreEditTransaction, type ScoreEditorPort, type ScoreEditorState,
  type ScoreInteractionSession, type ScoreInteractionSnapshot, type ScoreRevisionGuard,
} from '../../core/editing';
import type {Score} from '../../core/model/Score';
import type {NoteId} from '../../core/types/ids';
import {makeId} from '../../core/utils/id';
import {applyScoreOperations, sameScoreContent, snapshotScoreOperations, validateEditableScore} from '../core';

export interface ScoreEditorOptions {
  /** Default: 100 retained transactions across undo and redo. */
  readonly history?: false | {readonly limit?: number};
  /** Observer exceptions never roll back commits or prevent other observers. */
  readonly onListenerError?: (error: unknown) => void;
}

interface ContentRoot {readonly contentId: string; readonly content: Score}
interface HistoryEntry {
  readonly before: ContentRoot;
  readonly after: ContentRoot;
  readonly label: string;
  readonly operations: readonly ScoreEditOperation[];
  readonly affectedNoteIds: readonly NoteId[];
}

/** A UI-free single-document owner. It creates no player, clock, loader or DOM. */
export class ScoreEditor implements ScoreEditorPort {
  private snapshot: ScoreDocumentSnapshot;
  private publishedSnapshot: ScoreDocumentSnapshot;
  private state: ScoreEditorState;
  private savedContentId: string;
  private readonly historyLimit: number;
  private readonly historyEnabled: boolean;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private trimmedCount = 0;
  private busy = false;
  private publishing = false;
  private pendingPublication = false;
  private readonly sourceListeners = new Set<(snapshot: ScoreDocumentSnapshot) => void>();
  private readonly stateListeners = new Set<(state: ScoreEditorState) => void>();
  private readonly checkpoints = new WeakSet<ScoreCheckpoint>();
  private readonly sessions = new Set<InteractionSession>();
  private readonly onListenerError?: (error: unknown) => void;

  constructor(score: Score, options: ScoreEditorOptions = {}) {
    validateEditableScore(score);
    if (!options || typeof options !== 'object' ||
        (options.history !== undefined && options.history !== false &&
          (!options.history || typeof options.history !== 'object' || Array.isArray(options.history)))) {
      throw new ScoreEditError('invalid-command', 'Invalid editor options');
    }
    this.historyEnabled = options.history !== false;
    this.historyLimit = options.history === false ? 0 : options.history?.limit ?? 100;
    if (!Number.isSafeInteger(this.historyLimit) || (this.historyEnabled && this.historyLimit < 1)) {
      throw new ScoreEditError('invalid-command', 'History limit must be a positive safe integer; use history: false to disable it');
    }
    if (options.onListenerError !== undefined && typeof options.onListenerError !== 'function') {
      throw new ScoreEditError('invalid-command', 'onListenerError must be a function');
    }
    this.onListenerError = options.onListenerError;
    this.snapshot = Object.freeze({documentId: makeId('score-document'), documentRevision: 0,
      contentId: makeId('score-content'), content: score, status: 'ready'});
    this.savedContentId = this.snapshot.contentId;
    this.publishedSnapshot = this.snapshot;
    this.state = this.makeState();
  }

  get score(): Score { return this.snapshot.content; }
  getSnapshot(): ScoreDocumentSnapshot { return this.snapshot; }
  getState(): ScoreEditorState { return this.state; }

  subscribe(listener: (snapshot: ScoreDocumentSnapshot) => void): () => void {
    return this.listen(this.sourceListeners, listener, this.snapshot);
  }

  subscribeState(listener: (state: ScoreEditorState) => void): () => void {
    return this.listen(this.stateListeners, listener, this.state);
  }

  execute(command: ScoreEditCommand): ScoreEditResult {
    return this.run(() => {
      assertCommandEnvelope(command);
      this.checkGuard(command);
      const result = applyScoreOperations(this.score, command.operations);
      return this.acceptEdit(result.score, command.label, result.operations, result.affectedNoteIds);
    });
  }

  transaction(label: string, build: (transaction: ScoreEditTransaction) => void, guard?: ScoreRevisionGuard): ScoreEditResult {
    return this.run(() => {
      this.checkGuard(guard);
      if (typeof label !== 'string' || typeof build !== 'function') {
        throw new ScoreEditError('invalid-command', 'A transaction requires a label and synchronous callback');
      }
      const operations: ScoreEditOperation[] = [];
      let open = true;
      const transaction: ScoreEditTransaction = Object.freeze({add: (operation: ScoreEditOperation) => {
        if (!open) throw new ScoreEditError('transaction-aborted', 'Transaction callback has already returned');
        operations.push(...snapshotScoreOperations([operation]));
      }});
      try {
        const returned: unknown = build(transaction);
        if (returned && (typeof returned === 'object' || typeof returned === 'function') &&
            'then' in returned && typeof returned.then === 'function') {
          // Consume a rejected async continuation after closing the builder.
          void Promise.resolve(returned).catch(() => {});
          throw new ScoreEditError('transaction-aborted', 'Transactions cannot cross await');
        }
      } catch (error) {
        if (error instanceof ScoreEditError) throw error;
        throw new ScoreEditError('transaction-aborted', error instanceof Error ? error.message : 'Transaction callback failed');
      } finally {
        open = false;
      }
      this.assertAlive();
      const result = applyScoreOperations(this.score, operations);
      return this.acceptEdit(result.score, label, result.operations, result.affectedNoteIds);
    });
  }

  undo(guard?: ScoreRevisionGuard): ScoreEditResult { return this.travelHistory('undo', guard); }
  redo(guard?: ScoreRevisionGuard): ScoreEditResult { return this.travelHistory('redo', guard); }

  markSaved(): void {
    this.assertWritable();
    if (this.savedContentId === this.snapshot.contentId) return;
    this.savedContentId = this.snapshot.contentId;
    this.refreshState();
  }

  clearHistory(): void {
    this.assertWritable();
    if (!this.undoStack.length && !this.redoStack.length) return;
    this.undoStack = [];
    this.redoStack = [];
    this.refreshState();
  }

  createCheckpoint(): ScoreCheckpoint {
    this.assertAlive();
    const checkpoint = Object.freeze({documentId: this.snapshot.documentId,
      contentId: this.snapshot.contentId, content: this.score});
    this.checkpoints.add(checkpoint);
    return checkpoint;
  }

  restoreCheckpoint(checkpoint: ScoreCheckpoint, guard?: ScoreRevisionGuard): ScoreEditResult {
    return this.run(() => {
      this.checkGuard(guard);
      if (!checkpoint || !this.checkpoints.has(checkpoint) || checkpoint.documentId !== this.snapshot.documentId) {
        throw new ScoreEditError('invalid-checkpoint', 'Restore requires a checkpoint issued by this editor');
      }
      if (this.snapshot.contentId === checkpoint.contentId) return this.noop();
      validateEditableScore(checkpoint.content);
      this.checkNextRevision();
      const affected = Object.freeze([...new Set([...this.score.parts, ...checkpoint.content.parts]
        .flatMap((part) => part.notes.map((note) => note.id)))]);
      // External history becomes the new base; local redo must not cross it.
      this.undoStack = [];
      this.redoStack = [];
      return this.commit(checkpoint, 'restore', 'Restore checkpoint', Object.freeze([]), affected, 'reset-origin');
    });
  }

  createInteractionSession(): ScoreInteractionSession {
    this.assertWritable();
    const session = new InteractionSession(this, (value) => this.sessions.delete(value), (error) => this.report(error));
    this.sessions.add(session);
    return session;
  }

  dispose(): void {
    if (this.snapshot.status === 'disposed') return;
    this.snapshot = Object.freeze({...this.snapshot, status: 'disposed'});
    this.undoStack = [];
    this.redoStack = [];
    this.state = this.makeState();
    for (const session of [...this.sessions]) session.dispose();
    this.publish();
    // A nested dispose is published by the active publisher before clearing.
    if (!this.publishing) this.clearListeners();
  }

  private travelHistory(direction: 'undo' | 'redo', guard?: ScoreRevisionGuard): ScoreEditResult {
    return this.run(() => {
      this.checkGuard(guard);
      if (!this.historyEnabled) throw new ScoreEditError('history-disabled', 'Local history is disabled');
      const source = direction === 'undo' ? this.undoStack : this.redoStack;
      const target = direction === 'undo' ? this.redoStack : this.undoStack;
      const entry = source[source.length - 1];
      if (!entry) return this.noop();
      this.checkNextRevision();
      source.pop();
      target.push(entry);
      // Restoring a root is the history action; operations record the original
      // edit for inspection, not an instruction to replay it for undo.
      return this.commit(direction === 'undo' ? entry.before : entry.after,
        direction, entry.label, Object.freeze([]), entry.affectedNoteIds);
    });
  }

  private acceptEdit(content: Score, label: string, operations: readonly ScoreEditOperation[], affected: readonly NoteId[]): ScoreEditResult {
    this.assertAlive();
    if (sameScoreContent(this.score, content)) return this.noop();
    this.checkNextRevision();
    const before: ContentRoot = this.snapshot;
    const after = Object.freeze({contentId: makeId('score-content'), content});
    if (this.historyEnabled) {
      this.redoStack = [];
      this.undoStack.push({before, after, label, operations, affectedNoteIds: affected});
      while (this.undoStack.length > this.historyLimit) { this.undoStack.shift(); this.trimmedCount++; }
    }
    return this.commit(after, 'edit', label, operations, affected);
  }

  private commit(root: ContentRoot, origin: ScoreDocumentChange['origin'], label: string,
    operations: readonly ScoreEditOperation[], affectedNoteIds: readonly NoteId[],
    policy: 'preserve-quarter' | 'reset-origin' = 'preserve-quarter'): ScoreEditResult {
    const fromRevision = this.snapshot.documentRevision;
    const toRevision = fromRevision + 1;
    const change: ScoreDocumentChange = Object.freeze({origin, label, fromRevision, toRevision,
      operations, affectedNoteIds, positionMap: createScorePositionMap(this.snapshot.documentId,
        fromRevision, toRevision, root.content.durationQuarters, policy)});
    const snapshot: ScoreDocumentSnapshot = Object.freeze({documentId: this.snapshot.documentId,
      documentRevision: toRevision, contentId: root.contentId, content: root.content, status: 'ready', change});
    this.assertAlive();
    this.snapshot = snapshot;
    this.state = this.makeState();
    for (const session of [...this.sessions]) session.documentChanged();
    this.publish();
    return Object.freeze({status: 'committed', snapshot, change});
  }

  private noop(): ScoreEditResult { return Object.freeze({status: 'noop', snapshot: this.snapshot}); }
  private run(action: () => ScoreEditResult): ScoreEditResult {
    try { this.assertWritable(); } catch (error) { return failure(error); }
    this.busy = true;
    try { return action(); } catch (error) { return failure(error); } finally { this.busy = false; }
  }
  private checkNextRevision(): void {
    this.assertAlive();
    if (!Number.isSafeInteger(this.snapshot.documentRevision + 1)) {
      throw new ScoreEditError('invalid-command', 'Document revision limit exceeded');
    }
  }
  private checkGuard(guard?: ScoreRevisionGuard): void {
    if (guard === undefined) return;
    if (!guard || typeof guard !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(guard)) ||
        ['documentId', 'expectedRevision'].some((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(guard, key);
          return !descriptor || !('value' in descriptor) || !descriptor.enumerable;
        })) {
      throw new ScoreEditError('invalid-command', 'Revision guards require plain own data properties');
    }
    if (typeof guard.documentId !== 'string' || !Number.isSafeInteger(guard.expectedRevision) || guard.expectedRevision < 0) {
      throw new ScoreEditError('invalid-command', 'Invalid document revision guard');
    }
    if (guard.documentId !== this.snapshot.documentId) throw new ScoreEditError('document-mismatch', 'Command targets another document');
    if (guard.expectedRevision !== this.snapshot.documentRevision) throw new ScoreEditError('revision-conflict', 'Command revision is stale');
  }
  private assertAlive(): void {
    if (this.snapshot.status === 'disposed') throw new ScoreEditError('disposed', 'Editor is disposed');
  }
  private assertWritable(): void {
    this.assertAlive();
    if (this.busy || this.publishing) throw new ScoreEditError('reentrant-command', 'Commands cannot nest or run during publication');
  }
  private makeState(): ScoreEditorState {
    return Object.freeze({document: this.snapshot, dirty: this.snapshot.contentId !== this.savedContentId,
      history: Object.freeze({enabled: this.historyEnabled, limit: this.historyLimit,
        undoCount: this.undoStack.length, redoCount: this.redoStack.length, trimmedCount: this.trimmedCount,
        canUndo: this.undoStack.length > 0 && this.snapshot.status === 'ready',
        canRedo: this.redoStack.length > 0 && this.snapshot.status === 'ready'})});
  }
  private refreshState(): void { this.state = this.makeState(); this.publish(); }
  private listen<T>(set: Set<(value: T) => void>, listener: (value: T) => void, value: T): () => void {
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    if (this.snapshot.status !== 'disposed') set.add(listener);
    const wasPublishing = this.publishing;
    this.publishing = true;
    this.call(listener, value);
    this.publishing = wasPublishing;
    if (!wasPublishing && this.pendingPublication) this.publish();
    return () => { set.delete(listener); };
  }
  private publish(): void {
    this.pendingPublication = true;
    if (this.publishing) return;
    this.publishing = true;
    try {
      while (this.pendingPublication) {
        this.pendingPublication = false;
        const snapshot = this.snapshot;
        const state = this.state;
        if (snapshot !== this.publishedSnapshot) {
          this.publishedSnapshot = snapshot;
          for (const listener of [...this.sourceListeners]) {
            if (snapshot !== this.snapshot) break;
            if (this.sourceListeners.has(listener)) this.call(listener, snapshot);
          }
        }
        for (const listener of [...this.stateListeners]) {
          if (state !== this.state) break;
          if (this.stateListeners.has(listener)) this.call(listener, state);
        }
      }
    } finally {
      this.publishing = false;
      if (this.snapshot.status === 'disposed') this.clearListeners();
    }
  }
  private clearListeners(): void { this.sourceListeners.clear(); this.stateListeners.clear(); }
  private call<T>(listener: (value: T) => void, value: T): void {
    try { listener(value); } catch (error) { this.report(error); }
  }
  private report(error: unknown): void {
    try {
      if (this.onListenerError) this.onListenerError(error);
      else console.error('ScoreEditor subscriber failed', error);
    } catch (reportError) { console.error('ScoreEditor error handler failed', reportError); }
  }
}

export function createScoreEditor(score: Score, options?: ScoreEditorOptions): ScoreEditor {
  return new ScoreEditor(score, options);
}

function failure(error: unknown): ScoreEditFailure {
  return Object.freeze({status: 'failed', error: error instanceof ScoreEditError ? error :
    new ScoreEditError('invalid-command', error instanceof Error ? error.message : 'Invalid edit command')});
}

function assertCommandEnvelope(command: ScoreEditCommand): void {
  if (!command || typeof command !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(command))) {
    throw new ScoreEditError('invalid-command', 'Command must be a plain serializable envelope');
  }
  const allowed = new Set(['version', 'documentId', 'expectedRevision', 'label', 'operations']);
  for (const key of Reflect.ownKeys(command)) {
    const descriptor = Object.getOwnPropertyDescriptor(command, key)!;
    if (typeof key !== 'string' || !allowed.has(key) || !('value' in descriptor) || !descriptor.enumerable) {
      throw new ScoreEditError('invalid-command', 'Command contains unsupported fields or accessors');
    }
  }
  if (command.version !== 1 || typeof command.label !== 'string' || !Array.isArray(command.operations)) {
    throw new ScoreEditError('invalid-command', 'Command requires version 1, a label and operations');
  }
}

class InteractionSession implements ScoreInteractionSession {
  private snapshot: ScoreInteractionSnapshot;
  private readonly listeners = new Set<(snapshot: ScoreInteractionSnapshot) => void>();
  private publishing = false;
  private pending = false;
  constructor(private readonly editor: ScoreEditor, private readonly release: (session: InteractionSession) => void,
    private readonly report: (error: unknown) => void) {
    this.snapshot = Object.freeze({documentId: editor.getSnapshot().documentId,
      selectedNoteIds: Object.freeze([]), disposed: false});
  }
  getSnapshot(): ScoreInteractionSnapshot { return this.snapshot; }
  subscribe(listener: (snapshot: ScoreInteractionSnapshot) => void): () => void {
    if (typeof listener !== 'function') throw new TypeError('Listener must be a function');
    if (!this.snapshot.disposed) this.listeners.add(listener);
    const wasPublishing = this.publishing;
    this.publishing = true;
    this.call(listener, this.snapshot);
    this.publishing = wasPublishing;
    if (!wasPublishing && this.pending) this.publish();
    return () => { this.listeners.delete(listener); };
  }
  setSelection(noteIds: readonly NoteId[]): void {
    this.assertAlive();
    if (!Array.isArray(noteIds) || noteIds.some((id) => typeof id !== 'string' || !this.editor.score.getNote(id as NoteId))) {
      throw new ScoreEditError('unknown-note', 'Selection contains an unknown note');
    }
    const selectedNoteIds = Object.freeze([...new Set(noteIds)]);
    this.snapshot = Object.freeze({...this.snapshot, selectedNoteIds});
    this.publish();
  }
  preview(operations: readonly ScoreEditOperation[]): ScoreDraftResult {
    try {
      this.assertAlive();
      const base = this.editor.getSnapshot();
      const result = applyScoreOperations(base.content, operations);
      this.snapshot = Object.freeze({...this.snapshot, draft: Object.freeze({documentRevision: base.documentRevision,
        content: result.score, operations: result.operations})});
      this.publish();
      this.assertAlive();
      if (this.editor.getSnapshot().documentRevision !== base.documentRevision) {
        throw new ScoreEditError('revision-conflict', 'Draft was superseded during publication');
      }
      return Object.freeze({status: 'preview', snapshot: this.snapshot});
    } catch (error) { return failure(error); }
  }
  commitDraft(label = 'Edit notes'): ScoreEditResult {
    try { this.assertAlive(); } catch (error) { return failure(error); }
    const draft = this.snapshot.draft;
    if (!draft) return Object.freeze({status: 'noop', snapshot: this.editor.getSnapshot()});
    const command: ScoreEditCommand = {version: 1, label, documentId: this.editor.getSnapshot().documentId,
      expectedRevision: draft.documentRevision, operations: draft.operations};
    this.cancelDraft();
    try { this.assertAlive(); } catch (error) { return failure(error); }
    return this.editor.execute(command);
  }
  cancelDraft(): void {
    this.assertAlive();
    if (!this.snapshot.draft) return;
    this.snapshot = Object.freeze({documentId: this.snapshot.documentId, selectedNoteIds: this.snapshot.selectedNoteIds, disposed: false});
    this.publish();
  }
  documentChanged(): void {
    if (this.snapshot.disposed) return;
    this.snapshot = Object.freeze({documentId: this.snapshot.documentId, selectedNoteIds: Object.freeze(this.snapshot.selectedNoteIds.filter((id) => this.editor.score.getNote(id))), disposed: false});
    this.publish();
  }
  dispose(): void {
    if (this.snapshot.disposed) return;
    this.snapshot = Object.freeze({documentId: this.snapshot.documentId, selectedNoteIds: Object.freeze([]), disposed: true});
    this.release(this);
    this.publish();
  }
  private assertAlive(): void {
    if (this.snapshot.disposed || this.editor.getSnapshot().status === 'disposed') throw new ScoreEditError('disposed', 'Interaction session is disposed');
    if (this.publishing) throw new ScoreEditError('reentrant-command', 'Interaction commands cannot run during publication');
  }
  private call(listener: (snapshot: ScoreInteractionSnapshot) => void, snapshot: ScoreInteractionSnapshot): void {
    try { listener(snapshot); } catch (error) { this.report(error); }
  }
  private publish(): void {
    this.pending = true;
    if (this.publishing) return;
    this.publishing = true;
    try {
      while (this.pending) {
        this.pending = false;
        const snapshot = this.snapshot;
        for (const listener of [...this.listeners]) {
          if (snapshot !== this.snapshot) break;
          if (this.listeners.has(listener)) this.call(listener, snapshot);
        }
      }
    } finally {
      this.publishing = false;
      if (this.snapshot.disposed) this.listeners.clear();
    }
  }
}
