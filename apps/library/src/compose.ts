// Turn a set of chosen elements into one working composition: markup that
// nests every companion in the player that lends it data, state and time, the
// define calls its tags need, and a complete page to copy. The live canvas and
// the copyable code are both built from this one result, so what the library
// shows is exactly what it hands over.
import {ELEMENT_PARAMS} from '../../doc/webmusic/src/lib/params/index.ts';
import {RECIPES, type Recipe} from './recipes.ts';

export type Attributes = Readonly<Record<string, string | null>>;
/** Per-tag attribute changes from Parameters: a string sets, null removes. */
export type Overrides = Readonly<Record<string, Attributes>>;

export interface ComposeOptions {
  /** Prefix for the Arabesque files: `import.meta.env.BASE_URL` live, `/` in copied code. */
  readonly mediaBase: string;
  readonly overrides?: Overrides;
}

/** A document editor the page loads and lends to a player and its editing views. */
export interface EditorStep {
  readonly kind: 'score' | 'audio';
  /** Arabesque URL the editor loads. */
  readonly url: string;
  /** Selectors of the elements that borrow it: the player first. */
  readonly targets: readonly string[];
}

export const EDITOR_LOADERS = {
  score: {entry: '@webmusic/score/view/headless', name: 'loadScoreEditor'},
  audio: {entry: '@webmusic/audio/view/headless', name: 'loadAudioClipEditor'},
} as const;

export interface Composition {
  /** Chosen and required tags, in catalog order. */
  readonly tags: readonly string[];
  /** Tags the composition added because a chosen element needs them. */
  readonly added: readonly string[];
  /** Body markup. */
  readonly markup: string;
  /** Public entry → define functions, in catalog order. */
  readonly imports: ReadonlyMap<string, readonly string[]>;
  /** Editors to load and lend after the markup is in the document. */
  readonly editors: readonly EditorStep[];
  /** A `<script type="module">` that defines every tag in the markup and loads its editors. */
  readonly script: string;
}

const RECIPE = new Map(RECIPES.map((recipe) => [recipe.tag, recipe]));
const ORDER = new Map(RECIPES.map((recipe, index) => [recipe.tag, index]));

export function recipeFor(tag: string): Recipe {
  const recipe = RECIPE.get(tag);
  if (!recipe) throw new Error(`No library recipe for <${tag}>`);
  return recipe;
}

export function entryFor(tag: string): string {
  const spec = ELEMENT_PARAMS[tag];
  if (!spec) throw new Error(`No parameter catalog entry for <${tag}>`);
  return spec.entry;
}

type MediaFormat = 'midi' | 'mxl' | 'wav' | 'mp3';
const MEDIA_FILE: Record<MediaFormat, string> = {
  midi: 'midi/Arabesque%20No.1.mid',
  mxl: 'mxl/Arabesque%20No.1.mxl',
  wav: 'wav/Arabesque%20No.1.wav',
  mp3: 'mp3/Arabesque%20No.1.mp3',
};

export function mediaUrl(format: MediaFormat, base: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}${MEDIA_FILE[format]}`;
}

/** Add what chosen elements require, keep catalog order, drop unknown tags. */
export function resolveSelection(selection: readonly string[]): {tags: string[]; added: string[]} {
  const chosen = new Set(selection.filter((tag) => RECIPE.has(tag)));
  const all = new Set<string>();
  const visit = (tag: string) => {
    if (all.has(tag)) return;
    all.add(tag);
    for (const required of recipeFor(tag).requires ?? []) visit(required);
  };
  for (const tag of chosen) visit(tag);
  const tags = [...all].sort((a, b) => ORDER.get(a)! - ORDER.get(b)!);
  return {tags, added: tags.filter((tag) => !chosen.has(tag))};
}

const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

interface Node {
  readonly tag: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children?: readonly Node[];
}

function render(node: Node, depth: number): string {
  const indent = '  '.repeat(depth);
  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => value === '' ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`).join('');
  const open = `${indent}<${node.tag}${attributes}>`;
  if (!node.children?.length) return `${open}</${node.tag}>`;
  return [open, ...node.children.map((child) => render(child, depth + 1)), `${indent}</${node.tag}>`].join('\n');
}

