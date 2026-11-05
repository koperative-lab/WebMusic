import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  Duration, NoteId, Pitch, Rational, ScoreBuilder, createScorePositionMap,
  type Score, type ScoreDocumentSnapshot, type ScoreDocumentSource,
} from '../../src/core';
import {ScorePlayer} from '../../src/play/headless/score-player';
import type {PreloadableHeadlessSynth} from '../../src/play/headless/audio-contracts';
import type {ScorePlayerScheduler} from '../../src/play/headless/score-player-scheduler';

const players: ScorePlayer[] = [];
afterEach(() => { for (const player of players.splice(0)) player.dispose(); vi.restoreAllMocks(); });

function music(quarters = 8, bpm = 120, pitch = 'C4', repeats = false): Score {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: builder.newPartId(), name: 'Piano'});
  builder.addNote(part, {id: NoteId('note'), pitch: Pitch.parse(pitch), voice: builder.newVoiceId(),
    onsetQuarters: Rational.ZERO, duration: new Duration({base: new Rational(quarters)})});
  builder.addTempo({atQuarters: Rational.ZERO, bpm});
  if (repeats) {
    builder.addMeasure({id: builder.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO,
      durationQuarters: new Rational(4), repeat: {start: true}});
    builder.addMeasure({id: builder.newMeasureId(), number: 2, onsetQuarters: new Rational(4),
      durationQuarters: new Rational(4), repeat: {end: true}});
  }
  return builder.build();
}

