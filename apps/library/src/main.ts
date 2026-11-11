// The WebMusic component library: every Web Component as a card on a vertical
// reel. Cards are as large as their element's picture and are packed in
// topological order, so each player is followed by what attaches to it. A card
// shows the element's name, its category tag and how the element looks — a
// still picture, not a demo. Its page plays it with Parameters and code.
import './styles.css';
import {LIBRARY, byTag, type LibraryEntry} from './catalog.ts';
import {composeApp, snippet, type Overrides} from './compose.ts';
import {liveComposition, mountComposition} from './elements.ts';
import {icon, type IconName} from './icons.ts';
import {packSkyline, packedHeight, stretchFills, topologicalOrder, type Box, type Size} from './layout.ts';
import {anyPicture, cancelPending, loadPictures, pictureFor, pictureUrl, prioritize, requestPicture} from './pictures.ts';
import type {PictureJob} from './render.ts';
import {CATEGORIES, type CategoryId} from './recipes.ts';
import {search, type Family} from './search.ts';
import type {ParamSpec} from '../../doc/webmusic/src/lib/params/index.ts';

const DOCS_ORIGIN: string = import.meta.env.VITE_WEBMUSIC_DOCS
  ?? (import.meta.env.DEV ? 'http://localhost:4321' : 'https://koperative-lab.github.io/WebMusic');

// ---------------------------------------------------------------- state

let query = '';
let family: Family = 'all';
let category: CategoryId | undefined;

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

type Route = {kind: 'catalog'} | {kind: 'element'; entry: LibraryEntry};