export function composeApp(selection: readonly string[], options: ComposeOptions): Composition {
  const {tags, added} = resolveSelection(selection);
  const has = (tag: string) => tags.includes(tag);
  const bySlot = (...slots: Recipe['slot'][]) => tags.filter((tag) => slots.includes(recipeFor(tag).slot));
  const media = (format: MediaFormat) => mediaUrl(format, options.mediaBase);
  const used = new Set<string>();

  /** One element: fixed attributes first, then the recipe's, then Parameters overrides. */
  const element = (tag: string, fixed: Record<string, string> = {}, children?: Node[]): Node => {
    const attributes: Record<string, string> = {...fixed, ...recipeFor(tag).attributes};
    if (!used.has(tag)) {
      for (const [name, value] of Object.entries(options.overrides?.[tag] ?? {})) {
        if (value === null) delete attributes[name];
        else attributes[name] = value;
      }
    }
    used.add(tag);
    return {tag, attributes, children};
  };

  const nodes: Node[] = [];

  // Score: one player owns the transport. Companions nest in it, or in the
  // lead part of a Rack desk when the app has one.
  const scoreCompanions = bySlot('score-companion');
  const scoreFree = bySlot('score-free');
  const desk = has('score-rack-control') || has('score-rack-part');
  const scoreHost = desk || has('score-player') || scoreCompanions.length > 0;
  const scoreSource = media(tags.some((tag) => recipeFor(tag).notation) ? 'mxl' : 'midi');
  const editors: EditorStep[] = [];
  const editing = (domain: 'score' | 'audio', list: readonly string[]) => list.filter((tag) => recipeFor(tag).editor === domain);
  // A desk plays its parts' own files; editing views there stay read-only.
  const scoreEditing = desk ? [] : editing('score', scoreCompanions);
  if (scoreEditing.length) editors.push({kind: 'score', url: scoreSource, targets: ['#score', ...scoreEditing]});
  const companionNodes = (list: readonly string[]): Node[] => list.flatMap((tag) => {
    const node = scoreEditing.includes(tag) ? element(tag, {editable: ''}) : element(tag);
    // A panel for the declared insert, next to the sound panel.
    if (tag === 'score-effect' && has('score-synth-panel')) {
      return [node, {tag: 'score-synth-panel', attributes: {target: '#room', sections: 'effects'}}];
    }
    return [node];
  });
  if (!scoreHost) {
    nodes.push(...scoreFree.map((tag) => element(tag)));
  } else if (desk) {
    const panel = scoreFree.filter((tag) => tag === 'score-synth-panel');
    const inputs = scoreFree.filter((tag) => tag !== 'score-synth-panel');
    nodes.push(element('score-player', {id: 'score'}, [
      element('score-rack-control', {id: 'desk'}, [
        {...element('score-rack-part', {id: 'lead', src: scoreSource, sound: 'triangle'}), children: companionNodes([...scoreCompanions, ...panel])},
        {tag: 'score-rack-part', attributes: {id: 'pad', src: media('midi'), sound: 'sine'}},
        ...inputs.map((tag) => element(tag)),
      ]),
    ]));
  } else {
    nodes.push(element('score-player', scoreEditing.length ? {id: 'score'} : {id: 'score', src: scoreSource}, companionNodes([...scoreCompanions, ...scoreFree])));
  }

  // Audio: a mixer owns its member players; meters tap its master bus. Every
  // other companion nests in one audio player.
  const audioCompanions = bySlot('audio-companion');
  const mix = has('audio-mixer');
  const mixMeters = mix ? audioCompanions.filter((tag) => recipeFor(tag).category === 'metering') : [];
  const hosted = audioCompanions.filter((tag) => !mixMeters.includes(tag));
  if (mix) {
    nodes.push(element('audio-mixer', {}, [
      {tag: 'audio-player', attributes: {id: 'piano', src: media('wav')}},
      {tag: 'audio-player', attributes: {id: 'double', src: media('wav'), volume: '0.6'}},
    ]));
    nodes.push(...mixMeters.map((tag) => element(tag, {input: '#mix', port: 'master'})));
  }
  const queue = has('audio-playlist');
  // An edited document is the player's source. Beside a queue, the editing
  // views get a player of their own so the queue keeps its player.
  const audioEditing = editing('audio', hosted);
  const ownEditPlayer = queue && audioEditing.length > 0;
  const mainHosted = ownEditPlayer ? hosted.filter((tag) => !audioEditing.includes(tag)) : hosted;
  const audioChild = (tag: string) => tag === 'audio-playlist' ? element(tag, {src: `${media('wav')}, ${media('mp3')}`})
    : audioEditing.includes(tag) ? element(tag, {editable: ''}) : element(tag);
  if (has('audio-player') || mainHosted.length > 0) {
    const edited = !ownEditPlayer && audioEditing.length > 0;
    nodes.push(element('audio-player', queue || edited ? {id: 'audio'} : {id: 'audio', src: media('wav')}, mainHosted.map(audioChild)));
    if (edited) editors.push({kind: 'audio', url: media('wav'), targets: ['#audio', ...audioEditing]});
  }
  if (ownEditPlayer) {
    nodes.push({tag: 'audio-player', attributes: {id: 'clip', controls: ''}, children: audioEditing.map(audioChild)});
    editors.push({kind: 'audio', url: media('wav'), targets: ['#clip', ...audioEditing]});
  }

  const markup = nodes.map((node) => render(node, 0)).join('\n');
  const present = new Set<string>();
  const collect = (node: Node) => { present.add(node.tag); node.children?.forEach(collect); };
  nodes.forEach(collect);
  const imports = new Map<string, string[]>();
  for (const recipe of RECIPES) {
    if (!present.has(recipe.tag)) continue;
    const entry = entryFor(recipe.tag);
    imports.set(entry, [...(imports.get(entry) ?? []), recipe.define]);
  }
  const loaders = new Map<string, string[]>();
  for (const step of editors) {
    const {entry, name} = EDITOR_LOADERS[step.kind];
    if (!loaders.get(entry)?.includes(name)) loaders.set(entry, [...(loaders.get(entry) ?? []), name]);
  }
  const editorLines = editors.length === 0 ? [] : [
    '  // Your page owns each editor; dispose it after detaching the elements.',
    ...editors.flatMap((step) => [
      `  const ${step.kind}Editor = await ${EDITOR_LOADERS[step.kind].name}('${step.url}');`,
      `  for (const element of document.querySelectorAll('${step.targets.join(', ')}')) element.editor = ${step.kind}Editor;`,
    ]),
  ];
  const script = imports.size === 0 ? '' : [
    '<script type="module">',
    ...[...imports, ...loaders].map(([entry, names]) => `  import {${names.join(', ')}} from '${entry}';`),
    ...[...imports.values()].flat().map((name) => `  ${name}();`),
    ...editorLines,
    '</script>',
  ].join('\n');
  return {tags, added, markup, imports, editors, script};
}

/** Script and markup, the way the documentation pages show an element. */
export function snippet(composition: Composition): string {
  return [composition.script, composition.markup].filter(Boolean).join('\n\n');
}

/** A complete page; bare package specifiers resolve through the app's bundler. */
export function page(composition: Composition, title = 'My WebMusic app'): string {
  const indent = (text: string, depth: number) => text.split('\n').map((line) => line ? `${'  '.repeat(depth)}${line}` : line).join('\n');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${title.replace(/</g, '&lt;')}</title>`,
    ...(composition.script ? [indent(composition.script, 2)] : []),
    '  </head>',
    '  <body>',
    ...(composition.markup ? [indent(composition.markup, 2)] : []),
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}
