import type {ParamDescriptor} from '../module/parameter';

// A processor definition is plain data shared by the main thread and the
// audio thread. This file therefore imports types only: an author's worklet
// bundle must not pull main-thread Kernel code in through it.

/** One audio bus of a processor. Channel count is fixed for the node's life. */
export interface ProcessorAudioPort {
  readonly id: string;
  readonly channels: number;
}

/**
 * Serializable description of one authored DSP processor. The same object is
 * passed to `prepareProcessor` on the main thread and to `defineProcessor` in
 * the worklet file, so both sides agree on ports and parameters.
 */
export interface ProcessorDefinition {
  /** With `version`, the processor's identity; a project stores this pair. */
  readonly id: string;
  readonly version: string;
  /** Default: none, which makes an instrument or generator. */
  readonly audioInputs?: readonly ProcessorAudioPort[];
  /** Default: one stereo output named `output`. At least one is required. */
  readonly audioOutputs?: readonly ProcessorAudioPort[];
  /** Accept queued note events. Default false. */
  readonly noteInput?: boolean;
  /** Receive the Session anchor on the audio thread. Default false. */
  readonly transport?: boolean;
  /**
   * Every parameter is an `AudioParam` of the node. `modulation: 'audio-rate'`
   * makes it a-rate (one value per frame); anything else makes it k-rate (one
   * value per block).
   */
  readonly params?: readonly ParamDescriptor[];
  /** Declared processing latency in samples; never a measured device latency. Default 0. */
  readonly latencySamples?: number;
  /** How long output continues after input and notes end. Default 0; `Infinity` never idles. */
  readonly tailSeconds?: number;
}

/** A validated definition with every default applied. Deeply frozen. */
export interface ResolvedProcessorDefinition {
  readonly id: string;
  readonly version: string;
  /** The `registerProcessor` name: `id@version`. */
  readonly name: string;
  readonly audioInputs: readonly ProcessorAudioPort[];
  readonly audioOutputs: readonly ProcessorAudioPort[];
  readonly noteInput: boolean;
  readonly transport: boolean;
  readonly params: readonly ParamDescriptor[];
  readonly latencySamples: number;
  readonly tailSeconds: number;
}

/** The `AudioParamDescriptor` shape, declared here because worklet globals have no DOM types. */
export interface ProcessorAudioParamDescriptor {
  readonly name: string;
  readonly defaultValue: number;
  readonly minValue: number;
  readonly maxValue: number;
  readonly automationRate: 'a-rate' | 'k-rate';
}

const MAX_CHANNELS = 32;
const resolved = new WeakSet<object>();

function identifier(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new TypeError(`Processor ${name} must be a nonempty trimmed string.`);
  }
  return value;
}

function ports(value: readonly ProcessorAudioPort[] | undefined, fallback: readonly ProcessorAudioPort[], kind: string): readonly ProcessorAudioPort[] {
  if (value === undefined) return Object.freeze(fallback.map(port => Object.freeze({...port})));
  if (!Array.isArray(value)) throw new TypeError(`Processor ${kind} must be an array.`);
  const seen = new Set<string>();
  return Object.freeze(value.map((port: ProcessorAudioPort) => {
    const id = identifier(port?.id, `${kind} port ID`);
    if (seen.has(id)) throw new TypeError(`Processor ${kind} port ID is duplicated: ${id}.`);
    seen.add(id);
    if (!Number.isInteger(port.channels) || port.channels < 1 || port.channels > MAX_CHANNELS) {
      throw new RangeError(`Processor ${kind} port ${id} needs 1–${MAX_CHANNELS} channels.`);
    }
    return Object.freeze({id, channels: port.channels});
  }));
}

function params(value: readonly ParamDescriptor[] | undefined): readonly ParamDescriptor[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('Processor params must be an array.');
  const seen = new Set<string>();
  return Object.freeze(value.map((param: ParamDescriptor) => {
    const id = identifier(param?.id, 'parameter ID');
    if (seen.has(id)) throw new TypeError(`Processor parameter ID is duplicated: ${id}.`);
    seen.add(id);
    identifier(param.unit, `parameter ${id} unit`);
    const {min, max} = param.range ?? ({} as ParamDescriptor['range']);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new RangeError(`Processor parameter ${id} needs a finite range with min <= max.`);
    }
    if (!Number.isFinite(param.defaultValue) || param.defaultValue < min || param.defaultValue > max) {
      throw new RangeError(`Processor parameter ${id} default must lie within its range.`);
    }
    return Object.freeze({...param, range: Object.freeze({min, max})});
  }));
}

/** The `registerProcessor` name of a definition: `id@version`. */
export function processorName(definition: Pick<ProcessorDefinition, 'id' | 'version'>): string {
  return `${identifier(definition?.id, 'ID')}@${identifier(definition?.version, 'version')}`;
}

/**
 * Validate a definition and apply its defaults. Throws before any resource is
 * acquired; resolving an already resolved definition returns it unchanged.
 */
export function resolveProcessorDefinition(definition: ProcessorDefinition | ResolvedProcessorDefinition): ResolvedProcessorDefinition {
  if (!definition || typeof definition !== 'object') throw new TypeError('Processor definition must be an object.');
  if (resolved.has(definition)) return definition as ResolvedProcessorDefinition;
  const name = processorName(definition);
  const audioOutputs = ports(definition.audioOutputs, [{id: 'output', channels: 2}], 'audio output');
  if (audioOutputs.length === 0) throw new TypeError('Processor needs at least one audio output.');
  const latencySamples = definition.latencySamples ?? 0;
  if (!Number.isInteger(latencySamples) || latencySamples < 0) {
    throw new RangeError('Processor latencySamples must be a nonnegative integer.');
  }
  const tailSeconds = definition.tailSeconds ?? 0;
  if (Number.isNaN(tailSeconds) || tailSeconds < 0) {
    throw new RangeError('Processor tailSeconds must be nonnegative or Infinity.');
  }
  const result: ResolvedProcessorDefinition = Object.freeze({
    id: definition.id,
    version: definition.version,
    name,
    audioInputs: ports(definition.audioInputs, [], 'audio input'),
    audioOutputs,
    noteInput: definition.noteInput === true,
    transport: definition.transport === true,
    params: params(definition.params),
    latencySamples,
    tailSeconds,
  });
  resolved.add(result);
  return result;
}

/** The node's `AudioParam` declarations, in definition order. */
export function processorAudioParams(definition: ProcessorDefinition | ResolvedProcessorDefinition): readonly ProcessorAudioParamDescriptor[] {
  return Object.freeze(resolveProcessorDefinition(definition).params.map(param => Object.freeze({
    name: param.id,
    defaultValue: param.defaultValue,
    minValue: param.range.min,
    maxValue: param.range.max,
    automationRate: param.modulation === 'audio-rate' ? 'a-rate' as const : 'k-rate' as const,
  })));
}

/**
 * A stable text form of everything two registrations of one name must agree
 * on. Two definitions with the same `id@version` and different signatures are
 * a conflict, not an update.
 */
export function processorSignature(definition: ProcessorDefinition | ResolvedProcessorDefinition): string {
  const {name, audioInputs, audioOutputs, noteInput, transport, latencySamples, tailSeconds} = resolveProcessorDefinition(definition);
  return JSON.stringify({
    name, audioInputs, audioOutputs, noteInput, transport, latencySamples,
    tailSeconds: Number.isFinite(tailSeconds) ? tailSeconds : 'Infinity',
    params: processorAudioParams(definition),
  });
}
