import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  createAudioClip, createMemoryAudioAssetStore, createAudioSequence, createAudioPositionMap,
  type AudioDocumentSnapshot, type AudioDocumentSource, type AudioPositionStep, type AudioSequence, type AudioAssetSegment,
} from '../../src/core';
import {AudioPlayer} from '../../src/play/headless/audio-player';
import {AudioSequenceEngine} from '../../src/play/headless/sequence-engine';

const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
function context() {
  const buffers: AudioBuffer[] = [];
  const sources: Array<AudioBufferSourceNode & {starts: number[][]}> = [];
  const ctx = {
    state: 'running', currentTime: 0, destination: node(),
    close: vi.fn(async () => {}), resume: vi.fn(async () => {}),
    createGain: vi.fn(() => ({...node(), gain: {value: 1}})),
    createStereoPanner: vi.fn(() => ({...node(), pan: {value: 0}})),
    createAnalyser: vi.fn(() => ({...node(), fftSize: 0, smoothingTimeConstant: 0})),
    createBuffer: vi.fn((numberOfChannels: number, length: number, sampleRate: number) => {
      const channels = Array.from({length: numberOfChannels}, () => new Float32Array(length));
      const buffer = {numberOfChannels, length, sampleRate, duration: length / sampleRate,
        getChannelData: (channel: number) => channels[channel]} as AudioBuffer;
      buffers.push(buffer); return buffer;
    }),
    createBufferSource: vi.fn(() => {
      const starts: number[][] = [];
      const source = {...node(), playbackRate: {value: 1}, starts,
        start: vi.fn((...args: number[]) => { starts.push(args); }), stop: vi.fn(), onended: null, buffer: null} as unknown as AudioBufferSourceNode & {starts: number[][]};
      sources.push(source); return source;
    }),
  } as unknown as AudioContext;
  return {ctx, buffers, sources, advance: (seconds: number) => { Object.defineProperty(ctx, 'currentTime', {value: seconds, configurable: true}); }};
}
function document(length = 1000) {
  const assets = {...createMemoryAudioAssetStore()};
  const initialLease = assets.registerClip(createAudioClip({sampleRate: 1000,
    channelData: [Float32Array.from({length}, (_, index) => index / length)]}), {id: 'asset'});
  const content = createAudioSequence({sampleRate: 1000, channelLayout: ['mono'], segments: [
    {kind: 'asset', id: 'segment', assetId: 'asset', sourceStart: 0, sourceEnd: length, gain: 1, envelope: []},
  ]}, assets);
  let snapshot: AudioDocumentSnapshot = {documentId: 'document', documentRevision: 0, contentId: 'content-0', content, assets, status: 'ready'};
  const listeners = new Set<(snapshot: AudioDocumentSnapshot) => void>();
  const source: AudioDocumentSource = {getSnapshot: () => snapshot,
    subscribe: (notify) => { listeners.add(notify); notify(snapshot); return () => { listeners.delete(notify); }; }};
  const publish = (content: AudioSequence, steps: readonly AudioPositionStep[] = [], status: 'ready' | 'disposed' = 'ready') => {
    const from = snapshot.documentRevision;
    snapshot = {...snapshot, content, contentId: `content-${from + 1}`, documentRevision: from + 1, status,
      change: {origin: 'edit', label: 'Test edit', fromRevision: from, toRevision: from + 1, operations: [], affectedRanges: [],
        positionMap: createAudioPositionMap(snapshot.documentId, from, from + 1, steps)}};
    for (const notify of [...listeners]) notify(snapshot);
    return snapshot;
  };
  return {assets, initialLease, source, publish, content, listeners};
}
const wait = (player: AudioPlayer, source: AudioDocumentSource) => player.waitForDocumentRevision(source.getSnapshot());
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers();});

