import {
  AudioEditError, makeId, type AudioFrameRange, type AudioEditFailure, type AudioDocumentSnapshot, type AudioDraftResult,
  type AudioEditOperation, type AudioEditResult, type AudioClipEditorPort, type AudioEditorState,
  type AudioInteractionSession, type AudioInteractionSnapshot, type AudioDocumentPlaybackBinding,
} from '../../core';

export interface AudioViewEditingOptions {
  /** Mutation gestures are opt-in. Selection remains local to the session. */
  editable?: boolean;
  /** Borrow an existing same-document session; otherwise the view owns one. */
  interactionSession?: AudioInteractionSession;
}

export interface AudioViewEditingState {
  readonly document: AudioDocumentSnapshot;
  readonly interaction: AudioInteractionSnapshot;
  readonly history: AudioEditorState['history'];
  readonly editable: boolean;
  readonly available: boolean;
  readonly error?: AudioEditError;
}

/** View interaction only: the borrowed Core editor remains the content/history owner. */
export interface AudioViewEditing {
  readonly editor: AudioClipEditorPort;
  readonly session: AudioInteractionSession;
  readonly state: AudioViewEditingState;
  setEditable(editable: boolean): void;
  select(range: AudioFrameRange): void;
  copy(): {readonly status: 'copied'; readonly length: number} | AudioEditFailure;
  cut(): AudioEditResult;
  paste(): AudioEditResult;
  preview(operations: readonly AudioEditOperation[]): AudioDraftResult;
  commit(label?: string): AudioEditResult;
  cancel(): void;
  execute(label: string, operations: readonly AudioEditOperation[]): AudioEditResult;
  undo(): AudioEditResult;
  redo(): AudioEditResult;
  subscribe(listener: (state: AudioViewEditingState) => void): () => void;
  dispose(): void;
}

export function createAudioViewEditing(editor: AudioClipEditorPort, options: AudioViewEditingOptions = {}): AudioViewEditing {
  const document = editor.getSnapshot();
  if (document.status !== 'ready') throw new AudioEditError('disposed', 'The document is unavailable');
  const session = options.interactionSession ?? editor.createInteractionSession();
  if (session.getSnapshot().documentId !== document.documentId || session.getSnapshot().disposed) {
    throw new AudioEditError('document-mismatch', 'The interaction session must belong to the bound document');
  }
  const ownsSession = !options.interactionSession;
  let editable = options.editable ?? false;
  let disposed = false;
  let error: AudioEditError | undefined;
  const listeners = new Set<(state: AudioViewEditingState) => void>();
  let state = snapshot();
  function snapshot(): AudioViewEditingState {
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
        try { listener(next); } catch (error) { console.error('AudioView editing subscriber failed', error); }
      }
    }
  }
  function assertAvailable(mutate = false): void {
    if (disposed || !state.available) throw new AudioEditError('disposed', 'The editing view is unavailable');
    if (mutate && !editable) throw new AudioEditError('invalid-command', 'Editing is disabled');
  }
  function result<T extends AudioEditResult | AudioDraftResult>(action: () => T): T | {readonly status: 'failed'; readonly error: AudioEditError} {
    try {
      assertAvailable(true);
      const value = action();
      error = value.status === 'failed' ? value.error : undefined;
      publish();
      return value;
    } catch (cause) {
      const commandError = cause instanceof AudioEditError ? cause : new AudioEditError('invalid-command', cause instanceof Error ? cause.message : String(cause));
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
    select(range) { assertAvailable(); session.setSelection(range); },
    copy() {
      try {
        assertAvailable();
        const clipboard = editor.copy(session.getSnapshot().selection);
        try { return {status: 'copied', length: clipboard.content.length}; }
        finally { clipboard.release(); }
      } catch (cause) { return {status: 'failed', error: cause instanceof AudioEditError ? cause : new AudioEditError('invalid-command', String(cause))}; }
    },
    cut() { return result(() => editor.cut(session.getSnapshot().selection)); },
    paste() { return result(() => editor.paste(session.getSnapshot().selection.startFrame, {rightId: makeId('segment')})); },
    preview(operations) { return result(() => session.preview(operations)); },
    commit(label) { return result(() => session.commitDraft(label)); },
    cancel() {
      if (disposed || !state.available) return;
      // A revision change already discarded the draft; do not nest a session
      // command when a subscriber cancels during that publication.
      if (session.getSnapshot().draft) session.cancelDraft();
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
      try { listener(state); } catch (error) { console.error('AudioView editing subscriber failed', error); }
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { offDocument(); } finally {
        try { offSession(); } finally {
          try { if (ownsSession) session.dispose(); } finally { state = snapshot(); listeners.clear(); }
        }
      }
    },
  };
}

/** A matching document ID alone is insufficient for transport overlays or seeking. */
export function audioDocumentPlaybackCompatible(document: AudioDocumentSnapshot, binding?: AudioDocumentPlaybackBinding): boolean {
  return document.status === 'ready' && binding?.status === 'ready' && binding.documentCoordinates === true &&
    binding.applied?.documentId === document.documentId && binding.applied.documentRevision === document.documentRevision;
}
