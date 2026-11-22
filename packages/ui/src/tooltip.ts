import {installStyle} from './internal/style';
import {neutralColor} from './internal/palette';

// ============================================================================
// Tooltips (DEC-083): the name of an icon button the pointer rests on, in a
// small ink box beside the pointer, shown at once. Elements that show text
// get no box. One per document, delegated, so it reaches the icon buttons of
// every component on the page, including those inside open shadow roots,
// without each component drawing its own. In help mode a described element
// also shows its `aria-description` — the same text assistive technology
// reads; what carries one is the page's choice.
// ============================================================================

export interface TooltipOptions {
  /** Start with help mode on: hovered elements also show their `aria-description`. Defaults to off. */
  help?: boolean;
}

export interface TooltipHandle {
  /** Whether help mode is on. Help mode is one per document, shared by every handle. */
  readonly help: boolean;
  /** Turn help mode on or off. */
  setHelp(on: boolean): void;
  /** Release this handle; the last release removes the box, its listeners and its stylesheet. */
  dispose(): void;
}

/** What a tooltip shows for one element. */
export interface TooltipContent {
  /** The element's name: the `title` or control `aria-label` of an element that shows no text. */
  name: string;
  /** In help mode, its `aria-description`; otherwise empty. */
  description: string;
}

const INK = `var(--wm-foreground, ${neutralColor('foreground')})`;
const ON_INK = 'var(--wm-accent-foreground, light-dark(#fff, #111))';
const MONO = 'var(--wm-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)';
const SANS = 'var(--wm-font-family, system-ui, -apple-system, "Segoe UI", sans-serif)';

/** The box beside the pointer. Zero specificity, so a page's own rules win. */
export const tooltipStyle = String.raw`
:where([data-wm-tooltip]) {
  position: fixed; inset: auto; top: 0; left: 0; z-index: 2147483647; box-sizing: border-box;
  max-width: min(var(--wm-tooltip-max-width, 20rem), calc(100vw - 1rem)); margin: 0; padding: .25rem .625rem .3125rem;
  overflow: visible; border: 0; border-radius: var(--wm-tooltip-radius, var(--wm-control-radius, 0)); box-shadow: none;
  background: var(--wm-tooltip-background, ${INK}); color: var(--wm-tooltip-foreground, ${ON_INK});
  font: 400 .75rem/1.4 var(--wm-tooltip-font, ${MONO}); white-space: nowrap; pointer-events: none;
}
:where([data-wm-tooltip][data-help]) { white-space: normal; width: max-content; }
:where([data-wm-tooltip] [data-part="description"]) { display: block; margin-top: .25rem; font: 400 .8125rem/1.45 ${SANS}; }
:where([data-wm-tooltip] [data-part="description"]:first-child) { margin-top: 0; }
`;

/** Roles and tags an `aria-label` names when they show no text. */
const CONTROL_ROLES = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'switch', 'radio', 'checkbox', 'option', 'slider', 'spinbutton']);
const CONTROL_TAGS = new Set(['BUTTON', 'A', 'SUMMARY']);
const HTML = 'http://www.w3.org/1999/xhtml';
/** Distance from the pointer to the box, as on a pointer's own label. */
const OFFSET = {x: 12, y: 18};
const EDGE = 8;

const squash = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

function isHtml(node: unknown): node is HTMLElement {
  return typeof node === 'object' && node !== null && (node as Node).nodeType === 1 && (node as Element).namespaceURI === HTML;
}

function isControl(element: HTMLElement): boolean {
  return CONTROL_TAGS.has(element.tagName) || CONTROL_ROLES.has(element.getAttribute('role') ?? '');
}

/** The text an element shows, without the parts it hides from everyone. */
function shownText(element: HTMLElement): string {
  const text = (element as {innerText?: string}).innerText;
  return squash(typeof text === 'string' ? text : element.textContent);
}

/** Text that names something: a letter or digit, not an icon glyph such as × or ▶. */
const WORDS = /[\p{L}\p{N}]/u;

/**
 * What a tooltip would show for `element`, or undefined when it has nothing
 * to add. Only an element that shows no words of its own — an icon button —
 * is named: its `title`, or the `aria-label` of a control. Anything that
 * shows text (a card, a tab, a chip, a component) already says what it is.
 * In help mode an element with an `aria-description` is described, with its
 * name above, whether or not it shows text.
 */
export function tooltipContent(element: HTMLElement, help = false, title = element.getAttribute('title')): TooltipContent | undefined {
  const label = squash(element.getAttribute('aria-label'));
  const description = help ? squash(element.getAttribute('aria-description')) : '';
  const shown = shownText(element);
  let name = '';
  if (!WORDS.test(shown)) name = squash(title) || (isControl(element) ? label : '');
  if (!name && !description) return undefined;
  // Help names what it describes, even where the element shows that name itself.
  if (!name) name = label || shown || squash(title);
  return {name, description};
}

