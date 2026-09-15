// ============================================================================
// <synth-panel> — ONE control panel for a synth voice. The `sections`
// attribute (comma list, default "sound,effects") picks which blocks render,
// in order:
//
//   • "sound"    — one rotary knob per `.sound` (alias `.params`) parameter
//                  descriptor, grouped by `group`.
//   • "effects"  — assign `.context` + `.effects` (alias `.effect`); the panel
//                  builds the chain, exposes `.input` / `.output` AudioNodes and
//                  renders one knob per live param.
//   • "envelope" — a draggable ADSR editor; `.envelope` / `.ranges` / `.apply`,
//                  dispatches `webscore:envelope`.
//   • "eq"       — a 3-band graphic EQ over `.context`; drag points on the
//                  response curve; `.bands` overrides.
//   • "lfo"      — shape / rate / depth modulation source driving `.target`.
//   • "macros"   — N assignable macro knobs (`.macros`), each driving many
//                  targets at once and dispatching `webscore:macro`.
//
// When both "effects" and "eq" are active their audio nodes are spliced into a
// single serial chain (effects → eq) behind the shared `.input` / `.output`.
// Toggling `sections` at runtime re-renders and re-applies the current values
// of the remaining sections (knob positions, envelope, EQ bands, macro
// positions, live effect params survive). Disconnecting tears down every audio
// node the panel built and stops the LFO frame loop.
//
// CSS custom properties: --synth-bg, --synth-border, --synth-box-border,
// --synth-head, --synth-label, --synth-radius,
// --synth-track, --synth-fill, --synth-thumb, --synth-graph-bg, --synth-graph,
// --synth-graph-grid, --synth-graph-fill, --synth-graph-text, --synth-accent
//
// This file is the element coordinator. Pure mapping rules live in
// internal/synth-panel-model, Web Audio ownership is the public headless
// SynthPanelAudioGraph, and all interactive DOM comes from @webmusic/ui.
// ============================================================================

import type { Effect } from "../headless/effects";
import {
  mountEnvelope,
  type EnvelopeBinding,
  type EnvelopeHandle,
} from "@webmusic/ui/envelope";
import {mountEq, type EqBinding, type EqHandle} from "@webmusic/ui/eq";
import {mountLfo, type LfoBinding, type LfoHandle} from "@webmusic/ui/lfo";
import {mountParameterRack, type ParameterRackHandle} from "@webmusic/ui/parameter";
import {mountMacroRack, type MacroRackHandle} from "@webmusic/ui/macro";
import {mountSectionPanel, type SectionPanelHandle} from "@webmusic/ui/panel";
import {
  LfoController,
  lfoWave,
  type LfoControllerState,
  type LfoTarget,
} from "../headless/lfo";
import { WebMusicElement, upgradeProperties } from "./internal/base";
import { emitEnvelopeChange } from "./internal/envelope-emit";
import {SynthPanelAudioGraph} from '../headless/synth-panel-audio';
import {
  DEFAULT_BANDS,
  PARAM_RANGE,
  PARAM_UNIT,
  clamp01,
  parseSections,
  type Envelope,
  type EnvelopeRanges,
  type EqBand,
  type MacroDetail,
  type SoundParam,
  type SynthMacro,
  type SynthPanelSection,
} from "./internal/synth-panel-model";

const SYNTH_PANEL_COMPATIBILITY_STYLE = `
:host {
  display: block;
  box-sizing: border-box;
  inline-size: 100%;
  min-inline-size: 0;
  max-inline-size: 100%;
}
:host([hidden]) { display: none; }
.panel {
  border: var(--wm-synth-panel-surface-border, var(--wm-panel-surface-border, var(--wm-component-border, var(--wm-panel-border, 0))));
  padding: var(--wm-synth-panel-surface-padding, var(--wm-panel-surface-padding, var(--wm-component-padding, var(--wm-panel-padding, 0))));
  background: var(--wm-synth-panel-surface-background, var(--wm-panel-surface-background, var(--wm-component-background, var(--synth-bg, var(--wm-panel-background, var(--wm-surface, #fff))))));
  border-radius: var(--wm-synth-panel-surface-radius, var(--wm-panel-surface-radius, var(--wm-component-radius, var(--synth-radius, var(--wm-control-radius, 0)))));
  color: var(--synth-head, var(--wm-panel-foreground, var(--wm-foreground, #444)));
}
`;

