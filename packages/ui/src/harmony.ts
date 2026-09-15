import {
  harmonyValues,
  harmonyInline,
  harmonyMotion,
  harmonyParts,
  harmonyRule,
  progressionTone,
  severityFill,
  toneFill,
  toneMark,
  type Severity,
  type ToneRole,
} from './harmony-style';
import {controlHeight, controlRadius} from './internal/control';
import {
  addClassNames,
  clamp,
  clamp01,
  finite,
  finitePositive,
  markEmptyState,
  setParts,
} from './internal/dom';
import {
  flowAxis,
  flowBoundaries,
  flowBoundaryFrom,
  flowBox,
  flowCrossed,
  flowShift,
  flowZone,
  segmentIndexOf,
  unwrapAngle,
  wheelPoint,
  wheelSector,
  type FlowAxis,
  type FlowZone,
} from './internal/flow-geometry';
import {
  joinFrameLoop,
  resolveMotion,
  type FrameClock,
  type FrameTick,
  type MotionMode,
} from './internal/frame';
import {claimHost, createErrorSink} from './internal/lifecycle';
import {restampActiveStyle, stampIdleStyle, stampSpans} from './internal/spans';
import {installStyle, paint} from './internal/style';
import {componentSurfaceDeclarations, embeddedSurfaceDeclarations} from './internal/surface';
import type {Declarations} from './styles';

/**
 * Four read-outs that show a harmonic analysis HAPPENING rather than listing
 * what it concluded: a conveyor, a nameplate, a ranked strip and a wheel.
 *
 * ## The conveyor is the point
 *
 * `mountFlowLane` pins a now line at a fixed fraction of the viewport and
 * scrolls the MATERIAL under it. That is the opposite of a map, and it is
 * chosen for one reason: two thirds of the viewport is the future, so the next
 * chord can be seen approaching. A map answers "where am I in the piece"; a
 * conveyor answers "what is happening, and what is about to". Both are correct
 * and they are different instruments — `mountTimeline` is the map and stays
 * one.
 *
 * Several tracks — chord bands, numerals, motif occurrences — share ONE axis,
 * ONE now line and ONE transform. Not by convention: they are children of a
 * single reel, so there is no arrangement of the code in which they can drift
 * apart.
 *
 * ## What these mounts are NOT told
 *
 * They know no music theory. A band is "from 4.0 to 8.0, tone slot 7, labelled
 * 'Am7', role 'third'". The word 'chord' does not appear in a single field, and
 * the axis is a number line whose unit this module has never been told.
 *
 * The stamping axis is deliberately a SECOND number line. A conveyor is a
 * portrait of real time — a ritardando has to be visibly wider — while a
 * playhead is fed the score's own metrical position, and drawing the metrical
 * one would render rubato as a metronome. So `start`/`end` place a band and
 * `stampStart`/`stampEnd` stamp it, and the kit never converts between them
 * because it cannot: only the caller knows the map.
 *
 * ## Two rules that look like performance notes and are correctness rules
 *
 * **A band's inline style is a pure function of its own fields.** Never of the
 * position. `createAnalysisPlayhead` REPLACES a lit node's `style.cssText` with
 * the idle string stamped at render time, so a per-frame inline write on a band
 * is erased at precisely the instant that band matters. Every moving thing
 * lives on the reel's transform, or on a CHILD of the band — a child's style is
 * nobody else's business.
 *
 * **An offscreen band is never removed from the DOM.** The playhead discovers
 * nodes with `querySelectorAll`, so a recycled band is a silently dead
 * highlight — and the recycled ones would be exactly those near the now line.
 * Offscreen cost is paid with `content-visibility`, and `will-change` is
 * granted to the reel alone. Past roughly two thousand items the correct answer
 * is to MERGE THE DATA before it gets here: a lane that redraws a thousand
 * bands nobody can distinguish is the same mistake as a list, drawn faster.
 *
 * ## Reduced motion changes the driver, never the layout
 *
 * A `stepped` lane holds the identical nodes at identical offsets and
 * re-anchors when the sounding band changes instead of on every frame. The
 * screenshots are the same picture. That matters because "the next chord is
 * approaching" is a property of WHERE THINGS ARE, not of how they got there —
 * a reduced-motion viewer keeps the whole point of the design and spends six
 * style writes a second instead of three hundred and sixty.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary.
// ---------------------------------------------------------------------------

export type {FrameClock, FrameTick, MotionMode} from './internal/frame';
export type {Severity, ToneRole} from './harmony-style';

/**
 * One sounding pitch, as a read-out needs it: what to print and what colour it
 * is doing. Structurally a subset of the pitch surfaces' own mark, so a caller
 * hands the SAME array to a keyboard and to a nameplate and the two cannot
 * disagree — `harmony.ts` and `pitch.ts` may not import each other, and a
 * shared type would need a third module for four fields.
 */
export interface HarmonyVoice {
  label?: string;
  mark?: string;
  role?: ToneRole;
}

type HarmonyHost = HTMLElement | ShadowRoot;

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// The skin.
//
// Every value is a CHAIN ending in a literal, never a bare `var()`: these
// mounts are allowed to be mounted on a node carrying no tokens at all, where a
// bare custom property is invalid at computed-value time — which paints a band
// invisible, the one failure a colour system may not have.
//
// The numeric geometry is deliberately NOT tokenised. Reading a number back out
// of a `--wui-*` property means `getComputedStyle`, custom properties do not
// inherit under jsdom, and `parseFloat('')` is `NaN`. Themes move colour here;
// the scale is an option with a documented default, and the heights below are
// pure CSS that no JavaScript ever reads back.
// ---------------------------------------------------------------------------

const INK = harmonyValues.ink;
const INK_MUTED = harmonyValues.inkMuted;
const SURFACE = harmonyValues.surface;
const LINE = harmonyValues.line;
const ACCENT = harmonyValues.accent;
const ON_ACCENT = harmonyValues.onAccent;
const METER_BED = harmonyValues.track;

// Standalone mounts can inherit public typography without a Workbench token root.
const FONT = 'var(--wui-harmony-font, var(--wm-harmony-font, var(--wm-font-family, inherit)))';
const FONT_MONO = 'var(--wui-harmony-font-mono, var(--wm-harmony-font-mono, var(--wm-font-mono, ui-monospace, monospace)))';
const FONT_DISPLAY = `var(--wui-harmony-font-display, var(--wm-harmony-font-display, ${FONT}))`;
const SIZE_DISPLAY = 'var(--wui-harmony-size-display, 2rem)';
const SIZE_TITLE = 'var(--wui-harmony-size-title, 1rem)';
const SIZE_BODY = 'var(--wui-harmony-size-body, .8rem)';
const SIZE_LABEL = 'var(--wui-harmony-size-label, .74rem)';
const SIZE_MICRO = 'var(--wui-harmony-size-micro, .7rem)';

const SPACE_1 = 'var(--wui-harmony-space-1, 4px)';
const SPACE_2 = 'var(--wui-harmony-space-2, 8px)';

const EASE = 'var(--wui-harmony-motion-ease, ease-out)';
const MOTION_TONE = 'var(--wui-harmony-motion-tone, 90ms)';
const MOTION_CHIP = 'var(--wui-harmony-motion-chip, 120ms)';
const MOTION_TURN = 'var(--wui-harmony-motion-turn, 320ms)';

const FLOW_HEIGHT = 'var(--wui-harmony-flow-height, var(--wm-harmony-flow-height, 96px))';
const LANE_HEIGHT = 'var(--wui-harmony-lane-height, var(--wm-harmony-lane-height, 48px))';
/** The ruler owns a line above the tracks; its labels never cover band labels. */
const RULER_HEIGHT = `calc(${SIZE_MICRO} * 2)`;
const NOW_LINE =
  'var(--wui-harmony-flow-now, var(--wm-harmony-flow-now, var(--wui-harmony-accent, #111)))';
// A caller's fill token remains literal. Only the neutral fallback is softened:
// an opaque ink-coloured band otherwise hides its own inherited ink labels.
const BAND_TONE =
  'var(--wm-harmony-flow-tone, var(--wui-harmony-flow-tone, color-mix(in srgb, var(--wui-harmony-accent, var(--wm-accent, #111)) 18%, transparent)))';

/**
 * The two motion durations this family spends that `harmonyMotion` does not
 * carry yet. Declared in the sheet so a host can read them, and painted onto
 * the root on every path so a host's own `--wm-*` override is reachable at all.
 *
 * The budget of §2.5.2 names a third, `--wui-harmony-motion-flow`, for "the
 * re-anchor ease and the zoom transition". It is not declared here, because the
 * lane can honestly ease neither and a token nothing reads is a promise to a
 * caller that nothing keeps. The reel's offset is absolute pixels while every
 * band's box is a percentage of the reel's WIDTH, so easing the width while
 * writing the transform outright describes two different scales for the length
 * of the ease — measured as the material sitting 1890px off the now line for
 * 120ms after a zoom, and worse the further into the piece the listener had
 * got. Both are written together instead, in one `place()`, from one scale.
 */
const HARMONY_MOTION: Readonly<Record<'full' | 'reduced', Declarations>> = {
  full: {
    '--wui-harmony-motion-pop': 'var(--wm-harmony-motion-pop, 180ms)',
    '--wui-harmony-motion-turn': 'var(--wm-harmony-motion-turn, 320ms)',
  },
  reduced: {
    '--wui-harmony-motion-pop': '0s',
    '--wui-harmony-motion-turn': '0s',
  },
};

/**
 * The nameplate's pop, in milliseconds, written here as well as in the sheet.
 *
 * The Web Animations API takes a number and cannot take a `var()`, so this one
 * duration genuinely lives in two places: `--wui-harmony-motion-pop` for the
 * half CSS owns and this constant for the half the animation owns. It is the
 * only such pair in the family, and a test holds the two equal.
 */
const DEFAULT_POP_MS = 180;

/** Pixels per axis unit at the default density. Not a token: see the note above. */
const DEFAULT_SCALE = 44;
/** The lane's own zoom range, as a multiple of `scale`. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
/** What a lane assumes it is wide when nothing can measure it. */
const DEFAULT_LANE_WIDTH = 640;
/** A drag emits at most one preview seek per this many milliseconds. */
const DRAG_INTERVAL_MS = 120;
/** How long the now line's arrival flash lasts. §3.6.3's only sanctioned flash. */
const NOW_PULSE_MS = 90;
/** A wheel scrub commits this long after the last notch. */
const WHEEL_SETTLE_MS = 140;

/** How loud a band is by which side of the now line it is on. */
const ZONE_OPACITY: Readonly<Record<FlowZone, string>> = {
  ahead: '.18',
  now: '1',
  wake: '.12',
};

/**
 * A motif's other occurrences, lit with the one that is sounding.
 *
 * Above `ahead` and `wake` and BELOW `now`, which is the whole point: the
 * sibling highlight says "these are the same shape", and the sounding band still
 * has to be the brightest thing on the lane or the reader loses the now line.
 */
const FOCUS_OPACITY = '.7';

/** A bar line against a beat. Both are `flowParts.tick`'s `.5` without it. */
const TICK_MAJOR_OPACITY = '.9';

/** A row the caller asked to be drawn dimmed, its bands with it. */
const MUTED_LANE_OPACITY = '.45';

const harmonySurface = componentSurfaceDeclarations('harmony', {
  padding: '0', border: '0', background: SURFACE,
});

