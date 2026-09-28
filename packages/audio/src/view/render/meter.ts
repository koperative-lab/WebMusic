// ============================================================================
// renderLoudnessMeter — compatibility facade over the shared meter presenter.
//
// The public signature and RenderedAudioVisualizer contract remain stable.
// AudioMeterController borrows the analyser; @webmusic/ui owns DOM and rAF.
// ============================================================================

import {mountMeter, type MeterHandle} from '@webmusic/ui/meter';
import type {Region} from '../../core';
import {AudioMeterController} from '../headless/meter';
import type {AnalyserSource, MeterRenderOptions, RenderedAudioVisualizer} from '../core/types';

const DEFAULTS = {
  mode: 'level' as const,
  bars: 28,
  height: 54,
  backgroundColor: 'transparent',
};

/** Narrow an `AnalyserNode | {analyser}` source to its AnalyserNode. */
function resolveAnalyser(source: AnalyserNode | AnalyserSource): AnalyserNode {
  return 'analyser' in source ? source.analyser : source;
}

/**
 * Render a live loudness/spectrum meter into `container`, driven by an
 * `AnalyserNode` (or any `{analyser}` source).
 */
export function renderLoudnessMeter(
  container: HTMLElement,
  source: AnalyserNode | AnalyserSource,
  options: MeterRenderOptions = {},
): RenderedAudioVisualizer {
  const controller = new AudioMeterController({analyser: resolveAnalyser(source)});
  const height = options.height ?? DEFAULTS.height;
  const backgroundColor = options.backgroundColor ?? DEFAULTS.backgroundColor;
  // Each renderer gets a private presenter host. The public renderer has
  // always allowed multiple independent meters in the same caller container,
  // while mountMeter intentionally enforces one presenter per host.
  const host = container.ownerDocument.createElement('div');
  host.style.position = 'relative';
  host.style.width = '100%';
  host.style.height = `${height}px`;
  host.style.overflow = 'hidden';
  host.style.background = backgroundColor;
  container.append(host);

  let presenter: MeterHandle;
  try {
    presenter = mountMeter(
      host,
      {
        readLevel: () => controller.readLevel(),
        readSpectrum: (bars) => controller.readSpectrum(bars),
      },
      {
        mode: options.mode ?? DEFAULTS.mode,
        bars: options.bars ?? DEFAULTS.bars,
        height,
        color: options.color,
        peakColor: options.peakColor,
        backgroundColor,
        label: options.mode === 'spectrum' ? 'Spectrum' : 'Audio level',
      },
    );
    // This meter is the functional viewport inside an already-framed
    // <audio-view> stage. Neutralize the presenter's outer card at its canonical
    // surface layer so a page-wide --wm-component-* theme cannot reintroduce a
    // nested border or padding around the meter geometry.
    presenter.element.style.setProperty('--wm-meter-surface-background', backgroundColor);
    presenter.element.style.setProperty('--wm-meter-surface-border', '0');
    presenter.element.style.setProperty('--wm-meter-surface-padding', '0');
    presenter.element.style.setProperty('--wm-meter-surface-radius', '0');
    // Keep the legacy semantic hooks aligned for older themes.
    presenter.element.style.setProperty('--wm-meter-padding', '0');
    presenter.element.style.setProperty('--wm-meter-radius', '0');
    if (options.backgroundColor !== undefined) {
      presenter.element.style.setProperty('--wm-meter-track', options.backgroundColor);
    }
  } catch (error) {
    host.remove();
    controller.dispose();
    throw error;
  }

  let disposed = false;
  return {
    redraw(): void {
      presenter.redraw();
    },
    setZoom(): void {
      /* no time axis on a meter */
    },
    setRegions(): void {
      /* meters carry no regions */
    },
    hitTest(): {seconds: number; region?: Region} {
      return {seconds: 0};
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      let firstError: unknown;
      try {
        presenter.destroy();
      } catch (error) {
        firstError ??= error;
      }
      try {
        controller.dispose();
      } catch (error) {
        firstError ??= error;
      }
      try {
        host.remove();
      } catch (error) {
        firstError ??= error;
      }
      if (firstError !== undefined) throw firstError;
    },
  };
}
