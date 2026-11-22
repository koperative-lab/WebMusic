import {AudioOutputPort} from './audio-port';
import {createCapabilityKey, ModuleCapabilities, type CapabilityKey} from './capability';
import {routeModuleOutput} from './context';
import type {ConnectionLease} from './lease';
import {NoteInputPort, type NoteEvent} from './note-port';
import {ParamHandle, ParamSurface} from './parameter';
import type {ModuleHandle} from './registry';
import {
  ProjectModuleUnavailableError,
  type ProjectFactoryRequest, type ProjectJsonObject, type ProjectModuleInstance, type ProjectPluginFactory, type ProjectPortDescriptor,
} from './project-types';

// ============================================================================
// Web Audio Modules 2.0 as project modules (DEC-078): the web's counterpart of
// VST and AU plugins in Max. The adapter speaks the WAM 2 API structurally, so
// the packages depend on no WAM library; the application supplies the host
// group (from `@webaudiomodules/sdk`) and decides which plugin URLs it trusts.
// A WAM's code runs in the page and its processor in the AudioWorklet.
// ============================================================================

/** The parameter description a WAM node reports. */
export interface WamParameterInfoLike {
  readonly id: string;
  readonly label?: string;
  readonly type?: 'float' | 'int' | 'boolean' | 'choice';
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  readonly discreteStep?: number;
  readonly exponent?: number;
  readonly units?: string;
}

/** The part of a `WamNode` the adapter uses. */
export interface WamNodeLike extends AudioNode {
  getParameterInfo(...ids: string[]): Promise<Readonly<Record<string, WamParameterInfoLike>>>;
  getParameterValues(normalized?: boolean, ...ids: string[]): Promise<Readonly<Record<string, {readonly value: number}>>>;
  setParameterValues(values: Readonly<Record<string, {id: string; value: number; normalized: boolean}>>): Promise<void>;
  getState?(): Promise<unknown>;
  setState?(state: unknown): Promise<void>;
  scheduleEvents(...events: readonly {type: 'wam-midi'; time: number; data: {bytes: readonly [number, number, number]}}[]): void;
  destroy?(): void;
}

/** The part of a `WebAudioModule` instance the adapter uses. */
export interface WamInstanceLike {
  readonly audioNode: WamNodeLike;
  readonly descriptor?: {readonly name?: string; readonly hasAudioInput?: boolean; readonly hasAudioOutput?: boolean; readonly hasMidiInput?: boolean};
  createGui?(): Promise<Element>;
  destroyGui?(gui: Element): void;
}

/** A WAM module's default export. */
export interface WamConstructorLike {
  createInstance(groupId: string, context: BaseAudioContext, initialState?: unknown): Promise<WamInstanceLike>;
}

export interface WamPluginOptions {
  /** Plugin ID. Defaults to `webmusic.wam`. */
  readonly id?: string;
  /**
   * The host group of an AudioContext, from `initializeWamHost(context)` of
   * `@webaudiomodules/sdk`. Called once per AudioContext.
   */
  readonly hostGroup: (context: BaseAudioContext) => string | Promise<string>;
  /** Load a WAM module by URL. Defaults to a dynamic `import()` of the URL. */
  readonly load?: (url: string) => Promise<WamConstructorLike>;
  /** Accept or refuse a URL before loading it. Defaults to accepting any http(s) URL. */
  readonly allow?: (url: string) => boolean;
}

/** What a WAM module lends its editor: the instance and its own GUI. */
export interface WamModule {
  readonly instance: WamInstanceLike;
  readonly name: string;
  /** Create the plugin's own interface; destroy it with `destroyGui`. Undefined when the plugin has none. */
  createGui(): Promise<Element> | undefined;
  destroyGui(gui: Element): void;
}

export const WAM_MODULE: CapabilityKey<WamModule> = createCapabilityKey<WamModule>('webmusic.wam-module');

async function defaultLoad(url: string): Promise<WamConstructorLike> {
  const module = await import(/* @vite-ignore */ url) as {default?: WamConstructorLike};
  if (!module.default || typeof module.default.createInstance !== 'function') throw new ProjectModuleUnavailableError(`${url} is not a Web Audio Module.`);
  return module.default;
}

const MIDI_AXIS = 'audio-context-seconds';

/**
 * A project plugin that runs Web Audio Modules. A record's `config.url` names
 * the WAM; `config.state`, when present, is passed to `createInstance` and
 * refreshed from the plugin after parameter changes. The module has an
 * `input` and an `output` when the plugin declares audio in and out, a
 * `notes` input when it takes MIDI, and one parameter per WAM parameter.
 * A plugin that cannot load leaves the module unresolved with the reason.
 */
