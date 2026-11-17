// Export a component as code (DEC-078): a JavaScript module that defines a
// custom element, for projects that install the packages, and a standalone
// HTML page that loads the published packages from a CDN. Pure: strings in,
// strings out.

import {parseModuleProject, type ModuleProject} from '@webmusic/kernel/module';
import {createComponentPlugins} from './plugins';
import {ComponentSurfaces} from './surfaces';

export interface ComponentExportOptions {
  /** The custom element's tag: lowercase, with a hyphen. */
  readonly tag: string;
  /** Plugin IDs the code supplies through `extra`; others not in the standard set are listed as resources to provide. */
  readonly provided?: readonly string[];
}

export interface ComponentPageOptions extends ComponentExportOptions {
  readonly title?: string;
  /** Where `@webmusic/bridge/component` loads from. Defaults to jsDelivr's ESM build of `version`. */
  readonly moduleUrl?: string;
  /** Package version for the default module URL. Defaults to 0.3.0. */
  readonly version?: string;
  /** Base URL that asset URIs resolve against in the page. Defaults to the page itself. */
  readonly assetBase?: string;
}

const TAG = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/;
const RESERVED = new Set(['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph']);

function checkTag(tag: string): void {
  if (!TAG.test(tag) || RESERVED.has(tag)) throw new TypeError(`${tag} is not a custom element name: use lowercase letters with a hyphen, such as arabesque-player.`);
}

/** Plugin IDs the standard component plugins provide. */
export function standardPluginIds(): ReadonlySet<string> {
  return new Set(createComponentPlugins({surfaces: new ComponentSurfaces(), midi: undefined}).map(plugin => plugin.id));
}

/**
 * What a project needs beyond the packages: asset URIs it loads and plugin
 * IDs the standard set does not provide (a prepared DSP processor, a WAM host).
 */
export function componentResources(input: unknown, provided: readonly string[] = []): {assets: readonly string[]; plugins: readonly string[]} {
  const project = parseModuleProject(input);
  const known = standardPluginIds();
  const plugins = [...new Set(project.modules.map(module => module.plugin.id))].filter(id => !known.has(id) && !provided.includes(id)).sort();
  return Object.freeze({assets: Object.freeze(project.assets.map(asset => asset.uri)), plugins: Object.freeze(plugins)});
}

const json = (project: ModuleProject) => JSON.stringify(project, null, 2);
/** JSON is valid JavaScript, but not inside a `<script>`: a `</script>` in a string would end it. */
const scriptSafe = (text: string) => text.replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, character => character === '\u2028' ? '\\u2028' : '\\u2029');

function resourceComment(resources: {assets: readonly string[]; plugins: readonly string[]}): string {
  const lines = [
    ...(resources.assets.length ? ['// Assets it loads, relative to the page:', ...resources.assets.map(uri => `//   ${uri}`)] : []),
    ...(resources.plugins.length ? ['// Plugins to supply through `extra` (they stay unresolved until you do):', ...resources.plugins.map(id => `//   ${id}`)] : []),
  ];
  return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * A JavaScript module that defines `<tag>` for a project that installs the
 * packages: `npm install @webmusic/kernel @webmusic/ui @webmusic/score
 * @webmusic/audio @webmusic/bridge`, import the module, and write `<tag>`.
 */
export function componentModuleSource(input: unknown, options: ComponentExportOptions): string {
  checkTag(options.tag);
  const project = parseModuleProject(input);
  return `// <${options.tag}> — a WebMusic component.
// Needs @webmusic/kernel, @webmusic/ui, @webmusic/score, @webmusic/audio and
// @webmusic/bridge. Import this module once, then write <${options.tag}></${options.tag}>.
${resourceComment(componentResources(project, options.provided))}import {defineComponentElement} from '@webmusic/bridge/component';

export const project = ${json(project)};

export default defineComponentElement(${JSON.stringify(options.tag)}, project);
`;
}

/** A standalone HTML page that runs the component from the published packages. */
export function componentPageSource(input: unknown, options: ComponentPageOptions): string {
  checkTag(options.tag);
  const project = parseModuleProject(input);
  const title = (options.title ?? project.id).replace(/[<&]/g, character => character === '<' ? '&lt;' : '&amp;');
  const moduleUrl = options.moduleUrl ?? `https://cdn.jsdelivr.net/npm/@webmusic/bridge@${options.version ?? '0.3.0'}/component/+esm`;
  const resources = componentResources(project, options.provided);
  const base = options.assetBase === undefined ? '' : `, {base: ${JSON.stringify(options.assetBase)}}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 16px; background: light-dark(#fff, #111); color: light-dark(#111, #eee); }
</style>
</head>
<body>
<${options.tag}></${options.tag}>
<script type="module">
${scriptSafe(resourceComment(resources))}import {defineComponentElement} from ${JSON.stringify(moduleUrl)};
const project = ${scriptSafe(json(project))};
defineComponentElement(${JSON.stringify(options.tag)}, project${base});
</script>
</body>
</html>
`;
}
