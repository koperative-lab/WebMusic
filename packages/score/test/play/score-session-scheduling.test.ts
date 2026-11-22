import {afterEach, describe, expect, it, vi} from 'vitest';
import {ModuleAudioEnvironment, ModuleContext} from '@webmusic/kernel/module';
import {SessionTransport} from '@webmusic/kernel/session';
import {Duration, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score, type ScoreDocumentSnapshot, type ScoreDocumentSource} from '../../src/core';
import {ScorePlayer} from '../../src/play/headless/score-player';
import {ScorePlayerModule} from '../../src/play/headless/score-module';
import type {HeadlessSynth} from '../../src/play/headless/audio-contracts';

function score(notes: Array<{start: number; duration: number; midi?: number}> = [{start: 0, duration: 1}]) {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('part'), name: 'Part'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  for (const note of notes) builder.addNote(part, {
    id: builder.newNoteId(), voice: VoiceId('voice'), pitch: Pitch.fromMidi(note.midi ?? 60),
    onsetQuarters: Rational.ZERO, duration: Duration.quarter(),
    performed: {onsetSec: note.start, durationSec: note.duration, velocity: 100},
  });
  return builder.build();
}

function fixture(options: {offset?: number; scale?: number; lookahead?: number; notes?: Array<{start: number; duration: number; midi?: number}>; scheduled?: boolean; retiming?: boolean} = {}) {
  let now = 0;
  let state: AudioContextState = 'running';
  const context = {} as AudioContext;
  const param = () => ({value: 1, setValueAtTime() {}, cancelScheduledValues() {}});
  const node = () => ({context, gain: param(), pan: param(), connect(destination: unknown) { return destination; }, disconnect() {}});
  Object.defineProperties(context, {currentTime: {get: () => now}, state: {get: () => state}});
  Object.assign(context, {destination: node(), createGain: node, createStereoPanner: node,
    resume: vi.fn(async () => { state = 'running'; }), close: vi.fn()});
  const ons: Array<{handle: number; midi: number; time: number; duration: number}> = [];
  const cancel = vi.fn(), off = vi.fn(), retime = vi.fn();
  let sequence = 0, tick: (() => void) | undefined;
  const synth: HeadlessSynth = {
    supportsScheduledCancellation: options.scheduled !== false,
    supportsScheduledDuration: options.scheduled !== false,
    supportsScheduledRetiming: options.retiming !== false,
    connect: () => () => {},
    noteOn(midi, _velocity, time, duration) { const handle = ++sequence; ons.push({handle, midi, time, duration}); return handle; },
    noteOffById: off, cancelScheduledNote: cancel, retimeScheduledNote: retime,
  };
  const source = score(options.notes);
  const player = new ScorePlayer(source, {audioContext: context, synth, lookaheadSeconds: options.lookahead ?? 0.25,
    createTickSource: () => ({get running() { return tick !== undefined; }, workerBacked: false, start(callback) { tick = callback; }, stop() { tick = undefined; }, dispose() { tick = undefined; }})});
  const session = new SessionTransport(() => now, {leadInSeconds: 0.1, driftCheckIntervalMs: 0});
  const audio = new ModuleAudioEnvironment({context});
  const scope = new ModuleContext({id: 'test-session', audio, session});
  const module = new ScorePlayerModule(source, {context: scope, player, offsetSeconds: options.offset, positionScale: options.scale});
  const clean = () => { module.dispose(); session.dispose(); player.dispose(); audio.dispose(); };
  cleanups.push(clean);
  return {player, module, session, context, ons, cancel, off, retime,
    at(time: number) { now = time; tick?.(); }, suspend() { state = 'suspended'; },
    resume() { state = 'running'; tick?.(); }};
}

const cleanups: Array<() => void> = [];
afterEach(() => { for (const clean of cleanups.splice(0).reverse()) clean(); vi.useRealTimers(); });

