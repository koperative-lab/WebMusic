// The WebAssembly reference processor's definition and binary: plain data
// shared by the main thread and the worklet file.
import type {ProcessorDefinition} from '@webmusic/kernel/processor';

/**
 * A gain whose arithmetic runs in WebAssembly. With a shared ring (on a
 * cross-origin isolated page) it also streams its output there; without one
 * it reports its peak four times a second instead.
 */
export const wasmGain: ProcessorDefinition = {
  id: 'webmusic.reference.wasm-gain',
  version: '1.0.0',
  audioInputs: [{id: 'input', channels: 2}],
  audioOutputs: [{id: 'output', channels: 2}],
  wasm: true,
  sharedRing: {capacity: 16384},
  params: [{id: 'gain', label: 'Gain', unit: 'ratio', range: {min: 0, max: 2}, defaultValue: 1, step: 0.01}],
};

/**
 * The module, 102 bytes, hand-assembled from this text:
 *
 *   (module
 *     (memory (export "memory") 1)
 *     (func (export "gain") (param $n i32) (local $i i32) (local $g f32)
 *       (local.set $g (f32.load (i32.const 512)))
 *       (block (loop
 *         (br_if 1 (i32.ge_u (local.get $i) (local.get $n)))
 *         (f32.store (i32.shl (local.get $i) (i32.const 2))
 *           (f32.mul (f32.load (i32.shl (local.get $i) (i32.const 2))) (local.get $g)))
 *         (local.set $i (i32.add (local.get $i) (i32.const 1)))
 *         (br 0)))))
 *
 * `gain(n)` multiplies the first n float32 values of its memory by the float32
 * at byte 512 (float index 128). The factor travels in memory, not as an
 * argument: V8 boxes a fractional argument when one call site reaches the
 * exports of several instances, as it does once two nodes run this processor.
 * A real processor would ship a compiled `.wasm` file and pass its URL instead.
 */
export const WASM_GAIN_BYTES = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 1, 127, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1,
  7, 17, 2, 6, 109, 101, 109, 111, 114, 121, 2, 0, 4, 103, 97, 105, 110, 0, 0, 10, 57, 1, 55, 2,
  1, 127, 1, 125, 65, 128, 4, 42, 2, 0, 33, 2, 2, 64, 3, 64, 32, 1, 32, 0, 79, 13, 1, 32,
  1, 65, 2, 116, 32, 1, 65, 2, 116, 42, 2, 0, 32, 2, 148, 56, 2, 0, 32, 1, 65, 1, 106, 33,
  1, 12, 0, 11, 11, 11,
]);
