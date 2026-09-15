import type {Alter, MidiNumber, Octave, Step} from '../types/pitch';

/**
 * A *notated* pitch (with enharmonic distinction).
 * F#4 and Gb4 are different Pitches but share the same MIDI number.
 * MusicXML cares about spelling; MIDI does not.
 */
export class Pitch {
  constructor(readonly step: Step, readonly alter: Alter, readonly octave: Octave) {
    if (!Object.prototype.hasOwnProperty.call(Pitch.STEP_TO_SEMITONE, step)) throw new RangeError('pitch step must be A through G');
    if (!Number.isInteger(alter) || alter < -2 || alter > 2) throw new RangeError('pitch alter must be an integer from -2 to 2');
    if (!Number.isSafeInteger(octave)) throw new RangeError('pitch octave must be a safe integer');
    if (!Number.isSafeInteger(this.midi)) throw new RangeError('pitch MIDI value must be a safe integer');
    Object.freeze(this);
  }

  static readonly STEP_TO_SEMITONE: Readonly<Record<Step, number>> = Object.freeze({
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  });

  /** Parse "C4", "F#5", "Bb3", "C##4". */
  static parse(s: string): Pitch {
    const m = /^([A-G])(b{1,2}|#{1,2})?(-?\d+)$/.exec(s);
    if (!m) throw new SyntaxError(`Invalid pitch: ${s}`);
    const step = m[1] as Step;
    const acc = m[2] ?? '';
    const alter = (acc.startsWith('#') ? acc.length : acc.startsWith('b') ? -acc.length : 0) as Alter;
    return new Pitch(step, alter, parseInt(m[3], 10));
  }

  /** MIDI number; C4 = 60. */
  get midi(): MidiNumber {
    return (this.octave + 1) * 12 + Pitch.STEP_TO_SEMITONE[this.step] + this.alter;
  }

  /** Default sharp-preferring spelling from MIDI number. */
  static fromMidi(midi: MidiNumber): Pitch {
    if (!Number.isSafeInteger(midi)) throw new RangeError('MIDI pitch must be a safe integer');
    const sharps: ReadonlyArray<readonly [Step, Alter]> = [
      ['C', 0],
      ['C', 1],
      ['D', 0],
      ['D', 1],
      ['E', 0],
      ['F', 0],
      ['F', 1],
      ['G', 0],
      ['G', 1],
      ['A', 0],
      ['A', 1],
      ['B', 0],
    ];
    const oct = Math.floor(midi / 12) - 1;
    const pc = ((midi % 12) + 12) % 12;
    const [step, alter] = sharps[pc];
    return new Pitch(step, alter, oct);
  }

  transpose(semitones: number): Pitch {
    if (!Number.isSafeInteger(semitones)) throw new RangeError('pitch transposition must be a safe integer');
    return Pitch.fromMidi(this.midi + semitones);
  }

  /** Compare by sound, ignoring spelling. */
  enharmonicEq(o: Pitch): boolean {
    return this.midi === o.midi;
  }
  /** Compare by sound AND spelling. */
  eq(o: Pitch): boolean {
    return this.step === o.step && this.alter === o.alter && this.octave === o.octave;
  }

  /** Frequency in Hz, A4 reference. */
  toFrequency(a4 = 440): number {
    if (!Number.isFinite(a4) || a4 <= 0) throw new RangeError('reference frequency must be finite and positive');
    return a4 * Math.pow(2, (this.midi - 69) / 12);
  }

  toString(): string {
    const acc = this.alter > 0 ? '#'.repeat(this.alter) : this.alter < 0 ? 'b'.repeat(-this.alter) : '';
    return `${this.step}${acc}${this.octave}`;
  }

  toJSON() {
    return {step: this.step, alter: this.alter, octave: this.octave};
  }

  static fromJSON(json: {step: Step; alter: Alter; octave: Octave}): Pitch {
    return new Pitch(json.step, json.alter, json.octave);
  }
}
