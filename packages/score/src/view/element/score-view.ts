import {bindPlayerToVisualizer, type PlayerBindingHandlers} from '../render/binding';
import {validateScoreViewConfiguration} from '../core/configuration';
import {findSequenceNote} from '../core/note-sequence';
import {type ViewPlayerNote, type ViewPlayerSnapshot} from './internal/player-binding';
import {SCORE_VIEW_BASE_ATTRIBUTES, ScoreViewElementBase} from './internal/score-view-base';
import {NoteId, type Score} from '../../core';
import {createScoreView, type ScoreView} from '../headless/score-view';
import {renderScoreVisualizer, type ScoreVisualizerHandle} from '../render/score-visualizer';
import type {
  RenderedScoreVisualizer,
  ScoreViewType,
  ScoreViewDirection,
  ScoreViewConfiguration,
  StaffRenderOptions,
  VisualizerRenderOptions,
  WaterfallRenderOptions,
} from '../core/types';
import {boolAttr, defineOnce, numAttr, upgradeProperties} from './base';
import {mountScrollRegion, mountStage, type ScrollRegionHandle, type StageHandle} from '@webmusic/ui/stage';

const ELEMENT_NOTE_RGB = '51, 51, 51';
const ELEMENT_ACTIVE_NOTE_RGB = '240, 84, 119';

export type {ScoreViewType, ScoreViewDirection} from '../core/types';
export type {ScoreViewConfiguration, ScoreViewOptionsByType} from '../core/types';