function currentRoute(): Route {
  const path = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (path.startsWith('c/')) {
    const entry = byTag(path.slice(2));
    if (entry) return {kind: 'element', entry};
  }
  return {kind: 'catalog'};
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
function mountLive(stage: HTMLElement, tags: readonly string[], overrides: Overrides, onError: (reason: unknown) => void): () => void {
  const controller = new AbortController();
  let teardown: (() => void) | undefined;
  mountComposition(stage, liveComposition(tags, overrides), onError, controller.signal)
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
  readonly image: HTMLImageElement;
  /** The picture the card's current width asks for. */
  job?: PictureJob;
}

const GAP = 16;
const PAD = 16;
/** Width a card needs for its name and tag. */
const headWidth = (tag: string) => Math.ceil(tag.length * 7.5 + 112);
let cards: Card[] = [];
let reelObserver: IntersectionObserver | undefined;
let resizeObserver: ResizeObserver | undefined;
let scheduled = 0;
let relayout: () => void = () => {};

const isFill = (card: Card) => card.entry.recipe.preview.fit === 'fill';

/** The element's size: from its picture once drawn, else the recipe's estimate. */
function sizeOf(card: Card, frameWidth?: number): Size {
  const picture = isFill(card) && frameWidth ? pictureFor({tag: card.entry.tag, width: frameWidth}) ?? anyPicture(card.entry.tag) : anyPicture(card.entry.tag);
  if (picture && isFill(card) && frameWidth) return {width: frameWidth, height: Math.round(picture.height * Math.min(1, frameWidth / picture.width)) || picture.height};
  return picture ?? card.entry.recipe.preview;
}

let chrome = 0;
/** Header and borders around the frame, measured from a card on screen. */
function chromeHeight(card: Card): number {
  if (!chrome) chrome = (card.element.querySelector<HTMLElement>('.lb-card__head')?.offsetHeight ?? 31) + 2;
  return chrome;
}

/** Show the best picture there is for the card's width, and ask for the exact one. */
function paint(card: Card, frameWidth: number, priority: number): void {
  const job: PictureJob = isFill(card) ? {tag: card.entry.tag, width: Math.round(frameWidth)} : {tag: card.entry.tag};
  card.job = job;
  const exact = pictureFor(job);
  const shown = exact ?? anyPicture(card.entry.tag);
  if (shown) {
    const url = pictureUrl(shown);
    if (card.image.getAttribute('src') !== url) card.image.src = url;
    card.image.hidden = false;
  } else {
    card.image.hidden = true;
  }
  card.element.classList.toggle('lb-card--drawing', !exact);
  if (exact) return;
  requestPicture(job, priority).then((picture) => {
    if (card.job !== job) return;
    card.element.classList.remove('lb-card--drawing', 'lb-card--failed');
    card.image.src = pictureUrl(picture);
    card.image.hidden = false;
    // Its real size may differ from the estimate the layout used.
    cancelAnimationFrame(scheduled);
    scheduled = requestAnimationFrame(() => relayout());
  }, (error: unknown) => {
    if (card.job !== job || (error instanceof DOMException && error.name === 'AbortError')) return;
    card.element.classList.remove('lb-card--drawing');
    card.element.classList.add('lb-card--failed');
    card.element.dataset.pictureError = error instanceof Error ? error.message : String(error);
  });
}

function cardFor(entry: LibraryEntry): Card {
  // A still picture of the element: no element is mounted on this page.
  const image = h('img', {class: 'lb-card__picture', alt: '', decoding: 'async', draggable: 'false', hidden: ''});
  const frame = h('div', {class: 'lb-card__frame'}, image);
  const tag = h('button', {type: 'button', class: 'lb-chip', 'aria-pressed': String(category === entry.category.id), title: entry.category.label}, entry.category.short);
  tag.addEventListener('click', () => { category = category === entry.category.id ? undefined : entry.category.id; refilter(); });
  const element = h('article', {class: 'lb-card', 'data-tag': entry.tag, title: entry.summary});
  element.append(
    h('header', {class: 'lb-card__head'},
      h('a', {class: 'lb-card__name', href: `#/c/${entry.tag}`}, entry.tag),
      tag,
    ),
    frame);
  return {entry, element, frame, image};
}

function layoutReel(reel: HTMLElement): void {
  const width = Math.max(1, reel.clientWidth - PAD * 2);
  let top = PAD;
  const viewportBottom = window.scrollY + window.innerHeight;
  // Each family is a segment of its own, so packing never pulls a card across.
  for (const family of ['Score', 'Audio'] as const) {
    const segment = cards.filter((card) => card.entry.family === family);
    if (!segment.length) continue;
    const boxes: Box[] = segment.map((card) => {
      const fill = isFill(card);
      const own = sizeOf(card);
      const cardWidth = Math.min(width, Math.max(headWidth(card.entry.tag), fill ? card.entry.recipe.preview.width : own.width + 2));
      // A stretching card takes half again its least width when the row has room for more beside it.
      return {width: cardWidth, height: chromeHeight(card) + (fill ? own.height : sizeOf(card).height), fill, preferred: fill ? Math.min(width, cardWidth * 1.5) : undefined};
    });
    const placed = stretchFills(packSkyline(boxes, width, GAP), boxes, width, GAP);
    segment.forEach((card, index) => {
      const spot = placed[index]!;
      const frameWidth = Math.max(1, spot.width - 2);
      Object.assign(card.element.style, {left: `${PAD + spot.x}px`, top: `${top + spot.y}px`, width: `${spot.width}px`});
      const size = sizeOf(card, frameWidth);
      // A stretching element fills the card; one with its own width sits centred in it.
      const scale = Math.min(1, frameWidth / Math.max(1, size.width));
      card.frame.style.height = `${Math.round(size.height * (isFill(card) ? 1 : scale))}px`;
      Object.assign(card.image.style, isFill(card)
        ? {width: '100%', height: '100%', left: '0px'}
        : {width: `${size.width * scale}px`, height: `${size.height * scale}px`, left: `${Math.max(0, (frameWidth - size.width * scale) / 2)}px`});
      // On screen first. Within that, elements with their own width before
      // stretching ones: their sizes settle the layout, so a stretching card is
      // drawn once, at its final width.
      const y = top + spot.y;
      paint(card, frameWidth, (y < viewportBottom + 200 ? 0 : 1_000_000) + (isFill(card) ? 100_000 : 0) + y);
    });
    top += packedHeight(placed) + GAP * 2;
  }
  reel.style.height = `${top - GAP * 2 + PAD}px`;
  // Pictures for widths no card has any more are not drawn.
  const wanted = new Set(cards.map((card) => JSON.stringify(card.job)));
  cancelPending((job) => wanted.has(JSON.stringify(job)));
}

function renderReel(): void {
  reelObserver?.disconnect();
  resizeObserver?.disconnect();
  const entries = topologicalOrder(search(LIBRARY, query, family).filter((entry) => !category || entry.category.id === category));
  cards = entries.map(cardFor);
  if (!cards.length) {
    main.replaceChildren(h('p', {class: 'lb-empty'}, '—'));
    return;
  }
  const reel = h('div', {class: 'lb-reel', role: 'list', 'aria-label': `${cards.length} components`}, ...cards.map((card) => card.element));
  for (const card of cards) card.element.setAttribute('role', 'listitem');
  main.replaceChildren(reel);
  main.classList.add('lb-main--reel');
  relayout = () => layoutReel(reel);
  void picturesLoaded.then(() => { if (relayout === layoutRef) layoutReel(reel); });
  const layoutRef = relayout;
  layoutReel(reel);
  let lastWidth = reel.clientWidth;
  resizeObserver = new ResizeObserver(() => {
    if (reel.clientWidth === lastWidth) return;
    lastWidth = reel.clientWidth;
    layoutReel(reel);
  });
  resizeObserver.observe(reel);
  // A card scrolled into view moves to the front of the drawing queue.
  const byElement = new Map(cards.map((card) => [card.element as Element, card]));
  reelObserver = new IntersectionObserver((records) => {
    for (const record of records) {
      const card = byElement.get(record.target);
      if (card?.job && record.isIntersecting) prioritize(card.job, -1);
    }
  }, {rootMargin: '400px 0px'});
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

  main.replaceChildren(
    pageHead(entry.tag,
      h('span', {class: 'lb-chip', title: entry.category.label}, entry.category.short),
      h('span', {class: 'lb-spacer'}),
      h('a', {class: 'lb-icon', href: docsUrl(entry), 'aria-label': 'Reference', title: 'Reference'}, icon('docs'))),
    h('div', {class: 'lb-layout'},
      h('div', {class: 'lb-stage'}, canvas.element, code.element),
      h('div', {class: 'lb-side'}, parameters.childElementCount ? panel('Parameters', parameters) : null)),
  );
}

// ---------------------------------------------------------------- render

function render(): void {
  stopAll();
  reelObserver?.disconnect();
  resizeObserver?.disconnect();
  const route = currentRoute();
  renderBar();
  main.classList.remove('lb-main--reel');
  if (route.kind === 'element') renderElement(route.entry);
  else renderReel();
  document.title = route.kind === 'element' ? `${tagName(route.entry.tag)} · WebMusic library` : 'WebMusic library';
  if (route.kind !== 'catalog') { window.scrollTo(0, 0); main.focus({preventScroll: true}); }
}

/** This build's pictures, read from the browser before the first full layout. */
const picturesLoaded = loadPictures();

app.replaceChildren(bar, main, announcer);
window.addEventListener('hashchange', render);
render();
