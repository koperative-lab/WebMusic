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

export const AUDIO_ANALYZE_PARAMS: ElementParamCatalog = {
  'audio-meter': {
    tag: 'audio-meter',
    entry: ENTRY,
    params: [
      {name: 'player', kind: 'text', placeholder: '#session', fallback: 'use .analyser or .context', note: 'Borrow the central player output analyser; late insertion and source replacement are observed.'},
      {name: 'mode', kind: 'enum', options: ['level', 'spectrum'], fallback: 'level', note: 'Choose normalized level or FFT bars; changing modes remounts the presenter.'},
      {name: 'bars', kind: 'number', min: 4, step: 1, fallback: '28', note: 'Spectrum bar count, minimum 4; remounts the presenter.'},
      {name: 'aria-label', kind: 'text', placeholder: 'Output level', fallback: 'Audio level, or Spectrum', note: 'Accessible monitor name.'},
      {name: 'fft-size', kind: 'number', min: 32, max: 32768, step: 32, fallback: '1024', note: 'Power-of-two FFT size for an owned tap only; does not retune a borrowed analyser.'},
      {name: 'smoothing-time-constant', kind: 'number', min: 0, max: 1, step: 0.05, fallback: '0.8', note: 'Owned analyser smoothing; a borrowed analyser keeps its own setting.'},
      {name: 'level-scale', kind: 'number', min: 0, step: 0.1, fallback: '1.8', note: 'Multiplier for the normalized RMS and peak display.'},
      {name: 'peak-decay', kind: 'number', min: 0, step: 0.002, fallback: '0.012', note: 'Absolute per-read decrement of the held scaled-RMS marker.'},
    ],
    properties: [
      {name: 'player', note: 'Borrow an AudioMeterPlayer object instead of a selector.'},
      {name: 'context', note: 'Build an owned transparent input-analyser-output tap in a caller-supplied BaseAudioContext.'},
      {name: 'analyser', note: 'Borrow an existing AnalyserNode; it is never disconnected by the meter.'},
      {name: 'input / output', note: 'Read-only ports of an owned transparent tap; absent for a borrowed analyser.'},
    ],
    events: [{name: 'webaudio:error', note: 'A read, scheduling or tuning failure; error value is the event detail.'}],
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
