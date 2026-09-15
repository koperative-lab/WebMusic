// ============================================================================
// Effect — stable lazy recipe facade for composable Web Audio post-processing.
// Node construction and DSP helpers live in `effects/builders`; this module
// keeps the public factories and graph insertion contract compact.
// ============================================================================

import type {ReverbOptions} from './audio-contracts';
import type {EffectKernelContract} from './effects/kernel-contract';
import {
  buildAnalyserEffect,
  buildBitcrusherEffect,
  buildChorusEffect,
  buildCompressorEffect,
  buildDelayEffect,
  buildDistortionEffect,
  buildEffectChain,
  buildFilterEffect,
  buildGainEffect,
  buildLimiterEffect,
  buildPannerEffect,
  buildReverbEffect,
  buildTremoloEffect,
} from './effects/builders';
import type {
  AnalyserOptions,
  BitcrusherOptions,
  ChorusOptions,
  CompressorOptions,
  DelayOptions,
  DistortionOptions,
  EffectFactory,
  EffectNode,
  FilterOptions,
  LimiterOptions,
  TremoloOptions,
} from './effects/contracts';

// Keep the compile-time kernel contract reachable without emitting a bare
// runtime import into otherwise side-effect-free bundles.
type _EffectKernelContractAnchor = EffectKernelContract;

export type {
  AnalyserOptions,
  BitcrusherOptions,
  ChorusOptions,
  CompressorOptions,
  DelayOptions,
  DistortionOptions,
  EffectNode,
  FilterOptions,
  LimiterOptions,
  TremoloOptions,
} from './effects/contracts';

/** Internal factory shape: builders work against any BaseAudioContext. */
type InternalEffectFactory = (context: BaseAudioContext) => EffectNode;

export class Effect {
  /** Optional display label used by controls. */
  label?: string;

  private constructor(private readonly factory: InternalEffectFactory) {}

  /** Realise this effect's nodes for a given context. */
  build(context: AudioContext): EffectNode {
    return this.factory(context);
  }

  /**
   * Realise this effect's nodes for any context — online or offline. This is
   * the kernel Effect contract (@webmusic/kernel/effect), so score effects
   * cross into @webaudio players (and offline renders) by shape alone.
   */
  createAudioNodes(context: BaseAudioContext): EffectNode {
    return this.factory(context);
  }

  /** Bring your own sub-graph. */
  static custom(implementation: EffectFactory | EffectNode): Effect {
    // The public EffectFactory stays AudioContext-typed (narrowing it would
    // break existing callers under strictFunctionTypes). The widening cast is
    // unsound only if a user-supplied custom effect is later run against an
    // OfflineAudioContext — the same exposure @webaudio/play's customEffect
    // accepts by construction.
    return new Effect(
      typeof implementation === 'function'
        ? (implementation as InternalEffectFactory)
        : () => implementation,
    );
  }

  static gain(value = 1): Effect {
    return new Effect((context) => buildGainEffect(context, value));
  }

  static panner(pan = 0): Effect {
    return new Effect((context) => buildPannerEffect(context, pan));
  }

  static analyser(options: AnalyserOptions = {}): Effect {
    return new Effect((context) => buildAnalyserEffect(context, options));
  }

  static limiter(options: LimiterOptions = {}): Effect {
    return new Effect((context) => buildLimiterEffect(context, options));
  }

  static bitcrusher(options: BitcrusherOptions = {}): Effect {
    return new Effect((context) => buildBitcrusherEffect(context, options));
  }

  static tremolo(options: TremoloOptions = {}): Effect {
    return new Effect((context) => buildTremoloEffect(context, options));
  }

  static chorus(options: ChorusOptions = {}): Effect {
    return new Effect((context) => buildChorusEffect(context, options));
  }

  static filter(options: FilterOptions = {}): Effect {
    return new Effect((context) => buildFilterEffect(context, options));
  }

  static delay(options: DelayOptions = {}): Effect {
    return new Effect((context) => buildDelayEffect(context, options));
  }

  static distortion(options: DistortionOptions = {}): Effect {
    return new Effect((context) => buildDistortionEffect(context, options));
  }

  static compressor(options: CompressorOptions = {}): Effect {
    return new Effect((context) => buildCompressorEffect(context, options));
  }

  static reverb(options: ReverbOptions = {}): Effect {
    return new Effect((context) => buildReverbEffect(context, options));
  }

  /** Compose several effects in series; nullish entries are skipped. */
  static chain(...effects: Array<Effect | null | undefined>): Effect {
    const chain = effects.filter((effect): effect is Effect => Boolean(effect));
    return new Effect((context) => buildEffectChain(context, chain));
  }
}

/** Insert an optional effect between a source and destination node. */
export function insertEffect(
  context: AudioContext,
  source: AudioNode,
  destination: AudioNode,
  effect: Effect | undefined,
): {dispose?: () => void} {
  if (!effect) {
    let connectionAttempted = false;
    try {
      // As with custom effect edges, an AudioNode proxy may commit this direct
      // route and then throw. Record intent first so the failed construction
      // can retract the exact edge while preserving the connect failure.
      connectionAttempted = true;
      source.connect(destination);
    } catch (error) {
      if (connectionAttempted) {
        try {
          source.disconnect(destination);
        } catch {
          // Best-effort rollback; the connect failure remains authoritative.
        }
      }
      throw error;
    }
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        source.disconnect(destination);
      },
    };
  }
  let node: EffectNode | undefined;
  let sourceConnected = false;
  let outputConnected = false;
  try {
    node = effect.build(context);
    // Record mutation intent before invoking a structural/custom AudioNode.
    // A proxy connect() may commit its edge and then throw; rollback must still
    // attempt that exact disconnect, matching buildEffectChain's transaction.
    sourceConnected = true;
    source.connect(node.input);
    outputConnected = true;
    node.output.connect(destination);
  } catch (error) {
    // Graph construction is a transaction. A custom effect may throw after
    // allocating nodes or one of its cross-context edges may reject; unwind
    // every edge we know was committed while preserving the original failure.
    if (outputConnected && node) {
      try {
        node.output.disconnect(destination);
      } catch {
        // Best-effort rollback; the construction error remains authoritative.
      }
    }
    if (sourceConnected && node) {
      try {
        source.disconnect(node.input);
      } catch {
        // See above.
      }
    }
    try {
      node?.dispose?.();
    } catch {
      // See above.
    }
    throw error;
  }

  let disposed = false;
  return {
    dispose: () => {
      if (disposed || !node) return;
      disposed = true;
      let firstError: unknown;
      try {
        node.output.disconnect(destination);
      } catch (error) {
        firstError = error;
      }
      try {
        source.disconnect(node.input);
      } catch (error) {
        firstError ??= error;
      }
      try {
        node.dispose?.();
      } catch (error) {
        firstError ??= error;
      }
      if (firstError !== undefined) throw firstError;
    },
  };
}

/** Prefer the explicit effect option, falling back to legacy reverb settings. */
export function resolveEffect(
  effect: Effect | undefined,
  reverb: false | ReverbOptions | undefined,
): Effect | undefined {
  if (effect) return effect;
  return reverb ? Effect.reverb(reverb) : undefined;
}
