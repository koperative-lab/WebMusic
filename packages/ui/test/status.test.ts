// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountStatus, statusStyle, type StatusState} from '../src/status';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('mountStatus', () => {
  it('paints loading, error and ready states with accessible semantics', () => {
    const host = document.createElement('div');
    let state: StatusState = {kind: 'loading'};
    let notify: (() => void) | undefined;
    const handle = mountStatus(
      host,
      {
        snapshot: () => state,
        subscribe: (next) => {
          notify = next;
          return () => {
            notify = undefined;
          };
        },
      },
      {
        classNames: {root: 'legacy-status', message: 'legacy-message'},
        parts: {root: 'status-shell', message: 'status-copy'},
      },
    );

    expect(handle.element.hidden).toBe(false);
    expect(handle.element.dataset.kind).toBe('loading');
    expect(handle.element.getAttribute('role')).toBe('status');
    expect(handle.element.getAttribute('aria-live')).toBe('polite');
    expect(handle.element.getAttribute('aria-busy')).toBe('true');
    expect(handle.message.textContent).toBe('Loading…');
    expect(handle.element.classList.contains('legacy-status')).toBe(true);
    expect(handle.element.getAttribute('part')).toContain('status-shell');
    expect(handle.message.getAttribute('part')).toContain('status-copy');

    state = {kind: 'error', message: 'Could not decode'};
    notify?.();
    expect(handle.element.getAttribute('role')).toBe('alert');
    expect(handle.element.getAttribute('aria-live')).toBe('assertive');
    expect(handle.element.hasAttribute('aria-busy')).toBe(false);
    expect(handle.message.textContent).toBe('Could not decode');

    state = {kind: 'ready'};
    notify?.();
    expect(handle.element.hidden).toBe(true);
    expect(handle.element.hasAttribute('role')).toBe(false);
    expect(handle.message.textContent).toBe('');

    handle.destroy();
    expect(notify).toBeUndefined();
    expect(host.childElementCount).toBe(0);
  });

  it('preserves caller DOM, replaces a previous mount and routes failures', () => {
    const host = document.createElement('div');
    const callerNode = document.createElement('p');
    host.append(callerNode);
    const firstCleanup = vi.fn();
    mountStatus(host, {
      snapshot: () => ({kind: 'empty'}),
      subscribe: () => firstCleanup,
    });
    const failure = new Error('snapshot failed');
    const onError = vi.fn();
    const second = mountStatus(
      host,
      {snapshot: () => {
        throw failure;
      }},
      {onError},
    );

    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(host.firstElementChild).toBe(callerNode);
    expect(host.querySelectorAll('.wui-status')).toHaveLength(1);

    second.destroy();
    expect(host.firstElementChild).toBe(callerNode);
    expect(host.querySelector('.wui-status')).toBeNull();
  });

  it('exports the canonical status style', () => {
    expect(statusStyle).toContain('.wui-status');
    expect(statusStyle).toContain('[data-kind="error"]');
  });
});

describe('mountStatus host ownership', () => {
  it('lets a replacement mounted from the previous cleanup win the host', () => {
    const host = document.createElement('div');
    const first = mountStatus(host, {snapshot: () => ({kind: 'ready'})});
    let replacement: ReturnType<typeof mountStatus> | undefined;

    // The previous surface's teardown mounts a new one — application code is
    // allowed to do this, and it used to leave two roots in the host.
    const originalDestroy = first.destroy;
    first.destroy = () => {
      originalDestroy();
      replacement = mountStatus(host, {snapshot: () => ({kind: 'error', message: 'replaced'})});
    };

    const superseded = mountStatus(host, {snapshot: () => ({kind: 'loading'})});

    expect(host.querySelectorAll('.wui-status')).toHaveLength(1);
    expect(host.querySelector('.wui-status')).toBe(replacement?.element);
    // The superseded mount never appended, and its handle is inert.
    expect(superseded.element.isConnected).toBe(false);

    replacement?.destroy();
  });
});

describe('empty states announce', () => {
  it('marks every presenter empty state as a live region', async () => {
    const {mountParameterRack} = await import('../src/parameter');
    const {mountTrackList} = await import('../src/track-list');
    const {mountEq} = await import('../src/eq');

    const rackHost = document.createElement('div');
    mountParameterRack(rackHost, {snapshot: () => ({parameters: []}), setValue: vi.fn()});
    const rackEmpty = rackHost.querySelector('.wui-parameter-rack__empty')!;
    expect(rackEmpty.getAttribute('role')).toBe('status');
    expect(rackEmpty.getAttribute('aria-live')).toBe('polite');

    const listHost = document.createElement('div');
    mountTrackList(listHost, {snapshot: () => ({items: []}), select: vi.fn()});
    const listEmpty = listHost.querySelector('.wui-track-list__empty')!;
    expect(listEmpty.getAttribute('role')).toBe('status');

    const eqHost = document.createElement('div');
    mountEq(eqHost, {snapshot: () => ({bands: [], ready: false}), setBand: vi.fn()});
    const eqEmpty = eqHost.querySelector('.wui-eq__empty')!;
    expect(eqEmpty.getAttribute('role')).toBe('status');
    expect(eqEmpty.getAttribute('aria-live')).toBe('polite');
  });
});
