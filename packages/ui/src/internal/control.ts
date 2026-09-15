/**
 * Canonical geometry for the controls inside a presenter.
 *
 * `componentSurfaceDeclarations` already shares the outer card; this is the
 * same treatment one layer in. A button, a seek bar, a slider thumb and a level
 * readout that sit in one strip have to resolve to ONE number, or the strip
 * stops reading as a strip — a 8px pill beside a 32px button is the shape this
 * exists to prevent. The transport has always worked this way
 * (`--wui-transport-height` in styles.ts); these helpers are that chain,
 * generalized, so a presenter cannot quietly invent a second control height.
 *
 * Two axes are deliberately NOT governed here:
 *
 * - A **travel axis**. A vertical fader's length is its resolution, not a row
 *   height; its thickness is the axis this governs and it already matches.
 * - A **drawing surface**. An envelope, an EQ curve, a waveform or a keyboard
 *   has an aspect ratio, not a control height. Those use {@link surfaceHeight}.
 *
 * The `--wui-row-h` step is inherited from the transport and is why a host that
 * sets its own row height already re-sizes the shipped control; keeping it here
 * extends that reach to every presenter instead of only one.
 *
 * String builders only: nothing here reads a browser global.
 */

/** Height of a control that shares a row with a button. */
export const controlHeight = (component: string): string =>
  `var(--wm-${component}-height, var(--wm-control-size, var(--wui-row-h, 2rem)))`;

/** Corner radius of a control surface or a bar. Square by default, by design. */
export const controlRadius = (component: string): string =>
  `var(--wm-${component}-radius, var(--wm-control-radius, 0))`;

/**
 * Corner radius of a slider thumb. Separate from {@link controlRadius} so a
 * theme can round a card without rounding the handle that slides along it.
 */
export const controlThumbRadius = (component: string): string =>
  `var(--wm-${component}-thumb-radius, var(--wm-control-radius, 0))`;

/**
 * The three drawing-surface heights.
 *
 * A curve, a waveform or a keyboard needs room, and the amount of room is an
 * editorial choice rather than a per-presenter accident: before this scale the
 * kit shipped 48, 60, 120, 140 and 160px, five numbers that agreed with nothing.
 * A presenter names the tier its drawing needs; a caller overrides either the
 * tier for every surface at once, or that one presenter's height with any
 * length it likes.
 */
export type SurfaceScale = 'sm' | 'md' | 'lg';

const SURFACE_DEFAULTS: Readonly<Record<SurfaceScale, string>> = {
  sm: '72px',
  md: '144px',
  lg: '216px',
};

/** Height of a drawing surface, resolved through its scale tier. */
export const surfaceHeight = (component: string, scale: SurfaceScale): string =>
  `var(--wm-${component}-height, var(--wm-surface-${scale}, ${SURFACE_DEFAULTS[scale]}))`;
