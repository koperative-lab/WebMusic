// Shared buffers and the sampler objects (DEC-077), as Max's buffer~,
// groove~ and record~, and a microphone input as adc~. A buffer is named
// within one AudioContext; every object that names it reads the same
// samples and hears when they change.
//
// Ownership: a `buffer` object owns its entry and removes it on dispose
// unless a newer buffer of the same name replaced it. `groove` owns the
// source nodes it starts; `record` owns its capture nodes; `adc` borrows a
// microphone stream shared per AudioContext and stops it with its last user.

import {
  AudioOutputPort, MessageInputPort, MessageOutputPort, ProjectModuleUnavailableError, atomsOf, bang, floatAtom, intAtom,
  isNumberAtom, message, routeModuleOutput, symbolAtom,
  type ConnectionLease, type Message, type ModuleHandle, type ProjectFactoryRequest, type ProjectModuleInstance, type ProjectPluginFactory,
} from '@webmusic/kernel/module';
import {ModuleCapabilities} from '@webmusic/kernel/module';
import {OBJECT_INTERFACE, OBJECT_PLUGIN_PREFIX, OBJECT_PLUGIN_VERSION, parseArgs, type ObjectInterface} from '@webmusic/kernel/objects';
import {AudioClip} from '../../core';

/**
 * Named AudioBuffers of one AudioContext. An entry has owners, the `buffer`
 * objects that declare it, and a key describing how it was made; writes by
 * anyone else (a recording, an edit) keep both. While a graph is rebuilt the
 * old and the new `buffer` object both own it, so a discarded rebuild or the
 * old graph's disposal never removes what the other still uses.
 */
export class SharedBuffers {
  readonly #entries = new Map<string, {buffer: AudioBuffer; revision: number; owners: Set<object>; key?: string}>();
  readonly #listeners = new Map<string, Set<() => void>>();

