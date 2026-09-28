// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  mountPlaylist,
  playlistStyle,
  type PlaylistBinding,
  type PlaylistHandle,
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

/** A binding with inert commands, for tests that override one behaviour. */
function stub(
  snapshot: () => PlaylistState,
  overrides: Partial<PlaylistBinding> = {},
): PlaylistBinding {
  return {
    snapshot,
    toggle: () => {},
    previous: () => {},
    next: () => {},
    seek: () => {},
    select: () => {},
    ...overrides,
  };
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {promise, resolve, reject};
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

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

  it('applies custom labels, compatibility classes and part tokens', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const handle = mountPlaylist(
      host,
      stub(() => ({
        playing: false,
        progress: 0.25,
        items: [
          {id: 'intro', label: 'Intro', duration: '0:30', active: true},
          {id: 'finale', label: '<b>Finale</b>', duration: '1:45'},
        ],
      })),
      {
        label: 'Set list',
        previousLabel: 'Previous movement',
        playLabel: 'Start set',
        pauseLabel: 'Pause set',
        nextLabel: 'Next movement',
        seekLabel: 'Set position',
        classNames: {
          root: 'custom-root',
          button: 'transport-button',
          play: 'custom-play',
          item: 'custom-item',
          label: 'custom-label',
        },
        parts: {
          root: 'playlist-shell',
          button: 'transport-command',
          play: 'toggle-command',
          item: 'track-command',
          label: 'track-title',
        },
      },
    );

    expect(handle.element.classList).toContain('wrap');
    expect(handle.element.classList).toContain('custom-root');
    expect(handle.element.getAttribute('part')).toContain('playlist-shell');
    expect(
      host.querySelector('style[data-webmusic-ui="playlist"]')?.textContent,
    ).toBe(playlistStyle);
    expect(handle.controls.previous.classList).toContain('transport-button');
    expect(handle.controls.previous.getAttribute('aria-label')).toBe('Previous movement');
    expect(handle.controls.toggle.classList).toContain('custom-play');
    expect(handle.controls.toggle.getAttribute('part')).toContain('transport-command');
    expect(handle.controls.toggle.getAttribute('part')).toContain('toggle-command');
    expect(handle.controls.toggle.getAttribute('aria-label')).toBe('Start set');
    expect(handle.controls.toggle.getAttribute('aria-pressed')).toBe('false');
    expect(handle.controls.next.getAttribute('aria-label')).toBe('Next movement');
    expect(handle.controls.seek.getAttribute('aria-label')).toBe('Set position');
    expect(handle.controls.seek.value).toBe('250');
    expect(handle.controls.seek.getAttribute('aria-valuetext')).toBe('25%');
    expect(handle.controls.list.getAttribute('aria-label')).toBe('Set list');

    const finale = handle.controls.item('finale')!;
    expect(finale.tagName).toBe('LI');
    expect(finale.classList).toContain('custom-item');
    expect(finale.getAttribute('part')).toContain('track-command');
    expect(finale.querySelector('.num')!.textContent).toBe('2');
    expect(finale.querySelector('.ttl')!.classList).toContain('custom-label');
    expect(finale.querySelector('.ttl')!.getAttribute('part')).toContain('track-title');
    expect(finale.querySelector('.dur')!.textContent).toBe('1:45');
    // Labels are arbitrary text, never markup.
    expect(host.querySelector('b')).toBeNull();
    expect(finale.textContent).toContain('<b>Finale</b>');
  });

  it('clamps a progress value outside 0..1', () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);

    binding.state = {...binding.state, progress: 2};
    binding.notify();

    expect(handle.controls.seek.value).toBe('1000');
    expect(handle.controls.seek.getAttribute('aria-valuetext')).toBe('100%');
  });

  it('refuses commands while the binding reports disabled', () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);

    binding.state = {...binding.state, disabled: true};
    binding.notify();

    handle.controls.toggle.click();
    handle.controls.item('b')!.click();
    handle.controls.seek.dispatchEvent(new Event('input'));

    expect(binding.toggle).not.toHaveBeenCalled();
    expect(binding.select).not.toHaveBeenCalled();
    expect(binding.seek).not.toHaveBeenCalled();
  });

  it('restores row focus across a rebuild', () => {
    const binding = new FakePlaylist();
    const {handle} = mount(binding);
    const rowB = handle.controls.item('b')!;
    rowB.focus();
    expect(document.activeElement).toBe(rowB);

    binding.state = {
      ...binding.state,
      items: [...binding.state.items, {id: 'd', label: 'Encore'}],
    };
    binding.notify();

    const rebuilt = handle.controls.item('b')!;
    expect(rebuilt).not.toBe(rowB);
    expect(document.activeElement).toBe(rebuilt);
  });

  it('reports subscribe, snapshot, synchronous and asynchronous failures', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const subscribeFailure = new Error('subscribe failed');
    const snapshotFailure = new Error('snapshot failed');
    const syncFailure = new Error('next failed');
    const asyncFailure = new Error('select failed');
    const reported: unknown[] = [];
    let snapshot = (): PlaylistState => ({
      playing: false,
      progress: 0,
      items: [{id: 'a', label: 'Intro'}],
    });
    const handle = mountPlaylist(
      host,
      stub(() => snapshot(), {
        next: () => {
          throw syncFailure;
        },
        select: () => Promise.reject(asyncFailure),
        subscribe: () => {
          throw subscribeFailure;
        },
      }),
      {
        onError: (error) => {
          reported.push(error);
          throw new Error('reporter failed');
        },
      },
    );

    expect(reported).toEqual([subscribeFailure]);

    expect(() => handle.controls.next.click()).not.toThrow();
    expect(reported).toEqual([subscribeFailure, syncFailure]);

    handle.controls.item('a')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(reported).toEqual([subscribeFailure, syncFailure, asyncFailure]);

    const rowA = handle.controls.item('a')!;
    snapshot = () => {
      throw snapshotFailure;
    };
    handle.update();

    expect(reported).toEqual([
      subscribeFailure,
      syncFailure,
      asyncFailure,
      snapshotFailure,
    ]);
    expect(handle.controls.item('a')).toBe(rowA);
  });

  it('reports a subscribe that does not return a function', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onError = vi.fn();
    mountPlaylist(
      host,
      stub(() => ({playing: false, progress: 0, items: []}), {
        subscribe: (() => 'nope') as unknown as PlaylistBinding['subscribe'],
      }),
      {onError},
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(TypeError);
  });

  it('rejects a blank entry id without replacing the last good rows', () => {
    const binding = new FakePlaylist();
    const host = document.createElement('div');
    document.body.append(host);
    const onError = vi.fn();
    const handle = mountPlaylist(host, binding, {onError});
    const rowA = handle.controls.item('a')!;

    binding.state = {...binding.state, items: [{id: ' ', label: 'Blank'}]};
    handle.update();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(TypeError);
    expect(handle.controls.item('a')).toBe(rowA);
    expect(handle.controls.list.children).toHaveLength(3);
  });

  it('reconciles out-of-order commands and reports only the latest failure', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const first = deferred();
    const second = deferred();
    const staleFailure = new Error('stale selection failed');
    const onError = vi.fn();
    let state: PlaylistState = {
      playing: false,
      progress: 0,
      items: [
        {id: 'first', label: 'First'},
        {id: 'second', label: 'Second'},
      ],
    };
    const handle = mountPlaylist(
      host,
      stub(() => state, {
        select: (id) => {
          const pending = id === 'first' ? first : second;
          return pending.promise.then(() => {
            state = {
              ...state,
              items: state.items.map((entry) => ({...entry, active: entry.id === id})),
            };
            if (id === 'first') throw staleFailure;
          });
        },
      }),
      {onError},
    );

    handle.controls.item('first')!.click();
    handle.controls.item('second')!.click();
    second.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.controls.item('second')!.getAttribute('aria-current')).toBe('true');

    first.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.controls.item('first')!.getAttribute('aria-current')).toBe('true');
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps stale controls and command settlements inert after replacement', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const pending = deferred();
    const firstError = vi.fn();
    const toggled = vi.fn();
    const firstHandle = mountPlaylist(
      host,
      stub(() => ({playing: false, progress: 0, items: [{id: 'a', label: 'Intro'}]}), {
        toggle: toggled,
        select: () => pending.promise,
      }),
      {onError: firstError},
    );
    const staleToggle = firstHandle.controls.toggle;
    const staleItem = firstHandle.controls.item('a')!;
    staleItem.click();

    const second = mountPlaylist(
      host,
      stub(() => ({
        playing: false,
        progress: 0,
        items: [{id: 'z', label: 'Replacement', active: true}],
      })),
    );
    staleToggle.click();
    staleItem.click();
    pending.reject(new Error('stale rejection'));
    await Promise.resolve();
    await Promise.resolve();

    expect(toggled).not.toHaveBeenCalled();
    expect(firstError).not.toHaveBeenCalled();
    expect(firstHandle.element.isConnected).toBe(false);
    expect(host.querySelectorAll('.wui-playlist')).toHaveLength(1);
    expect(host.querySelector('.wui-playlist')).toBe(second.element);
    expect(second.controls.item('z')!.textContent).toContain('Replacement');
  });

  it('preserves caller DOM and finishes a best-effort destroy', () => {
    const host = document.createElement('div');
    const unrelated = document.createElement('p');
    host.append(unrelated);
    document.body.append(host);
    const cleanupFailure = new Error('unsubscribe failed');
    const toggled = vi.fn();
    const onError = vi.fn();
    const handle = mountPlaylist(
      host,
      stub(() => ({playing: false, progress: 0, items: []}), {
        toggle: toggled,
        subscribe: () => () => {
          throw cleanupFailure;
        },
      }),
      {onError},
    );
    const staleToggle = handle.controls.toggle;

    handle.destroy();
    handle.destroy();
    staleToggle.click();

    expect(toggled).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(cleanupFailure);
    expect(host.childElementCount).toBe(1);
    expect(host.firstElementChild).toBe(unrelated);
  });

  it('reports a cleanup that throws undefined and still removes the mount', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const onError = vi.fn();
    const handle = mountPlaylist(
      host,
      stub(() => ({playing: false, progress: 0, items: []}), {
        subscribe: () => () => {
          // A falsy throw is still a failure: the report must not test truth.
          throw undefined;
        },
      }),
      {onError},
    );

    handle.destroy();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(undefined);
    expect(host.childElementCount).toBe(0);
  });

  it('leaves an attempted mount inert when its first snapshot remounts the host', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const subscribe = vi.fn(() => () => {});
    let replacement: PlaylistHandle | undefined;
    const attempted = mountPlaylist(
      host,
      stub(
        () => {
          replacement ??= mountPlaylist(
            host,
            stub(() => ({
              playing: false,
              progress: 0,
              items: [{id: 'winner', label: 'Winner', active: true}],
            })),
          );
          return {playing: false, progress: 0, items: []};
        },
        {subscribe},
      ),
    );

    expect(replacement).toBeDefined();
    expect(subscribe).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.wui-playlist')).toHaveLength(1);
    expect(host.querySelector('.wui-playlist')).toBe(replacement!.element);
    expect(replacement!.controls.item('winner')!.textContent).toContain('Winner');

    attempted.destroy();
    expect(host.querySelector('.wui-playlist')).toBe(replacement!.element);
  });

  it('keeps a reentrant cleanup replacement as the only host owner', () => {
    const host = document.createElement('div');
    document.body.append(host);
    let replacement: PlaylistHandle | undefined;
    mountPlaylist(
      host,
      stub(() => ({playing: false, progress: 0, items: []}), {
        subscribe: () => () => {
          throw new Error('first cleanup failed');
        },
      }),
      {
        onError: () => {
          replacement ??= mountPlaylist(
            host,
            stub(() => ({
              playing: false,
              progress: 0,
              items: [{id: 'nested', label: 'Nested', active: true}],
            })),
          );
        },
      },
    );
    const subscribe = vi.fn(() => () => {});
    const attempted = mountPlaylist(
      host,
      stub(() => ({playing: false, progress: 0, items: []}), {subscribe}),
    );

    expect(replacement).toBeDefined();
    expect(subscribe).not.toHaveBeenCalled();
    expect(host.querySelectorAll('.wui-playlist')).toHaveLength(1);
    expect(host.querySelector('.wui-playlist')).toBe(replacement!.element);

    attempted.destroy();
    expect(host.querySelector('.wui-playlist')).toBe(replacement!.element);
  });

  it('rolls back a partial host append failure', () => {
    const host = document.createElement('div');
    const unrelated = document.createElement('p');
    host.append(unrelated);
    document.body.append(host);
    const failure = new Error('append failed');
    const originalAppend = host.append.bind(host);
    const append = vi.spyOn(host, 'append').mockImplementation((...nodes) => {
      originalAppend(nodes[0]!);
      throw failure;
    });
    const subscribe = vi.fn(() => () => {});

    expect(() =>
      mountPlaylist(
        host,
        stub(() => ({playing: false, progress: 0, items: []}), {subscribe}),
      ),
    ).toThrow(failure);
    expect(subscribe).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(1);
    expect(host.firstElementChild).toBe(unrelated);
    expect(host.querySelector('.wui-playlist')).toBeNull();
    expect(host.querySelector('style[data-webmusic-ui="playlist"]')).toBeNull();

    append.mockRestore();
    const recovery = mountPlaylist(host, new FakePlaylist());
    expect(host.querySelector('.wui-playlist')).toBe(recovery.element);
  });
});


describe('playlist selection companion', () => {
  it('omits the transport bar while retaining keyboard-accessible selection', () => {
    const host = document.createElement('div');
    const binding = new FakePlaylist();
    const handle = mountPlaylist(host, binding, {transport: false});
    expect(host.querySelector('.wui-playlist__bar')).toBeNull();
    const row = handle.controls.item('b')!;
    row.click();
    expect(binding.select).toHaveBeenCalledWith('b');
    expect(binding.toggle).not.toHaveBeenCalled();
    handle.destroy();
    expect(binding.subscribers.size).toBe(0);
  });
});
