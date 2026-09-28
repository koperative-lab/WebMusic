import {installStyle} from './internal/style';
import {claimHost, createErrorSink} from './internal/lifecycle';
import {markEmptyState, addClassNames, setParts} from './internal/dom';
import {componentSurfaceCss} from './internal/surface';
// ============================================================================
// Domain-neutral list presenter: an ordered index of named rows, one of which
// may be current. It knows nothing about audio, regions, scores or time — only
// ids, labels, a pre-formatted `detail` string and an optional swatch colour —
// so any list-shaped selection surface can drive it.
//
// This is the accessible counterpart to a graphical lane, which is the whole
// reason it exists: a canvas can draw the same rows, but only real list
// semantics, real buttons, one tab stop and arrow-key movement make them
// reachable. Roles, focus and names are the contract here, not decoration.
// ============================================================================

export interface TrackListItem {
  id: string;
  label: string;
  /** Pre-formatted trailing text (a time, a count, a key). Never formatted here. */
  detail?: string;
  /** CSS colour for the row's swatch. Absent means the row shows no swatch. */
  color?: string;
  active?: boolean;
  /** Row present but not selectable — rendered dimmed and skipped by the arrows. */
  disabled?: boolean;
}

export interface TrackListState {
  items: readonly TrackListItem[];
  /** Disable every row at once, e.g. while the owner is still loading. */
  disabled?: boolean;
}

/** Structural presenter port. It owns no DOM or UI resource. */
export interface TrackListBinding {
  snapshot(): TrackListState;
  select(id: string): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}

export interface TrackListClassNames {
  root?: string;
  list?: string;
  item?: string;
  row?: string;
  swatch?: string;
  label?: string;
  detail?: string;
  empty?: string;
}

export interface TrackListParts {
  root?: string;
  list?: string;
  item?: string;
  row?: string;
  swatch?: string;
  label?: string;
  detail?: string;
  empty?: string;
}

export interface TrackListOptions {
  /** Accessible name of the list. Defaults to 'Tracks'. */
  label?: string;
  /**
   * Render an `<ol>` instead of a `<ul>`. Only for a list whose ORDER is part
   * of its meaning; a set of named rows is a `<ul>`.
   */
  ordered?: boolean;
  /**
   * Text shown in place of the rows when there are none. An empty list must
   * still say something — a blank box reads as a broken component.
   * Defaults to 'No items'.
   */
  emptyLabel?: string;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
  /** Compatibility classes added alongside the canonical `wui-*` classes. */
  classNames?: TrackListClassNames;
  /** Additional CSS part tokens added alongside the canonical part names. */
  parts?: TrackListParts;
  /** Receives command, subscription and snapshot failures. */
  onError?: (error: unknown) => void;
}

/**
 * Named references to the nodes a mounted track list renders — the stable way
 * to reach presenter DOM, instead of indexing into `element`'s children.
 */
export interface TrackListControls {
  /** The `<ul>` or `<ol>` carrying the rows. */
  list: HTMLElement;
  /** The `<li>` for one id, when it is currently rendered. */
  item(id: string): HTMLLIElement | undefined;
  /** The activatable control inside that `<li>`. */
  row(id: string): HTMLButtonElement | undefined;
  /** Move DOM focus to one row. Reports whether the row could take it. */
  focus(id: string): boolean;
}

export interface TrackListHandle {
  element: HTMLElement;
  controls: TrackListControls;
  update(): void;
  destroy(): void;
}

type Host = HTMLElement | ShadowRoot;

const mounted = new WeakMap<Host, TrackListHandle>();

export const trackListStyle = String.raw`
.wui-track-list {
${componentSurfaceCss('track-list', {
  padding: 'var(--wm-track-list-padding, .6rem)',
  border: '1px solid var(--wm-track-list-border, var(--wm-border, #d8d8d8))',
  radius: 'var(--wm-track-list-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-track-list-background, var(--wm-surface, #fff))',
})}
  color: var(--wm-track-list-text, var(--wm-foreground, #444));
  font: .85rem var(--wm-font-family, var(--wm-font, system-ui, sans-serif));
}

.wui-track-list__items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.wui-track-list__row {
  display: flex;
  align-items: center;
  gap: .5rem;
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: .35rem .4rem;
  border: 0;
  border-radius: var(--wm-track-list-radius, var(--wm-control-radius, 0));
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.wui-track-list__row[aria-current="true"] {
  background: var(--wm-track-list-active, rgba(17, 17, 17, .08));
  font-weight: 600;
}

.wui-track-list__row:disabled {
  cursor: default;
  opacity: .5;
}

.wui-track-list__row:focus-visible {
  outline: 2px solid var(--wm-focus, currentColor);
  outline-offset: -2px;
}

.wui-track-list__swatch {
  flex: none;
  width: .55rem;
  height: .55rem;
  border-radius: var(--wm-track-list-swatch-radius, 50%);
  background: var(--wm-track-list-swatch, currentColor);
}

/* The swatch node is always rendered so a colour can appear or disappear
   without rebuilding the row; the hidden attribute is what keeps it off
   screen, spelled out here rather than left to a host that may have reset it. */
.wui-track-list__swatch[hidden] {
  display: none;
}

.wui-track-list__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wui-track-list__detail {
  flex: none;
  margin-left: auto;
  color: var(--wm-track-list-muted, var(--wm-foreground-muted, var(--wm-foreground, #666)));
  font-variant-numeric: tabular-nums;
}

.wui-track-list__empty {
  padding: .4rem;
  color: var(--wm-track-list-muted, var(--wm-foreground-muted, var(--wm-foreground, #666)));
}
`;