class Document implements ScoreDocumentSource {
  private value: ScoreDocumentSnapshot;
  readonly listeners = new Set<(snapshot: ScoreDocumentSnapshot) => void>();
  constructor(content: Score, documentId = 'document') {
    this.value = Object.freeze({documentId, documentRevision: 0, contentId: 'content-0', content, status: 'ready'});
  }
  getSnapshot(): ScoreDocumentSnapshot { return this.value; }
  subscribe(listener: (snapshot: ScoreDocumentSnapshot) => void): () => void {
    this.listeners.add(listener); listener(this.value); return () => { this.listeners.delete(listener); };
  }
  replace(content: Score, options: {map?: boolean; reset?: boolean; skip?: number} = {}): void {
    const previous = this.value;
    const next = previous.documentRevision + (options.skip ?? 1);
    this.value = Object.freeze({documentId: previous.documentId, documentRevision: next, contentId: `content-${next}`,
      content, status: 'ready', ...(options.map === false ? {} : {change: Object.freeze({origin: 'edit' as const, label: 'Change',
        fromRevision: previous.documentRevision, toRevision: next, operations: [], affectedNoteIds: [NoteId('note')],
        positionMap: createScorePositionMap(previous.documentId, previous.documentRevision, next, content.durationQuarters,
          options.reset ? 'reset-origin' : 'preserve-quarter')})})});
    for (const listener of [...this.listeners]) listener(this.value);
  }
  dispose(): void {
    this.value = Object.freeze({...this.value, status: 'disposed'});
    for (const listener of [...this.listeners]) listener(this.value);
    this.listeners.clear();
  }
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function flush(): Promise<void> { for (let index = 0; index < 12; index++) await Promise.resolve(); }

function engine(score = music(), expandRepeats = false) {
  const context = {state: 'running', currentTime: 0, sampleRate: 44100, resume: vi.fn(async () => {})};
  const param = () => ({value: 1, setValueAtTime() { return this; }, cancelScheduledValues() { return this; }});
  const node = () => ({context, gain: param(), connect() {}, disconnect() {}});
  const createGain = vi.fn(node);
  Object.assign(context, {destination: node(), createGain, createStereoPanner: () => ({...node(), pan: param()})});
  const preload = vi.fn(async (_notes?: ReadonlyArray<import('../../src/core').Note>) => {});
  const synth: PreloadableHeadlessSynth = {preload, connect: vi.fn(), noteOn: vi.fn(), noteOff: vi.fn()};
  const tick = {running: false, workerBacked: false, start: vi.fn(), stop: vi.fn(), dispose: vi.fn()};
  const player = new ScorePlayer(score, {audioContext: context as unknown as AudioContext, synth,
    expandRepeats, createTickSource: () => tick});
  players.push(player);
  const scheduler = (player as unknown as {scheduler: ScorePlayerScheduler}).scheduler;
  return {player, scheduler, context, createGain, preload, synth, tick};
}

async function bind(player: ScorePlayer, document: Document): Promise<void> {
  player.setDocumentSource(document);
  expect((await player.waitForDocumentRevision(document.getSnapshot())).status).toBe('applied');
}

describe('native document revision application', () => {
  it('applies without creating audio and retains player, publisher, scheduler and clock identities', async () => {
    const {player, scheduler, createGain, context, preload} = engine();
    const playback = player.playback;
    const clock = player.clock;
    const document = new Document(music());
    expect(player.documentBinding.status).toBe('empty');
    expect(playback.snapshot().documentId).toBeUndefined();
    player.setDocumentSource(document);
    expect(player.documentBinding.status).toBe('preparing');
    await expect(player.play()).rejects.toMatchObject({code: 'not-ready'});
    expect((await player.waitForDocumentRevision(document.getSnapshot())).status).toBe('applied');
    expect(player.playback).toBe(playback);
    expect(player.clock).toBe(clock);
    expect((player as unknown as {scheduler: ScorePlayerScheduler}).scheduler).toBe(scheduler);
    expect(createGain).not.toHaveBeenCalled();
    expect(context.resume).not.toHaveBeenCalled();
    expect(preload).not.toHaveBeenCalled();
    expect(playback.snapshot()).toMatchObject({documentId: 'document', documentRevision: 0, readiness: 'ready', state: 'stopped'});
    expect(player.documentBinding.documentCoordinates).toBe(true);
    const sourceRevision = playback.snapshot().sourceRevision;
    await player.seekNominal(0.123456);
    player.setRate(1.5);
    document.replace(music(8, 60, 'D4'));
    await player.waitForDocumentRevision(document.getSnapshot());
    expect(player.nominalSeconds).toBeCloseTo(0.246912, 10);
    expect(player.rate).toBe(1.5);
    expect(player.playback.snapshot().sourceRevision).toBeGreaterThan(sourceRevision);
    expect(player.playback.snapshot().score).toBe(document.getSnapshot().content);
    expect(player.isPlaying()).toBe(false);
  });

  it('pauses active voices and preserves initialized graph and synth ownership', async () => {
    const {player, synth, createGain, tick} = engine();
    const document = new Document(music());
    await bind(player, document);
    await player.play();
    expect(player.isPlaying()).toBe(true);
    const context = player.context;
    document.replace(music(8, 120, 'E4'));
    expect(player.isPlaying()).toBe(false);
    await player.waitForDocumentRevision(document.getSnapshot());
    expect(player.context).toBe(context);
    expect(createGain).toHaveBeenCalledOnce();
    expect(synth.connect).toHaveBeenCalledOnce();
    expect(tick.dispose).not.toHaveBeenCalled();
    expect(player.playback.snapshot().activeNotes).toEqual([]);
    expect(player.playback.snapshot().state).toBe('paused');
  });

  it('keeps stopped and ended transport states across attachment and applied edits', async () => {
    const {player} = engine();
    const document = new Document(music());
    await bind(player, document);
    expect(player.playback.snapshot().state).toBe('stopped');
    document.replace(music(8, 120, 'D4'));
    await player.waitForDocumentRevision(document.getSnapshot());
    expect(player.playback.snapshot().state).toBe('stopped');
    await player.seekNominal(4);
    await player.play();
    expect(player.playback.snapshot().state).toBe('ended');
    document.replace(music(8, 120, 'E4'));
    await player.waitForDocumentRevision(document.getSnapshot());
    expect(player.playback.snapshot()).toMatchObject({state: 'ended', documentRevision: 2});
  });

  it('publishes one cursor and timeupdate after a clamped or reset adoption is ready', async () => {
    const {player} = engine();
    const document = new Document(music());
    await bind(player, document);
    await player.seekNominal(3);
    const updates: Array<[number, number | undefined]> = [];
    let cursors = 0;
    player.on('cursor', () => { cursors += 1; });
    player.on('timeupdate', ({nominalSeconds}) => updates.push([nominalSeconds, player.playback.snapshot().documentRevision]));
    document.replace(music(2));
    await player.waitForDocumentRevision(document.getSnapshot());
    expect(updates).toEqual([[1, 1]]);
    document.replace(music(8), {map: false});
    await player.waitForDocumentRevision(document.getSnapshot());
    expect(updates).toEqual([[1, 1], [0, 2]]);
    expect(cursors).toBe(2);
  });

  it('settles a start superseded by a revision during context resume instead of rejecting as not ready', async () => {
    const {player, context, preload} = engine();
    const document = new Document(music());
    await bind(player, document);
    const resumed = deferred(); const prepared = deferred();
    context.state = 'suspended';
    context.resume.mockImplementationOnce(async () => { await resumed.promise; context.state = 'running'; });
    preload.mockImplementationOnce(() => prepared.promise);
    const start = player.play();
    await flush();
    document.replace(music(8, 120, 'D4'));
    expect(player.documentBinding.status).toBe('preparing');
    resumed.resolve();
    await expect(start).resolves.toBeUndefined();
    expect(player.isPlaying()).toBe(false);
    prepared.resolve();
    expect((await player.waitForDocumentRevision(document.getSnapshot())).status).toBe('applied');
    expect(player.playback.snapshot().state).toBe('paused');
  });

  it('reports failure without stale playback, preserves terminal results, and retries explicitly', async () => {
    const {player, preload} = engine();
    await player.preload();
    const document = new Document(music());
    await bind(player, document);
    const applied = player.playback.snapshot().score;
    preload.mockRejectedValueOnce(new Error('sample unavailable'));
    document.replace(music(8, 120, 'D4'));
    const failed = await player.waitForDocumentRevision(document.getSnapshot());
    expect(failed).toMatchObject({status: 'failed', error: {message: 'sample unavailable'}});
    expect(player.playback.snapshot()).toMatchObject({score: applied, documentRevision: 0, readiness: 'error'});
    expect(player.documentBinding).toMatchObject({status: 'error', requested: {documentRevision: 1}, applied: {documentRevision: 0}, documentCoordinates: false});
    await expect(player.play()).rejects.toMatchObject({code: 'not-ready'});
    const calls = preload.mock.calls.length;
    player.setDocumentSource(document);
    expect(preload).toHaveBeenCalledTimes(calls);
    expect(await player.waitForDocumentRevision(document.getSnapshot())).toBe(failed);
    const retry = player.retryDocumentApplication();
    const retried = await retry;
    expect(retried.status).toBe('applied');
    expect(retried.attempt).toBeGreaterThan(failed.attempt);
    expect(player.playback.snapshot().documentRevision).toBe(1);
    expect(failed.status).toBe('failed');
  });

  it('composes skipped shrink/undo maps and ignores late preparation from superseded attempts', async () => {
    const {player, preload} = engine();
    await player.preload();
    const document = new Document(music());
    await bind(player, document);
    await player.seekNominal(3);
    const first = deferred(); const second = deferred();
    preload.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    document.replace(music(2));
    const oldTarget = document.getSnapshot();
    const old = player.waitForDocumentRevision(oldTarget);
    await flush();
    document.replace(music(8));
    const current = player.waitForDocumentRevision(document.getSnapshot());
    await flush();
    expect((await old).status).toBe('superseded');
    first.resolve(); await flush();
    expect(player.playback.snapshot().documentRevision).toBe(0);
    second.resolve();
    expect((await current).status).toBe('applied');
    expect(player.nominalSeconds).toBe(1);
    expect((await player.waitForDocumentRevision(oldTarget)).status).toBe('superseded');
    expect(await player.waitForDocumentRevision({...document.getSnapshot(), documentRevision: 9})).toMatchObject({status: 'failed', error: {code: 'unknown-revision'}});
  });

  it('retains map chains across failed preparation before a later revision', async () => {
    const {player, preload} = engine();
    await player.preload();
    const document = new Document(music());
    await bind(player, document); await player.seekNominal(3);
    preload.mockRejectedValueOnce(new Error('offline'));
    document.replace(music(2));
    expect((await player.waitForDocumentRevision(document.getSnapshot())).status).toBe('failed');
    document.replace(music(8));
    await player.waitForDocumentRevision(document.getSnapshot());
    expect(player.nominalSeconds).toBe(1);
  });

  it.each([false, true])('preserves latest stop/seek intent and live rate/loop changes while preparing (seek: %s)', async (seek) => {
    const {player, preload, scheduler} = engine();
    await player.preload();
    const document = new Document(music());
    await bind(player, document);
    const pending = deferred(); preload.mockImplementationOnce(() => pending.promise);
    document.replace(music(8, 60));
    const applied = player.waitForDocumentRevision(document.getSnapshot());
    await flush();
    player.setLoop(0.5, 1.5);
    player.stop();
    player.setRate(2);
    if (seek) await player.seekNominal(0.75);
    player.setRate(3);
    pending.resolve(); await applied;
    expect(player.nominalSeconds).toBe(seek ? 1.5 : 0);
    expect(player.rate).toBe(3);
    expect(scheduler.nominalLoop).toEqual([1, 3]);
    expect(player.isPlaying()).toBe(false);
  });

  it('disables collapsed loops and resets unknown mapping without disabling unexpanded coordinates', async () => {
    const {player, scheduler} = engine();
    const document = new Document(music());
    await bind(player, document);
    player.setLoop(3, 4);
    document.replace(music(4)); await player.waitForDocumentRevision(document.getSnapshot());
    expect(scheduler.nominalLoop).toBeUndefined();
    await player.seekNominal(1);
    player.setLoop(0.5, 1.5);
    document.replace(music(8), {map: false});
    expect(await player.waitForDocumentRevision(document.getSnapshot())).toMatchObject({status: 'applied', positionPolicy: 'reset-origin'});
    expect(player.nominalSeconds).toBe(0);
    expect(scheduler.nominalLoop).toBeUndefined();
    expect(player.documentBinding.documentCoordinates).toBe(true);
  });

  it('reports repeat-expanded origin fallback and never claims authored coordinates', async () => {
    const {player, scheduler} = engine(music(8, 120, 'C4', true), true);
    const document = new Document(music(8, 120, 'C4', true));
    await bind(player, document);
    await player.seekNominal(3); player.setLoop(1, 3);
    document.replace(music(8, 120, 'D4', true));
    expect(await player.waitForDocumentRevision(document.getSnapshot())).toMatchObject({status: 'applied', positionPolicy: 'reset-origin'});
    expect(player.nominalSeconds).toBe(0);
    expect(scheduler.nominalLoop).toBeUndefined();
    expect(player.documentBinding.documentCoordinates).toBe(false);
    expect(player.playback.snapshot().score).not.toBe(document.getSnapshot().content);
  });

  it.each(['detach', 'player-dispose', 'document-dispose'] as const)('settles pending work on %s and releases subscriptions', async (action) => {
    const {player, preload} = engine();
    await player.preload();
    const document = new Document(music()); await bind(player, document);
    const before = player.playback.snapshot().score;
    const pending = deferred(); preload.mockImplementationOnce(() => pending.promise);
    document.replace(music(8, 120, 'G4'));
    const outcome = player.waitForDocumentRevision(document.getSnapshot()); await flush();
    if (action === 'detach') player.setDocumentSource(undefined);
    else if (action === 'player-dispose') player.dispose();
    else document.dispose();
    expect((await outcome).status).toBe('superseded');
    pending.resolve(); await flush();
    expect(player.playback.snapshot().score).toBe(before);
    expect(document.listeners.size).toBe(0);
    if (action === 'detach') {
      expect(player.documentBinding.status).toBe('empty');
      expect(player.playback.snapshot().documentId).toBeUndefined();
      expect(player.playback.snapshot().readiness).toBe('ready');
    } else await expect(player.play()).rejects.toThrow();
  });

  it('settles as superseded when applied publication synchronously requests newer content', async () => {
    const {player} = engine(); const document = new Document(music()); await bind(player, document);
    let replace = true;
    player.playback.subscribe((snapshot) => {
      if (replace && snapshot.documentRevision === 1) { replace = false; document.replace(music(8, 120, 'E4')); }
    });
    document.replace(music(8, 120, 'D4'));
    expect((await player.waitForDocumentRevision(document.getSnapshot())).status).toBe('superseded');
    await player.waitForDocumentRevision(document.getSnapshot());
    expect(player.playback.snapshot().documentRevision).toBe(2);
  });

  it('retains current position on an explicit fresh application attempt of the ready revision', async () => {
    const {player} = engine(); const document = new Document(music()); await bind(player, document);
    await player.seekNominal(1.25);
    const attempt = player.documentBinding.attempt;
    expect(await player.retryDocumentApplication()).toMatchObject({status: 'applied', positionPolicy: 'preserve-quarter'});
    expect(player.documentBinding.attempt).toBeGreaterThan(attempt);
    expect(player.nominalSeconds).toBe(1.25);
  });

  it('completes terminal cleanup when a borrowed source unsubscribe throws', async () => {
    const {player, synth, tick} = engine(); const document = new Document(music());
    const failures: unknown[] = [];
    player.on('operationError', ({error}) => failures.push(error));
    const source: ScoreDocumentSource = {getSnapshot: () => document.getSnapshot(), subscribe: (listener) => {
      const unsubscribe = document.subscribe(listener);
      return () => { unsubscribe(); throw new Error('cleanup failed'); };
    }};
    player.setDocumentSource(source); await player.waitForDocumentRevision(document.getSnapshot());
    await player.play();
    expect(() => player.dispose()).not.toThrow();
    expect(tick.dispose).toHaveBeenCalledOnce();
    expect(synth.connect).toHaveBeenCalledOnce();
    expect(failures).toHaveLength(1);
    expect(document.listeners.size).toBe(0);
    expect(player.playback.snapshot().readiness).toBe('disposed');
  });
});