const flowParts = {
  root: {
    ...harmonySurface,
    display: 'block',
    'min-width': '0',
    position: 'relative',
    color: INK,
    'font-family': FONT,
    'font-size': SIZE_BODY,
  },
  /**
   * The clipping declaration is NOT here — see {@link FLOW_CLIP}. One CSS
   * property has to be written twice with two different values, and a
   * declaration record has one slot per property.
   */
  body: {display: 'grid', 'grid-template-columns': 'auto minmax(0, 1fr)', 'min-width': '0'},
  viewport: {
    'grid-column': '2',
    position: 'relative',
    'min-width': '0',
    height: FLOW_HEIGHT,
    background: 'transparent',
    contain: 'layout paint',
    'touch-action': 'pan-y',
  },
  // The one promoted node on the whole lane. Three hundred promoted bands is a
  // layer-tree explosion, and the bands never move relative to the reel.
  //
  // NO transition on `width`, and that is a correctness rule rather than a
  // taste. A band's box is a percentage OF THIS WIDTH while the reel's offset
  // is absolute pixels, so an eased width and an instant transform describe two
  // different scales for as long as the ease runs: a zoom threw the material
  // `(now - axis.start) * (newScale - oldScale)` px off the now line — measured
  // at 1890px, decaying over 120ms, and worse the further into the piece the
  // listener had got. The two cannot be eased together, so neither is.
  reel: {
    position: 'absolute',
    top: '0',
    left: '0',
    bottom: '0',
    'will-change': 'transform',
  },
  lane: {
    position: 'absolute',
    left: '0',
    right: '0',
    height: LANE_HEIGHT,
    'border-bottom': `1px solid ${LINE}`,
  },
  band: {
    position: 'absolute',
    'box-sizing': 'border-box',
    display: 'flex',
    'flex-direction': 'column',
    'justify-content': 'center',
    gap: '1px',
    padding: `0 ${SPACE_1}`,
    overflow: 'hidden',
    'content-visibility': 'auto',
    'contain-intrinsic-size': 'auto 48px',
  },
  // The tone lives on a CHILD, never on the band itself: the band's own inline
  // style is overwritten wholesale by the playhead, and the fill is the one
  // thing that has to keep changing while the band is lit.
  fill: {
    position: 'absolute',
    inset: '0',
    background: BAND_TONE,
    opacity: ZONE_OPACITY.ahead,
    transition: `opacity ${MOTION_CHIP} ${EASE}, background-color ${MOTION_TONE} ${EASE}`,
    'pointer-events': 'none',
  },
  // The role stripe: a second, orthogonal channel, so colour never carries a
  // fact alone.
  role: {
    position: 'absolute',
    'inset-block': '0',
    left: '0',
    width: '2px',
    'pointer-events': 'none',
  },
  label: {
    position: 'relative',
    flex: '0 0 auto',
    'min-width': '0',
    overflow: 'hidden',
    'text-overflow': 'ellipsis',
    'font-weight': '700',
    'font-family': FONT_MONO,
    'font-size': SIZE_BODY,
    'white-space': 'nowrap',
  },
  note: {
    position: 'relative',
    flex: '0 0 auto',
    'min-width': '0',
    overflow: 'hidden',
    'text-overflow': 'ellipsis',
    'font-size': SIZE_MICRO,
    color: INK_MUTED,
    'white-space': 'nowrap',
  },
  bead: {
    position: 'absolute',
    top: SPACE_1,
    right: SPACE_1,
    width: '.4rem',
    height: '.4rem',
    'border-radius': '50%',
  },
  // The contour owns the remaining row height after its labels. An absolute
  // full-row SVG draws directly through those labels, especially when its
  // caller supplies a long band that spans most of the score.
  glyph: {
    display: 'block',
    position: 'relative',
    width: '100%',
    height: '0',
    'min-height': '0',
    flex: '1 1 0',
    'pointer-events': 'none',
  },
  // The now line stays over the plot; the readout has its own space above it.
  now: {
    position: 'absolute',
    top: '0',
    bottom: '0',
    width: '1px',
    background: NOW_LINE,
    'pointer-events': 'none',
    // The flash of §3.6.3 rides `transform`, not `width`: `scaleX` grows the
    // line about its own centre, so the line the whole design pins in place
    // does not shift half a pixel sideways every time it is drawn attention to.
    transition: `width ${MOTION_TONE} linear`,
    'transform-origin': 'center',
  },
  pinned: {
    position: 'relative',
    'min-width': '0',
    'margin-bottom': SPACE_2,
    'font-family': FONT_DISPLAY,
    'font-weight': '700',
    'font-size': SIZE_TITLE,
    'line-height': '1.1',
    'white-space': 'normal',
    'overflow-wrap': 'anywhere',
    'pointer-events': 'none',
  },
  pinnedNote: {
    display: 'block',
    'font-family': FONT,
    'font-size': SIZE_MICRO,
    color: INK_MUTED,
  },
  // "There is no future here" — the empty field a live read-out shows to its
  // right, because pretending to know what has not been played is the one lie
  // this family is not allowed to tell.
  //
  // Hatched rather than filled, and that is the whole point of the node: a
  // solid block reads as MATERIAL, and the one thing this field may not look
  // like is something. An undressed div would have been the same lie told
  // silently — §5.7 asks for the emptiness to be visible, not merely true.
  future: {
    position: 'absolute',
    top: '0',
    bottom: '0',
    right: '0',
    'pointer-events': 'none',
    'border-left': `1px solid ${LINE}`,
    background: `repeating-linear-gradient(135deg, ${LINE} 0 1px, transparent 1px 7px)`,
    opacity: '.4',
  },
  gutter: {
    'box-sizing': 'border-box',
    'min-width': '0',
    'max-width': '7rem',
    'padding-top': RULER_HEIGHT,
    display: 'flex',
    'flex-direction': 'column',
    'font-size': SIZE_MICRO,
    color: INK_MUTED,
    'pointer-events': 'none',
  },
  gutterRow: {
    display: 'flex',
    'align-items': 'center',
    height: LANE_HEIGHT,
    'box-sizing': 'border-box',
    flex: '0 0 auto',
    'min-width': '0',
    padding: `0 ${SPACE_2} 0 0`,
  },
  gutterLabel: {'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap'},
  decorations: {'pointer-events': 'none'},
  tick: {
    position: 'absolute',
    top: '0',
    bottom: '0',
    width: '1px',
    background: LINE,
    opacity: '.5',
  },
  tickLabel: {
    position: 'absolute',
    top: '0',
    'font-size': SIZE_MICRO,
    color: INK_MUTED,
  },
  flag: {position: 'absolute', width: '2px', top: '0', bottom: '0'},
  bracket: {
    position: 'absolute',
    border: `1px solid ${LINE}`,
    'border-bottom': 'none',
  },
  empty: {margin: '0', 'font-size': SIZE_LABEL, color: INK_MUTED},
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

const nameplateParts = {
  root: {
    ...harmonySurface,
    display: 'block',
    'min-width': '0',
    'overflow-wrap': 'anywhere',
    position: 'relative',
    color: INK,
    'font-family': FONT,
  },
  live: {display: 'block'},
  symbol: {
    display: 'block',
    'max-width': '100%',
    'white-space': 'normal',
    'overflow-wrap': 'anywhere',
    'font-family': FONT_DISPLAY,
    'font-weight': '700',
    'font-size': SIZE_DISPLAY,
    'line-height': '1.15',
    'min-height': '1.2em',
  },
  full: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    overflow: 'hidden',
    'clip-path': 'inset(50%)',
  },
  // The approach ghost. `--wui-harmony-approach` is one custom property written
  // per frame on the ROOT — one write, not a sheet of them.
  next: {
    'font-family': FONT_DISPLAY,
    'font-size': SIZE_TITLE,
    color: INK_MUTED,
    opacity: 'calc(.25 + var(--wui-harmony-approach, 0) * .55)',
    'min-height': '1.2em',
  },
  caption: {
    'font-size': SIZE_LABEL,
    color: INK_MUTED,
    'margin-bottom': '.25rem',
  },
  voicing: {
    'font-family': FONT_MONO,
    'font-size': SIZE_BODY,
    margin: '.3rem 0 .6rem',
    'min-height': '1.1rem',
  },
  alternates: {
    display: 'flex',
    gap: SPACE_1,
    'flex-wrap': 'wrap',
    'list-style': 'none',
    margin: '0',
    padding: '0',
  },
  // The chip an alternate reading is drawn as, whether or not it can be pressed.
  // `cursor` is deliberately NOT in here: a reading the caller gave no
  // `selectAlternate` for renders as an inert `<li>`, and a pointer cursor over
  // a node that does nothing is the same lie as a focusable node with no
  // behaviour — the one this module already refuses to ship two lines below.
  alternate: {
    'box-sizing': 'border-box',
    'min-width': '0',
    'max-width': '100%',
    'white-space': 'normal',
    'overflow-wrap': 'anywhere',
    border: `1px solid ${LINE}`,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    'font-size': SIZE_LABEL,
    padding: '.15rem .45rem',
  },
  /** Only where there is something to press. */
  alternateButton: {
    cursor: 'pointer',
    'min-height': controlHeight('harmony'),
    'border-radius': controlRadius('harmony'),
  },
  alternateItem: {'min-width': '0', 'max-width': '100%'},
  history: {
    display: 'flex',
    gap: '.35rem',
    'flex-wrap': 'wrap',
    'min-height': '1.4rem',
  },
  empty: {margin: '0', 'font-size': SIZE_LABEL, color: INK_MUTED},
} satisfies Readonly<Record<string, Declarations>>;

const chipParts = {
  root: {
    ...harmonySurface,
    display: 'block',
    color: INK,
    'font-family': FONT,
    'font-size': SIZE_BODY,
  },
  list: {
    display: 'flex',
    gap: '.4rem',
    'list-style': 'none',
    margin: '0',
    padding: '0',
  },
  flow: {'flex-direction': 'row', 'flex-wrap': 'wrap'},
  ribbon: {
    'flex-direction': 'row',
    'flex-wrap': 'nowrap',
    'overflow-x': 'auto',
  },
  stack: {'flex-direction': 'column', gap: '.3rem'},
  item: {
    'border-radius': 'var(--wm-harmony-radius, var(--wm-control-radius, 0))',
    border: `1px solid ${LINE}`,
    padding: '.3rem .5rem',
    'min-width': '2.5rem',
    position: 'relative',
  },
  row: {
    display: 'grid',
    'grid-template-columns': '4.5rem 1fr auto',
    'align-items': 'center',
    gap: '.5rem',
    border: 'none',
    padding: '.15rem 0',
  },
  primary: {
    'font-family': FONT_DISPLAY,
    'font-weight': '700',
    'font-size': SIZE_TITLE,
  },
  secondary: {
    'font-size': SIZE_MICRO,
    'font-family': FONT_MONO,
    color: INK_MUTED,
  },
  meter: {
    position: 'relative',
    height: '.5rem',
    background: METER_BED,
    display: 'block',
  },
  // The whole-piece answer, drawn BEHIND the part that has been heard. One row
  // of DOM carrying two tracks, because they are two readings of one quantity
  // and putting them in two rows invites the eye to compare the wrong pair.
  ghost: {
    position: 'absolute',
    inset: '0 auto 0 0',
    background: METER_BED,
    filter: 'brightness(.94)',
  },
  fill: {position: 'absolute', inset: '0 auto 0 0', background: ACCENT},
  trailing: {
    'font-size': SIZE_MICRO,
    'font-family': FONT_MONO,
    color: INK_MUTED,
    'text-align': 'right',
  },
  bead: {
    width: '.55rem',
    height: '.55rem',
    'border-radius': '50%',
    flex: '0 0 auto',
  },
  empty: {margin: '0', 'font-size': SIZE_LABEL, color: INK_MUTED},
} satisfies Readonly<Record<string, Declarations>>;

const wheelParts = {
  root: {
    ...harmonySurface,
    display: 'block',
    position: 'relative',
    color: INK,
    'font-family': FONT,
  },
  svg: {display: 'block', width: '100%', height: 'auto', 'max-width': '100%'},
  sector: {
    transition: `fill ${MOTION_TONE} ${EASE}, opacity ${MOTION_TONE} ${EASE}`,
  },
  // One transform write plus one transition. The needle does not run a loop:
  // where a key is, is a conclusion, and a conclusion changes when the evidence
  // does, not sixty times a second.
  needle: {
    'transform-box': 'view-box',
    'transform-origin': 'center',
    transition: `transform ${MOTION_TURN} ${EASE}`,
  },
  centre: {display: 'block', 'text-align': 'center', 'margin-top': '.35rem'},
  primary: {
    display: 'block',
    'font-family': FONT_DISPLAY,
    'font-weight': '700',
    'font-size': SIZE_TITLE,
    'min-height': '1.2em',
  },
  secondary: {
    display: 'block',
    'font-size': SIZE_MICRO,
    color: INK_MUTED,
    'min-height': '1.2em',
  },
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
  empty: {margin: '0', 'font-size': SIZE_LABEL, color: INK_MUTED},
} satisfies Readonly<Record<string, Declarations>>;

/**
 * `overflow: hidden; overflow: clip;` — the same property twice, in this order,
 * and the single most load-bearing pair of declarations in the module.
 *
 * An `overflow: hidden` box IS a scroll container in the programmatic sense,
 * and `createAnalysisPlayhead` calls `scrollIntoView` on every node it newly
 * lights. Inside a lane that writes a transform every frame, one such call
 * permanently shoves the reel relative to the viewport and the anchor is
 * finished — and the node it scrolls to is always the one ON the anchor, so the
 * symptom is a lane that drifts a little further off every chord.
 *
 * `overflow: clip` creates no scroll container at all, so THIS box never
 * scrolls and the anchor is safe. It is not a no-op for the page: a clip box is
 * skipped by `scrollIntoView`, which then goes on to the nearest real
 * scrollport above it, and a band whose lit occurrence is not the occurrence
 * under the line — a motif recurring — can be a long way outside the viewport.
 * So the second half of the guarantee is the caller's: a root that holds a lane
 * takes `createAnalysisPlayhead(root, {scroll: false})`, which is the same
 * `{scroll?: boolean}` the workbench passes. The `hidden` before `clip` is what
 * an engine too old for `clip` keeps, where the transform still works and the
 * scroll listener below takes over.
 *
 * It cannot live in a declaration record, which has one slot per property, so
 * it is written as literal CSS for the sheet and as two assignments for the
 * inline path.
 */
const FLOW_CLIP = '.wui-harmony-flow__viewport { overflow: hidden; overflow: clip; }';

/** The four root classes, in the order their sections appear below. */
const HARMONY_ROOTS = [
  '.wui-harmony-flow',
  '.wui-harmony-nameplate',
  '.wui-harmony-chip',
  '.wui-harmony-wheel',
] as const;

const indent = (rule: string): string =>
  rule
    .split('\n')
    .map((row) => `  ${row}`)
    .join('\n');

/**
 * The stylesheet for all four read-outs. Exported so a host rendering into its
 * own light DOM can install it once instead of taking it per mount; a host that
 * passes `stylesheet: false` gets the identical declarations painted onto the
 * nodes, generated from the same records.
 *
 * The state rules are the half a `cssText` string cannot carry: an attribute
 * selector and a media query. Everything that carries INFORMATION rather than
 * motion — `data-zone`, `data-current` — is also written onto the node when a
 * host opts out of this sheet.
 */
export const harmonyPresenterStyle = [
  harmonyRule('.wui-harmony-flow', HARMONY_MOTION.full, flowParts.root),
  harmonyRule('.wui-harmony-flow__body', flowParts.body),
  harmonyRule('.wui-harmony-flow__viewport', flowParts.viewport),
  FLOW_CLIP,
  harmonyRule('.wui-harmony-flow__reel', flowParts.reel),
  harmonyRule('.wui-harmony-flow__lane', flowParts.lane),
  harmonyRule('.wui-harmony-flow__band', flowParts.band),
  harmonyRule('.wui-harmony-flow__fill', flowParts.fill),
  harmonyRule('.wui-harmony-flow__role', flowParts.role),
  harmonyRule('.wui-harmony-flow__label', flowParts.label),
  harmonyRule('.wui-harmony-flow__note', flowParts.note),
  harmonyRule('.wui-harmony-flow__bead', flowParts.bead),
  harmonyRule('.wui-harmony-flow__glyph', flowParts.glyph),
  harmonyRule('.wui-harmony-flow__now', flowParts.now),
  harmonyRule('.wui-harmony-flow__pinned', flowParts.pinned),
  harmonyRule('.wui-harmony-flow__pinned-note', flowParts.pinnedNote),
  harmonyRule('.wui-harmony-flow__future', flowParts.future),
  harmonyRule('.wui-harmony-flow__gutter', flowParts.gutter),
  harmonyRule('.wui-harmony-flow__gutter-row', flowParts.gutterRow),
  harmonyRule('.wui-harmony-flow__gutter-label', flowParts.gutterLabel),
  harmonyRule('.wui-harmony-flow__decorations', flowParts.decorations),
  harmonyRule('.wui-harmony-flow__tick', flowParts.tick),
  harmonyRule('.wui-harmony-flow__tick-label', flowParts.tickLabel),
  harmonyRule('.wui-harmony-flow__flag', flowParts.flag),
  harmonyRule('.wui-harmony-flow__bracket', flowParts.bracket),
  harmonyRule('.wui-harmony-flow__empty', flowParts.empty),
  harmonyRule('.wui-harmony-flow__index', flowParts.index),
  harmonyRule('.wui-harmony-flow__band[data-zone="now"] .wui-harmony-flow__fill', {
    opacity: ZONE_OPACITY.now,
  }),
  harmonyRule('.wui-harmony-flow__band[data-zone="wake"] .wui-harmony-flow__fill', {
    opacity: ZONE_OPACITY.wake,
  }),
  // The sibling highlight — a motif's other occurrences lighting with it. It
  // paints with `background`, never with an outline: that property belongs to
  // the playhead alone, and six assertions detect "is it lit" by looking for
  // its name in a style string.
  //
  // `:not([data-zone="now"])` is load-bearing, not defensive. This rule and the
  // two zone rules above it sat at equal specificity with this one last, so
  // focusing a group DIMMED the sounding band from 1 to .7 — the one band that
  // must never dim. Reordering only moves the bug: with focus first the zone
  // rules win and the sibling highlight is dead for `ahead` and `wake`, which is
  // every band it was written for. Excluding `now` says the intent instead of
  // relying on the order two rules happen to be listed in.
  harmonyRule(
    '.wui-harmony-flow__band[data-focus="true"]:not([data-zone="now"]) .wui-harmony-flow__fill',
    {opacity: FOCUS_OPACITY},
  ),
  // Written by `rebuildLanes` since the lane was first drawn, styled by nothing
  // until now. `FlowTrack.muted` says "drawn dimmed, and its bands with it", and
  // dimming the ROW is how the bands come with it for free.
  harmonyRule('.wui-harmony-flow__lane[data-muted="true"]', {opacity: MUTED_LANE_OPACITY}),
  harmonyRule('.wui-harmony-flow__tick[data-major="true"]', {opacity: TICK_MAJOR_OPACITY}),
  harmonyRule('.wui-harmony-flow[data-motion="stepped"] .wui-harmony-flow__reel', {
    transition: 'none',
  }),

  harmonyRule('.wui-harmony-nameplate', HARMONY_MOTION.full, nameplateParts.root),
  harmonyRule('.wui-harmony-nameplate__live', nameplateParts.live),
  harmonyRule('.wui-harmony-nameplate__symbol', nameplateParts.symbol),
  // `hero` is the read-out standing alone on a stage; `display`, the default,
  // is the same plate sitting inside a card that has other things to say.
  harmonyRule('.wui-harmony-nameplate[data-emphasis="hero"] .wui-harmony-nameplate__symbol', {
    'font-size': `calc(${SIZE_DISPLAY} * 1.35)`,
  }),
  harmonyRule('.wui-harmony-nameplate__full', nameplateParts.full),
  harmonyRule('.wui-harmony-nameplate__next', nameplateParts.next),
  harmonyRule('.wui-harmony-nameplate__caption', nameplateParts.caption),
  harmonyRule('.wui-harmony-nameplate__voicing', nameplateParts.voicing),
  harmonyRule('.wui-harmony-nameplate__alternates', nameplateParts.alternates),
  harmonyRule('.wui-harmony-nameplate__alternates > li', nameplateParts.alternateItem),
  harmonyRule('.wui-harmony-nameplate__alternate', nameplateParts.alternate),
  harmonyRule('button.wui-harmony-nameplate__alternate', nameplateParts.alternateButton),
  harmonyRule('.wui-harmony-nameplate__history', nameplateParts.history),
  harmonyRule('.wui-harmony-nameplate__chip', harmonyParts.historyChip),
  harmonyRule('.wui-harmony-nameplate__chip[data-current="true"]', harmonyParts.historyChipActive),
  harmonyRule('.wui-harmony-nameplate__empty', nameplateParts.empty),

  harmonyRule('.wui-harmony-chip', HARMONY_MOTION.full, chipParts.root),
  harmonyRule('.wui-harmony-chip__list', chipParts.list),
  harmonyRule('.wui-harmony-chip__list[data-layout="flow"]', chipParts.flow),
  harmonyRule('.wui-harmony-chip__list[data-layout="ribbon"]', chipParts.ribbon),
  harmonyRule('.wui-harmony-chip__list[data-layout="stack"]', chipParts.stack),
  harmonyRule('.wui-harmony-chip__item', chipParts.item),
  harmonyRule(
    '.wui-harmony-chip__list[data-layout="stack"] .wui-harmony-chip__item',
    chipParts.row,
  ),
  // `data-selectable` was written by `paintChip` and read by nothing: a chip the
  // caller made pressable looked exactly like one that does nothing.
  harmonyRule('.wui-harmony-chip__item[data-selectable="true"]', {cursor: 'pointer'}),
  harmonyRule('.wui-harmony-chip__primary', chipParts.primary),
  harmonyRule('.wui-harmony-chip__secondary', chipParts.secondary),
  harmonyRule('.wui-harmony-chip__meter', chipParts.meter),
  harmonyRule('.wui-harmony-chip__ghost', chipParts.ghost),
  harmonyRule('.wui-harmony-chip__fill', chipParts.fill),
  harmonyRule('.wui-harmony-chip__trailing', chipParts.trailing),
  harmonyRule('.wui-harmony-chip__bead', chipParts.bead),
  harmonyRule('.wui-harmony-chip__empty', chipParts.empty),

  harmonyRule('.wui-harmony-wheel', HARMONY_MOTION.full, wheelParts.root),
  harmonyRule('.wui-harmony-wheel__svg', wheelParts.svg),
  harmonyRule('.wui-harmony-wheel__sector', wheelParts.sector),
  harmonyRule('.wui-harmony-wheel__needle', wheelParts.needle),
  harmonyRule('.wui-harmony-wheel__centre', wheelParts.centre),
  harmonyRule('.wui-harmony-wheel__primary', wheelParts.primary),
  harmonyRule('.wui-harmony-wheel__secondary', wheelParts.secondary),
  harmonyRule('.wui-harmony-wheel__index', wheelParts.index),
  harmonyRule('.wui-harmony-wheel__empty', wheelParts.empty),

  // The escape a `cssText` string cannot carry, and the reason it is here as
  // well as in `resolveMotion`: a page whose shell never declared `data-motion`
  // and whose JavaScript never ran still owes a reduced-motion viewer a still
  // surface. `motion: 'continuous'` does not out-rank the viewer's own setting.
  [
    '@media (prefers-reduced-motion: reduce) {',
    ...HARMONY_ROOTS.flatMap((selector) => [
      indent(harmonyRule(selector, harmonyMotion.reduced, HARMONY_MOTION.reduced)),
      indent(
        harmonyRule(`${selector}, ${selector} *, ${selector} *::before, ${selector} *::after`, {
          transition: 'none',
          animation: 'none',
        }),
      ),
    ]),
    '}',
  ].join('\n'),
].join('\n\n');

