import {bindPlayerToVisualizer, type PlayerBindingHandlers} from '../render/binding';
import {validateScoreViewConfiguration} from '../core/configuration';
import {findSequenceNote} from '../core/note-sequence';
import {
  bindViewPlayer, seekViewPlayer, readViewPlayerScore, readViewPlayerSnapshot, resolveViewPlayer,
  type ViewPlayerNote, type ViewPlayerSnapshot,
} from './internal/player-binding';
import {Rational, type Score, type ScorePlaybackSource} from '../../core';
import type {ScoreMap} from '../core/map';
import {createScoreMapView, type ScoreMapView} from '../headless/score-map';
import {createPianoRollLayout} from '../core/layout';
import {mountScoreThumbnail} from '../render/thumbnail';
import {mountScoreMapAnnotations} from '../render/map-annotations';
import {createScoreView, type ScoreView} from '../headless/score-view';
import {renderScoreVisualizer} from '../render/score-visualizer';
import type {
  RenderedScoreVisualizer,
  ScoreViewType,
  ScoreViewConfiguration,
  StaffRenderOptions,
  VisualizerRenderOptions,
  WaterfallRenderOptions,
} from '../core/types';
import {HTMLElementBase, boolAttr, cssSizeAttr, defineOnce, numAttr, upgradeProperties} from './base';
import {mountStage, type StageHandle} from '@webmusic/ui/stage';
import {mountTimeline, type TimelineHandle, type TimelineRegion, type TimelineTick} from '@webmusic/ui/timeline';
import {mountStatus, type StatusHandle} from '@webmusic/ui/status';

const ELEMENT_NOTE_RGB = '51, 51, 51';
const ELEMENT_ACTIVE_NOTE_RGB = '240, 84, 119';

export type {ScoreViewType} from '../core/types';
export type {ScoreViewConfiguration, ScoreViewOptionsByType} from '../core/types';

/** Element modes include lightweight previews without expanding renderer types. */
export type ScoreViewElementType = ScoreViewType | 'map' | 'thumbnail';

/** Map navigation intent; seconds are on the nominal score timeline. */
export interface ScoreViewSeekDetail {
  quarters: number;
  seconds: number;
}

/**
 * Every render option `<score-view>` can forward — the union of the three
 * views' option bags. Keys that a view does not understand are ignored by its
 * renderer, so one bag can safely describe all three `type`s.
 */
export type ScoreViewRenderOptions = VisualizerRenderOptions & WaterfallRenderOptions & StaffRenderOptions;

/** Numeric layout attributes forwarded to the renderer (kebab → camel). */
const NUMERIC_OPTION_ATTRS: ReadonlyArray<readonly [attr: string, key: keyof ScoreViewRenderOptions]> = [
  // All views: note geometry + horizontal scale + pitch range.
  ['pixels-per-second', 'pixelsPerSecond'],
  ['note-height', 'noteHeight'],
  ['note-spacing', 'noteSpacing'],
  ['min-pitch', 'minPitch'],
  ['max-pitch', 'maxPitch'],
  // Waterfall: pitch-column geometry.
  ['white-note-width', 'whiteNoteWidth'],
  ['black-note-width', 'blackNoteWidth'],
  // Staff: key signature fallback (chromatic pitch class, 0 = C).
  ['default-key', 'defaultKey'],
];

/** Colour attributes forwarded to the renderer as `"r, g, b"` strings. */
const COLOR_OPTION_ATTRS: ReadonlyArray<readonly [attr: string, key: keyof ScoreViewRenderOptions]> = [
  ['note-color', 'noteRGB'],
  ['active-note-color', 'activeNoteRGB'],
];

/** Staff `scroll-type` attribute values → `ScrollType` enum numbers. */
const SCROLL_TYPES: Record<string, number> = {page: 0, note: 1, bar: 2};

/**
 * Parse a colour attribute into the `"r, g, b"` form the renderers expect
 * (they compose `rgba(<noteRGB>, <opacity>)`). Accepts `#rgb` / `#rrggbb`
 * hex, `rgb(r, g, b)`, or a raw `r, g, b` triple. Anything else →
 * `undefined` (the element's built-in skin remains in effect).
 */
