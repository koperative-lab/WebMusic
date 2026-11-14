import type {Effect, EffectNodes} from '../effect-chain';
import {resolveProcessorDefinition, type ProcessorDefinition, type ResolvedProcessorDefinition} from './definition';
import {createProcessorNode, listenToProcessor, processorParam, type ProcessorNodeFactory} from './node';
import {isProcessorPrepared} from './prepare';

export interface ProcessorEffectOptions {
  /** Caption for controls; default: the definition ID. */
  readonly label?: string;
  /** Structured-cloneable value handed to every realization's `create`. */
  readonly config?: unknown;
  readonly createNode?: ProcessorNodeFactory;
  /** A realization's processor failed; it is silent and stays in the chain. */
  readonly onError?: (message: string) => void;
  /** Author-defined observations from any realization. */
  readonly onReport?: (data: unknown) => void;
}

/**
 * A prepared processor as an insert `Effect` recipe for `InsertChain`, a
 * Rack channel or a player's `.effect`. Each realization creates its own
 * `AudioWorkletNode` and is both the slot's input and output: the chain feeds
 * the first audio input and reads the first audio output. Further buses stay
 * unconnected.
 *
 * `createAudioNodes` stays synchronous, so the processor must already be
 * prepared in that context; otherwise it throws and the chain keeps its
 * working graph. It never substitutes a bypass.
 *
 * The chain builds the parameter handles from the node's `AudioParam`s with
 * the definition's descriptors, so `audio-rate` and `control-rate` parameters
 * accept modulation and others are written directly.
 */
export function processorEffect(
  definition: ProcessorDefinition | ResolvedProcessorDefinition,
  options: ProcessorEffectOptions = {},
): Effect {
  const resolved = resolveProcessorDefinition(definition);
  if (resolved.audioInputs.length === 0) throw new TypeError(`Processor ${resolved.name} has no audio input, so it cannot be an insert effect.`);
  if (resolved.noteInput) throw new TypeError(`Processor ${resolved.name} requests note input, which an insert cannot carry; use createProcessorModule.`);
  if (resolved.transport) throw new TypeError(`Processor ${resolved.name} requests transport, which an insert cannot carry; use createProcessorModule.`);
  // State modulation explicitly: the chain would otherwise infer `control-rate`
  // from a k-rate AudioParam and accept modulation the definition did not declare.
  const parameterDescriptors = Object.freeze(Object.fromEntries(resolved.params.map(({id, ...descriptor}) =>
    [id, Object.freeze({...descriptor, modulation: descriptor.modulation ?? 'none'})])));
  const baseValues = Object.freeze(Object.fromEntries(resolved.params.map(param => [param.id, param.defaultValue])));
  return Object.freeze({
    label: options.label ?? resolved.id,
    parameterDescriptors,
    createAudioNodes(context: BaseAudioContext): EffectNodes {
      if (!isProcessorPrepared(context, resolved)) {
        throw new Error(`Processor ${resolved.name} is not prepared in this audio context; await prepareProcessor first.`);
      }
      const node = createProcessorNode(context, resolved, {
        config: options.config, createNode: options.createNode, baseValues,
        inputChannels: resolved.audioInputs[0].channels,
      });
      let stop: (() => void) | undefined;
      try {
        let failed = false;
        stop = listenToProcessor(node, {
          fail: message => {
            if (failed) return;
            failed = true;
            options.onError?.(message);
          },
          data: options.onReport,
        });
        const params = Object.fromEntries(resolved.params.map(param => [param.id, processorParam(node, resolved, param.id)]));
        let disposed = false;
        return {
          input: node,
          output: node,
          params,
          dispose() {
            if (disposed) return;
            disposed = true;
            let failure: unknown;
            try { node.disconnect(); } catch (error) { failure = error; }
            try { stop?.(); } catch (error) { failure ??= error; }
            if (failure !== undefined) throw failure;
          },
        };
      } catch (error) {
        try { stop?.(); } catch { /* Preserve the construction failure. */ }
        try { node.disconnect(); } catch { /* Preserve the construction failure. */ }
        throw error;
      }
    },
  });
}
