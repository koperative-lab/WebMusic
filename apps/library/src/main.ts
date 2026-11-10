// The WebMusic component library: every Web Component as a card on a vertical
// reel. Cards have the footprint their element draws in and are packed in
// topological order, so each player is followed by what attaches to it. A card
// shows the element's name, its category tag and how the element looks — a
// still picture, not a demo. Its page plays it with Parameters and code, and
// chosen elements compose into one working page to copy.
import './styles.css';
import {LIBRARY, byTag, type LibraryEntry} from './catalog.ts';
import {composeApp, page, snippet, type Overrides} from './compose.ts';
import {liveComposition, mountComposition} from './elements.ts';
import {icon, type IconName} from './icons.ts';
import {packColumns, parentOf, reelRows, topologicalOrder} from './layout.ts';
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
let category: CategoryId | undefined;
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
  button.addEventListener('click', (event) => { event.stopPropagation(); onClick(button); });
  return button;
}

function setIcon(button: HTMLButtonElement, name: IconName, label: string): void {
  button.replaceChildren(icon(name));
  button.setAttribute('aria-label', label);
  button.title = label;
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
/** Filters live on the reel: change them there, or go back to it. */
const refilter = () => { if (currentRoute().kind === 'catalog') { renderBar(); renderReel(); } else go('#/'); };

// ---------------------------------------------------------------- top bar

const app = document.querySelector<HTMLElement>('#app')!;
const bar = h('header', {class: 'lb-bar'});
const main = h('main', {class: 'lb-main', tabindex: '-1'});
const searchField = h('input', {type: 'search', class: 'lb-search__field', placeholder: 'Search', 'aria-label': 'Search components', autocomplete: 'off', spellcheck: 'false'});

searchField.addEventListener('input', () => { query = searchField.value; refilter(); });
searchField.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && searchField.value) {
    event.preventDefault();
    searchField.value = query = '';
    refilter();
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
  const families = h('div', {class: 'lb-segment', role: 'group', 'aria-label': 'Family'},
    ...(['all', 'Score', 'Audio'] as const).map((id) => {
      const button = h('button', {type: 'button', 'aria-pressed': String(family === id)}, id === 'all' ? 'All' : id);
      button.addEventListener('click', () => { family = id; refilter(); });
      return button;
    }));
  const filter = category && h('button', {type: 'button', class: 'lb-chip lb-chip--active', 'aria-label': `Clear ${CATEGORIES.find((c) => c.id === category)!.short} filter`},
    CATEGORIES.find((c) => c.id === category)!.short, icon('close'));
  filter?.addEventListener('click', () => { category = undefined; refilter(); });
  bar.replaceChildren(
    h('a', {class: 'lb-brand', href: '#/', 'aria-label': 'WebMusic library'}, 'WebMusic'),
    families,
    h('label', {class: 'lb-search'}, icon('search'), searchField),
    ...(filter ? [filter] : []),
    h('span', {class: 'lb-spacer'}),
    h('a', {class: 'lb-icon', href: DOCS_ORIGIN, 'aria-label': 'Documentation', title: 'Documentation'}, icon('docs')),
    h('a', {href: '#/app', class: 'lb-icon lb-app-link', 'aria-label': `Your app, ${selection.length} components`, title: 'Your app', 'aria-current': route.kind === 'app' ? 'page' : undefined},
      icon('app'), selection.length ? h('span', {class: 'lb-value'}, String(selection.length)) : null),
  );
}

// ---------------------------------------------------------------- live previews

/** Something mounted on screen that must be stopped before it goes away. */
const live = new Set<() => void>();

function stopAll(): void {
  for (const stop of [...live]) stop();
  live.clear();
}

/**
 * Mount a composition into `stage` and keep `onError` informed. Returns the
 * cleanup, which aborts a mount still loading.
 */
function mountLive(stage: HTMLElement, tags: readonly string[], overrides: Overrides, onError: (reason: unknown) => void, card?: number): () => void {
  const controller = new AbortController();
  let teardown: (() => void) | undefined;
  // Cards share the document, so each card's ids get a prefix of their own.
  const composition = card !== undefined
    ? composeApp(tags, {mediaBase: import.meta.env.BASE_URL, overrides, bareHosts: true, idPrefix: `c${card}-`})
    : liveComposition(tags, overrides);
  mountComposition(stage, composition, onError, controller.signal)
    .then((cleanup) => { if (controller.signal.aborted) cleanup(); else teardown = cleanup; })
    .catch((reason: unknown) => { if (!controller.signal.aborted) onError(reason); });
  const stop = () => {
    controller.abort();
    teardown?.();
    teardown = undefined;
    live.delete(stop);
  };
  live.add(stop);
  return stop;
}

