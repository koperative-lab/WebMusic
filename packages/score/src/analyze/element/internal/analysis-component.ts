import {Rational, isPitchedNote, noteMidi, type Score, type ScorePlaybackSource} from '../../../core';
import {
  romanNumeralForChord,
  spellChord,
  spellChordNotes,
  type Key,
  type SpellingPreference,
} from '../../core';
import {createAnalysisSession, type AnalysisResult, type AnalysisSession} from '../../headless/session';
import {createTransportClock, rateFromDurations, type TransportClock} from '../../headless/transport-clock';
import {
  formatMetricalPosition,
  projectProgression,
  projectNameplate,
  type FlowBandView,
  type FlowLaneView,
  type NameplateView,
  type SoundingProjection,
} from '../../headless/workbench';
import {
  bindAnalysisPlayer,
  createLiveChordTracker,
  createLiveKeyTracker,
  createPlayheadHighlighter,
  createScoreSource,
  recipeFor,
  type AnalysisViewType,
  type SlotKind,
  type SlotSpec,
  type ViewRecipe,
} from './index';
import {HTMLElementBase, upgradeProperties} from '../base';
import {seekAnalysisPlayer, type AnalysisTimeUpdate} from './player-binding';
import {projectChordCells} from './chord-cells';
import {
  mountFlowLane,
  mountNameplate,
  type FlowLaneHandle,
  type NameplateHandle,
} from '@webmusic/ui/harmony';
import {
  mountWorkbench,
  type MotionMode,
  type WorkbenchHandle,
  type WorkbenchPhase,
  type WorkbenchState,
} from '@webmusic/ui/workbench';

export type {AnalysisViewType} from './recipes';

/** Detail of the `webscore:seek` a lane click, drag or key dispatches. */
export interface AnalysisViewSeekDetail {
  quarters: number;
  seconds: number;
}

export interface AnalysisSelection {
  readonly id: string;
  readonly startQuarters: number;
  readonly endQuarters: number;
}

export interface AnalysisViewSelectDetail extends AnalysisSelection {
  readonly kind: 'chord';
}

export interface AnalysisInspectionCandidate {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly selected: boolean;
}

export interface AnalysisInspection {
  readonly kind: AnalysisViewSelectDetail['kind'];
  readonly selection: AnalysisSelection;
  readonly headline: string;
  readonly detail: string;
  readonly evidence: readonly string[];
  readonly candidates: readonly AnalysisInspectionCandidate[];
}

/**
 * Presenter faults already warned about, so a paint path running twenty times a
 * second reports its one problem once. Module-level on purpose: two workbenches
 * on a page have the same problem, and the reader needs to hear it once.
 */
const REPORTED = new Set<string>();

// ---------------------------------------------------------------------------
// The attribute surface.
//
// Parsed out here rather than inside the class, so every fallback is one
// readable table instead of a branch buried in a paint path. Two rules run
// through all of it:
//
//  1. A value the element cannot read falls back to the documented default and
//     says so ONCE. Twenty times a second is not a diagnostic, and silence is
//     worse: a silently ignored attribute is indistinguishable from an
//     unimplemented one, which is the exact reading this whole surface exists
//     to make impossible.
//  2. Every word here reaches a presenter — through a mount OPTION or through
//     the snapshot a presenter pulls. Never through a token write: the element
//     may not `setProperty('--wm-…')`, because a kit token is the presenter's
//     vocabulary and not its caller's.
// ---------------------------------------------------------------------------

/** `window="auto"`: this many bars of the piece in view at once. */
const AUTO_WINDOW_BARS = 2;

/** A field of view outside this is not a reading of the attribute, it is a typo. */
const MIN_WINDOW_SECONDS = 0.5;
const MAX_WINDOW_SECONDS = 600;

/**
 * One value out of a fixed set, or `undefined` for "absent, or unreadable".
 *
 * The caller applies its own default, so an attribute that is missing and one
 * that is misspelled take the same path — the difference is that the second one
 * is said out loud.
 */
function pick<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: string,
  attribute: string,
  warn: (message: string) => void,
): T | undefined {
  if (raw === null) return undefined;
  const value = raw.trim().toLowerCase();
  if ((allowed as readonly string[]).includes(value)) return value as T;
  warn(`${attribute}="${raw}" is not one of ${allowed.join(' / ')} — using ${fallback}.`);
  return undefined;
}

/** One line of the semantic twin: the readable view, and the playhead's target. */
interface IndexRow {
  id: string;
  text: string;
  /** Quarters. The RANGE form of the span contract. */
  span?: {start: number; end: number};
}

/**
 * Everything one view draws, recomputed whole on each domain event.
 *
 * A plain object with no methods and no node references: the presenters pull it
 * through their own `snapshot()`, so "what is on screen" is always exactly one
 * value that can be logged, diffed and reasoned about. Frame events never touch
 * it — they travel through the clock to `tick()` and move material, nothing more.
 */
interface ViewModel {
  recipe: ViewRecipe;
  score?: Score;
  lane: FlowLaneView;
  sounding?: Pick<SoundingProjection, 'spelling' | 'naming'>;
  index: readonly IndexRow[];
  /** Changes exactly when the conveyor and the readable twin need reconciling. */
  laneKey: string;
  phase: WorkbenchPhase;
  message: string;
  detail: string;
  inspection?: AnalysisInspection;
}

/** The half of the model that only a new analysis can change. Memoised on it. */
interface Material {
  /** Identity as a number, so a repaint decision is a string compare. */
  revision: number;
  score?: Score;
  result?: AnalysisResult;
  lane: FlowLaneView;
  index: readonly IndexRow[];
}

/** One disposable presenter. Flow material and frame updates remain separate. */
interface Tenant {
  kind?: SlotKind;
  /** Visible axis span; changing the window remounts only this presenter. */
  visibleSpan?: number;
  host: HTMLElement;
  update(): void;
  destroy(): void;
}

const EMPTY_LANE: FlowLaneView = {bands: [], now: 0};
// Scores and analysis results are immutable: sibling components share one
// default analysis snapshot without sharing their local interaction state.
const ANALYSES = new WeakMap<Score, AnalysisResult>();

/** Shared composition and lifecycle for independent analysis components. */
export abstract class AnalysisComponentElement extends HTMLElementBase {
  protected abstract get analysisType(): AnalysisViewType;

