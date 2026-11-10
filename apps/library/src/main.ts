// The WebMusic component library: every Web Component by function, a search
// over names, purposes and members, a live Arabesque canvas per element with
// its attributes in Parameters, and an app composer that nests the chosen
// elements into one working page to copy.
import './styles.css';
import {LIBRARY, byTag, inCategory, type LibraryEntry} from './catalog.ts';
import {composeApp, page, snippet, type Overrides} from './compose.ts';
import {liveComposition, mountComposition} from './elements.ts';
import {icon, type IconName} from './icons.ts';
import {CATEGORIES, type CategoryId} from './recipes.ts';
import {search, type Family} from './search.ts';
import type {ParamSpec} from '../../doc/webmusic/src/lib/params/index.ts';

const DOCS_ORIGIN: string = import.meta.env.VITE_WEBMUSIC_DOCS
  ?? (import.meta.env.DEV ? 'http://localhost:4321' : 'https://koperative-lab.github.io/WebMusic');
const STORAGE_KEY = 'webmusic-library:app';
const storage = (() => { try { return window.localStorage; } catch { return undefined; } })();

// ---------------------------------------------------------------- state

let query = '';
let family: Family = 'all';
let category: CategoryId | 'all' = 'all';
let selection: string[] = loadSelection();

function loadSelection(): string[] {
  try {
    const stored: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((tag): tag is string => typeof tag === 'string' && !!byTag(tag)) : [];
  } catch { return []; }
}

function saveSelection(next: readonly string[]): void {
  selection = LIBRARY.map((entry) => entry.tag).filter((tag) => next.includes(tag));
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(selection)); } catch { /* Selection stays for this visit. */ }
  renderBar();
}

const toggleSelected = (tag: string) => saveSelection(selection.includes(tag) ? selection.filter((other) => other !== tag) : [...selection, tag]);

// ---------------------------------------------------------------- DOM helpers

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string | undefined> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    if (name === 'class') node.className = value;
    else node.setAttribute(name, value);
  }
  node.append(...children.filter((child): child is Node | string => !!child));
  return node;
}

function iconButton(name: IconName, label: string, onClick: (button: HTMLButtonElement) => void, attributes: Record<string, string | undefined> = {}): HTMLButtonElement {
  const button = h('button', {type: 'button', class: 'lb-icon', 'aria-label': label, title: label, ...attributes}, icon(name));
  button.addEventListener('click', () => onClick(button));
  return button;
}

function action(label: string, onClick: () => unknown, primary = false): HTMLButtonElement {
  const button = h('button', {type: 'button', class: primary ? 'lb-action lb-action--primary' : 'lb-action'}, label);
  button.addEventListener('click', () => { void onClick(); });
  return button;
}

const tagName = (tag: string) => `<${tag}>`;
const docsUrl = (entry: LibraryEntry) => `${DOCS_ORIGIN.replace(/\/$/, '')}${entry.href}`;

const announcer = h('p', {class: 'lb-hidden', role: 'status'});
function announce(message: string): void {
  announcer.textContent = '';
  requestAnimationFrame(() => { announcer.textContent = message; });
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    announce(`${what} copied`);
  } catch {
    announce(`${what} could not be copied; select the code and copy it`);
  }
}

function panel(caption: string, body: Node, ...head: Child[]): HTMLElement {
  return h('section', {class: 'lb-panel'},
    h('header', {class: 'lb-panel__head'}, h('h2', {class: 'lb-caption'}, caption), h('span', {class: 'lb-spacer'}), ...head),
    body);
}

function codePanel(caption: string, code: () => string, label: string): {element: HTMLElement; update: () => void} {
  const pre = h('pre', {class: 'lb-code', tabindex: '0', 'aria-label': caption});
  const update = () => { pre.textContent = code(); };
  update();
  return {element: panel(caption, pre, iconButton('copy', `Copy ${label}`, () => { void copy(code(), label); })), update};
}

// ---------------------------------------------------------------- routing

type Route = {kind: 'catalog'} | {kind: 'element'; entry: LibraryEntry} | {kind: 'app'};

