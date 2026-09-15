import type {HeadlessSynth} from '../audio-contracts';
import {reportPlaybackOperationFailure} from '../playback-events';

interface MidiNote {
  midi: number;
  started: boolean;
  on?: ReturnType<typeof setTimeout>;
  off?: ReturnType<typeof setTimeout>;
}

import type {MidiOutOptions, MidiOutputLike} from './contracts';

/** Sends Web MIDI note messages instead of producing audio. */
export class MidiOutBackend implements HeadlessSynth {
  private context?: AudioContext;
  private output?: MidiOutputLike;
  private readonly channel: number;
  private readonly given?: MidiOutputLike;
  private readonly notes = new Map<number, MidiNote>();
  private nextNoteId = 1;
  private connectionId = 0;

  constructor(options: MidiOutOptions = {}) {
    this.given = options.output;
    this.channel = (options.channel ?? 0) & 0x0f;
  }

  connect(destination: AudioNode): () => void {
    const connectionId = ++this.connectionId;
    this.context = destination.context as AudioContext;
    // Web MIDI has no AudioNode edge to detach, but this exact route owns the
    // context clock and pending sends. Returning a disposer keeps Sound's
    // borrowed-route lifecycle precise and makes a fresh route safe.
    return () => {
      if (connectionId !== this.connectionId) return;
      this.connectionId += 1;
      this.context = undefined;
      this.releaseRoute();
    };
  }

  async preload(): Promise<void> {
    const context = this.context;
    const connectionId = this.connectionId;
    if (this.given) {
      if (this.context === context) this.output = this.given;
      return;
    }
    const nav = typeof navigator !== 'undefined'
      ? navigator as Navigator & {
        requestMIDIAccess?: () => Promise<{outputs: Map<string, MidiOutputLike>}>;
      }
      : undefined;
    if (!nav?.requestMIDIAccess) {
      throw new Error('Sound.midiOut: Web MIDI is not available; pass { output }.');
    }
    const access = await nav.requestMIDIAccess();
    if (this.context !== context || this.connectionId !== connectionId) return;
    this.output = access.outputs.values().next().value;
    if (!this.output) throw new Error('Sound.midiOut: no MIDI output found.');
  }

  noteOn(midi: number, velocity: number, time: number, durationSeconds: number): number {
    const id = this.nextNoteId++;
    const note: MidiNote = {midi: midi & 0x7f, started: false};
    this.notes.set(id, note);
    this.schedule(id, note, 'on', time, () => {
      note.started = true;
      this.output?.send([0x90 | this.channel, note.midi, Math.max(0, Math.min(127, Math.round(velocity)))]);
    });
    this.schedule(id, note, 'off', time + durationSeconds, () => this.releaseNote(id, note));
    return id;
  }

  noteOff(midi: number, time: number): void {
    for (const [id, note] of this.notes) {
      if (note.midi === (midi & 0x7f)) this.noteOffById(id, time);
    }
  }

  noteOffById(handle: unknown, time: number): void {
    const note = typeof handle === 'number' ? this.notes.get(handle) : undefined;
    if (!note) return;
    // Explicit pause/stop releases at "now" must quiet external hardware even
    // while its borrowed audio reference is suspended.
    if (time <= (this.context?.currentTime ?? 0)) {
      this.releaseNote(handle as number, note);
      return;
    }
    this.schedule(handle as number, note, 'off', time, () => this.releaseNote(handle as number, note));
  }

  retimeScheduledNote(handle: unknown, time: number): void {
    this.noteOffById(handle, time);
  }

  dispose(): void {
    this.connectionId += 1;
    this.context = undefined;
    this.releaseRoute();
  }

  /** Cancel future sends and attempt one release for every attack already sent. */
  private releaseRoute(): void {
    const notes = [...this.notes.values()];
    const output = this.output;
    this.notes.clear();
    this.output = undefined;
    for (const note of notes) this.clearNoteTimers(note);
    let failed = false;
    let firstError: unknown;
    for (const note of notes) {
      if (!note.started) continue;
      try {
        output?.send([0x80 | this.channel, note.midi, 0]);
      } catch (error) {
        if (!failed) firstError = error;
        failed = true;
      }
    }
    if (failed) throw firstError;
  }

  private clearNoteTimers(note: MidiNote): void {
    if (note.on !== undefined) clearTimeout(note.on);
    if (note.off !== undefined) clearTimeout(note.off);
    note.on = undefined;
    note.off = undefined;
  }

  private releaseNote(id: number, note: MidiNote): void {
    if (this.notes.get(id) !== note) return;
    this.notes.delete(id);
    this.clearNoteTimers(note);
    if (note.started) this.output?.send([0x80 | this.channel, note.midi, 0]);
  }

  private schedule(id: number, note: MidiNote, slot: 'on' | 'off', time: number, callback: () => void): void {
    if (note[slot] !== undefined) clearTimeout(note[slot]);
    const connectionId = this.connectionId;
    const remaining = Math.max(0, time - (this.context?.currentTime ?? 0));
    const timer = setTimeout(() => {
      if (note[slot] !== timer) return;
      note[slot] = undefined;
      if (connectionId !== this.connectionId || this.notes.get(id) !== note) return;
      // JS timers wake the adapter; AudioContext seconds decide when a note
      // actually starts/ends. A suspended context must not consume its gate.
      const context = this.context;
      if (context?.state === 'closed') {
        try { this.releaseNote(id, note); }
        catch (error) { reportPlaybackOperationFailure('Sound.midiOut', 'closed context release', error); }
        return;
      }
      if (context && (context.currentTime < time || (context.state && context.state !== 'running'))) {
        this.schedule(id, note, slot, time, callback);
        return;
      }
      try {
        callback();
      } catch (error) {
        reportPlaybackOperationFailure('Sound.midiOut', slot === 'on' ? 'noteOn' : 'noteOff', error);
      }
    }, this.context?.state && this.context.state !== 'running' ? 50 : remaining * 1000);
    note[slot] = timer;
  }
}
