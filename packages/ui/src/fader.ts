import {addClassNames, clamp01, setParts} from './internal/dom';
import {mountSurfaceSlider, type SurfaceSliderHandle} from './stage';

/**
 * The kit's shared level control: a painted track with a fill and a block
 * handle, running on a `0…1` scale in either orientation.
 *
 * It is a primitive, not a presenter — no binding, no subscription, no domain
 * state. The caller places {@link FaderHandle.element}, repaints it from its
 * own state through {@link FaderHandle.paint}, and receives every move through
 * `onInput`.
 *
 * The control is drawn from plain elements rather than a native range input,
 * for one reason: a native slider's handle can only be styled through
 * `::-webkit-slider-thumb` and friends, which a light-DOM host that installs no
 * stylesheet cannot reach. Every box here is positioned with inline geometry
 * and coloured through `--wm-fader-*` custom properties, so the control looks
 * the same whether or not a stylesheet is present. Pointer, keyboard and ARIA
 * behaviour come from the kit's own {@link mountSurfaceSlider}.
 */

export interface FaderClassNames {
  root?: string;
  fill?: string;
  thumb?: string;
}

export type FaderParts = FaderClassNames;

export interface FaderOptions {
  /** Accessible name of the slider. */
  label: string;
  /** Starting level, clamped to `0…1`. Defaults to `1`. */
  value?: number;
  /** Track direction. Defaults to `vertical`. */
  orientation?: 'vertical' | 'horizontal';
  /** Start disabled. Later changes go through {@link FaderHandle.paint}. */
  disabled?: boolean;
  /** Arrow-key step, as a fraction of the range. Defaults to `0.05`. */
  keyboardStep?: number;
  /** Compatibility classes added alongside the canonical `wui-fader*` names. */
  classNames?: FaderClassNames;
  /** Additional CSS part tokens added alongside the canonical part names. */
  parts?: FaderParts;
  /** Receives the clamped `0…1` level on every move of the control. */
  onInput?: (value: number) => void;
  /** Receives pointer, keyboard and cleanup failures. */
  onError?: (error: unknown) => void;
}

export interface FaderHandle {
  /** The slider itself: the focusable, labelled track. */
  element: HTMLDivElement;
  /** The painted fill. */
  fill: HTMLSpanElement;
  /** The handle riding the fill's edge. */
  thumb: HTMLSpanElement;
  /** The level the control currently shows. */
  readonly value: number;
  /** Repaint from the owner's state, without emitting `onInput`. */
  paint: (value: number, disabled?: boolean) => void;
  /** Release the slider's listeners and ARIA. */
  destroy: () => void;
}

/**
 * What inline geometry cannot express: focus and disabled affordances. Hosts
 * that install a stylesheet get them; hosts that do not still get a correct,
 * themeable control.
 */
export const faderStyle = String.raw`
.wui-fader:focus-visible {
  outline: 2px solid var(--wm-focus, var(--wm-foreground, #111));
  outline-offset: 2px;
}

.wui-fader[aria-disabled='true'] {
  opacity: 0.45;
  cursor: default;
}
`;

const TRACK = 'var(--wm-fader-track, var(--wm-surface-muted, #f3f3f3))';
/**
 * No outline by default: a fader is a filled track, the same as the transport's
 * seek bar it sits beside. A caller that wants one asks for it — the mixer's
 * strips do, through `--wm-mixer-track-border`.
 */
const TRACK_BORDER = 'var(--wm-fader-track-border, transparent)';
const FILL = 'var(--wm-fader-fill, var(--wm-accent, #999))';
const THUMB = 'var(--wm-fader-thumb, var(--wm-foreground, #111))';
const HANDLE = 'var(--wm-fader-handle, 10px)';
const RADIUS = 'var(--wm-fader-radius, var(--wm-control-radius, 0))';

/**
 * Build one fader. The caller owns the returned nodes and must call
 * {@link FaderHandle.destroy} to release the slider behaviour.
 */