// ---------------------------------------------------------------- reel

interface Card {
  readonly entry: LibraryEntry;
  readonly element: HTMLElement;
  readonly frame: HTMLElement;
  readonly stage: HTMLElement;
  stop?: () => void;
}

const GAP = 16;
const PAD = 16;
/** Column width the reel aims for, and the fixed height of one row. */
const TARGET_COLUMN = 168;
const ROW = 150;
let cards: Card[] = [];
let reelObserver: IntersectionObserver | undefined;
let resizeObserver: ResizeObserver | undefined;

/** Scale the element down to fit its card, keeping its own width large enough to lay out. */
function fit(card: Card): void {
  const {frame, stage} = card;
  const width = frame.clientWidth;
  const height = frame.clientHeight;
  if (!width || !height) return;
  const design = Math.max(width, 480);
  stage.style.width = `${design}px`;
  const content = Math.max(1, stage.scrollHeight);
  const scale = Math.min(width / design, height / content, 1);
  stage.style.transform = `scale(${scale})`;
  stage.style.left = `${Math.max(0, (width - design * scale) / 2)}px`;
  stage.style.top = `${Math.max(0, (height - content * scale) / 2)}px`;
}

/** A card shows how its element looks: mounted, then made inert. */
function mountCard(card: Card): void {
  if (card.stop) return;
  card.element.classList.remove('lb-card--failed');
  const stop = mountLive(card.stage, [card.entry.tag], {}, () => card.element.classList.add('lb-card--failed'), cards.indexOf(card));
  const sizer = new ResizeObserver(() => fit(card));
  sizer.observe(card.stage);
  card.stop = () => { sizer.disconnect(); stop(); card.stop = undefined; };
}

function cardFor(entry: LibraryEntry): Card {
  // The preview is a picture of the element: no focus, pointer or keyboard reaches it.
  const frame = h('div', {class: 'lb-card__frame', inert: ''});
  const stage = h('div', {class: 'lb-card__stage'});
  frame.append(stage);
  const tag = h('button', {type: 'button', class: 'lb-chip', 'aria-pressed': String(category === entry.category.id), title: entry.category.label}, entry.category.short);
  tag.addEventListener('click', () => { category = category === entry.category.id ? undefined : entry.category.id; refilter(); });
  const element = h('article', {class: 'lb-card', 'data-tag': entry.tag, title: entry.summary});
  const card: Card = {entry, element, frame, stage};
  element.append(
    h('header', {class: 'lb-card__head'},
      h('a', {class: 'lb-card__name', href: `#/c/${entry.tag}`}, entry.tag),
      tag,
      selection.includes(entry.tag) ? h('span', {class: 'lb-card__chosen', 'aria-label': 'In your app', title: 'In your app'}, icon('check')) : null),
    frame);
  element.addEventListener('pointerenter', () => highlight(entry.tag));
  element.addEventListener('pointerleave', () => highlight(undefined));
  element.addEventListener('focusin', () => highlight(entry.tag));
  element.addEventListener('focusout', () => highlight(undefined));
  return card;
}

const links = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
links.classList.add('lb-links');
links.setAttribute('aria-hidden', 'true');

/** The cards an element attaches to, and those attached to it. */
function related(tag: string): Set<string> {
  const near = new Set<string>([tag]);
  const parent = parentOf(byTag(tag)!.recipe);
  if (parent) near.add(parent);
  for (const card of cards) if (parentOf(card.entry.recipe) === tag) near.add(card.entry.tag);
  return near;
}

/** Hairlines from a card to the cards it attaches to and that attach to it. */
function highlight(tag: string | undefined): void {
  links.replaceChildren();
  const reel = links.parentElement;
  reel?.classList.toggle('lb-reel--focus', !!tag);
  if (!tag) { for (const card of cards) card.element.classList.remove('lb-card--near'); return; }
  const near = related(tag);
  for (const card of cards) card.element.classList.toggle('lb-card--near', near.has(card.entry.tag));
  const center = (card: Card) => ({x: card.element.offsetLeft + card.element.offsetWidth / 2, y: card.element.offsetTop + card.element.offsetHeight / 2});
  const from = cards.find((card) => card.entry.tag === tag);
  if (!from) return;
  for (const card of cards) {
    if (card === from || !near.has(card.entry.tag)) continue;
    const a = center(from);
    const b = center(card);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    // An elbow through the gap row between the two cards.
    const midY = (a.y + b.y) / 2;
    line.setAttribute('d', `M${a.x} ${a.y}V${midY}H${b.x}V${b.y}`);
    links.append(line);
  }
}

