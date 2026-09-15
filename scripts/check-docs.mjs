#!/usr/bin/env node
// ============================================================================
// Source-based documentation gates. Optional local guidance in
// .dev/docs/DOCS-CONVENTIONS.md describes coverage and manual acceptance.
//
//   1. params catalog  ==  each element's `static observedAttributes`
//   2. catalog integrity — every tag has a page, an entry and a live href
//   3. selected element page structure, Headless leaf/demo shape and exported names
//   4. live demo integration — every rendered demo uses LiveDemoCanvas
//   5. plan rules — both family form inventories exist and carry no demos, dense
//      element order, UI Kit labels mirror the catalog, root API entry coverage
//   6. supported internal-link and anchor forms resolve
//
// Runs on source, not on `dist/`, so it is cheap enough for `npm run check`.
// TypeScript catalogs are loaded through Node's type stripping: every catalog
// file's own imports are `import type`, so they have no runtime graph to
// resolve. Keep it that way and this script needs no bundler.
// ============================================================================

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {domainFamilies, packageDirectories} from './package-policy.mjs';
import {headlessDocProblems} from './headless-docs-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = 'apps/doc/webmusic/src/content/docs';
const failures = [];
const notes = [];

const fail = (check, message) => failures.push({check, message});
const abs = (path) => join(ROOT, path);
const read = (path) => readFileSync(abs(path), 'utf8');
const load = (path) => import(pathToFileURL(abs(path)).href);

