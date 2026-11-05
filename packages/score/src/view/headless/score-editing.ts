import {
  ScoreEditError, type NoteId, type ScoreDocumentSnapshot, type ScoreDraftResult,
  type ScoreEditOperation, type ScoreEditResult, type ScoreEditorPort, type ScoreEditorState,
  type ScoreInteractionSession, type ScoreInteractionSnapshot, type ScorePlaybackSnapshot,
} from '../../core';

export interface ScoreViewEditingOptions {
  /** Mutation gestures are opt-in. Selection remains local to the session. */
  editable?: boolean;
  /** Borrow an existing same-document session; otherwise the view owns one. */
  interactionSession?: ScoreInteractionSession;
}

export interface ScoreViewEditingState {
  readonly document: ScoreDocumentSnapshot;
  readonly interaction: ScoreInteractionSnapshot;
  readonly history: ScoreEditorState['history'];
  readonly editable: boolean;
  readonly available: boolean;
  readonly error?: ScoreEditError;
}

/** View interaction only: the borrowed Core editor remains the content/history owner. */
export interface ScoreViewEditing {
  readonly editor: ScoreEditorPort;
  readonly session: ScoreInteractionSession;
  readonly state: ScoreViewEditingState;
  setEditable(editable: boolean): void;
  select(noteIds: readonly NoteId[]): void;
  preview(operations: readonly ScoreEditOperation[]): ScoreDraftResult;
  commit(label?: string): ScoreEditResult;
  cancel(): void;
  execute(label: string, operations: readonly ScoreEditOperation[]): ScoreEditResult;
  undo(): ScoreEditResult;
  redo(): ScoreEditResult;
  subscribe(listener: (state: ScoreViewEditingState) => void): () => void;
  dispose(): void;
}

export function createScoreViewEditing(editor: ScoreEditorPort, options: ScoreViewEditingOptions = {}): ScoreViewEditing {
  const document = editor.getSnapshot();
  if (document.status !== 'ready') throw new ScoreEditError('disposed', 'The document is unavailable');
  const session = options.interactionSession ?? editor.createInteractionSession();
  if (session.getSnapshot().documentId !== document.documentId || session.getSnapshot().disposed) {
    throw new ScoreEditError('document-mismatch', 'The interaction session must belong to the bound document');
  }
  const ownsSession = !options.interactionSession;
  let editable = options.editable ?? false;
  let disposed = false;
  let error: ScoreEditError | undefined;
  const listeners = new Set<(state: ScoreViewEditingState) => void>();
  let state = snapshot();
  function snapshot(): ScoreViewEditingState {
    const document = editor.getSnapshot();
    const interaction = session.getSnapshot();
    return Object.freeze({document, interaction, history: editor.getState().history, editable,
      available: !disposed && document.status === 'ready' && !interaction.disposed, ...(error ? {error} : {})});
  }
  function publish(): void {
    if (disposed) return;
    const next = state = snapshot();
    for (const listener of [...listeners]) {
      if (state !== next || disposed) break;
      if (listeners.has(listener)) {
        try { listener(next); } catch (error) { console.error('ScoreView editing subscriber failed', error); }
      }
    }
  }
  function assertAvailable(mutate = false): void {
    if (disposed || !state.available) throw new ScoreEditError('disposed', 'The editing view is unavailable');
    if (mutate && !editable) throw new ScoreEditError('invalid-command', 'Editing is disabled');
  }
  function result<T extends ScoreEditResult | ScoreDraftResult>(action: () => T): T | {readonly status: 'failed'; readonly error: ScoreEditError} {
    try {
      assertAvailable(true);
      const value = action();
      error = value.status === 'failed' ? value.error : undefined;
      publish();
      return value;
    } catch (cause) {
      const commandError = cause instanceof ScoreEditError ? cause : new ScoreEditError('invalid-command', cause instanceof Error ? cause.message : String(cause));
      error = commandError;
      publish();
      return Object.freeze({status: 'failed', error: commandError});
    }
  }
  const offDocument = editor.subscribeState(() => publish());
  const offSession = session.subscribe(() => publish());
  return {
    editor, session,
    get state() { return state; },
    setEditable(value) {
      assertAvailable();
      if (editable === value) return;
      if (!value && session.getSnapshot().draft) session.cancelDraft();
      editable = value;
      publish();
    },
    select(noteIds) { assertAvailable(); session.setSelection(noteIds); },
    preview(operations) { return result(() => session.preview(operations)); },
    commit(label) { return result(() => session.commitDraft(label)); },
    cancel() {
      if (disposed || !state.available) return;
      // Nothing to discard: publishing would redraw every surface for no change.
      if (!session.getSnapshot().draft && !error) return;
      session.cancelDraft();
      error = undefined;
      publish();
    },
    execute(label, operations) {
      return result(() => {
        const base = editor.getSnapshot();
        return editor.execute({version: 1, documentId: base.documentId, expectedRevision: base.documentRevision, label, operations});
      });
    },
    undo() { return result(() => editor.undo()); },
    redo() { return result(() => editor.redo()); },
    subscribe(listener) {
      assertAvailable();
      listeners.add(listener);
      try { listener(state); } catch (error) { console.error('ScoreView editing subscriber failed', error); }
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { offDocument(); } finally {
        try { offSession(); } finally {
          try { if (ownsSession) session.dispose(); } finally {
            // One terminal state lets borrowers observe unavailability.
            const final = state = snapshot(); const borrowers = [...listeners]; listeners.clear();
            for (const listener of borrowers) {
              try { listener(final); } catch (error) { console.error('ScoreView editing subscriber failed', error); }
            }
          }
        }
      }
    },
  };
}

/** A matching document ID alone is insufficient for transport overlays or seeking. */
export function scoreDocumentPlaybackCompatible(document: ScoreDocumentSnapshot, playback?: ScorePlaybackSnapshot): boolean {
  return document.status === 'ready' && playback?.readiness === 'ready' &&
    playback.documentBinding?.status === 'ready' && playback.documentBinding.documentCoordinates === true &&
    playback.documentId === document.documentId && playback.documentRevision === document.documentRevision;
}
