import {bindLocalization, message as localize, type UILocalization} from './localization';
import {
  harmonyValues,
  harmonyDensity,
  harmonyMotion,
  harmonyParts,
  harmonyRule,
  harmonyScheme,
  harmonySheet,
  harmonyTokens,
  severityFill,
} from './harmony-style';
import {addClassNames, finite, setParts} from './internal/dom';
import {controlHeight, controlRadius, controlThumbRadius} from './internal/control';
import {
  joinFrameLoop,
  resolveMotion,
  type FrameClock,
  type FrameTick,
  type MotionMode,
  type ResolvedMotion,
} from './internal/frame';
import {claimHost, createErrorSink, createUpdateLoop} from './internal/lifecycle';
import {installStyle, paint} from './internal/style';
import {componentSurfaceDeclarations} from './internal/surface';
import type {Declarations} from './styles';

/**
 * The shell every analysis view sits in: a grid, a tablist, a stage, a rail of
 * docks, a strip, a status bar — and NOTHING that draws content.
 *
 * ## It hands out slots; it does not fill them
 *
 * `handle.stage` and `handle.dock(id)` are HOSTS. The caller mounts its own
 * presenters into them, and this module never looks inside. That is what makes
 * one shell serve six different views without knowing what any of them show:
 * a view is `{id, label}` and a dock is `{id, label, placement}`, so the word
 * for what a dock contains does not appear anywhere in this file. It cannot,
 * because this module may not import the surfaces it hosts — they are separate
 * published subpaths, and a shell that reached into one would make the whole
 * kit a single chunk.
 *
 * ## The rule this module lives or dies by
 *
 * **`update()` is idempotent and never rebuilds a slot node.** Every dock holds
 * a child presenter that took that node with `claimHost`, and rebuilding the
 * node unmounts that presenter silently — no exception, no warning, just a dock
 * that stopped answering. So the stage, the semantic index and every dock body
 * are created once, at mount, and afterwards only ever have attributes written
 * on them. Tabs and dock frames are reconciled by id and REORDERED rather than
 * replaced.
 *
 * Under a clock that rule gains a second, sharper meaning: an `update()` called
 * once per frame would unmount every child presenter sixty times a second. The
 * frame path and the snapshot path are therefore completely separate — the
 * clock only ever calls {@link WorkbenchHandle.tick}, which touches no node this
 * shell owns and re-reads no snapshot.
 *
 * ## One reading per frame, taken here
 *
 * `internal/frame.ts` owns one `requestAnimationFrame` per document. This shell
 * subscribes to it ONCE, calls `binding.now()` exactly ONCE per frame, and
 * hands every slot the same {@link FrameTick} through {@link FrameClock}. Two
 * presenters reading the position independently is precisely how four docks
 * that are meant to bite together drift apart by a frame; a shared axis is only
 * shared when the READING is shared.
 *
 * The loop is gated three ways, and each gate is a real bug it prevents:
 *
 * - No subscriber, no loop. A page holding a parked workbench costs nothing.
 * - `phase` neither `playing` nor `listening`, no loop. An idle shell burning a
 *   frame callback in a background tab is not a style preference.
 * - Reduced motion opens NO loop at all and steps on the caller's own
 *   notifications instead. That is honest in a way "run the loop with the
 *   durations set to zero" is not, and it is the electricity §2.5.3 promises.
 *
 * ## Layout is container queries, never a media query
 *
 * This element is routinely put in a 16rem-tall box on a documentation page.
 * The viewport's width is not a fact about it, and asking the viewport gives a
 * two-column shell inside a 300px column. The root is the query container and
 * an inner frame carries the grid, because an element cannot query itself.
 *
 * `data-rail="false"` collapses the grid to one column with no JavaScript
 * touching a style: the shell says what is true and the sheet decides what that
 * looks like.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary.
// ---------------------------------------------------------------------------

export type {FrameClock, FrameTick, MotionMode} from './internal/frame';

/** One switchable view. The shell knows an id and a word to print, and no more. */
export interface WorkbenchView {
  id: string;
  label: string;
  /** Long form, shown as the tab's tooltip. */
  description?: string;
  /**
   * Which docks this view wants, by id. Absent means all of them. A dock left
   * out is not merely hidden: its frame and its switch are gone too, because a
   * switch for something this view could never show is a dead control.
   */
  docks?: readonly string[];
}

/** One side panel. `placement` is a position on the grid, not a kind of thing. */
export interface WorkbenchDock {
  id: string;
  label: string;
  /** Defaults to `rail`. */
  placement?: 'rail' | 'strip';
  /**
   * Whether the viewer may fold this dock away. Defaults to true, and is forced
   * false when the binding has no `toggleDock` to receive the answer.
   */
  toggleable?: boolean;
}

/**
 * The five states a shell can be in, written to `data-phase`.
 *
 * `phase` also GATES THE CLOCK: only `playing` and `listening` run a frame
 * loop. Everything else is a still shell that still answers the pointer and the
 * keyboard — parked is not blank, and a workbench you can drag through is more
 * alive than one spinning a loop over nothing.
 */
export type WorkbenchPhase = 'idle' | 'listening' | 'playing' | 'empty' | 'error';

/**
 * What the status bar says.
 *
 * `message` is a live region and `detail` deliberately is not: the detail
 * changes many times a second while something is playing, and a live region
 * that does would read a position out loud for as long as the piece lasts.
 */
export interface WorkbenchStatus {
  message?: string;
  detail?: string;
}

export interface WorkbenchState {
  views: readonly WorkbenchView[];
  activeViewId: string;
  /**
   * Every dock this shell will ever hold, and therefore **stable for the life
   * of the mount**. A dock that leaves this array takes its slot node with it,
   * and with the node goes whatever the caller mounted inside — the shell says
   * so through `onError` rather than silently. Use {@link WorkbenchView.docks}
   * to choose which of them a view offers.
   */
  docks: readonly WorkbenchDock[];
  /** Missing or `true` means shown. Only an explicit `false` folds a dock away. */
  dockVisibility?: Readonly<Record<string, boolean>>;
  title?: string;
  subtitle?: string;
  density?: 'comfortable' | 'compact';
  /** Omitted means "follow the host page", which is the right default for a card. */
  scheme?: 'light' | 'dark';
  phase?: WorkbenchPhase;
  status?: WorkbenchStatus;
}

export interface WorkbenchBinding {
  /** Content. Pulled on domain events — NEVER per frame. */
  snapshot(): WorkbenchState;
  /**
   * This frame's ONE position, in the caller's own units, on an axis this shell
   * has never been told the meaning of. Omitting it means the shell runs no
   * frame loop at all.
   */
  now?(frame: {time: number; delta: number}): number;
  /**
   * A discontinuity counter, passed straight through to `FrameTick.epoch`. A
   * presenter snaps when it changes and interpolates when it does not, which is
   * what stops a backwards seek being tweened across material nobody heard.
   */
  epoch?(): number;
  activateView?(id: string): void;
  toggleDock?(id: string, next: boolean): void;
  subscribe?(notify: () => void): () => void;
}

export interface WorkbenchClassNames {
  root?: string;
  header?: string;
  tablist?: string;
  tab?: string;
  stage?: string;
  rail?: string;
  strip?: string;
  status?: string;
  index?: string;
}

export interface WorkbenchParts {
  root?: string;
  /** Outer painted frame, below the query-container root. */
  frame?: string;
  header?: string;
  tablist?: string;
  tab?: string;
  stage?: string;
  rail?: string;
  strip?: string;
  status?: string;
  index?: string;
}

