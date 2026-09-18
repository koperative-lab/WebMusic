import {installStyle} from './internal/style';
import {claimHost, createErrorSink} from './internal/lifecycle';
import {addClassNames, clamp01, setParts} from './internal/dom';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {controlHeight, controlRadius, controlThumbRadius} from './internal/control';
import {bindLocalization, formatNumber, formatPercent, message, type UILocalization} from './localization';
// ============================================================================
// Domain-neutral queue presenter: a transport bar over an ordered list of
// entries. It knows nothing about audio, scores or files — only labels,
// durations and which row is current — so any sequential player can drive it.
// ============================================================================

export interface PlaylistItem {
  id: string;
  label: string;
  /** Pre-formatted duration text. The presenter never formats time itself. */
  duration?: string;
  active?: boolean;
  /**
   * Per-entry state. `loading` marks an entry being fetched or decoded;
   * `error` marks one that failed and is skipped. Absent means ready.
   */
  status?: 'loading' | 'error';
}

export interface PlaylistState {
  playing: boolean;
  /** Position within the CURRENT entry, 0..1. */
  progress: number;
  disabled?: boolean;
  items: readonly PlaylistItem[];
}

/** Structural presenter port. It owns no DOM or UI resource. */
export interface PlaylistBinding {
  snapshot(): PlaylistState;
  toggle(): Promise<void> | void;
  previous(): Promise<void> | void;
  next(): Promise<void> | void;
  /** Seek within the current entry. Receives a 0..1 fraction. */
  seek(value: number): Promise<void> | void;
  select(id: string): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}

export interface PlaylistClassNames {
  root?: string;
  bar?: string;
  button?: string;
  seek?: string;
  list?: string;
  item?: string;
}

export interface PlaylistParts {
  root?: string;
  bar?: string;
  button?: string;
  seek?: string;
  list?: string;
  item?: string;
}

export interface PlaylistOptions {
  localization?: UILocalization;
  /** Accessible name of the list. Defaults to 'Playlist'. */
  label?: string;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
  /** Compatibility classes added alongside the canonical `wui-*` classes. */
  classNames?: PlaylistClassNames;
  /** Additional CSS part tokens added alongside the canonical part names. */
  parts?: PlaylistParts;
  /** Receives command, subscription and snapshot failures. */
  onError?: (error: unknown) => void;
}

/**
 * Named references to the nodes a mounted playlist renders — the stable way to
 * reach presenter DOM, instead of indexing into `element`'s children.
 */
export interface PlaylistControls {
  previous: HTMLButtonElement;
  toggle: HTMLButtonElement;
  next: HTMLButtonElement;
  seek: HTMLInputElement;
  list: HTMLOListElement;
  /** The row for one entry id, when it is currently rendered. */
  item(id: string): HTMLLIElement | undefined;
}

export interface PlaylistHandle {
  element: HTMLElement;
  controls: PlaylistControls;
  update(): void;
  destroy(): void;
}

type Host = HTMLElement | ShadowRoot;

const mounted = new WeakMap<Host, PlaylistHandle>();