// ---------------------------------------------------------------------------
// Small shared plumbing. The same guarded writers the pitch surfaces use: a
// `data-*` value re-written with its own value is a mutation the browser and
// every observer both see, and these read-outs write attributes far more often
// than they change them.
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

// Author display declarations (including the inline skin) override the UA's
// [hidden] rule. Preserve each node's display so empty flex rows really collapse
// and reveal with the same layout on both styling paths.
const hiddenDisplays = new WeakMap<HTMLElement, string>();

function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
  if (hidden) {
    if (!hiddenDisplays.has(node)) hiddenDisplays.set(node, node.style.display);
    setStyleValue(node, 'display', 'none');
  } else if (hiddenDisplays.has(node)) {
    setStyleValue(node, 'display', hiddenDisplays.get(node) || undefined);
    hiddenDisplays.delete(node);
  }
}

function setLabel(node: Element, label: string): void {
  if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
}

function svg<K extends keyof SVGElementTagNameMap>(
  document: Document,
  name: K,
  attributes: Readonly<Record<string, string | number>> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

/** A number safe to write into an attribute: never `NaN`, never `Infinity`. */
function coordinate(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}

/**
 * Paint the boxes onto the nodes, but only for a host that opted out of the
 * stylesheet. Both paths read the same records, so the sheet and the inline
 * string cannot describe two different read-outs.
 */
function dressing(
  stylesheet: boolean | undefined,
): (node: ElementCSSInlineStyle, ...groups: Declarations[]) => void {
  if (stylesheet === false) return (node, ...groups) => paint(node, ...groups);
  return () => {};
}

/** The label a read-out announces when the caller supplies none. */
function describe(subject: string, names: readonly string[]): string {
  return names.length > 0 ? `${subject}: ${names.join(', ')}` : subject;
}

/**
 * Declare the whole motion budget on a root, and spend it down to nothing where
 * the viewer asked for less.
 *
 * The full record is written even when the sheet is installed, and it is not
 * redundant: the transitions above read `var(--wui-harmony-motion-chip, 120ms)`,
 * and that chain never reaches `--wm-harmony-motion-chip` unless the `--wui-*`
 * name is declared somewhere on the way down. This is where a host's own
 * override becomes reachable at all — which is why BOTH records are painted.
 * `harmonyMotion` carries tone and chip and `HARMONY_MOTION` carries the three
 * this family added; painting only the second left the two the fill's own
 * transition spends unreachable for any mount not sitting inside an analysis
 * root, and a standalone lane is exactly what the docs site mounts.
 */
function dressMotion(root: HTMLElement, stepped: boolean): void {
  paint(root, harmonyMotion.full, HARMONY_MOTION.full);
  if (stepped) paint(root, harmonyMotion.reduced, HARMONY_MOTION.reduced);
}

// ---------------------------------------------------------------------------
// The flow lane.
// ---------------------------------------------------------------------------

/** One item on the conveyor. Domain-neutral: two numbers, some text, three colours. */
export interface FlowBand {
  id: string;
  /** Where the band sits on the LANE axis. The kit only ever compares these. */
  start: number;
  end: number;
  /**
   * Where the band sits on the STAMPING axis — the numbers a playhead is fed.
   * They default to `start`/`end`, and they exist separately because the two
   * axes are different rulers: a conveyor is drawn in real time so a
   * ritardando visibly stretches, while a playhead is fed the score's own
   * metrical position. The kit never converts between them.
   */
  stampStart?: number;
  stampEnd?: number;
  /**
   * Several appearances of one item — a motif recurring. Given this, the band
   * stamps ONLY the multi-span form: a node carrying both forms reads back as
   * one span too many.
   */
  spans?: readonly {start: number; end: number}[];
  /** 0-based row. Rows share one axis, one now line and one transform. */
  track?: number;
  /** The big word, pinned at the now line while this band is sounding. */
  primary?: string;
  secondary?: string;
  trailing?: string;
  /** A pure-geometry path, drawn inside the band's own box. The kit only frames it. */
  glyph?: string;
  /** A normalised contour inside the band, `at` and `y` both 0…1. */
  points?: readonly {at: number; y: number}[];
  /** 0…11 — the progression slot that fills the block. */
  tone?: number;
  /** What the pitch is DOING — paints the stripe down the band's leading edge. */
  role?: ToneRole;
  /** How loud the read-out shouts — paints a bead, never the whole block. */
  severity?: Severity;
  /** 0…1 share of the row's fill height; text and hit targets retain the full row. */
  weight?: number;
  /** Siblings that light together. */
  group?: string;
  disabled?: boolean;
}

export interface FlowTrack {
  id: string;
  label?: string;
  sublabel?: string;
  /** Drawn dimmed, and its bands with it. The row keeps its place in the reel. */
  muted?: boolean;
}

export interface FlowFlag {
  id: string;
  at: number;
  track?: number;
  severity?: Severity;
  label?: string;
}

export interface FlowBracket {
  id: string;
  start: number;
  end: number;
  from: number;
  to: number;
  severity?: Severity;
  label?: string;
}

export interface FlowLaneState {
  bands: readonly FlowBand[];
  /**
   * The rows. They share ONE reel and ONE now line — not by convention but
   * structurally, because they are children of the same transformed node.
   */
  tracks?: readonly FlowTrack[];
  /**
   * Which row owns the instant — the row the pinned read-out is taken from and
   * the one `aria-current` follows. Defaults to the topmost row that has bands,
   * which is right when the rows are a stack of the same kind of thing and
   * wrong when the top one is a header: a strip spanning the whole piece is
   * under the now line at every instant and answers nothing by being there.
   */
  primaryTrack?: number;
  flags?: readonly FlowFlag[];
  brackets?: readonly FlowBracket[];
  ruler?: readonly {at: number; label: string; major?: boolean}[];
  /** The material's extent. Both the reel's width and every scrub clamp to it. */
  span?: {start: number; end: number};
  /** The current position. With `binding.position` this is only the first frame's seed. */
  now: number;
  playing?: boolean;
  /** `false` draws the space right of the now line as an empty field. */
  future?: boolean;
  /** Override the readout pinned at the now line. */
  pinned?: {primary?: string; secondary?: string};
  /** Every band in this group lights together. */
  focusGroup?: string;
  emptyLabel?: string;
  disabled?: boolean;
}

export interface FlowLaneBinding {
  /** Content. Pulled on domain events — NOT per frame. */
  snapshot(): FlowLaneState;
  /**
   * Position. Pulled ONCE per frame. Given it, this mount is live; without it
   * the position is whatever `state.now` last said.
   *
   * It takes the frame rather than returning one so that the caller can
   * interpolate between sparse samples itself: whether to interpolate depends
   * on whether something is playing, at what rate, and whether a seek just
   * happened — all domain knowledge, none of it the kit's to guess.
   */
  position?(tick: FrameTick): number;
  /** `phase` lets a caller throttle a seek storm: preview while dragging, commit on release. */
  seek?(position: number, phase: 'drag' | 'commit'): Promise<void> | void;
  selectBand?(id: string, band: FlowBand, options: {additive: boolean}): Promise<void> | void;
  focusBand?(id: string | undefined): void;
  subscribe?(notify: () => void): () => void;
}

export interface FlowLaneClassNames {
  root?: string;
  viewport?: string;
  reel?: string;
}

export interface FlowLaneParts {
  root?: string;
  viewport?: string;
  reel?: string;
}

export interface FlowLaneOptions {
  /** Outer surface, or no frame/background when a containing presenter owns it. Defaults to 'default'. */
  surface?: 'default' | 'none';
  label?: string;
  /**
   * Where the now line is pinned, 0…1. Defaults to **.33** — a third behind,
   * two thirds ahead, because anticipation is the entire reason for the shape.
   */
  anchor?: number;
  /** Pixels per axis unit before zoom. Defaults to 44; overridden by a valid visibleSpan. */
  scale?: number;
  /**
   * Axis units fitting across the measured viewport before zoom. A finite
   * positive value adapts scale to container width; omitted or invalid values
   * use scale. Resize preserves the current position and zoom.
   */
  visibleSpan?: number;
  /**
   * What the lane assumes it is wide when nothing can measure it — no
   * `ResizeObserver`, or a layout engine that answers `0`. Without it a lane in
   * such an environment pins the now line at x = 0 and every test written
   * against the reel's transform is vacuously true rather than failing.
   */
  fallbackWidth?: number;
  motion?: MotionMode;
  /** Run a frame loop. Defaults to whether `binding.position` exists; a `clock` forces it false. */
  animate?: boolean;
  /** Somebody else's clock. Given one, this mount opens no loop of its own. */
  clock?: FrameClock;
  /**
   * Write the span contract onto each band. Defaults to true. Turn it off only
   * where this lane's stamping unit differs from the unit the playhead on this
   * root is fed — a mismatch there is visible as the page scrolling sideways.
   */
  spans?: boolean;
  /** Arrow-key movement, in axis units. Defaults to 1. */
  keyboardStep?: number;
  /** Shift-arrow movement, in axis units. Defaults to 4. */
  keyboardPage?: number;
  /** Say the position in the caller's own words for `aria-valuetext`. */
  formatPosition?: (position: number) => string;
  classNames?: FlowLaneClassNames;
  parts?: FlowLaneParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface FlowLaneHandle {
  element: HTMLElement;
  readonly viewport: HTMLElement;
  readonly reel: HTMLElement;
  readonly nowLine: HTMLElement;
  /** The visually hidden semantic twin: the lane, readable without CSS. */
  readonly index: HTMLOListElement;
  track(id: string): HTMLElement | undefined;
  band(id: string): HTMLElement | undefined;
  /** Re-place the material only. NEVER re-reads the snapshot, and the loop calls only this. */
  tick(): void;
  /** Re-read the snapshot and reconcile the nodes. Never called by the frame loop. */
  update(): void;
  destroy(): void;
}

interface BandNode {
  root: HTMLElement;
  fill: HTMLElement;
  role: HTMLElement;
  label: HTMLElement;
  note: HTMLElement;
  bead: HTMLElement;
  glyph?: SVGSVGElement;
  entry: HTMLLIElement;
  /** The last box written, so an unchanged band is never re-serialised. */
  css: string;
  band: FlowBand;
}

const mountedFlowLanes = new WeakMap<HarmonyHost, FlowLaneHandle>();

/** Mount the conveyor: a fixed now line, and the material running under it. */
export function mountFlowLane(
  host: HarmonyHost,
  binding: FlowLaneBinding,
  options: FlowLaneOptions = {},
): FlowLaneHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const style = installStyle(document, 'harmony', harmonyPresenterStyle, options.stylesheet);
  const dress = dressing(options.stylesheet);
  const inline = options.stylesheet === false;
  const motion = resolveMotion(host, options.motion, view);
  const stepped = motion !== 'continuous';
  const anchor = clamp(options.anchor, 0, 1, 0.33);
  const baseScale = finitePositive(options.scale, DEFAULT_SCALE);
  const visibleSpan =
    typeof options.visibleSpan === 'number' && Number.isFinite(options.visibleSpan) && options.visibleSpan > 0
      ? options.visibleSpan
      : undefined;
  const fallbackWidth = finitePositive(options.fallbackWidth, DEFAULT_LANE_WIDTH);
  const keyboardStep = finitePositive(options.keyboardStep, 1);
  const keyboardPage = finitePositive(options.keyboardPage, 4);
  const stamping = options.spans !== false;

  const root = document.createElement('div');
  root.className = 'wui-harmony-flow';
  root.setAttribute('role', 'group');
  root.dataset.motion = motion;
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  dress(root, flowParts.root);
  if (options.surface === 'none') paint(root, embeddedSurfaceDeclarations);
  dressMotion(root, stepped);

  const viewport = document.createElement('div');
  viewport.className = 'wui-harmony-flow__viewport';
  addClassNames(viewport, options.classNames?.viewport);
  setParts(viewport, 'viewport', options.parts?.viewport);
  dress(viewport, flowParts.viewport);
  // Written inline on EVERY path, sheet or no sheet: see `FLOW_CLIP`. The
  // second assignment wins wherever `clip` is understood and is dropped
  // wherever it is not, which is exactly the fallback the pair is for.
  viewport.style.overflow = 'hidden';
  viewport.style.overflow = 'clip';
  const body = document.createElement('div');
  body.className = 'wui-harmony-flow__body';
  dress(body, flowParts.body);
  body.append(viewport);
  root.append(body);

  const reel = document.createElement('div');
  reel.className = 'wui-harmony-flow__reel';
  // The last visual child of the viewport that was not hidden, and the only one
  // whose contents are words. With `binding.seek` the viewport is a `slider`,
  // whose children are presentational, so the band labels were suppressed and
  // the `<ol>` twin was the single reading. WITHOUT `seek` there is no role, so
  // every label was announced twice — once off the reel in visual order, once
  // out of the twin. The twin is the accessible representation of this lane on
  // both paths; the reel is the picture of it.
  reel.setAttribute('aria-hidden', 'true');
  addClassNames(reel, options.classNames?.reel);
  setParts(reel, 'reel', options.parts?.reel);
  dress(reel, flowParts.reel);

  const lanes = document.createElement('div');
  lanes.className = 'wui-harmony-flow__lanes';
  const decorations = document.createElement('div');
  decorations.className = 'wui-harmony-flow__decorations';
  dress(decorations, flowParts.decorations);
  reel.append(lanes, decorations);

  const gutter = document.createElement('div');
  gutter.className = 'wui-harmony-flow__gutter';
  gutter.setAttribute('aria-hidden', 'true');
  dress(gutter, flowParts.gutter);

  const nowLine = document.createElement('div');
  nowLine.className = 'wui-harmony-flow__now';
  nowLine.setAttribute('aria-hidden', 'true');
  dress(nowLine, flowParts.now);

  // This readout stays above the plot, where it can wrap without covering the
  // ruler or the bands. It never rides the moving reel.
  const pinned = document.createElement('div');
  pinned.className = 'wui-harmony-flow__pinned';
  pinned.setAttribute('aria-hidden', 'true');
  dress(pinned, flowParts.pinned);
  const pinnedName = document.createElement('span');
  pinnedName.className = 'wui-harmony-flow__pinned-name';
  const pinnedNote = document.createElement('span');
  pinnedNote.className = 'wui-harmony-flow__pinned-note';
  dress(pinnedNote, flowParts.pinnedNote);
  pinned.append(pinnedName, pinnedNote);

  const future = document.createElement('div');
  future.className = 'wui-harmony-flow__future';
  future.setAttribute('aria-hidden', 'true');
  future.hidden = true;
  dress(future, flowParts.future);

  viewport.append(reel, future, nowLine);
  body.prepend(gutter);
  root.prepend(pinned);

  const index = document.createElement('ol');
  index.className = 'wui-harmony-flow__index';
  dress(index, flowParts.index);
  root.append(index);

  const empty = document.createElement('p');
  empty.className = 'wui-harmony-flow__empty';
  empty.hidden = true;
  markEmptyState(empty);
  dress(empty, flowParts.empty);
  root.append(empty);

  const bands = new Map<string, BandNode>();
  const trackNodes = new Map<string, HTMLElement>();
  let axis: FlowAxis = flowAxis(undefined, []);
  let boundaries: number[] = [];
  let ordered: FlowBand[] = [];
  let state: FlowLaneState = {bands: [], now: 0};
  let position = 0;
  let painted = Number.NaN;
  let epoch = 0;
  let zoom = 1;
  let laneWidth = fallbackWidth;
  let laneSignature = '';
  let rulerSignature = '';
  let currentId: string | undefined;
  /**
   * The row the pinned readout, the aria text and the stepped re-anchor all
   * answer from: the LOWEST track number present, not whatever `state.bands`
   * happens to list first. Several tracks share one now line, so exactly one of
   * them has to be the headline, and letting array order decide meant a lane
   * pinning a motif's name and anchoring 48px away from the chord under the
   * line. `state.pinned` overrides it where a caller wants another answer.
   */
  let primaryTrack = 0;
  let pulse: Animation | undefined;
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let leaveLoop: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  let drag: {pointerId: number; left: number; at: number; moved: boolean} | undefined;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;

  const report = createErrorSink(options.onError);
  const clockNow = (): number => view?.performance?.now?.() ?? Date.now();
  const pxPerUnit = (): number => (visibleSpan === undefined ? baseScale : laneWidth / visibleSpan) * zoom;

  // -------------------------------------------------------------------------
  // Reading the position.
  // -------------------------------------------------------------------------

  const readPosition = (tick: FrameTick): number => {
    if (!binding.position) return finite(state.now, axis.start);
    try {
      const value = binding.position(tick);
      return Number.isFinite(value) ? value : position;
    } catch (error) {
      report(error);
      return position;
    }
  };

  const trackOf = (band: {track?: number}): number =>
    Math.max(0, Math.round(finite(band.track, 0)));

  /**
   * The band the position is inside, on the headline row for preference. The
   * band it was inside last frame is asked first, because between two crossings
   * the answer is the same one every time and a scan of every band on the reel
   * is a per-frame cost that grows with the piece — and the held answer is only
   * trusted while it is itself on the headline row, or a lower row's band could
   * start underneath it and never be noticed.
   *
   * The fallback to any row is what keeps a hole in the headline from blanking
   * the readout: the lane still says what is sounding, on whichever row it is.
   */
  const bandAt = (at: number): FlowBand | undefined => {
    const held = currentId === undefined ? undefined : bands.get(currentId)?.band;
    if (held && trackOf(held) === primaryTrack && flowZone(at, held) === 'now') return held;
    return (
      ordered.find((band) => trackOf(band) === primaryTrack && flowZone(at, band) === 'now') ??
      ordered.find((band) => flowZone(at, band) === 'now')
    );
  };

  /**
   * The one sanctioned flash in the whole design, and it flashes the LINE, not
   * the material (§3.6.3). `scaleX` rather than `width` so the line grows about
   * its own centre and the thing the lane pins in place is not nudged sideways
   * to celebrate arriving somewhere.
   *
   * Feature-detected for the same reason the nameplate's pop is: jsdom has no
   * `Element.prototype.animate`, and a lane that threw on its first chord in a
   * test environment would be a lane nobody could test.
   */
  const pulseNowLine = (): void => {
    if (stepped) return;
    const run = (nowLine as {animate?: HTMLElement['animate']}).animate;
    if (typeof run !== 'function') return;
    try {
      pulse?.cancel();
      pulse = run.call(
        nowLine,
        [{transform: 'scaleX(1)'}, {transform: 'scaleX(2)'}, {transform: 'scaleX(1)'}],
        {duration: NOW_PULSE_MS, easing: 'linear'},
      );
    } catch (error) {
      report(error);
    }
  };

  /**
   * The slider's value, said at READER granularity.
   *
   * Not per frame. `aria-valuenow` and `aria-valuetext` are accessibility-tree
   * mutations on the view's only tab stop, and writing them sixty times a
   * second makes a focused slider announce sixty distinct values a second in
   * any reader that speaks value changes. The answer only actually changes when
   * the sounding band does or when somebody seeks, and those are the two places
   * this is called from.
   */
  const announce = (): void => {
    if (!binding.seek) return;
    const current = currentId === undefined ? undefined : bands.get(currentId)?.band;
    setAttr(viewport, 'aria-valuenow', coordinate(position));
    setAttr(
      viewport,
      'aria-valuetext',
      options.formatPosition?.(position) ??
        (current?.primary ? `${coordinate(position)} — ${current.primary}` : coordinate(position)),
    );
  };

  /**
   * Place the material. The ONE per-frame write on the reel, plus the drain on
   * the sounding band's own fill — a child node, so no idle style is disturbed.
   */
  const place = (next: number, forced: boolean): void => {
    if (destroyed) return;
    const previous = painted;
    position = Number.isFinite(next) ? next : position;
    const current = bandAt(position);
    // Reduced motion re-anchors on the BAND, not on the instant: the layout is
    // pixel-identical and only this number differs.
    const at = stepped ? (current ? current.start : position) : position;
    const shift = flowShift(at, axis, pxPerUnit(), anchor, laneWidth);
    const transform = `translate3d(${shift}px, 0, 0)`;
    if (reel.style.transform !== transform) reel.style.transform = transform;

    if (forced || !Number.isFinite(previous) || flowCrossed(boundaries, previous, position)) {
      for (const node of bands.values()) {
        const zone = flowZone(position, node.band);
        setData(node.root, 'zone', zone);
        // The state channel the sheet owns through an attribute selector,
        // written onto the CHILD for a host that has no sheet. Never onto the
        // band itself: that node's style belongs to the playhead.
        //
        // The sibling highlight is read back off the node rather than kept in a
        // second variable, because `paintBand` is the one writer of `data-focus`
        // and a private copy here could disagree with it. Without this the
        // inline path had `focusGroup` — the whole reason `motifs` draws one
        // track per motif — doing nothing at all: an option a host without a
        // sheet passes and never sees. The `now` exclusion is the sheet rule's,
        // said the same way in the same place.
        if (inline)
          setStyleValue(
            node.fill,
            'opacity',
            node.root.dataset.focus === 'true' && zone !== 'now'
              ? FOCUS_OPACITY
              : ZONE_OPACITY[zone],
          );
      }
    }

    const changed = currentId !== current?.id;
    if (changed) {
      const leaving = currentId === undefined ? undefined : bands.get(currentId);
      if (leaving) {
        setAttr(leaving.entry, 'aria-current', undefined);
        setStyleValue(leaving.fill, 'background', inline ? BAND_TONE : undefined);
      }
      currentId = current?.id;
      // `aria-current` on the semantic twin only. On a band it would collide
      // with the playhead, which owns that attribute on every span-carrying
      // node and is the single source of "this one is sounding".
      const arriving = current === undefined ? undefined : bands.get(current.id);
      if (arriving) setAttr(arriving.entry, 'aria-current', 'true');
      // Not on the first placement: a lane that flashed as it appeared would be
      // announcing an arrival nobody travelled to.
      if (current && Number.isFinite(previous)) pulseNowLine();
    }

    // The drain: the sounding band is filled only as far as the now line,
    // because the material to its right is time nobody has heard yet. One
    // gradient, written on the band's own CHILD — the band's inline style is
    // the playhead's, and this is the one thing that has to keep changing
    // while the band is lit. Off under reduced motion, where the band is
    // simply full: an eighth of a second of gradient is not worth a driver.
    const sounding = current === undefined ? undefined : bands.get(current.id);
    if (sounding && current) {
      const width = current.end - current.start;
      const share = stepped || width <= 0 ? 100 : clamp01((position - current.start) / width) * 100;
      setStyleValue(
        sounding.fill,
        'background',
        share >= 100
          ? (inline ? BAND_TONE : undefined)
          : `linear-gradient(to right, ${BAND_TONE} 0 ${coordinate(share)}%, transparent ${coordinate(share)}% 100%)`,
      );
    }

    setText(pinnedName, state.pinned?.primary ?? current?.primary ?? '');
    setText(pinnedNote, state.pinned?.secondary ?? current?.secondary ?? '');
    setHidden(pinned, !pinnedName.textContent && !pinnedNote.textContent);
    setStyleValue(nowLine, 'width', current ? '2px' : '1px');
    if (forced || changed) announce();
    painted = position;
  };

  const tickAt = (tick: FrameTick): void => {
    if (destroyed) return;
    try {
      const forced = tick.epoch !== undefined && tick.epoch !== epoch;
      if (tick.epoch !== undefined) epoch = tick.epoch;
      if (tick.degraded !== undefined) {
        setData(root, 'motion', tick.degraded ? 'degraded' : motion);
      }
      // A gesture in progress is the authority on the position; the clock is
      // not. Without this the loop overwrites `position` from
      // `binding.position()` between two pointer moves, every delta is computed
      // from a number a frame reset 16ms ago, and 264px of finger travel
      // commits where it started — the whole gesture discarded. Pointer capture
      // and the wheel's settle timer scope it exactly, and the frame after the
      // release re-syncs from the caller.
      if (drag || wheelTimer !== undefined) return;
      const next = readPosition(tick);
      // Reduced motion is EVENT rate, not frame rate. This is where that saving
      // is actually made: a stepped lane is ticked at the full rate — by its own
      // loop or by a shell's clock — and does nothing at all until the sounding
      // band changes, so running the whole body sixty times a second in order to
      // re-anchor six times is what §2.5.3 promises and this returns before.
      if (stepped && tick.continuous && !forced && !flowCrossed(boundaries, painted, next)) {
        position = Number.isFinite(next) ? next : position;
        return;
      }
      place(next, forced);
    } catch (error) {
      report(error);
    }
  };

  const frame = (at: number, degraded: boolean): void =>
    tickAt({at, now: position, continuous: true, epoch, degraded});

  // -------------------------------------------------------------------------
  // Building the material.
  // -------------------------------------------------------------------------

  const buildBand = (): BandNode => {
    const node = document.createElement('div');
    node.className = 'wui-harmony-flow__band';
    const fill = document.createElement('span');
    fill.className = 'wui-harmony-flow__fill';
    dress(fill, flowParts.fill);
    const role = document.createElement('span');
    role.className = 'wui-harmony-flow__role';
    role.hidden = true;
    dress(role, flowParts.role);
    const label = document.createElement('span');
    label.className = 'wui-harmony-flow__label';
    dress(label, flowParts.label);
    const note = document.createElement('span');
    note.className = 'wui-harmony-flow__note';
    note.hidden = true;
    dress(note, flowParts.note);
    const bead = document.createElement('span');
    bead.className = 'wui-harmony-flow__bead';
    bead.hidden = true;
    dress(bead, flowParts.bead);
    node.append(fill, role, label, note, bead);
    const entry = document.createElement('li');
    return {
      root: node,
      fill,
      role,
      label,
      note,
      bead,
      entry,
      css: '',
      band: {id: '', start: 0, end: 0},
    };
  };

  const laneCount = (): number => {
    let widest = state.tracks?.length ?? 0;
    for (const band of ordered) widest = Math.max(widest, Math.round(finite(band.track, 0)) + 1);
    return Math.max(1, widest);
  };

  /** A band's whole box, from its own fields and the axis. Never from `now`. */
  const boxOf = (band: FlowBand): string => {
    const box = flowBox(band, axis);
    return harmonyInline(
      inline ? flowParts.band : {},
      {
        left: `${box.left}%`,
        width: `${box.width}%`,
        // The parent lane owns its row offset. Applying track here again
        // placed later rows outside the viewport. Weight belongs to the fill.
        top: '0',
        height: '100%',
      },
      band.tone !== undefined && Number.isFinite(band.tone)
        ? {'--wui-harmony-flow-tone': progressionTone(band.tone)}
        : {},
    );
  };

  const paintBand = (node: BandNode, band: FlowBand): void => {
    node.band = band;
    // An EMPTY `spans` array is NOT the multi-span form with nothing in it. The
    // natural caller shape is `spans: motif.occurrences.map(...)`, and taking an
    // empty result literally clears the stamp off a band that has a perfectly
    // good start and end — dropping it out of `ANALYSIS_SPAN_SELECTOR` for
    // good, so it can never be lit and nothing says why.
    //
    // Decided on the SURVIVORS, not on the input length: `stampSpans` drops
    // every non-finite pair, so a list whose entries are all still unplaced —
    // one occurrence without a position yet, out of the same `map` — reaches it
    // non-empty, comes out with nothing to write, and takes the band's honest
    // `start`/`end` down with it. Same defect as the empty list, one step in.
    const usable = (band.spans ?? []).filter(
      (span) => span && Number.isFinite(span.start) && Number.isFinite(span.end),
    );
    const multi = usable.length > 0;
    const css = boxOf(band);
    // The stamp is part of the signature, not just the box: a band whose
    // stamping axis moved while its lane position did not still owes the
    // playhead a new pair of numbers. Concatenated rather than serialised —
    // this runs for every band on every snapshot, and a `JSON.stringify` over a
    // freshly allocated array of objects per band was most of what an update
    // cost on a lane with hundreds of them.
    const signature = multi
      ? `${css}|${usable.map((span) => `${span.start}:${span.end}`).join(' ')}`
      : `${css}|${finite(band.stampStart, band.start)}:${finite(band.stampEnd, band.end)}`;
    if (node.css !== signature) {
      node.css = signature;
      // Rewriting the box would drop a highlight the playhead had laid over it,
      // and the alternative is worse: an idle style that no longer matches the
      // node restores the WRONG geometry the first time the highlight ends. So
      // the box is rewritten and the highlight handed straight back. This runs
      // when the CONTENT or the zoom changed, never while the material merely
      // moves — and the order matters, because re-stamping over a lit node
      // would otherwise record the highlight itself as the idle state, which is
      // a highlight that can never be removed.
      node.root.style.cssText = css;
      if (stamping)
        stampSpans(
          node.root,
          multi
            ? usable.map((span) => ({start: span.start, end: span.end}))
            : {
                start: finite(band.stampStart, band.start),
                end: finite(band.stampEnd, band.end),
              },
        );
      // Last, and after every paint: the playhead restores exactly this string.
      stampIdleStyle(node.root);
      // …and then, if this is the band that is sounding, gets its box back. The
      // playhead lights a node ONCE and skips it while it stays lit, so without
      // this the sounding chord loses its highlight permanently — dark, and
      // still carrying the `aria-current` that says it is the one.
      restampActiveStyle(node.root);
    }
    setData(node.root, 'band', band.id);
    setData(node.root, 'track', String(Math.max(0, Math.round(finite(band.track, 0)))));
    setData(node.root, 'role', band.role);
    setData(node.root, 'group', band.group);
    setData(node.root, 'disabled', band.disabled ? 'true' : undefined);
    setData(
      node.root,
      'focus',
      band.group !== undefined && band.group === state.focusGroup ? 'true' : undefined,
    );
    if (band.role) {
      setStyleValue(node.role, 'background', toneFill(band.role));
      setHidden(node.role, false);
    } else {
      setHidden(node.role, true);
    }
    const weight = clamp(band.weight, 0.1, 1, 1);
    setStyleValue(node.fill, 'top', `${coordinate((1 - weight) * 50)}%`);
    setStyleValue(node.fill, 'bottom', 'auto');
    setStyleValue(node.fill, 'height', `${coordinate(weight * 100)}%`);
    setText(node.label, band.primary ?? '');
    const note = [band.secondary, band.trailing].filter(Boolean).join(' · ');
    setText(node.note, note);
    setAttr(node.root, 'title', [band.primary, note].filter(Boolean).join(' — ') || undefined);
    setHidden(node.note, note === '');
    if (band.severity) {
      setStyleValue(node.bead, 'background', severityFill(band.severity));
      setHidden(node.bead, false);
    } else {
      setHidden(node.bead, true);
    }
    paintGlyph(node, band);
    setText(
      node.entry,
      [band.primary, band.secondary, band.trailing].filter(Boolean).join(' — ') || band.id,
    );
  };

  /** The caller's own geometry, framed. The kit never invents a shape. */
  const paintGlyph = (node: BandNode, band: FlowBand): void => {
    const path =
      band.glyph ??
      (band.points && band.points.length > 1
        ? band.points
            .map(
              (point, at) =>
                `${at === 0 ? 'M' : 'L'}${coordinate(clamp01(point.at) * 100)} ${coordinate((1 - clamp01(point.y)) * 100)}`,
            )
            .join(' ')
        : undefined);
    if (!path) {
      node.glyph?.remove();
      node.glyph = undefined;
      return;
    }
    if (!node.glyph) {
      const surface = svg(document, 'svg', {
        viewBox: '0 0 100 100',
        preserveAspectRatio: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      });
      surface.setAttribute('class', 'wui-harmony-flow__glyph');
      dress(surface, flowParts.glyph);
      const line = svg(document, 'path', {
        fill: 'none',
        'stroke-width': 1.5,
        // The normalised axis may stretch to thousands of CSS pixels. The
        // path scales with time; its stroke must remain a legible thin line.
        'vector-effect': 'non-scaling-stroke',
      });
      line.setAttribute('class', 'wui-harmony-flow__contour');
      surface.append(line);
      node.glyph = surface;
      node.root.append(surface);
    }
    const line = node.glyph.firstElementChild as SVGPathElement | null;
    if (line) {
      setAttr(line, 'd', path);
      setAttr(line, 'stroke', band.role ? toneFill(band.role) : ACCENT);
    }
  };

  const rebuildLanes = (count: number): void => {
    const signature = JSON.stringify([count, state.tracks ?? []]);
    if (signature === laneSignature) return;
    laneSignature = signature;
    trackNodes.clear();
    const rows: HTMLElement[] = [];
    const labels: HTMLElement[] = [];
    for (let row = 0; row < count; row += 1) {
      const track = state.tracks?.[row];
      const node = document.createElement('div');
      node.className = 'wui-harmony-flow__lane';
      node.dataset.track = String(row);
      if (track) node.dataset.lane = track.id;
      dress(node, flowParts.lane);
      if (track?.muted) {
        node.dataset.muted = 'true';
        if (inline) setStyleValue(node, 'opacity', MUTED_LANE_OPACITY);
      }
      node.style.top = `calc(${RULER_HEIGHT} + ${LANE_HEIGHT} * ${row})`;
      rows.push(node);
      trackNodes.set(track?.id ?? String(row), node);
      const label = document.createElement('div');
      label.className = 'wui-harmony-flow__gutter-row';
      const text = document.createElement('span');
      text.className = 'wui-harmony-flow__gutter-label';
      text.textContent = [track?.label, track?.sublabel].filter(Boolean).join(' · ');
      dress(text, flowParts.gutterLabel);
      label.append(text);
      if (text.textContent) label.title = text.textContent;
      dress(label, flowParts.gutterRow);
      labels.push(label);
    }
    lanes.replaceChildren(...rows);
    gutter.replaceChildren(...labels);
    setHidden(gutter, !labels.some((label) => label.textContent));
    // CSS owns token lengths; no computed-style reads are needed to fit rows.
    viewport.style.minHeight = `calc(${RULER_HEIGHT} + ${LANE_HEIGHT} * ${count})`;
  };

  const rebuildDecorations = (): void => {
    const signature = JSON.stringify([
      state.ruler ?? null,
      state.flags ?? null,
      state.brackets ?? null,
      axis.start,
      axis.end,
    ]);
    if (signature === rulerSignature) return;
    rulerSignature = signature;
    const items: HTMLElement[] = [];
    for (const entry of state.ruler ?? []) {
      if (!Number.isFinite(entry?.at)) continue;
      const at = ((entry.at - axis.start) / axis.span) * 100;
      const tick = document.createElement('div');
      tick.className = 'wui-harmony-flow__tick';
      dress(tick, flowParts.tick);
      tick.style.left = `${coordinate(at)}%`;
      // `major` was written and never read on either path — a bar line and a
      // beat drawn at the same weight, which is the one thing a ruler is for.
      if (entry.major) {
        tick.dataset.major = 'true';
        if (inline) setStyleValue(tick, 'opacity', TICK_MAJOR_OPACITY);
      }
      items.push(tick);
      if (entry.label) {
        const text = document.createElement('div');
        text.className = 'wui-harmony-flow__tick-label';
        text.style.left = `${coordinate(at)}%`;
        text.textContent = entry.label;
        dress(text, flowParts.tickLabel);
        items.push(text);
      }
    }
    for (const flag of state.flags ?? []) {
      if (!flag || !Number.isFinite(flag.at)) continue;
      const node = document.createElement('div');
      node.className = 'wui-harmony-flow__flag';
      // FIRST, on the inline path, and before a single datum is written. `dress`
      // is a bulk `setProperty` of a whole part record, so anything it names
      // that this node has already computed is overwritten: `flowParts.flag`
      // carries `top: 0; bottom: 0`, which erased the row placement below and
      // drew every row-scoped flag full height across all of them. The record is
      // the FLOOR a datum stands on, never a coat of paint over the top of it.
      dress(node, flowParts.flag);
      node.style.left = `${coordinate(((flag.at - axis.start) / axis.span) * 100)}%`;
      node.style.background = severityFill(flag.severity);
      // A flag on a named row belongs to that row; one without a row is a fact
      // about the whole moment and crosses all of them.
      if (flag.track !== undefined && Number.isFinite(flag.track)) {
        const row = Math.max(0, Math.round(flag.track));
        node.style.top = `calc(${RULER_HEIGHT} + ${LANE_HEIGHT} * ${row})`;
        node.style.bottom = 'auto';
        node.style.height = LANE_HEIGHT;
        node.dataset.track = String(row);
      }
      node.dataset.flag = flag.id;
      if (flag.label) node.title = flag.label;
      items.push(node);
    }
    for (const bracket of state.brackets ?? []) {
      if (!bracket || !Number.isFinite(bracket.start)) continue;
      const box = flowBox(bracket, axis);
      const from = Math.min(finite(bracket.from, 0), finite(bracket.to, 0));
      const to = Math.max(finite(bracket.from, 0), finite(bracket.to, 0));
      const node = document.createElement('div');
      node.className = 'wui-harmony-flow__bracket';
      // Same rule as the flag above, and here it cost the one thing a bracket
      // exists to say: `flowParts.bracket` names the `border` SHORTHAND, which
      // resets `border-color` to `currentColor` — so on the inline path every
      // bracket came out the neutral line grey no matter what severity said,
      // and a parallel-fifths warning looked exactly like a phrase mark.
      dress(node, flowParts.bracket);
      node.style.left = `${box.left}%`;
      node.style.width = `${box.width}%`;
      node.style.top = `calc(${RULER_HEIGHT} + ${LANE_HEIGHT} * ${from} + ${LANE_HEIGHT} / 2)`;
      node.style.height = `calc(${LANE_HEIGHT} * ${to - from})`;
      node.style.borderColor = severityFill(bracket.severity);
      node.dataset.bracket = bracket.id;
      if (bracket.label) node.title = bracket.label;
      items.push(node);
    }
    decorations.replaceChildren(...items);
  };

  const measure = (): void => {
    // Never from the frame callback: reading a layout box per frame forces a
    // synchronous layout, which is the one cost this whole design is arranged
    // to avoid. And never from `update()` either where a `ResizeObserver` is
    // answering — that path runs at domain rate, up to ~20Hz per lane, and
    // every one of those reads was a forced layout returning the number the
    // observer had already delivered.
    laneWidth = finitePositive(viewport.clientWidth || root.clientWidth, fallbackWidth);
  };

  const update = (): void => {
    if (destroyed) return;
    try {
      state = binding.snapshot();
      ordered = (state.bands ?? []).filter(
        (band): band is FlowBand =>
          Boolean(band) && Number.isFinite(band.start) && Number.isFinite(band.end),
      );
      axis = flowAxis(state.span, ordered);
      boundaries = flowBoundaries(ordered);
      primaryTrack = Number.isFinite(state.primaryTrack)
        ? Math.max(0, Math.round(state.primaryTrack as number))
        : ordered.length === 0
          ? 0
          : Math.min(...ordered.map(trackOf));
      if (!resizeObserver) measure();
      rebuildLanes(laneCount());
      rebuildDecorations();

      const seen = new Set<string>();
      const entries: HTMLLIElement[] = [];
      let structural = false;
      for (const band of ordered) {
        if (seen.has(band.id)) continue;
        seen.add(band.id);
        let node = bands.get(band.id);
        if (!node) {
          node = buildBand();
          bands.set(band.id, node);
          structural = true;
        }
        paintBand(node, band);
        const lane = lanes.children[Math.max(0, Math.round(finite(band.track, 0)))] ?? lanes;
        if (node.root.parentNode !== lane) lane.append(node.root);
        entries.push(node.entry);
      }
      for (const [id, node] of [...bands]) {
        // Removed because the DATA no longer has it — never because it scrolled
        // out of view. A band culled by position is a silently dead highlight.
        if (seen.has(id)) continue;
        bands.delete(id);
        node.root.remove();
        node.entry.remove();
        structural = true;
      }
      if (structural || entries.length !== index.childElementCount)
        index.replaceChildren(...entries);

      reel.style.width = `${coordinate(axis.span * pxPerUnit())}px`;
      const nowAt = `${coordinate(anchor * 100)}%`;
      if (nowLine.style.left !== nowAt) nowLine.style.left = nowAt;
      if (future.style.left !== nowAt) future.style.left = nowAt;
      setHidden(future, state.future !== false);
      setData(root, 'playing', state.playing ? 'true' : undefined);
      setData(root, 'disabled', state.disabled ? 'true' : undefined);
      setData(viewport, 'lanes', String(laneCount()));
      // Only where the viewport is actually a slider. A range on a node with no
      // role is a promise to a reader that nothing keeps.
      if (binding.seek) {
        setAttr(viewport, 'aria-valuemin', coordinate(axis.start));
        setAttr(viewport, 'aria-valuemax', coordinate(axis.end));
        setAttr(viewport, 'aria-disabled', state.disabled ? 'true' : undefined);
      }

      const message = state.emptyLabel ?? '';
      const showEmpty = ordered.length === 0 && message !== '';
      setText(empty, showEmpty ? message : '');
      setHidden(empty, !showEmpty);

      setLabel(
        root,
        options.label ??
          describe(
            'Flow lane',
            ordered
              .slice(0, 4)
              .map((band) => band.primary)
              .filter((label): label is string => Boolean(label)),
          ),
      );
      // `state.now` seeds the FIRST placement and nothing after it: once a
      // frame has answered, the caller's own position is the authority and a
      // domain update must not drag the material back to where the last
      // snapshot happened to say it was.
      place(
        binding.position && Number.isFinite(painted) ? position : finite(state.now, axis.start),
        true,
      );
    } catch (error) {
      report(error);
    }
  };

  // -------------------------------------------------------------------------
  // Pointer, wheel and keyboard. The lane takes a callback; turning it into an
  // event is the element's job, because the event's shape is domain vocabulary.
  // -------------------------------------------------------------------------

  const emit = (next: number, phase: 'drag' | 'commit'): void => {
    if (!binding.seek || state.disabled) return;
    const clamped = Math.max(axis.start, Math.min(axis.end, next));
    place(clamped, false);
    announce();
    try {
      void Promise.resolve(binding.seek(clamped, phase)).catch(report);
    } catch (error) {
      report(error);
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!binding.seek || state.disabled || event.button !== 0) return;
    const bounds = viewport.getBoundingClientRect?.();
    drag = {
      pointerId: event.pointerId,
      left: event.clientX,
      at: 0,
      moved: false,
    };
    if (bounds && bounds.width > 0) laneWidth = bounds.width;
    viewport.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = event.clientX - drag.left;
    if (Math.abs(delta) < 2 && !drag.moved) return;
    drag.moved = true;
    // Dragging moves the MATERIAL, so a drag to the right walks backwards.
    const next = position - delta / pxPerUnit();
    drag.left = event.clientX;
    const at = clockNow();
    // A seek pauses and restarts the transport, so a drag that emitted on every
    // pointer move would restart it forty times a second.
    if (at - drag.at < DRAG_INTERVAL_MS) {
      place(Math.max(axis.start, Math.min(axis.end, next)), false);
      return;
    }
    drag.at = at;
    emit(next, 'drag');
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    viewport.releasePointerCapture?.(drag.pointerId);
    drag = undefined;
    if (moved) emit(position, 'commit');
  };

  const onClick = (event: MouseEvent): void => {
    const target = (event.target as Element | null)?.closest?.('.wui-harmony-flow__band');
    const id = (target as HTMLElement | null)?.dataset?.band;
    const node = id ? bands.get(id) : undefined;
    if (!node) return;
    if (binding.selectBand) {
      try {
        void Promise.resolve(
          binding.selectBand(node.band.id, node.band, {
            additive: event.shiftKey || event.metaKey || event.ctrlKey,
          }),
        ).catch(report);
      } catch (error) {
        report(error);
      }
    }
    if (binding.seek) emit(node.band.start, 'commit');
  };

  const onWheel = (event: WheelEvent): void => {
    if (state.disabled) return;
    if (event.ctrlKey || event.metaKey) {
      const next = clamp(zoom * Math.exp(-event.deltaY / 300), MIN_ZOOM, MAX_ZOOM, zoom);
      if (next === zoom) return;
      zoom = next;
      event.preventDefault();
      reel.style.width = `${coordinate(axis.span * pxPerUnit())}px`;
      place(position, true);
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
    if (delta === 0 || !binding.seek) return;
    event.preventDefault();
    emit(position + delta / pxPerUnit(), 'drag');
    if (wheelTimer !== undefined) clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      wheelTimer = undefined;
      emit(position, 'commit');
    }, WHEEL_SETTLE_MS);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!binding.seek || state.disabled) return;
    const step = event.shiftKey ? keyboardPage : keyboardStep;
    let next: number | undefined;
    if (event.key === 'ArrowRight') next = position + step;
    else if (event.key === 'ArrowLeft') next = position - step;
    else if (event.key === 'Home') next = axis.start;
    else if (event.key === 'End') next = axis.end;
    else if (event.key === ']') next = flowBoundaryFrom(boundaries, position, 1);
    else if (event.key === '[') next = flowBoundaryFrom(boundaries, position, -1);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      // The accessibility the shared axis gives away: "what numeral is under
      // this chord" is one key press, because the rows are one reel.
      const current = bandAt(position);
      const row = Math.round(finite(current?.track, 0)) + (event.key === 'ArrowDown' ? 1 : -1);
      const neighbour = ordered
        .filter((band) => Math.round(finite(band.track, 0)) === row)
        .sort((a, b) => Math.abs(a.start - position) - Math.abs(b.start - position))[0];
      if (neighbour) {
        binding.focusBand?.(neighbour.id);
        event.preventDefault();
      }
      return;
    }
    if (next === undefined) return;
    event.preventDefault();
    emit(next, 'commit');
  };

  if (binding.seek) {
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'slider');
    viewport.setAttribute('aria-orientation', 'horizontal');
    setLabel(viewport, options.label ?? 'Position');
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    viewport.addEventListener('keydown', onKeyDown);
  }
  viewport.addEventListener('click', onClick);
  viewport.addEventListener('wheel', onWheel, {passive: false});
  // Belt and braces beside `overflow: clip`: if anything ever does scroll this
  // box, the anchor is wrong by exactly that much until it is put back. Reading
  // `scrollLeft` costs a layout, so it is read only when a scroll actually
  // happened rather than once a frame.
  viewport.addEventListener('scroll', () => {
    if (viewport.scrollLeft !== 0) viewport.scrollLeft = 0;
    if (viewport.scrollTop !== 0) viewport.scrollTop = 0;
  });

  // -------------------------------------------------------------------------
  // The clock.
  // -------------------------------------------------------------------------

  const animate = options.clock ? false : (options.animate ?? binding.position !== undefined);

  // A stepped lane joins the loop TOO. Refusing it looks like the reduced-motion
  // saving and is the opposite: `tickAt` is the only caller of `readPosition`,
  // so a lane with no loop never samples the caller's clock, `update()` re-places
  // from the cached `position` on purpose, and the reel parks at its mount-time
  // seed while the playhead walks the highlight off the right-hand edge and the
  // pinned read-out goes on naming bar one. `motion: 'auto'` — the default —
  // resolves to `stepped` on its own under `prefers-reduced-motion: reduce`, so
  // that was every reduced-motion reader of the shipped demo. The saving is real
  // and it is taken one level down instead: the short-circuit in `tickAt` returns
  // after one `binding.position()` and one bisection, writing nothing to the DOM
  // until the sounding band actually changes. Frame RATE, event COST.
  const joinLoop = (): void => {
    if (destroyed || leaveLoop || !animate) return;
    leaveLoop = joinFrameLoop(view, frame);
  };

  const partLoop = (): void => {
    leaveLoop?.();
    leaveLoop = undefined;
  };

  const handle: FlowLaneHandle = {
    element: root,
    viewport,
    reel,
    nowLine,
    index,
    track(id: string): HTMLElement | undefined {
      return trackNodes.get(id);
    },
    band(id: string): HTMLElement | undefined {
      return bands.get(id)?.root;
    },
    tick(): void {
      tickAt({at: clockNow(), now: position, continuous: false, epoch});
    },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      partLoop();
      pulse?.cancel();
      if (wheelTimer !== undefined) clearTimeout(wheelTimer);
      // A mount torn down mid-drag never reached `onPointerUp`, so the capture
      // it took stayed with a node that is about to leave the document — and the
      // pointer stays captured by a detached element until the browser notices.
      if (drag) {
        try {
          viewport.releasePointerCapture?.(drag.pointerId);
        } catch {
          // Already released, or the pointer is long gone. Either is fine; a
          // teardown does not get to fail over a cursor.
        }
        drag = undefined;
      }
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      claim.release();
      root.remove();
      style?.remove();
    },
  };

  const claim = claimHost(mountedFlowLanes, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    root.remove();
    style?.remove();
    return handle;
  }

  const ResizeObserverClass = view?.ResizeObserver;
  if (ResizeObserverClass) {
    try {
      resizeObserver = new ResizeObserverClass(() => {
        if (destroyed) return;
        measure();
        reel.style.width = `${coordinate(axis.span * pxPerUnit())}px`;
        place(position, true);
      });
      resizeObserver.observe(viewport);
    } catch (error) {
      // Not merely reported: `update()` skips its own measurement wherever an
      // observer is answering, so an observer that exists and is not observing
      // would leave the lane on its fallback width for life.
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      report(error);
    }
  }

  const IntersectionObserverClass = view?.IntersectionObserver;
  if (IntersectionObserverClass) {
    try {
      // A lane nobody can see does not run. Rejoining catches up in one frame
      // because the position is a pure function of the instant, not an
      // accumulation of the frames that were missed.
      intersectionObserver = new IntersectionObserverClass((entries) => {
        if (destroyed) return;
        const visible = entries[entries.length - 1]?.isIntersecting ?? true;
        if (visible) {
          joinLoop();
          handle.tick();
        } else partLoop();
      });
      intersectionObserver.observe(root);
    } catch (error) {
      report(error);
    }
  }

  measure();
  update();
  joinLoop();
  if (options.clock) {
    try {
      unsubscribe = options.clock.subscribe(tickAt);
    } catch (error) {
      report(error);
    }
  }
  if (binding.subscribe) {
    const chained = unsubscribe;
    try {
      // Called ON the binding, never through a local alias. A binding whose
      // `subscribe` is a method — the ordinary shape when the caller is a class
      // — loses its receiver the moment the function is lifted off the object,
      // and the `TypeError` that follows is swallowed by the `catch` below and
      // routed to `onError`. The lane then shows its first snapshot forever,
      // with no symptom a caller could see. The other three mounts already call
      // it this way; this one is the odd file out.
      const stop = binding.subscribe(update);
      unsubscribe = (): void => {
        chained?.();
        stop();
      };
    } catch (error) {
      report(error);
    }
  }
  return handle;
}

