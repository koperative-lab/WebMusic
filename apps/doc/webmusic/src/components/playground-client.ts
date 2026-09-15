// ============================================================================
// One hoisted module wires every <ElementPlayground> on the page.
//
// Astro dedupes identical module scripts, so this runs once no matter how many
// panels a page carries. Each panel is found by `[data-wm-pg]`, its live
// element by the `data-target` selector inside the panel's stage - no
// per-instance variables, and nothing here imports a WebMusic package (the
// panels' own demo scripts register the elements).
//
// Only boolean controls need a sentinel, because "absent" and "present but
// empty" are different states for them; every other control treats an empty
// value as "remove the attribute", which needs no magic string at all.
// ============================================================================

/** The words `boolAttr` in @webmusic/kernel/element reads as "present, but off". */
const FALSY = /^(false|0|no|off)$/i;

/** A composed demo handles structural reset here, before attributes are restored. */
export const PLAYGROUND_RESET_EVENT = 'webmusic:playground-reset';

/** Ask an already-mounted playground to discover and seed newly inserted controls. */
export const PLAYGROUND_SYNC_EVENT = 'webmusic:playground-sync';

type PlaygroundControl = HTMLSelectElement | HTMLInputElement;

/** Unscoped rows drive the panel's main target. This key cannot be a CSS selector. */
const ROOT_SCOPE = '\0playground-root';

interface PlaygroundMount {
  sync(): void;
  reset(): void;
}

/** One mount per panel, even when Astro/page lifecycle hooks call us repeatedly. */
const mounts = new WeakMap<HTMLElement, PlaygroundMount>();

/** Apply one control's current value to the live element. */
function apply(target: Element, control: PlaygroundControl): void {
  if (control instanceof HTMLInputElement && control.hasAttribute('data-pg-visible')) {
    target.toggleAttribute('hidden', !control.checked);
    return;
  }
  const name = control.dataset.pgAttr;
  if (!name) return;

  if (control.dataset.pgKind === 'bool') {
    const value = control.value;
    if (value === 'on') target.setAttribute(name, '');
    else if (value === 'off') target.setAttribute(name, 'false');
    else target.removeAttribute(name);
    return;
  }

  const raw = control.value.trim();
  if (raw === '') target.removeAttribute(name);
  else target.setAttribute(name, raw);
}

/** Longest single line worth keeping unwrapped before the tag is broken out. */
const ONE_LINE_LIMIT = 72;

/** Rebuild the `<tag …>` readout from the element's current attributes. */
/** Written by a presenter or the demo, never by the reader — so never printed. */
const PLUMBING = /^(?:class|style|part|slot|role|tabindex|data-|aria-)/;

/**
 * `id` is printed on a nested element and hidden on the root.
 *
 * On the root it is the demo naming its own element so its own wiring can find
 * it — `<score-view id="score-view">` beside `player="#score-player"` — and it is
 * not part of what the element does. Nested, it is how a composition tells its
 * children apart: `<rack-part id="lead">` is the name of the fader the desk
 * draws for it, and a reader copying the markup needs it.
 */
const hidden = (name: string, root: boolean): boolean =>
  PLUMBING.test(name) || (root && name === 'id');

/** Escape an attribute for the double-quoted HTML copied from the readout. */
function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '"') return '&quot;';
    if (character === '<') return '&lt;';
    return '&gt;';
  });
}

function printableAttribute(attribute: Attr): string {
  return attribute.value === ''
    ? attribute.name
    : `${attribute.name}="${escapeAttribute(attribute.value)}"`;
}

/**
 * The markup that builds what the stage shows, as a reader would write it.
 *
 * Only CUSTOM elements are printed. A composition is made of components, and
 * everything else in the tree was put there by one of them — the `<div>` a rack
 * transport mounts into, a presenter's own chrome — which a reader neither
 * writes nor copies.
 */
