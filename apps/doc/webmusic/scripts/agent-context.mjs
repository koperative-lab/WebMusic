import {createHash} from 'node:crypto';
import {readFile, readdir, realpath, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mdxToMdast, markdownToMdast, markdownToHast} from 'satteri';
import {load as loadYaml} from 'js-yaml';
import ts from 'typescript';
import {releaseBaseline} from './agent-context-release.mjs';
import {packageDirectories} from '../../../../scripts/package-policy.mjs';
import {
  contextFiles, catalogOutput, licenseOutput, sourceOutput, componentCatalog,
  catalogSourcePaths, assertPublicRuntimeSource, patternSelection, functionalIndexGroup,
} from './agent-context-catalog.mjs';

const defaultRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const docsDirectory = 'apps/doc/webmusic/src/content/docs';
const rawInputs = new Set([
  'apps/doc/webmusic/src/components/quick-start-player-client.ts',
]);
// These components are interactive controls, not reference content. Their
// owning pages retain the actual import/API examples and link to live demos.
const demoComponents = new Set([
  'QuickStartPlayerDemo', 'ProgrammaticRackDemo', 'ProgrammaticPlayerControllerDemo',
  'ProgrammaticLoopPlayerDemo', 'ScorePlayerPlayground', 'ProgrammaticMetronomeDemo',
  'ProgrammaticInteractivePlayerDemo', 'ScoreWindowPlayground', 'PlaybackFollowersPlayground',
  'ProgrammaticAbPlayerDemo', 'ProgrammaticEffectDemo', 'ProgrammaticSoundDemo',
  'AnalysisFeaturePlayground', 'NoteInputDemo', 'SheetViewPlayground', 'RackControlDemo',
  'SynthPanelDemo', 'LiveTrackersPlayground', 'AnalysisSessionPlayground',
  'PitchViewPlayground', 'ReactPresetShowcase', 'ScoreViewDemo', 'WaterfallKeyboardDemo',
  'UiPresenterLiveDemo', 'ScoreReportPlayground', 'ProgrammaticTransportDriverDemo',
]);
const htmlElements = new Set(['details', 'summary', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'br', 'p', 'div', 'span', 'strong', 'em', 'code', 'sup', 'sub']);
const digest = (value) => createHash('sha256').update(value).digest('hex');
const slash = (value) => value.split(path.sep).join('/');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function safeRelative(relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => !part || part === '..' || part.startsWith('.'))) {
    throw new Error(`Agent context rejects non-public path: ${relative}`);
  }
  return relative;
}

async function readPublic(root, relative, inputs) {
  safeRelative(relative);
  const filename = path.join(await realpath(root), relative);
  if (await realpath(filename) !== filename) throw new Error(`Agent context does not follow symbolic links: ${relative}`);
  const source = await readFile(filename, 'utf8');
  inputs?.set(relative, digest(source));
  return source;
}

async function walkFiles(directory, prefix = '') {
  const files = [];
  for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b) => compare(a.name, b.name))) {
    if (entry.isSymbolicLink()) throw new Error(`Agent context does not follow symbolic links: ${path.join(directory, entry.name)}`);
    if (entry.name.startsWith('.')) continue;
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await walkFiles(path.join(directory, entry.name), `${relative}/`));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function publicPages(root) {
  return (await walkFiles(path.join(root, docsDirectory))).filter((relative) =>
    /\.(md|mdx)$/.test(relative) && /^(?:index\.mdx?|quick-start\.mdx?|(?:agent-toolkit|score|uikit|kernel)\/)/.test(relative));
}

function pageRoute(relative) {
  return `/${relative.replace(/(?:^|\/)index\.mdx?$/, '').replace(/\.mdx?$/, '')}/`.replace(/\/+/g, '/');
}

function pageOutput(relative) { return `agent-context/${relative.replace(/\.mdx?$/, '.md')}`; }