export const playlistStyle = String.raw`
.wui-playlist {
${componentSurfaceCss('playlist', {
  border: '1px solid var(--wm-playlist-border, var(--wm-border, #d8d8d8))',
  radius: 'var(--wm-playlist-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-playlist-background, var(--wm-surface, #fff))',
})}
  color: var(--wm-playlist-text, var(--wm-foreground, #444));
  font: .85rem var(--wm-font-family, var(--wm-font, system-ui, sans-serif));
}

.wui-playlist__bar {
  display: flex;
  align-items: center;
  gap: .5rem;
}

.wui-playlist__button {
  box-sizing: border-box;
  width: ${controlHeight('playlist')};
  height: ${controlHeight('playlist')};
  border: 1px solid var(--wm-playlist-button-border, ${controlBorderFallback});
  border-radius: var(--wm-playlist-radius, var(--wm-control-radius, 0));
  background: var(--wm-playlist-button, var(--wm-surface, #fff));
  color: var(--wm-playlist-button-text, var(--wm-foreground, #444));
  font: inherit;
  cursor: pointer;
}

.wui-playlist__button.play {
  border-color: var(--wm-playlist-primary-border, var(--wm-playlist-button-border, var(--wm-accent, #111)));
  background: var(--wm-playlist-primary-background, var(--wm-playlist-button, var(--wm-accent, #111)));
  color: var(--wm-playlist-primary-foreground, var(--wm-playlist-button-text, var(--wm-accent-foreground, #fff)));
}

.wui-playlist__button:disabled {
  cursor: default;
  opacity: .5;
}

.wui-playlist__seek {
  appearance: none;
  -webkit-appearance: none;
  box-sizing: border-box;
  flex: 1;
  min-width: 4rem;
  height: ${controlHeight('playlist')};
  margin: 0;
  border: 0;
  border-radius: ${controlRadius('playlist')};
  background: linear-gradient(
    to right,
    var(--wm-playlist-accent, var(--wm-accent, #111)) 0,
    var(--wm-playlist-accent, var(--wm-accent, #111)) var(--wui-playlist-progress, 0%),
    var(--wm-playlist-track, var(--wm-surface-muted, #f3f3f3)) var(--wui-playlist-progress, 0%)
  );
  cursor: pointer;
}

.wui-playlist__seek::-webkit-slider-runnable-track { height: 100%; border: 0; background: transparent; }
.wui-playlist__seek::-moz-range-track { height: 100%; border: 0; background: transparent; }

.wui-playlist__seek::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: var(--wm-playlist-handle-size, .9rem);
  height: ${controlHeight('playlist')};
  margin: 0;
  border: 0;
  border-radius: ${controlThumbRadius('playlist')};
  background: var(--wm-playlist-thumb, var(--wm-foreground, #111));
}

.wui-playlist__seek::-moz-range-thumb {
  width: var(--wm-playlist-handle-size, .9rem);
  height: ${controlHeight('playlist')};
  border: 0;
  border-radius: ${controlThumbRadius('playlist')};
  background: var(--wm-playlist-thumb, var(--wm-foreground, #111));
}

.wui-playlist__items {
  margin: .7rem 0 0;
  padding: 0;
  list-style: none;
}

.wui-playlist__item {
  display: flex;
  gap: .6rem;
  padding: .35rem .4rem;
  border-radius: var(--wm-playlist-radius, var(--wm-control-radius, 0));
  cursor: pointer;
}

.wui-playlist__item[aria-current="true"] {
  background: var(--wm-playlist-active, rgba(17, 17, 17, .08));
  font-weight: 600;
}

.wui-playlist__item[data-status="loading"] {
  opacity: .7;
}

.wui-playlist__item[data-status="error"] {
  color: var(--wm-playlist-error, var(--wm-error, #c0392b));
  cursor: default;
}

.wui-playlist__button:focus-visible,
.wui-playlist__seek:focus-visible {
  outline: 2px solid var(--wm-focus, currentColor);
  outline-offset: 2px;
}

.wui-playlist__item:focus-visible {
  outline: 2px solid var(--wm-focus, currentColor);
  outline-offset: -2px;
}

.wui-playlist__label {
  flex: 1;
}

.wui-playlist__duration {
  color: var(--wm-playlist-muted, var(--wm-foreground-muted, var(--wm-foreground, #666)));
  font-variant-numeric: tabular-nums;
}
`;

/**
 * Mount a queue: previous / play-pause / next, a seek bar over the current
 * entry, and the entry list.
 *
 * The rows are rendered once per list *identity* change and patched in place
 * afterwards. That matters because the natural notify source is a transport
 * tick at ~20 Hz: rebuilding every focusable row that often would steal focus
 * from a keyboard user mid-list and cancel clicks in flight.
 */
