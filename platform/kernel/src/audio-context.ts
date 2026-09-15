// ============================================================================
// SSR-safe AudioContext construction shared by both families. Only the
// constructor lookup is common; ownership, liveness validation and
// close-on-dispose semantics deliberately stay in each consumer (they differ
// by design between the score and audio families).
// ============================================================================

type GlobalWithLegacyAudio = typeof globalThis & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

/**
 * The runtime AudioContext constructor (standard, else legacy
 * `webkitAudioContext`); `undefined` when Web Audio is absent (SSR / Node).
 */
export function getAudioContextConstructor(): (typeof AudioContext) | undefined {
  const scope = globalThis as GlobalWithLegacyAudio;
  return scope.AudioContext ?? scope.webkitAudioContext;
}

/**
 * Construct an AudioContext, throwing `missingMessage` when Web Audio is
 * unavailable. Calls the constructor with no argument when `options` is
 * omitted, preserving `arguments.length`-sensitive test fakes.
 */
export function createWebAudioContext(missingMessage: string, options?: AudioContextOptions): AudioContext {
  const AudioCtor = getAudioContextConstructor();
  if (!AudioCtor) throw new Error(missingMessage);
  return options === undefined ? new AudioCtor() : new AudioCtor(options);
}
