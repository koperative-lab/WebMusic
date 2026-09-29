/** Keep the custom-element host layout-neutral around its framed presenter. */
export function prepareAudioViewHost(host: HTMLElement): void {
  host.style.setProperty('display', 'block');
  host.style.setProperty('min-width', '0');
}

/**
 * Route an Audio element's public surface tokens onto the UI presenter's
 * framed outer root. The stage keeps its coordinate-sensitive viewport inside
 * that root, so the host remains transparent and there is one frame.
 */
export function applyAudioPresenterSurface(
  host: HTMLElement,
  root: HTMLElement,
  purpose: string,
  presenter: string,
  foreground = `${presenter}-foreground`,
): void {
  prepareAudioViewHost(host);
  root.style.setProperty('box-sizing', 'border-box');
  root.style.setProperty(
    'background',
    `var(--wm-${purpose}-surface-background, var(--wm-${presenter}-surface-background, var(--wm-component-background, var(--wm-surface, #fff))))`,
  );
  root.style.setProperty(
    'border',
    `var(--wm-${purpose}-surface-border, var(--wm-${presenter}-surface-border, var(--wm-component-border, 1px solid var(--wm-border, #d8d8d8))))`,
  );
  root.style.setProperty(
    'padding',
    `var(--wm-${purpose}-surface-padding, var(--wm-${presenter}-surface-padding, var(--wm-component-padding, .6rem)))`,
  );
  root.style.setProperty(
    'border-radius',
    `var(--wm-${purpose}-surface-radius, var(--wm-${presenter}-surface-radius, var(--wm-component-radius, var(--wm-control-radius, 0))))`,
  );
  root.style.setProperty(
    'color',
    `var(--wm-${purpose}-surface-foreground, var(--wm-${foreground}, var(--wm-component-foreground, var(--wm-foreground, #444))))`,
  );
}