// ---------------------------------------------------------------------------
// The nameplate.
// ---------------------------------------------------------------------------

export interface ChordNameCandidate {
  /** The caller's spelling. The kit never names anything. */
  symbol: string;
  /** The spoken form, e.g. 'C major seventh'. Announced instead of the symbol. */
  full?: string;
  /** How this reading differs — 'inversion', 'rootless', 'enharmonic'. */
  note?: string;
  weight?: number;
  /**
   * The opaque identity of this naming. A change pops, even when `symbol` is
   * byte-identical — which is how "C, G, C" and "the same chord struck again"
   * are told apart. The kit only ever compares it with `!==`; it does not know
   * it is comparing chords.
   */
  key?: string;
}

export interface NameplateState {
  primary?: ChordNameCandidate;
  alternates?: readonly ChordNameCandidate[];
  voicing?: readonly HarmonyVoice[];
  caption?: string;
  history?: readonly string[];
  confidence?: number;
  emphasis?: 'hero' | 'display';
  emptyLabel?: string;
  /** The naming that is coming. Drawn as a ghost; never announced. */
  next?: ChordNameCandidate;
}

export interface NameplateBinding {
  snapshot(): NameplateState;
  subscribe?(notify: () => void): () => void;
  /** A reading was chosen. Omit it and the alternates render as plain text. */
  selectAlternate?(index: number, candidate: ChordNameCandidate): Promise<void> | void;
  /**
   * How near `next` is, 0…1. Pulled once per frame. Nearness is domain
   * knowledge — it depends on the rate, the metre, and on what the caller
   * thinks near means — so it is a number the caller returns rather than one
   * the kit infers from a lane it cannot see.
   */
  approach?(tick: FrameTick): number | undefined;
}

