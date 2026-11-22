// A component's own settings in a graph (DEC-085): attributes of its Element
// and custom properties set on it, kept in its module's config under
// `attributes` and `style`. They are the Element's public settings — the
// same attributes and tokens a page would write — so a component is set the
// same way in a graph, in an exported component and pasted into a project.
//
// A project file may come from anyone, so nothing here trusts it. An
// attribute is written only when the Element observes it, which leaves out
// event handlers and anything else the Element does not read; never when the
// graph owns it (a source, a connection, an identity), when a box argument
// writes it, or when the manifest locks it. A custom property is written only
// under the public `--wm-` prefix and only with a value that fetches nothing.
//
// Pure: no DOM is touched beyond reading the Element class's observed
// attributes from the custom element registry.

import type {ProjectJsonObject} from '@webmusic/kernel/module';
import type {ComponentManifest} from './manifest';

/** A component's settings, as read from its module's config. */
export interface ComponentSettings {
  /** Attributes of the Element, by name. */
  readonly attributes: Readonly<Record<string, string>>;
  /** Custom properties set on the Element, by name. */
  readonly style: Readonly<Record<string, string>>;
}

/** The keys of a module's config that hold its settings. */
export type ComponentSettingKind = keyof ComponentSettings;

/**
 * Attributes a graph owns on every component: where its material comes from,
 * what it is connected to, and what identifies it. Cords, assets and the host
 * decide these; a setting never does.
 */
export const GRAPH_ATTRIBUTES: readonly string[] = Object.freeze([
  'id', 'class', 'style', 'slot', 'part', 'is', 'src', 'format', 'peaks-src', 'input', 'port', 'target', 'session', 'sound-font', 'device-id',
]);

const TOKEN_NAME = /^--wm-[a-z0-9-]+$/;
/** Functions that load something: a token's value is a colour, a length or a number, never a resource. */
const LOADS = /(?:url|src|image-set|image|cross-fade|element|paint)\s*\(/i;
const MAX_VALUE = 256;

type Registry = Pick<CustomElementRegistry, 'get'>;
const registryOf = (registry?: Registry): Registry | undefined => registry ?? (globalThis as {customElements?: Registry}).customElements;

/**
 * The attributes a setting may write on a component's Element: those the
 * Element observes, less the graph's, the box arguments' and the manifest's
 * locked ones. Empty until the Element is defined.
 */
export function settableAttributes(manifest: ComponentManifest, registry?: Registry): readonly string[] {
  const observed = (registryOf(registry)?.get(manifest.tag) as {observedAttributes?: readonly string[]} | undefined)?.observedAttributes ?? [];
  const taken = new Set([...GRAPH_ATTRIBUTES, ...(manifest.locked ?? []), ...manifest.parameters.flatMap(parameter => parameter.attribute ? [parameter.attribute] : [])]);
  return observed.filter(name => !taken.has(name));
}

/** True for a custom property and value a setting may write. */
export function isStyleSetting(name: string, value: unknown): value is string {
  return TOKEN_NAME.test(name) && typeof value === 'string' && value.trim() !== '' && value.length <= MAX_VALUE && !/[;{}<>]/.test(value) && !LOADS.test(value);
}

const entries = (value: unknown): [string, unknown][] =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];

/**
 * Whose style something shows (DEC-090): its `own`, or, with `inherit`, that
 * of what holds it — a box its component's theme, a component its app's.
 * The choice is the author's, box by box and component by component; the
 * style it sets aside is kept, so choosing `own` again brings it back.
 */
export type StyleSource = 'own' | 'inherit';

/** The style source a box's `config` chooses under `styling`; `own` unless it says `inherit`. */
export function styleSource(config: Readonly<Record<string, unknown>>): StyleSource {
  return config.styling === 'inherit' ? 'inherit' : 'own';
}

/** `config` with its style source chosen; `own` is the absence of the key. */
export function withStyleSource(config: ProjectJsonObject, source: StyleSource): ProjectJsonObject {
  const {styling: _previous, ...rest} = config;
  return source === 'inherit' ? {...rest, styling: 'inherit'} : rest;
}

/**
 * The settings in `config` that may be applied to the component's Element;
 * anything else in `attributes` or `style` is left out without an error, so
 * a project written for a later Element still loads. A box that inherits its
 * style (DEC-090) has none of its own applied; its attributes stay.
 */
export function componentSettings(manifest: ComponentManifest, config: Readonly<Record<string, unknown>>, registry?: Registry): ComponentSettings {
  const settable = new Set(settableAttributes(manifest, registry));
  const attributes: Record<string, string> = {};
  for (const [name, value] of entries(config.attributes)) {
    if (settable.has(name) && typeof value === 'string' && value.length <= MAX_VALUE) attributes[name] = value;
  }
  const style: Record<string, string> = {};
  if (styleSource(config) === 'own') for (const [name, value] of entries(config.style)) if (isStyleSetting(name, value)) style[name] = value.trim();
  return {attributes, style};
}

/**
 * `config` with one setting written, or removed when `value` is undefined.
 * An empty `attributes` or `style` is dropped, so a component without
 * settings has the config it had before it was given any.
 */
export function withComponentSetting(config: ProjectJsonObject, kind: ComponentSettingKind, name: string, value: string | undefined): ProjectJsonObject {
  const group = Object.fromEntries(entries(config[kind]).filter(([key, item]) => key !== name && typeof item === 'string')) as Record<string, string>;
  if (value !== undefined) group[name] = value;
  const {[kind]: _previous, ...rest} = config;
  return Object.keys(group).length ? {...rest, [kind]: group} : rest;
}
