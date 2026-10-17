// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ModuleAudioEnvironment, ModuleContext} from '@webmusic/kernel/module';
import {SessionTransport} from '@webmusic/kernel/session';
import {notifyModuleContext, provideModuleContext, requestModuleContext} from '@webmusic/kernel/element';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {Effect, SCORE_NOTE_INPUT, ScorePlayer, ScorePlayerModule, ScoreRackModule, type HeadlessSynth} from '../../src/play/headless';
import {defineScorePlayerElement, ScorePlayerElement} from '../../src/play/element/score-player';
import {defineRackControlElement, RackControlElement} from '../../src/play/element/score-rack-control';
import {defineRackPartElement, RackPartElement} from '../../src/play/element/score-rack-part';
import {defineNoteInputElement, NoteInputElement} from '../../src/play/element/score-note-input';

defineScorePlayerElement();
defineRackControlElement();
defineRackPartElement();
defineNoteInputElement();
customElements.define('module-custom-desk', class extends RackControlElement {});
class DelayedScoreElement extends ScorePlayerElement {
  pending!: Promise<Score>;
  protected override resolveScore(): Promise<Score> { return this.pending; }
}
customElements.define('module-delayed-score', DelayedScoreElement);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function score() {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('p'), name: 'Part'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  builder.addMeasure({id: MeasureId('m'), number: 1, onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4}});
  builder.addNote(part, {id: builder.newNoteId(), voice: VoiceId('v'), pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO, duration: Duration.whole()});
  return builder.build();
}

function fixture() {
  const context = {} as AudioContext;
  const edges = new Map<AudioNode, Set<AudioNode>>();
  const node = () => {
    const parameter = () => ({value: 1, defaultValue: 1, minValue: -100, maxValue: 100,
      setValueAtTime: vi.fn(), cancelScheduledValues: vi.fn()});
    const result = {context, gain: parameter(), pan: parameter(),
      connect: vi.fn((to: AudioNode) => { edges.get(result)!.add(to); return to; }),
      disconnect: vi.fn((to?: AudioNode) => { if (to) edges.get(result)!.delete(to); else edges.get(result)!.clear(); }),
    } as unknown as GainNode;
    edges.set(result, new Set());
    return result;
  };
  Object.assign(context, {state: 'running', currentTime: 0, sampleRate: 48000,
    destination: node(), createGain: vi.fn(node), createStereoPanner: vi.fn(node),
    resume: vi.fn(async () => {}), close: vi.fn(async () => {})});
  const synth: HeadlessSynth = {connect: vi.fn(() => vi.fn()), noteOn: vi.fn(), noteOff: vi.fn(), dispose: vi.fn()};
  const session = new SessionTransport(() => context.currentTime);
  const audio = new ModuleAudioEnvironment({context});
  const scope = new ModuleContext({id: 'root', audio, session});
  return {context, edges, synth, session, scope, audio};
}

const cleanups: Array<() => void> = [];
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(async () => {
  document.body.replaceChildren();
  await settle();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
});

