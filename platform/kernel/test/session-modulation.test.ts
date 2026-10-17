import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {SessionTransport, SessionLFO, attachSessionAutomation, type SessionSchedulingBinding} from '../src/session';
import {ParamHandle} from '../src/module/parameter';
import {createConnectionLease} from '../src/module/lease';

class Parameter {
  value = 0;
  readonly minValue = -3.4e38;
  readonly maxValue = 3.4e38;
  automationRate: AutomationRate = 'a-rate';
  events: Array<[string, number, number?]> = [];
  cancelScheduledValues(time: number) { this.events.push(['cancel', time]); }
  setValueAtTime(value: number, time: number) { this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value: number, time: number) { this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value: number, time: number) { this.events.push(['exponential', value, time]); }
}
class Node {
  offset = new Parameter(); gain = new Parameter(); playbackRate = new Parameter();
  readonly edges = new Set<unknown>();
  buffer: AudioBuffer | null = null;
  loop = false; loopStart = 0; loopEnd = 0;
  onended: (() => void) | null = null;
  starts: Array<[number | undefined, number | undefined]> = [];
  stops: Array<number | undefined> = [];
  constructor(readonly context: Context) {}
  connect(target: unknown) { this.edges.add(target); }
  disconnect() { this.edges.clear(); }
  start(time?: number, offset?: number) { this.starts.push([time, offset]); }
  stop(time?: number) { this.stops.push(time); }
}
class Context {
  currentTime = 0;
  sampleRate = 48000;
  constants: Node[] = [];
  buffers: Node[] = [];
  createGain() { return new Node(this); }
  createConstantSource() { const node = new Node(this); this.constants.push(node); return node; }
  createBufferSource() { const node = new Node(this); this.buffers.push(node); return node; }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return {duration: length / sampleRate, getChannelData: () => data} as unknown as AudioBuffer;
  }
  get native() { return this as unknown as BaseAudioContext; }
}
function fixture() {
  const context = new Context();
  const session = new SessionTransport(() => context.currentTime, {leadInSeconds: 0.1, tick: {createWorker: () => null}, driftCheckIntervalMs: 0});
  const parameter = new ParamHandle({id: 'gain', unit: 'gain', defaultValue: 1, range: {min: 0, max: 4}, modulation: 'audio-rate', updateTiming: 'scheduled'});
  return {context, session, parameter};
}
const points = [{type: 'set' as const, timeSeconds: 0, value: 0}, {type: 'linear' as const, timeSeconds: 1, value: 2}];
const tick = {createWorker: () => null};
const follower = () => ({play() {}, pause() {}, stop() {}, seek() {}, setRate() {}, position: 0});

