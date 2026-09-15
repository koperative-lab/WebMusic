import type {CSSProperties} from 'react';

/**
 * The same self-contained outer surface used by the DOM presenters.
 *
 * React components cannot rely on a documentation wrapper or a globally
 * installed stylesheet, so the declarations live on their rendered root and
 * remain themeable through the shared `--wm-component-*` tokens.
 */
export function componentSurfaceStyle(component: string): CSSProperties {
  return {
    boxSizing: 'border-box',
    padding: `var(--wm-${component}-surface-padding, var(--wm-component-padding, .6rem))`,
    border: `var(--wm-${component}-surface-border, var(--wm-component-border, 1px solid var(--wm-border, #d8d8d8)))`,
    borderRadius: `var(--wm-${component}-surface-radius, var(--wm-component-radius, var(--wm-control-radius, 0)))`,
    background: `var(--wm-${component}-surface-background, var(--wm-component-background, var(--wm-surface, #fff)))`,
    color: `var(--wm-${component}-surface-foreground, var(--wm-component-foreground, var(--wm-foreground, #444)))`,
  };
}
