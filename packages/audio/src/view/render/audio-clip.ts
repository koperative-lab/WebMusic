import {
  AudioEditError, audioBeatGridBeatFrames, audioChannelLayout, audioSequenceTempoGrid, createAudioSequence, createMemoryAudioAssetStore, makeId,
  type AudioAssetLease, type AudioBeatGrid, type AudioAssetReader, type AudioAssetStore, type AudioClip, type AudioDraftResult,
  type AudioEditOperation, type AudioEditResult, type AudioFrameRange, type AudioSequence, type AudioSequenceAnnotation,
} from '../../core';
import {
  AUDIO_FADE_CURVES, audioFadeLength, audioRangeFadeOperations, audioRangeGainOperations, audioRangeSilenceOperations,
  audioSegmentFadeEnvelope, audioSegmentSpans, decibelsToGain, editAudioEnvelope, gainToDecibels, nearestAudioZeroCrossing,
  type AudioFadeCurve, type AudioSegmentSpan,
} from '../core/clip-edits';
import {snapToTempoGrid, tapTempo, tempoGridLines, type TempoGrid} from '@webmusic/kernel/transport';
import type {AudioViewEditing} from '../headless/audio-editing';
import {createAudioSequenceWaveform, type AudioSequenceWaveform} from '../headless/sequence-waveform';

/** Editing features a clip view can offer. Range selection and the cursor are always available while editing. */
export type AudioClipFeature = 'split' | 'delete' | 'clipboard' | 'trim' | 'silence' | 'gain' | 'fade' |
  'envelope' | 'markers' | 'grid' | 'process' | 'snap' | 'zoom' | 'history';
export const AUDIO_CLIP_FEATURES: readonly AudioClipFeature[] = Object.freeze(['split', 'delete', 'clipboard', 'trim',
  'silence', 'gain', 'fade', 'envelope', 'markers', 'grid', 'process', 'snap', 'zoom', 'history']);
/** Pointer tool: `select` selects ranges and drags handles; `split` cuts at a click; `envelope` edits gain points. */
export type AudioClipTool = 'select' | 'split' | 'envelope';
/**
 * Snapping for the cursor, range edges and markers. `grid` (the snap button)
 * snaps to the finest drawn line: beat-grid subdivisions while the beat grid is
 * shown, else the ruler's quarter ticks. The others are fixed: zero crossings,
 * time steps, or beats and bars of the document's beat grid.
 */
export type AudioClipSnap = 'off' | 'grid' | 'zero' | '10ms' | '100ms' | '1s' | 'beat' | 'bar';
export const AUDIO_CLIP_SNAPS: readonly AudioClipSnap[] = Object.freeze(['off', 'grid', 'zero', '10ms', '100ms', '1s', 'beat', 'bar']);
/** Beats-per-bar choices offered by the grid meter card. */
export const AUDIO_CLIP_GRID_METERS: readonly number[] = Object.freeze([2, 3, 4, 5, 6, 7, 8, 12]);
export const AUDIO_CLIP_PROCESSES = Object.freeze(['normalize', 'reverse', 'invert', 'remove-dc'] as const);

/** Clip view state a user can change from the toolbar, keyboard or wheel. Every value is also an option. */
export interface AudioClipSettings {
  readonly tool: AudioClipTool;
  readonly snap: AudioClipSnap;
  /** Draw segment gain envelopes over the waveform. */
  readonly envelopes: boolean;
  /**
   * Horizontal zoom in pixels per second; 0 fits the whole clip to the width.
   * Omitted as an option, the view opens at a working zoom: eight bars of the
   * beat grid, else ten seconds (or the whole clip when shorter).
   */
  readonly pixelsPerSecond: number;
  /** Vertical waveform magnification, 1–16. */
  readonly amplitude: number;
  /** Curve used by fade commands and fade handles. */
  readonly fadeCurve: AudioFadeCurve;
  /** Draw the document's beat grid and use it for beat snap, quantize and beat jump. */
  readonly grid: boolean;
  /** Ruler seeks land on a beat, keeping the playing beat phase. */
  readonly quantize: boolean;
  /** Grid Edit mode: the toolbar shows the grid tools and dragging moves the grid. Needs the `grid` feature. */
  readonly gridEdit: boolean;
}

export interface AudioClipOptions extends Partial<AudioClipSettings> {
  features?: readonly AudioClipFeature[];
  /** Total height of the channel lanes in CSS pixels; default 180. */
  height?: number;
  /** Keep the playhead in view while playback advances. */
  followPlayback?: boolean;
  onPreview?(result: Extract<AudioDraftResult, {status: 'preview'}>): void;
  onCommit?(result: Extract<AudioEditResult, {status: 'committed'}>): void;
  onError?(error: unknown): void;
  /**
   * A click on the ruler asks the application to move playback; seconds on
   * the document timeline. `quantized` marks a beat target from a quantized
   * click: a playing transport should keep its beat phase (Kernel `tempoGridJump`).
   */
  onSeek?(seconds: number, detail?: {readonly quantized: boolean}): void;
  /**
   * PageUp/PageDown beat jump while playback is shown: move playback by whole
   * beats, keeping its phase. Without it, or without playback, the cursor moves.
   */
  onBeatJump?(beats: number): void;
  /** A toolbar, keyboard or wheel change; `configure` calls do not report. */
  onSettingsChange?(settings: AudioClipSettings, changed: keyof AudioClipSettings): void;
}

/** What the clip view draws: a decoded clip (read-only) or a borrowed editing controller. */
export type AudioClipContent = {readonly clip: AudioClip} | {readonly editing: AudioViewEditing};

/** Playhead overlay; `seconds: null` hides it. */
export interface AudioClipPlayback { readonly seconds: number | null }

export interface AudioClipHandle {
  readonly element: HTMLElement;
  readonly settings: AudioClipSettings;
  readonly features: readonly AudioClipFeature[];
  /** Visible span in seconds. */
  visibleRange(): {readonly startSeconds: number; readonly endSeconds: number};
  /** `autoZoom: true` re-applies the initial working zoom (as when `pixelsPerSecond` is omitted). */
  configure(options: Partial<AudioClipSettings> & {features?: readonly AudioClipFeature[]; followPlayback?: boolean; autoZoom?: boolean}): void;
  updatePlayback(playback?: AudioClipPlayback): void;
  cancel(): void;
  dispose(): void;
}

/** A borrowed editor that can also run range processors (`AudioClipEditor`). */
interface ProcessingEditor {
  readonly processorDescriptors?: readonly {readonly id: string; readonly version: number}[];
  processRange?(request: Record<string, unknown>, options?: {readonly signal?: AbortSignal}): Promise<{readonly status: string; readonly error?: unknown}>;
  cancelProcessing?(): void;
}

const RULER = 24;
const HANDLE = 8;
const ZOOM_STEP = 1.5;
/** Seconds shown by the initial working zoom without a beat grid, and bars with one. */
const AUTO_ZOOM_SECONDS = 10;
const AUTO_ZOOM_BARS = 8;
/** Narrowest spacing of drawn grid lines, in CSS pixels. */
const GRID_LINE_SPACING = 10;
/**
 * Zoom per wheel delta pixel. Chromium reports a trackpad pinch as Ctrl+wheel
 * with deltaY = −100 × ln(scale), so this rate follows the fingers exactly;
 * one event's delta is clamped so a mouse wheel notch (≈100) zooms about 1.5×.
 */
const WHEEL_ZOOM_RATE = .01;
const WHEEL_ZOOM_CLAMP = 40;
/** Trailing delay before continuous zoom and amplitude changes are reported. */
const SETTINGS_REPORT_MS = 150;
const MAX_PPS = 48_000;
const PROCESS_LABELS: Record<string, string> = {normalize: 'Normalize', reverse: 'Reverse', invert: 'Invert', 'remove-dc': 'Remove DC offset'};
const SNAP_LABELS: Record<AudioClipSnap, string> = {off: 'Off', grid: 'Grid', zero: 'Zero crossings', '10ms': '10 ms', '100ms': '100 ms', '1s': '1 s', beat: 'Beat', bar: 'Bar'};
/** Grid fine adjustment: one click moves 1 ms (Shift 10 ms) or changes tempo by 0.01 BPM (Shift 0.1). */
const GRID_SHIFT_MS = 1;
const GRID_TEMPO_STEP = .01;
/** A tap run commits its tempo after this much silence. */
const TAP_COMMIT_MS = 1500;
const CURVE_LABELS: Record<AudioFadeCurve, string> = {linear: 'Linear', logarithmic: 'Logarithmic', cosine: 'Cosine'};

const ICONS: Record<string, string> = {
  select: '<path d="M6 4v15l4-4 3 6 2-1-3-6h6z"/>',
  split: '<path d="M12 3v18"/><path d="M5 8l4 4-4 4M19 8l-4 4 4 4"/>',
  envelope: '<path d="M3 17l5-9 5 6 4-8 4 5"/><path d="M7 7h2v2H7zM12 13h2v2h-2zM16 5h2v2h-2z"/>',
  cut: '<path d="M6 6l12 12M18 6L6 18"/><path d="M4 4h4v4H4zM16 16h4v4h-4z"/>',
  copy: '<path d="M8 8h12v12H8z"/><path d="M4 16V4h12"/>',
  paste: '<path d="M6 5h12v16H6z"/><path d="M9 3h6v4H9z"/>',
  delete: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  trim: '<path d="M4 6v12M20 6v12"/><path d="M8 12h8"/><path d="M8 9v6M16 9v6"/>',
  silence: '<path d="M3 12h18"/><path d="M7 9v6M17 9v6"/>',
  'fade-in': '<path d="M3 19L21 5v14z"/>',
  'fade-out': '<path d="M3 5l18 14H3z"/>',
  curve: '<path d="M3 19c8 0 10-14 18-14"/>',
  marker: '<path d="M6 3v18"/><path d="M6 4h11l-3 4 3 4H6"/>',
  process: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><path d="M14 4h4v4h-4zM8 10h4v4H8zM16 16h4v4h-4z"/>',
  snap: '<path d="M6 5h4v7a2 2 0 0 0 4 0V5h4v7a6 6 0 0 1-12 0z"/><path d="M6 9h4M14 9h4"/>',
  envelopes: '<path d="M3 18l6-10 5 7 7-11"/>',
  undo: '<path d="M9 14l-5-5 5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h4"/>',
  'zoom-out': '<path d="M12 5v14"/><path d="M3 12h6M6.5 9.5L9 12l-2.5 2.5M21 12h-6M17.5 9.5L15 12l2.5 2.5"/>',
  'zoom-in': '<path d="M12 5v14"/><path d="M4 12h5M6.5 9.5L4 12l2.5 2.5M20 12h-5M17.5 9.5L20 12l-2.5 2.5"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  values: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><path d="M14 5h4v4h-4zM8 15h4v4H8z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  grid: '<path d="M4 4v16M9.5 4v16M15 4v16M20 4v16"/><path d="M4 4h3"/>',
  'grid-edit': '<path d="M4 4v16M9 4v16"/><path d="M13 20l1-4 5-5 3 3-5 5z"/>',
  'grid-downbeat': '<path d="M12 4v16"/><path d="M7 4h10l-5 5z"/>',
  'grid-tap': '<path d="M7 21l3.5-17h3L17 21z"/><path d="M12 16l6-9"/>',
  'grid-earlier': '<path d="M3 12l4-3v6z"/><path d="M11 6v12M15 6v12M19 6v12"/>',
  'grid-later': '<path d="M5 6v12M9 6v12M13 6v12"/><path d="M21 12l-4-3v6z"/>',
  'grid-expand': '<path d="M2 12l3-3v6z"/><path d="M8 6v12M12 6v12M16 6v12"/><path d="M22 12l-3-3v6z"/>',
  'grid-shrink': '<path d="M6 12L3 9v6z"/><path d="M10 6v12M12 6v12M14 6v12"/><path d="M18 12l3-3v6z"/>',
  'grid-double': '<path d="M5 6v12M8 6v12M11 6v12M14 6v12"/>',
  'grid-half': '<path d="M5 6v12M12 6v12"/>',
  'grid-meter': '<path d="M5 19h14"/><path d="M8 19V8M12 19V5M16 19v-8"/>',
  'grid-clear': '<path d="M4 4v16M9 4v16M14 4v6"/><path d="M14 14l6 6M20 14l-6 6"/>',
};

