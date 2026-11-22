import {createAudioClip, type AudioClip} from '@webmusic/audio';
import {loadClipFromUrl} from '@webmusic/audio/play';

const excerpts = new Map<number, Promise<AudioClip>>();

export function arabesqueAudioUrl(): string {
  return `${import.meta.env.BASE_URL}wav/Arabesque%20No.1.wav`;
}

/**
 * Decode the existing recording once per excerpt length and keep only its
 * opening seconds. A later session reuses the excerpt instead of downloading
 * and decoding the complete recording again, and the large decoded clip can
 * be released. A failed load is forgotten so a retry can request it again.
 */
export function loadArabesqueAudioExcerpt(endSeconds: number): Promise<AudioClip> {
  if (!Number.isFinite(endSeconds) || endSeconds <= 0) {
    return Promise.reject(new RangeError('Arabesque excerpt length must be a positive number of seconds'));
  }
  const cached = excerpts.get(endSeconds);
  if (cached) return cached;
  const pending = loadClipFromUrl(arabesqueAudioUrl())
    .then((clip) => {
      const excerpt = clip.slice(0, endSeconds);
      // slice() shares the recording's PCM buffers. Materialize the short
      // channels before caching so the complete recording can be released.
      const channelData = excerpt.channels();
      if (!channelData) throw new Error('Arabesque audio excerpt requires decoded samples');
      return createAudioClip({
        sampleRate: excerpt.sampleRate,
        channelData,
        metadata: excerpt.metadata,
        regions: excerpt.regions,
        ...(excerpt.beatGrid ? {beatGrid: excerpt.beatGrid} : {}),
      });
    })
    .catch((error: unknown) => {
      if (excerpts.get(endSeconds) === pending) excerpts.delete(endSeconds);
      throw error;
    });
  excerpts.set(endSeconds, pending);
  return pending;
}