export interface NameplateClassNames {
  root?: string;
  symbol?: string;
}

export interface NameplateParts {
  root?: string;
  symbol?: string;
}

export interface NameplateOptions {
  /** Outer surface, or no frame/background when a containing presenter owns it. Defaults to 'default'. */
  surface?: 'default' | 'none';
  label?: string;
  motion?: MotionMode;
  /** The pop, in ms. Defaults to 180, and to 0 in a reduced motion mode. */
  popDuration?: number;
  /** Run a frame loop. Defaults to whether `binding.approach` exists; a `clock` forces it false. */
  animate?: boolean;
  clock?: FrameClock;
  classNames?: NameplateClassNames;
  parts?: NameplateParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface NameplateHandle {
  element: HTMLElement;
  /** The primary symbol's node. Its identity survives every `update()`. */
  readonly symbol: HTMLElement;
  /** Pop for a reason the kit cannot see — a reading the reader chose, say. */
  pop(intent?: 'change' | 'stress'): void;
  /** Re-read the approach only. */
  tick(): void;
  update(): void;
  destroy(): void;
}

const mountedNameplates = new WeakMap<HarmonyHost, NameplateHandle>();

/** Mount the one line the reader is actually reading. */
export function mountNameplate(
  host: HarmonyHost,
  binding: NameplateBinding,
  options: NameplateOptions = {},
): NameplateHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const style = installStyle(document, 'harmony', harmonyPresenterStyle, options.stylesheet);
  const dress = dressing(options.stylesheet);
  const inline = options.stylesheet === false;
  const motion = resolveMotion(host, options.motion, view);
  const stepped = motion !== 'continuous';
  const popMs = stepped ? 0 : Math.max(0, options.popDuration ?? DEFAULT_POP_MS);