/** Declared generated routes, relative to the site's base, for source checks. */
export async function declaredAgentContextPaths({root = defaultRoot} = {}) {
  const pages = (await publicPages(root)).map((relative) => ({route: pageRoute(relative), output: pageOutput(relative)}));
  const presenters = await catalogValues(root, 'apps/doc/shared/ui-presenter-catalog.ts', ['UI_PRESENTER_CATALOG']);
  const composition = await catalogValues(root, 'apps/doc/shared/ui-catalog.ts', ['UI_COMPOSITION_CATALOG']);
  const catalog = componentCatalog(pages, presenters.UI_PRESENTER_CATALOG, composition.UI_COMPOSITION_CATALOG);
  return new Set([
    ...Object.values(contextFiles).map((output) => `/${output}`),
    '/agent-context/manifest.json', `/${catalogOutput}`, `/${licenseOutput}`,
    ...pages.map(({output}) => `/${output}`),
    ...catalogSourcePaths(catalog).map((source) => `/${sourceOutput(source)}`),
  ]);
}

function urls(site, base) {
  const origin = new URL(site);
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Agent context site must be an HTTP(S) URL.');
  const prefix = `/${base.replace(/^\/+|\/+$/g, '')}/`.replace(/\/+/g, '/');
  if (prefix.includes('..') || /[?#\\]/.test(prefix)) throw new Error(`Invalid documentation base: ${base}`);
  const absolute = (route) => new URL(`${prefix}${route.replace(/^\/+/, '')}`, origin.origin).href;
  const link = (url) => url.startsWith('/') && !url.startsWith('//') ? absolute(url) : url;
  return {prefix, absolute, link};
}

function literal(node, location) {
  if (!node) throw new Error(`${location}: missing static value`);
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression, location);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken) return -literal(node.operand, location);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((entry) => literal(entry, location));
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map((entry) => {
      if (!ts.isPropertyAssignment(entry) || !entry.name || ts.isComputedPropertyName(entry.name)) throw new Error(`${location}: only literal object properties are supported`);
      return [entry.name.text, literal(entry.initializer, location)];
    }));
  }
  throw new Error(`${location}: unsupported computed value; use a literal string or an explicitly supported renderer`);
}

function typescript(source, location) {
  const tree = ts.createSourceFile(location, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (tree.parseDiagnostics.length) throw new Error(`${location}: ${ts.flattenDiagnosticMessageText(tree.parseDiagnostics[0].messageText, '\n')}`);
  return tree;
}

async function catalogValues(root, relative, names, inputs) {
  const tree = typescript(await readPublic(root, relative, inputs), relative);
  const values = {};
  for (const statement of tree.statements) if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
      let initializer = declaration.initializer;
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression;
      if (!ts.isArrayLiteralExpression(initializer)) throw new Error(`${relative}: catalog must be a literal array`);
      const fields = declaration.name.text === 'UI_PRESENTER_CATALOG'
        ? ['presenter', 'classSlug', 'summary', 'consumerTags']
        : ['tag', 'headless', 'ui', 'status', 'href'];
      values[declaration.name.text] = initializer.elements.map((entry) => {
        if (!ts.isObjectLiteralExpression(entry)) throw new Error(`${relative}: catalog entries must be literal objects`);
        return Object.fromEntries(fields.map((field) => {
          const property = entry.properties.find((candidate) => ts.isPropertyAssignment(candidate) && candidate.name.text === field);
          if (!property) throw new Error(`${relative}: catalog entry is missing ${field}`);
          return [field, literal(property.initializer, `${relative}: ${field}`)];
        }));
      });
    }
  }
  for (const name of names) if (!(name in values)) throw new Error(`${relative}: missing ${name}`);
  return values;
}

