// The WebAssembly reference processor's worklet file.
import {defineProcessor} from '@webmusic/kernel/processor-worklet';
import {wasmGain} from './wasm-gain';
import {wasmGainDsp} from './wasm-gain-dsp';

defineProcessor(wasmGain, wasmGainDsp);
