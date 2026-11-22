// The reference polyphonic processor's DSP, written with the public authoring
// kit exactly as a third-party author would. poly-synth.worklet.ts registers
// it; tests run the same object against a fake worklet scope.
//
// Rules this file follows, and yours should too:
// - Allocate every buffer and voice in create(). process() and note() run on
//   the audio thread and must not allocate, build closures or strings, or post.
// - Voices live in parallel typed arrays indexed by voice number.
// - note() only records where in the coming block a change happens; process()
//   renders each voice from that frame offset, so onsets are sample-exact.
import type {ProcessorImplementation} from '@webmusic/kernel/processor-worklet';
import {POLY_SYNTH_VOICES} from './poly-synth';

const IDLE = 0, ATTACK = 1, DECAY = 2, SUSTAIN = 3, RELEASE = 4, FADE = 5;
/** `cancel` has no release phase; this short ramp only prevents a click. */
const CANCEL_SECONDS = 0.003;
/** Below this envelope level a releasing voice is silent and becomes free. */
const SILENT = 1e-5;
const NONE = -1;

export interface PolySynthState {
  readonly sampleRate: number;
  readonly occurrence: Int32Array;
  readonly stage: Uint8Array;
  readonly envelope: Float64Array;
  readonly velocity: Float64Array;
  readonly phase: Float64Array;
  readonly increment: Float64Array;
  /** Pitch and velocity of a pending onset, applied at its frame so a stolen note keeps its own until then. */
  readonly nextIncrement: Float64Array;
  readonly nextVelocity: Float64Array;
  /** Filter integrator states (TPT state-variable filter). */
  readonly low: Float64Array;
  readonly band: Float64Array;
  /** Frame in the coming block where the voice starts, releases or is cancelled; NONE when no change is pending. */
  readonly startAt: Int32Array;
  readonly releaseAt: Int32Array;
  readonly cancelAt: Int32Array;
  readonly started: Float64Array;
  age: number;
}

function allocate(voices: number, sampleRate: number): PolySynthState {
  return {
    sampleRate,
    occurrence: new Int32Array(voices).fill(NONE),
    stage: new Uint8Array(voices),
    envelope: new Float64Array(voices),
    velocity: new Float64Array(voices),
    phase: new Float64Array(voices),
    increment: new Float64Array(voices),
    nextIncrement: new Float64Array(voices),
    nextVelocity: new Float64Array(voices),
    low: new Float64Array(voices),
    band: new Float64Array(voices),
    startAt: new Int32Array(voices).fill(NONE),
    releaseAt: new Int32Array(voices).fill(NONE),
    cancelAt: new Int32Array(voices).fill(NONE),
    started: new Float64Array(voices),
    age: 0,
  };
}

/** A free voice, else the quietest releasing one, else the oldest. */
function chooseVoice(state: PolySynthState): number {
  let releasing = NONE;
  let oldest = 0;
  for (let voice = 0; voice < state.stage.length; voice++) {
    const stage = state.stage[voice];
    if (stage === IDLE && state.startAt[voice] === NONE) return voice;
    if ((stage === RELEASE || stage === FADE) && (releasing === NONE || state.envelope[voice] < state.envelope[releasing])) releasing = voice;
    if (state.started[voice] < state.started[oldest]) oldest = voice;
  }
  return releasing !== NONE ? releasing : oldest;
}

function findVoice(state: PolySynthState, occurrence: number): number {
  for (let voice = 0; voice < state.occurrence.length; voice++) if (state.occurrence[voice] === occurrence) return voice;
  return NONE;
}

/** Band-limited sawtooth: a naive ramp with a two-sample polynomial correction at the wrap. */
function polyBlepSaw(phase: number, increment: number): number {
  let value = 2 * phase - 1;
  if (phase < increment) {
    const t = phase / increment;
    value -= t + t - t * t - 1;
  } else if (phase > 1 - increment) {
    const t = (phase - 1) / increment;
    value -= t * t + t + t + 1;
  }
  return value;
}