  #recipe(): ViewRecipe {
    return recipeFor(this.analysisType);
  }

  #source = createScoreSource(this);
  #session?: AnalysisSession;
  #highlight = createPlayheadHighlighter({scroll: false});
  #clock: TransportClock = createTransportClock();

  #root?: HTMLElement;
  #evidenceStatus?: HTMLElement;
  #renderedInspection?: AnalysisInspection;
  #workbench?: WorkbenchHandle;
  #presenter?: Tenant;
  #rows = new Map<string, HTMLLIElement>();

  #model?: ViewModel;
  #cache?: Material;
  /** Bumped whenever {@link Material} is rebuilt — the lane's repaint trigger. */
  #materials = 0;
  #laneKey = '';
  #soundingCache?: {signature: string; projection: Pick<SoundingProjection, 'spelling' | 'naming'>};
  #score?: Score;
  #error?: string;
  #unbind?: () => void;
  #player?: Element;
  /** `window`, resolved once per (spec, score) — `auto` allocates Rationals. */
  #windowCache?: {raw: string | null; score?: Score; seconds?: number};
  #selection?: AnalysisSelection;
  #selectionScore?: Score;
  #inspectionCache?: {score: Score; selection: AnalysisSelection; signature: string; value: AnalysisInspection | undefined};
  /** What the clock was built for, so it is only rebuilt when that changes. */
  #clockDuration = 0;

  /**
   * Nominal seconds per transport second, read off the cursor and never
   * differenced — a difference cannot tell a tempo change from a seek.
   */
  #rate = 1;
  #lastUpdate?: AnalysisTimeUpdate;
  #seekOrigin?: number;
  #revision = 0;
  #seekRequest = 0;
  #skipNextBandSeek = false;
  #timeRevision = 0;
  #playing = false;
  #epoch = 0;
  #soundingMidis: readonly number[] = [];
  #chordChangeTimer?: ReturnType<typeof setTimeout>;
  #lastEmittedChord?: string;

  /** Derived presentation activity; the player remains the transport owner. */
  #moving = false;
  #settling = false;
  /** The shell's own "something changed" channel — how a stepped lane ticks. */
  #notify?: () => void;

  #liveChord = createLiveChordTracker({
    onUpdate: (state) => {
      this.#soundingMidis = state.midis;
      this.#apply();
      this.#scheduleChordChange();
    },
  });

  // Only the live nameplate uses this context to choose automatic spelling.
  #liveKey = createLiveKeyTracker(() => undefined);

  connectedCallback(): void {
    upgradeProperties(this, [
      'score',
      'density',
      'scheme',
      'spelling',
      'motion',
      'window',
      'analysisWindow',
      'key',
      'stabilityMs',
    ]);
    this.#mount();
    this.#bindPlayer();
    void this.#refresh();
  }

  disconnectedCallback(): void {
    this.#destroy();
  }

  attributeChangedCallback(name?: string): void {
    if (!this.isConnected) return;
    if (name === 'player') {
      this.#bindPlayer();
      if (!this.#source.score && !this.getAttribute('src')) void this.#refresh();
      else this.#apply();
      return;
    }
    // Motion is a presenter mount option; replacing it preserves source state.
    if (name === 'motion') {
      this.#remount();
      return;
    }
    if (name === 'stability-ms') {
      this.#scheduleChordChange();
      return;
    }
    // Everything else is content the presenters pull. Routing it through the
    // loader would re-fetch and re-parse `src` every time a reader touched a
    // display parameter would otherwise repeat the source request.
    if (name !== 'src' && name !== 'format') {
      this.#cache = undefined;
      this.#inspectionCache = undefined;
      this.#apply();
      if (name === 'spelling') this.#scheduleChordChange();
      return;
    }
    void this.#refresh();
  }

  /** Assign a pre-loaded score programmatically (overrides `src`). */
  set score(score: Score | undefined) {
    this.#source.score = score;
    if (this.isConnected) void this.#refresh();
  }

  get score(): Score | undefined {
    return this.#source.score;
  }

  /** The named chord, or `undefined` for silence or an unnamed note set. */
  get chord(): string | undefined {
    return this.#model?.sounding?.naming.primary?.symbol;
  }

  /** Delay for a new displayed chord before `webscore:chordchange`, in milliseconds. */
  get stabilityMs(): number {
    const raw = this.getAttribute('stability-ms');
    if (raw === null) return 80;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0 && value <= 1000) return value;
    this.#warn(`stability-ms="${raw}" must be 0 to 1000 ms — using 80.`);
    return 80;
  }

  set stabilityMs(value: number) { this.setAttribute('stability-ms', String(value)); }

  /** The inspected quarter-note region. This is local UI state, not a score edit. */
  get selection(): AnalysisSelection | undefined {
    return this.#selection ? {...this.#selection} : undefined;
  }

  /** Detailed evidence for the current score-lane selection. */
  get analysis(): AnalysisInspection | undefined {
    const inspection = this.#model?.inspection;
    return inspection && {
      ...inspection,
      selection: {...inspection.selection},
      evidence: [...inspection.evidence],
      candidates: inspection.candidates.map((candidate) => ({...candidate})),
    };
  }

  /** Inspect a score region without commanding the bound player. */
  selectRegion(startQuarters: number, endQuarters: number): void {
    if (!Number.isFinite(startQuarters) || !Number.isFinite(endQuarters) || endQuarters <= startQuarters) {
      throw new RangeError('Analysis selection requires a finite increasing quarter-note range');
    }
    const score = this.#score;
    if (!score || this.analysisType === 'live-chord') return;
    const end = score.durationQuarters.toFloat();
    const start = Math.max(0, Math.min(end, startQuarters));
    const stop = Math.max(0, Math.min(end, endQuarters));
    if (stop <= start) throw new RangeError('Analysis selection is outside the score');
    this.#setSelection({id: `region:${start}:${stop}`, startQuarters: start, endQuarters: stop}, true);
  }

  /** Return to the first available band after a local selection. */
  clearSelection(): void {
    this.#selection = undefined;
    this.#inspectionCache = undefined;
    this.#apply();
  }

  /** Reflects `density`; anything unreadable falls back to `comfortable`. */
  get density(): 'comfortable' | 'compact' {
    return (
      pick(
        this.getAttribute('density'),
        ['comfortable', 'compact'] as const,
        'comfortable',
        'density',
        (message) => this.#warn(message),
      ) ?? 'comfortable'
    );
  }

  set density(density: 'comfortable' | 'compact') {
    this.setAttribute('density', density);
  }

  /** Reflects `scheme`. `undefined` means "follow the page", which is the default. */
  get scheme(): 'light' | 'dark' | undefined {
    return pick(
      this.getAttribute('scheme'),
      ['light', 'dark'] as const,
      "the page's own scheme",
      'scheme',
      (message) => this.#warn(message),
    );
  }

  set scheme(scheme: 'light' | 'dark' | undefined) {
    if (scheme === undefined) this.removeAttribute('scheme');
    else this.setAttribute('scheme', scheme);
  }

  /** Reflects `spelling` — how a sounding set is named on every surface at once. */
  get spelling(): SpellingPreference {
    return (
      pick(
        this.getAttribute('spelling'),
        ['auto', 'sharp', 'flat'] as const,
        'auto',
        'spelling',
        (message) => this.#warn(message),
      ) ?? 'auto'
    );
  }

  set spelling(spelling: SpellingPreference) {
    this.setAttribute('spelling', spelling);
  }

  /**
   * Reflects `motion`. `auto` is the default and is not the same as
   * `continuous`: it hands the question to the shell, which asks the nearest
   * `data-motion` ancestor and then `prefers-reduced-motion`.
   */
  get motion(): 'auto' | 'continuous' | 'stepped' | 'none' {
    return (
      pick(
        this.getAttribute('motion'),
        ['auto', 'continuous', 'stepped', 'none'] as const,
        'auto',
        'motion',
        (message) => this.#warn(message),
      ) ?? 'auto'
    );
  }

  set motion(motion: 'auto' | 'continuous' | 'stepped' | 'none') {
    this.setAttribute('motion', motion);
  }

  /** Reflects `window`: the conveyor's field of view in seconds, or `auto`. */
  get window(): number | 'auto' {
    const raw = this.getAttribute('window');
    if (raw === null || raw.trim().toLowerCase() === 'auto') return 'auto';
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= MIN_WINDOW_SECONDS && seconds <= MAX_WINDOW_SECONDS
      ? seconds
      : 'auto';
  }

  set window(seconds: number | 'auto') {
    this.setAttribute('window', String(seconds));
  }

  // -------------------------------------------------------------------------
  // The shell. Mounted once and reconciled for the element's whole life: a
  // presenter and frame clock live until disconnect or a motion change.
  // -------------------------------------------------------------------------

  #mount(): void {
    if (this.#workbench) return;
    // No document, no performance: the base class is SSR-safe, so an instance
    // can be constructed and connected with nothing to render into. Every path
    // below reads `#workbench`, so declining here leaves the element inert
    // rather than half-built.
    const owner = this.ownerDocument as Document | undefined;
    if (typeof owner?.createElement !== 'function') return;
    const root = owner.createElement('div');
    root.className = 'webscore-analyze';
    root.setAttribute('part', 'root');
    // Host layout is an Element concern; the selected UIKit presenter owns
    // all visual content. Zero specificity keeps application CSS in control.
    const selector = this.localName.replace(/[^a-z0-9-]/gi, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
    const hostStyle = owner.createElement('style');
    // The size-contained workbench has no intrinsic inline width. Give flex
    // and grid compositions a fluid basis; siblings may still shrink it.
    hostStyle.textContent = `:where(${selector}) { box-sizing: border-box; inline-size: 100%; min-inline-size: 0; }
:where(${selector}:not([hidden])) { display: block; }
:where(.webscore-analyze) { min-inline-size: 0; }
:where(.webscore-analyze__evidence-status) { position: absolute; inline-size: 1px; block-size: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }`;
    root.append(hostStyle);
    this.replaceChildren(root);
    this.#root = root;
    this.#workbench = mountWorkbench(
      root,
      {
        snapshot: () => this.#shellState(),
        now: (frame) => this.#positionAt(frame.time),
        epoch: () => this.#epoch,
        // 🔴 The reduced-motion driver, and the reason this line is not
        // optional. Under `prefers-reduced-motion` the shell opens NO frame
        // loop (§2.5.3: a different driver, not a disabled one), so the only
        // thing that can ever move the conveyor is this notification. Without
        // it the reel's transform, the pinned name, every band's zone and the
        // slider's `aria-valuenow` are constant for the whole piece — which is
        // exactly the frozen table this redesign exists to remove, served to
        // the readers who asked for less motion rather than none.
        subscribe: (notify) => {
          this.#notify = notify;
          return (): void => {
            this.#notify = undefined;
          };
        },
      },
      {
        label: this.#recipe().slot.label,
        navigation: false,
        // Display configuration belongs to the application's Parameters UI.
        chrome: 'bare',
        parts: {root: 'presentation', frame: 'surface', stage: 'content', note: 'status-note', index: 'index'},
        // `auto` is passed as `undefined` ON PURPOSE. It is not a synonym for
        // `continuous`: it is the element declining to answer, so the shell
        // asks the nearest `data-motion` ancestor and then the viewer's own
        // `prefers-reduced-motion`. Naming a mode here overrides both.
        motion: this.#motion(),
        onError: (error) => this.#report(error),
      },
    );
    // Bare chrome removes configuration UI; the Element still owns one complete
    // component surface. Style the public frame hook rather than wrapping an
    // already painted presenter or changing the reusable workbench's defaults.
    // Read public tokens without publishing host-local defaults, so inherited
    // application themes remain authoritative across updates and remounts.
    const surface = this.#workbench.element.querySelector<HTMLElement>(':scope > [part~="surface"]');
    if (surface) {
      surface.style.padding = 'var(--wm-workbench-surface-padding, var(--wm-component-padding, var(--cp-padding, var(--wm-harmony-padding, var(--wm-analysis-padding, var(--webscore-analyze-padding, .6rem))))))';
      surface.style.border = 'var(--wm-workbench-surface-border, var(--wm-component-border, var(--cp-border, var(--wm-harmony-border, var(--wm-analysis-border, var(--webscore-analyze-border, 1px solid var(--wm-border, light-dark(#d8d8d8, #333))))))))';
      surface.style.background = 'var(--wm-workbench-surface-background, var(--wm-component-background, var(--cp-background, var(--wm-harmony-background, var(--wm-analysis-background, var(--webscore-analyze-bg, var(--wm-surface, light-dark(#fff, #111))))))))';
    }
    if (this.analysisType !== 'live-chord') {
      const status = owner.createElement('div');
      status.className = 'webscore-analyze__evidence-status';
      status.setAttribute('aria-label', 'Analysis evidence');
      this.#evidenceStatus = status;
      this.#workbench.stage.append(status);
    }
  }

  /** Rebuild motion-dependent presentation while retaining score and player state. */
  #remount(): void {
    if (!this.#workbench) return;
    this.#presenter?.destroy();
    this.#presenter = undefined;
    // The new frame owns new semantic rows; release the old row references.
    this.#rows.clear();
    this.#highlight.clear();
    this.#workbench.destroy();
    this.#workbench = undefined;
    this.#notify = undefined;
    this.#root?.remove();
    this.#root = undefined;
    this.#evidenceStatus = undefined;
    this.#renderedInspection = undefined;
    // The lane's material has to be reconciled onto the new nodes, so the
    // "nothing changed" shortcut in `#apply` must not fire on the first pass.
    this.#laneKey = '';
    this.#mount();
    this.#apply();
  }

  /** `motion`, as the kit reads it: `auto` is `undefined`, not a mode. */
  #motion(): MotionMode | undefined {
    const motion = this.motion;
    return motion === 'auto' ? undefined : motion;
  }

  /**
   * Say something once, however many frames notice it.
   *
   * Module-level, like {@link REPORTED}: two workbenches on one page have the
   * same misspelled attribute, and the reader needs to hear about it once.
   */
  #warn(message: string): void {
    if (REPORTED.has(message)) return;
    REPORTED.add(message);
    console.warn(`<${this.localName || 'analysis-component'}>: ${message}`);
  }

  /** Report a presenter or delegated command failure once. */
  #report(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (REPORTED.has(message)) return;
    REPORTED.add(message);
    console.warn(`<${this.localName || 'analysis-component'}>: ${message}`);
  }

  #destroy(): void {
    this.#revision += 1;
    this.#source.cancel();
    this.#unbind?.();
    this.#unbind = undefined;
    this.#player = undefined;
    this.#resetPlayerState();
    this.#presenter?.destroy();
    this.#presenter = undefined;
    this.#rows.clear();
    this.#workbench?.destroy();
    this.#workbench = undefined;
    this.#notify = undefined;
    this.#root?.remove();
    this.#root = undefined;
    this.#evidenceStatus = undefined;
    this.#renderedInspection = undefined;
    // Release derived caches when the component disconnects.
    this.#session = undefined;
    this.#model = undefined;
    this.#cache = undefined;
    this.#soundingCache = undefined;
    this.#selection = undefined;
    this.#selectionScore = undefined;
    this.#inspectionCache = undefined;
  }

  async #refresh(): Promise<void> {
    this.#revision += 1;
    if (!this.#recipe().needsScore) {
      this.#source.cancel();
      this.#score = undefined;
      this.#session = undefined;
      this.#error = undefined;
      this.#syncClock();
      if (this.#lastUpdate) this.#followTime(this.#lastUpdate);
      else this.#apply();
      return;
    }
    const {score, stale, error} = await this.#source.load();
    if (stale || !this.isConnected) return;
    this.#score = score;
    if (this.#selectionScore !== score) {
      this.#selection = undefined;
      this.#selectionScore = score;
      this.#inspectionCache = undefined;
      this.#clearChordChange();
      this.#lastEmittedChord = undefined;
    }
    const native = (this.#player as (Element & {playback?: ScorePlaybackSource}) | undefined)?.playback?.snapshot();
    if (native && native.readiness !== 'unavailable' && native.score && score && score !== native.score) {
      this.#resetPlayerState();
      this.setAttribute('data-player-state', 'mismatched');
    }
    this.#error = error;
    if (!score) this.#session = undefined;
    this.#syncClock();
    if (this.#lastUpdate) this.#followTime(this.#lastUpdate);
    else this.#apply();
  }

  /** Bound prediction to the loaded score, retaining snapshots across duration changes. */
  #syncClock(): void {
    const duration = this.#score?.durationSeconds ?? 0;
    if (duration === this.#clockDuration) return;
    this.#clockDuration = duration;
    this.#clock = createTransportClock(duration > 0 ? {durationSeconds: duration} : {});
  }

  // -------------------------------------------------------------------------
  // One domain event, one whole model, one reconcile. Nothing here is per-view
  // and nothing here draws: the presenters pull what they need.
  // -------------------------------------------------------------------------

  #apply(): void {
    const workbench = this.#workbench;
    if (!workbench) return;
    const model = this.#compute();
    this.#model = model;
    this.#root?.setAttribute('role', 'region');
    this.#root?.setAttribute('aria-label', model.recipe.slot.label);
    const settled = model.laneKey === this.#laneKey;
    this.#alignPresenter(workbench);
    // The rows are a pure function of the material, and rewriting a thousand
    // `<li>` texts and span stamps on every cursor is the single most expensive
    // thing this element could do twenty times a second. The playhead does not
    // need them rewritten — it needs them THERE.
    if (!settled) {
      // A row node is reused across views when its id repeats, so a highlight
      // laid on the old material would survive onto text that no longer says
      // what it said. Dropped here, and the next cursor puts it back.
      this.#highlight.clear();
      this.#renderIndex(workbench);
    }
    workbench.update();
    // A cursor arrives twenty times a second and every note-on lands here too.
    // The read-outs are a handful of nodes each and are repainted every time;
    // a conveyor is hundreds of bands, so it is repainted only when its
    // MATERIAL changed — the movement between those moments is the frame
    // clock's job, and reconciling a lane that has not changed would be the
    // per-frame work this whole arrangement exists to avoid.
    this.#laneKey = model.laneKey;
    if (this.#presenter && (!settled || this.#presenter.kind !== 'flow')) this.#presenter.update();
    this.#renderInspection();
    // Last, and only after every slot holds the new material: the shell turns
    // this into one reading and one `tick` for every slot at once. Under
    // continuous motion the loop would have done it a frame later anyway; under
    // reduced motion there IS no loop, and this is the entire driver.
    this.#notify?.();
  }

  #compute(): ViewModel {
    const type = this.analysisType;
    const recipe = this.#recipe();
    this.#moving = this.#animating(this.#now());
    const score = recipe.needsScore ? this.#score : undefined;
    const result = score && type === 'chords'
      ? this.#analyze(score) : undefined;
    const material = this.#material(recipe, result, score);
    const lane = material.lane;
    this.#syncSelection(lane, score);
    const index = material.index;
    const message = this.#error
      ?? (recipe.needsScore && !score ? 'Waiting for a score — set player, src or .score.'
        : index.length === 0 ? recipe.emptyLabel : '');
    return {
      recipe,
      score,
      lane: {
        ...lane,
        playing: this.#playing,
        focusGroup: material.lane.bands.find((band) => band.id === this.#selection?.id)?.group ?? this.#selection?.id,
      },
      sounding: type === 'live-chord' ? this.#sounding(this.#liveKey.result()) : undefined,
      index,
      laneKey: `${material.revision}|${this.#playing ? 1 : 0}|${this.#selection?.id ?? ''}`,
      phase: this.#error ? 'error'
        : this.#moving ? 'playing'
        : recipe.slot.kind === 'flow' && index.length === 0 ? 'empty' : 'idle',
      message,
      detail: score ? formatMetricalPosition(score, this.#quartersNow(score)) : '',
      inspection: score && this.#selection ? this.#inspect(score, this.#selection, result) : undefined,
    };
  }

  /** Reuse immutable lane geometry and semantic rows between player snapshots. */
  #material(
    recipe: ViewRecipe,
    result: AnalysisResult | undefined,
    score: Score | undefined,
  ): Material {
    const cached = this.#cache;
    if (cached && cached.score === score && cached.result === result) {
      return cached;
    }
    const lane = this.#laneFor(recipe, result, score);
    const material: Material = {
      revision: (this.#materials += 1),
      score,
      result,
      lane,
      index: this.#indexFor(lane, score),
    };
    this.#cache = material;
    return material;
  }

  /** Name only the sounding set; pitch diagrams belong to sibling View elements. */
  #sounding(key: Key | undefined): Pick<SoundingProjection, 'spelling' | 'naming'> {
    const midis = this.#soundingMidis;
    const held = midis.join(',');
    const signature = `${held}|${key ? `${key.tonic} ${key.mode}` : ''}|${this.spelling}`;
    const cached = this.#soundingCache;
    if (cached?.signature === signature) return cached.projection;
    const spelling = spellChord(midis, {key, spelling: this.spelling});
    const projection = {spelling, naming: projectNameplate(spelling)};
    this.#soundingCache = {signature, projection};
    return projection;
  }

  #clearChordChange(): void {
    if (this.#chordChangeTimer !== undefined) clearTimeout(this.#chordChangeTimer);
    this.#chordChangeTimer = undefined;
  }

  #scheduleChordChange(): void {
    if (this.analysisType !== 'live-chord') return;
    this.#clearChordChange();
    const chord = this.chord;
    if (!chord) {
      this.#lastEmittedChord = undefined;
      return;
    }
    if (chord === this.#lastEmittedChord) return;
    const midis = [...this.#soundingMidis];
    const revision = this.#revision;
    const publish = (): void => {
      this.#chordChangeTimer = undefined;
      if (!this.isConnected || revision !== this.#revision || this.chord !== chord) return;
      this.#lastEmittedChord = chord;
      this.dispatchEvent(new CustomEvent('webscore:chordchange', {
        detail: {chord, midis}, bubbles: true, composed: true,
      }));
    };
    const delay = this.stabilityMs;
    if (delay === 0) publish();
    else this.#chordChangeTimer = setTimeout(publish, delay);
  }

  /** The nameplate snapshot, configured by the external `alternates` attribute. */
  #nameplate(extra: Partial<NameplateView> = {}): NameplateView {
    const naming: NameplateView = {...(this.#model?.sounding?.naming ?? {}), ...extra};
    if (this.getAttribute('alternates') === 'hide') {
      delete naming.alternates;
    }
    return naming;
  }

  /**
   * `window` in seconds; UIKit resolves it against the measured container width.
   *
   * `auto` is two bars for the chord lane.
   * It is a duration, not a band count: a ritardando makes the same bars wider
   * on the reel, which is why the lane's axis is seconds.
   */
  #laneSpan(): number | undefined {
    const raw = this.getAttribute('window');
    const score = this.#score;
    const cached = this.#windowCache;
    if (cached && cached.raw === raw && cached.score === score) return cached.seconds;
    const seconds = this.#windowSeconds(raw, score);
    this.#windowCache = {raw, score, seconds};
    return seconds;
  }

  #windowSeconds(raw: string | null, score: Score | undefined): number | undefined {
    if (raw !== null && raw.trim().toLowerCase() !== 'auto') {
      const seconds = Number(raw);
      if (Number.isFinite(seconds) && seconds >= MIN_WINDOW_SECONDS && seconds <= MAX_WINDOW_SECONDS) {
        return seconds;
      }
      this.#warn(
        `window="${raw}" is not auto or a field of view between ${MIN_WINDOW_SECONDS} and ${MAX_WINDOW_SECONDS} seconds — following the score.`,
      );
    }
    // No score, no bars to count: the lane keeps its own default rather than
    // being handed a field of view measured against a piece that is not there.
    if (!score) return undefined;
    const bars = barsSeconds(score, AUTO_WINDOW_BARS);
    if (bars === undefined) return undefined;
    return Math.min(Math.max(bars, MIN_WINDOW_SECONDS), MAX_WINDOW_SECONDS);
  }

  #laneFor(
    recipe: ViewRecipe,
    result: AnalysisResult | undefined,
    score: Score | undefined,
  ): FlowLaneView {
    const source = recipe.slot.source;
    if (!score) return {...EMPTY_LANE, disabled: true};
    if (source === 'progression') {
      if (!result) return {...EMPTY_LANE, disabled: true};
      // The projection pins the position under the name for a PARKED lane. It
      // is dropped here rather than refreshed, because refreshing it means
      // reconciling every band on the reel twenty times a second to move one
      // text node — and the status strip already carries the live bar and beat,
      // on the cursor's own rate and deliberately outside the live region. What
      // stays pinned is the crossing band's own name, which is what the line is
      // there to answer.
      const lane = projectChordCells(score, projectProgression(result, score, 'chords', {roll: false}), {
        spelling: this.spelling,
        key: this.#chordKey(result).key,
      });
      return {...lane, bands: lane.bands.map((band) => ({...band, group: band.id})), pinned: undefined};
    }
    return EMPTY_LANE;
  }

  #syncSelection(lane: FlowLaneView, score: Score | undefined): void {
    const type = this.analysisType;
    if (!score || type === 'live-chord') return;
    const selected = this.#selection;
    if (selected?.id.startsWith('region:')) return;
    const band = lane.bands.find((item) => item.id === selected?.id)
      ?? lane.bands.find((item) => Boolean(item.primary));
    if (!band) {
      this.#selection = undefined;
      return;
    }
    const next = stampOf(band);
    if (!next) return;
    if (selected?.id === band.id && selected.startQuarters === next.start && selected.endQuarters === next.end) return;
    this.#selection = {id: band.id, startQuarters: next.start, endQuarters: next.end};
    this.#inspectionCache = undefined;
  }

  #setSelection(selection: AnalysisSelection, emit: boolean): void {
    const kind = this.#inspectionKind();
    if (!kind) return;
    const prior = this.#selection;
    if (prior?.id === selection.id && prior.startQuarters === selection.startQuarters
      && prior.endQuarters === selection.endQuarters) return;
    this.#selection = selection;
    this.#inspectionCache = undefined;
    this.#apply();
    if (emit) {
      this.dispatchEvent(new CustomEvent<AnalysisViewSelectDetail>('webscore:analysisselect', {
        detail: {...selection, kind}, bubbles: true, composed: true,
      }));
    }
  }

  #inspectionKind(): AnalysisViewSelectDetail['kind'] | undefined {
    return this.analysisType === 'chords' ? 'chord' : undefined;
  }

  #inspect(score: Score, selection: AnalysisSelection, result: AnalysisResult | undefined): AnalysisInspection | undefined {
    const kind = this.#inspectionKind();
    if (!kind) return undefined;
    const signature = `${kind}|${selection.id}|${selection.startQuarters}|${selection.endQuarters}|${this.spelling}|${this.getAttribute('key') ?? ''}`;
    const cached = this.#inspectionCache;
    if (cached?.score === score && cached.selection === selection && cached.signature === signature) return cached.value;
    const value = this.#chordInspection(score, selection, result);
    this.#inspectionCache = {score, selection, signature, value};
    return value;
  }

  #chordInspection(score: Score, selection: AnalysisSelection, result: AnalysisResult | undefined): AnalysisInspection {
    const cell = selection.id.startsWith('chord-cell-');
    const at = (selection.startQuarters + selection.endQuarters) / 2;
    const evidence = score.parts.flatMap((part) => part.notes
      .filter((note) => isPitchedNote(note)
        && (cell
          ? note.onsetQuarters.toFloat() < selection.endQuarters
            && note.offsetQuarters.toFloat() > selection.startQuarters
          : note.onsetQuarters.toFloat() <= at && note.offsetQuarters.toFloat() > at))
      .map((note) => ({note, partId: String(part.id)})));
    const {key, explicit} = this.#chordKey(result);
    const spelling = spellChordNotes(evidence.map((item) => item.note), {
      key, spelling: this.spelling,
    });
    const symbol = spelling.primary?.symbol ?? spelling.label;
    const degree = key && spelling.primary ? romanNumeralForChord(symbol, key) : undefined;
    const context = key ? `Degree ${degree ?? 'unknown'} in ${key.tonic} ${key.mode}${explicit ? ' (chosen)' : ' (score-wide estimate)'}`
      : 'No reliable key context';
    const pitches = new Map(spelling.pitches.map((pitch) => [pitch.midi, pitch]));
    return {
      kind: 'chord', selection,
      headline: symbol,
      detail: cell
        ? `Notes across ${formatMetricalPosition(score, selection.startQuarters)} to ${formatMetricalPosition(score, selection.endQuarters)} · ${context}`
        : `Sampled at ${formatMetricalPosition(score, at)} within the selected region · ${context}`,
      evidence: evidence.map(({note, partId}) => {
        const spelled = pitches.get(noteMidi(note));
        return `${spelled?.name ?? note.pitch?.toString() ?? 'pitch'} ${spelled?.degreeLabel ?? ''} · ${partId}/${String(note.voice)} · ${String(note.id)}`;
      }),
      candidates: spelling.namings.map((name) => ({
        id: name.symbol, label: name.symbol, detail: name.kind,
        selected: name.symbol === spelling.primary?.symbol,
      })),
    };
  }

  #chordKey(result: AnalysisResult | undefined): {key?: Key; explicit: boolean} {
    const keyAttribute = this.getAttribute('key');
    const explicitKey = parseKey(keyAttribute);
    if (keyAttribute && !explicitKey) {
      this.#warn(`key="${keyAttribute}" must name a tonic and major or minor mode — using the detected key.`);
    }
    const detected = result?.key.scores.length && result.key.confidence > 0 ? result.key : undefined;
    return {key: explicitKey ?? detected, explicit: Boolean(explicitKey)};
  }

  /** Semantic rows share the intervals drawn by the visible lane. */
  #indexFor(lane: FlowLaneView, score: Score | undefined): readonly IndexRow[] {
    if (!score) return [];
    const stamped = lane.primaryTrack;
    return lane.bands
      .filter((band) => Boolean(band.primary))
      .map((band) => ({
        id: band.id,
        text: rowText(band, score),
        span:
          stamped === undefined || (band.track ?? 0) === stamped ? stampOf(band) : undefined,
      }));
  }

  #analyze(score: Score): AnalysisResult {
    const shared = ANALYSES.get(score);
    if (shared) return shared;
    if (!this.#session) this.#session = createAnalysisSession(score);
    const result = this.#session.update(score);
    ANALYSES.set(score, result);
    return result;
  }

  // -------------------------------------------------------------------------
  // The shell's own snapshot.
  // -------------------------------------------------------------------------

  #shellState(): WorkbenchState {
    const model = this.#model;
    const recipe = model?.recipe ?? this.#recipe();
    return {
      views: [{id: recipe.id, label: recipe.label}],
      activeViewId: recipe.id,
      docks: [],
      // Presenters inherit density and colour from this minimal frame.
      density: this.density,
      scheme: this.scheme,
      phase: model?.phase ?? 'idle',
      status: {message: model?.message ?? '', detail: model?.detail ?? ''},
    };
  }

  /** Mount one presenter; UIKit handles resizing without replacing the host. */
  #alignPresenter(workbench: WorkbenchHandle): void {
    const spec = (this.#model?.recipe ?? this.#recipe()).slot;
    const visibleSpan = spec.kind === 'flow' ? this.#laneSpan() : undefined;
    const held = this.#presenter;
    if (held && held.visibleSpan === visibleSpan) return;
    const host = held?.host ?? this.ownerDocument.createElement('div');
    if (held) held.destroy();
    else {
      host.dataset.slot = spec.id;
      workbench.stage.append(host);
    }
    this.#presenter = this.#mountSlot(spec, host, workbench);
  }

  #mountSlot(spec: SlotSpec, host: HTMLElement, workbench: WorkbenchHandle): Tenant {
    if (spec.kind === 'flow') {
      const handle: FlowLaneHandle = mountFlowLane(
        host,
        {
          snapshot: () => this.#model?.lane ?? EMPTY_LANE,
          position: (tick) => tick.now,
          // `seek` alone. A band click already travels this way — the lane
          // calls `selectBand` AND `seek` for one click — so binding both
          // would announce the same gesture twice.
          seek: (position: number, phase: 'drag' | 'commit') => this.#seek(position, phase),
          ...(this.#inspectionKind() ? {
            selectBand: (id: string, band: FlowBandView) => {
              const span = stampOf(band);
              if (span) {
                const revision = this.#revision;
                this.#setSelection({id, startQuarters: span.start, endQuarters: span.end}, true);
                if (revision !== this.#revision) this.#skipNextBandSeek = true;
              }
            },
          } : {}),
        },
        {
          label: spec.label,
          // The workbench owns the one external surface. The musical lane
          // keeps its palette without painting another alpha background or box.
          surface: 'none',
          parts: {root: 'lane', viewport: 'viewport', reel: 'reel'},
          clock: workbench.clock,
          // The playhead owns the semantic index instead; see the class note.
          spans: false,
          reservePinned: this.analysisType === 'chords',
          // The caller owns seconds; UIKit owns responsive pixel geometry.
          visibleSpan: this.#laneSpan(),
          formatPosition: (position) => this.#describePosition(position),
          onError: (error) => this.#report(error),
        },
      );
      return {
        kind: spec.kind,
        visibleSpan: this.#laneSpan(),
        host,
        update: () => handle.update(),
        destroy: () => handle.destroy(),
      };
    }
    const handle: NameplateHandle = mountNameplate(
      host,
      {
        snapshot: () => this.#nameplate({emphasis: 'hero'}),
      },
      {
        label: spec.label,
        surface: 'none',
        stableLayout: true,
        parts: {root: 'nameplate', symbol: 'symbol'},
        onError: (error) => this.#report(error),
      },
    );
    return {kind: spec.kind, host, update: () => handle.update(), destroy: () => handle.destroy()};
  }

  #renderInspection(): void {
    const inspection = this.#model?.inspection;
    if (this.#renderedInspection === inspection) return;
    this.#renderedInspection = inspection;
    if (this.#evidenceStatus) {
      if (inspection) this.#evidenceStatus.setAttribute('role', 'status');
      else this.#evidenceStatus.removeAttribute('role');
      this.#evidenceStatus.textContent = inspection
        ? [inspection.headline, inspection.detail, ...inspection.evidence].join('. ')
        : '';
    }
  }

  // -------------------------------------------------------------------------
  // The semantic index. The shell hands over the `<ol>`; its rows are ours, and
  // so is their span contract — this is the node set the playhead lights.
  // -------------------------------------------------------------------------

  #renderIndex(workbench: WorkbenchHandle): void {
    const rows = this.#model?.index ?? [];
    const seen = new Set<string>();
    const ordered: HTMLLIElement[] = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      let node = this.#rows.get(row.id);
      if (!node) {
        node = this.ownerDocument.createElement('li');
        this.#rows.set(row.id, node);
      }
      if (node.textContent !== row.text) node.textContent = row.text;
      stampRow(node, row);
      ordered.push(node);
    }
    for (const [id, node] of [...this.#rows]) {
      if (seen.has(id)) continue;
      this.#rows.delete(id);
      node.remove();
    }
    const index = workbench.index;
    if (ordered.length !== index.childElementCount || ordered.some((node, at) => index.children[at] !== node)) {
      index.replaceChildren(...ordered);
    }
  }

  // -------------------------------------------------------------------------
  // Time. One reading per frame for the whole element, and the seek that goes
  // with it.
  // -------------------------------------------------------------------------

  #now(): number {
    const view = this.ownerDocument?.defaultView;
    return view?.performance?.now?.() ?? Date.now();
  }

  /** Predict the score position between owner snapshots for frame updates. */
  #positionAt(atMs: number): number {
    // Stop frame work when owner snapshots stop advancing or prediction expires.
    const moving = this.#animating(atMs);
    if (moving !== this.#moving) {
      this.#moving = moving;
      this.#settle();
    }
    const reading = this.#clock.readAt(atMs);
    this.#epoch = reading.epoch;
    return reading.seconds;
  }

  /** Only a score lane following an advancing owner requires animation frames. */
  #animating(atMs: number): boolean {
    return !this.#error && Boolean(this.#score) && this.#recipe().slot.kind === 'flow'
      && this.#playing && !this.#clock.readAt(atMs).held;
  }

  /**
   * Recompute once, out of band.
   *
   * `#positionAt` runs INSIDE the shell's frame emit, and reconciling the whole
   * model from there would rebuild nodes in the middle of the pass that is
   * reading them. The work is deferred to a microtask instead, and collapsed:
   * a transport settling is one event, however many frames notice it.
   */
  #settle(): void {
    if (this.#settling) return;
    this.#settling = true;
    queueMicrotask(() => {
      this.#settling = false;
      if (this.#workbench) this.#apply();
    });
  }

  #quartersNow(score: Score): number {
    const seconds = this.#clock.readAt(this.#now()).seconds;
    return score.timeMap.secondsToQuarters(Math.max(0, seconds)).toFloat();
  }

  #describePosition(position: number): string {
    const score = this.#model?.score;
    if (!score) return `${position.toFixed(2)} s`;
    return formatMetricalPosition(score, score.timeMap.secondsToQuarters(Math.max(0, position)).toFloat());
  }

  /** Announce the seek and drive the bound player, which does not listen. */
  #seek(position: number, phase: 'drag' | 'commit'): void {
    if (this.#skipNextBandSeek) {
      this.#skipNextBandSeek = false;
      return;
    }
    const score = this.#model?.score;
    if (!score) return;
    if (!Number.isFinite(position)) return;
    const seconds = Math.min(score.durationSeconds, Math.max(0, position));
    this.#seekOrigin ??= this.#clock.readAt(this.#now()).seconds;
    this.#clock.hold(seconds);
    if (phase === 'drag') return;
    const origin = this.#seekOrigin;
    this.#seekOrigin = undefined;
    const revision = this.#revision;
    const request = ++this.#seekRequest;
    const timeRevision = this.#timeRevision;
    const quarters = score.timeMap.secondsToQuarters(seconds).toFloat();
    const player = this.#player as (Element & {
      seek?: (seconds: number) => void | Promise<void>;
      seekNominal?: (seconds: number) => void | Promise<void>;
    }) | undefined;
    const current = () => this.#revision === revision && this.#seekRequest === request
      && this.#player === player && Boolean(this.#workbench);
    const failed = (error: unknown): void => {
      if (!current() || this.#timeRevision !== timeRevision) return;
      this.#clock.stop(this.#now(), origin);
      this.#apply();
      if (this.#root) this.#highlight.follow(this.#indexRoot(), score, origin);
      this.#report(error);
    };
    this.dispatchEvent(
      new CustomEvent<AnalysisViewSeekDetail>('webscore:seek', {
        detail: {quarters, seconds}, bubbles: true, composed: true,
      }),
    );
    // A listener may replace the player, score, or component during the event.
    if (!current()) return;
    try {
      const pending = seekAnalysisPlayer(player, seconds, score, this.#rate, current);
      if (pending) void Promise.resolve(pending).catch(failed);
    } catch (error) {
      failed(error);
    } finally {
      if (current()) {
        this.#clock.release(this.#now());
        this.#apply();
        if (this.#root) this.#highlight.follow(this.#indexRoot(), score, this.#clock.readAt(this.#now()).seconds);
      }
    }
  }

  // -------------------------------------------------------------------------
  // The player.
  // -------------------------------------------------------------------------

  #bindPlayer(): void {
    this.#revision += 1;
    this.#unbind?.();
    this.#unbind = undefined;
    this.#player = undefined;
    this.#resetPlayerState();
    this.#unbind = bindAnalysisPlayer(this, {
      score: () => this.#source.score ?? (this.getAttribute('src') ? this.#score : undefined),
      targetChanged: (target) => {
        this.#revision += 1;
        this.#resetPlayerState();
        this.#player = target;
        this.#apply();
      },
      dataChanged: () => {
        if (!this.#source.score && !this.getAttribute('src')) void this.#refresh();
      },
      reset: () => {
        this.#resetPlayerState();
        this.#apply();
      },
      ...(this.analysisType === 'live-chord' ? {
        noteOn: (midi: number) => {
          this.#liveKey.noteOn(midi);
          this.#liveChord.noteOn(midi);
        },
        noteOff: (midi: number) => this.#liveChord.noteOff(midi),
      } : {}),
      timeUpdate: (_seconds, update) => this.#followTime(update),
      end: () => {
        this.#playing = false;
        if (this.#lastUpdate) {
          this.#lastUpdate = {...this.#lastUpdate, playing: false,
            nominalSeconds: this.#score?.durationSeconds ?? this.#lastUpdate.nominalSeconds};
        }
        // With the length, so the transport parks at the double bar instead of
        // wherever the last coast happened to reach.
        this.#clock.stop(this.#now(), this.#score?.durationSeconds);
        if (this.analysisType === 'live-chord') {
          this.#liveKey.reset();
          this.#liveChord.reset();
        }
        this.#highlight.clear();
        this.#apply();
      },
    });
  }

  #followTime(update: AnalysisTimeUpdate): void {
    this.#timeRevision += 1;
    this.#lastUpdate = update;
    this.#playing = update.playing ?? true;
    this.#rate = update.rate ?? rateFromDurations(
      this.#score?.durationSeconds ?? 0, update.transportDurationSeconds,
    );
    if (this.#playing) {
      this.#clock.sample({nominalSeconds: update.nominalSeconds, rate: this.#rate, atMs: this.#now()});
    } else {
      this.#clock.stop(this.#now(), update.nominalSeconds);
    }
    this.#apply();
    const score = this.#model?.score;
    if (score && this.#root) {
      this.#highlight.follow(this.#indexRoot(), score, this.#clock.readAt(this.#now()).seconds);
    }
  }

  #indexRoot(): HTMLElement {
    return (this.#workbench?.index ?? this.#root) as HTMLElement;
  }

  #resetPlayerState(): void {
    this.#timeRevision += 1;
    // Live analysis and playhead state are owned by the current player
    // subscription. A disconnect or selector replacement starts a fresh
    // ownership domain instead of mixing events from two players.
    if (this.analysisType === 'live-chord') {
      this.#clearChordChange();
      this.#lastEmittedChord = undefined;
      this.#liveKey.reset();
      this.#liveChord.reset();
    }
    this.#highlight.clear();
    this.#soundingMidis = [];
    this.#playing = false;
    this.#moving = false;
    this.#rate = 1;
    this.#lastUpdate = undefined;
    this.#seekOrigin = undefined;
    this.#skipNextBandSeek = false;
    // A fresh clock, unconditionally: a new player is a new time domain, and
    // the old one's anchor, epoch and measured interval belong to a transport
    // that is no longer answering.
    this.#clockDuration = this.#score?.durationSeconds ?? 0;
    this.#clock = createTransportClock(
      this.#clockDuration > 0 ? {durationSeconds: this.#clockDuration} : {},
    );
  }
}

