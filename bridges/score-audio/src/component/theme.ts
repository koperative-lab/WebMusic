// The style of a whole component (DEC-088): custom properties kept in its
// project's `layout.style` and written on the component's own root, where
// every box inside inherits them. Every presenter and Element resolves its
// values through `--wm-<part>-<role>` to a shared `--wm-<role>` (see the
// visual design), so a handful of shared roles restyles a whole component,
// and a part's own token is the exception a box or a theme may add.
//
// Three places set a token, the nearest winning as CSS has it: a box's own
// settings (DEC-085), the component's theme, and whatever holds the
// component — a page or an app. A theme is written at the component's host
// from inside, the lowest place there is, so a rule the page writes for the
// element wins over it.
//
// A project file may come from anyone: a theme takes only what a setting
// takes — a name under `--wm-` and a value that loads nothing.
//
// Pure: strings and plain records; `applyComponentStyle` writes the given element.

import {parseModuleProject, type ModuleProject} from '@webmusic/kernel/module';
import {isStyleSetting, styleSource} from './settings';

/** What a theme token's value is, for an editor that offers it. */
export type ThemeTokenKind = 'color' | 'length' | 'border' | 'font';

/** One shared role every presenter and Element falls back to. */
export interface ThemeToken {
  readonly name: string;
  readonly kind: ThemeTokenKind;
  /** What the role paints. */
  readonly role: string;
  /** The value in effect while nothing sets it, as CSS text. */
  readonly fallback: string;
}

/**
 * The shared roles of the visual design: the tokens a theme usually sets.
 * A theme may hold any `--wm-` token; these are the ones that reach every
 * display part.
 */
export const THEME_TOKENS: readonly ThemeToken[] = Object.freeze([
  {name: '--wm-foreground', kind: 'color', role: 'Text, icons, pressed fills and selected marks', fallback: 'light-dark(#111, #eee)'},
  {name: '--wm-foreground-muted', kind: 'color', role: 'Idle icons, captions and secondary marks', fallback: 'light-dark(#777, #aaa)'},
  {name: '--wm-surface', kind: 'color', role: 'The background of a component and its controls', fallback: 'light-dark(#fff, #111)'},
  {name: '--wm-surface-muted', kind: 'color', role: 'Hover fills, tracks and insets', fallback: 'light-dark(#f3f3f3, #1c1c1c)'},
  {name: '--wm-border', kind: 'color', role: 'Frames and dividers', fallback: 'light-dark(#d8d8d8, #333)'},
  {name: '--wm-control-border', kind: 'color', role: 'Controls and fields inside a frame', fallback: 'var(--wm-border)'},
  {name: '--wm-accent', kind: 'color', role: 'Values and fills that are on', fallback: 'var(--wm-foreground)'},
  {name: '--wm-accent-foreground', kind: 'color', role: 'Content over a pressed fill', fallback: 'light-dark(#fff, #111)'},
  {name: '--wm-danger', kind: 'color', role: 'Errors and clipping', fallback: 'light-dark(#b42318, #f97066)'},
  {name: '--wm-recording', kind: 'color', role: 'Recording and armed inputs', fallback: 'light-dark(#c62828, #ef5350)'},
  {name: '--wm-playhead', kind: 'color', role: 'Playheads and sounding notes', fallback: 'rgb(240, 84, 119)'},
  {name: '--wm-scrim', kind: 'color', role: 'The veil behind an adjustment card', fallback: 'rgb(0 0 0 / .45)'},
  {name: '--wm-focus-ring', kind: 'border', role: 'The outline of the focused control', fallback: '2px solid var(--wm-foreground)'},
  {name: '--wm-control-radius', kind: 'length', role: 'Corners of controls', fallback: '0'},
  {name: '--wm-control-size', kind: 'length', role: 'The height of buttons, fields and toolbar rows', fallback: '2rem'},
  {name: '--wm-component-radius', kind: 'length', role: 'Corners of a component\'s frame', fallback: 'var(--wm-control-radius)'},
  {name: '--wm-component-border', kind: 'border', role: 'A component\'s outer frame', fallback: '1px solid var(--wm-border)'},
  {name: '--wm-font-family', kind: 'font', role: 'Interface text', fallback: 'system-ui, sans-serif'},
  {name: '--wm-font-mono', kind: 'font', role: 'Values, units and captions', fallback: 'ui-monospace, SFMono-Regular, Menlo, monospace'},
] as const);

const entries = (value: unknown): [string, unknown][] =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];

/** The custom properties in `style` that may be written: `--wm-` names with values that load nothing. */
export function styleSettings(style: unknown): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, value] of entries(style)) if (isStyleSetting(name, value)) out[name] = value.trim();
  return out;
}

/** The style a box's `config` gives it: its `style` as it may be written, or nothing while the box inherits (DEC-090). */
export function ownStyle(config: Readonly<Record<string, unknown>>): Readonly<Record<string, string>> {
  return styleSource(config) === 'inherit' ? {} : styleSettings(config.style);
}

/** A component's theme: the entries of its project's `layout.style` that may be applied. */
export function componentTheme(project: Pick<ModuleProject, 'layout'>): Readonly<Record<string, string>> {
  return styleSettings(project.layout.style);
}

/** `project` with one theme token written, or removed when `value` is undefined; an empty theme is dropped. */
export function withComponentTheme(project: ModuleProject, name: string, value: string | undefined): ModuleProject {
  if (value !== undefined && !isStyleSetting(name, value)) throw new TypeError(`${name} cannot be themed with that value: a theme sets --wm- tokens to values that load nothing.`);
  const style = Object.fromEntries(Object.entries(project.layout.style ?? {}).filter(([key]) => key !== name));
  if (value !== undefined) style[name] = value.trim();
  const {style: _previous, ...layout} = project.layout;
  return parseModuleProject({...project, layout: Object.keys(style).length ? {...layout, style} : layout});
}

/** `style` as CSS declarations; empty for no entries. */
export function styleDeclarations(style: unknown): string {
  return Object.entries(styleSettings(style)).map(([name, value]) => `${name}: ${value};`).join(' ');
}

const written = new WeakMap<HTMLElement, Set<string>>();

/**
 * Write `style` on `element` as custom properties and take back those an
 * earlier call wrote that it no longer holds. Used for a box's own style
 * and for a theme on a root the host owns.
 */
export function applyComponentStyle(element: HTMLElement, style: unknown): void {
  const next = styleSettings(style);
  const before = written.get(element) ?? new Set<string>();
  for (const name of before) if (!(name in next)) element.style.removeProperty(name);
  for (const [name, value] of Object.entries(next)) element.style.setProperty(name, value);
  written.set(element, new Set(Object.keys(next)));
}