function currentRoute(): Route {
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (path.startsWith('c/')) {
    const entry = byTag(path.slice(2));
    if (entry) return {kind: 'element', entry};
  }
  if (path === 'app' || path.startsWith('app/')) return {kind: 'app'};
  return {kind: 'catalog'};
}

/** A shared link, `#/app/<tag>,<tag>`, replaces the selection once. */
function importSharedApp(): void {
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (!path.startsWith('app/')) return;
  const shared = path.slice(4).split(',').filter((tag) => byTag(tag));
  history.replaceState(null, '', '#/app');
  if (shared.length) saveSelection(shared);
}

const go = (hash: string) => { if (location.hash !== hash) location.hash = hash; else render(); };

// ---------------------------------------------------------------- chrome

const app = document.querySelector<HTMLElement>('#app')!;
const bar = h('header', {class: 'lb-bar'});
const nav = h('nav', {class: 'lb-nav', 'aria-label': 'Categories'});
const main = h('main', {class: 'lb-main', tabindex: '-1'});
const searchField = h('input', {type: 'search', class: 'lb-search__field', placeholder: 'Search components', 'aria-label': 'Search components', autocomplete: 'off', spellcheck: 'false'});

searchField.addEventListener('input', () => {
  query = searchField.value;
  if (currentRoute().kind !== 'catalog') go('#/');
  else { renderNav(); renderCatalog(); }
});
searchField.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && searchField.value) {
    event.preventDefault();
    searchField.value = query = '';
    renderNav();
    renderCatalog();
  }
});
document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    searchField.focus();
    searchField.select();
  }
});

function renderBar(): void {
  const route = currentRoute();
  const appLink = h('a', {href: '#/app', class: 'lb-icon lb-app-link', 'aria-label': `Your app, ${selection.length} components`, title: 'Your app', 'aria-current': route.kind === 'app' ? 'page' : undefined},
    icon('app'), h('span', {class: 'lb-value'}, String(selection.length)));
  bar.replaceChildren(
    h('a', {class: 'lb-brand', href: '#/'}, 'WebMusic library'),
    h('label', {class: 'lb-search'}, icon('search'), searchField),
    h('span', {class: 'lb-spacer'}),
    h('a', {class: 'lb-icon', href: DOCS_ORIGIN, 'aria-label': 'Documentation', title: 'Documentation'}, icon('docs')),
    appLink,
  );
}

function matches(): LibraryEntry[] {
  return search(LIBRARY, query, family);
}

function renderNav(): void {
  const hits = matches();
  const families = h('div', {class: 'lb-choice', role: 'group', 'aria-label': 'Family'},
    ...(['all', 'Score', 'Audio'] as const).map((id) => {
      const button = h('button', {type: 'button', 'aria-pressed': String(family === id)}, id === 'all' ? 'All' : id);
      button.addEventListener('click', () => { family = id; if (currentRoute().kind !== 'catalog') go('#/'); else { renderNav(); renderCatalog(); } });
      return button;
    }));
  const list = h('ul', {class: 'lb-categories'});
  const item = (id: CategoryId | 'all', label: string, count: number) => {
    const button = h('button', {type: 'button', class: 'lb-category', 'aria-pressed': String(category === id)},
      h('span', {}, label), h('span', {class: 'lb-value'}, String(count)));
    button.addEventListener('click', () => {
      category = category === id && id !== 'all' ? 'all' : id;
      if (currentRoute().kind !== 'catalog') go('#/');
      else { renderNav(); renderCatalog(); }
    });
    return h('li', {}, button);
  };
  list.append(item('all', 'All components', hits.length));
  for (const group of CATEGORIES) list.append(item(group.id, group.label, inCategory(group.id, hits).length));
  nav.replaceChildren(h('div', {class: 'lb-nav__section'}, families), list);
}

// ---------------------------------------------------------------- live canvas

let teardown: (() => void) | undefined;
let controller: AbortController | undefined;

function stopCanvas(): void {
  controller?.abort();
  controller = undefined;
  teardown?.();
  teardown = undefined;
}