  get(name: string): AudioBuffer | undefined { return this.#entries.get(name)?.buffer; }
  /** Counts every change of `name`; 0 when it holds nothing. */
  revision(name: string): number { return this.#entries.get(name)?.revision ?? 0; }
  names(): readonly string[] { return [...this.#entries.keys()].sort(); }

  /** Replace the samples of `name`, keeping its owner. */
  set(name: string, buffer: AudioBuffer): void {
    const entry = this.#entries.get(name);
    this.#entries.set(name, {owners: new Set(), ...entry, buffer, revision: (entry?.revision ?? 0) + 1});
    this.#notify(name);
  }

  /**
   * Add `owner` to the owners of `name`. An entry made the same way (`key`)
   * keeps its samples, so a rebuilt graph keeps what was recorded into it;
   * otherwise `create` makes new samples. Returns the buffer it holds.
   */
  claim(name: string, owner: object, key: string, create: () => AudioBuffer): AudioBuffer {
    const entry = this.#entries.get(name);
    if (entry && entry.key === key) { entry.owners.add(owner); return entry.buffer; }
    const buffer = create();
    this.#entries.set(name, {buffer, revision: (entry?.revision ?? 0) + 1, owners: new Set([...(entry?.owners ?? []), owner]), key});
    this.#notify(name);
    return buffer;
  }

  /** True when `name` holds samples made as `key`. */
  madeAs(name: string, key: string): boolean { return this.#entries.get(name)?.key === key; }

  /** Drop `owner`; `name` goes with its last owner. */
  release(name: string, owner: object): void {
    const entry = this.#entries.get(name);
    if (!entry || !entry.owners.delete(owner) || entry.owners.size) return;
    this.#entries.delete(name);
    this.#notify(name);
  }

  subscribe(name: string, listener: () => void): () => void {
    let set = this.#listeners.get(name);
    if (!set) { set = new Set(); this.#listeners.set(name, set); }
    set.add(listener);
    return () => { set!.delete(listener); };
  }

  #notify(name: string): void {
    for (const listener of [...(this.#listeners.get(name) ?? [])]) { try { listener(); } catch { /* Observers cannot undo a buffer change. */ } }
  }
}

const shared = new WeakMap<BaseAudioContext, SharedBuffers>();
/** The shared buffers of an AudioContext. */
export function sharedBuffersFor(context: BaseAudioContext): SharedBuffers {
  let buffers = shared.get(context);
  if (!buffers) { buffers = new SharedBuffers(); shared.set(context, buffers); }
  return buffers;
}

/** An AudioClip of a buffer's samples, for a waveform view. */
export function clipOfBuffer(buffer: AudioBuffer): AudioClip {
  return new AudioClip({sampleRate: buffer.sampleRate, channelData: Array.from({length: buffer.numberOfChannels}, (_, channel) => buffer.getChannelData(channel).slice())});
}

const words = (record: {config: Record<string, unknown>}) => parseArgs(record.config as never);
const nameOf = (request: ProjectFactoryRequest) => {
  const first = words(request.record)[0];
  if (first?.type !== 'symbol') throw new ProjectModuleUnavailableError('Name the buffer: for example buffer drums.');
  return first.value;
};

function interfaceOf(kind: string, snapshot: () => Record<string, unknown>, interact: (value: Message) => void, listeners: Set<() => void>): ObjectInterface {
  return Object.freeze({
    kind,
    snapshot: () => snapshot() as never,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    interact,
  });
}

/**
 * `buffer name [seconds]`: holds the named buffer. With a `source` asset it
 * loads that recording; otherwise it starts silent and `seconds` long (1 s by
 * default). `size seconds` and `clear` replace it; bang outputs `name seconds
 * channels`.
 */
function bufferPlugin(): ProjectPluginFactory {
  return Object.freeze({
    id: `${OBJECT_PLUGIN_PREFIX}buffer`, version: OBJECT_PLUGIN_VERSION,
    async create(request: ProjectFactoryRequest): Promise<ProjectModuleInstance> {
      const {record, context} = request;
      const name = nameOf(request);
      const audio = context.audio.prepare();
      const store = sharedBuffersFor(audio);
      const seconds = (() => { const atom = words(record)[1]; return isNumberAtom(atom) && atom.value > 0 ? atom.value : 1; })();
      const owner = {};
      const key = JSON.stringify([record.config.args ?? '', record.assets?.source ?? '']);
      const clip = record.assets?.source && !store.madeAs(name, key) ? await request.resolveAsset('source') : undefined;
      if (clip !== undefined && !(clip instanceof AudioClip)) throw new TypeError('A buffer source asset must resolve to an AudioClip.');
      store.claim(name, owner, key, () => clip ? clip.toAudioBuffer(audio) : audio.createBuffer(2, Math.max(1, Math.round(seconds * audio.sampleRate)), audio.sampleRate));
      const listeners = new Set<() => void>();
      const outlet = new MessageOutputPort({id: 'out0'});
      const notify = () => { for (const listener of [...listeners]) listener(); };
      const release = store.subscribe(name, notify);
      const current = () => store.get(name);
      const replace = (length: number) => {
        store.set(name, audio.createBuffer(current()?.numberOfChannels ?? 2, Math.max(1, Math.round(length * audio.sampleRate)), audio.sampleRate));
      };
      const receive = (value: Message) => {
        const number = atomsOf(value).find(isNumberAtom)?.value;
        if (value.selector === 'size' && number && number > 0) replace(number);
        else if (value.selector === 'clear') replace(current()?.duration ?? seconds);
        else if (value.selector === 'bang') {
          const buffer = current();
          outlet.send(message('list', [symbolAtom(name), floatAtom(buffer?.duration ?? 0), intAtom(buffer?.numberOfChannels ?? 0)], value.time));
        }
      };
      const inlet = new MessageInputPort(receive, {id: 'in0'});
      const iface = interfaceOf('buffer', () => ({name, seconds: current()?.duration ?? 0, channels: current()?.numberOfChannels ?? 0, revision: store.revision(name)}), receive, listeners);
      const module: ModuleHandle = {id: record.id, ports: () => [inlet, outlet], capabilities: new ModuleCapabilities().with(OBJECT_INTERFACE, iface)};
      const registration = context.registry.register(module);
      return {
        module,
        ports: [{id: 'in0', label: 'size seconds, clear, bang', kind: 'message', direction: 'input'}, {id: 'out0', label: 'name seconds channels', kind: 'message', direction: 'output'}],
        exportConfig: () => record.config,
        dispose: () => { release(); store.release(name, owner); inlet.dispose(); outlet.dispose(); registration.release(); listeners.clear(); },
      };
    },
  });
}

/**
 * `groove name`: plays the named buffer. A number starts at that many seconds;
 * bang or `play` starts at the loop start; `stop` stops; `loop start end`
 * sets the loop in seconds (end 0 is the buffer's end); `looping 0/1` and
 * `rate r` change how it plays. Starts and stops happen at the message's time.
 * It bangs when a sound that does not loop ends.
 */
function groovePlugin(): ProjectPluginFactory {
  return Object.freeze({
    id: `${OBJECT_PLUGIN_PREFIX}groove`, version: OBJECT_PLUGIN_VERSION,
    create(request: ProjectFactoryRequest): ProjectModuleInstance {
      const {record, context} = request;
      const name = nameOf(request);
      const audio = context.audio.prepare();
      const store = sharedBuffersFor(audio);
      const output = audio.createGain();
      const port = new AudioOutputPort(output, {id: 'output'});
      const done = new MessageOutputPort({id: 'out0'});
      let source: AudioBufferSourceNode | undefined;
      let loop = {start: 0, end: 0, on: false};
      let rate = 1;
      let route: ConnectionLease | undefined;
      const stop = (time = audio.currentTime) => {
        if (!source) return;
        const playing = source;
        source = undefined;
        playing.onended = null;
        try { playing.stop(Math.max(audio.currentTime, time)); } catch { /* Already stopped. */ }
        setTimeout(() => playing.disconnect(), Math.max(0, (time - audio.currentTime) * 1000) + 50);
      };
      const play = (offset: number, time: number) => {
        const buffer = store.get(name);
        if (!buffer) return;
        stop(time);
        const node = audio.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = rate;
        node.loop = loop.on;
        node.loopStart = loop.start;
        node.loopEnd = loop.end > loop.start ? loop.end : 0;
        node.connect(output);
        node.onended = () => { if (source === node) { source = undefined; done.send(bang()); } node.disconnect(); };
        node.start(Math.max(audio.currentTime, time), Math.max(0, Math.min(buffer.duration, offset)));
        source = node;
      };
      const inlet = new MessageInputPort(value => {
        const numbers = atomsOf(value).filter(isNumberAtom).map(atom => atom.value);
        const time = value.time ?? audio.currentTime;
        switch (value.selector) {
          case 'int': case 'float': play(numbers[0]!, time); return;
          case 'bang': case 'play': case 'start': play(loop.start, time); return;
          case 'stop': stop(time); return;
          case 'loop':
            loop = {...loop, start: Math.max(0, numbers[0] ?? 0), end: Math.max(0, numbers[1] ?? 0), on: true};
            if (source) { source.loop = true; source.loopStart = loop.start; source.loopEnd = loop.end > loop.start ? loop.end : 0; }
            return;
          case 'looping': loop = {...loop, on: (numbers[0] ?? 1) !== 0}; if (source) source.loop = loop.on; return;
          case 'rate': rate = numbers[0] ?? 1; source?.playbackRate.setValueAtTime(rate, Math.max(audio.currentTime, time)); return;
        }
      }, {id: 'in0'});
      let disposed = false;
      const module: ModuleHandle = {
        id: record.id,
        ports: () => [inlet, done],
        getPort: id => id === 'output' ? port : undefined,
        prepare: () => { if (!disposed && !route) route = routeModuleOutput(context, module, port); },
      };
      const registration = context.registry.register(module);
      return {
        module,
        ports: [{id: 'in0', label: 'seconds to start, play, stop, loop start end, looping, rate', kind: 'message', direction: 'input'},
          {id: 'output', label: 'audio', kind: 'audio', direction: 'output'}, {id: 'out0', label: 'bang at the end', kind: 'message', direction: 'output'}],
        exportConfig: () => record.config,
        dispose: () => { disposed = true; stop(); route?.release(); port.dispose(); inlet.dispose(); done.dispose(); registration.release(); output.disconnect(); },
      };
    },
  });
}

/**
 * `record name`: `start` (or 1) records its audio input into the named
 * buffer from the beginning; `stop` (or 0) ends it and replaces the buffer
 * with what was recorded, then bangs. Capture runs on a ScriptProcessor, as
 * the Audio recorder does, so no worklet file is needed.
 */
function recordPlugin(): ProjectPluginFactory {
  return Object.freeze({
    id: `${OBJECT_PLUGIN_PREFIX}record`, version: OBJECT_PLUGIN_VERSION,
    create(request: ProjectFactoryRequest): ProjectModuleInstance {
      const {record, context} = request;
      const name = nameOf(request);
      const audio = context.audio.prepare();
      const store = sharedBuffersFor(audio);
      const input = audio.createGain();
      const done = new MessageOutputPort({id: 'out0'});
      let capture: {processor: ScriptProcessorNode; silent: GainNode; chunks: Float32Array[][]; frames: number} | undefined;
      const start = () => {
        if (capture) return;
        const processor = audio.createScriptProcessor(4096, 2, 2);
        const silent = audio.createGain();
        silent.gain.value = 0;
        const chunks: Float32Array[][] = [[], []];
        const state = {processor, silent, chunks, frames: 0};
        processor.onaudioprocess = event => {
          for (let channel = 0; channel < 2; channel++) chunks[channel]!.push(Float32Array.from(event.inputBuffer.getChannelData(Math.min(channel, event.inputBuffer.numberOfChannels - 1))));
          state.frames += event.inputBuffer.length;
        };
        input.connect(processor);
        // A ScriptProcessor runs only while its output is connected.
        processor.connect(silent).connect(audio.destination);
        capture = state;
      };
      const stop = (time?: number) => {
        if (!capture) return;
        const {processor, silent, chunks, frames} = capture;
        capture = undefined;
        processor.onaudioprocess = null;
        input.disconnect(processor); processor.disconnect(); silent.disconnect();
        if (!frames) return;
        const buffer = audio.createBuffer(2, frames, audio.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
          let offset = 0;
          for (const chunk of chunks[channel]!) { buffer.copyToChannel(chunk as Float32Array<ArrayBuffer>, channel, offset); offset += chunk.length; }
        }
        store.set(name, buffer);
        done.send(bang(time));
      };
      const inlet = new MessageInputPort(value => {
        const number = atomsOf(value).find(isNumberAtom)?.value;
        if (value.selector === 'start' || (number !== undefined && number !== 0 && value.selector !== 'stop')) start();
        else if (value.selector === 'stop' || number === 0) stop(value.time);
      }, {id: 'in0'});
      const module: ModuleHandle = {id: record.id, ports: () => [inlet, done]};
      const registration = context.registry.register(module);
      return {
        module,
        ports: [{id: 'input', label: 'audio to record', kind: 'audio', direction: 'input'},
          {id: 'in0', label: 'start or 1, stop or 0', kind: 'message', direction: 'input'}, {id: 'out0', label: 'bang when recorded', kind: 'message', direction: 'output'}],
        getInput: id => id === 'input' ? input : undefined,
        exportConfig: () => record.config,
        dispose: () => { stop(); inlet.dispose(); done.dispose(); registration.release(); input.disconnect(); },
      };
    },
  });
}

const microphones = new WeakMap<BaseAudioContext, {stream: Promise<MediaStream>; users: number}>();

/**
 * `adc`: the microphone, asked for once per AudioContext and shared. It never
 * follows the default route — wire it on, or it would feed back through the
 * speakers. A refused or missing microphone leaves the object unresolved with
 * the reason.
 */
function adcPlugin(): ProjectPluginFactory {
  return Object.freeze({
    id: `${OBJECT_PLUGIN_PREFIX}adc`, version: OBJECT_PLUGIN_VERSION,
    async create(request: ProjectFactoryRequest): Promise<ProjectModuleInstance> {
      const {record, context} = request;
      const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
      if (!media?.getUserMedia) throw new ProjectModuleUnavailableError('This browser gives no microphone access.');
      const audio = context.audio.prepare() as AudioContext;
      if (typeof audio.createMediaStreamSource !== 'function') throw new ProjectModuleUnavailableError('This audio context cannot take a microphone.');
      let entry = microphones.get(audio);
      if (!entry) {
        entry = {stream: media.getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}}), users: 0};
        microphones.set(audio, entry);
      }
      let stream: MediaStream;
      try { stream = await entry.stream; }
      catch (error) {
        microphones.delete(audio);
        throw new ProjectModuleUnavailableError(`The microphone is unavailable: ${error instanceof Error ? error.message : String(error)}`, {cause: error});
      }
      entry.users++;
      const source = audio.createMediaStreamSource(stream);
      const output = audio.createGain();
      source.connect(output);
      const port = new AudioOutputPort(output, {id: 'output'});
      const module: ModuleHandle = {id: record.id, getPort: id => id === 'output' ? port : undefined};
      const registration = context.registry.register(module);
      return {
        module,
        ports: [{id: 'output', label: 'microphone', kind: 'audio', direction: 'output'}],
        exportConfig: () => record.config,
        dispose: () => {
          registration.release(); port.dispose(); source.disconnect(); output.disconnect();
          const shared = microphones.get(audio);
          if (shared && --shared.users <= 0) { microphones.delete(audio); for (const track of stream.getTracks()) track.stop(); }
        },
      };
    },
  });
}

/** Project plugins for `buffer`, `groove`, `record` and `adc`. */
export function createSamplerPlugins(): readonly ProjectPluginFactory[] {
  return Object.freeze([bufferPlugin(), groovePlugin(), recordPlugin(), adcPlugin()]);
}

