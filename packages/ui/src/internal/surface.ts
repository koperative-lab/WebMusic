import {neutralPalette} from './palette';

/**
 * Canonical outer surface shared by every visible UI presenter.
 *
 * Component-specific tokens remain the first override point, while the
 * `--wm-component-*` layer lets an application retheme every presenter with a
 * single set of properties. Literal fallbacks intentionally describe a light,
 * neutral component card so Web Components are complete without page CSS.
 */
export interface ComponentSurfaceFallbacks {
  /** Compatibility chain used after the canonical component surface token. */
  background?: string;
  border?: string;
  padding?: string;
  radius?: string;
}

/**
 * Neutral edge for controls nested inside a component surface.
 *
 * This is deliberately separate from `--wm-component-border`: a component's
 * outer frame and the controls it contains are different layers, even when
 * their default colour is the same. Primary/selected controls and focus rings
 * keep their own higher-contrast tokens.
 */
export const controlBorderFallback =
  `var(--wm-control-border, var(--wm-border, ${neutralPalette.border[0]}))`;

export function componentSurfaceDeclarations(
  component: string,
  fallbacks: ComponentSurfaceFallbacks = {},
): Readonly<Record<string, string>> {
  return {
    'box-sizing': 'border-box',
    padding: `var(--wm-${component}-surface-padding, var(--wm-component-padding, ${fallbacks.padding ?? '.6rem'}))`,
    border: `var(--wm-${component}-surface-border, var(--wm-component-border, ${fallbacks.border ?? `1px solid var(--wm-border, ${neutralPalette.border[0]})`}))`,
    'border-radius': `var(--wm-${component}-surface-radius, var(--wm-component-radius, ${fallbacks.radius ?? 'var(--wm-control-radius, 0)'}))`,
    background: `var(--wm-${component}-surface-background, var(--wm-component-background, ${fallbacks.background ?? 'var(--wm-surface, #fff)'}))`,
  };
}

/** Serialize the shared surface for presenter stylesheets. */
export function componentSurfaceCss(
  component: string,
  fallbacks: ComponentSurfaceFallbacks = {},
): string {
  return Object.entries(componentSurfaceDeclarations(component, fallbacks))
    .map(([property, value]) => `  ${property}: ${value};`)
    .join('\n');
}

/** A nested presenter can leave the containing surface as the sole paint layer. */
export const embeddedSurfaceDeclarations: Readonly<Record<string, string>> = {
  padding: '0', border: '0', 'border-radius': '0', background: 'transparent',
};