/**
 * How long the first `bars` bars of a piece last, in nominal seconds.
 *
 * Bars rather than a fixed number of seconds, because the field of view a
 * reader can hold a PHRASE in is measured in bars — and at 60 bpm those eight
 * bars are twice as long as at 120, which is exactly what the conveyor should
 * show. Read through the measure grid, so a pickup and a 6/8 both come out
 * right instead of through an assumed four quarters.
 */
function barsSeconds(score: Score, bars: number): number | undefined {
  const first = score.timeMap.quartersToMBS(Rational.ZERO).measure;
  const end = score.timeMap.mbsToQuarters({
    measure: first + Math.max(1, Math.round(bars)),
    beat: 1,
    subbeat: Rational.ZERO,
  });
  const seconds = score.timeMap.quartersToSeconds(end);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function stampOf(band: FlowBandView): {start: number; end: number} | undefined {
  const start = band.stampStart ?? band.start;
  const end = band.stampEnd ?? band.end;
  return Number.isFinite(start) && Number.isFinite(end) ? {start, end} : undefined;
}

function rowText(band: FlowBandView, score: Score): string {
  const stamp = stampOf(band);
  const parts = [
    band.primary,
    band.secondary,
    stamp ? formatMetricalPosition(score, stamp.start) : undefined,
  ].filter((part): part is string => Boolean(part));
  // De-duplicated, because a projection is free to have already put the
  // position in `secondary` and a row reading `bar 3 · bar 3` is a row nobody
  // wrote on purpose.
  return [...new Set(parts)].join(' · ');
}

/** Stamp the semantic row on the same quarter-note interval as its band. */
function stampRow(node: HTMLLIElement, row: IndexRow): void {
  if (!row.span) {
    delete node.dataset.startQuarters;
    delete node.dataset.endQuarters;
    return;
  }
  node.dataset.startQuarters = String(row.span.start);
  node.dataset.endQuarters = String(row.span.end);
}

function parseKey(raw: string | null): Key | undefined {
  if (!raw) return undefined;
  const match = /^([A-Ga-g](?:#|b)?)\s+(major|minor)$/i.exec(raw.trim());
  if (!match) return undefined;
  return {tonic: `${match[1][0].toUpperCase()}${match[1].slice(1)}`, mode: match[2].toLowerCase() as Key['mode']};
}
