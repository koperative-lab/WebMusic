import type {AudioClip} from '@webmusic/audio';
import type {Score} from '@webmusic/score';

interface RenderProvenance {
  score: Score;
  tempoScale: number;
  hasTail: boolean;
}

// The registry is shared by ESM/CJS or duplicate Bridge module instances in
// one JS realm. It holds neither samples nor a transport; its WeakMap key is
// only the exact immutable clip returned by renderScoreToClip. Clips moved
// across realms, copied, sliced or serialized may have different timelines
// and carry no provenance.
const REGISTRY_KEY = Symbol.for('@webmusic/bridge/render-provenance-v1');

function renderProvenance(create: boolean): WeakMap<AudioClip, RenderProvenance> | undefined {
  let registry = Reflect.get(globalThis, REGISTRY_KEY) as WeakMap<AudioClip, RenderProvenance> | undefined;
  if (registry === undefined && create) {
    registry = new WeakMap<AudioClip, RenderProvenance>();
    Object.defineProperty(globalThis, REGISTRY_KEY, {
      value: registry,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return registry;
}

export function recordRenderProvenance(
  clip: AudioClip,
  score: Score,
  tempoScale: number,
  hasTail: boolean,
): void {
  renderProvenance(true)!.set(clip, {score, tempoScale, hasTail});
}

export function assertRenderedClipAlignment(
  factory: 'createSyncedPlayback' | 'createAudioMasteredPlayback',
  score: Score,
  clip: AudioClip,
  expandRepeats: boolean | undefined = false,
): void {
  const provenance = renderProvenance(false)?.get(clip);
  if (!provenance) return;
  if (provenance.score !== score) {
    throw new RangeError(
      `${factory} cannot pair a Bridge-rendered clip with a different Score instance. ` +
        'Render this score again with renderScoreToClip(), or use an ordinary clip ' +
        'if your application owns the alignment.',
    );
  }
  if (expandRepeats) {
    throw new RangeError(
      `${factory} cannot expand repeats only in ScorePlayer for a Bridge-rendered clip: ` +
        'the score and clip would follow different timelines. Call expandRepeats(score) first, ' +
        'then renderScoreToClip(expandedScore) and pair that same expanded Score instance ' +
        'without scoreOptions.expandRepeats.',
    );
  }
  if (provenance.tempoScale !== 1) {
    throw new RangeError(
      `${factory} cannot pair a clip rendered with a tempo override: its audio seconds ` +
        'do not match the score-seconds axis. Render at the score tempo, then ' +
        'change both players with sync.setRate().',
    );
  }
  if (factory === 'createSyncedPlayback' && provenance.hasTail) {
    throw new RangeError(
      'createSyncedPlayback cannot play the tail of a clip rendered from the same score: ' +
        'the score master stops at its natural end. Use createAudioMasteredPlayback(score, clip) ' +
        'to play the complete render, or render with tailSeconds: 0.',
    );
  }
}
