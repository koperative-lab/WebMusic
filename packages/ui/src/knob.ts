import {addClassNames, clamp01, setParts} from './internal/dom';
import {mountSurfaceSlider, type SurfaceSliderHandle} from './stage';

/**
 * The kit's shared rotary control: a painted arc with a pointer, running on a
 * `0…1` scale.
 *
 * The knob to {@link createFader}'s fader, and built the same way and for the
 * same reason: plain nodes with inline geometry, so a light-DOM host that
 * installs no stylesheet still gets a correct, themeable control. Pointer,
 * keyboard and ARIA come from {@link mountSurfaceSlider}.
 *
 * `mountParameterRack` draws its own knobs and keeps doing so. Theirs is a
 * different mechanism — an invisible native `<input type="range">` under an
 * SVG, with the geometry in the rack's stylesheet — and it works there because
 * a rack always installs that sheet. Folding the two together would mean
 * giving one of them the other's interaction model, which is a change to how a
 * shipped control behaves, not a de-duplication.
 */

export interface KnobClassNames {
  root?: string;
  track?: string;
  arc?: string;
  pointer?: string;
}

export type KnobParts = KnobClassNames;

export interface KnobOptions {
  /** Accessible name of the control. */
  label: string;
  /** Human-readable value; machine ARIA values remain numeric. */
  formatValue?: (fraction: number) => string;
  /** Starting level, clamped to `0…1`. Defaults to `1`. */
  value?: number;
  /** Start disabled. Later changes go through {@link KnobHandle.paint}. */
  disabled?: boolean;
  /** Arrow-key step, as a fraction of the range. Defaults to `0.05`. */
  keyboardStep?: number;
  /** Compatibility classes added alongside the canonical `wui-knob*` names. */
  classNames?: KnobClassNames;
  /** Additional CSS part tokens added alongside the canonical part names. */
  parts?: KnobParts;
  /** Receives the clamped `0…1` level on every move of the control. */
  onInput?: (value: number) => void;
  /** Receives pointer, keyboard and cleanup failures. */
  onError?: (error: unknown) => void;
}

export interface KnobHandle {
  /** The control itself: the focusable, labelled dial. */
  element: HTMLDivElement;
  /** The unfilled arc behind the value. */
  track: SVGPathElement;
  /** The filled arc. */
  arc: SVGPathElement;
  /** The line marking the current value. */
  pointer: SVGLineElement;
  /** The level the control currently shows. */
  readonly value: number;
  /** Repaint from the owner's state, without emitting `onInput`. */
  paint: (value: number, disabled?: boolean) => void;
  updateLabel: (label: string) => void;
  /** Release the slider's listeners and ARIA. */
  destroy: () => void;
}

/**
 * What inline geometry cannot express: focus and disabled affordances.
 */
export const knobStyle = String.raw`
.wui-knob:focus-visible {
  outline: 2px solid var(--wm-focus, var(--wm-foreground, #111));
  outline-offset: 2px;
}

.wui-knob[aria-disabled='true'] {
  opacity: 0.45;
  cursor: default;
}
`;

const TRACK = 'var(--wm-knob-track, var(--wm-surface-muted, #f3f3f3))';
const ARC = 'var(--wm-knob-arc, var(--wm-accent, #999))';
const POINTER = 'var(--wm-knob-pointer, var(--wm-foreground, #111))';

/** Degrees of dead zone at the bottom, split either side of six o'clock. */
const GAP = 90;
/** The usable sweep, from `-135°` to `+135°` measured from twelve o'clock. */
const SWEEP = 360 - GAP;

const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * The 36×36 user space the dial is drawn in: `C` is its centre and `RIM` its
 * edge. The arc's centreline sits half a stroke inside the rim, so at the
 * default 6-wide stroke the painted edge lands exactly on `RIM` and the dial
 * fills its box with nothing around it. A caller who thickens the stroke past
 * the default trades that flush edge for the extra weight.
 */
const C = 18;
const RIM = 18;
const R = RIM - 3;

/**
 * A point on the dial at `radius` from the centre, in that same user space.
 * Defaults to the arc's centreline.
 */
function polar(fraction: number, radius: number = R): {x: number; y: number} {
  const radians = ((-SWEEP / 2 + fraction * SWEEP) * Math.PI) / 180;
  return {x: C + radius * Math.sin(radians), y: C - radius * Math.cos(radians)};
}

/** The arc path from `0` up to `fraction`, or the whole track at `1`. */
function arcPath(fraction: number): string {
  const from = polar(0);
  const to = polar(Math.max(fraction, 0.0001));
  const large = fraction * SWEEP > 180 ? 1 : 0;
  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
}