function layoutReel(reel: HTMLElement): void {
  const width = reel.clientWidth;
  const columns = Math.max(1, Math.floor((width - PAD * 2 + GAP) / (TARGET_COLUMN + GAP)));
  const column = (width - PAD * 2 - GAP * (columns - 1)) / columns;
  // Each family is a segment of its own, so packing never pulls a card across.
  let rows = 0;
  for (const family of ['Score', 'Audio'] as const) {
    const segment = cards.filter((card) => card.entry.family === family);
    if (!segment.length) continue;
    const placements = packColumns(segment.map((card) => card.entry.recipe.size), columns);
    segment.forEach((card, index) => {
      const placement = placements[index]!;
      Object.assign(card.element.style, {
        left: `${PAD + placement.x * (column + GAP)}px`,
        top: `${PAD + (rows + placement.y) * (ROW + GAP)}px`,
        width: `${placement.w * column + (placement.w - 1) * GAP}px`,
        height: `${placement.h * ROW + (placement.h - 1) * GAP}px`,
      });
    });
    rows += reelRows(placements);
  }
  const height = PAD * 2 + rows * ROW + Math.max(0, rows - 1) * GAP;
  reel.style.height = `${height}px`;
  links.setAttribute('viewBox', `0 0 ${width} ${height}`);
  links.setAttribute('width', String(width));
  links.setAttribute('height', String(height));
  for (const card of cards) fit(card);
}

function renderReel(): void {
  stopAll();
  reelObserver?.disconnect();
  resizeObserver?.disconnect();
  const entries = topologicalOrder(search(LIBRARY, query, family).filter((entry) => !category || entry.category.id === category));
  cards = entries.map(cardFor);
  links.replaceChildren();
  if (!cards.length) {
    main.replaceChildren(h('p', {class: 'lb-empty'}, '—'));
    return;
  }
  const reel = h('div', {class: 'lb-reel', role: 'list', 'aria-label': `${cards.length} components`}, links, ...cards.map((card) => card.element));
  for (const card of cards) card.element.setAttribute('role', 'listitem');
  main.replaceChildren(reel);
  main.classList.add('lb-main--reel');
  layoutReel(reel);
  let lastWidth = reel.clientWidth;
  resizeObserver = new ResizeObserver(() => {
    if (reel.clientWidth === lastWidth) return;
    lastWidth = reel.clientWidth;
    layoutReel(reel);
  });
  resizeObserver.observe(reel);
  // Mount what is on screen or close to it; release what scrolls far away.
  const byElement = new Map(cards.map((card) => [card.element as Element, card]));
  reelObserver = new IntersectionObserver((records) => {
    for (const record of records) {
      const card = byElement.get(record.target);
      if (!card) continue;
      if (record.isIntersecting) mountCard(card);
      else card.stop?.();
    }
  }, {rootMargin: '600px 0px'});
  for (const card of cards) reelObserver.observe(card.element);
  announce(`${cards.length} component${cards.length === 1 ? '' : 's'}`);
}

// ---------------------------------------------------------------- live canvas (element and app pages)