const STYLE = `
:where([data-audio-clip]) {
  --ac-ink: var(--wm-foreground, light-dark(#111, #eee));
  --ac-muted: var(--wm-foreground-muted, light-dark(#777, #aaa));
  --ac-line: var(--wm-control-border, var(--wm-border, light-dark(#d8d8d8, #333)));
  --ac-surface: var(--wm-audio-clip-background, var(--wm-surface, light-dark(#fff, #111)));
  --ac-raised: var(--wm-surface-muted, light-dark(#f3f3f3, #1c1c1c));
  --ac-on-ink: var(--wm-accent-foreground, light-dark(#fff, #111));
  --ac-wave: var(--wm-audio-clip-wave, var(--wm-foreground, light-dark(#111, #eee)));
  --ac-active: var(--wm-audio-clip-playhead, rgb(240, 84, 119));
  --ac-control: var(--wm-control-size, 2rem);
  --ac-mono: var(--wm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  position: relative; display: flex; flex-direction: column; min-width: 0; overflow: hidden;
  color: var(--ac-ink); background: var(--ac-surface);
  border: var(--wm-component-border, 1px solid var(--wm-border, light-dark(#d8d8d8, #333))); border-radius: var(--wm-component-radius, var(--wm-control-radius, 0));
}
:where([data-audio-clip] [part~="toolbar"]) {
  display: flex; flex-wrap: nowrap; align-items: stretch; min-width: 0; height: var(--ac-control); flex: none;
  overflow-x: auto; scrollbar-width: none; border-bottom: 1px solid var(--ac-line);
}
:where([data-audio-clip] [part~="toolbar"])::-webkit-scrollbar, :where([data-audio-clip] [part~="viewport"])::-webkit-scrollbar { display: none; }
:where([data-audio-clip] [part~="toolbar-group"]) { display: flex; flex: none; border-right: 1px solid var(--ac-line); }
:where([data-audio-clip] [part~="toolbar-spacer"]) { flex: 1 1 auto; }
:where([data-audio-clip] [part~="toolbar"] button) {
  display: inline-flex; align-items: center; justify-content: center; flex: none; min-width: var(--ac-control); height: var(--ac-control);
  padding: 0 .375rem; margin: 0; border: 0; border-radius: 0; background: transparent; color: var(--ac-muted); cursor: pointer;
  font: 500 .6875rem/1 var(--ac-mono);
}
:where([data-audio-clip] [part~="toolbar"] button:hover) { color: var(--ac-ink); background: var(--ac-raised); }
:where([data-audio-clip] [part~="toolbar"] button[aria-pressed="true"], [data-audio-clip] [part~="toolbar"] button[aria-expanded="true"]) { color: var(--ac-on-ink); background: var(--ac-ink); }
:where([data-audio-clip] [part~="toolbar"] button:disabled) { opacity: .3; cursor: default; background: transparent; color: var(--ac-muted); }
:where([data-audio-clip] button:focus-visible, [data-audio-clip] [part~="viewport"]:focus-visible, [data-audio-clip] [part~="hud"]:focus-visible) {
  outline: var(--wm-focus-ring, 2px solid var(--ac-ink)); outline-offset: -2px;
}
:where([data-audio-clip] svg[data-icon]) { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: square; stroke-linejoin: miter; }
:where([data-audio-clip] [part~="message"]) {
  display: flex; align-items: center; flex: 0 1 auto; min-width: 0; padding: 0 .5rem; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  color: var(--ac-muted); font: .6875rem/1 var(--ac-mono); text-transform: uppercase; letter-spacing: .06em;
}
:where([data-audio-clip] [part~="viewport"]) { position: relative; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; outline: none; }
:where([data-audio-clip] [part~="canvas"]) { position: relative; }
:where([data-audio-clip] [part~="stage"]) { position: sticky; left: 0; top: 0; overflow: hidden; }
:where([data-audio-clip] [part~="stage"] canvas, [data-audio-clip] [part~="stage"] > svg) { position: absolute; left: 0; top: 0; display: block; }
:where([data-audio-clip][data-editable] [part~="stage"]) { cursor: text; }
:where([data-audio-clip][data-tool="split"] [part~="stage"]) { cursor: col-resize; }
:where([data-audio-clip][data-tool="envelope"] [part~="stage"]) { cursor: crosshair; }
:where([data-audio-clip][data-grid-edit] [part~="stage"]) { cursor: ew-resize; }
:where([data-audio-clip] [part~="toolbar"] [part~="bpm"]) {
  box-sizing: border-box; flex: none; width: 4.75rem; height: var(--ac-control); margin: 0; padding: 0 .375rem; border: 0; border-radius: 0;
  background: var(--ac-surface); color: var(--ac-ink); font: .75rem/1 var(--ac-mono); text-align: right; -moz-appearance: textfield;
}
:where([data-audio-clip] [part~="bpm"])::-webkit-inner-spin-button, :where([data-audio-clip] [part~="bpm"])::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
:where([data-audio-clip] [part~="bpm"]:focus-visible) { outline: var(--wm-focus-ring, 2px solid var(--ac-ink)); outline-offset: -2px; }
:where([data-audio-clip] [part~="toolbar"] button [data-readout]) { margin-left: .125rem; }
:where([data-audio-clip] [part~="hud"]) {
  position: absolute; top: calc(${RULER}px + 6px); left: 6px; display: flex; align-items: center; gap: .375rem; height: 1.5rem; padding: 0 .5rem;
  background: var(--ac-surface); border: 1px solid var(--ac-line); color: var(--ac-ink); font: .6875rem/1 var(--ac-mono); cursor: ns-resize; user-select: none; touch-action: none;
}
:where([data-audio-clip] [part~="hud"]::before) { content: ""; width: .625rem; height: .625rem; border: 1px solid currentColor; border-radius: 50%; }
:where([data-audio-clip] [part~="overlay"]) {
  position: absolute; inset: var(--ac-control) 0 0 0; display: flex; justify-content: center; align-items: flex-start; padding: .75rem;
  background: var(--wm-audio-clip-scrim, rgb(0 0 0 / .45)); z-index: 2;
}
:where([data-audio-clip] [part~="card"]) { width: min(100%, 20rem); background: var(--ac-surface); border: 1px solid var(--ac-line); box-shadow: 0 8px 24px rgb(0 0 0 / .18); }
:where([data-audio-clip] [part~="card-header"]) { display: flex; align-items: center; justify-content: space-between; height: var(--ac-control); padding-left: .5rem; border-bottom: 1px solid var(--ac-line); }
:where([data-audio-clip] [part~="card-header"] h2) { margin: 0; font: 500 .6875rem/1 var(--ac-mono); text-transform: uppercase; letter-spacing: .08em; color: var(--ac-muted); }
:where([data-audio-clip] [part~="card"] button) {
  display: inline-flex; align-items: center; justify-content: center; gap: .375rem; height: var(--ac-control); min-width: var(--ac-control); margin: 0; padding: 0 .5rem;
  border: 0; border-radius: 0; background: transparent; color: var(--ac-ink); font: .6875rem/1 var(--ac-mono); cursor: pointer;
}
:where([data-audio-clip] [part~="card"] button:hover) { background: var(--ac-raised); }
:where([data-audio-clip] [part~="card"] button:disabled) { opacity: .3; cursor: default; }
:where([data-audio-clip] [part~="choices"]) { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--ac-line); }
:where([data-audio-clip] [part~="choices"] > *) { background: var(--ac-surface); }
:where([data-audio-clip] [part~="choices"] [aria-pressed="true"]) { background: var(--ac-ink); color: var(--ac-on-ink); }
:where([data-audio-clip] [part~="fields"]) { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; padding: .5rem; }
:where([data-audio-clip] [part~="fields"] label) { display: grid; gap: .25rem; color: var(--ac-muted); font: .625rem/1 var(--ac-mono); text-transform: uppercase; letter-spacing: .06em; }
:where([data-audio-clip] [part~="fields"] input) {
  box-sizing: border-box; width: 100%; height: var(--ac-control); padding: 0 .375rem; border: 1px solid var(--ac-line); border-radius: 0;
  background: var(--ac-surface); color: var(--ac-ink); font: .75rem/1 var(--ac-mono);
}
:where([data-audio-clip] [part~="actions"]) { display: flex; justify-content: flex-end; gap: 1px; border-top: 1px solid var(--ac-line); }
:where([data-audio-clip] [part~="actions"] [data-primary]) { background: var(--ac-ink); color: var(--ac-on-ink); }
:where([data-audio-clip] [part~="offscreen"]) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
`;

type Drag =
  | {kind: 'range'; pointerId: number; anchor: number; moved: boolean; x: number}
  | {kind: 'fade'; pointerId: number; span: AudioSegmentSpan; side: 'in' | 'out'; revision: number}
  | {kind: 'gain'; pointerId: number; span: AudioSegmentSpan; y: number; gain: number; revision: number}
  | {kind: 'envelope'; pointerId: number; span: AudioSegmentSpan; index: number; revision: number}
  | {kind: 'marker'; pointerId: number; id: string; offset: number; revision: number}
  | {kind: 'hud'; pointerId: number; y: number; decibels: number; range: AudioFrameRange; revision: number}
  | {kind: 'grid'; pointerId: number; x: number; frame: number; grid: AudioBeatGrid; moved: boolean; revision: number};

/**
 * A waveform editor in the manner of Audition's waveform view and DAW clip
 * editors: a time ruler with markers, one lane per channel, segment boundaries,
 * fade handles, segment gain lines, gain envelopes and a gain HUD. With an
 * editable borrowed controller every gesture and key is one atomic command.
 */