export function parseColorAttr(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();

  const hex = value.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const channels = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
    return channels.join(', ');
  }

  const triple = value.match(/^(?:rgb\(\s*)?(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)?$/i);
  if (triple) {
    const channels = triple.slice(1, 4).map((c) => Math.min(255, Number(c)));
    return channels.join(', ');
  }

  return undefined;
}

/**
 * `<score-view>` — the single WebScore visualization element. The `type`
 * attribute picks the drawing (`piano-roll` by default, `staff`, `waterfall`,
 * `map` or `thumbnail`). Switching it disposes the old presentation and reuses
 * the resolved score. Map and thumbnail never create a full visualizer.
 *
 * ```html
 * <score-view type="waterfall" src="song.mid"
 *   width="640" height="300" min-pitch="48" max-pitch="84"
 *   note-height="8" note-color="#2563eb" active-note-color="#f59e0b"></score-view>
 * ```
 *
 * Resolves a `Score` from `.score`, `src`, or the selected player's already
 * loaded data (in that order). URL parsing loads the optional I/O stack on
 * demand; `format` forces a parser. Drawing delegates to the package's
 * `render*Visualizer` functions.
 *
 * Every visual knob is customizable per instance, declaratively (attributes)
 * or programmatically (`.options`, which wins on conflict):
 *
 * - **Element size** — `width` / `height` (bare number = px, or any CSS
 *   length). A fixed `height` clips-and-scrolls views taller than it.
 * - **Note geometry** — `note-height`, `note-spacing`, and the horizontal
 *   scale `pixels-per-second`.
 * - **Pitch range** — `min-pitch` / `max-pitch` (MIDI numbers); on
 *   the waterfall, `show-only-octaves-used` trims the columns to the octaves
 *   the score actually uses.
 * - **Pitch-column geometry** (waterfall) — `white-note-width` and
 *   `black-note-width`. Compose a separate `<pitch-view>` for a keyboard.
 * - **Colours** — `note-color` / `active-note-color` (hex, `rgb()`, or a raw
 *   `r, g, b` triple).
 * - **Expressions** — `show-annotations` (default true) shows supported score
 *   directions. False removes their space without changing musical data.
 * - **Staff** — `default-key` (chromatic key index), `scroll-type`
 *   (`page` · `note` · `bar`), and `split-staves` (default true; false combines
 *   source staves within each part).
 *
 * All numeric attributes are NaN-safe: absent, empty or non-numeric values
 * fall back to the renderer default instead of poisoning the layout.
 *
 * Set `player="#id"` to bind the view to a `<score-player>`: the view
 * follows its initial and subsequent nominal position, including paused seeks
 * and rate changes. Event-only note sources retain their note-on/off behavior.
 * The structural binding never imports the Play implementation.
 */
