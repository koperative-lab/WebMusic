import type {Score, ScorePlaybackSource} from '../../core';

export type AnalysisSeekOutcome =
  | {readonly status: 'committed' | 'superseded'; readonly nominalSeconds: number | null}
  | {readonly status: 'failed'; readonly nominalSeconds: number | null; readonly error: unknown};

/** Shared nonvisual native navigation; the Element only adds gesture feedback. */
export async function seekAnalysisPlayback(
  source: ScorePlaybackSource,
  score: Score | undefined,
  seconds: number,
  isCurrent: () => boolean = () => true,
): Promise<AnalysisSeekOutcome> {
  let nominalSeconds: number | null = null;
  const superseded = (): AnalysisSeekOutcome => Object.freeze({status: 'superseded', nominalSeconds});
  try {
    const initial = source.snapshot();
    if (!isCurrent()) return superseded();
    nominalSeconds = initial.nominalSeconds;
    const data = score ?? initial.score;
    if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Nominal seconds must be finite and non-negative.');
    if (!data || initial.readiness !== 'ready' || initial.score !== data) throw new Error('The playback source is not ready for this score.');
    const command = source.seekNominal;
    // Snapshot access and a structural command getter may synchronously replace
    // the caller's source. Never dispatch that older intent after they return.
    if (!isCurrent()) return superseded();
    if (!command) throw new Error('The playback source is read-only.');
    await command.call(source, Math.min(seconds, data.durationSeconds));
    if (!isCurrent()) return superseded();
    const committed = source.snapshot();
    if (!isCurrent()) return superseded();
    nominalSeconds = committed.nominalSeconds;
    if (committed.sourceRevision !== initial.sourceRevision || committed.score !== data) return superseded();
    if (committed.readiness !== 'ready') throw new Error('The playback source is no longer ready for this score.');
    return Object.freeze({status: 'committed', nominalSeconds});
  } catch (error) {
    return isCurrent() ? Object.freeze({status: 'failed', nominalSeconds, error}) : superseded();
  }
}
