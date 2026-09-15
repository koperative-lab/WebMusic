// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountDocumentationSearch, readSearchIndex, searchDocuments, type SearchDocument} from '../src/starlight/search-client';

const entries: SearchDocument[] = [
  {url: '/WebMusic/score/', title: 'Score', text: 'ScorePlayer controls playback and the transport.'},
  {url: '/WebMusic/player/', title: 'ScorePlayer', text: 'Set the tempo and seek to a new playback position.'},
  {url: '/WebMusic/midi/', title: 'MIDI input', text: 'Choose a MIDI device. C# major. 音乐播放。'},
];
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function mount() {
  document.body.innerHTML = `<button id="previous">Previous focus</button><div id="search" data-index-url="/WebMusic/search-index.json">
    <button data-search-open disabled>Search</button><dialog><button data-search-close>Close</button>
    <input type="search"><p role="status"></p><button data-search-retry hidden>Retry</button><ol data-search-results></ol></dialog></div>`;
  const root = document.querySelector<HTMLElement>('#search')!;
  const dialog = root.querySelector('dialog')!;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new Event('close')); };
  const detach = mountDocumentationSearch(root);
  cleanups.push(detach);
  const input = root.querySelector('input')!;
  const open = () => root.querySelector<HTMLButtonElement>('[data-search-open]')!.click();
  const query = (value: string) => { input.value = value; input.dispatchEvent(new Event('input')); };
  return {root, dialog, input, open, query, detach};
}

describe('documentation search matching', () => {
  it('ranks matching titles before body mentions and requires every term', () => {
    expect(searchDocuments(entries, 'scoreplayer').map((entry) => entry.title)).toEqual(['ScorePlayer', 'Score']);
    expect(searchDocuments(entries, 'playback tempo').map((entry) => entry.title)).toEqual(['ScorePlayer']);
    expect(searchDocuments(entries, 'ScorePlayer nonexistent')).toEqual([]);
    expect(searchDocuments(entries, '  ')).toEqual([]);
    expect(searchDocuments(entries, '<>')).toEqual([]);
  });

  it('handles case, Unicode, musical accidentals, and excerpts around body matches', () => {
    expect(searchDocuments(entries, 'ＭＩＤＩ')[0]?.title).toBe('MIDI input');
    expect(searchDocuments(entries, '音乐')[0]?.title).toBe('MIDI input');
    expect(searchDocuments(entries, 'C# major')[0]?.title).toBe('MIDI input');
    const text = `${'Introduction '.repeat(30)}uniquematch ${'following '.repeat(40)}`;
    const result = searchDocuments([{url: '/long/', title: 'Long', text}], 'uniquematch')[0]!;
    expect(result.excerpt).toContain('uniquematch');
    expect(result.excerpt.startsWith('…')).toBe(true);
    expect(result.excerpt.length).toBeLessThanOrEqual(202);
  });

  it('allows only versioned same-origin links inside the deployed base', () => {
    const url = new URL('https://example.test/WebMusic/search-index.json');
    expect(readSearchIndex({version: 1, entries}, url)).toEqual(entries);
    for (const invalid of ['javascript:alert(1)', 'https://evil.test/WebMusic/', '/score/', '/WebMusic/../elsewhere/']) {
      expect(() => readSearchIndex({version: 1, entries: [{...entries[0], url: invalid}]}, url)).toThrow();
    }
    expect(() => readSearchIndex({version: 2, entries}, url)).toThrow();
    expect(() => readSearchIndex({version: 1, entries: [{url: '/WebMusic/'}]}, url)).toThrow();
  });
});

