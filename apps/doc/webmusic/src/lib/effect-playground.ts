import {Effect, DEFAULT_EQ_BANDS} from '@webmusic/score/play/headless';

export type PlaygroundEffectKind =
  | 'reverb'
  | 'equalizer'
  | 'filter'
  | 'delay'
  | 'chorus'
  | 'compressor'
  | 'distortion';

export type PlaygroundEffectValue = number | string;

interface EffectFieldBase {
  readonly key: string;
  readonly label: string;
  readonly group?: string;
  readonly note: string;
}

export interface EffectNumberField extends EffectFieldBase {
  readonly kind: 'number';
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
}

export interface EffectEnumField extends EffectFieldBase {
  readonly kind: 'enum';
  readonly defaultValue: string;
  readonly options: readonly string[];
}

export type EffectFieldSpec = EffectNumberField | EffectEnumField;

export interface PlaygroundEffectDefinition {
  readonly kind: PlaygroundEffectKind;
  readonly label: string;
  readonly factoryLabel: string;
  readonly description: string;
  readonly fields: readonly EffectFieldSpec[];
}

export interface PlaygroundEffectItem {
  readonly key: string;
  readonly kind: PlaygroundEffectKind;
  readonly values: Record<string, PlaygroundEffectValue>;
}

const eqLow = DEFAULT_EQ_BANDS[0] ?? {frequency: 120, gain: 0, q: 0.8};
const eqMid = DEFAULT_EQ_BANDS[1] ?? {frequency: 1_000, gain: 0, q: 0.9};
const eqHigh = DEFAULT_EQ_BANDS[2] ?? {frequency: 6_000, gain: 0, q: 0.9};