export const polySynthDsp: ProcessorImplementation<PolySynthState> = {
  create: ({sampleRate}) => allocate(POLY_SYNTH_VOICES, sampleRate),

  note(state, event) {
    if (event.gate === 'on') {
      const voice = chooseVoice(state);
      state.occurrence[voice] = event.occurrence;
      state.nextVelocity[voice] = event.velocity;
      state.nextIncrement[voice] = 440 * Math.pow(2, (event.midi - 69 + event.cents / 100) / 12) / state.sampleRate;
      state.startAt[voice] = event.frameOffset;
      state.releaseAt[voice] = NONE;
      state.cancelAt[voice] = NONE;
      state.started[voice] = ++state.age;
      return;
    }
    const voice = findVoice(state, event.occurrence);
    if (voice === NONE) return;
    if (event.gate === 'off') state.releaseAt[voice] = event.frameOffset;
    else state.cancelAt[voice] = event.frameOffset;
  },

  process(state, block) {
    const left = block.outputs[0][0];
    const right = block.outputs[0][1];
    const length = left.length;
    const params = block.params;
    const sampleRate = state.sampleRate;
    const level = params.level[0];
    const sustain = params.sustain[0];
    const attackStep = 1 / Math.max(1, params.attack[0] * sampleRate);
    // Exponential segments reach −60 dB in their stated time.
    const decayCoefficient = Math.pow(0.001, 1 / Math.max(1, params.decay[0] * sampleRate));
    const releaseCoefficient = Math.pow(0.001, 1 / Math.max(1, params.release[0] * sampleRate));
    const fadeStep = 1 / (CANCEL_SECONDS * sampleRate);
    // TPT state-variable lowpass, coefficients once per block.
    const cutoff = Math.min(params.cutoff[0], 0.45 * sampleRate);
    const g = Math.tan(Math.PI * cutoff / sampleRate);
    const damping = 2 - 2 * params.resonance[0];
    const a1 = 1 / (1 + g * (g + damping));
    const a2 = g * a1;
    const a3 = g * a2;

    for (let voice = 0; voice < state.stage.length; voice++) {
      const startAt = state.startAt[voice];
      if (startAt === NONE && state.stage[voice] === IDLE) continue;
      // A free voice starts at its onset frame. A stolen one renders from the
      // block start so its previous note can fade out up to the onset.
      const first = startAt !== NONE && state.stage[voice] === IDLE ? startAt : 0;

      let stage = state.stage[voice];
      let envelope = state.envelope[voice];
      let phase = state.phase[voice];
      let increment = state.increment[voice];
      let low = state.low[voice];
      let band = state.band[voice];
      const releaseAt = state.releaseAt[voice];
      const cancelAt = state.cancelAt[voice];
      let amplitude = level * state.velocity[voice];
      let pending = startAt;

      for (let frame = first; frame < length; frame++) {
        if (frame === pending) {
          stage = ATTACK;
          envelope = 0;
          phase = 0;
          low = 0;
          band = 0;
          increment = state.nextIncrement[voice];
          state.velocity[voice] = state.nextVelocity[voice];
          amplitude = level * state.velocity[voice];
          pending = NONE;
        } else if (pending !== NONE && stage !== IDLE) {
          // Before the onset of a stealing note: fade the previous note out.
          stage = FADE;
        }
        if (frame === releaseAt && pending === NONE && stage !== IDLE && stage !== FADE) stage = RELEASE;
        if (frame === cancelAt && pending === NONE) stage = FADE;
        if (stage === IDLE) continue;

        if (stage === ATTACK) {
          envelope += attackStep;
          if (envelope >= 1) { envelope = 1; stage = DECAY; }
        } else if (stage === DECAY) {
          envelope = sustain + (envelope - sustain) * decayCoefficient;
          if (envelope - sustain < SILENT) { envelope = sustain; stage = SUSTAIN; }
        } else if (stage === SUSTAIN) {
          envelope = sustain;
        } else if (stage === RELEASE) {
          envelope *= releaseCoefficient;
          if (envelope < SILENT) { envelope = 0; stage = IDLE; }
        } else {
          envelope -= fadeStep;
          if (envelope <= 0) { envelope = 0; stage = IDLE; }
        }

        const input = polyBlepSaw(phase, increment);
        phase += increment;
        if (phase >= 1) phase -= 1;
        const v3 = input - low;
        const v1 = a1 * band + a2 * v3;
        const v2 = low + a2 * band + a3 * v3;
        band = 2 * v1 - band;
        low = 2 * v2 - low;
        const sample = low * envelope * amplitude;
        left[frame] += sample;
        if (right) right[frame] += sample;
      }

      state.stage[voice] = stage;
      state.envelope[voice] = envelope;
      state.phase[voice] = phase;
      state.increment[voice] = increment;
      state.low[voice] = low;
      state.band[voice] = band;
      state.startAt[voice] = NONE;
      state.releaseAt[voice] = NONE;
      state.cancelAt[voice] = NONE;
      if (stage === IDLE) state.occurrence[voice] = NONE;
    }
  },
};
