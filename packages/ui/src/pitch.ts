import {formatNumber, readText, textValue, type UITextValue, type UIValueFormatters} from './text';
import {
  harmonyValues,
  harmonyDensity,
  harmonyMotion,
  harmonyRule,
  harmonyScheme,
  harmonyTokens,
  toneFill,
  toneInk,
  toneMark,
  type HarmonyDensity,
  type HarmonyScheme,
  type ToneRole,
} from './harmony-style';
import {addClassNames, clamp, markEmptyState, setParts} from './internal/dom';
import {resolveMotion, type MotionMode} from './internal/frame';
import {claimHost, createErrorSink, createUpdateLoop} from './internal/lifecycle';
import {neutralColor} from './internal/palette';
import {installStyle, paint} from './internal/style';
import {componentSurfaceDeclarations, embeddedSurfaceDeclarations} from './internal/surface';
import {
  accidentalGlyph,
  DEFAULT_FRET_COUNT,
  FRET_UNIT,
  fretDotX,
  fretWireX,
  LEDGER_REACH,
  MAX_FIRST_FRET,
  MAX_FRET_COUNT,
  MAX_KEYBOARD_SPAN,
  MAX_STAFF_COLUMNS,
  MIDI_CEILING,
  MIDI_FLOOR,
  NOTE_REACH,
  NOTEHEAD_RX,
  NOTEHEAD_RY,
  pianoKeyLayout,
  resolveFretWindow,
  SECOND_OFFSET,
  STAFF_CLEF_X,
  STAFF_COLUMN_WIDTH,
  STAFF_LEAD_IN,
  STAFF_LEFT,
  STAFF_MARGIN,
  STAFF_SIGNATURE_X,
  STRING_GAP,
  staffLines,
  staffPlacement,
  staffY,
  type FretPosition,
  type StaffAccidental,
  type StaffPlacement,
  type StaffSystem,
} from './internal/pitch-geometry';
import type {Declarations} from './styles';

/**
 * Three surfaces that read the same sounding pitches three ways — a keyboard, a
 * staff and a fretboard — and never disagree about any of them.
 *
 * ## They are live, not snapshots
 *
 * Each mark may carry `since`, so a surface can show a pitch arriving and
 * leaving rather than blinking between two stills: the keyboard presses and
 * releases, the noteheads fade in, the fretboard's dots grow. That is the whole
 * reason `update()` DIFFS instead of rebuilding. Replacing the children every
 * frame restarts every transition, which pins the surface on the first frame of
 * its own attack forever — under a snapshot model that was an efficiency note,
 * and here it is the difference between a live surface and a dead one.
 *
 * The phases are derived, not declared. A caller says "60, 64 and 67 are
 * sounding"; the difference against the previous set is what makes 60 an
 * `attack`, and its absence next time is what makes it a `release`. No caller
 * is asked to track that, because no caller should have to.
 *
 * ## What these surfaces are NOT told
 *
 * They know no music theory. A mark is "diatonic step 28, role 'third',
 * labelled 'E4'" — never "the third of Cmaj7". Spelling is the caller's answer
 * because it has to be: F#4 and Gb4 are one key on the keyboard and two lines
 * on the staff, and only the caller knows which it meant.
 *
 * Clefs go one step further. A staff line, a ledger, a notehead and an
 * accidental are all reducible to geometry and this module draws them. A clef
 * is not, so the caller passes the glyph STRING and the kit only positions it.
 * Pass no `clefs` and there is no text node in the output at all — that is a
 * pinned test, and it is what keeps `packages/ui` free of notation characters.
 *
 * ## Reduced motion changes the driver, never the layout
 *
 * `motion: 'stepped'` and `'none'` produce a pixel-identical surface with the
 * transitions spent down to `0s`. Turning the movement off is allowed; turning
 * the layout into a different layout is not, because "the next chord is
 * approaching" is a property of where things are, not of how they got there.
 *
 * None of the three runs a frame loop. Every move here is one attribute write
 * plus a CSS transition, so a page holding six of these wakes up exactly as
 * often as its data changes.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary.
// ---------------------------------------------------------------------------

/**
 * One mark any pitch surface can draw. Spelling and role are the caller's
 * answers; everything else is arithmetic this module does itself.
 */
export interface PitchMark {
  midi: number;
  /** The caller's spelling, e.g. 'F#4'. The kit never names a pitch. */
  label?: string;
  /**
   * The role abbreviation printed beside the colour, e.g. 'R' or '#11'.
   * Defaults to {@link toneMark} of the role — pass one wherever the caller
   * knows the real figure, because the role alone cannot tell a 9 from a 13.
   */
  mark?: string;
  role?: ToneRole;
  /** 0…1 emphasis: velocity, weight or confidence. Defaults to 1. */
  weight?: number;
  active?: boolean;
  id?: string;
  /**
   * When this mark started sounding, in the caller's own units — the same ruler
   * the surface's `now` is on. Given both, the surface can show how long a
   * pitch has been held; given neither, it is simply on or off, which is a
   * complete and supported way to use every one of these.
   */
  since?: number;
}

/**
 * How much a live surface is allowed to move, and the clock a live one reads.
 *
 * All three names live in `internal/frame`, which is where the shared frame
 * loop lives, and are re-exported here because they appear in the public
 * signatures of these three mounts: a consumer that cannot name the type of an
 * option it is passing has been handed half an interface. Every subpath in this
 * family re-exports the SAME original binding, so the barrel's `export *` lines
 * cannot collide over them.
 *
 * The sheet carries the reduced-motion escape as a media query too, so a host
 * that installed it is covered even where no JavaScript ever asked.
 */
export type {FrameClock, FrameTick, MotionMode} from './internal/frame';

type PitchHost = HTMLElement | ShadowRoot;

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// The skin.
//
// Every value below is a CHAIN ending in a literal, never a bare `var()`: a
// surface is allowed to be mounted on a node that carries no tokens at all, and
// a bare custom property there is invalid at computed-value time — which paints
// a notehead invisible, the one failure a colour system may not have.
//
// The numeric geometry is deliberately NOT tokenised. It lives in
// `internal/pitch-geometry` as constants, because reading a number back out of
// a `--wui-*` property means `getComputedStyle`, custom properties do not
// inherit under jsdom, and `parseFloat('')` is `NaN`. Themes move colour here;
// the shapes stay put.
// ---------------------------------------------------------------------------

const INK = harmonyValues.ink;
const INK_MUTED = harmonyValues.inkMuted;
const FONT = 'var(--wui-harmony-font, inherit)';
const FONT_MONO = 'var(--wui-harmony-font-mono, ui-monospace, monospace)';
const SIZE_MICRO = 'var(--wui-harmony-size-micro, .6875rem)';
const SIZE_LABEL = 'var(--wui-harmony-size-label, .75rem)';

const EASE = 'var(--wui-harmony-motion-ease, ease-out)';
const MOTION_TONE = 'var(--wui-harmony-motion-tone, 90ms)';
const MOTION_RELEASE = 'var(--wui-harmony-motion-release, 140ms)';
const MOTION_COLUMN = 'var(--wui-harmony-motion-column, 200ms)';

const KEY_WHITE = 'var(--wui-pitch-key-white, var(--wm-note-key, var(--wm-surface, light-dark(#fff, #282828))))';
const KEY_BLACK = 'var(--wui-pitch-key-black, var(--wm-note-key-alt, var(--wm-surface-inverse, light-dark(#222, #111))))';
const KEY_BORDER = `var(--wui-pitch-key-border, var(--wm-note-border, var(--wm-control-border, var(--wm-border, ${neutralColor('border')}))))`;
const KEY_LABEL = 'var(--wui-pitch-key-label, var(--wm-note-label, var(--wm-foreground-muted, var(--wm-foreground, light-dark(#666, #aaa)))))';
const KEY_RADIUS = 'var(--wui-pitch-key-radius, var(--wm-note-radius, var(--wm-control-radius, 0)))';
const KEY_BLACK_HEIGHT = 'var(--wui-pitch-key-black-height, 62%)';
const KEY_MIN_WIDTH = 'var(--wui-pitch-key-min-width, var(--wui-pitch-key-width-default, 2.5rem))';
const FRETBOARD_UNIT = 'var(--wui-pitch-fretboard-unit, var(--wui-pitch-unit-default, 2.2px))';
const KEYBOARD_HEIGHT = 'var(--wui-harmony-keyboard-height, var(--wm-keyboard-height, 92px))';

// `--wui-harmony-line` is a row hairline at 1.38:1 on the surface, which is
// right for a rule between two rows and invisible as a staff line.
const STAFF_LINE = 'var(--wui-pitch-staff-line, var(--wm-pitch-staff-line, var(--wm-foreground, light-dark(#666, #888))))';
const STAFF_SPACE = 'var(--wui-harmony-staff-space, var(--wm-staff-space, 9px))';

const FRET_NECK = `var(--wui-pitch-fret-neck, var(--wm-pitch-fret-neck, var(--wm-surface, ${neutralColor('surfaceMuted')})))`;
const FRET_WIRE = 'var(--wui-pitch-fret-wire, var(--wm-pitch-fret-wire, var(--wm-foreground, light-dark(#999, #777))))';
const FRET_NUT = 'var(--wui-pitch-fret-nut, var(--wm-pitch-fret-nut, var(--wm-foreground, light-dark(#444, #ccc))))';
const FRET_STRING = 'var(--wui-pitch-fret-string, var(--wm-pitch-fret-string, var(--wm-foreground, light-dark(#888, #aaa))))';
const FRET_INLAY = 'var(--wui-pitch-fret-inlay, var(--wm-pitch-fret-inlay, var(--wm-foreground, light-dark(#ccc, #444))))';
const FRETBOARD_HEIGHT =
  'var(--wui-harmony-fretboard-height, var(--wm-fretboard-height, 104px))';

/**
 * The two motion durations this module spends that `harmonyMotion` does not
 * carry yet. Painted onto the root only in a reduced mode, so a shell that
 * declares its own budget keeps it.
 */
const PITCH_MOTION: Readonly<Record<'full' | 'reduced', Declarations>> = {
  full: {
    '--wui-harmony-motion-release': 'var(--wm-harmony-motion-release, 140ms)',
    '--wui-harmony-motion-column': 'var(--wm-harmony-motion-column, 200ms)',
  },
  reduced: {'--wui-harmony-motion-release': '0s', '--wui-harmony-motion-column': '0s'},
};

/** How long a release takes when the caller does not say. */
const DEFAULT_RELEASE_MS = 140;

/**
 * What a mark's published age is spent on, by default: it dims as it is held.
 *
 * `since` was computed, written and read by nobody. A hook nothing spends is
 * not a feature, it is a promise, so the surfaces spend it themselves and a
 * theme that disagrees overrides one declaration. It is `fill-opacity` on the
 * two SVG surfaces because `opacity` on those nodes already carries the staff's
 * `data-when` and the fretboard's `data-phase` — one property cannot answer to
 * two facts.
 */
/**
 * How solid a mark paints: its caller's own emphasis, dimmed by how long ago it
 * sounded.
 *
 * `--wui-pitch-weight` is `PitchMark.weight` — a velocity, a confidence, a
 * caller's "this one matters less" — and it defaults to 1, so a caller that
 * says nothing gets exactly the age fade this used to be. All three surfaces
 * spend it through this one expression: the keyboard as `opacity`, the staff's
 * notehead and the fretboard's disc as `fill-opacity`. A field the type declares
 * and nothing reads is a promise the surface does not keep.
 */
const AGE_FADE = 'calc(var(--wui-pitch-weight, 1) * (1 - var(--wui-harmony-age, 0) * .35))';

/** `0`…`1`, and nothing at all at full weight, so the default writes no property. */
function markWeight(weight: number | undefined): string | undefined {
  if (!Number.isFinite(weight as number)) return undefined;
  const value = clamp(weight as number, 0, 1);
  return value >= 1 ? undefined : String(Math.round(value * 100) / 100);
}

/**
 * The boxes, as data — so the stylesheet and the inline path are generated from
 * one record and cannot drift. A host that opts out of the sheet gets the same
 * declarations written onto the nodes.
 */
const pitchDensity: Record<HarmonyDensity, Declarations> = {
  comfortable: {},
  compact: {'--wui-pitch-key-width-default': '2.25rem', '--wui-pitch-unit-default': '2px'},
};

const pitchViewport: Declarations = {
  ...componentSurfaceDeclarations('pitch', {padding: '0', border: '0', background: 'var(--wm-surface, transparent)'}),
  display: 'block', 'min-width': '0', 'max-width': '100%',
  position: 'relative', 'overflow-x': 'auto', 'overscroll-behavior-x': 'contain',
};

