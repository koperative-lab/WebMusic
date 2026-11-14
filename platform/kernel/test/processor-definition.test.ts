import {describe, expect, it} from 'vitest';
import {
  processorAudioParams, processorName, processorSignature, resolveProcessorDefinition,
  type ProcessorDefinition,
} from '../src/processor';

const gain: ProcessorDefinition = {
  id: 'test.gain',
  version: '1.0.0',
  audioInputs: [{id: 'input', channels: 2}],
  params: [
    {id: 'gain', unit: 'ratio', range: {min: 0, max: 2}, defaultValue: 1, modulation: 'audio-rate'},
    {id: 'smooth', unit: 'seconds', range: {min: 0, max: 1}, defaultValue: 0.01},
  ],
};

describe('processor definition', () => {
  it('applies defaults and freezes the result', () => {
    const resolved = resolveProcessorDefinition({id: 'test.tone', version: '1.0.0'});
    expect(resolved).toEqual({
      id: 'test.tone', version: '1.0.0', name: 'test.tone@1.0.0',
      audioInputs: [], audioOutputs: [{id: 'output', channels: 2}],
      noteInput: false, transport: false, params: [], latencySamples: 0, tailSeconds: 0,
    });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.audioOutputs)).toBe(true);
    expect(Object.isFrozen(resolved.audioOutputs[0])).toBe(true);
    expect(resolveProcessorDefinition(resolved)).toBe(resolved);
  });

  it('does not alias the author object', () => {
    const resolved = resolveProcessorDefinition(gain);
    expect(resolved.params[0]).not.toBe(gain.params![0]);
    expect(Object.isFrozen(gain)).toBe(false);
  });

  it('names a processor id@version', () => {
    expect(processorName(gain)).toBe('test.gain@1.0.0');
    expect(() => processorName({id: ' padded', version: '1'})).toThrow(TypeError);
    expect(() => processorName({id: 'a', version: ''})).toThrow(TypeError);
  });

  it('maps modulation capability to the AudioParam rate', () => {
    expect(processorAudioParams(gain)).toEqual([
      {name: 'gain', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'a-rate'},
      {name: 'smooth', defaultValue: 0.01, minValue: 0, maxValue: 1, automationRate: 'k-rate'},
    ]);
  });

  it.each<[string, Partial<ProcessorDefinition>]>([
    ['no outputs', {audioOutputs: []}],
    ['duplicate port', {audioOutputs: [{id: 'a', channels: 1}, {id: 'a', channels: 1}]}],
    ['zero channels', {audioInputs: [{id: 'in', channels: 0}]}],
    ['fractional channels', {audioInputs: [{id: 'in', channels: 1.5}]}],
    ['duplicate parameter', {params: [gain.params![0], gain.params![0]]}],
    ['inverted range', {params: [{id: 'x', unit: 'ratio', range: {min: 1, max: 0}, defaultValue: 0}]}],
    ['default outside range', {params: [{id: 'x', unit: 'ratio', range: {min: 0, max: 1}, defaultValue: 2}]}],
    ['missing unit', {params: [{id: 'x', unit: '', range: {min: 0, max: 1}, defaultValue: 0}]}],
    ['negative latency', {latencySamples: -1}],
    ['fractional latency', {latencySamples: 0.5}],
    ['negative tail', {tailSeconds: -1}],
    ['NaN tail', {tailSeconds: Number.NaN}],
  ])('rejects %s', (_name, change) => {
    expect(() => resolveProcessorDefinition({...gain, ...change})).toThrow();
  });

  it('accepts an infinite tail', () => {
    expect(resolveProcessorDefinition({...gain, tailSeconds: Infinity}).tailSeconds).toBe(Infinity);
  });

  it('gives equal signatures to equal contracts and different ones otherwise', () => {
    const signature = processorSignature(gain);
    expect(processorSignature({...gain, params: gain.params!.map(param => ({...param, label: 'ignored by the audio thread'}))})).toBe(signature);
    expect(processorSignature({...gain, noteInput: true})).not.toBe(signature);
    expect(processorSignature({...gain, audioInputs: [{id: 'input', channels: 1}]})).not.toBe(signature);
    expect(processorSignature({...gain, tailSeconds: Infinity})).not.toBe(signature);
    expect(processorSignature({...gain, params: [{...gain.params![0], range: {min: 0, max: 4}}, gain.params![1]]})).not.toBe(signature);
  });
});
