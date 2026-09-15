import {faderStyle} from './fader';
import {knobStyle} from './knob';
import {componentSurfaceDeclarations} from './internal/surface';
import {controlHeight, controlRadius, controlThumbRadius} from './internal/control';

/**
 * Canonical transport tokens and presenter styles — declared ONCE.
 *
 * The transport has to look right two ways: installed as a stylesheet, and
 * painted inline for a light-DOM host that cannot install one without the
 * rules escaping into the whole page. Those used to be two hand-kept copies of
 * the same design, one here and one inlined by the score package's facade, and
 * every visual change had to land in both. Removing a border from the seek bar
 * took two files, in two packages, in two vocabularies.
 *
 * So the box is data. {@link transportTokens} and {@link transportParts} are
 * the single source; the stylesheet below is generated from them, and
 * `mountTransport` paints the same declarations onto the same nodes when it is
 * mounted with `stylesheet: false`.
 *
 * What stays CSS-only is what inline styles cannot express: `:host`, the
 * pseudo-elements of the native range, and every state selector. A host with no
 * stylesheet must install `transportStateStyle` separately for keyboard focus
 * and disabled feedback; the preset facade does so alongside inline geometry.
 *
 * The module is still data only: nothing here reads a browser global.
 */

/** One rule's worth of declarations, in CSS property spelling. */
export type Declarations = Readonly<Record<string, string>>;

/**
 * The `--wui-*` layer: every value the parts below paint with, resolved from
 * the `--cp-*` compatibility layer, then the public `--wm-*` tokens, then the
 * kit's own fallbacks. A consumer overrides at whichever level it owns.
 */
export const transportTokens: Declarations = {
  '--wui-transport-height': `var(--cp-height, ${controlHeight('transport')})`,
  '--wui-transport-button-width': 'var(--cp-button-width, var(--wui-transport-height))',
  '--wui-transport-button-height': 'var(--cp-button-height, var(--wui-transport-height))',
  '--wui-transport-track-height': 'var(--cp-track-height, var(--wui-transport-height))',
  '--wui-transport-gap': 'var(--cp-gap, var(--wm-control-gap, var(--wui-gap, 0.6rem)))',
  '--wui-transport-button-bg':
    'var(--cp-button-bg, var(--wm-transport-button-background, var(--wm-accent, var(--wui-ink, #111))))',
  '--wui-transport-button-color':
    'var(--cp-button-color, var(--wm-transport-button-foreground, var(--wm-accent-foreground, var(--wui-on-ink, #fff))))',
  '--wui-transport-button-border':
    'var(--cp-button-border, var(--wm-transport-border, var(--wm-border, var(--wui-line-control, #111))))',
  '--wui-transport-track':
    'var(--cp-track, var(--wm-transport-track, var(--wm-surface-muted, var(--wui-inset, #f3f3f3))))',
  '--wui-transport-fill':
    'var(--cp-fill, var(--wm-transport-fill, var(--wm-accent, var(--wui-fill, #999))))',
  '--wui-transport-thumb':
    'var(--cp-thumb, var(--wm-transport-thumb, var(--wm-foreground, var(--wui-pointer, #111))))',
  '--wui-transport-text':
    'var(--cp-text, var(--wm-transport-foreground, var(--wm-foreground-muted, var(--wm-foreground, var(--wui-ink-soft, #444)))))',
  '--wui-transport-radius': `var(--cp-radius, ${controlRadius('transport')})`,
  '--wui-transport-thumb-radius': `var(--cp-thumb-radius, ${controlThumbRadius('transport')})`,
  '--wui-transport-handle': 'var(--cp-seek-handle, var(--wm-transport-handle-size, 0.9rem))',
  '--wui-transport-font':
    'var(--cp-font, 0.85rem/1.2 var(--wm-font-family, system-ui, sans-serif))',
  '--wui-transport-time-font':
    'var(--cp-time-font, 0.72rem/1.2 var(--wm-font-mono, var(--wui-font-mono, ui-monospace, monospace)))',
};

/**
 * The box each node carries. Keys are CSS property names, so the same record
 * feeds a rule body and `style.setProperty`.
 */