const pitchParts = {
  keyboardRoot: {
    ...pitchViewport,
    color: INK,
    'font-family': FONT,
  },
  keyboardBoard: {
    position: 'relative',
    width: '100%',
    'min-width': 'var(--wui-pitch-keyboard-width, 0px)',
    height: KEYBOARD_HEIGHT,
    'user-select': 'none',
  },
  keyboardKey: {
    position: 'absolute',
    top: '0',
    'box-sizing': 'border-box',
    display: 'flex',
    'flex-direction': 'column',
    'align-items': 'center',
    'justify-content': 'flex-end',
    gap: '1px',
    'padding-bottom': '.2rem',
    border: `1px solid ${KEY_BORDER}`,
    'border-radius': KEY_RADIUS,
    'background-image': 'var(--wui-pitch-key-wash, none)',
    transition: `background-color ${MOTION_TONE} ${EASE}, opacity ${MOTION_RELEASE} ${EASE}`,
  },
  keyboardWhite: {height: '100%', 'background-color': `var(--wui-pitch-key-face, ${KEY_WHITE})`},
  // The centring offset is the layout: `pianoKeyLayout` returns the BOUNDARY a
  // black key straddles, so without this every black key lands half a key right.
  keyboardBlack: {
    height: KEY_BLACK_HEIGHT,
    'z-index': '2',
    transform: 'translateX(-50%)',
    'background-color': `var(--wui-pitch-key-face, ${KEY_BLACK})`,
  },
  keyboardMark: {
    'max-width': '100%', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
    'font-family': FONT_MONO,
    'font-size': SIZE_MICRO,
    'font-weight': '700',
    'line-height': '1',
    color: `var(--wui-pitch-key-ink, ${KEY_LABEL})`,
    'pointer-events': 'none',
  },
  keyboardLabel: {
    'max-width': '100%', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap',
    'font-family': FONT_MONO,
    'font-size': SIZE_MICRO,
    'line-height': '1',
    color: `var(--wui-pitch-key-ink, ${KEY_LABEL})`,
    'pointer-events': 'none',
  },
  keyboardRuler: {
    width: '100%', 'min-width': 'var(--wui-pitch-keyboard-width, 0px)',
    position: 'relative',
    height: '1.1em',
    'margin-top': '.15rem',
    'font-family': FONT_MONO,
    'font-size': SIZE_MICRO,
    color: INK_MUTED,
  },
  // `line-height: 1` for the same reason the key's own two labels have it: the
  // ruler is `1.1em` tall and a normal line box is taller than that, so without
  // it every octave name hangs a third of its own height below the card.
  keyboardOctave: {
    position: 'absolute',
    top: '0',
    'line-height': '1',
    transform: 'translateX(-50%)',
  },

  staffRoot: {...pitchViewport, color: INK, 'font-family': FONT},
  staffSvg: {display: 'block', width: '100%', overflow: 'hidden'},
  staffReel: {transition: `transform ${MOTION_COLUMN} ${EASE}`},
  staffNote: {transition: `opacity ${MOTION_TONE} ${EASE}`},
  // The head and the disc below carry the SAME `fill` transition the keyboard
  // spends on its `background-color`. Without them the tone colour snapped on
  // two of the three surfaces, and "all the docks change colour at once" —
  // which is the pop this family exists for — happened on one.
  staffHead: {transition: `fill ${MOTION_TONE} ${EASE}`, 'fill-opacity': AGE_FADE},
  staffAccidental: {transition: `stroke ${MOTION_TONE} ${EASE}`},
  staffEmpty: {margin: '0', 'font-size': SIZE_LABEL, color: INK_MUTED},

  fretboardRoot: {...pitchViewport, color: INK, 'font-family': FONT},
  // Width is available space; the minimum geometry and fixed cross-axis size
  // keep text and circular marks readable instead of shrinking the whole SVG.
  fretboardSvg: {display: 'block', width: '100%', overflow: 'hidden'},
  fretboardReel: {transition: `transform ${MOTION_COLUMN} ${EASE}`},
  fretboardDot: {transition: `opacity ${MOTION_TONE} ${EASE}`},
  fretboardDisc: {transition: `fill ${MOTION_TONE} ${EASE}`, 'fill-opacity': AGE_FADE},
  fretboardEmpty: {margin: '0', 'font-size': SIZE_LABEL, color: INK_MUTED},
} satisfies Readonly<Record<string, Declarations>>;

/**
 * How loud a column is, by its distance from the sounding one.
 *
 * A record rather than four rules, because it has to reach BOTH paths: the
 * sheet turns it into attribute selectors, and a host that opted out of the
 * sheet has it written onto the node. `data-when` is information — it is what
 * "the next chord is coming" looks like — so unlike a transition it may not go
 * missing when the stylesheet does.
 */
const WHEN_OPACITY: Readonly<Record<string, string>> = {
  past: '.35',
  now: '1',
  next: '.55',
  far: '.3',
};

/** The three root classes, in the order their sections appear below. */
const PITCH_ROOTS = ['.wui-pitch-keyboard', '.wui-pitch-staff', '.wui-pitch-fretboard'] as const;

/** The three roots as one selector list, optionally each with a suffix. */
const pitchRoots = (suffix = ''): string =>
  PITCH_ROOTS.map((selector) => `${selector}${suffix}`).join(', ');

const indent = (rule: string): string =>
  rule
    .split('\n')
    .map((row) => `  ${row}`)
    .join('\n');

/**
 * The stylesheet for all three surfaces. Exported so a host that renders into
 * its own light DOM can install it once instead of taking it per mount; a host
 * that passes `stylesheet: false` gets the identical declarations painted onto
 * the nodes, generated from the same records.
 *
 * The state rules are the half a `cssText` string cannot carry: an attribute
 * selector and a media query. Everything a node needs in order to look right on
 * its own is in the records above, and every state rule below that carries
 * INFORMATION rather than motion — `data-when`, `data-ghost` — is also written
 * onto the node when a host opts out of this sheet.
 */
