/**
 * The kit's icon and icon-button vocabulary, from Visual design
 * (dev/design/VISUAL-DESIGN.md#icons and #controls).
 *
 * Icons are inline SVG on a 24-unit grid drawn at 16px with a 1.5
 * `currentColor` stroke, square caps and mitred joins, and are hidden from
 * assistive technology: the button carries the name in `aria-label` and
 * `title`. Unicode glyphs (▶ ⏸ ⏹ ⏮ ⏭ ●) are not icons — several render as
 * colour emoji on Apple platforms and none follow the stroke weight.
 *
 * String builders and one DOM factory; nothing here reads a browser global.
 */

/** Path data for the icons more than one presenter draws. A presenter keeps its own private shapes. */
export const ICON_PATHS = Object.freeze({
  play: '<path d="M7 5v14l11-7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<path d="M6 6h12v12H6z"/>',
  record: '<path d="M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12z"/>',
  previous: '<path d="M6 5v14"/><path d="M18 5L9 12l9 7z"/>',
  next: '<path d="M18 5v14"/><path d="M6 5l9 7-9 7z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/>',
  freeze: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>',
  reset: '<path d="M5 12a7 7 0 1 0 2-5"/><path d="M5 4v4h4"/>',
  clear: '<path d="M6 6l12 12M18 6L6 18"/>',
  hold: '<path d="M4 20V9M10 20V5M16 20v-7M22 20V9"/><path d="M8 3h4M14 11h4"/>',
  keyboard: '<path d="M3 6h18v12H3z"/><path d="M7 10h0M11 10h0M15 10h0M8 14h8"/>',
  rising: '<path d="M3 17h6l6-10h6"/>',
  falling: '<path d="M3 7h6l6 10h6"/>',
  both: '<path d="M3 12h4l5-7 5 14 4-7h0"/>',
});

/** Inline-SVG markup for an icon (for builders that set innerHTML). */
export function iconMarkup(paths: string): string {
  return `<svg data-icon viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter">${paths}</svg>`;
}

/** A stroke icon element ready to append to a button. */
export function strokeIcon(document: Document, paths: string): SVGSVGElement {
  const holder = document.createElement('span');
  holder.innerHTML = iconMarkup(paths);
  return holder.firstElementChild as SVGSVGElement;
}

/**
 * Give a button an icon and its name. The name goes to `aria-label` and
 * `title`; any previous content is replaced. An optional short mono readout
 * (`×2`, `MID`) may sit beside the icon.
 */
export function setIconButton(button: HTMLButtonElement, paths: string, label: string, readout?: string): void {
  const document = button.ownerDocument;
  button.replaceChildren(strokeIcon(document, paths));
  if (readout) {
    const value = document.createElement('span');
    value.dataset.readout = '';
    value.textContent = readout;
    button.append(value);
  }
  button.setAttribute('aria-label', label);
  button.title = label;
}

/**
 * Declarations for an icon button: muted idle icon without fill or border,
 * ink with a raised fill on hover, inverted when pressed or expanded, 30% when
 * disabled, and a 2px ink focus outline drawn inside. `selector` is the
 * button's class selector; rules use `:where()` so application CSS wins.
 */
export function iconButtonCss(selector: string, component: string): string {
  return `
:where(${selector}) {
  display: inline-flex; align-items: center; justify-content: center; gap: .25rem; flex: none; box-sizing: border-box;
  min-width: var(--wm-${component}-height, var(--wm-control-size, 2rem)); height: var(--wm-${component}-height, var(--wm-control-size, 2rem));
  margin: 0; padding: 0 .375rem; border: 0; border-radius: var(--wm-control-radius, 0); background: transparent;
  color: var(--wm-foreground-muted, light-dark(#777, #aaa)); font: 500 .6875rem/1 var(--wm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  cursor: pointer;
}
:where(${selector}:hover:not(:disabled)) { color: var(--wm-foreground, light-dark(#111, #eee)); background: var(--wm-surface-muted, light-dark(#f3f3f3, #1c1c1c)); }
:where(${selector}[aria-pressed="true"], ${selector}[aria-expanded="true"]) {
  color: var(--wm-accent-foreground, light-dark(#fff, #111)); background: var(--wm-foreground, light-dark(#111, #eee));
}
:where(${selector}:disabled) { opacity: .3; cursor: default; background: transparent; }
:where(${selector}:focus-visible) { outline: var(--wm-focus-ring, 2px solid var(--wm-foreground, light-dark(#111, #eee))); outline-offset: -2px; }
:where(${selector} svg[data-icon]) { width: 16px; height: 16px; flex: none; }
`;
}

/** Declarations that hide a scrolling region's scrollbar while keeping it scrollable. */
export function hiddenScrollbarCss(selector: string): string {
  return `:where(${selector}) { scrollbar-width: none; }\n:where(${selector})::-webkit-scrollbar { display: none; }\n`;
}

/** Visually hidden but announced: for instructions and live status (Visual design → Type). */
export const visuallyHiddenDeclarations: Readonly<Record<string, string>> = Object.freeze({
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: '0',
  border: '0',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  'clip-path': 'inset(50%)',
  'white-space': 'nowrap',
});

/** {@link visuallyHiddenDeclarations} as a CSS rule body. */
export const visuallyHiddenCss = Object.entries(visuallyHiddenDeclarations).map(([property, value]) => `${property}: ${value};`).join(' ');