export function wamPlugin(options: WamPluginOptions): ProjectPluginFactory {
  const groups = new WeakMap<BaseAudioContext, Promise<string>>();
  const allow = options.allow ?? (url => /^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('./'));
  return Object.freeze({
    id: options.id ?? 'webmusic.wam',
    version: '1.0.0',
    async create(request: ProjectFactoryRequest): Promise<ProjectModuleInstance> {
      const {record, context, signal} = request;
      const url = typeof record.config.url === 'string' ? record.config.url : '';
      if (!url) throw new ProjectModuleUnavailableError('Give the Web Audio Module a URL.');
      if (!allow(url)) throw new ProjectModuleUnavailableError(`This page does not load Web Audio Modules from ${url}.`);
      const audio = context.audio.prepare();
      let group = groups.get(audio);
      if (!group) { group = Promise.resolve(options.hostGroup(audio)); groups.set(audio, group); }
      let instance: WamInstanceLike;
      try {
        const constructor = await (options.load ?? defaultLoad)(url);
        signal.throwIfAborted();
        instance = await constructor.createInstance(await group, audio, record.config.state);
      } catch (error) {
        if ((error as {name?: string})?.name === 'AbortError') throw error;
        throw new ProjectModuleUnavailableError(`The Web Audio Module did not load: ${error instanceof Error ? error.message : String(error)}`, {cause: error});
      }
      const node = instance.audioNode;
      const destroy = () => { try { node.disconnect(); } catch { /* Already detached. */ } try { node.destroy?.(); } catch { /* Best effort. */ } };
      try {
        signal.throwIfAborted();
        const info = await node.getParameterInfo();
        const values = await node.getParameterValues(false).catch(() => ({} as Record<string, {value: number}>));
        signal.throwIfAborted();
        let state = record.config.state;
        const refreshState = () => { void node.getState?.().then(next => { try { state = JSON.parse(JSON.stringify(next ?? null)); } catch { /* Keep the last state that was data. */ } }, () => {}); };
        const handles = Object.values(info).map(param => {
          const min = Number(param.minValue), max = Number(param.maxValue);
          const integer = param.type === 'int' || param.type === 'boolean' || param.type === 'choice';
          return new ParamHandle({
            id: param.id, label: param.label || param.id, unit: param.units || (integer ? 'step' : 'value'),
            range: {min, max}, defaultValue: Number(param.defaultValue),
            ...(integer ? {step: 1} : param.discreteStep ? {step: param.discreteStep} : {}),
            ...(param.exponent && param.exponent !== 0 ? {scale: 'logarithmic' as const} : {}),
          }, {
            baseValue: values[param.id]?.value ?? Number(param.defaultValue),
            apply: value => { void node.setParameterValues({[param.id]: {id: param.id, value, normalized: false}}).then(refreshState, () => {}); },
          });
        });
        const params = new ParamSurface(handles);
        const descriptor = instance.descriptor ?? {};
        const output = descriptor.hasAudioOutput === false ? undefined : new AudioOutputPort(node, {id: 'output'});
        const notes = descriptor.hasMidiInput ? new NoteInputPort({accept: (event: NoteEvent) => {
          const time = event.axis === MIDI_AXIS ? Math.max(audio.currentTime, event.time) : audio.currentTime;
          const pitch = Math.max(0, Math.min(127, Math.round(event.pitch.midi)));
          const on = event.gate === 'on';
          node.scheduleEvents({type: 'wam-midi', time, data: {bytes: on ? [0x90, pitch, Math.max(1, Math.round(event.velocity * 127))] : [0x80, pitch, 0]}});
        }}, {id: 'notes'}) : undefined;
        const lend: WamModule = Object.freeze({
          instance, name: descriptor.name || url,
          createGui: () => instance.createGui?.(),
          destroyGui: (gui: Element) => { try { instance.destroyGui?.(gui); } catch { /* The plugin's own view. */ } },
        });
        let route: ConnectionLease | undefined;
        let disposed = false;
        const module: ModuleHandle = {
          id: record.id, params,
          capabilities: new ModuleCapabilities().with(WAM_MODULE, lend),
          ports: () => notes ? [notes] : [],
          getPort: id => id === 'output' ? output : undefined,
          prepare: () => { if (!disposed && output && !route) route = routeModuleOutput(context, module, output); },
        };
        const registration = context.registry.register(module);
        const ports: ProjectPortDescriptor[] = [
          ...(descriptor.hasAudioInput === false ? [] : [{id: 'input', label: 'audio in', kind: 'audio' as const, direction: 'input' as const}]),
          ...(notes ? [{id: 'notes', label: 'notes', kind: 'note' as const, direction: 'input' as const}] : []),
          ...(output ? [{id: 'output', label: 'audio out', kind: 'audio' as const, direction: 'output' as const}] : []),
        ];
        return {
          module, ports,
          getInput: id => id === 'input' && descriptor.hasAudioInput !== false ? node : undefined,
          exportConfig: () => ({...record.config, ...(state === undefined ? {} : {state: state as ProjectJsonObject})}),
          dispose: () => {
            if (disposed) return;
            disposed = true;
            registration.release();
            route?.release();
            notes?.dispose();
            output?.dispose();
            for (const handle of handles) handle.dispose();
            destroy();
          },
        };
      } catch (error) { destroy(); throw error; }
    },
  });
}
