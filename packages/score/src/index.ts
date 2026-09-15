// ============================================================================
// @webmusic/score — root entry: the core score model (immutable Score,
// builders, primitives, query/transform/serialize helpers).
//
// Capabilities live one subpath down; the second level picks the form:
//   @webmusic/score/io         — parse / serialize / load (MIDI, MusicXML,
//                                MXL, ABC), plus worker offload
//   @webmusic/score/view       — stateless layout and projection helpers
//   @webmusic/score/play       — SFZ, recording conversion, offline render
//   @webmusic/score/analyze    — stateless key/chord/motif analysis
//   /headless, /render, /drivers, /element and /worker-* select their forms
//   @webmusic/score/react      — React hooks and components (optional peer)
// ============================================================================

export * from './core';
