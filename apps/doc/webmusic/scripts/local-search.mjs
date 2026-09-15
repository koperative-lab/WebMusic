import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const compact = (text) => text.replace(/\s+/g, ' ').trim();

/** Index only rendered public article content, never MDX source or navigation. */
export function searchDocument(html, relative, base = '/') {
  if (/(?:^|\/)404(?:\/index)?\.html$/.test(relative)) return undefined;
  const dom = new JSDOM(html);
  try {
    const document = dom.window.document;
    if ([...document.querySelectorAll('meta[name="robots"]')].some((meta) => /\bnoindex\b/i.test(meta.content))
      || document.querySelector('meta[http-equiv="refresh" i]')) return undefined;
    const title = compact(document.querySelector('main h1')?.textContent ?? '');
    const article = document.querySelector('main .sl-markdown-content');
    if (!title || !article) return undefined;
    article.querySelectorAll('script,style,template,noscript,button,input,select,textarea,[hidden],[aria-hidden="true"],[data-search-ignore],[data-pagefind-ignore]').forEach((element) => element.remove());
    article.querySelectorAll('p,div,section,article,h1,h2,h3,h4,h5,h6,li,pre,tr,td,th,br').forEach((element) => element.append(' '));
    const text = compact(article.textContent ?? '');
    const route = relative.split(path.sep).join('/').replace(/(?:^|\/)index\.html$/, (match) => match.startsWith('/') ? '/' : '');
    const prefix = `/${base.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\//, '/');
    return {url: prefix + route.split('/').map(encodeURIComponent).join('/'), title, text};
  } finally {
    dom.window.close();
  }
}

export async function writeSearchIndex(directory, base = '/') {
  const entries = [];
  const walk = async (current) => {
    for (const entry of await readdir(current, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) throw new Error(`Search input must not be a symbolic link: ${entry.name}`);
      const filename = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile() && entry.name.endsWith('.html')) {
        const record = searchDocument(await readFile(filename, 'utf8'), path.relative(directory, filename), base);
        if (record) entries.push(record);
      }
    }
  };
  await walk(directory);
  if (!entries.length) throw new Error('No public documentation articles were found for local search.');
  entries.sort((a, b) => a.url.localeCompare(b.url));
  await writeFile(path.join(directory, 'search-index.json'), `${JSON.stringify({version: 1, entries})}\n`);
  return entries;
}

export function localSearch() {
  let base = '/';
  return {
    name: 'webmusic-local-search',
    hooks: {
      'astro:config:done': ({config}) => { base = config.base; },
      'astro:build:done': async ({dir, logger}) => {
        const entries = await writeSearchIndex(fileURLToPath(dir), base);
        logger.info(`Local search indexed ${entries.length} public documentation pages.`);
      },
    },
  };
}
