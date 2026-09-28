import {afterEach, describe, expect, it, vi} from 'vitest';
import {ScoreBuilder} from '@webmusic/score';
import {ScorePlayer} from '@webmusic/score/play/headless';
import {createAudioClip} from '@webmusic/audio';
import {AudioClipPlayer} from '@webmusic/audio/play/headless';
import {createSyncedPlayback} from '../src/sync';
import {createAudioMasteredPlayback} from '../src/audio-master';

const score = () => new ScoreBuilder().build();
const clip = () => createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1000)]});

function fakeContext() {
  return {currentTime: 0, state: 'running', close: vi.fn(async () => {})} as unknown as AudioContext;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([
  ['score master', createSyncedPlayback],
  ['audio master', createAudioMasteredPlayback],
] as const)('%s factory context ownership', (_name, create) => {
  it('closes its own context exactly once through sync.dispose()', () => {
    const context = fakeContext();
    vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
    const pair = create(score(), clip(), {driftCheckIntervalMs: 0});

    pair.sync.dispose();
    pair.sync.dispose();
    pair.scorePlayer.dispose();
    pair.clipPlayer.dispose();

    expect(context.close).toHaveBeenCalledOnce();
  });

  it('leaves a caller-supplied context open', () => {
    const context = fakeContext();
    const pair = create(score(), clip(), {context, driftCheckIntervalMs: 0});
    pair.sync.dispose();
    pair.scorePlayer.dispose();
    pair.clipPlayer.dispose();
    expect(context.close).not.toHaveBeenCalled();
  });

  it('closes the context even when a transport disposer fails', () => {
    const context = fakeContext();
    vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
    const pair = create(score(), clip(), {driftCheckIntervalMs: 0});
    const dispose = pair.clipPlayer.dispose.bind(pair.clipPlayer);
    vi.spyOn(pair.clipPlayer, 'dispose').mockImplementation(() => {
      dispose();
      throw new Error('transport cleanup failed');
    });
    const scoreDispose = vi.spyOn(pair.scorePlayer, 'dispose');

    expect(() => pair.sync.dispose()).toThrow('transport cleanup failed');
    expect(scoreDispose).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledOnce();
    expect(() => pair.sync.dispose()).not.toThrow();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it.each([false, true])('rolls back construction without closing a borrowed context (%s)', (borrowed) => {
    const context = fakeContext();
    vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
    const scoreDispose = vi.spyOn(ScorePlayer.prototype, 'dispose');
    const clipDispose = vi.spyOn(AudioClipPlayer.prototype, 'dispose');

    expect(() => create(score(), clip(), {
      ...(borrowed ? {context} : {}),
      leadInSeconds: -1,
    })).toThrow(/leadInSeconds/);
    expect(scoreDispose).toHaveBeenCalledOnce();
    expect(clipDispose).toHaveBeenCalledOnce();
    expect(context.close).toHaveBeenCalledTimes(borrowed ? 0 : 1);
  });

  it('contains rejected context cleanup and reports it to the operation observer', async () => {
    const context = fakeContext();
    const failure = new Error('close failed');
    vi.mocked(context.close).mockRejectedValue(failure);
    vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
    const onOperationError = vi.fn(() => { throw new Error('observer failed'); });
    const pair = create(score(), clip(), {driftCheckIntervalMs: 0, onOperationError});
    pair.sync.dispose();
    await Promise.resolve();
    expect(onOperationError).toHaveBeenCalledWith('context.close', failure);
  });
});
