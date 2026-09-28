// ============================================================================
// @webmusic/audio — root entry: the core audio model (immutable AudioClip,
// peaks, time primitives, serialize helpers).
//
// Capabilities live one subpath down; the second level picks the form:
//   @webmusic/audio/play       — decoding (mp3/wav/ogg/flac via optional WASM
//                                peers), playback, player elements, worker
//                                offload
//   @webmusic/audio/view       — waveform/spectrogram views, visualizers,
//                                <audio-view> elements
//   @webmusic/audio/analyze    — MIR analysis (key/tempo/pitch/loudness),
//                                transcription, worker offload
//   @webmusic/audio/react      — React hooks and components (optional peer)
// ============================================================================

export * from './core';
