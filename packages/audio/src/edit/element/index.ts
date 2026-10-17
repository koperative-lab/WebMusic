export {
  AudioDocumentElement, defineAudioDocumentElement,
  type AudioDocumentLoadResult, type AudioDocumentStateDetail, type AudioDocumentStatus,
} from './audio-document';
export type {AudioDocumentLoader, AudioDocumentLoadOptions} from './internal/audio-document-loader';
import {defineAudioDocumentElement} from './audio-document';
/** Register the nonvisual Audio editing declaration. */
export function defineAllAudioElements(): void { defineAudioDocumentElement(); }
