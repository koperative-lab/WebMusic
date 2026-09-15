// ============================================================================
// The `webscore:envelope` announcement shared by the two elements that host an
// ADSR editor — <envelope-control> and <synth-panel>'s envelope section.
//
// Both dispatch the event, then hand the same envelope to a caller-owned
// `apply` that may be async. The subtle part is the rejection path: an apply
// that fails after the element has been disconnected, or after a newer edit has
// superseded it, must stay silent, and reporting must never itself produce an
// unhandled rejection. `isCurrent` is what each caller uses to say whether the
// call it started is still the live one.
// ============================================================================

import type { EnvelopeState } from "@webmusic/ui/envelope";

export interface EnvelopeEmit {
  /** The element the event is dispatched from. */
  host: EventTarget;
  envelope: EnvelopeState;
  apply?: (envelope: EnvelopeState) => unknown;
  /** False once this call has been superseded or the host disconnected. */
  isCurrent: () => boolean;
  reportError: (error: unknown) => void;
}

export function emitEnvelopeChange({
  host,
  envelope,
  apply,
  isCurrent,
  reportError,
}: EnvelopeEmit): void {
  host.dispatchEvent(
    new CustomEvent<EnvelopeState>("webscore:envelope", {
      detail: envelope,
      bubbles: true,
      composed: true,
    }),
  );
  if (!apply) return;
  try {
    const pending = apply(envelope);
    void Promise.resolve(pending).catch((error: unknown) => {
      if (!isCurrent()) return;
      try {
        reportError(error);
      } catch {
        // Async reporting must not create an unhandled rejection.
      }
    });
  } catch (error) {
    reportError(error);
  }
}
