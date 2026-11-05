// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, type AudioClip} from '@webmusic/audio';
import {mountDemos} from '../src/components/demo-lifecycle';
import type {mountIndependentLoops as mountIndependentLoopsFn} from '../src/components/bridges/independent-loops-client';

const boundaries = vi.hoisted(() => ({players: vi.fn(), groups: vi.fn(), loadClip: vi.fn()}));
vi.mock('@webmusic/audio/play', () => ({loadClipFromUrl: boundaries.loadClip}));
vi.mock('@webmusic/audio/play/headless', () => ({AudioClipPlayer: class {
  constructor(...args: unknown[]) { return boundaries.players(...args); }
}}));
vi.mock('@webmusic/kernel/sync', () => ({TransportGroup: class {
  constructor(...args: unknown[]) { return boundaries.groups(...args); }
}}));

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return {promise, resolve};
}
/** Small deterministic PCM fixture; production demos keep using Arabesque. */
function recordingClip(): AudioClip {
  return createAudioClip({
    sampleRate: 8,
    channelData: [Float32Array.from({length: 32}, (_, index) => index / 32),
      Float32Array.from({length: 32}, (_, index) => -index / 32)],
    metadata: {title: 'Test recording'},
  });
}
const follower = () => ({play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seek: vi.fn(),
  setRate: vi.fn(), dispose: vi.fn(), seconds: 0, playing: false});
let mountIndependentLoops: typeof mountIndependentLoopsFn;
let stop: (() => void) | undefined;
let resume: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
function mount() {
  document.body.innerHTML = `<section data-loop-test>
    <button data-start></button><button data-pause></button><button data-seek></button><button data-dispose></button>
    <select data-rate><option value="1">1</option><option value="2">2</option></select>
    <output data-status></output><output data-timeline></output><progress></progress><progress></progress>
  </section>`;
  stop = mountDemos('[data-loop-test]', mountIndependentLoops);
  return document.querySelector<HTMLElement>('[data-loop-test]')!;
}

