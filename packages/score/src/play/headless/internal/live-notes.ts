import type {NoteInputOccurrence} from '../../core/note-input-model';
import type {HeadlessSynth} from '../audio-contracts';

interface LiveNote {
  active: boolean;
  context?: AudioContext;
  synth?: HeadlessSynth;
  handle?: unknown;
}

/** Exact live occurrences, separate from the score scheduler's voice ownership. */
export class LiveNotes {
  private readonly notes = new Map<string, LiveNote>();
  private disposed = false;

  constructor(private readonly prepare: () => {context: AudioContext; synth: HeadlessSynth}) {}

  noteOn(note: NoteInputOccurrence): void {
    if (this.disposed) throw new Error('Live note input is disposed.');
    if (!note.id || !Number.isInteger(note.midi) || note.midi < 0 || note.midi > 127 ||
      !Number.isFinite(note.velocity) || note.velocity <= 0 || note.velocity > 127) {
      throw new RangeError('A live note requires an occurrence id, MIDI pitch 0..127 and velocity greater than 0 through 127.');
    }
    if (this.notes.has(note.id)) throw new Error(`Live note occurrence already exists: ${note.id}`);
    const record: LiveNote = {active: true};
    this.notes.set(note.id, record);
    try {
      const {context, synth} = this.prepare();
      if (!record.active || this.disposed) return;
      if ((!synth.supportsNoteOccurrences && !synth.supportsScheduledCancellation) || !synth.noteOffById) {
        throw new Error('This instrument does not support independent note occurrences.');
      }
      record.context = context;
      record.synth = synth;
      const handle = synth.noteOn(note.midi, note.velocity, context.currentTime, Infinity);
      if (handle == null) throw new Error('An occurrence-capable instrument must return a unique voice handle.');
      if ([...this.notes.values()].some(other => other !== record && other.synth === synth && other.handle === handle)) {
        throw new Error('An occurrence-capable instrument returned a duplicate voice handle.');
      }
      record.handle = handle;
      // Extension code can release or dispose while noteOn is still on its stack.
      if (!record.active || this.disposed) synth.noteOffById(handle, context.currentTime);
    } catch (error) {
      record.active = false;
      if (this.notes.get(note.id) === record) this.notes.delete(note.id);
      throw error;
    }
  }

  noteOff(id: string): void {
    const record = this.notes.get(id);
    if (!record) return;
    this.notes.delete(id);
    record.active = false;
    if (record.handle != null) record.synth!.noteOffById!(record.handle, record.context!.currentTime);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    let failure: unknown;
    for (const id of [...this.notes.keys()]) {
      try { this.noteOff(id); } catch (error) { failure ??= error; }
    }
    if (failure !== undefined) throw failure;
  }
}