interface Shown {
  element: HTMLElement;
  /** The element's own title while the box stands in for the platform's. */
  title?: string;
  /** An `aria-label` lent while the title is lifted, so the element keeps its name. */
  lentLabel?: boolean;
  byPointer: boolean;
  observer?: MutationObserver;
}

class Tooltips {
  readonly box: HTMLElement;
  private readonly nameNode: HTMLElement;
  private readonly descriptionNode: HTMLElement;
  private readonly style: HTMLStyleElement;
  private readonly lifetime = new AbortController();
  private shown?: Shown;
  /** Pressed: no box for it until the pointer leaves it. */
  private quiet?: HTMLElement;
  private pointer = {x: 0, y: 0};
  help = false;
  handles = 0;

  constructor(private readonly document: Document) {
    this.style = installStyle(document, 'tooltip', tooltipStyle);
    (document.head ?? document.documentElement).append(this.style);
    const box = this.box = document.createElement('div');
    box.dataset.wmTooltip = '';
    box.setAttribute('aria-hidden', 'true');
    if ('popover' in box) box.setAttribute('popover', 'manual');
    box.hidden = true;
    this.nameNode = document.createElement('span');
    this.nameNode.dataset.part = 'name';
    this.descriptionNode = document.createElement('span');
    this.descriptionNode.dataset.part = 'description';
    box.append(this.nameNode, this.descriptionNode);
    (document.body ?? document.documentElement).append(box);

    const {signal} = this.lifetime;
    const listen = (target: EventTarget, type: string, listener: (event: Event) => void, passive = true) =>
      target.addEventListener(type, listener, {capture: true, passive, signal});
    listen(document, 'pointerover', (event) => this.over(event as PointerEvent));
    listen(document, 'pointermove', (event) => this.move(event as PointerEvent));
    listen(document, 'pointerout', (event) => { if (!(event as PointerEvent).relatedTarget) this.leave(); });
    listen(document, 'pointerdown', () => { if (this.shown) { this.quiet = this.shown.element; this.hide(); } });
    listen(document, 'focusin', (event) => this.focus(event));
    listen(document, 'focusout', () => { if (this.shown && !this.shown.byPointer) this.hide(); });
    listen(document, 'keydown', (event) => { if ((event as KeyboardEvent).key === 'Escape') this.hide(); });
    listen(document, 'scroll', () => { if (this.shown?.byPointer) this.hide(); });
    const view = document.defaultView;
    if (view) listen(view, 'blur', () => this.hide());
  }

  private resolve(path: readonly EventTarget[]): {element: HTMLElement; content: TooltipContent} | undefined {
    for (const node of path) {
      if (!isHtml(node) || node === this.box) continue;
      // The element already shown keeps its lifted title as its own.
      const title = this.shown?.element === node ? this.shown.title ?? node.getAttribute('title') : node.getAttribute('title');
      const content = tooltipContent(node, this.help, title);
      if (content) return {element: node, content};
    }
    return undefined;
  }

  private over(event: PointerEvent): void {
    if (event.pointerType === 'touch') { this.hide(); return; }
    this.pointer = {x: event.clientX, y: event.clientY};
    const found = this.resolve(event.composedPath());
    if (this.quiet && found?.element !== this.quiet) this.quiet = undefined;
    if (!found || found.element === this.quiet) { if (this.shown?.byPointer) this.hide(); return; }
    if (this.shown?.element !== found.element) this.show(found.element, found.content, true);
    else this.place();
  }

  private move(event: PointerEvent): void {
    if (!this.shown?.byPointer) return;
    if (!this.shown.element.isConnected) { this.hide(); return; }
    this.pointer = {x: event.clientX, y: event.clientY};
    this.place();
  }

  private leave(): void {
    this.quiet = undefined;
    if (this.shown?.byPointer) this.hide();
  }

  private focus(event: Event): void {
    const path = event.composedPath();
    const target = path.find(isHtml);
    let visible: boolean;
    try { visible = !!target?.matches(':focus-visible'); } catch { visible = false; }
    if (!visible) return;
    const found = this.resolve(path);
    if (found && found.element === target) this.show(found.element, found.content, false);
    else if (this.shown && !this.shown.byPointer) this.hide();
  }

  private show(element: HTMLElement, content: TooltipContent, byPointer: boolean): void {
    this.hide();
    const shown: Shown = {element, byPointer};
    // The platform's own tooltip would follow a second later; the title waits beside the box.
    if (byPointer && element.hasAttribute('title')) {
      shown.title = element.getAttribute('title') ?? '';
      if (!element.hasAttribute('aria-label') && !shownText(element)) {
        element.setAttribute('aria-label', shown.title);
        shown.lentLabel = true;
      }
      element.removeAttribute('title');
    }
    const View = this.document.defaultView?.MutationObserver;
    if (View) {
      shown.observer = new View(() => this.refresh());
      shown.observer.observe(element, {attributes: true, attributeFilter: ['title', 'aria-label', 'aria-description']});
    }
    this.shown = shown;
    this.render(content);
    this.box.hidden = false;
    this.raise();
    this.place();
  }

