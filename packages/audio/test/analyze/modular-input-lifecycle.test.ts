// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AudioOutputPort, type ModuleHandle} from '@webmusic/kernel/module';
import {defineAudioLevelAnalyzerElement} from '../../src/analyze/element/audio-level-analyzer';
import {defineAudioOscilloscopeElement} from '../../src/analyze/element/audio-oscilloscope';
import {defineAudioSpectrumAnalyzerElement} from '../../src/analyze/element/audio-spectrum-analyzer';
import {defineAudioTransientAnalyzerElement} from '../../src/analyze/element/audio-transient-analyzer';
import {bindModuleAudioInput} from '../../src/play/element/internal/module-input';

vi.mock('../../src/analyze/headless/realtime', () => ({
  createRealtimeAnalyzer: () => ({running: false, start() { this.running = true; }, stop() { this.running = false; }}),
}));

defineAudioLevelAnalyzerElement();
defineAudioOscilloscopeElement();
defineAudioSpectrumAnalyzerElement();
defineAudioTransientAnalyzerElement();

type AnalyzerElement = HTMLElement & {inputModule?: ModuleHandle | null};
type Stage = 'subscribe' | 'getPort' | 'createAnalyser' | 'connect';
const tags = ['audio-level-analyzer', 'audio-oscilloscope', 'audio-spectrum-analyzer', 'audio-transient-analyzer'];

function source(id: string) {
  const listeners = new Set<() => void>();
  const connections = new Set<AudioNode>();
  const analysers: Array<AnalyserNode & {disconnect: ReturnType<typeof vi.fn>}> = [];
  const hooks: Partial<Record<Stage | 'unsubscribe', () => void>> = {};
  const context = {
    sampleRate: 48_000,
    createAnalyser() {
      hooks.createAnalyser?.();
      const node = {context, fftSize: 2048, disconnect: vi.fn()} as unknown as typeof analysers[number];
      analysers.push(node);
      return node;
    },
  };
  const output = {
    context,
    connect(node: AudioNode) { connections.add(node); hooks.connect?.(); },
    disconnect(node: AudioNode) { connections.delete(node); },
  } as unknown as AudioNode;
  const port = new AudioOutputPort(output);
  const module = {
    id,
    dispose: vi.fn(),
    getPort() { hooks.getPort?.(); return port; },
    subscribe(callback: () => void) {
      listeners.add(callback);
      callback();
      hooks.subscribe?.();
      return () => { listeners.delete(callback); hooks.unsubscribe?.(); };
    },
  } satisfies ModuleHandle & {dispose(): void};
  return {module, port, listeners, connections, analysers, hooks, emit() { for (const callback of [...listeners]) callback(); }};
}

