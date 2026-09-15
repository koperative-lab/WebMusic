import type {Effect, EffectNode} from './effects';
import {EqController, type EqBand} from './eq';
import {reportPlaybackOperationFailure} from './playback-events';

interface PanelChain {
  input: AudioNode;
  output: AudioNode;
  effects: EffectNode[];
  equalizer?: EqController;
  edges: Array<[AudioNode, AudioNode]>;
}

/** Sections understood by the reusable synth-panel coordinator. */
export type SynthPanelSection =
  | 'sound'
  | 'effects'
  | 'envelope'
  | 'eq'
  | 'lfo'
  | 'macros';

export interface SynthPanelAudioOptions {
  context: AudioContext | undefined;
  effects: readonly Effect[];
  bands: readonly EqBand[];
  sections: readonly SynthPanelSection[];
  effectValues: readonly Record<string, number>[];
}

/**
 * Owns and atomically rebuilds every Web Audio node in a synth-panel chain.
 *
 * The public input/output nodes are stable for the lifetime of one AudioContext.
 * Reconfiguring sections, effects or EQ only replaces the graph between those
 * boundary gains, so callers do not have to reconnect their source and
 * destination after every panel edit.
 */
export class SynthPanelAudioGraph {
  effectNodes: EffectNode[] = [];
  equalizer?: EqController;
  input?: AudioNode;
  output?: AudioNode;
  private context?: AudioContext;
  private chain?: PanelChain;
  private generation = 0;
  private building = false;

  teardown(): void {
    this.generation += 1;
    const previous = this.chain;
    this.chain = undefined;
    this.effectNodes = [];
    this.equalizer = undefined;
    this.input = undefined;
    this.output = undefined;
    this.context = undefined;
    this.releaseChain(previous);
  }

  /** Release a detached snapshot, preserving edges/resources used by its replacement. */
  private releaseChain(chain: PanelChain | undefined, retained = this.chain): void {
    if (!chain) return;
    let failure: unknown;
    const clean = (operation: () => void) => {
      try { operation(); } catch (error) { failure ??= error; }
    };
    for (const [source, destination] of [...chain.edges].reverse()) {
      if (retained?.edges.some(([from, to]) => source === from && destination === to)) continue;
      clean(() => source.disconnect(destination));
    }
    const retainedNodes = new Set(retained?.effects.flatMap((node) => [node.input, node.output]));
    for (const node of [...chain.effects].reverse()) {
      if (retainedNodes.has(node.input) || retainedNodes.has(node.output)) continue;
      clean(() => node.output.disconnect());
      clean(() => node.input.disconnect());
      clean(() => node.dispose?.());
    }
    if (chain.equalizer !== retained?.equalizer) clean(() => chain.equalizer?.dispose());
    if (chain.input !== retained?.input) clean(() => chain.input.disconnect());
    if (chain.output !== retained?.output) clean(() => chain.output.disconnect());
    if (failure !== undefined) throw failure;
  }

  rebuild(options: SynthPanelAudioOptions): void {
    // A custom build/AudioNode hook can call back into the panel. A nested
    // build cannot safely share the same pending transaction; teardown is
    // allowed and invalidates it through generation instead.
    if (this.building) throw new Error('Synth panel audio graph construction is already in progress.');
    const context = options.context;
    if (!context) {
      this.teardown();
      return;
    }

    const generation = ++this.generation;
    const previous = this.chain;
    const reuseBoundary = this.context === context && previous;
    let input: AudioNode | undefined;
    let output: AudioNode | undefined;
    let replacement: PanelChain | undefined;
    const previousParams = new Set(previous?.effects.flatMap((node) => Object.values(node.params ?? {})));
    const changedParams = new Map<AudioParam, number>();
    const assertCurrent = () => {
      if (generation !== this.generation) throw new Error('Synth panel audio graph construction was cancelled.');
    };
    this.building = true;
    try {
      input = reuseBoundary ? previous.input : context.createGain();
      assertCurrent();
      output = reuseBoundary ? previous.output : context.createGain();
      assertCurrent();
      const next: PanelChain = {input, output, effects: [], edges: []};
      replacement = next;
      const connect = (source: AudioNode, destination: AudioNode) => {
        // Record intent first: structural AudioNode hooks may connect then throw.
        next.edges.push([source, destination]);
        source.connect(destination);
        assertCurrent();
      };
      const pieces: Array<{input: AudioNode; output: AudioNode}> = [];
      if (options.sections.includes('effects')) {
        for (const [index, effect] of options.effects.entries()) {
          const node = effect.build(context);
          next.effects.push(node);
          assertCurrent();
          const saved = options.effectValues[index];
          if (saved && node.params) {
            for (const [name, value] of Object.entries(saved)) {
              const param = node.params[name];
              if (param) {
                // Effect.custom can return an existing node. Restore its
                // live parameter if a later stage of this build fails.
                if (previousParams.has(param) && !changedParams.has(param)) changedParams.set(param, param.value);
                param.value = value;
              }
              assertCurrent();
            }
          }
          pieces.push(node);
        }
      }
      if (options.sections.includes('eq')) {
        next.equalizer = new EqController({context, bands: options.bands});
        assertCurrent();
        if (next.equalizer.input && next.equalizer.output) {
          pieces.push({input: next.equalizer.input, output: next.equalizer.output});
        }
      }
      for (let index = 0; index < pieces.length - 1; index += 1) {
        connect(pieces[index].output, pieces[index + 1].input);
      }
      const last = pieces[pieces.length - 1]?.output;
      if (last) connect(last, output);
      connect(input, pieces[0]?.input ?? output);
      this.chain = next;
      this.context = context;
      this.input = input;
      this.output = output;
      this.effectNodes = next.effects;
      this.equalizer = next.equalizer;
    } catch (error) {
      for (const [param, value] of changedParams) {
        try { param.value = value; }
        catch (cleanupError) { reportPlaybackOperationFailure('SynthPanelAudioGraph', 'failed parameter rollback', cleanupError); }
      }
      try {
        if (replacement) this.releaseChain(replacement);
        else {
          for (const node of [input, output]) {
            if (!node || node === this.input || node === this.output) continue;
            try { node.disconnect(); }
            catch (cleanupError) { reportPlaybackOperationFailure('SynthPanelAudioGraph', 'failed boundary cleanup', cleanupError); }
          }
        }
      } catch (cleanupError) {
        reportPlaybackOperationFailure('SynthPanelAudioGraph', 'failed rebuild cleanup', cleanupError);
      }
      throw error;
    } finally {
      this.building = false;
    }
    // The replacement is already authoritative. Cleanup callbacks may reenter
    // or fail; they cannot restore a partially disposed previous graph.
    try {
      this.releaseChain(previous);
    } catch (error) {
      reportPlaybackOperationFailure('SynthPanelAudioGraph', 'replaced graph cleanup', error);
    }
  }
}
