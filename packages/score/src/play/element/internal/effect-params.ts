// ============================================================================
// Display ranges and units for the named parameters an `Effect` exposes.
//
// A headless `EffectNode` reports each param's current value but not the range
// a knob should sweep, so every element that renders effect params — the
// standalone <effect-control> and <synth-panel>'s effects section — reads the
// sweep from here. Unknown names fall back to a plain 0…1.
// ============================================================================

export const PARAM_RANGE: Readonly<Record<string, [number, number, number]>> = {
  frequency: [20, 12_000, 1],
  Q: [0.1, 20, 0.1],
  gain: [0, 1, 0.01],
  pan: [-1, 1, 0.01],
  wet: [0, 1, 0.01],
  dry: [0, 1, 0.01],
  time: [0, 1, 0.01],
  feedback: [0, 0.95, 0.01],
  rate: [0.1, 12, 0.1],
  depth: [0, 1, 0.01],
  threshold: [-60, 0, 1],
  ratio: [1, 20, 0.5],
};

export const PARAM_UNIT: Readonly<Record<string, string>> = {
  frequency: "Hz",
  rate: "Hz",
  threshold: "dB",
};
