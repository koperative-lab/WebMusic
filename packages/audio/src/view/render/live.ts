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