export interface WorkbenchOptions {
  localization?: UILocalization;
  /**
   * `full` (the default) is header, stage, rail, strip and status bar. `bare`
   * is an unframed stage with no padding — a sibling element wraps the card it
   * already has and inherits this skin without pretending to have six views.
   */
  chrome?: 'full' | 'bare';
  /** Show view tabs. False retains dock controls/status for a single named region. */
  navigation?: boolean;
  motion?: MotionMode;
  label?: string;
  classNames?: WorkbenchClassNames;
  parts?: WorkbenchParts;
  onError?: (error: unknown) => void;
  /**
   * A dock started or stopped answering — `dock(id)` flipping between a node
   * and `undefined`, whatever the reason: the viewer folded it, the new view
   * did not ask for it, or it left `docks` entirely.
   *
   * This is the other half of the refusal `dock(id)` performs. The shell can
   * decline to hand out a hidden slot, but it cannot take down a presenter it
   * does not own, so a tenant mounted before the fold would go on drawing and
   * holding a clock subscription inside a box nobody can see. **Destroy the
   * tenant on `false` and mount a fresh one on `true`.**
   *
   * Only ever reports a CHANGE: the first pass records the state silently, so a
   * callback never fires before `mountWorkbench` has returned the handle it
   * would need to answer.
   */
  onDockVisibility?: (id: string, visible: boolean) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface WorkbenchHandle {
  element: HTMLElement;
  /** The caller's mount point for the current view. Never rebuilt. */
  readonly stage: HTMLElement;
  /**
   * A dock's mount point, or `undefined` for an unknown id, a dock this view
   * did not ask for, one the viewer folded away, and every id under
   * `chrome: 'bare'`. A caller must not be able to mount into something nobody
   * can see: the presenter would run, take a clock subscription and paint into
   * a hidden box for the life of the page.
   *
   * The refusal only covers what has not been mounted yet. A tenant already in
   * a dock that folds is the caller's to take down, and
   * {@link WorkbenchOptions.onDockVisibility} is where the shell says so.
   */
  dock(id: string): HTMLElement | undefined;
  /**
   * The current view's semantic list, rendered as a DIRECT CHILD OF THE HOST
   * and a sibling of the shell's own frame. It is the caller's slot, emptied by
   * nobody: a shell that owned its children could not be the readable twin of a
   * stage whose contents it knows nothing about.
   */
  readonly index: HTMLOListElement;
  /**
   * The live region's own node, for a caller that would rather write it than
   * snapshot it — and `undefined` under `chrome: 'bare'`, which builds no
   * status bar. A node that is not in the tree is worse than no node: text
   * written to it disappears with no error at all.
   */
  readonly statusMessage: HTMLElement | undefined;
  /** The one clock every slot in this shell reads. */
  readonly clock: FrameClock;
  /**
   * Drive one frame by hand. The deterministic seam: a test drives this instead
   * of waiting on a real ~16 ms rAF, and a shell whose view has no rAF at all
   * still has a way to be correct.
   */
  tick(): void;
  /** Re-read the snapshot and reconcile. The clock NEVER calls this. */
  update(): void;
  destroy(): void;
}

type WorkbenchHost = HTMLElement | ShadowRoot;

// ---------------------------------------------------------------------------
// The skin.
//
// Every value is a CHAIN ending in a literal, never a bare `var()`: this shell
// is allowed to be mounted on a node carrying no tokens at all, where a bare
// custom property is invalid at computed-value time — which paints a control
// invisible, the one failure a colour system may not have.
// ---------------------------------------------------------------------------

const INK = harmonyValues.ink;
const INK_MUTED = harmonyValues.inkMuted;
const SURFACE = harmonyValues.surface;
const LINE = harmonyValues.line;
const ACCENT = harmonyValues.accent;
const ON_ACCENT = harmonyValues.onAccent;
const TRACK = harmonyValues.track;
const RADIUS = 'var(--wui-harmony-radius, 0)';

const FONT = 'var(--wui-harmony-font, inherit)';
const FONT_MONO = 'var(--wui-harmony-font-mono, ui-monospace, monospace)';
const SIZE_TITLE = 'var(--wui-harmony-size-title, 1rem)';
const SIZE_LABEL = 'var(--wui-harmony-size-label, .74rem)';
const SIZE_MICRO = 'var(--wui-harmony-size-micro, .7rem)';

const SPACE_1 = 'var(--wui-harmony-space-1, 4px)';
const SPACE_2 = 'var(--wui-harmony-space-2, 8px)';

const EASE = 'var(--wui-harmony-motion-ease, ease-out)';
const MOTION_CHIP = 'var(--wui-harmony-motion-chip, 120ms)';
const CONTROL_HEIGHT = controlHeight('workbench');
const SWITCH_TRAVEL = `translateX(calc(${CONTROL_HEIGHT} * .625))`;

/**
 * The colour of the line material arrives on, and where it stands.
 *
 * The colour is the flow lane's own token, so the skeleton this shell draws on
 * an empty stage and the surface that later fills it agree without the shell
 * importing that module. The position is the literal 33% the lane defaults its
 * `anchor` option to — a knob, not a token, over there, and inventing a token
 * here to mirror an option there would be a name nothing reads.
 */
const NOW_LINE = `var(--wui-harmony-flow-now, var(--wm-harmony-flow-now, ${ACCENT}))`;
const NOW_ANCHOR = '33%';

/**
 * The rail's width, as one knob rather than three magic numbers.
 *
 * `clamp` and not a media query for the same reason the breakpoints below are
 * container queries: a percentage of the SHELL is a fact about the shell, and a
 * percentage of the viewport is a fact about something else entirely.
 */
const RAIL = 'var(--wui-workbench-rail, clamp(228px, 28%, 312px))';

/** The width a dock is never squeezed below once the rail has become a shelf. */
const DOCK_FLOOR = 'var(--wui-workbench-dock-min, 240px)';

/**
 * Below this the rail drops under the stage; below the second, one column.
 *
 * These are widths of the query CONTAINER'S CONTENT BOX, which is why the card's
 * border and padding sit on the frame one level down rather than on the root: a
 * padded container would fire both of these ~26px late, and the threshold would
 * then MOVE whenever a host retuned `--wui-harmony-pad`. A breakpoint that
 * depends on a spacing token is a breakpoint nobody can document.
 */
const BREAK_RAIL = 720;
const BREAK_TIGHT = 440;

/** How long the listening dot takes to breathe once. A CSS animation, not a tick. */
const BREATHE = '1.6s';

/**
 * The three grids, named once and used by both paths.
 *
 * The record below can hold only ONE value per property, so the collapsed forms
 * live here as tuples: the sheet reaches them through a selector and a query,
 * and the inline path writes whichever one is true straight onto the frame.
 * Two spellings of one grid is how a shell ends up responsive on one path only.
 */
const GRID_FULL = [
  '"header header" "main rail" "strip strip" "status status"',
  `minmax(0, 1fr) ${RAIL}`,
  'auto minmax(0, 1fr) auto auto',
] as const;

const GRID_SINGLE = [
  '"header" "main" "strip" "status"',
  'minmax(0, 1fr)',
  'auto minmax(0, 1fr) auto auto',
] as const;

const GRID_BARE = ['"main"', 'minmax(0, 1fr)', 'minmax(0, 1fr)'] as const;
const BARE_FRAME = {...componentSurfaceDeclarations('workbench', {border: '0', padding: '0', background: SURFACE}), gap: '0'};

const workbenchParts = {
  /**
   * The query container, and nothing else — no border, no padding. The grid is
   * one level down because an element cannot answer a container query about
   * itself, and a shell that had to be wrapped by its caller to become
   * responsive would be a shell that is responsive only when someone
   * remembered.
   *
   * The card's box is stripped off this node and re-declared on the frame,
   * because a container query resolves against the CONTENT box: leaving the
   * padding here would make every breakpoint a function of a spacing token.
   */
  root: {
    display: 'block',
    position: 'relative',
    'min-width': '0',
    border: '0',
    padding: '0',
    'container-type': 'inline-size',
    'container-name': 'wui-workbench',
    color: INK,
    background: 'transparent',
    'font-family': FONT,
  },
  /**
   * The grid, and the card's box — taken from `harmonyParts.root` itself rather
   * than respelled, so the border and padding that moved down here cannot drift
   * from the ones every other analysis surface draws.
   */
  frame: {
    display: 'grid',
    ...componentSurfaceDeclarations('workbench', {
      border: harmonyParts.root.border, padding: harmonyParts.root.padding, background: SURFACE,
    }),
    'grid-template-areas': GRID_FULL[0],
    'grid-template-columns': GRID_FULL[1],
    'grid-template-rows': GRID_FULL[2],
    gap: SPACE_2,
    'min-width': '0',
    'min-height': '0',
    height: '100%',
  },
  header: {
    'grid-area': 'header',
    display: 'flex',
    'flex-wrap': 'wrap',
    'align-items': 'baseline',
    'justify-content': 'space-between',
    gap: SPACE_2,
    'min-width': '0',
  },
  identity: {display: 'flex', 'flex-direction': 'column', gap: SPACE_1, 'min-width': '0'},
  title: {margin: '0', 'font-size': SIZE_TITLE, 'font-weight': '600'},
  subtitle: {margin: '0', 'font-size': SIZE_LABEL, color: INK_MUTED},
  tablist: {
    display: 'flex',
    'align-items': 'center',
    gap: SPACE_1,
    'min-width': '0',
    'overflow-x': 'auto',
    // The strip scrolls sideways at the tightest size and must never take the
    // page with it; a tablist is not a scroll story.
    'overscroll-behavior-x': 'contain',
    'scrollbar-width': 'none',
  },
  tab: {
    'box-sizing': 'border-box',
    appearance: 'none',
    display: 'inline-flex',
    'align-items': 'center',
    flex: '0 0 auto',
    margin: '0',
    padding: `${SPACE_1} ${SPACE_2}`,
    border: '0',
    'border-radius': controlRadius('workbench'),
    'min-height': CONTROL_HEIGHT,
    background: 'transparent',
    color: INK_MUTED,
    font: 'inherit',
    'font-size': SIZE_LABEL,
    'line-height': '1.6',
    cursor: 'pointer',
    // Colour only. A tab that resized on selection would reflow the whole strip
    // under the pointer that is about to click the next one.
    transition: `color ${MOTION_CHIP} ${EASE}, background ${MOTION_CHIP} ${EASE}`,
  },
  tabActive: {background: ACCENT, color: ON_ACCENT},
  main: {
    'grid-area': 'main',
    display: 'flex',
    'flex-direction': 'column',
    gap: SPACE_1,
    'min-width': '0',
    'min-height': '0',
  },
  stage: {position: 'relative', flex: '1 1 auto', 'min-width': '0', 'min-height': '0'},
  note: {margin: '0', 'font-size': SIZE_LABEL, color: INK_MUTED},
  rail: {
    'grid-area': 'rail',
    display: 'flex',
    'flex-direction': 'column',
    gap: SPACE_2,
    'min-width': '0',
    'min-height': '0',
  },
  strip: {
    'grid-area': 'strip',
    display: 'flex',
    'flex-wrap': 'wrap',
    gap: SPACE_2,
    'min-width': '0',
  },
  dock: {
    display: 'flex',
    'flex-direction': 'column',
    gap: SPACE_1,
    'min-width': '0',
    flex: '1 1 auto',
  },
  dockHead: {
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'space-between',
    gap: SPACE_1,
    'min-width': '0',
  },
  dockLabel: {
    'font-size': SIZE_MICRO,
    'letter-spacing': '.06em',
    'text-transform': 'uppercase',
    color: INK_MUTED,
    'min-width': '0',
    overflow: 'hidden',
    'text-overflow': 'ellipsis',
    'white-space': 'nowrap',
  },
  dockToggle: {
    'box-sizing': 'border-box',
    appearance: 'none',
    display: 'inline-flex',
    'align-items': 'center',
    flex: '0 0 auto',
    width: `calc(${CONTROL_HEIGHT} * 1.625)`,
    height: CONTROL_HEIGHT,
    margin: '0',
    padding: '3px',
    border: `1px solid ${LINE}`,
    'border-radius': controlRadius('workbench'),
    background: TRACK,
    cursor: 'pointer',
    transition: `background ${MOTION_CHIP} ${EASE}`,
  },
  dockKnob: {
    display: 'block',
    width: `calc(${CONTROL_HEIGHT} - 8px)`,
    height: `calc(${CONTROL_HEIGHT} - 8px)`,
    'border-radius': controlThumbRadius('workbench'),
    background: INK_MUTED,
    transition: `transform ${MOTION_CHIP} ${EASE}, background ${MOTION_CHIP} ${EASE}`,
  },
  dockBody: {'min-width': '0'},
  status: {
    'grid-area': 'status',
    display: 'flex',
    'align-items': 'baseline',
    gap: SPACE_2,
    'min-width': '0',
    'padding-top': SPACE_1,
    'border-top': `1px solid ${LINE}`,
    'font-size': SIZE_LABEL,
  },
  dot: {
    flex: '0 0 auto',
    width: '8px',
    height: '8px',
    'border-radius': '999px',
    background: severityFill(undefined),
    'align-self': 'center',
  },
  message: {margin: '0', 'min-width': '0', flex: '1 1 auto'},
  /**
   * Mono with tabular figures: the detail is a counter, and a proportional one
   * makes the whole bar twitch on every digit that changes width.
   */
  detail: {
    margin: '0',
    flex: '0 0 auto',
    'font-family': FONT_MONO,
    'font-variant-numeric': 'tabular-nums',
    'font-size': SIZE_MICRO,
    color: INK_MUTED,
  },
  /**
   * The semantic twin, visually hidden and fully readable. Same recipe the flow
   * lane uses for its own index, so a reader meets one shape in both places.
   */
  index: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    margin: '0',
    padding: '0',
    overflow: 'hidden',
    'clip-path': 'inset(50%)',
    'white-space': 'nowrap',
    'list-style': 'none',
  },
} satisfies Readonly<Record<string, Declarations>>;