/** A framed live canvas with one error line; returns the canvas for Parameters. */
function liveCanvas(caption: string, tags: () => readonly string[], overrides: () => Overrides): {element: HTMLElement; canvas: HTMLElement; ready: Promise<void>; reload: () => Promise<void>} {
  const canvas = h('div', {class: 'lb-canvas'});
  const error = h('p', {class: 'lb-error', role: 'alert', hidden: ''});
  const fail = (reason: unknown) => {
    if (!error.hidden) return;
    error.textContent = reason instanceof Error ? reason.message : String(reason ?? 'The component failed to load.');
    error.hidden = false;
  };
  const reload = async () => {
    stopCanvas();
    error.hidden = true;
    const signal = (controller = new AbortController()).signal;
    try {
      const cleanup = await mountComposition(canvas, liveComposition(tags(), overrides()), fail, signal);
      if (signal.aborted) cleanup();
      else teardown = cleanup;
    } catch (reason) {
      if (!signal.aborted) fail(reason);
    }
  };
  const element = panel(caption, h('div', {}, canvas, error), iconButton('reload', 'Reload canvas', () => { void reload(); }));
  return {element, canvas, ready: reload(), reload};
}

// ---------------------------------------------------------------- catalog

function card(entry: LibraryEntry): HTMLElement {
  const chosen = selection.includes(entry.tag);
  const add = iconButton(chosen ? 'check' : 'plus', chosen ? `Remove ${tagName(entry.tag)} from your app` : `Add ${tagName(entry.tag)} to your app`, () => {
    toggleSelected(entry.tag);
    renderCatalog();
    announce(selection.includes(entry.tag) ? `${tagName(entry.tag)} added to your app` : `${tagName(entry.tag)} removed from your app`);
  }, {'aria-pressed': String(chosen)});
  return h('li', {class: 'lb-card'},
    h('div', {class: 'lb-card__head'},
      h('a', {class: 'lb-tag', href: `#/c/${entry.tag}`}, tagName(entry.tag)),
      add),
    h('p', {class: 'lb-card__summary'}, entry.summary),
    h('p', {class: 'lb-caption'}, `${entry.family} · ${entry.capability}${entry.nonvisual ? ' · nonvisual' : ''}`));
}

function renderCatalog(): void {
  const hits = matches();
  const groups = CATEGORIES.filter((group) => category === 'all' || group.id === category)
    .map((group) => ({group, entries: inCategory(group.id, hits)}))
    .filter(({entries}) => entries.length > 0);
  const sections = groups.map(({group, entries}) => h('section', {class: 'lb-group', 'aria-labelledby': `lb-group-${group.id}`},
    h('h2', {class: 'lb-group__title', id: `lb-group-${group.id}`},
      h('span', {}, group.label), h('span', {class: 'lb-value'}, String(entries.length))),
    h('ul', {class: 'lb-cards'}, ...entries.map(card))));
  const total = groups.reduce((sum, {entries}) => sum + entries.length, 0);
  main.replaceChildren(
    h('div', {class: 'lb-head'},
      h('h1', {}, 'Components'),
      h('p', {class: 'lb-lede'}, 'Every WebMusic Web Component, grouped by what it does. Open one to try it on Arabesque No. 1, or add components to your app and copy the composed page.')),
    ...(sections.length ? sections : [h('p', {class: 'lb-empty'}, `No component matches “${query}”.`)]),
  );
  announce(`${total} component${total === 1 ? '' : 's'}`);
}

// ---------------------------------------------------------------- element page

/** Attributes Parameters leaves alone: sources, links and ids are the composition's. */
const FIXED_ATTRIBUTES = new Set(['src', 'format', 'input', 'port', 'target', 'session', 'id', 'sound-font']);

function effectiveValue(entry: LibraryEntry, overrides: Overrides, name: string): string | undefined {
  const override = overrides[entry.tag]?.[name];
  if (override === null) return undefined;
  return override ?? entry.recipe.attributes?.[name];
}

