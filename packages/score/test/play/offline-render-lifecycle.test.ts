import {afterEach, describe, expect, it, vi} from 'vitest';
import {ScoreBuilder} from '../../src/core';
import {Effect, renderScoreToBuffer, type HeadlessSynth} from '../../src/play/headless';

function fixture() {
  const output = {connect: vi.fn(), disconnect: vi.fn()};
  const effectInput = {connect: vi.fn(), disconnect: vi.fn()};
  const effectOutput = {connect: vi.fn(), disconnect: vi.fn()};
  const effectDispose = vi.fn();
  const rendered = {} as AudioBuffer;
  class OfflineContext {
    destination = {};
    createGain() { return output; }
    async startRendering() { return rendered; }
  }
  vi.stubGlobal('OfflineAudioContext', OfflineContext);
  const effect = Effect.custom({
    input: effectInput as unknown as AudioNode,
    output: effectOutput as unknown as AudioNode,
    dispose: effectDispose,
  });
  return {output, effectOutput, effectDispose, effect, rendered};
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('offline rendering resource cleanup', () => {
  it('releases the effect and owned synth when synth connection fails', async () => {
    const f = fixture();
    const failure = new Error('connect failed');
    const synth: HeadlessSynth = {noteOn() {}, connect() { throw failure; }, dispose: vi.fn()};
    await expect(renderScoreToBuffer(new ScoreBuilder().build(), {
      synth, synthOwnership: 'owned', effect: f.effect,
    })).rejects.toBe(failure);
    expect(synth.dispose).toHaveBeenCalledOnce();
    expect(f.effectDispose).toHaveBeenCalledOnce();
    expect(f.effectOutput.disconnect).toHaveBeenCalledOnce();
    expect(f.output.disconnect).toHaveBeenLastCalledWith();
  });

  it.each(['borrowed', 'owned'] as const)('finishes graph cleanup when %s synth cleanup throws', async (synthOwnership) => {
    const f = fixture();
    const failure = new Error('cleanup failed');
    const release = vi.fn(() => { throw failure; });
    const synth: HeadlessSynth = {noteOn() {}, connect: () => release, dispose: release};
    await expect(renderScoreToBuffer(new ScoreBuilder().build(), {
      synth, synthOwnership, effect: f.effect,
    })).rejects.toBe(failure);
    expect(release).toHaveBeenCalledOnce();
    expect(f.effectDispose).toHaveBeenCalledOnce();
    expect(f.output.disconnect).toHaveBeenLastCalledWith();
  });

  it('preserves preparation failure while releasing all later failing cleanups', async () => {
    const f = fixture();
    const failure = new Error('sample decode failed');
    const synth: HeadlessSynth & {preload(): Promise<void>} = {
      noteOn() {}, connect: () => () => { throw new Error('route cleanup failed'); },
      preload: async () => { throw failure; },
    };
    f.effectDispose.mockImplementation(() => { throw new Error('effect cleanup failed'); });
    await expect(renderScoreToBuffer(new ScoreBuilder().build(), {synth, effect: f.effect})).rejects.toBe(failure);
    expect(f.effectDispose).toHaveBeenCalledOnce();
    expect(f.output.disconnect).toHaveBeenLastCalledWith();
  });
});