describe('Session-relative automation and native phase', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plans native ramps across future loops and re-arms from the shared position after rate/seek', async () => {
    const {context, session, parameter} = fixture();
    await session.setLoop({startSeconds: 0, endSeconds: 1});
    const lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {lookaheadSeconds: 2.5, tick});
    expect(context.constants).toHaveLength(0);
    await session.play();
    expect(parameter.snapshot.automation?.map(event => [event.type, event.value, event.time])).toEqual([
      ['set', 0, 0.1], ['linear', 2, 1.1], ['set', 0, 1.1], ['linear', 2, 2.1], ['set', 0, 2.1], ['linear', 1, 2.6],
    ]);
    context.currentTime = 0.6;
    expect(parameter.snapshot.baseValue).toBeCloseTo(1);
    await session.setRate(2);
    expect(parameter.snapshot.automation?.[0]).toEqual({type: 'set', value: 1, time: 0.6});
    await session.seek(0.25);
    expect(parameter.snapshot.automation?.[0]).toEqual({type: 'set', value: 0.5, time: 0.7});
    lease.release(); session.dispose(); parameter.dispose();
  });

  it('holds on pause and reference-clock suspension, and a manual base write overrides ownership', async () => {
    const {context, session, parameter} = fixture();
    const lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {tick});
    await session.play();
    const count = context.constants[0].offset.events.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(context.constants[0].offset.events).toHaveLength(count);
    context.currentTime = 0.2;
    await session.pause();
    const held = parameter.snapshot.baseValue;
    context.currentTime = 2;
    await vi.advanceTimersByTimeAsync(500);
    expect(parameter.snapshot.baseValue).toBe(held);
    await session.play();
    parameter.setBaseValue(0.9);
    expect(lease.active).toBe(false);
    context.currentTime = 2.2;
    await vi.advanceTimersByTimeAsync(50);
    expect(parameter.snapshot.baseValue).toBe(0.9);
    session.dispose(); parameter.dispose();
  });

  it.each(['pause', 'stop'] as const)('keeps the ticker stopped after a reentrant %s while attaching to a playing Session', async command => {
    const {context, session, parameter} = fixture();
    await session.play();
    let lease: ReturnType<typeof attachSessionAutomation> | undefined;
    let stopping: Promise<unknown> | undefined;
    const unwatch = parameter.subscribe(snapshot => {
      if (!stopping && snapshot.automation?.length) stopping = session[command]();
    });
    try {
      lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {tick});
      await stopping;
      expect(session.snapshot.paused).toBe(true);
      expect(lease.active).toBe(true);
      expect(parameter.snapshot.automation).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      await session.play();
      expect(parameter.snapshot.automation?.length).toBeGreaterThan(0);
      context.currentTime = 0.2;
      await vi.advanceTimersByTimeAsync(25);
      expect(parameter.snapshot.baseValue).toBeCloseTo(0.2);
      expect(lease.active).toBe(true);
    } finally { unwatch(); lease?.release(); session.dispose(); parameter.dispose(); }
  });

  it('waits for the replacement anchor when an attachment observer seeks during native scheduling', async () => {
    const {context, session, parameter} = fixture();
    await session.play();
    const worker = {postMessage: vi.fn(), terminate: vi.fn(), addEventListener: vi.fn()};
    let lease: ReturnType<typeof attachSessionAutomation> | undefined;
    let seeking: Promise<unknown> | undefined;
    const unwatch = parameter.subscribe(snapshot => {
      if (!seeking && snapshot.automation?.length) seeking = session.seek(0.5);
    });
    try {
      lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {tick: {createWorker: () => worker}});
      expect(session.scheduling.snapshot.phase).toBe('invalidated');
      expect(parameter.snapshot.automation).toHaveLength(0);
      expect(worker.postMessage).not.toHaveBeenCalled();
      await seeking;
      expect(session.scheduling.snapshot.phase).toBe('ready');
      expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({type: 'start', intervalMs: 25});
      expect(parameter.snapshot.automation?.[0].value).toBe(1);
      lease.release();
      expect(worker.terminate).toHaveBeenCalledOnce();
      expect(parameter.snapshot.disposed).toBe(false);
      expect(parameter.snapshot.automation).toHaveLength(0);
      session.dispose(); parameter.dispose();
      expect(context.constants.every(source => source.stops.length === 1 && source.edges.size === 0)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { unwatch(); lease?.release(); session.dispose(); parameter.dispose(); }
  });

  it.each((['scheduling', 'pause'] as const).flatMap(phase =>
    (['before', 'after'] as const).map(order => ({phase, order}))))('preserves a reentrant manual override during $phase with its observer attached $order ownership', async ({phase, order}) => {
    const {context, session, parameter} = fixture();
    let armed = false, writes = 0;
    const override = (snapshot: typeof parameter.snapshot) => {
      if (!armed || writes || (phase === 'scheduling' ? !snapshot.automation?.length : snapshot.automation?.length !== 0)) return;
      writes++;
      parameter.setBaseValue(0.9);
    };
    let unwatch = order === 'before' ? parameter.subscribe(override) : () => {};
    const lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {tick});
    if (order === 'after') unwatch = parameter.subscribe(override);
    try {
      if (phase === 'pause') { await session.play(); context.currentTime = 0.2; }
      armed = true;
      if (phase === 'pause') await session.pause();
      else await session.play();
      expect(writes).toBe(1);
      expect(lease.active).toBe(false);
      expect(parameter.snapshot.baseValue).toBe(0.9);
      context.currentTime += 0.3;
      await vi.advanceTimersByTimeAsync(50);
      expect(parameter.snapshot.baseValue).toBe(0.9);
      expect(writes).toBe(1);
    } finally { unwatch(); lease.release(); session.dispose(); parameter.dispose(); }
  });

  it('finishes initial subscription cleanup before notifying a reentrant manual takeover', () => {
    const {context, session, parameter} = fixture();
    let subscriptions = 0, wrote = false, subscriptionsAtRelease: number | undefined;
    const binding: SessionSchedulingBinding = {...session.scheduling, subscribe(listener) {
      subscriptions++;
      const unsubscribe = session.scheduling.subscribe(listener);
      return () => { subscriptions--; unsubscribe(); };
    }};
    const unwatch = parameter.subscribe(() => {
      if (wrote) return;
      wrote = true;
      parameter.setBaseValue(0.9);
    });
    const onRelease = vi.fn(() => { subscriptionsAtRelease = subscriptions; });
    const lease = attachSessionAutomation(binding, context.native, parameter, points, {tick, onRelease});
    expect(lease.active).toBe(false);
    expect(parameter.snapshot.baseValue).toBe(0.9);
    expect(subscriptionsAtRelease).toBe(0);
    expect(subscriptions).toBe(0);
    expect(onRelease).toHaveBeenCalledOnce();
    lease.release();
    expect(onRelease).toHaveBeenCalledOnce();
    unwatch(); session.dispose(); parameter.dispose();
  });

  it.each(['manual', 'explicit', 'session', 'parameter', 'error'] as const)('notifies terminal release once for %s cleanup and contains a throwing observer', async reason => {
    const {context, session, parameter} = fixture();
    const remainingAutomation: number[] = [];
    const onRelease = vi.fn(() => { remainingAutomation.push(parameter.snapshot.automation?.length ?? 0); throw new Error('Release observer failed.'); });
    const onError = vi.fn();
    const lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {tick, onRelease, onError});
    try {
      await session.play();
      expect(onRelease).not.toHaveBeenCalled();
      if (reason === 'manual') parameter.setBaseValue(0.9);
      else if (reason === 'explicit') lease.release();
      else if (reason === 'session') session.dispose();
      else if (reason === 'parameter') parameter.dispose();
      else {
        vi.spyOn(parameter, 'scheduleAutomation').mockImplementationOnce(() => { throw new Error('Scheduling failed.'); });
        context.currentTime = 0.2;
        await vi.advanceTimersByTimeAsync(25);
        expect(onError).toHaveBeenCalledOnce();
      }
      expect(lease.active).toBe(false);
      expect(onRelease).toHaveBeenCalledOnce();
      expect(remainingAutomation).toEqual([0]);
      lease.release(); session.dispose(); parameter.dispose();
      expect(onRelease).toHaveBeenCalledOnce();
    } finally { lease.release(); session.dispose(); parameter.dispose(); }
  });

  it('lets a release observer install a new owner and isolates its asynchronous rejection', async () => {
    const {context, session, parameter} = fixture();
    let replacement: ReturnType<typeof attachSessionAutomation> | undefined;
    const onRelease = vi.fn(async () => {
      replacement = attachSessionAutomation(session.scheduling, context.native, parameter,
        [{type: 'set', value: 0.6, timeSeconds: 0}], {tick});
      throw new Error('Async release observer failed.');
    });
    const lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {tick, onRelease});
    try {
      lease.release();
      await Promise.resolve();
      expect(onRelease).toHaveBeenCalledOnce();
      expect(replacement?.active).toBe(true);
      await session.play();
      lease.release();
      context.currentTime = 0.2;
      await vi.advanceTimersByTimeAsync(25);
      expect(replacement?.active).toBe(true);
      expect(parameter.snapshot.baseValue).toBe(0.6);
    } finally { lease.release(); replacement?.release(); session.dispose(); parameter.dispose(); }
  });

  it('notifies after attempted cleanup even when cancellation fails, without releasing a replacement owner', async () => {
    const {context, session, parameter} = fixture();
    let replacement: ReturnType<typeof attachSessionAutomation> | undefined;
    const onRelease = vi.fn(() => {
      replacement = attachSessionAutomation(session.scheduling, context.native, parameter,
        [{type: 'set', value: 0.6, timeSeconds: 0}], {tick});
    });
    const lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {tick, onRelease});
    try {
      await session.play();
      vi.spyOn(parameter, 'cancelAutomation').mockImplementationOnce(() => { throw new Error('Cancellation failed.'); });
      expect(() => lease.release()).toThrow('Cancellation failed.');
      expect(onRelease).toHaveBeenCalledOnce();
      expect(lease.active).toBe(false);
      expect(replacement?.active).toBe(true);
      lease.release();
      context.currentTime = 0.2;
      await vi.advanceTimersByTimeAsync(25);
      expect(replacement?.active).toBe(true);
      expect(parameter.snapshot.baseValue).toBe(0.6);
    } finally { lease.release(); replacement?.release(); session.dispose(); parameter.dispose(); }
  });

  it.each([false, true])('keeps automation live when the clock advances between planning and submission (loop: %s)', async loop => {
    const {context, session, parameter} = fixture();
    if (loop) await session.setLoop({startSeconds: 0, endSeconds: 1});
    const onError = vi.fn();
    const lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {tick, onError});
    try {
      await session.play();
      const schedule = parameter.scheduleAutomation.bind(parameter);
      vi.spyOn(parameter, 'scheduleAutomation').mockImplementation((clock, events, referenceTime) => {
        context.currentTime += 0.02;
        schedule(clock, events, referenceTime);
      });
      context.currentTime = loop ? 1.09 : 0.2;
      await vi.advanceTimersByTimeAsync(25);
      expect(lease.active).toBe(true);
      expect(lease.error).toBeUndefined();
      expect(onError).not.toHaveBeenCalled();
      expect(parameter.snapshot.baseValue).toBeCloseTo(loop ? 0.02 : 0.24);
      const end = parameter.snapshot.automation!.at(-1)!;
      expect(end.time).toBeCloseTo(loop ? 1.34 : 0.45);
      expect(end.value).toBeCloseTo(loop ? 0.48 : 0.7);
      context.currentTime += 0.05;
      await vi.advanceTimersByTimeAsync(25);
      expect(lease.active).toBe(true);
      expect(parameter.snapshot.baseValue).toBeCloseTo(loop ? 0.16 : 0.38);
    } finally { lease.release(); session.dispose(); parameter.dispose(); }
  });

  it('supports continuous once automation across wrapped Session passes and rejects competing ownership', async () => {
    const {context, session, parameter} = fixture();
    await session.setLoop({startSeconds: 0, endSeconds: 1});
    const lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {loop: 'once', lookaheadSeconds: 3, tick});
    expect(() => attachSessionAutomation(session.scheduling, context.native, parameter, points)).toThrow('owner');
    await session.play(); context.currentTime = 1.6;
    expect(parameter.snapshot.baseValue).toBe(2);
    session.dispose();
    expect(lease.active).toBe(false);
    expect(parameter.snapshot.disposed).toBe(false);
    parameter.dispose();
  });

  it.each([false, true])('keeps paused automation through CV edits (previously playing: %s)', async previouslyPlaying => {
    const {context, session, parameter} = fixture();
    const lease = attachSessionAutomation(session.scheduling, context.native, parameter, points, {tick});
    try {
      if (previouslyPlaying) {
        await session.play();
        context.currentTime = 0.2;
        await session.pause();
      }
      const held = parameter.snapshot.baseValue;
      const baseRevision = parameter.snapshot.baseRevision;
      const mapping = parameter.connectModulation({output: context.createGain() as unknown as AudioNode,
        rate: 'a-rate', range: {min: -1, max: 1}}, {depth: 0.1});
      expect(lease.active).toBe(true);
      mapping.setDepth(0.2);
      expect(lease.active).toBe(true);
      mapping.release();
      expect(parameter.snapshot).toMatchObject({baseValue: held, baseRevision});
      expect(lease.active).toBe(true);
      await session.play();
      expect(parameter.snapshot.automation?.some(event => event.type === 'linear')).toBe(true);
      await session.pause();
      parameter.setBaseValue(0.9);
      expect(lease.active).toBe(false);
      await session.play();
      expect(parameter.snapshot.baseValue).toBe(0.9);
      expect(parameter.snapshot.automation).toHaveLength(0);
    } finally { lease.release(); session.dispose(); parameter.dispose(); }
  });

  it('cancels a member LFO even when an earlier disposal listener commands the Session', async () => {
    const {context, session, parameter} = fixture();
    let binding!: SessionSchedulingBinding;
    const participant = session.register(follower(), {axis: 'local', durationSeconds: 10,
      attachScheduling: next => { binding = next; return createConnectionLease(() => {}); }});
    await session.preload();
    let pause: Promise<unknown> | undefined;
    binding.subscribe(event => { if (event.type === 'dispose') pause = session.pause(); });
    const lfo = new SessionLFO(context.native, binding, {tick, lookaheadSeconds: 1});
    const disposed = vi.fn();
    binding.subscribe(event => { if (event.type === 'dispose') disposed(); });
    try {
      await session.play();
      const source = context.buffers[0];
      participant.release();
      await participant.settled;
      await pause;
      expect(disposed).toHaveBeenCalledOnce();
      expect(source.stops).toContain(undefined);
      expect(source.edges.size).toBe(0);
      expect(lfo.frequency.snapshot.disposed).toBe(true);
      expect(session.snapshot.disposed).toBe(false);
    } finally { lfo.dispose(); session.dispose(); parameter.dispose(); }
  });

  it('keeps native work invalidated through obsolete queued seeks and slow legacy joins', async () => {
    const {context, session, parameter} = fixture();
    let prepared!: () => void, joined!: () => void;
    const preparation = new Promise<void>(resolve => { prepared = resolve; });
    const joining = new Promise<void>(resolve => { joined = resolve; });
    session.register(follower(), {axis: 'native', durationSeconds: 20, prepare: () => preparation,
      attachScheduling: () => createConnectionLease(() => {})});
    let starts = 0;
    session.register({...follower(), play() { if (++starts === 2) return joining; }}, {axis: 'legacy', durationSeconds: 20});
    const lfo = new SessionLFO(context.native, session.scheduling, {frequency: 0.25, tick, lookaheadSeconds: 1});
    try {
      const play = session.play(), old = session.seek(3), latest = session.seek(9);
      prepared();
      await vi.advanceTimersByTimeAsync(0);
      expect(starts).toBe(2);
      expect(session.scheduling.snapshot.phase).toBe('invalidated');
      expect(context.buffers).toHaveLength(0);
      joined();
      expect((await Promise.all([play, old, latest])).map(commit => commit.status)).toEqual(['superseded', 'superseded', 'committed']);
      expect(session.scheduling.snapshot).toMatchObject({phase: 'ready', originPosition: 9});
      expect(context.buffers).toHaveLength(1);
      const source = context.buffers[0];
      expect(source.starts[0]).toEqual([0.1, 0.25 * source.buffer!.duration]);
    } finally { prepared(); joined(); lfo.dispose(); session.dispose(); parameter.dispose(); }
  });

  it('reconstructs paused seek state and preserves an explicitly restored initial baseline', async () => {
    const {context, session, parameter} = fixture();
    const lease = attachSessionAutomation(session.scheduling, context.native, parameter,
      [{type: 'linear', value: 3, timeSeconds: 2}], {initialValue: 1, tick});
    await session.seek(1);
    expect(parameter.snapshot.baseValue).toBe(2);
    expect(lease.active).toBe(true);
    expect(lease.initialValue).toBe(1);
    expect(context.constants).toHaveLength(0);
    await session.stop();
    expect(parameter.snapshot.baseValue).toBe(1);
    lease.release(); session.dispose(); parameter.dispose();
  });

  it('preflights malformed tracks without allocating or changing the parameter', () => {
    const {context, session, parameter} = fixture();
    expect(() => attachSessionAutomation(session.scheduling, context.native, parameter, [{type: 'linear', value: 5, timeSeconds: 1}])).toThrow('range');
    expect(() => attachSessionAutomation(session.scheduling, context.native, parameter, [{type: 'set', value: 0, timeSeconds: 0}, {type: 'exponential', value: 1, timeSeconds: 1}])).toThrow('positive');
    expect(context.constants).toHaveLength(0);
    expect(parameter.snapshot.baseValue).toBe(1);
    session.dispose(); parameter.dispose();
  });

  it('derives native LFO start phase and rate from the same Session anchor', async () => {
    const {context, session} = fixture();
    await session.seek(0.125);
    const lfo = new SessionLFO(context.native, session.scheduling, {frequency: 2, phase: 0.25, lookaheadSeconds: 1, tick});
    expect(context.buffers).toHaveLength(0);
    await session.play();
    const first = context.buffers[0];
    expect(first.starts[0][0]).toBe(0.1);
    expect(first.starts[0][1]).toBeCloseTo(0.5 * first.buffer!.duration);
    expect(first.playbackRate.value).toBeCloseTo(2 * first.buffer!.duration);
    await session.setRate(2);
    const replacement = context.buffers.at(-1)!;
    expect(first.stops).toContain(undefined);
    expect(replacement.starts[0][0]).toBe(0.1);
    expect(replacement.starts[0][1]).toBeCloseTo(0.5 * replacement.buffer!.duration);
    expect(replacement.playbackRate.value).toBeCloseTo(4 * replacement.buffer!.duration);
    const number = context.buffers.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(context.buffers).toHaveLength(number);
    await session.pause();
    expect(replacement.edges.size).toBe(0);
    expect(lfo.frequency.snapshot.disposed).toBe(false);
    session.dispose();
    expect(lfo.frequency.snapshot.disposed).toBe(true);
  });

  it('pre-schedules both sides of a loop and resets phase using wrapped positions', async () => {
    const {context, session} = fixture();
    await session.setLoop({startSeconds: 0.25, endSeconds: 0.75});
    await session.seek(0.5);
    const lfo = new SessionLFO(context.native, session.scheduling, {frequency: 1, lookaheadSeconds: 1, tick});
    await session.play();
    expect(context.buffers).toHaveLength(3);
    const [first, second] = context.buffers;
    expect(first.stops[0]).toBeCloseTo(0.35);
    expect(second.starts[0][0]).toBeCloseTo(0.35);
    expect(first.starts[0][1]).toBeCloseTo(0.5 * first.buffer!.duration);
    expect(second.starts[0][1]).toBeCloseTo(0.25 * second.buffer!.duration);
    const output = lfo.signal.output;
    lfo.setWaveform('triangle');
    expect(lfo.signal.output).toBe(output);
    lfo.dispose(); session.dispose();
  });
});