/** A framed live canvas with one error line. */
function liveCanvas(caption: string, tags: () => readonly string[], overrides: () => Overrides): {element: HTMLElement; canvas: HTMLElement} {
  const canvas = h('div', {class: 'lb-canvas'});
  const error = h('p', {class: 'lb-error', role: 'alert', hidden: ''});
  let stop: (() => void) | undefined;
  const fail = (reason: unknown) => {
    if (!error.hidden) return;
    error.textContent = reason instanceof Error ? reason.message : String(reason ?? 'The component failed to load.');
    error.hidden = false;
  };
  const reload = () => {
    stop?.();
    error.hidden = true;
    stop = mountLive(canvas, tags(), overrides(), fail);
  };
  reload();
  const element = panel(caption, h('div', {}, canvas, error), iconButton('reload', 'Reload canvas', reload));
  return {element, canvas};
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

function pageHead(title: string, ...rest: Child[]): HTMLElement {
  return h('div', {class: 'lb-head'},
    h('a', {class: 'lb-icon lb-back', href: '#/', 'aria-label': 'All components', title: 'All components'}, icon('back')),
    h('h1', {class: 'lb-title'}, title),
    ...rest);
}

function renderElement(entry: LibraryEntry): void {
  let overrides: Overrides = {};
  const composed = () => composeApp([entry.tag], {mediaBase: '/', overrides});
  const code = codePanel('Code', () => snippet(composed()), 'code');
  const canvas = liveCanvas('Live', () => [entry.tag], () => overrides);

  const parameters = h('div', {class: 'lb-parameters'});
  const renderParameters = () => {
    const params = entry.spec.params.filter((param) => !FIXED_ATTRIBUTES.has(param.name) && visible(entry, param, overrides));
    parameters.replaceChildren(...params.map((param) => parameterControl(entry, param, overrides, (name, value) => {
      overrides = {...overrides, [entry.tag]: {...overrides[entry.tag], [name]: value}};
      const target = canvas.canvas.querySelector(entry.tag);
      if (value === null) target?.removeAttribute(name);
      else target?.setAttribute(name, value);
      code.update();
      if (entry.spec.params.some((other) => other.when?.attribute === name)) renderParameters();
    })));
  };
  renderParameters();

  const chosen = selection.includes(entry.tag);
  const add = iconButton(chosen ? 'check' : 'plus', chosen ? 'Remove from your app' : 'Add to your app', (button) => {
    toggleSelected(entry.tag);
    const now = selection.includes(entry.tag);
    setIcon(button, now ? 'check' : 'plus', now ? 'Remove from your app' : 'Add to your app');
    button.setAttribute('aria-pressed', String(now));
  }, {'aria-pressed': String(chosen)});
  main.replaceChildren(
    pageHead(entry.tag,
      h('span', {class: 'lb-chip', title: entry.category.label}, entry.category.short),
      h('span', {class: 'lb-spacer'}),
      h('a', {class: 'lb-icon', href: docsUrl(entry), 'aria-label': 'Reference', title: 'Reference'}, icon('docs')),
      add),
    h('div', {class: 'lb-layout'},
      h('div', {class: 'lb-stage'}, canvas.element, code.element),
      h('div', {class: 'lb-side'}, parameters.childElementCount ? panel('Parameters', parameters) : null)),
  );
}

// ---------------------------------------------------------------- app composer

function renderApp(): void {
  const composed = () => composeApp(selection, {mediaBase: '/'});
  const {tags, added} = composed();
  if (!tags.length) {
    main.replaceChildren(pageHead('Your app'), h('a', {class: 'lb-empty-app', href: '#/', 'aria-label': 'Add components'}, icon('plus')));
    return;
  }
  const code = codePanel('Page', () => page(composed()), 'page');
  const canvas = liveCanvas('Live', () => selection, () => ({}));
  const list = h('ul', {class: 'lb-chosen'}, ...tags.map((tag) => {
    const auto = added.includes(tag);
    return h('li', {class: 'lb-chosen__item'},
      h('a', {class: 'lb-card__name', href: `#/c/${tag}`}, tag),
      h('span', {class: 'lb-chip'}, auto ? 'Added' : byTag(tag)!.category.short),
      auto ? h('span', {class: 'lb-icon-space'}) : iconButton('close', `Remove ${tagName(tag)}`, () => { toggleSelected(tag); renderApp(); }));
  }));
  const share = () => copy(`${location.origin}${location.pathname}#/app/${selection.join(',')}`, 'Link');
  main.replaceChildren(
    pageHead('Your app',
      h('span', {class: 'lb-spacer'}),
      iconButton('link', 'Copy link', () => { void share(); }),
      iconButton('trash', 'Clear', () => { saveSelection([]); renderApp(); }),
      action('Copy page', () => copy(page(composed()), 'Page'), true)),
    h('div', {class: 'lb-layout'},
      h('div', {class: 'lb-stage'}, canvas.element, code.element),
      h('div', {class: 'lb-side'}, panel('Components', list))),
  );
}

// ---------------------------------------------------------------- render

function render(): void {
  stopAll();
  reelObserver?.disconnect();
  resizeObserver?.disconnect();
  importSharedApp();
  const route = currentRoute();
  renderBar();
  main.classList.remove('lb-main--reel');
  if (route.kind === 'element') renderElement(route.entry);
  else if (route.kind === 'app') renderApp();
  else renderReel();
  document.title = route.kind === 'element' ? `${tagName(route.entry.tag)} · WebMusic library`
    : route.kind === 'app' ? 'Your app · WebMusic library' : 'WebMusic library';
  if (route.kind !== 'catalog') { window.scrollTo(0, 0); main.focus({preventScroll: true}); }
}

app.replaceChildren(bar, main, announcer);
window.addEventListener('hashchange', render);
render();
