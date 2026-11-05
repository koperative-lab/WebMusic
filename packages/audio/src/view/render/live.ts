import {colormapByName, type Colormap} from '../core/colormaps';
import type {LiveProjectionType, LiveScrollBuffer} from '../headless/live';
import type {AudioCanvasFrame} from './overview';

export interface LiveProjectionRenderOptions {
  waveColor?: string;
  colorMap?: string | Colormap;
}

/** Paint the current fixed-capacity live history into a presenter-owned canvas. */
export function paintLiveProjection(
  frame: AudioCanvasFrame,
  buffer: LiveScrollBuffer | undefined,
  type: LiveProjectionType,
  options: LiveProjectionRenderOptions = {},
): void {
  const {context, width, height} = frame;
  context.clearRect(0, 0, width, height);
  if (!buffer || buffer.length === 0 || !(width > 0) || !(height > 0)) return;

  const columnWidth = Math.max(1, width / buffer.capacity);
  const originX = width - buffer.length * columnWidth;

  if (type === 'waveform') {
    context.fillStyle = options.waveColor ?? 'currentColor';
    const middle = height / 2;
    buffer.forEach((column, index) => {
      const min = column.values[0] ?? 0;
      const max = column.values[1] ?? 0;
      const top = middle - max * (height / 2);
      const bottom = middle - min * (height / 2);
      context.fillRect(
        originX + index * columnWidth,
        top,
        columnWidth,
        Math.max(1, bottom - top),
      );
    });
    return;
  }

  const colormap = resolveColormap(options.colorMap);
  const history = spectrogramHistory(context, buffer, colormap);
  if (history) {
    history.composite(context, originX, columnWidth, height);
    return;
  }

  // No bitmap support (a recording or server-side context): paint every cell.
  buffer.forEach((column, index) => {
    const x = originX + index * columnWidth;
    const rows = column.values.length;
    const rowHeight = height / Math.max(1, rows);
    for (let row = 0; row < rows; row += 1) {
      const value = column.values[row] ?? 0;
      if (value <= 0) continue;
      const [red, green, blue] = colormap(value);
      context.fillStyle = `rgb(${red},${green},${blue})`;
      context.fillRect(
        x,
        height - (row + 1) * rowHeight,
        columnWidth,
        rowHeight + 1,
      );
    }
  });
}

function resolveColormap(value: string | Colormap | undefined): Colormap {
  return typeof value === 'function' ? value : colormapByName(value);
}

// ---------------------------------------------------------------------------
// Incremental spectrogram history.
//
// Repainting the whole history every frame cost one fillStyle + fillRect per
// cell — capacity × bins, hundreds of thousands at 60 Hz. Instead each target
// context keeps a one-texel-per-cell ring bitmap: a frame writes only the new
// column(s), each with one putImageData, and composites the ring onto the frame
// in at most two scaled drawImage calls. Nothing is shifted, so nothing smears.
// ---------------------------------------------------------------------------

const COLOR_STEPS = 256;

interface RingCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): RingContext | null;
}

