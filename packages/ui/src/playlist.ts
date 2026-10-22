import {mountStatus, statusStyle, type StatusHandle, type StatusState} from './status';
import {installStyle} from './internal/style';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {controlHeight, controlRadius, controlThumbRadius} from './internal/control';
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
  /** Optional owner readiness. An empty list otherwise waits for entries. */
  status?: StatusState;
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
  /** Added to all three transport buttons. */
  button?: string;
  previous?: string;
  play?: string;
  next?: string;
  seek?: string;
  list?: string;
  item?: string;
  number?: string;
  label?: string;
  duration?: string;
  status?: string;
  itemStatus?: string;
}

export interface PlaylistParts {
  root?: string;
  bar?: string;
  /** Added to all three transport buttons. */
  button?: string;
  previous?: string;
  play?: string;
  next?: string;
  seek?: string;
  list?: string;
  item?: string;
  number?: string;
  label?: string;
  duration?: string;
  status?: string;
  itemStatus?: string;
}

export interface PlaylistOptions {
  /** Show the transport bar. False leaves selection to this list and transport to its owner. Default true. */
  transport?: boolean;
  /** Accessible name of the list. Defaults to 'Playlist'. */
  label?: string;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
  previousLabel?: string;
  playLabel?: string;
  pauseLabel?: string;
  nextLabel?: string;
  seekLabel?: string;
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

/** A snapshot with every optional field resolved, so painting stays total. */
interface NormalizedItem {
  id: string;
  label: string;
  duration: string;
  active: boolean;
  status?: 'loading' | 'error';
}

interface NormalizedState {
  playing: boolean;
  progress: number;
  disabled: boolean;
  items: NormalizedItem[];
  status: StatusState;
}

const mounted = new WeakMap<Host, PlaylistHandle>();

export const playlistStyle = statusStyle + String.raw`
.wui-playlist,
.wui-playlist * { box-sizing: border-box; }

.wui-playlist {
${componentSurfaceCss('playlist', {
  border: '1px solid var(--wm-playlist-border, var(--wm-border, #d8d8d8))',
  radius: 'var(--wui-playlist-radius, var(--wm-playlist-radius, var(--wm-control-radius, 0)))',
  background: 'var(--wm-playlist-background, var(--wm-surface, #fff))',
})}
  color: var(--wui-playlist-text, var(--wm-playlist-text, var(--wm-foreground, #444)));
  font: .85rem var(--wm-font-family, var(--wm-font, system-ui, sans-serif));
}

.wui-playlist__status .wui-status { min-height:3rem; height:auto; }
.wui-playlist__item-status { flex:0 0 auto; }
.wui-playlist__item-status .wui-status { --wm-status-indicator-size:.875rem; }
.wui-playlist__status[hidden], .wui-playlist__item-status[hidden], .wui-playlist__duration[hidden], .wui-playlist__bar[hidden], .wui-playlist__items[hidden] { display:none; }
.wui-playlist__bar {
  display: flex;
  align-items: center;
  gap: .5rem;
}

.wui-playlist__button {
  width: ${controlHeight('playlist')};
  height: ${controlHeight('playlist')};
  padding: 0;
  border: 1px solid var(--wm-playlist-button-border, ${controlBorderFallback});
  border-radius: var(--wui-playlist-radius, var(--wm-playlist-radius, var(--wm-control-radius, 0)));
  background: var(--wm-playlist-button, var(--wm-surface, #fff));
  color: var(--wm-playlist-button-text, var(--wm-foreground, #444));
  font: inherit;
  cursor: pointer;
}

.wui-playlist__button.play {
  border-color: var(--wui-playlist-primary-border, var(--wm-playlist-primary-border, var(--wm-playlist-button-border, var(--wm-accent, #111))));
  background: var(--wui-playlist-primary-background, var(--wm-playlist-primary-background, var(--wm-playlist-button, var(--wm-accent, #111))));
  color: var(--wui-playlist-primary-foreground, var(--wm-playlist-primary-foreground, var(--wm-playlist-button-text, var(--wm-accent-foreground, #fff))));
}

.wui-playlist__button:disabled {
  cursor: default;
  opacity: .5;
}

.wui-playlist__button:focus-visible,
.wui-playlist__seek:focus-visible {
  outline: 2px solid var(--wm-focus, currentColor);
  outline-offset: 2px;
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
  border-radius: var(--wui-playlist-radius, ${controlRadius('playlist')});
  background: linear-gradient(
    to right,
    var(--wui-playlist-accent, var(--wm-playlist-accent, var(--wm-accent, #111))) 0,
    var(--wui-playlist-accent, var(--wm-playlist-accent, var(--wm-accent, #111))) var(--wui-playlist-progress, 0%),
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

/* A linked queue omits the transport bar; its first row needs no reserved gap. */
.wui-playlist__items:first-child { margin-top: 0; }

.wui-playlist__item {
  display: flex;
  align-items: baseline;
  gap: .6rem;
  padding: .35rem .4rem;
  border-radius: var(--wui-playlist-radius, var(--wm-playlist-radius, var(--wm-control-radius, 0)));
  cursor: pointer;
}

.wui-playlist__item[aria-current="true"] {
  background: var(--wui-playlist-active, var(--wm-playlist-active, rgba(17, 17, 17, .08)));
  font-weight: 600;
}

.wui-playlist__item[data-status="loading"] {
  opacity: .7;
}

.wui-playlist__item[data-status="error"] {
  color: var(--wm-playlist-error, var(--wm-error, #c0392b));
  cursor: default;
}

.wui-playlist__item:focus-visible {
  outline: 2px solid var(--wm-focus, currentColor);
  outline-offset: -2px;
}

.wui-playlist__label {
  flex: 1;
  min-width: 0;
}

.wui-playlist__duration {
  color: var(--wui-playlist-muted, var(--wm-playlist-muted, var(--wm-foreground-muted, var(--wm-foreground, #666))));
  font-variant-numeric: tabular-nums;
}

/* Rows are list items, so they cannot carry :disabled themselves. */
.wui-playlist[aria-disabled="true"] .wui-playlist__item {
  opacity: .5;
  cursor: default;
}

.wui-playlist__number {
  font-variant-numeric: tabular-nums;
}

@media (forced-colors: active) {
  .wui-playlist { border-color: CanvasText; background: Canvas; color: CanvasText; }
  .wui-playlist__button { border-color: ButtonText; background: ButtonFace; color: ButtonText; }
  .wui-playlist__item[aria-current="true"] { outline: 2px solid Highlight; }
}
`;

function addClassNames(element: Element, names: string | undefined): void {
  for (const name of names?.trim().split(/\s+/) ?? []) {
    if (name) element.classList.add(name);
  }
}

function setParts(
  element: Element,
  canonical: readonly string[],
  ...additional: Array<string | undefined>
): void {
  const tokens = [
    ...canonical,
    ...additional.flatMap((value) => value?.trim().split(/\s+/) ?? []),
  ].filter(Boolean);
  element.setAttribute('part', [...new Set(tokens)].join(' '));
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function clamp01(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, numeric));
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as {then?: unknown}).then === 'function'
  );
}