beforeEach(async () => {
  // The shared excerpt cache is module state; every case starts without it.
  vi.resetModules();
  ({mountIndependentLoops} = await import('../src/components/bridges/independent-loops-client'));
  boundaries.players.mockReset(); boundaries.groups.mockReset();
  boundaries.loadClip.mockReset().mockImplementation(async () => recordingClip());
  resume = vi.fn(async () => {}); close = vi.fn(async () => {});
  vi.stubGlobal('AudioContext', class {
    state = 'running'; currentTime = 0; sampleRate = 44100;
    resume = resume; close = close;
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(async () => {
  stop?.(); stop = undefined;
  document.body.replaceChildren();
  await flush(); vi.unstubAllGlobals();
});

describe('independent loop composition lifecycle', () => {
  it('caches only independently owned excerpt buffers, without retaining the full recording PCM', async () => {
    const recording = recordingClip();
    boundaries.loadClip.mockResolvedValue(recording);
    const {loadArabesqueAudioExcerpt} = await import('../src/components/headless/arabesque-audio');
    const excerpt = await loadArabesqueAudioExcerpt(1.5);
    expect(excerpt.length).toBe(12);
    expect(excerpt.duration).toBe(1.5);
    expect(excerpt.numberOfChannels).toBe(2);
    expect(excerpt.metadata).toEqual(recording.metadata);
    // Public channel access defensively copies, hiding retained parent buffers.
    // Inspect actual storage so a zero-copy slice cannot satisfy this regression.
    const originalChannels = Reflect.get(recording, '_channels') as readonly Float32Array[];
    const excerptChannels = Reflect.get(excerpt, '_channels') as readonly Float32Array[];
    for (let channel = 0; channel < excerpt.numberOfChannels; channel++) {
      expect(excerptChannels[channel].buffer).not.toBe(originalChannels[channel].buffer);
      expect(excerptChannels[channel].byteOffset).toBe(0);
      expect(excerptChannels[channel].buffer.byteLength).toBe(12 * Float32Array.BYTES_PER_ELEMENT);
      expect(excerptChannels[channel]).toEqual(originalChannels[channel].slice(0, 12));
    }
    expect(await loadArabesqueAudioExcerpt(1.5)).toBe(excerpt);
    expect(boundaries.loadClip).toHaveBeenCalledOnce();
  });

  it('ignores a shared excerpt that settles after disposal and reuses it for the next session', async () => {
    const pending = deferred<AudioClip>();
    boundaries.loadClip.mockReturnValue(pending.promise);
    const root = mount();
    root.querySelector<HTMLButtonElement>('[data-start]')!.click(); await flush();
    expect(boundaries.loadClip).toHaveBeenCalledOnce();
    expect(boundaries.loadClip.mock.calls[0][0]).toMatch(/wav\/Arabesque%20No\.1\.wav$/);
    root.querySelector<HTMLButtonElement>('[data-dispose]')!.click();
    const recording = recordingClip();
    pending.resolve(recording); await flush();
    expect(boundaries.players).not.toHaveBeenCalled();
    expect(boundaries.groups).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    boundaries.players.mockImplementation(follower);
    boundaries.groups.mockReturnValue({addFollower: vi.fn(), subscribe: vi.fn(() => vi.fn()), dispose: vi.fn(),
      dispatch: vi.fn(async () => ({status: 'committed', snapshot: {position: 0}}))});
    root.querySelector<HTMLButtonElement>('[data-start]')!.click(); await flush();
    expect(boundaries.loadClip).toHaveBeenCalledOnce();
    expect(boundaries.players).toHaveBeenCalledTimes(2);
    expect(boundaries.players.mock.calls.map((call) => call[0])).toMatchObject([
      {length: 8, duration: 1}, {length: 12, duration: 1.5},
    ]);
  });

  it('forgets a failed excerpt load so the next session can retry it', async () => {
    boundaries.loadClip.mockRejectedValueOnce(new Error('offline'));
    const root = mount();
    root.querySelector<HTMLButtonElement>('[data-start]')!.click(); await flush();
    expect(root.querySelector('[data-status]')!.textContent).toBe('offline');
    expect(close).toHaveBeenCalledOnce();
    boundaries.players.mockImplementation(follower);
    boundaries.groups.mockReturnValue({addFollower: vi.fn(), subscribe: vi.fn(() => vi.fn()), dispose: vi.fn(),
      dispatch: vi.fn(async () => ({status: 'committed', snapshot: {position: 0}}))});
    root.querySelector<HTMLButtonElement>('[data-start]')!.click(); await flush();
    expect(boundaries.loadClip).toHaveBeenCalledTimes(2);
    expect(boundaries.players).toHaveBeenCalledTimes(2);
  });

  it('releases an already registered follower and the context when the next follower fails', async () => {
    const first = follower();
    boundaries.players.mockReturnValueOnce(first).mockImplementationOnce(() => {
      throw new Error('second follower failed');
    });
    const members: Array<{dispose(): void}> = [];
    const group = {
      addFollower: vi.fn((member) => { members.push(member); }),
      dispose: vi.fn(() => { for (const member of members) member.dispose(); }),
    };
    boundaries.groups.mockReturnValue(group);
    const root = mount();
    root.querySelector<HTMLButtonElement>('[data-start]')!.click(); await flush();
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(group.dispose).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(root.querySelector('[data-status]')!.textContent).toBe('second follower failed');
    expect(root.querySelector<HTMLButtonElement>('[data-start]')!.disabled).toBe(false);
  });

  it('can dispose a pending audio resume without installing followers afterward', async () => {
    const pending = deferred(); resume.mockReturnValue(pending.promise);
    const root = mount();
    root.querySelector<HTMLButtonElement>('[data-start]')!.click();
    const dispose = root.querySelector<HTMLButtonElement>('[data-dispose]')!;
    expect(dispose.disabled).toBe(false);
    dispose.click(); pending.resolve(); await flush();
    expect(close).toHaveBeenCalledOnce();
    expect(boundaries.players).not.toHaveBeenCalled();
    expect(boundaries.groups).not.toHaveBeenCalled();
  });

  it('configures native loops and matching group metadata without looping the master', async () => {
    boundaries.players.mockImplementation(follower);
    const group = {addFollower: vi.fn(), subscribe: vi.fn(() => vi.fn()), dispose: vi.fn(),
      dispatch: vi.fn(async () => ({status: 'committed', snapshot: {position: 0}}))};
    boundaries.groups.mockReturnValue(group);
    const root = mount();
    root.querySelector<HTMLButtonElement>('[data-start]')!.click(); await flush();
    expect(boundaries.players).toHaveBeenCalledTimes(2);
    expect(boundaries.players.mock.calls[0][1]).toMatchObject({loop: {start: 0, end: 1}, engine: 'buffer'});
    expect(boundaries.players.mock.calls[1][1]).toMatchObject({loop: {start: 0, end: 1.5}, engine: 'buffer'});
    expect(group.addFollower.mock.calls.map((call) => call[1])).toEqual([
      {loop: {startSeconds: 0, endSeconds: 1}}, {loop: {startSeconds: 0, endSeconds: 1.5}},
    ]);
    expect(boundaries.groups.mock.calls[0][2]).not.toHaveProperty('loop');
    root.querySelector<HTMLButtonElement>('[data-seek]')!.click(); await flush();
    expect(group.dispatch).toHaveBeenLastCalledWith({type: 'seek', position: 4.25});
    root.remove(); await flush();
    expect(group.dispose).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
