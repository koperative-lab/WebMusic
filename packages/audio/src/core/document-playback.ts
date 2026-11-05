import type {AudioClip} from './model/AudioClip';
import type {AudioSequence, AudioAssetReader} from './sequence';

export interface AudioDocumentRevision {readonly documentId: string; readonly documentRevision: number}
export interface AudioDocumentPlaybackBinding {
  readonly status: 'empty' | 'preparing' | 'ready' | 'error';
  readonly attempt: number;
  readonly requested?: AudioDocumentRevision;
  readonly applied?: AudioDocumentRevision;
  readonly positionPolicy?: 'preserve-frame' | 'reset-origin';
  readonly documentCoordinates: boolean;
  readonly error?: unknown;
}
export type AudioDocumentApplicationResult =
  | {readonly status: 'applied'; readonly target: AudioDocumentRevision; readonly attempt: number; readonly positionPolicy: 'preserve-frame' | 'reset-origin'}
  | {readonly status: 'superseded'; readonly target?: AudioDocumentRevision; readonly attempt: number}
  | {readonly status: 'failed'; readonly target?: AudioDocumentRevision; readonly attempt: number; readonly error: unknown};
export class AudioDocumentApplicationError extends Error {
  constructor(readonly code: 'unknown-revision' | 'not-ready' | 'disposed' | 'invalid-source' | 'invalid-snapshot' | 'document-disposed' | 'source-conflict', message: string) {
    super(message); this.name = 'AudioDocumentApplicationError';
  }
}
/** Applied source; publication revision is independent of document revision. */
export type AudioPlaybackSourceSnapshot =
  | {readonly kind: 'empty'; readonly clip: undefined; readonly revision: number}
  | {readonly kind: 'clip'; readonly clip: AudioClip; readonly revision: number}
  | {readonly kind: 'sequence'; readonly clip: undefined; readonly sequence: AudioSequence; readonly assets: AudioAssetReader;
      readonly revision: number; readonly documentId: string; readonly documentRevision: number};
