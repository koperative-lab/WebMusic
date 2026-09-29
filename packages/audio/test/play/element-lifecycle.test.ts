import {afterEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip} from '../../src/core';
import {AudioMixer} from '../../src/play/headless/mixer';
import {AudioMixerElement} from '../../src/play/element/audio-mixer';
import {AudioMeterElement} from '../../src/analyze/element/audio-meter';

function installElementSurface<T extends object>(element: T) {
  const target = element as unknown as Record<string, unknown>;
  target.isConnected = false;
  target.getAttribute = () => null;
  target.attachShadow = () => ({
    innerHTML: '',
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  target.dispatchEvent = () => true;
  return {
    connect() {
      target.isConnected = true;
    },
    disconnect() {
      target.isConnected = false;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('audio element resource ownership', () => {
  it('rebuilds an owned mixer after a disconnect/reconnect cycle', () => {
    const contexts: Array<{close: ReturnType<typeof vi.fn>}> = [];
    class FakeAudioContext {
      state = 'running';
      destination = {};
      close = vi.fn(async () => {});
      constructor() {
        contexts.push(this);
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const element = new AudioMixerElement();
    const connection = installElementSurface(element);
    const clip = createAudioClip({sampleRate: 8_000, channelData: [new Float32Array(8)]});
    element.members = [{id: 'voice', clip}];

    connection.connect();
    element.connectedCallback();
    const first = element.mixer;
    expect(first).toBeInstanceOf(AudioMixer);

    connection.disconnect();
    element.disconnectedCallback();
    expect(element.mixer).toBeUndefined();
    expect(contexts[0]!.close).toHaveBeenCalledTimes(1);

    connection.connect();
    element.connectedCallback();
    expect(element.mixer).toBeInstanceOf(AudioMixer);
    expect(element.mixer).not.toBe(first);
    expect(element.mixer?.ids()).toEqual(['voice']);
  });

  it('does not dispose an externally-owned mixer on disconnect', () => {
    const element = new AudioMixerElement();
    const connection = installElementSurface(element);
    const mixer = new AudioMixer();
    const dispose = vi.spyOn(mixer, 'dispose');
    element.mixer = mixer;

    connection.connect();
    element.connectedCallback();
    connection.disconnect();
    element.disconnectedCallback();
    connection.connect();
    element.connectedCallback();

    expect(dispose).not.toHaveBeenCalled();
    expect(element.mixer).toBe(mixer);
  });

  it('tears down and rebuilds a meter-owned graph, but never disconnects an injected analyser', () => {
    const gains: Array<{connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>}> = [];
    const analysers: Array<{
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      fftSize: number;
      smoothingTimeConstant: number;
    }> = [];
    const makeNode = () => ({connect: vi.fn(), disconnect: vi.fn()});
    const context = {
      createGain: vi.fn(() => {
        const gain = makeNode();
        gains.push(gain);
        return gain;
      }),
      createAnalyser: vi.fn(() => {
        const analyser = {...makeNode(), fftSize: 0, smoothingTimeConstant: 0};
        analysers.push(analyser);
        return analyser;
      }),
    } as unknown as BaseAudioContext;
    const element = new AudioMeterElement();
    const connection = installElementSurface(element);
    element.context = context;
    const firstInput = element.input;

    connection.connect();
    element.connectedCallback();
    connection.disconnect();
    element.disconnectedCallback();
    expect(gains[0]!.disconnect).toHaveBeenCalledTimes(1);
    expect(gains[1]!.disconnect).toHaveBeenCalledTimes(1);
    expect(analysers[0]!.disconnect).toHaveBeenCalledTimes(1);

    connection.connect();
    element.connectedCallback();
    expect(element.input).toBeDefined();
    expect(element.input).not.toBe(firstInput);

    const external = {
      ...makeNode(),
      fftSize: 1024,
      frequencyBinCount: 512,
      getByteFrequencyData: vi.fn(),
      getByteTimeDomainData: vi.fn(),
    } as unknown as AnalyserNode;
    element.analyser = external;
    expect(element.context).toBeUndefined();
    expect(element.analyser).toBe(external);
    expect(external.disconnect).not.toHaveBeenCalled();

    connection.disconnect();
    element.disconnectedCallback();
    expect(external.disconnect).not.toHaveBeenCalled();
  });

  it('changes meter mode and bars without rebuilding its audio graph', () => {
    const makeNode = () => ({connect: vi.fn(), disconnect: vi.fn()});
    const context = {
      createGain: vi.fn(makeNode),
      createAnalyser: vi.fn(() => ({
        ...makeNode(),
        fftSize: 0,
        smoothingTimeConstant: 0,
        frequencyBinCount: 512,
        getByteFrequencyData: vi.fn(),
        getByteTimeDomainData: vi.fn(),
      })),
    } as unknown as BaseAudioContext;
    const element = new AudioMeterElement();
    const connection = installElementSurface(element);
    element.context = context;
    connection.connect();
    element.connectedCallback();

    element.attributeChangedCallback();
    element.attributeChangedCallback();

    expect(context.createGain).toHaveBeenCalledTimes(2);
    expect(context.createAnalyser).toHaveBeenCalledOnce();
    connection.disconnect();
    element.disconnectedCallback();
  });
});
