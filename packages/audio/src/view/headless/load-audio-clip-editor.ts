import type {AudioClip, AudioFormat} from '../../core';
import {loadClipFromUrl} from '../../play/api/load';
import {createAudioClipEditor, type AudioClipEditor, type AudioClipEditorOptions} from './audio-clip-editor';

/** Limits forwarded to the decoder; there is no context or streaming source. */
export interface AudioClipEditorLoadLimits {
  readonly maxInputBytes?: number;
  readonly maxDecodedFrames?: number;
  readonly maxDecodedBytes?: number;
  readonly maxChannels?: number;
  readonly timeoutMs?: number;
}

/** Replaces the default decoded loader, e.g. to decode natively with a borrowed AudioContext. */
export type AudioClipEditorLoader = (url: string, options: AudioClipEditorLoadLimits & {
  readonly signal?: AbortSignal;
  readonly format?: AudioFormat;
}) => Promise<AudioClip>;

/** URL loading options plus the editor's history, processing and listener options. */
export interface LoadAudioClipEditorOptions extends Omit<AudioClipEditorOptions, 'assets'>, AudioClipEditorLoadLimits {
  readonly format?: AudioFormat;
  readonly signal?: AbortSignal;
  readonly loader?: AudioClipEditorLoader;
}

const FORMATS = new Set(['wav', 'aiff', 'mp3', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'webm']);

/** The default loader decodes the whole file without streaming or an implicit AudioContext. */
const defaultLoader: AudioClipEditorLoader = (url, options) => loadClipFromUrl(url, {...options, streaming: false});

/**
 * Fetch and decode one audio file, then create the editor that owns it. The
 * caller owns the returned editor: assign it to `<audio-view>` / `<audio-player>`
 * through `.editor` and call `dispose()` when the document is no longer needed.
 *
 * Rejects with the loader's error (including an `AbortError` from `signal`)
 * and creates no editor in that case.
 */
export async function loadAudioClipEditor(url: string, options: LoadAudioClipEditorOptions = {}): Promise<AudioClipEditor> {
  const {format, signal, loader, maxInputBytes, maxDecodedFrames, maxDecodedBytes, maxChannels, timeoutMs, ...editorOptions} = options;
  if (format !== undefined && !FORMATS.has(format)) throw new TypeError(`Unsupported Audio format: ${String(format)}`);
  const limits = {maxInputBytes, maxDecodedFrames, maxDecodedBytes, maxChannels, timeoutMs};
  const defined = Object.fromEntries(Object.entries(limits).filter(([, value]) => value !== undefined)) as AudioClipEditorLoadLimits;
  const clip = await (loader ?? defaultLoader)(url, {...defined, ...(signal ? {signal} : {}), ...(format ? {format} : {})});
  signal?.throwIfAborted();
  return createAudioClipEditor(clip, editorOptions);
}