  /** The element changed its name while shown: carry a new title, and redraw. */
  private refresh(): void {
    const shown = this.shown;
    if (!shown) return;
    const {element} = shown;
    if (shown.title !== undefined && element.hasAttribute('title')) {
      shown.title = element.getAttribute('title') ?? '';
      element.removeAttribute('title');
    }
    const content = tooltipContent(element, this.help, shown.title ?? element.getAttribute('title'));
    if (!content) { this.hide(); return; }
    this.render(content);
    this.place();
  }

  private render(content: TooltipContent): void {
    this.nameNode.textContent = content.name;
    this.descriptionNode.textContent = content.description;
    this.descriptionNode.hidden = !content.description;
    if (content.description) this.box.dataset.help = '';
    else delete this.box.dataset.help;
  }

  /** Above everything, modal dialogs included, when the browser has a top layer. */
  private raise(): void {
    const box = this.box as HTMLElement & {showPopover?: () => void; hidePopover?: () => void};
    if (typeof box.showPopover !== 'function' || !box.hasAttribute('popover')) return;
    try {
      if (box.matches(':popover-open')) box.hidePopover?.();
      box.showPopover();
    } catch { /* A detached document has no top layer; the fixed box still shows. */ }
  }

  private place(): void {
    const shown = this.shown;
    if (!shown) return;
    const view = this.document.defaultView;
    const width = view?.innerWidth ?? 0;
    const height = view?.innerHeight ?? 0;
    const box = this.box.getBoundingClientRect();
    let x: number;
    let y: number;
    if (shown.byPointer) {
      x = this.pointer.x + OFFSET.x;
      y = this.pointer.y + OFFSET.y;
      if (y + box.height > height - EDGE) y = this.pointer.y - box.height - EDGE;
    } else {
      const anchor = shown.element.getBoundingClientRect();
      x = anchor.left;
      y = anchor.bottom + 4;
      if (y + box.height > height - EDGE) y = anchor.top - box.height - 4;
    }
    if (width) x = Math.min(x, width - box.width - EDGE);
    this.box.style.transform = `translate(${Math.round(Math.max(EDGE, x))}px, ${Math.round(Math.max(EDGE, y))}px)`;
  }

  hide(): void {
    const shown = this.shown;
    if (!shown) return;
    this.shown = undefined;
    shown.observer?.disconnect();
    const {element} = shown;
    if (shown.title !== undefined && !element.hasAttribute('title')) element.setAttribute('title', shown.title);
    if (shown.lentLabel && element.getAttribute('aria-label') === shown.title) element.removeAttribute('aria-label');
    const box = this.box as HTMLElement & {hidePopover?: () => void};
    try { if (box.hasAttribute('popover') && box.matches(':popover-open')) box.hidePopover?.(); } catch { /* not open */ }
    box.hidden = true;
  }

  setHelp(on: boolean): void {
    this.help = on;
    const root = this.document.documentElement;
    if (on) root.dataset.wmHelp = '';
    else delete root.dataset.wmHelp;
    this.refresh();
  }

  destroy(): void {
    this.hide();
    this.lifetime.abort();
    this.box.remove();
    this.style.remove();
    delete this.document.documentElement.dataset.wmHelp;
  }
}

const mounted = new WeakMap<Document, Tooltips>();

/**
 * Show the name of the element under the pointer in an ink box beside it, at
 * once, in place of the platform's delayed title tooltip. Only an element
 * that shows no text is named — every icon button: its `title`, or the
 * `aria-label` of a control (a button, link, tab, slider…). Keyboard focus
 * shows the same box under the focused control.
 *
 * In help mode the box also shows the element's `aria-description`, so a
 * described element explains itself on hover, as an instrument's info view
 * does. One set of tooltips serves a document however many times this is
 * called; each call returns its own handle.
 */
export function mountTooltips(document: Document = globalThis.document, options: TooltipOptions = {}): TooltipHandle {
  let tooltips = mounted.get(document);
  if (!tooltips) {
    tooltips = new Tooltips(document);
    mounted.set(document, tooltips);
  }
  tooltips.handles += 1;
  if (options.help !== undefined) tooltips.setHelp(options.help);
  const shared = tooltips;
  let released = false;
  return {
    get help() { return shared.help; },
    setHelp(on: boolean) { if (!released) shared.setHelp(on); },
    dispose() {
      if (released) return;
      released = true;
      shared.handles -= 1;
      if (shared.handles > 0) return;
      shared.destroy();
      if (mounted.get(document) === shared) mounted.delete(document);
    },
  };
}