function markupFor(element: Element, indent: string, root = true): string[] {
  const tag = element.tagName.toLowerCase();
  const attributes = [...element.attributes]
    .filter((a) => !hidden(a.name, root))
    .map(printableAttribute);
  const open = attributes.length === 0 ? `<${tag}>` : `<${tag} ${attributes.join(' ')}>`;

  const children = [...element.children]
    .filter((child) => child.tagName.includes('-'))
    .flatMap((child) => markupFor(child, `${indent}  `, false));
  const close = `</${tag}>`;
  if (indent.length + open.length + (children.length ? 0 : close.length) <= ONE_LINE_LIMIT) {
    return children.length ? [`${indent}${open}`, ...children, `${indent}${close}`] : [`${indent}${open}${close}`];
  }
  const opening = [`${indent}<${tag}`, ...attributes.map((a) => `${indent}  ${a}`)];
  return children.length ? [...opening, `${indent}>`, ...children, `${indent}${close}`] : [...opening, `${indent}>${close}`];
}

function rootMarkupFor(root: Element): string[] {
  const lines = markupFor(root, '');
  if (lines.length !== 1 || lines[0]!.length <= ONE_LINE_LIMIT) return lines;

  const tag = root.tagName.toLowerCase();
  const attributes = [...root.attributes]
    .filter((attribute) => !hidden(attribute.name, true))
    .map(printableAttribute);
  return [
    `<${tag}`,
    ...attributes.map((attribute) => `  ${attribute}`),
    `></${tag}>`,
  ];
}

function readout(panel: HTMLElement, root: Element): void {
  const out = panel.querySelector<HTMLElement>('[data-pg-markup]');
  if (!out) return;
  // A live composition can consist of sibling custom elements connected by a
  // property (for example note-input + score-recorder.source). A native stage
  // wrapper marked as a fragment is layout-only: copy the public components,
  // never the documentation div around them.
  const fragment = root.hasAttribute('data-pg-fragment');
  const lines = fragment
    ? [...root.children]
      .filter((child) => child.tagName.includes('-'))
      .flatMap((child) => markupFor(child, '', false))
    : rootMarkupFor(root);
  out.textContent = lines.join('\n');
}

/** Put the current markup on the clipboard, reporting what actually happened. */
function wireCopy(panel: HTMLElement): void {
  const button = panel.querySelector<HTMLButtonElement>('[data-pg-copy]');
  const markup = panel.querySelector<HTMLElement>('[data-pg-markup]');
  if (!button || !markup) return;

  const copySources = (): HTMLElement[] => {
    const visible = [...panel.querySelectorAll<HTMLElement>('[data-pg-copy-source]')]
      .filter((source) => !source.closest('[hidden]'))
      .filter((source) => (source.textContent ?? '').trim() !== '');
    return visible.length > 0 ? visible : [markup];
  };

  const label = button.textContent ?? 'Copy';
  let restore: ReturnType<typeof setTimeout> | undefined;
  const say = (text: string): void => {
    button.textContent = text;
    if (restore) clearTimeout(restore);
    restore = setTimeout(() => {
      button.textContent = label;
    }, 1400);
  };

  button.addEventListener('click', () => {
    void (async () => {
      const sources = copySources();
      const contents = sources.map((source) => source.textContent ?? '').join('\n\n');
      try {
        await navigator.clipboard.writeText(contents);
        say('Copied');
      } catch {
        // Clipboard access can be refused (permission, insecure context). Select
        // the text so the keyboard shortcut still works, and say so rather than
        // claiming a copy that did not happen.
        const range = document.createRange();
        range.selectNodeContents(panel.querySelector('[data-pg-code-stack]') ?? markup);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        say('Selected — press ⌘/Ctrl+C');
      }
    })();
  });
}

