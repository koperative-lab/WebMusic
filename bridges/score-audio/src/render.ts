import {createAudioClip, type AudioClip} from '@webmusic/audio';
import type {Score} from '@webmusic/score';
import {renderScoreToBuffer, type RenderOptions} from '@webmusic/score/play';

/**
 * Render a score offline into an {@link AudioClip} — a Score→Audio conversion
 * that stays a data function (DEC-068). A positive tail (the default) keeps
 * final samples after the score ends; `tailSeconds: 0` ends with the score. A
 * tempo override changes the clip's content axis relative to the score.
 */
export async function renderScoreToClip(score: Score, options?: RenderOptions): Promise<AudioClip> {
  const tempo = options?.tempo;
  if (tempo !== undefined && (!Number.isFinite(tempo) || tempo <= 0)) {
    throw new RangeError('renderScoreToClip tempo must be finite and > 0.');
  }
  const tail = options?.tailSeconds;
  if (tail !== undefined && (!Number.isFinite(tail) || tail < 0)) {
    throw new RangeError('renderScoreToClip tailSeconds must be finite and >= 0.');
  }
  const buffer = await renderScoreToBuffer(score, options);
  const channelData: Float32Array[] = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    channelData.push(buffer.getChannelData(channel));
  }
  return createAudioClip({channelData, sampleRate: buffer.sampleRate});
}