  const root = document.createElement('div');
  root.className = 'wui-harmony-nameplate';
  root.setAttribute('role', 'group');
  root.dataset.motion = motion;
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  dress(root, nameplateParts.root);
  if (options.surface === 'none') paint(root, embeddedSurfaceDeclarations);
  dressMotion(root, stepped);

  const caption = document.createElement('div');
  caption.className = 'wui-harmony-nameplate__caption';
  caption.hidden = true;
  dress(caption, nameplateParts.caption);

  // ONE live region, and the symbol lives inside it for its whole life. A
  // replaced node inside `aria-live` is a change the reader never hears, which
  // is why `update()` writes `textContent` and never rebuilds this pair.
  const live = document.createElement('div');
  live.className = 'wui-harmony-nameplate__live';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  dress(live, nameplateParts.live);

  const symbol = document.createElement('div');
  symbol.className = 'wui-harmony-nameplate__symbol';
  addClassNames(symbol, options.classNames?.symbol);
  setParts(symbol, 'symbol', options.parts?.symbol);
  dress(symbol, nameplateParts.symbol);

  const full = document.createElement('span');
  full.className = 'wui-harmony-nameplate__full';
  dress(full, nameplateParts.full);
  live.append(symbol, full);

  const next = document.createElement('div');
  next.className = 'wui-harmony-nameplate__next';
  next.setAttribute('aria-hidden', 'true');
  next.hidden = true;
  dress(next, nameplateParts.next);

  const voicing = document.createElement('div');
  voicing.className = 'wui-harmony-nameplate__voicing';
  voicing.hidden = true;
  dress(voicing, nameplateParts.voicing);

  const alternates = document.createElement('ul');
  alternates.className = 'wui-harmony-nameplate__alternates';
  alternates.hidden = true;
  dress(alternates, nameplateParts.alternates);

  // Out of the live region on purpose: a history that announced itself would
  // read every chord twice, once as the nameplate and once as its own echo.
  const history = document.createElement('div');
  history.className = 'wui-harmony-nameplate__history';
  history.setAttribute('aria-hidden', 'true');
  dress(history, nameplateParts.history);

  const empty = document.createElement('p');
  empty.className = 'wui-harmony-nameplate__empty';
  empty.hidden = true;
  markEmptyState(empty);
  dress(empty, nameplateParts.empty);

  root.append(caption, live, next, voicing, alternates, history, empty);

  let shown: string | undefined;
  /**
   * What the two rebuilt lists last rendered.
   *
   * Both are `replaceChildren`, and an unconditional one destroys and re-creates
   * every alternate `<button>`: a keyboard user holding focus on a naming
   * candidate lost it — to `<body>` — on any `update()` at all, a byte-identical
   * snapshot included. A chord change is exactly the moment a reader is deciding
   * between those readings, so it is exactly the moment focus may not be taken
   * away. Guarded the same way a band's box is.
   */
  let readingSignature = '';
  let historySignature = '';
  let state: NameplateState = {};
  let animation: Animation | undefined;
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let leaveLoop: (() => void) | undefined;
  const report = createErrorSink(options.onError);
  const clockNow = (): number => view?.performance?.now?.() ?? Date.now();

