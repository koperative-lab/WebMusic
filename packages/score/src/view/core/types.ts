import type {Note} from '../../core';

export interface ViewLayoutOptions {
  /** Finite positive pixels per nominal second; default 30. */
  pixelsPerSecond?: number;
  /** Finite positive pitch-lane height (piano roll) or natural pitch-column width (waterfall). */
  laneHeight?: number;
  /** Finite positive spacing between adjacent staff lines; default 10. */
  staffSpace?: number;
}

/** Domain-level score view mode shared by code and element layers. */
export type ScoreViewType = 'piano-roll' | 'staff' | 'waterfall';

export interface VisualizerRenderOptions {
  /** Show supported score expression directions; default true. False removes their layout space. */
  showAnnotations?: boolean;
  /** Piano-roll pitch-lane height or staff glyph scale, in pixels; default 6. */
  noteHeight?: number;
  /** Gap subtracted from duration rectangles, in pixels; default 1. Zero joins adjacent notes. */
  noteSpacing?: number;
  /** Pixels per nominal second. Scales duration lengths without changing playback; default 30. */
  pixelsPerSecond?: number;
  noteRGB?: string;
  activeNoteRGB?: string;
  /** CSS color for SVG/canvas note surfaces; overrides noteRGB when supplied. */
  noteColor?: string;
  /** CSS color for SVG/canvas active notes; overrides activeNoteRGB when supplied. */
  activeNoteColor?: string;
  minPitch?: number;
  maxPitch?: number;
  /**
   * Viewport virtualization for the SVG piano-roll / waterfall note layers:
   * only the notes intersecting the visible scroll window (± a buffer) are
   * kept in the DOM, and the window is re-computed incrementally on scroll.
   *
   * Default (`undefined`): enabled automatically when the sequence has more
   * than 2000 notes — below that, the always-mounted DOM is cheap and keeps
   * behavior simplest; above it, per-note DOM nodes dominate initial render
   * and reflow cost (50k notes ≈ 50k SVG rects). Pass `true` / `false` to
   * force, or `{bufferScreens}` to enable with a custom buffer
   * (how many extra viewports of notes stay mounted on each side of the
   * visible window; default 1).
   *
   * Additive and backward compatible: active-note highlighting, auto-follow
   * scrolling and `redraw`/`clearActiveNotes` behave identically; notes
   * scrolled out of the window are simply not in the DOM.
   */
  virtualization?: boolean | {bufferScreens?: number};
}

export interface WaterfallRenderOptions extends VisualizerRenderOptions {
  /** Fixed natural-note column width in pixels; default 20 outside the fitted Element. */
  whiteNoteWidth?: number;
  /** Fixed accidental column width in pixels; default 0.62 × whiteNoteWidth, at most the natural width. */
  blackNoteWidth?: number;
  /** Infer occupied octaves for unspecified endpoints. Explicit minPitch/maxPitch remain exact MIDI bounds. */
  showOnlyOctavesUsed?: boolean;
}

export interface StaffRenderOptions extends VisualizerRenderOptions {
  defaultKey?: number;
  instruments?: number[];
  scrollType?: number;
  /** Preserve source staff assignments (default true); false combines staves within each part. */
  splitStaves?: boolean;
}

/** Renderer options selected by a concrete view mode. */
export interface ScoreViewOptionsByType {
  'piano-roll': VisualizerRenderOptions;
  staff: StaffRenderOptions;
  waterfall: WaterfallRenderOptions;
}

type AllScoreViewOptionKeys = keyof WaterfallRenderOptions | keyof StaffRenderOptions;

/**
 * An atomic mode/options change. Options belonging to another mode are rejected,
 * including when the options were first assigned to a separate variable.
 */
export type ScoreViewConfiguration = {
  [Mode in ScoreViewType]: {
    type: Mode;
    options?: ScoreViewOptionsByType[Mode] & {
      [Key in Exclude<AllScoreViewOptionKeys, keyof ScoreViewOptionsByType[Mode]>]?: never;
    };
  };
}[ScoreViewType];

export interface ScoreSequenceNote {
  readonly noteId?: string;
  readonly partId?: string;
  readonly pitch: number;
  readonly velocity?: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly instrument?: number;
  readonly program?: number;
  readonly isDrum?: boolean;
  readonly part?: number;
  readonly voice?: number;
  readonly staff?: number;
}

export interface ScoreNoteSequence {
  readonly ticksPerQuarter: number;
  readonly tempos: ReadonlyArray<Readonly<{time: number; qpm: number}>>;
  readonly timeSignatures: ReadonlyArray<
    Readonly<{time: number; numerator: number; denominator: number}>
  >;
  readonly keySignatures: ReadonlyArray<Readonly<{time: number; key: number; mode: number}>>;
  readonly partInfos: ReadonlyArray<Readonly<{part: number; name: string}>>;
  readonly notes: ReadonlyArray<ScoreSequenceNote>;
  readonly totalTime: number;
}

export interface RenderedScoreVisualizer<TVisualizer = unknown> {
  readonly noteSequence: ScoreNoteSequence;
  readonly visualizer: TVisualizer;
  redraw(activeNote?: ScoreSequenceNote, scrollIntoView?: boolean): number | null;
  /** Highlight notes sounding at nominal seconds, using start <= time < end. */
  redrawAtTime?(seconds: number, scrollIntoView?: boolean): number | null;
  clearActiveNotes(): void;
  /**
   * Release DOM side effects made while rendering: undo any reparenting the
   * visualizer performed, remove created wrapper elements/listeners and drop
   * drawn content. Optional for backward compatibility — all renderers from
   * this package provide it. Safe to call more than once.
   */
  dispose?(): void;
}

export interface PianoRollNote {
  partId: string;
  note: Note;
  /** Onset in seconds. */
  startSeconds: number;
  /** Sounding duration in seconds. */
  durationSeconds: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StaffGlyph {
  partId: string;
  note: Note;
  /** Onset in seconds. */
  startSeconds: number;
  x: number;
  staffY: number;
  ledgerLines: number;
}

/** A waterfall note — same shape as {@link PianoRollNote} (pitch-column x). */
export type WaterfallNote = PianoRollNote;