const SYNTH_ENVELOPE_COMPATIBILITY_STYLE = `
.graph.env {
  background: var(--wm-envelope-surface-background, var(--wm-component-background, var(--synth-bg, var(--wm-surface, #fff))));
  border: var(--wm-envelope-surface-border, var(--wm-component-border, 1px solid var(--synth-box-border, var(--wm-control-border, var(--wm-border, #d8d8d8)))));
  border-radius: var(--wm-envelope-surface-radius, var(--wm-component-radius, var(--synth-radius, var(--wm-control-radius, 0))));
  color: var(--synth-graph, var(--wm-envelope-foreground, var(--wm-foreground-on-inverse, #fff)));
}
.graph.env [part~="svg"] {
  height: var(--wm-envelope-height, 140px);
  border-color: var(--synth-box-border, var(--wm-envelope-border, var(--wm-control-border, var(--wm-border, #d8d8d8))));
  border-radius: var(--synth-radius, var(--wm-envelope-radius, var(--wm-control-radius, 0)));
  background: var(--synth-graph-bg, var(--wm-envelope-background, var(--wm-surface-inverse, #111)));
}
.graph.env [part~="grid"].grid {
  stroke: var(--synth-graph-grid, var(--wm-envelope-grid, rgba(255,255,255,0.12)));
}
.graph.env [part~="area"].area {
  fill: var(--synth-graph-fill, var(--wm-envelope-fill, rgba(255,255,255,0.12)));
}
.graph.env [part~="curve"].curve {
  stroke: var(--synth-graph, var(--wm-envelope-curve, currentColor));
}
.graph.env [part~="handle"].handle {
  fill: var(--synth-graph, var(--wm-envelope-handle, currentColor));
}
.graph.env [part~="readout"].read {
  color: var(--synth-graph-text, var(--wm-envelope-text, var(--wm-foreground-muted, var(--wm-foreground, #666))));
}
`;

const SYNTH_LFO_COMPATIBILITY_STYLE = `
.lfo {
  padding: var(--wm-lfo-padding, 0);
  border: 0;
  border-radius: var(--synth-radius, var(--wm-lfo-radius, var(--wm-control-radius, 0)));
  background: var(--wm-lfo-background, transparent);
  color: var(--synth-head, var(--wm-lfo-foreground, var(--wm-foreground, #444)));
  font: inherit;
}
.lfo [part~="run"].run {
  border-color: var(--synth-thumb, var(--wm-lfo-button-background, var(--wm-accent, var(--wm-foreground, #111))));
  background: var(--synth-thumb, var(--wm-lfo-button-background, var(--wm-accent, var(--wm-foreground, #111))));
  color: var(--wm-lfo-button-foreground, var(--wm-accent-foreground, #fff));
}
.lfo [part~="shape"].shape {
  border-color: var(--synth-box-border, var(--wm-lfo-chip-border, var(--wm-control-border, var(--wm-border, #d8d8d8))));
  background: var(--synth-bg, var(--wm-lfo-chip-background, var(--wm-surface, #fff)));
  color: var(--synth-head, var(--wm-lfo-chip-foreground, var(--wm-foreground, #444)));
}
.lfo [part~="shape"].shape.on {
  background: var(--synth-thumb, var(--wm-lfo-chip-active-background, var(--wm-accent, var(--wm-foreground, #111))));
  color: var(--wm-lfo-chip-active-foreground, var(--wm-accent-foreground, #fff));
}
.lfo [part~="control"] {
  color: var(--synth-label, var(--wm-lfo-label, var(--wm-foreground-muted, var(--wm-foreground, #666))));
}
.lfo [part~="input"] {
  background: var(--synth-track, var(--wm-lfo-track, var(--wm-control-track, #dcdcdc)));
}
.lfo [part~="input"]::-webkit-slider-thumb,
.lfo [part~="input"]::-moz-range-thumb {
  background: var(--synth-thumb, var(--wm-lfo-thumb, var(--wm-control-thumb, #111)));
}
.lfo [part~="wave"].wave {
  background: var(--synth-graph-bg, var(--wm-lfo-wave-background, var(--wm-surface-inverse, #111)));
}
.lfo [part~="curve"].lfo-curve {
  stroke: var(--synth-graph, var(--wm-lfo-wave, var(--wm-foreground-on-inverse, #fff)));
}
.lfo [part~="head"].head {
  stroke: var(--synth-accent, var(--wm-lfo-head, var(--wm-accent, #c0392b)));
}
`;

const SYNTH_EQ_COMPATIBILITY_STYLE = `
.graph.eq {
  background: var(--wm-eq-surface-background, var(--wm-component-background, var(--synth-bg, var(--wm-surface, #fff))));
  border: var(--wm-eq-surface-border, var(--wm-component-border, 1px solid var(--synth-box-border, var(--wm-control-border, var(--wm-border, #d8d8d8)))));
  border-radius: var(--wm-eq-surface-radius, var(--wm-component-radius, var(--synth-radius, var(--wm-control-radius, 0))));
  color: var(--synth-graph-text, var(--wm-eq-text, var(--wm-foreground-muted, var(--wm-foreground, #666))));
}
.graph.eq [part~="svg"] {
  height: var(--wm-eq-height, 160px);
  border-color: var(--synth-box-border, var(--wm-eq-border, var(--wm-control-border, var(--wm-border, #d8d8d8))));
  border-radius: var(--synth-radius, var(--wm-eq-radius, var(--wm-control-radius, 0)));
  background: var(--synth-graph-bg, var(--wm-eq-background, var(--wm-surface-inverse, #111)));
}
.graph.eq [part~="grid"].grid { stroke: var(--synth-graph-grid, var(--wm-eq-grid, rgba(255,255,255,.12))); }
.graph.eq [part~="zero"].zero { stroke: var(--synth-graph-grid, var(--wm-eq-zero, rgba(255,255,255,.3))); }
.graph.eq [part~="area"].area { fill: var(--synth-graph-fill, var(--wm-eq-fill, rgba(255,255,255,.1))); }
.graph.eq [part~="curve"].curve { stroke: var(--synth-graph, var(--wm-eq-curve, var(--wm-foreground-on-inverse, #fff))); }
.graph.eq [part~="point"].point { fill: var(--synth-graph, var(--wm-eq-point, var(--wm-foreground-on-inverse, #fff))); }
`;

