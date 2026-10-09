// @webmusic/audio/analyze/element - complete observed-attribute surfaces.

import type {ElementParamCatalog} from './types';

const ENTRY = '@webmusic/audio/analyze/element';

const PLAYER = {
  name: 'player',
  kind: 'text',
  placeholder: '#session',
  fallback: 'unbound - waiting for an explicit analyser',
  note: 'Unique audio-player selector in the current root. The tool borrows its analyser only while playing.',
} as const;

const METER_TYPES = ['vu', 'loudness', 'waveform', 'oscilloscope', 'spectrum', 'spectrogram', 'stereometer'] as const;

function meterTypes(...values: Array<(typeof METER_TYPES)[number]>) {
  return {attribute: 'type', values, fallback: 'vu'} as const;
}

export const AUDIO_ANALYZE_PARAMS: ElementParamCatalog = {
  'audio-meter': {
    tag: 'audio-meter',
    entry: ENTRY,
    params: [
      {name: 'player', kind: 'text', placeholder: '#session', fallback: 'use .analyser or .context', note: 'Borrow the central player output analyser; late insertion and source replacement are observed.'},
      {name: 'type', kind: 'enum', options: [...METER_TYPES], fallback: 'vu — needle dial with peak and clip lamps', note: 'Select the display: VU, loudness bars, scrolling waveform, oscilloscope, spectrum, spectrogram or stereometer. The graph stays connected.'},
      {name: 'theme', kind: 'enum', options: ['mono', 'color'], fallback: 'mono — intensity as a surface-to-ink grey ramp', note: 'mono paints sound with the page greys; color adds hue for frequency and a colormap for intensity.'},
      {name: 'size', kind: 'enum', options: ['sm', 'md', 'lg'], fallback: 'md — height up to the 144px surface tier', note: 'Preset cap for the adaptive height: the kit surface tiers of 72, 144 or 216px. Width stays fluid.'},
      {name: 'width', kind: 'text', placeholder: '320 or 20rem', fallback: 'fluid — fills the container', note: 'Explicit host width as a CSS length; a bare number is pixels.'},
      {name: 'height', kind: 'text', placeholder: '160 or 10rem', fallback: 'adaptive — follows the width up to the size cap', note: 'Explicit frame height as a CSS length; a bare number is pixels. Overrides size.'},
      {name: 'mode', kind: 'enum', options: ['level', 'spectrum'], fallback: 'ignored when type is set', note: 'Legacy selector: level maps to the VU dial and spectrum to the spectrum until a type attribute is present.'},
      {name: 'bars', kind: 'number', min: 0, step: 1, fallback: '0 — continuous curve', note: 'Spectrum only: a bar count of at least 4, or 0 for the continuous curve.', when: meterTypes('spectrum')},
      {name: 'aria-label', kind: 'text', placeholder: 'Output level', fallback: 'the type name, such as VU meter', note: 'Accessible monitor name.'},
      {name: 'scale', kind: 'enum', options: ['log', 'mel', 'linear'], fallback: 'log', note: 'Frequency axis of the spectrum and spectrogram.', when: meterTypes('spectrum', 'spectrogram')},
      {name: 'window-seconds', kind: 'number', min: 0.5, step: 0.5, fallback: '4', note: 'History kept by the waveform and spectrogram, in seconds; changing it clears the strip.', when: meterTypes('waveform', 'spectrogram')},
      {name: 'timebase-ms', kind: 'number', min: 0.1, max: 100, step: 0.1, fallback: '20', note: 'Visible oscilloscope span in milliseconds, capped by the analyser window.', when: meterTypes('oscilloscope')},
      {name: 'trigger', kind: 'enum', options: ['rising', 'off'], fallback: 'rising', note: 'Align the oscilloscope to the latest rising zero crossing, or free-run.', when: meterTypes('oscilloscope')},
      {name: 'loudness-mode', kind: 'enum', options: ['momentary', 'short-term', 'rms-fast', 'rms-slow'], fallback: 'momentary — K-weighted 400 ms window', note: 'K-weighted 400 ms or 3 s windows read in LUFS; RMS 300 ms or 1 s windows read in dBFS.', when: meterTypes('loudness')},
      {name: 'reference-dbfs', kind: 'number', min: -40, max: 0, step: 1, fallback: '-18', note: 'Sine level, in dBFS peak, that reads 0 VU.', when: meterTypes('vu')},
      {name: 'fft-size', kind: 'number', min: 32, max: 32768, step: 32, fallback: '1024', note: 'Power-of-two FFT size for an owned tap only; does not retune a borrowed analyser.'},
      {name: 'smoothing-time-constant', kind: 'number', min: 0, max: 1, step: 0.05, fallback: '0.8', note: 'Owned analyser smoothing; a borrowed analyser keeps its own setting.'},
      {name: 'level-scale', kind: 'number', min: 0, step: 0.1, fallback: '1.8', note: 'Display gain of readLevel(), the waveform columns and the stereometer points; the oscilloscope stays 1:1.'},
      {name: 'peak-decay', kind: 'number', min: 0, step: 0.002, fallback: '0.012', note: 'Per-frame decrement of the VU and loudness hold markers, in normalized scale units.'},
    ],
    properties: [
      {name: 'player', note: 'Borrow an AudioMeterPlayer object instead of a selector.'},
      {name: 'context', note: 'Build an owned transparent input-analyser-output tap in a caller-supplied BaseAudioContext.'},
      {name: 'analyser', note: 'Borrow an existing AnalyserNode; the meter adds at most one output edge for its stereo branch.'},
      {name: 'input / output', note: 'Read-only ports of an owned transparent tap; absent for a borrowed analyser.'},
      {name: 'type / theme', note: 'Reflected display type and palette.'},
      {name: 'snapshot', note: 'Read-only latest painted reduction, typed by display, or undefined without a source.'},
    ],
    events: [{name: 'webaudio:error', note: 'A read, scheduling, stereo-branch or tuning failure; error value is the event detail.'}],
  },
  'audio-level-analyzer': {
    tag: 'audio-level-analyzer',
    entry: ENTRY,
    params: [
      PLAYER,
      {name: 'threshold-dbfs', kind: 'number', min: -60, max: 0, step: 1, fallback: '-12',
        note: 'Sample-peak comparison threshold; the control and threshold line update together.'},
    ],
    properties: [
      {name: 'analyser', note: 'Optional caller-owned AnalyserNode; takes precedence over player.'},
      {name: 'thresholdDbfs', note: 'Reflected threshold, clamped to -60 through 0 dBFS.'},
      {name: 'sample', note: 'Read-only latest sampled {rmsDbfs, peakDbfs}; undefined before a frame.'},
      {name: 'heldPeakDbfs', note: 'Read-only sample-peak hold; the UI Reset hold command clears it.'},
      {name: 'frozen', note: 'Read-only visual freeze state; the UI Freeze command toggles it.'},
    ],
    events: [
      {name: 'webaudio:levelchange', note: '{rmsDbfs, peakDbfs, crestDb, heldPeakDbfs, thresholdDbfs} per accepted sample.'},
      {name: 'webaudio:error', note: '{error} when the live graph cannot start or frames stall.'},
    ],
  },
  'audio-spectrum-analyzer': {
    tag: 'audio-spectrum-analyzer',
    entry: ENTRY,
    params: [
      PLAYER,
      {name: 'frozen', kind: 'bool', fallback: 'false', note: 'Hold the currently drawn FFT frame for inspection.'},
      {name: 'peak-hold', kind: 'bool', fallback: 'false', note: 'Overlay the highest observed bin levels until Reset peaks.'},
      {name: 'min-frequency', kind: 'number', min: 1, max: 20000, step: 1, fallback: '20', note: 'Lower frequency of the logarithmic display.'},
      {name: 'max-frequency', kind: 'number', min: 2, max: 24000, step: 1, fallback: '20000', note: 'Upper frequency of the logarithmic display, limited by source Nyquist.'},
      {name: 'aria-label', kind: 'text', fallback: 'Spectrum analyzer', note: 'Accessible name of the inspection surface.'},
    ],
    properties: [
      {name: 'analyser', note: 'Optional caller-owned AnalyserNode; borrowed FFT settings are not changed.'},
      {name: 'frozen / peakHold', note: 'Reflected display modes.'},
      {name: 'minFrequency / maxFrequency', note: 'Reflected display frequency bounds in Hz.'},
      {name: 'selectedFrequency', note: 'Read-only probed frequency in Hz.'},
      {name: 'frame', note: 'Read-only latest frequency frame, or undefined before sampling.'},
      {name: 'resetPeaks()', note: 'Clear the displayed peak-hold trace without changing the audio graph.'},
    ],
    events: [
      {name: 'webaudio:spectrumprobe', note: '{frequency, decibels?} after pointer or keyboard frequency inspection.'},
      {name: 'webaudio:error', note: '{error} when the live graph cannot start or frames stall.'},
    ],
  },
  'audio-oscilloscope': {
    tag: 'audio-oscilloscope',
    entry: ENTRY,
    params: [
      PLAYER,
      {name: 'frozen', kind: 'bool', fallback: 'false', note: 'Hold the current sampled window and stop polling.'},
      {name: 'timebase-ms', kind: 'number', min: 0.1, max: 100, step: 0.1, fallback: '10', note: 'Requested visible milliseconds, bounded by the borrowed analyser window.'},
      {name: 'trigger-level', kind: 'number', min: -1, max: 1, step: 0.05, fallback: '0', note: 'Linear sample-amplitude threshold for edge alignment.'},
      {name: 'trigger-edge', kind: 'enum', options: ['rising', 'falling', 'off'], fallback: 'rising', note: 'Align a rising or falling crossing, or show the latest untriggered window.'},
      {name: 'aria-label', kind: 'text', fallback: 'Oscilloscope', note: 'Accessible inspection surface name.'},
    ],
    properties: [
      {name: 'analyser', note: 'Optional caller-owned AnalyserNode; takes precedence over player.'},
      {name: 'frozen / timebaseMs / triggerLevel / triggerEdge', note: 'Reflected inspection controls.'},
      {name: 'trace', note: 'Read-only copied waveform window and trigger state, or undefined before sampling.'},
      {name: 'selectedTimeMs', note: 'Read-only probe position relative to the visible window.'},
    ],
    events: [
      {name: 'webaudio:oscilloscopeprobe', note: '{timeMs, amplitude?} after keyboard or pointer inspection.'},
      {name: 'webaudio:error', note: '{error} when the live graph cannot start or frames stall.'},
    ],
  },
  'audio-transient-analyzer': {
    tag: 'audio-transient-analyzer',
    entry: ENTRY,
    params: [
      PLAYER,
      {name: 'sensitivity', kind: 'number', min: 0, max: 1, step: 0.05, fallback: '0.55', note: 'Higher sensitivity lowers the attack threshold; the tool control updates this attribute.'},
      {name: 'min-interval-ms', kind: 'number', min: 50, max: 1000, step: 10, fallback: '160', note: 'Minimum spacing between emitted live attack cues in milliseconds.'},
    ],
    properties: [
      {name: 'analyser', note: 'Optional caller-owned AnalyserNode; takes precedence over player.'},
      {name: 'sensitivity / minIntervalMs', note: 'Reflected detection controls.'},
      {name: 'sample', note: 'Latest normalized {strength, hit} cue observation, if available.'},
      {name: 'hitCount / frozen', note: 'Read-only inspection count and freeze state.'},
      {name: 'reset()', note: 'Clear detection history without changing the source graph.'},
    ],
    events: [
      {name: 'webaudio:transient', note: '{timeMs, strength, threshold, intervalMs?} on an accepted approximate attack cue.'},
      {name: 'webaudio:error', note: '{error} when the live graph cannot start or frames stall.'},
    ],
  },
};
