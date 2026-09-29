// ============================================================================
// LiveScrollBuffer — the headless half of a live, scrolling projection.
//
// Every offline surface in this capability draws data that already exists.
// A live one has the opposite shape: one column arrives per animation frame
// and the oldest falls off the left edge. That is a ring buffer plus a clock,
// and it is entirely DOM-free — which is what keeps the drawing side a thin
// painter over a model that can be tested without a canvas.
// ============================================================================

/** One captured column. `values` is normalized to 0..1. */
export interface LiveColumn {
  /** Seconds since capture began — the column's own timestamp. */
  seconds: number;
  values: Float32Array;
}

export interface LiveScrollOptions {
  /** How much history to keep, in seconds. Default 5. */
  windowSeconds?: number;
  /** Expected columns per second, used to size the ring. Default 60. */
  columnsPerSecond?: number;
  /** Rows per column: 1 for a min/max pair band, N for a spectrum slice. */
  rows: number;
}

export type LiveProjectionType = 'waveform' | 'spectrogram';

export interface LiveViewControllerOptions {
  /** Borrowed analyser. The controller never mutates or disconnects it. */
  analyser?: AnalyserNode;
  type?: LiveProjectionType;
  windowSeconds?: number;
  columnsPerSecond?: number;
}

/**
 * A fixed-capacity ring of columns covering the most recent
 * `windowSeconds`. Capacity is derived once and never grows: a live view runs
 * for as long as the page is open, so an unbounded history is a leak with a
 * pretty name.
 */
export class LiveScrollBuffer {
  readonly rows: number;
  readonly capacity: number;
  #windowSeconds: number;
  #columns: Float32Array;
  #times: Float64Array;
  #count = 0;
  #next = 0;

