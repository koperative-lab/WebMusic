import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createAudioClip, type AudioClip} from '../../src/core';
import {
  AudioPlaylist,
  createAudioPlaylist,
  type AudioPlaylistEntry,
  type AudioPlaylistOptions,
} from '../../src/play/headless/playlist';


// ---------------------------------------------------------------------------
// One fake AudioContext for the whole queue: the point of the controller is
// that N entries share exactly one, so the tests count node creation on it.
// ---------------------------------------------------------------------------
interface FakeSource {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
  loop: boolean;
}

function fakeContext() {
  const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
  const sources: FakeSource[] = [];
  const closed = vi.fn(async () => {});
  const context = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: node(),
    resume: vi.fn(async () => {}),
    close: closed,
    createGain: vi.fn(() => ({...node(), gain: {value: 1}})),
    createStereoPanner: vi.fn(() => ({...node(), pan: {value: 0}})),
    createAnalyser: vi.fn(() => ({...node(), fftSize: 0, smoothingTimeConstant: 0})),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: vi.fn(() => {
      const source = {
        ...node(),
        buffer: null as unknown,
        playbackRate: {value: 1},
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        onended: null as (() => void) | null,
        start: vi.fn(),
        stop: vi.fn(),
      };
      sources.push(source);
      return source;
    }),
  } as unknown as AudioContext;
  return {context, sources, closed};
}

function clip(seconds = 1): AudioClip {
  return createAudioClip({
    sampleRate: 1_000,
    channelData: [new Float32Array(seconds * 1_000)],
  });
}

