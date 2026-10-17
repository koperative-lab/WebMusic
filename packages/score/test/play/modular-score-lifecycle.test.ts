// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ModuleAudioEnvironment, ModuleContext} from '@webmusic/kernel/module';
import {SessionTransport} from '@webmusic/kernel/session';
import {notifyModuleContext, provideModuleContext, requestModuleContext} from '@webmusic/kernel/element';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {ScoreRackModule, type HeadlessSynth} from '../../src/play/headless';
import {defineScorePlayerElement, ScorePlayerElement} from '../../src/play/element/score-player';
import {defineRackControlElement, RackControlElement} from '../../src/play/element/score-rack-control';
import {defineRackPartElement, RackPartElement} from '../../src/play/element/score-rack-part';

vi.mock('../../src/io/load', () => ({loadScoreFromUrl: vi.fn()}));

defineScorePlayerElement();
defineRackControlElement();
defineRackPartElement();
class DelayedScoreElement extends ScorePlayerElement {
  pending!: Promise<Score>;
  protected override resolveScore(): Promise<Score> { return this.pending; }
}
customElements.define('lifecycle-delayed-score', DelayedScoreElement);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

function score(durationSeconds = 2) {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('p'), name: 'Part'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  builder.addMeasure({id: MeasureId('m'), number: 1, onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4), timeSignature: {numerator: 4, denominator: 4}});
  builder.addNote(part, {id: builder.newNoteId(), voice: VoiceId('v'), pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO, duration: Duration.whole(), performed: {onsetSec: 0, durationSec: durationSeconds, velocity: 100}});
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
  vi.clearAllMocks();
  vi.useRealTimers();
});


