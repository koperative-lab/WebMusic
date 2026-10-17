import {describe, expect, it, vi} from 'vitest';
import {ParamHandle, ParamMacro, ControlLFO, ControlEnvelope, EnvelopeFollower, type ControlSignal} from '../src/module';

class Parameter {
  private stored: number;
  automationRate: AutomationRate = 'a-rate';
  readonly events: Array<[string, number, number?]> = [];
  constructor(value = 0, readonly minValue = -1e20, readonly maxValue = 1e20) { this.stored = value; }
  get value() { return this.stored; }
  set value(value: number) { this.stored = Math.max(this.minValue, Math.min(this.maxValue, value)); }
  cancelScheduledValues(time: number) { this.events.push(['cancel', time]); return this; }
  setValueAtTime(value: number, time: number) { this.events.push(['set', value, time]); return this; }
  linearRampToValueAtTime(value: number, time: number) { this.events.push(['linear', value, time]); return this; }
  exponentialRampToValueAtTime(value: number, time: number) { this.events.push(['exponential', value, time]); return this; }
}

class Node {
  readonly edges = new Set<unknown>();
  readonly gain = new Parameter(1);
  readonly offset = new Parameter(1);
  readonly frequency = new Parameter(440);
  readonly Q = new Parameter(1);
  type = 'sine';
  curve: Float32Array | null = null;
  started = 0;
  stopped = 0;
  throwDisconnect = false;
  constructor(readonly context: Context) {}
  connect(target: unknown) { this.edges.add(target); return target; }
  disconnect(target?: unknown) { if (target) this.edges.delete(target); else this.edges.clear(); if (this.throwDisconnect) throw new Error('disconnect'); }
  start() { this.started++; }
  stop() { this.stopped++; }
}
class Context {
  currentTime = 0;
  sampleRate = 48000;
  readonly nodes: Node[] = [];
  readonly createConstantSource = vi.fn(() => this.node());
  readonly createGain = vi.fn(() => this.node());
  readonly createOscillator = vi.fn(() => this.node());
  readonly createBiquadFilter = vi.fn(() => this.node());
  readonly createIIRFilter = vi.fn((_feedforward: number[], _feedback: number[]) => this.node());
  readonly createWaveShaper = vi.fn(() => this.node());
  private node() { const node = new Node(this); this.nodes.push(node); return node; }
  get native() { return this as unknown as BaseAudioContext; }
}
const native = (param: Parameter) => param as unknown as AudioParam;
const signal = (context: Context, rate: 'a-rate' | 'k-rate' = 'a-rate'): ControlSignal => ({
  output: context.createGain() as unknown as AudioNode, rate, range: {min: -1, max: 1},
});
const handle = (modulation: 'audio-rate' | 'control-rate' = 'audio-rate') => new ParamHandle({
  id: 'gain', unit: 'linear-gain', range: {min: 0, max: 4}, defaultValue: 1, updateTiming: 'scheduled', modulation,
});