describe('Score consumes one Session scheduling authority', () => {
  it('maps non-unit rate and offset into one shared reference origin and rejects participant writes', async () => {
    const f = fixture({offset: 0.25, scale: 2});
    await f.session.setRate(1.5);
    await f.session.play();
    expect(f.ons).toHaveLength(1);
    expect(f.ons[0].time).toBeCloseTo(0.1);
    expect(f.ons[0].duration).toBeCloseTo(0.25);
    expect(f.player.clock.state.originTime).toBe(f.session.clock.state.originTime);
    expect(f.player.clock.state.originPosition).toBe(0.25);
    expect(f.player.rate).toBe(3);
    f.at(0.2);
    expect(f.player.nominalSeconds).toBeCloseTo(0.55);
    await expect(f.player.play()).rejects.toThrow(/owned by its Session/);
    expect(() => f.player.setRate(2)).toThrow(/owned by its Session/);
    expect(() => f.player.pause()).toThrow(/owned by its Session/);
    expect(f.session.clock.rate).toBe(1.5);
  });

  it('commits the next loop pass before the boundary, clipping and retriggering crossing notes', async () => {
    const f = fixture({lookahead: 0.45});
    await f.session.setLoop({startSeconds: 0, endSeconds: 0.2});
    await f.session.play();
    expect(f.ons.map((note) => note.time)).toEqual([0.1, 0.30000000000000004]);
    for (const note of f.ons) expect(note.duration).toBeCloseTo(0.2);
    const origin = f.session.clock.state.originTime;
    f.at(0.31);
    expect(f.ons.filter((note) => Math.abs(note.time - 0.3) < 1e-9)).toHaveLength(1);
    expect(f.player.nominalSeconds).toBeCloseTo(0.01);
    expect(f.session.clock.state.originTime).toBe(origin);
    expect(f.ons.some((note) => Math.abs(note.time - 0.5) < 1e-9)).toBe(true);
  });

  it('invalidates future occurrences before seek and rebuilds them from the new epoch', async () => {
    const f = fixture({notes: [{start: 0.1, duration: 0.1}, {start: 0.6, duration: 0.2}], lookahead: 0.4});
    await f.session.play();
    expect(f.ons).toHaveLength(1);
    const old = f.ons[0].handle;
    await f.session.seek(0.6);
    expect(f.cancel).toHaveBeenCalledWith(old, 0);
    expect(f.ons).toHaveLength(2);
    expect(f.ons[1].time).toBeCloseTo(f.session.clock.state.originTime);
    expect(f.ons[1].duration).toBeCloseTo(0.2);
    await f.session.pause();
    expect(f.player.isPlaying()).toBe(false);
    const count = f.ons.length;
    f.at(1);
    expect(f.ons).toHaveLength(count);
  });

  it('preserves a sounding native occurrence on rate edits while retracting future work', async () => {
    const f = fixture({notes: [{start: 0, duration: 1}, {start: 0.5, duration: 0.2}], lookahead: 0.8});
    const events = vi.fn();
    f.player.on('noteOn', events);
    await f.session.play();
    const current = f.ons[0].handle, future = f.ons[1].handle;
    f.at(0.2);
    expect(events).toHaveBeenCalledOnce();
    await f.session.setRate(2);
    expect(f.cancel).not.toHaveBeenCalledWith(current, expect.anything());
    expect(f.cancel).toHaveBeenCalledWith(future, 0.2);
    expect(f.retime).toHaveBeenCalledWith(current, 0.65);
    expect(f.ons).toHaveLength(3);
    expect(f.ons[2].time).toBeCloseTo(0.4);
    expect(events).toHaveBeenCalledOnce();
  });

  it('rebuilds active custom-backend gates when precise retiming was not explicitly promised', async () => {
    const f = fixture({retiming: false});
    await f.session.play();
    const old = f.ons[0].handle;
    f.at(0.2);
    await f.session.setRate(2);
    expect(f.cancel).toHaveBeenCalledWith(old, 0.2);
    expect(f.retime).not.toHaveBeenCalled();
    expect(f.ons).toHaveLength(2);
    expect(f.ons[1].time).toBeCloseTo(0.2);
    expect(f.ons[1].duration).toBeCloseTo(0.45);
  });

  it('keeps onset observations on the frozen audio clock and reports callback backends honestly', async () => {
    vi.useFakeTimers();
    const f = fixture({scheduled: false});
    const noteOn = vi.fn();
    f.player.on('noteOn', noteOn);
    await f.session.play();
    expect(f.ons).toHaveLength(0);
    expect(f.player.schedulingCapabilities.attacks).toBe('callback');
    expect(f.player.schedulingCapabilities.releases).toBe('callback');
    expect(f.player.schedulingCapabilities.cancellation).toBe('pitch');
    f.suspend();
    vi.advanceTimersByTime(1000);
    f.at(0.1);
    expect(noteOn).not.toHaveBeenCalled();
    f.resume();
    expect(f.ons).toHaveLength(1);
    expect(noteOn).toHaveBeenCalledOnce();
    f.module.dispose();
    const count = f.ons.length;
    f.at(2);
    expect(f.ons).toHaveLength(count);
    expect(f.context.close).not.toHaveBeenCalled();
  });

  it('preload leaves a suspended context alone and play activates it before establishing the origin', async () => {
    const f = fixture();
    f.suspend();
    await f.session.preload();
    expect(f.context.resume).not.toHaveBeenCalled();
    expect(f.ons).toHaveLength(0);
    await f.session.play();
    expect(f.context.resume).toHaveBeenCalledOnce();
    expect(f.ons[0].time).toBeCloseTo(0.1);
  });

  it('applies a document revision to a Session follower: the Session pauses, keeps its position, and plays the new notes from there (DEC-086)', async () => {
    /** A document source for tests: one content, replaced whole. */
    class Document implements ScoreDocumentSource {
      private value: ScoreDocumentSnapshot;
      private readonly listeners = new Set<(snapshot: ScoreDocumentSnapshot) => void>();
      constructor(content: Score) { this.value = Object.freeze({documentId: 'document', documentRevision: 0, contentId: 'content-0', content, status: 'ready'}); }
      getSnapshot(): ScoreDocumentSnapshot { return this.value; }
      subscribe(listener: (snapshot: ScoreDocumentSnapshot) => void): () => void { this.listeners.add(listener); listener(this.value); return () => { this.listeners.delete(listener); }; }
      replace(content: Score): void {
        const revision = this.value.documentRevision + 1;
        this.value = Object.freeze({documentId: 'document', documentRevision: revision, contentId: `content-${revision}`, content, status: 'ready'});
        for (const listener of [...this.listeners]) listener(this.value);
      }
    }
    const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
    const f = fixture({notes: [{start: 0, duration: 4, midi: 60}]});
    await f.session.play();
    f.at(0.6);
    expect(f.ons.map(note => note.midi)).toEqual([60]);
    expect(f.player.followsSession).toBe(true);
    const origin = f.session.clock.state.originTime;

    // Attaching the document is a revision: the member asks the Session to pause, and the player writes no transport.
    const document = new Document(score([{start: 0, duration: 4, midi: 64}]));
    expect(() => f.module.setDocumentSource(document)).not.toThrow();
    expect((await f.player.waitForDocumentRevision(document.getSnapshot())).status).toBe('applied');
    await flush();
    expect(f.session.snapshot.paused).toBe(true);
    expect(f.cancel).toHaveBeenCalled();
    const position = f.session.position;
    expect(position).toBeCloseTo(0.5);
    expect(f.player.playback.snapshot().score).toBe(document.getSnapshot().content);
    expect(() => f.player.pause()).toThrow(/owned by its Session/);

    // Played again, the Session goes on from where it was, with the document's notes.
    await f.session.play();
    expect(f.ons.map(note => note.midi)).toEqual([60, 64]);
    expect(f.session.position).toBeCloseTo(position);
    expect(f.session.clock.state.originTime).not.toBe(origin);

    // An edit while it plays does the same, and the Session reads the member's new length.
    f.at(1.2);
    document.replace(score([{start: 0, duration: 8, midi: 67}]));
    expect((await f.player.waitForDocumentRevision(document.getSnapshot())).status).toBe('applied');
    await flush();
    expect(f.session.snapshot.paused).toBe(true);
    expect(f.session.snapshot.durationSeconds).toBe(8);
    await f.session.play();
    expect(f.ons.map(note => note.midi)).toEqual([60, 64, 67]);

    // Paused, a revision is adopted without another command.
    await f.session.pause();
    const commits = f.session.snapshot.revision;
    document.replace(score([{start: 0, duration: 8, midi: 72}]));
    expect((await f.player.waitForDocumentRevision(document.getSnapshot())).status).toBe('applied');
    await flush();
    expect(f.session.snapshot.revision).toBe(commits);
    await f.session.play();
    expect(f.ons.at(-1)!.midi).toBe(72);
  });
});