export const transportParts = {
  root: {
    ...componentSurfaceDeclarations('transport'),
    display: 'flex',
    'flex-wrap': 'wrap',
    'align-items': 'center',
    gap: 'var(--wui-transport-gap)',
    width: '100%',
    'min-width': '0',
    'max-width': '100%',
    color: 'var(--wui-transport-text)',
    font: 'var(--wui-transport-font)',
  },
  play: {
    appearance: 'none',
    'box-sizing': 'border-box',
    display: 'inline-flex',
    'align-items': 'center',
    'justify-content': 'center',
    flex: '0 0 auto',
    width: 'var(--wui-transport-button-width)',
    height: 'var(--wui-transport-button-height)',
    padding: '0',
    margin: '0',
    border: '1px solid var(--wui-transport-button-border)',
    'border-radius': 'var(--wui-transport-radius)',
    background: 'var(--wui-transport-button-bg)',
    color: 'var(--wui-transport-button-color)',
    cursor: 'pointer',
  },
  // The fader and the knob paint themselves from these; the transport only
  // says which of its own tokens feed them. Thickness stays the row's height,
  // so the control reads as part of the same strip.
  volume: {
    'max-width': '100%',
    '--wm-fader-length': 'var(--cp-volume-width, var(--wm-transport-volume-width, 4.5rem))',
    '--wm-fader-thickness': 'var(--cp-volume-height, var(--wui-transport-track-height))',
    '--wm-fader-fill': 'var(--wui-transport-fill)',
    '--wm-fader-track': 'var(--wui-transport-track)',
    '--wm-fader-thumb': 'var(--cp-volume-thumb, var(--wui-transport-thumb))',
    '--wm-fader-radius': 'var(--wui-transport-radius)',
    '--wm-knob-size': 'var(--cp-volume-size, var(--wui-transport-track-height))',
    '--wm-knob-track': 'var(--wui-transport-track)',
    '--wm-knob-arc': 'var(--wui-transport-fill)',
    '--wm-knob-pointer': 'var(--cp-volume-thumb, var(--wui-transport-thumb))',
  },
  track: {
    'box-sizing': 'border-box',
    // Reserve a usable scrub target before optional controls wrap. Percentage
    // bounds let even a smaller host contain its track without page overflow.
    flex: '1 1 6rem',
    'min-width': 'min(6rem, 100%)',
    'max-width': '100%',
    height: 'var(--wui-transport-track-height)',
    margin: '0',
    // No outline: the track reads as a filled bar, not a boxed one.
    border: '0',
    'border-radius': 'var(--wui-transport-radius)',
    background: 'var(--wui-transport-track)',
    overflow: 'hidden',
  },
  surface: {
    position: 'relative',
    cursor: 'pointer',
    'touch-action': 'none',
  },
  // No `width` here: the fill's is a VALUE, written every frame by
  // `paintProgress`, not a box declaration. Declaring it as well would put one
  // number in two places, which is what the rest of this module exists to stop.
  fill: {
    display: 'block',
    height: '100%',
    margin: '0',
    background: 'var(--wui-transport-fill)',
    'pointer-events': 'none',
  },
  seek: {
    appearance: 'none',
    '-webkit-appearance': 'none',
    'box-sizing': 'border-box',
    display: 'block',
    width: '100%',
    height: '100%',
    margin: '0',
    border: '0',
    'border-radius': '0',
    background:
      'linear-gradient(to right, var(--wui-transport-fill) 0, var(--wui-transport-fill) var(--wui-progress, var(--cp-fill-pct, 0%)), transparent var(--wui-progress, var(--cp-fill-pct, 0%)))',
    cursor: 'pointer',
  },
  time: {
    display: 'flex',
    'flex-wrap': 'wrap',
    'justify-content': 'flex-end',
    flex: '0 1 auto',
    'min-width': '0',
    'max-width': '100%',
    color: 'var(--wui-transport-text)',
    font: 'var(--wui-transport-time-font)',
    'font-variant-numeric': 'tabular-nums',
    'text-align': 'right',
  },
  timeSegment: {'white-space': 'nowrap'},
} satisfies Readonly<Record<string, Declarations>>;

/** The name of a part the transport can paint. */
export type TransportPart = keyof typeof transportParts;

const body = (...groups: Declarations[]): string =>
  groups
    .flatMap((group) => Object.entries(group))
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');

const rule = (selector: string, ...groups: Declarations[]): string =>
  `${selector} {\n${body(...groups)}\n}`;

/**
 * What inline declarations cannot reach: the host, the native range's
 * pseudo-elements, and every state selector.
 */
const transportStructureStyle = String.raw`
:host(:not([hidden])) {
  display: block;
}

.wui-transport__play svg {
  display: block;
  width: 1.1rem;
  height: 1.1rem;
  fill: currentColor;
}

.wui-transport__seek::-webkit-slider-runnable-track {
  height: 100%;
  border: 0;
  background: transparent;
}

.wui-transport__seek::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: var(--wui-transport-handle);
  height: var(--wui-transport-track-height);
  margin: 0;
  border: 0;
  border-radius: var(--wui-transport-thumb-radius);
  background: var(--wui-transport-thumb);
}

.wui-transport__seek::-moz-range-track {
  height: 100%;
  border: 0;
  background: transparent;
}

.wui-transport__seek::-moz-range-thumb {
  width: var(--wui-transport-handle);
  height: var(--wui-transport-track-height);
  border: 0;
  border-radius: var(--wui-transport-thumb-radius);
  background: var(--wui-transport-thumb);
}
`;

/** Focus and disabled feedback for transports using inline geometry. No host or layout rules. */
export const transportStateStyle = [faderStyle, knobStyle, String.raw`
.wui-transport__play:focus-visible,
.wui-transport__track:focus-within,
.wui-transport__track[role="slider"]:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--wm-focus, var(--wui-focus, var(--wui-ink, #111)));
  outline-offset: 2px;
}

.wui-transport__seek:focus-visible {
  outline: none;
}

.wui-transport__play:disabled,
.wui-transport__seek:disabled {
  opacity: 0.45;
  cursor: default;
}

.wui-transport__track[aria-disabled="true"] { opacity: 0.45; cursor: default; }
`].join('\n\n');

export const transportStyle = [
  transportStructureStyle,
  transportStateStyle,
  rule('.wui-transport', transportTokens, transportParts.root),
  rule('.wui-transport__play', transportParts.play),
  rule('.wui-transport__volume', transportParts.volume),
  rule('.wui-transport__track', transportParts.track),
  rule('.wui-transport__surface', transportParts.surface),
  rule('.wui-transport__fill', transportParts.fill),
  rule('.wui-transport__seek', transportParts.seek),
  rule('.wui-transport__time', transportParts.time),
  rule('.wui-transport__time-elapsed, .wui-transport__time-total', transportParts.timeSegment),
].join('\n\n');
