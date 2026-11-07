// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {checkModuleConformance, getModulePort, ModuleAudioEnvironment, ModuleContext, NoteOutputPort, SOURCE_SCHEMAS} from '@webmusic/kernel/module';
import {SessionTransport} from '@webmusic/kernel/session';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {
  MidiNoteSink, MidiNoteSource, recordNoteOutput, ScorePlayer, ScorePlayerModule, ScoreRackModule,
  ScoreRecorderSession, type HeadlessSynth, type MidiInputLike,
} from '../../src/play/headless';

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
  await settle();
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('ScorePlayerModule ports', () => {
  it('exposes note, source, transport and, once prepared, audio ports', async () => {
    const {scope, session, audio} = fixture();
    const module = new ScorePlayerModule(score(), {id: 'lead', context: scope});
    cleanups.push(() => audio.dispose(), () => session.dispose(), () => module.dispose());
    expect(module.ports().map(port => `${port.family}/${port.id}`)).toEqual(['note/notes', 'source/source', 'transport/transport']);
    const source = getModulePort(module, 'source', 'source')!;
    expect(source.schemaId).toBe(SOURCE_SCHEMAS.score);
    expect(source.snapshot().value).toBe(module.player.playback);
    await module.prepare();
    expect(getModulePort(module, 'main', 'audio')).toBe(module.player.audioOutput);
  });

  it('plays exact voices from a note port and cancels them when the producer disconnects', async () => {
    const {context, synth, scope, session, audio} = fixture();
    let sequence = 0;
    Object.assign(synth, {supportsNoteOccurrences: true, noteOn: vi.fn(() => ++sequence), noteOffById: vi.fn()});
    const player = new ScorePlayer(score(), {audioContext: context, synth});
    const module = new ScorePlayerModule(score(), {id: 'keys', context: scope, player});
    cleanups.push(() => audio.dispose(), () => session.dispose(), () => player.dispose(), () => module.dispose());
    const keyboard = new NoteOutputPort({id: 'keyboard'});
    const lease = module.notes.connect(keyboard);
    const base = {sourceId: 'keyboard', pitch: {midi: 60}, velocity: 0.8, axis: 'performance-seconds', time: 0, epoch: 0} as const;
    keyboard.emit({...base, occurrenceId: 'a', gate: 'on'});
    keyboard.emit({...base, occurrenceId: 'b', gate: 'on'});
    await settle();
    expect(synth.noteOn).toHaveBeenCalledTimes(2);
    keyboard.emit({...base, occurrenceId: 'a', gate: 'off'});
    expect(synth.noteOffById).toHaveBeenCalledTimes(1);
    lease.release();
    expect(synth.noteOffById).toHaveBeenCalledTimes(2);
  });

  it('re-routes in place when only the destination changes and refuses a scope change', async () => {
    const {context, scope, session, audio} = fixture();
    const first = context.createGain();
    const second = context.createGain();
    const parent = scope.derive({id: 'first', destination: () => first});
    const module = new ScorePlayerModule(score(), {id: 'lead', context: parent});
    cleanups.push(() => audio.dispose(), () => session.dispose(), () => module.dispose());
    await module.prepare();
    const player = module.player;
    expect(player.audioOutput!.defaultDestination).toBe(first);
    expect(module.retarget(scope.derive({id: 'second', destination: () => second}))).toBe(true);
    expect(module.player).toBe(player);
    expect(player.audioOutput!.defaultDestination).toBe(second);
    expect(session.snapshot.participantCount).toBe(1);
    const other = new ModuleContext({id: 'other', audio, session: new SessionTransport(() => 0)});
    expect(module.retarget(other)).toBe(false);
  });

  it('passes the conformance kit, as does the Score Rack', async () => {
    const {scope, session, audio} = fixture();
    cleanups.push(() => audio.dispose(), () => session.dispose());
    const player = await checkModuleConformance(() => {
      const module = new ScorePlayerModule(score(), {id: 'lead', context: scope});
      return {module, dispose: () => module.dispose()};
    }, {expectedId: 'lead', borrowedPorts: ['transport/transport']});
    expect(player.failures).toEqual([]);
    const rack = await checkModuleConformance(() => {
      const module = new ScoreRackModule(scope, {id: 'desk'});
      return {module, dispose: () => module.dispose()};
    }, {expectedId: 'desk'});
    expect(rack.failures).toEqual([]);
  });
});

describe('MIDI note modules', () => {
  it('turns Web MIDI messages into owned occurrences and restores the previous handler', () => {
    const previous = vi.fn();
    const input: MidiInputLike = {onmidimessage: previous};
    const source = new MidiNoteSource(input, {id: 'pads'});
    const events: string[] = [];
    source.notes.subscribe(event => events.push(`${event.occurrenceId}:${event.gate}:${event.pitch.midi}`));
    input.onmidimessage!({data: [0x90, 60, 100]});
    input.onmidimessage!({data: [0x91, 60, 90]});
    input.onmidimessage!({data: [0x80, 60, 0]});
    input.onmidimessage!({data: [0x90, 62, 0]});
    expect(events).toEqual(['pads-1:on:60', 'pads-2:on:60', 'pads-1:off:60']);
    source.dispose();
    expect(events.at(-1)).toBe('pads-2:cancel:60');
    expect(input.onmidimessage).toBe(previous);
  });

  it('sends each occurrence to a MIDI output and releases held notes on disposal', () => {
    const sent: number[][] = [];
    const sink = new MidiNoteSink({send: (data) => sent.push([...data])}, {channel: 2});
    const keys = new NoteOutputPort();
    sink.notes.connect(keys);
    const base = {sourceId: 'keys', pitch: {midi: 64}, velocity: 1, axis: 'performance-seconds', time: 0, epoch: 0} as const;
    keys.emit({...base, occurrenceId: 'x', gate: 'on'});
    keys.emit({...base, occurrenceId: 'y', gate: 'on', pitch: {midi: 67}});
    keys.emit({...base, occurrenceId: 'x', gate: 'off', velocity: 0});
    sink.dispose();
    expect(sent).toEqual([[0x92, 64, 127], [0x92, 67, 127], [0x82, 64, 0], [0x82, 67, 0]]);
  });

  it('records a note source into a take', () => {
    let time = 0;
    const recorder = new ScoreRecorderSession(() => time);
    recorder.start();
    const keys = new NoteOutputPort();
    const lease = recordNoteOutput(recorder, keys);
    const base = {sourceId: 'keys', pitch: {midi: 60}, velocity: 0.5, axis: 'performance-seconds', time: 0, epoch: 0} as const;
    keys.emit({...base, occurrenceId: 'a', gate: 'on'});
    time = 0.5;
    keys.emit({...base, occurrenceId: 'a', gate: 'off'});
    lease.release();
    keys.emit({...base, occurrenceId: 'b', gate: 'on'});
    const notes = recorder.finish()!;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({midi: 60, onsetSec: 0, durationSec: 0.5});
  });
});