/**
 * Build one knob. The caller places {@link KnobHandle.element} and must call
 * {@link KnobHandle.destroy} to release the control's behaviour.
 */
export function createKnob(document: Document, options: KnobOptions): KnobHandle {
  let level = clamp01(options.value ?? 1);
  let disabled = options.disabled === true;

  const element = document.createElement('div');
  element.className = 'wui-knob';
  addClassNames(element, options.classNames?.root);
  setParts(element, 'knob', options.parts?.root);
  element.style.position = 'relative';
  element.style.boxSizing = 'border-box';
  element.style.flex = '0 0 auto';
  element.style.width = 'var(--wm-knob-size, 2.25rem)';
  element.style.height = 'var(--wm-knob-size, 2.25rem)';
  element.style.cursor = 'pointer';
  element.style.touchAction = 'none';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.display = 'block';
  svg.style.overflow = 'visible';

  const stroke = 'var(--wm-knob-thickness, 6)';
  const track = document.createElementNS(SVG_NS, 'path');
  track.setAttribute('d', arcPath(1));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', TRACK);
  track.setAttribute('stroke-width', stroke);
  track.setAttribute('stroke-linecap', 'butt');
  track.setAttribute('class', 'wui-knob__track');
  addClassNames(track, options.classNames?.track);
  setParts(track, 'knob-track', options.parts?.track);

  const arc = document.createElementNS(SVG_NS, 'path');
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', ARC);
  arc.setAttribute('stroke-width', stroke);
  arc.setAttribute('stroke-linecap', 'butt');
  arc.setAttribute('class', 'wui-knob__arc');
  addClassNames(arc, options.classNames?.arc);
  setParts(arc, 'knob-arc', options.parts?.arc);

  const pointer = document.createElementNS(SVG_NS, 'line');
  pointer.setAttribute('stroke', POINTER);
  pointer.setAttribute('stroke-width', 'var(--wm-knob-pointer-width, 3)');
  pointer.setAttribute('stroke-linecap', 'butt');
  pointer.setAttribute('class', 'wui-knob__pointer');
  addClassNames(pointer, options.classNames?.pointer);
  setParts(pointer, 'knob-pointer', options.parts?.pointer);

  svg.append(track, arc, pointer);
  element.append(svg);

  const paintPixels = (): void => {
    arc.setAttribute('d', arcPath(level));
    // A full radius: dead centre out to the rim, crossing the arc on the way.
    const tip = polar(level, RIM);
    pointer.setAttribute('x1', String(C));
    pointer.setAttribute('y1', String(C));
    pointer.setAttribute('x2', tip.x.toFixed(2));
    pointer.setAttribute('y2', tip.y.toFixed(2));
    // Kept in step for callers that would rather paint from CSS than geometry.
    element.style.setProperty('--wui-knob-value', `${(level * 100).toFixed(1)}%`);
  };

  let slider: SurfaceSliderHandle | undefined;
  const paint = (value: number, nextDisabled?: boolean): void => {
    level = clamp01(value);
    if (nextDisabled !== undefined) disabled = nextDisabled;
    paintPixels();
    slider?.update();
  };

  paintPixels();
  slider = mountSurfaceSlider(
    element,
    {
      snapshot: () => ({minimum: 0, maximum: 1, value: level, disabled}),
      // A dial is read by ANGLE, not by how far down the box the pointer is:
      // over a 36px control an absolute vertical mapping gives the whole range
      // in a couple of finger-widths. Angle needs no relative-drag mode in
      // `mountSurfaceSlider`, which has no concept of one.
      valueAt: (point) => {
        const cx = point.rect.width / 2;
        const cy = point.rect.height / 2;
        const degrees = (Math.atan2(point.x - cx, cy - point.y) * 180) / Math.PI;
        return (degrees + SWEEP / 2) / SWEEP;
      },
      commit: (value) => {
        const next = clamp01(value);
        paint(next);
        options.onInput?.(next);
      },
    },
    {
      label: options.label,
      orientation: 'vertical',
      keyboardStep: options.keyboardStep ?? 0.05,
      formatValue: options.formatValue ?? ((value) => `${Math.round(value * 100)}%`),
      onError: options.onError,
    },
  );

  return {
    element,
    track,
    arc,
    pointer,
    get value() {
      return level;
    },
    paint,
    updateLabel: (label) => slider?.updateLabel(label),
    destroy() {
      slider?.destroy();
      slider = undefined;
    },
  };
}