function fence(value, language = 'ts') {
  if (!/^[a-zA-Z0-9+-]+$/.test(language)) throw new Error(`Unsupported code language: ${language}`);
  const longest = Math.max(2, ...[...value.matchAll(/`+/g)].map((match) => match[0].length));
  const delimiter = '`'.repeat(longest + 1);
  return `${delimiter}${language}\n${value.replace(/\n$/, '')}\n${delimiter}`;
}

function table(headers, rows) {
  const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return [headers, headers.map(() => '---'), ...rows].map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n');
}

/** Parse MDX without executing it; preserve original Markdown and code spans. */
export async function extractAgentMarkdown(source, {
  filename = 'fixture.mdx', root = defaultRoot, canonical = 'https://example.test/',
  resolveLink = (value) => value, inputs = new Map(), catalogs,
} = {}) {
  let tree;
  try { tree = mdxToMdast(source); } catch (error) { throw new Error(`${filename}: cannot parse MDX: ${error.message}`); }
  const frontmatter = tree.children.find((node) => node.type === 'yaml');
  const metadata = frontmatter ? loadYaml(frontmatter.value, {json: true}) : {};
  if (!metadata || typeof metadata.title !== 'string') throw new Error(`${filename}: a string title is required`);
  if (metadata.slug !== undefined) throw new Error(`${filename}: custom slugs need an explicit agent-context route mapping`);
  const values = new Map();
  const exported = new Set();
  const used = new Set();
  const imports = new Map();
  const location = (node) => `${filename}:${node.position?.start.line ?? 1}`;
  for (const node of tree.children.filter((entry) => entry.type === 'mdxjsEsm')) {
    for (const statement of typescript(node.value, location(node)).statements) {
      if (ts.isImportDeclaration(statement)) {
        const target = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        if (target.endsWith('?raw')) {
          if (!clause?.name || clause.namedBindings) throw new Error(`${location(node)}: raw imports must have one default binding`);
          const relative = slash(path.relative(root, path.resolve(root, path.dirname(filename), target.slice(0, -4))));
          if (!rawInputs.has(relative)) throw new Error(`${location(node)}: raw input is outside the public allowlist: ${relative}`);
          values.set(clause.name.text, await readPublic(root, relative, inputs));
        } else if (clause?.name) {
          if (!target.endsWith('.astro') || !target.startsWith('.')) throw new Error(`${location(node)}: unsupported MDX component import ${target}`);
          imports.set(clause.name.text, target);
        } else if (['astro:components', '@astrojs/starlight/components'].includes(target) && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const entry of clause.namedBindings.elements) {
            if ((entry.propertyName?.text ?? entry.name.text) !== 'Code') throw new Error(`${location(node)}: unsupported Astro component`);
            imports.set(entry.name.text, 'Code');
          }
        } else throw new Error(`${location(node)}: unsupported import ${target}`);
      } else if (ts.isVariableStatement(statement) && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) throw new Error(`${location(node)}: destructured exports are unsupported`);
          const value = literal(declaration.initializer, location(node));
          if (typeof value !== 'string') throw new Error(`${location(node)}: MDX exports must be literal code strings`);
          values.set(declaration.name.text, value);
          exported.add(declaration.name.text);
        }
      } else throw new Error(`${location(node)}: unsupported MDX JavaScript; executable expressions are never evaluated`);
    }
  }
  const attributes = (node) => Object.fromEntries(node.attributes.map((attribute) => {
    if (attribute.type !== 'mdxJsxAttribute') throw new Error(`${location(node)}: spread attributes are unsupported`);
    const value = attribute.value;
    if (typeof value === 'object' && value !== null) {
      if (!/^[A-Za-z_$][\w$]*$/.test(value.value.trim()) || !values.has(value.value.trim())) throw new Error(`${location(node)}: unsupported expression ${value.value}`);
      used.add(value.value.trim());
      return [attribute.name, values.get(value.value.trim())];
    }
    return [attribute.name, value];
  }));
  const span = (node) => source.slice(node.position.start.offset, node.position.end.offset);
  const children = (node) => {
    let result = '';
    let offset = node.position.start.offset;
    for (const child of node.children ?? []) {
      result += source.slice(offset, child.position.start.offset) + render(child);
      offset = child.position.end.offset;
    }
    return result + source.slice(offset, node.position.end.offset);
  };
  const render = (node) => {
    if (node.type === 'yaml' || node.type === 'mdxjsEsm') return '';
    if (node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') throw new Error(`${location(node)}: unsupported MDX expression; add an explicit static renderer`);
    if (node.type === 'link' || node.type === 'image') {
      const target = resolveLink(node.url);
      if (target === node.url) return children(node);
      const label = node.type === 'image' ? node.alt : node.children.map((child) => render(child)).join('');
      return `${node.type === 'image' ? '!' : ''}[${label}](<${target}>${node.title ? ` ${JSON.stringify(node.title)}` : ''})`;
    }
    if (node.type === 'definition') return `[${node.label ?? node.identifier}]: <${resolveLink(node.url)}>${node.title ? ` ${JSON.stringify(node.title)}` : ''}`;
    if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
      if (!node.name || htmlElements.has(node.name)) {
        if (node.attributes.some((attribute) => attribute.type !== 'mdxJsxAttribute' || (typeof attribute.value === 'object' && attribute.value !== null))) {
          throw new Error(`${location(node)}: HTML attributes must be literal strings`);
        }
        const result = children(node);
        let quote;
        let end = 0;
        for (; end < result.length; end++) {
          const character = result[end];
          if (quote ? character === quote : character === '"' || character === "'") quote = quote ? undefined : character;
          else if (!quote && character === '>') break;
        }
        // Rewrite only this element's opening tag: code fences nested in
        // <details> are examples and their application URLs must stay intact.
        return result.slice(0, end).replace(/\b(href|src)=(['"])(.*?)\2/g, (_, key, mark, value) => `${key}=${mark}${resolveLink(value)}${mark}`) + result.slice(end);
      }
      if (!imports.has(node.name)) throw new Error(`${location(node)}: unsupported component ${node.name}`);
      const attrs = attributes(node);
      if (node.name === 'ApiSandbox' || imports.get(node.name) === 'Code') {
        if (typeof attrs.code !== 'string') throw new Error(`${location(node)}: ${node.name} requires a static code string`);
        return fence(attrs.code, attrs.lang ?? 'ts');
      }
      if (node.children.length) throw new Error(`${location(node)}: ${node.name} children require an explicit renderer`);
      if (demoComponents.has(node.name)) return `[Interactive example on the documentation page](${canonical})`;
      if (node.name === 'UiPresenterCatalog' && catalogs) {
        return table(['Presenter', 'Group', 'Purpose'], catalogs.presenters.map((entry) => [`[\`@webmusic/ui/${entry.presenter}\`](${resolveLink(`/uikit/${entry.classSlug}/${entry.presenter}/`)})`, entry.classSlug, entry.summary]));
      }
      if (node.name === 'UiCompositionCatalog' && catalogs) {
        return table(['Element', 'Headless / model', 'UI composition', 'Status'], catalogs.composition.map((entry) => [`[\`<${entry.tag}>\`](${resolveLink(entry.href)})`, entry.headless, entry.ui, entry.status]));
      }
      if (node.name === 'UiPresenterRelated' && catalogs) {
        const entry = catalogs.presenters.find((candidate) => candidate.presenter === attrs.presenter);
        if (!entry) throw new Error(`${location(node)}: unknown presenter ${attrs.presenter}`);
        const consumers = entry.consumerTags.map((tag) => {
          const consumer = catalogs.composition.find((candidate) => candidate.tag === tag);
          if (!consumer) throw new Error(`${location(node)}: unknown consumer ${tag}`);
          return `- [\`<${tag}>\`](${resolveLink(consumer.href)})`;
        });
        const related = catalogs.presenters.filter((candidate) => candidate.presenter !== entry.presenter && candidate.classSlug === entry.classSlug)
          .map((candidate) => `- [\`@webmusic/ui/${candidate.presenter}\`](${resolveLink(`/uikit/${candidate.classSlug}/${candidate.presenter}/`)})`);
        return `## Used by\n\n${consumers.join('\n') || 'Mount this presenter with application-owned state and bindings.'}\n\n## Related presenters\n\n${related.join('\n')}`;
      }
      throw new Error(`${location(node)}: unsupported component ${node.name}; add an explicit renderer`);
    }
    return node.children ? children(node) : span(node);
  };
  let body = render(tree).trim();
  const unused = [...exported].filter((name) => !used.has(name));
  if (unused.length) body += `\n\n## Additional code examples\n\n${unused.map((name) => `### ${name}\n\n${fence(values.get(name))}`).join('\n\n')}`;
  return {title: metadata.title, description: metadata.description ?? '', body: `${body}\n`};
}

/** Check the retained release source fingerprint, not just package versions. */
export async function verifyReleaseBaseline({root = defaultRoot, baseline = releaseBaseline} = {}) {
  if (baseline === releaseBaseline && JSON.stringify(baseline.packages.map(({directory}) => directory)) !== JSON.stringify(packageDirectories)) {
    throw new Error('Agent context release mapping must match the public package policy.');
  }
  for (const record of baseline.packages) {
    const manifest = await readPublic(root, `${record.directory}/package.json`);
    const parsed = JSON.parse(manifest);
    const sourceFiles = await walkFiles(path.join(root, record.directory, 'src'));
    const source = [];
    for (const relative of sourceFiles) source.push([relative, digest(await readPublic(root, `${record.directory}/src/${relative}`))]);
    if (parsed.name !== record.name || parsed.version !== record.version || digest(manifest) !== record.manifestSha256 || digest(json(source)) !== record.sourceSha256) {
      throw new Error(`Agent context release baseline mismatch for ${record.name}. Review source/API compatibility and update the verified release mapping before publishing context; unchanged package versions are insufficient.`);
    }
  }
  return baseline;
}

export function patternSections(markdown, names, filename) {
  const tree = markdownToMdast(markdown);
  const headings = tree.children.filter((node) => node.type === 'heading');
  return names.map((name) => {
    const index = headings.findIndex((node) => markdown.slice(node.position.start.offset, node.position.end.offset).replace(/^#+\s*/, '') === name);
    if (index === -1) throw new Error(`${filename}: missing curated pattern heading ${name}`);
    const heading = headings[index];
    const end = headings.slice(index + 1).find((node) => node.depth <= heading.depth)?.position.start.offset ?? markdown.length;
    // Component references put full API tables in a details block after the
    // prose. Those tables belong in the components bundle, not these recipes.
    const details = tree.children.find((node) => node.type === 'html' && /^<details\b/.test(node.value) && node.position.start.offset > heading.position.start.offset && node.position.start.offset < end);
    return markdown.slice(heading.position.start.offset, details?.position.start.offset ?? end).trim();
  }).join('\n\n');
}

export async function generateAgentContext({root = defaultRoot, site = 'https://koperative-lab.github.io', base = '/'} = {}) {
  root = path.resolve(root);
  const release = await verifyReleaseBaseline({root});
  const url = urls(site, base);
  const inputs = new Map();
  // Curated membership and extraction logic change the documentation product
  // even when the input MDX is unchanged. Include those public owners in its
  // revision, rather than hashing just the source pages.
  for (const source of [
    'apps/doc/webmusic/scripts/agent-context.mjs',
    'apps/doc/webmusic/scripts/agent-context-catalog.mjs',
    'apps/doc/webmusic/scripts/agent-context-release.mjs',
    'scripts/element-composition-policy.mjs', 'scripts/package-policy.mjs',
  ]) await readPublic(root, source, inputs);
  const presenters = await catalogValues(root, 'apps/doc/shared/ui-presenter-catalog.ts', ['UI_PRESENTER_CATALOG'], inputs);
  const composition = await catalogValues(root, 'apps/doc/shared/ui-catalog.ts', ['UI_COMPOSITION_CATALOG'], inputs);
  const files = new Map();
  const pages = [];
  const packageVersions = Object.fromEntries(release.packages.map(({name, version}) => [name, version]));
  for (const relative of await publicPages(root)) {
    const filename = `${docsDirectory}/${relative}`;
    const canonical = url.absolute(pageRoute(relative));
    const page = await extractAgentMarkdown(await readPublic(root, filename, inputs), {
      filename, root, canonical, resolveLink: url.link, inputs,
      catalogs: {presenters: presenters.UI_PRESENTER_CATALOG, composition: composition.UI_COMPOSITION_CATALOG},
    });
    const owner = relative.startsWith('score/') ? '@webmusic/score' : relative.startsWith('uikit/') ? '@webmusic/ui' : relative.startsWith('kernel/') ? '@webmusic/kernel' : null;
    const output = pageOutput(relative);
    const record = {title: page.title, description: page.description, source: filename, route: pageRoute(relative), canonical, output, url: url.absolute(output), package: owner, version: owner ? packageVersions[owner] : null};
    pages.push(record);
    files.set(output, `# ${page.title}\n\n${page.description ? `> ${page.description}\n\n` : ''}Canonical documentation: ${canonical}\n\nRelease compatibility: ${Object.entries(owner ? {[owner]: packageVersions[owner]} : packageVersions).map(([name, version]) => `${name}@${version}`).join(', ')}. Source baseline: ${release.commit}.\n\n${page.body}`);
  }
  const catalog = componentCatalog(pages, presenters.UI_PRESENTER_CATALOG, composition.UI_COMPOSITION_CATALOG);
  for (const source of catalogSourcePaths(catalog)) {
    assertPublicRuntimeSource(source, release);
    files.set(sourceOutput(source), await readPublic(root, source, inputs));
  }
  for (const output of [...catalog.components.flatMap(({docs, source, styles}) => [...docs, ...source, ...styles]), ...catalog.theme.docs, ...catalog.theme.source]) {
    if (!files.has(output)) throw new Error(`Agent catalog references an output that was not generated: ${output}`);
  }
  files.set(catalogOutput, json(catalog));
  files.set(licenseOutput, await readPublic(root, 'LICENSE', inputs));
  const inputsList = [...inputs].sort(([a], [b]) => compare(a, b)).map(([source, sha256]) => ({source, sha256}));
  const documentationRevision = digest(json(inputsList));
  const compatibility = `This context covers ${Object.entries(packageVersions).map(([name, version]) => `${name}@${version}`).join(', ')}. Runtime sources and package manifests match release ${release.commit}; documentation revision ${documentationRevision}. Check installed exports and declarations before coding. This is the current verified release, not an archive of arbitrary versions.`;
  const selection = new Map();
  // Put orientation first, followed by task groups in a stable order.
  for (const page of [...pages].sort((a, b) => (functionalIndexGroup(a) === 'Start here and choose an integration' ? -1 : 0) - (functionalIndexGroup(b) === 'Start here and choose an integration' ? -1 : 0))) {
    const group = functionalIndexGroup(page);
    if (!selection.has(group)) selection.set(group, []);
    selection.get(group).push(page);
  }
  const index = `# WebMusic\n\n> Music interaction toolkit: Web Components, Headless objects, and API + UI composition.\n\n${compatibility}\n\nStart with this index to locate a task, then fetch its linked Markdown reference. Select Web Components for ready-made controls, Headless for custom UI, or API + UI for explicit bindings. Interactive demo controls are linked; static examples and reference tables are preserved.\n\n## Choose a context file\n\n- [llms-full.txt](${url.absolute(contextFiles.full)}): All public documentation in one file.\n- [llms-components.txt](${url.absolute(contextFiles.components)}): Web Component, Headless and UI presenter references.\n- [llms-patterns.txt](${url.absolute(contextFiles.patterns)}): Focused setup, composition, playback-following, React, styling and I/O patterns.\n- [Context manifest](${url.absolute('agent-context/manifest.json')}): Release, content checksums, pages and bundle membership.\n- [Component catalog](${url.absolute(catalogOutput)}): Stable query IDs and verified documentation/source paths for the Skill scripts.\n\n${[...selection].map(([label, entries]) => `## ${label}\n\n${entries.map((page) => `- [${page.title.replace(/\[/g, '\\[').replace(/\]/g, '\\]')}](${page.url}): ${page.description || `Reference for ${page.title}`}`).join('\n')}`).join('\n\n')}\n`;
  files.set(contextFiles.index, index);
  const componentOutputs = new Set(catalog.components.flatMap(({docs}) => docs));
  const componentPages = pages.filter((page) => componentOutputs.has(page.output) || ['/score/element/', '/score/headless/', '/uikit/catalog/'].includes(page.route));
  const bundles = [
    {id: 'full', output: contextFiles.full, title: 'WebMusic complete documentation', description: 'All public documentation pages, including setup, API, components and Agent Toolkit guidance.', pages: pages.map(({output}) => output)},
    {id: 'components', output: contextFiles.components, title: 'WebMusic component references', description: 'Web Component, Headless and UI presenter contracts, examples, lifecycle and styling.', pages: componentPages.map(({output}) => output)},
    {id: 'patterns', output: contextFiles.patterns, title: 'WebMusic composition and usage patterns', description: 'Curated task sections from the owning public references. Follow the source links for complete API tables.', pages: patternSelection.map(({page}) => pageOutput(page)), sections: patternSelection.map(({title, page, sections}) => ({title, page: pageOutput(page), headings: sections ?? null}))},
  ];
  for (const bundle of bundles) {
    const body = bundle.id === 'patterns' ? patternSelection.map(({title, page: relative, sections}) => {
      const page = pages.find((entry) => entry.output === pageOutput(relative));
      if (!page) throw new Error(`Missing pattern source: ${relative}`);
      const source = files.get(page.output);
      return `# ${title}\n\nSource: [${page.title}](${page.canonical}) · [Complete Markdown](${page.url})\n\n${sections ? patternSections(source, sections, relative) : source}`;
    }).join('\n\n---\n\n') : bundle.pages.map((output) => files.get(output)).join('\n---\n\n');
    files.set(bundle.output, `# ${bundle.title}\n\n> ${bundle.description}\n\n${compatibility}\n\n[Documentation index](${url.absolute(contextFiles.index)})\n\n${body}\n`);
  }
  const manifest = {
    schemaVersion: 1, release: {commit: release.commit, packages: packageVersions, verification: 'runtime-source-and-manifest-sha256'},
    documentationRevision, site: new URL(site).origin, base: url.prefix,
    extraction: {interactiveDemos: 'canonical-page-link', staticCode: 'preserved', mdxExpressions: 'literal-only', catalogComponents: 'static-tables'},
    inputs: inputsList, pages, bundles, catalog: catalogOutput, license: catalog.license,
    outputs: [...files].map(([output, contents]) => ({path: output, sha256: digest(contents)})).sort((a, b) => compare(a.path, b.path)),
  };
  files.set('agent-context/manifest.json', json(manifest));
  return {files, manifest};
}

/** Verify every emitted byte and local link against build artifacts. */
export async function verifyAgentContextOutput(directory, generated) {
  const {files, manifest} = generated;
  for (const page of manifest.pages) {
    const local = page.route.replace(/^\/+/, '');
    await readFile(path.join(directory, local, 'index.html')).catch(() => { throw new Error(`Agent context canonical page has no built target: ${page.canonical}`); });
  }
  for (const [relative, expected] of files) {
    if (await readFile(path.join(directory, relative), 'utf8') !== expected) throw new Error(`Agent context output mismatch: ${relative}`);
    // Runtime source is served verbatim as text; comments or template literals
    // that resemble Markdown links are code, not generated documentation links.
    if (!/\.(md|txt)$/.test(relative) || relative.startsWith('agent-context/source/')) continue;
    const visit = async (node) => {
      for (const address of [node.properties?.href, node.properties?.src].filter((value) => typeof value === 'string')) {
        const target = new URL(address, new URL(relative, `${manifest.site}${manifest.base}`));
        if (target.origin === manifest.site) {
          if (!target.pathname.startsWith(manifest.base)) throw new Error(`${relative}: link escapes documentation base: ${address}`);
          const local = decodeURIComponent(target.pathname.slice(manifest.base.length));
          const filename = local.endsWith('/') || !path.extname(local) ? `${local.replace(/\/$/, '')}/index.html`.replace(/^\//, '') : local;
          await readFile(path.join(directory, safeRelative(filename))).catch(() => { throw new Error(`${relative}: generated link has no built target: ${address}`); });
        }
      }
      for (const child of node.children ?? []) await visit(child);
    };
    await visit(markdownToHast(expected, {features: {rawHtml: true}}));
  }
}

export function agentContext() {
  let root = defaultRoot;
  let site = 'https://koperative-lab.github.io';
  let base = '/';
  return {
    name: 'webmusic-agent-context',
    hooks: {
      'astro:config:done': ({config}) => {
        root = path.resolve(fileURLToPath(config.root), '../../..');
        site = config.site || site;
        base = config.base;
      },
      'astro:server:setup': async ({server}) => {
        // Read on demand so edits, imported snippets and release mismatches are
        // visible immediately without a persistent stale development cache.
        server.middlewares.use(async (request, response, next) => {
          const pathname = new URL(request.url || '/', 'http://localhost').pathname;
          const prefix = urls(site, base).prefix;
          // Astro removes config.base before integration middleware runs.
          // Accept an intact base too for middleware harnesses/other adapters.
          const relative = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname.replace(/^\//, '');
          if (!Object.values(contextFiles).includes(relative) && !relative.startsWith('agent-context/')) return next();
          try {
            const generated = await generateAgentContext({root, site, base});
            const contents = generated.files.get(relative);
            if (contents === undefined) return next();
            response.setHeader('Content-Type', relative.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8');
            response.setHeader('Cache-Control', 'no-store');
            response.end(contents);
          } catch (error) { next(error); }
        });
      },
      'astro:build:done': async ({dir, logger}) => {
        const directory = fileURLToPath(dir);
        const generated = await generateAgentContext({root, site, base});
        for (const [relative, contents] of generated.files) {
          await mkdir(path.dirname(path.join(directory, relative)), {recursive: true});
          await writeFile(path.join(directory, relative), contents);
        }
        await verifyAgentContextOutput(directory, generated);
        logger.info(`Agent context verified ${generated.manifest.pages.length} public Markdown references, four llms files and the Skill catalog.`);
      },
    },
  };
}
