import {createHash} from 'node:crypto';
import {readFile, realpath} from 'node:fs/promises';
import path from 'node:path';

const defaultBase = 'https://koperative-lab.github.io/WebMusic/';
const packages = ['@webmusic/kernel', '@webmusic/ui', '@webmusic/score'];
const bundles = {index: 'llms.txt', full: 'llms-full.txt', components: 'llms-components.txt', patterns: 'llms-patterns.txt'};
const maxBytes = 32 * 1024 * 1024;

export function options(args, {positionals = 0, list = false} = {}) {
  const result = {values: []};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument === '--json' && list) result.json = true;
    else if (['--base-url', '--context-dir', ...(list ? ['--kind'] : [])].includes(argument)) {
      if (result[argument] !== undefined) throw new Error(`Duplicate option: ${argument}`);
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${argument} needs a value.`);
      result[argument] = value;
    } else if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}. Use --help.`);
    else result.values.push(argument);
  }
  if (result.help) return result;
  if (result.values.length !== positionals) throw new Error(`Expected ${positionals ? 'one component ID or document route' : 'no positional arguments'}. Use --help.`);
  if (result['--base-url'] && result['--context-dir']) throw new Error('Choose either --base-url or --context-dir.');
  if (result['--kind'] && !['element', 'headless', 'ui'].includes(result['--kind'])) throw new Error('--kind must be element, headless or ui.');
  return result;
}

function outputPath(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_./-]+$/.test(value) || value.startsWith('/') || value.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid context output path: ${String(value)}`);
  }
  return value;
}

function json(contents, label) {
  try { return JSON.parse(contents); }
  catch (cause) { throw new Error(`${label} is not valid JSON. Use a generated WebMusic documentation site.`, {cause}); }
}

export async function loadContext(settings) {
  const directory = settings['--context-dir'] ? await realpath(settings['--context-dir']) : null;
  const base = new URL(settings['--base-url'] ?? defaultBase);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('--base-url must be an HTTP(S) site root without credentials, query or fragment.');
  if (!base.pathname.endsWith('/')) base.pathname += '/';

  async function read(relative) {
    outputPath(relative);
    let data;
    if (directory) {
      let filename;
      try { filename = await realpath(path.join(directory, relative)); }
      catch (cause) { throw new Error(`Missing context file: ${relative}. --context-dir must point to a complete generated site root.`, {cause}); }
      const inside = path.relative(directory, filename);
      if (inside.startsWith(`..${path.sep}`) || inside === '..' || path.isAbsolute(inside)) throw new Error(`Context file escapes the selected directory: ${relative}`);
      data = await readFile(filename);
    } else {
      const url = new URL(relative, base);
      let response;
      try { response = await fetch(url, {signal: AbortSignal.timeout(30_000), redirect: 'error'}); }
      catch (error) { throw new Error(`Could not fetch ${url}: ${error.message}. Check the site root or use --context-dir.`, {cause: error}); }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} for ${url}. Check that the Agent Toolkit is deployed at this site root.`);
      }
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body ?? []) {
        length += chunk.length;
        if (length > maxBytes) throw new Error(`Context file exceeds 32 MiB: ${relative}`);
        chunks.push(chunk);
      }
      data = Buffer.concat(chunks);
    }
    if (data.length > maxBytes) throw new Error(`Context file exceeds 32 MiB: ${relative}`);
    return data;
  }

  const manifest = json(await read('agent-context/manifest.json'), 'Context manifest');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.outputs) || !Array.isArray(manifest.pages)) throw new Error('Unsupported context manifest. Update the skill and context together.');
  if (manifest.mode === 'development') throw new Error('Unreleased development context is not compatible with this release Skill. Use the verified published context for installed packages.');
  for (const name of packages) {
    if (manifest.release?.packages?.[name] !== '0.1.0') throw new Error(`Unsupported context version for ${name}: ${manifest.release?.packages?.[name] ?? 'missing'}. This skill supports 0.1.0; use matching context and installed package declarations.`);
  }
  const hashes = new Map();
  for (const record of manifest.outputs) {
    outputPath(record.path);
    if (!/^[a-f0-9]{64}$/.test(record.sha256) || hashes.has(record.path)) throw new Error(`Invalid or duplicate manifest output: ${record.path}`);
    hashes.set(record.path, record.sha256);
  }
  async function text(relative) {
    outputPath(relative);
    const expected = hashes.get(relative);
    if (!expected) throw new Error(`Output is not in the context manifest: ${relative}`);
    const contents = await read(relative);
    if (createHash('sha256').update(contents).digest('hex') !== expected) throw new Error(`Context hash mismatch: ${relative}. Refresh the complete context snapshot; do not mix builds.`);
    return contents.toString('utf8');
  }
  async function catalog() {
    const value = json(await text(manifest.catalog), 'Component catalog');
    if (value.schemaVersion !== 1 || !Array.isArray(value.components) || !value.theme) throw new Error('Unsupported component catalog. Update the skill and context together.');
    for (const component of [...value.components, value.theme]) {
      for (const field of ['docs', 'source', ...(component === value.theme ? [] : ['styles'])]) {
        if (!Array.isArray(component[field])) throw new Error(`Catalog ${field} must be an output-path list.`);
        component[field].forEach(outputPath);
      }
    }
    return value;
  }
  async function component(id) {
    const selected = (await catalog()).components.find((item) => item.id === id);
    if (!selected) throw new Error(`Unknown component ID: ${id}. Run list_components.mjs to choose an element/, headless/ or ui/ ID.`);
    return selected;
  }
  async function document(query) {
    const normalized = `/${query.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
    const selected = (Object.hasOwn(bundles, query) ? bundles[query] : undefined) ?? Object.values(bundles).find((value) => value === query) ?? manifest.pages.find((page) => page.route === normalized || page.output === query)?.output;
    if (!selected) throw new Error(`Unknown document: ${query}. Use index, full, components, patterns, or a route from llms.txt.`);
    return text(selected);
  }
  return {manifest, text, catalog, component, document};
}

async function documents(context, paths) {
  return (await Promise.all([...new Set(paths)].map((relative) => context.text(relative)))).join('\n\n---\n\n');
}

async function sources(context, paths) {
  return (await Promise.all([...new Set(paths)].map(async (relative) => {
    const contents = await context.text(relative);
    const fence = '`'.repeat(Math.max(2, ...[...contents.matchAll(/`+/g)].map(([ticks]) => ticks.length)) + 1);
    const extension = path.extname(relative.replace(/\.txt$/, '')).slice(1);
    return `## ${relative}\n\n${fence}${extension}\n${contents.trimEnd()}\n${fence}\n`;
  }))).join('\n');
}