/** `<score-view>` draws exactly the three renderer types. */
export type ScoreViewElementType = ScoreViewType;

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
 * attribute picks the drawing (`piano-roll` by default, `staff` or
 * `waterfall`). Switching it disposes the old presentation and reuses the
 * resolved score.
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
 *   `black-note-width`. Compose a separate `<score-pitch-view>` for a keyboard.
 * - **Colours** — `note-color` / `active-note-color` (hex, `rgb()`, or a raw
 *   `r, g, b` triple).
 * - **Direction** — `direction` selects up/down/left/right for piano-roll and
 *   waterfall. The staff retains its normal reading direction.
 * - **Expressions** (staff only) — `show-annotations` (default false) enables
 *   supported score directions. Hidden expressions reserve no space and retain
 *   musical data. Piano roll and waterfall never draw annotations.
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
 *
 * `<score-view>` is read-only. Assign `.editor` to draw an editor's current
 * content (including another view's shared draft) without editing it; use
 * `<score-grid-view editable>` to edit notes.
 */
export class ScoreViewElement extends ScoreViewElementBase {
  static get observedAttributes(): string[] {
    return [
      ...SCORE_VIEW_BASE_ATTRIBUTES,
      'type',
      'direction',
      'show-annotations',
      'show-only-octaves-used',
      'scroll-type',
      'split-staves',
      ...NUMERIC_OPTION_ATTRS.map(([attr]) => attr),
      ...COLOR_OPTION_ATTRS.map(([attr]) => attr),
    ];
  }

  private explicitOptions?: ScoreViewRenderOptions;
  private visualizerHandlers?: PlayerBindingHandlers;
  private renderedUnbind?: () => void;
  private rendered?: ScoreVisualizerHandle;
  private scrollRegion?: ScrollRegionHandle;
  private view?: ScoreView;
  private stage?: StageHandle;

  connectedCallback(): void {
    upgradeProperties(this, ['score', 'options', 'type', 'direction', 'editor', 'interactionSession']);
    super.connectedCallback();
  }

  attributeChangedCallback(name: string): void {
    if (!this.isConnected || !ScoreViewElement.observedAttributes.includes(name)) return;
    if (!this.handleBaseAttribute(name)) this.renderCurrent();
  }

  /** Current position on the nominal score timeline, in seconds. */
  get currentTime(): number {
    return this.view?.state.currentTime ?? this.playheadSeconds;
  }

  /** MIDI pitches intersecting the current score position, ascending. */
  get active(): number[] {
    if (this.editing && this.documentPlaybackReady()) {
      return [...new Set(this.documentPlayback!.activeNotes.flatMap((note) => {
        const pitch = this.editing!.state.document.content.getNote(NoteId(note.noteId))?.pitch;
        return pitch ? [pitch.midi] : [];
      }))].sort((a, b) => a - b);
    }
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
    return raw === 'staff' || raw === 'waterfall' ? raw : 'piano-roll';
  }

  set type(type: ScoreViewElementType) {
    this.setAttribute('type', type);
  }

  /** Piano-roll time axis or waterfall travel direction; the staff keeps normal layout. */
  get direction(): ScoreViewDirection {
    const value = this.getAttribute('direction');
    return value === 'up' || value === 'down' || value === 'left' || value === 'right'
      ? value : this.type === 'waterfall' ? 'down' : 'right';
  }

  set direction(direction: ScoreViewDirection) {
    this.setAttribute('direction', direction);
  }

  protected disposePresentation(): number {
    const revision = ++this.presentationRevision;
    const binding = this.renderedUnbind;
    const rendered = this.rendered, view = this.view, stage = this.stage, status = this.status;
    const scrollRegion = this.scrollRegion;
    this.renderedUnbind = undefined;
    this.visualizerHandlers = undefined;
    this.scrollRegion = undefined;
    this.rendered = undefined;
    this.view = undefined;
    this.stage = undefined;
    this.status = undefined;
    // Cleanup callbacks can synchronously mount a newer presentation. Clear
    // only this lifetime's DOM before invoking its captured cleanup callbacks.
    this.replaceChildren();
    const failures: unknown[] = [];
    for (const cleanup of [() => binding?.(), () => scrollRegion?.destroy(), () => rendered?.dispose?.(), () => view?.dispose(),
      () => stage?.destroy(), () => status?.destroy()]) {
      try { cleanup(); } catch (error) { failures.push(error); }
    }
    for (const error of failures.slice(1)) console.error('[WebScore] Score View presentation cleanup failed', error);
    if (failures.length) throw failures[0];
    return revision;
  }

  protected renderCurrent(preservePosition = true): void {
    if (preservePosition) this.playheadSeconds = this.currentTime;
    const generation = this.editorGeneration;
    const revision = this.disposePresentation();
    if (revision !== this.presentationRevision || generation !== this.editorGeneration) return;
    const prepared = this.prepareRender();
    if (!prepared) return;
    const {score, owner} = prepared;
    const type = this.type;
    const blocked = this.hasEditorIntent() && !this.editing ? this.blockedEditorState() : undefined;
    if (blocked && owner) this.showStatus('error', `Editor unavailable: ${blocked}`);
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
      this.scrollRegion?.destroy();
      this.scrollRegion = undefined;
      this.rendered?.dispose?.();
      this.rendered = undefined;
      this.view.dispose();
      this.view = undefined;
      this.showStatus('error', this.errorMessage(failure));
      return;
    }
    this.rebindRendered(this.rendered);
  }

  private renderScore(score: Score, surface: HTMLElement, type: ScoreViewType): ScoreVisualizerHandle {
    const options = this.renderOptions();
    // Only the staff draws score annotations; the other renderers never receive the switch.
    if (type !== 'staff') delete options.showAnnotations;
    const rendered = renderScoreVisualizer(score, surface, type, type === 'waterfall' ? {
      ...options,
      fitToWidth: true,
      showOnlyOctavesUsed: options.showOnlyOctavesUsed ?? true,
    } : options);
    try {
      if (rendered.scrollViewport) {
        this.scrollRegion = mountScrollRegion(rendered.scrollViewport, {
          label: 'Score time window', hideScrollbar: true,
        });
      }
      return rendered;
    } catch (error) {
      rendered.dispose?.();
      throw error;
    }
  }

  /** Attribute-derived render options, overridden by `.options`. */
  private renderOptions(): ScoreViewRenderOptions {
    const options: Record<string, unknown> = {
      showAnnotations: false,
      noteRGB: ELEMENT_NOTE_RGB,
      activeNoteRGB: ELEMENT_ACTIVE_NOTE_RGB,
      noteColor: 'var(--wm-score-view-note, var(--wm-foreground, light-dark(#333, #ddd)))',
      activeNoteColor: 'var(--wm-score-view-active-note, var(--wm-accent, rgb(240, 84, 119)))',
    };
    if (this.type === 'piano-roll' || this.type === 'waterfall') options.direction = this.direction;

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
    const merged = {...(options as ScoreViewRenderOptions), ...this.explicitOptions};
    merged.showAnnotations = this.explicitOptions?.showAnnotations ?? options.showAnnotations as boolean;
    if (this.type === 'piano-roll' || this.type === 'waterfall') {
      merged.direction = this.explicitOptions?.direction ?? this.direction;
    }
    return merged;
  }

  protected followEventNote(note: ViewPlayerNote, on: boolean): void {
    if (note.startTime === undefined || !Number.isFinite(note.startTime) || note.startTime < 0) return;
    if (on) this.visualizerHandlers?.noteOn(note.midi, note.startTime);
    else this.visualizerHandlers?.noteOff(note.midi, note.startTime);
  }

  protected resetPresentationPlayback(): void {
    this.view?.reset();
    this.rendered?.clearActiveNotes();
  }

  protected endPresentationPlayback(): void {
    if (this.lastSnapshot) this.view?.seek(this.lastSnapshot.nominalSeconds);
    else this.view?.end();
    this.view?.clearActiveNotes();
    this.rendered?.clearActiveNotes();
  }

  protected paintPosition(snapshot: ViewPlayerSnapshot): void {
    this.paintSeconds(snapshot.nominalSeconds);
  }

  private paintSeconds(seconds: number): void {
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
    if (this.hasEditorIntent() && !this.documentPlaybackReady()) {
      this.view?.reset(); rendered.clearActiveNotes();
    } else if (this.lastSnapshot) this.followSnapshot(this.lastSnapshot);
    else this.paintSeconds(this.playheadSeconds);
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
