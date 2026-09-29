import type {AudioPeaks} from '../../core';
import {fitWaveformColumns} from '../headless/waveform';

/** Structural subset shared with `@webmusic/ui`'s CanvasStageFrame. */
export interface AudioCanvasFrame {
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
}

export interface WaveformOverviewOptions {
  color?: string;
}

/**
 * Paint a whole peaks pyramid fitted into one canvas viewport. DOM ownership,
 * sizing and DPR stay with the UI presenter; this adapter only translates the
 * Headless columns into pixels.
 */
export function paintWaveformOverview(
  frame: AudioCanvasFrame,
  peaks: AudioPeaks | undefined,
  options: WaveformOverviewOptions = {},
): void {
  const {context, width, height} = frame;
  context.clearRect(0, 0, width, height);
  if (!peaks || !(width > 0) || !(height > 0)) return;

  const middle = height / 2;
  const scale = height / 2;
  context.fillStyle = options.color ?? 'currentColor';
  for (const column of fitWaveformColumns(peaks, width)) {
    const peak = column.peaks[0];
    if (!peak) continue;
    const top = middle - peak.max * scale;
    const bottom = middle - peak.min * scale;
    context.fillRect(column.x, top, 1, Math.max(1, bottom - top));
  }
}