function walk(dir, out = []) {
  for (const name of readdirSync(abs(dir))) {
    const path = `${dir}/${name}`;
    if (statSync(abs(path)).isDirectory()) walk(path, out);
    else if (name.endsWith('.mdx') || name.endsWith('.md')) out.push(path);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. The parameter catalog must equal `static observedAttributes`, in order.
// ---------------------------------------------------------------------------

/**
 * Attribute names out of a `const NAME … = [ … ]` spread source. Two shapes
 * occur: a flat `['a', 'b']` list, and a `[['attr', 'key'], …]` option table
 * whose first tuple slot is the attribute. The type annotation may itself
 * contain brackets (`readonly string[]`), so the array is found by balancing
 * from the assignment rather than by the first `[`.
 */
function resolveList(source, name) {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) return null;
  const assign = source.indexOf('=', start);
  const open = source.indexOf('[', assign);
  if (assign < 0 || open < 0) return null;
  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '[') depth++;
    else if (source[i] === ']' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close < 0) return null;
  const body = source.slice(open + 1, close);
  const pairs = [...body.matchAll(/\[\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
  if (pairs.length) return pairs;
  return [...body.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

/**
 * The element's observed attributes, with every `...spread` resolved. An
 * element with no getter observes nothing — `<rack-control>` is driven only by
 * `.rack` — which is an empty list, not a failure.
 */
function observedAttributes(source, file) {
  const body = /static get observedAttributes\(\)[^{]*\{\s*return\s*\[([\s\S]*?)\];/.exec(source);
  if (!body) return /static get observedAttributes/.test(source) ? null : [];
  const names = [];
  for (const line of body[1].split(',')) {
    const literal = /['"]([a-z][a-z0-9-]*)['"]/.exec(line);
    if (literal) {
      names.push(literal[1]);
      continue;
    }
    const spread = /\.\.\.([A-Z_][A-Z0-9_]*)/.exec(line);
    if (!spread) continue;
    const resolved = resolveList(source, spread[1]);
    if (!resolved) {
      fail('params', `${file}: cannot resolve spread \`...${spread[1]}\` in observedAttributes`);
      continue;
    }
    names.push(...resolved);
  }
  return names;
}

function elementSources() {
  const byTag = {};
  for (const family of domainFamilies) {
    for (const capability of ['play', 'view', 'analyze']) {
      const dir = `packages/${family}/src/${capability}/element`;
      for (const name of readdirSync(abs(dir))) {
        if (!name.endsWith('.ts')) continue;
        if (['index.ts', 'auto.ts', 'global.ts', 'base.ts'].includes(name)) continue;
        byTag[name.replace(/\.ts$/, '')] = {path: `${dir}/${name}`, family, capability};
      }
    }
  }
  return byTag;
}

async function checkParams(sources) {
  const groups = domainFamilies.flatMap((family) => ['play', 'view', 'analyze'].map((capability) => `${family}-${capability}`));
  const catalog = {};
  for (const group of groups) {
    const module = await load(`apps/doc/webmusic/src/lib/params/${group}.ts`);
    Object.assign(catalog, Object.values(module)[0]);
  }

  for (const [tag, spec] of Object.entries(catalog)) {
    const source = sources[tag];
    if (!source) {
      fail('params', `catalog documents <${tag}>, which has no element source`);
      continue;
    }
    const truth = observedAttributes(read(source.path), source.path);
    if (!truth) {
      fail('params', `${source.path}: no \`static get observedAttributes()\` found`);
      continue;
    }
    const got = spec.params.map((p) => p.name);
    const missing = truth.filter((name) => !got.includes(name));
    const extra = got.filter((name) => !truth.includes(name));
    if (missing.length) fail('params', `<${tag}>: catalog is missing ${missing.join(', ')}`);
    if (extra.length) fail('params', `<${tag}>: catalog invents ${extra.join(', ')}`);
    if (!missing.length && !extra.length && got.join() !== truth.join()) {
      fail('params', `<${tag}>: catalog order differs from observedAttributes (${truth.join(', ')})`);
    }
  }

  for (const tag of Object.keys(sources)) {
    if (!catalog[tag]) fail('params', `<${tag}> has an element source but no catalog entry`);
  }
  return catalog;
}

// ---------------------------------------------------------------------------
// 2. Catalog integrity — hrefs land on pages, consumer tags are real.
// ---------------------------------------------------------------------------

async function checkCatalogs(pages, paramsCatalog) {
  const {UI_COMPOSITION_CATALOG} = await load('apps/doc/shared/ui-catalog.ts');
  const {UI_PRESENTER_CATALOG, UI_PRESENTER_CLASSES} = await load('apps/doc/shared/ui-presenter-catalog.ts');

  const tags = new Set(UI_COMPOSITION_CATALOG.map((entry) => entry.tag));
  for (const entry of UI_COMPOSITION_CATALOG) {
    const [pageHref, fragment] = entry.href.split('#');
    const page = pages.get(pageHref);
    if (!page) fail('catalog', `ui-catalog <${entry.tag}> href ${entry.href} is not a page`);
    else if (fragment && !page.headings.has(fragment)) {
      fail('catalog', `ui-catalog <${entry.tag}> href ${entry.href} has no matching heading`);
    }
    if (!paramsCatalog[entry.tag]) fail('catalog', `ui-catalog <${entry.tag}> has no parameter catalog entry`);
  }
  for (const tag of Object.keys(paramsCatalog)) {
    if (!tags.has(tag)) fail('catalog', `<${tag}> is in the parameter catalog but not in ui-catalog`);
  }

  const classes = new Set(UI_PRESENTER_CLASSES.map((entry) => entry.slug));
  for (const entry of UI_PRESENTER_CATALOG) {
    if (!classes.has(entry.classSlug)) fail('catalog', `presenter ${entry.presenter}: unknown class ${entry.classSlug}`);
    const href = `/uikit/${entry.classSlug}/${entry.presenter}/`;
    if (!pages.has(href)) fail('catalog', `presenter ${entry.presenter} has no page at ${href}`);
    for (const tag of entry.consumerTags) {
      if (!tags.has(tag)) fail('catalog', `presenter ${entry.presenter}: consumer <${tag}> is not a catalog tag`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Element page shape.
// ---------------------------------------------------------------------------

function frontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---/.exec(source);
  if (!match) return {};
  // Flattened one level: `sidebar.label` and `sidebar.order` are the two nested
  // keys the plan constrains, and no frontmatter key name is used at two depths.
  const data = {};
  for (const line of match[1].split('\n')) {
    const kv = /^\s*([a-z]+):\s*(.+)$/.exec(line);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return data;
}

function checkElementPages(files, paramsCatalog) {
  for (const file of files) {
    const match = /\/element\/(play|view|analyze)\/([a-z-]+)\.mdx$/.exec(file);
    if (!match || match[2] === 'index') continue;
    const tag = match[2];
    const source = read(file);
    const page = relative(DOCS, file);

    if (!paramsCatalog[tag]) {
      fail('page', `${page}: no element named <${tag}> — page name must be the tag`);
      continue;
    }
    const title = frontmatter(source).title;
    if (title !== `'<${tag}>'`) fail('page', `${page}: title is ${title}, expected '<${tag}>'`);

    const playgrounds = source.match(/^<[A-Z][A-Za-z]*(?:Playground|Demo)\b[^>]*\/>/gm) ?? [];
    if (playgrounds.length === 0) fail('page', `${page}: no live demo`);

    for (const section of ['API', 'Styling']) {
      if (!source.includes(`<summary>${section}</summary>`)) {
        fail('page', `${page}: missing the ${section} <details> block`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3b. Title form, per DOCS-SITE-PLAN.md §"Titles and labels": a title names the
// thing — a tag in angle brackets, or an entry as imported. Titles are
// deliberately NOT unique site-wide; the sidebar and breadcrumb disambiguate.
// ---------------------------------------------------------------------------

function checkTitles(files) {
  for (const file of files) {
    const page = relative(DOCS, file);
    const raw = frontmatter(read(file)).title;
    if (!raw) {
      fail('title', `${page}: no title`);
      continue;
    }
    const title = raw.replace(/^['"]|['"]$/g, '');

    const api = /^(score)\/api\/([a-z-]+)\.mdx$/.exec(page);
    if (api) {
      const entry = api[2] === 'index' ? `@webmusic/${api[1]}` : `@webmusic/${api[1]}/${api[2]}`;
      if (title !== entry) fail('title', `${page}: title is "${title}", expected '${entry}'`);
    }

    const uikit = /^uikit\/[a-z-]+\/([a-z-]+)\.mdx$/.exec(page);
    if (uikit && title !== `@webmusic/ui/${uikit[1]}`) {
      fail('title', `${page}: title is "${title}", expected '@webmusic/ui/${uikit[1]}'`);
    }

    // The UI Kit root API page follows the same rule as every other API page:
    // its title is the entry as imported.
    if (page === 'uikit/api.mdx' && title !== '@webmusic/ui') {
      fail('title', `${page}: title is "${title}", expected '@webmusic/ui'`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3c. Rules DOCS-SITE-PLAN.md states that a machine can hold it to.
// ---------------------------------------------------------------------------

/**
 * A capability group expands straight to its element pages, numbered densely
 * from 1 (plan §"Site tree and page ownership"). There is no per-capability
 * Overview leaf: each family's `element/index.mdx` and `headless/index.mdx`
 * inventory every tag and every exported value in one place, and neither
 * carries demos — a demo belongs on the page owning the element or object.
 */
function checkCapabilityGroups(files) {
  const groups = {};
  for (const file of files) {
    const match = /^(score)\/element\/(play|analyze|view)\/([a-z-]+)\.mdx$/.exec(relative(DOCS, file));
    if (!match) continue;
    const [, family, capability, name] = match;
    if (name === 'index') {
      fail('plan', `${family}/${capability}: a capability group has no Overview leaf; inventory it on ${family}/element/index.mdx`);
      continue;
    }
    ((groups[`${family}/${capability}`] ??= [])).push({name, data: frontmatter(read(file))});
  }

  for (const [group, pages] of Object.entries(groups)) {
    // `Number(undefined)` is NaN, and NaN makes the sort comparator useless, so
    // a missing order is reported against its own page rather than smeared
    // across the group's order list.
    for (const page of pages) {
      if (!Number.isInteger(Number(page.data.order))) fail('plan', `${group}/${page.name}.mdx: no integer sidebar.order`);
    }
    const orders = pages.map((page) => Number(page.data.order)).filter(Number.isInteger).sort((a, b) => a - b);
    const dense = orders.every((order, index) => order === index + 1);
    if (!dense) fail('plan', `${group}: element orders are ${orders.join(', ')}, expected 1…${orders.length}`);
  }

  // Both form inventories are required, and for the same reason: each is the
  // only page that lists its whole form for the family.
  for (const family of domainFamilies) {
    for (const [form, what] of [['element', 'Web Components'], ['headless', 'Headless']]) {
      const inventory = `${DOCS}/${family}/${form}/index.mdx`;
      if (!existsSync(abs(inventory))) {
        fail('plan', `${family}/${form}/index.mdx: the family ${what} inventory is missing`);
        continue;
      }
      const demos = read(inventory).match(/^<[A-Z][A-Za-z]*(?:Playground|Demo)\b[^>]*\/>/gm) ?? [];
      if (demos.length) {
        fail('plan', `${family}/${form}/index.mdx: the ${what} inventory carries no demos (found ${demos.join(', ')})`);
      }
    }
  }
}

/** The UI Kit class labels have one source; the sidebar mirrors it by hand. */
async function checkUiKitLabels() {
  const {UI_PRESENTER_CLASSES} = await load('apps/doc/shared/ui-presenter-catalog.ts');
  const config = read('apps/doc/webmusic/astro.config.mjs');
  const sidebar = new Map(
    [...config.matchAll(/uiKitCategory\('([a-z-]+)',\s*'([^']+)'\)/g)].map((m) => [m[1], m[2]]),
  );
  for (const entry of UI_PRESENTER_CLASSES) {
    const label = sidebar.get(entry.slug);
    if (label === undefined) fail('plan', `astro.config.mjs has no uiKitCategory('${entry.slug}', …)`);
    else if (label !== entry.label) {
      fail('plan', `class ${entry.slug}: sidebar says "${label}", the catalog says "${entry.label}"`);
    }
  }
}

/** Every sub-entry section of a root API page carries its subpath (API template). */
function checkEntrySections(page, packageJson, entryHeading) {
  const exports = entryNames(packageJson);
  const documented = [...read(page).matchAll(entryHeading)].map((m) => m[1]);
  for (const entry of exports) {
    if (!documented.includes(entry)) fail('plan', `${relative(DOCS, page)}: no section for the ${entry} entry`);
  }
  for (const entry of documented) {
    if (!exports.includes(entry)) fail('plan', `${relative(DOCS, page)}: documents ${entry}, which is not an entry`);
  }
}

/** The package's published subpaths, without the leading "./". */
function entryNames(packageJson) {
  return Object.keys(JSON.parse(read(packageJson)).exports)
    .filter((name) => name !== '.' && name !== './package.json')
    .map((name) => name.slice(2));
}

/**
 * A root API page accounts for every published entry of its package, and for
 * nothing that is not one (API template §"Entry map" / §"API Reference", and
 * DOCS-SITE-PLAN.md §"Install": the package subpath table lives on the root
 * API page only).
 *
 * Kernel documents its ten entries as sections, because none has a page of
 * its own; the family roots carry a subpath table whose rows link to the
 * capability, headless and element pages. Both satisfy the same rule — the
 * entry is NAMED on the root page — so this check looks for the entry
 * specifier rather than prescribing which form it appears in.
 */
function checkRootEntryCoverage(page, packageJson, packageName) {
  const source = read(page);
  const entries = entryNames(packageJson);
  const named = new Set(
    [...source.matchAll(new RegExp(`${packageName.replace('/', '\\/')}\\/([a-z0-9-]+(?:\\/[a-z0-9-]+)*)`, 'g'))].map(
      (match) => match[1],
    ),
  );
  for (const entry of entries) {
    if (!named.has(entry)) {
      fail('plan', `${relative(DOCS, page)}: does not name the ${packageName}/${entry} entry`);
    }
  }
  for (const name of named) {
    if (!entries.includes(name)) {
      fail('plan', `${relative(DOCS, page)}: names ${packageName}/${name}, which is not a published entry`);
    }
  }
}


/**
 * Value exports of one barrel, following `export * from './x'` into the file
 * it names.
 *
 * Values only. The barrels also export ~160 option, event and state types,
 * which the template documents beside the object that produces them rather
 * than as table rows; listing them would bury the objects a reader is looking
 * for.
 *
 * Following the star is what makes this a reading of the published entry
 * rather than of one file: a star re-export names nothing, so a scan that
 * stops at the barrel sees an empty line where a whole module's exports are —
 * today the analysis worker client, whose values no page had to account for.
 */
function valueExports(file, seen = new Set()) {
  if (seen.has(file)) return []; // A cycle would otherwise recurse forever.
  seen.add(file);
  const source = read(file);
  const names = [];
  // `export {a, b as c, type D}` — the re-export form every barrel here uses.
  for (const block of source.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(',')) {
      const name = part.trim();
      if (!name || name.startsWith('type ')) continue;
      names.push(name.split(/\s+as\s+/).pop().trim());
    }
  }
  // `export const|function|class X` — declarations made directly in the file.
  for (const decl of source.matchAll(/export\s+(?:declare\s+)?(?:const|function|class)\s+([A-Za-z0-9_$]+)/g)) {
    names.push(decl[1]);
  }
  // `export * from './x'` — everything that file exports, on the same terms.
  const dir = file.slice(0, file.lastIndexOf('/'));
  for (const star of source.matchAll(/export\s+\*\s+from\s+'(\.[^']*)'/g)) {
    const base = join(dir, star[1]);
    const resolved = [`${base}.ts`, `${base}/index.ts`].find((candidate) => existsSync(abs(candidate)));
    if (resolved) names.push(...valueExports(resolved, seen));
    else fail('plan', `${file}: export * from '${star[1]}' resolves to no file`);
  }
  return names;
}

/**
 * A family's Headless documentation accounts for every VALUE each `/headless`
 * barrel exports (HEADLESS-PAGE-TEMPLATE.md §"The family `index.mdx`": listing
 * every value there "is the manual completeness requirement for the whole
 * capability; the gate behind it is weaker" — this is that weaker gate).
 *
 * A new engine, controller, session or helper appearing with nobody
 * documenting it is the drift this catches. The export table lives on the
 * family inventory page, so that page is always read; the capability's own
 * object pages count too, because naming a value beside the object that
 * produces it documents it just as well.
 */
function checkHeadlessExports(family, capability) {
  const barrel = `packages/${family}/src/${capability}/headless/index.ts`;
  if (!existsSync(abs(barrel))) return; // No headless entry for this capability.
  // A capability is either still one aggregated page or already split into a
  // directory of object pages; either way the family inventory is read with it.
  const inventory = `${DOCS}/${family}/headless/index.mdx`;
  const aggregated = `${DOCS}/${family}/headless/${capability}.mdx`;
  const directory = `${DOCS}/${family}/headless/${capability}`;
  const pages = [
    ...(existsSync(abs(inventory)) ? [inventory] : []),
    ...(existsSync(abs(aggregated))
      ? [aggregated]
      : readdirSync(abs(directory)).filter((name) => name.endsWith('.mdx')).map((name) => `${directory}/${name}`)),
  ];
  // The label names the capability, not just the family: one inventory answers
  // for three barrels, and "which barrel drifted" is the useful half.
  const label = existsSync(abs(aggregated))
    ? `${family}/headless/${capability}.mdx`
    : `${family}/headless/ (${capability})`;
  const exported = new Set(valueExports(barrel));
  const documented = pages.map((file) => read(file)).join('\n');
  const missing = [...exported].filter((name) => !new RegExp(`\`${name}\``).test(documented));
  for (const name of missing.sort()) {
    fail('plan', `${label}: no entry for the ${name} export (${barrel})`);
  }
}

// ---------------------------------------------------------------------------
// 4. Every live demo rendered by a page must reach the shared canvas.
// ---------------------------------------------------------------------------

function componentUsesLiveCanvas(file, seen = new Set()) {
  if (seen.has(file)) return false;
  seen.add(file);
  if (!existsSync(abs(file))) return false;
  if (file.endsWith('/LiveDemoCanvas.astro')) return true;

  const source = read(file);
  for (const match of source.matchAll(/from\s+['"]([^'"]+\.astro)['"]/g)) {
    if (!match[1].startsWith('.')) continue;
    const imported = join(dirname(file), match[1]);
    if (componentUsesLiveCanvas(imported, seen)) return true;
  }
  return false;
}

function checkLiveDemoCanvases(files) {
  const names = /(?:Demo|Playground|Showcase|Sandbox)$/;
  let instances = 0;
  const pages = new Set();

  for (const file of files.filter((path) => path.endsWith('.mdx'))) {
    const source = read(file);
    for (const match of source.matchAll(/import\s+([A-Z][A-Za-z0-9]*)\s+from\s+['"]([^'"]+\.astro)['"]/g)) {
      const [, name, specifier] = match;
      if (!names.test(name) || !new RegExp(`<${name}\\b`).test(source)) continue;
      const component = join(dirname(file), specifier);
      instances += source.match(new RegExp(`<${name}\\b`, 'g'))?.length ?? 0;
      pages.add(file);
      if (!componentUsesLiveCanvas(component)) {
        fail(
          'live-demo',
          `${relative(DOCS, file)}: <${name}> does not use components/LiveDemoCanvas.astro`,
        );
      }
    }
  }

  notes.push(`${pages.size} live-demo pages · ${instances} instances`);
}

// ---------------------------------------------------------------------------
// 6. Internal links and anchors.
// ---------------------------------------------------------------------------

/** github-slugger's rule, which is what Starlight generates heading ids with. */
function slug(heading) {
  return heading
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');
}

function pageUrl(file) {
  const path = relative(DOCS, file).replace(/\.mdx?$/, '');
  return path === 'index' ? '/' : `/${path.replace(/\/index$/, '')}/`;
}

function collectPages(files) {
  const pages = new Map();
  for (const file of files) {
    const source = read(file);
    const headings = new Set();
    let fenced = false;
    for (const line of source.split('\n')) {
      if (/^\s*```/.test(line)) fenced = !fenced;
      if (fenced) continue;
      const heading = /^#{2,6}\s+(.+?)\s*$/.exec(line);
      if (heading) headings.add(slug(heading[1]));
      // Components render their own ids; honour an explicit one when a page writes it.
      for (const explicit of line.matchAll(/\bid="([^"]+)"/g)) headings.add(explicit[1]);
    }
    pages.set(pageUrl(file), {file, headings});
  }
  return pages;
}

function astroRedirects() {
  const config = read('apps/doc/webmusic/astro.config.mjs');
  const block = /redirects:\s*\{([\s\S]*?)\n {2}\},/.exec(config);
  const map = new Map();
  for (const line of block?.[1].split('\n') ?? []) {
    const entry = /'([^']+)':\s*withDocsBase\('([^']+)'\)/.exec(line);
    // A target may carry its own fragment (a legacy URL folded into a section of
    // the page that absorbed it). Normalising that to a trailing slash would
    // produce a route matching no page at all.
    if (entry) map.set(`${entry[1]}/`, entry[2].includes('#') ? entry[2] : `${entry[2].replace(/\/$/, '')}/`);
  }
  return map;
}

/**
 * Anchors that a page's own Astro component renders, so they are absent from
 * the .mdx headings. Keep this list short: each entry is a page whose anchors
 * this checker cannot see.
 */
const COMPONENT_ANCHORS = new Map([
  ['/uikit/catalog/', /^presenter-class-(transport-time|parameters-gestures|mixing-capture|notes|views-analysis|layout-feedback)$/],
]);

/** Files served straight out of `public/` — links to them are not page links. */
function publicAssets() {
  const assets = new Set();
  const scan = (dir, prefix) => {
    for (const name of readdirSync(abs(dir))) {
      const path = `${dir}/${name}`;
      if (statSync(abs(path)).isDirectory()) scan(path, `${prefix}${name}/`);
      else assets.add(`/${prefix}${name}`);
    }
  };
  scan('apps/doc/webmusic/public', '');
  return assets;
}

function checkLinks(files, pages, redirects, assets) {
  for (const file of files) {
    const source = read(file);
    const page = relative(DOCS, file);
    for (const link of source.matchAll(/\]\(([/#][^)\s"]*)\)/g)) {
      const [path, fragment] = link[1].split('#');
      if (assets.has(path)) continue;
      const url = path === '' ? pageUrl(file) : path.endsWith('/') ? path : `${path}/`;
      const direct = pages.get(url);
      // A redirect is for a bookmark, not for a link this repository controls:
      // the plan requires inbound links to name the owning page, and Astro's
      // static redirect is a meta refresh that DROPS the fragment, so a bounced
      // anchor silently lands at the top of the replacement page.
      const bounce = direct ? undefined : redirects.get(url);
      const target = direct ?? pages.get(bounce?.split('#')[0] ?? '');
      if (!target) {
        fail('link', `${page}: → ${link[1]} is not a page`);
        continue;
      }
      if (bounce) {
        const lost = fragment ? `, and the redirect drops #${fragment}` : '';
        fail('link', `${page}: → ${link[1]} only resolves through the redirect to ${bounce}${lost} — link the owning page`);
        continue;
      }
      if (!fragment) continue;
      const allowed = COMPONENT_ANCHORS.get(url);
      if (allowed?.test(fragment)) continue;
      if (!target.headings.has(fragment)) {
        fail('link', `${page}: → ${link[1]} — no heading #${fragment} on that page`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 9. The docs site's own component kit must not squat on @webmusic/ui's class
//    names.
//
//    apps/doc/shared/ui.css loads globally on every page, and the elements the
//    docs demo mount kit presenters into the LIGHT DOM — so a docs rule sharing
//    a name with a kit class silently restyles the shipped component it is
//    supposed to be demonstrating, with the winner decided by document order.
//    Nine names collided when this check was written; `.wui-fader` was setting
//    `flex-direction: column` on the transport's horizontal volume control.
//
//    A docs page may still target a kit class deliberately — that is what the
//    documented class contract is for — so only the shared component stylesheet
//    is held to this rule.
// ---------------------------------------------------------------------------

function checkDocsCssNamespace() {
  // `walk` only collects doc pages, so the kit sources are read directly.
  const sourceFiles = (dir) =>
    readdirSync(abs(dir)).flatMap((name) => {
      const path = `${dir}/${name}`;
      if (statSync(abs(path)).isDirectory()) return sourceFiles(path);
      return name.endsWith('.ts') ? [path] : [];
    });
  const kit = new Set();
  for (const file of sourceFiles('packages/ui/src')) {
    const source = read(file);
    for (const match of source.matchAll(/["'`](wui-[a-z0-9-]+(?:__[a-z0-9-]+)?)/g)) kit.add(match[1]);
    for (const match of source.matchAll(/\.(wui-[a-z0-9-]+(?:__[a-z0-9-]+)?)/g)) kit.add(match[1]);
  }
  const stylesheet = 'apps/doc/shared/ui.css';
  const declared = new Set(
    [...read(stylesheet).matchAll(/\.(wui-[a-z0-9_-]+)/g)].map((match) => match[1]),
  );
  for (const name of [...declared].sort()) {
    if (kit.has(name)) {
      fail(
        'docs-css',
        `${stylesheet} declares .${name}, which @webmusic/ui also renders — a docs rule would restyle the shipped presenter. Use a doc- prefixed name.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 10. A documented CSS variable must have something behind it.
//
//     An element's `--wa*-*` / `--rc-*` / `--webscore-*` variables are promises
//     to a caller, and a promise with no reader is worse than no promise: it
//     looks supported. Six were dead when this check was written — five
//     `--wam-empty-*` for a placeholder that is really the kit's status
//     surface, and one `--wui-mixer-fill` left behind when the mixer's strips
//     moved onto the shared fader.
//
//     Live means one of three things in package source: the value is READ
//     (`var(--x`), WRITTEN for callers to read (`setProperty('--x'`), or
//     DECLARED in a stylesheet string (`--x:`). Kit `--wm-*` tokens are out of
//     scope — those are the kit's own vocabulary, checked by the architecture
//     gate from the other side.
// ---------------------------------------------------------------------------

function checkDocumentedCssVariables(files) {
  const sources = [];
  const collect = (dir) => {
    for (const name of readdirSync(abs(dir))) {
      const path = `${dir}/${name}`;
      if (statSync(abs(path)).isDirectory()) collect(path);
      else if (name.endsWith('.ts')) sources.push(read(path));
    }
  };
  for (const pkg of packageDirectories.filter((directory) => directory.startsWith('packages/')).map((directory) => `${directory}/src`)) collect(pkg);
  const source = sources.join('\n');
  const live = (name) =>
    source.includes(`var(${name}`) ||
    source.includes(`setProperty('${name}'`) ||
    source.includes(`setProperty("${name}"`) ||
    source.includes(`${name}:`);

  for (const file of files) {
    const seen = new Set();
    for (const match of read(file).matchAll(/`(--(?!wm-)[a-z][a-z0-9-]*)`/g)) {
      const name = match[1];
      if (seen.has(name) || live(name)) continue;
      seen.add(name);
      fail(
        'css-variable',
        `${relative(DOCS, file)} documents ${name}, which nothing in packages/*/src reads, writes or declares.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------

const files = walk(DOCS);
const sources = elementSources();
const paramsCatalog = await checkParams(sources);
const pages = collectPages(files);
await checkCatalogs(pages, paramsCatalog);
checkElementPages(files, paramsCatalog);
for (const message of headlessDocProblems({
  pages: files.map((file) => ({file, source: read(file)})),
  readFile: read,
  frameFile: 'apps/doc/webmusic/src/components/HeadlessDemoFrame.astro',
})) fail('headless-page', message);
checkLiveDemoCanvases(files);
checkTitles(files);
checkCapabilityGroups(files);
await checkUiKitLabels();
checkEntrySections(
  `${DOCS}/kernel/api.mdx`,
  'platform/kernel/package.json',
  /^## [a-z-]+ — @webmusic\/kernel\/([a-z-]+)$/gm,
);
checkRootEntryCoverage(`${DOCS}/kernel/api.mdx`, 'platform/kernel/package.json', '@webmusic/kernel');
for (const family of domainFamilies) {
  checkRootEntryCoverage(`${DOCS}/${family}/api/index.mdx`, `packages/${family}/package.json`, `@webmusic/${family}`);
}
checkRootEntryCoverage(`${DOCS}/uikit/api.mdx`, 'packages/ui/package.json', '@webmusic/ui');
for (const family of domainFamilies) {
  for (const capability of ['play', 'analyze', 'view']) {
    checkHeadlessExports(family, capability);
  }
}
checkDocsCssNamespace();
checkDocumentedCssVariables(files);
checkLinks(files, pages, astroRedirects(), publicAssets());

notes.push(`${files.length} pages · ${Object.keys(paramsCatalog).length} elements · ${pages.size} routes`);

if (failures.length) {
  const byCheck = {};
  for (const {check, message} of failures) (byCheck[check] ??= []).push(message);
  for (const [check, messages] of Object.entries(byCheck)) {
    console.error(`\n${check} (${messages.length})`);
    for (const message of messages) console.error(`  ${message}`);
  }
  console.error(`\ncheck-docs: ${failures.length} problem(s) — ${notes.join(', ')}`);
  process.exit(1);
}
console.log(`check-docs: clean — ${notes.join(', ')}`);