export const pitchStyle = [
  // The token layer is declared on each ROOT rather than assumed from an
  // ancestor. These surfaces mount into a workbench dock that carries it, and
  // equally into a bare `<div>` that does not — and a surface whose colours
  // depend on who its parent happens to be is not a surface a caller can drop
  // anywhere. `density` and `scheme` are the two the caller can move.
  harmonyRule(pitchRoots(), harmonyTokens),
  harmonyRule(pitchRoots('[data-density="compact"]'), harmonyDensity.compact, pitchDensity.compact),
  harmonyRule(pitchRoots('[data-scheme="system"]'), harmonyScheme.system),
  harmonyRule(pitchRoots('[data-scheme="light"]'), harmonyScheme.light),
  harmonyRule(pitchRoots('[data-scheme="dark"]'), harmonyScheme.dark),

  harmonyRule('.wui-pitch-keyboard', pitchParts.keyboardRoot),
  harmonyRule('.wui-pitch-keyboard__board', pitchParts.keyboardBoard),
  harmonyRule('.wui-pitch-keyboard__key', pitchParts.keyboardKey),
  harmonyRule('.wui-pitch-keyboard__key--white', pitchParts.keyboardWhite),
  harmonyRule('.wui-pitch-keyboard__key--black', pitchParts.keyboardBlack),
  harmonyRule('.wui-pitch-keyboard__mark', pitchParts.keyboardMark),
  harmonyRule('.wui-pitch-keyboard__label', pitchParts.keyboardLabel),
  harmonyRule('.wui-pitch-keyboard__ruler', pitchParts.keyboardRuler),
  harmonyRule('.wui-pitch-keyboard__ruler[hidden]', {display: 'none'}),
  harmonyRule('.wui-pitch-keyboard__octave', pitchParts.keyboardOctave),
  harmonyRule('.wui-pitch-keyboard__key[data-phase="release"]', {opacity: '.72'}),
  harmonyRule('.wui-pitch-keyboard__key[data-ghost="true"]', {'border-style': 'dashed'}),
  harmonyRule('.wui-pitch-keyboard__key[data-active="true"]', {opacity: AGE_FADE}),

  harmonyRule('.wui-pitch-staff', pitchParts.staffRoot),
  harmonyRule('.wui-pitch-staff__svg', pitchParts.staffSvg),
  harmonyRule('.wui-pitch-staff__reel', pitchParts.staffReel),
  harmonyRule('.wui-pitch-staff__note', pitchParts.staffNote),
  harmonyRule('.wui-pitch-staff__head', pitchParts.staffHead),
  harmonyRule('.wui-pitch-staff__accidental', pitchParts.staffAccidental),
  harmonyRule('.wui-pitch-staff__empty', pitchParts.staffEmpty),
  harmonyRule('.wui-pitch-staff__note[data-when="next"]', {opacity: WHEN_OPACITY.next!}),
  harmonyRule('.wui-pitch-staff__note[data-when="far"]', {opacity: WHEN_OPACITY.far!}),
  harmonyRule('.wui-pitch-staff__note[data-when="past"]', {opacity: WHEN_OPACITY.past!}),
  harmonyRule('.wui-pitch-staff__note[data-phase="attack"]', {opacity: '0'}),

  harmonyRule('.wui-pitch-fretboard', pitchParts.fretboardRoot),
  harmonyRule('.wui-pitch-fretboard__svg', pitchParts.fretboardSvg),
  harmonyRule('.wui-pitch-fretboard__reel', pitchParts.fretboardReel),
  harmonyRule('.wui-pitch-fretboard__dot', pitchParts.fretboardDot),
  harmonyRule('.wui-pitch-fretboard__disc', pitchParts.fretboardDisc),
  harmonyRule('.wui-pitch-fretboard__empty', pitchParts.fretboardEmpty),
  harmonyRule('.wui-pitch-fretboard__dot[data-phase="attack"]', {opacity: '0'}),
  // A dot that has finished releasing is REMOVED, so a release that stops at a
  // visible opacity ends in a cut. It fades the whole way, and the grip that
  // just left the neck is gone by the time the node is.
  harmonyRule('.wui-pitch-fretboard__dot[data-phase="release"]', {opacity: '0'}),

  // The escape a `cssText` string cannot carry, and the reason it is here as
  // well as in `resolveMotion`: a page whose shell never declared `data-motion`
  // and whose JavaScript never ran still owes a reduced-motion viewer a still
  // surface. `motion: 'continuous'` does not out-rank the viewer's own setting.
  [
    '@media (prefers-reduced-motion: reduce) {',
    ...PITCH_ROOTS.flatMap((selector) => [
      indent(harmonyRule(selector, harmonyMotion.reduced, PITCH_MOTION.reduced)),
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
// Small shared plumbing.
// ---------------------------------------------------------------------------

/**
 * Write a `data-*` value only when it actually changes.
 *
 * Not an optimisation. `data-phase` is the attribute the CSS transitions hang
 * off, and re-writing it with its own value is a mutation the browser and any
 * observer both see. The contract these surfaces owe is "the number of phase
 * writes is the number of phase CHANGES", and this is where it is kept.
 */
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

/**
 * The same guard for one inline declaration — a custom property, which has no
 * `dataset` shortcut, or a plain one where a host opted out of the sheet and
 * an attribute selector therefore reaches nothing.
 */
function setStyleValue(node: ElementCSSInlineStyle, name: string, value: string | undefined): void {
  const current = node.style.getPropertyValue(name);
  if (value === undefined) {
    if (current) node.style.removeProperty(name);
    return;
  }
  if (current !== value) node.style.setProperty(name, value);
}

function setLabel(node: Element, label: string): void {
  if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
}

function setText(node: {textContent: string | null}, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/**
 * Assigning `hidden` writes the attribute even when the value is unchanged, and
 * a keyboard has one label and one mark per key. Thirty-seven redundant
 * attribute writes per repaint is not free at twenty repaints a second.
 */
function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
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

function positivePixels(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * A count or an index, rounded, with a fallback for anything that is not a
 * number. Written out rather than left to `Math.max(0, Math.round(x))`, which
 * answers `NaN` for a `NaN` and puts the string 'NaN' straight into an
 * attribute — a value that matches every selector and parses as nothing.
 */
function whole(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

/** How the caller's own units map onto `0…1` of "how long has this been held". */
const DEFAULT_AGE_SPAN = 4;

function ageOf(now: unknown, since: unknown, span: number): string | undefined {
  if (typeof now !== 'number' || !Number.isFinite(now)) return undefined;
  if (typeof since !== 'number' || !Number.isFinite(since)) return undefined;
  const width = Number.isFinite(span) && span > 0 ? span : DEFAULT_AGE_SPAN;
  return String(Math.max(0, Math.min(1, (now - since) / width)));
}

/** The label a surface announces when the caller supplies none. */
function describe(override: UITextValue<{names: string}> | undefined, subject: string, names: readonly string[], onError?: (error: unknown) => void): string {
  const joined = names.join(', ');
  return textValue(override, names.length > 0 ? `${subject}: ${joined}` : subject, {names: joined}, onError);
}

/**
 * Paint the boxes onto the nodes, but only for a host that opted out of the
 * stylesheet. Both paths read the same records, so the sheet and the inline
 * string cannot describe two different surfaces.
 */
function dressing(
  stylesheet: boolean | undefined,
): (node: ElementCSSInlineStyle, ...groups: Declarations[]) => void {
  if (stylesheet === false) return (node, ...groups) => paint(node, ...groups);
  return () => {};
}

/**
 * The one-shot promotion from `attack` to `sustain`, and the sweep that clears
 * a finished release.
 *
 * One handle each, per mount, for the whole surface — not one per key. A
 * keyboard is 37 keys and a chord is four of them; 37 timers to express four
 * facts is how a passive read-out ends up costing more than the player.
 */
interface Beat {
  settle(run: () => void): void;
  /**
   * Run the sweep in `delayMs`, or SOONER if something is already pending for
   * later. A sweep that simply refused while a timer was outstanding made a
   * release last up to twice its declared duration — a key lifted just after
   * another one waited for that key's sweep and then for a whole fresh tail.
   */
  sweep(run: () => void, delayMs: number): void;
  cancel(): void;
}

function createBeat(view: (Window & typeof globalThis) | null): Beat {
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due = 0;
  const clock = (): number => view?.performance?.now?.() ?? Date.now();
  const cancelFrame = (): void => {
    if (frame === undefined) return;
    if (view?.cancelAnimationFrame) view.cancelAnimationFrame(frame);
    else clearTimeout(frame as unknown as ReturnType<typeof setTimeout>);
    frame = undefined;
  };
  return {
    settle(run): void {
      if (frame !== undefined) return;
      const fire = (): void => {
        frame = undefined;
        run();
      };
      frame = view?.requestAnimationFrame
        ? view.requestAnimationFrame(fire)
        : (setTimeout(fire, 0) as unknown as number);
    },
    sweep(run, delayMs): void {
      const wait = Math.max(0, Number.isFinite(delayMs) ? delayMs : 0);
      const at = clock() + wait;
      if (timer !== undefined) {
        if (at >= due) return;
        clearTimeout(timer);
      }
      due = at;
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, wait);
    },
    cancel(): void {
      cancelFrame();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Scrollable readouts expose one keyboard stop only while content overflows. */
function pitchScroll(root: HTMLElement, content: Element, onResize?: () => void) {
  const view = root.ownerDocument.defaultView;
  let observer: ResizeObserver | undefined;
  let destroyed = false;
  const refresh = (): void => {
    if (destroyed) return;
    if (root.clientWidth > 0 && root.scrollWidth > root.clientWidth + 1) setAttr(root, 'tabindex', '0');
    else root.removeAttribute('tabindex');
  };
  const resized = (): void => {refresh(); onResize?.();};
  return {
    refresh,
    start(): void {
      if (destroyed) return;
      const Observer = view?.ResizeObserver;
      if (Observer) {
        observer = new Observer(resized);
        observer.observe(root);
        observer.observe(content);
      } else view?.addEventListener('resize', resized);
      refresh();
    },
    destroy(): void {
      destroyed = true;
      observer?.disconnect();
      view?.removeEventListener('resize', resized);
    },
  };
}

// ---------------------------------------------------------------------------
// The keyboard.
// ---------------------------------------------------------------------------

export interface KeyboardState {
  /** Lowest MIDI pitch drawn. Defaults to 48. */
  low?: number;
  /** Highest MIDI pitch drawn. Defaults to 84. */
  high?: number;
  marks: readonly PitchMark[];
  /**
   * Pitch classes that belong to the key but are not sounding, drawn as a wash.
   * A different channel from the marks and readable as one: a ghost key carries
   * `data-ghost="true"` and `data-active="false"`, so nothing about it depends
   * on being able to see the colour.
   */
  ghostPitchClasses?: readonly number[];
  /** Which keys may print a name. Defaults to `'marked'`. */
  labels?: 'none' | 'marked' | 'white' | 'all';
  /** The octave ruler's text — whether C4 or C3 is a convention, not a fact. */
  octaveLabels?: ReadonlyMap<number, string>;
  /** The caller's current position, on the same ruler as `PitchMark.since`. */
  now?: number;
}

export interface KeyboardBinding {
  snapshot(): KeyboardState;
  subscribe?(notify: () => void): () => void;
}

export interface KeyboardClassNames {
  root?: string;
  board?: string;
}

export interface KeyboardParts {
  root?: string;
  board?: string;
}

export interface KeyboardText {
  description?: UITextValue<{names: string}>;
}

export interface KeyboardOptions {
  /** Final text from application-owned presentation state; refreshed by update(). */
  getText?: () => KeyboardText;
  /** Fit the complete normalized range to the available width, ignoring key widths and their CSS minimum. Defaults to false. */
  fitToWidth?: boolean;
  /** Exact white-key width in CSS px; absent/invalid retains responsive minimum sizing. Ignored by fitToWidth. */
  whiteKeyWidth?: number;
  /** Exact black-key width in CSS px, capped at white width. Alone derives white width at the default .62 ratio. Ignored by fitToWidth. */
  blackKeyWidth?: number;
  /** White-key height in CSS px; absent/invalid retains the public CSS token. */
  whiteKeyHeight?: number;
  /** Black-key height in CSS px, capped at the white-key height. */
  blackKeyHeight?: number;
  /** Outer surface, or no frame/background when a containing presenter owns it. Defaults to 'default'. */
  surface?: 'default' | 'none';
  label?: string;
  /** Reveal newly active marks inside a wide keyboard. Defaults to 'none'. */
  follow?: 'active' | 'none';
  motion?: MotionMode;
  /** Release tail in ms. Defaults to 140, and to 0 in a reduced motion mode. */
  release?: number;
  /** Leave a fading trace of the role colour on a released key. */
  trail?: boolean;
  /** How many of the caller's own units `--wui-harmony-age` spans. Defaults to 4. */
  ageSpan?: number;
  classNames?: KeyboardClassNames;
  parts?: KeyboardParts;
  onError?: (error: unknown) => void;
  /**
   * The compact tier: same information, less room. A workbench packing six
   * surfaces into one column asks for it; a single surface on a page does not.
   */
  density?: HarmonyDensity;
  /** Pin the colour scheme instead of following the page. Defaults to inheriting it. */
  scheme?: HarmonyScheme;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface KeyboardHandle {
  element: HTMLElement;
  board: HTMLElement;
  /** The key node for one pitch, or nothing when it is outside the range. */
  key(midi: number): HTMLElement | undefined;
  update(): void;
  destroy(): void;
}

interface KeyNode {
  root: HTMLElement;
  mark: HTMLSpanElement;
  label: HTMLSpanElement;
}

interface Sounding {
  role?: ToneRole;
  mark?: string;
  label?: string;
  since?: number;
  weight?: number;
}

const mountedKeyboards = new WeakMap<PitchHost, KeyboardHandle>();

/** Mount a passive keyboard read-out that presses and releases with its input. */
export function mountKeyboard(
  host: PitchHost,
  binding: KeyboardBinding,
  options: KeyboardOptions = {},
): KeyboardHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const style = installStyle(document, 'pitch', pitchStyle, options.stylesheet);
  const dress = dressing(options.stylesheet);
  const inline = options.stylesheet === false;
  const motion = resolveMotion(host, options.motion, view);
  const stepped = motion !== 'continuous';
  const releaseMs = stepped ? 0 : Math.max(0, options.release ?? DEFAULT_RELEASE_MS);
  const ageSpan = options.ageSpan ?? DEFAULT_AGE_SPAN;
  const fitToWidth = options.fitToWidth === true;
  const requestedBlackWidth = positivePixels(options.blackKeyWidth);
  const whiteKeyWidth = fitToWidth ? undefined : positivePixels(options.whiteKeyWidth) ?? (requestedBlackWidth === undefined ? undefined : requestedBlackWidth / .62);
  const blackKeyWidth = whiteKeyWidth === undefined ? undefined : Math.min(whiteKeyWidth, requestedBlackWidth ?? whiteKeyWidth * .62);
  const whiteKeyHeight = positivePixels(options.whiteKeyHeight);
  const blackKeyHeight = positivePixels(options.blackKeyHeight);

  const root = document.createElement('div');
  root.className = 'wui-pitch-keyboard';
  root.setAttribute('role', 'img');
  // Named HERE and not only in `update()`. `update()` runs the caller's
  // `snapshot()`, and a snapshot that throws on its first call leaves a
  // `role="img"` with no accessible name at all — an unnamed image, which is
  // the one thing a screen reader cannot skip and cannot read. The derived
  // sentence below replaces this the moment there is something to say.
  setLabel(root, options.label ?? 'Sounding pitches');
  root.dataset.motion = motion;
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  // The two the caller can move, stamped so the sheet's own rules can see them
  // and repeated inline for a host that installed no sheet.
  if (options.density) root.dataset.density = options.density;
  if (options.scheme) root.dataset.scheme = options.scheme;
  dress(
    root,
    harmonyScheme[options.scheme ?? 'inherit'],
    harmonyTokens,
    harmonyDensity[options.density ?? 'comfortable'],
    pitchDensity[options.density ?? 'comfortable'],
    pitchParts.keyboardRoot,
  );
  if (options.surface === 'none') paint(root, embeddedSurfaceDeclarations);
  if (fitToWidth) root.style.overflowX = 'hidden';
  if (stepped) paint(root, harmonyMotion.reduced, PITCH_MOTION.reduced);

  const board = document.createElement('div');
  board.className = 'wui-pitch-keyboard__board';
  addClassNames(board, options.classNames?.board);
  setParts(board, 'board', options.parts?.board);
  dress(board, pitchParts.keyboardBoard);
  if (whiteKeyHeight !== undefined) board.style.height = `${whiteKeyHeight}px`;
  root.append(board);

  const ruler = document.createElement('div');
  ruler.className = 'wui-pitch-keyboard__ruler';
  ruler.setAttribute('aria-hidden', 'true');
  dress(ruler, pitchParts.keyboardRuler);
  root.append(ruler);
  const scroll = fitToWidth ? undefined : pitchScroll(root, board, () => reveal());

  const keys = new Map<number, KeyNode>();
  let sounding = new Map<number, Sounding>();
  const releasing = new Map<number, number>();
  let boardSignature = '';
  let rulerSignature = '';
  let pendingReveal: readonly number[] = [];
  let destroyed = false;
  let text: KeyboardText | undefined;
  let unsubscribe: (() => void) | undefined;

  const report = createErrorSink(options.onError);
  const beat = createBeat(view);

  const now = (): number => view?.performance?.now?.() ?? Date.now();

  const buildKey = (key: {midi: number; black?: boolean}): KeyNode => {
    const node = document.createElement('div');
    node.className = `wui-pitch-keyboard__key wui-pitch-keyboard__key--${key.black ? 'black' : 'white'}`;
    node.dataset.midi = String(key.midi);
    dress(node, pitchParts.keyboardKey, key.black ? pitchParts.keyboardBlack : pitchParts.keyboardWhite);
    if (key.black && blackKeyHeight !== undefined) node.style.height = whiteKeyHeight === undefined
      ? `min(${blackKeyHeight}px, 100%)` : `${Math.min(blackKeyHeight, whiteKeyHeight)}px`;
    const mark = document.createElement('span');
    mark.className = 'wui-pitch-keyboard__mark';
    mark.hidden = true;
    dress(mark, pitchParts.keyboardMark);
    const label = document.createElement('span');
    label.className = 'wui-pitch-keyboard__label';
    label.hidden = true;
    dress(label, pitchParts.keyboardLabel);
    node.append(mark, label);
    return {root: node, mark, label};
  };

  // A range that begins or ends on a black key used to be handled here, by
  // insetting the ROOT with padding. `pianoKeyLayout` now reserves the half
  // white key itself, which is the one place the fix reaches all three callers
  // of the helper — this surface, `<keyboard-view>` and `<note-input>`. The two
  // compensations are alternatives, never both: padding on top of the reserve
  // insets a black-ended board twice.
  const rebuild = (lo: number, hi: number): void => {
    const layout = pianoKeyLayout(lo, hi);
    const white = layout.find((key) => !key.black);
    const units = white ? 100 / white.width : 1;
    const boardWidth = whiteKeyWidth === undefined ? undefined : whiteKeyWidth * units;
    setStyleValue(root, '--wui-pitch-keyboard-width', fitToWidth ? '0px' : boardWidth === undefined
      ? `calc(${KEY_MIN_WIDTH} * ${coordinate(units)})` : `${coordinate(boardWidth)}px`);
    if (fitToWidth) {
      board.style.width = ruler.style.width = '100%';
      board.style.minWidth = ruler.style.minWidth = '0';
    } else if (boardWidth !== undefined) {
      board.style.width = `${coordinate(boardWidth)}px`;
      board.style.minWidth = `${coordinate(boardWidth)}px`;
      ruler.style.width = `${coordinate(boardWidth)}px`;
      ruler.style.minWidth = `${coordinate(boardWidth)}px`;
    }
    const ordered: HTMLElement[] = [];
    const next = new Map<number, KeyNode>();
    for (const key of layout) {
      const existing = keys.get(key.midi);
      const node = existing ?? buildKey(key);
      node.root.style.left = `${key.left}%`;
      node.root.style.width = `${key.black && whiteKeyWidth !== undefined && blackKeyWidth !== undefined
        ? key.width / .62 * blackKeyWidth / whiteKeyWidth : key.width}%`;
      next.set(key.midi, node);
      ordered.push(node.root);
    }
    for (const [midi, node] of keys) if (!next.has(midi)) node.root.remove();
    keys.clear();
    for (const [midi, node] of next) keys.set(midi, node);
    // The only structural write in this mount, and it happens when the RANGE
    // changes — never on a repaint, because moving a node restarts its
    // transitions just as surely as recreating it.
    board.replaceChildren(...ordered);
  };

  const rebuildRuler = (lo: number, hi: number, labels: ReadonlyMap<number, string>): void => {
    const layout = pianoKeyLayout(lo, hi);
    const marks: HTMLElement[] = [];
    for (const key of layout) {
      const text = labels.get(key.midi);
      if (text === undefined) continue;
      const node = document.createElement('span');
      node.className = 'wui-pitch-keyboard__octave';
      node.dataset.midi = String(key.midi);
      // A white key's `left` is its edge and a black key's is its own centre,
      // so only one of the two takes half a width. Centring both put every
      // black-key ruler mark a third of a key to the right of its key.
      node.style.left = `${key.black ? key.left : key.left + key.width / 2}%`;
      node.textContent = text;
      dress(node, pitchParts.keyboardOctave);
      if (fitToWidth) paint(node, {'max-width': `${key.width}%`, overflow: 'hidden', 'white-space': 'nowrap', 'text-overflow': 'ellipsis'});
      marks.push(node);
    }
    ruler.replaceChildren(...marks);
    setHidden(ruler, marks.length === 0);
    if (inline) setStyleValue(ruler, 'display', marks.length === 0 ? 'none' : undefined);
  };

  const reveal = (): void => {
    if (fitToWidth || destroyed || pendingReveal.length === 0 || root.clientWidth <= 0) return;
    const heldKeys = pendingReveal.map((midi) => keys.get(midi)?.root).filter((key): key is HTMLElement => Boolean(key));
    pendingReveal = [];
    if (heldKeys.length === 0) return;
    const left = Math.min(...heldKeys.map((key) => key.offsetLeft - (key.classList.contains('wui-pitch-keyboard__key--black') ? key.offsetWidth / 2 : 0)));
    const right = Math.max(...heldKeys.map((key) => key.offsetLeft + key.offsetWidth * (key.classList.contains('wui-pitch-keyboard__key--black') ? 0.5 : 1)));
    if (left < root.scrollLeft || right > root.scrollLeft + root.clientWidth) {
      root.scrollLeft = Math.max(0, Math.min(root.scrollWidth - root.clientWidth, (left + right - root.clientWidth) / 2));
    }
  };

  const promote = (): void => {
    if (destroyed) return;
    for (const [midi, node] of keys) {
      if (node.root.dataset.phase === 'attack' && sounding.has(midi)) {
        setData(node.root, 'phase', 'sustain');
      }
    }
  };

  /**
   * Arm the sweep for the EARLIEST outstanding release, not for a fresh full
   * tail. Two keys lifted 100 ms apart owe two different deadlines, and one
   * timer serves both only if it is set by the nearer of them.
   */
  const armSweep = (): void => {
    if (releaseMs <= 0 || releasing.size === 0) return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const at of releasing.values()) earliest = Math.min(earliest, at);
    beat.sweep(sweep, earliest + releaseMs - now());
  };

  const sweep = (): void => {
    if (destroyed) return;
    const cutoff = now() - releaseMs;
    for (const [midi, at] of [...releasing]) {
      if (at > cutoff) continue;
      releasing.delete(midi);
      const node = keys.get(midi);
      if (node) clearKey(node);
    }
    armSweep();
  };

  const clearKey = (node: KeyNode): void => {
    setData(node.root, 'phase', undefined);
    setData(node.root, 'role', undefined);
    setStyleValue(node.root, '--wui-pitch-key-face', undefined);
    setStyleValue(node.root, '--wui-pitch-key-ink', undefined);
    setStyleValue(node.root, '--wui-harmony-age', undefined);
    setStyleValue(node.root, '--wui-pitch-weight', undefined);
    setText(node.mark, '');
    setHidden(node.mark, true);
  };

  const pass = (): void => {
    if (destroyed) return;
    text = readText(options.getText, options.onError);
    if (destroyed || !claim.isCurrent()) return;
    try {
      const state = binding.snapshot();
      if (destroyed || !claim.isCurrent()) return;
      const low = clamp(state.low, MIDI_FLOOR, MIDI_CEILING, 48);
      const high = clamp(state.high, MIDI_FLOOR, MIDI_CEILING, 84);
      const lo = Math.round(Math.min(low, high));
      const hi = Math.min(Math.round(Math.max(low, high)), lo + MAX_KEYBOARD_SPAN);
      const labelMode = state.labels ?? 'marked';
      const signature = `${lo}:${hi}`;
      if (signature !== boardSignature) {
        boardSignature = signature;
        rebuild(lo, hi);
        rulerSignature = '';
      }

      const octaves = state.octaveLabels ?? new Map<number, string>();
      const nextRuler = `${signature}|${[...octaves].map(([midi, text]) => `${midi}=${text}`).join(',')}`;
      if (nextRuler !== rulerSignature) {
        rulerSignature = nextRuler;
        rebuildRuler(lo, hi, octaves);
      }

      const next = new Map<number, Sounding>();
      const names: string[] = [];
      for (const mark of state.marks ?? []) {
        if (mark.active === false) continue;
        const midi = Math.round(mark.midi);
        if (!Number.isFinite(midi) || midi < lo || midi > hi) continue;
        next.set(midi, {
          role: mark.role,
          mark: mark.mark ?? (mark.role ? toneMark(mark.role) : undefined),
          label: mark.label,
          since: mark.since,
          weight: mark.weight,
        });
        if (mark.label) names.push(mark.label);
      }

      const at = now();
      for (const midi of sounding.keys()) {
        if (!next.has(midi)) releasing.set(midi, at);
      }
      let attacked = false;
      for (const midi of next.keys()) {
        if (sounding.has(midi)) continue;
        attacked = true;
        releasing.delete(midi);
      }

      const ghosts = new Set(
        (state.ghostPitchClasses ?? [])
          .filter((value) => Number.isFinite(value))
          .map((value) => ((Math.round(value) % 12) + 12) % 12),
      );

      for (const [midi, node] of keys) {
        const held = next.get(midi);
        if (held) {
          const wasHeld = sounding.has(midi);
          setData(node.root, 'active', 'true');
          setData(node.root, 'ghost', undefined);
          setData(node.root, 'role', held.role ?? 'other');
          if (!wasHeld) setData(node.root, 'phase', 'attack');
          else if (node.root.dataset.phase !== 'attack') setData(node.root, 'phase', 'sustain');
          setStyleValue(node.root, '--wui-pitch-key-face', toneFill(held.role));
          setStyleValue(node.root, '--wui-pitch-key-ink', toneInk(held.role));
          // `weight` is the caller's emphasis — a velocity, a confidence — and
          // it is SPENT, not merely accepted. A declared field nobody reads is a
          // promise the surface does not keep, which is the same objection the
          // module header raises about `since`. Full weight writes nothing, so
          // the sheet's own `data-active` opacity keeps the key it had.
          setStyleValue(node.root, '--wui-pitch-weight', markWeight(held.weight));
          setStyleValue(node.root, '--wui-pitch-key-wash', undefined);
          setStyleValue(node.root, '--wui-harmony-age', ageOf(state.now, held.since, ageSpan));
          // Both state channels the sheet owns through an attribute selector,
          // written onto the node for a host that has no sheet: how long the
          // pitch has been held, and the dip on release below.
          if (inline) setStyleValue(node.root, 'opacity', AGE_FADE);
          setText(node.mark, held.mark ?? '');
          setHidden(node.mark, !held.mark);
          paintLabel(node, labelMode, held.label, octaves.get(midi));
          continue;
        }

        setData(node.root, 'active', 'false');
        const fading = releasing.has(midi) && releaseMs > 0;
        if (fading) {
          setData(node.root, 'phase', 'release');
          if (!options.trail) {
            setData(node.root, 'role', undefined);
            setStyleValue(node.root, '--wui-pitch-key-face', undefined);
            setStyleValue(node.root, '--wui-pitch-key-ink', undefined);
          }
        } else {
          releasing.delete(midi);
          clearKey(node);
        }
        if (inline) setStyleValue(node.root, 'opacity', fading ? '.72' : undefined);
        const ghost = !fading && ghosts.has(((midi % 12) + 12) % 12);
        setData(node.root, 'ghost', ghost ? 'true' : undefined);
        setStyleValue(
          node.root,
          '--wui-pitch-key-wash',
          ghost ? `linear-gradient(${toneFill('ghost')}, ${toneFill('ghost')})` : undefined,
        );
        // The dashed edge is the ghost's channel for a reader who cannot see
        // the wash, so it follows the node when the sheet does not.
        if (inline) node.root.style.borderStyle = ghost ? 'dashed' : 'solid';
        if (!fading) paintLabel(node, labelMode, undefined, octaves.get(midi));
      }

      // Read layout only on an arrival. Repeated snapshots and releases leave
      // a manually scrolled viewport alone, including in follow mode.
      if (attacked && options.follow === 'active') pendingReveal = [...next.keys()];
      else pendingReveal = pendingReveal.filter((midi) => next.has(midi));
      reveal();
      scroll?.refresh();
      sounding = next;
      if (attacked) beat.settle(promote);
      armSweep();
      setLabel(root, options.label ?? describe(text?.description, 'Sounding', names, options.onError));
    } catch (error) {
      report(error);
    }
  };

  const updates = createUpdateLoop({
    name: 'Keyboard',
    pass,
    isCurrent: () => !destroyed && claim.isCurrent(),
    report,
  });
  const update = updates.run;

  const paintLabel = (
    node: KeyNode,
    mode: 'none' | 'marked' | 'white' | 'all',
    marked: string | undefined,
    fallback: string | undefined,
  ): void => {
    // The kit never invents a name: a key prints one only where the caller
    // supplied it, either on the mark or through the octave ruler's map.
    let text = '';
    if (mode === 'marked') text = marked ?? '';
    else if (mode === 'white') {
      const white = node.root.classList.contains('wui-pitch-keyboard__key--white');
      text = marked ?? (white ? (fallback ?? '') : '');
    } else if (mode === 'all') text = marked ?? fallback ?? '';
    setText(node.label, text);
    setAttr(node.label, 'title', text || undefined);
    setHidden(node.label, text === '');
  };

  const handle: KeyboardHandle = {
    element: root,
    board,
    key(midi: number): HTMLElement | undefined {
      return keys.get(Math.round(midi))?.root;
    },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      updates.cancel();
      beat.cancel();
      scroll?.destroy();
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

  // Claim the host before destroying the previous surface: its cleanup may
  // mount a replacement, and that replacement must win.
  const claim = claimHost(mountedKeyboards, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    // A re-entrant mount took the host while this one was appending; leave it
    // exactly as that mount left it.
    root.remove();
    style?.remove();
    return handle;
  }

  update();
  // `update()` runs the caller's `snapshot()`, and that may mount a replacement
  // into this very host — which destroys THIS handle before it owns anything to
  // unsubscribe. Subscribing afterwards would hand a teardown to a handle whose
  // `destroy()` has already run and now short-circuits, and nothing could ever
  // release it again.
  if (destroyed || !claim.isCurrent()) return handle;
  scroll?.start();
  if (binding.subscribe) {
    try {
      const stop = binding.subscribe(update);
      if (destroyed || !claim.isCurrent()) stop();
      else unsubscribe = stop;
    } catch (error) {
      report(error);
    }
  }
  return handle;
}

// ---------------------------------------------------------------------------
// The staff.
// ---------------------------------------------------------------------------

/**
 * The two pure helpers a caller needs before it can hand a surface anything.
 *
 * `staffPlacement` answers where a diatonic step sits and what it stands on;
 * `fretPositionsFor` answers every place inside a window that sounds one pitch.
 * Both are arithmetic — WHICH spelling and WHICH position are the caller's.
 */
export {staffPlacement, fretPositionsFor} from './internal/pitch-geometry';
export type {StaffAccidental, StaffSystem, StaffPlacement, FretPosition};

export interface StaffMark extends PitchMark {
  /**
   * The diatonic step: C0 = 0, D0 = 1 … B0 = 6, C1 = 7, middle C (C4) = 28.
   *
   * Required, and the caller's answer, because which line a note sits on
   * follows its SPELLING: F#4 and Gb4 are one key and two lines.
  */
  diatonic: number;
  /** The glyph to draw; omit when the key signature supplies it. MIDI identifies the pitch. */
  accidental?: StaffAccidental;
  /** Marks sharing a column stack into one chord. Defaults to 0. */
  column?: number;
}

export interface StaffState {
  marks: readonly StaffMark[];
  system?: StaffSystem;
  /**
   * The clef glyphs, as strings the caller owns. Omit them and the surface
   * draws no text at all — the kit positions a clef, it does not know one.
   */
  clefs?: {upper?: string; lower?: string};
  keySignature?: readonly {diatonic: number; accidental: StaffAccidental}[];
  columns?: number;
  activeColumn?: number;
  emptyLabel?: string;
  /**
   * `'anchor'` pins the active column at a fixed x and lets the columns flow
   * past it; `'none'` (the default) leaves every column where it was drawn.
   * The two produce the identical noteheads with the identical attributes —
   * only the reel's transform differs.
   */
  follow?: 'anchor' | 'none';
  now?: number;
}

export interface StaffBinding {
  snapshot(): StaffState;
  subscribe?(notify: () => void): () => void;
}

export interface StaffClassNames {
  root?: string;
  svg?: string;
}

export interface StaffParts {
  root?: string;
  svg?: string;
}

export interface StaffText {
  description?: UITextValue<{names: string}>;
}

export interface StaffOptions {
  /** Final text from application-owned presentation state; refreshed by update(). */
  getText?: () => StaffText;
  /** Outer surface, or no frame/background when a containing presenter owns it. Defaults to 'default'. */
  surface?: 'default' | 'none';
  label?: string;
  /** Where the pinned column sits, 0…1. Defaults to .35. Only for `follow: 'anchor'`. */
  anchor?: number;
  motion?: MotionMode;
  /**
   * How many of the caller's own units `--wui-harmony-age` spans. Defaults to 4.
   *
   * The same option, the same default and the same meaning on all three
   * surfaces: one pitch, one instant and two docks answering differently about
   * how long it has been held is the disagreement this family exists to avoid.
   */
  ageSpan?: number;
  classNames?: StaffClassNames;
  parts?: StaffParts;
  onError?: (error: unknown) => void;
  /**
   * The compact tier: same information, less room. A workbench packing six
   * surfaces into one column asks for it; a single surface on a page does not.
   */
  density?: HarmonyDensity;
  /** Pin the colour scheme instead of following the page. Defaults to inheriting it. */
  scheme?: HarmonyScheme;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface StaffHandle {
  element: HTMLElement;
  svg: SVGSVGElement;
  /**
   * The group drawn for one notehead, or nothing when it is not drawn. Where
   * two spellings share a step — C4 beside C#4 — this answers with the first,
   * which is the one the reader's eye lands on.
   */
  note(column: number, diatonic: number): SVGGElement | undefined;
  update(): void;
  destroy(): void;
}

const mountedStaves = new WeakMap<PitchHost, StaffHandle>();

/** Mount a passive staff read-out whose columns can flow past a fixed line. */
export function mountStaff(
  host: PitchHost,
  binding: StaffBinding,
  options: StaffOptions = {},
): StaffHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const style = installStyle(document, 'pitch', pitchStyle, options.stylesheet);
  const dress = dressing(options.stylesheet);
  const inline = options.stylesheet === false;
  const motion = resolveMotion(host, options.motion, view);
  const stepped = motion !== 'continuous';
  const anchor = Math.max(0, Math.min(1, options.anchor ?? 0.35));
  const ageSpan = options.ageSpan ?? DEFAULT_AGE_SPAN;

  const root = document.createElement('div');
  root.className = 'wui-pitch-staff';
  root.setAttribute('role', 'img');
  // See `mountKeyboard`: a `role="img"` whose first snapshot throws must still
  // have a name.
  setLabel(root, options.label ?? 'Staff');
  root.dataset.motion = motion;
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  // The two the caller can move, stamped so the sheet's own rules can see them
  // and repeated inline for a host that installed no sheet.
  if (options.density) root.dataset.density = options.density;
  if (options.scheme) root.dataset.scheme = options.scheme;
  dress(
    root,
    harmonyScheme[options.scheme ?? 'inherit'],
    harmonyTokens,
    harmonyDensity[options.density ?? 'comfortable'],
    pitchDensity[options.density ?? 'comfortable'],
    pitchParts.staffRoot,
  );
  if (options.surface === 'none') paint(root, embeddedSurfaceDeclarations);
  if (stepped) paint(root, harmonyMotion.reduced, PITCH_MOTION.reduced);

  const surface = svg(document, 'svg', {'aria-hidden': 'true', focusable: 'false'});
  surface.setAttribute('class', 'wui-pitch-staff__svg');
  surface.setAttribute('preserveAspectRatio', 'xMinYMid meet');
  addClassNames(surface, options.classNames?.svg);
  setParts(surface, 'svg', options.parts?.svg);
  dress(surface, pitchParts.staffSvg);

  const system = svg(document, 'g');
  system.setAttribute('class', 'wui-pitch-staff__system');
  const reel = svg(document, 'g');
  reel.setAttribute('class', 'wui-pitch-staff__reel');
  dress(reel, pitchParts.staffReel);
  surface.append(system, reel);
  root.append(surface);
  const scroll = pitchScroll(root, surface);

  const empty = document.createElement('p');
  empty.className = 'wui-pitch-staff__empty';
  empty.hidden = true;
  markEmptyState(empty);
  dress(empty, pitchParts.staffEmpty);
  root.append(empty);

  /**
   * One drawn notehead: the group the phase and the `data-*` live on, plus the
   * two children whose PAINT changes without their SHAPE changing.
   *
   * `shape` is the whole reason this is a record rather than a bare group.
   * Rebuilding a note's children on every repaint gives a replaced element no
   * previous computed style, so it can never transition — which is exactly the
   * failure the keyboard's node diffing was written to avoid, one level lower
   * down. A note is rebuilt when its GEOMETRY changes and repainted when only
   * its role does.
   */
  interface NoteNode {
    root: SVGGElement;
    head: SVGEllipseElement;
    accidental?: SVGPathElement;
    shape: string;
  }

  const notes = new Map<string, NoteNode>();
  let systemSignature = '';
  let held = new Set<string>();
  let destroyed = false;
  let text: StaffText | undefined;
  let unsubscribe: (() => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let viewportUnits = 0;
  let frameHeight = 0;

  const report = createErrorSink(options.onError);
  const beat = createBeat(view);

  const promote = (): void => {
    if (destroyed) return;
    for (const note of notes.values()) {
      if (note.root.getAttribute('data-phase') === 'attack') setData(note.root, 'phase', 'sustain');
    }
  };

  const drawSystem = (state: StaffState, width: number): void => {
    const name = state.system ?? 'grand';
    const signature = JSON.stringify([
      name,
      state.clefs?.upper ?? null,
      state.clefs?.lower ?? null,
      state.keySignature ?? null,
      width,
    ]);
    if (signature === systemSignature) return;
    systemSignature = signature;
    const children: SVGElement[] = [];
    const lines = staffLines(name);
    for (const step of lines) {
      const y = staffY(step);
      const line = svg(document, 'line', {
        x1: 0,
        y1: coordinate(y),
        x2: coordinate(width),
        y2: coordinate(y),
        stroke: STAFF_LINE,
        'stroke-width': 0.28,
      });
      line.setAttribute('class', 'wui-pitch-staff__line');
      line.setAttribute('data-diatonic', String(step));
      children.push(line);
    }
    if (name === 'grand') {
      const top = staffY(38);
      const bottom = staffY(18);
      const brace = svg(document, 'path', {
        d: `M1.6,${coordinate(top)} C-1.4,${coordinate(top + 4)} -1.4,${coordinate(bottom - 4)} 1.6,${coordinate(bottom)}`,
        fill: 'none',
        stroke: STAFF_LINE,
        'stroke-width': 0.5,
      });
      brace.setAttribute('class', 'wui-pitch-staff__brace');
      children.push(brace);
    }
    // A clef is the one shape this module will not invent. Given none, no text
    // node is created — which is what keeps the package free of notation.
    for (const [slot, glyph, step] of [
      ['upper', state.clefs?.upper, 34],
      ['lower', state.clefs?.lower, 22],
    ] as const) {
      if (!glyph) continue;
      if (slot === 'upper' && name === 'bass') continue;
      if (slot === 'lower' && name === 'treble') continue;
      const text = svg(document, 'text', {
        x: STAFF_CLEF_X,
        y: coordinate(staffY(step)),
        fill: STAFF_LINE,
        'dominant-baseline': 'middle',
        'font-size': 8,
      });
      text.setAttribute('class', 'wui-pitch-staff__clef');
      text.setAttribute('data-clef', slot);
      text.textContent = glyph;
      children.push(text);
    }
    // Each accidental advances the run by its OWN width, and the lead-in grew
    // to hold the total (see `leadIn` below). A fixed step and a fixed gutter
    // put a seven-flat signature through the first chord and its last two
    // flats off the right-hand edge of the drawing.
    let cursor = STAFF_SIGNATURE_X;
    for (const entry of state.keySignature ?? []) {
      const glyph = accidentalGlyph(entry.accidental);
      if (!glyph) continue;
      const x = cursor + glyph.width / 2;
      cursor += glyph.width;
      const node = svg(document, 'path', {
        d: glyph.path,
        transform: `translate(${coordinate(x)} ${coordinate(staffY(entry.diatonic))})`,
        fill: 'none',
        stroke: STAFF_LINE,
        'stroke-width': 0.3,
        'stroke-linecap': 'round',
      });
      node.setAttribute('class', 'wui-pitch-staff__signature');
      node.setAttribute('data-diatonic', String(entry.diatonic));
      children.push(node);
    }
    system.replaceChildren(...children);
  };

  /**
   * Draw or repaint one note.
   *
   * The shape signature is the whole point. `replaceChildren` on every repaint
   * hands the browser a brand-new ellipse with no previous computed style, and
   * an element with no previous style cannot transition — so the notehead's
   * colour would snap while the keyboard's fades, and a staff sitting still
   * would still allocate and discard every one of its own children twenty times
   * a second. Children are rebuilt when the GEOMETRY moves; a role change is
   * two guarded attribute writes on the nodes that are already there.
   */
  const drawNote = (
    note: NoteNode,
    mark: StaffMark,
    placement: StaffPlacement,
    column: number,
    offset: number,
    accidentalX: number | undefined,
  ): void => {
    const glyph = accidentalGlyph(mark.accidental);
    const shape = [
      coordinate(offset),
      coordinate(placement.y),
      placement.ledgers.join('.'),
      mark.accidental ?? '',
      glyph && accidentalX !== undefined ? coordinate(accidentalX) : '',
    ].join('|');
    if (note.shape !== shape) {
      note.shape = shape;
      const children: SVGElement[] = [];
      for (const step of placement.ledgers) {
        const ledger = svg(document, 'line', {
          x1: coordinate(offset - LEDGER_REACH),
          y1: coordinate(staffY(step)),
          x2: coordinate(offset + LEDGER_REACH),
          y2: coordinate(staffY(step)),
          stroke: STAFF_LINE,
          'stroke-width': 0.28,
        });
        ledger.setAttribute('class', 'wui-pitch-staff__ledger');
        ledger.setAttribute('data-diatonic', String(step));
        children.push(ledger);
      }
      setAttr(note.head, 'cx', coordinate(offset));
      setAttr(note.head, 'cy', coordinate(placement.y));
      setAttr(
        note.head,
        'transform',
        `rotate(-18 ${coordinate(offset)} ${coordinate(placement.y)})`,
      );
      children.push(note.head);
      if (glyph && accidentalX !== undefined) {
        const accidental =
          note.accidental ??
          (() => {
            const created = svg(document, 'path', {
              fill: 'none',
              'stroke-width': 0.3,
              'stroke-linecap': 'round',
            });
            created.setAttribute('class', 'wui-pitch-staff__accidental');
            dress(created, pitchParts.staffAccidental);
            note.accidental = created;
            return created;
          })();
        setAttr(accidental, 'd', glyph.path);
        setAttr(
          accidental,
          'transform',
          `translate(${coordinate(accidentalX)} ${coordinate(placement.y)})`,
        );
        children.push(accidental);
      }
      note.root.replaceChildren(...children);
    }
    // Paint, every time and guarded: this is the one thing that may change on a
    // note that did not move, and the one thing that has to be able to fade.
    setAttr(note.head, 'fill', toneFill(mark.role));
    if (glyph && note.accidental) setAttr(note.accidental, 'stroke', toneFill(mark.role));
    setData(note.root, 'column', String(column));
    setData(note.root, 'diatonic', String(Math.round(mark.diatonic)));
    setData(
      note.root,
      'midi',
      Number.isFinite(mark.midi) ? String(Math.round(mark.midi)) : undefined,
    );
    setData(note.root, 'role', mark.role ?? 'other');
    setData(note.root, 'active', mark.active === false ? 'false' : 'true');
  };

  const buildNote = (): NoteNode => {
    const node = svg(document, 'g');
    node.setAttribute('class', 'wui-pitch-staff__note');
    dress(node, pitchParts.staffNote);
    const head = svg(document, 'ellipse', {rx: NOTEHEAD_RX, ry: NOTEHEAD_RY});
    head.setAttribute('class', 'wui-pitch-staff__head');
    dress(head, pitchParts.staffHead);
    return {root: node, head, shape: ''};
  };

  const pass = (): void => {
    if (destroyed) return;
    text = readText(options.getText, options.onError);
    if (destroyed || !claim.isCurrent()) return;
    try {
      const state = binding.snapshot();
      if (destroyed || !claim.isCurrent()) return;
      const name = state.system ?? 'grand';
      const marks = (state.marks ?? []).filter((mark) => {
        if (typeof mark?.diatonic === 'number' && Number.isFinite(mark.diatonic)) return true;
        report(new Error('Staff mark has no diatonic step; the caller spells a pitch, the kit places it.'));
        return false;
      });
      const byColumn = new Map<number, StaffMark[]>();
      let widest = 0;
      for (const mark of marks) {
        const column = Math.max(0, whole(mark.column, 0));
        widest = Math.max(widest, column);
        const bucket = byColumn.get(column) ?? [];
        bucket.push(mark);
        byColumn.set(column, bucket);
      }
      // `columns` is a FLOOR — the room the caller wants reserved — and never a
      // cap. Read as an override it silently truncates: six marks in columns
      // 0…5 under `columns: 3` drew three noteheads and dropped the rest, and on
      // a conveyor the column that gets dropped is the one the now-line is on.
      // `MAX_STAFF_COLUMNS` is the only real ceiling.
      const columns = Math.min(
        MAX_STAFF_COLUMNS,
        Math.max(1, whole(state.columns, 0), widest + 1),
      );
      const active = Math.max(0, Math.min(columns - 1, whole(state.activeColumn, 0)));
      // The gutter holds the clef AND the signature, so it grows with the
      // signature. Seven flats need more than two flats' worth of room, and a
      // fixed nine half-spaces gave them the same.
      let signatureWidth = 0;
      for (const entry of state.keySignature ?? []) {
        signatureWidth += accidentalGlyph(entry?.accidental)?.width ?? 0;
      }
      const accidentalWidth = Math.max(0, ...[...byColumn.values()].map((bucket) =>
        bucket.reduce((width, mark) => width + (accidentalGlyph(mark.accidental)?.width ?? 0), 0),
      ));
      const leadIn = Math.max(STAFF_LEAD_IN, STAFF_SIGNATURE_X + signatureWidth + 1,
        STAFF_SIGNATURE_X + signatureWidth + accidentalWidth + NOTEHEAD_RX - STAFF_COLUMN_WIDTH / 2 + 1);
      const contentWidth = leadIn + columns * STAFF_COLUMN_WIDTH;

      const next = new Set<string>();
      const children: SVGGElement[] = [];
      let structural = false;
      let attacked = false;
      // What was actually DRAWN, so the frame can be grown to hold it. A staff
      // framed on its own five lines clips every note beyond a ledger or two,
      // and the clipping is invisible — the notes are emitted in full and the
      // viewport eats them.
      let highest = Number.POSITIVE_INFINITY;
      let lowest = Number.NEGATIVE_INFINITY;
      const pitchKey = (mark: StaffMark): string =>
        Number.isFinite(mark.midi)
          ? `midi:${Math.round(mark.midi)}`
          : `accidental:${mark.accidental ?? 'implicit'}`;
      for (let column = 0; column < columns; column += 1) {
        // A glyph is not an identity: the signature can supply an accidental
        // while a natural on the same step explicitly cancels it. Keep their
        // MIDI pitches separate, but let repeated unisons share one head.
        // Deduplicate before laying out heads and accidental spacing.
        const spellings = new Set<string>();
        const bucket = (byColumn.get(column) ?? [])
          .slice()
          .sort((a, b) => a.diatonic - b.diatonic)
          .filter((mark) => {
            const spelling = `${Math.round(mark.diatonic)}:${pitchKey(mark)}`;
            if (spellings.has(spelling)) return false;
            spellings.add(spelling);
            return true;
          });
        const centre = leadIn + (column + 0.5) * STAFF_COLUMN_WIDTH;
        let previousStep: number | undefined;
        let previousOffset = 0;
        // Accidentals stack leftwards from the COLUMN's own edge, each by its
        // own glyph's width. Measuring from a head that a second has already
        // displaced cancels the stagger — two sharps a step apart then land on
        // top of each other, which is what a constant step did.
        let lane = 0;
        const staggered = new Map<StaffMark, number>();
        for (const mark of bucket.slice().reverse()) {
          const glyph = accidentalGlyph(mark.accidental);
          if (!glyph) continue;
          lane += glyph.width;
          staggered.set(mark, centre - NOTEHEAD_RX - lane + glyph.width / 2);
        }
        for (const mark of bucket) {
          const step = Math.round(mark.diatonic);
          // A second cannot share a stem line, so the upper of the two moves
          // right by one head. Geometry, not theory — and a CHROMATIC pair is
          // the same geometry: C4 and C#4 sounding together are two heads on
          // one step, drawn side by side with an accidental each. Engravers
          // have always drawn them that way, and there is no spelling that
          // separates three consecutive semitones onto three letters, so
          // refusing the case would leave the stave the one surface that
          // disagrees with the keyboard about what is sounding.
          const offset =
            previousStep !== undefined &&
            step - previousStep <= 1 &&
            step - previousStep >= 0 &&
            previousOffset === 0
              ? centre + SECOND_OFFSET
              : centre;
          previousStep = step;
          previousOffset = offset - centre;
          // The FIRST head on a step keeps the plain key, so `handle.note()`
          // still answers for it; a different pitch on that step takes a key
          // of its own even when its accidental is supplied by the signature.
          const base = `${column}:${step}`;
          const key = next.has(base) ? `${base}:${pitchKey(mark)}` : base;
          if (next.has(key)) continue;
          next.add(key);
          let note = notes.get(key);
          if (!note) {
            note = buildNote();
            notes.set(key, note);
            structural = true;
            setData(note.root, 'phase', 'attack');
            attacked = true;
          }
          const placement = staffPlacement(mark.diatonic, name);
          drawNote(note, mark, placement, column, offset, staggered.get(mark));
          for (const y of [placement.y, ...placement.ledgers.map(staffY)]) {
            highest = Math.min(highest, y);
            lowest = Math.max(lowest, y);
          }
          const distance = column - active;
          const when =
            distance < 0 ? 'past' : distance === 0 ? 'now' : distance === 1 ? 'next' : 'far';
          setData(note.root, 'when', when);
          if (inline) setStyleValue(note.root, 'opacity', WHEN_OPACITY[when]);
          setStyleValue(note.root, '--wui-harmony-age', ageOf(state.now, mark.since, ageSpan));
          // See AGE_FADE: the notehead's `fill-opacity` reads both.
          setStyleValue(note.root, '--wui-pitch-weight', markWeight(mark.weight));
          children.push(note.root);
        }
      }
      for (const [key, note] of notes) {
        if (next.has(key)) continue;
        notes.delete(key);
        note.root.remove();
        structural = true;
      }
      if (structural || children.length !== held.size) reel.replaceChildren(...children);
      held = next;

      const lines = staffLines(name);
      const reach = Number.isFinite(highest) ? NOTE_REACH : 0;
      const top = Math.min(staffY(lines[0] ?? 38), highest - reach) - STAFF_MARGIN;
      const bottom =
        Math.max(staffY(lines[lines.length - 1] ?? 18), lowest + reach) + STAFF_MARGIN;
      frameHeight = bottom - top;
      // Grow the lines to the available width while preserving the existing
      // note/clef spacing. Scaling the SVG's content to fill would stretch
      // noteheads; a content-sized SVG leaves a lone chord on a tiny staff.
      const width = Math.max(contentWidth, viewportUnits + STAFF_LEFT);
      drawSystem(state, width);
      setAttr(
        surface,
        'viewBox',
        `${coordinate(STAFF_LEFT)} ${coordinate(top)} ${coordinate(width - STAFF_LEFT)} ${coordinate(bottom - top)}`,
      );
      // Half-spaces to pixels, in a `calc` rather than a number read back out
      // of the token: a custom property does not inherit in every environment
      // this runs in, and `parseFloat('')` is NaN.
      setStyleValue(surface, 'min-width', `calc(${STAFF_SPACE} * ${coordinate((contentWidth - STAFF_LEFT) / 2)})`);
      scroll.refresh();
      const height = `calc(${STAFF_SPACE} * ${coordinate((bottom - top) / 2)})`;
      if (surface.style.height !== height) surface.style.height = height;

      const activeX = leadIn + (active + 0.5) * STAFF_COLUMN_WIDTH;
      const shift = state.follow === 'anchor' ? anchor * width - activeX : 0;
      setAttr(reel, 'transform', `translate(${coordinate(shift)} 0)`);

      const message = state.emptyLabel ?? '';
      const showEmpty = marks.length === 0 && message !== '';
      setText(empty, showEmpty ? message : '');
      setHidden(empty, !showEmpty);

      if (attacked) beat.settle(promote);
      setLabel(
        root,
        options.label ??
          describe(
            text?.description, 'Staff',
            marks.map((mark) => mark.label).filter((label): label is string => Boolean(label)), options.onError,
          ),
      );
    } catch (error) {
      report(error);
    }
  };

  const updates = createUpdateLoop({
    name: 'Staff',
    pass,
    isCurrent: () => !destroyed && claim.isCurrent(),
    report,
  });
  const update = updates.run;

  const handle: StaffHandle = {
    element: root,
    svg: surface,
    note(column: number, diatonic: number): SVGGElement | undefined {
      return notes.get(`${Math.round(column)}:${Math.round(diatonic)}`)?.root;
    },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      updates.cancel();
      beat.cancel();
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      scroll.destroy();
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

  const claim = claimHost(mountedStaves, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    root.remove();
    style?.remove();
    return handle;
  }

  update();
  // `update()` runs the caller's `snapshot()`, and that may mount a replacement
  // into this very host — which destroys THIS handle before it owns anything to
  // unsubscribe. Subscribing afterwards would hand a teardown to a handle whose
  // `destroy()` has already run and now short-circuits, and nothing could ever
  // release it again.
  if (destroyed || !claim.isCurrent()) return handle;
  scroll.start();
  const ResizeObserverClass = view?.ResizeObserver;
  if (ResizeObserverClass) {
    try {
      resizeObserver = new ResizeObserverClass((entries) => {
        if (destroyed) return;
        const bounds = entries[entries.length - 1]?.contentRect;
        if (!bounds || bounds.width <= 0 || bounds.height <= 0 || frameHeight <= 0) return;
        const units = bounds.width / bounds.height * frameHeight;
        if (!Number.isFinite(units) || Math.abs(units - viewportUnits) < 0.01) return;
        viewportUnits = units;
        update();
      });
      resizeObserver.observe(surface);
    } catch (error) {
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      report(error);
    }
  }
  if (binding.subscribe) {
    try {
      const stop = binding.subscribe(update);
      if (destroyed || !claim.isCurrent()) stop();
      else unsubscribe = stop;
    } catch (error) {
      report(error);
    }
  }
  return handle;
}

// ---------------------------------------------------------------------------
// The fretboard.
// ---------------------------------------------------------------------------

export interface FretMark {
  /** 0 is the string drawn at the edge of the board. */
  stringIndex: number;
  /** 0 is the open string. */
  fret: number;
  /**
   * Which pitch this position sounds, if the caller knows.
   *
   * A neck needs only the string and the fret to draw a dot, so this is never
   * read for geometry. It is stamped as `data-midi`, which is the only way a
   * fretboard can be checked against a keyboard and a staff without something
   * re-deriving a guitar's tuning — and "the docks never disagree about a
   * sounding pitch" is the claim this whole module exists to keep.
   */
  midi?: number;
  role?: ToneRole;
  /** The caller's spelling, or a role abbreviation. */
  label?: string;
  mark?: string;
  finger?: string;
  active?: boolean;
  since?: number;
  weight?: number;
  id?: string;
}

export interface FretboardBarre {
  fret: number;
  fromString: number;
  toString: number;
}

export interface FretboardState {
  strings?: number;
  /**
   * The lowest fret in view, or `'auto'` to frame the marks.
   *
   * `'auto'` is arithmetic, not judgement: WHICH position a hand should take is
   * the caller's answer, and this only frames the one already chosen. It keeps
   * a window that still holds every mark, so a shape alternating between the
   * two ends of a window does not drag the neck back and forth.
   */
  firstFret?: number | 'auto';
  fretCount?: number;
  marks: readonly FretMark[];
  /** Strings marked as not sounding. A mark on the same string wins. */
  muted?: readonly number[];
  stringLabels?: readonly string[];
  inlays?: readonly number[];
  orientation?: 'horizontal' | 'vertical';
  emptyLabel?: string;
  /** Geometry, not theory: the caller says which strings a bar covers. */
  barre?: readonly FretboardBarre[];
  now?: number;
}

export interface FretboardBinding {
  snapshot(): FretboardState;
  subscribe?(notify: () => void): () => void;
}

export interface FretboardClassNames {
  root?: string;
  svg?: string;
}

export interface FretboardParts {
  root?: string;
  svg?: string;
}

export interface FretboardText {
  description?: UITextValue<{names: string}>;
  fret?: UITextValue<{value: string; fret: number}>;
}

export interface FretboardOptions {
  /** Final text from application-owned presentation state; refreshed by update(). */
  getText?: () => FretboardText;
  formatters?: UIValueFormatters;
  /** Exact adjacent-fret spacing in CSS px; absent/invalid retains responsive spacing. */
  fretWidth?: number;
  /** Exact adjacent-string spacing in CSS px; absent/invalid retains density geometry. */
  stringSpacing?: number;
  /** String stroke width in CSS px, independent of the viewport scale. */
  stringWidth?: number;
  /** Outer surface, or no frame/background when a containing presenter owns it. Defaults to 'default'. */
  surface?: 'default' | 'none';
  label?: string;
  motion?: MotionMode;
  /** Release tail in ms. Defaults to 140, and to 0 in a reduced motion mode. */
  release?: number;
  /** How many of the caller's own units `--wui-harmony-age` spans. Defaults to 4. */
  ageSpan?: number;
  classNames?: FretboardClassNames;
  parts?: FretboardParts;
  onError?: (error: unknown) => void;
  /**
   * The compact tier: same information, less room. A workbench packing six
   * surfaces into one column asks for it; a single surface on a page does not.
   */
  density?: HarmonyDensity;
  /** Pin the colour scheme instead of following the page. Defaults to inheriting it. */
  scheme?: HarmonyScheme;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface FretboardHandle {
  element: HTMLElement;
  svg: SVGSVGElement;
  /** The group drawn for one stopped position, or nothing when it is not drawn. */
  dot(stringIndex: number, fret: number): SVGGElement | undefined;
  update(): void;
  destroy(): void;
}

const DEFAULT_STRINGS = 6;
const MAX_STRINGS = 12;
/** Room before the nut for the open and muted markers, in neck units. */
const FRET_LEAD = FRET_UNIT;
const NECK_PAD = 10;

/**
 * Where the string names sit, in neck units: one whole fret out, which is one
 * lane beyond the open and muted markers at `-FRET_LEAD * 0.55`, so the two
 * never collide on a string that is both named and muted — and still inside the
 * frame, whose near edge is `-FRET_LEAD - NECK_PAD / 2`.
 */
const FRET_LABEL_GUTTER = -FRET_LEAD;

/** Dot geometry stays fixed as the responsive neck expands its fret spacing. */
const DOT_RADIUS = 4.4;
const DOT_TEXT_SIZE = 6.2;
/** Stroke on an OPEN string's ring — see the dot loop on why it is a ring. */
const DOT_RING_WIDTH = 1.2;

const mountedFretboards = new WeakMap<PitchHost, FretboardHandle>();

/** Mount a passive fretboard read-out whose window slides to follow the hand. */
export function mountFretboard(
  host: PitchHost,
  binding: FretboardBinding,
  options: FretboardOptions = {},
): FretboardHandle {
  const document = host.ownerDocument;
  const view = document.defaultView;
  const style = installStyle(document, 'pitch', pitchStyle, options.stylesheet);
  const dress = dressing(options.stylesheet);
  const motion = resolveMotion(host, options.motion, view);
  const stepped = motion !== 'continuous';
  const releaseMs = stepped ? 0 : Math.max(0, options.release ?? DEFAULT_RELEASE_MS);
  const ageSpan = options.ageSpan ?? DEFAULT_AGE_SPAN;
  const fretWidth = positivePixels(options.fretWidth);
  const stringSpacing = positivePixels(options.stringSpacing);
  const stringWidth = positivePixels(options.stringWidth);
  const explicitGeometry = fretWidth !== undefined || stringSpacing !== undefined;
  const geometryUnit = options.density === 'compact' ? 2 : 2.2;
  const stringGap = stringSpacing === undefined ? STRING_GAP : stringSpacing / geometryUnit;
  // Requested string spacing moves centres, never shrinks circular marks or
  // their rings. Edge clearance therefore has an independent lower bound.
  const acrossPadding = Math.max(stringGap * 1.1, DOT_RADIUS + DOT_RING_WIDTH / 2,
    stringWidth === undefined ? 0 : stringWidth / (2 * geometryUnit));

  const root = document.createElement('div');
  root.className = 'wui-pitch-fretboard';
  root.setAttribute('role', 'img');
  // See `mountKeyboard`: a `role="img"` whose first snapshot throws must still
  // have a name.
  setLabel(root, options.label ?? 'Fretboard');
  root.dataset.motion = motion;
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);
  // The two the caller can move, stamped so the sheet's own rules can see them
  // and repeated inline for a host that installed no sheet.
  if (options.density) root.dataset.density = options.density;
  if (options.scheme) root.dataset.scheme = options.scheme;
  dress(
    root,
    harmonyScheme[options.scheme ?? 'inherit'],
    harmonyTokens,
    harmonyDensity[options.density ?? 'comfortable'],
    pitchDensity[options.density ?? 'comfortable'],
    pitchParts.fretboardRoot,
  );
  if (options.surface === 'none') paint(root, embeddedSurfaceDeclarations);
  if (stepped) paint(root, harmonyMotion.reduced, PITCH_MOTION.reduced);

  const surface = svg(document, 'svg', {'aria-hidden': 'true', focusable: 'false'});
  surface.setAttribute('class', 'wui-pitch-fretboard__svg');
  surface.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  addClassNames(surface, options.classNames?.svg);
  setParts(surface, 'svg', options.parts?.svg);
  dress(surface, pitchParts.fretboardSvg);

  const reel = svg(document, 'g');
  reel.setAttribute('class', 'wui-pitch-fretboard__reel');
  dress(reel, pitchParts.fretboardReel);
  // An open string is a fact about a STRING, not about a place on the neck, so
  // its marker lives outside the sliding reel beside the mute markers. Riding
  // the reel, it ended up behind a nut that a third-position window should not
  // have been drawing in the first place, and off the board entirely as soon as
  // the frame had no slack to leak into.
  const open = svg(document, 'g');
  open.setAttribute('class', 'wui-pitch-fretboard__open');
  const gutter = svg(document, 'g');
  gutter.setAttribute('class', 'wui-pitch-fretboard__gutter');
  surface.append(reel, open, gutter);
  root.append(surface);
  const scroll = pitchScroll(root, surface);

  const empty = document.createElement('p');
  empty.className = 'wui-pitch-fretboard__empty';
  empty.hidden = true;
  markEmptyState(empty);
  dress(empty, pitchParts.fretboardEmpty);
  root.append(empty);

  const neck = svg(document, 'g');
  neck.setAttribute('class', 'wui-pitch-fretboard__neck');
  const bars = svg(document, 'g');
  bars.setAttribute('class', 'wui-pitch-fretboard__bars');
  const dots = svg(document, 'g');
  dots.setAttribute('class', 'wui-pitch-fretboard__dots');
  reel.append(neck, bars, dots);

  const placed = new Map<string, SVGGElement>();
  const releasing = new Map<string, number>();
  let held = new Set<string>();
  let neckSignature = '';
  let barsSignature = '';
  let gutterSignature = '';
  let window_ = 0;
  let neckScale = 1;
  let viewportUnits = 0;
  let frameAcrossSpan = 0;
  let verticalFrame = false;
  let resizeObserver: ResizeObserver | undefined;
  let destroyed = false;
  let text: FretboardText | undefined;
  let unsubscribe: (() => void) | undefined;

  const report = createErrorSink(options.onError);
  const beat = createBeat(view);
  const now = (): number => view?.performance?.now?.() ?? Date.now();

  /** Neck space to view space. The ONLY thing orientation changes. */
  const map = (along: number, across: number, vertical: boolean): [number, number] =>
    vertical ? [across, along * (explicitGeometry ? neckScale : 1)] : [along * neckScale, across];
  const fixedMap = (along: number, across: number, vertical: boolean): [number, number] =>
    vertical ? [across, along] : [along, across];

  const line = (
    className: string,
    from: [number, number],
    to: [number, number],
    stroke: string,
    width: number,
  ): SVGLineElement => {
    const node = svg(document, 'line', {
      x1: coordinate(from[0]),
      y1: coordinate(from[1]),
      x2: coordinate(to[0]),
      y2: coordinate(to[1]),
      stroke,
      'stroke-width': width,
      'stroke-linecap': 'round',
    });
    node.setAttribute('class', className);
    return node;
  };

  const drawNeck = (
    strings: number,
    firstWire: number,
    lastFret: number,
    inlays: readonly number[],
    vertical: boolean,
  ): void => {
    const signature = `${strings}:${firstWire}:${lastFret}:${vertical}:${neckScale}:${inlays.join(',')}`;
    if (signature === neckSignature) return;
    neckSignature = signature;
    const across = (strings - 1) * stringGap;
    const alongStart = fretWireX(firstWire);
    const alongEnd = fretWireX(lastFret);
    const children: SVGElement[] = [];

    const [rx, ry] = fixedMap(alongStart * neckScale - FRET_LEAD, -stringGap * 0.4, vertical);
    const [rw, rh] = fixedMap((alongEnd - alongStart) * neckScale + FRET_LEAD, across + stringGap * 0.8, vertical);
    const surfaceRect = svg(document, 'rect', {
      x: coordinate(rx),
      y: coordinate(ry),
      width: coordinate(rw),
      height: coordinate(rh),
      fill: FRET_NECK,
    });
    surfaceRect.setAttribute('class', 'wui-pitch-fretboard__wood');
    children.push(surfaceRect);

    // Only the window is built. Building the whole neck from the nut and then
    // sliding it left leaves the nut and the frets behind it alive outside the
    // frame, where a letterboxed viewport paints them: a third-position box
    // that shows a nut is not a guitar.
    for (let fret = firstWire; fret <= lastFret; fret += 1) {
      const along = fretWireX(fret);
      const wire = line(
        fret === 0 ? 'wui-pitch-fretboard__nut' : 'wui-pitch-fretboard__wire',
        map(along, 0, vertical),
        map(along, across, vertical),
        fret === 0 ? FRET_NUT : FRET_WIRE,
        fret === 0 ? 1.6 : 0.7,
      );
      wire.setAttribute('data-fret', String(fret));
      children.push(wire);
    }
    for (let index = 0; index < strings; index += 1) {
      const at = index * stringGap;
      const string = line(
        'wui-pitch-fretboard__string',
        fixedMap(alongStart * neckScale - FRET_LEAD, at, vertical),
        map(alongEnd, at, vertical),
        FRET_STRING,
        stringWidth ?? 0.5,
      );
      if (stringWidth !== undefined) string.setAttribute('vector-effect', 'non-scaling-stroke');
      string.setAttribute('data-string', String(index));
      children.push(string);
    }
    for (const fret of inlays) {
      if (!Number.isFinite(fret) || fret <= firstWire || fret > lastFret) continue;
      const [cx, cy] = map(fretDotX(fret), across / 2, vertical);
      const inlay = svg(document, 'circle', {
        cx: coordinate(cx),
        cy: coordinate(cy),
        r: 1.8,
        fill: FRET_INLAY,
      });
      inlay.setAttribute('class', 'wui-pitch-fretboard__inlay');
      inlay.setAttribute('data-fret', String(Math.round(fret)));
      children.push(inlay);
    }
    neck.replaceChildren(...children);
  };

  const buildDot = (): SVGGElement => {
    const node = svg(document, 'g');
    node.setAttribute('class', 'wui-pitch-fretboard__dot');
    dress(node, pitchParts.fretboardDot);
    const disc = svg(document, 'circle', {r: DOT_RADIUS});
    disc.setAttribute('class', 'wui-pitch-fretboard__disc');
    dress(disc, pitchParts.fretboardDisc);
    const text = svg(document, 'text', {
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': DOT_TEXT_SIZE,
    });
    text.setAttribute('class', 'wui-pitch-fretboard__mark');
    node.append(disc, text);
    return node;
  };

  /** Arm the sweep for the EARLIEST outstanding release. See the keyboard's. */
  const armSweep = (): void => {
    if (releaseMs <= 0 || releasing.size === 0) return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const at of releasing.values()) earliest = Math.min(earliest, at);
    beat.sweep(sweep, earliest + releaseMs - now());
  };

  const sweep = (): void => {
    if (destroyed) return;
    const cutoff = now() - releaseMs;
    for (const [key, at] of [...releasing]) {
      if (at > cutoff) continue;
      releasing.delete(key);
      const node = placed.get(key);
      if (node) {
        placed.delete(key);
        node.remove();
      }
    }
    armSweep();
  };

  const promote = (): void => {
    if (destroyed) return;
    for (const node of placed.values()) {
      if (node.getAttribute('data-phase') === 'attack') setData(node, 'phase', 'sustain');
    }
  };

  const pass = (): void => {
    if (destroyed) return;
    text = readText(options.getText, options.onError);
    if (destroyed || !claim.isCurrent()) return;
    try {
      const state = binding.snapshot();
      if (destroyed || !claim.isCurrent()) return;
      const vertical = state.orientation === 'vertical';
      const strings = Math.max(1, Math.min(MAX_STRINGS, whole(state.strings, DEFAULT_STRINGS)));
      const fretCount = Math.max(
        1,
        Math.min(MAX_FRET_COUNT, whole(state.fretCount, DEFAULT_FRET_COUNT)),
      );
      const marks = (state.marks ?? []).filter(
        (mark) =>
          mark &&
          Number.isFinite(mark.stringIndex) &&
          Number.isFinite(mark.fret) &&
          mark.stringIndex >= 0 &&
          mark.stringIndex < strings,
      );
      const sounding = marks.filter((mark) => mark.active !== false);

      window_ =
        state.firstFret === 'auto'
          ? resolveFretWindow({
              frets: sounding.map((mark) => Math.round(mark.fret)),
              fretCount,
              previous: window_,
            })
          : Math.max(0, Math.min(MAX_FIRST_FRET, whole(state.firstFret, 0)));

      // The window's own wires: one below its lowest fret, so that fret has a
      // space to sit in, and its highest fret closes it. At the nut there is no
      // wire below, and the lead before it holds the open and mute markers.
      const firstWire = Math.max(0, window_ - 1);
      const lastFret = window_ + fretCount;
      frameAcrossSpan = (strings - 1) * stringGap + acrossPadding * 2;
      verticalFrame = vertical;
      const fretSpan = fretWireX(lastFret) - fretWireX(firstWire);
      const labelWidth = Math.max(0, ...(state.stringLabels ?? []).slice(0, strings).map((name) => name.length * 3));
      const gutterExtra = vertical ? 0 : Math.max(0, labelWidth + 1 - NECK_PAD / 2);
      neckScale = fretWidth !== undefined ? fretWidth / (FRET_UNIT * geometryUnit)
        : vertical ? 1 : Math.max(1, (viewportUnits - FRET_LEAD - NECK_PAD - gutterExtra) / fretSpan);
      drawNeck(strings, firstWire, lastFret, state.inlays ?? [], vertical);

      // A mark the window cannot hold is not drawn small, it is drawn OFF the
      // neck: at `firstFret: 5, fretCount: 5` a mark at fret 99 emits
      // `cx="1576"` inside a 122-unit viewBox. The clip hides it, but it is
      // still a node in the DOM and it still counted itself into the accessible
      // sentence — a chord read-out naming a note nobody can see. An OPEN string
      // is exempt: it is drawn in the lead before the nut, which no window moves.
      const drawn = sounding.filter((mark) => {
        const fret = Math.round(mark.fret);
        return fret <= 0 || (fret >= window_ && fret <= lastFret);
      });

      const across = (strings - 1) * stringGap;
      const at = now();
      const next = new Set<string>();
      let structural = false;
      let attacked = false;
      const necked: SVGElement[] = [];
      const opened: SVGElement[] = [];
      const stow = (node: SVGGElement, fret: number): void => {
        (fret <= 0 ? opened : necked).push(node);
      };

      // A bar is geometry the caller hands over whole, so it is rebuilt on its
      // own signature rather than diffed: there is no phase to preserve on it.
      const barreSignature = JSON.stringify([
        vertical,
        strings,
        neckScale,
        (state.barre ?? []).map((bar) => [bar?.fret, bar?.fromString, bar?.toString]),
      ]);
      if (barreSignature !== barsSignature) {
        barsSignature = barreSignature;
        const items: SVGElement[] = [];
        for (const bar of state.barre ?? []) {
          if (!bar || !Number.isFinite(bar.fret)) continue;
          const from = Math.max(0, Math.min(strings - 1, whole(bar.fromString, 0)));
          const to = Math.max(0, Math.min(strings - 1, whole(bar.toString, 0)));
          const lo = Math.min(from, to);
          const hi = Math.max(from, to);
          const [x1, y1] = map(fretDotX(bar.fret), lo * stringGap, vertical);
          const [x2, y2] = map(fretDotX(bar.fret), hi * stringGap, vertical);
          const node = line('wui-pitch-fretboard__barre', [x1, y1], [x2, y2], toneFill('other'), 6);
          node.setAttribute('data-fret', String(whole(bar.fret, 0)));
          node.setAttribute('data-from-string', String(lo));
          node.setAttribute('data-to-string', String(hi));
          items.push(node);
        }
        bars.replaceChildren(...items);
      }

      for (const mark of drawn) {
        const stringIndex = Math.round(mark.stringIndex);
        const fret = Math.round(mark.fret);
        const key = `${stringIndex}:${fret}`;
        if (next.has(key)) continue;
        next.add(key);
        releasing.delete(key);
        let node = placed.get(key);
        if (!node) {
          node = buildDot();
          placed.set(key, node);
          structural = true;
          setData(node, 'phase', 'attack');
          attacked = true;
        } else if (!held.has(key)) {
          setData(node, 'phase', 'attack');
          attacked = true;
        }
        const [cx, cy] = (fret <= 0 ? fixedMap : map)(fretDotX(fret), stringIndex * stringGap, vertical);
        const disc = node.firstElementChild as SVGCircleElement | null;
        const text = node.lastElementChild as SVGTextElement | null;
        // Guarded, like every other write in this module: six unconditional
        // attribute writes per dot per repaint is the whole idle cost of a
        // board that did not change.
        // An OPEN string is a RING and a stopped one a filled disc. That is the
        // distinction every chord chart in print makes, and drawing both as
        // filled discs loses the one fact a player reads first: which strings
        // the left hand is not on. The ring carries the role colour on its
        // stroke, so the greyscale channel survives either way.
        const open = fret <= 0;
        if (disc) {
          setAttr(disc, 'cx', coordinate(cx));
          setAttr(disc, 'cy', coordinate(cy));
          setAttr(disc, 'fill', open ? 'none' : toneFill(mark.role));
          setAttr(disc, 'stroke', open ? toneFill(mark.role) : undefined);
          setAttr(disc, 'stroke-width', open ? String(DOT_RING_WIDTH) : undefined);
        }
        if (text) {
          setAttr(text, 'x', coordinate(cx));
          setAttr(text, 'y', coordinate(cy));
          // Inside a filled disc the mark reads against the fill; inside a ring
          // there is no fill to read against, so it takes the role's own colour.
          setAttr(text, 'fill', open ? toneFill(mark.role) : toneInk(mark.role));
          const printed = mark.mark ?? (mark.role ? toneMark(mark.role) : '');
          setText(text, mark.finger ?? printed);
        }
        setData(node, 'string', String(stringIndex));
        setData(node, 'fret', String(fret));
        setData(
          node,
          'midi',
          Number.isFinite(mark.midi) ? String(Math.round(mark.midi as number)) : undefined,
        );
        setData(node, 'role', mark.role ?? 'other');
        setData(node, 'active', 'true');
        setStyleValue(node, '--wui-harmony-age', ageOf(state.now, mark.since, ageSpan));
        setStyleValue(node, '--wui-pitch-weight', markWeight(mark.weight));
        stow(node, fret);
      }

      for (const [key, node] of [...placed]) {
        if (next.has(key)) continue;
        if (releaseMs > 0) {
          if (!releasing.has(key)) {
            releasing.set(key, at);
            setData(node, 'active', 'false');
            setData(node, 'phase', 'release');
          }
          stow(node, Number(key.slice(key.indexOf(':') + 1)));
          continue;
        }
        placed.delete(key);
        node.remove();
        structural = true;
      }
      if (structural || necked.length !== dots.childElementCount) {
        dots.replaceChildren(...necked);
      }
      if (structural || opened.length !== open.childElementCount) {
        open.replaceChildren(...opened);
      }
      held = next;

      // A muted string is a fact about a string, so it lives in the fixed
      // gutter rather than in the sliding neck: a window at the fifth fret must
      // not take the mute markers with it.
      const stringsWithMarks = new Set(drawn.map((mark) => Math.round(mark.stringIndex)));
      const muted = (state.muted ?? [])
        .map((index) => whole(index, -1))
        .filter(
          (index) =>
            Number.isFinite(index) &&
            index >= 0 &&
            index < strings &&
            !stringsWithMarks.has(index),
        );
      // The tuning is part of the gutter's signature: change `stringLabels` and
      // the names beside the strings have to be redrawn with the crosses.
      const stringLabels = state.stringLabels ?? [];
      const nextGutter =
        `${strings}:${vertical}:${window_}:${muted.join(',')}` +
        `:${stringLabels.slice(0, strings).join(',')}`;
      if (nextGutter !== gutterSignature) {
        gutterSignature = nextGutter;
        const items: SVGElement[] = [];
        for (const index of muted) {
          const [x, y] = fixedMap(-FRET_LEAD * 0.55, index * stringGap, vertical);
          const glyph = svg(document, 'text', {
            x: coordinate(x),
            y: coordinate(y),
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
            'font-size': 5,
            fill: INK_MUTED,
          });
          glyph.setAttribute('class', 'wui-pitch-fretboard__muted');
          glyph.setAttribute('data-string', String(index));
          // U+00D7, a latin multiplication sign — not a notation character.
          glyph.textContent = '×';
          items.push(glyph);
        }
        // The tuning, printed at the edge of the board. A caller that hands over
        // `stringLabels` gets them DRAWN and not merely spoken: the names went
        // into the accessible sentence and nowhere else, so a sighted reader had
        // no way to tell a drop-D diagram from a standard one. They ride in the
        // fixed gutter, never in the sliding reel, so they stay put as the
        // window moves up the neck.
        for (let index = 0; index < strings; index += 1) {
          const name = stringLabels[index];
          if (typeof name !== 'string' || name === '') continue;
          const [lx, ly] = fixedMap(FRET_LABEL_GUTTER, index * stringGap, vertical);
          const glyph = svg(document, 'text', {
            x: coordinate(lx),
            y: coordinate(ly),
            'font-family': FONT_MONO,
            'text-anchor': vertical ? 'middle' : 'end',
            'dominant-baseline': 'central',
            'font-size': 5,
            fill: INK_MUTED,
          });
          glyph.setAttribute('class', 'wui-pitch-fretboard__label');
          glyph.setAttribute('data-string', String(index));
          glyph.textContent = name;
          items.push(glyph);
        }
        const [nx, ny] = fixedMap(-FRET_LEAD * 0.55, -stringGap * 0.75, vertical);
        const number = svg(document, 'text', {
          x: coordinate(nx),
          y: coordinate(ny),
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'font-size': 5,
          fill: INK_MUTED,
        });
        number.setAttribute('class', 'wui-pitch-fretboard__fret-number');
        // `5fr`, the way a chord book writes it, and not a bare `5` that reads
        // as a fingering or a string number beside two of each.
        number.textContent = window_ > 0 ? textValue(text?.fret, `${formatNumber(options.formatters, window_, undefined, options.onError)}fr`, {value: formatNumber(options.formatters, window_, undefined, options.onError), fret: window_}, options.onError) : '';
        items.push(number);
        gutter.replaceChildren(...items);
      }

      const fretLabel = gutter.querySelector('.wui-pitch-fretboard__fret-number');
      if (fretLabel) setText(fretLabel, window_ > 0 ? textValue(text?.fret, `${formatNumber(options.formatters, window_, undefined, options.onError)}fr`, {value: formatNumber(options.formatters, window_, undefined, options.onError), fret: window_}, options.onError) : '');

      // The frame follows what the neck actually SPANS after the slide, so the
      // board fills its box at every window. A frame sized for the widest case
      // left a fret and a half of bare ground beside a nut-position board and
      // none beside any other, which reads as the neck growing when the window
      // leaves the nut.
      const alongMin = -FRET_LEAD - NECK_PAD / 2 - gutterExtra;
      const baseAlongSpan = FRET_LEAD + fretSpan + NECK_PAD + gutterExtra;
      const alongSpan = FRET_LEAD + fretSpan * neckScale + NECK_PAD + gutterExtra;
      // Wide enough for the gutter's own text: the fret number sits three
      // quarters of a string gap clear of the first string, and at `0.9` its
      // glyph box crossed the edge of the frame by a whole unit.
      const acrossMin = -acrossPadding;
      const acrossSpan = across + acrossPadding * 2;
      const [vx, vy] = fixedMap(alongMin, acrossMin, vertical);
      const [vw, vh] = fixedMap(alongSpan, acrossSpan, vertical);
      setAttr(
        surface,
        'viewBox',
        `${coordinate(vx)} ${coordinate(vy)} ${coordinate(vw)} ${coordinate(vh)}`,
      );
      // A minimum CSS length per geometry unit preserves glyphs in narrow
      // containers. Extra horizontal room expands fret spacing, never circles.
      const acrossSize = `max(${FRETBOARD_HEIGHT}, calc(${FRETBOARD_UNIT} * ${coordinate(acrossSpan)}))`;
      if (explicitGeometry) {
        const pixelWidth = vw * geometryUnit;
        const pixelHeight = vh * geometryUnit;
        const fixedWidth = vertical || fretWidth !== undefined;
        setStyleValue(surface, 'width', fixedWidth ? `${coordinate(pixelWidth)}px` : '100%');
        setStyleValue(surface, 'min-width', fixedWidth ? `${coordinate(pixelWidth)}px` : `${coordinate(baseAlongSpan * geometryUnit)}px`);
        setStyleValue(surface, 'height', `${coordinate(pixelHeight)}px`);
        setAttr(surface, 'width', coordinate(pixelWidth));
        setAttr(surface, 'height', coordinate(pixelHeight));
      } else {
        setStyleValue(surface, 'width', vertical ? acrossSize : '100%');
        setStyleValue(surface, 'min-width', vertical ? acrossSize
          : `max(calc(${FRETBOARD_HEIGHT} * ${coordinate(baseAlongSpan / acrossSpan)}), calc(${FRETBOARD_UNIT} * ${coordinate(baseAlongSpan)}))`);
        setStyleValue(surface, 'height', vertical
          ? `calc(${acrossSize} * ${coordinate(alongSpan / acrossSpan)})` : acrossSize);
      }
      scroll.refresh();

      const slide = -fretWireX(firstWire);
      const [tx, ty] = map(slide, 0, vertical);
      setAttr(reel, 'transform', `translate(${coordinate(tx)} ${coordinate(ty)})`);

      const message = state.emptyLabel ?? '';
      const showEmpty = drawn.length === 0 && message !== '';
      setText(empty, showEmpty ? message : '');
      setHidden(empty, !showEmpty);

      if (attacked) beat.settle(promote);
      armSweep();
      setLabel(
        root,
        options.label ??
          describe(
            text?.description, 'Fretboard',
            drawn
              .map((mark) => mark.label ?? state.stringLabels?.[Math.round(mark.stringIndex)])
              .filter((label): label is string => Boolean(label)), options.onError,
          ),
      );
    } catch (error) {
      report(error);
    }
  };

  const updates = createUpdateLoop({
    name: 'Fretboard',
    pass,
    isCurrent: () => !destroyed && claim.isCurrent(),
    report,
  });
  const update = updates.run;

  const handle: FretboardHandle = {
    element: root,
    svg: surface,
    dot(stringIndex: number, fret: number): SVGGElement | undefined {
      return placed.get(`${Math.round(stringIndex)}:${Math.round(fret)}`);
    },
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      updates.cancel();
      beat.cancel();
      scroll.destroy();
      resizeObserver?.disconnect();
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

  const claim = claimHost(mountedFretboards, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    root.remove();
    style?.remove();
    return handle;
  }

  update();
  // `update()` runs the caller's `snapshot()`, and that may mount a replacement
  // into this very host — which destroys THIS handle before it owns anything to
  // unsubscribe. Subscribing afterwards would hand a teardown to a handle whose
  // `destroy()` has already run and now short-circuits, and nothing could ever
  // release it again.
  if (destroyed || !claim.isCurrent()) return handle;
  scroll.start();
  const Observer = view?.ResizeObserver;
  if (Observer) {
    resizeObserver = new Observer((entries) => {
      if (destroyed || verticalFrame || fretWidth !== undefined) return;
      const bounds = entries[entries.length - 1]?.contentRect;
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
      const units = bounds.width / bounds.height * frameAcrossSpan;
      if (!Number.isFinite(units) || Math.abs(units - viewportUnits) < 0.01) return;
      viewportUnits = units;
      update();
    });
    resizeObserver.observe(surface);
  }
  if (binding.subscribe) {
    try {
      const stop = binding.subscribe(update);
      if (destroyed || !claim.isCurrent()) stop();
      else unsubscribe = stop;
    } catch (error) {
      report(error);
    }
  }
  return handle;
}
