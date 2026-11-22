// The reference polyphonic processor's worklet file. Bundle it as its own
// module (for example Vite's `?worker&url`) and pass that URL to
// prepareProcessor; it imports nothing from the main thread.
import {defineProcessor} from '@webmusic/kernel/processor-worklet';
import {polySynth} from './poly-synth';
import {polySynthDsp} from './poly-synth-dsp';

defineProcessor(polySynth, polySynthDsp);