export function mountPlaylist(
  host: Host,
  binding: PlaylistBinding,
  options: PlaylistOptions = {},
): PlaylistHandle {

  const document = host.ownerDocument;
  const style = installStyle(document, 'playlist', playlistStyle, options.stylesheet);

  const root = document.createElement('div');
  root.className = 'wui-playlist wrap';
  addClassNames(root, options.classNames?.root);
  setParts(root, 'root', options.parts?.root);

  const bar = document.createElement('div');
  bar.className = 'wui-playlist__bar bar';
  addClassNames(bar, options.classNames?.bar);
  setParts(bar, 'bar', options.parts?.bar);

  const button = (modifier: string, label: string, text: string): HTMLButtonElement => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `wui-playlist__button t ${modifier}`;
    node.setAttribute('aria-label', label);
    node.textContent = text;
    addClassNames(node, options.classNames?.button);
    setParts(node, `button ${modifier}`, options.parts?.button);
    return node;
  };

  const previous = button('prev', message(options.localization, 'playlist.previous', 'Previous'), '⏮');
  const toggle = button('play', message(options.localization, 'playlist.play', 'Play'), '▶');
  const next = button('next', message(options.localization, 'playlist.next', 'Next'), '⏭');

  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '1000';
  seek.className = 'wui-playlist__seek seek';
  seek.setAttribute('aria-label', message(options.localization, 'playlist.seek', 'Seek'));
  addClassNames(seek, options.classNames?.seek);
  setParts(seek, 'seek', options.parts?.seek);

  bar.append(previous, toggle, next, seek);

  const list = document.createElement('ol');
  list.className = 'wui-playlist__items';
  list.setAttribute('aria-label', options.label ?? message(options.localization, 'playlist.label', 'Playlist'));
  addClassNames(list, options.classNames?.list);
  setParts(list, 'list', options.parts?.list);

  root.append(bar, list);

  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let unbindLocalization: (() => void) | undefined;
  let listSignature = '';
  const rows = new Map<string, HTMLLIElement>();

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

  const renderRow = (item: PlaylistItem, index: number): HTMLLIElement => {
    const row = document.createElement('li');
    row.className = 'wui-playlist__item item';
    row.dataset.i = item.id;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    addClassNames(row, options.classNames?.item);
    setParts(row, 'item', options.parts?.item);

    const ordinal = document.createElement('span');
    ordinal.className = 'num';
    ordinal.textContent = String(index + 1);

    const label = document.createElement('span');
    label.className = 'wui-playlist__label ttl';
    label.textContent = item.label;

    const duration = document.createElement('span');
    duration.className = 'wui-playlist__duration dur';
    duration.textContent = item.duration ?? '';

    const select = (): void => command(() => binding.select(item.id));
    row.addEventListener('click', select);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });

    row.append(ordinal, label, duration);
    return row;
  };

  /** Patch the mutable parts of a row: active, per-entry status, duration. */
  const paintRow = (row: HTMLLIElement, item: PlaylistItem, index: number): void => {
    row.classList.toggle('on', item.active === true);
    row.setAttribute('aria-current', String(item.active === true));
    if (item.status) row.dataset.status = item.status;
    else delete row.dataset.status;
    const duration = row.querySelector<HTMLElement>('.wui-playlist__duration');
    if (duration) duration.textContent = item.duration ?? '';
    const label = row.querySelector<HTMLElement>('.wui-playlist__label');
    if (label) label.textContent = item.label;
    const ordinal = row.querySelector<HTMLElement>('.num');
    if (ordinal) ordinal.textContent = formatNumber(options.localization, index + 1);
  };

  update = (): void => {
    if (destroyed) return;
    try {
      const state = binding.snapshot();
      const items = state.items ?? [];

      toggle.textContent = state.playing ? '⏸' : '▶';
      toggle.setAttribute('aria-label', state.playing
        ? message(options.localization, 'playlist.pause', 'Pause')
        : message(options.localization, 'playlist.play', 'Play'));
      previous.setAttribute('aria-label', message(options.localization, 'playlist.previous', 'Previous'));
      next.setAttribute('aria-label', message(options.localization, 'playlist.next', 'Next'));
      seek.setAttribute('aria-label', message(options.localization, 'playlist.seek', 'Seek'));
      seek.setAttribute('aria-valuetext', formatPercent(options.localization, clamp01(state.progress)));
      list.setAttribute('aria-label', options.label ?? message(options.localization, 'playlist.label', 'Playlist'));
      for (const control of [previous, toggle, next, seek]) {
        control.toggleAttribute('disabled', state.disabled === true);
      }
      seek.value = String(Math.round(clamp01(state.progress) * 1000));
      seek.style.setProperty('--wui-playlist-progress', `${clamp01(state.progress) * 100}%`);

      // Only the identity and order of the entries force a rebuild; label,
      // duration, active and status are patched onto the existing rows.
      const signature = JSON.stringify(items.map((item) => item.id));
      if (signature !== listSignature) {
        rows.clear();
        const nodes = items.map((item, index) => {
          const row = renderRow(item, index);
          rows.set(item.id, row);
          return row;
        });
        list.replaceChildren(...nodes);
        listSignature = signature;
      }
      for (const [index, item] of items.entries()) {
        const row = rows.get(item.id);
        if (row) paintRow(row, item, index);
      }
    } catch (error) {
      report(error);
    }
  };

  previous.addEventListener('click', () => command(() => binding.previous()));
  toggle.addEventListener('click', () => command(() => binding.toggle()));
  next.addEventListener('click', () => command(() => binding.next()));
  seek.addEventListener('input', () =>
    command(() => binding.seek(Number(seek.value) / 1000)),
  );

  const handle: PlaylistHandle = {
    element: root,
    controls: {
      previous,
      toggle,
      next,
      seek,
      list,
      item(id: string): HTMLLIElement | undefined {
        return rows.get(id);
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
      const releaseText = unbindLocalization;
      unbindLocalization = undefined;
      releaseText?.();
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
  unbindLocalization = bindLocalization(options.localization, update, () => !destroyed && claim.isCurrent(), report);
  return handle;
}