export function mountAudioClip(host: HTMLElement, content: AudioClipContent, options: AudioClipOptions = {}): AudioClipHandle {
  const document = host.ownerDocument;
  const editing = 'editing' in content ? content.editing : undefined;
  if (editing && !editing.state.available) throw new AudioEditError('disposed', 'The editing view is unavailable');
  let features = parseFeatures(options.features ?? AUDIO_CLIP_FEATURES);
  let settings = normalizeSettings({tool: 'select', snap: 'off', envelopes: false, pixelsPerSecond: 0, amplitude: 1, fadeCurve: 'linear',
    grid: false, quantize: false, gridEdit: false}, options, features);
  let followPlayback = options.followPlayback ?? true;
  const laneTotal = Math.max(60, Math.round(options.height ?? 180));

  // ---- the drawn document
  let ownedStore: AudioAssetStore | undefined;
  let ownedLease: AudioAssetLease | undefined;
  let assets: AudioAssetReader;
  let sequence: AudioSequence;
  if (editing) {
    assets = editing.state.document.assets;
    sequence = visible();
  } else {
    const clip = (content as {clip: AudioClip}).clip;
    if (!clip.channels()) throw new AudioEditError('invalid-sequence', 'The clip view needs decoded samples; streaming clips cannot be drawn');
    ownedStore = createMemoryAudioAssetStore();
    ownedLease = ownedStore.registerClip(clip);
    assets = ownedStore;
    sequence = createAudioSequence({sampleRate: clip.sampleRate, channelLayout: audioChannelLayout(clip.numberOfChannels),
      segments: [{kind: 'asset', id: 'clip', assetId: ownedLease.assetIds[0], sourceStart: 0, sourceEnd: clip.length}]}, ownedStore);
  }
  // Hold every aligned peak bin of the clip (two per 256 frames, bounded), so
  // zooming back to a level never rereads PCM.
  const waveform: AudioSequenceWaveform = createAudioSequenceWaveform(sequence, assets,
    {cacheEntries: Math.min(131_072, Math.max(16_384, Math.ceil(sequence.length / 256) * 2 + 4096))});
  let spans = audioSegmentSpans(sequence);
  let disposed = false;
  let playbackSeconds: number | null = null;
  let drag: Drag | undefined;
  let openCard: string | undefined;
  let processing: AbortController | undefined;
  let frame = 0;
  let taps: number[] = [];
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  let autoZoom = options.pixelsPerSecond === undefined;
  let pendingZoom: {factor: number; anchorX: number} | undefined;
  let reportTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingReports = new Set<keyof AudioClipSettings>();
  let canvasSize = '';
  /** True while a frame callback applies queued zoom; paints then happen synchronously. */
  let inFrame = false;
  /** Geometry of the last paint, so a scroll event it already covers is skipped. */
  let lastPaint = {scroll: -1, pps: -1};

  function visible(): AudioSequence {
    return editing!.state.interaction.draft?.content ?? editing!.state.document.content;
  }

  // ---- DOM
  const root = document.createElement('section');
  root.dataset.audioClip = '';
  root.setAttribute('part', 'clip');
  root.setAttribute('aria-label', 'Audio clip');
  const style = document.createElement('style');
  style.textContent = STYLE;
  const toolbar = document.createElement('div');
  toolbar.setAttribute('part', 'toolbar');
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Audio editing');
  const viewport = document.createElement('div');
  viewport.setAttribute('part', 'viewport');
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', 'Waveform');
  const canvasBox = document.createElement('div');
  canvasBox.setAttribute('part', 'canvas');
  const stage = document.createElement('div');
  stage.setAttribute('part', 'stage');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('part', 'waveform');
  canvas.setAttribute('aria-hidden', 'true');
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('part', 'marks');
  overlay.setAttribute('aria-hidden', 'true');
  // Audition-style gain HUD: drag up or down, or press Up/Down while focused.
  const hud = document.createElement('button');
  hud.type = 'button';
  hud.setAttribute('part', 'hud');
  hud.title = 'Amplify: drag up or down, or press Up and Down';
  stage.append(canvas, overlay, hud);
  canvasBox.append(stage);
  viewport.append(canvasBox);
  const instructions = document.createElement('p');
  instructions.id = makeId('audio-clip-help');
  instructions.setAttribute('part', 'offscreen');
  instructions.textContent = 'Drag to select a range; click to place the cursor. Arrow keys move the cursor, Shift extends. Delete removes the range, Ctrl or Cmd with C, X, V copies, cuts and pastes, with T trims and with K splits. M adds a marker. Plus and minus zoom. G shows the beat grid; Page Up and Page Down jump by a bar. In Grid Edit, drag to move the grid, brackets nudge it, comma and period change the tempo, T taps the tempo and D sets the downbeat at the cursor.';
  const live = document.createElement('p');
  live.setAttribute('part', 'offscreen');
  live.setAttribute('role', 'status');
  root.append(style, toolbar, viewport, instructions, live);
  host.append(root);

  // ---- toolbar
  const buttons = new Map<string, HTMLButtonElement>();
  const icon = (name: string) => `<svg data-icon viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const button = (name: string, label: string, run: (event: MouseEvent) => void): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.setAttribute('part', 'tool-button');
    element.dataset.clipAction = name;
    element.setAttribute('aria-label', label);
    element.title = label;
    element.innerHTML = icon(name);
    element.addEventListener('click', (event) => { if (!disposed) run(event); });
    buttons.set(name, element);
    return element;
  };
  const group = (name: string, ...children: HTMLElement[]) => {
    const element = document.createElement('div');
    element.setAttribute('part', 'toolbar-group');
    element.dataset.group = name;
    element.append(...children);
    return element;
  };
  const toolGroup = group('tools', button('select', 'Select (V)', () => setSetting('tool', 'select')),
    button('split', 'Razor (R)', () => setSetting('tool', 'split')), button('envelope', 'Envelope (E)', () => setSetting('tool', 'envelope')));
  const clipboardGroup = group('clipboard', button('cut', 'Cut', () => clipboard('cut')), button('copy', 'Copy', () => clipboard('copy')),
    button('paste', 'Paste at cursor', () => clipboard('paste')));
  const editGroup = group('edit', button('delete', 'Delete range', () => deleteRange()), button('trim', 'Trim to range', () => trimRange()),
    button('silence', 'Silence range', () => silenceRange()));
  const fadeGroup = group('fade', button('fade-in', 'Fade in range', () => fadeRange('in')), button('fade-out', 'Fade out range', () => fadeRange('out')),
    button('curve', 'Fade curve', () => toggleCard('curve')));
  const markerGroup = group('markers', button('marker', 'Add marker (M)', () => addMarker()));
  const gridGroup = group('grid', button('grid', 'Beat grid (G)', () => setSetting('grid', !settings.grid)),
    button('grid-edit', 'Grid Edit', () => setSetting('gridEdit', !settings.gridEdit)));
  const bpm = document.createElement('input');
  bpm.type = 'number';
  bpm.setAttribute('part', 'bpm');
  bpm.min = '1'; bpm.max = '999'; bpm.step = '0.01';
  bpm.setAttribute('aria-label', 'Tempo in beats per minute');
  bpm.title = 'Tempo (BPM)';
  bpm.addEventListener('change', () => {
    const value = Number(bpm.value);
    if (Number.isFinite(value) && value > 0 && value <= 999) setTempo(value, 'Set tempo');
    else { syncChrome(); fail(new RangeError('Tempo must be between 1 and 999 BPM')); }
  });
  bpm.addEventListener('keydown', (event) => { if (event.key === 'Escape') { bpm.blur(); syncChrome(); } event.stopPropagation(); });
  const readout = (element: HTMLButtonElement, text: string): HTMLButtonElement => {
    const value = document.createElement('span');
    value.dataset.readout = '';
    value.textContent = text;
    element.append(value);
    return element;
  };
  const gridAnchorGroup = group('grid-anchor', button('grid-downbeat', 'Set downbeat at cursor (D)', () => setDownbeat()));
  const gridTempoGroup = group('grid-tempo', bpm, button('grid-tap', 'Tap tempo (T)', () => tap(performanceSeconds())));
  const step = (event: MouseEvent | KeyboardEvent) => event.shiftKey ? 10 : 1;
  const gridShiftGroup = group('grid-shift', button('grid-earlier', 'Move grid earlier ([, Shift ×10)', (event) => shiftGrid(-GRID_SHIFT_MS * step(event))),
    button('grid-later', 'Move grid later (], Shift ×10)', (event) => shiftGrid(GRID_SHIFT_MS * step(event))));
  const gridStretchGroup = group('grid-stretch', button('grid-expand', 'Widen beats, slower (comma, Shift ×10)', (event) => stretchGrid(-GRID_TEMPO_STEP * step(event))),
    button('grid-shrink', 'Narrow beats, faster (period, Shift ×10)', (event) => stretchGrid(GRID_TEMPO_STEP * step(event))));
  const gridScaleGroup = group('grid-scale', readout(button('grid-double', 'Double the tempo', () => scaleGrid(2)), '×2'),
    readout(button('grid-half', 'Halve the tempo', () => scaleGrid(.5)), '×½'));
  const gridMeterGroup = group('grid-meter', readout(button('grid-meter', 'Beats per bar', () => toggleCard('grid-meter')), '4'),
    button('grid-clear', 'Remove the beat grid', () => clearGrid()));
  const gridEditGroups = [gridAnchorGroup, gridTempoGroup, gridShiftGroup, gridStretchGroup, gridScaleGroup, gridMeterGroup];

  const processGroup = group('process', button('process', 'Process range', () => toggleCard('process')));
  const viewGroup = group('view', button('snap', 'Snap to grid', () => setSetting('snap', settings.snap === 'off' ? 'grid' : 'off')), button('envelopes', 'Show envelopes', () => setSetting('envelopes', !settings.envelopes)));
  const message = document.createElement('div');
  message.setAttribute('part', 'message');
  message.setAttribute('role', 'status');
  const spacer = document.createElement('div');
  spacer.setAttribute('part', 'toolbar-spacer');
  const historyGroup = group('history', button('undo', 'Undo', () => history('undo')), button('redo', 'Redo', () => history('redo')));
  const zoomGroup = group('zoom', button('zoom-out', 'Zoom out (−)', () => zoomBy(1 / ZOOM_STEP)), button('zoom-in', 'Zoom in (+)', () => zoomBy(ZOOM_STEP)),
    button('fit', 'Fit the clip', () => setSetting('pixelsPerSecond', 0)));
  const valuesGroup = group('values', button('values', 'Frame values', () => toggleCard('values')));
  for (const name of ['curve', 'process', 'values', 'grid-meter']) buttons.get(name)!.setAttribute('aria-haspopup', 'dialog');
  toolbar.append(toolGroup, clipboardGroup, editGroup, fadeGroup, markerGroup, gridGroup, ...gridEditGroups, processGroup, viewGroup,
    message, spacer, historyGroup, zoomGroup, valuesGroup);

  // ---- cards
  const scrim = document.createElement('div');
  scrim.setAttribute('part', 'overlay');
  const card = document.createElement('div');
  card.setAttribute('part', 'card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  scrim.append(card);
  root.append(scrim);
  show(scrim, false);
  scrim.addEventListener('pointerdown', (event) => { if (event.target === scrim) closeCard(); });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeCard(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...card.querySelectorAll<HTMLElement>('button:not(:disabled), input')];
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    focusable[event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length]?.focus();
  });

  function cardShell(title: string): HTMLElement {
    card.replaceChildren();
    const header = document.createElement('div');
    header.setAttribute('part', 'card-header');
    const heading = document.createElement('h2');
    heading.id = `${instructions.id}-card`;
    heading.textContent = title;
    card.setAttribute('aria-labelledby', heading.id);
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('part', 'card-close');
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = icon('close');
    close.addEventListener('click', () => closeCard());
    header.append(heading, close);
    card.append(header);
    return card;
  }

  function choiceGrid<T extends string>(values: readonly T[], labels: Record<string, string>, current: T, choose: (value: T) => void): HTMLElement {
    const grid = document.createElement('div');
    grid.setAttribute('part', 'choices');
    for (const value of values) {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('part', 'choice');
      option.dataset.value = value;
      option.textContent = labels[value] ?? value;
      option.setAttribute('aria-pressed', String(value === current));
      option.addEventListener('click', () => { choose(value); closeCard(); });
      grid.append(option);
    }
    return grid;
  }

  function field(parent: HTMLElement, label: string, value: string, name: string): HTMLInputElement {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.value = value;
    input.name = name;
    input.setAttribute('aria-label', label);
    wrapper.append(input);
    parent.append(wrapper);
    return input;
  }

  function actions(...items: Array<[string, () => void, boolean?]>): HTMLElement {
    const row = document.createElement('div');
    row.setAttribute('part', 'actions');
    for (const [label, run, primary] of items) {
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = label;
      if (primary) action.dataset.primary = '';
      action.addEventListener('click', () => { try { run(); } catch (error) { fail(error); } });
      row.append(action);
    }
    return row;
  }

  function toggleCard(kind: string): void {
    if (openCard === kind) { closeCard(); return; }
    openCard = kind;
    if (kind === 'curve') cardShell('Fade curve').append(choiceGrid(AUDIO_FADE_CURVES, CURVE_LABELS, settings.fadeCurve, (value) => setSetting('fadeCurve', value)));
    else if (kind === 'process') buildProcessCard();
    else if (kind === 'grid-meter') {
      const current = sequence.beatGrid?.beatsPerBar ?? 4;
      cardShell('Beats per bar').append(choiceGrid(AUDIO_CLIP_GRID_METERS.map(String), Object.fromEntries(AUDIO_CLIP_GRID_METERS.map((value) => [String(value), `${value} beats`])),
        String(current), (value) => setMeter(Number(value))));
    }
    else buildValuesCard();
    show(scrim, true);
    syncChrome();
    (card.querySelector<HTMLElement>('[aria-pressed="true"], input, [part~="choices"] button, [part~="actions"] button') ?? card.querySelector<HTMLElement>('button'))?.focus();
  }

  function closeCard(): void {
    if (!openCard) return;
    const trigger = buttons.get(openCard);
    openCard = undefined;
    show(scrim, false);
    syncChrome();
    trigger?.focus();
  }

  function buildProcessCard(): void {
    const shell = cardShell('Process range');
    const available = processors();
    const fields = document.createElement('div');
    fields.setAttribute('part', 'fields');
    const target = field(fields, 'Normalize to dB', '-1', 'target');
    target.step = '0.1'; target.max = '0';
    const grid = document.createElement('div');
    grid.setAttribute('part', 'choices');
    for (const kind of AUDIO_CLIP_PROCESSES) {
      const option = document.createElement('button');
      option.type = 'button';
      option.setAttribute('part', 'choice');
      option.dataset.value = kind;
      option.textContent = PROCESS_LABELS[kind];
      option.disabled = !available.some((item) => item.id === kind);
      option.addEventListener('click', () => {
        const decibels = Number(target.value);
        closeCard();
        void runProcessor(kind, kind === 'normalize' ? {targetPeak: Math.min(1, decibelsToGain(Number.isFinite(decibels) ? Math.min(0, decibels) : -1))} : {});
      });
      grid.append(option);
    }
    shell.append(grid, fields);
    if (processing) shell.append(actions(['Cancel processing', () => { (editing?.editor as ProcessingEditor | undefined)?.cancelProcessing?.(); processing?.abort(); }]));
  }

  function buildValuesCard(): void {
    const shell = cardShell('Frame values');
    const fields = document.createElement('div');
    fields.setAttribute('part', 'fields');
    const range = selection();
    const start = field(fields, 'Start frame', String(range.startFrame), 'start');
    const end = field(fields, 'End frame', String(range.endFrame), 'end');
    const silence = field(fields, 'Silence frames', String(Math.round(sequence.sampleRate)), 'silence');
    const gain = field(fields, 'Range gain dB', '0', 'gain');
    gain.step = '0.1';
    const frames = () => {
      const a = Number(start.value), b = Number(end.value);
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < a || b > sequence.length) throw new RangeError('Frames must be integers within the clip');
      select({startFrame: a, endFrame: b});
    };
    shell.append(fields, actions(
      ['Select', () => { frames(); closeCard(); }],
      ['Insert silence', () => {
        const length = Number(silence.value);
        if (!Number.isSafeInteger(length) || length < 1) throw new RangeError('Silence length must be a positive integer');
        frames();
        run('Insert silence', [{type: 'insert-silence', frame: selection().startFrame, length, id: makeId('segment'), rightId: makeId('segment')}]);
        closeCard();
      }],
      ['Apply gain', () => {
        const decibels = Number(gain.value);
        if (!Number.isFinite(decibels)) throw new RangeError('Gain must be a number of decibels');
        frames();
        amplify(selectionOrAll(), decibels);
        closeCard();
      }, true],
    ));
  }

  // ---- state helpers
  const canEdit = () => Boolean(editing && editing.state.available && editing.state.editable && !disposed);
  const has = (feature: AudioClipFeature) => features.includes(feature);
  /** Grid Edit is live only while editing is possible and the feature is offered. */
  const gridMode = () => settings.gridEdit && has('grid') && canEdit();
  /** The drawn document's grid on its seconds axis. */
  const tempo = (): TempoGrid | undefined => audioSequenceTempoGrid(sequence);
  const performanceSeconds = () => (document.defaultView?.performance?.now() ?? Date.now()) / 1000;
  const committed = () => editing?.state.available ? editing.state.document.content : sequence;
  const selection = (): AudioFrameRange => editing?.state.available ? editing.state.interaction.selection : {startFrame: 0, endFrame: 0};
  const selectionOrAll = (): AudioFrameRange => {
    const range = selection();
    return range.endFrame > range.startFrame ? range : {startFrame: 0, endFrame: committed().length};
  };
  const say = (text: string) => { live.textContent = text; };
  const flash = (text: string) => { message.textContent = text; message.title = text; };
  const seconds = (frames: number) => frames / sequence.sampleRate;
  const describe = (range: AudioFrameRange) => range.endFrame > range.startFrame
    ? `Selected ${formatTime(seconds(range.startFrame))} to ${formatTime(seconds(range.endFrame))}`
    : `Cursor at ${formatTime(seconds(range.startFrame))}`;

  function fail(error: unknown): void {
    const text = error instanceof Error ? error.message : String(error);
    flash(text); say(text);
    options.onError?.(error);
  }

  function completed(result: AudioEditResult): boolean {
    if (result.status === 'failed') { fail(result.error); return false; }
    flash('');
    if (result.status === 'committed') { options.onCommit?.(result); say(result.change.label); }
    return true;
  }

  function run(label: string, operations: readonly AudioEditOperation[]): boolean {
    if (!editing || !canEdit() || !operations.length) return false;
    cancelDrag();
    return completed(editing.execute(label, operations));
  }

  function select(range: AudioFrameRange): void {
    if (!editing?.state.available) return;
    const length = committed().length;
    const start = Math.max(0, Math.min(length, Math.min(range.startFrame, range.endFrame)));
    const end = Math.max(0, Math.min(length, Math.max(range.startFrame, range.endFrame)));
    editing.select({startFrame: start, endFrame: end});
    say(describe({startFrame: start, endFrame: end}));
  }

  function processors(): readonly {readonly id: string; readonly version: number}[] {
    return (editing?.editor as ProcessingEditor | undefined)?.processorDescriptors ?? [];
  }

  // ---- geometry
  function pixelsPerSecond(): number {
    if (autoZoom) {
      const width = viewport.clientWidth || host.getBoundingClientRect().width;
      if (width > 0) {
        // Open at a working zoom: eight bars of the beat grid, else ten seconds.
        const grid = tempo();
        const shown = Math.min(seconds(sequence.length), grid ? AUTO_ZOOM_BARS * grid.beatsPerBar * 60 / grid.bpm : AUTO_ZOOM_SECONDS);
        autoZoom = false;
        settings = Object.freeze({...settings, pixelsPerSecond: shown > 0 ? Math.min(MAX_PPS, Math.round(width / shown * 1000) / 1000) : 0});
      }
    }
    if (settings.pixelsPerSecond > 0) return settings.pixelsPerSecond;
    const width = viewport.clientWidth || host.getBoundingClientRect().width || 600;
    return Math.max(1e-3, width / Math.max(seconds(sequence.length), 1e-3));
  }

  /** Grid lines per beat drawn at this zoom: bars only (1 / beatsPerBar), beats, or halves down to 1/32. */
  function gridDivision(grid: TempoGrid): number | undefined {
    const beatPixels = 60 / grid.bpm * (painting?.pps ?? pixelsPerSecond());
    if (beatPixels * grid.beatsPerBar < 4) return undefined;
    if (beatPixels < 6) return 1 / grid.beatsPerBar;
    let division = 1;
    while (division < 32 && beatPixels / (division * 2) >= GRID_LINE_SPACING) division *= 2;
    return division;
  }

  /** Ruler label interval in seconds at this zoom; quarter ticks fall between labels. */
  function rulerStep(): number {
    const steps = [.001, .005, .01, .05, .1, .25, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const pps = painting?.pps ?? pixelsPerSecond();
    return steps.find((value) => value * pps >= 80) ?? 600;
  }
  // A paint reads layout once: interleaving DOM writes with scrollLeft or
  // clientWidth reads forces a page layout per mark.
  let painting: {readonly scroll: number; readonly pps: number} | undefined;
  const scrollX = () => painting?.scroll ?? viewport.scrollLeft;
  const framesPerPixel = () => sequence.sampleRate / (painting?.pps ?? pixelsPerSecond());
  const xOf = (frame: number) => frame / framesPerPixel() - scrollX();
  const frameAt = (x: number) => Math.max(0, Math.min(sequence.length, Math.round((x + viewport.scrollLeft) * framesPerPixel())));
  const laneHeight = () => laneTotal / sequence.channelLayout.length;
  const gainY = (gain: number) => {
    // -40 dB at the bottom of the first lane, +12 dB at its top.
    const decibels = Math.max(-40, Math.min(12, gainToDecibels(gain)));
    return RULER + laneHeight() * (1 - (decibels + 40) / 52);
  };
  const envelopeY = (gain: number) => RULER + laneTotal * (1 - Math.min(2, Math.max(0, gain)) / 2);
  const envelopeGainAt = (y: number) => Math.max(0, Math.min(2, (1 - (y - RULER) / laneTotal) * 2));

  function snapFrame(frame: number): number {
    if (settings.snap === 'off' || !has('snap')) return frame;
    if (settings.snap === 'zero') return nearestAudioZeroCrossing(committed(), assets, frame, Math.round(framesPerPixel() * 8) + 64);
    const clamp = (value: number) => Math.max(0, Math.min(sequence.length, Math.round(value * sequence.sampleRate)));
    if (settings.snap === 'beat' || settings.snap === 'bar') {
      const grid = tempo();
      if (!grid) return frame;
      return clamp(snapToTempoGrid(grid, seconds(frame), {division: settings.snap === 'bar' ? 1 / grid.beatsPerBar : 1}));
    }
    if (settings.snap === 'grid') {
      // The finest drawn line: beat-grid subdivisions, else the ruler's quarter ticks.
      const grid = settings.grid || gridMode() ? tempo() : undefined;
      const division = grid && gridDivision(grid);
      if (grid && division) return clamp(snapToTempoGrid(grid, seconds(frame), {division}));
      const step = rulerStep() / 4;
      return clamp(Math.round(seconds(frame) / step) * step);
    }
    const step = sequence.sampleRate * (settings.snap === '10ms' ? .01 : settings.snap === '100ms' ? .1 : 1);
    return Math.min(sequence.length, Math.round(frame / step) * step);
  }

  // ---- drawing
  function scheduleDraw(): void {
    const view = document.defaultView;
    // Inside a frame callback a new request would paint one frame late, after
    // the scroll position already moved: paint now instead.
    if (!view || inFrame) { if (view) view.cancelAnimationFrame(frame); draw(); return; }
    view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(() => draw());
  }

  function draw(): void {
    if (disposed) return;
    const width = Math.max(1, viewport.clientWidth || host.getBoundingClientRect().width || 600);
    const total = RULER + laneTotal;
    const contentWidth = Math.max(width, Math.ceil(seconds(sequence.length) * pixelsPerSecond()));
    canvasBox.style.width = `${contentWidth}px`;
    canvasBox.style.height = `${total}px`;
    stage.style.width = `${width}px`;
    stage.style.height = `${total}px`;
    const ratio = document.defaultView?.devicePixelRatio ?? 1;
    lastPaint = {scroll: viewport.scrollLeft, pps: pixelsPerSecond()};
    // Reallocating the backing store is costly; resize only when the box changes.
    const size = `${width}x${total}@${ratio}`;
    if (size !== canvasSize) {
      canvasSize = size;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(total * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${total}px`;
      overlay.setAttribute('width', String(width));
      overlay.setAttribute('height', String(total));
      overlay.setAttribute('viewBox', `0 0 ${width} ${total}`);
    }
    const context = canvas.getContext?.('2d');
    const computed = document.defaultView?.getComputedStyle(root);
    const ink = computed?.getPropertyValue('--ac-wave').trim() || '#111';
    const line = computed?.getPropertyValue('--ac-line').trim() || '#d8d8d8';
    if (context) {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, total);
      const lane = laneHeight();
      context.fillStyle = line;
      for (let channel = 0; channel <= sequence.channelLayout.length; channel += 1) context.fillRect(0, RULER + channel * lane - (channel ? .5 : 0), width, 1);
      context.fillStyle = ink;
      const perPixel = framesPerPixel();
      const scroll = viewport.scrollLeft;
      // Columns read whole power-of-two bins aligned to the timeline, so a zoom
      // step reuses the bins cached at the previous one instead of new ranges.
      const binFrames = perPixel > 2 ? 2 ** Math.floor(Math.log2(perPixel)) : 0;
      const channelCount = sequence.channelLayout.length;
      const column = Array.from({length: channelCount}, () => ({min: Infinity, max: -Infinity}));
      for (let x = 0; x < width; x += 1) {
        const a = Math.floor((x + scroll) * perPixel);
        const b = Math.min(sequence.length, Math.max(a + 1, Math.floor((x + 1 + scroll) * perPixel)));
        if (a >= sequence.length) break;
        let peaks: readonly {readonly min: number; readonly max: number}[];
        if (binFrames) {
          for (const peak of column) { peak.min = Infinity; peak.max = -Infinity; }
          for (let start = Math.floor(a / binFrames) * binFrames; start < b; start += binFrames) {
            const values = waveform.readPeaks(start, Math.min(sequence.length, start + binFrames));
            for (let channel = 0; channel < channelCount; channel += 1) {
              if (values[channel].min < column[channel].min) column[channel].min = values[channel].min;
              if (values[channel].max > column[channel].max) column[channel].max = values[channel].max;
            }
          }
          peaks = column;
        } else peaks = waveform.readPeaks(a, b);
        peaks.forEach((peak, channel) => {
          if (!Number.isFinite(peak.min)) return;
          const middle = RULER + channel * lane + lane / 2;
          const scale = lane / 2 * settings.amplitude;
          const top = middle - Math.min(1, peak.max * settings.amplitude) * (lane / 2);
          const bottom = middle - Math.max(-1, peak.min * settings.amplitude) * (lane / 2);
          context.fillRect(x, Math.max(RULER + channel * lane, top), 1, Math.max(1, Math.min(bottom, middle + scale) - top));
        });
      }
    }
    drawMarks(width);
    paintHud();
  }

  let marksTarget: Element | DocumentFragment = overlay;
  function svg(tag: string, attributes: Record<string, string | number>, parent: Element | DocumentFragment = marksTarget): SVGElement {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
    parent.append(element);
    return element;
  }

  function drawMarks(width: number): void {
    painting = {scroll: scrollX(), pps: pixelsPerSecond()};
    const fragment = document.createDocumentFragment();
    marksTarget = fragment;
    try { paintMarks(width); } finally { painting = undefined; marksTarget = overlay; }
    overlay.replaceChildren(fragment);
  }

  function paintMarks(width: number): void {
    const total = RULER + laneTotal;
    // Ruler: ticks at a readable interval.
    const pps = painting?.pps ?? pixelsPerSecond();
    const step = rulerStep();
    svg('rect', {x: 0, y: 0, width, height: RULER, fill: 'var(--ac-surface)'});
    svg('rect', {x: 0, y: RULER - 1, width, height: 1, fill: 'var(--ac-line)'});
    const startSeconds = scrollX() / pps;
    const first = Math.floor(startSeconds / step) * 4;
    for (let index = first; index / 4 * step <= startSeconds + width / pps; index += 1) {
      const t = index / 4 * step;
      const x = t * pps - scrollX();
      if (x < -1) continue;
      if (index % 4) { svg('rect', {x, y: RULER - 4, width: 1, height: 3, fill: 'var(--ac-muted)', 'data-ruler-tick': ''}); continue; }
      svg('rect', {x, y: RULER - 8, width: 1, height: 7, fill: 'var(--ac-muted)'});
      const label = svg('text', {x: x + 3, y: 12, fill: 'var(--ac-muted)', 'font-size': 10, 'font-family': 'var(--ac-mono)'});
      label.textContent = formatTime(t, step);
    }
    // Segment boundaries, names, gain lines and fade handles.
    for (const span of spans) {
      const left = xOf(span.start), right = xOf(span.end);
      if (right < 0 || left > width) continue;
      if (span.start > 0) {
        const boundary = svg('rect', {x: left - .5, y: RULER, width: 1, height: laneTotal, fill: 'var(--ac-muted)', 'data-segment-boundary': span.segment.id});
        boundary.setAttribute('opacity', '.8');
      }
      if (span.segment.kind === 'silence') {
        svg('rect', {x: left, y: RULER, width: Math.max(1, right - left), height: laneTotal, fill: 'var(--ac-raised)', 'data-silence': span.segment.id});
        continue;
      }
      const segment = span.segment;
      if (has('gain') && canEdit() && !gridMode()) {
        const y = gainY(segment.gain);
        svg('line', {x1: left, x2: right, y1: y, y2: y, stroke: 'var(--ac-ink)', 'stroke-width': 1, 'stroke-dasharray': '4 3', 'data-gain-line': segment.id});
      }
      if (has('fade') && canEdit() && !gridMode()) {
        const size = span.end - span.start;
        const fadeIn = audioFadeLength(segment.envelope, size, 'in');
        const fadeOut = audioFadeLength(segment.envelope, size, 'out');
        for (const [side, at] of [['in', span.start + fadeIn], ['out', span.end - fadeOut]] as const) {
          const x = xOf(at);
          svg('rect', {x: x - HANDLE / 2, y: RULER + 1, width: HANDLE, height: HANDLE, fill: 'var(--ac-surface)', stroke: 'var(--ac-ink)', 'stroke-width': 1,
            'data-fade-handle': side, 'data-segment': segment.id});
          if ((side === 'in' && fadeIn) || (side === 'out' && fadeOut)) {
            svg('line', {x1: side === 'in' ? left : right, y1: RULER + laneTotal, x2: x, y2: RULER + 1, stroke: 'var(--ac-ink)', 'stroke-width': 1, opacity: .6});
          }
        }
      }
      if ((settings.envelopes || settings.tool === 'envelope') && has('envelope')) {
        const points = segment.envelope.length ? segment.envelope : [{frame: 0, gain: 1}, {frame: span.end - span.start, gain: 1}];
        const path = points.map((point, index) => `${index ? 'L' : 'M'}${xOf(span.start + point.frame)},${envelopeY(point.gain)}`).join('');
        svg('path', {d: path, fill: 'none', stroke: 'var(--ac-ink)', 'stroke-width': 1.25, 'data-envelope': segment.id});
        if (segment.envelope.length) segment.envelope.forEach((point, index) => {
          const x = xOf(span.start + point.frame);
          if (x < -4 || x > width + 4) return;
          svg('rect', {x: x - 3, y: envelopeY(point.gain) - 3, width: 6, height: 6, fill: 'var(--ac-surface)', stroke: 'var(--ac-ink)',
            'data-envelope-point': index, 'data-segment': segment.id});
        });
      }
    }
    drawGrid(width, total);
    // Markers and regions.
    for (const annotation of sequence.annotations) {
      const x = xOf(annotation.startFrame);
      if (annotation.endFrame !== undefined) {
        const end = xOf(annotation.endFrame);
        svg('rect', {x, y: 0, width: Math.max(1, end - x), height: RULER - 1, fill: 'var(--ac-ink)', opacity: .12});
      }
      if (x < -40 || x > width) continue;
      svg('rect', {x: x - .5, y: 0, width: 1, height: total, fill: 'var(--ac-ink)', opacity: .5});
      const flag = svg('path', {d: `M${x},2h9l-3,4l3,4h-9z`, fill: 'var(--ac-ink)', 'data-marker': annotation.id});
      flag.setAttribute('aria-label', annotation.label ?? 'Marker');
      if (annotation.label) {
        const label = svg('text', {x: x + 12, y: 10, fill: 'var(--ac-ink)', 'font-size': 9, 'font-family': 'var(--ac-mono)'});
        label.textContent = annotation.label;
      }
    }
    // Selection or cursor.
    const range = selection();
    if (editing) {
      const left = xOf(range.startFrame), right = xOf(range.endFrame);
      if (range.endFrame > range.startFrame) {
        svg('rect', {x: left, y: RULER, width: Math.max(1, right - left), height: laneTotal, fill: 'var(--ac-ink)', opacity: .14, 'data-selection': ''});
        svg('rect', {x: left - .5, y: RULER, width: 1, height: laneTotal, fill: 'var(--ac-ink)'});
        svg('rect', {x: right - .5, y: RULER, width: 1, height: laneTotal, fill: 'var(--ac-ink)'});
      } else {
        svg('rect', {x: left - .5, y: 0, width: 1, height: total, fill: 'var(--ac-ink)', 'data-cursor': ''});
      }
    }
    if (playbackSeconds !== null) {
      const x = playbackSeconds * pps - scrollX();
      if (x >= 0 && x <= width) svg('rect', {x: x - 1, y: 0, width: 2, height: total, fill: 'var(--ac-active)', 'data-playhead': ''});
    }
  }

  function drawGrid(width: number, total: number): void {
    const grid = tempo();
    if (!grid || !(settings.grid || gridMode())) return;
    const pps = painting?.pps ?? pixelsPerSecond();
    const division = gridDivision(grid);
    if (!division) return;
    const barPixels = 60 / grid.bpm * pps * grid.beatsPerBar;
    const start = scrollX() / pps;
    const lines = tempoGridLines(grid, start - 1 / pps, start + (width + 1) / pps, division);
    for (const line of lines) {
      const x = line.position * pps - scrollX();
      if (!Number.isInteger(line.beat)) {
        // Subdivisions get fainter the finer they are.
        const fraction = line.beat - Math.floor(line.beat);
        let level = 1;
        while (level < 6 && Math.abs(fraction * 2 ** level - Math.round(fraction * 2 ** level)) > 1e-6) level += 1;
        svg('rect', {x: x - .5, y: RULER, width: 1, height: laneTotal, fill: 'var(--ac-muted)', opacity: Math.max(.08, .22 - level * .03), 'data-grid-sub': ''});
      } else if (line.downbeat) {
        svg('rect', {x: x - .5, y: RULER, width: 1, height: laneTotal, fill: 'var(--ac-ink)', opacity: .55, 'data-grid-bar': line.beat / grid.beatsPerBar + 1});
        if (barPixels >= 28) {
          const label = svg('text', {x: x + 3, y: RULER + 10, fill: 'var(--ac-muted)', 'font-size': 9, 'font-family': 'var(--ac-mono)'});
          label.textContent = String(Math.round(line.beat / grid.beatsPerBar) + 1);
        }
      } else {
        svg('rect', {x: x - .5, y: RULER, width: 1, height: laneTotal, fill: 'var(--ac-muted)', opacity: .35, 'data-grid-beat': line.beat});
      }
    }
    const anchor = grid.anchor * pps - scrollX();
    if (anchor >= -6 && anchor <= width + 6) {
      svg('path', {d: `M${anchor - 5},${RULER - 7}h10l-5,6z`, fill: 'var(--ac-ink)', 'data-grid-anchor': ''});
      if (gridMode()) svg('rect', {x: anchor - .5, y: RULER, width: 1, height: total - RULER, fill: 'var(--ac-ink)', 'data-grid-anchor-line': ''});
    }
  }

  function paintHud(): void {
    const shown = canEdit() && has('gain') && !gridMode();
    show(hud, shown);
    if (!shown) return;
    const decibels = drag?.kind === 'hud' ? drag.decibels : 0;
    hud.textContent = `${decibels >= 0 ? '+' : ''}${decibels.toFixed(1)} dB`;
    const range = selection();
    hud.setAttribute('aria-label', `Amplify ${range.endFrame > range.startFrame ? 'the selection' : 'the whole clip'} by ${decibels.toFixed(1)} decibels; Up and Down change it by 1 dB`);
  }

  // ---- chrome
  function show(node: HTMLElement, shown: boolean): void { node.hidden = !shown; node.style.display = shown ? '' : 'none'; }

  function syncChrome(): void {
    const editable = canEdit();
    root.toggleAttribute('data-editable', editable);
    root.dataset.tool = settings.tool;
    const gridEditing = gridMode();
    root.toggleAttribute('data-grid-edit', gridEditing);
    root.toggleAttribute('data-grid', settings.grid);
    show(toolbar, editable);
    // Grid Edit swaps the content tools for the grid tools, keeping one toolbar row.
    const content = !gridEditing;
    show(buttons.get('split')!, has('split'));
    show(buttons.get('envelope')!, has('envelope'));
    show(toolGroup, content && (has('split') || has('envelope')));
    show(clipboardGroup, content && has('clipboard'));
    show(buttons.get('delete')!, has('delete'));
    show(buttons.get('trim')!, has('trim'));
    show(buttons.get('silence')!, has('silence'));
    show(editGroup, content && (has('delete') || has('trim') || has('silence')));
    show(fadeGroup, content && has('fade'));
    show(markerGroup, content && has('markers'));
    show(gridGroup, has('grid'));
    for (const item of gridEditGroups) show(item, gridEditing);
    show(processGroup, content && has('process') && processors().length > 0);
    show(buttons.get('snap')!, has('snap'));
    show(buttons.get('envelopes')!, has('envelope'));
    show(viewGroup, content && (has('snap') || has('envelope')));
    show(historyGroup, has('history'));
    show(zoomGroup, has('zoom'));
    show(valuesGroup, content);
    buttons.get('grid')!.setAttribute('aria-pressed', String(settings.grid));
    buttons.get('grid-edit')!.setAttribute('aria-pressed', String(gridEditing));
    const grid = sequence.beatGrid;
    if (document.activeElement !== bpm) bpm.value = grid ? grid.bpm.toFixed(2) : '';
    bpm.placeholder = grid ? '' : '—';
    for (const name of ['grid-earlier', 'grid-later', 'grid-expand', 'grid-shrink', 'grid-double', 'grid-half', 'grid-meter', 'grid-clear']) buttons.get(name)!.disabled = !grid;
    buttons.get('grid-meter')!.querySelector('[data-readout]')!.textContent = String(grid?.beatsPerBar ?? 4);
    for (const name of ['select', 'split', 'envelope'] as const) buttons.get(name)!.setAttribute('aria-pressed', String(settings.tool === name));
    buttons.get('envelopes')!.setAttribute('aria-pressed', String(settings.envelopes));
    for (const name of ['curve', 'process', 'values', 'grid-meter']) buttons.get(name)!.setAttribute('aria-expanded', String(openCard === name));
    buttons.get('snap')!.setAttribute('aria-pressed', String(settings.snap !== 'off'));
    buttons.get('snap')!.title = `Snap: ${SNAP_LABELS[settings.snap]}`;
    buttons.get('curve')!.title = `Fade curve: ${CURVE_LABELS[settings.fadeCurve]}`;
    const range = selection();
    const ranged = range.endFrame > range.startFrame;
    for (const name of ['cut', 'copy', 'delete', 'trim', 'silence', 'fade-in', 'fade-out']) buttons.get(name)!.disabled = !ranged;
    buttons.get('paste')!.disabled = !(editing?.editor.getState().clipboard.hasContent);
    buttons.get('process')!.disabled = !ranged && !processing;
    buttons.get('undo')!.disabled = !editing?.state.history.canUndo;
    buttons.get('redo')!.disabled = !editing?.state.history.canRedo;
    if (editable) {
      viewport.setAttribute('tabindex', '0');
      viewport.setAttribute('aria-describedby', instructions.id);
    } else {
      viewport.removeAttribute('tabindex');
      viewport.removeAttribute('aria-describedby');
    }
  }

  function setSetting<K extends keyof AudioClipSettings>(key: K, value: AudioClipSettings[K], report = true, anchorX?: number): void {
    if (settings[key] === value) return;
    if (key === 'gridEdit') { cancelDrag(); finishTap(); }
    const x = anchorX ?? (viewport.clientWidth || 0) / 2;
    const anchor = key === 'pixelsPerSecond' ? frameAt(x) : undefined;
    if (key === 'pixelsPerSecond') autoZoom = false;
    settings = normalizeSettings(settings, {[key]: value} as Partial<AudioClipSettings>, features);
    if (anchor !== undefined) keepAnchored(anchor, x);
    syncChrome();
    // Zoom and amplitude change continuously: paint once per frame and report
    // after the gesture settles, so the host is not re-rendered per wheel event.
    const continuous = key === 'pixelsPerSecond' || key === 'amplitude';
    if (continuous) scheduleDraw(); else draw();
    if (!report) return;
    if (!continuous) { options.onSettingsChange?.(settings, key); return; }
    pendingReports.add(key);
    if (reportTimer !== undefined) clearTimeout(reportTimer);
    reportTimer = setTimeout(flushReports, SETTINGS_REPORT_MS);
  }

  function flushReports(): void {
    if (reportTimer !== undefined) clearTimeout(reportTimer);
    reportTimer = undefined;
    const keys = [...pendingReports];
    pendingReports.clear();
    if (!disposed) for (const key of keys) options.onSettingsChange?.(settings, key);
  }

  /** Size the scrolled content for the current zoom without painting. */
  function layout(): void {
    const width = Math.max(1, viewport.clientWidth || host.getBoundingClientRect().width || 600);
    canvasBox.style.width = `${Math.max(width, Math.ceil(seconds(sequence.length) * pixelsPerSecond()))}px`;
  }

  /** Keep `frame` under the viewport x it was at before a zoom. */
  function keepAnchored(frame: number, x: number): void {
    layout();
    viewport.scrollLeft = Math.max(0, frame / framesPerPixel() - x);
  }

  function zoomBy(factor: number, anchorX?: number): void {
    if (!has('zoom')) return;
    const current = pixelsPerSecond();
    const fit = (viewport.clientWidth || 600) / Math.max(seconds(sequence.length), 1e-3);
    const next = Math.min(MAX_PPS, current * factor);
    setSetting('pixelsPerSecond', next <= fit * 1.001 ? 0 : Math.round(next * 1000) / 1000, true, anchorX);
  }

  // ---- commands
  function clipboard(kind: 'cut' | 'copy' | 'paste'): void {
    if (!editing || !canEdit() || !has('clipboard')) return;
    if (kind === 'copy') {
      const result = editing.copy();
      if (result.status === 'failed') fail(result.error); else { flash(''); say(`Copied ${formatTime(seconds(result.length))}`); syncChrome(); }
      return;
    }
    completed(kind === 'cut' ? editing.cut() : editing.paste());
  }

  function deleteRange(): void {
    if (!has('delete')) return;
    const range = selection();
    if (range.endFrame <= range.startFrame) return;
    if (run('Delete audio', [{type: 'splice', startFrame: range.startFrame, deleteCount: range.endFrame - range.startFrame, segments: [], rightId: makeId('segment')}])) {
      select({startFrame: range.startFrame, endFrame: range.startFrame});
    }
  }

  function trimRange(): void {
    if (!has('trim')) return;
    const range = selection();
    if (range.endFrame > range.startFrame && run('Trim audio', [{type: 'trim', ...range}])) select({startFrame: 0, endFrame: range.endFrame - range.startFrame});
  }

  function guarded(build: () => AudioEditOperation[]): AudioEditOperation[] {
    try { return build(); } catch (error) { fail(error); return []; }
  }

  function silenceRange(): void {
    if (!has('silence')) return;
    const range = selection();
    if (range.endFrame > range.startFrame) run('Silence', guarded(() => audioRangeSilenceOperations(committed(), range, () => makeId('segment'))));
  }

  function fadeRange(direction: 'in' | 'out'): void {
    if (!has('fade')) return;
    const range = selection();
    if (range.endFrame > range.startFrame) {
      run(direction === 'in' ? 'Fade in' : 'Fade out', guarded(() => audioRangeFadeOperations(committed(), range, direction, settings.fadeCurve, () => makeId('segment'))));
    }
  }

  function amplify(range: AudioFrameRange, decibels: number): void {
    if (!has('gain') || !decibels) return;
    run(`Amplify ${decibels > 0 ? '+' : ''}${decibels.toFixed(1)} dB`, guarded(() => audioRangeGainOperations(committed(), range, decibelsToGain(decibels), () => makeId('segment'))));
  }

  function splitAt(frame: number): void {
    if (!has('split')) return;
    const span = spans.find((candidate) => candidate.start < frame && frame < candidate.end);
    if (!span) { flash('Place the cursor inside a segment to split it'); return; }
    run('Split', [{type: 'split', segmentId: span.segment.id, frame: frame - span.start, leftId: makeId('segment'), rightId: makeId('segment')}]);
  }

  function addMarker(): void {
    if (!has('markers')) return;
    const range = selection();
    const count = committed().annotations.length + 1;
    const marker: AudioSequenceAnnotation = range.endFrame > range.startFrame
      ? {id: makeId('marker'), startFrame: range.startFrame, endFrame: range.endFrame, anchoring: 'content', label: `Region ${count}`}
      : {id: makeId('marker'), startFrame: range.startFrame, anchoring: 'content', label: `Marker ${count}`};
    run(range.endFrame > range.startFrame ? 'Add region' : 'Add marker', [{type: 'set-annotations', annotations: [...committed().annotations, marker]}]);
  }

  function removeMarker(id: string): void {
    run('Remove marker', [{type: 'set-annotations', annotations: committed().annotations.filter((annotation) => annotation.id !== id)}]);
  }

  async function runProcessor(kind: string, parameters: Record<string, unknown>): Promise<void> {
    const editor = editing?.editor as (ProcessingEditor & AudioViewEditing['editor']) | undefined;
    const descriptor = processors().find((item) => item.id === kind);
    const range = selection();
    if (!editor?.processRange || !descriptor || !canEdit() || range.endFrame <= range.startFrame || processing) return;
    const controller = new AbortController();
    processing = controller;
    flash(`${PROCESS_LABELS[kind] ?? kind}…`);
    syncChrome();
    try {
      const snapshot = editor.getSnapshot();
      const result = await editor.processRange({documentId: snapshot.documentId, expectedRevision: snapshot.documentRevision, ...range,
        processorId: descriptor.id, processorVersion: descriptor.version, parameters, assetId: makeId('processed'),
        segmentId: makeId('segment'), rightId: makeId('segment'), label: PROCESS_LABELS[kind] ?? kind}, {signal: controller.signal});
      if (disposed) return;
      if (result.status === 'failed') fail(result.error);
      else if (result.status === 'committed') { flash(''); options.onCommit?.(result as Extract<AudioEditResult, {status: 'committed'}>); say(`${PROCESS_LABELS[kind]} applied`); }
      else flash(`Processing ${result.status}`);
    } catch (error) {
      if (!disposed) fail(error);
    } finally {
      if (processing === controller) processing = undefined;
      if (!disposed) syncChrome();
    }
  }

  // ---- beat grid
  function gridOperation(grid: AudioBeatGrid | null): AudioEditOperation[] {
    return [{type: 'set-beat-grid', grid}];
  }

  function setGrid(label: string, grid: AudioBeatGrid | null): boolean {
    if (!has('grid')) return false;
    finishTap();
    return run(label, gridOperation(grid));
  }

  /** Keep an anchor at or after frame 0 by whole bars, so the phase never changes. */
  function anchorInRange(grid: AudioBeatGrid, anchorFrame: number): number {
    const bar = audioBeatGridBeatFrames(grid, sequence.sampleRate) * grid.beatsPerBar;
    let anchor = anchorFrame;
    if (anchor < 0) anchor += Math.ceil(-anchor / bar) * bar;
    return Math.round(anchor * 1000) / 1000;
  }

  function roundTempo(value: number): number { return Math.round(value * 1000) / 1000; }

  function setTempo(value: number, label: string): void {
    const grid = committed().beatGrid;
    const bpmValue = roundTempo(Math.min(999, Math.max(1, value)));
    setGrid(label, grid ? {...grid, bpm: bpmValue} : {bpm: bpmValue, anchorFrame: selection().startFrame, beatsPerBar: 4});
  }

  function shiftGrid(milliseconds: number): void {
    const grid = committed().beatGrid;
    if (!grid) return;
    setGrid('Move beat grid', {...grid, anchorFrame: anchorInRange(grid, grid.anchorFrame + milliseconds / 1000 * sequence.sampleRate)});
  }

  function stretchGrid(delta: number): void {
    const grid = committed().beatGrid;
    if (grid) setTempo(grid.bpm + delta, delta > 0 ? 'Faster beat grid' : 'Slower beat grid');
  }

  function scaleGrid(factor: number): void {
    const grid = committed().beatGrid;
    if (!grid) return;
    const next = grid.bpm * factor;
    if (next < 1 || next > 999) { fail(new RangeError('Tempo must stay between 1 and 999 BPM')); return; }
    setTempo(next, factor > 1 ? 'Double tempo' : 'Halve tempo');
  }

  function setMeter(beatsPerBar: number): void {
    const grid = committed().beatGrid;
    if (grid && grid.beatsPerBar !== beatsPerBar) setGrid('Set beats per bar', {...grid, beatsPerBar});
  }

  function setDownbeat(atPlayhead = false): void {
    const frameValue = atPlayhead && playbackSeconds !== null ? Math.round(playbackSeconds * sequence.sampleRate) : selection().startFrame;
    const grid = committed().beatGrid;
    setGrid('Set downbeat', grid ? {...grid, anchorFrame: frameValue} : {bpm: 120, anchorFrame: frameValue, beatsPerBar: 4});
  }

  function clearGrid(): void {
    if (committed().beatGrid) setGrid('Remove beat grid', null);
  }

  /** One tap; a run previews its tempo and commits after a pause. */
  function tap(time: number): void {
    if (!editing || !canEdit() || !has('grid')) return;
    taps = [...taps.filter((value) => time - value <= 8), time].slice(-16);
    const tapped = tapTempo(taps);
    if (tapTimer !== undefined) clearTimeout(tapTimer);
    tapTimer = setTimeout(() => commitTap(), TAP_COMMIT_MS);
    if (tapped === undefined) { flash('Tap'); return; }
    const grid = committed().beatGrid;
    const next = {bpm: roundTempo(tapped), anchorFrame: grid?.anchorFrame ?? selection().startFrame, beatsPerBar: grid?.beatsPerBar ?? 4};
    previewDrag(gridOperation(next));
    flash(`${next.bpm.toFixed(2)} BPM`);
  }

  function commitTap(): void {
    if (tapTimer !== undefined) clearTimeout(tapTimer);
    tapTimer = undefined;
    taps = [];
    if (!editing || disposed || !editing.state.available) return;
    const draft = editing.state.interaction.draft;
    if (draft && draft.content.beatGrid !== editing.state.document.content.beatGrid) completed(editing.commit('Tap tempo'));
  }

  /** End a tap run now: commit what it measured. */
  function finishTap(): void {
    if (tapTimer !== undefined || taps.length) commitTap();
  }

  function beatJump(beats: number): void {
    const grid = tempo();
    if (!grid) return;
    if (playbackSeconds !== null && options.onBeatJump) { options.onBeatJump(beats); return; }
    const target = Math.round((seconds(selection().startFrame) + beats * 60 / grid.bpm) * sequence.sampleRate);
    const clamped = Math.max(0, Math.min(committed().length, target));
    select({startFrame: clamped, endFrame: clamped});
    revealFrame(clamped);
  }

  function history(kind: 'undo' | 'redo'): void {
    if (!editing || !canEdit() || !has('history')) return;
    cancelDrag();
    completed(kind === 'undo' ? editing.undo() : editing.redo());
  }

  // ---- pointer
  function localPoint(event: PointerEvent | MouseEvent): {x: number; y: number} {
    const box = stage.getBoundingClientRect();
    return {x: event.clientX - box.left, y: event.clientY - box.top};
  }

  function spanAt(frame: number): AudioSegmentSpan | undefined {
    return spans.find((span) => span.start <= frame && frame < span.end) ?? spans[spans.length - 1];
  }

  function previewDrag(operations: AudioEditOperation[]): void {
    if (!editing) return;
    const result = editing.preview(operations);
    if (result.status === 'preview') options.onPreview?.(result);
    else fail(result.error);
  }

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || disposed) return;
    const point = localPoint(event);
    const target = event.target instanceof Element ? event.target : null;
    const grabsGrid = gridMode() && Boolean(committed().beatGrid);
    if (point.y < RULER && !target?.closest('[data-marker]') && !(grabsGrid && target?.closest('[data-grid-anchor]'))) {
      // The ruler moves playback; the application decides whether it can.
      // Quantize lands on a beat; a playing transport keeps its phase.
      const grid = tempo();
      const at = seconds(frameAt(point.x));
      if (settings.quantize && settings.grid && grid) options.onSeek?.(Math.max(0, snapToTempoGrid(grid, at)), {quantized: true});
      else options.onSeek?.(at);
      return;
    }
    if (!editing || !canEdit()) return;
    viewport.focus({preventScroll: true});
    event.preventDefault();
    const capture = () => { try { stage.setPointerCapture?.(event.pointerId); } catch { /* detached */ } };
    const revision = editing.state.document.documentRevision;
    if (gridMode()) {
      // Grid Edit: dragging anywhere moves the whole grid; a click places the cursor.
      finishTap();
      const grid = committed().beatGrid;
      const at = frameAt(point.x);
      if (grid) { drag = {kind: 'grid', pointerId: event.pointerId, x: point.x, frame: at, grid, moved: false, revision}; capture(); }
      else select({startFrame: at, endFrame: at});
      return;
    }
    const marker = target?.closest<SVGElement>('[data-marker]');
    if (marker && has('markers')) {
      const id = marker.dataset.marker!;
      if (event.altKey) { removeMarker(id); return; }
      const annotation = committed().annotations.find((item) => item.id === id);
      if (annotation) { drag = {kind: 'marker', pointerId: event.pointerId, id, offset: frameAt(point.x) - annotation.startFrame, revision}; capture(); }
      return;
    }
    const fade = target?.closest<SVGElement>('[data-fade-handle]');
    if (fade && has('fade') && settings.tool === 'select') {
      const span = spans.find((item) => item.segment.id === fade.dataset.segment);
      if (span) { drag = {kind: 'fade', pointerId: event.pointerId, span, side: fade.dataset.fadeHandle as 'in' | 'out', revision}; capture(); }
      return;
    }
    const pointIndex = target?.closest<SVGElement>('[data-envelope-point]');
    if (pointIndex && has('envelope')) {
      const span = spans.find((item) => item.segment.id === pointIndex.dataset.segment);
      const index = Number(pointIndex.dataset.envelopePoint);
      if (span && span.segment.kind === 'asset') {
        if (event.altKey) {
          run('Remove envelope point', [{type: 'set-envelope', segmentId: span.segment.id, points: editAudioEnvelope(span.segment.envelope, {remove: index})}]);
          return;
        }
        drag = {kind: 'envelope', pointerId: event.pointerId, span, index, revision}; capture();
      }
      return;
    }
    const gainLine = target?.closest<SVGElement>('[data-gain-line]');
    if (gainLine && has('gain') && settings.tool === 'select') {
      const span = spans.find((item) => item.segment.id === gainLine.dataset.gainLine);
      if (span && span.segment.kind === 'asset') { drag = {kind: 'gain', pointerId: event.pointerId, span, y: point.y, gain: span.segment.gain, revision}; capture(); }
      return;
    }
    const at = snapFrame(frameAt(point.x));
    if (settings.tool === 'split') { splitAt(at); return; }
    if (settings.tool === 'envelope' && has('envelope')) {
      const span = spanAt(at);
      if (!span || span.segment.kind !== 'asset') return;
      const segment = span.segment;
      const base = segment.envelope.length ? segment.envelope : [{frame: 0, gain: 1}, {frame: span.end - span.start, gain: 1}];
      const points = editAudioEnvelope(base, {add: {frame: at - span.start, gain: envelopeGainAt(point.y)}});
      run('Add envelope point', [{type: 'set-envelope', segmentId: segment.id, points}]);
      return;
    }
    if (event.detail === 2) {
      // Double-click selects the segment under the pointer.
      const span = spanAt(at);
      if (span) select({startFrame: span.start, endFrame: span.end});
      return;
    }
    const current = selection();
    const anchor = event.shiftKey ? (Math.abs(at - current.startFrame) > Math.abs(at - current.endFrame) ? current.startFrame : current.endFrame) : at;
    select({startFrame: anchor, endFrame: at});
    drag = {kind: 'range', pointerId: event.pointerId, anchor, moved: event.shiftKey, x: point.x};
    capture();
  });

  stage.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId || !editing) return;
    const point = localPoint(event);
    if (drag.kind === 'range') {
      if (!drag.moved && Math.abs(point.x - drag.x) < 3) return;
      drag.moved = true;
      edgeScroll(point.x);
      select({startFrame: drag.anchor, endFrame: snapFrame(frameAt(point.x))});
      return;
    }
    if (editing.state.document.documentRevision !== drag.revision) { cancelDrag(); return; }
    if (drag.kind === 'grid') {
      if (!drag.moved && Math.abs(point.x - drag.x) < 3) return;
      drag.moved = true;
      const delta = (point.x - drag.x) * framesPerPixel();
      previewDrag(gridOperation({...drag.grid, anchorFrame: anchorInRange(drag.grid, drag.grid.anchorFrame + delta)}));
      flash(`Grid ${delta >= 0 ? '+' : '−'}${Math.abs(delta / sequence.sampleRate * 1000).toFixed(1)} ms`);
      return;
    }
    if (drag.kind === 'fade') {
      const {span, side} = drag;
      if (span.segment.kind !== 'asset') return;
      const size = span.end - span.start;
      const length = side === 'in' ? frameAt(point.x) - span.start : span.end - frameAt(point.x);
      previewDrag([{type: 'set-envelope', segmentId: span.segment.id,
        points: audioSegmentFadeEnvelope(span.segment.envelope, size, side, Math.max(0, Math.min(size, length)), settings.fadeCurve)}]);
      flash(`Fade ${side} ${formatTime(seconds(Math.max(0, length)))}`);
    } else if (drag.kind === 'gain') {
      const decibels = gainToDecibels(drag.gain) + (drag.y - point.y) / laneHeight() * 52;
      const gain = decibelsToGain(Math.max(-40, Math.min(12, decibels)));
      previewDrag([{type: 'set-gain', segmentIds: [drag.span.segment.id], gain}]);
      flash(`Gain ${formatDecibels(gain)}`);
    } else if (drag.kind === 'envelope') {
      const {span, index} = drag;
      if (span.segment.kind !== 'asset') return;
      const frame = Math.max(0, Math.min(span.end - span.start, frameAt(point.x) - span.start));
      previewDrag([{type: 'set-envelope', segmentId: span.segment.id,
        points: editAudioEnvelope(span.segment.envelope, {move: index, to: {frame, gain: envelopeGainAt(point.y)}})}]);
    } else if (drag.kind === 'marker') {
      const id = drag.id, offset = drag.offset;
      const annotations = committed().annotations.map((annotation) => {
        if (annotation.id !== id) return annotation;
        const start = Math.max(0, Math.min(sequence.length - 1, snapFrame(frameAt(point.x) - offset)));
        const span = annotation.endFrame === undefined ? undefined : annotation.endFrame - annotation.startFrame;
        return {...annotation, startFrame: span === undefined ? start : Math.min(start, sequence.length - span),
          ...(span === undefined ? {} : {endFrame: Math.min(start, sequence.length - span) + span})};
      });
      previewDrag([{type: 'set-annotations', annotations}]);
    }
  });

  function finishDrag(event: PointerEvent, commit: boolean): void {
    if (!drag || drag.pointerId !== event.pointerId || !editing) return;
    const ended = drag;
    drag = undefined;
    if (ended.kind === 'range') { syncChrome(); return; }
    if (ended.kind === 'hud') return;
    if (ended.kind === 'grid' && !ended.moved) {
      if (commit) select({startFrame: ended.frame, endFrame: ended.frame});
      return;
    }
    if (!commit || !editing.state.interaction.draft || editing.state.document.documentRevision !== ended.revision) { editing.cancel(); draw(); return; }
    const labels = {fade: 'Fade', gain: 'Change segment gain', envelope: 'Move envelope point', marker: 'Move marker', grid: 'Move beat grid'} as const;
    completed(editing.commit(labels[ended.kind]));
  }
  stage.addEventListener('pointerup', (event) => finishDrag(event, true));
  stage.addEventListener('pointercancel', (event) => finishDrag(event, false));
  stage.addEventListener('lostpointercapture', (event) => finishDrag(event as PointerEvent, false));
  stage.addEventListener('dblclick', (event) => {
    const marker = event.target instanceof Element ? event.target.closest<SVGElement>('[data-marker]') : null;
    if (marker && canEdit() && has('markers')) removeMarker(marker.dataset.marker!);
  });

  function edgeScroll(x: number): void {
    const width = viewport.clientWidth;
    // Scroll only a laid-out viewport, and only while the drag nears an edge.
    if (!width) return;
    if (x > width - 16) viewport.scrollLeft += 24;
    else if (x < 16) viewport.scrollLeft -= 24;
  }

  // ---- gain HUD
  hud.addEventListener('pointerdown', (event) => {
    if (!editing || !canEdit() || !has('gain') || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    drag = {kind: 'hud', pointerId: event.pointerId, y: event.clientY, decibels: 0, range: selectionOrAll(), revision: editing.state.document.documentRevision};
    try { hud.setPointerCapture?.(event.pointerId); } catch { /* detached */ }
  });
  hud.addEventListener('pointermove', (event) => {
    if (!drag || drag.kind !== 'hud' || drag.pointerId !== event.pointerId || !editing) return;
    const decibels = Math.round(Math.max(-40, Math.min(24, (drag.y - event.clientY) / 4)) * 10) / 10;
    if (decibels === drag.decibels) return;
    drag.decibels = decibels;
    if (decibels) previewDrag(guarded(() => audioRangeGainOperations(committed(), (drag as {range: AudioFrameRange}).range, decibelsToGain(decibels), () => makeId('segment'))));
    else editing.cancel();
    paintHud();
  });
  const endHud = (event: PointerEvent, commit: boolean) => {
    if (!drag || drag.kind !== 'hud' || drag.pointerId !== event.pointerId || !editing) return;
    const {decibels, revision} = drag;
    drag = undefined;
    if (!commit || !decibels || !editing.state.interaction.draft || editing.state.document.documentRevision !== revision) { editing.cancel(); paintHud(); return; }
    completed(editing.commit(`Amplify ${decibels > 0 ? '+' : ''}${decibels.toFixed(1)} dB`));
    paintHud();
  };
  hud.addEventListener('pointerup', (event) => endHud(event, true));
  hud.addEventListener('pointercancel', (event) => endHud(event, false));
  hud.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    event.stopPropagation();
    amplify(selectionOrAll(), event.key === 'ArrowUp' ? 1 : -1);
  });

  // ---- keyboard
  viewport.addEventListener('keydown', (event) => {
    if (!editing || !canEdit()) return;
    const command = event.metaKey || event.ctrlKey;
    const key = event.key;
    const range = selection();
    const cursor = range.endFrame;
    const nudge = Math.max(1, Math.round(sequence.sampleRate * (event.altKey ? .001 : .01)));
    const move = (to: number) => {
      const target = Math.max(0, Math.min(committed().length, to));
      select(event.shiftKey ? {startFrame: range.startFrame, endFrame: target} : {startFrame: target, endFrame: target});
      revealFrame(target);
    };
    const handled = (() => {
      if (command && (key === 'z' || key === 'Z')) { history(event.shiftKey ? 'redo' : 'undo'); return true; }
      if (command && (key === 'y' || key === 'Y')) { history('redo'); return true; }
      if (command && (key === 'a' || key === 'A')) { select({startFrame: 0, endFrame: committed().length}); return true; }
      if (command && (key === 'c' || key === 'C')) { clipboard('copy'); return true; }
      if (command && (key === 'x' || key === 'X')) { clipboard('cut'); return true; }
      if (command && (key === 'v' || key === 'V')) { clipboard('paste'); return true; }
      if (command && (key === 't' || key === 'T')) { trimRange(); return true; }
      if (command && (key === 'k' || key === 'K')) { splitAt(range.startFrame); return true; }
      if (command && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        const stops = [...new Set([0, committed().length, ...spans.map((span) => span.start), ...committed().annotations.map((item) => item.startFrame)])].sort((a, b) => a - b);
        const next = key === 'ArrowRight' ? stops.find((stop) => stop > cursor) : [...stops].reverse().find((stop) => stop < cursor);
        if (next !== undefined) move(next);
        return true;
      }
      if (command) return false;
      if (key === 'Escape') {
        if (drag) cancelDrag();
        else if (gridMode()) setSetting('gridEdit', false);
        else select({startFrame: cursor, endFrame: cursor});
        return true;
      }
      if ((key === 'PageUp' || key === 'PageDown') && settings.grid && tempo()) {
        const grid = tempo()!;
        beatJump((key === 'PageUp' ? -1 : 1) * grid.beatsPerBar * (event.shiftKey ? 4 : 1));
        return true;
      }
      if ((key === 'g' || key === 'G') && has('grid')) { setSetting('grid', !settings.grid); return true; }
      if (gridMode()) {
        if (key === '[' || key === '{') { shiftGrid(-GRID_SHIFT_MS * step(event)); return true; }
        if (key === ']' || key === '}') { shiftGrid(GRID_SHIFT_MS * step(event)); return true; }
        if (key === ',' || key === '<') { stretchGrid(-GRID_TEMPO_STEP * step(event)); return true; }
        if (key === '.' || key === '>') { stretchGrid(GRID_TEMPO_STEP * step(event)); return true; }
        if (key === 't' || key === 'T') { tap(event.timeStamp / 1000 || performanceSeconds()); return true; }
        if (key === 'd') { setDownbeat(); return true; }
        if (key === 'D') { setDownbeat(true); return true; }
      }
      if (key === 'ArrowLeft') { move(cursor - nudge); return true; }
      if (key === 'ArrowRight') { move(cursor + nudge); return true; }
      if (key === 'Home') { move(0); return true; }
      if (key === 'End') { move(committed().length); return true; }
      if (key === 'Delete' || key === 'Backspace') { deleteRange(); return true; }
      if (key === 'm' || key === 'M') { addMarker(); return true; }
      if (key === 'v' || key === 'V') { setSetting('tool', 'select'); return true; }
      if ((key === 'r' || key === 'R') && has('split')) { setSetting('tool', 'split'); return true; }
      if ((key === 'e' || key === 'E') && has('envelope')) { setSetting('tool', 'envelope'); return true; }
      if (key === '=' || key === '+') { zoomBy(ZOOM_STEP); return true; }
      if (key === '-') { zoomBy(1 / ZOOM_STEP); return true; }
      return false;
    })();
    if (handled) event.preventDefault();
  });

  function revealFrame(target: number): void {
    const x = xOf(target);
    const width = viewport.clientWidth;
    if (x < 0 || x > width) viewport.scrollLeft = Math.max(0, target / framesPerPixel() - width / 2);
  }

  viewport.addEventListener('wheel', (event) => {
    if ((event.ctrlKey || event.metaKey) && has('zoom')) {
      event.preventDefault();
      // Sum a pinch or wheel burst within one frame and zoom proportionally to its deltas.
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
      queueZoom(Math.exp(-Math.max(-WHEEL_ZOOM_CLAMP, Math.min(WHEEL_ZOOM_CLAMP, delta)) * WHEEL_ZOOM_RATE), localPoint(event).x);
    } else if (event.altKey && has('zoom')) {
      event.preventDefault();
      setSetting('amplitude', Math.max(1, Math.min(16, settings.amplitude * (event.deltaY < 0 ? 1.25 : 1 / 1.25))));
    }
  }, {passive: false});
  viewport.addEventListener('scroll', () => {
    // A zoom paints with its new scroll offset in the same frame; skip the echo.
    if (viewport.scrollLeft === lastPaint.scroll && (settings.pixelsPerSecond === lastPaint.pps || !settings.pixelsPerSecond)) return;
    scheduleDraw();
  }, {passive: true});

  /** Apply zoom at most once per frame, anchored at the latest pointer x. */
  function queueZoom(factor: number, anchorX: number): void {
    if (!Number.isFinite(factor) || factor <= 0) return;
    if (pendingZoom) { pendingZoom.factor *= factor; pendingZoom.anchorX = anchorX; return; }
    pendingZoom = {factor, anchorX};
    const view = document.defaultView;
    const apply = () => {
      const zoom = pendingZoom; pendingZoom = undefined;
      if (!zoom || disposed) return;
      inFrame = true;
      try { zoomBy(zoom.factor, zoom.anchorX); } finally { inFrame = false; }
    };
    if (view) view.requestAnimationFrame(apply); else apply();
  }

  // Safari reports a trackpad pinch as gesture events carrying the cumulative scale.
  let gestureScale = 1;
  const gesture = (handler: (event: Event & {scale?: number; clientX?: number}) => void) => (event: Event) => {
    if (!has('zoom')) return;
    event.preventDefault();
    handler(event as Event & {scale?: number; clientX?: number});
  };
  viewport.addEventListener('gesturestart', gesture(() => { gestureScale = 1; }));
  viewport.addEventListener('gesturechange', gesture((event) => {
    const scale = typeof event.scale === 'number' && event.scale > 0 ? event.scale : 1;
    const x = typeof event.clientX === 'number' ? event.clientX - stage.getBoundingClientRect().left : (viewport.clientWidth || 0) / 2;
    queueZoom(scale / gestureScale, x);
    gestureScale = scale;
  }));

  function cancelDrag(): void {
    const active = drag;
    drag = undefined;
    if (active && active.kind !== 'range' && editing?.state.interaction.draft) editing.cancel();
  }

  // ---- lifecycle
  const unsubscribe = editing?.subscribe(() => {
    if (disposed) return;
    if (!editing.state.available) { syncChrome(); return; }
    const next = visible();
    if (next !== sequence) {
      sequence = next;
      waveform.setSequence(next);
      spans = audioSegmentSpans(next);
    }
    if (drag && drag.kind !== 'range' && drag.kind !== 'hud' && editing.state.document.documentRevision !== drag.revision) cancelDrag();
    syncChrome();
    scheduleDraw();
  });
  const view = document.defaultView;
  const observer = view?.ResizeObserver ? new view.ResizeObserver(() => scheduleDraw()) : undefined;
  observer?.observe(viewport);
  syncChrome();
  draw();

  return {
    element: root,
    get settings() { pixelsPerSecond(); return settings; },
    get features() { return features; },
    visibleRange() {
      const pps = pixelsPerSecond();
      const start = viewport.scrollLeft / pps;
      return {startSeconds: start, endSeconds: Math.min(seconds(sequence.length), start + (viewport.clientWidth || 0) / pps)};
    },
    configure(next) {
      const nextFeatures = next.features ? parseFeatures(next.features) : features;
      const nextSettings = normalizeSettings(settings, next, nextFeatures);
      features = nextFeatures;
      settings = nextSettings;
      if (next.autoZoom) autoZoom = true;
      else if (next.pixelsPerSecond !== undefined) autoZoom = false;
      if (next.followPlayback !== undefined) followPlayback = next.followPlayback;
      cancelDrag();
      syncChrome();
      draw();
    },
    updatePlayback(playback) {
      playbackSeconds = playback?.seconds ?? null;
      if (followPlayback && playbackSeconds !== null && !drag) {
        const x = playbackSeconds * pixelsPerSecond() - viewport.scrollLeft;
        const width = viewport.clientWidth;
        if (width && (x < 0 || x > width - 8)) viewport.scrollLeft = Math.max(0, playbackSeconds * pixelsPerSecond() - width * .1);
      }
      drawMarks(Math.max(1, viewport.clientWidth || 600));
    },
    cancel() { cancelDrag(); draw(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelDrag();
      if (tapTimer !== undefined) clearTimeout(tapTimer);
      tapTimer = undefined;
      if (reportTimer !== undefined) clearTimeout(reportTimer);
      reportTimer = undefined;
      pendingZoom = undefined;
      processing?.abort();
      observer?.disconnect();
      view?.cancelAnimationFrame(frame);
      unsubscribe?.();
      waveform.dispose();
      ownedLease?.release();
      ownedStore?.dispose();
      root.remove();
    },
  };
}