function parameterControl(entry: LibraryEntry, param: ParamSpec, overrides: Overrides, set: (name: string, value: string | null) => void): HTMLElement {
  const current = effectiveValue(entry, overrides, param.name);
  const id = `lb-param-${param.name}`;
  let control: HTMLElement;
  if (param.kind === 'bool') {
    const states = [{id: 'unset', label: 'Default', value: null}, {id: 'on', label: 'On', value: ''}, {id: 'off', label: 'Off', value: 'false'}] as const;
    const active = current === undefined ? 'unset' : current === 'false' ? 'off' : 'on';
    control = h('div', {class: 'lb-choice', role: 'group', 'aria-labelledby': `${id}-label`});
    const buttons = states.map((state) => {
      const button = h('button', {type: 'button', 'aria-pressed': String(state.id === active)}, state.label);
      button.addEventListener('click', () => {
        for (const other of buttons) other.setAttribute('aria-pressed', String(other === button));
        set(param.name, state.value);
      });
      return button;
    });
    control.append(...buttons);
  } else if (param.kind === 'enum') {
    const select = h('select', {class: 'lb-field', id},
      h('option', {value: ''}, `Default · ${(param.fallback ?? 'unset').split(' — ')[0]}`),
      ...(param.options ?? []).map((option) => h('option', {value: option}, option)));
    select.value = current ?? '';
    select.addEventListener('change', () => set(param.name, select.value || null));
    control = select;
  } else {
    const input = h('input', {
      class: 'lb-field', id, type: param.kind === 'number' ? 'number' : 'text',
      placeholder: param.placeholder ?? param.fallback?.split(' — ')[0] ?? '',
      min: param.min?.toString(), max: param.max?.toString(), step: param.step?.toString() ?? (param.kind === 'number' ? 'any' : undefined),
      spellcheck: 'false',
    });
    input.value = current ?? '';
    input.addEventListener('change', () => set(param.name, input.value.trim() === '' ? null : input.value.trim()));
    control = input;
  }
  return h('div', {class: 'lb-param', title: param.note},
    param.kind === 'bool'
      ? h('span', {class: 'lb-caption', id: `${id}-label`}, param.name)
      : h('label', {class: 'lb-caption', for: id}, param.name),
    control);
}

/** Show a row only while its controlling attribute has one of the listed values. */
function visible(entry: LibraryEntry, param: ParamSpec, overrides: Overrides): boolean {
  if (!param.when) return true;
  const value = effectiveValue(entry, overrides, param.when.attribute);
  return param.when.values.includes(value || param.when.fallback);
}

function memberTable(caption: string, rows: readonly {name: string; detail: string}[]): HTMLElement | null {
  if (!rows.length) return null;
  return panel(caption, h('dl', {class: 'lb-members'}, ...rows.flatMap((row) => [h('dt', {}, row.name), h('dd', {}, row.detail)])));
}

function renderElement(entry: LibraryEntry): void {
  let overrides: Overrides = {};
  const composed = () => composeApp([entry.tag], {mediaBase: '/', overrides});
  const code = codePanel('Code', () => snippet(composed()), 'code');
  const live = liveCanvas('Live', () => [entry.tag], () => overrides);

  const parameters = h('div', {class: 'lb-parameters'});
  const renderParameters = () => {
    const params = entry.spec.params.filter((param) => !FIXED_ATTRIBUTES.has(param.name) && visible(entry, param, overrides));
    parameters.replaceChildren(...params.map((param) => parameterControl(entry, param, overrides, (name, value) => {
      overrides = {...overrides, [entry.tag]: {...overrides[entry.tag], [name]: value}};
      const target = live.canvas.querySelector(entry.tag);
      if (value === null) target?.removeAttribute(name);
      else target?.setAttribute(name, value);
      code.update();
      if (entry.spec.params.some((other) => other.when?.attribute === name)) renderParameters();
    })));
    if (!params.length) parameters.append(h('p', {class: 'lb-caption'}, 'No markup parameters'));
  };
  renderParameters();

  const chosen = selection.includes(entry.tag);
  const added = composed().added;
  main.replaceChildren(
    h('div', {class: 'lb-head'},
      h('a', {class: 'lb-back', href: '#/'}, icon('back'), h('span', {}, 'Components')),
      h('h1', {class: 'lb-tag-title'}, tagName(entry.tag)),
      h('p', {class: 'lb-caption'}, `${entry.category.label} · ${entry.family} · ${entry.capability}${entry.nonvisual ? ' · nonvisual' : ''}`),
      h('p', {class: 'lb-lede'}, entry.summary),
      h('div', {class: 'lb-actions'},
        action(chosen ? 'Remove from app' : 'Add to app', () => { toggleSelected(entry.tag); renderElement(entry); }, !chosen),
        h('a', {class: 'lb-action', href: docsUrl(entry)}, 'Reference'),
        h('code', {class: 'lb-value lb-entry'}, entry.entry)),
    ),
    h('div', {class: 'lb-layout'},
      h('div', {class: 'lb-stage'},
        live.element,
        code.element,
        added.length ? h('p', {class: 'lb-caption'}, `Composed with ${added.map(tagName).join(', ')}`) : null),
      h('div', {class: 'lb-side'},
        panel('Parameters', parameters),
        memberTable('Properties and methods', (entry.spec.properties ?? []).map((member) => ({name: member.name, detail: member.note}))),
        memberTable('Events', (entry.spec.events ?? []).map((member) => ({name: member.name, detail: member.note}))),
        panel('Composition', h('dl', {class: 'lb-members'},
          h('dt', {}, 'Behaviour'), h('dd', {}, entry.headless),
          h('dt', {}, 'Presenters'), h('dd', {}, entry.ui))))),
  );
}

