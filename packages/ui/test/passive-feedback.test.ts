// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountMeter} from '../src/meter';
import {mountMixer, type MixerState} from '../src/mixer';
import {mountPlaylist, type PlaylistState} from '../src/playlist';
import {mountRecorder, type RecorderState} from '../src/recorder';
import type {StatusState} from '../src/status';

afterEach(() => document.body.replaceChildren());

describe('shared passive feedback', () => {
  it('distinguishes missing meter input from a valid silent source and restores errors', () => {
    const host = document.createElement('div');
    let state: StatusState = {kind: 'waiting', message: 'Waiting for input'};
    const readLevel = vi.fn(() => ({level: 0}));
    const handle = mountMeter(host, {
      readStatus: () => state, readLevel, readSpectrum: () => [],
    }, {animate: false});
    expect(host.querySelector('[data-kind="waiting"] [part="indicator"]')).not.toBeNull();
    expect(readLevel).not.toHaveBeenCalled();
    expect(handle.element.hasAttribute('aria-valuenow')).toBe(false);
    state = {kind: 'loading'};
    handle.redraw();
    expect(handle.element.getAttribute('aria-busy')).toBe('true');
    state = {kind: 'ready'};
    handle.redraw();
    expect(handle.element.getAttribute('aria-valuenow')).toBe('0');
    expect(host.querySelector<HTMLElement>('.wui-meter__track')!.hidden).toBe(false);
    state = {kind: 'error', message: 'Graph disconnected'};
    handle.redraw();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Graph disconnected');
    handle.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('keeps a meter mounted from the initial read error callback as the current owner', () => {
    const host = document.createElement('div');
    const replacementBinding = {readLevel: () => ({level: 0.5}), readSpectrum: () => []};
    const stale = mountMeter(host, {
      readLevel: () => { throw new Error('Unavailable graph'); }, readSpectrum: () => [],
    }, {
      animate: false,
      onError: () => { mountMeter(host, replacementBinding, {animate: false}); },
    });
    expect(host.querySelectorAll('.wui-meter')).toHaveLength(1);
    expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('50');
    stale.destroy();
    expect(host.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('50');
  });

  it('replaces recorder preparation and waiting text while preserving ready actions and take details', () => {
    const host = document.createElement('div');
    let state: RecorderState = {recording: false, busy: true, status: 'Opening microphone'};
    const handle = mountRecorder(host, {snapshot: () => state, toggleRecording: vi.fn()});
    expect(host.querySelector('[data-kind="loading"]')?.textContent).toBe('Opening microphone');
    expect(host.querySelector<HTMLButtonElement>('[part="record"]')!.disabled).toBe(true);
    state = {recording: false, statusKind: 'waiting', status: 'Waiting for owner'};
    handle.update();
    expect(host.querySelector('[data-kind="waiting"]')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[part="record"]')!.disabled).toBe(false);
    state = {recording: false, status: 'take 1: 0:03', canPlay: true};
    handle.update();
    expect(host.querySelector('[part="status"]')?.textContent).toBe('take 1: 0:03');
    expect(host.querySelector<HTMLElement>('.wui-status')!.hidden).toBe(true);
    handle.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('retains focused playlist rows while loading resolves or fails and disposes old row feedback', () => {
    const host = document.createElement('div');
    document.body.append(host);
    let state: PlaylistState = {playing: false, progress: 0, items: []};
    const handle = mountPlaylist(host, {
      snapshot: () => state, toggle: vi.fn(), previous: vi.fn(), next: vi.fn(), seek: vi.fn(), select: vi.fn(),
    });
    expect(host.querySelector('[data-kind="waiting"]')).not.toBeNull();
    state = {...state, items: [{id: 'one', label: 'One', active: true, status: 'loading'}]};
    handle.update();
    const row = handle.controls.item('one')!;
    row.focus();
    expect(row.querySelector('[data-kind="loading"]')).not.toBeNull();
    expect(handle.element.getAttribute('aria-busy')).toBe('true');
    state = {...state, items: [{id: 'one', label: 'One', active: true, status: 'error'}]};
    handle.update();
    expect(handle.controls.item('one')).toBe(row);
    expect(document.activeElement).toBe(row);
    expect(row.querySelector('[role="alert"]')?.textContent).toBe('Unable to load');
    state = {...state, items: [{id: 'one', label: 'One', active: true, duration: '0:03'}]};
    handle.update();
    expect(row.querySelector<HTMLElement>('.wui-playlist__duration')!.hidden).toBe(false);
    expect(handle.element.getAttribute('aria-busy')).toBe('false');
    state = {...state, items: []};
    handle.update();
    expect(host.querySelectorAll('.wui-status')).toHaveLength(1);
    handle.destroy();
    expect(host.childElementCount).toBe(0);
  });

  it('waits for mixer channels without suppressing usable strips during another load', () => {
    const host = document.createElement('div');
    let state: MixerState = {master: 1, channels: [], status: {kind: 'waiting'}};
    const handle = mountMixer(host, {snapshot: () => state, setMaster: vi.fn(), setChannel: vi.fn()});
    const board = host.querySelector<HTMLElement>('.wui-mixer__board')!;
    expect(board.hidden).toBe(true);
    state = {...state, channels: [{id: 'one', label: 'One', value: 0.5}], status: {kind: 'loading'}};
    handle.update();
    expect(board.hidden).toBe(false);
    expect(host.querySelector('[aria-label="One volume"]')).not.toBeNull();
    state = {...state, status: {kind: 'ready'}};
    handle.update();
    expect(host.querySelector<HTMLElement>('.wui-mixer__status')!.hidden).toBe(true);
    handle.destroy();
    expect(host.childElementCount).toBe(0);
  });
});