export const EFFECT_DEFINITIONS: readonly PlaygroundEffectDefinition[] = [
  {
    kind: 'reverb',
    label: 'Reverb',
    factoryLabel: 'Effect.reverb',
    description: 'A synthetic room impulse with separate dry and reflected levels.',
    fields: [
      {key: 'seconds', label: 'room time', group: 'Room', kind: 'number', defaultValue: 1.8, min: 0.1, max: 8, step: 0.1, unit: 's', note: 'Length of the generated room impulse.'},
      {key: 'decay', label: 'decay', group: 'Room', kind: 'number', defaultValue: 2.2, min: 0.1, max: 8, step: 0.1, note: 'How quickly reflections fade through the impulse.'},
      {key: 'wet', label: 'wet', group: 'Mix', kind: 'number', defaultValue: 0.28, min: 0, max: 1, step: 0.01, note: 'Reflected signal level.'},
      {key: 'dry', label: 'dry', group: 'Mix', kind: 'number', defaultValue: 0.82, min: 0, max: 1, step: 0.01, note: 'Unprocessed signal level.'},
    ],
  },
  {
    kind: 'equalizer',
    label: '3-band equalizer',
    factoryLabel: 'Effect.chain',
    description: 'Three peaking filters for low, mid and high tonal shaping.',
    fields: [
      {key: 'low.frequency', label: 'frequency', group: 'Low', kind: 'number', defaultValue: eqLow.frequency, min: 30, max: 500, step: 1, unit: 'Hz', note: 'Low-band centre frequency.'},
      {key: 'low.gain', label: 'gain', group: 'Low', kind: 'number', defaultValue: eqLow.gain ?? 0, min: -18, max: 18, step: 0.5, unit: 'dB', note: 'Low-band boost or cut.'},
      {key: 'low.Q', label: 'Q', group: 'Low', kind: 'number', defaultValue: eqLow.q ?? 0.8, min: 0.1, max: 20, step: 0.1, note: 'Low-band width.'},
      {key: 'mid.frequency', label: 'frequency', group: 'Mid', kind: 'number', defaultValue: eqMid.frequency, min: 200, max: 5_000, step: 1, unit: 'Hz', note: 'Mid-band centre frequency.'},
      {key: 'mid.gain', label: 'gain', group: 'Mid', kind: 'number', defaultValue: eqMid.gain ?? 0, min: -18, max: 18, step: 0.5, unit: 'dB', note: 'Mid-band boost or cut.'},
      {key: 'mid.Q', label: 'Q', group: 'Mid', kind: 'number', defaultValue: eqMid.q ?? 0.9, min: 0.1, max: 20, step: 0.1, note: 'Mid-band width.'},
      {key: 'high.frequency', label: 'frequency', group: 'High', kind: 'number', defaultValue: eqHigh.frequency, min: 2_000, max: 18_000, step: 1, unit: 'Hz', note: 'High-band centre frequency.'},
      {key: 'high.gain', label: 'gain', group: 'High', kind: 'number', defaultValue: eqHigh.gain ?? 0, min: -18, max: 18, step: 0.5, unit: 'dB', note: 'High-band boost or cut.'},
      {key: 'high.Q', label: 'Q', group: 'High', kind: 'number', defaultValue: eqHigh.q ?? 0.9, min: 0.1, max: 20, step: 0.1, note: 'High-band width.'},
    ],
  },
  {
    kind: 'filter',
    label: 'Filter',
    factoryLabel: 'Effect.filter',
    description: 'One configurable Web Audio biquad filter.',
    fields: [
      {key: 'type', label: 'type', kind: 'enum', defaultValue: 'lowpass', options: ['lowpass', 'highpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf'], note: 'Biquad response shape.'},
      {key: 'frequency', label: 'frequency', kind: 'number', defaultValue: 1_000, min: 20, max: 20_000, step: 1, unit: 'Hz', note: 'Cutoff or centre frequency.'},
      {key: 'Q', label: 'Q', kind: 'number', defaultValue: 1, min: 0.1, max: 20, step: 0.1, note: 'Resonance or filter width.'},
      {key: 'gain', label: 'gain', kind: 'number', defaultValue: 0, min: -24, max: 24, step: 0.5, unit: 'dB', note: 'Gain for peaking and shelf filters.'},
    ],
  },
  {
    kind: 'delay',
    label: 'Delay',
    factoryLabel: 'Effect.delay',
    description: 'A feedback echo with independent wet and dry levels.',
    fields: [
      {key: 'delaySeconds', label: 'time', kind: 'number', defaultValue: 0.25, min: 0, max: 2, step: 0.01, unit: 's', note: 'Time between the dry sound and each echo.'},
      {key: 'feedback', label: 'feedback', kind: 'number', defaultValue: 0.3, min: 0, max: 0.95, step: 0.01, note: 'Amount of each echo fed into the next.'},
      {key: 'wet', label: 'wet', kind: 'number', defaultValue: 0.3, min: 0, max: 1, step: 0.01, note: 'Echo level.'},
      {key: 'dry', label: 'dry', kind: 'number', defaultValue: 1, min: 0, max: 1, step: 0.01, note: 'Unprocessed signal level.'},
    ],
  },
  {
    kind: 'chorus',
    label: 'Chorus',
    factoryLabel: 'Effect.chorus',
    description: 'A short modulated delay that adds width and movement.',
    fields: [
      {key: 'delaySeconds', label: 'delay', kind: 'number', defaultValue: 0.025, min: 0.001, max: 0.1, step: 0.001, unit: 's', note: 'Base delay of the doubled voice.'},
      {key: 'depth', label: 'depth', kind: 'number', defaultValue: 0.005, min: 0, max: 0.05, step: 0.001, unit: 's', note: 'Delay modulation depth.'},
      {key: 'frequency', label: 'rate', kind: 'number', defaultValue: 0.8, min: 0.1, max: 12, step: 0.1, unit: 'Hz', note: 'Modulation oscillator rate.'},
      {key: 'wet', label: 'wet', kind: 'number', defaultValue: 0.5, min: 0, max: 1, step: 0.01, note: 'Modulated signal level.'},
    ],
  },
  {
    kind: 'compressor',
    label: 'Compressor',
    factoryLabel: 'Effect.compressor',
    description: 'Dynamic-range control using the Web Audio compressor.',
    fields: [
      {key: 'threshold', label: 'threshold', kind: 'number', defaultValue: -24, min: -100, max: 0, step: 1, unit: 'dB', note: 'Level above which compression begins.'},
      {key: 'knee', label: 'knee', kind: 'number', defaultValue: 30, min: 0, max: 40, step: 1, unit: 'dB', note: 'Width of the transition into compression.'},
      {key: 'ratio', label: 'ratio', kind: 'number', defaultValue: 12, min: 1, max: 20, step: 0.5, note: 'Input-to-output reduction above the threshold.'},
      {key: 'attack', label: 'attack', kind: 'number', defaultValue: 0.003, min: 0, max: 1, step: 0.001, unit: 's', note: 'How quickly gain reduction starts.'},
      {key: 'release', label: 'release', kind: 'number', defaultValue: 0.25, min: 0, max: 1, step: 0.01, unit: 's', note: 'How quickly gain reduction releases.'},
    ],
  },
  {
    kind: 'distortion',
    label: 'Distortion',
    factoryLabel: 'Effect.distortion',
    description: 'A waveshaper from subtle saturation to a harder curve.',
    fields: [
      {key: 'amount', label: 'amount', kind: 'number', defaultValue: 0.4, min: 0, max: 1, step: 0.01, note: 'Strength of the waveshaping curve.'},
      {key: 'oversample', label: 'oversample', kind: 'enum', defaultValue: '2x', options: ['none', '2x', '4x'], note: 'Waveshaper oversampling quality.'},
    ],
  },
] as const;