function parseFeatures(input: readonly AudioClipFeature[]): AudioClipFeature[] {
  for (const feature of input) if (!AUDIO_CLIP_FEATURES.includes(feature)) throw new RangeError(`Unknown clip feature: ${String(feature)}`);
  return AUDIO_CLIP_FEATURES.filter((feature) => input.includes(feature));
}

/** Parse a `tools` token list; unknown tokens are ignored and absence means all features. */
export function parseAudioClipFeatures(value: string | null | undefined): AudioClipFeature[] {
  if (value === null || value === undefined) return [...AUDIO_CLIP_FEATURES];
  const tokens = value.split(/[\s,]+/).filter(Boolean);
  return AUDIO_CLIP_FEATURES.filter((feature) => tokens.includes(feature));
}

function normalizeSettings(current: AudioClipSettings, next: Partial<AudioClipSettings>, features: readonly AudioClipFeature[]): AudioClipSettings {
  const tool = next.tool ?? current.tool;
  if (!['select', 'split', 'envelope'].includes(tool)) throw new RangeError(`Unknown tool: ${String(tool)}`);
  const snap = next.snap ?? current.snap;
  if (!AUDIO_CLIP_SNAPS.includes(snap)) throw new RangeError(`Unknown snap: ${String(snap)}`);
  const fadeCurve = next.fadeCurve ?? current.fadeCurve;
  if (!AUDIO_FADE_CURVES.includes(fadeCurve)) throw new RangeError(`Unknown fade curve: ${String(fadeCurve)}`);
  const pixelsPerSecond = next.pixelsPerSecond ?? current.pixelsPerSecond;
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond < 0) throw new RangeError('pixelsPerSecond must be 0 (fit) or positive');
  const amplitude = next.amplitude ?? current.amplitude;
  if (!Number.isFinite(amplitude) || amplitude <= 0) throw new RangeError('amplitude must be positive');
  // A tool whose feature is not offered falls back to selection.
  const offered = tool === 'select' || features.includes(tool);
  return Object.freeze({tool: offered ? tool : 'select', snap, fadeCurve, envelopes: next.envelopes ?? current.envelopes,
    pixelsPerSecond: pixelsPerSecond === 0 ? 0 : Math.min(MAX_PPS, Math.max(1e-3, pixelsPerSecond)),
    amplitude: Math.min(16, Math.max(1, amplitude)), grid: Boolean(next.grid ?? current.grid),
    quantize: Boolean(next.quantize ?? current.quantize),
    gridEdit: Boolean(next.gridEdit ?? current.gridEdit) && features.includes('grid')});
}

function formatTime(value: number, step = .001): string {
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  const digits = step < .01 ? 3 : step < .1 ? 2 : step < 1 ? 1 : 0;
  return `${minutes}:${rest.toFixed(digits).padStart(digits ? digits + 3 : 2, '0')}`;
}

function formatDecibels(gain: number): string {
  const decibels = gainToDecibels(gain);
  return Number.isFinite(decibels) ? `${decibels >= 0 ? '+' : ''}${decibels.toFixed(1)} dB` : '−∞ dB';
}
