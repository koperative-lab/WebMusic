import {describe, expect, it, vi} from 'vitest';
import {AudioInputPort, AudioOutputPort} from '../src/module/audio-port';
import {checkModuleConformance} from '../src/module/conformance';
import {ModuleAudioEnvironment, ModuleContext, moduleScopeChange} from '../src/module/context';
import {createControlPort} from '../src/module/control-port';
import {NoteInputPort, NoteOutputPort, type NoteEvent} from '../src/module/note-port';
import {ParamHandle, ParamSurface} from '../src/module/parameter';
import {assertPortInfo, PortListeners} from '../src/module/port';
import {getModulePort, type ModuleHandle, type ModulePort} from '../src/module/registry';
import {SOURCE_SCHEMAS, SourcePublisher} from '../src/module/source-port';
import {createTransportPort} from '../src/module/transport-port';
import {SessionTransport} from '../src/session';

class TestAudioNode {
  readonly connections = new Set<TestAudioNode>();
  channelCount = 2;
  channelInterpretation: ChannelInterpretation = 'speakers';
  constructor(readonly context: BaseAudioContext) {}
  connect(destination: TestAudioNode): TestAudioNode { this.connections.add(destination); return destination; }
  disconnect(destination: TestAudioNode): void {
    if (!destination) throw new Error('global disconnect is forbidden');
    this.connections.delete(destination);
  }
}
const node = (context: BaseAudioContext) => new TestAudioNode(context) as unknown as AudioNode;
const raw = (value: AudioNode) => value as unknown as TestAudioNode;

function note(overrides: Partial<NoteEvent> = {}): NoteEvent {
  return {occurrenceId: 'n1', sourceId: 'keys', pitch: {midi: 60}, velocity: 0.8, gate: 'on',
    axis: 'audio-context-seconds', time: 1, epoch: 0, ...overrides};
}

describe('common port declarations', () => {
  it('validates identity, family, direction, multiplicity, schema version and readiness', () => {
    const base = {id: 'main', family: 'audio', direction: 'output', multiplicity: 'single', schemaVersion: 1, readiness: 'ready'} as const;
    expect(() => assertPortInfo(base)).not.toThrow();
    expect(() => assertPortInfo({...base, id: ' main'})).toThrow(/trimmed/);
    expect(() => assertPortInfo({...base, family: 'midi' as never})).toThrow(/family/);
    expect(() => assertPortInfo({...base, direction: 'both' as never})).toThrow(/direction/);
    expect(() => assertPortInfo({...base, multiplicity: 'many' as never})).toThrow(/multiplicity/);
    expect(() => assertPortInfo({...base, schemaVersion: 0})).toThrow(/schemaVersion/);
    expect(() => assertPortInfo({...base, readiness: 'gone' as never})).toThrow(/readiness/);
  });

  it('skips listeners removed during delivery and reports failures without starving the rest', () => {
    const errors: unknown[] = [];
    const listeners = new PortListeners<number>(error => errors.push(error));
    const seen: string[] = [];
    let stopLast = () => {};
    listeners.add(() => { seen.push('first'); stopLast(); });
    listeners.add(() => { throw new Error('broken'); });
    stopLast = listeners.add(() => seen.push('last'));
    listeners.emit(1);
    expect(seen).toEqual(['first']);
    expect(errors).toHaveLength(1);
  });
});

describe('audio input ports', () => {
  it('admits a producer as its main route and restores the default on release', () => {
    const context = {state: 'running'} as BaseAudioContext;
    const speakers = node(context);
    const output = new AudioOutputPort(node(context), {defaultDestination: speakers});
    const input = new AudioInputPort(node(context), {id: 'in', latencySeconds: 0.002});
    expect(input).toMatchObject({family: 'audio', direction: 'input', multiplicity: 'sum', readiness: 'ready', channelCount: 2});
    const lease = input.connect(output);
    expect(raw(output.node).connections).toEqual(new Set([raw(input.node)]));
    expect(input.producers).toEqual([output]);
    lease.release();
    expect(raw(output.node).connections).toEqual(new Set([raw(speakers)]));
    expect(input.producers).toEqual([]);
  });

  it('rejects a second producer on a single input and a different context before changing routes', () => {
    const context = {state: 'running'} as BaseAudioContext;
    const speakers = node(context);
    const input = new AudioInputPort(node(context), {multiplicity: 'single'});
    input.connect(new AudioOutputPort(node(context)), 'send');
    const second = new AudioOutputPort(node(context), {defaultDestination: speakers});
    expect(() => input.connect(second)).toThrow(/single producer/);
    expect(raw(second.node).connections).toEqual(new Set([raw(speakers)]));
    const foreign = new AudioOutputPort(node({state: 'running'} as BaseAudioContext));
    expect(() => new AudioInputPort(node(context)).connect(foreign)).toThrow(/same context/);
  });

  it('detaches on dispose and releases only its admitted edges', () => {
    const context = {state: 'running'} as BaseAudioContext;
    const output = new AudioOutputPort(node(context));
    const input = new AudioInputPort(node(context));
    input.connect(output, 'send');
    input.dispose();
    input.dispose();
    expect(input.readiness).toBe('detached');
    expect(raw(output.node).connections.size).toBe(0);
    expect(output.readiness).toBe('ready');
  });
});

