import type {AudioClip, AudioFormat} from '../../../core';
import {loadClipFromUrl} from '../../../play/api/load';

/** Limits forwarded to the existing decoder; no context or streaming source. */
export interface AudioDocumentLoadOptions {
  readonly maxInputBytes?: number;
  readonly maxDecodedFrames?: number;
  readonly maxDecodedBytes?: number;
  readonly maxChannels?: number;
  readonly timeoutMs?: number;
}

export type AudioDocumentLoader = (url: string, options: AudioDocumentLoadOptions & {
  readonly signal: AbortSignal;
  readonly format?: AudioFormat;
}) => Promise<AudioClip>;

/** The only reviewed Edit-to-Play import: the existing bounded, decoded loader. */
export const loadAudioDocument: AudioDocumentLoader = (url, options) =>
  loadClipFromUrl(url, {...options, streaming: false});
