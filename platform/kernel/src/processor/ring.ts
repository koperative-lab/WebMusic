// A single-producer, single-consumer float ring over shared memory, used by
// both threads: the processor writes on the audio thread, the main thread
// reads. Pure: no DOM, and nothing runs at import time.

const READ = 0;
const WRITE = 1;
const DROPPED = 2;
const HEADER_BYTES = 16;

/** Where shared memory and the other optional processor features are available. */
export interface ProcessorCapabilities {
  /** `AudioWorkletNode` exists, so processors can run at all. */
  readonly audioWorklet: boolean;
  /** `WebAssembly` exists, so `source.wasm` can be compiled. */
  readonly wasm: boolean;
  /**
   * The page is cross-origin isolated and has `SharedArrayBuffer` and
   * `Atomics`, so a definition's `sharedRing` is provided. Pages served
   * without COOP/COEP headers (GitHub Pages, for one) report false.
   */
  readonly sharedMemory: boolean;
}

/** What this environment offers processors. Reading it allocates nothing. */
export function processorCapabilities(): ProcessorCapabilities {
  const scope = globalThis as {
    crossOriginIsolated?: boolean; AudioWorkletNode?: unknown; WebAssembly?: unknown;
    SharedArrayBuffer?: unknown; Atomics?: unknown;
  };
  return Object.freeze({
    audioWorklet: typeof scope.AudioWorkletNode === 'function',
    wasm: typeof scope.WebAssembly === 'object' && scope.WebAssembly !== null,
    sharedMemory: scope.crossOriginIsolated === true && typeof scope.SharedArrayBuffer === 'function' && typeof scope.Atomics === 'object',
  });
}

/**
 * A lock-free ring of `float32` samples in one `SharedArrayBuffer`. Exactly
 * one side writes and one side reads. Writing never blocks or allocates: what
 * does not fit is dropped and counted. One slot stays empty, so a ring of
 * capacity `n` holds at most `n − 1` samples.
 */
export class ProcessorRing {
  /** The shared memory, to hand to the other thread. */
  readonly buffer: SharedArrayBuffer;
  readonly capacity: number;
  readonly #state: Int32Array;
  readonly #data: Float32Array;

  /** Allocate a ring. Throws where `SharedArrayBuffer` is unavailable. */
  static create(capacity: number): ProcessorRing {
    if (!Number.isInteger(capacity) || capacity < 2) throw new RangeError('A processor ring needs an integer capacity of at least 2.');
    if (typeof SharedArrayBuffer !== 'function') throw new Error('SharedArrayBuffer is unavailable: the page is not cross-origin isolated.');
    return new ProcessorRing(new SharedArrayBuffer(HEADER_BYTES + capacity * 4));
  }

  /** Attach to a ring another thread created. */
  constructor(buffer: SharedArrayBuffer) {
    const capacity = (buffer?.byteLength - HEADER_BYTES) / 4;
    if (!Number.isInteger(capacity) || capacity < 2) throw new TypeError('Not a processor ring buffer.');
    this.buffer = buffer;
    this.capacity = capacity;
    this.#state = new Int32Array(buffer, 0, 4);
    this.#data = new Float32Array(buffer, HEADER_BYTES, capacity);
  }

  /** Samples waiting to be read. */
  get available(): number {
    const read = Atomics.load(this.#state, READ), write = Atomics.load(this.#state, WRITE);
    return (write - read + this.capacity) % this.capacity;
  }

  /** Samples the writer has dropped because the ring was full, since creation. */
  get dropped(): number { return Atomics.load(this.#state, DROPPED); }

  /** Writer side: append `length` samples from `source[start…]`; returns how many fit. Allocates nothing. */
  write(source: ArrayLike<number>, start = 0, length = source.length - start): number {
    const capacity = this.capacity, data = this.#data;
    const read = Atomics.load(this.#state, READ);
    let write = Atomics.load(this.#state, WRITE);
    const space = capacity - 1 - (write - read + capacity) % capacity;
    const count = length < space ? length : space;
    for (let index = 0; index < count; index++) {
      data[write] = source[start + index];
      write = write + 1 === capacity ? 0 : write + 1;
    }
    Atomics.store(this.#state, WRITE, write);
    if (count < length) Atomics.add(this.#state, DROPPED, length - count);
    return count;
  }

  /** Reader side: move up to `target.length` samples into `target`; returns how many. */
  read(target: Float32Array): number {
    const capacity = this.capacity, data = this.#data;
    let read = Atomics.load(this.#state, READ);
    const write = Atomics.load(this.#state, WRITE);
    const available = (write - read + capacity) % capacity;
    const count = available < target.length ? available : target.length;
    for (let index = 0; index < count; index++) {
      target[index] = data[read];
      read = read + 1 === capacity ? 0 : read + 1;
    }
    Atomics.store(this.#state, READ, read);
    return count;
  }
}
