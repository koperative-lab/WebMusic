import type {Score} from '../../../core';
import {serializeMIDI, serializeMusicXML} from '../../../io/formats';

export type ScoreRecorderExportFormat = 'midi' | 'musicxml';

export interface ScoreRecorderDownload {
  name: string;
  data: Uint8Array | string;
  mime: string;
}

/** Serialize a take and describe the browser download without touching the DOM. */
export function prepareScoreRecorderDownload(
  score: Score,
  format: ScoreRecorderExportFormat,
): ScoreRecorderDownload {
  if (format === 'midi') {
    return {
      name: 'recording.mid',
      data: serializeMIDI(score),
      mime: 'audio/midi',
    };
  }
  return {
    name: 'recording.musicxml',
    data: serializeMusicXML(score),
    mime: 'application/vnd.recordare.musicxml+xml',
  };
}

/** Perform the browser-only download side effect for a prepared take. */
export function downloadScoreRecorderTake(score: Score, format: ScoreRecorderExportFormat): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return;
  const artifact = prepareScoreRecorderDownload(score, format);
  const blob = new Blob([artifact.data as BlobPart], {type: artifact.mime});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a') as HTMLAnchorElement;
  anchor.href = url;
  anchor.download = artifact.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
