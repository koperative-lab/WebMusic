// @vitest-environment jsdom

import {describe, expect, it, vi} from 'vitest';
import {
  mountPlaylist,
  playlistStyle,
  type PlaylistBinding,
  type PlaylistState,
} from '../src/playlist';

class FakePlaylist implements PlaylistBinding {
  state: PlaylistState = {
    playing: false,
    progress: 0,
    items: [
      {id: 'a', label: 'Intro', duration: '0:30', active: true},
      {id: 'b', label: 'Verse', duration: '1:10'},
      {id: 'c', label: 'Outro', duration: '0:45'},
    ],
  };

  readonly subscribers = new Set<() => void>();
  readonly toggle = vi.fn(() => {
    this.state = {...this.state, playing: !this.state.playing};
  });
  readonly previous = vi.fn();
  readonly next = vi.fn();
  readonly seek = vi.fn((value: number) => {
    this.state = {...this.state, progress: value};
  });
  readonly select = vi.fn((id: string) => {
    this.state = {
      ...this.state,
      items: this.state.items.map((item) => ({...item, active: item.id === id})),
    };
  });

  snapshot(): PlaylistState {
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

function mount(binding: PlaylistBinding = new FakePlaylist()) {
  const host = document.createElement('div');
  document.body.append(host);
  const handle = mountPlaylist(host, binding);
  return {host, handle, binding};
}

describe('mountPlaylist', () => {
  it('renders the transport bar and one row per entry', () => {
    const {handle} = mount();

    expect(handle.controls.list.children).toHaveLength(3);
    expect(handle.controls.item('b')!.textContent).toContain('Verse');
    expect(handle.controls.item('b')!.textContent).toContain('1:10');
    expect(handle.controls.item('a')!.getAttribute('aria-current')).toBe('true');
    expect(handle.element.querySelector('style')).toBeNull();
    expect(playlistStyle).toContain('.wui-playlist__item');
  });

  it('routes every control through the binding', async () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);

    handle.controls.toggle.click();
    handle.controls.previous.click();
    handle.controls.next.click();
    handle.controls.item('c')!.click();
    handle.controls.seek.value = '500';
    handle.controls.seek.dispatchEvent(new Event('input'));
    await Promise.resolve();

    expect(binding.toggle).toHaveBeenCalledTimes(1);
    expect(binding.previous).toHaveBeenCalledTimes(1);
    expect(binding.next).toHaveBeenCalledTimes(1);
    expect(binding.select).toHaveBeenCalledWith('c');
    // The range is 0..1000 in the DOM and a 0..1 fraction in the contract.
    expect(binding.seek).toHaveBeenCalledWith(0.5);
  });

  it('selects an entry from the keyboard', () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);

    handle.controls.item('b')!.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}),
    );
    expect(binding.select).toHaveBeenCalledWith('b');
  });

  it('keeps the row nodes across a progress-only update', () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);
    const before = [...handle.controls.list.children];

    binding.state = {...binding.state, progress: 0.4, playing: true};
    binding.notify();

    // A transport tick must not rebuild focusable rows: a keyboard user mid
    // list would lose focus 20 times a second.
    expect([...handle.controls.list.children]).toEqual(before);
    expect(handle.controls.seek.value).toBe('400');
    expect(handle.controls.toggle.getAttribute('aria-label')).toBe('Pause');
  });

  it('moves the current marker in place when the track changes', () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);
    const rowB = handle.controls.item('b')!;

    binding.select('b');
    binding.notify();

    expect(handle.controls.item('b')).toBe(rowB);
    expect(rowB.getAttribute('aria-current')).toBe('true');
    expect(handle.controls.item('a')!.getAttribute('aria-current')).toBe('false');
  });

  it('rebuilds only when the entries themselves change', () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);
    const rowA = handle.controls.item('a')!;

    binding.state = {
      ...binding.state,
      items: [...binding.state.items, {id: 'd', label: 'Encore'}],
    };
    binding.notify();

    expect(handle.controls.list.children).toHaveLength(4);
    expect(handle.controls.item('a')).not.toBe(rowA);
  });

  it('reflects per-entry loading and error state', () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);

    binding.state = {
      ...binding.state,
      items: binding.state.items.map((item) =>
        item.id === 'b' ? {...item, status: 'error' as const} : {...item, status: undefined},
      ),
    };
    binding.notify();

    expect(handle.controls.item('b')!.dataset.status).toBe('error');
    expect(handle.controls.item('a')!.dataset.status).toBeUndefined();
  });

  it('disables every control when the binding reports disabled', () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);

    binding.state = {...binding.state, disabled: true};
    binding.notify();

    expect(handle.controls.toggle.disabled).toBe(true);
    expect(handle.controls.seek.disabled).toBe(true);
  });

  it('reports snapshot and command failures through onError', async () => {
    const onError = vi.fn();
    const host = document.createElement('div');
    document.body.append(host);
    const failure = new Error('nope');
    const handle = mountPlaylist(
      host,
      {
        snapshot: () => ({playing: false, progress: 0, items: []}),
        toggle: () => Promise.reject(failure),
        previous: () => {},
        next: () => {},
        seek: () => {},
        select: () => {},
      },
      {onError},
    );

    handle.controls.toggle.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('replaces a previous mount on the same host and cleans up on destroy', () => {
    const {host, handle} = mount();
    const second = mountPlaylist(host, new FakePlaylist());

    expect(host.querySelectorAll('.wui-playlist')).toHaveLength(1);
    expect(handle.element.isConnected).toBe(false);

    second.destroy();
    expect(host.querySelector('.wui-playlist')).toBeNull();
    expect(host.querySelector('style')).toBeNull();
  });

  it('unsubscribes on destroy', () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);
    expect(binding.subscribers.size).toBe(1);

    handle.destroy();
    expect(binding.subscribers.size).toBe(0);
  });

  it('omits the stylesheet when the host provides its own', () => {
    const host = document.createElement('div');
    document.body.append(host);
    mountPlaylist(host, new FakePlaylist(), {stylesheet: false});

    expect(host.querySelector('style')).toBeNull();
    expect(host.querySelector('.wui-playlist')).not.toBeNull();
  });
});
