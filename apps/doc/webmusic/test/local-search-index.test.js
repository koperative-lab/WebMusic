import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {searchDocument, writeSearchIndex} from '../scripts/local-search.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {recursive: true, force: true})));
});
const article = '<main><h1>Score &amp; MIDI</h1><div class="sl-markdown-content"><h2>Playback</h2><p>Use <code>ScorePlayer</code> to play.</p><p>Next paragraph.</p></div></main>';

describe('public documentation search index', () => {
  it('extracts rendered article text without controls, navigation, or executable content', () => {
    const html = `<nav>Unrelated navigation</nav>${article.replace('</div>', '<button>Hidden control</button><script>window.bad = true;</script><p hidden>Private text</p><p data-search-ignore>Ignored text</p></div>')}`;
    expect(searchDocument(html, 'score/index.html')).toEqual({
      url: '/score/', title: 'Score & MIDI', text: 'Playback Use ScorePlayer to play. Next paragraph.',
    });
  });

  it('creates root, project-base, and encoded article routes', () => {
    expect(searchDocument(article, 'index.html', '/WebMusic/')?.url).toBe('/WebMusic/');
    expect(searchDocument(article, 'score/index.html', '/WebMusic')?.url).toBe('/WebMusic/score/');
    expect(searchDocument(article, '音乐/index.html', '/')?.url).toBe('/%E9%9F%B3%E4%B9%90/');
    expect(searchDocument(article, 'flat.html', '/')?.url).toBe('/flat.html');
  });

  it('omits aliases marked noindex, redirects, 404s, and non-article pages', () => {
    expect(searchDocument(`<meta name="robots" content="noindex, follow">${article}`, 'introduction/index.html')).toBeUndefined();
    expect(searchDocument(`<meta http-equiv="refresh" content="0;url=/score/">${article}`, 'old/index.html')).toBeUndefined();
    expect(searchDocument(article, '404.html')).toBeUndefined();
    expect(searchDocument(article, '404/index.html')).toBeUndefined();
    expect(searchDocument('<main><h1>Not an article</h1></main>', 'other.html')).toBeUndefined();
  });

  it('writes a deterministic, versioned index for the actual public article files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'webmusic-search-'));
    directories.push(directory);
    await mkdir(path.join(directory, 'score'));
    await writeFile(path.join(directory, 'index.html'), article);
    await writeFile(path.join(directory, 'score/index.html'), article);
    await writeFile(path.join(directory, '404.html'), article);
    await writeFile(path.join(directory, 'not-an-article.html'), '<p>Other</p>');
    const entries = await writeSearchIndex(directory, '/WebMusic/');
    expect(entries.map((entry) => entry.url)).toEqual(['/WebMusic/', '/WebMusic/score/']);
    const first = await readFile(path.join(directory, 'search-index.json'), 'utf8');
    expect(JSON.parse(first)).toEqual({version: 1, entries});
    await writeSearchIndex(directory, '/WebMusic/');
    expect(await readFile(path.join(directory, 'search-index.json'), 'utf8')).toBe(first);
  });
});
