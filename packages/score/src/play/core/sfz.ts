// ============================================================================
// Minimal SFZ parser — enough of the format to drive `Sound.sfz`'s pitch-shifting
// sampler. Supports <global> / <group> / <region> headers with inherited opcodes,
// the common key/velocity-range and sample opcodes, and both numeric and note-name
// key values (e.g. `lokey=60` or `lokey=c4`).
// ============================================================================

export interface SfzRegion {
  sample?: string;
  lokey?: number;
  hikey?: number;
  pitch_keycenter?: number;
  lovel?: number;
  hivel?: number;
  tune?: number; // cents
  volume?: number; // dB
  default_path?: string;
}

/** One resolved key/velocity region consumed by any SFZ sampler. */
export interface SampleZone {
  sample: string;
  loKey: number;
  hiKey: number;
  rootKey: number;
  loVel: number;
  hiVel: number;
  tuneCents?: number;
  volume?: number;
}

/** Resource limits for parsing or resolving an SFZ from an untrusted source. */
export interface SfzParseOptions {
  /** Maximum source characters accepted by `parseSfz`. Default 1 MiB. */
  maxInputCharacters?: number;
  /** Maximum parsed regions / resolved zones. Default 512. */
  maxRegions?: number;
}

export const DEFAULT_SFZ_PARSE_LIMITS: Readonly<Required<SfzParseOptions>> = Object.freeze({
  maxInputCharacters: 1_000_000,
  maxRegions: 512,
});

const NOTE_TO_SEMITONE: Record<string, number> = {c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11};

/** Parse a key value: a MIDI number, or a note name like `c#4` / `Db3`. */
export function parseSfzKey(value: string): number | undefined {
  const v = value.trim();
  if (/^-?\d+$/.test(v)) return Number(v);
  const m = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(v);
  if (!m) return undefined;
  const [, letter, accidental, octave] = m;
  let semitone = NOTE_TO_SEMITONE[letter.toLowerCase()];
  if (accidental === '#') semitone += 1;
  else if (accidental === 'b') semitone -= 1;
  // SFZ convention: c4 = MIDI 60 → octave offset +1.
  return (Number(octave) + 1) * 12 + semitone;
}

/**
 * Parse SFZ text into flattened regions, each carrying its effective opcodes
 * after inheriting from any enclosing <global> / <group> blocks.
 */
export function parseSfz(text: string, options: SfzParseOptions = {}): SfzRegion[] {
  if (typeof text !== 'string') throw new TypeError('SFZ source must be a string');
  const limits = resolveSfzParseLimits(options);
  if (text.length > limits.maxInputCharacters) {
    throw new RangeError(
      `SFZ resource limit exceeded: source is ${text.length.toLocaleString()} characters (maxInputCharacters is ${limits.maxInputCharacters.toLocaleString()})`,
    );
  }
  // Strip comments, then split into a stream of `<header>` / `opcode=value` tokens.
  const cleaned = text.replace(/\/\/[^\n]*/g, ' ').replace(/\r/g, ' ');
  const tokens = cleaned.match(/<\w+>|[\w$]+=\S+/g) ?? [];

  const regions: SfzRegion[] = [];
  let global: SfzRegion = {};
  let group: SfzRegion = {};
  let current: SfzRegion | null = null;
  let scope: 'global' | 'group' | 'region' | null = null;

  const apply = (target: SfzRegion, key: string, raw: string) => {
    switch (key) {
      case 'sample':
        target.sample = raw.replace(/\\/g, '/');
        break;
      case 'default_path':
        target.default_path = raw.replace(/\\/g, '/');
        break;
      case 'lokey':
        target.lokey = parseSfzKey(raw);
        break;
      case 'hikey':
        target.hikey = parseSfzKey(raw);
        break;
      case 'key': {
        const k = parseSfzKey(raw);
        target.lokey = k;
        target.hikey = k;
        target.pitch_keycenter = k;
        break;
      }
      case 'pitch_keycenter':
        target.pitch_keycenter = parseSfzKey(raw);
        break;
      case 'lovel':
        target.lovel = Number(raw);
        break;
      case 'hivel':
        target.hivel = Number(raw);
        break;
      case 'tune':
      case 'pitch':
        target.tune = Number(raw);
        break;
      case 'volume':
        target.volume = Number(raw);
        break;
      default:
        break; // unsupported opcode — ignore
    }
  };

  const pushCurrentRegion = () => {
    if (!current) return;
    if (regions.length >= limits.maxRegions) {
      throw new RangeError(
        `SFZ resource limit exceeded: region count is greater than maxRegions (${limits.maxRegions.toLocaleString()})`,
      );
    }
    regions.push(current);
  };

  for (const token of tokens) {
    if (token.startsWith('<')) {
      if (scope === 'region') pushCurrentRegion();
      const header = token.slice(1, -1);
      if (header === 'global') {
        global = {};
        group = {};
        scope = 'global';
        current = null;
      } else if (header === 'group') {
        group = {};
        scope = 'group';
        current = null;
      } else if (header === 'region') {
        current = {...global, ...group};
        scope = 'region';
      } else {
        scope = null;
        current = null;
      }
      continue;
    }

    const eq = token.indexOf('=');
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    const target = scope === 'global' ? global : scope === 'group' ? group : current;
    if (target) apply(target, key, value);
  }
  if (scope === 'region') pushCurrentRegion();

  return regions;
}

/** Turn parsed regions into resolved, ready-to-load sample zones. */
export function resolveSfzZones(
  regions: SfzRegion[],
  sfzUrl: string,
  options: Pick<SfzParseOptions, 'maxRegions'> = {},
): SampleZone[] {
  const maxRegions = positiveSafeInteger(
    'maxRegions',
    options.maxRegions,
    DEFAULT_SFZ_PARSE_LIMITS.maxRegions,
  );
  if (regions.length > maxRegions) {
    throw new RangeError(
      `SFZ resource limit exceeded: ${regions.length.toLocaleString()} regions (maxRegions is ${maxRegions.toLocaleString()})`,
    );
  }
  const baseDir = sfzUrl.slice(0, sfzUrl.lastIndexOf('/') + 1);
  const zones: SampleZone[] = [];
  for (const r of regions) {
    if (!r.sample) continue;
    const root = r.pitch_keycenter ?? 60;
    const prefix = r.default_path ?? '';
    zones.push({
      sample: resolveUrl(baseDir, prefix + r.sample),
      loKey: r.lokey ?? 0,
      hiKey: r.hikey ?? 127,
      rootKey: root,
      loVel: r.lovel ?? 0,
      hiVel: r.hivel ?? 127,
      tuneCents: r.tune,
      volume: r.volume,
    });
  }
  return zones;
}

function resolveUrl(baseDir: string, path: string): string {
  if (/^(https?:)?\/\//.test(path) || path.startsWith('/')) return path;
  return baseDir + path;
}

function resolveSfzParseLimits(options: SfzParseOptions): Required<SfzParseOptions> {
  return {
    maxInputCharacters: positiveSafeInteger(
      'maxInputCharacters',
      options.maxInputCharacters,
      DEFAULT_SFZ_PARSE_LIMITS.maxInputCharacters,
    ),
    maxRegions: positiveSafeInteger('maxRegions', options.maxRegions, DEFAULT_SFZ_PARSE_LIMITS.maxRegions),
  };
}

function positiveSafeInteger(name: string, value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`SFZ option ${name} must be a positive safe integer`);
  }
  return value;
}