function clean(input: ReturnType<typeof source>) {
  expect(input.listeners.size).toBe(0);
  expect(input.connections.size).toBe(0);
  for (const node of input.analysers) expect(node.disconnect).toHaveBeenCalledOnce();
  expect(input.module.dispose).not.toHaveBeenCalled();
  expect(input.port.disposed).toBe(false);
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {},
    lineTo() {}, stroke() {}, fillText() {}, setLineDash() {},
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe.each(tags)('%s modular input ownership', (tag) => {
  it('releases its tap and subscription on normal removal, without disposing the source', () => {
    const input = source('first');
    const element = document.createElement(tag) as AnalyzerElement;
    element.inputModule = input.module;
    document.body.append(element);
    expect(input.listeners.size).toBe(1);
    expect(input.connections.size).toBe(1);
    element.remove();
    clean(input);
  });

  it.each([new Error('Module output is unavailable'), 'Module output is unavailable'])('reports {error: Error} and permits synchronous error-handler removal (%s)', (failure) => {
    const input = source('first');
    input.hooks.getPort = () => { throw failure; };
    const element = document.createElement(tag) as AnalyzerElement;
    const events: CustomEvent<{error: Error}>[] = [];
    element.addEventListener('webaudio:error', event => { events.push(event as CustomEvent<{error: Error}>); element.remove(); });
    element.inputModule = input.module;
    document.body.append(element);
    expect(events).toHaveLength(1);
    expect(events[0]!.detail.error).toBeInstanceOf(Error);
    expect(events[0]!.detail.error.message).toBe('Module output is unavailable');
    expect(events[0]!.bubbles).toBe(true);
    expect(events[0]!.composed).toBe(true);
    expect(element.isConnected).toBe(false);
    clean(input);
  });

  it.each(['subscribe', 'getPort', 'createAnalyser', 'connect'] as const)('retires late resources when %s removes the host', (stage) => {
    const input = source('first');
    const element = document.createElement(tag) as AnalyzerElement;
    input.hooks[stage] = () => { delete input.hooks[stage]; element.remove(); };
    element.inputModule = input.module;
    document.body.append(element);
    expect(element.isConnected).toBe(false);
    clean(input);
  });

  it.each(['subscribe', 'getPort', 'createAnalyser', 'connect'] as const)('preserves the replacement binding when %s sets inputModule', (stage) => {
    const first = source('first');
    const second = source('second');
    const element = document.createElement(tag) as AnalyzerElement;
    first.hooks[stage] = () => { delete first.hooks[stage]; element.inputModule = second.module; };
    element.inputModule = first.module;
    document.body.append(element);
    clean(first);
    expect(second.listeners.size).toBe(1);
    expect(second.connections.size).toBe(1);
    first.emit();
    expect(second.connections.size).toBe(1);
    element.remove();
    clean(second);
  });

  it('releases selector discovery and late taps when an input attribute rebinds synchronously', () => {
    const first = source('first');
    const second = source('second');
    const a = Object.assign(document.createElement('div'), {module: first.module}); a.id = 'first';
    const b = Object.assign(document.createElement('div'), {module: second.module}); b.id = 'second';
    document.body.append(a, b);
    const element = document.createElement(tag) as AnalyzerElement;
    first.hooks.connect = () => { delete first.hooks.connect; element.setAttribute('input', '#second'); };
    element.setAttribute('input', '#first');
    document.body.append(element);
    clean(first);
    expect(second.connections.size).toBe(1);
    expect(second.listeners.size).toBe(2);
    element.remove();
    clean(second);
  });

  it('preserves the reconnected lifetime when unsubscribe appends the same element', () => {
    const input = source('first');
    const element = document.createElement(tag) as AnalyzerElement;
    element.inputModule = input.module;
    document.body.append(element);
    const originalSurface = element.querySelector('[part~=surface]');
    expect(originalSurface).not.toBeNull();
    input.hooks.unsubscribe = () => {
      delete input.hooks.unsubscribe;
      document.body.append(element);
    };
    element.remove();
    expect(element.isConnected).toBe(true);
    expect(element.querySelectorAll('[part~=surface]')).toHaveLength(1);
    expect(element.querySelector('[part~=surface]')).not.toBe(originalSurface);
    expect(originalSurface!.isConnected).toBe(false);
    expect(input.listeners.size).toBe(1);
    expect(input.connections.size).toBe(1);
    element.remove();
    expect(element.querySelectorAll('[part~=surface]')).toHaveLength(0);
    clean(input);
  });

  it('keeps a new binding if the previous unsubscribe reenters the input setter', () => {
    const first = source('first'); const second = source('second'); const latest = source('latest');
    const element = document.createElement(tag) as AnalyzerElement;
    element.inputModule = first.module; document.body.append(element);
    first.hooks.unsubscribe = () => { delete first.hooks.unsubscribe; element.inputModule = latest.module; };
    element.inputModule = second.module;
    clean(first); clean(second);
    expect(latest.connections.size).toBe(1);
    element.remove(); clean(latest);
  });
});

it.each(['getPort', 'createAnalyser', 'connect'] as const)('does not publish a helper candidate after disposal inside %s', (stage) => {
  const input = source('helper');
  const host = document.createElement('div'); document.body.append(host);
  const readings: unknown[] = [];
  // No port initially; install one only after the disposer has been handed off.
  let ready = false;
  const module = {...input.module, getPort() { input.hooks.getPort?.(); return ready ? input.port : undefined; }};
  const release = bindModuleAudioInput(host, module, value => readings.push(value));
  const count = readings.length;
  input.hooks[stage] = () => { delete input.hooks[stage]; release(); };
  ready = true; input.emit();
  expect(readings).toHaveLength(count);
  clean(input);
  release();
  clean(input);
});