/**
 * The state-driven grids and the two a container query owns.
 *
 * Only the last two are the documented cost of `stylesheet: false`. The first
 * two are not responsive niceties — they are the shell saying which grid is
 * TRUE right now — so the inline path writes them itself, from the same tuples,
 * rather than leaving an empty 300px rail column on a shell that has no rail.
 */
const RESPONSIVE = [
  // No rail to show: one column, decided by the shell's own truth rather than
  // by JavaScript reaching into a style object.
  harmonyRule('.wui-workbench[data-rail="false"] .wui-workbench__frame', {
    'grid-template-areas': GRID_SINGLE[0],
    'grid-template-columns': GRID_SINGLE[1],
    'grid-template-rows': GRID_SINGLE[2],
  }),
  harmonyRule('.wui-workbench[data-chrome="bare"] .wui-workbench__frame', {
    ...BARE_FRAME,
    'grid-template-areas': GRID_BARE[0],
    'grid-template-columns': GRID_BARE[1],
    'grid-template-rows': GRID_BARE[2],
  }),
  [
    `@container wui-workbench (max-width: ${BREAK_RAIL - 1}px) {`,
    indent(
      harmonyRule('.wui-workbench__frame', {
        'grid-template-areas': '"header" "main" "rail" "strip" "status"',
        'grid-template-columns': 'minmax(0, 1fr)',
        'grid-template-rows': 'auto minmax(0, 1fr) auto auto auto',
      }),
    ),
    // The rail becomes a shelf: the docks are the same nodes in the same order,
    // laid along the other axis. Nothing is dropped at a narrow width, because
    // a control that vanishes when the box is small is a control the viewer
    // cannot find.
    indent(
      harmonyRule('.wui-workbench__rail', {
        'flex-direction': 'row',
        'overflow-x': 'auto',
        'overscroll-behavior-x': 'contain',
      }),
    ),
    // Every dock gets a readable width or the shelf scrolls; found by running
    // it. A column shares its width by height, but a ROW shares it by intrinsic
    // content, so one dock holding a wide drawing starves the two beside it —
    // three surfaces became 515px, 70px and 9px on a 594px shelf. Growing from
    // an equal floor and refusing to shrink is what makes the scrollbar, and a
    // scrollbar is the honest answer to "these do not fit".
    indent(
      harmonyRule('.wui-workbench__rail .wui-workbench__dock', {
        flex: `1 0 min(100%, ${DOCK_FLOOR})`,
      }),
    ),
    '}',
  ].join('\n'),
  [
    `@container wui-workbench (max-width: ${BREAK_TIGHT - 1}px) {`,
    indent(harmonyRule('.wui-workbench__identity', {display: 'none'})),
    indent(harmonyRule('.wui-workbench__status', {'flex-wrap': 'wrap'})),
    '}',
  ].join('\n'),
].join('\n\n');