describe('documentation search dialog', () => {
  it('loads lazily once, applies the current query after loading, and renders safe local links', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    const {root, open, query} = mount();
    expect(fetch).not.toHaveBeenCalled();
    open();
    query('scoreplayer');
    resolve(new Response(JSON.stringify({version: 1, entries})));
    await vi.waitFor(() => expect(root.querySelectorAll('a')).toHaveLength(2));
    expect(new URL(String(fetch.mock.calls[0]?.[0])).pathname).toBe('/WebMusic/search-index.json');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/WebMusic/player/');
    expect(root.querySelector('[role="status"]')?.textContent).toBe('2 results.');
    root.querySelector<HTMLButtonElement>('[data-search-close]')!.click();
    open();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('restores focus, supports shortcuts and arrow navigation, and unbinds on disposal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({version: 1, entries}))));
    const {root, dialog, input, query, detach} = mount();
    const previous = document.querySelector<HTMLButtonElement>('#previous')!;
    previous.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', ctrlKey: true}));
    expect(dialog.open).toBe(true);
    expect(document.activeElement).toBe(input);
    query('playback');
    await vi.waitFor(() => expect(root.querySelectorAll('a')).toHaveLength(2));
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
    expect(document.activeElement).toBe(root.querySelector('a'));
    root.querySelector('a')!.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowUp', bubbles: true}));
    expect(document.activeElement).toBe(input);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'K', metaKey: true}));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(previous);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', ctrlKey: true}));
    query('playback');
    const composingEscape = new KeyboardEvent('keydown', {key: 'Escape', isComposing: true, bubbles: true, cancelable: true});
    input.dispatchEvent(composingEscape);
    expect(dialog.open).toBe(true);
    expect(composingEscape.defaultPrevented).toBe(false);
    const escape = new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true});
    input.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(previous);
    expect(input.value).toBe('playback');
    detach();
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', ctrlKey: true}));
    expect(dialog.open).toBe(false);
    expect(document.body.hasAttribute('data-webmusic-search-open')).toBe(false);
  });

  it('reports failed loads and lets the reader retry', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(new Response(JSON.stringify({version: 1, entries})));
    vi.stubGlobal('fetch', fetch);
    const {root, open, query} = mount();
    open();
    await vi.waitFor(() => expect(root.querySelector<HTMLButtonElement>('[data-search-retry]')!.hidden).toBe(false));
    query('midi');
    root.querySelector<HTMLButtonElement>('[data-search-retry]')!.click();
    await vi.waitFor(() => expect(root.querySelector('a')?.textContent).toContain('MIDI input'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('renders index markup as text and cancels its request lifetime on disposal', async () => {
    const malicious = {...entries[0], title: '<img src=x onerror=alert(1)>', text: 'literal <script>payload</script>'};
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({version: 1, entries: [malicious]})));
    vi.stubGlobal('fetch', fetch);
    const {root, open, query, detach} = mount();
    open();
    query('payload');
    await vi.waitFor(() => expect(root.querySelector('a')).not.toBeNull());
    expect(root.querySelectorAll('img,script')).toHaveLength(0);
    expect(root.querySelector('strong')?.textContent).toBe(malicious.title);
    const request = fetch.mock.calls[0]?.[1] as RequestInit;
    detach();
    expect(request.signal?.aborted).toBe(true);
  });

  it('does not navigate while Enter is committing an IME candidate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({version: 1, entries}))));
    const {root, input, open, query} = mount();
    open();
    query('midi');
    await vi.waitFor(() => expect(root.querySelector('a')).not.toBeNull());
    const click = vi.spyOn(root.querySelector('a')!, 'click').mockImplementation(() => {});
    const composition = new KeyboardEvent('keydown', {key: 'Enter', isComposing: true, bubbles: true, cancelable: true});
    input.dispatchEvent(composition);
    expect(click).not.toHaveBeenCalled();
    expect(composition.defaultPrevented).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('ignores a late response after the search component is removed', async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetch);
    const {root, open, query, detach} = mount();
    open();
    query('midi');
    detach();
    resolve(new Response(JSON.stringify({version: 1, entries})));
    await new Promise((done) => setTimeout(done, 0));
    expect(root.querySelector('a')).toBeNull();
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
