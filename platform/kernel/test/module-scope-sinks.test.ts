import {describe, expect, it, vi} from 'vitest';
import {AudioOutputPort} from '../src/module/audio-port';
import {checkModuleConformance} from '../src/module/conformance';
import {ModuleAudioEnvironment, ModuleContext} from '../src/module/context';
import {createProviderScope} from '../src/module/provider-scope';
import {CaptureSink, createOfflineModuleEnvironment, DeviceSink} from '../src/module/sinks';
import {SessionTransport} from '../src/session';

function liveContext() {
  const node = () => ({connect: vi.fn(), disconnect: vi.fn(), channelCount: 2, channelInterpretation: 'speakers'}) as unknown as AudioNode;
  const context = {state: 'running', currentTime: 0, destination: node(),
    createMediaStreamDestination: vi.fn(() => ({...node(), stream: {} as MediaStream})),
    setSinkId: vi.fn(async () => {})} as unknown as AudioContext;
  for (const value of [context.destination]) Object.assign(value, {context});
  return context;
}

describe('createProviderScope', () => {
  it('owns a Session and audio environment at the root and borrows both when nested', () => {
    const root = createProviderScope({id: 'root', parent: undefined, audio: {create: () => liveContext()}});
    expect(root.ownedSession).toBeInstanceOf(SessionTransport);
    expect(root.ownedAudio).toBe(root.context.audio);
    expect(root.ownedAudio!.peek()).toBeUndefined();
    const child = createProviderScope({id: 'rack', parent: root.context});
    expect(child.ownedSession).toBeUndefined();
    expect(child.ownedAudio).toBeUndefined();
    expect(child.context.session).toBe(root.session);
    expect(child.context.audio).toBe(root.context.audio);
    const local = createProviderScope({id: 'local', parent: root.context, local: true});
    expect(local.ownedSession).toBeDefined();
    expect(local.context.session).not.toBe(root.session);
    expect(local.context.transport).not.toBe(root.context.transport);
    local.dispose(); local.dispose();
    expect(local.ownedSession!.snapshot.disposed).toBe(true);
    expect(root.session.snapshot.disposed).toBe(false);
    root.dispose();
    expect(root.ownedAudio!.disposed).toBe(true);
  });

  it('elects an outermost Rack as the Session owner and passes target and admission', () => {
    const audio = new ModuleAudioEnvironment({context: liveContext()});
    const parent = new ModuleContext({id: 'page', audio});
    const admit = vi.fn();
    const scope = createProviderScope({id: 'desk', parent, admit, target: null});
    expect(scope.ownedSession).toBeDefined();
    expect(scope.context.admit).toBe(admit);
    expect(scope.context.audio).toBe(audio);
    scope.dispose();
  });
});

describe('sink modules', () => {
  it('device sink exposes the destination as its input and selects devices where supported', async () => {
    const context = liveContext();
    const sink = new DeviceSink(new ModuleAudioEnvironment({context}));
    expect(sink.ports()).toEqual([]);
    sink.prepare();
    expect(sink.input?.node).toBe(context.destination);
    expect(sink.supportsDeviceSelection).toBe(true);
    await sink.selectDevice('speakers-2');
    expect((context as unknown as {setSinkId: ReturnType<typeof vi.fn>}).setSinkId).toHaveBeenCalledWith('speakers-2');
    const report = await checkModuleConformance(() => {
      const next = new DeviceSink(new ModuleAudioEnvironment({context}));
      next.prepare();
      return {module: next, dispose: () => next.dispose()};
    }, {expectedId: 'device'});
    expect(report.failures).toEqual([]);
    const bare = new DeviceSink(new ModuleAudioEnvironment({context: {...context, setSinkId: undefined} as unknown as AudioContext}));
    await expect(bare.selectDevice('x')).rejects.toThrow(/unavailable/);
  });

  it('capture sink records a take through MediaRecorder in the same context', async () => {
    const context = liveContext();
    const listeners: Record<string, (event: never) => void> = {};
    class Recorder {
      state = 'inactive';
      constructor(readonly stream: MediaStream) {}
      addEventListener(type: string, listener: (event: never) => void) { listeners[type] = listener; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; listeners.dataavailable({data: new Blob(['pcm'])} as never); listeners.stop({} as never); }
    }
    const sink = new CaptureSink(new ModuleAudioEnvironment({context}), {recorder: Recorder as never});
    sink.start();
    expect(sink.recording).toBe(true);
    expect(() => sink.start()).toThrow(/already recording/);
    const take = await sink.stop();
    expect(await take.text()).toBe('pcm');
    await expect(sink.stop()).rejects.toThrow(/not recording/);
    sink.dispose();
    expect(sink.input?.readiness).toBe('detached');
  });

  it('offline environment renders once through its own context', async () => {
    const buffer = {} as AudioBuffer;
    const startRendering = vi.fn(async () => buffer);
    const create = vi.fn(() => ({state: 'suspended', startRendering}) as unknown as OfflineAudioContext);
    const offline = createOfflineModuleEnvironment({sampleRate: 48000, durationSeconds: 1.5, create});
    expect(create).toHaveBeenCalledWith(2, 72000, 48000);
    expect(offline.environment.prepare()).toBe(offline.context);
    expect(await offline.render()).toBe(buffer);
    await offline.render();
    expect(startRendering).toHaveBeenCalledTimes(1);
    expect(() => createOfflineModuleEnvironment({sampleRate: 0, durationSeconds: 1, create})).toThrow(/sampleRate/);
  });

  it('device sink admits a producer as its main route', () => {
    const context = liveContext();
    const sink = new DeviceSink(new ModuleAudioEnvironment({context}));
    sink.prepare();
    const source = {context, connect: vi.fn(), disconnect: vi.fn()} as unknown as AudioNode;
    const output = new AudioOutputPort(source);
    const lease = sink.input!.connect(output);
    expect(output.replaced).toBe(true);
    lease.release();
    expect(output.replaced).toBe(false);
  });
});