function normalizeSnapshot(snapshot: PlaylistState): NormalizedState {
  const items = Array.from(snapshot?.items ?? [], (item): NormalizedItem => {
    const status = item?.status;
    return {
      id: text(item?.id),
      label: text(item?.label),
      duration: text(item?.duration),
      active: item?.active === true,
      ...(status === 'loading' || status === 'error' ? {status} : {}),
    };
  });
  for (const item of items) {
    // Rows are addressed by id — `controls.item(id)`, selection, focus
    // restoration — so a blank one would make an entry unreachable.
    if (!item.id.trim()) throw new TypeError('Playlist item ids must not be empty');
  }
  return {
    playing: snapshot?.playing === true,
    progress: clamp01(snapshot?.progress),
    disabled: snapshot?.disabled === true,
    status: snapshot?.status ?? {kind: items.length ? 'ready' : 'waiting', message: 'Waiting for playlist entries.'},
    items,
  };
}

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
  setParts(root, ['root'], options.parts?.root);

  const bar = document.createElement('div');
  bar.className = 'wui-playlist__bar bar';
  addClassNames(bar, options.classNames?.bar);
  setParts(bar, ['bar'], options.parts?.bar);

  const button = (
    modifier: 'prev' | 'play' | 'next',
    kind: 'previous' | 'play' | 'next',
    label: string,
    icon: string,
  ): HTMLButtonElement => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `wui-playlist__button t ${modifier}`;
    node.setAttribute('aria-label', label);
    node.textContent = icon;
    addClassNames(node, options.classNames?.button);
    addClassNames(node, options.classNames?.[kind]);
    setParts(node, ['button', modifier], options.parts?.button, options.parts?.[kind]);
    return node;
  };

  const previous = button('prev', 'previous', options.previousLabel ?? 'Previous', '⏮');
  const toggle = button('play', 'play', options.playLabel ?? 'Play', '▶');
  const next = button('next', 'next', options.nextLabel ?? 'Next', '⏭');

  const seek = document.createElement('input');
  seek.type = 'range';
  seek.min = '0';
  seek.max = '1000';
  seek.step = '1';
  seek.className = 'wui-playlist__seek seek';
  seek.setAttribute('aria-label', options.seekLabel ?? 'Seek');
  addClassNames(seek, options.classNames?.seek);
  setParts(seek, ['seek'], options.parts?.seek);

  bar.append(previous, toggle, next, seek);

  const list = document.createElement('ol');
  list.className = 'wui-playlist__items';
  list.setAttribute('aria-label', options.label ?? 'Playlist');
  addClassNames(list, options.classNames?.list);
  setParts(list, ['list'], options.parts?.list);

  if (options.transport !== false) root.append(bar);
  root.append(list);
  const statusHost = document.createElement('div');
  statusHost.className = 'wui-playlist__status';
  addClassNames(statusHost, options.classNames?.status);
  setParts(statusHost, ['status'], options.parts?.status);
  root.append(statusHost);
  let statusState: StatusState = {kind: 'ready'};
  const status = mountStatus(statusHost, {snapshot: () => statusState}, {
    stylesheet: false, classNames: {root: 'wui-status--embedded'},
  });

  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  let current: NormalizedState | undefined;
  let updating = false;
  let pendingUpdate = false;
  let commandRevision = 0;
  let listSignature = '';
  const rows = new Map<string, HTMLLIElement>();
  const rowStatuses = new Map<string, {host: HTMLElement; handle: StatusHandle; state: StatusState}>();
  const clearRowStatuses = (): void => {
    for (const item of rowStatuses.values()) item.handle.destroy();
    rowStatuses.clear();
  };
  const cleanups: Array<() => void> = [];

  const isCurrent = (): boolean => !destroyed && mounted.get(host) === handle;

  const report = (error: unknown): void => {
    try {
      const result = options.onError?.(error);
      if (isThenable(result)) void Promise.resolve(result).catch(() => undefined);
    } catch {
      // Error reporting must not break the presenter's own update path.
    }
  };

  const listen = (target: EventTarget, type: string, listener: EventListener): void => {
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  };

  const focusedRowId = (): string | undefined => {
    const tree = list.getRootNode() as Document | ShadowRoot;
    const active = tree.activeElement ?? document.activeElement;
    if (!active || !list.contains(active)) return undefined;
    const id = active.getAttribute('data-i');
    return id?.trim() ? id : undefined;
  };

  const renderRow = (item: NormalizedItem, index: number): HTMLLIElement => {
    const row = document.createElement('li');
    row.className = 'wui-playlist__item item';
    row.dataset.i = item.id;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    addClassNames(row, options.classNames?.item);
    setParts(row, ['item'], options.parts?.item);

    const ordinal = document.createElement('span');
    ordinal.className = 'wui-playlist__number num';
    ordinal.textContent = String(index + 1);
    // The row's accessible name is its contents; the ordinal is already
    // conveyed by the list itself.
    ordinal.setAttribute('aria-hidden', 'true');
    addClassNames(ordinal, options.classNames?.number);
    setParts(ordinal, ['number'], options.parts?.number);

    const label = document.createElement('span');
    label.className = 'wui-playlist__label ttl';
    label.textContent = item.label;
    addClassNames(label, options.classNames?.label);
    setParts(label, ['label'], options.parts?.label);

    const duration = document.createElement('span');
    duration.className = 'wui-playlist__duration dur';
    duration.textContent = item.duration;
    addClassNames(duration, options.classNames?.duration);
    setParts(duration, ['duration'], options.parts?.duration);

    const itemStatus = document.createElement('span');
    itemStatus.className = 'wui-playlist__item-status';
    addClassNames(itemStatus, options.classNames?.itemStatus);
    setParts(itemStatus, ['item-status'], options.parts?.itemStatus);
    const entry = {host: itemStatus, state: {kind: 'ready'} as StatusState, handle: undefined as StatusHandle | undefined};
    const handle = mountStatus(itemStatus, {snapshot: () => entry.state}, {
      stylesheet: false, classNames: {root: 'wui-status--embedded'},
    });
    // The binding closes over the same mutable entry stored for repainting.
    rowStatuses.set(item.id, Object.assign(entry, {handle}));
    row.append(ordinal, label, duration, itemStatus);
    return row;
  };

  /** Patch the mutable parts of a row: active, per-entry status, duration. */
  const paintRow = (row: HTMLLIElement, item: NormalizedItem): void => {
    row.classList.toggle('on', item.active);
    row.setAttribute('aria-current', String(item.active));
    if (item.status) row.dataset.status = item.status;
    else delete row.dataset.status;
    const duration = row.querySelector<HTMLElement>('.wui-playlist__duration');
    if (duration) {
      duration.textContent = item.duration;
      duration.hidden = item.status === 'loading' || item.status === 'error';
    }
    const feedback = rowStatuses.get(item.id);
    if (feedback) {
      feedback.state = {kind: item.status ?? 'ready', message: item.status === 'error' ? 'Unable to load' : item.status === 'loading' ? `Loading ${item.label}` : ''};
      feedback.handle.update();
      feedback.host.hidden = !item.status;
    }
  };

  const paint = (state: NormalizedState): void => {
    statusState = state.status;
    status.update();
    statusHost.hidden = statusState.kind === 'ready';
    list.hidden = state.items.length === 0;
    bar.hidden = list.hidden && statusState.kind !== 'ready';
    root.setAttribute('aria-busy', String(statusState.kind === 'loading' || state.items.some((item) => item.active && item.status === 'loading')));
    toggle.textContent = state.playing ? '⏸' : '▶';
    toggle.setAttribute(
      'aria-label',
      state.playing ? (options.pauseLabel ?? 'Pause') : (options.playLabel ?? 'Play'),
    );
    toggle.setAttribute('aria-pressed', String(state.playing));
    root.classList.toggle('is-playing', state.playing);
    root.classList.toggle('is-disabled', state.disabled);
    root.setAttribute('aria-disabled', String(state.disabled));
    for (const control of [previous, toggle, next, seek]) {
      control.disabled = state.disabled;
    }
    seek.value = String(Math.round(state.progress * 1000));
    seek.defaultValue = seek.value;
    seek.style.setProperty('--wui-playlist-progress', `${state.progress * 100}%`);
    seek.setAttribute('aria-valuetext', `${Math.round(state.progress * 100)}%`);

    // Only the identity and order of the entries force a rebuild; label,
    // duration, active and status are patched onto the existing rows.
    const signature = JSON.stringify(state.items.map((item) => [item.id, item.label]));
    if (signature !== listSignature) {
      const refocus = focusedRowId();
      rows.clear();
      clearRowStatuses();
      const nodes = state.items.map((item, index) => {
        const row = renderRow(item, index);
        rows.set(item.id, row);
        return row;
      });
      list.replaceChildren(...nodes);
      listSignature = signature;
      if (refocus !== undefined) rows.get(refocus)?.focus();
    }
    for (const item of state.items) {
      const row = rows.get(item.id);
      if (row) paintRow(row, item);
    }
    current = state;
  };

  const performUpdate = (): void => {
    if (!isCurrent()) return;
    try {
      const state = normalizeSnapshot(binding.snapshot());
      if (isCurrent()) paint(state);
    } catch (error) {
      if (isCurrent()) report(error);
    }
  };

  const update = (): void => {
    if (!isCurrent()) return;
    if (updating) {
      // A notify raised while painting cannot recurse; it runs one more pass.
      pendingUpdate = true;
      return;
    }
    updating = true;
    let passes = 0;
    try {
      do {
        pendingUpdate = false;
        performUpdate();
        passes += 1;
      } while (pendingUpdate && isCurrent() && passes < 32);
      if (pendingUpdate && isCurrent()) {
        report(new Error('Playlist update did not stabilize after 32 passes'));
      }
    } finally {
      pendingUpdate = false;
      updating = false;
    }
  };

  const command = (work: () => Promise<void> | void): void => {
    if (!isCurrent() || current?.disabled !== false) return;
    const revision = ++commandRevision;
    const isLatest = (): boolean => isCurrent() && revision === commandRevision;
    const settle = (): void => {
      // An older command may still have changed the authoritative snapshot.
      if (isCurrent()) update();
    };
    const reject = (error: unknown): void => {
      if (!isCurrent()) return;
      const reportable = isLatest();
      update();
      if (reportable && isLatest()) report(error);
    };
    try {
      void Promise.resolve(work()).then(settle, reject);
    } catch (error) {
      reject(error);
    }
  };

  const rowFrom = (target: EventTarget | null): HTMLLIElement | undefined => {
    const node = (target as Element | null)?.closest?.('[data-i]');
    if (!node || !list.contains(node)) return undefined;
    const id = (node as HTMLElement).dataset.i;
    return id ? rows.get(id) : undefined;
  };

  listen(previous, 'click', () => command(() => binding.previous()));
  listen(toggle, 'click', () => command(() => binding.toggle()));
  listen(next, 'click', () => command(() => binding.next()));
  listen(seek, 'input', () =>
    command(() => binding.seek(clamp01(Number(seek.value) / 1000))),
  );
  // Rows are delegated: they are replaced whenever the entries change, and a
  // per-row listener would then have to be unbound one node at a time.
  listen(list, 'click', (event) => {
    const row = rowFrom(event.target);
    if (row) command(() => binding.select(row.dataset.i!));
  });
  listen(list, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== 'Enter' && key !== ' ') return;
    const row = rowFrom(event.target);
    if (!row) return;
    event.preventDefault();
    command(() => binding.select(row.dataset.i!));
  });

  /** Release everything this mount owns, keeping the first failure to report. */
  const teardown = (): {failed: boolean; error: unknown} => {
    let failed = false;
    let error: unknown;
    const attempt = (work: () => void): void => {
      try {
        work();
      } catch (thrown) {
        if (!failed) error = thrown;
        failed = true;
      }
    };
    for (const cleanup of cleanups.splice(0)) attempt(cleanup);
    const off = unsubscribe;
    unsubscribe = undefined;
    if (off) attempt(off);
    attempt(clearRowStatuses);
    attempt(() => status.destroy());
    attempt(() => root.remove());
    attempt(() => style?.remove());
    current = undefined;
    rows.clear();
    listSignature = '';
    if (mounted.get(host) === handle) mounted.delete(host);
    return {failed, error};
  };

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
    update,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      pendingUpdate = false;
      commandRevision += 1;
      const {failed, error} = teardown();
      if (failed) report(error);
    },
  };

  // Claim the host before releasing its previous presenter. Cleanup and error
  // callbacks may mount another playlist; this attempted handle then stays
  // inert and must never append over or later delete that replacement.
  const previousHandle = mounted.get(host);
  mounted.set(host, handle);
  try {
    try {
      previousHandle?.destroy();
    } catch (error) {
      if (isCurrent()) report(error);
    }
    if (!isCurrent()) return handle;

    host.append(...(style ? [style] : []), root);
    if (!isCurrent()) return handle;

    update();
    if (!isCurrent()) return handle;

    try {
      const off = binding.subscribe?.(update);
      if (off !== undefined && typeof off !== 'function') {
        throw new TypeError('Playlist subscribe() must return a function');
      }
      if (off) {
        if (isCurrent()) unsubscribe = off;
        else {
          try {
            off();
          } catch {
            // Superseded mounts do not publish stale cleanup failures.
          }
        }
      }
    } catch (error) {
      if (isCurrent()) report(error);
    }
  } catch (error) {
    destroyed = true;
    pendingUpdate = false;
    commandRevision += 1;
    teardown();
    throw error;
  }
  return handle;
}
