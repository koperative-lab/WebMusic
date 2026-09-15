// @vitest-environment jsdom

import {describe, expect, it, vi} from 'vitest';
import {
  mountTrackList,
  trackListStyle,
  type TrackListBinding,
  type TrackListState,
} from '../src/track-list';

class FakeTrackList implements TrackListBinding {
  state: TrackListState = {
    items: [
      {id: 'a', label: 'Intro', detail: '0:00.0', color: '#f00', active: true},
      {id: 'b', label: 'Verse', detail: '0:12.5'},
      {id: 'c', label: 'Outro', detail: '1:04.0'},
    ],
  };

  readonly subscribers = new Set<() => void>();
  readonly select = vi.fn((id: string) => {
    this.state = {
      ...this.state,
      items: this.state.items.map((item) => ({...item, active: item.id === id})),
    };
  });

  snapshot(): TrackListState {
    return this.state;
  }

  subscribe(notify: () => void): () => void {
    this.subscribers.add(notify);
    return () => this.subscribers.delete(notify);
  }

  notify(): void {
    for (const subscriber of this.subscribers) subscriber();
  }
}

function mount(binding: TrackListBinding = new FakeTrackList()) {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mountTrackList(host, binding);
  return {host, handle, binding};
}

function press(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
}

describe('mountTrackList', () => {
  it('renders an accessible list of rows', () => {
    const {handle} = mount();

    expect(handle.controls.list.tagName).toBe('UL');
    expect(handle.controls.list.getAttribute('aria-label')).toBe('Tracks');
    expect(handle.controls.list.children).toHaveLength(3);

    const row = handle.controls.row('b');
    expect(row?.tagName).toBe('BUTTON');
    expect(row?.type).toBe('button');
    expect(row?.textContent).toContain('Verse');
    expect(row?.textContent).toContain('0:12.5');
    expect(handle.element.querySelector('style')).toBeNull();
    expect(trackListStyle).toContain('.wui-track-list__row');
  });

  it('shows a swatch only for a row that carries a colour', () => {
    const {handle} = mount();
    const swatch = (id: string): HTMLElement =>
      handle.controls.row(id)!.querySelector<HTMLElement>('.wui-track-list__swatch')!;

    expect(swatch('a').hidden).toBe(false);
    expect(swatch('a').style.background).toBe('rgb(255, 0, 0)');
    // Decorative: the label already names the row, so the dot stays unnamed.
    expect(swatch('a').getAttribute('aria-hidden')).toBe('true');
    expect(swatch('b').hidden).toBe(true);
  });

  it('marks the active row with aria-current and gives it the tab stop', () => {
    const {handle} = mount();

    expect(handle.controls.row('a')!.getAttribute('aria-current')).toBe('true');
    expect(handle.controls.row('b')!.getAttribute('aria-current')).toBe('false');
    // One tab stop for the whole list, on the row that is live.
    expect(handle.controls.row('a')!.tabIndex).toBe(0);
    expect(handle.controls.row('b')!.tabIndex).toBe(-1);
    expect(handle.controls.row('c')!.tabIndex).toBe(-1);
  });

  it('selects a row from the pointer and from the keyboard', () => {
    const binding = new FakeTrackList();
    const {handle} = mount(binding);

    handle.controls.row('c')!.click();
    expect(binding.select).toHaveBeenCalledWith('c');

    press(handle.controls.row('b')!, 'Enter');
    expect(binding.select).toHaveBeenCalledWith('b');

    press(handle.controls.row('a')!, ' ');
    expect(binding.select).toHaveBeenCalledWith('a');
    expect(binding.select).toHaveBeenCalledTimes(3);
  });

  it('cancels the native activation so a key press selects exactly once', () => {
    const {handle} = mount();
    const event = new KeyboardEvent('keydown', {key: ' ', bubbles: true, cancelable: true});

    handle.controls.row('b')!.dispatchEvent(event);

    // Without this the button would also fire its own click on keyup.
    expect(event.defaultPrevented).toBe(true);
  });

  it('moves focus between rows with the arrow keys', () => {
    const {handle} = mount();
    handle.controls.row('a')!.focus();

    press(handle.controls.row('a')!, 'ArrowDown');
    expect(document.activeElement).toBe(handle.controls.row('b'));
    expect(handle.controls.row('b')!.tabIndex).toBe(0);
    expect(handle.controls.row('a')!.tabIndex).toBe(-1);

    press(handle.controls.row('b')!, 'ArrowUp');
    expect(document.activeElement).toBe(handle.controls.row('a'));

    // Clamped, not wrapped: the ends of a long index stay put.
    press(handle.controls.row('a')!, 'ArrowUp');
    expect(document.activeElement).toBe(handle.controls.row('a'));

    press(handle.controls.row('a')!, 'End');
    expect(document.activeElement).toBe(handle.controls.row('c'));
    press(handle.controls.row('c')!, 'Home');
    expect(document.activeElement).toBe(handle.controls.row('a'));
  });

  it('skips a disabled row when the arrows move', () => {
    const binding = new FakeTrackList();
    const {handle} = mount(binding);

    binding.state = {
      ...binding.state,
      items: binding.state.items.map((item) =>
        item.id === 'b' ? {...item, disabled: true} : item,
      ),
    };
    binding.notify();

    expect(handle.controls.row('b')!.disabled).toBe(true);
    handle.controls.row('a')!.focus();
    press(handle.controls.row('a')!, 'ArrowDown');
    expect(document.activeElement).toBe(handle.controls.row('c'));
  });

  it('disables every row when the binding reports disabled', () => {
    const binding = new FakeTrackList();
    const {handle} = mount(binding);

    binding.state = {...binding.state, disabled: true};
    binding.notify();

    expect(handle.controls.row('a')!.disabled).toBe(true);
    expect(handle.controls.row('c')!.disabled).toBe(true);
  });

  it('keeps the row nodes across an active-only update', () => {
    const binding = new FakeTrackList();
    const {handle} = mount(binding);
    const before = [...handle.controls.list.children];
    const rowB = handle.controls.row('b')!;

    binding.select('b');
    binding.notify();

    // A selection tick must not rebuild focusable rows: a keyboard user mid
    // list would lose focus every time the playhead crossed a boundary.
    expect([...handle.controls.list.children]).toEqual(before);
    expect(handle.controls.row('b')).toBe(rowB);
    expect(rowB.getAttribute('aria-current')).toBe('true');
    expect(handle.controls.row('a')!.getAttribute('aria-current')).toBe('false');
  });

  it('patches colour and detail without rebuilding the row', () => {
    const binding = new FakeTrackList();
    const {handle} = mount(binding);
    const rowB = handle.controls.row('b')!;

    binding.state = {
      ...binding.state,
      items: binding.state.items.map((item) =>
        item.id === 'b' ? {...item, color: '#00f', detail: '0:13.0'} : item,
      ),
    };
    binding.notify();

    expect(handle.controls.row('b')).toBe(rowB);
    const swatch = rowB.querySelector<HTMLElement>('.wui-track-list__swatch')!;
    expect(swatch.hidden).toBe(false);
    expect(rowB.textContent).toContain('0:13.0');
  });

  it('rebuilds only when the rows themselves change', () => {
    const binding = new FakeTrackList();
    const {handle} = mount(binding);
    const rowA = handle.controls.row('a')!;

    binding.state = {
      ...binding.state,
      items: [...binding.state.items, {id: 'd', label: 'Encore'}],
    };
    binding.notify();

    expect(handle.controls.list.children).toHaveLength(4);
    expect(handle.controls.row('a')).not.toBe(rowA);
  });

  it('renders the empty label instead of a blank box', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mountTrackList(
      host,
      {snapshot: () => ({items: []}), select: () => {}},
      {emptyLabel: 'No regions yet'},
    );

    expect(handle.controls.list.children).toHaveLength(1);
    expect(handle.controls.list.textContent).toBe('No regions yet');
    expect(handle.controls.row('a')).toBeUndefined();
  });

  it('honours the ordered and label options', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mountTrackList(host, new FakeTrackList(), {ordered: true, label: 'Regions'});

    expect(handle.controls.list.tagName).toBe('OL');
    expect(handle.controls.list.getAttribute('aria-label')).toBe('Regions');
  });

  it('reports snapshot and command failures through onError', async () => {
    const onError = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const failure = new Error('nope');
    const handle = mountTrackList(
      host,
      {
        snapshot: () => ({items: [{id: 'a', label: 'Intro'}]}),
        select: () => Promise.reject(failure),
      },
      {onError},
    );

    handle.controls.row('a')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('replaces a previous mount on the same host and cleans up on destroy', () => {
    const {host, handle} = mount();
    const second = mountTrackList(host, new FakeTrackList());

    expect(host.querySelectorAll('.wui-track-list')).toHaveLength(1);
    expect(handle.element.isConnected).toBe(false);

    second.destroy();
    expect(host.querySelector('.wui-track-list')).toBeNull();
    expect(host.querySelector('style')).toBeNull();
  });

  it('unsubscribes on destroy', () => {
    const binding = new FakeTrackList();
    const {handle} = mount(binding);
    expect(binding.subscribers.size).toBe(1);

    handle.destroy();
    expect(binding.subscribers.size).toBe(0);
  });

  it('omits the stylesheet when the host provides its own', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountTrackList(host, new FakeTrackList(), {stylesheet: false});

    expect(host.querySelector('style')).toBeNull();
    expect(host.querySelector('.wui-track-list')).not.toBeNull();
  });
});