function indent(rule: string): string {
  return rule
    .split('\n')
    .map((row) => `  ${row}`)
    .join('\n');
}

/**
 * The shell's stylesheet. Exported so a host rendering into its own light DOM
 * can install it once instead of taking it per mount; a host that passes
 * `stylesheet: false` gets the identical boxes painted onto the nodes, from the
 * same records.
 *
 * It opens with `harmonySheet`, making this root a token carrier for its slots.
 * Tenants that inherit those tokens follow the shell's density. A presenter
 * that installs its own token root, such as a pitch surface, needs the caller
 * to forward density through that presenter's options when mounting it.
 */
export const workbenchStyle = [
  harmonySheet('.wui-workbench'),

  harmonyRule('.wui-workbench', workbenchParts.root),
  harmonyRule('.wui-workbench__frame', workbenchParts.frame),
  harmonyRule('.wui-workbench__header', workbenchParts.header),
  harmonyRule('.wui-workbench__identity', workbenchParts.identity),
  harmonyRule('.wui-workbench__title', workbenchParts.title),
  harmonyRule('.wui-workbench__subtitle', workbenchParts.subtitle),
  harmonyRule('.wui-workbench__tablist', workbenchParts.tablist),
  harmonyRule('.wui-workbench__tab', workbenchParts.tab),
  harmonyRule('.wui-workbench__tab[aria-selected="true"]', workbenchParts.tabActive),
  harmonyRule('.wui-workbench__main', workbenchParts.main),
  harmonyRule('.wui-workbench__stage', workbenchParts.stage),
  harmonyRule('.wui-workbench__note', workbenchParts.note),
  harmonyRule('.wui-workbench__rail', workbenchParts.rail),
  harmonyRule('.wui-workbench__strip', workbenchParts.strip),
  harmonyRule('.wui-workbench__dock', workbenchParts.dock),
  harmonyRule('.wui-workbench__dock-head', workbenchParts.dockHead),
  harmonyRule('.wui-workbench__dock-label', workbenchParts.dockLabel),
  harmonyRule('.wui-workbench__dock-toggle', workbenchParts.dockToggle),
  harmonyRule('.wui-workbench__dock-knob', workbenchParts.dockKnob),
  harmonyRule('.wui-workbench__dock-toggle[aria-checked="true"]', {background: ACCENT}),
  harmonyRule('.wui-workbench__dock-toggle[aria-checked="true"] .wui-workbench__dock-knob', {
    background: ON_ACCENT,
    transform: SWITCH_TRAVEL,
  }),
  harmonyRule('.wui-workbench__dock-body', workbenchParts.dockBody),
  harmonyRule('.wui-workbench__status', workbenchParts.status),
  harmonyRule('.wui-workbench__dot', workbenchParts.dot),
  harmonyRule('.wui-workbench__message', workbenchParts.message),
  harmonyRule('.wui-workbench__detail', workbenchParts.detail),
  harmonyRule('.wui-workbench__index', workbenchParts.index),
  harmonyRule('.wui-workbench__note[data-phase="error"]', {color: severityFill('error')}),

  // `hidden` has to actually hide. The UA sheet's `[hidden] { display: none }`
  // is at USER-AGENT origin and every `display` above it is at author origin,
  // so a flex box the shell hid would stay on screen — and the sharpest version
  // of that is a `role="switch"` a reader can tab to, is told is on, throws, and
  // nothing happens. Listed node by node rather than as `.wui-workbench
  // [hidden]`, so this rule can never reach into a slot the caller filled.
  harmonyRule(
    [
      'identity',
      'title',
      'subtitle',
      'note',
      'rail',
      'strip',
      'dock',
      'dock-toggle',
      'dock-body',
      'detail',
    ]
      .map((part) => `.wui-workbench__${part}[hidden]`)
      .join(',\n'),
    {display: 'none'},
  ),

  // An empty stage in a waiting phase draws the SHAPE of what is coming: a
  // faint ruler and a dimmed line where the material will arrive. Pure CSS, no
  // clock, no node — and `:empty` means it disappears the instant the caller
  // mounts anything at all, so it can never sit behind a real surface. An idle
  // workbench that renders literally nothing is the one state a reader cannot
  // tell from a mistake.
  harmonyRule(
    [
      '.wui-workbench[data-phase="idle"] .wui-workbench__stage:empty',
      '.wui-workbench[data-phase="listening"] .wui-workbench__stage:empty',
    ].join(',\n'),
    {
      'min-height': '4rem',
      'border-radius': RADIUS,
      background: [
        `linear-gradient(${NOW_LINE}, ${NOW_LINE}) ${NOW_ANCHOR} 0 / 1px 100% no-repeat`,
        `repeating-linear-gradient(90deg, ${LINE} 0 1px, transparent 1px 48px)`,
      ].join(', '),
      opacity: '.55',
    },
  ),

  // The phase, as colour. Written here rather than inline so a host can restyle
  // it with a cascade instead of fighting an inline declaration — and painted
  // onto the dot as well, but only for a host that opted out of this sheet.
  harmonyRule('.wui-workbench[data-phase="playing"] .wui-workbench__dot', {background: ACCENT}),
  harmonyRule('.wui-workbench[data-phase="listening"] .wui-workbench__dot', {
    background: ACCENT,
    animation: `wui-workbench-breathe ${BREATHE} ease-in-out infinite`,
  }),
  harmonyRule('.wui-workbench[data-phase="error"] .wui-workbench__dot', {
    background: severityFill('error'),
  }),
  // The one animation in the shell, and it is on purpose: "listening" is a
  // state with no material to move, so the only honest way to say it is still
  // waiting is a pulse that does not pretend to be a position.
  ['@keyframes wui-workbench-breathe {', '  50% { opacity: .3; }', '}'].join('\n'),

  RESPONSIVE,
].join('\n\n');

// ---------------------------------------------------------------------------
// Small shared plumbing. The same guarded writers the other analysis surfaces
// use: re-writing an attribute with its own value is a mutation the browser and
// every observer both see, and a shell writes far more often than it changes.
// ---------------------------------------------------------------------------

function setAttr(node: Element, name: string, value: string | undefined): void {
  const current = node.getAttribute(name);
  if (value === undefined) {
    if (current !== null) node.removeAttribute(name);
    return;
  }
  if (current !== value) node.setAttribute(name, value);
}

function setData(node: Element, name: string, value: string | undefined): void {
  setAttr(node, `data-${name}`, value);
}