describe('Score module graph and Session integration', () => {
  it('routes nested real-player inputs to exact borrowed voices once without starting transport', async () => {
    const {context, synth, session: unusedSession} = fixture();
    unusedSession.dispose();
    let sequence = 0;
    Object.assign(synth, {supportsNoteOccurrences: true, noteOn: vi.fn(() => ++sequence), noteOffById: vi.fn()});
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules');
    root.audioContext = context;
    const child = document.createElement('score-player') as ScorePlayerElement;
    child.score = score();
    child.sound = synth;
    const inputs = Array.from({length: 2}, () => {
      const element = document.createElement('score-note-input') as NoteInputElement;
      element.setAttribute('keyboard', '');
      element.setAttribute('start', '60');
      return element;
    });
    child.append(...inputs);
    root.append(child);
    document.body.append(root);
    await settle();
    const session = requestModuleContext(child)!.session!;
    expect(context.createGain).not.toHaveBeenCalled();
    for (const element of inputs) {
      element.shadowRoot!.querySelector('.wui-note')!.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyA', bubbles: true}));
    }
    await settle();
    expect(synth.noteOn).toHaveBeenCalledTimes(2);
    expect(synth.noteOn).toHaveBeenNthCalledWith(1, 60, 100, 0, Infinity);
    expect(synth.noteOn).toHaveBeenNthCalledWith(2, 60, 100, 0, Infinity);
    expect(child.playback.snapshot().state).not.toBe('playing');
    expect(session.snapshot.paused).toBe(true);
    inputs[0].remove();
    expect(synth.noteOffById).toHaveBeenCalledExactlyOnceWith(1, 0);
    inputs[1].releaseHeld();
    expect(synth.noteOffById).toHaveBeenLastCalledWith(2, 0);
    expect(synth.noteOff).not.toHaveBeenCalled();
    root.remove();
    await settle();
    expect(synth.dispose).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });

  it('owns only module input occurrences when detaching a borrowed engine', async () => {
    const {context, synth, scope, session, audio} = fixture();
    let sequence = 0;
    Object.assign(synth, {supportsNoteOccurrences: true, noteOn: vi.fn(() => ++sequence), noteOffById: vi.fn()});
    const player = new ScorePlayer(score(), {audioContext: context, synth});
    const module = new ScorePlayerModule(score(), {id: 'live', context: scope, player});
    cleanups.push(() => audio.dispose(), () => session.dispose(), () => player.dispose(), () => module.dispose());
    const target = module.capabilities.get(SCORE_NOTE_INPUT)!;
    await target.prepare();
    player.noteOnOccurrence({id: 'external-input', midi: 60, velocity: 100});
    target.noteOn({id: 'module-input', midi: 60, velocity: 100});
    expect(player.isPlaying()).toBe(false);
    module.dispose();
    expect(synth.noteOffById).toHaveBeenCalledExactlyOnceWith(2, 0);
    expect(synth.dispose).not.toHaveBeenCalled();
    player.noteOffOccurrence('external-input');
    expect(synth.noteOffById).toHaveBeenLastCalledWith(1, 0);
    expect(synth.noteOff).not.toHaveBeenCalled();
  });

  it('replaces a live local effect without restarting the engine or changing its output port', async () => {
    vi.useFakeTimers();
    const {context, synth} = fixture();
    const player = new ScorePlayer(score(), {audioContext: context, synth, effect: Effect.gain(0.2)});
    cleanups.push(() => player.dispose());
    await player.play();
    const output = player.audioOutput;
    const chain = player.inserts!;
    const previous = chain.instances[0];
    player.setEffect(Effect.gain(0.7));
    expect(player.isPlaying()).toBe(true);
    expect(player.audioOutput).toBe(output);
    expect(player.inserts).toBe(chain);
    expect(chain.instances[0]).not.toBe(previous);
    expect(synth.connect).toHaveBeenCalledTimes(1);
    expect(() => player.setEffect(Effect.custom(() => { throw new Error('factory failed'); }))).toThrow('factory failed');
    expect(chain.instances[0].params.get('gain')?.snapshot.baseValue).toBe(0.7);
    expect(player.isPlaying()).toBe(true);
  });

  it('prepares nested Rack buses lazily and preserves borrowed engine lifetime on detach', async () => {
    const {context, synth, scope, session, audio, edges} = fixture();
    const outer = new ScoreRackModule(scope, {id: 'outer'});
    const inner = new ScoreRackModule(outer.context, {id: 'inner'});
    const player = new ScorePlayer(score(), {audioContext: context, synth});
    const module = new ScorePlayerModule(score(), {id: 'voice', context: inner.context, player});
    cleanups.push(() => audio.dispose(), () => session.dispose(), () => player.dispose(), () => outer.dispose(), () => inner.dispose(), () => module.dispose());
    expect(context.createGain).not.toHaveBeenCalled();
    expect(session.snapshot.participantCount).toBe(1);
    expect(inner.list()).toHaveLength(0);
    await session.preload();
    expect(inner.list().map((channel) => channel.id)).toEqual(['voice']);
    expect(outer.list().map((channel) => channel.id)).toEqual(['inner']);
    expect(context.resume).not.toHaveBeenCalled();
    expect(edges.get(player.audioOutput!.node)?.has(context.destination)).toBe(false);
    const channel = inner.channelInserts('voice')!;
    channel.setCompatibility(Effect.gain(0.4));
    inner.setEffect(Effect.gain(0.6));
    expect(edges.get(player.audioOutput!.defaultDestination!)?.has(channel.input)).toBe(true);
    const master = [...edges.get(channel.output)!][0];
    expect(edges.get(master)?.has(inner.inserts!.input)).toBe(true);
    expect(player.inserts!.instances).toHaveLength(0);
    expect(inner.channelInserts('voice')).toBe(channel);
    const nativeDispose = vi.spyOn(player, 'dispose');
    module.dispose();
    expect(inner.list()).toHaveLength(0);
    expect(session.snapshot.participantCount).toBe(0);
    expect(player.audioOutput!.defaultDestination).toBeUndefined();
    expect(channel.disposed).toBe(true);
    expect(inner.inserts!.disposed).toBe(false);
    expect(nativeDispose).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });

  it('keeps a source-free root as one Session with nested sources and independent control views', async () => {
    const {context, synth, session: unusedSession} = fixture();
    unusedSession.dispose();
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules');
    root.audioContext = context;
    const desk = document.createElement('score-rack-control') as RackControlElement;
    const child = document.createElement('score-player') as ScorePlayerElement;
    child.score = score();
    child.sound = synth;
    desk.append(child);
    root.append(desk);
    document.body.append(root);
    await settle();
    const style = document.createElement('style');
    style.textContent = '.wui-transport { display: flex; }';
    document.body.append(style);
    const session = requestModuleContext(child)!.session!;
    expect(session.snapshot.participantCount).toBe(1);
    expect(root.module?.getPort?.('output')).toBeUndefined();
    expect(root.resolvedScore).toBeUndefined();
    expect(context.createGain).not.toHaveBeenCalled();
    const rootControls = root.querySelector<HTMLElement>(':scope > [data-rack-transport] > .wui-transport')!;
    const childControls = child.querySelector<HTMLElement>(':scope > [data-rack-transport] > .wui-transport')!;
    expect(rootControls.hidden).toBe(false);
    expect(getComputedStyle(rootControls).display).toBe('flex');
    expect(childControls.hidden).toBe(true);
    expect(getComputedStyle(childControls).display).toBe('none');
    const engine = child.playback.snapshot();
    child.setAttribute('controls', 'show');
    expect(child.playback.snapshot().sourceRevision).toBe(engine.sourceRevision);
    expect(childControls.hidden).toBe(false);
    expect(getComputedStyle(childControls).display).toBe('flex');
    child.setAttribute('controls', 'auto');
    expect(getComputedStyle(childControls).display).toBe('none');
    root.setAttribute('controls', 'hide');
    expect(getComputedStyle(rootControls).display).toBe('none');
    root.setAttribute('controls', 'auto');
    expect(getComputedStyle(rootControls).display).toBe('flex');
    await session.preload();
    expect((desk.module as ScoreRackModule).list()).toHaveLength(1);
    expect(child.module?.getPort?.('output')).toBeDefined();
    expect(root.module?.getPort?.('output')).toBeUndefined();
    expect(root.contains(child)).toBe(true);
    const port = child.module?.getPort?.('output');
    desk.prepend(child);
    await settle();
    expect(child.module?.getPort?.('output')).toBe(port);
    expect(session.snapshot.participantCount).toBe(1);
  });

  it('adopts declarations under a custom-tag desk and exposes the same runtime for external targets', async () => {
    const {context, synth, session: unusedSession} = fixture();
    unusedSession.dispose();
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules');
    root.audioContext = context;
    const desk = document.createElement('module-custom-desk') as RackControlElement;
    const part = document.createElement('score-rack-part') as RackPartElement;
    part.id = 'declared-voice';
    part.score = score();
    part.sound = synth;
    desk.append(part);
    root.append(desk);
    document.body.append(root);
    await settle();
    const first = part.module;
    const session = requestModuleContext(part)!.session!;
    expect(first).toBeDefined();
    expect(desk.rackPartModule(part)).toBe(first);
    expect(session.snapshot.participantCount).toBe(1);
    expect(context.createGain).not.toHaveBeenCalled();
    part.id = 'renamed-voice';
    expect(part.module).toBe(first);
    part.score = score();
    await settle();
    expect(part.module).not.toBe(first);
    expect(session.snapshot.participantCount).toBe(1);
    await session.preload();
    expect((desk.module as ScoreRackModule).list()[0].module).toBe(part.module);
    expect(part.module?.getPort?.('output')).toBeDefined();
  });

  it('retains a child engine when its parent republishes only the current source target', async () => {
    const {scope, session, synth} = fixture();
    let upstream = scope;
    const host = document.createElement('div');
    host.setAttribute('composition', 'modules');
    cleanups.push(() => session.dispose(), provideModuleContext(host, () => upstream));
    const child = document.createElement('score-player') as ScorePlayerElement;
    child.score = score();
    child.sound = synth;
    host.append(child);
    document.body.append(host);
    await settle();
    await session.preload();
    const output = child.module?.getPort?.('output');
    const revision = child.playback.snapshot().sourceRevision;
    upstream = scope.derive({id: 'new-parent-source', target: {id: 'new-source'}});
    notifyModuleContext(host);
    await settle();
    expect(child.module?.getPort?.('output')).toBe(output);
    expect(child.playback.snapshot().sourceRevision).toBe(revision);
    expect(session.snapshot.participantCount).toBe(1);
  });

  it('keeps duration unknown while a declared source loads and waits before preparing its real engine', async () => {
    const {scope, session, synth, context} = fixture();
    const host = document.createElement('div');
    host.setAttribute('composition', 'modules');
    cleanups.push(() => session.dispose(), provideModuleContext(host, () => scope));
    const load = deferred<Score>();
    const child = document.createElement('module-delayed-score') as DelayedScoreElement;
    child.pending = load.promise;
    child.setAttribute('src', 'deferred.mid');
    child.sound = synth;
    host.append(child);
    document.body.append(host);
    await settle();
    expect(session.snapshot.pendingSourceCount).toBe(1);
    expect(session.snapshot.participantCount).toBe(0);
    expect(session.snapshot.durationSeconds).toBeNull();
    expect(session.snapshot.ended).toBe(false);
    let prepared = false;
    const prepare = session.preload().then(() => { prepared = true; });
    await settle();
    expect(prepared).toBe(false);
    expect(context.createGain).not.toHaveBeenCalled();
    load.resolve(score());
    await prepare;
    expect(session.snapshot.pendingSourceCount).toBe(0);
    expect(session.snapshot.participantCount).toBe(1);
    expect(session.snapshot.durationSeconds).toBe(2);
    expect(child.module?.getPort?.('output')).toBeDefined();
  });

  it('keeps load failure blocking until retry or removal, and cancels without registering a late engine', async () => {
    const {scope, session, synth} = fixture();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    cleanups.push(() => errors.mockRestore());
    const host = document.createElement('div');
    host.setAttribute('composition', 'modules');
    cleanups.push(() => session.dispose(), provideModuleContext(host, () => scope));
    const load = deferred<Score>();
    const child = document.createElement('module-delayed-score') as DelayedScoreElement;
    child.pending = load.promise;
    child.setAttribute('src', 'failed.mid');
    child.sound = synth;
    host.append(child);
    document.body.append(host);
    await settle();
    load.reject(new Error('score download failed'));
    await settle();
    await expect(session.preload()).rejects.toThrow('score download failed');
    expect(session.snapshot.durationSeconds).toBeNull();
    expect(session.snapshot.pendingSourceCount).toBe(1);
    const retry = deferred<Score>();
    child.pending = retry.promise;
    child.setAttribute('src', 'retry.mid');
    await settle();
    const pending = session.preload();
    child.remove();
    await settle();
    await pending;
    retry.resolve(score());
    await settle();
    expect(session.snapshot.pendingSourceCount).toBe(0);
    expect(session.snapshot.participantCount).toBe(0);
  });
});