describe('native shared parameter CV', () => {
  it('keeps ordinary lazy writes node-free, then fans one full base bus to current and future voices', () => {
    const context = new Context(), param = handle(), first = new Parameter(), second = new Parameter();
    param.bindAudioParam(context.native, native(first), {lazy: true});
    expect(context.nodes).toHaveLength(0);
    expect(first.value).toBe(1);
    param.setBaseValue(0.5);
    expect(first.value).toBe(0.5);
    const bus = param.audio(context.native);
    expect(first.value).toBe(0);
    expect(context.createConstantSource).toHaveBeenCalledTimes(1);
    const base = context.nodes[0];
    expect(base.offset.value).toBe(0.5);
    param.bindAudioParam(context.native, native(second));
    expect(second.value).toBe(0);
    expect(base.edges).toEqual(new Set([first, second]));
    param.setBaseValue(0.75);
    expect(first.value).toBe(0);
    expect(second.value).toBe(0);
    expect(base.offset.events.at(-1)).toEqual(['set', 0.75, 0]);
    expect(bus.baseValueAt(0)).toBe(0.75);
    expect(param.snapshot.effectiveReadback).toEqual({status: 'unavailable'});
  });

  it('rejects recursive preparation without leaking an orphaned running bus', () => {
    const context = new Context(), param = handle();
    const create = context.createConstantSource.getMockImplementation()!;
    let reentered = false;
    context.createConstantSource.mockImplementation(() => {
      if (!reentered) {
        reentered = true;
        expect(() => param.audio(context.native)).toThrow('re-enter');
      }
      return create();
    });
    param.audio(context.native);
    param.dispose();
    expect(context.nodes).toHaveLength(1);
    expect(context.nodes[0].stopped).toBe(1);
  });

  it('cannot pin a disposed handle to a context created by a reentrant factory', () => {
    const context = new Context(), param = handle();
    const create = context.createConstantSource.getMockImplementation()!;
    context.createConstantSource.mockImplementation(() => { param.dispose(); return create(); });
    expect(() => param.audio(context.native)).toThrow('disposed');
    expect(context.nodes[0].stopped).toBe(1);
    expect(param.snapshot.disposed).toBe(true);
  });

  it('rolls binding back if a native parameter setter disposes the bus', () => {
    const context = new Context(), param = handle(), bus = param.audio(context.native);
    const target = new Parameter(2);
    let value = 2;
    Object.defineProperty(target, 'value', {get: () => value, set: (next: number) => { value = next; if (next === 0) bus.dispose(); }});
    expect(() => bus.bind(native(target))).toThrow('disposed');
    expect(value).toBe(2);
    expect(context.nodes[0].edges.size).toBe(0);
  });

  it('rejects a second base authority for a borrowed native parameter', () => {
    const context = new Context(), first = handle(), second = handle(), target = new Parameter();
    const lease = first.bindAudioParam(context.native, native(target), {lazy: true});
    expect(() => second.bindAudioParam(context.native, native(target), {lazy: true})).toThrow('another parameter');
    lease.release();
    expect(() => second.bindAudioParam(context.native, native(target), {lazy: true})).not.toThrow();
  });

  it('does not create a bus for an invalid initial automation timeline', () => {
    const context = new Context(), param = handle();
    expect(() => param.scheduleAutomation(context.native, [{type: 'set', value: 1, time: -1}])).toThrow();
    expect(context.nodes).toHaveLength(0);
  });

  it('compensates a native positive minimum rather than counting its floor twice', () => {
    const context = new Context(), param = handle(), ratio = new Parameter(2, 1, 20);
    param.bindAudioParam(context.native, native(ratio));
    expect(ratio.value).toBe(1);
    expect(context.nodes).toHaveLength(2);
    expect(context.nodes[0].offset.value).toBe(1);
    expect(context.nodes[1].offset.value).toBe(-1);
    expect(context.nodes[1].edges.has(ratio)).toBe(true);
    param.dispose();
    expect(context.nodes.every(node => node.stopped === 1 && node.edges.size === 0)).toBe(true);
    expect(ratio.value).toBe(1);
  });

  it('reference-counts duplicate target bindings and restores base on the last release', () => {
    const context = new Context(), param = handle(), target = new Parameter();
    const first = param.bindAudioParam(context.native, native(target));
    const second = param.bindAudioParam(context.native, native(target));
    first.release(); first.release();
    expect(target.value).toBe(0);
    expect(context.nodes[0].edges.has(target)).toBe(true);
    second.release();
    expect(target.value).toBe(1);
    expect(context.nodes[0].edges.has(target)).toBe(false);
  });

  it('declares rate support and rejects context changes or unsupported precision', () => {
    const context = new Context(), other = new Context(), param = handle();
    const target = new Parameter(); target.automationRate = 'k-rate';
    expect(() => param.bindAudioParam(context.native, native(target))).toThrow('k-rate');
    const control = handle('control-rate');
    control.bindAudioParam(context.native, native(target));
    expect(context.nodes[0].offset.automationRate).toBe('k-rate');
    param.bindAudioParam(context.native, native(new Parameter()));
    expect(() => param.audio(other.native)).toThrow('another AudioContext');
    expect(() => param.connectModulation(signal(context, 'k-rate'), {depth: 1})).toThrow('a-rate');
    const callback = new ParamHandle({id: 'callback', unit: 'x', range: {min: 0, max: 1}, defaultValue: 0});
    expect(() => callback.audio(context.native)).toThrow('does not support');
    expect(() => callback.scheduleAutomation(context.native, [])).toThrow('scheduled');
  });

  it('maps additive native-unit depth, publishes estimated bounds, and releases only its edge', () => {
    const context = new Context(), param = handle(), source = signal(context);
    const output = source.output as unknown as Node;
    const other = context.createGain(); output.connect(other);
    const mapping = param.connectModulation(source, {depth: 0.25});
    expect(param.snapshot.modulationRange).toEqual({min: 0.75, max: 1.25});
    mapping.setDepth(-0.5);
    expect(param.snapshot.modulationRange).toEqual({min: 0.5, max: 1.5});
    mapping.release(); mapping.release();
    expect(output.edges).toEqual(new Set([other]));
    expect(param.snapshot.modulationRange).toEqual({min: 1, max: 1});
    expect(() => mapping.setDepth(1)).toThrow('released');
  });

  it('normalizes unipolar and noncanonical source ranges before applying depth', () => {
    const context = new Context(), param = handle();
    const mapping = param.connectModulation({...signal(context), range: {min: 2, max: 4}}, {depth: 0.5, polarity: 'unipolar'});
    const scale = context.nodes.find(node => node.edges.has(context.nodes[1].offset))!;
    expect(scale.gain.value).toBe(0.25);
    expect(param.snapshot.modulationRange).toEqual({min: 1, max: 1.5});
    expect(mapping.polarity).toBe('unipolar');
  });

  it('preflights invalid modulation without adding graph edges', () => {
    const context = new Context(), param = handle();
    const source = signal(context);
    const bus = param.audio(context.native);
    const before = context.nodes.length;
    expect(() => bus.connect(source, {depth: NaN})).toThrow('finite');
    expect(() => bus.connect({...source, range: {min: 0, max: 0}}, {depth: 1})).toThrow('range');
    expect(() => bus.connect(signal(new Context()), {depth: 1})).toThrow('share');
    expect(context.nodes).toHaveLength(before);
  });

  it('releases buses and mappings on backend teardown while keeping reusable configuration', () => {
    const context = new Context(), next = new Context(), param = handle();
    const target = new Parameter();
    const lease = param.bindAudioParam(context.native, native(target));
    const mapping = param.connectModulation(signal(context), {depth: 0.2});
    param.setBaseValue(0.3);
    const changes = vi.fn(); param.subscribe(changes);
    param.releaseAudio(context.native);
    expect(lease.active).toBe(false);
    expect(mapping.active).toBe(false);
    expect(target.value).toBe(0.3);
    expect(param.snapshot.disposed).toBe(false);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(() => param.bindAudioParam(next.native, native(new Parameter()))).not.toThrow();
  });

  it('finishes all owned cleanup even if an edge disconnect rejects', () => {
    const context = new Context(), param = handle();
    const first = new Parameter(), second = new Parameter();
    const a = param.bindAudioParam(context.native, native(first));
    const b = param.bindAudioParam(context.native, native(second));
    const mapping = param.connectModulation(signal(context), {depth: 0.2});
    context.nodes[0].throwDisconnect = true;
    const observer = vi.fn(); param.subscribe(observer);
    expect(() => param.dispose()).toThrow('disconnect');
    expect(param.snapshot.disposed).toBe(true);
    expect(a.active || b.active || mapping.active).toBe(false);
    expect(context.nodes[0].stopped).toBe(1);
    expect(first.value).toBe(1);
    expect(second.value).toBe(1);
    expect(observer).toHaveBeenCalledOnce();
    expect(() => param.dispose()).not.toThrow();
  });
});

