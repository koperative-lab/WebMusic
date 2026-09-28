/**
 * Branded ID types: compile-time distinct, runtime strings, zero overhead.
 * Prevents accidentally passing a RegionId where an AudioClipId is expected.
 */
export type Brand<T, B> = T & {readonly __brand: B};

export type AudioClipId = Brand<string, 'AudioClipId'>;
export type RegionId = Brand<string, 'RegionId'>;

export const AudioClipId = (s: string) => s as AudioClipId;
export const RegionId = (s: string) => s as RegionId;
