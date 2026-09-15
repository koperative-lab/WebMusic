#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readFile, readdir, mkdir, stat, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotDirectory = path.join(repository, 'scripts/licenses/site');
const noticePath = 'licenses/THIRD_PARTY_NOTICES.txt';
const inventoryPath = 'licenses/BUNDLED_ASSETS.json';
const marker = 'WebMusic site licenses:';
const reviewedSiteLicenses = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Unlicense', 'CC0-1.0', 'W3C-20150513']);
const slash = (value) => value.split(path.sep).join('/');
const digest = (value) => createHash('sha256').update(value).digest('hex');

async function filesUnder(directory) {
  return (await Promise.all((await readdir(directory, {withFileTypes: true})).map((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(filename) : [filename];
  }))).flat().sort();
}

function sourcePath(id) {
  const clean = id.replace(/^\0/, '').replace(/^\/@fs\//, '/').split('?')[0];
  return path.isAbsolute(clean) ? clean : null;
}

export async function sitePackageOwner(filename) {
  let directory = path.dirname(filename);
  while (directory !== path.dirname(directory)) {
    try {
      const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name) return {directory, manifest};
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Cannot identify the package owning ${filename}`);
}

/** Include upstream LICENSE/NOTICE directories as well as single license files. */
export async function readSitePackageNotice({directory, manifest}) {
  if (manifest.name === '@codesandbox/nodebox') {
    throw new Error('Nodebox runtime is excluded by the documentation site distribution policy; use browser sandbox templates.');
  }
  if (!reviewedSiteLicenses.has(manifest.license)) {
    throw new Error(`Review ${manifest.name}@${manifest.version} license ${manifest.license} against the site distribution policy before bundling it.`);
  }
  const documents = [];
  let hasLicense = false;
  for (const name of (await readdir(directory)).sort()) {
    if (!/^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(name)) continue;
    const filename = path.join(directory, name);
    const paths = (await stat(filename)).isDirectory() ? await filesUnder(filename) : [filename];
    for (const file of paths) {
      const text = (await readFile(file, 'utf8')).replace(/\r\n?/g, '\n').trim();
      if (!text || text.includes('\0')) throw new Error(`Invalid license text: ${file}`);
      documents.push(`${slash(path.relative(directory, file))}\n${text}`);
      if (/^(?:licen[cs]e|copying)/i.test(name)) hasLicense = true;
    }
  }
  if (!documents.length && manifest.name === '@nodable/entities' && manifest.version === '3.0.0'
      && manifest.license === 'MIT' && manifest.repository?.url === 'git+https://github.com/nodable/val-parsers.git') {
    documents.push(`Reviewed upstream LICENSE\n${(await readFile(path.join(repository, 'scripts/licenses/nodable-entities-3.0.0-MIT.txt'), 'utf8')).trim()}`);
    hasLicense = true;
  }
  if (!hasLicense) {
    const reviewed = JSON.parse(await readFile(path.join(snapshotDirectory, 'missing-licenses.json'), 'utf8'))[`${manifest.name}@${manifest.version}`];
    const repository = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
    if (reviewed && manifest.license === reviewed.license && repository === reviewed.repository) {
      const content = await readFile(path.join(snapshotDirectory, reviewed.file), 'utf8');
      if (digest(content) !== reviewed.sha256
          || digest(await readFile(path.join(directory, reviewed.artifact))) !== reviewed.artifactSha256) {
        throw new Error(`Reviewed package or license changed: ${manifest.name}@${manifest.version}`);
      }
      documents.push(`Reviewed license\nSource: ${reviewed.source}\n\n${content.trim()}`);
      hasLicense = true;
    }
  }
  if (!hasLicense || typeof manifest.license !== 'string') {
    throw new Error(`${manifest.name}@${manifest.version}: bundled site code needs a license identifier and license text.`);
  }
  return {
    key: `${manifest.name}@${manifest.version}`,
    license: manifest.license,
    text: `${manifest.name}@${manifest.version}\nLicense: ${manifest.license}\n\n${documents.join('\n\n')}`,
  };
}

export async function readSiteSupplement(owner, {directory = snapshotDirectory} = {}) {
  const {manifest} = owner;
  if (!['vexflow', 'opensheetmusicdisplay', 'static-browser-server', 'spessasynth_core', 'stb-vorbis'].includes(manifest.name)) return [];
  const filename = path.join(directory, `${manifest.name}-${manifest.version}.json`);
  let supplement;
  try { supplement = JSON.parse(await readFile(filename, 'utf8')); } catch (cause) {
    throw new Error(`Review the prebundled assets and licenses for ${manifest.name}@${manifest.version} before building the site.`, {cause});
  }
  if (supplement.package !== manifest.name || supplement.version !== manifest.version) {
    throw new Error(`Wrong package/version in ${filename}`);
  }
  for (const artifact of supplement.artifacts ?? []) {
    const installed = path.resolve(owner.directory, artifact.file);
    if (!installed.startsWith(owner.directory + path.sep)
        || digest(await readFile(installed)) !== artifact.sha256) {
      throw new Error(`Reviewed bundled asset changed: ${manifest.name}/${artifact.file}`);
    }
  }
  const documents = await Promise.all(supplement.documents.map(async (document) => {
    const text = (await readFile(path.join(directory, document.file), 'utf8')).trim();
    if (!text) throw new Error(`Empty supplementary license: ${document.file}`);
    if (document.sha256 && digest(await readFile(path.join(directory, document.file))) !== document.sha256) {
      throw new Error(`Reviewed supplementary license changed: ${document.file}`);
    }
    return `${document.title}\nSource: ${document.source}\n\n${text}`;
  }));
  return [{
    key: `${manifest.name}@${manifest.version} bundled assets`,
    license: 'See individual notices below',
    text: `${manifest.name}@${manifest.version}: bundled asset licenses\n\n${documents.join('\n\n' + '='.repeat(72) + '\n\n')}`,
  }];
}

export function siteNoticeReference(filename) {
  return slash(path.posix.relative(path.posix.dirname(slash(filename)), noticePath));
}

export function attachSiteNotice(code, filename) {
  const reference = `/*! ${marker} ${siteNoticeReference(filename)} */`;
  if (code.includes(reference)) return code;
  // Append before sourceMappingURL: no generated code or source-map offsets move.
  const footer = code.match(/\n\/\/[#@] sourceMappingURL=[^\r\n]*\n?$/)?.[0] ?? '';
  const body = footer ? code.slice(0, -footer.length) : code.replace(/\n$/, '');
  return `${body}\n${reference}\n${footer ? footer.slice(1) : ''}`;
}

const noticeText = (records) => 'WebMusic documentation site: third-party notices\n\n'
  + 'The following software and font data are distributed with this website.\n'
  + 'Each component retains its own copyright and license. This file includes\n'
  + 'notices for JavaScript, CSS, HTML, workers, and generated search assets.\n'
  + 'BUNDLED_ASSETS.json records the build module inventory and covered files.\n\n'
  + records.map((record) => record.text).join('\n\n' + '='.repeat(72) + '\n\n') + '\n';

/** One collector is shared by Vite's client and worker builds, but excludes SSR bundles. */
export function createSiteNoticeCollector({root = repository, appDirectory = path.join(root, 'apps/doc/webmusic'), includeGenerated = true} = {}) {
  const modules = new Set();
  const outputNames = new Set();
  const require = createRequire(path.join(appDirectory, 'package.json'));
  function plugin() {
    let server = false;
    const css = new Set();
    function isServerBuild(context) {
      const consumer = context.environment?.config.consumer;
      return consumer ? consumer === 'server' : server;
    }
    return {
      name: 'webmusic-site-license-inventory',
      apply: 'build',
      enforce: 'post',
      configResolved(config) { server = Boolean(config.build.ssr); },
      transform(_code, id) {
        // Astro extracts or inlines public CSS during its prerender build.
        if (/\.(?:css|scss|sass|less)(?:\?|$)/.test(id)) css.add(id);
      },
      renderChunk(_code, chunk) {
        // Astro may inline a script into HTML and remove it from generateBundle.
        // The rendered chunk still identifies every owner of that inline code.
        if (isServerBuild(this)) return;
        outputNames.add(chunk.fileName);
        for (const id of Object.keys(chunk.modules)) modules.add(id);
      },
      generateBundle(_options, bundle) {
        // Astro 7 sets top-level build.ssr=true for both environments. The
        // active environment, when available, owns the client/server decision.
        const isServer = isServerBuild(this);
        for (const output of Object.values(bundle)) {
          if (!isServer || output.type === 'asset') outputNames.add(output.fileName);
          if (!isServer && output.type === 'chunk') {
            for (const id of Object.keys(output.modules)) modules.add(id);
          }
        }
        // CSS can become a separate asset or inline HTML, and is absent from
        // JavaScript chunk.modules in both cases. Keep its ownership separately.
        for (const id of css) modules.add(id);
      },
    };
  }
  async function write(directory) {
    const records = new Map();
    const owners = new Map();
    const sources = new Set();
    async function addOwner(owner) {
      if (owner.manifest.name === 'pagefind') throw new Error('Unreviewed Pagefind runtime: use the local search integration.');
      if (owners.has(owner.directory)) return;
      owners.set(owner.directory, owner);
      for (const record of [await readSitePackageNotice(owner), ...await readSiteSupplement(owner)]) {
        if (records.has(record.key) && records.get(record.key).text !== record.text) {
          throw new Error(`Conflicting site notices for ${record.key}`);
        }
        records.set(record.key, record);
      }
    }
    for (const id of modules) {
      const filename = sourcePath(id);
      if (!filename) continue; // Vite virtual helpers belong to their generating runtime.
      const owner = await sitePackageOwner(filename);
      sources.add(owner.manifest.version
        ? `${owner.manifest.name}@${owner.manifest.version}/${slash(path.relative(owner.directory, filename))}`
        : slash(path.relative(root, filename)));
      if (owner.manifest.version && !owner.manifest.private) await addOwner(owner);
    }
    const files = await filesUnder(directory);
    if (files.some((filename) => slash(path.relative(directory, filename)).startsWith('pagefind/') || filename.endsWith('.pagefind'))) {
      throw new Error('Unreviewed Pagefind output: use the local search integration.');
    }
    if (!modules.size) throw new Error('No client module inventory was captured for site notices.');
    if (includeGenerated) {
      // These producers emit HTML and inline scripts outside chunk.modules.
      for (const producer of ['astro', '@astrojs/starlight/components']) await addOwner(await sitePackageOwner(require.resolve(producer)));
      if ([...outputNames].some((filename) => /(?:^|\/)ec\.[^/]+\.(?:js|css)$/.test(filename))) {
        // Expressive Code emits JavaScript/CSS assets from string templates,
        // outside chunk.modules. Follow the installed renderer's actual package
        // resolution chain to its template owners, including nested versions.
        const integration = require.resolve('astro-expressive-code');
        const rehype = createRequire(integration).resolve('rehype-expressive-code');
        const renderer = createRequire(rehype).resolve('expressive-code');
        for (const entry of [integration, rehype, renderer]) await addOwner(await sitePackageOwner(entry));
        const rendererRequire = createRequire(renderer);
        for (const name of ['@expressive-code/core', '@expressive-code/plugin-frames', '@expressive-code/plugin-text-markers', '@expressive-code/plugin-shiki']) {
          await addOwner(await sitePackageOwner(rendererRequire.resolve(name)));
        }
      }
    }
    const projectLicense = await readFile(path.join(root, 'LICENSE'), 'utf8');
    records.set('WebMusic website', {key: 'WebMusic website', license: 'MIT', text: `WebMusic website\n\n${projectLicense.trim()}`});
    const ordered = [...records.values()].sort((a, b) => a.key.localeCompare(b.key));
    const text = noticeText(ordered);
    const artifacts = [];
    for (const filename of files) {
      const relative = slash(path.relative(directory, filename));
      if (/\.(?:js|mjs|css)$/.test(relative)) {
        if (!relative.startsWith('pagefind/') && ![...outputNames].some((name) => path.posix.basename(name) === path.posix.basename(relative))) {
          throw new Error(`Site code was not captured by the license inventory: ${relative}`);
        }
        await writeFile(filename, attachSiteNotice(await readFile(filename, 'utf8'), relative));
        artifacts.push(relative);
      } else if (relative.endsWith('.html')) {
        const html = await readFile(filename, 'utf8');
        const link = `<link rel="license" href="${siteNoticeReference(relative)}">`;
        if (!html.includes(link)) {
          // Astro redirect documents use valid implicit <head> markup.
          const boundary = html.search(/<\/head\s*>|<body(?:\s|>)/i);
          const linked = boundary < 0 ? html.replace(/^(<!doctype[^>]*>)?/i, `$&${link}`)
            : html.slice(0, boundary) + link + html.slice(boundary);
          await writeFile(filename, linked);
        }
        artifacts.push(relative);
      } else if (relative.startsWith('pagefind/')) artifacts.push(relative);
    }
    await mkdir(path.join(directory, 'licenses'), {recursive: true});
    await writeFile(path.join(directory, noticePath), text);
    await writeFile(path.join(directory, inventoryPath), JSON.stringify({
      schemaVersion: 1,
      noticeFile: noticePath,
      noticeSha256: digest(text),
      packages: ordered.map(({key, license}) => ({key, license})),
      modules: [...sources].sort(),
      artifacts: artifacts.sort(),
    }, null, 2) + '\n');
    return verifySiteNotices(directory);
  }
  return {plugin, write};
}

export async function verifySiteNotices(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, inventoryPath), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.noticeFile !== noticePath
      || !manifest.modules?.length || !manifest.packages?.length || !manifest.artifacts?.length) {
    throw new Error('Invalid or empty site license inventory.');
  }
  const notices = await readFile(path.join(directory, noticePath), 'utf8');
  if (digest(notices) !== manifest.noticeSha256) throw new Error('Site third-party notices are missing or changed.');
  const actual = (await filesUnder(directory)).map((filename) => slash(path.relative(directory, filename)))
    .filter((filename) => /\.(?:js|mjs|css|html)$/.test(filename) || filename.startsWith('pagefind/')).sort();
  if (actual.some((filename) => filename.startsWith('pagefind/'))) throw new Error('Unreviewed Pagefind output: use the local search integration.');
  if (JSON.stringify(actual) !== JSON.stringify(manifest.artifacts)) throw new Error('Site license inventory does not cover the current output files.');
  for (const filename of actual) {
    if (/\.(?:js|mjs|css)$/.test(filename)) {
      const content = await readFile(path.join(directory, filename), 'utf8');
      if (!content.includes(`/*! ${marker} ${siteNoticeReference(filename)} */`)) {
        throw new Error(`Missing site license reference: ${filename}`);
      }
    } else if (filename.endsWith('.html')) {
      const content = await readFile(path.join(directory, filename), 'utf8');
      if (!content.includes(`<link rel="license" href="${siteNoticeReference(filename)}">`)) {
        throw new Error(`Missing site license link: ${filename}`);
      }
    }
  }
  return {packages: manifest.packages.length, artifacts: actual.length};
}

/** Run last: verify all emitted site code, after indexing and other producers finish. */
export default function siteNoticeIntegration(options) {
  const collector = createSiteNoticeCollector(options);
  return {
    name: 'webmusic-site-notices',
    hooks: {
      'astro:config:setup': ({updateConfig}) => updateConfig({vite: {
        plugins: [collector.plugin()],
        worker: {plugins: () => [collector.plugin()]},
      }}),
      'astro:build:done': async ({dir, logger}) => {
        const result = await collector.write(fileURLToPath(dir));
        logger.info(`Site licenses verified: ${result.packages} records, ${result.artifacts} files.`);
      },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [flag, directory, ...rest] = process.argv.slice(2);
  if (flag !== '--check' || rest.length) throw new Error('Usage: node scripts/site-notices.mjs --check [site-dist]');
  const result = await verifySiteNotices(path.resolve(directory ?? path.join(repository, 'apps/doc/webmusic/dist')));
  console.log(`Site licenses verified: ${result.packages} records, ${result.artifacts} files.`);
}