export class ScoreViewElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return [
      'src',
      'format',
      'player',
      'type',
      'for-part',
      'cells',
      'width',
      'height',
      'show-annotations',
      'show-only-octaves-used',
      'scroll-type',
      'split-staves',
      ...NUMERIC_OPTION_ATTRS.map(([attr]) => attr),
      ...COLOR_OPTION_ATTRS.map(([attr]) => attr),
    ];
  }

  private explicitScore?: Score;
  /** The score currently rendered, whether assigned or loaded from `src`. */
  private resolvedScore?: Score;
  private explicitOptions?: ScoreViewRenderOptions;
  private loadToken = 0;
  private loadController?: AbortController;
  private boundPlayer?: Element;
  private playerUnbind?: () => void;
  private lastSnapshot?: ViewPlayerSnapshot;
  private visualizerHandlers?: PlayerBindingHandlers;
  private renderedUnbind?: () => void;
  private rendered?: RenderedScoreVisualizer;
  private view?: ScoreView;
  private stage?: StageHandle;
  private status?: StatusHandle;
  private loadError?: unknown;
  private map?: ScoreMap;
  private mapView?: ScoreMapView;
  private timeline?: TimelineHandle;
  private annotationsCleanup?: () => void;
  private playheadSeconds = 0;
  private presentationRevision = 0;
  private snapshotRevision = 0;
  private sourceInitialized = false;
  private sourceInput?: Score | string;
  private sourceFormat?: string;
  private ownedSizes = new Map<string, string>();

  connectedCallback(): void {
    upgradeProperties(this, ['score', 'options', 'type']);
    this.bindPlayer();
    void this.refresh();
  }

  disconnectedCallback(): void {
    this.cancelLoad();
    this.unbindPlayer();
    this.disposePresentation();
    this.resolvedScore = undefined;
    this.sourceInitialized = false;
  }

  attributeChangedCallback(name: string): void {
    if (!this.isConnected) return;
    if (name === 'player') this.bindPlayer();
    else if (name === 'src' || name === 'format') void this.refresh();
    else if (name === 'width' || name === 'height') this.applyHostSize();
    else if (name === 'for-part' || name === 'cells') this.remap();
    else this.renderCurrent();
  }

  /** Assign a pre-loaded score programmatically (overrides `src`). */
  set score(score: Score | undefined) {
    this.explicitScore = score;
    if (this.isConnected) void this.refresh();
  }

  get score(): Score | undefined {
    return this.explicitScore ?? this.resolvedScore;
  }

  /** Current position on the nominal score timeline, in seconds. */
  get currentTime(): number {
    return this.view?.state.currentTime ?? this.playheadSeconds;
  }

  /** MIDI pitches intersecting the current score position, ascending. */
  get active(): number[] {
    return [...new Set(this.view?.state.activeNotes.map((note) => note.pitch) ?? [])].sort((a, b) => a - b);
  }

  /** Renderer options merged over the attributes (property wins). */
  set options(options: ScoreViewRenderOptions | undefined) {
    this.explicitOptions = options;
    if (this.isConnected) this.renderCurrent();
  }

  get options(): ScoreViewRenderOptions | undefined {
    return this.explicitOptions;
  }

  /**
   * Set mode and compatible options together. Invalid configuration throws before
   * changing this view. Replaces `.options`; attribute defaults still apply.
   * The legacy `.options` property remains permissive for existing callers.
   */
  configure(configuration: ScoreViewConfiguration): void {
    validateScoreViewConfiguration(configuration);
    const options = configuration.options ? {...configuration.options} : undefined;
    this.explicitOptions = options;
    if (this.getAttribute('type') !== configuration.type) {
      this.setAttribute('type', configuration.type);
    } else if (this.isConnected) {
      this.renderCurrent();
    }
  }

  /** Reflects the `type` attribute; unknown values fall back to `piano-roll`. */
  get type(): ScoreViewElementType {
    const raw = this.getAttribute('type');
    return raw === 'staff' || raw === 'waterfall' || raw === 'map' || raw === 'thumbnail' ? raw : 'piano-roll';
  }

  set type(type: ScoreViewElementType) {
    this.setAttribute('type', type);
  }

  /** Map density part, selected by id or name; absent means every part. */
  get forPart(): string | undefined {
    return this.getAttribute('for-part') ?? undefined;
  }

  /** Map cell budget; measures are grouped evenly to fit it. */
  get cells(): number {
    return Math.max(1, Math.round(numAttr(this, 'cells', 64)));
  }

  private async refresh(): Promise<void> {
    const src = this.getAttribute('src');
    const input = this.explicitScore ?? (src || readViewPlayerScore(this.boundPlayer));
    const format = typeof input === 'string' ? this.getAttribute('format') ?? undefined : undefined;
    if (this.sourceInitialized && input === this.sourceInput && format === this.sourceFormat) return;
    this.sourceInitialized = true;
    this.sourceInput = input;
    this.sourceFormat = format;
    this.loadError = undefined;
    this.cancelLoad();
    const token = this.loadToken;
    const controller = new AbortController();
    this.loadController = controller;
    let score: Score | undefined;
    try {
      score = await this.resolveScore(input, format, controller.signal);
    } finally {
      if (this.loadController === controller) this.loadController = undefined;
    }
    if (token !== this.loadToken || !this.isConnected) return; // superseded or detached
    this.resolvedScore = score;
    const native = (this.boundPlayer as (Element & {playback?: ScorePlaybackSource}) | undefined)?.playback?.snapshot();
    if (native && native.readiness !== 'unavailable' && native.score && score !== native.score) {
      this.lastSnapshot = undefined;
      this.setAttribute('data-player-state', 'mismatched');
    }
    this.playheadSeconds = score ? this.lastSnapshot?.nominalSeconds ?? 0 : 0;
    this.renderCurrent(false);
  }

  private disposePresentation(): void {
    this.presentationRevision += 1;
    this.annotationsCleanup?.();
    this.annotationsCleanup = undefined;
    this.style?.removeProperty('--_webscore-preview-annotations');
    this.rebindRendered(undefined);
    this.rendered?.dispose?.();
    this.rendered = undefined;
    this.view?.dispose();
    this.view = undefined;
    this.stage?.destroy();
    this.stage = undefined;
    this.status?.destroy();
    this.status = undefined;
    this.timeline?.destroy();
    this.timeline = undefined;
    this.mapView?.dispose();
    this.mapView = undefined;
    this.map = undefined;
    this.replaceChildren();
  }

  private renderCurrent(preservePosition = true): void {
    if (preservePosition) this.playheadSeconds = this.currentTime;
    this.disposePresentation();
    this.applyHostSize();
    const score = this.resolvedScore;
    const type = this.type;
    const owner = (this as {ownerDocument?: Document}).ownerDocument;
    if (owner) {
      const style = owner.createElement('style');
      const selector = this.localName.replace(/[^a-z0-9-]/gi, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
      style.textContent = `:where(${selector}) { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; }
:where(${selector}:not([hidden])) { display: block; }
:where(${selector}[type="thumbnail"]) { height: calc(3rem + var(--_webscore-preview-annotations, 0px)); }`;
      this.append(style);
    }
    if (!score) {
      if (owner) this.showStatus(this.loadError === undefined ? 'empty' : 'error',
        this.loadError === undefined ? 'Waiting for a score' : this.errorMessage(this.loadError));
      return;
    }
    if (type === 'map') {
      this.remap();
      if (!owner) return;
      this.timeline = mountTimeline(this, {
        snapshot: () => this.mapSnapshot(),
        seek: (quarters) => this.seekMap(quarters),
        selectRegion: (id) => {
          const cell = this.map?.cells[Number(id.slice('cell-'.length))];
          if (cell) this.seekMap(cell.startQuarters);
        },
      }, {
        label: 'Score map',
        formatPosition: (quarters) => score.measures.length
          ? `m. ${score.timeMap.quartersToMBS(Rational.from(quarters)).measure}`
          : quarters.toFixed(1),
      });
      this.renderMapAnnotations();
      return;
    }
    if (type === 'thumbnail') {
      const notes = createPianoRollLayout(score);
      if (!owner || !notes.length) return;
      const color = this.summaryColor('var(--wm-score-view-note, currentColor)');
      this.stage = mountStage(this,
        {render: (surface) => mountScoreThumbnail(surface, notes, {
          color, score, showAnnotations: this.renderOptions().showAnnotations,
        }, (height) => {
          // Derived per-instance sizing, not a public styling control. Explicit
          // host height attributes or author CSS still override the default.
          this.style.setProperty('--_webscore-preview-annotations', `${height}px`);
        })},
        {label: 'Score preview', fill: true, overflow: 'auto'},
      );
      return;
    }
    this.view = createScoreView(score, {type});
    if (owner && !this.view.sequence.notes.length) {
      this.view.dispose();
      this.view = undefined;
      this.showStatus('empty', 'No notes to display');
      return;
    }
    if (!owner) {
      this.replaceChildren();
      this.rendered = this.renderScore(score, this as unknown as HTMLElement, type);
      this.rebindRendered(this.rendered);
      return;
    }
    let failed = false;
    let failure: unknown;
    this.stage = mountStage(
      this,
      {render: (surface) => { this.rendered = this.renderScore(score, surface, type); }},
      {
        label: 'Score visualization', fill: true, overflow: 'auto',
        onError: (error) => { failed = true; failure = error; },
      },
    );
    // Theme the public stage handle without shadowing inherited presenter tokens.
    this.stage.element.style.background = 'var(--wm-score-view-background, var(--wm-stage-background, var(--wm-stage-surface-background, var(--wm-component-background, var(--wm-surface, light-dark(#fff, #111))))))';
    if (failed) {
      this.stage.destroy();
      this.stage = undefined;
      this.rendered?.dispose?.();
      this.rendered = undefined;
      this.view.dispose();
      this.view = undefined;
      this.showStatus('error', this.errorMessage(failure));
      return;
    }
    this.rebindRendered(this.rendered);
  }

  private cancelLoad(): void {
    this.loadToken += 1;
    // An old command must not repaint the retained map while a new input loads.
    this.mapView?.dispose();
    this.mapView = undefined;
    const controller = this.loadController;
    this.loadController = undefined;
    controller?.abort();
  }

  /**
   * Reflect the `width` / `height` attributes onto the host box. With a fixed
   * `height`, content taller than the box scrolls vertically inside it
   * (horizontal panning stays inside each view's own scroller).
   */
  private applyHostSize(): void {
    // `style` exists on any real HTMLElement; the guard is for the SSR-safe
    // base class, which is a plain object in Node.
    const style = (this as {style?: CSSStyleDeclaration}).style;
    if (!style) return;
    const width = cssSizeAttr(this, 'width');
    const height = cssSizeAttr(this, 'height');
    const apply = (property: string, value: string | undefined): void => {
      if (value) {
        style.setProperty(property, value);
        this.ownedSizes.set(property, value);
      } else if (this.ownedSizes.has(property)) {
        if (!style.getPropertyValue || style.getPropertyValue(property) === this.ownedSizes.get(property)) {
          style.removeProperty(property);
        }
        this.ownedSizes.delete(property);
      }
    };
    apply('width', width);
    apply('height', height);
    apply('overflow-y', height ? 'auto' : undefined);
  }

  private renderScore(score: Score, surface: HTMLElement, type: ScoreViewType): RenderedScoreVisualizer {
    const options = this.renderOptions();
    if (type !== 'waterfall') return renderScoreVisualizer(score, surface, type, options);
    return renderScoreVisualizer(score, surface, type, {
      ...options,
      fitToWidth: true,
      showOnlyOctavesUsed: options.showOnlyOctavesUsed ?? true,
    });
  }

  private showStatus(kind: 'empty' | 'error', message: string): void {
    this.status?.destroy();
    this.status = mountStatus(this, {snapshot: () => ({kind, message})});
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /** Attribute-derived render options, overridden by `.options`. */
  private renderOptions(): ScoreViewRenderOptions {
    const options: Record<string, unknown> = {
      noteRGB: ELEMENT_NOTE_RGB,
      activeNoteRGB: ELEMENT_ACTIVE_NOTE_RGB,
      noteColor: 'var(--wm-score-view-note, var(--wm-foreground, light-dark(#333, #ddd)))',
      activeNoteColor: 'var(--wm-score-view-active-note, var(--wm-accent, rgb(240, 84, 119)))',
    };

    for (const [attr, key] of NUMERIC_OPTION_ATTRS) {
      if (this.getAttribute(attr) == null) continue;
      const value = numAttr(this, attr, Number.NaN);
      if (Number.isFinite(value)) options[key] = value;
    }

    for (const [attr, key] of COLOR_OPTION_ATTRS) {
      const value = parseColorAttr(this.getAttribute(attr));
      if (value !== undefined) {
        options[key] = value;
        delete options[key === 'noteRGB' ? 'noteColor' : 'activeNoteColor'];
      }
    }

    if (this.getAttribute('show-only-octaves-used') != null) {
      options.showOnlyOctavesUsed = boolAttr(this, 'show-only-octaves-used');
    }
    if (this.getAttribute('show-annotations') != null) {
      options.showAnnotations = boolAttr(this, 'show-annotations');
    }
    if (this.getAttribute('split-staves') != null) {
      options.splitStaves = boolAttr(this, 'split-staves');
    }

    const scrollType = this.getAttribute('scroll-type')?.trim().toLowerCase();
    if (scrollType && scrollType in SCROLL_TYPES) {
      options.scrollType = SCROLL_TYPES[scrollType];
    }

    if (this.explicitOptions?.noteRGB !== undefined) delete options.noteColor;
    if (this.explicitOptions?.activeNoteRGB !== undefined) delete options.activeNoteColor;
    return {...(options as ScoreViewRenderOptions), ...this.explicitOptions};
  }

  private async resolveScore(input: Score | string | undefined, format: string | undefined, signal: AbortSignal): Promise<Score | undefined> {
    if (typeof input !== 'string') return input;
    try {
      const io = await import('../../io/load');
      const loaded = await io.loadScoreFromUrl(input, {
        ...(format ? {format: format as never} : {}),
        signal,
      });
      return loaded;
    } catch (error) {
      if (signal.aborted) return undefined;
      this.loadError = error;
      console.error('[WebScore] <score-view> failed to load', input, error, '(is @webmusic/score/io installed?)');
      return undefined;
    }
  }

  private remap(): void {
    if (this.type !== 'map' || !this.resolvedScore) return;
    const options = {part: this.forPart, maxCells: this.cells};
    if (!this.mapView) {
      this.mapView = createScoreMapView({score: this.resolvedScore, ...options,
        seekNominal: (seconds) => {
          const target = this.boundPlayer as (Element & {rate?: number; playback?: ScorePlaybackSource}) | undefined;
          const playback = target?.playback;
          const model = this.mapView;
          const candidateRate = readViewPlayerSnapshot(target)?.rate ?? target?.rate ?? this.lastSnapshot?.rate;
          const rate = typeof candidateRate === 'number' && Number.isFinite(candidateRate) && candidateRate > 0
            ? candidateRate : 1;
          const result = seekViewPlayer(target, seconds, this.resolvedScore, rate);
          const reconcile = (): void => {
            if (model !== this.mapView || target !== this.boundPlayer || playback !== target?.playback) return;
            // Native snapshots settle even a no-op command. Legacy owners report
            // new positions through events; their getter may still be stale.
            const actual = playback?.snapshot();
            if (actual && actual.readiness !== 'unavailable' && actual.readiness !== 'disposed') {
              model?.setPosition(actual.nominalSeconds ?? 0);
            }
          };
          if (result) return Promise.resolve(result).then(reconcile);
          reconcile();
        },
      });
      this.mapView.setPosition(this.playheadSeconds);
      this.mapView.subscribe((state) => {
        this.playheadSeconds = state.nominalSeconds;
        if (this.lastSnapshot) this.lastSnapshot = {...this.lastSnapshot, nominalSeconds: state.nominalSeconds};
        this.timeline?.update();
      });
    } else this.mapView.configure(options);
    const projected = this.mapView.state.map!;
    this.map = {durationQuarters: projected.durationQuarters, cells: [...projected.cells], marks: [...projected.marks]};
    // Expressions have their own strip; the navigation ruler keeps bar labels
    // so it neither repeats a rehearsal nor resurrects a hidden source mark.
    const measures = new Map(this.resolvedScore.measures.map((measure) => [measure.onsetQuarters.toFloat(), measure]));
    this.map.marks = this.map.marks.map((mark) => {
      const measure = measures.get(mark.startQuarters);
      return measure?.rehearsal
        ? {...mark, label: `m. ${measure.number}`, level: measure.timeSignature || measure.tempo ? 'major' : 'minor'}
        : mark;
    });
    this.timeline?.update();
    this.renderMapAnnotations();
  }

  /** A compact expression ruler shares the map's quarter axis and part filter. */
  private renderMapAnnotations(): void {
    this.annotationsCleanup?.();
    this.annotationsCleanup = undefined;
    const score = this.resolvedScore;
    const timeline = this.timeline;
    if (!score || !timeline || this.renderOptions().showAnnotations === false) return;
    this.annotationsCleanup = mountScoreMapAnnotations(timeline, score, {
      part: this.forPart,
      color: this.summaryColor('var(--wm-score-view-note, currentColor)'),
    });
  }

  /** Lightweight drawings share the same explicit color precedence as notes. */
  private summaryColor(fallback: string): string {
    if (this.explicitOptions?.noteColor !== undefined) return this.explicitOptions.noteColor;
    if (this.explicitOptions?.noteRGB !== undefined) return `rgb(${this.explicitOptions.noteRGB})`;
    const raw = this.getAttribute('note-color');
    const channels = parseColorAttr(raw);
    return channels ? `rgb(${channels})` : raw || fallback;
  }

  private mapSnapshot() {
    const score = this.resolvedScore;
    const map = this.map;
    const playhead = score?.timeMap.secondsToQuarters(this.playheadSeconds).toFloat() ?? 0;
    return {
      duration: map?.durationQuarters ?? 0,
      playhead,
      ticks: map?.marks.map<TimelineTick>((mark, index) => ({
        id: `mark-${index}`, position: mark.startQuarters, label: mark.label, level: mark.level,
      })),
      regions: (map?.cells ?? []).map<TimelineRegion>((cell, index) => ({
        id: `cell-${index}`, start: cell.startQuarters, end: cell.endQuarters,
        label: cell.firstMeasure === undefined ? ''
          : cell.lastMeasure !== undefined && cell.lastMeasure !== cell.firstMeasure
            ? `m. ${cell.firstMeasure}–${cell.lastMeasure}` : `m. ${cell.firstMeasure}`,
        color: `color-mix(in srgb, ${this.summaryColor('var(--wm-score-view-map, var(--wm-accent, #4869d8))')} ${Math.round(12 + cell.density * 88)}%, transparent)`,
        selected: playhead >= cell.startQuarters && playhead < cell.endQuarters,
      })),
    };
  }

  /** Map commands borrow the player's time axis, without owning its transport. */
  private seekMap(position: number): void {
    const score = this.resolvedScore;
    const mapView = this.mapView;
    if (!score || !mapView || this.type !== 'map' || !Number.isFinite(position)) return;
    const quarters = Math.max(0, Math.min(this.map?.durationQuarters ?? 0, position));
    const seconds = score.timeMap.quartersToSeconds(Rational.from(quarters));
    const target = this.boundPlayer as (Element & {
      rate?: number;
      seekNominal?: (seconds: number) => void | Promise<void>;
      seek?: (seconds: number) => void | Promise<void>;
    }) | undefined;
    const sourceRevision = this.loadToken;
    const presentationRevision = this.presentationRevision;
    const beforeState = mapView.state;
    const beforeSnapshot = this.snapshotRevision;
    const current = () => this.isConnected && mapView === this.mapView
      && sourceRevision === this.loadToken && presentationRevision === this.presentationRevision
      && target === this.boundPlayer && target === resolveViewPlayer(this);
    this.dispatchEvent(new CustomEvent<ScoreViewSeekDetail>('webscore:seek', {
      detail: {quarters, seconds}, bubbles: true, composed: true,
    }));
    // A consumer can synchronously replace the source, owner or type on intent.
    if (!current() || beforeSnapshot !== this.snapshotRevision || beforeState !== mapView.state) return;
    void mapView.seekQuarters(quarters).then((outcome) => {
      if (current() && outcome.status === 'failed') console.error('[WebScore] <score-view> seek failed', outcome.error);
    });
  }

  // ---- Playback sync (player="#id") ----

  private bindPlayer(): void {
    this.unbindPlayer();
    this.playerUnbind = bindViewPlayer(this, {
      score: () => this.explicitScore ?? (this.getAttribute('src') ? this.resolvedScore : undefined),
      targetChanged: (target) => {
        this.boundPlayer = target;
        this.mapView?.setScore(this.resolvedScore);
      },
      scoreChanged: () => {
        if (!this.explicitScore && !this.getAttribute('src')) void this.refresh();
      },
      snapshot: (snapshot) => this.followSnapshot(snapshot),
      noteOn: (note) => this.followNote(note, true),
      noteOff: (note) => this.followNote(note, false),
      reset: () => {
        this.snapshotRevision += 1;
        this.lastSnapshot = undefined;
        this.playheadSeconds = 0;
        this.mapView?.setPosition(0);
        this.view?.reset();
        this.rendered?.clearActiveNotes();
        this.timeline?.update();
      },
      end: () => {
        if (this.lastSnapshot) this.view?.seek(this.lastSnapshot.nominalSeconds);
        else this.view?.end();
        this.view?.clearActiveNotes();
        this.rendered?.clearActiveNotes();
        if (!readViewPlayerSnapshot(this.boundPlayer)) this.playheadSeconds = 0;
        this.timeline?.update();
      },
    });
    if (!this.playerUnbind && !this.explicitScore && !this.getAttribute('src')) void this.refresh();
  }

  private unbindPlayer(): void {
    this.playerUnbind?.();
    this.playerUnbind = undefined;
    this.boundPlayer = undefined;
    this.lastSnapshot = undefined;
    this.snapshotRevision += 1;
    this.playheadSeconds = 0;
    this.mapView?.setScore(this.resolvedScore);
    this.view?.reset();
    this.rendered?.clearActiveNotes();
    this.timeline?.update();
  }

  private followNote(note: ViewPlayerNote, on: boolean): void {
    const snapshot = readViewPlayerSnapshot(this.boundPlayer);
    if (snapshot) {
      this.followSnapshot(snapshot);
      return;
    }
    if (note.startTime === undefined || !Number.isFinite(note.startTime) || note.startTime < 0) return;
    if (on) this.visualizerHandlers?.noteOn(note.midi, note.startTime);
    else this.visualizerHandlers?.noteOff(note.midi, note.startTime);
  }

  private followSnapshot(snapshot: ViewPlayerSnapshot): void {
    this.snapshotRevision += 1;
    this.lastSnapshot = snapshot;
    this.playheadSeconds = this.resolvedScore ? snapshot.nominalSeconds : 0;
    this.mapView?.setPosition(this.playheadSeconds);
    this.timeline?.update();
    this.paintPosition(snapshot.nominalSeconds);
  }

  private paintPosition(seconds: number): void {
    if (!this.view || !this.rendered) return;
    const state = this.view.seek(seconds);
    if (this.rendered.redrawAtTime) {
      this.rendered.redrawAtTime(state.currentTime, true);
      return;
    }
    const latest = state.activeNotes[state.activeNotes.length - 1];
    const note = latest ? findSequenceNote(this.rendered.noteSequence, latest.pitch, latest.startTime) : undefined;
    if (note) this.rendered.redraw(note, true);
    else this.rendered.clearActiveNotes();
  }

  /** Keep legacy event-only note binding, then restore the current snapshot. */
  private rebindRendered(rendered: RenderedScoreVisualizer | undefined): void {
    this.renderedUnbind?.();
    this.renderedUnbind = undefined;
    this.visualizerHandlers = undefined;
    if (!rendered) return;
    this.renderedUnbind = bindPlayerToVisualizer(rendered, (handlers) => {
      this.visualizerHandlers = handlers;
      return () => { this.visualizerHandlers = undefined; };
    }, this.view);
    if (this.lastSnapshot) this.followSnapshot(this.lastSnapshot);
    else this.paintPosition(this.playheadSeconds);
  }
}

/**
 * Register `<score-view>` (or a custom tag). Call once in the browser. A
 * no-op outside the browser and when the tag is already taken. Tree-shakeable:
 * importing the package does not register elements until you invoke this.
 */
export function defineScoreViewElement(tag = 'score-view'): void {
  defineOnce(tag, ScoreViewElement);
}
