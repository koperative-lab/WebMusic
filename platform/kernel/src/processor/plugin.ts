import {
  ProjectModuleUnavailableError,
  type ProjectFactoryRequest, type ProjectModuleInstance, type ProjectPluginFactory, type ProjectPortDescriptor,
} from '../module/project-types';
import {resolveProcessorDefinition, type ProcessorDefinition, type ResolvedProcessorDefinition} from './definition';
import {createProcessorModule, type ProcessorNodeFactory} from './module';
import {isProcessorPrepared, prepareProcessor, type ProcessorSource} from './prepare';

export interface ProcessorPluginOptions {
  /**
   * Where to load the processor when a project restores it into a context
   * where it is not yet prepared. Without it, the processor must already be
   * prepared there; otherwise the module stays unresolved.
   */
  readonly source?: ProcessorSource;
  readonly createNode?: ProcessorNodeFactory;
  /** Author-defined observations from any instance, with its module ID. */
  readonly onReport?: (moduleId: string, data: unknown) => void;
}

/**
 * A project plugin for one processor definition, registered under the
 * definition's `id` and `version`. Each module record becomes a processor
 * module in its context: the record's `config` is handed to the processor's
 * `create`, saved parameters restore through the module's parameter surface,
 * the first output follows the context's default route, and notes and audio
 * connect through its ports.
 *
 * When the processor cannot be prepared in the project's audio context — no
 * `source` and not prepared, `AudioWorklet` unavailable, or the load fails —
 * the module stays unresolved with the reason, and its record, parameters
 * and connections are kept for the next restore. A project saved with a
 * different processor version finds no plugin and stays unresolved too.
 */
export function processorPlugin(
  definition: ProcessorDefinition | ResolvedProcessorDefinition,
  options: ProcessorPluginOptions = {},
): ProjectPluginFactory {
  const resolved = resolveProcessorDefinition(definition);
  const ports: readonly ProjectPortDescriptor[] = Object.freeze([
    ...resolved.audioInputs.map(port => Object.freeze({id: port.id, kind: 'audio' as const, direction: 'input' as const})),
    ...(resolved.noteInput ? [Object.freeze({id: 'notes', kind: 'note' as const, direction: 'input' as const})] : []),
    ...resolved.audioOutputs.map(port => Object.freeze({id: port.id, kind: 'audio' as const, direction: 'output' as const})),
  ]);
  return Object.freeze({
    id: resolved.id,
    version: resolved.version,
    async create({record, context, signal}: ProjectFactoryRequest): Promise<ProjectModuleInstance> {
      const audio = context.audio.prepare();
      if (!isProcessorPrepared(audio, resolved)) {
        if (!options.source) {
          throw new ProjectModuleUnavailableError(`Processor ${resolved.name} is not prepared in this audio context and the plugin has no source.`);
        }
        try {
          await prepareProcessor(audio, resolved, options.source);
        } catch (error) {
          if (signal.aborted) throw error;
          const reason = error instanceof Error ? error.message : String(error);
          throw new ProjectModuleUnavailableError(`Processor ${resolved.name} could not be prepared: ${reason}`, {cause: error});
        }
      }
      if (signal.aborted) throw signal.reason ?? new Error('Project restoration was aborted.');
      const module = createProcessorModule(context, resolved, {
        id: record.id,
        config: record.config,
        createNode: options.createNode,
        onReport: options.onReport ? data => options.onReport!(record.id, data) : undefined,
      });
      return {
        module,
        ports,
        getInput: name => module.getInput(name)?.node,
        dispose: () => module.dispose(),
      };
    },
  });
}
