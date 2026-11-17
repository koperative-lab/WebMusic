import {createCapabilityKey, type CapabilityKey} from './capability';
import type {ModuleSession} from '../session';
import {barsBeatsTicksAt, type BarsBeatsTicks, type MusicalTempo} from '../transport';

/**
 * The Session's musical time, lent to every module of a project (DEC-077):
 * its tempo and meter, the position in bars, beats and ticks, and the audio
 * time of a Session position, for timers that follow the transport.
 */
export interface MusicalTimeSource {
  /** Current tempo and meter. */
  tempo(): MusicalTempo;
  /** Whether the Session is playing. */
  playing(): boolean;
  /** Session position in seconds now. */
  position(): number;
  /** Bars, beats and ticks now. */
  barsBeatsTicks(): BarsBeatsTicks;
  /** AudioContext time at a Session position, while playing; undefined while paused. */
  timeAt(position: number): number | undefined;
  /** Notified after a tempo change and after play, pause, seek or a loop jump. */
  subscribe(listener: () => void): () => void;
}

export const MUSICAL_TIME: CapabilityKey<MusicalTimeSource> = createCapabilityKey<MusicalTimeSource>('webmusic.musical-time');

/** A musical-time source over a Session; `notify()` reports a tempo change. */
export function createMusicalTimeSource(session: ModuleSession, tempo: () => MusicalTempo): MusicalTimeSource & {notify(): void} {
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) { try { listener(); } catch { /* Observers cannot stop a tempo change. */ } } };
  let release: (() => void) | undefined;
  const source = {
    tempo,
    playing: () => !session.snapshot.paused,
    position: () => session.position,
    barsBeatsTicks: () => barsBeatsTicksAt(session.position, tempo()),
    timeAt: (position: number) => {
      if (session.snapshot.paused) return undefined;
      const time = session.clock.timeAt(position);
      return Number.isFinite(time) ? time : undefined;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      release ??= session.subscribe(notify);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) { release?.(); release = undefined; }
      };
    },
    notify,
  };
  return source;
}
