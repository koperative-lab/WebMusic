/**
 * Branded ID types: compile-time distinct, runtime strings, zero overhead.
 * Prevents accidentally passing a NoteId where a MeasureId is expected.
 */
export type Brand<T, B> = T & {readonly __brand: B};

export type NoteId = Brand<string, 'NoteId'>;
export type MeasureId = Brand<string, 'MeasureId'>;
export type PartId = Brand<string, 'PartId'>;
export type VoiceId = Brand<string, 'VoiceId'>;
export type ScoreId = Brand<string, 'ScoreId'>;

export const NoteId = (s: string) => s as NoteId;
export const MeasureId = (s: string) => s as MeasureId;
export const PartId = (s: string) => s as PartId;
export const VoiceId = (s: string) => s as VoiceId;
export const ScoreId = (s: string) => s as ScoreId;
