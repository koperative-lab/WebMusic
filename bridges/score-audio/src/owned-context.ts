/** Contexts allocated by a playback factory belong to its returned sync. */
type OperationErrorObserver = (operation: string, error: unknown) => void;
const ownedContexts = new WeakMap<object, {
  context: AudioContext;
  onOperationError?: OperationErrorObserver;
}>();

export function ownContext(owner: object, context: AudioContext, onOperationError?: OperationErrorObserver): void {
  ownedContexts.set(owner, {context, onOperationError});
}

export function releaseOwnedContext(owner: object): void {
  const owned = ownedContexts.get(owner);
  if (!owned) return;
  // Delete before calling external code, so re-entrant disposal is harmless.
  ownedContexts.delete(owner);
  closeContext(owned.context, owned.onOperationError);
}

export function closeContext(context: AudioContext, onOperationError?: OperationErrorObserver): void {
  const report = (error: unknown) => {
    try {
      onOperationError?.('context.close', error);
    } catch {
      // An observer cannot replace the original construction/disposal error.
    }
  };
  try {
    void context.close().catch(report);
  } catch (error) {
    report(error);
  }
}
