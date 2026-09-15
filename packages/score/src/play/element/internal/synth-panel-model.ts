import { formatKnobNumber } from "./number-format";
import { lfoWave, type LfoShape, type LfoTarget } from "../../headless/lfo";
import {DEFAULT_EQ_BANDS, type EqBand} from "../../headless/eq";
import type {SynthPanelSection} from '../../headless/synth-panel-audio';

export { lfoWave };
export type { LfoShape, LfoTarget };

export interface SoundParam {
  name: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  options?: string[];
  group?: string;
  apply: (value: number) => void;
}

/**
 * The ADSR shape is the kit's, re-exported under the names `<synth-panel>`
 * publishes. Two verbatim redeclarations of one structural contract — and one
 * of them, `EnvelopeRanges`, already carried the kit's own name.
 */
export type {EnvelopeState as Envelope, EnvelopeRanges} from '@webmusic/ui/envelope';

export type {EqBand};

export interface MacroTarget {
  name?: string;
  min: number;
  max: number;
  unit?: string;
  apply: (value: number) => void;
}

export interface SynthMacro {
  label?: string;
  value?: number;
  targets: MacroTarget[];
}

export interface MacroDetail {
  index: number;
  label: string;
  value: number;
}

export type {SynthPanelSection};
export const ALL_SECTIONS: readonly SynthPanelSection[] = [
  "sound",
  "effects",
  "envelope",
  "eq",
  "lfo",
  "macros",
];
export const DEFAULT_SECTIONS: readonly SynthPanelSection[] = [
  "sound",
  "effects",
];
export { PARAM_RANGE, PARAM_UNIT } from "./effect-params";
export const DEFAULT_BANDS: readonly EqBand[] = [
  ...DEFAULT_EQ_BANDS,
];

export function parseSections(
  raw: string | null | undefined,
): SynthPanelSection[] {
  if (raw == null || raw.trim() === "") return [...DEFAULT_SECTIONS];
  const out: SynthPanelSection[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim().toLowerCase() as SynthPanelSection;
    if (
      (ALL_SECTIONS as readonly string[]).includes(name) &&
      !out.includes(name)
    )
      out.push(name);
  }
  return out.length > 0 ? out : [...DEFAULT_SECTIONS];
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function formatValue(value: number, unit?: string): string {
  const formatted = formatKnobNumber(value);
  return unit ? `${formatted} ${unit}` : formatted;
}