export function createFader(document: Document, options: FaderOptions): FaderHandle {
  const horizontal = options.orientation === 'horizontal';
  let level = clamp01(options.value ?? 1);
  let disabled = options.disabled === true;

  const element = document.createElement('div');
  element.className = `wui-fader${horizontal ? ' wui-fader--horizontal' : ''}`;
  addClassNames(element, options.classNames?.root);
  setParts(element, 'fader', options.parts?.root);
  element.style.position = 'relative';
  element.style.boxSizing = 'border-box';
  element.style.flex = '0 0 auto';
  element.style.width = horizontal
    ? 'var(--wm-fader-length, 4.5rem)'
    : 'var(--wm-fader-width, 2rem)';
  element.style.height = horizontal
    // A horizontal fader sits in a control row, so its default thickness is
    // the row's own height rather than a number of its own: 14px next to a 2rem
    // transport read as a different family of control.
    ? 'var(--wm-fader-thickness, var(--wm-control-size, 2rem))'
    : 'var(--wm-fader-height, 96px)';
  element.style.border = `1px solid ${TRACK_BORDER}`;
  element.style.borderRadius = RADIUS;
  element.style.background = TRACK;
  element.style.overflow = 'hidden';
  element.style.cursor = 'pointer';
  element.style.touchAction = 'none';

  const fill = document.createElement('span');
  fill.className = 'wui-fader__fill';
  addClassNames(fill, options.classNames?.fill);
  setParts(fill, 'fader-fill', options.parts?.fill);
  fill.style.position = 'absolute';
  fill.style.background = FILL;
  fill.style.pointerEvents = 'none';

  const thumb = document.createElement('span');
  thumb.className = 'wui-fader__thumb';
  addClassNames(thumb, options.classNames?.thumb);
  setParts(thumb, 'fader-thumb', options.parts?.thumb);
  thumb.style.position = 'absolute';
  thumb.style.background = THUMB;
  thumb.style.pointerEvents = 'none';

  if (horizontal) {
    fill.style.left = '0';
    fill.style.top = '0';
    fill.style.bottom = '0';
    thumb.style.top = '0';
    thumb.style.bottom = '0';
    thumb.style.width = HANDLE;
  } else {
    fill.style.left = '0';
    fill.style.right = '0';
    fill.style.bottom = '0';
    thumb.style.left = '0';
    thumb.style.right = '0';
    thumb.style.height = HANDLE;
  }
  element.append(fill, thumb);

  const paintPixels = (): void => {
    const percent = `${(level * 100).toFixed(1)}%`;
    // Kept in step for callers that would rather paint from CSS than geometry.
    element.style.setProperty('--wui-fader-fill', percent);
    if (horizontal) {
      fill.style.width = percent;
      // `calc` keeps the whole handle inside the track at both ends.
      thumb.style.left = `calc(${percent} - ${HANDLE} * ${level.toFixed(3)})`;
    } else {
      fill.style.height = percent;
      thumb.style.bottom = `calc(${percent} - ${HANDLE} * ${level.toFixed(3)})`;
    }
  };

  let slider: SurfaceSliderHandle | undefined;
  const paint = (value: number, nextDisabled?: boolean): void => {
    level = clamp01(value);
    if (nextDisabled !== undefined) disabled = nextDisabled;
    paintPixels();
    // Re-reads the snapshot below, which repaints role/value/disabled ARIA.
    slider?.update();
  };

  paintPixels();
  slider = mountSurfaceSlider(
    element,
    {
      snapshot: () => ({minimum: 0, maximum: 1, value: level, disabled}),
      valueAt: (point) =>
        horizontal
          ? point.x / (point.rect.width || 1)
          : 1 - point.y / (point.rect.height || 1),
      commit: (value) => {
        const next = clamp01(value);
        // Paint from the control's own move first: the owner may reject it, and
        // its next paint() puts the handle back.
        paint(next);
        options.onInput?.(next);
      },
    },
    {
      label: options.label,
      orientation: horizontal ? 'horizontal' : 'vertical',
      keyboardStep: options.keyboardStep ?? 0.05,
      formatValue: (value) => `${Math.round(value * 100)}%`,
      onError: options.onError,
    },
  );

  return {
    element,
    fill,
    thumb,
    get value() {
      return level;
    },
    paint,
    destroy() {
      slider?.destroy();
      slider = undefined;
    },
  };
}