interface RingContext {
  createImageData(width: number, height: number): ImageData;
  putImageData(image: ImageData, dx: number, dy: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;
}

interface SpectrogramHistory {
  readonly buffer: LiveScrollBuffer;
  readonly colormap: Colormap;
  readonly capacity: number;
  readonly rows: number;
  composite(target: CanvasRenderingContext2D, originX: number, columnWidth: number, height: number): void;
}

const histories = new WeakMap<CanvasRenderingContext2D, SpectrogramHistory>();

function spectrogramHistory(
  context: CanvasRenderingContext2D,
  buffer: LiveScrollBuffer,
  colormap: Colormap,
): SpectrogramHistory | undefined {
  if (typeof context.drawImage !== 'function') return undefined;
  let history = histories.get(context);
  if (!history || history.buffer !== buffer || history.colormap !== colormap ||
      history.capacity !== buffer.capacity || history.rows !== buffer.rows) {
    history = createHistory(context, buffer, colormap);
    if (history) histories.set(context, history);
    else histories.delete(context);
  }
  return history;
}

function createHistory(
  target: CanvasRenderingContext2D,
  buffer: LiveScrollBuffer,
  colormap: Colormap,
): SpectrogramHistory | undefined {
  const {capacity, rows} = buffer;
  const ring = createRingCanvas(target, capacity, rows);
  const context = ring?.getContext('2d');
  if (!ring || !context || typeof context.createImageData !== 'function' ||
      typeof context.putImageData !== 'function') return undefined;
  const column = context.createImageData(1, rows);
  const pixels = new Uint32Array(column.data.buffer, column.data.byteOffset, column.data.byteLength >> 2);
  const table = packColormap(colormap);

  /** Ring slot written next; the `count` slots before it are populated. */
  let head = 0;
  let count = 0;
  let oldestSeconds = Number.NaN;
  let newestSeconds = Number.NaN;

  const writeColumn = (values: ArrayLike<number>): void => {
    for (let row = 0; row < rows; row += 1) {
      const value = Number(values[row] ?? 0);
      // Row 0 is the lowest band, drawn at the bottom; silence stays transparent.
      pixels[rows - 1 - row] = value > 0
        ? table[Math.min(COLOR_STEPS - 1, Math.round(value * (COLOR_STEPS - 1)))]!
        : 0;
    }
    context.putImageData(column, head, 0);
    head = (head + 1) % capacity;
  };

  const rebuild = (): void => {
    context.clearRect(0, 0, capacity, rows);
    head = 0;
    buffer.forEach((entry) => writeColumn(entry.values));
    count = buffer.length;
  };

  /** Columns pushed since the last sync, or -1 when the ring must be rebuilt. */
  const added = (): number => {
    const length = buffer.length;
    if (Number.isNaN(newestSeconds) || length < count) return -1;
    const newest = buffer.latestSeconds;
    if (newest === newestSeconds) {
      if (length > count) return length - count;
      // Unchanged at both ends: nothing arrived.
      return buffer.at(0)?.seconds === oldestSeconds ? 0 : -1;
    }
    let fresh = 0;
    while (fresh < length && buffer.at(length - 1 - fresh)!.seconds > newestSeconds) fresh += 1;
    if (fresh === 0 || fresh >= length) return -1;
    // While filling, the length grows by exactly the columns pushed.
    if (length < capacity && length - fresh !== count) return -1;
    return fresh;
  };

  const sync = (): void => {
    const fresh = added();
    const length = buffer.length;
    if (fresh < 0) rebuild();
    else for (let index = length - fresh; index < length; index += 1) writeColumn(buffer.at(index)!.values);
    count = length;
    newestSeconds = buffer.latestSeconds;
    oldestSeconds = buffer.at(0)?.seconds ?? Number.NaN;
  };

  return {
    buffer, colormap, capacity, rows,
    composite(frame, originX, columnWidth, height): void {
      sync();
      if (count === 0) return;
      const oldest = (head - count + capacity) % capacity;
      const first = Math.min(count, capacity - oldest);
      const smoothing = frame.imageSmoothingEnabled;
      // Cells keep square edges when the ring is scaled up to the frame.
      frame.imageSmoothingEnabled = false;
      try {
        const source = ring as unknown as CanvasImageSource;
        frame.drawImage(source, oldest, 0, first, rows, originX, 0, first * columnWidth, height);
        if (count > first) {
          frame.drawImage(source, 0, 0, count - first, rows,
            originX + first * columnWidth, 0, (count - first) * columnWidth, height);
        }
      } finally {
        frame.imageSmoothingEnabled = smoothing;
      }
    },
  };
}

function createRingCanvas(target: CanvasRenderingContext2D, width: number, height: number): RingCanvas | undefined {
  const document = (target.canvas as HTMLCanvasElement | undefined)?.ownerDocument;
  if (document) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas as unknown as RingCanvas;
  }
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height) as unknown as RingCanvas;
  return undefined;
}

/** A colormap packed as RGBA pixels (ImageData byte order on either endianness). */
function packColormap(colormap: Colormap): Uint32Array {
  const table = new Uint32Array(COLOR_STEPS);
  const bytes = new Uint8ClampedArray(table.buffer);
  for (let step = 0; step < COLOR_STEPS; step += 1) {
    const [red, green, blue] = colormap(step / (COLOR_STEPS - 1));
    const offset = step * 4;
    bytes[offset] = red;
    bytes[offset + 1] = green;
    bytes[offset + 2] = blue;
    bytes[offset + 3] = 255;
  }
  return table;
}
