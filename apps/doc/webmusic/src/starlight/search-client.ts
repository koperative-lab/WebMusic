export interface SearchDocument {
  url: string;
  title: string;
  text: string;
}

export interface SearchResult extends SearchDocument {
  excerpt: string;
  score: number;
}

const normalize = (value: string) => value.normalize('NFKC').toLowerCase();

/** Match every query term, then rank title matches above article-only matches. */
export function searchDocuments(entries: SearchDocument[], query: string): SearchResult[] {
  const phrase = normalize(query).trim();
  const terms = [...new Set(phrase.match(/[\p{L}\p{N}_#]+/gu) ?? [])];
  if (!terms.length) return [];
  return entries.flatMap((entry) => {
    const title = normalize(entry.title);
    const body = normalize(entry.text);
    const combined = `${title} ${body}`;
    if (!terms.every((term) => combined.includes(term))) return [];
    const score = (title === phrase ? 100 : title.startsWith(phrase) ? 60 : title.includes(phrase) ? 40 : 0)
      + terms.filter((term) => title.includes(term)).length * 15;
    const positions = terms.map((term) => body.indexOf(term)).filter((index) => index >= 0);
    const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 60);
    const end = Math.min(entry.text.length, start + 200);
    const excerpt = `${start ? '…' : ''}${entry.text.slice(start, end)}${end < entry.text.length ? '…' : ''}`;
    return [{...entry, score, excerpt}];
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.url.localeCompare(b.url));
}

/** Validate local links before assigning href; fetched text is rendered as text. */
export function readSearchIndex(value: unknown, indexUrl: URL): SearchDocument[] {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
    || !('entries' in value) || !Array.isArray(value.entries)) throw new Error('Invalid search index.');
  const base = indexUrl.pathname.slice(0, indexUrl.pathname.lastIndexOf('/') + 1);
  return value.entries.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object'
      || !('url' in entry) || typeof entry.url !== 'string'
      || !('title' in entry) || typeof entry.title !== 'string'
      || !('text' in entry) || typeof entry.text !== 'string') throw new Error('Invalid search entry.');
    const url = new URL(entry.url, indexUrl);
    if (!entry.url.startsWith('/') || url.origin !== indexUrl.origin || !url.pathname.startsWith(base)
      || url.search || url.hash) throw new Error('Search entries must stay inside this documentation site.');
    return {url: url.pathname, title: entry.title, text: entry.text};
  });
}

export function mountDocumentationSearch(root: HTMLElement): () => void {
  const dialog = root.querySelector<HTMLDialogElement>('dialog')!;
  const openButton = root.querySelector<HTMLButtonElement>('[data-search-open]')!;
  const closeButton = root.querySelector<HTMLButtonElement>('[data-search-close]')!;
  const retryButton = root.querySelector<HTMLButtonElement>('[data-search-retry]')!;
  const input = root.querySelector<HTMLInputElement>('input[type="search"]')!;
  const status = root.querySelector<HTMLElement>('[role="status"]')!;
  const results = root.querySelector<HTMLOListElement>('[data-search-results]')!;
  const lifetime = new AbortController();
  const {signal} = lifetime;
  const document = root.ownerDocument;
  const window = document.defaultView!;
  let entries: SearchDocument[] | undefined;
  let loading = false;
  let returnFocus: HTMLElement | undefined;
  const indexUrl = new URL(root.dataset.indexUrl ?? 'search-index.json', window.location.href);
  const links = () => [...results.querySelectorAll<HTMLAnchorElement>('a')];
  const render = () => {
    if (!entries) return;
    const matches = searchDocuments(entries, input.value);
    results.replaceChildren();
    status.textContent = !input.value.trim() ? 'Enter a title, API, or topic.'
      : matches.length ? `${matches.length} result${matches.length === 1 ? '' : 's'}${matches.length > 20 ? '; showing the first 20' : ''}.`
        : 'No matching documentation. Try another word.';
    for (const match of matches.slice(0, 20)) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const title = document.createElement('strong');
      const excerpt = document.createElement('p');
      const route = document.createElement('small');
      link.href = match.url;
      title.textContent = match.title;
      excerpt.textContent = match.excerpt;
      route.textContent = match.url;
      link.append(title, excerpt, route);
      item.append(link);
      results.append(item);
    }
  };
  const load = async () => {
    if (entries) { render(); return; }
    if (loading || signal.aborted) return;
    if (root.dataset.dev === 'true') {
      status.textContent = 'Search is available in the built documentation. Run the documentation build and preview to search.';
      return;
    }
    loading = true;
    retryButton.hidden = true;
    status.textContent = 'Loading documentation search…';
    input.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(indexUrl, {signal, credentials: 'same-origin'});
      if (!response.ok) throw new Error('Search index could not be loaded.');
      const value: unknown = await response.json();
      if (signal.aborted) return;
      entries = readSearchIndex(value, indexUrl);
      render();
    } catch {
      if (signal.aborted) return;
      status.textContent = 'Search could not load. Check your connection and try again.';
      retryButton.hidden = false;
    } finally {
      loading = false;
      input.removeAttribute('aria-busy');
    }
  };
  const open = () => {
    if (dialog.open) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : openButton;
    dialog.showModal();
    document.body.setAttribute('data-webmusic-search-open', '');
    input.focus();
    void load();
  };
  openButton.disabled = false;
  openButton.addEventListener('click', open, {signal});
  closeButton.addEventListener('click', () => dialog.close(), {signal});
  retryButton.addEventListener('click', () => { void load(); }, {signal});
  dialog.addEventListener('close', () => {
    document.body.removeAttribute('data-webmusic-search-open');
    if (returnFocus?.isConnected) returnFocus.focus();
  }, {signal});
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || (event.target instanceof Element && event.target.closest('a'))) dialog.close();
  }, {signal});
  input.addEventListener('input', render, {signal});
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'ArrowDown' && links().length) { event.preventDefault(); links()[0]?.focus(); }
    if (event.key === 'Enter' && links().length) { event.preventDefault(); links()[0]?.click(); }
  }, {signal});
  results.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const key = event.key;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) return;
    const items = links();
    const index = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (index < 0) return;
    event.preventDefault();
    if (key === 'ArrowUp' && index === 0) input.focus();
    else items[key === 'Home' ? 0 : key === 'End' ? items.length - 1 : Math.min(items.length - 1, index + (key === 'ArrowDown' ? 1 : -1))]?.focus();
  }, {signal});
  window.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && dialog.open) {
      // Search inputs otherwise consume the first Escape to clear their text.
      event.preventDefault();
      dialog.close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k' && !event.repeat) {
      event.preventDefault();
      if (dialog.open) dialog.close();
      else open();
    }
  }, {signal});
  return () => {
    lifetime.abort();
    if (dialog.open) dialog.close();
    document.body.removeAttribute('data-webmusic-search-open');
  };
}
