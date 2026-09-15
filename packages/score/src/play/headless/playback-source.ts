import type {ScorePlaybackSnapshot, ScorePlaybackSource} from '../../core';
import {reportPlaybackOperationFailure} from './playback-events';

/** Internal publication mechanism shared by native and Element playback owners. */
export class PlaybackPublisher implements ScorePlaybackSource {
  private revision = 0;
  private readonly listeners = new Set<(snapshot: ScorePlaybackSnapshot) => void>();

  constructor(
    private readonly read: () => Omit<ScorePlaybackSnapshot, 'revision'>,
    readonly seekNominal?: (seconds: number) => Promise<void>,
  ) {}

  snapshot(): ScorePlaybackSnapshot {
    return Object.freeze({...this.read(), revision: this.revision});
  }

  subscribe(listener: (snapshot: ScorePlaybackSnapshot) => void): () => void {
    this.listeners.add(listener);
    try {
      listener(this.snapshot());
    } catch (error) {
      this.listeners.delete(listener);
      throw error;
    }
    return () => { this.listeners.delete(listener); };
  }

  notify(): void {
    this.revision += 1;
    const snapshot = this.snapshot();
    for (const listener of [...this.listeners]) {
      // A callback can publish a replacement before its peers are reached.
      // That nested publication already delivered the new revision to them.
      if (snapshot.revision !== this.revision) break;
      if (!this.listeners.has(listener)) continue;
      try {
        listener(snapshot);
      } catch (error) {
        reportPlaybackOperationFailure('ScorePlayback', 'subscriber', error);
      }
    }
  }
}
