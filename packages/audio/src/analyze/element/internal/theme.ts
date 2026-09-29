/** Style the live Analyze surfaces through their public and UI Kit tokens. */

/** Keep the light-DOM host fluid without overriding caller CSS or native hidden. */
function applyAnalysisHostLayout(host: HTMLElement, root: HTMLElement): void {
  const selector = host.localName.replace(/[^a-z0-9-]/gi, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
  const style = host.ownerDocument.createElement('style');
  // The stylesheet travels with this rendered root, so replacing a card or
  // disconnecting its host cannot leave document-level styles behind.
  style.textContent = `:where(${selector}) { box-sizing: border-box; inline-size: 100%; min-inline-size: 0; max-inline-size: 100%; }
:where(${selector}:not([hidden])) { display: block; }`;
  root.prepend(style);
}

/** Theme a freshly rendered analysis presenter root. */
export function applyAnalysisTheme(
  host: HTMLElement,
  root: HTMLElement,
  purpose: 'audio-level-analyzer' | 'audio-oscilloscope' | 'audio-spectrum-analyzer' | 'audio-transient-analyzer',
): void {
  applyAnalysisHostLayout(host, root);
  root.style.setProperty('box-sizing', 'border-box');
  root.style.setProperty(
    'background',
    `var(--wm-${purpose}-surface-background, var(--wm-analysis-surface-background, var(--wm-component-background, var(--wm-analysis-background, var(--wm-surface, #fff)))))`,
  );
  root.style.setProperty(
    'color',
    `var(--wm-${purpose}-surface-foreground, var(--wm-analysis-foreground, var(--wm-component-foreground, var(--wm-foreground, #444))))`,
  );
  root.style.setProperty(
    'border',
    `var(--wm-${purpose}-surface-border, var(--wm-analysis-surface-border, var(--wm-component-border, var(--wm-analysis-border, 1px solid var(--wm-border, #d8d8d8)))))`,
  );
  root.style.setProperty(
    'border-radius',
    `var(--wm-${purpose}-surface-radius, var(--wm-analysis-surface-radius, var(--wm-component-radius, var(--wm-analysis-radius, var(--wm-control-radius, 0)))))`,
  );
  root.style.setProperty(
    'padding',
    `var(--wm-${purpose}-surface-padding, var(--wm-analysis-surface-padding, var(--wm-component-padding, var(--wm-analysis-padding, .6rem))))`,
  );
}