describe('note ports', () => {
  it('rejects malformed events and off events for occurrences that are not held', () => {
    const output = new NoteOutputPort();
    expect(() => output.emit(note({velocity: 2}))).toThrow(/velocity/);
    expect(() => output.emit(note({pitch: {midi: 128}}))).toThrow(/midi/);
    expect(() => output.emit(note({epoch: -1}))).toThrow(/epoch/);
    expect(() => output.emit(note({gate: 'off'}))).toThrow(/Unknown note occurrence/);
    output.emit(note());
    expect(() => output.emit(note())).toThrow(/already held/);
  });

  it('releases same-pitch occurrences from different sources independently', () => {
    const accepted: NoteEvent[] = [];
    const input = new NoteInputPort({accept: event => accepted.push(event)});
    const keys = new NoteOutputPort({id: 'keys'});
    const midi = new NoteOutputPort({id: 'midi'});
    const keysLease = input.connect(keys);
    input.connect(midi);
    keys.emit(note({occurrenceId: 'a', sourceId: 'keys'}));
    midi.emit(note({occurrenceId: 'b', sourceId: 'midi'}));
    keysLease.release();
    expect(accepted.map(event => `${event.occurrenceId}:${event.gate}`)).toEqual(['a:on', 'b:on', 'a:cancel']);
    midi.emit(note({occurrenceId: 'b', sourceId: 'midi', gate: 'off', time: 2}));
    expect(accepted.at(-1)).toMatchObject({occurrenceId: 'b', gate: 'off', time: 2});
    keys.emit(note({occurrenceId: 'c', sourceId: 'keys'}));
    expect(accepted.some(event => event.occurrenceId === 'c')).toBe(false);
  });

  it('cancels held occurrences when the producer is disposed', () => {
    const accepted: NoteEvent[] = [];
    const input = new NoteInputPort({accept: event => accepted.push(event)});
    const output = new NoteOutputPort();
    input.connect(output);
    output.emit(note());
    output.dispose(5);
    output.dispose();
    expect(accepted.at(-1)).toMatchObject({gate: 'cancel', time: 5});
    expect(output.readiness).toBe('detached');
    expect(output.held).toEqual([]);
  });

  it('enforces single-producer inputs', () => {
    const input = new NoteInputPort({accept: () => {}}, {multiplicity: 'single'});
    input.connect(new NoteOutputPort());
    expect(() => input.connect(new NoteOutputPort())).toThrow(/single producer/);
  });
});

describe('source ports', () => {
  it('commits revisions before listeners run so a reentrant read sees the newest snapshot', () => {
    const source = new SourcePublisher<string>(SOURCE_SCHEMAS.score);
    const reads: string[] = [];
    source.subscribe(snapshot => reads.push(`${snapshot.revision}:${snapshot.readiness}:${source.snapshot().revision}`));
    const pending = source.loading();
    expect(source.ready('arabesque')).toBe(pending + 1);
    expect(reads).toEqual(['1:loading:1', '2:ready:2']);
    expect(source.snapshot()).toMatchObject({readiness: 'ready', value: 'arabesque'});
    source.fail(new Error('missing'));
    expect(source.snapshot().value).toBeUndefined();
  });

  it('keeps the last snapshot after disposal and rejects further commits', () => {
    const source = new SourcePublisher<number>(SOURCE_SCHEMAS.audioClip, {id: 'clip'});
    source.ready(1);
    source.dispose();
    expect(source.readiness).toBe('detached');
    expect(source.snapshot().value).toBe(1);
    expect(() => source.ready(2)).toThrow(/disposed/);
    expect(() => new SourcePublisher('')).toThrow(/schemaId/);
  });
});