describe('document playback application', () => {
  it('adopts revisions without PCM reads/context and publishes same-transport identities', async () => {
    const doc = document(); const {ctx} = context(); const read = vi.spyOn(doc.assets, 'read');
    const player = new AudioPlayer(undefined, {audioContext: ctx}); const changes = vi.fn();
    player.on('sourcechange', changes); player.setDocumentSource(doc.source);
    expect(player.documentBinding.status).toBe('preparing');
    await expect(player.play()).rejects.toMatchObject({code: 'not-ready'});
    expect((await wait(player, doc.source)).status).toBe('applied');
    const transport = player.transport; const clock = player.clock;
    expect(player.source).toMatchObject({kind: 'sequence', sequence: doc.content, documentRevision: 0});
    expect(player.clip).toBeUndefined();
    doc.publish(createAudioSequence({...doc.content, segments: [{...(doc.content.segments[0] as AudioAssetSegment), gain: 0.5}]}));
    expect((await wait(player, doc.source)).status).toBe('applied');
    expect(player.transport).toBe(transport); expect(player.clock).toBe(clock);
    expect(player.source).toMatchObject({kind: 'sequence', documentRevision: 1});
    expect(changes.mock.calls.at(-1)?.[0]).toMatchObject({kind: 'sequence', documentRevision: 1});
    expect(read).not.toHaveBeenCalled(); expect(ctx.createBuffer).not.toHaveBeenCalled(); expect(ctx.resume).not.toHaveBeenCalled();
    player.dispose(); doc.initialLease.release(); doc.assets.dispose();
    expect(doc.assets.getStats().leases).toBe(0); expect(doc.listeners.size).toBe(0); expect(ctx.close).not.toHaveBeenCalled();
  });
  it('honors an explicit loop on the first requested document and after preparation begins', async () => {
    const doc = document(); const player = new AudioPlayer(undefined, {loop: true});
    player.setDocumentSource(doc.source); await wait(player, doc.source);
    expect((player.transport as AudioSequenceEngine).loopOption).toBe(true);
    player.setDocumentSource(undefined); player.setDocumentSource(doc.source);
    player.setLoop({start: 0.1, end: 0.5}); await wait(player, doc.source);
    expect((player.transport as AudioSequenceEngine).loopOption).toEqual({start: 0.1, end: 0.5});
    player.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('does not reinstall a request superseded inside a borrowed asset retain callback', async () => {
    const first = document(); const second = document();
    // Distinct document identity makes accidental old-root publication visible.
    const source: AudioDocumentSource = {getSnapshot: () => ({...second.source.getSnapshot(), documentId: 'second'}),
      subscribe: (notify) => second.source.subscribe((snapshot) => notify({...snapshot, documentId: 'second'}))};
    const player = new AudioPlayer(); const retain = first.assets.retain; let replaced = false;
    first.assets.retain = (ids) => {const lease = retain(ids); if (!replaced) {replaced = true; player.setDocumentSource(source);} return lease;};
    player.setDocumentSource(first.source); await wait(player, source);
    expect(player.documentSource).toBe(source); expect(player.source).toMatchObject({kind: 'sequence', documentId: 'second'});
    expect(first.assets.getStats().leases).toBe(1); player.dispose();
    first.initialLease.release(); first.assets.dispose(); second.initialLease.release(); second.assets.dispose();
  });
  it('preserves a new attachment selected while a disposed source retires its pending attempt', async () => {
    const first = document(), second = document();
    const source: AudioDocumentSource = {getSnapshot: () => ({...second.source.getSnapshot(), documentId: 'second'}),
      subscribe: (notify) => second.source.subscribe((snapshot) => notify({...snapshot, documentId: 'second'}))};
    const player = new AudioPlayer(), retain = first.assets.retain;
    let switched = false;
    first.assets.retain = (ids) => {
      const lease = retain(ids);
      return {assetIds: lease.assetIds, get released() {return lease.released;}, release() {
        lease.release();
        if (!switched) {switched = true; player.setDocumentSource(source);}
      }};
    };
    player.setDocumentSource(first.source); const obsolete = wait(player, first.source);
    first.publish(first.content, [], 'disposed');
    expect((await obsolete).status).toBe('superseded');
    const applied = await wait(player, source);
    expect(applied.status).toBe('applied'); expect(player.documentSource).toBe(source);
    expect(player.source).toMatchObject({kind: 'sequence', documentId: 'second', documentRevision: 0});
    expect(player.documentBinding).toMatchObject({status: 'ready', requested: {documentId: 'second', documentRevision: 0}});
    expect(await wait(player, source)).toBe(applied);
    player.seek(.5); expect((await player.retryDocumentApplication()).status).toBe('applied'); expect(player.seconds).toBe(.5);
    player.dispose(); first.initialLease.release(); second.initialLease.release(); first.assets.dispose(); second.assets.dispose();
    expect(first.assets.getStats().leases).toBe(0); expect(second.assets.getStats().leases).toBe(0);
  });
  it('maps skipped deletions and keeps a collapsed anchor left-affine on undo', async () => {
    const doc = document(); const player = new AudioPlayer(); player.setDocumentSource(doc.source); await wait(player, doc.source);
    player.seek(0.5); player.setLoop({start: 0.45, end: 0.55});
    const short = createAudioSequence({...doc.content, segments: [{kind: 'silence', id: 'short', length: 800}]});
    doc.publish(short, [{type: 'splice', startFrame: 400, deleteCount: 200, insertCount: 0, length: 800}]);
    const obsolete = wait(player, doc.source);
    doc.publish(short, []);
    expect((await obsolete).status).toBe('superseded'); await wait(player, doc.source);
    expect(player.seconds).toBe(0.4); expect((player.transport as AudioSequenceEngine).loopOption).toBe(false);
    doc.publish(doc.content, [{type: 'splice', startFrame: 400, deleteCount: 0, insertCount: 200, length: 1000}]);
    await wait(player, doc.source); expect(player.seconds).toBe(0.4);
    player.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('honors stop then seek and settings during preparation, and remains paused', async () => {
    const doc = document(); const {ctx} = context(); const player = new AudioPlayer(undefined, {audioContext: ctx});
    player.setDocumentSource(doc.source); await wait(player, doc.source); player.seek(0.5);
    const longer = createAudioSequence({...doc.content, segments: [{kind: 'silence', id: 'long', length: 1200}]});
    doc.publish(longer, [{type: 'splice', startFrame: 0, deleteCount: 0, insertCount: 200, length: 1200}]);
    player.stop(); player.seek(0.7); player.setRate(2); player.setVolume(0.4); player.setPan(0.3); player.setLoop({start: 0.2, end: 0.8});
    await wait(player, doc.source); expect(player.seconds).toBe(0.9); expect(player.playing).toBe(false);
    expect(player.rate).toBe(2); expect((player.transport as AudioSequenceEngine).loopOption).toEqual({start: 0.4, end: 1});
    doc.publish(longer, []); player.stop(); await wait(player, doc.source); expect(player.seconds).toBe(0);
    player.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('keeps failed attempts terminal, gates stale play and retries without undoing content', async () => {
    const doc = document(); const player = new AudioPlayer(); player.setDocumentSource(doc.source); await wait(player, doc.source);
    const retain = vi.spyOn(doc.assets, 'retain'); retain.mockImplementationOnce(() => { throw new Error('lease failure'); });
    doc.publish(doc.content); const failed = await wait(player, doc.source);
    expect(failed.status).toBe('failed'); expect(player.source).toMatchObject({documentRevision: 0});
    await expect(player.play()).rejects.toMatchObject({code: 'not-ready'});
    player.setDocumentSource(doc.source); expect(await wait(player, doc.source)).toBe(failed);
    expect((await player.retryDocumentApplication()).status).toBe('applied');
    expect(player.source).toMatchObject({documentRevision: 1});
    expect((await player.waitForDocumentRevision({documentId: 'document', documentRevision: 5})).status).toBe('failed');
    player.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('reports retired lease cleanup errors without failing an adopted document revision', async () => {
    const doc = document(); const retain = doc.assets.retain; let fail = false;
    doc.assets.retain = (ids) => {
      const lease = retain(ids);
      return {...lease, release() {lease.release(); if (fail) throw new Error('retired lease cleanup');}};
    };
    const player = new AudioPlayer(); const errors = vi.fn(); player.on('error', errors);
    player.on('error', () => {throw new Error('observer failure');});
    player.setDocumentSource(doc.source); await wait(player, doc.source);
    fail = true; doc.publish(doc.content);
    expect((await wait(player, doc.source)).status).toBe('applied');
    expect(player.documentBinding.status).toBe('ready');
    expect(player.source).toMatchObject({kind: 'sequence', documentRevision: 1});
    expect(errors).toHaveBeenCalledWith(expect.objectContaining({message: 'retired lease cleanup'}));
    fail = false; player.dispose(); doc.initialLease.release(); doc.assets.dispose();
    expect(doc.assets.getStats().leases).toBe(0);
  });
  it('detaches owned sequence resources and supersedes pending work without disposing borrowed data', async () => {
    const doc = document(); const {ctx, sources} = context(); const player = new AudioPlayer(undefined, {audioContext: ctx});
    player.setDocumentSource(doc.source); await wait(player, doc.source); await player.play();
    expect(sources.length).toBeGreaterThan(0); doc.publish(doc.content); const pending = wait(player, doc.source);
    player.setDocumentSource(undefined); expect((await pending).status).toBe('superseded');
    expect(player.source.kind).toBe('empty'); expect(sources[0].stop).toHaveBeenCalled(); expect(doc.listeners.size).toBe(0);
    expect(doc.assets.getStats().leases).toBe(1); expect(ctx.close).not.toHaveBeenCalled(); player.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('rejects independent sources atomically and cancels a pending resume on edit', async () => {
    const doc = document(); const {ctx, sources} = context(); Object.defineProperty(ctx, 'state', {value: 'suspended'});
    let resume!: () => void; vi.mocked(ctx.resume).mockImplementation(() => new Promise<void>((resolve) => {resume = resolve;}));
    const player = new AudioPlayer(undefined, {audioContext: ctx}); player.setDocumentSource(doc.source); await wait(player, doc.source);
    expect(() => player.setClip(createAudioClip({sampleRate: 1000, channelData: [new Float32Array(1)]}))).toThrow(/conflicts/);
    const playing = player.play(); doc.publish(doc.content); resume(); await playing; await wait(player, doc.source);
    expect(sources.length).toBe(0); expect(player.playing).toBe(false); player.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('treats a zero-length ready sequence as available and a disposed source as unavailable', async () => {
    const doc = document(); const player = new AudioPlayer();
    doc.publish(createAudioSequence({sampleRate: 1000, channelLayout: ['mono']}));
    player.setDocumentSource(doc.source); await wait(player, doc.source); await player.play();
    expect(player.source.kind).toBe('sequence'); expect(player.duration).toBe(0); expect(player.documentBinding.status).toBe('ready');
    doc.publish(doc.source.getSnapshot().content, [], 'disposed');
    await expect(player.play()).rejects.toMatchObject({code: 'not-ready'}); player.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
});

describe('bounded sequence scheduling', () => {
  it('schedules gain/envelope/silence PCM matching sequence reads, loops and releases pinned buffers', async () => {
    vi.useFakeTimers(); const doc = document(); const {ctx, sources, buffers, advance} = context();
    const content = createAudioSequence({...doc.content, segments: [
      {...(doc.content.segments[0] as AudioAssetSegment), sourceStart: 100, sourceEnd: 300, gain: 0.5, envelope: [{frame: 0, gain: 0}, {frame: 200, gain: 1}]},
      {kind: 'silence', id: 'silence', length: 100},
    ]});
    const engine = new AudioSequenceEngine(() => ctx, {chunkFrames: 100, preparedBytesLimit: 1200, volume: 0.3, pan: 0.2});
    engine.adopt(content, doc.assets, 0, {start: 0.1, end: 0.3}); await engine.play();
    expect(buffers[0].getChannelData(0)[0]).toBe(0);
    expect(buffers[0].getChannelData(0)[50]).toBeCloseTo(0.15 * 0.5 * 0.25);
    expect(buffers[1].getChannelData(0)[0]).toBeCloseTo(0.2 * 0.5 * 0.5);
    advance(0.15); vi.advanceTimersByTime(25);
    expect(buffers.some((buffer) => buffer.getChannelData(0).every((value) => value === 0))).toBe(true);
    expect(sources).toHaveLength(4); sources.forEach((source, index) => expect(source.starts[0][0]).toBeCloseTo(index / 10));
    expect(engine.preparedBytes).toBeLessThanOrEqual(1200);
    advance(0.35); expect(engine.seconds).toBeCloseTo(0.15); engine.pause(); expect(vi.getTimerCount()).toBe(0);
    engine.dispose(); expect(engine.preparedBytes).toBe(0); expect(ctx.close).not.toHaveBeenCalled(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('bounds long-input reads and total active/inactive chunk allocation', async () => {
    vi.useFakeTimers(); const {ctx, advance, buffers} = context(); let leases = 0;
    const reader = {getDescriptor: () => ({id: 'large', length: 10_000_000, byteLength: 40_000_000, sampleRate: 1000, channelLayout: ['mono']}),
      read: vi.fn((_id: string, _start: number, channels: readonly Float32Array[]) => {channels[0].fill(0.25);}),
      getReferenceCount: () => leases,
      retain: (assetIds: readonly string[]) => {leases++; let released = false; return {assetIds, get released() {return released;}, release() {if (!released) {released = true; leases--;}}};}};
    const content = createAudioSequence({sampleRate: 1000, channelLayout: ['mono'], segments: [
      {kind: 'asset', id: 'large', assetId: 'large', sourceStart: 0, sourceEnd: 10_000_000, gain: 1, envelope: []},
    ]}, reader);
    const engine = new AudioSequenceEngine(() => ctx, {chunkFrames: 100, preparedBytesLimit: 1600});
    engine.adopt(content, reader, 0, false); expect(reader.read).not.toHaveBeenCalled(); await engine.play();
    for (let index = 1; index < 15; index++) {advance(index * 0.1); vi.advanceTimersByTime(25);}
    expect(engine.preparedBytes).toBeLessThanOrEqual(1600); expect(buffers.every((buffer) => buffer.length <= 100)).toBe(true);
    expect(reader.read.mock.calls.every((call) => call[2][0].length <= 100)).toBe(true); engine.dispose(); expect(leases).toBe(0);
  });
  it('rejects pathological loop voice counts and unsupported pitch preservation', () => {
    const doc = document(); const {ctx} = context(); const engine = new AudioSequenceEngine(() => ctx);
    const content = createAudioSequence({sampleRate: 48000, channelLayout: ['mono'], segments: [{kind: 'silence', id: 'dense', length: 48000}]});
    engine.adopt(content, doc.assets, 0, false);
    expect(() => engine.setLoop({start: 0, end: 1 / 48000})).toThrow(/512 scheduled voices/);
    expect(engine.loopOption).toBe(false); expect(ctx.createBufferSource).not.toHaveBeenCalled();
    expect(() => engine.setPreservesPitch(true)).toThrow(/pitch preservation/);
    engine.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('uses one frame-quantized loop for scheduling and the observed timeline', async () => {
    const doc = document(); const {ctx, sources, advance} = context();
    const engine = new AudioSequenceEngine(() => ctx, {chunkFrames: 100});
    engine.adopt(doc.content, doc.assets, 0, {start: 0, end: 0.01001});
    expect(engine.loopOption).toEqual({start: 0, end: 0.01});
    await engine.play();
    sources.forEach((source, index) => {
      expect(source.starts[0][0]).toBeCloseTo(index * 0.01);
      expect(source.starts[0][2]).toBe(0.01);
    });
    advance(100.005); expect(engine.seconds).toBeCloseTo(0.005, 10);
    engine.pause(); engine.setLoop({start: 0.0201, end: 0.0304});
    expect(engine.loopOption).toEqual({start: 0.02, end: 0.03});
    expect(() => engine.setLoop({start: 0.0201, end: 0.0204})).toThrow(/one output frame/);
    expect(engine.loopOption).toEqual({start: 0.02, end: 0.03});
    expect(() => engine.adopt(doc.content, doc.assets, 0, {start: 0, end: 0.0001})).toThrow(/one output frame/);
    engine.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('releases the abandoned chunk reservation when a PCM read pauses playback', async () => {
    const doc = document(); const {ctx, sources} = context(); const originalRead = doc.assets.read;
    const engine = new AudioSequenceEngine(() => ctx, {chunkFrames: 100, preparedBytesLimit: 800});
    engine.adopt(doc.content, doc.assets, 0, false);
    doc.assets.read = (...args) => {engine.pause(); originalRead(...args);};
    await engine.play();
    expect(engine.preparedBytes).toBe(0); expect(sources).toHaveLength(0);
    expect(doc.assets.getStats().leases).toBe(2);
    doc.assets.read = originalRead; await engine.play();
    expect(engine.preparedBytes).toBe(800); expect(sources).toHaveLength(2);
    engine.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('disconnects the complete graph when the terminal asset lease release throws', async () => {
    const doc = document(); const {ctx, sources} = context(); const retain = doc.assets.retain; let fail = false;
    doc.assets.retain = (ids) => {
      const lease = retain(ids);
      return {...lease, release() {lease.release(); if (fail) throw new Error('lease cleanup');}};
    };
    const engine = new AudioSequenceEngine(() => ctx);
    engine.adopt(doc.content, doc.assets, 0, false); await engine.play(); fail = true;
    expect(() => engine.dispose()).toThrow('lease cleanup');
    expect(sources[0].stop).toHaveBeenCalled(); expect(sources[0].disconnect).toHaveBeenCalled();
    for (const create of [ctx.createGain, ctx.createStereoPanner, ctx.createAnalyser]) {
      expect(vi.mocked(create).mock.results[0].value.disconnect).toHaveBeenCalled();
    }
    expect(engine.analyser).toBeUndefined(); expect(engine.sequence).toBeUndefined(); expect(engine.preparedBytes).toBe(0);
    expect(() => engine.dispose()).not.toThrow(); expect(doc.assets.getStats().leases).toBe(1);
    doc.initialLease.release(); doc.assets.dispose();
  });
  it('discards a stale PCM read and preserves leases through reentrant disposal', async () => {
    const doc = document(); const {ctx, sources} = context(); const originalRead = doc.assets.read;
    const engine = new AudioSequenceEngine(() => ctx, {chunkFrames: 100});
    engine.adopt(doc.content, doc.assets, 0, false);
    doc.assets.read = (...args) => {
      engine.dispose(); doc.initialLease.release(); doc.assets.dispose();
      expect(doc.assets.getStats().leases).toBe(1); // the in-progress read owns its lease
      originalRead(...args);
    };
    await engine.play(); expect(sources).toHaveLength(0); expect(engine.preparedBytes).toBe(0);
    expect(doc.assets.getStats().leases).toBe(0);
  });
  it('retains the newest revision after an asset read reentrantly adopts content', async () => {
    const doc = document(); const {ctx, sources} = context(); const originalRead = doc.assets.read;
    const engine = new AudioSequenceEngine(() => ctx, {chunkFrames: 100});
    engine.adopt(doc.content, doc.assets, 0, false);
    const next = createAudioSequence({sampleRate: 1000, channelLayout: ['mono'], segments: [{kind: 'silence', id: 'next', length: 500}]});
    doc.assets.read = (...args) => {engine.adopt(next, doc.assets, 0.2, false); originalRead(...args);};
    await engine.play(); expect(engine.sequence).toBe(next); expect(engine.seconds).toBe(0.2);
    expect(engine.preparedBytes).toBe(0); expect(sources).toHaveLength(0);
    engine.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('releases a partial graph on construction failure and announces its lazy tap', async () => {
    const doc = document(); const {ctx} = context(); const engine = new AudioSequenceEngine(() => ctx);
    engine.adopt(doc.content, doc.assets, 0, false);
    vi.mocked(ctx.createStereoPanner).mockImplementationOnce(() => {throw new Error('graph failure');});
    await expect(engine.play()).rejects.toThrow('graph failure');
    expect(vi.mocked(ctx.createGain).mock.results[0].value.disconnect).toHaveBeenCalled();
    const loaded = vi.fn(); engine.onLoad(loaded); engine.preload();
    expect(loaded).toHaveBeenCalledOnce(); expect(engine.analyser).toBeDefined();
    engine.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
  it('fails preparation before allocating when one chunk exceeds the declared budget', () => {
    const doc = document(); const {ctx} = context(); const engine = new AudioSequenceEngine(() => ctx, {preparedBytesLimit: 4});
    expect(() => engine.adopt(doc.content, doc.assets, 0, false)).toThrow(/preparedBytesLimit/);
    expect(ctx.createBuffer).not.toHaveBeenCalled(); expect(doc.assets.getStats().leases).toBe(1);
    engine.dispose(); doc.initialLease.release(); doc.assets.dispose();
  });
});