/** The nodes of one rendered row, kept together so a patch never re-queries. */
interface Row {
  item: HTMLLIElement;
  row: HTMLButtonElement;
  swatch: HTMLSpanElement;
  label: HTMLSpanElement;
  detail: HTMLSpanElement;
}

/**
 * Mount an accessible index: a real list of real buttons, one of which may be
 * `aria-current`.
 *
 * The rows are rendered once per list *identity* change and patched in place
 * afterwards. That matters because the natural notify source is a playback or
 * selection tick: rebuilding every focusable row that often would steal focus
 * from a keyboard user mid-list and cancel clicks in flight.
 *
 * Focus uses a roving tabindex rather than making every row a tab stop. A
 * list of two hundred markers must not be two hundred stops on the way to the
 * next control; the arrows move within it, Tab moves past it.
 */
export function mountTrackList(
  host: Host,
  binding: TrackListBinding,
  options: TrackListOptions = {},
): TrackListHandle {

  const document = host.ownerDocument;
  const style = installStyle(document, 'track-list', trackListStyle, options.stylesheet);

  const root = document.createElement('div');
  root.className = 'wui-track-list';
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);

  const list = document.createElement(options.ordered ? 'ol' : 'ul');
  list.className = 'wui-track-list__items';
  // The list carries the name, not the wrapper: a screen reader reads it
  // together with "list, N items", which is the useful announcement.
  list.setAttribute('aria-label', options.label ?? 'Tracks');
  addClassNames(list, options.classNames?.list);
  setParts(list, 'list', options.parts?.list);

  root.append(list);

  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let listSignature = '';
  /** The id that currently owns the list's single tab stop. */
  let rovingId: string | undefined;
  let order: string[] = [];
  const rows = new Map<string, Row>();

  const report = createErrorSink(options.onError);

  let update = (): void => {};

  const command = (work: () => Promise<void> | void): void => {
    try {
      void Promise.resolve(work())
        .then(() => update())
        .catch(report);
    } catch (error) {
      report(error);
    }
  };

  /** Rows the arrows may land on. A disabled button cannot take focus. */
  const focusableRows = (): Row[] => {
    const result: Row[] = [];
    for (const id of order) {
      const entry = rows.get(id);
      if (entry && !entry.row.disabled) result.push(entry);
    }
    return result;
  };

  /** Give `id` the single tab stop, taking it from whoever held it. */
  const setRoving = (id: string | undefined): void => {
    rovingId = id;
    for (const [rowId, entry] of rows) entry.row.tabIndex = rowId === id ? 0 : -1;
  };

  const focusRow = (id: string): boolean => {
    const entry = rows.get(id);
    if (!entry || entry.row.disabled) return false;
    setRoving(id);
    entry.row.focus();
    return true;
  };

  /** Move focus `delta` rows from `from`, or to an end when `to` is given. */
  const moveFocus = (from: string, delta: number, to?: 'first' | 'last'): void => {
    const candidates = focusableRows();
    if (candidates.length === 0) return;
    const current = candidates.findIndex((entry) => entry.item.dataset.i === from);
    let index: number;
    if (to === 'first') index = 0;
    else if (to === 'last') index = candidates.length - 1;
    // Clamp instead of wrapping: in a long index, jumping from the last row
    // back to the first reads as the list having scrolled somewhere else.
    else index = Math.max(0, Math.min(candidates.length - 1, current + delta));
    const target = candidates[index];
    if (target) focusRow(target.item.dataset.i ?? from);
  };

  const renderRow = (item: TrackListItem): Row => {
    const listItem = document.createElement('li');
    listItem.className = 'wui-track-list__item';
    listItem.dataset.i = item.id;
    addClassNames(listItem, options.classNames?.item);
    setParts(listItem, 'item', options.parts?.item);

    // A real <button>, not a role=button div: it carries the accessible name,
    // the disabled state and the activation semantics for free.
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'wui-track-list__row';
    row.tabIndex = -1;
    addClassNames(row, options.classNames?.row);
    setParts(row, 'row', options.parts?.row);

    const swatch = document.createElement('span');
    swatch.className = 'wui-track-list__swatch';
    // Decorative: the colour repeats what the label already says, and an
    // unnamed coloured dot announced on every row is pure noise.
    swatch.setAttribute('aria-hidden', 'true');
    swatch.hidden = true;
    addClassNames(swatch, options.classNames?.swatch);
    setParts(swatch, 'swatch', options.parts?.swatch);

    const label = document.createElement('span');
    label.className = 'wui-track-list__label';
    label.textContent = item.label;
    addClassNames(label, options.classNames?.label);
    setParts(label, 'label', options.parts?.label);

    const detail = document.createElement('span');
    detail.className = 'wui-track-list__detail';
    addClassNames(detail, options.classNames?.detail);
    setParts(detail, 'detail', options.parts?.detail);

    row.addEventListener('click', () => command(() => binding.select(item.id)));
    row.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveFocus(item.id, 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveFocus(item.id, -1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        moveFocus(item.id, 0, 'first');
      } else if (event.key === 'End') {
        event.preventDefault();
        moveFocus(item.id, 0, 'last');
      } else if (event.key === 'Enter' || event.key === ' ') {
        // preventDefault suppresses the button's own activation (Enter fires a
        // click on keydown, Space on keyup), so a key press selects once, not
        // twice, and Space never scrolls the page instead.
        event.preventDefault();
        command(() => binding.select(item.id));
      }
    });
    // Tab, a click or a programmatic focus can all land somewhere the arrows
    // did not put us; the tab stop follows focus wherever it actually went.
    row.addEventListener('focus', () => setRoving(item.id));

    row.append(swatch, label, detail);
    listItem.append(row);
    return {item: listItem, row, swatch, label, detail};
  };

  /** Patch the mutable parts of a row: colour, detail, current and disabled. */
  const paintRow = (entry: Row, item: TrackListItem, disabled: boolean): void => {
    const current = item.active === true;
    entry.row.setAttribute('aria-current', String(current));
    entry.item.classList.toggle('on', current);
    entry.row.disabled = disabled || item.disabled === true;
    if (item.color) {
      entry.swatch.hidden = false;
      entry.swatch.style.background = item.color;
    } else {
      entry.swatch.hidden = true;
      entry.swatch.style.removeProperty('background');
    }
    entry.detail.textContent = item.detail ?? '';
    // An empty node would still claim the row's flex gap.
    entry.detail.hidden = !item.detail;
  };

  const renderEmpty = (): HTMLLIElement => {
    const empty = document.createElement('li');
    empty.className = 'wui-track-list__empty';
    empty.textContent = options.emptyLabel ?? 'No items';
    addClassNames(empty, options.classNames?.empty);
    setParts(empty, 'empty', options.parts?.empty);
    markEmptyState(empty);
    return empty;
  };

  update = (): void => {
    if (destroyed) return;
    try {
      const state = binding.snapshot();
      const items = state.items ?? [];
      const disabled = state.disabled === true;

      // Only identity, order and label force a rebuild; colour, detail,
      // current and disabled are patched onto the existing rows.
      const signature = JSON.stringify(items.map((item) => [item.id, item.label]));
      if (signature !== listSignature) {
        rows.clear();
        order = [];
        const nodes = items.map((item) => {
          const entry = renderRow(item);
          rows.set(item.id, entry);
          order.push(item.id);
          return entry.item;
        });
        list.replaceChildren(...(nodes.length > 0 ? nodes : [renderEmpty()]));
        listSignature = signature;
        rovingId = undefined;
      }
      for (const item of items) {
        const entry = rows.get(item.id);
        if (entry) paintRow(entry, item, disabled);
      }

      // Entering the list from Tab must land somewhere meaningful: the current
      // row when there is one, otherwise the first row that can take focus.
      const candidates = focusableRows();
      const held = candidates.some((entry) => entry.item.dataset.i === rovingId);
      if (!held) {
        const active = candidates.find((entry) => entry.row.getAttribute('aria-current') === 'true');
        setRoving((active ?? candidates[0])?.item.dataset.i);
      }
    } catch (error) {
      report(error);
    }
  };

  const handle: TrackListHandle = {
    element: root,
    controls: {
      list,
      item(id: string): HTMLLIElement | undefined {
        return rows.get(id)?.item;
      },
      row(id: string): HTMLButtonElement | undefined {
        return rows.get(id)?.row;
      },
      focus(id: string): boolean {
        return focusRow(id);
      },
    },
    update: () => update(),
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      try {
        unsubscribe?.();
      } catch (error) {
        report(error);
      }
      claim.release();
      root.remove();
      style?.remove();
    },
  };

  // Claim the host before destroying the previous mount: its cleanup may mount
  // a replacement, and that replacement must win.
  const claim = claimHost(mounted, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    // A re-entrant mount took the host while this one was appending; leave it
    // exactly as that mount left it.
    root.remove();
    style?.remove();
    return handle;
  }
  update();
  if (binding.subscribe) {
    try {
      unsubscribe = binding.subscribe(() => update());
    } catch (error) {
      report(error);
    }
  }
  return handle;
}
