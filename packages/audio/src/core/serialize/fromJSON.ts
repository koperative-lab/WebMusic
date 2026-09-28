import {AudioClip, type AudioClipJSON} from '../model/AudioClip';
import {Region} from '../model/Region';
import {BeatGrid} from '../time/BeatGrid';

/**
 * Rebuild an {@link AudioClip} from its JSON (as produced by `clip.toJSON()`).
 *
 * The JSON intentionally carries NO samples (they are large + transferable, not
 * serializable), so pass the per-channel `Float32Array`s alongside — e.g. the
 * arrays a decode worker transferred back. Omit `channels` to rebuild a
 * streaming clip (samples loaded lazily by the player from `sourceUrl`).
 */
export function clipFromJSON(json: AudioClipJSON, channels?: Float32Array[]): AudioClip {
  return new AudioClip({
    id: json.id,
    sampleRate: json.sampleRate,
    ...(channels && channels.length > 0
      ? {channelData: channels}
      : {length: json.length, numberOfChannels: json.numberOfChannels}),
    metadata: json.metadata,
    regions: json.regions.map((r) => Region.fromJSON(r)),
    ...(json.beatGrid ? {beatGrid: BeatGrid.fromJSON(json.beatGrid)} : {}),
    ...(json.sourceUrl !== undefined ? {sourceUrl: json.sourceUrl} : {}),
    ...(!channels?.length && json.sourceOffsetSeconds !== undefined
      ? {sourceOffsetSeconds: json.sourceOffsetSeconds} : {}),
  });
}
