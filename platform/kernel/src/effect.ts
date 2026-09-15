// ============================================================================
// Effect contract shared by both families: an effect is anything with
// `createAudioNodes(context) → {input, output}`. Canonical source is
// @webaudio/play's shape — `BaseAudioContext` keeps it offline-render capable.
// @webscore/play's Effect class adds a `createAudioNodes` method to satisfy it
// structurally. Chain/insert helpers deliberately stay per-family: their
// dispose/rollback semantics differ by design.
// ============================================================================

/** A built effect sub-graph: signal enters `input`, leaves `output`. */
export interface EffectNodes {
  readonly input: AudioNode;
  readonly output: AudioNode;
  /** Live, adjustable parameters (e.g. `frequency`, `wet`) for real-time control. */
  params?: Record<string, AudioParam>;
  dispose?(): void;
}

/**
 * The structural Effect contract. The single method `createAudioNodes` lets
 * effects cross between the families by shape alone.
 */
export interface Effect {
  /** Optional label — UIs can caption controls with it. */
  label?: string;
  createAudioNodes(context: BaseAudioContext): EffectNodes;
}