const definitions = new Map(EFFECT_DEFINITIONS.map((definition) => [definition.kind, definition]));

export function effectDefinition(kind: string): PlaygroundEffectDefinition | undefined {
  return definitions.get(kind as PlaygroundEffectKind);
}

export function createEffectItem(kind: PlaygroundEffectKind, key: string): PlaygroundEffectItem {
  const definition = effectDefinition(kind);
  if (!definition) throw new Error(`Unknown playground effect: ${kind}`);
  return {
    key,
    kind,
    values: Object.fromEntries(
      definition.fields.map((field) => [field.key, field.defaultValue]),
    ),
  };
}

export function normalizeEffectValue(
  definition: PlaygroundEffectDefinition,
  fieldKey: string,
  raw: string,
): PlaygroundEffectValue | undefined {
  const field = definition.fields.find((candidate) => candidate.key === fieldKey);
  if (!field) return undefined;
  if (field.kind === 'enum') {
    return field.options.includes(raw) ? raw : field.defaultValue;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(field.min, Math.min(field.max, value));
}

function numeric(item: PlaygroundEffectItem, key: string): number {
  const definition = effectDefinition(item.kind);
  const field = definition?.fields.find((candidate) => candidate.key === key);
  const fallback = field?.kind === 'number' ? field.defaultValue : 0;
  const value = item.values[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function text(item: PlaygroundEffectItem, key: string): string {
  const definition = effectDefinition(item.kind);
  const field = definition?.fields.find((candidate) => candidate.key === key);
  const fallback = field?.kind === 'enum' ? field.defaultValue : '';
  const value = item.values[key];
  return typeof value === 'string' ? value : fallback;
}

function effectsFor(item: PlaygroundEffectItem): Effect[] {
  switch (item.kind) {
    case 'reverb':
      return [Effect.reverb({
        seconds: numeric(item, 'seconds'),
        decay: numeric(item, 'decay'),
        wet: numeric(item, 'wet'),
        dry: numeric(item, 'dry'),
      })];
    case 'equalizer':
      return ['low', 'mid', 'high'].map((band) => Effect.filter({
        type: 'peaking',
        frequency: numeric(item, `${band}.frequency`),
        gain: numeric(item, `${band}.gain`),
        Q: numeric(item, `${band}.Q`),
      }));
    case 'filter':
      return [Effect.filter({
        type: text(item, 'type') as BiquadFilterType,
        frequency: numeric(item, 'frequency'),
        Q: numeric(item, 'Q'),
        gain: numeric(item, 'gain'),
      })];
    case 'delay':
      return [Effect.delay({
        delaySeconds: numeric(item, 'delaySeconds'),
        feedback: numeric(item, 'feedback'),
        wet: numeric(item, 'wet'),
        dry: numeric(item, 'dry'),
      })];
    case 'chorus':
      return [Effect.chorus({
        delaySeconds: numeric(item, 'delaySeconds'),
        depth: numeric(item, 'depth'),
        frequency: numeric(item, 'frequency'),
        wet: numeric(item, 'wet'),
      })];
    case 'compressor':
      return [Effect.compressor({
        threshold: numeric(item, 'threshold'),
        knee: numeric(item, 'knee'),
        ratio: numeric(item, 'ratio'),
        attack: numeric(item, 'attack'),
        release: numeric(item, 'release'),
      })];
    case 'distortion':
      return [Effect.distortion({
        amount: numeric(item, 'amount'),
        oversample: text(item, 'oversample') as OverSampleType,
      })];
  }
}

/** Build the individual effects in their visible editor order. */
export function buildPlaygroundEffects(items: readonly PlaygroundEffectItem[]): Effect[] {
  return items.flatMap(effectsFor);
}

/** Build one chain for targets whose public surface is the singular `.effect`. */
export function buildPlaygroundEffect(items: readonly PlaygroundEffectItem[]): Effect | undefined {
  const effects = buildPlaygroundEffects(items);
  return effects.length === 0 ? undefined : Effect.chain(...effects);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function effectSummary(item: PlaygroundEffectItem): string {
  switch (item.kind) {
    case 'reverb':
      return `${Math.round(numeric(item, 'wet') * 100)}% wet · ${numeric(item, 'seconds')} s`;
    case 'equalizer':
      return `${signed(numeric(item, 'low.gain'))} / ${signed(numeric(item, 'mid.gain'))} / ${signed(numeric(item, 'high.gain'))} dB`;
    case 'filter':
      return `${text(item, 'type')} · ${numeric(item, 'frequency')} Hz`;
    case 'delay':
      return `${numeric(item, 'delaySeconds')} s · ${Math.round(numeric(item, 'wet') * 100)}% wet`;
    case 'chorus':
      return `${numeric(item, 'frequency')} Hz · ${Math.round(numeric(item, 'wet') * 100)}% wet`;
    case 'compressor':
      return `${numeric(item, 'threshold')} dB · ${numeric(item, 'ratio')}:1`;
    case 'distortion':
      return `${Math.round(numeric(item, 'amount') * 100)}% · ${text(item, 'oversample')}`;
  }
}

function literal(value: PlaygroundEffectValue): string {
  if (typeof value === 'number') return Object.is(value, -0) ? '0' : String(value);
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function options(entries: ReadonlyArray<readonly [string, PlaygroundEffectValue]>): string {
  return `{${entries.map(([key, value]) => `${key}: ${literal(value)}`).join(', ')}}`;
}

function expressionsFor(item: PlaygroundEffectItem): string[] {
  switch (item.kind) {
    case 'reverb':
      return [`Effect.reverb(${options([
        ['seconds', numeric(item, 'seconds')],
        ['decay', numeric(item, 'decay')],
        ['wet', numeric(item, 'wet')],
        ['dry', numeric(item, 'dry')],
      ])})`];
    case 'equalizer':
      return ['low', 'mid', 'high'].map((band) => `Effect.filter(${options([
        ['type', 'peaking'],
        ['frequency', numeric(item, `${band}.frequency`)],
        ['gain', numeric(item, `${band}.gain`)],
        ['Q', numeric(item, `${band}.Q`)],
      ])})`);
    case 'filter':
      return [`Effect.filter(${options([
        ['type', text(item, 'type')],
        ['frequency', numeric(item, 'frequency')],
        ['Q', numeric(item, 'Q')],
        ['gain', numeric(item, 'gain')],
      ])})`];
    case 'delay':
      return [`Effect.delay(${options([
        ['delaySeconds', numeric(item, 'delaySeconds')],
        ['feedback', numeric(item, 'feedback')],
        ['wet', numeric(item, 'wet')],
        ['dry', numeric(item, 'dry')],
      ])})`];
    case 'chorus':
      return [`Effect.chorus(${options([
        ['delaySeconds', numeric(item, 'delaySeconds')],
        ['depth', numeric(item, 'depth')],
        ['frequency', numeric(item, 'frequency')],
        ['wet', numeric(item, 'wet')],
      ])})`];
    case 'compressor':
      return [`Effect.compressor(${options([
        ['threshold', numeric(item, 'threshold')],
        ['knee', numeric(item, 'knee')],
        ['ratio', numeric(item, 'ratio')],
        ['attack', numeric(item, 'attack')],
        ['release', numeric(item, 'release')],
      ])})`];
    case 'distortion':
      return [`Effect.distortion(${options([
        ['amount', numeric(item, 'amount')],
        ['oversample', text(item, 'oversample')],
      ])})`];
  }
}

export interface EffectSetupCodeOptions {
  /** Public selector used in the copyable JavaScript example. */
  selector?: string;
  /** Local binding used in the copyable JavaScript example. */
  identifier?: string;
  /** Public property receiving the result. Defaults to the singular chain API. */
  assignment?: 'effect' | 'effects';
}

export function effectSetupCode(
  items: readonly PlaygroundEffectItem[],
  options: EffectSetupCodeOptions = {},
): string {
  const expressions = items.flatMap(expressionsFor);
  if (expressions.length === 0) return '';
  const selector = options.selector ?? 'score-player';
  const identifier = /^[A-Za-z_$][\w$]*$/.test(options.identifier ?? '')
    ? options.identifier!
    : 'target';
  const assignment = options.assignment === 'effects' ? 'effects' : 'effect';
  const value = assignment === 'effects'
    ? [
      `${identifier}.effects = [`,
      ...expressions.map((expression) => `  ${expression},`),
      '];',
    ]
    : [
      `${identifier}.effect = Effect.chain(`,
      ...expressions.map((expression) => `  ${expression},`),
      ');',
    ];
  return [
    "import {Effect} from '@webmusic/score/play/headless';",
    '',
    `const ${identifier} = document.querySelector(${literal(selector)});`,
    ...value,
  ].join('\n');
}