describe('scheduled base automation', () => {
  it('models current base separately from CV and propagates it to voices joining later', () => {
    const context = new Context(), param = handle();
    param.scheduleAutomation(context.native, [{type: 'set', value: 1, time: 1}, {type: 'linear', value: 3, time: 3}]);
    context.currentTime = 2;
    expect(param.snapshot.baseValue).toBe(2);
    const voice = new Parameter(); param.bindAudioParam(context.native, native(voice));
    expect(voice.value).toBe(0);
    expect(context.createConstantSource).toHaveBeenCalledTimes(1);
    expect(param.snapshot.effectiveReadback.status).toBe('unavailable');
    param.cancelAutomation();
    expect(param.snapshot.automation).toEqual([]);
    context.currentTime = 4;
    expect(param.snapshot.baseValue).toBe(2);
    expect(context.nodes[0].offset.events.slice(-2)).toEqual([['cancel', 2], ['set', 2, 2]]);
  });

  it('replaces automation at the modeled current value and supports exponential trajectories', () => {
    const context = new Context(), param = handle();
    param.scheduleAutomation(context.native, [{type: 'exponential', value: 4, time: 2}]);
    context.currentTime = 1;
    expect(param.snapshot.baseValue).toBe(2);
    param.scheduleAutomation(context.native, [{type: 'linear', value: 1, time: 3}]);
    context.currentTime = 2;
    expect(param.snapshot.baseValue).toBe(1.5);
    param.setBaseValue(0.5);
    context.currentTime = 5;
    expect(param.snapshot.baseValue).toBe(0.5);
  });

  it('preserves a linear trajectory when lazy CV allocation advances the audio clock', () => {
    const context = new Context(), param = handle();
    const create = context.createConstantSource.getMockImplementation()!;
    context.createConstantSource.mockImplementation(() => { context.currentTime = 0.5; return create(); });
    param.scheduleAutomation(context.native, [{type: 'set', value: 1, time: 0}, {type: 'linear', value: 3, time: 2}]);
    expect(param.snapshot.baseValue).toBe(1.5);
    expect(param.snapshot.automation).toEqual([{type: 'set', value: 1.5, time: 0.5}, {type: 'linear', value: 3, time: 2}]);
    context.currentTime = 1;
    expect(param.snapshot.baseValue).toBe(2);
    expect(context.nodes[0].offset.events.at(-1)).toEqual(['linear', 3, 2]);
    param.dispose();
  });

  it.each(['handle', 'bus'] as const)('uses one default planning time across %s validation', target => {
    const context = new Context(), param = handle(), bus = param.audio(context.native);
    Object.defineProperty(context, 'currentTime', {get: vi.fn().mockReturnValueOnce(0).mockReturnValue(1)});
    const events = [{type: 'set' as const, value: 1, time: 0}, {type: 'exponential' as const, value: 4, time: 2}];
    if (target === 'handle') param.scheduleAutomation(context.native, events);
    else bus.schedule(events);
    expect(bus.baseValueAt(1)).toBe(2);
    expect(bus.baseValueAt(1.5)).toBeCloseTo(Math.sqrt(8));
    expect(bus.automation).toEqual([{type: 'set', value: 2, time: 1}, {type: 'exponential', value: 4, time: 2}]);
    param.dispose();
  });

  it('anchors an implicit exponential ramp at the captured base when replacing an existing trajectory', () => {
    const context = new Context(), param = handle();
    param.scheduleAutomation(context.native, [{type: 'linear', value: 3, time: 2}]);
    const referenceTime = context.currentTime;
    context.currentTime = 1;
    param.scheduleAutomation(context.native, [{type: 'exponential', value: 4, time: 2}], referenceTime);
    expect(param.snapshot.baseValue).toBe(2);
    context.currentTime = 1.5;
    expect(param.snapshot.baseValue).toBeCloseTo(Math.sqrt(8));
    param.dispose();
  });

  it.each(['linear', 'exponential'] as const)('repairs a %s ramp when native submission crosses another render quantum', type => {
    const context = new Context(), param = handle(), bus = param.audio(context.native);
    const offset = context.nodes[0].offset;
    const cancel = offset.cancelScheduledValues.bind(offset);
    const cancelling = vi.spyOn(offset, 'cancelScheduledValues').mockImplementationOnce(time => {
      context.currentTime = 1;
      return cancel(time);
    });
    bus.schedule([{type: 'set', value: 1, time: 0}, {type, value: 4, time: 2}]);
    const midpoint = type === 'linear' ? 2.5 : 2;
    expect(cancelling).toHaveBeenCalledTimes(2);
    expect(cancelling.mock.calls).toEqual([[0], [1]]);
    expect(offset.events.slice(-3)).toEqual([['set', midpoint, 1], ['set', midpoint, 1], [type, 4, 2]]);
    expect(bus.baseValueAt(1)).toBe(midpoint);
    expect(bus.baseValueAt(1.5)).toBeCloseTo(type === 'linear' ? 3.25 : Math.sqrt(8));
    param.dispose();
  });

  it('bounds repair attempts under repeated native stalls and accepts a later refill', () => {
    const context = new Context(), param = handle(), bus = param.audio(context.native);
    const offset = context.nodes[0].offset, cancel = offset.cancelScheduledValues.bind(offset);
    const cancelling = vi.spyOn(offset, 'cancelScheduledValues').mockImplementation(time => {
      context.currentTime += 0.1;
      return cancel(time);
    });
    expect(() => bus.schedule([{type: 'linear', value: 3, time: 2}])).not.toThrow();
    expect(cancelling).toHaveBeenCalledTimes(3);
    expect(bus.active).toBe(true);
    cancelling.mockRestore();
    bus.schedule([{type: 'set', value: 1, time: 0}, {type: 'linear', value: 3, time: 2}], 0);
    expect(bus.baseValueAt(1)).toBe(2);
    param.dispose();
  });

  it('rebases elapsed sets and same-time loop resets without moving future endpoints', () => {
    const context = new Context(), param = handle();
    context.currentTime = 1;
    param.scheduleAutomation(context.native, [
      {type: 'set', value: 0, time: 0}, {type: 'linear', value: 2, time: 1},
      {type: 'set', value: 0, time: 1}, {type: 'linear', value: 2, time: 2},
      {type: 'set', value: 0.5, time: 3},
    ], 0);
    expect(param.snapshot.baseValue).toBe(0);
    context.currentTime = 1.5;
    expect(param.snapshot.baseValue).toBe(1);
    context.currentTime = 2.5;
    expect(param.snapshot.baseValue).toBe(2);
    context.currentTime = 3;
    expect(param.snapshot.baseValue).toBe(0.5);
    param.dispose();
  });

  it('holds the last point after an elapsed horizon and holds the current base for an empty replacement', () => {
    const context = new Context(), param = handle();
    context.currentTime = 3;
    param.scheduleAutomation(context.native, [{type: 'set', value: 1, time: 0}, {type: 'linear', value: 3, time: 2}], 0);
    expect(param.snapshot.baseValue).toBe(3);
    expect(param.snapshot.automation).toEqual([{type: 'set', value: 3, time: 3}]);
    param.scheduleAutomation(context.native, [{type: 'linear', value: 1, time: 5}]);
    context.currentTime = 4;
    param.scheduleAutomation(context.native, [], 3);
    context.currentTime = 6;
    expect(param.snapshot.baseValue).toBe(2);
    expect(param.snapshot.automation).toEqual([]);
    param.dispose();
  });

  it.each(['handle', 'bus'] as const)('rejects malformed or unanchored past input through %s before touching accepted work', target => {
    const context = new Context(), param = handle(), bus = param.audio(context.native);
    param.scheduleAutomation(context.native, [{type: 'linear', value: 3, time: 2}]);
    context.currentTime = 1;
    const before = [...context.nodes[0].offset.events];
    const schedule = (events: Parameters<typeof bus.schedule>[0], referenceTime?: number) => target === 'handle'
      ? param.scheduleAutomation(context.native, events, referenceTime) : bus.schedule(events, referenceTime);
    for (const referenceTime of [NaN, Infinity, -1, 2]) {
      expect(() => schedule([{type: 'set', value: 1, time: 2}], referenceTime)).toThrow('reference time');
    }
    expect(() => schedule([{type: 'set', value: 1, time: 0}])).toThrow();
    for (const events of [
      [{type: 'set' as const, value: 1, time: -1}],
      [{type: 'set' as const, value: NaN, time: 0}],
      [{type: 'set' as const, value: 1, time: Infinity}],
      [{type: 'set' as const, value: 1, time: 1}, {type: 'linear' as const, value: 2, time: 0.5}],
      [{type: 'set' as const, value: 0, time: 0}, {type: 'exponential' as const, value: 2, time: 2}],
      [{type: 'unknown' as 'set', value: 1, time: 0}],
    ]) expect(() => schedule(events, 0)).toThrow();
    expect(context.nodes[0].offset.events).toEqual(before);
    expect(param.snapshot.baseValue).toBe(2);
    param.dispose();
  });

  it('rejects malformed schedules before cancelling the accepted trajectory', () => {
    const context = new Context(), param = handle();
    param.scheduleAutomation(context.native, [{type: 'linear', value: 2, time: 2}]);
    const before = [...context.nodes[0].offset.events];
    for (const events of [
      [{type: 'set' as const, value: 5, time: 2}],
      [{type: 'set' as const, value: 1, time: -1}],
      [{type: 'set' as const, value: 0, time: 0}, {type: 'exponential' as const, value: 1, time: 2}],
    ]) expect(() => param.scheduleAutomation(context.native, events)).toThrow();
    expect(context.nodes[0].offset.events).toEqual(before);
  });
});