  /**
   * The pop, through the Web Animations API, by elimination: replacing the node
   * is barred by the live region; toggling a class does not restart an
   * animation that has already run on the same node without a reflow trick; and
   * `@keyframes` cannot reach a host that opted out of the stylesheet. WAAPI
   * passes all three, and each call returns a fresh animation, so re-triggering
   * is free.
   *
   * Opacity only. The symbol is the one line the reader is actually reading,
   * and a word that jumps or scales while being read cannot be read.
   */
  const pop = (intent: 'change' | 'stress' = 'change'): void => {
    if (destroyed || popMs <= 0) return;
    // Feature-detected, not assumed: jsdom has no `Element.prototype.animate`
    // at all, and a read-out that threw on its first chord in a test
    // environment would be a read-out nobody could test.
    const run = (symbol as {animate?: HTMLElement['animate']}).animate;
    if (typeof run !== 'function') return;
    try {
      animation?.cancel();
      animation = run.call(
        symbol,
        intent === 'stress'
          ? [{opacity: 1}, {opacity: 0.45}, {opacity: 1}]
          : [{opacity: 0}, {opacity: 1}],
        {duration: popMs, easing: 'ease-out'},
      );
    } catch (error) {
      report(error);
    }
  };

  const applyApproach = (value: number | undefined): void => {
    setStyleValue(
      root,
      '--wui-harmony-approach',
      value === undefined ? undefined : String(clamp01(value)),
    );
  };

  const tickAt = (tick: FrameTick): void => {
    if (destroyed) return;
    try {
      applyApproach(binding.approach?.(tick));
    } catch (error) {
      report(error);
    }
  };

  const update = (): void => {
    if (destroyed) return;
    try {
      state = binding.snapshot();
      const primary = state.primary;
      const identity = primary ? (primary.key ?? primary.symbol) : undefined;
      setText(symbol, primary?.symbol ?? '');
      setHidden(symbol, !primary);
      setText(full, primary?.full ?? '');
      setHidden(full, !primary?.full);
      // With a spoken form present the symbol is hidden from the reader, so the
      // pair is announced once rather than as an abbreviation and its expansion.
      setAttr(symbol, 'aria-hidden', primary?.full ? 'true' : undefined);
      if (identity !== shown) {
        shown = identity;
        if (identity !== undefined) pop('change');
      }

      setText(caption, state.caption ?? '');
      setHidden(caption, !state.caption);
      setText(next, state.next?.symbol ?? '');
      setHidden(next, !state.next);
      setData(root, 'emphasis', state.emphasis);
      // The one option that says "this read-out is standing alone on a stage",
      // and on the inline path it did nothing: `data-emphasis` was written, the
      // rule that reads it lives only in the sheet, and `live-chord` — the view
      // the `hero` size was added for — pins its nameplate on the now line.
      if (inline)
        setStyleValue(
          symbol,
          'font-size',
          state.emphasis === 'hero' ? `calc(${SIZE_DISPLAY} * 1.35)` : undefined,
        );
      setData(
        root,
        'confidence',
        Number.isFinite(state.confidence) ? String(clamp01(state.confidence)) : undefined,
      );

      const voices = state.voicing ?? [];
      setText(
        voicing,
        voices
          .map((voice) => voice.label ?? voice.mark ?? (voice.role ? toneMark(voice.role) : ''))
          .filter(Boolean)
          .join('  '),
      );
      setHidden(voicing, voices.length === 0);

      const readings = state.alternates ?? [];
      // `key` and `weight` belong in the signature even though neither is drawn.
      // The guard exists to keep a focused `<button>` alive across a chord
      // change, and every button closes over the candidate object it was built
      // from — so any field the guard omits is a field `selectAlternate` can be
      // handed a stale copy of. `key` is documented as "the opaque identity of
      // this naming", which makes it precisely the field a caller looks at.
      const readingKey = JSON.stringify([
        binding.selectAlternate !== undefined,
        readings.map((candidate) => [
          candidate.symbol,
          candidate.note ?? null,
          candidate.key ?? null,
          candidate.weight ?? null,
        ]),
      ]);
      const items: HTMLLIElement[] = [];
      if (readingKey !== readingSignature)
        readings.forEach((candidate, at) => {
          const item = document.createElement('li');
          dress(item, nameplateParts.alternateItem);
          // A real button only where there is something to press. A focusable
          // node with no behaviour is a trap, not an affordance.
          if (binding.selectAlternate) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'wui-harmony-nameplate__alternate';
            button.textContent = candidate.note
              ? `${candidate.symbol} (${candidate.note})`
              : candidate.symbol;
            dress(button, nameplateParts.alternate, nameplateParts.alternateButton);
            button.addEventListener('click', () => {
              try {
                void Promise.resolve(binding.selectAlternate!(at, candidate)).catch(report);
              } catch (error) {
                report(error);
              }
              pop('stress');
            });
            item.append(button);
          } else {
            // The class as well as the record. Without it the inert reading was
            // the only alternate on the page with no sheet rule to land on — a
            // bare run of text next to a row of bordered chips, on exactly the
            // path a host that installed the sheet is using.
            item.className = 'wui-harmony-nameplate__alternate';
            item.textContent = candidate.note
              ? `${candidate.symbol} (${candidate.note})`
              : candidate.symbol;
            dress(item, nameplateParts.alternate);
          }
          items.push(item);
        });
      if (readingKey !== readingSignature) {
        readingSignature = readingKey;
        alternates.replaceChildren(...items);
      }
      setHidden(alternates, readings.length === 0);

      const historyKey = JSON.stringify([state.history ?? [], primary?.symbol ?? null]);
      if (historyKey !== historySignature) {
        historySignature = historyKey;
        history.replaceChildren(
          ...(state.history ?? []).map((label) => {
            const chip = document.createElement('span');
            chip.className = 'wui-harmony-nameplate__chip';
            chip.textContent = label;
            if (label === primary?.symbol) chip.dataset.current = 'true';
            dress(
              chip,
              harmonyParts.historyChip,
              label === primary?.symbol ? harmonyParts.historyChipActive : {},
            );
            return chip;
          }),
        );
      }

      setHidden(history, !state.history?.length);

      const message = state.emptyLabel ?? '';
      const showEmpty = !primary && message !== '';
      setText(empty, showEmpty ? message : '');
      setHidden(empty, !showEmpty);
      setLabel(
        root,
        options.label ?? describe('Chord', primary ? [primary.full ?? primary.symbol] : []),
      );
    } catch (error) {
      report(error);
    }
  };

  const handle: NameplateHandle = {
    element: root,
    symbol,
    pop,
    tick(): void {
      tickAt({at: clockNow(), now: 0, continuous: false});
    },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      leaveLoop?.();
      leaveLoop = undefined;
      animation?.cancel();
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      claim.release();
      root.remove();
      style?.remove();
    },
  };

  const claim = claimHost(mountedNameplates, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    root.remove();
    style?.remove();
    return handle;
  }

  update();
  const animate = options.clock ? false : (options.animate ?? binding.approach !== undefined);
  if (animate && !stepped) {
    leaveLoop = joinFrameLoop(view, (at, degraded) =>
      tickAt({at, now: 0, continuous: true, degraded}),
    );
  }
  if (options.clock) {
    try {
      unsubscribe = options.clock.subscribe(tickAt);
    } catch (error) {
      report(error);
    }
  }
  if (binding.subscribe) {
    const chained = unsubscribe;
    try {
      const stop = binding.subscribe(update);
      unsubscribe = (): void => {
        chained?.();
        stop();
      };
    } catch (error) {
      report(error);
    }
  }
  return handle;
}

// ---------------------------------------------------------------------------
// The chip strip.
//
// It survives the conveyor, and the reason is a rule rather than nostalgia: a
// ranked list has no time axis, and something with no time axis must not
// pretend to be performing. Making this a degenerate mode of the lane would
// hide a frame loop, a free list and pointer capture inside a static `<ol>` —
// a second implementation inside the first.
// ---------------------------------------------------------------------------

export interface ChipItem {
  id: string;
  /** Domain-neutral position. The strip only compares and stamps these. */
  start: number;
  end: number;
  primary: string;
  secondary?: string;
  roman?: string;
  trailing?: string;
  /** 0…1 — the bar. */
  meter?: number;
  /** 0…1 — the whole-piece answer, drawn as an outline behind the bar. */
  meterGhost?: number;
  occurrences?: readonly number[];
  spans?: readonly {start: number; end: number}[];
  tone?: number;
  severity?: Severity;
}

export interface ChipStripState {
  items: readonly ChipItem[];
  /**
   * How the chips are laid out. All three are ORDER, not time: a strip has no
   * time axis, which is precisely why it is not a lane. A read-out that wants a
   * ruler and a position wants `mountFlowLane`, and the two are kept apart so
   * that neither has to pretend to be the other.
   */
  layout?: 'flow' | 'ribbon' | 'stack';
  emptyLabel?: string;
}

export interface ChipStripBinding {
  snapshot(): ChipStripState;
  subscribe?(notify: () => void): () => void;
  selectItem?(id: string, item: ChipItem): Promise<void> | void;
}

export interface ChipStripClassNames {
  root?: string;
  list?: string;
}

export interface ChipStripParts {
  root?: string;
  list?: string;
}

export interface ChipStripOptions {
  /** Outer surface, or no frame/background when a containing presenter owns it. Defaults to 'default'. */
  surface?: 'default' | 'none';
  label?: string;
  /** Write the span contract onto each chip. Defaults to true. */
  spans?: boolean;
  classNames?: ChipStripClassNames;
  parts?: ChipStripParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface ChipStripHandle {
  element: HTMLElement;
  readonly list: HTMLOListElement;
  item(id: string): HTMLElement | undefined;
  update(): void;
  destroy(): void;
}

const mountedChipStrips = new WeakMap<HarmonyHost, ChipStripHandle>();

/** Mount a ranked or atemporal read-out: candidates, bins, a compatibility card. */
export function mountChipStrip(
  host: HarmonyHost,
  binding: ChipStripBinding,
  options: ChipStripOptions = {},
): ChipStripHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, 'harmony', harmonyPresenterStyle, options.stylesheet);
  const dress = dressing(options.stylesheet);
  const inline = options.stylesheet === false;
  const stamping = options.spans !== false;

  const root = document.createElement('div');
  root.className = 'wui-harmony-chip';
  root.setAttribute('role', 'group');
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  dress(root, chipParts.root);
  if (options.surface === 'none') paint(root, embeddedSurfaceDeclarations);

  const list = document.createElement('ol');
  list.className = 'wui-harmony-chip__list';
  addClassNames(list, options.classNames?.list);
  setParts(list, 'list', options.parts?.list);
  dress(list, chipParts.list);
  root.append(list);

  const empty = document.createElement('p');
  empty.className = 'wui-harmony-chip__empty';
  empty.hidden = true;
  markEmptyState(empty);
  dress(empty, chipParts.empty);
  root.append(empty);

  const items = new Map<string, HTMLLIElement>();
  /**
   * The box each chip was last painted with, so a chip whose text changed is
   * not re-boxed. Keyed by the node so it needs no cleanup: a chip the data
   * dropped takes its entry with it.
   */
  const boxes = new WeakMap<HTMLLIElement, string>();
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  const report = createErrorSink(options.onError);

  const update = (): void => {
    if (destroyed) return;
    try {
      const state = binding.snapshot();
      const layout = state.layout ?? 'flow';
      setData(list, 'layout', layout);
      if (inline) {
        paint(list, chipParts.list, chipParts[layout]);
      }
      const rows = (state.items ?? []).filter((item): item is ChipItem => Boolean(item?.id));
      const ordered: HTMLLIElement[] = [];
      const seen = new Set<string>();
      for (const item of rows) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        let node = items.get(item.id);
        if (!node) {
          node = document.createElement('li');
          items.set(item.id, node);
        }
        paintChip(node, item, layout);
        ordered.push(node);
      }
      for (const [id, node] of [...items]) {
        if (seen.has(id)) continue;
        items.delete(id);
        node.remove();
      }
      list.replaceChildren(...ordered);

      const message = state.emptyLabel ?? '';
      const showEmpty = ordered.length === 0 && message !== '';
      setText(empty, showEmpty ? message : '');
      setHidden(empty, !showEmpty);
      setLabel(
        root,
        options.label ??
          describe(
            'Read-out',
            rows.slice(0, 4).map((item) => item.primary),
          ),
      );
    } catch (error) {
      report(error);
    }
  };

  const paintChip = (node: HTMLLIElement, item: ChipItem, layout: string): void => {
    node.className = 'wui-harmony-chip__item';
    node.dataset.chip = item.id;
    const css = harmonyInline(
      inline ? chipParts.item : {},
      inline && layout === 'stack' ? chipParts.row : {},
      inline && binding.selectItem ? {cursor: 'pointer'} : {},
      item.tone !== undefined && Number.isFinite(item.tone)
        ? {
            '--wui-harmony-flow-tone': progressionTone(item.tone),
            'border-color': progressionTone(item.tone),
          }
        : {},
    );
    // An empty array is a caller whose own `map` came back empty, not a request
    // to un-stamp a chip that has a start and an end — and a list of pairs that
    // `stampSpans` will drop for being non-finite is the same thing said less
    // obviously. Decided on the survivors, exactly as in `paintBand`.
    const usable = (item.spans ?? []).filter(
      (span) => span && Number.isFinite(span.start) && Number.isFinite(span.end),
    );
    const multi = usable.length > 0;
    const signature = multi
      ? `${css}|${usable.map((span) => `${span.start}:${span.end}`).join(' ')}`
      : `${css}|${item.start}:${item.end}`;
    // Guarded against the LAST BOX, never against `style.cssText`. While the
    // playhead has a chip lit, `cssText` carries the highlight, so a comparison
    // against it is always unequal — and every snapshot update therefore reset
    // the sounding chip to its idle box, which the playhead then declined to
    // repaint because the chip had never left its active set. A dark chip
    // carrying `aria-current="true"`, on every chord change.
    if (boxes.get(node) !== signature) {
      boxes.set(node, signature);
      node.style.cssText = css;
      if (stamping) {
        stampSpans(
          node,
          multi
            ? usable.map((span) => ({start: span.start, end: span.end}))
            : {start: item.start, end: item.end},
        );
        // Last, and after every paint: the playhead restores exactly this
        // string — and takes its highlight back if this chip is lit.
        stampIdleStyle(node);
        restampActiveStyle(node);
      }
    }

    const children: HTMLElement[] = [];
    if (item.severity) {
      const bead = document.createElement('span');
      bead.className = 'wui-harmony-chip__bead';
      bead.style.background = severityFill(item.severity);
      dress(bead, chipParts.bead);
      children.push(bead);
    }
    const primary = document.createElement('span');
    primary.className = 'wui-harmony-chip__primary';
    primary.textContent = item.roman ?? item.primary;
    dress(primary, chipParts.primary);
    children.push(primary);
    if (item.secondary ?? item.roman) {
      const secondary = document.createElement('span');
      secondary.className = 'wui-harmony-chip__secondary';
      secondary.textContent = item.roman ? item.primary : (item.secondary ?? '');
      dress(secondary, chipParts.secondary);
      children.push(secondary);
    }
    if (item.meter !== undefined || item.meterGhost !== undefined) {
      const meter = document.createElement('span');
      meter.className = 'wui-harmony-chip__meter';
      dress(meter, chipParts.meter);
      if (item.meterGhost !== undefined) {
        const ghost = document.createElement('span');
        ghost.className = 'wui-harmony-chip__ghost';
        ghost.style.width = `${coordinate(clamp01(item.meterGhost) * 100)}%`;
        dress(ghost, chipParts.ghost);
        meter.append(ghost);
      }
      const fill = document.createElement('span');
      fill.className = 'wui-harmony-chip__fill';
      fill.style.width = `${coordinate(clamp01(item.meter ?? 0) * 100)}%`;
      dress(fill, chipParts.fill);
      meter.append(fill);
      children.push(meter);
    }
    if (item.trailing !== undefined || item.occurrences?.length) {
      const trailing = document.createElement('span');
      trailing.className = 'wui-harmony-chip__trailing';
      trailing.textContent = item.trailing ?? `x${item.occurrences?.length ?? 0}`;
      dress(trailing, chipParts.trailing);
      children.push(trailing);
    }
    node.replaceChildren(...children);
    if (binding.selectItem) {
      node.dataset.selectable = 'true';
    }
  };

  const onClick = (event: MouseEvent): void => {
    if (!binding.selectItem) return;
    const target = (event.target as Element | null)?.closest?.('.wui-harmony-chip__item');
    const id = (target as HTMLElement | null)?.dataset?.chip;
    if (!id || !items.has(id)) return;
    try {
      const snapshot = binding.snapshot().items.find((entry) => entry.id === id);
      if (snapshot) void Promise.resolve(binding.selectItem(id, snapshot)).catch(report);
    } catch (error) {
      report(error);
    }
  };
  list.addEventListener('click', onClick);

  const handle: ChipStripHandle = {
    element: root,
    list,
    item(id: string): HTMLElement | undefined {
      return items.get(id);
    },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      claim.release();
      root.remove();
      style?.remove();
    },
  };

  const claim = claimHost(mountedChipStrips, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    root.remove();
    style?.remove();
    return handle;
  }

  update();
  if (binding.subscribe) {
    try {
      unsubscribe = binding.subscribe(update);
    } catch (error) {
      report(error);
    }
  }
  return handle;
}

