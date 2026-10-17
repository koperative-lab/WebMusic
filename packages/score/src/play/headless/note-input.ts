import {createCapabilityKey} from '@webmusic/kernel/module';
import type {NoteInputOccurrence, NoteInputTarget} from '../core/note-input-model';

/** Score-only note semantics travel through an explicitly declared module capability. */
export const SCORE_NOTE_INPUT = createCapabilityKey<NoteInputTarget>('score.note-input');

export interface NoteInputControllerOptions {
  target?: NoteInputTarget;
  onError?: (error: unknown) => void;
}

interface HeldOccurrence {
  readonly note: NoteInputOccurrence;
  readonly target?: NoteInputTarget;
  active: boolean;
  started: boolean;
}

let nextSource = 0;

/** Owns only this source's gates; the target, instrument and context stay borrowed. */
export class NoteInputController {
  private readonly sourceId = ++nextSource;
  private sequence = 0;
  private target?: NoteInputTarget;
  private readonly held = new Map<string, HeldOccurrence>();
  private readonly onError?: (error: unknown) => void;
  private disposed = false;

  constructor(options: NoteInputControllerOptions = {}) {
    this.target = options.target;
    this.onError = options.onError;
  }

  get activeOccurrenceCount(): number { return this.held.size; }
  get connected(): boolean { return this.target !== undefined && !this.disposed; }

  /** Retargeting releases old gates and never transfers held keys to another instrument. */
  setTarget(target: NoteInputTarget | undefined): void {
    if (this.disposed || target === this.target) return;
    this.target = target;
    this.releaseAll();
  }

  press(midi: number, velocity = 100): NoteInputOccurrence {
    if (this.disposed) throw new Error('NoteInputController has been disposed.');
    if (!Number.isInteger(midi) || midi < 0 || midi > 127 ||
      !Number.isFinite(velocity) || velocity < 1 || velocity > 127) {
      throw new RangeError('Note input requires a MIDI pitch in 0–127 and velocity in 1–127.');
    }
    const note = Object.freeze({id: `note-input-${this.sourceId}-${++this.sequence}`, midi, velocity});
    const held: HeldOccurrence = {note, target: this.target, active: true, started: false};
    this.held.set(note.id, held);
    if (held.target) {
      try {
        const ready = held.target.prepare();
        void Promise.resolve(ready).then(() => {
          if (!held.active || this.disposed) return;
          const target = held.target!;
          // Publish ownership before invoking foreign code. If it releases this
          // occurrence while starting, the post-call cleanup covers late audio.
          held.started = true;
          try {
            target.noteOn(note);
            if (!held.active) target.noteOff(note.id);
          } catch (error) {
            this.release(note.id);
            this.report(error);
          }
        }, (error) => {
          if (!held.active) return;
          this.release(note.id);
          this.report(error);
        });
      } catch (error) {
        this.release(note.id);
        this.report(error);
      }
    }
    return note;
  }

  release(id: string): void {
    const held = this.held.get(id);
    if (!held) return;
    this.held.delete(id);
    held.active = false;
    if (held.started) {
      try { held.target?.noteOff(id); } catch (error) { this.report(error); }
    }
  }

  releaseAll(): void {
    for (const id of [...this.held.keys()]) this.release(id);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target = undefined;
    this.releaseAll();
  }

  private report(error: unknown): void {
    try {
      const result: unknown = this.onError?.(error);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {});
      }
    } catch { /* Diagnostics cannot revive released notes. */ }
  }
}

export type {NoteInputOccurrence, NoteInputTarget} from '../core/note-input-model';
