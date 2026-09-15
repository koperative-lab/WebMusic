import { afterEach, describe, expect, it, vi } from "vitest";
import type { Effect, EffectNode } from "../../src/play/headless/effects";
import {
  lfoWave as facadeLfoWave,
  parseSections as facadeParseSections,
} from "../../src/play/element/synth-panel";
import {SynthPanelAudioGraph} from '../../src/play/headless';
import {
  lfoWave,
  parseSections,
  type EqBand,
} from "../../src/play/element/internal/synth-panel-model";

function audioNode() {
  const connections = new Set<AudioNode>();
  return {
    connections,
    connect: vi.fn((target: AudioNode) => { connections.add(target); return target; }),
    disconnect: vi.fn((target?: AudioNode) => { if (target) connections.delete(target); else connections.clear(); }),
  } as unknown as AudioNode & {connections: Set<AudioNode>};
}

function audioContext() {
  return {
    createGain: vi.fn(() => audioNode()),
    createBiquadFilter: vi.fn(() => Object.assign(audioNode(), {
      frequency: {value: 0}, gain: {value: 0}, Q: {value: 0},
    })),
  } as unknown as AudioContext;
}

function effectFixture() {
  const node = {input: audioNode(), output: audioNode(), dispose: vi.fn()} as EffectNode;
  const effect = {build: vi.fn(() => node)} as unknown as Effect;
  return {effect, node};
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("synth-panel module boundaries", () => {
  it("keeps the historical facade pointed at the model functions", () => {
    expect(facadeParseSections).toBe(parseSections);
    expect(facadeLfoWave).toBe(lfoWave);
  });

  it("owns effects and EQ nodes as one disposable audio graph", () => {
    const input = audioNode();
    const output = audioNode();
    const wet = { value: 0.1 } as AudioParam;
    const dispose = vi.fn();
    const effectNode = {
      input,
      output,
      params: { wet },
      dispose,
    } as EffectNode;
    const effect = { build: vi.fn(() => effectNode) } as unknown as Effect;
    const boundaryIn = audioNode() as unknown as GainNode;
    const boundaryOut = audioNode() as unknown as GainNode;
    const gainIn = audioNode() as unknown as GainNode;
    const gainOut = audioNode() as unknown as GainNode;
    const filter = Object.assign(audioNode(), {
      type: "lowpass",
      frequency: { value: 0 },
      gain: { value: 0 },
      Q: { value: 0 },
    }) as unknown as BiquadFilterNode;
    const context = {
      createGain: vi
        .fn()
        .mockReturnValueOnce(boundaryIn)
        .mockReturnValueOnce(boundaryOut)
        .mockReturnValueOnce(gainIn)
        .mockReturnValueOnce(gainOut)
        .mockImplementation(() => audioNode()),
      createBiquadFilter: vi.fn(() => filter),
    } as unknown as AudioContext;
    const bands: EqBand[] = [{ frequency: 1000, gain: 3, q: 0.7 }];

    const graph = new SynthPanelAudioGraph();
    graph.rebuild({
      context,
      effects: [effect],
      bands,
      sections: ["effects", "eq"],
      effectValues: [{ wet: 0.75 }],
    });

    expect(graph.input).toBe(boundaryIn);
    expect(graph.output).toBe(boundaryOut);
    expect(boundaryIn.connect).toHaveBeenCalledWith(input);
    expect(wet.value).toBe(0.75);
    expect(output.connect).toHaveBeenCalledWith(gainIn);
    expect(gainOut.connect).toHaveBeenCalledWith(boundaryOut);
    expect(filter.frequency.value).toBe(1000);

    graph.teardown();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(graph.input).toBeUndefined();
    expect(graph.output).toBeUndefined();
  });

  it("keeps external routes connected while rebuilding the same context", () => {
    const boundaryIn = audioNode() as unknown as GainNode;
    const boundaryOut = audioNode() as unknown as GainNode;
    const firstInput = audioNode();
    const firstOutput = audioNode();
    const secondInput = audioNode();
    const secondOutput = audioNode();
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    const first = {
      build: vi.fn(() => ({
        input: firstInput,
        output: firstOutput,
        dispose: firstDispose,
      })),
    } as unknown as Effect;
    const second = {
      build: vi.fn(() => ({
        input: secondInput,
        output: secondOutput,
        dispose: secondDispose,
      })),
    } as unknown as Effect;
    const context = {
      createGain: vi
        .fn()
        .mockReturnValueOnce(boundaryIn)
        .mockReturnValueOnce(boundaryOut),
    } as unknown as AudioContext;
    const source = audioNode();
    const destination = audioNode();
    const graph = new SynthPanelAudioGraph();

    graph.rebuild({
      context,
      effects: [first],
      bands: [],
      sections: ["effects"],
      effectValues: [],
    });
    source.connect(graph.input!);
    graph.output!.connect(destination);
    const publicInput = graph.input;
    const publicOutput = graph.output;

    graph.rebuild({
      context,
      effects: [second],
      bands: [],
      sections: ["effects"],
      effectValues: [],
    });

    expect(graph.input).toBe(publicInput);
    expect(graph.output).toBe(publicOutput);
    expect(context.createGain).toHaveBeenCalledTimes(2);
    expect(source.connect).toHaveBeenCalledExactlyOnceWith(boundaryIn);
    expect(boundaryOut.connect).toHaveBeenCalledExactlyOnceWith(destination);
    expect(boundaryOut.disconnect).not.toHaveBeenCalled();
    expect(boundaryIn.connect).toHaveBeenNthCalledWith(1, firstInput);
    expect(boundaryIn.connect).toHaveBeenNthCalledWith(2, secondInput);
    expect(firstOutput.connect).toHaveBeenCalledWith(boundaryOut);
    expect(secondOutput.connect).toHaveBeenCalledWith(boundaryOut);
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(secondDispose).not.toHaveBeenCalled();
  });

  it("keeps a dry bypass between stable boundaries when no audio section is active", () => {
    const boundaryIn = audioNode() as unknown as GainNode;
    const boundaryOut = audioNode() as unknown as GainNode;
    const context = {
      createGain: vi
        .fn()
        .mockReturnValueOnce(boundaryIn)
        .mockReturnValueOnce(boundaryOut),
    } as unknown as AudioContext;
    const graph = new SynthPanelAudioGraph();

    graph.rebuild({
      context,
      effects: [],
      bands: [],
      sections: ["sound", "envelope"],
      effectValues: [],
    });
    const publicInput = graph.input;
    const publicOutput = graph.output;

    expect(publicInput).toBe(boundaryIn);
    expect(publicOutput).toBe(boundaryOut);
    expect(boundaryIn.connect).toHaveBeenCalledExactlyOnceWith(boundaryOut);

    graph.rebuild({
      context,
      effects: [],
      bands: [],
      sections: ["macros"],
      effectValues: [],
    });

    expect(graph.input).toBe(publicInput);
    expect(graph.output).toBe(publicOutput);
    expect(context.createGain).toHaveBeenCalledTimes(2);
    // Web Audio deduplicates the identical bypass edge; replacing its recipe
    // must not disconnect the edge still owned by the new snapshot.
    expect(boundaryIn.disconnect).not.toHaveBeenCalled();
    expect(boundaryIn.connect).toHaveBeenCalledTimes(2);
    expect(boundaryIn.connect).toHaveBeenLastCalledWith(boundaryOut);
  });

  it('keeps the old route audible and releases every allocated effect after a failed replacement', () => {
    const boundaryIn = audioNode();
    const boundaryOut = audioNode();
    const oldNode = {input: audioNode(), output: audioNode(), dispose: vi.fn()};
    const pendingNode = {input: audioNode(), output: audioNode(), dispose: vi.fn()};
    const failure = new Error('second effect failed');
    const context = {createGain: vi.fn().mockReturnValueOnce(boundaryIn).mockReturnValueOnce(boundaryOut)} as unknown as AudioContext;
    const graph = new SynthPanelAudioGraph();
    const options = {context, bands: [], sections: ['effects'] as const, effectValues: []};
    graph.rebuild({...options, effects: [{build: () => oldNode} as unknown as Effect]});

    expect(() => graph.rebuild({...options, effects: [
      {build: () => pendingNode} as unknown as Effect,
      {build: () => {throw failure;}} as unknown as Effect,
    ]})).toThrow(failure);

    expect(graph.input).toBe(boundaryIn);
    expect(graph.output).toBe(boundaryOut);
    expect(graph.effectNodes).toEqual([oldNode]);
    expect(oldNode.dispose).not.toHaveBeenCalled();
    expect(boundaryIn.disconnect).not.toHaveBeenCalled();
    expect(oldNode.output.disconnect).not.toHaveBeenCalled();
    expect(pendingNode.dispose).toHaveBeenCalledOnce();
    graph.teardown();
    expect(oldNode.dispose).toHaveBeenCalledOnce();
    expect(pendingNode.dispose).toHaveBeenCalledOnce();
  });

  it('rolls back a connection that commits then throws and continues cleanup after a disposer throws', () => {
    vi.useFakeTimers();
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boundaryIn = audioNode();
    const boundaryOut = audioNode();
    const context = {createGain: vi.fn().mockReturnValueOnce(boundaryIn).mockReturnValueOnce(boundaryOut)} as unknown as AudioContext;
    const graph = new SynthPanelAudioGraph();
    const options = {context, bands: [], sections: ['effects'] as const, effectValues: []};
    graph.rebuild({...options, effects: []});
    const originalFailure = new Error('connection failed');
    const links = new Set<AudioNode>();
    const first = {input: audioNode(), output: audioNode(), dispose: vi.fn()};
    const second = {input: audioNode(), output: audioNode(), dispose: vi.fn(() => {throw new Error('cleanup failed');})};
    vi.mocked(first.output.connect).mockImplementation((destination: AudioNode | AudioParam) => {
      links.add(destination as AudioNode);
      throw originalFailure;
    });
    vi.mocked(first.output.disconnect).mockImplementation((destination?: unknown) => {
      if (destination) links.delete(destination as AudioNode);
      else links.clear();
    });
    expect(() => graph.rebuild({...options, effects: [first, second].map((node) => ({build: () => node}) as unknown as Effect)})).toThrow(originalFailure);
    expect(links.size).toBe(0);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(graph.input).toBe(boundaryIn);
    expect(boundaryIn.disconnect).not.toHaveBeenCalled();
    graph.teardown();
    vi.runAllTimers();
    expect(report).toHaveBeenCalledOnce();
  });

  it('restores a reused custom effect parameter when a later builder fails', () => {
    const context = {createGain: () => audioNode()} as unknown as AudioContext;
    const gain = {value: 0.5} as AudioParam;
    const shared = {input: audioNode(), output: audioNode(), params: {gain}, dispose: vi.fn()};
    const effect = {build: () => shared} as unknown as Effect;
    const graph = new SynthPanelAudioGraph();
    const options = {context, bands: [], sections: ['effects'] as const, effectValues: [{gain: 0.5}]};
    graph.rebuild({...options, effects: [effect]});
    expect(() => graph.rebuild({...options, effectValues: [{gain: 0.75}], effects: [
      effect, {build: () => {throw new Error('failure');}} as unknown as Effect,
    ]})).toThrow('failure');
    expect(gain.value).toBe(0.5);
    expect(shared.dispose).not.toHaveBeenCalled();
    expect(shared.output.disconnect).not.toHaveBeenCalled();
    graph.teardown();
    expect(shared.dispose).toHaveBeenCalledOnce();
  });

  it('does not resurrect audio when an effect factory tears down the panel during construction', () => {
    const context = {createGain: () => audioNode()} as unknown as AudioContext;
    const graph = new SynthPanelAudioGraph();
    const options = {context, bands: [], sections: ['effects'] as const, effectValues: []};
    const old = {input: audioNode(), output: audioNode(), dispose: vi.fn()};
    const pending = {input: audioNode(), output: audioNode(), dispose: vi.fn()};
    graph.rebuild({...options, effects: [{build: () => old} as unknown as Effect]});
    expect(() => graph.rebuild({...options, effects: [{build: () => {
      graph.teardown();
      return pending;
    }} as unknown as Effect]})).toThrow('cancelled');
    expect(graph.input).toBeUndefined();
    expect(graph.output).toBeUndefined();
    expect(graph.effectNodes).toEqual([]);
    expect(old.dispose).toHaveBeenCalledOnce();
    expect(pending.dispose).toHaveBeenCalledOnce();
    graph.teardown();
    expect(pending.dispose).toHaveBeenCalledOnce();
  });

  it('keeps the previous context route when allocating the new context boundary fails', () => {
    const context = {createGain: () => audioNode()} as unknown as AudioContext;
    const graph = new SynthPanelAudioGraph();
    const options = {context, effects: [], bands: [], sections: [] as const, effectValues: []};
    graph.rebuild(options);
    const previousInput = graph.input;
    const previousOutput = graph.output;
    const pendingInput = audioNode();
    const nextContext = {createGain: vi.fn().mockReturnValueOnce(pendingInput).mockImplementationOnce(() => {throw new Error('allocation failed');})} as unknown as AudioContext;
    expect(() => graph.rebuild({...options, context: nextContext})).toThrow('allocation failed');
    expect(graph.input).toBe(previousInput);
    expect(graph.output).toBe(previousOutput);
    expect(previousInput?.disconnect).not.toHaveBeenCalled();
    expect(pendingInput.disconnect).toHaveBeenCalledOnce();
    graph.teardown();
  });
  it('keeps external connections across same-context DSP replacements and reactivation', () => {
    const graph = new SynthPanelAudioGraph();
    const context = audioContext();
    const first = effectFixture();
    const second = effectFixture();
    const options = {context, effects: [first.effect], bands: [], sections: ['effects'] as const, effectValues: []};
    graph.rebuild(options);
    const input = graph.input!;
    const output = graph.output!;
    const source = audioNode();
    const destination = audioNode();
    source.connect(input);
    output.connect(destination);

    graph.rebuild({...options, effects: [second.effect]});
    expect(graph.input).toBe(input);
    expect(graph.output).toBe(output);
    expect(source.connections.has(input)).toBe(true);
    expect((output as ReturnType<typeof audioNode>).connections.has(destination)).toBe(true);
    expect((input as ReturnType<typeof audioNode>).connections).toEqual(new Set([second.node.input]));
    expect(first.node.dispose).toHaveBeenCalledOnce();

    graph.rebuild({...options, sections: ['sound']});
    // Main's public empty-path contract keeps the stable dry route audible.
    expect(graph.input).toBe(input);
    expect(graph.output).toBe(output);
    expect((input as ReturnType<typeof audioNode>).connections).toEqual(new Set([output]));
    const third = effectFixture();
    graph.rebuild({...options, effects: [third.effect]});
    expect(graph.input).toBe(input);
    expect(graph.output).toBe(output);
    expect((output as ReturnType<typeof audioNode>).connections.has(destination)).toBe(true);
    graph.teardown();
    graph.teardown();
    expect(third.node.dispose).toHaveBeenCalledOnce();
    expect((output as ReturnType<typeof audioNode>).connections.size).toBe(0);
  });

  it('retains the usable graph and releases every completed candidate after a later build fails', () => {
    const graph = new SynthPanelAudioGraph();
    const current = effectFixture();
    const partial = effectFixture();
    const options = {context: audioContext(), effects: [current.effect], bands: [], sections: ['effects'] as const, effectValues: []};
    graph.rebuild(options);
    const input = graph.input;
    const output = graph.output;
    const error = new Error('cannot build second effect');
    const failing = {build: () => { throw error; }} as unknown as Effect;
    vi.mocked(partial.node.dispose!).mockImplementation(() => { throw new Error('cleanup also failed'); });

    expect(() => graph.rebuild({...options, effects: [partial.effect, failing]})).toThrow(error);
    expect(graph.input).toBe(input);
    expect(graph.output).toBe(output);
    expect(graph.effectNodes).toEqual([current.node]);
    expect((input as ReturnType<typeof audioNode>).connections.has(current.node.input)).toBe(true);
    expect(current.node.dispose).not.toHaveBeenCalled();
    expect(partial.node.input.disconnect).toHaveBeenCalled();
    expect(partial.node.output.disconnect).toHaveBeenCalled();
    expect(partial.node.dispose).toHaveBeenCalledOnce();
    graph.teardown();
  });

  it('rolls back candidate wiring failures without removing the current route', () => {
    const graph = new SynthPanelAudioGraph();
    const current = effectFixture();
    const candidate = effectFixture();
    const options = {context: audioContext(), effects: [current.effect], bands: [], sections: ['effects'] as const, effectValues: []};
    graph.rebuild(options);
    const input = graph.input;
    vi.mocked(candidate.node.output.connect).mockImplementation(() => { throw new Error('connection failed'); });
    expect(() => graph.rebuild({...options, effects: [candidate.effect]})).toThrow('connection failed');
    expect(graph.effectNodes).toEqual([current.node]);
    expect((input as ReturnType<typeof audioNode>).connections.has(current.node.input)).toBe(true);
    expect(candidate.node.dispose).toHaveBeenCalledOnce();
    graph.teardown();
  });

  it('keeps the old context on failed replacement and releases partially created ports', () => {
    const graph = new SynthPanelAudioGraph();
    const current = effectFixture();
    const candidate = effectFixture();
    const options = {context: audioContext(), effects: [current.effect], bands: [], sections: ['effects'] as const, effectValues: []};
    graph.rebuild(options);
    const input = graph.input;
    const nextContext = audioContext();
    const partialPort = audioNode();
    vi.mocked(nextContext.createGain).mockReturnValueOnce(partialPort as unknown as GainNode).mockImplementationOnce(() => { throw new Error('port allocation failed'); });
    expect(() => graph.rebuild({...options, context: nextContext, effects: [candidate.effect]})).toThrow('port allocation failed');
    expect(graph.input).toBe(input);
    expect(partialPort.disconnect).toHaveBeenCalled();
    // Boundary allocation precedes effect construction; no candidate exists yet.
    expect(candidate.effect.build).not.toHaveBeenCalled();
    expect(candidate.node.dispose).not.toHaveBeenCalled();
    expect(current.node.dispose).not.toHaveBeenCalled();
    graph.teardown();
  });

  it('does not revive a graph torn down reentrantly by a candidate builder', () => {
    const graph = new SynthPanelAudioGraph();
    const candidate = effectFixture();
    vi.mocked(candidate.effect.build).mockImplementation(() => { graph.teardown(); return candidate.node; });
    expect(() => graph.rebuild({context: audioContext(), effects: [candidate.effect], bands: [], sections: ['effects'], effectValues: []})).toThrow('cancelled');
    expect(graph.input).toBeUndefined();
    expect(graph.effectNodes).toEqual([]);
    expect(candidate.node.dispose).toHaveBeenCalledOnce();
  });

  it('attempts all teardown even when one effect disposer throws', () => {
    const graph = new SynthPanelAudioGraph();
    const first = effectFixture();
    const second = effectFixture();
    graph.rebuild({context: audioContext(), effects: [first.effect, second.effect], bands: [], sections: ['effects'], effectValues: []});
    const output = graph.output!;
    vi.mocked(first.node.dispose!).mockImplementation(() => { throw new Error('dispose failed'); });
    expect(() => graph.teardown()).toThrow('dispose failed');
    expect(second.node.dispose).toHaveBeenCalledOnce();
    expect(output.disconnect).toHaveBeenCalled();
    expect(graph.input).toBeUndefined();
    expect(() => graph.teardown()).not.toThrow();
  });
});