// ---------------------------------------------------------------------------
// The wheel.
// ---------------------------------------------------------------------------

export interface WheelSegment {
  id: string;
  label: string;
  weight?: number;
  active?: boolean;
}

export interface WheelState {
  /** The outer ring, drawn clockwise IN THE ORDER GIVEN. The order is the caller's answer. */
  outer: readonly WheelSegment[];
  inner?: readonly WheelSegment[];
  centre?: {primary: string; secondary?: string};
  /**
   * The needle. `at` is a segment id or a fractional index — 2.5 is halfway
   * between the third and fourth segments. The kit turns that into an angle,
   * and the caller never writes a number of degrees.
   */
  needle?: {
    at: string | number;
    ring?: 'outer' | 'inner';
    /**
     * The needle's width, in segments. 0 is a hair; wider is the only honest
     * way to draw a conclusion held at 40% confidence — an unsure answer should
     * LOOK unsure rather than point precisely at a guess.
     */
    spread?: number;
    label?: string;
  };
  /** Recent needle positions, oldest first: a comet's tail. */
  trail?: readonly {at: string | number; weight?: number}[];
  emptyLabel?: string;
}

export interface WheelBinding {
  snapshot(): WheelState;
  subscribe?(notify: () => void): () => void;
  selectSegment?(id: string, segment: WheelSegment): Promise<void> | void;
}

export interface WheelClassNames {
  root?: string;
  svg?: string;
}

export interface WheelParts {
  root?: string;
  svg?: string;
}

export interface WheelOptions {
  /** Outer surface, or no frame/background when a containing presenter owns it. Defaults to 'default'. */
  surface?: 'default' | 'none';
  label?: string;
  motion?: MotionMode;
  /** Segments drawn when the caller has nothing to show yet. Defaults to 12. */
  placeholderSegments?: number;
  classNames?: WheelClassNames;
  parts?: WheelParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface WheelHandle {
  element: HTMLElement;
  svg: SVGSVGElement;
  /** The visually hidden semantic twin. */
  readonly index: HTMLOListElement;
  segment(id: string): SVGPathElement | undefined;
  update(): void;
  destroy(): void;
}

const WHEEL_SIZE = 100;
const WHEEL_CENTRE = 50;
const RING_OUTER = 47;
const RING_MIDDLE = 34;
const RING_INNER = 22;
const SEGMENT_GAP = 1.2;

const mountedWheels = new WeakMap<HarmonyHost, WheelHandle>();

/** Mount a radial read-out: a ring of segments and a needle on the conclusion. */
export function mountWheel(
  host: HarmonyHost,
  binding: WheelBinding,
  options: WheelOptions = {},
): WheelHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const style = installStyle(document, 'harmony', harmonyPresenterStyle, options.stylesheet);
  const dress = dressing(options.stylesheet);
  const motion = resolveMotion(host, options.motion, view);
  const stepped = motion !== 'continuous';
  const placeholders = Math.max(1, Math.round(finitePositive(options.placeholderSegments, 12)));

  const root = document.createElement('div');
  root.className = 'wui-harmony-wheel';
  root.setAttribute('role', 'group');
  root.dataset.motion = motion;
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  dress(root, wheelParts.root);
  if (options.surface === 'none') paint(root, embeddedSurfaceDeclarations);
  dressMotion(root, stepped);

  const surface = svg(document, 'svg', {
    viewBox: `0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`,
    'aria-hidden': 'true',
    focusable: 'false',
  });
  surface.setAttribute('class', 'wui-harmony-wheel__svg');
  surface.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  addClassNames(surface, options.classNames?.svg);
  setParts(surface, 'svg', options.parts?.svg);
  dress(surface, wheelParts.svg);

  const rings = svg(document, 'g');
  rings.setAttribute('class', 'wui-harmony-wheel__rings');
  const trail = svg(document, 'g');
  trail.setAttribute('class', 'wui-harmony-wheel__trail');
  const needle = svg(document, 'g');
  needle.setAttribute('class', 'wui-harmony-wheel__needle');
  dress(needle, wheelParts.needle);
  const pointer = svg(document, 'path', {fill: ACCENT});
  pointer.setAttribute('class', 'wui-harmony-wheel__pointer');
  needle.append(pointer);
  surface.append(rings, trail, needle);
  root.append(surface);

  // The centre is a live read-out now, so it obeys the nameplate's rule: the
  // text nodes keep their identity for life and only their content changes.
  const centre = document.createElement('div');
  centre.className = 'wui-harmony-wheel__centre';
  centre.setAttribute('role', 'status');
  centre.setAttribute('aria-live', 'polite');
  // NOT atomic, and the difference from the nameplate is the point. The
  // nameplate's two children are one fact said twice — the symbol and its spoken
  // form — so they are announced together. These two are different facts: the
  // key, and how sure the analysis is of it. `update()` runs on every
  // `binding.subscribe` notify, so with `aria-atomic` a confidence ticking from
  // 74% to 78% re-announced the key name with it, over and over, for a key that
  // had not changed. Without it only the child that changed speaks.
  dress(centre, wheelParts.centre);
  const centrePrimary = document.createElement('strong');
  centrePrimary.className = 'wui-harmony-wheel__primary';
  dress(centrePrimary, wheelParts.primary);
  const centreSecondary = document.createElement('span');
  centreSecondary.className = 'wui-harmony-wheel__secondary';
  dress(centreSecondary, wheelParts.secondary);
  centre.append(centrePrimary, centreSecondary);
  root.append(centre);

  const index = document.createElement('ol');
  index.className = 'wui-harmony-wheel__index';
  dress(index, wheelParts.index);
  root.append(index);

  const empty = document.createElement('p');
  empty.className = 'wui-harmony-wheel__empty';
  empty.hidden = true;
  markEmptyState(empty);
  dress(empty, wheelParts.empty);
  root.append(empty);

  const sectors = new Map<string, SVGPathElement>();
  let ringSignature = '';
  let angle = 0;
  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  const report = createErrorSink(options.onError);

  const drawRing = (
    segments: readonly WheelSegment[],
    outer: number,
    inner: number,
    ring: 'outer' | 'inner',
    into: SVGElement[],
    entries: HTMLLIElement[],
  ): void => {
    const count = segments.length;
    const total = segments.reduce(
      (sum, segment) => sum + Math.max(0, finite(segment.weight, 0)),
      0,
    );
    segments.forEach((segment, at) => {
      const from = (at * 360) / count + SEGMENT_GAP / 2;
      const to = ((at + 1) * 360) / count - SEGMENT_GAP / 2;
      const node = svg(document, 'path', {
        d: wheelSector(WHEEL_CENTRE, outer, inner, from, to),
        fill: progressionTone(at),
      });
      node.setAttribute('class', 'wui-harmony-wheel__sector');
      node.setAttribute('data-segment', segment.id);
      node.setAttribute('data-ring', ring);
      // Weight is opacity, not radius: a ring whose segments have different
      // radii is a ring the eye reads as a shape rather than as a comparison.
      node.setAttribute(
        'opacity',
        coordinate(0.25 + clamp01(segment.weight ?? (segment.active ? 1 : 0.4)) * 0.75),
      );
      dress(node, wheelParts.sector);
      sectors.set(`${ring}:${segment.id}`, node);
      into.push(node);

      const label = document.createElement('li');
      // No weights, no shares. `total` is the sum of the ring's `weight`s and an
      // unweighted ring sums to zero, so the twin announced "C major 0%, G major
      // 0%, A minor 0%" — twelve segments each claiming to be impossible, which
      // is worse than the ring saying nothing about strength at all. A share is
      // said only where there is a denominator to say it against.
      const share =
        total > 0 ? Math.round((Math.max(0, finite(segment.weight, 0)) / total) * 100) : undefined;
      label.textContent = share === undefined ? segment.label : `${segment.label} ${share}%`;
      label.dataset.segment = segment.id;
      label.dataset.ring = ring;
      entries.push(label);
    });
  };

  const update = (): void => {
    if (destroyed) return;
    try {
      const state = binding.snapshot();
      const outer: readonly WheelSegment[] =
        (state.outer?.length ?? 0) > 0
          ? state.outer
          : // The shape stands up before there is anything to put in it: an
            // empty wheel is still a wheel, not a hole in the layout.
            Array.from({length: placeholders}, (_unused, at) => ({
              id: `empty-${at}`,
              label: '',
            }));
      const inner = state.inner ?? [];
      const signature = JSON.stringify([
        outer.map((segment) => [segment.id, segment.label, segment.weight, segment.active]),
        inner.map((segment) => [segment.id, segment.label, segment.weight, segment.active]),
      ]);
      if (signature !== ringSignature) {
        ringSignature = signature;
        sectors.clear();
        const shapes: SVGElement[] = [];
        const entries: HTMLLIElement[] = [];
        drawRing(outer, RING_OUTER, RING_MIDDLE, 'outer', shapes, entries);
        if (inner.length > 0)
          drawRing(inner, RING_MIDDLE - 2, RING_INNER, 'inner', shapes, entries);
        rings.replaceChildren(...shapes);
        index.replaceChildren(...entries);
      }

      const onInner = state.needle?.ring === 'inner' && inner.length > 0;
      const ring = onInner ? inner : outer;
      const ids = ring.map((segment) => segment.id);
      const at = segmentIndexOf(state.needle?.at, ids);
      setAttr(needle, 'aria-hidden', 'true');
      setStyleValue(needle, 'display', at === undefined ? 'none' : undefined);
      let currentSegment: string | undefined;
      if (at !== undefined) {
        currentSegment = ring[Math.round(at) % ring.length]?.id;
        // Accumulated, never absolute: segment 11 to segment 0 is PLUS one
        // segment. An absolute angle takes the long way round on every wrap and
        // reads as the answer lurching backwards through ten it never held.
        angle = unwrapAngle(angle, ((at + 0.5) * 360) / ring.length);
        setStyleValue(needle, 'transform', `rotate(${coordinate(angle)}deg)`);
        const half = (Math.max(0, finite(state.needle?.spread, 0)) * 360) / ring.length / 2;
        const radius = onInner ? RING_MIDDLE - 2 : RING_OUTER;
        const hub = RING_INNER * 0.4;
        if (half > 0) {
          // A wedge, not a hair. An answer held at forty per cent confidence
          // has to LOOK unsure; a thin needle on an unsure answer is a picture
          // of certainty the data does not have.
          setAttr(pointer, 'd', wheelSector(WHEEL_CENTRE, radius, hub, -half, half));
          setAttr(pointer, 'fill', ACCENT);
          setAttr(pointer, 'stroke', 'none');
          setAttr(pointer, 'opacity', '.35');
        } else {
          const tip = wheelPoint(WHEEL_CENTRE, radius, 0);
          const base = wheelPoint(WHEEL_CENTRE, hub, 0);
          setAttr(pointer, 'd', `M${base.x} ${base.y} L${tip.x} ${tip.y}`);
          setAttr(pointer, 'fill', 'none');
          setAttr(pointer, 'stroke', ACCENT);
          setAttr(pointer, 'stroke-width', '2');
          setAttr(pointer, 'opacity', '1');
        }
      }

      const marks: SVGElement[] = [];
      (state.trail ?? []).forEach((entry, order, all) => {
        const step = segmentIndexOf(entry.at, ids);
        if (step === undefined) return;
        const point = wheelPoint(
          WHEEL_CENTRE,
          (RING_MIDDLE + RING_INNER) / 2,
          ((step + 0.5) * 360) / ring.length,
        );
        const mark = svg(document, 'circle', {
          cx: point.x,
          cy: point.y,
          r: 1.6,
          fill: ON_ACCENT,
          stroke: ACCENT,
          'stroke-width': 0.6,
          opacity: coordinate(clamp01(entry.weight ?? (order + 1) / Math.max(1, all.length))),
        });
        mark.setAttribute('class', 'wui-harmony-wheel__mark');
        marks.push(mark);
      });
      trail.replaceChildren(...marks);

      const currentKey =
        currentSegment === undefined
          ? undefined
          : `${onInner ? 'inner' : 'outer'}:${currentSegment}`;
      for (const [key, node] of sectors) {
        setAttr(node, 'data-current', key === currentKey ? 'true' : undefined);
      }
      // Keyed on RING and id, the way `sectors` already is. On id alone, an
      // outer and an inner segment that happen to share one — 'C' on both rings
      // is the ordinary case, not a contrived one — were both marked current,
      // and a reader was told two different answers are the answer.
      for (const entry of [...index.children] as HTMLLIElement[]) {
        const active =
          currentSegment !== undefined &&
          entry.dataset.segment === currentSegment &&
          entry.dataset.ring === (onInner ? 'inner' : 'outer');
        setAttr(entry, 'aria-current', active ? 'true' : undefined);
      }

      setText(centrePrimary, state.centre?.primary ?? '');
      setText(centreSecondary, state.centre?.secondary ?? '');
      const message = state.emptyLabel ?? '';
      const showEmpty = (state.outer?.length ?? 0) === 0 && message !== '';
      setText(empty, showEmpty ? message : '');
      setHidden(empty, !showEmpty);
      setLabel(
        root,
        options.label ??
          state.needle?.label ??
          describe('Wheel', state.centre?.primary ? [state.centre.primary] : []),
      );
    } catch (error) {
      report(error);
    }
  };

  const onClick = (event: MouseEvent): void => {
    if (!binding.selectSegment) return;
    const target = event.target as SVGElement | null;
    const id = target?.getAttribute?.('data-segment');
    if (!id) return;
    try {
      const state = binding.snapshot();
      const segment =
        state.outer?.find((entry) => entry.id === id) ??
        state.inner?.find((entry) => entry.id === id);
      if (segment) void Promise.resolve(binding.selectSegment(id, segment)).catch(report);
    } catch (error) {
      report(error);
    }
  };
  surface.addEventListener('click', onClick);

  const handle: WheelHandle = {
    element: root,
    svg: surface,
    index,
    segment(id: string): SVGPathElement | undefined {
      return sectors.get(`outer:${id}`) ?? sectors.get(`inner:${id}`);
    },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      claim.release();
      root.remove();
      style?.remove();
    },
  };

  const claim = claimHost(mountedWheels, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    root.remove();
    style?.remove();
    return handle;
  }

  update();
  if (binding.subscribe) {
    try {
      unsubscribe = binding.subscribe(update);
    } catch (error) {
      report(error);
    }
  }
  return handle;
}