  constructor(options: LiveScrollOptions) {
    this.rows = Math.max(1, Math.floor(options.rows));
    this.#windowSeconds = Math.max(0.1, options.windowSeconds ?? 5);
    const perSecond = Math.max(1, options.columnsPerSecond ?? 60);
    this.capacity = Math.max(2, Math.ceil(this.#windowSeconds * perSecond));
    this.#columns = new Float32Array(this.capacity * this.rows);
    this.#times = new Float64Array(this.capacity);
  }

  get windowSeconds(): number {
    return this.#windowSeconds;
  }

  /** Columns currently held, oldest first. */
  get length(): number {
    return this.#count;
  }

  /** Seconds of the newest column, or 0 before anything arrived. */
  get latestSeconds(): number {
    if (this.#count === 0) return 0;
    const newest = (this.#next - 1 + this.capacity) % this.capacity;
    return this.#times[newest]!;
  }

  /**
   * Append one column. `values` is copied — the caller almost always owns a
   * single scratch array it refills every frame, and keeping a reference would
   * make every stored column the same live buffer.
   */
  push(seconds: number, values: ArrayLike<number>): void {
    const base = this.#next * this.rows;
    const limit = Math.min(this.rows, values.length);
    for (let row = 0; row < limit; row += 1) this.#columns[base + row] = Number(values[row]);
    for (let row = limit; row < this.rows; row += 1) this.#columns[base + row] = 0;
    this.#times[this.#next] = seconds;
    this.#next = (this.#next + 1) % this.capacity;
    if (this.#count < this.capacity) this.#count += 1;
  }

  /**
   * Walk the held columns oldest-first. A callback rather than an array so a
   * 60 Hz repaint allocates nothing.
   */
  forEach(visit: (column: LiveColumn, index: number) => void): void {
    const scratch = new Float32Array(this.rows);
    const start = (this.#next - this.#count + this.capacity) % this.capacity;
    for (let offset = 0; offset < this.#count; offset += 1) {
      const slot = (start + offset) % this.capacity;
      const base = slot * this.rows;
      for (let row = 0; row < this.rows; row += 1) scratch[row] = this.#columns[base + row]!;
      visit({seconds: this.#times[slot]!, values: scratch}, offset);
    }
  }

  /** Read one held column by age index (0 = oldest). */
  at(index: number): LiveColumn | undefined {
    if (index < 0 || index >= this.#count) return undefined;
    const start = (this.#next - this.#count + this.capacity) % this.capacity;
    const slot = (start + index) % this.capacity;
    const base = slot * this.rows;
    return {seconds: this.#times[slot]!, values: this.#columns.slice(base, base + this.rows)};
  }

  /** Drop everything, e.g. when the source changes. */
  clear(): void {
    this.#count = 0;
    this.#next = 0;
  }
}

/**
 * DOM-free owner of a live projection's analyser scratch buffers, clock and
 * fixed-capacity history. A presenter decides when to call `capture()` and how
 * to paint `buffer`; this controller never schedules a frame or creates DOM.
 */
export class LiveViewController {
  #analyser?: AnalyserNode;
  #type: LiveProjectionType;
  #windowSeconds: number;
  #columnsPerSecond: number;
  #buffer?: LiveScrollBuffer;
  #frame?: Uint8Array<ArrayBuffer>;
  #spectrum?: Float32Array;
  #startedAt?: number;

  constructor(options: LiveViewControllerOptions = {}) {
    this.#analyser = options.analyser;
    this.#type = options.type ?? 'waveform';
    this.#windowSeconds = Math.max(0.5, options.windowSeconds ?? 5);
    this.#columnsPerSecond = Math.max(1, options.columnsPerSecond ?? 60);
  }

  get analyser(): AnalyserNode | undefined {
    return this.#analyser;
  }

  setAnalyser(analyser: AnalyserNode | undefined): void {
    if (analyser === this.#analyser) return;
    this.#analyser = analyser;
    this.clear();
  }

  get type(): LiveProjectionType {
    return this.#type;
  }

  setType(type: LiveProjectionType): void {
    if (type === this.#type) return;
    this.#type = type;
    this.clear();
  }

  get windowSeconds(): number {
    return this.#windowSeconds;
  }

  setWindowSeconds(windowSeconds: number): void {
    const next = Math.max(0.5, Number.isFinite(windowSeconds) ? windowSeconds : 5);
    if (next === this.#windowSeconds) return;
    this.#windowSeconds = next;
    this.clear();
  }

  get buffer(): LiveScrollBuffer | undefined {
    return this.#buffer;
  }

  /** Capture one analyser frame at a caller-supplied monotonic timestamp. */
  capture(nowMs: number): LiveScrollBuffer | undefined {
    const analyser = this.#analyser;
    if (!analyser) return undefined;
    const timestamp = Number.isFinite(nowMs) ? nowMs : 0;
    this.#startedAt ??= timestamp;
    const seconds = Math.max(0, (timestamp - this.#startedAt) / 1_000);
    const buffer = this.#ensureBuffer(analyser);

    if (this.#type === 'waveform') {
      const size = analyser.fftSize;
      if (!this.#frame || this.#frame.length !== size) this.#frame = new Uint8Array(size);
      analyser.getByteTimeDomainData(this.#frame);
      buffer.push(seconds, timeDomainColumn(this.#frame));
      return buffer;
    }

    const bins = analyser.frequencyBinCount;
    if (!this.#frame || this.#frame.length !== bins) this.#frame = new Uint8Array(bins);
    if (!this.#spectrum || this.#spectrum.length !== bins) this.#spectrum = new Float32Array(bins);
    analyser.getByteFrequencyData(this.#frame);
    buffer.push(seconds, frequencyColumn(this.#frame, this.#spectrum));
    return buffer;
  }

  /** Drop history and scratch state, e.g. when source or projection changes. */
  clear(): void {
    this.#buffer = undefined;
    this.#frame = undefined;
    this.#spectrum = undefined;
    this.#startedAt = undefined;
  }

  #ensureBuffer(analyser: AnalyserNode): LiveScrollBuffer {
    const rows = this.#type === 'waveform' ? 2 : analyser.frequencyBinCount;
    const current = this.#buffer;
    if (
      current &&
      current.rows === rows &&
      current.windowSeconds === this.#windowSeconds
    ) {
      return current;
    }
    this.#buffer = new LiveScrollBuffer({
      rows,
      windowSeconds: this.#windowSeconds,
      columnsPerSecond: this.#columnsPerSecond,
    });
    return this.#buffer;
  }
}

export function createLiveViewController(
  options?: LiveViewControllerOptions,
): LiveViewController {
  return new LiveViewController(options);
}

/** Reduce a time-domain frame to one min/max band, both normalized to -1..1. */
export function timeDomainColumn(frame: Uint8Array): [min: number, max: number] {
  let min = 1;
  let max = -1;
  for (let index = 0; index < frame.length; index += 1) {
    // getByteTimeDomainData centres silence at 128.
    const value = (frame[index]! - 128) / 128;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min > max ? [0, 0] : [min, max];
}

/** Normalize a byte frequency frame to 0..1, in place into `out`. */
export function frequencyColumn(frame: Uint8Array, out: Float32Array): Float32Array {
  const limit = Math.min(frame.length, out.length);
  for (let index = 0; index < limit; index += 1) out[index] = frame[index]! / 255;
  for (let index = limit; index < out.length; index += 1) out[index] = 0;
  return out;
}