export { lfoWave, parseSections };
export type {
  Envelope,
  EnvelopeRanges,
  EqBand,
  LfoShape,
  LfoTarget,
  MacroDetail,
  MacroTarget,
  SoundParam,
  SynthMacro,
  SynthPanelSection,
} from "./internal/synth-panel-model";

export interface SynthPanelEnvelopeErrorDetail {
  operation: "synth-panel";
  error: unknown;
}

export interface SynthPanelLfoErrorDetail {
  operation: "synth-panel";
  error: unknown;
}

/** Writable LFO configuration. Omitted fields retain their current values. */
export type SynthPanelLfoConfig = Partial<LfoControllerState>;

/** Complete public LFO state returned by `.lfo`. */
export type SynthPanelLfoState = LfoControllerState;

/** Complete state published by the bubbling, composed `webscore:lfo` event. */
export type SynthPanelLfoEventDetail = SynthPanelLfoState;

function sameLfoState(
  first: SynthPanelLfoState,
  second: SynthPanelLfoState,
): boolean {
  return (
    first.shape === second.shape &&
    first.rate === second.rate &&
    first.depth === second.depth &&
    first.running === second.running
  );
}

export class SynthPanelElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return ["sections"];
  }

  /** Called on every envelope change with the current ADSR (times in seconds). */
  apply?: (env: Envelope) => void;
  private rangeValues: EnvelopeRanges = {
    attackMax: 2,
    decayMax: 2,
    releaseMax: 2,
  };
  private targetRef?: LfoTarget;

  private root?: ShadowRoot;
  private panelHandle?: SectionPanelHandle;
  private ctx?: AudioContext;

  // sound section
  private soundParams: SoundParam[] = [];
  /** Current knob values (index → value) so a re-render restores positions. */
  private readonly soundValues = new Map<number, number>();
  private soundGeneration = 0;
  private readonly soundWrites = new Map<number, number>();
  private soundHandle?: ParameterRackHandle;

  // effects section
  private effectList: Effect[] = [];
  /** Live param values per effect index, re-applied after a chain rebuild. */
  private effectValues: Array<Record<string, number>> = [];
  private effectHandle?: ParameterRackHandle;

  // eq section
  private bandsRef: EqBand[] = DEFAULT_BANDS.map((b) => ({ ...b }));
  private readonly audio = new SynthPanelAudioGraph();
  private audioSections?: string;
  private eqHandle?: EqHandle;
  private eqMountGeneration = 0;

  // envelope section
  private env: Envelope = {
    attack: 0.05,
    decay: 0.2,
    sustain: 0.6,
    release: 0.4,
  };
  private envelopeHandle?: EnvelopeHandle;
  private envelopeMountGeneration = 0;
  private connectionGeneration = 0;
  private envelopeApplyRevision = 0;
  private active = false;

  // lfo section
  private lfoController?: LfoController;
  private lfoHandle?: LfoHandle;
  private lfoMountGeneration = 0;
  private lfoControllerGeneration = 0;
  private retainedLfoState: Pick<
    LfoControllerState,
    "shape" | "rate" | "depth" | "phase"
  > = {
    shape: "sine",
    rate: 1,
    depth: 0.6,
    phase: 0,
  };
  /** Explicit run intent assigned while detached; consumed by the next mount. */
  private pendingLfoRunning?: boolean;

  // macros section
  private macroList: SynthMacro[] = [];
  /** Current macro positions (0..1), kept across re-renders. */
  private macroValues: number[] = [];
  private macroHandle?: MacroRackHandle;

  /**
   * The kernel base owns the mounted flag, the lifetime generation and the
   * draining of owned cleanups. The panel keeps `connectionGeneration` and
   * `active` for its own re-entrancy checks: property upgrades and section
   * renders can synchronously disconnect the panel mid-mount, and the checks
   * below have to see that from inside this method.
   */
  protected onMount(): void {
    const connection = ++this.connectionGeneration;
    // Upgrade caller-assigned state before activating the mounted lifetime;
    // otherwise a pre-upgrade `.envelope` own property emits twice.
    this.active = false;
    this.destroySharedHandles();
    this.panelHandle?.destroy();
    this.panelHandle = undefined;
    upgradeProperties(this, [
      "sound",
      "params",
      "context",
      "effects",
      "effect",
      "envelope",
      "ranges",
      "apply",
      "bands",
      "lfo",
      "target",
      "macros",
    ]);
    if (connection !== this.connectionGeneration || !this.isConnected) return;
    if (!this.root) this.root = this.attachShadow({ mode: "open" });
    this.active = true;
    this.rebuildLfoController();
    if (!this.active || connection !== this.connectionGeneration) return;
    this.rebuildAudio();
    const envelopeMounted = this.render();
    if (
      envelopeMounted &&
      this.active &&
      this.connectionGeneration === connection
    )
      this.emitEnvelope();
  }

  /**
   * Section-wise teardown. This stays hand-written rather than becoming a
   * stack of `own()` cleanups: the sections are released in a fixed order,
   * each step re-checks that the panel is still disconnected, and failures
   * are routed to two different public error channels (envelope first, then
   * LFO) — none of which the base's reverse-order cleanup drain expresses.
   */
  protected onUnmount(): void {
    // Tear down every audio node the panel built and stop the LFO loop —
    // a detached panel must never keep processing (or leaking) audio.
    this.active = false;
    // A disconnect always stops the reusable LFO. A later explicit detached
    // assignment can set a fresh run intent for the next connection.
    this.pendingLfoRunning = undefined;
    this.soundGeneration += 1;
    this.audioSections = undefined;
    const connection = ++this.connectionGeneration;
    this.envelopeMountGeneration += 1;
    this.eqMountGeneration += 1;
    this.lfoMountGeneration += 1;
    this.lfoControllerGeneration += 1;
    const stillDisconnected = (): boolean =>
      !this.active && this.connectionGeneration === connection;
    const envelopeErrors: unknown[] = [];
    const lfoErrors: unknown[] = [];
    try {
      this.replaceEnvelopeHandle();
    } catch (error) {
      envelopeErrors.push(error);
    }
    if (!stillDisconnected()) return;
    try {
      this.replaceLfoHandle();
    } catch (error) {
      lfoErrors.push(error);
    }
    if (!stillDisconnected()) return;
    try {
      this.replaceEqHandle();
    } catch (error) {
      lfoErrors.push(error);
    }
    if (!stillDisconnected()) return;
    try {
      this.destroySharedHandles();
      this.panelHandle?.destroy();
      this.panelHandle = undefined;
    } catch (error) {
      lfoErrors.push(error);
    }
    if (!stillDisconnected()) return;
    try {
      this.teardownLfoController();
    } catch (error) {
      lfoErrors.push(error);
    }
    if (!stillDisconnected()) return;
    try {
      this.teardownAudio();
    } catch (error) {
      lfoErrors.push(error);
    }
    for (const error of envelopeErrors) this.reportEnvelopeError(error);
    for (const error of lfoErrors) this.reportLfoError(error);
  }

  attributeChangedCallback(): void {
    if (!this.isConnected) return;
    // Presentation order and non-audio sections do not change the signal path.
    if (this.audioSectionKey() !== this.audioSections) this.rebuildAudio();
    this.render();
  }

  // --- attribute / property surface ---

  get sections(): SynthPanelSection[] {
    return parseSections(this.getAttribute("sections"));
  }
  set sections(value: SynthPanelSection[] | string) {
    this.setAttribute(
      "sections",
      Array.isArray(value) ? value.join(",") : value,
    );
  }

  /** Sound parameters (one knob each); `.params` is a long-standing alias. */
  set sound(params: SoundParam[] | undefined) {
    this.soundGeneration += 1;
    this.soundWrites.clear();
    this.soundParams = params ?? [];
    this.soundValues.clear();
    if (this.isConnected) this.render();
  }
  get sound(): SoundParam[] {
    return this.soundParams;
  }
  set params(params: SoundParam[] | undefined) {
    this.sound = params;
  }
  get params(): SoundParam[] {
    return this.soundParams;
  }

  /** The AudioContext the effects / EQ chain is built on. */
  set context(context: AudioContext | undefined) {
    const previous = this.ctx;
    const graph = this.audio.effectNodes;
    this.ctx = context;
    if (this.isConnected) {
      try { this.rebuildAudio(); } catch (error) {
        if (this.ctx === context && this.audio.effectNodes === graph) this.ctx = previous;
        throw error;
      }
      this.render();
    }
  }
  get context(): AudioContext | undefined {
    return this.ctx;
  }

  /** The effect chain. `.effect` is a singular-assignment alias. */
  set effects(effects: Effect[] | undefined) {
    const previous = this.effectList;
    const previousValues = this.effectValues;
    const graph = this.audio.effectNodes;
    this.effectList = effects ?? [];
    const next = this.effectList;
    this.effectValues = [];
    if (this.isConnected) {
      try { this.rebuildAudio(); } catch (error) {
        if (this.effectList === next && this.audio.effectNodes === graph) {
          this.effectList = previous;
          this.effectValues = previousValues;
        }
        throw error;
      }
      this.render();
    }
  }
  get effects(): Effect[] {
    return this.effectList;
  }
  set effect(effect: Effect | Effect[] | undefined) {
    this.effects =
      effect == null ? [] : Array.isArray(effect) ? effect : [effect];
  }
  get effect(): Effect[] {
    return this.effectList;
  }

  /** Signal entry node of the built chain (connect a source into this). */
  get input(): AudioNode | undefined {
    return this.audio.input;
  }
  /** Signal exit node of the built chain (connect this to a destination). */
  get output(): AudioNode | undefined {
    return this.audio.output;
  }

  /** Borrowed modulation target. Assignment never applies a value eagerly. */
  set target(target: LfoTarget | undefined) {
    this.targetRef = target;
    try {
      this.lfoController?.setTarget(target);
    } catch (error) {
      this.reportLfoError(error);
    }
  }
  get target(): LfoTarget | undefined {
    return this.targetRef;
  }

  /**
   * Configure the LFO. Assignments are normalized by the same controller that
   * drives the UI; omitted fields retain their current values.
   */
  set lfo(config: SynthPanelLfoConfig) {
    const controller = this.lfoController;
    if (controller) {
      this.pendingLfoRunning = undefined;
      this.commitLfoChange(controller, () => {
        controller.configure({
          shape: config.shape,
          rate: config.rate,
          depth: config.depth,
          phase: config.phase,
        });
        if (config.running !== undefined) {
          controller.setRunning(config.running);
        }
      });
      return;
    }

    try {
      const normalizer = new LfoController(this.retainedLfoState);
      try {
        normalizer.configure({
          shape: config.shape,
          rate: config.rate,
          depth: config.depth,
          phase: config.phase,
        });
        this.retainLfoState(normalizer.snapshot());
      } finally {
        normalizer.dispose();
      }
      if (config.running !== undefined) {
        this.pendingLfoRunning = config.running;
      }
    } catch (error) {
      if (this.active) this.reportLfoError(error);
    }
  }

  /** A detached copy or the mounted controller's current complete state. */
  get lfo(): SynthPanelLfoState {
    const state = this.lfoController?.snapshot();
    return state
      ? { ...state }
      : {
          ...this.retainedLfoState,
          running: this.pendingLfoRunning ?? false,
        };
  }

  /** Set the ADSR envelope programmatically. */
  set envelope(env: Partial<Envelope>) {
    this.env = { ...this.env, ...env };
    if (this.active) {
      this.envelopeHandle?.update();
      this.emitEnvelope();
    }
  }
  get envelope(): Envelope {
    return { ...this.env };
  }

  /** Per-stage envelope maxima (seconds) used to scale the X axis. */
  set ranges(ranges: EnvelopeRanges) {
    this.rangeValues = {...ranges};
    if (this.active) this.envelopeHandle?.update();
  }
  get ranges(): EnvelopeRanges {
    return {...this.rangeValues};
  }

  /** Override the EQ bands. */
  set bands(bands: EqBand[] | undefined) {
    const previous = this.bandsRef;
    const graph = this.audio.effectNodes;
    this.bandsRef = (bands ?? DEFAULT_BANDS).map((b) => ({ ...b }));
    const next = this.bandsRef;
    if (this.isConnected) {
      try { this.rebuildAudio(); } catch (error) {
        if (this.bandsRef === next && this.audio.effectNodes === graph) this.bandsRef = previous;
        throw error;
      }
      this.render();
    }
  }
  get bands(): EqBand[] {
    return this.bandsRef.map((b) => ({ ...b }));
  }

  /** The macro knobs (each driving many targets). */
  set macros(macros: SynthMacro[] | undefined) {
    this.macroList = macros ?? [];
    // A fresh assignment is a fresh configuration, so a descriptor that states
    // a `value` wins; the retained position is the fallback for descriptors
    // that omit one, which is what keeps knobs steady across a section toggle.
    this.macroValues = this.macroList.map((m, i) =>
      clamp01(m.value ?? this.macroValues[i] ?? 0),
    );
    if (this.isConnected) this.render();
    this.macroList.forEach((_, i) => this.applyMacro(i, false));
  }
  get macros(): SynthMacro[] {
    return this.macroList;
  }

  // ==========================================================================
  // Audio chain (effects + eq) — build / teardown
  // ==========================================================================

  private teardownAudio(): void {
    this.audioSections = undefined;
    this.audio.teardown();
  }

  private audioSectionKey(): string {
    const sections = this.sections;
    return `${sections.includes('effects')}:${sections.includes('eq')}`;
  }

  /**
   * Rebuild the audio chain for the active sections. Replacing the chain must
   * prepare the candidate before unhooking old DSP. The public same-context
   * ports remain stable, and saved effect parameters survive section changes.
   */
  private rebuildAudio(): void {
    const key = this.audioSectionKey();
    const context = this.ctx;
    const effects = this.effectList;
    const bands = this.bandsRef;
    this.audio.rebuild({
      context,
      effects,
      bands,
      sections: this.sections,
      effectValues: this.effectValues,
    });
    if (context === this.ctx && effects === this.effectList && bands === this.bandsRef && key === this.audioSectionKey()) {
      this.audioSections = key;
    }
  }

  // ==========================================================================
  // Rendering
  // ==========================================================================

  private render(): boolean {
    if (!this.root) return false;
    // Release pointer capture/listeners before replacing the section markup.
    const renderGeneration = ++this.envelopeMountGeneration;
    this.replaceEnvelopeHandle();
    if (renderGeneration !== this.envelopeMountGeneration) return false;
    const lfoRenderGeneration = ++this.lfoMountGeneration;
    this.replaceLfoHandle();
    if (lfoRenderGeneration !== this.lfoMountGeneration) return false;
    const eqRenderGeneration = ++this.eqMountGeneration;
    this.replaceEqHandle();
    if (eqRenderGeneration !== this.eqMountGeneration) return false;
    this.destroySharedHandles();
    this.panelHandle?.destroy();
    this.panelHandle = undefined;
    const sections = this.sections;
    const ownerDocument = (this.root as unknown as {ownerDocument?: Document}).ownerDocument;
    if (!ownerDocument) return false;

    // The compound UI presenter owns the style, section and slot skeleton.
    // This Element only maps domain bindings into the five specialized
    // presenter kinds mounted in those returned slots.
    try {
      this.panelHandle = mountSectionPanel(
        this.root,
        sections.map((sectionName) => ({
          id: sectionName,
          classNames: {
            section: `sec sec-${sectionName}`,
            slot: `${sectionName}-host`,
          },
          parts: {
            section: `synth-${sectionName}-section`,
            slot: `synth-${sectionName}-slot`,
          },
        })),
        {
          label: "Synth panel",
          classNames: {root: "panel"},
          parts: {root: "synth-panel"},
          styleText: [
            SYNTH_PANEL_COMPATIBILITY_STYLE,
            SYNTH_ENVELOPE_COMPATIBILITY_STYLE,
            SYNTH_EQ_COMPATIBILITY_STYLE,
            SYNTH_LFO_COMPATIBILITY_STYLE,
          ].join("\n"),
        },
      );
    } catch (error) {
      this.reportLfoError(error);
      return false;
    }

    const slot = (name: SynthPanelSection): HTMLElement | undefined =>
      this.panelHandle?.slot(name);
    const soundHost = slot("sound");
    if (soundHost) this.wireSound(soundHost);
    const effectsHost = slot("effects");
    if (effectsHost) this.wireEffects(effectsHost);
    const envelopeHost = slot("envelope");
    const envelopeMounted = envelopeHost ? this.wireEnvelope(envelopeHost) : false;
    const eqHost = slot("eq");
    if (eqHost) this.wireEq(eqHost);
    const lfoHost = slot("lfo");
    if (lfoHost) this.wireLfo(lfoHost);
    const macroHost = slot("macros");
    if (macroHost) this.wireMacros(macroHost);
    return envelopeMounted;
  }

  // --- sound section ---

  private wireSound(host: HTMLElement): void {
    this.soundHandle = mountParameterRack(host, {
        snapshot: () => ({parameters: this.soundParams.map((param,index)=>({id:String(index),label:param.name,value:this.soundValues.get(index)??param.value,min:param.options?.length?0:param.min,max:param.options?.length?(param.options.length-1):param.max,step:param.options?.length?1:param.step,unit:param.unit,options:param.options,group:param.group}))}),
        setValue: (id, value) => {
          const index = Number(id);
          const param = this.soundParams[index];
          if (!param) return;
          const generation = this.soundGeneration;
          const write = (this.soundWrites.get(index) ?? 0) + 1;
          this.soundWrites.set(index, write);
          const previous = this.soundValues.get(index);
          // Commit optimistically so the knob stays under the pointer while an
          // async apply settles, then put it back if that apply fails. The
          // rejection is re-thrown so the presenter repaints and reports it
          // through onError instead of dropping it.
          this.soundValues.set(index, value);
          const rollback = (error: unknown): never => {
            if (generation === this.soundGeneration && this.soundParams[index] === param && this.soundWrites.get(index) === write) {
              if (previous === undefined) this.soundValues.delete(index);
              else this.soundValues.set(index, previous);
              this.soundHandle?.update();
            }
            throw error;
          };
          try {
            return Promise.resolve(param.apply(value)).catch(rollback);
          } catch (error) {
            return rollback(error);
          }
        },
      }, {layout:'grouped', onError:(error)=>this.reportLfoError(error)});
  }

  // --- effects section ---

  private wireEffects(host: HTMLElement): void {
    this.effectHandle = mountParameterRack(host, {
        snapshot: () => ({parameters: this.audio.effectNodes.flatMap((node,index)=>Object.entries(node.params??{}).map(([name,param])=>{const [min,max,step]=PARAM_RANGE[name]??[0,1,.01];return{id:`${index}:${name}`,label:name,value:this.effectValues[index]?.[name]??param.value,min,max,step,unit:PARAM_UNIT[name],group:this.effectList[index]?.label??`fx ${index+1}`}}))}),
        setValue: (id,value) => {const [rawIndex,name]=id.split(':');const index=Number(rawIndex);(this.effectValues[index]??={})[name]=value;const target=this.audio.effectNodes[index]?.params?.[name];if(target)target.value=value},
      }, {layout:'grouped',onError:(error)=>this.reportLfoError(error)});
  }

  // --- envelope section ---

  private wireEnvelope(host: HTMLElement): boolean {
    const generation = ++this.envelopeMountGeneration;
    let next: EnvelopeHandle;
    try {
      next = this.mountSynthEnvelopeUI(host, this.createEnvelopeBinding());
    } catch (error) {
      this.reportEnvelopeError(error);
      return false;
    }
    if (!this.active || generation !== this.envelopeMountGeneration) {
      next.destroy();
      return false;
    }
    return this.replaceEnvelopeHandle(next, generation);
  }

  /** Structural mapping kept in the concrete Element instead of an adapter. */
  protected createEnvelopeBinding(): EnvelopeBinding {
    return {
      snapshot: () => ({ envelope: this.envelope, ranges: { ...this.ranges } }),
      setEnvelope: (envelope) => {
        this.env = { ...envelope };
        this.envelopeHandle?.update();
        this.emitEnvelope();
      },
    };
  }

  /** Subclass seam for application-owned markup or presenter variants. */
  protected mountSynthEnvelopeUI(
    host: HTMLElement,
    binding: EnvelopeBinding,
  ): EnvelopeHandle {
    return mountEnvelope(host, binding, {
      classNames: {
        root: "graph env",
        grid: "grid",
        area: "area",
        curve: "curve",
        handle: "handle",
        readout: "read",
      },
      onError: (error) => this.reportEnvelopeError(error),
    });
  }

  protected reportEnvelopeError(error: unknown): void {
    this.dispatchEvent(
      new CustomEvent<SynthPanelEnvelopeErrorDetail>("webscore:error", {
        detail: { operation: "synth-panel", error },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private replaceEnvelopeHandle(
    next?: EnvelopeHandle,
    expectedGeneration = this.envelopeMountGeneration,
  ): boolean {
    const previous = this.envelopeHandle;
    this.envelopeHandle = undefined;
    previous?.destroy();
    if (expectedGeneration !== this.envelopeMountGeneration) {
      next?.destroy();
      return false;
    }
    this.envelopeHandle = next;
    return true;
  }

  private emitEnvelope(): void {
    const revision = ++this.envelopeApplyRevision;
    const connection = this.connectionGeneration;
    emitEnvelopeChange({
      host: this,
      envelope: this.envelope,
      apply: this.apply,
      isCurrent: () =>
        this.active &&
        connection === this.connectionGeneration &&
        revision === this.envelopeApplyRevision,
      reportError: (error) => this.reportEnvelopeError(error),
    });
  }

  // --- eq section ---

  private wireEq(host: HTMLElement): void {
    const controller = this.audio.equalizer;
    if (!controller) return;
    const generation = ++this.eqMountGeneration;
    let next: EqHandle;
    try {
      next = this.mountSynthEqUI(host, this.createEqBinding());
    } catch (error) {
      this.reportLfoError(error);
      return;
    }
    if (!this.active || generation !== this.eqMountGeneration) {
      next.destroy();
      return;
    }
    this.replaceEqHandle(next, generation);
  }

  protected createEqBinding(): EqBinding {
    return {
      snapshot: () =>
        this.audio.equalizer?.snapshot() ?? {
          bands: this.bandsRef.map((band) => ({...band})),
          response: [],
          ready: false,
        },
      setBand: (index, band) => {
        this.audio.equalizer?.setBand(index, band);
        this.bandsRef = this.audio.equalizer?.snapshot().bands ?? this.bandsRef;
      },
      subscribe: (notify) => this.audio.equalizer?.subscribe(notify) ?? (() => undefined),
    };
  }

  protected mountSynthEqUI(host: HTMLElement, binding: EqBinding): EqHandle {
    return mountEq(host, binding, {
      classNames: {
        root: "graph eq",
        grid: "grid",
        zero: "zero",
        area: "area",
        curve: "curve",
        points: "points",
        point: "point",
        readout: "read",
        empty: "needs-ctx",
      },
      emptyLabel: "Assign an AudioContext to .context",
      onError: (error) => this.reportLfoError(error),
    });
  }

  private replaceEqHandle(
    next?: EqHandle,
    expectedGeneration = this.eqMountGeneration,
  ): boolean {
    const previous = this.eqHandle;
    this.eqHandle = undefined;
    previous?.destroy();
    if (expectedGeneration !== this.eqMountGeneration) {
      next?.destroy();
      return false;
    }
    this.eqHandle = next;
    return true;
  }

  // --- lfo section ---

  private wireLfo(host: HTMLElement): void {
    const controller = this.lfoController;
    if (!controller) return;
    const generation = ++this.lfoMountGeneration;
    let next: LfoHandle;
    try {
      next = this.mountSynthLfoUI(host, this.createLfoBinding(controller));
    } catch (error) {
      this.reportLfoError(error);
      return;
    }
    if (!this.active || generation !== this.lfoMountGeneration) {
      next.destroy();
      return;
    }
    this.replaceLfoHandle(next, generation);
  }

  protected createSynthLfoController(): LfoController {
    return new LfoController({
      ...this.retainedLfoState,
      target: this.targetRef,
      now: () =>
        (typeof performance !== "undefined" ? performance.now() : 0) / 1000,
      requestFrame: (callback) =>
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(callback)
          : -1,
      cancelFrame: (handle) => {
        if (handle >= 0 && typeof cancelAnimationFrame === "function")
          cancelAnimationFrame(handle);
      },
      onError: (error) => this.reportLfoError(error),
    });
  }

  protected createLfoBinding(controller: LfoController): LfoBinding {
    return {
      snapshot: () => controller.snapshot(),
      setRunning: (running) =>
        this.commitLfoChange(controller, () => controller.setRunning(running)),
      setShape: (shape) =>
        this.commitLfoChange(controller, () => controller.configure({ shape })),
      setRate: (rate) =>
        this.commitLfoChange(controller, () => controller.configure({ rate })),
      setDepth: (depth) =>
        this.commitLfoChange(controller, () => controller.configure({ depth })),
      subscribe: (notify) => controller.subscribe(notify),
    };
  }

  /**
   * Commit one UI/API command and publish one semantic control-state event.
   * Phase remains available in the full detail/getter snapshot, but never
   * causes an event by itself (the animation loop must not emit DOM events).
   */
  private commitLfoChange(
    controller: LfoController,
    change: () => void,
  ): void {
    if (this.lfoController !== controller) return;
    const before = controller.snapshot();
    let failure: unknown;
    let failed = false;
    try {
      change();
    } catch (error) {
      failure = error;
      failed = true;
    }
    // A controller notification can run caller code through an overridden UI
    // seam. Never retain or announce state from a lifetime replaced re-entrantly.
    if (this.lfoController !== controller) return;
    const after = controller.snapshot();
    this.retainLfoState(after);
    if (failed) this.reportLfoError(failure);
    if (
      this.active &&
      this.lfoController === controller &&
      !sameLfoState(before, after)
    ) {
      this.dispatchEvent(
        new CustomEvent<SynthPanelLfoEventDetail>("webscore:lfo", {
          detail: { ...after },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private retainLfoState(state: SynthPanelLfoState): void {
    const { shape, rate, depth, phase } = state;
    this.retainedLfoState = { shape, rate, depth, phase };
  }

  protected mountSynthLfoUI(host: HTMLElement, binding: LfoBinding): LfoHandle {
    return mountLfo(host, binding, {
      classNames: {
        root: "lfo",
        row: "lfo-row",
        run: "run",
        shapes: "shapes",
        shape: "shape",
        rateInput: "rate",
        depthInput: "depth",
        rateValue: "val ratev",
        depthValue: "val depthv",
        wave: "wave",
        curve: "lfo-curve",
        head: "head",
      },
      onError: (error) => this.reportLfoError(error),
    });
  }

  protected reportLfoError(error: unknown): void {
    this.dispatchEvent(
      new CustomEvent<SynthPanelLfoErrorDetail>("webscore:error", {
        detail: { operation: "synth-panel", error },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private rebuildLfoController(): void {
    const generation = ++this.lfoControllerGeneration;
    this.teardownLfoController();
    if (!this.active || generation !== this.lfoControllerGeneration) return;
    let next: LfoController;
    try {
      next = this.createSynthLfoController();
    } catch (error) {
      if (this.active && generation === this.lfoControllerGeneration) {
        this.reportLfoError(error);
      }
      return;
    }
    if (!this.active || generation !== this.lfoControllerGeneration) {
      try {
        next.dispose();
      } catch {
        // A stale provisional controller has no current lifetime to report to.
      }
      return;
    }
    this.lfoController = next;
    const pendingRunning = this.pendingLfoRunning;
    this.pendingLfoRunning = undefined;
    if (pendingRunning !== undefined) {
      try {
        next.setRunning(pendingRunning);
      } catch (error) {
        if (this.active && this.lfoController === next) {
          this.reportLfoError(error);
        }
      }
    }
  }

  private teardownLfoController(): void {
    const controller = this.lfoController;
    this.lfoController = undefined;
    if (!controller) return;
    const errors: unknown[] = [];
    try {
      this.retainLfoState(controller.snapshot());
    } catch (error) {
      errors.push(error);
    }
    try {
      controller.dispose();
    } catch (error) {
      errors.push(error);
    }
    for (const error of errors) this.reportLfoError(error);
  }

  private replaceLfoHandle(
    next?: LfoHandle,
    expectedGeneration = this.lfoMountGeneration,
  ): boolean {
    const previous = this.lfoHandle;
    this.lfoHandle = undefined;
    previous?.destroy();
    if (expectedGeneration !== this.lfoMountGeneration) {
      next?.destroy();
      return false;
    }
    this.lfoHandle = next;
    return true;
  }

  // --- macros section ---

  private wireMacros(host: HTMLElement): void {
    this.macroHandle = mountMacroRack(
      host,
      this.macroList.map((macro, index) => ({
        snapshot: () => {
          const value = this.macroValues[index] ?? 0;
          return {
            label: macro.label ?? `MACRO ${index + 1}`,
            value,
            targets: macro.targets.map((item) => ({
              label: item.name ?? "param",
              value: item.min + value * (item.max - item.min),
              unit: item.unit,
            })),
          };
        },
        setValue: (value: number) => {
          this.macroValues[index] = clamp01(value);
          this.applyMacro(index, true);
        },
      })),
      {onError: (error) => this.reportLfoError(error)},
    );
  }

  private applyMacro(i: number, emit: boolean): void {
    const macro = this.macroList[i];
    if (!macro) return;
    const t = this.macroValues[i] ?? 0;
    for (const p of macro.targets) p.apply(p.min + t * (p.max - p.min));
    if (emit) {
      const detail: MacroDetail = {
        index: i,
        label: macro.label ?? `MACRO ${i + 1}`,
        value: t,
      };
      this.dispatchEvent(
        new CustomEvent("webscore:macro", {
          detail,
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private destroySharedHandles(): void {
    this.soundHandle?.destroy(); this.soundHandle = undefined;
    this.effectHandle?.destroy(); this.effectHandle = undefined;
    this.macroHandle?.destroy(); this.macroHandle = undefined;
  }
}

/** Register `<synth-panel>`. Call once in the browser. */
export function defineSynthPanelElement(tag = "synth-panel"): void {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, SynthPanelElement);
  }
}