describe('Score modular scope and source lifecycle', () => {
  it('honors a root destination assigned after connection', async () => {
    const f = fixture(); f.session.dispose();
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules'); root.audioContext = f.context; root.sound = f.synth; root.score = score();
    const probe = document.createElement('div'); root.append(probe); document.body.append(root); await settle();
    await requestModuleContext(probe)!.session!.preload();
    const requested = f.context.createGain(); root.destination = requested; await settle();
    await requestModuleContext(probe)!.session!.preload();
    expect(root.module!.getPort!('output')!.defaultDestination === requested).toBe(true);
    expect(root.module!.getPort!('output')!.defaultDestination === f.context.destination).toBe(false);
  });

  it('exposes its documented SessionTransport property', async () => {
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules'); const probe = document.createElement('div'); root.append(probe);
    document.body.append(root); await settle();
    expect(requestModuleContext(probe)!.session).toBeDefined();
    expect(root.sessionTransport).toBe(requestModuleContext(probe)!.session);
  });

  it('transfers pending-source ownership when an unresolved rack part moves Sessions', async () => {
    const {loadScoreFromUrl} = await import('../../src/io/load');
    const load = deferred<Score>(); vi.mocked(loadScoreFromUrl).mockReturnValueOnce(load.promise);
    const a = fixture(), b = fixture();
    const first = document.createElement('div'), second = document.createElement('div');
    first.setAttribute('composition', 'modules'); second.setAttribute('composition', 'modules');
    cleanups.push(() => a.session.dispose(), () => b.session.dispose(), provideModuleContext(first, () => a.scope), provideModuleContext(second, () => b.scope));
    const deskA = document.createElement('score-rack-control'), deskB = document.createElement('score-rack-control');
    const part = document.createElement('score-rack-part') as RackPartElement;
    part.setAttribute('src', 'slow.mid'); part.sound = a.synth;
    deskA.append(part); first.append(deskA); second.append(deskB); document.body.append(first, second); await settle();
    expect(a.session.snapshot.pendingSourceCount).toBe(1); expect(b.session.snapshot.pendingSourceCount).toBe(0);
    deskB.append(part); await settle();
    expect(a.session.snapshot.pendingSourceCount).toBe(0);
    expect(b.session.snapshot.pendingSourceCount).toBe(1);
    let oldReady = false, newReady = false;
    const oldPreparation = a.session.preload().then(() => { oldReady = true; });
    const newPreparation = b.session.preload().then(() => { newReady = true; });
    await settle();
    expect(oldReady).toBe(true);
    expect(newReady).toBe(false);
    expect(loadScoreFromUrl).toHaveBeenCalledTimes(1);
    load.resolve(score()); await settle();
    await Promise.all([oldPreparation, newPreparation]);
    expect(b.session.snapshot.pendingSourceCount).toBe(0);
    expect(b.session.snapshot.participantCount).toBe(1);
  });

  it('revokes old playback data when its provider becomes pending', async () => {
    const f = fixture(); let scope: ModuleContext | undefined = f.scope;
    const host = document.createElement('div'); host.setAttribute('composition', 'modules');
    cleanups.push(() => f.session.dispose(), provideModuleContext(host, () => scope));
    const child = document.createElement('score-player') as ScorePlayerElement;
    child.score = score(); child.sound = f.synth; child.setAttribute('controls', 'show'); host.append(child); document.body.append(host); await settle();
    expect(child.playback.snapshot().readiness).toBe('ready');
    const oldButton = child.querySelector<HTMLButtonElement>('button')!;
    scope = undefined; notifyModuleContext(host); await settle();
    expect(f.session.snapshot.participantCount).toBe(0); expect(child.module).toBeUndefined();
    expect(child.playback.snapshot().readiness).not.toBe('ready');
    expect(child.playback.snapshot().score).toBeUndefined();
    expect(child.querySelector('button')).toBeNull();
    oldButton.click(); await settle();
    expect(f.session.snapshot.paused).toBe(true);
    scope = f.scope; notifyModuleContext(host); await settle();
    expect(child.sessionTransport).toBe(f.session);
    expect(child.playback.snapshot().readiness).toBe('ready');
    expect(child.playback.snapshot().score).toBe(child.score);
  });

  it('moves failed source readiness without an implicit retry and clears it on replacement', async () => {
    const {loadScoreFromUrl} = await import('../../src/io/load');
    const load = deferred<Score>(); vi.mocked(loadScoreFromUrl).mockReturnValueOnce(load.promise);
    const a = fixture(), b = fixture();
    const first = document.createElement('div'), second = document.createElement('div');
    first.setAttribute('composition', 'modules'); second.setAttribute('composition', 'modules');
    cleanups.push(() => a.session.dispose(), () => b.session.dispose(), provideModuleContext(first, () => a.scope), provideModuleContext(second, () => b.scope));
    const deskA = document.createElement('score-rack-control'), deskB = document.createElement('score-rack-control');
    const part = document.createElement('score-rack-part') as RackPartElement;
    part.setAttribute('src', 'failed.mid'); part.sound = a.synth;
    deskA.append(part); first.append(deskA); second.append(deskB); document.body.append(first, second); await settle();
    load.reject(new Error('download failed')); await settle();
    await expect(a.session.preload()).rejects.toThrow('download failed');
    deskB.append(part); await settle();
    await expect(a.session.preload()).resolves.toBeUndefined();
    await expect(b.session.preload()).rejects.toThrow('download failed');
    expect(loadScoreFromUrl).toHaveBeenCalledTimes(1);
    part.score = score(); await settle();
    await expect(b.session.preload()).resolves.toBeUndefined();
    expect(b.session.snapshot.pendingSourceCount).toBe(0);
    expect(b.session.snapshot.participantCount).toBe(1);
  });

  it('applies the aggregate loop once a late child supplies duration', async () => {
    const {context, synth, session: unusedSession} = fixture();
    unusedSession.dispose();
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules'); root.setAttribute('loop', ''); root.audioContext = context;
    const child = document.createElement('lifecycle-delayed-score') as DelayedScoreElement;
    const pending = deferred<Score>(); child.pending = pending.promise; child.setAttribute('src', 'pending.mid'); child.sound = synth;
    root.append(child); document.body.append(root); await settle();
    const session = requestModuleContext(child)!.session!;
    expect(session.snapshot.durationSeconds).toBeNull();
    pending.resolve(score()); await settle();
    expect(session.snapshot.durationSeconds).toBe(2);
    expect(root.loop).toBe(true);
    expect(session.snapshot.loop).toEqual({startSeconds: 0, endSeconds: 2});
  });

  it('uses declaration ids as channel labels', async () => {
    const {context, synth, session: unusedSession} = fixture(); unusedSession.dispose();
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules'); root.audioContext = context;
    const desk = document.createElement('score-rack-control') as RackControlElement;
    const part = document.createElement('score-rack-part') as RackPartElement;
    part.id = 'lead'; part.score = score(); part.sound = synth; desk.append(part); root.append(desk); document.body.append(root); await settle();
    await requestModuleContext(part)!.session!.preload();
    expect(Array.from(desk.shadowRoot!.querySelectorAll('[part~=rack-control-label]')).map(e => e.textContent)).toContain('lead');
  });

  it('a root audioContext replacement is used by its replacement engine', async () => {
    const f = fixture(), g = fixture(); f.session.dispose(); g.session.dispose();
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules'); root.audioContext = f.context; root.sound = f.synth; root.score = score();
    const probe = document.createElement('div'); root.append(probe); document.body.append(root); await settle(); await requestModuleContext(probe)!.session!.preload();
    root.audioContext = g.context; await settle();
    await expect(requestModuleContext(probe)!.session!.preload()).resolves.toBeUndefined();
    expect(root.module!.getPort!('output')!.context).toBe(g.context);
    expect(f.context.close).not.toHaveBeenCalled();
    expect(g.context.close).not.toHaveBeenCalled();
  });

  it('rejects incompatible audio edits before disturbing the current source', async () => {
    const f = fixture(), g = fixture(); f.session.dispose(); g.session.dispose();
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules'); root.audioContext = f.context; root.destination = f.context.createGain();
    root.score = score(); root.sound = f.synth; document.body.append(root); await settle();
    const session = root.sessionTransport!;
    await session.preload();
    const output = root.module!.getPort!('output');
    const revision = root.playback.snapshot().sourceRevision;
    expect(() => { root.audioContext = g.context; }).toThrow(/same AudioContext/);
    expect(() => { root.destination = g.context.createGain(); }).toThrow(/same AudioContext/);
    expect(root.audioContext).toBe(f.context);
    expect(root.module!.getPort!('output')).toBe(output);
    expect(root.playback.snapshot().sourceRevision).toBe(revision);
    expect(root.sessionTransport).toBe(session);
    expect(f.context.close).not.toHaveBeenCalled();
  });

  it('rebinds descendant buses to a changed root route and reference context', async () => {
    const f = fixture(), g = fixture(); f.session.dispose(); g.session.dispose();
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules'); root.audioContext = f.context;
    const desk = document.createElement('score-rack-control') as RackControlElement;
    const leaf = document.createElement('score-player') as ScorePlayerElement;
    leaf.score = score(); leaf.sound = f.synth; desk.append(leaf); root.append(desk); document.body.append(root); await settle();
    const firstSession = root.sessionTransport!;
    await firstSession.preload();
    const firstOutput = desk.module!.getPort!('output')!;
    const destination = f.context.createGain(); root.destination = destination; await settle();
    await root.sessionTransport!.preload();
    expect(root.sessionTransport).toBe(firstSession);
    expect(firstOutput.disposed).toBe(true);
    expect(desk.module!.getPort!('output')!.defaultDestination).toBe(destination);
    root.destination = undefined; root.audioContext = g.context; await settle();
    await root.sessionTransport!.preload();
    expect(root.sessionTransport).not.toBe(firstSession);
    expect(firstSession.snapshot.disposed).toBe(true);
    expect(leaf.sessionTransport).toBe(root.sessionTransport);
    expect(root.sessionTransport!.snapshot.participantCount).toBe(1);
    expect(leaf.module!.getPort!('output')!.context).toBe(g.context);
    expect(desk.module!.getPort!('output')!.defaultDestination).toBe(g.context.destination);
    expect(f.context.close).not.toHaveBeenCalled();
    expect(g.context.close).not.toHaveBeenCalled();
  });

  it('drops and restores a loading part reservation across a pending provider', async () => {
    const {loadScoreFromUrl} = await import('../../src/io/load');
    const load = deferred<Score>(); vi.mocked(loadScoreFromUrl).mockReturnValueOnce(load.promise);
    const f = fixture(); let scope: ModuleContext | undefined = f.scope;
    const host = document.createElement('div'); host.setAttribute('composition', 'modules');
    cleanups.push(() => f.session.dispose(), provideModuleContext(host, () => scope));
    const desk = document.createElement('score-rack-control');
    const part = document.createElement('score-rack-part') as RackPartElement;
    part.setAttribute('src', 'pending.mid'); part.sound = f.synth;
    desk.append(part); host.append(desk); document.body.append(host); await settle();
    expect(f.session.snapshot.pendingSourceCount).toBe(1);
    scope = undefined; notifyModuleContext(host); await settle();
    expect(f.session.snapshot.pendingSourceCount).toBe(0);
    scope = f.scope; notifyModuleContext(host); await settle();
    expect(f.session.snapshot.pendingSourceCount).toBe(1);
    load.resolve(score()); await settle(); await f.session.preload();
    expect(loadScoreFromUrl).toHaveBeenCalledTimes(1);
    expect(f.session.snapshot.pendingSourceCount).toBe(0);
    expect(f.session.snapshot.participantCount).toBe(1);
    part.remove(); await settle();
    expect(f.session.snapshot.participantCount).toBe(0);
    expect(f.context.close).not.toHaveBeenCalled();
  });

  it('keeps loop bounds current as aggregate sources are replaced or removed', async () => {
    const f = fixture(); f.session.dispose();
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules'); root.loop = true; root.audioContext = f.context;
    const child = document.createElement('score-player') as ScorePlayerElement;
    child.score = score(); child.sound = f.synth; root.append(child); document.body.append(root); await settle();
    expect(root.sessionTransport!.snapshot.loop).toEqual({startSeconds: 0, endSeconds: 2});
    child.score = score(6); await settle();
    expect(root.sessionTransport!.snapshot.loop).toEqual({startSeconds: 0, endSeconds: 6});
    child.remove(); await settle();
    expect(root.loop).toBe(true);
    expect(root.sessionTransport!.snapshot.loop).toBeNull();
    root.append(child); await settle();
    expect(root.sessionTransport!.snapshot.loop).toEqual({startSeconds: 0, endSeconds: 6});
    root.remove(); await settle();
    expect(root.sessionTransport).toBeUndefined();
    expect(child.playback.snapshot().readiness).toBe('disposed');
  });

  it('keeps declaration order and rename edits separate from module identity and mix', async () => {
    const {loadScoreFromUrl} = await import('../../src/io/load');
    const leadLoad = deferred<Score>(), bassLoad = deferred<Score>();
    vi.mocked(loadScoreFromUrl).mockImplementation(url => url === 'lead.mid' ? leadLoad.promise : bassLoad.promise);
    const f = fixture(); f.session.dispose();
    const root = document.createElement('score-player') as ScorePlayerElement;
    root.setAttribute('composition', 'modules'); root.audioContext = f.context;
    const desk = document.createElement('score-rack-control') as RackControlElement;
    const lead = document.createElement('score-rack-part') as RackPartElement;
    const bass = document.createElement('score-rack-part') as RackPartElement;
    lead.id = 'lead'; bass.id = 'bass'; lead.sound = f.synth; bass.sound = f.synth;
    lead.setAttribute('src', 'lead.mid'); bass.setAttribute('src', 'bass.mid');
    desk.append(lead); root.append(desk); document.body.append(root); await settle();
    desk.append(bass); await settle();
    bassLoad.resolve(score()); await settle(); leadLoad.resolve(score()); await settle();
    await root.sessionTransport!.preload();
    const labels = () => Array.from(desk.shadowRoot!.querySelectorAll('[part~=rack-control-label]')).map(element => element.textContent);
    expect(labels()).toEqual(['master', 'lead', 'bass']);
    const module = lead.module!;
    const rack = desk.module as ScoreRackModule;
    rack.setVolume(module.id, 0.3); rack.mute(module.id, true);
    lead.id = 'melody'; await settle();
    expect(labels()).toEqual(['master', 'melody', 'bass']);
    desk.prepend(bass); await settle();
    expect(labels()).toEqual(['master', 'bass', 'melody']);
    expect(lead.module).toBe(module);
    expect(rack.list().find(channel => channel.id === module.id)).toMatchObject({volume: 0.3, muted: true});
    expect(loadScoreFromUrl).toHaveBeenCalledTimes(2);
  });
});
