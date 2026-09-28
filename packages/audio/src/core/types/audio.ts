/** Digital-audio container/codec formats WebAudio knows how to load. */
export type AudioFormat =
  | 'wav'
  | 'aiff'
  | 'mp3'
  | 'flac'
  | 'ogg'
  | 'opus'
  | 'm4a'
  | 'aac'
  | 'webm';

/** File-tag metadata (ID3 / Vorbis comments). All fields optional. */
export interface AudioClipMetadata {
  title?: string;
  artist?: string;
  album?: string;
  /** Cover-art object URL or data URL, if extracted. */
  pictureUrl?: string;
  /** Any extra tags a reader surfaces. */
  [key: string]: unknown;
}

/** Convert a sample index to seconds at a given sample rate. */
export function samplesToSeconds(samples: number, sampleRate: number): number {
  return samples / sampleRate;
}

/** Convert seconds to a (rounded) sample index at a given sample rate. */
export function secondsToSamples(seconds: number, sampleRate: number): number {
  return Math.round(seconds * sampleRate);
}
