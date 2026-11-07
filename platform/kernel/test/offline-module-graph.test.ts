import {describe, expect, it, vi} from 'vitest';
import {createOfflineModuleEnvironment, renderModuleGraph} from '../src/module';

/** A fake OfflineAudioContext whose render runs its suspensions in time order. */
class FakeOffline {
  currentTime = 0;
  readonly destination = {connect: vi.fn(), disconnect: vi.fn()};
  readonly suspensions: Array<{at: number; resolve: () => void}> = [];
  resumed = 0;
  readonly buffer = {length: 0} as unknown as AudioBuffer;
  constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {}
  get state(): AudioContextState { return 'suspended'; }
  resume(): Promise<void> { this.resumed += 1; return Promise.resolve(); }
  suspend(at: number): Promise<void> {
    return new Promise((resolve) => { this.suspensions.push({at, resolve}); });
  }
  async startRendering(): Promise<AudioBuffer> {
    for (const suspension of [...this.suspensions].sort((a, b) => a.at - b.at)) {
      this.currentTime = suspension.at;
      suspension.resolve();
      await Promise.resolve(); await Promise.resolve();
    }
    this.currentTime = this.length / this.sampleRate;
    return this.buffer;
  }
}
Object.defineProperty(FakeOffline.prototype, 'state', {get() { return 'suspended'; }, configurable: true});

describe('offline module environment', () => {
  it('looks live before rendering and ticks its schedulers at each rendered step', async () => {
    let fake!: FakeOffline;
    const offline = createOfflineModuleEnvironment({sampleRate: 512, durationSeconds: 1, tickSeconds: 0.25,
      create: (channels, length, rate) => (fake = new FakeOffline(channels, length, rate)) as unknown as OfflineAudioContext});
    expect(offline.context.state).toBe('running');
    await offline.context.resume();
    expect(fake.resumed).toBe(0);
    const source = offline.environment.createTickSource!(25);
    const times: number[] = [];
    source.start(() => times.push(fake.currentTime));
    expect(source.running).toBe(true);
    expect(await offline.render()).toBe(fake.buffer);
    // One tick at the start, then one per step: 0.25, 0.5, 0.75 s.
    expect(times).toEqual([0, 0.25, 0.5, 0.75]);
    expect(fake.resumed).toBe(3);
    source.dispose();
    expect(source.running).toBe(false);
  });
});

describe('renderModuleGraph', () => {
  it('builds in an offline scope, plays its Session, renders and cleans up', async () => {
    let fake!: FakeOffline;
    const order: string[] = [];
    const cleanup = vi.fn(() => order.push('cleanup'));
    let sessionDisposed: (() => boolean) | undefined;
    const buffer = await renderModuleGraph({
      sampleRate: 1280, durationSeconds: 0.5,
      create: (channels, length, rate) => (fake = new FakeOffline(channels, length, rate)) as unknown as OfflineAudioContext,
      build(scope) {
        expect(scope.audio.prepare()).toBe(fake);
        const session = scope.session!;
        let playing = false;
        session.register({
          play: () => { order.push('play'); playing = true; },
          pause: () => { playing = false; }, stop: () => { order.push('stop'); playing = false; },
          seek: () => {}, get position() { return 0; }, get running() { return playing; },
        }, {axis: 'test-seconds', durationSeconds: 0.5});
        const original = fake.startRendering.bind(fake);
        fake.startRendering = async () => { order.push('render'); return original(); };
        sessionDisposed = () => { try { session.subscribe(() => {}); return false; } catch { return true; } };
        return cleanup;
      },
    });
    expect(buffer).toBe(fake.buffer);
    expect(order.slice(0, 2)).toEqual(['play', 'render']);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(sessionDisposed!()).toBe(true);
  });
});