// ---------------------------------------------------------------- app composer

function renderApp(): void {
  const composed = () => composeApp(selection, {mediaBase: '/'});
  const {tags, added} = composed();
  if (!tags.length) {
    main.replaceChildren(
      h('div', {class: 'lb-head'}, h('h1', {}, 'Your app'),
        h('p', {class: 'lb-lede'}, 'Add components from the library with the plus button. They are nested into one working page: views, analysis and inserts follow the player that owns their transport.')),
      h('div', {class: 'lb-actions'}, h('a', {class: 'lb-action lb-action--primary', href: '#/'}, 'Browse components')));
    return;
  }
  const code = codePanel('Page', () => page(composed()), 'page');
  const live = liveCanvas('Live', () => selection, () => ({}));
  const list = h('ul', {class: 'lb-chosen'}, ...tags.map((tag) => {
    const auto = added.includes(tag);
    return h('li', {class: 'lb-chosen__item'},
      h('a', {class: 'lb-tag', href: `#/c/${tag}`}, tagName(tag)),
      h('span', {class: 'lb-caption'}, auto ? 'added' : byTag(tag)!.category.label),
      auto ? h('span', {class: 'lb-icon-space'}) : iconButton('close', `Remove ${tagName(tag)}`, () => { toggleSelected(tag); renderApp(); }));
  }));
  const share = () => copy(`${location.origin}${location.pathname}#/app/${selection.join(',')}`, 'Link');
  main.replaceChildren(
    h('div', {class: 'lb-head'},
      h('h1', {}, 'Your app'),
      h('p', {class: 'lb-caption'}, `${tags.length} component${tags.length === 1 ? '' : 's'}`),
      h('div', {class: 'lb-actions'},
        action('Copy page', () => copy(page(composed()), 'Page'), true),
        action('Copy link', share),
        action('Clear', () => { saveSelection([]); renderApp(); }),
        h('a', {class: 'lb-action', href: '#/'}, 'Add more'))),
    h('div', {class: 'lb-layout'},
      h('div', {class: 'lb-stage'}, live.element, code.element),
      h('div', {class: 'lb-side'}, panel('Components', list))),
  );
}

// ---------------------------------------------------------------- render

function render(): void {
  stopCanvas();
  importSharedApp();
  const route = currentRoute();
  renderBar();
  renderNav();
  if (route.kind === 'element') renderElement(route.entry);
  else if (route.kind === 'app') renderApp();
  else renderCatalog();
  document.title = route.kind === 'element' ? `${tagName(route.entry.tag)} · WebMusic library`
    : route.kind === 'app' ? 'Your app · WebMusic library' : 'WebMusic library';
  if (route.kind !== 'catalog') { window.scrollTo(0, 0); main.focus({preventScroll: true}); }
}

app.replaceChildren(bar, h('div', {class: 'lb-body'}, nav, main), announcer);
window.addEventListener('hashchange', render);
render();
