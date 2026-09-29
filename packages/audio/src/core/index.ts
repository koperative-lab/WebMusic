// ============================================================================
// @webmusic/audio — immutable model, time mapping, peaks types and events.
// Zero dependencies. The shared foundation every other @webmusic/audio/* package
// builds on (mirrors the role of @webscore/core).
// ============================================================================

// Model
export {
  AudioClip,
  createAudioClip,
  type AudioClipInit,
  type AudioClipJSON,
} from './model/AudioClip';
export {Region, createRegion, type RegionData} from './model/Region';
export {
  ClipEditSession,
  createClipEditSession,
  applyOp,
  type ClipEditDescriptor,
} from './model/ClipEditSession';

// Time
export {BeatGrid, type BeatGridData} from './time/BeatGrid';
export {beatGridMapping, type TimelineMapping} from './time/timeline-mapping';

// Peaks (type + readers + BBC waveform-data interop)
export {
  type AudioPeaks,
  type PeaksLevel,
  peakCount,
  readPeak,
  peaksLevelForResolution,
  peaksFromWaveformData,
  peaksToWaveformData,
  type WaveformDataJSON,
} from './peaks/AudioPeaks';

// Events
export {EventEmitter} from './events/EventEmitter';

// Serialization
export {clipFromJSON} from './serialize/fromJSON';

// Types
export {AudioClipId, RegionId, type Brand} from './types/ids';
export {
  type AudioFormat,
  type AudioClipMetadata,
  samplesToSeconds,
  secondsToSamples,
} from './types/audio';

// Utilities
export {makeId} from './utils/id';
export {invariant, clamp} from './utils/invariants';