function setStyleValue(node: ElementCSSInlineStyle, name: string, value: string | undefined): void {
  const current = node.style.getPropertyValue(name);
  if (value === undefined) {
    if (current) node.style.removeProperty(name);
    return;
  }
  if (current !== value) node.style.setProperty(name, value);
}

function setText(node: {textContent: string | null}, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

/**
 * Put `nodes` in `parent`, in this order, and touch nothing if they already
 * are.
 *
 * The identity guarantee lives here. `replaceChildren` MOVES the nodes it is
 * given rather than replacing them, so a dock that changed places keeps the
 * presenter mounted inside it — but a move is still a mutation, so the compare
 * comes first and most updates write nothing at all.
 */
function reorder(parent: Element, nodes: readonly Element[]): void {
  const current = parent.children;
  if (current.length === nodes.length && nodes.every((node, at) => current[at] === node)) return;
  parent.replaceChildren(...nodes);
}

/**
 * Paint the boxes onto the nodes, but only for a host that opted out of the
 * stylesheet. Both paths read the same records, so the sheet and the inline
 * string cannot describe two different shells.
 */
function dressing(
  stylesheet: boolean | undefined,
): (node: ElementCSSInlineStyle, ...groups: Declarations[]) => void {
  if (stylesheet === false) return (node, ...groups) => paint(node, ...groups);
  return () => {};
}

const PHASES: ReadonlySet<string> = new Set<WorkbenchPhase>([
  'idle',
  'listening',
  'playing',
  'empty',
  'error',
]);

/** Ids have to be unique in a document, and two shells on one page is normal. */
let shells = 0;

interface DockNode {
  section: HTMLElement;
  label: HTMLElement;
  toggle: HTMLButtonElement;
  knob: HTMLElement;
  body: HTMLElement;
  /** This view asked for it, and the chrome has somewhere to put it. */
  rendered: boolean;
  /** Rendered AND not folded away. Only then may a caller mount into it. */
  visible: boolean;
}

const mountedWorkbenches = new WeakMap<WorkbenchHost, WorkbenchHandle>();

/** Mount the shell: a grid of slots, a tablist, and the one reading per frame. */
export function mountWorkbench(
  host: WorkbenchHost,
  binding: WorkbenchBinding,
  options: WorkbenchOptions = {},
): WorkbenchHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const style = installStyle(document, 'workbench', workbenchStyle, options.stylesheet);
  const dress = dressing(options.stylesheet);
  const inline = options.stylesheet === false;
  const chrome = options.chrome === 'bare' ? 'bare' : 'full';
  const navigation = options.navigation !== false;
  const scope = `wui-workbench-${(shells += 1)}`;
  const report = createErrorSink(options.onError);

  let resolved: ResolvedMotion = resolveMotion(host, options.motion, view);
  let destroyed = false;
  let phase: WorkbenchPhase = 'idle';
  let roving: string | undefined;
  let leaveLoop: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  let unlocalize: (() => void) | undefined;
  let stopPreference: (() => void) | undefined;
  let lastFrame: number | undefined;
  let activeId: string | undefined;
  let settled = false;
  /**
   * Ids come off a counter that only ever climbs. A map's SIZE is not a
   * sequence: remove a dock in one snapshot and add one in the next and the
   * newcomer is handed an id the survivor still holds, which quietly aims two
   * `aria-labelledby` references at one label and makes a switch announce the
   * wrong dock.
   */
  let sequence = 0;

  const tabs = new Map<string, HTMLButtonElement>();
  const docks = new Map<string, DockNode>();

  // -------------------------------------------------------------------------
  // The frame. Built once, mutated for life.
  // -------------------------------------------------------------------------

  const root = document.createElement('div');
  root.className = 'wui-workbench';
  root.dataset.chrome = chrome;
  root.dataset.motion = resolved;
  if (options.label) {
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', options.label);
  }
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  // The token layer FIRST, so both styling paths provide the same defaults to
  // inheriting tenants. A tenant's own token declarations can override these.
  dress(root, harmonyTokens, harmonyParts.root, workbenchParts.root);

  const frame = document.createElement('div');
  frame.className = 'wui-workbench__frame';
  setParts(frame, 'frame', options.parts?.frame);
  dress(frame, workbenchParts.frame);
  if (chrome === 'bare') dress(frame, BARE_FRAME);
  root.append(frame);

  const header = document.createElement('div');
  header.className = 'wui-workbench__header';
  addClassNames(header, options.classNames?.header);
  setParts(header, 'header', options.parts?.header);
  dress(header, workbenchParts.header);

  const identity = document.createElement('div');
  identity.className = 'wui-workbench__identity';
  dress(identity, workbenchParts.identity);
  const title = document.createElement('p');
  title.className = 'wui-workbench__title';
  dress(title, workbenchParts.title);
  const subtitle = document.createElement('p');
  subtitle.className = 'wui-workbench__subtitle';
  dress(subtitle, workbenchParts.subtitle);
  identity.append(title, subtitle);

  const tablist = document.createElement('div');
  tablist.className = 'wui-workbench__tablist';
  tablist.setAttribute('role', 'tablist');
  tablist.setAttribute('aria-orientation', 'horizontal');
  tablist.setAttribute('aria-label', options.label ?? localize(options.localization, 'workbench.views', 'Views'));
  addClassNames(tablist, options.classNames?.tablist);
  setParts(tablist, 'tablist', options.parts?.tablist);
  dress(tablist, workbenchParts.tablist);
  header.append(identity);
  if (navigation) header.append(tablist);

  const main = document.createElement('div');
  main.className = 'wui-workbench__main';
  main.id = `${scope}-panel`;
  if (chrome === 'full') {
    main.setAttribute('role', navigation ? 'tabpanel' : 'region');
    if (!navigation) main.setAttribute('aria-label', options.label ?? localize(options.localization, 'workbench.analysis', 'Analysis'));
    // A panel whose only content is a caller's presenter may have nothing
    // focusable in it at all, and an unreachable panel is a page a keyboard
    // cannot read. The stop is cheap; an inaccessible view is not.
    main.tabIndex = 0;
  }
  dress(main, workbenchParts.main);

  const stage = document.createElement('div');
  stage.className = 'wui-workbench__stage';
  addClassNames(stage, options.classNames?.stage);
  setParts(stage, 'stage', options.parts?.stage);
  dress(stage, workbenchParts.stage);

  const note = document.createElement('p');
  note.className = 'wui-workbench__note';
  note.hidden = true;
  dress(note, workbenchParts.note);
  main.append(stage, note);

  const rail = document.createElement('div');
  rail.className = 'wui-workbench__rail';
  addClassNames(rail, options.classNames?.rail);
  setParts(rail, 'rail', options.parts?.rail);
  dress(rail, workbenchParts.rail);

  const strip = document.createElement('div');
  strip.className = 'wui-workbench__strip';
  addClassNames(strip, options.classNames?.strip);
  setParts(strip, 'strip', options.parts?.strip);
  dress(strip, workbenchParts.strip);

  const status = document.createElement('div');
  status.className = 'wui-workbench__status';
  addClassNames(status, options.classNames?.status);
  setParts(status, 'status', options.parts?.status);
  dress(status, workbenchParts.status);

  const dot = document.createElement('span');
  dot.className = 'wui-workbench__dot';
  dot.setAttribute('aria-hidden', 'true');
  dress(dot, workbenchParts.dot);

  const message = document.createElement('p');
  message.className = 'wui-workbench__message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  dress(message, workbenchParts.message);

  // NOT a live region, and that is the whole point of separating it from the
  // message: a bar/beat read-out changes many times a second during playback,
  // and a polite region that changed that often would talk over everything the
  // page has to say for as long as the piece lasts.
  const detail = document.createElement('p');
  detail.className = 'wui-workbench__detail';
  dress(detail, workbenchParts.detail);
  status.append(dot, message, detail);

  if (chrome === 'full') frame.append(header, main, rail, strip, status);
  else frame.append(main);

  // The semantic twin sits OUTSIDE the shell's frame, as a direct child of the
  // host: the caller's list has to be a sibling of the workbench, not a
  // descendant of a grid area that a container query may reflow around it.
  const index = document.createElement('ol');
  index.className = 'wui-workbench__index';
  addClassNames(index, options.classNames?.index);
  setParts(index, 'index', options.parts?.index);
  dress(index, workbenchParts.index);

  // -------------------------------------------------------------------------
  // The clock. One subscription to the shared loop, one reading per frame.
  // -------------------------------------------------------------------------

  const draws = new Set<(tick: FrameTick) => void>();
  let tick: FrameTick = {at: 0, now: 0, continuous: false, epoch: 0};

  const clockNow = (): number => view?.performance?.now?.() ?? Date.now();

  const emit = (at: number, continuous: boolean, degraded: boolean): void => {
    if (destroyed) return;
    let now = tick.now;
    let epoch = tick.epoch ?? 0;
    if (binding.now) {
      try {
        now = finite(binding.now({time: at, delta: lastFrame === undefined ? 0 : at - lastFrame}), now);
      } catch (error) {
        report(error);
      }
    }
    if (binding.epoch) {
      try {
        epoch = finite(binding.epoch(), epoch);
      } catch (error) {
        report(error);
      }
    }
    lastFrame = at;
    tick = {at, now, continuous, epoch, degraded};
    // A snapshot: a subscriber is allowed to unsubscribe itself, or another.
    for (const draw of [...draws]) {
      if (!draws.has(draw)) continue;
      try {
        draw(tick);
      } catch (error) {
        report(error);
      }
    }
  };

  const onFrame = (at: number, degraded: boolean): void => {
    // The loop telling the truth about itself. Visible and greppable beats a
    // mysterious stutter nobody can attribute.
    setData(root, 'motion', degraded ? 'degraded' : resolved);
    emit(at, true, degraded);
  };

  /**
   * Every condition under which this shell is allowed to burn a frame. Each one
   * is a bug it prevents, not a preference.
   */
  const wants = (): boolean =>
    !destroyed &&
    draws.size > 0 &&
    binding.now !== undefined &&
    resolved === 'continuous' &&
    (phase === 'playing' || phase === 'listening');

  const syncLoop = (): void => {
    if (wants()) {
      if (!leaveLoop) leaveLoop = joinFrameLoop(view, onFrame);
      return;
    }
    leaveLoop?.();
    leaveLoop = undefined;
    // `data-motion` is doing two jobs, and only one of them ends with the loop.
    // Every surface below this node resolves `motion: 'auto'` by reading the
    // nearest ancestor's value, and `degraded` is not one of the three answers
    // that contract accepts — so a shell that degraded and then parked would
    // leave each new dock to ask `matchMedia` on its own, which is exactly the
    // disagreement one shared answer exists to prevent.
    setData(root, 'motion', resolved);
  };

  const clock: FrameClock = {
    subscribe(draw: (tick: FrameTick) => void): () => void {
      draws.add(draw);
      syncLoop();
      let joined = true;
      return (): void => {
        if (!joined) return;
        joined = false;
        draws.delete(draw);
        syncLoop();
      };
    },
    read: () => tick,
  };

  const dressMotion = (): void => {
    paint(root, harmonyMotion.full);
    if (resolved !== 'continuous') paint(root, harmonyMotion.reduced);
  };
  dressMotion();

  // -------------------------------------------------------------------------
  // Reconciliation. Nothing below creates a node the caller may have mounted
  // into; the stage, the index and every dock body outlive every update.
  // -------------------------------------------------------------------------

  const buildTab = (viewId: string): HTMLButtonElement => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'wui-workbench__tab';
    tab.id = `${scope}-tab-${(sequence += 1)}`;
    tab.dataset.view = viewId;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', main.id);
    tab.tabIndex = -1;
    addClassNames(tab, options.classNames?.tab);
    setParts(tab, 'tab', options.parts?.tab);
    dress(tab, workbenchParts.tab);
    tab.addEventListener('click', onTabClick);
    tab.addEventListener('keydown', onTabKeyDown);
    return tab;
  };

  const buildDock = (dockId: string): DockNode => {
    const section = document.createElement('section');
    section.className = 'wui-workbench__dock';
    section.dataset.dock = dockId;
    dress(section, workbenchParts.dock);

    const head = document.createElement('div');
    head.className = 'wui-workbench__dock-head';
    dress(head, workbenchParts.dockHead);

    const label = document.createElement('span');
    label.className = 'wui-workbench__dock-label';
    label.id = `${scope}-dock-${(sequence += 1)}`;
    dress(label, workbenchParts.dockLabel);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wui-workbench__dock-toggle';
    toggle.dataset.dock = dockId;
    // `switch`, not a checkbox and not a pressed button: folding a dock away
    // takes effect at once and has no form to submit, which is exactly the
    // distinction the role exists to draw.
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', 'true');
    toggle.setAttribute('aria-labelledby', label.id);
    dress(toggle, workbenchParts.dockToggle);
    toggle.addEventListener('click', onDockToggle);

    const knob = document.createElement('span');
    knob.className = 'wui-workbench__dock-knob';
    knob.setAttribute('aria-hidden', 'true');
    dress(knob, workbenchParts.dockKnob);
    toggle.append(knob);
    head.append(label, toggle);

    const body = document.createElement('div');
    body.className = 'wui-workbench__dock-body';
    body.setAttribute('role', 'group');
    body.setAttribute('aria-labelledby', label.id);
    dress(body, workbenchParts.dockBody);

    section.append(head, body);
    return {section, label, toggle, knob, body, rendered: false, visible: false};
  };

  const pass = (): void => {
    if (destroyed) return;
    let snapshot: WorkbenchState;
    try {
      snapshot = binding.snapshot();
    } catch (error) {
      report(error);
      return;
    }

    tablist.setAttribute('aria-label', options.label ?? localize(options.localization, 'workbench.views', 'Views'));
    if (!navigation) main.setAttribute('aria-label', options.label ?? localize(options.localization, 'workbench.analysis', 'Analysis'));

    const views = (snapshot.views ?? []).filter(
      (candidate): candidate is WorkbenchView => typeof candidate?.id === 'string',
    );
    const active = views.find((candidate) => candidate.id === snapshot.activeViewId) ?? views[0];

    // --- the tablist -------------------------------------------------------
    // Bare chrome has none, and builds none: a tab in a strip that was never
    // appended would leave the panel's `aria-labelledby` pointing at an id no
    // document contains, which reads as an unlabelled region rather than as
    // nothing at all.
    if (chrome === 'full' && navigation) {
      const ordered: HTMLButtonElement[] = [];
      for (const candidate of views) {
        let tab = tabs.get(candidate.id);
        if (!tab) {
          tab = buildTab(candidate.id);
          tabs.set(candidate.id, tab);
        }
        setText(tab, candidate.label ?? candidate.id);
        setAttr(tab, 'title', candidate.description);
        const chosen = candidate.id === active?.id;
        setAttr(tab, 'aria-selected', chosen ? 'true' : 'false');
        if (inline) paint(tab, workbenchParts.tab, chosen ? workbenchParts.tabActive : {});
        ordered.push(tab);
      }
      for (const [id, tab] of [...tabs]) {
        if (views.some((candidate) => candidate.id === id)) continue;
        tabs.delete(id);
        tab.remove();
      }
      // Read the focus BEFORE the reorder and put it back after. `reorder` ends
      // in `replaceChildren`, which blurs whatever it moves, so a viewer
      // arrowing along the strip when a view arrives would be thrown back to
      // the start — by an update they did not ask for.
      //
      // The root node, not the document: inside a shadow tree
      // `document.activeElement` is the HOST element and never a tab, so the
      // check below would fail on every pass and reset the tab stop out from
      // under a focus that had not moved at all.
      const scopeRoot = tablist.getRootNode() as Partial<DocumentOrShadowRoot>;
      const focused = ordered.find((tab) => tab === scopeRoot.activeElement);
      reorder(tablist, ordered);
      if (focused && scopeRoot.activeElement !== focused) focused.focus();

      // Roving tabindex. It follows the FOCUSED tab while the strip has focus —
      // that is what manual activation means, an arrow that moves focus without
      // choosing — and snaps back to the selected one the moment focus leaves,
      // so tabbing into the strip lands on the view actually on screen.
      if (!focused) roving = active?.id;
      if (roving !== undefined && !tabs.has(roving)) roving = active?.id;
      for (const tab of ordered) {
        const wanted = tab.dataset.view === roving ? 0 : -1;
        if (tab.tabIndex !== wanted) tab.tabIndex = wanted;
      }
      setAttr(main, 'aria-labelledby', active ? tabs.get(active.id)?.id : undefined);
    }
    activeId = active?.id;

    // --- the docks ---------------------------------------------------------
    const declared = (snapshot.docks ?? []).filter(
      (candidate): candidate is WorkbenchDock => typeof candidate?.id === 'string',
    );
    const allowed = active?.docks;
    const railed: HTMLElement[] = [];
    const stripped: HTMLElement[] = [];
    const seen = new Set<string>();
    // Collected, then announced once the pass has settled: a caller told a dock
    // is gone will immediately ask what else it can reach, and it must be told
    // by a shell that has finished changing its mind.
    const flipped: {id: string; visible: boolean}[] = [];
    for (const candidate of declared) {
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      let node = docks.get(candidate.id);
      if (!node) {
        node = buildDock(candidate.id);
        docks.set(candidate.id, node);
      }
      const rendered = chrome === 'full' && (allowed === undefined || allowed.includes(candidate.id));
      const visible = rendered && snapshot.dockVisibility?.[candidate.id] !== false;
      const was = node.rendered && node.visible;
      node.rendered = rendered;
      node.visible = visible;
      if (rendered && visible !== was) flipped.push({id: candidate.id, visible});
      else if (!rendered && was) flipped.push({id: candidate.id, visible: false});
      setText(node.label, candidate.label ?? candidate.id);
      const toggleable = candidate.toggleable !== false && binding.toggleDock !== undefined;
      setHidden(node.toggle, !toggleable);
      // Hidden AND disabled. The attribute is what the sheet reads; `disabled`
      // is what takes a dead control out of the tab order on the inline path,
      // where there is no sheet to read it.
      if (node.toggle.disabled !== !toggleable) node.toggle.disabled = !toggleable;
      setAttr(node.toggle, 'aria-checked', visible ? 'true' : 'false');
      if (inline) {
        paint(node.toggle, workbenchParts.dockToggle, visible ? {background: ACCENT} : {});
        paint(node.knob, workbenchParts.dockKnob, {
          background: visible ? ON_ACCENT : INK_MUTED,
          transform: visible ? SWITCH_TRAVEL : 'none',
        });
      }
      // The BODY folds away, never the head: hiding the switch with the thing
      // it switches leaves the viewer no way back. `dock(id)` stops answering
      // at the same instant, so nothing new mounts into a box nobody sees.
      //
      // Unless there IS no way back — a folded dock whose switch was never
      // offered leaves a label over nothing and no control to open it, so that
      // one goes away whole.
      setHidden(node.body, !visible);
      setHidden(node.section, !rendered || (!visible && !toggleable));
      setData(node.section, 'visible', visible ? 'true' : 'false');
      if (!rendered) continue;
      if (candidate.placement === 'strip') stripped.push(node.section);
      else railed.push(node.section);
    }
    for (const [id, node] of [...docks]) {
      if (seen.has(id)) continue;
      docks.delete(id);
      if (node.rendered && node.visible) flipped.push({id, visible: false});
      // A dock that leaves `docks` takes its slot node with it, and with the
      // node goes whatever the caller mounted inside — the exact silent
      // unmount the whole module is built to prevent, arriving through the one
      // door left open. `docks` is meant to be STABLE for the life of the
      // mount; `WorkbenchView.docks` is how a view offers fewer of them. Saying
      // so out loud is the difference between a caller's bug and a mystery.
      if (node.body.childElementCount > 0) {
        report(
          new Error(
            `Workbench dock "${id}" left the snapshot with a presenter still mounted in it. ` +
              'Keep `docks` stable for the life of the mount and use `WorkbenchView.docks` to ' +
              'choose which docks a view offers.',
          ),
        );
      }
      node.section.remove();
    }
    reorder(rail, railed);
    reorder(strip, stripped);
    setHidden(rail, railed.length === 0);
    setHidden(strip, stripped.length === 0);
    setData(root, 'rail', railed.length > 0 ? 'true' : 'false');
    // The grid a record cannot hold, for the path that has no sheet to read it.
    // These two are not responsive rewrites — they are the shell saying which
    // grid is true — and skipping them leaves a permanent empty rail column.
    if (inline) {
      const grid = chrome === 'bare' ? GRID_BARE : railed.length > 0 ? GRID_FULL : GRID_SINGLE;
      setStyleValue(frame, 'grid-template-areas', grid[0]);
      setStyleValue(frame, 'grid-template-columns', grid[1]);
      setStyleValue(frame, 'grid-template-rows', grid[2]);
    }

    // --- identity, density, scheme, phase ----------------------------------
    setText(title, snapshot.title ?? '');
    setHidden(title, !snapshot.title);
    setText(subtitle, snapshot.subtitle ?? '');
    setHidden(subtitle, !snapshot.subtitle);
    setHidden(identity, !snapshot.title && !snapshot.subtitle);
    setData(root, 'view', active?.id);

    const density = snapshot.density === 'compact' ? 'compact' : 'comfortable';
    setData(root, 'density', density);
    // Painted on BOTH paths, and not redundant on the sheet path: the size
    // chain is `var(--wui-harmony-size-body, …)`, and it never reaches a host's
    // own `--wm-harmony-size-body` unless the `--wui-*` name is declared
    // somewhere on the way down. This is where that override becomes reachable.
    paint(root, harmonyDensity[density]);

    const scheme = snapshot.scheme === 'light' || snapshot.scheme === 'dark' ? snapshot.scheme : undefined;
    setData(root, 'scheme', scheme);
    if (scheme) paint(root, harmonyScheme[scheme]);
    else setStyleValue(root, 'color-scheme', undefined);

    const stated = snapshot.phase;
    phase = stated !== undefined && PHASES.has(stated) ? stated : 'idle';
    setData(root, 'phase', phase);
    if (inline) {
      setStyleValue(
        dot,
        'background',
        phase === 'error'
          ? severityFill('error')
          : phase === 'playing' || phase === 'listening'
            ? ACCENT
            : severityFill(undefined),
      );
    }

    const said = snapshot.status?.message ?? '';
    const told = snapshot.status?.detail ?? '';
    setText(message, said);
    setText(detail, told);
    setHidden(detail, told === '');

    // The stage's own sentence, for the two phases that have nothing to show.
    // It carries no live region of its own in `full` chrome — the status bar
    // already said it, and two polite regions saying one sentence is one
    // sentence read twice.
    const noted = phase === 'empty' || phase === 'error' ? said : '';
    setText(note, noted);
    setHidden(note, noted === '');
    setData(note, 'phase', noted === '' ? undefined : phase);
    if (chrome === 'bare') {
      setAttr(note, 'role', noted === '' ? undefined : 'status');
      setAttr(note, 'aria-live', noted === '' ? undefined : 'polite');
    }

    syncLoop();

    // The first pass establishes the baseline in silence. A callback fired
    // during `mountWorkbench` would reach a caller that does not yet hold the
    // handle it would need in order to do anything about it.
    if (settled) {
      for (const change of flipped) {
        try {
          options.onDockVisibility?.(change.id, change.visible);
        } catch (error) {
          report(error);
        }
      }
    }
    settled = true;
  };

  const updates = createUpdateLoop({
    name: 'Workbench',
    pass,
    isCurrent: () => claim.isCurrent(),
    report,
  });

  // -------------------------------------------------------------------------
  // Input. Manual activation, a roving tabindex, and nothing clever.
  // -------------------------------------------------------------------------

  /**
   * Scroll a tab into the strip's own view.
   *
   * Every number here is MEASURED, and an unlaid-out document answers `0` to
   * all of them — jsdom always, a display:none ancestor sometimes. A centring
   * arithmetic on a zero-width strip resolves to zero for every tab and would
   * yank a real strip back to its start on each key press, so a zero
   * measurement means "do not know" and nothing is written at all.
   */
  const revealTab = (tab: HTMLElement | undefined): void => {
    if (!tab) return;
    const room = tablist.clientWidth;
    const width = tab.offsetWidth;
    if (room <= 0 || width <= 0) return;
    const reach = Math.max(0, tablist.scrollWidth - room);
    const target = tab.offsetLeft - (room - width) / 2;
    tablist.scrollLeft = Math.min(Math.max(target, 0), reach);
  };

  const activate = (id: string | undefined): void => {
    if (destroyed || id === undefined) return;
    roving = id;
    // Choosing the view already on screen is not an activation. The entire
    // reason this tablist activates manually is that an activation costs an
    // analysis projection; spending one to arrive where we already are is the
    // same waste by a slower route.
    if (id !== activeId) {
      try {
        binding.activateView?.(id);
      } catch (error) {
        report(error);
      }
    }
    updates.run();
    // Focus stays exactly where it was, on the tab. Moving it into the panel
    // would take a keyboard reader out of the strip they were reading, and
    // there is nothing in the panel that has to be reached to know it changed.
    revealTab(tabs.get(id));
  };

  function onTabClick(event: Event): void {
    activate((event.currentTarget as HTMLElement).dataset.view);
  }

  function onTabKeyDown(event: KeyboardEvent): void {
    const ordered = [...tablist.children].filter(
      (node): node is HTMLButtonElement => node instanceof HTMLElement && node.dataset.view !== undefined,
    );
    const from = ordered.indexOf(event.currentTarget as HTMLButtonElement);
    if (from < 0 || ordered.length === 0) return;

    // MANUAL activation. An arrow moves focus and chooses nothing: automatic
    // activation would run one analysis projection per tab as a viewer sweeps
    // across the strip, which is three of them between two key repeats.
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      // The default would synthesize a click and activate this tab a second
      // time; suppressing it is what makes one press mean one activation.
      event.preventDefault();
      activate(ordered[from]?.dataset.view);
      return;
    }

    let to = from;
    if (event.key === 'ArrowRight') to = (from + 1) % ordered.length;
    else if (event.key === 'ArrowLeft') to = (from - 1 + ordered.length) % ordered.length;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = ordered.length - 1;
    else return;

    event.preventDefault();
    const next = ordered[to];
    if (!next) return;
    roving = next.dataset.view;
    for (const tab of ordered) tab.tabIndex = tab === next ? 0 : -1;
    next.focus();
    revealTab(next);
  }

  /**
   * Focus left the strip, so the tab stop goes back to the view on screen.
   *
   * Without this the promise above is only kept on the next snapshot pass, and
   * a parked shell has no next pass: a viewer who arrowed two tabs along,
   * changed nothing and tabbed away would find, on tabbing back, the stop
   * sitting on a view that is not the one they are looking at.
   */
  function onTabBlur(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && tablist.contains(next)) return;
    if (roving === activeId) return;
    roving = activeId;
    for (const [id, tab] of tabs) {
      const wanted = id === roving ? 0 : -1;
      if (tab.tabIndex !== wanted) tab.tabIndex = wanted;
    }
  }

  tablist.addEventListener('focusout', onTabBlur);

  function onDockToggle(event: Event): void {
    const id = (event.currentTarget as HTMLElement).dataset.dock;
    const node = id === undefined ? undefined : docks.get(id);
    if (!node || id === undefined) return;
    try {
      binding.toggleDock?.(id, !node.visible);
    } catch (error) {
      report(error);
    }
    updates.run();
  }

  // -------------------------------------------------------------------------
  // Motion. Resolved once, then followed — an OS toggle has to land at once,
  // and no media query can stop a transform a frame loop is writing.
  // -------------------------------------------------------------------------

  const applyMotion = (): void => {
    if (destroyed) return;
    const next = resolveMotion(host, options.motion, view);
    if (next !== resolved) {
      resolved = next;
      setData(root, 'motion', resolved);
      dressMotion();
    }
    syncLoop();
    // Reduced motion is EVENT rate, not frame rate: with no loop to arrive, the
    // position still has to reach the slots, so the change itself is the tick.
    if (!leaveLoop) emit(clockNow(), false, false);
  };

  const notify = (): void => {
    if (destroyed) return;
    updates.run();
    if (!leaveLoop) emit(clockNow(), false, false);
  };

  const handle: WorkbenchHandle = {
    element: root,
    stage,
    dock(id: string): HTMLElement | undefined {
      // A destroyed shell — including one deposed by a second mount on the same
      // host — hands out nothing. Its nodes are detached, so a presenter mounted
      // into one would run, hold a clock subscription and paint forever into a
      // tree no document contains, and the shell that let it in cannot stop it.
      if (destroyed) return undefined;
      const node = docks.get(id);
      return node?.rendered && node.visible ? node.body : undefined;
    },
    index,
    statusMessage: chrome === 'bare' ? undefined : message,
    clock,
    tick(): void {
      emit(clockNow(), false, false);
    },
    update(): void {
      updates.run();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      const releaseText = unlocalize;
      unlocalize = undefined;
      releaseText?.();
      leaveLoop?.();
      leaveLoop = undefined;
      draws.clear();
      updates.cancel();
      try {
        stopPreference?.();
      } catch (error) {
        report(error);
      }
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      claim.release();
      root.remove();
      index.remove();
      style?.remove();
    },
  };

  // Claim the host before destroying the previous surface: its cleanup may
  // mount a replacement, and that replacement must win.
  const claim = claimHost(mountedWorkbenches, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root, index);
  if (!claim.isCurrent()) {
    // A re-entrant mount took the host while this one was appending; leave it
    // exactly as that mount left it.
    root.remove();
    index.remove();
    style?.remove();
    return handle;
  }

  if (options.motion === undefined || options.motion === 'auto') {
    try {
      const media = view?.matchMedia?.('(prefers-reduced-motion: reduce)');
      if (media?.addEventListener) {
        const listener = (): void => applyMotion();
        media.addEventListener('change', listener);
        stopPreference = (): void => media.removeEventListener?.('change', listener);
      }
    } catch (error) {
      // `matchMedia` is absent in more than one environment this module is
      // mounted in, and an absent answer is "no preference", not a failed mount.
      report(error);
    }
  }

  updates.run();
  // One reading before anybody subscribes, so `clock.read()` answers with the
  // caller's real position rather than a seed: a slot mounted a line after the
  // shell joins BETWEEN frames, and that is the reading it starts from.
  emit(clockNow(), false, false);
  if (binding.subscribe) {
    try {
      unsubscribe = binding.subscribe(notify);
    } catch (error) {
      report(error);
    }
  }
  unlocalize = bindLocalization(options.localization, updates.run, () => !destroyed && claim.isCurrent(), options.onError);
  return handle;
}