function wire(panel: HTMLElement): PlaygroundMount {
  const stage = panel.querySelector('[data-pg-stage]') ?? panel;

  /** Values authored into the demo, keyed by a selector that survives replacement. */
  const baselines = new Map<string, Map<string, string | null>>();
  let readoutObserver: MutationObserver | undefined;
  let observedRoot: Element | undefined;
  let observedAttributes = '';
  let targetObserver: MutationObserver | undefined;
  let targetObserverTimer: ReturnType<typeof setTimeout> | undefined;

  const queryStage = (selector: string): Element | null => {
    try {
      return stage.querySelector(selector);
    } catch {
      // A scope comes from demo markup, but a malformed dynamic selector must
      // disable one row rather than break every playground on the page.
      return null;
    }
  };

  const findTarget = (): Element | null => {
    const selector = panel.dataset.target;
    return selector ? queryStage(selector) : null;
  };

  const controls = (): PlaygroundControl[] =>
    [...panel.querySelectorAll<PlaygroundControl>('[data-pg-attr], [data-pg-visible]')]
      .filter((control) => !control.closest('[data-pg-draft]'));

  const scopeKey = (control: Element): string => {
    const selector = control.closest('[data-pg-scope]')?.getAttribute('data-pg-scope');
    return selector || ROOT_SCOPE;
  };

  const targetForKey = (key: string): Element | null =>
    key === ROOT_SCOPE ? findTarget() : queryStage(key);

  /**
   * Which element a control drives. A row inside a `data-pg-scope` block drives
   * the element that selector finds — that is how a composed demo gives a
   * nested part the strip its own page has.
   *
   * Returns null rather than the panel target when a scope no longer resolves.
   * The alternative is worse than doing nothing: remove a part and its rows
   * survive server-rendered, so a fallback would quietly write that part's
   * `src` onto the master and tear the whole composition down.
   */
  const targetOf = (control: Element): Element | null => {
    return targetForKey(scopeKey(control));
  };

  const markupRoot = (): Element | null => {
    // The readout may root ABOVE the element the controls drive: a page about
    // `<rack-control>` still has to hand the reader the player it lives inside.
    const selector = panel.dataset.markup;
    return (selector ? queryStage(selector) : null) ?? findTarget();
  };

  const refresh = (): void => {
    for (const row of panel.querySelectorAll<HTMLElement>('[data-pg-when]')) {
      try {
        const condition = JSON.parse(row.dataset.pgWhen!) as {
          attribute: string; values: string[]; fallback: string; options?: string[];
        };
        const raw = targetOf(row)?.getAttribute(condition.attribute) ?? '';
        const value = condition.options ? (condition.options.includes(raw) ? raw : condition.fallback) : raw || condition.fallback;
        row.hidden = !condition.values.includes(value);
      } catch {
        row.hidden = true;
      }
    }
    const root = markupRoot();
    if (root) readout(panel, root);
  };

  /** Remember one controlled attribute exactly once, before the reader edits it. */
  const remember = (control: PlaygroundControl): void => {
    const name = control.hasAttribute('data-pg-visible') ? 'hidden' : control.dataset.pgAttr;
    const owner = targetOf(control);
    if (!name || !owner) return;
    const key = scopeKey(control);
    let attributes = baselines.get(key);
    if (!attributes) {
      attributes = new Map();
      baselines.set(key, attributes);
    }
    if (!attributes.has(name)) {
      attributes.set(name, owner.hasAttribute(name) ? owner.getAttribute(name) : null);
    }
  };

  /** Clear browser-restored form state before reflecting the live element. */
  const seed = (control: PlaygroundControl): void => {
    if (control instanceof HTMLInputElement && control.hasAttribute('data-pg-visible')) {
      const owner = targetOf(control);
      control.disabled = !owner;
      control.checked = !owner?.hasAttribute('hidden');
      return;
    }
    const unset = control.dataset.pgKind === 'bool' ? 'unset' : '';
    control.value = unset;

    const name = control.dataset.pgAttr;
    const owner = targetOf(control);
    control.disabled = !owner;
    if (!name || !owner?.hasAttribute(name)) return;

    const value = owner.getAttribute(name) ?? '';
    if (control.dataset.pgKind === 'bool') {
      control.value = FALSY.test(value.trim()) ? 'off' : 'on';
    } else if (control instanceof HTMLSelectElement) {
      if ([...control.options].some((option) => option.value === value)) control.value = value;
    } else {
      control.value = value;
    }
    // A select's default label may carry the unset sentinel instead of its
    // displayed spelling, so fall back to that sentinel when no value matched.
    if (control instanceof HTMLSelectElement && control.selectedIndex === -1) {
      control.value = unset;
    }
  };

  const restoreBaselines = (): void => {
    for (const [key, attributes] of baselines) {
      const owner = targetForKey(key);
      if (!owner) continue;
      for (const [name, value] of attributes) {
        // Structural editors can recreate an element with its authored values
        // before this pass. Avoid setting an identical src/format again: a
        // custom element still receives attributeChangedCallback for that
        // redundant write and may otherwise reload the same resource twice.
        if (value === null) {
          if (owner.hasAttribute(name)) owner.removeAttribute(name);
        } else if (owner.getAttribute(name) !== value) {
          owner.setAttribute(name, value);
        }
      }
    }
  };

  /** Follow the current composition and the attributes represented by its rows. */
  const observeReadout = (): void => {
    if (typeof MutationObserver === 'undefined') return;
    const root = markupRoot();
    if (!root) {
      readoutObserver?.disconnect();
      readoutObserver = undefined;
      observedRoot = undefined;
      observedAttributes = '';
      return;
    }
    const watched = [
      ...new Set(controls().map((control) => control.dataset.pgAttr ?? '').filter(Boolean)),
      'id',
      'hidden',
    ].sort();
    const signature = watched.join('\0');
    if (readoutObserver && observedRoot === root && observedAttributes === signature) return;

    readoutObserver?.disconnect();
    readoutObserver = new MutationObserver(refresh);
    readoutObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: watched,
    });
    observedRoot = root;
    observedAttributes = signature;
  };

  const stopWaitingForTarget = (): void => {
    targetObserver?.disconnect();
    targetObserver = undefined;
    if (targetObserverTimer !== undefined) clearTimeout(targetObserverTimer);
    targetObserverTimer = undefined;
  };

  const waitForTarget = (): void => {
    if (targetObserver || typeof MutationObserver === 'undefined') return;
    targetObserver = new MutationObserver(() => {
      if (!findTarget()) return;
      stopWaitingForTarget();
      mount.sync();
    });
    targetObserver.observe(stage, {childList: true, subtree: true});
    targetObserverTimer = setTimeout(stopWaitingForTarget, 10_000);
  };

  const mount: PlaygroundMount = {
    sync: () => {
      const current = controls();
      if (!findTarget()) {
        for (const control of current) control.disabled = true;
        waitForTarget();
        return;
      }

      stopWaitingForTarget();
      for (const control of current) remember(control);
      for (const control of current) seed(control);
      observeReadout();
      refresh();
    },
    reset: () => {
      // A composed editor gets the first word so it can synchronously put its
      // authored child structure back before stable-scope attributes are applied.
      panel.dispatchEvent(new CustomEvent(PLAYGROUND_RESET_EVENT, {bubbles: true}));
      restoreBaselines();
      mount.sync();
    },
  };

  // Delegation gives controls inserted later the same semantics as the rows
  // Astro rendered initially. Draft controls are intentionally inert until a
  // composed editor promotes them and requests a sync.
  const onControlEvent = (event: Event): void => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
    if (!control.matches('[data-pg-attr], [data-pg-visible]') || control.closest('[data-pg-draft]')) return;
    if (
      event.type === 'input' &&
      (!(control instanceof HTMLInputElement) || control.dataset.pgCommit === 'change')
    ) return;
    if (!control.checkValidity()) return;

    remember(control);
    const owner = targetOf(control);
    if (owner) apply(owner, control);
    refresh();
  };
  panel.addEventListener('change', onControlEvent);
  panel.addEventListener('input', onControlEvent);

  wireCopy(panel);

  panel.querySelector<HTMLButtonElement>('[data-pg-reset]')?.addEventListener('click', () => {
    mount.reset();
  });

  panel.addEventListener(PLAYGROUND_SYNC_EVENT, () => mount.sync());
  mount.sync();
  return mount;
}

function mountPanel(panel: HTMLElement): void {
  const mounted = mounts.get(panel);
  if (mounted) {
    mounted.sync();
    return;
  }
  mounts.set(panel, wire(panel));
}

export function mountPlaygrounds(): void {
  for (const panel of document.querySelectorAll<HTMLElement>('[data-wm-pg]')) mountPanel(panel);
}

function syncPlaygroundsAfterPageShow(event: PageTransitionEvent): void {
  // A normal load has fresh authored DOM; syncing is enough and avoids
  // rebuilding async components a second time. A BFCache restore revives the
  // edited DOM itself, so only that path needs the complete structural reset.
  if (!event.persisted) {
    mountPlaygrounds();
    return;
  }
  for (const panel of document.querySelectorAll<HTMLElement>('[data-wm-pg]')) {
    const mounted = mounts.get(panel);
    if (mounted) mounted.reset();
    else mountPanel(panel);
  }
}

// A browser may restore edited DOM from its back-forward cache. Authored
// baselines remain the source of truth; a persisted pageshow restores them,
// while a normal first load only gets the idempotent hydration pass.
if (typeof window !== 'undefined') window.addEventListener('pageshow', syncPlaygroundsAfterPageShow);