describe('transport ports', () => {
  it('projects Session snapshots, lends commands only on request and reports failures as outcomes', async () => {
    let time = 0;
    const session = new SessionTransport(() => time, {driftCheckIntervalMs: 0});
    const readOnly = createTransportPort(session);
    expect(readOnly.commands).toBeUndefined();
    expect(readOnly.snapshot()).toMatchObject({axis: 'session-seconds', playing: false, position: 0});
    const port = createTransportPort(session, {commands: true});
    const seen: number[] = [];
    const stop = port.subscribe(snapshot => seen.push(snapshot.position));
    const sought = await port.commands!.seek(2);
    expect(sought.status).toBe('committed');
    expect(port.snapshot().position).toBe(2);
    expect(seen.at(-1)).toBe(2);
    const bad = await port.commands!.setRate(-1);
    expect(bad.status).toBe('failed');
    expect(bad.error).toBeInstanceOf(Error);
    stop();
    session.dispose();
    expect(port.readiness).toBe('detached');
    time = 1;
  });

  it('is lent through the module context, one port per Session, and a new port changes the scope', () => {
    const session = new SessionTransport(() => 0, {driftCheckIntervalMs: 0});
    const audio = new ModuleAudioEnvironment({context: {state: 'running'} as BaseAudioContext});
    const root = new ModuleContext({id: 'root', audio, session});
    const child = root.derive({id: 'child'});
    expect(root.transport).toBeDefined();
    expect(child.transport).toBe(root.transport);
    expect(moduleScopeChange(root, child)).toBe('none');
    const hidden = root.derive({id: 'hidden', transport: null});
    expect(hidden.transport).toBeUndefined();
    expect(moduleScopeChange(root, hidden)).toBe('scope');
    const independent = root.derive({id: 'local', session: new SessionTransport(() => 0, {driftCheckIntervalMs: 0})});
    expect(independent.transport).not.toBe(root.transport);
    expect(new ModuleContext({id: 'none', audio}).transport).toBeUndefined();
  });
});

describe('module port lookup and conformance', () => {
  function testModule(id = 'lead') {
    const context = {state: 'running'} as BaseAudioContext;
    const output = new AudioOutputPort(node(context), {id: 'main'});
    const notes = new NoteInputPort({accept: () => {}});
    const source = new SourcePublisher(SOURCE_SCHEMAS.score);
    const params = new ParamSurface([new ParamHandle({id: 'gain', label: 'Gain', unit: 'gain', range: {min: 0, max: 1}, defaultValue: 1})]);
    const control = createControlPort(params);
    const ports: readonly ModulePort[] = Object.freeze([output, notes, source, control]);
    const module: ModuleHandle = {
      id, params, ports: () => ports,
      getPort: (name) => name === 'main' ? output : undefined,
      subscribe: () => () => {},
    };
    return {module, dispose() {
      output.dispose(); notes.dispose(); source.dispose();
      for (const handle of params) handle.dispose();
    }};
  }

  it('resolves ports by name, family and direction with the audio shortcut as fallback', () => {
    const {module} = testModule();
    expect(getModulePort(module, 'main', 'audio')?.family).toBe('audio');
    expect(getModulePort(module, 'notes', 'note', 'input')?.direction).toBe('input');
    expect(getModulePort(module, 'notes', 'note', 'output')).toBeUndefined();
    expect(getModulePort(module, 'source', 'source')?.family).toBe('source');
    const shortcutOnly: ModuleHandle = {id: 'old', getPort: () => module.getPort!('main')};
    expect(getModulePort(shortcutOnly, 'main', 'audio')).toBe(module.getPort!('main'));
    expect(getModulePort(shortcutOnly, 'main', 'audio', 'input')).toBeUndefined();
  });

  it('passes a well-formed module and reports every defect of a broken one', async () => {
    const good = await checkModuleConformance(() => testModule(), {expectedId: 'lead'});
    expect(good).toMatchObject({passed: true, instances: 2, failures: []});

    const context = {state: 'running'} as BaseAudioContext;
    const kept = new AudioOutputPort(node(context), {id: 'main'});
    const bad = await checkModuleConformance(() => ({
      module: {
        id: ' bad',
        ports: () => [kept, kept, new AudioOutputPort(node(context), {id: 'main'})],
        getPort: () => new AudioOutputPort(node(context), {id: 'main'}),
        subscribe: () => undefined as unknown as () => void,
      },
      dispose: vi.fn(),
    }), {repetitions: 1});
    expect(bad.passed).toBe(false);
    const checks = new Set(bad.failures.map(failure => failure.check));
    for (const check of ['id', 'ports', 'subscribe', 'dispose']) expect(checks.has(check)).toBe(true);
  });
});
