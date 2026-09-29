import type {AudioClip} from '@webmusic/audio';
import type {AudioClipPlayer} from '@webmusic/audio/play/headless';

/** Both factory directions use one buffer engine and group-owned loop/rate. */
export type FactoryClipOptions = Omit<
  NonNullable<ConstructorParameters<typeof AudioClipPlayer>[1]>,
  'engine' | 'mediaAdapterFactory' | 'loop' | 'rate'
> & {engine?: 'buffer'};

type FactoryName = 'createSyncedPlayback' | 'createAudioMasteredPlayback';

/** Both master directions place score zero at a finite clip position. */
export function validatedClipOffsetSeconds(value: number | undefined): number {
  const offset = value ?? 0;
  if (!Number.isFinite(offset) || offset < 0) {
    throw new RangeError('clipOffsetSeconds must be finite and >= 0.');
  }
  return offset;
}

/** Validate before either factory acquires a context or constructs a player. */
export function assertFactoryClipOptions(
  factory: FactoryName,
  clip: AudioClip,
  options: FactoryClipOptions | undefined,
): void {
  // Runtime callers can bypass the restricted TypeScript options shape.
  const input = options as
    | {engine?: unknown; mediaAdapterFactory?: unknown; loop?: unknown; rate?: unknown}
    | undefined;
  if (input?.loop !== undefined) {
    throw new RangeError(
      `${factory} does not accept clipOptions.loop: native clip looping does not expose the ` +
        'wrapped group axis. Use ScoreAudioSync.setLoop to loop both transports together.',
    );
  }
  if (input?.rate !== undefined) {
    throw new RangeError(
      `${factory} does not accept clipOptions.rate: the shared rate is owned by the ` +
        'transport group. Use ScoreAudioSync.setRate to change it on both transports.',
    );
  }
  if (input?.engine !== undefined && input.engine !== 'buffer') {
    throw new RangeError(
      `${factory} always uses the buffer engine (only it supplies the required scheduled clock); ` +
        `got engine '${String(input.engine)}'. Construct the players and ScoreAudioSync directly ` +
        'to use another clip transport.',
    );
  }
  if (input?.mediaAdapterFactory !== undefined) {
    throw new RangeError(
      `${factory} always uses the buffer engine; mediaAdapterFactory does not apply.`,
    );
  }
  if (!clip.hasSamples) {
    throw new RangeError(
      `${factory} requires a clip with decoded samples: the buffer engine cannot play ` +
        'a streaming (URL-only) clip. Decode the audio when loading it, or render a matched ' +
        'backing track with renderScoreToClip.',
    );
  }
}