describe('native control sources and shared-handle macros', () => {
  it('runs the LFO entirely on native nodes and disposes only its own resources', () => {
    const context = new Context();
    const lfo = new ControlLFO(context.native, {frequency: 2, waveform: 'triangle'});
    expect(context.nodes[0].started).toBe(1);
    expect(context.nodes[0].frequency.value).toBe(2);
    expect(lfo.signal.rate).toBe('a-rate');
    expect(lfo.signal.range).toEqual({min: -1, max: 1});
    lfo.frequency.setBaseValue(3);
    expect(context.nodes[0].frequency.value).toBe(3);
    lfo.setWaveform('square'); expect(lfo.waveform).toBe('square');
    lfo.dispose(); lfo.dispose();
    expect(context.nodes[0].stopped).toBe(1);
    expect(() => lfo.frequency.setBaseValue(4)).toThrow('disposed');
    expect(() => lfo.setWaveform('sine')).toThrow('disposed');
  });

  it('schedules a global ADSR and releases from the early attack level, including future command replacement', () => {
    const context = new Context();
    const envelope = new ControlEnvelope(context.native, {attack: 0.2, decay: 0.1, sustain: 0.5, release: 0.1});
    envelope.trigger(0);
    envelope.release(0.1);
    expect(context.nodes[0].offset.events.slice(-3)).toEqual([['cancel', 0.1], ['linear', 0.5, 0.1], ['linear', 0, 0.2]]);
    envelope.trigger(0.05);
    expect(context.nodes[0].offset.events.slice(-4)[1]).toEqual(['linear', 0.25, 0.05]);
    envelope.dispose(); envelope.dispose();
    expect(context.nodes[0].stopped).toBe(1);
  });

  it.each(['trigger', 'release'] as const)('uses one current-time anchor for a default envelope %s', method => {
    const context = new Context();
    const envelope = new ControlEnvelope(context.native);
    envelope.trigger(0);
    const readTime = vi.fn().mockReturnValueOnce(1).mockReturnValue(1 + 128 / context.sampleRate);
    Object.defineProperty(context, 'currentTime', {get: readTime});
    const previousEvents = context.nodes[0].offset.events.length;
    expect(() => envelope[method]()).not.toThrow();
    expect(context.nodes[0].offset.events[previousEvents]).toEqual(['cancel', 1]);
    expect(readTime).toHaveBeenCalledTimes(1);
    envelope.dispose();
  });

  it('rejects invalid explicit envelope times without changing its accepted trajectory', () => {
    const context = new Context();
    const envelope = new ControlEnvelope(context.native);
    envelope.trigger(2);
    context.currentTime = 1;
    const before = [...context.nodes[0].offset.events];
    for (const time of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => envelope.trigger(time)).toThrow('current or future');
      expect(() => envelope.release(time)).toThrow('current or future');
    }
    expect(() => envelope.trigger(1, NaN)).toThrow('velocity');
    expect(context.nodes[0].offset.events).toEqual(before);
    envelope.dispose();
    expect(() => envelope.trigger()).toThrow('disposed');
    expect(() => envelope.release()).toThrow('disposed');
  });

  it('bounds completed envelope history during repeated advancing gates', () => {
    const context = new Context();
    const envelope = new ControlEnvelope(context.native);
    // Inspect retained model size: native event fixtures intentionally retain
    // their call log, while the live envelope must not retain completed gates.
    const model = envelope as unknown as {points: Array<{time: number}>};
    for (let gate = 0; gate < 1000; gate++) {
      context.currentTime = gate;
      envelope.trigger();
      context.currentTime = gate + 0.5;
      envelope.release();
      expect(model.points.length).toBeLessThanOrEqual(3);
    }
    expect(model.points[0].time).toBe(999.5);
    envelope.dispose();
  });

  it('retains earlier future gates and an in-progress ramp while pruning completed history', () => {
    const context = new Context();
    const envelope = new ControlEnvelope(context.native, {attack: 0.25, decay: 0.25, sustain: 0.5, release: 0.25});
    envelope.trigger(0);
    envelope.release(0.5);
    envelope.trigger(1);
    envelope.release(1.5);
    envelope.trigger(2);
    context.currentTime = 0.6;
    envelope.release(1.125);
    expect(context.nodes[0].offset.events.slice(-3)).toEqual([
      ['cancel', 1.125], ['linear', 0.5, 1.125], ['linear', 0, 1.375],
    ]);
    // The current release ramp and earlier queued gate remain queryable even
    // after a later gate has been replaced and its completed prefix pruned.
    envelope.release(0.625);
    expect(context.nodes[0].offset.events.slice(-3)).toEqual([
      ['cancel', 0.625], ['linear', 0.25, 0.625], ['linear', 0, 0.875],
    ]);
    envelope.dispose();
  });

  it('keeps future ramp left limits and instantaneous decay steps after history pruning', () => {
    const context = new Context();
    const envelope = new ControlEnvelope(context.native, {attack: 0.25, decay: 0, sustain: 0.25, release: 0.25});
    envelope.trigger(0);
    envelope.release(0.5);
    envelope.trigger(1);
    envelope.release(1.25);
    context.currentTime = 0.6;
    envelope.release(1.25);
    expect(context.nodes[0].offset.events.slice(-4)).toEqual([
      ['cancel', 1.25], ['linear', 1, 1.25], ['set', 0.25, 1.25], ['linear', 0, 1.5],
    ]);
    envelope.release(1.125);
    expect(context.nodes[0].offset.events.slice(-3)).toEqual([
      ['cancel', 1.125], ['linear', 0.5, 1.125], ['linear', 0, 1.375],
    ]);
    envelope.dispose();
  });

  it('retriggers continuously during decay, sustain and release after completed gates', () => {
    const context = new Context();
    const envelope = new ControlEnvelope(context.native, {attack: 0.1, decay: 0.2, sustain: 0.25, release: 0.2});
    envelope.trigger();
    context.currentTime = 0.5;
    envelope.release();
    context.currentTime = 1;
    envelope.trigger(undefined, 0.8);
    context.currentTime = 1.15;
    envelope.trigger(undefined, 0.6);
    expect(context.nodes[0].offset.events.at(-3)?.[1]).toBeCloseTo(0.65);
    context.currentTime = 2;
    envelope.release();
    expect(context.nodes[0].offset.events.at(-2)).toEqual(['set', 0.15, 2]);
    context.currentTime = 2.1;
    envelope.trigger();
    expect(context.nodes[0].offset.events.at(-3)?.[1]).toBeCloseTo(0.075);
    envelope.dispose();
  });

  it('preserves the attack peak when a future release coincides with an instantaneous decay', () => {
    const context = new Context();
    const envelope = new ControlEnvelope(context.native, {attack: 0.2, decay: 0, sustain: 0.25, release: 0.2});
    envelope.trigger(0);
    envelope.release(0.2);
    expect(context.nodes[0].offset.events.slice(-4)).toEqual([
      ['cancel', 0.2], ['linear', 1, 0.2], ['set', 0.25, 0.2], ['linear', 0, 0.4],
    ]);
    // An earlier command must still read the intact original attack trajectory.
    envelope.release(0.1);
    expect(context.nodes[0].offset.events.slice(-3)).toEqual([
      ['cancel', 0.1], ['linear', 0.5, 0.1], ['linear', 0, 0.1 + 0.2],
    ]);
    envelope.dispose();
  });

  it('keeps silence before a future instantaneous attack when its gate is replaced at onset', () => {
    const context = new Context();
    const envelope = new ControlEnvelope(context.native, {attack: 0, decay: 0.2, sustain: 0.25, release: 0.2});
    envelope.trigger(0.2);
    envelope.release(0.2);
    expect(context.nodes[0].offset.events.slice(-3)).toEqual([
      ['cancel', 0.2], ['set', 1, 0.2], ['linear', 0, 0.4],
    ]);
    envelope.release(0.1);
    expect(context.nodes[0].offset.events.slice(-3)).toEqual([
      ['cancel', 0.1], ['set', 0, 0.1], ['linear', 0, 0.1 + 0.2],
    ]);
    envelope.dispose();
  });

  it('constructs a normalized audio-rate follower without a timer or ownership of upstream audio', () => {
    const context = new Context();
    const follower = new EnvelopeFollower(context.native, {smoothingHz: 10});
    expect(follower.signal.range).toEqual({min: 0, max: 1});
    expect(follower.signal.rate).toBe('a-rate');
    expect(context.nodes[1].curve?.[1024]).toBe(0);
    expect(context.nodes[1].curve?.[0]).toBe(1);
    const pole = Math.exp(-2 * Math.PI * 10 / context.sampleRate);
    expect(context.createIIRFilter).toHaveBeenCalledWith([1 - pole], [1, -pole]);
    expect(context.nodes[3].curve).toEqual(new Float32Array([0, 0, 1]));
    follower.dispose();
    expect(context.nodes.every(node => node.edges.size === 0)).toBe(true);
  });

  it('maps reversible macro endpoints to the same handles and isolates subscriber failures', () => {
    const first = handle(), second = handle();
    const macro = new ParamMacro([{target: first, min: 0, max: 2}, {target: second, min: 4, max: 0}]);
    const listener = vi.fn(); macro.subscribe(listener); macro.subscribe(() => { throw new Error('observer'); });
    macro.setValue(0.25);
    expect(first.snapshot.baseValue).toBe(0.5);
    expect(second.snapshot.baseValue).toBe(3);
    expect(listener).toHaveBeenCalledWith(0.25);
    macro.dispose();
    expect(first.snapshot.disposed).toBe(false);
    expect(() => macro.setValue(0.5)).toThrow('disposed');
  });

  it('preflights disposed targets and rolls successful base writes back on backend rejection', () => {
    const first = handle();
    const rejecting = new ParamHandle({id: 'reject', unit: 'x', range: {min: 0, max: 4}, defaultValue: 1}, {apply: () => { throw new Error('reject'); }});
    const macro = new ParamMacro([{target: first, min: 0, max: 4}, {target: rejecting, min: 0, max: 4}]);
    expect(() => macro.setValue(0.5)).toThrow('reject');
    expect(first.snapshot.baseValue).toBe(1);
    expect(macro.value).toBe(0);
    rejecting.dispose();
    expect(() => macro.setValue(0)).toThrow('disposed');
    expect(first.snapshot.baseValue).toBe(1);
    expect(() => new ParamMacro([{target: first, min: -1, max: 1}])).toThrow('range');
  });
});