/** End the currently sounding source, the way the buffer engine reports it. */
function endCurrentTrack(sources: ReturnType<typeof fakeContext>['sources']): void {
  const source = sources[sources.length - 1];
  source?.onended?.();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AudioPlaylist queue', () => {
  it('createAudioPlaylist builds a controller and starts at the first entry', () => {
    const queue = createAudioPlaylist({
      entries: [
        {id: 'a', clip: clip()},
        {id: 'b', clip: clip()},
      ],
    });

    expect(queue).toBeInstanceOf(AudioPlaylist);
    expect(queue.index).toBe(0);
    expect(queue.current?.id).toBe('a');
    expect(queue.entries).toHaveLength(2);
  });

  it('drops entries with no id and de-duplicates repeats', () => {
    const queue = createAudioPlaylist({
      entries: [
        {id: 'a', clip: clip()},
        {id: '', clip: clip()},
        {id: 'a', clip: clip()},
      ],
    });

    expect(queue.entries.map((entry) => entry.id)).toEqual(['a']);
  });

  it('plays every entry through ONE AudioContext', async () => {
    const {context} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      entries: [
        {id: 'a', clip: clip()},
        {id: 'b', clip: clip()},
      ],
    });

    await queue.play();
    await queue.next();

    // Two entries, two players — but the context was supplied, so nothing
    // minted another and nothing closed it out from under the second track.
    expect(context.close).not.toHaveBeenCalled();
    expect(queue.index).toBe(1);
    expect(queue.playing).toBe(true);
  });

  it('advances to the next entry when one ends', async () => {
    const {context, sources} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      entries: [
        {id: 'a', clip: clip()},
        {id: 'b', clip: clip()},
      ],
    });
    const changes: string[] = [];
    queue.on('trackchange', ({id}) => changes.push(id));
    const ended: string[] = [];
    queue.on('trackend', ({id}) => ended.push(id));

    await queue.play();
    endCurrentTrack(sources);
    await vi.waitFor(() => expect(queue.index).toBe(1));

    expect(ended).toEqual(['a']);
    expect(changes).toEqual(['a', 'b']);
  });

  it('never sets loop on the track player', async () => {
    const {context, sources} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      loop: true,
      entries: [
        {id: 'a', clip: clip()},
        {id: 'b', clip: clip()},
      ],
    });

    await queue.play();

    // The buffer engine suppresses its ended callback while looping, so a
    // looping track player would wedge the queue forever. List loop is the
    // controller's job, and this is the assertion that keeps it that way.
    expect(sources.every((source) => source.loop === false)).toBe(true);
  });

  it('wraps to the first entry at the end when the list loops', async () => {
    const {context, sources} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      loop: true,
      entries: [
        {id: 'a', clip: clip()},
        {id: 'b', clip: clip()},
      ],
    });
    const finished = vi.fn();
    queue.on('playlistend', finished);

    await queue.play();
    await queue.next();
    endCurrentTrack(sources);
    await vi.waitFor(() => {
      expect(queue.index).toBe(0);
      expect(queue.playing).toBe(true);
    });

    expect(finished).not.toHaveBeenCalled();
  });

  it('emits playlistend after the last entry when it does not loop', async () => {
    const {context, sources} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      entries: [{id: 'only', clip: clip()}],
    });
    const finished = vi.fn();
    queue.on('playlistend', finished);

    await queue.play();
    endCurrentTrack(sources);
    await vi.waitFor(() => expect(finished).toHaveBeenCalledTimes(1));

    expect(queue.playing).toBe(false);
  });

  it('select and previous move without wrapping unless the list loops', async () => {
    const {context} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      entries: [
        {id: 'a', clip: clip()},
        {id: 'b', clip: clip()},
        {id: 'c', clip: clip()},
      ],
    });

    await queue.select('c');
    expect(queue.index).toBe(2);
    await queue.next();
    expect(queue.index).toBe(2);

    await queue.previous();
    expect(queue.index).toBe(1);
    await queue.select(0);
    await queue.previous();
    expect(queue.index).toBe(0);
  });

  it('keeps playing across a track change and stays paused when it was paused', async () => {
    const {context} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      entries: [
        {id: 'a', clip: clip()},
        {id: 'b', clip: clip()},
      ],
    });

    await queue.select('b');
    expect(queue.playing).toBe(false);

    await queue.play();
    expect(queue.playing).toBe(true);
    await queue.select('a');
    expect(queue.playing).toBe(true);
  });

  it('applies seeks made after selecting a paused entry before its player exists', async () => {
    const {context, sources} = fakeContext();
    const queue = createAudioPlaylist({audioContext: context, entries: [
      {id: 'a', clip: clip(10)}, {id: 'b', clip: clip(10)},
    ]});

    await queue.select('b');
    expect(queue.activePlayer).toBeUndefined();
    queue.seek(5);
    expect(queue.seconds).toBe(5);
    await queue.play();
    expect(queue.seconds).toBe(5);
    expect(sources.at(-1)?.start).toHaveBeenCalledWith(expect.any(Number), 5);

    queue.pause();
    await queue.select('a');
    queue.seekFraction(0.25);
    expect(queue.seconds).toBe(2.5);
    await queue.play();
    expect(queue.seconds).toBe(2.5);
    expect(sources.at(-1)?.start).toHaveBeenCalledWith(expect.any(Number), 2.5);
    queue.dispose();
  });

  it('resolves a queued fractional seek after loading a URL entry', async () => {
    const {context, sources} = fakeContext();
    let finishLoad!: (value: AudioClip) => void;
    const queue = createAudioPlaylist({
      audioContext: context,
      entries: [{id: 'remote', src: '/remote.wav'}],
      loadEntry: () => new Promise<AudioClip>((resolve) => { finishLoad = resolve; }),
    });

    const starting = queue.play();
    await vi.waitFor(() => expect(queue.statusOf('remote')).toBe('loading'));
    queue.seekFraction(0.4);
    finishLoad(clip(10));
    await starting;

    expect(queue.seconds).toBe(4);
    expect(sources.at(-1)?.start).toHaveBeenCalledWith(expect.any(Number), 4);
    queue.dispose();
  });

  it('loads a src entry through the shared context and reports its status', async () => {
    const {context} = fakeContext();
    const loaded = clip();
    const spy = vi.fn(async (_entry: AudioPlaylistEntry, _context: AudioContext) => loaded);
    const queue = createAudioPlaylist({
      audioContext: context,
      prefetch: false,
      loadEntry: spy,
      entries: [{id: 'a', src: 'https://example.test/a.mp3'}],
    });
    const statuses: string[] = [];
    queue.on('statuschange', ({status}) => statuses.push(status));

    await queue.play();

    expect(spy).toHaveBeenCalledTimes(1);
    // Without a context the decoder skips native decodeAudioData entirely and
    // demands a WASM peer for formats the browser handles natively.
    expect(spy.mock.calls[0]![1]).toBe(context);
    expect(statuses).toEqual(['loading', 'ready']);
    expect(queue.clipOf('a')).toBe(loaded);
  });

  it('prefetches the next entry while the current one plays', async () => {
    const {context} = fakeContext();
    const spy = vi.fn(async (_entry: AudioPlaylistEntry, _context: AudioContext) => clip());
    const queue = createAudioPlaylist({
      audioContext: context,
      loadEntry: spy,
      entries: [
        {id: 'a', clip: clip()},
        {id: 'b', src: 'https://example.test/b.mp3'},
      ],
    });

    await queue.play();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![0]!.src).toBe('https://example.test/b.mp3');
    expect(queue.statusOf('b')).toBe('ready');
  });

  it('skips an entry that fails to load instead of wedging the queue', async () => {
    const {context} = fakeContext();
    const failure = new Error('404');
    const queue = createAudioPlaylist({
      audioContext: context,
      loadEntry: () => Promise.reject(failure),
      entries: [
        {id: 'broken', src: 'https://example.test/missing.mp3'},
        {id: 'good', clip: clip()},
      ],
    });
    const errors: Error[] = [];
    queue.on('error', (error) => errors.push(error));

    await queue.play();
    await vi.waitFor(() => expect(queue.index).toBe(1));

    expect(queue.statusOf('broken')).toBe('error');
    expect(errors).toContain(failure);
    expect(queue.playing).toBe(true);
  });

  it('reports a src entry when no loader was supplied', async () => {
    const {context} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      skipFailed: false,
      entries: [{id: 'a', src: 'https://example.test/a.mp3'}],
    });
    const errors: Error[] = [];
    queue.on('error', (error) => errors.push(error));

    await queue.play();

    // The headless layer may not import play/api, so loading is injected —
    // the same shape the media engine uses for its adapter factory.
    expect(errors[0]!.message).toMatch(/needs a loader/);
    expect(queue.statusOf('a')).toBe('error');
  });

  it('reports an entry that carries neither clip nor src', async () => {
    const {context} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      skipFailed: false,
      entries: [{id: 'empty'}],
    });
    const errors: Error[] = [];
    queue.on('error', (error) => errors.push(error));

    await queue.play();

    expect(errors[0]!.message).toMatch(/neither clip nor src/);
    expect(queue.statusOf('empty')).toBe('error');
  });

  it('carries a resolved clip across a setEntries re-render', async () => {
    const {context} = fakeContext();
    const resolved = clip();
    const queue = createAudioPlaylist({
      audioContext: context,
      prefetch: false,
      loadEntry: async () => resolved,
      entries: [{id: 'a', src: 'https://example.test/a.mp3'}],
    });

    await queue.play();
    queue.setEntries([
      {id: 'a', src: 'https://example.test/a.mp3', label: 'renamed'},
      {id: 'b', clip: clip()},
    ]);

    expect(queue.clipOf('a')).toBe(resolved);
    expect(queue.current?.label).toBe('renamed');
    expect(queue.index).toBe(0);
    expect(queue.playing).toBe(true);
  });

  it('stops when the playing entry is removed from the queue', async () => {
    const {context} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      entries: [
        {id: 'a', clip: clip()},
        {id: 'b', clip: clip()},
      ],
    });

    await queue.play();
    queue.setEntries([{id: 'b', clip: clip()}]);

    expect(queue.playing).toBe(false);
    expect(queue.current?.id).toBe('b');
  });

  it('applies volume and rate to the entry that is playing', async () => {
    const {context} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      entries: [{id: 'a', clip: clip()}],
    });

    await queue.play();
    queue.setVolume(0.25);
    queue.setRate(2);

    expect(queue.activePlayer).toBeDefined();
    expect(queue.duration).toBeGreaterThan(0);
  });

  it('closes only a context it created itself', () => {
    const {context, closed} = fakeContext();
    const borrowed = createAudioPlaylist({audioContext: context, entries: [{id: 'a', clip: clip()}]});

    borrowed.dispose();
    expect(closed).not.toHaveBeenCalled();
  });

  it('is inert after dispose', async () => {
    const {context} = fakeContext();
    const queue = createAudioPlaylist({
      audioContext: context,
      entries: [{id: 'a', clip: clip()}],
    });

    await queue.play();
    queue.dispose();
    await queue.play();

    expect(queue.playing).toBe(false);
    expect(queue.activePlayer).toBeUndefined();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {promise, resolve, reject};
}

describe('AudioPlaylist asynchronous transitions', () => {
  const queues: AudioPlaylist[] = [];
  const makeQueue = (options: AudioPlaylistOptions) => {
    const queue = new AudioPlaylist(options);
    queues.push(queue);
    return queue;
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const queue of queues.splice(0)) queue.dispose();
    vi.useRealTimers();
  });

  it.each(['rejection', 'synchronous throw', 'missing source', 'missing loader'])(
    'stops after one failed pass with %s, while allowing an explicit retry',
    async (failure) => {
      const {context} = fakeContext();
      const loadEntry = vi.fn(() => {
        if (failure === 'synchronous throw') throw new Error('404');
        return Promise.reject(new Error('404'));
      });
      const queue = makeQueue({
        audioContext: context,
        loop: true,
        prefetch: false,
        entries: ['a', 'b'].map((id) => ({
          id,
          ...(failure === 'missing source' ? {} : {src: `${id}.mp3`}),
        })),
        ...(failure === 'missing loader' ? {} : {loadEntry}),
      });
      const errors = vi.fn();
      queue.on('error', (error) => {
        errors(error);
        // Bound the regression itself: the broken implementation must fail
        // an assertion rather than monopolize the test runner indefinitely.
        if (errors.mock.calls.length > 6) queue.stop();
      });

      await queue.play();
      expect(errors).toHaveBeenCalledTimes(2);
      expect(queue.playing).toBe(false);
      expect(queue.statusOf('a')).toBe('error');
      expect(queue.statusOf('b')).toBe('error');
      await queue.play();
      expect(errors).toHaveBeenCalledTimes(4);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(['stop', 'dispose'] as const)('shares concurrent/reentrant starts and releases every source on %s', async (operation) => {
    const {context, sources} = fakeContext();
    const loaded = deferred<AudioClip>();
    const loadEntry = vi.fn(() => loaded.promise);
    const queue = makeQueue({audioContext: context, prefetch: false, entries: [{id: 'a', src: 'a.wav'}], loadEntry});
    const changes = vi.fn();
    let reentrant: Promise<void> | undefined;
    queue.on('statuschange', ({status}) => {
      if (status === 'loading') reentrant = queue.play();
    });
    queue.on('trackchange', changes);

    const first = queue.play();
    const second = queue.play();
    await Promise.resolve();
    expect(loadEntry).toHaveBeenCalledTimes(1);
    loaded.resolve(clip());
    await Promise.all([first, second, reentrant]);
    expect(sources).toHaveLength(1);
    expect(changes).toHaveBeenCalledTimes(1);

    queue[operation]();
    expect(sources.every((source) => source.stop.mock.calls.length === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('allows a playlistend listener to retry after its loader recovers', async () => {
    const {context} = fakeContext();
    let recovered = false;
    const queue = makeQueue({
      audioContext: context,
      entries: [{id: 'a', src: 'a.wav'}],
      loadEntry: async () => {
        if (!recovered) throw new Error('temporarily unavailable');
        return clip();
      },
    });
    let retry: Promise<void> | undefined;
    queue.on('playlistend', () => {
      if (recovered) return;
      recovered = true;
      retry = queue.play();
    });
    await queue.play();
    await retry;
    expect(queue.playing).toBe(true);
    expect(queue.statusOf('a')).toBe('ready');
  });

  it('discards a removed current entry when its old load completes', async () => {
    const {context, sources} = fakeContext();
    const loaded = deferred<AudioClip>();
    const queue = makeQueue({audioContext: context, prefetch: false, entries: [{id: 'old', src: 'old.wav'}], loadEntry: () => loaded.promise});
    const pending = queue.play();
    await Promise.resolve();
    queue.setEntries([{id: 'new', clip: clip(3)}]);
    loaded.resolve(clip(1));
    await pending;
    expect(queue.activePlayer).toBeUndefined();
    expect(sources).toHaveLength(0);

    await queue.play();
    expect(queue.current?.id).toBe('new');
    expect(queue.currentClip?.duration).toBe(3);
    expect(queue.activePlayer?.duration).toBe(3);
  });

  it('replaces an active source with the same id and preserves playback intent', async () => {
    const {context, sources} = fakeContext();
    const queue = makeQueue({audioContext: context, entries: [{id: 'a', clip: clip(1)}]});
    await queue.play();
    const oldPlayer = queue.activePlayer;
    queue.setEntries([{id: 'a', clip: clip(3)}]);
    await queue.play();
    expect(queue.activePlayer).not.toBe(oldPlayer);
    expect(oldPlayer?.playing).toBe(false);
    expect(sources[0]!.stop).toHaveBeenCalledTimes(1);
    expect(queue.currentClip?.duration).toBe(3);
    expect(queue.activePlayer?.duration).toBe(3);
    expect(queue.playing).toBe(true);
  });

  it('does not let an old URL load overwrite a replacement using the same id', async () => {
    const {context} = fakeContext();
    const oldLoad = deferred<AudioClip>();
    const newLoad = deferred<AudioClip>();
    const queue = makeQueue({
      audioContext: context,
      prefetch: false,
      entries: [{id: 'a', src: 'old.wav'}],
      loadEntry: (entry) => entry.src === 'old.wav' ? oldLoad.promise : newLoad.promise,
    });
    const oldPlay = queue.play();
    await Promise.resolve();
    queue.setEntries([{id: 'a', src: 'new.wav'}]);
    const newPlay = queue.play();
    oldLoad.resolve(clip(1));
    await oldPlay;
    expect(queue.activePlayer).toBeUndefined();
    expect(queue.statusOf('a')).toBe('loading');
    newLoad.resolve(clip(3));
    await newPlay;
    expect(queue.currentClip?.duration).toBe(3);
    expect(queue.activePlayer?.duration).toBe(3);
  });

  it.each([false, true])('keeps a pending state across a label change (prefetch=%s)', async (prefetch) => {
    const {context} = fakeContext();
    const loaded = deferred<AudioClip>();
    const loadEntry = vi.fn(() => loaded.promise);
    const first = {id: 'first', clip: clip()};
    const queue = makeQueue({audioContext: context, loadEntry, entries: [...(prefetch ? [first] : []), {id: 'a', src: 'a.wav'}]});
    const pending = queue.play();
    if (prefetch) await pending;
    await Promise.resolve();
    expect(loadEntry).toHaveBeenCalledTimes(1);
    queue.setEntries([...(prefetch ? [first] : []), {id: 'a', src: 'a.wav', label: 'renamed'}]);
    const resolved = clip(3);
    loaded.resolve(resolved);
    if (prefetch) await queue.next();
    else await pending;
    expect(queue.current?.label).toBe('renamed');
    expect(queue.statusOf('a')).toBe('ready');
    expect(queue.currentClip).toBe(resolved);
    expect(queue.playing).toBe(true);
    expect(loadEntry).toHaveBeenCalledTimes(1);
  });

  it('honors a stop and fresh play while sharing the pending load', async () => {
    const {context, sources} = fakeContext();
    const loaded = deferred<AudioClip>();
    const loadEntry = vi.fn(() => loaded.promise);
    const queue = makeQueue({audioContext: context, prefetch: false, entries: [{id: 'a', src: 'a.wav'}], loadEntry});
    const oldPlay = queue.play();
    await Promise.resolve();
    queue.stop();
    const newPlay = queue.play();
    loaded.resolve(clip());
    await Promise.all([oldPlay, newPlay]);
    expect(sources).toHaveLength(1);
    expect(loadEntry).toHaveBeenCalledTimes(1);
    expect(queue.playing).toBe(true);
  });

  it('honors trackchange and trackend listeners that stop the queue', async () => {
    const {context, sources} = fakeContext();
    const queue = makeQueue({audioContext: context, entries: [{id: 'a', clip: clip()}, {id: 'b', clip: clip()}]});
    const onChange = () => queue.stop();
    queue.on('trackchange', onChange);
    await queue.play();
    expect(sources).toHaveLength(0);
    queue.off('trackchange', onChange);
    await queue.play();
    queue.on('trackend', () => queue.stop());
    endCurrentTrack(sources);
    await Promise.resolve();
    expect(queue.current?.id).toBe('a');
    expect(queue.playing).toBe(false);
  });

  it('allows a ready listener to replace the entry before its player is installed', async () => {
    const {context, sources} = fakeContext();
    const queue = makeQueue({audioContext: context, prefetch: false, entries: [{id: 'a', src: 'old.wav'}], loadEntry: async () => clip(1)});
    let replacement: Promise<void> | undefined;
    queue.on('statuschange', ({status}) => {
      if (status === 'ready') {
        queue.setEntries([{id: 'a', clip: clip(3)}]);
        replacement = queue.play();
      }
    });
    await queue.play();
    await replacement;
    expect(sources).toHaveLength(1);
    expect(queue.currentClip?.duration).toBe(3);
    expect(queue.activePlayer?.duration).toBe(3);
  });
});


describe('AudioPlaylist selection validation and live policies', () => {
  const queues: AudioPlaylist[] = [];
  function makeQueue(options: AudioPlaylistOptions): AudioPlaylist {
    const queue = new AudioPlaylist(options);
    queues.push(queue);
    return queue;
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const queue of queues.splice(0)) queue.dispose();
    vi.useRealTimers();
  });

  it('rejects invalid selections before changing a playing entry or its position', async () => {
    const {context} = fakeContext();
    const queue = makeQueue({audioContext: context, entries: [
      {id: 'a', clip: clip()}, {id: 'b', clip: clip()},
    ]});
    await queue.select('b');
    await queue.play();
    queue.seek(0.3);
    const player = queue.activePlayer;
    for (const invalid of ['missing', -1, 2, 0.5, NaN, Infinity]) {
      await expect(queue.select(invalid)).rejects.toBeInstanceOf(RangeError);
      expect(queue.index).toBe(1);
      expect(queue.activePlayer).toBe(player);
      expect(queue.playing).toBe(true);
      expect(queue.seconds).toBeCloseTo(0.3);
    }
  });

  it('applies loop changes at the next boundary without replacing the player', async () => {
    const {context, sources} = fakeContext();
    const queue = makeQueue({audioContext: context, prefetch: false, entries: [
      {id: 'a', clip: clip()}, {id: 'b', clip: clip()},
    ]});
    await queue.select('b');
    await queue.play();
    queue.seek(0.3);
    const player = queue.activePlayer;
    queue.setLoop(true);
    expect(queue.activePlayer).toBe(player);
    expect(queue.seconds).toBeCloseTo(0.3);
    endCurrentTrack(sources);
    await vi.waitFor(() => expect(queue.current?.id).toBe('a'));
    queue.setLoop(false);
    await queue.select('b');
    const ended = vi.fn();
    queue.on('playlistend', ended);
    endCurrentTrack(sources);
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
  });

  it('enables prefetch in place and retains an in-flight result after disabling', async () => {
    const {context} = fakeContext();
    const pending = deferred<AudioClip>();
    const loaded = clip(2);
    const loader = vi.fn(() => pending.promise);
    const queue = makeQueue({audioContext: context, prefetch: false, loadEntry: loader, entries: [
      {id: 'a', clip: clip()}, {id: 'b', src: 'b.wav'},
    ]});
    await queue.play();
    const player = queue.activePlayer;
    queue.seek(0.2);
    expect(loader).not.toHaveBeenCalled();
    queue.setPrefetch(true);
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);
    queue.setPrefetch(false);
    pending.resolve(loaded);
    await vi.waitFor(() => expect(queue.clipOf('b')).toBe(loaded));
    expect(queue.activePlayer).toBe(player);
    expect(queue.seconds).toBeCloseTo(0.2);
    await queue.next();
    expect(queue.currentClip).toBe(loaded);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('uses the latest skip-failed policy for a pending load without rebuilding entries', async () => {
    const {context} = fakeContext();
    let reject!: (error: Error) => void;
    const pending = new Promise<AudioClip>((_resolve, onReject) => { reject = onReject; });
    const queue = makeQueue({audioContext: context, prefetch: false, loadEntry: () => pending, entries: [
      {id: 'a', src: 'a.wav'}, {id: 'b', clip: clip()},
    ]});
    const playing = queue.play();
    queue.setSkipFailed(false);
    reject(new Error('404'));
    await playing;
    expect(queue.index).toBe(0);
    expect(queue.playing).toBe(false);
    await queue.select('b');
    expect(queue.activePlayer).toBeUndefined();
    queue.setSkipFailed(true);
    await queue.select('a');
    await queue.play();
    expect(queue.current?.id).toBe('b');
    expect(queue.playing).toBe(true);
  });
});