async function sourceLicense() {
  const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');
  return `\n# Source license\n\n${license.trimEnd()}\n`;
}

const commands = {
  list_components: {summary: 'List component IDs, titles and owning reference paths.', usage: '[--kind element|headless|ui] [--json]', list: true},
  get_component_docs: {summary: 'Read the owning reference for an exact component ID.', usage: '<component-id>', positionals: 1},
  get_source: {summary: 'Read selected implementation entry files. These are not supported import paths or a complete dependency tree.', usage: '<component-id>', positionals: 1},
  get_styles: {summary: 'Read public styling contracts: tokens, parts and presenter bindings. Output is reference text, not an installable stylesheet.', usage: '<component-id>', positionals: 1},
  get_theme: {summary: 'Read shared theming documentation and selected implementation files.', usage: ''},
  get_docs: {summary: 'Read a documented site route, generated Markdown path, or context bundle.', usage: '<route|index|full|components|patterns>', positionals: 1},
};

export async function run(command, args = process.argv.slice(2)) {
  try {
    const config = commands[command];
    const settings = options(args, config);
    if (settings.help) {
      process.stdout.write(`${config.summary}\n\nUsage: node ${command}.mjs ${config.usage} [options]\n\nOptions:\n  --base-url URL       Documentation site root (default: ${defaultBase})\n  --context-dir PATH   Complete generated site root; reads without network\n  --help, -h           Show this help without fetching context\n\nRequires Node >=22.19.0. Read-only; context must match WebMusic 0.1.0.\n`);
      return;
    }
    const context = await loadContext(settings);
    let result;
    if (command === 'list_components') {
      const entries = (await context.catalog()).components.filter((item) => !settings['--kind'] || item.kind === settings['--kind']);
      result = settings.json ? JSON.stringify(entries, null, 2) : entries.map((item) => `${item.id}\t${item.title}\n  ${item.description}\n  ${item.docs.join(', ')}`).join('\n');
    } else if (command === 'get_docs') result = await context.document(settings.values[0]);
    else if (command === 'get_theme') {
      const theme = (await context.catalog()).theme;
      result = `${await documents(context, theme.docs)}\n\n# Theme implementation reference\n\nSelected source files at release ${context.manifest.release.commit}.\n\n${await sources(context, theme.source)}${await sourceLicense()}`;
    } else {
      const selected = await context.component(settings.values[0]);
      if (command === 'get_source') {
        if (!selected.source.length) throw new Error(`No source entries for ${selected.id}. Use get_component_docs.mjs for its public contract.`);
        result = `# ${selected.title}: implementation reference\n\nSelected entry files at release ${context.manifest.release.commit}. Follow the component documentation for supported imports; this is not a complete transitive source tree.\n\n${await sources(context, selected.source)}${await sourceLicense()}`;
      } else {
        const paths = command === 'get_styles' ? selected.styles : selected.docs;
        if (!paths.length) throw new Error(`No ${command === 'get_styles' ? 'visual styling contract' : 'reference'} for ${selected.id}. Use get_component_docs.mjs for its behavior or choose a ui/ presenter from list_components.mjs.`);
        result = await documents(context, paths);
      }
    }
    process.stdout.write(result.endsWith('\n') ? result : `${result}\n`);
  } catch (error) {
    process.stderr.write(`WebMusic: ${error.message}\n`);
    process.exitCode = 1;
  }
}
