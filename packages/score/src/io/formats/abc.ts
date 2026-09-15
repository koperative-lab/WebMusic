import { abcToScientificNotation, scientificToAbcNotation } from '@tonaljs/abc-notation';
import {
  Duration,
  MeasureId,
  PartId,
  Pitch,
  Rational,
  Score,
  ScoreBuilder,
  VoiceId,
  midiToPitch,
  scoreKeySignatures,
  scoreTimeSignatures,
  scoreTitle,
  type Alter,
  type Step,
} from '../../core';
import type { ScoreDiagnostic, ScoreParseResult, ScoreSerializeResult } from '../diagnostics';

/** Resource limits applied while parsing untrusted ABC input. */
export interface ABCParseLimits {
  /** Maximum UTF-8 source size accepted by the parser. */
  maxInputBytes: number;
  /** Maximum number of note/rest tokens accepted from the tune body. */
  maxTokens: number;
  /** Maximum number of measures the parser may materialize. */
  maxMeasures: number;
  /** Maximum duration of one note/rest in quarter notes. */
  maxDurationQuarters: number;
}

/** Optional overrides for {@link DEFAULT_ABC_PARSE_LIMITS}. */
export type ABCParseOptions = Partial<ABCParseLimits>;

/**
 * Conservative defaults for browser-side parsing of untrusted ABC files.
 * Consumers importing unusually large, trusted scores can raise these limits
 * explicitly through {@link parseABC} or `loadScore({abc: ...})`.
 */
export const DEFAULT_ABC_PARSE_LIMITS: Readonly<ABCParseLimits> = Object.freeze({
  maxInputBytes: 1_000_000,
  maxTokens: 100_000,
  maxMeasures: 4_096,
  maxDurationQuarters: 256,
});

/** Thrown when ABC parsing stops before allocating excessive work or memory. */
export class ABCParseLimitError extends Error {
  readonly code = 'abc-parse-limit';

  constructor(message: string) {
    super(message);
    this.name = 'ABCParseLimitError';
  }
}

/** Resolve and validate optional ABC resource-limit overrides. */
export function resolveABCParseLimits(options: ABCParseOptions = {}): ABCParseLimits {
  return {
    maxInputBytes: resolvePositiveIntegerLimit(
      'maxInputBytes',
      options.maxInputBytes,
      DEFAULT_ABC_PARSE_LIMITS.maxInputBytes,
    ),
    maxTokens: resolvePositiveIntegerLimit('maxTokens', options.maxTokens, DEFAULT_ABC_PARSE_LIMITS.maxTokens),
    maxMeasures: resolvePositiveIntegerLimit('maxMeasures', options.maxMeasures, DEFAULT_ABC_PARSE_LIMITS.maxMeasures),
    maxDurationQuarters: resolvePositiveNumberLimit(
      'maxDurationQuarters',
      options.maxDurationQuarters,
      DEFAULT_ABC_PARSE_LIMITS.maxDurationQuarters,
    ),
  };
}

/** Assert a byte count before decoding a binary ABC payload into a string. */
export function assertABCInputByteLength(byteLength: number, limits: ABCParseLimits): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new TypeError('ABC input byte length must be a non-negative safe integer');
  }
  if (byteLength > limits.maxInputBytes) {
    throw new ABCParseLimitError(
      `ABC resource limit exceeded: input is ${byteLength.toLocaleString()} bytes (maxInputBytes is ${limits.maxInputBytes.toLocaleString()})`,
    );
  }
}

/**
 * Parse minimal ABC notation. Supports only single-voice tunes with header
 * fields T:, M:, L: and simple note tokens. An omitted L follows ABC's
 * meter-dependent default (1/8, or 1/16 for meters below 3/4). Resource
 * limits protect callers that accept ABC directly from untrusted sources.
 */
export function parseABC(abc: string, options: ABCParseOptions = {}): Score {
  return parseABCDetailed(abc, options).score;
}

/**
 * Parse the supported ABC subset and report source features that the compact
 * normalised model/parser does not currently preserve.
 */
export function parseABCDetailed(abc: string, options: ABCParseOptions = {}): ScoreParseResult {
  if (typeof abc !== 'string') throw new TypeError('ABC input must be a string');
  const limits = resolveABCParseLimits(options);
  assertABCInputByteLength(utf8ByteLengthAtMost(abc, limits.maxInputBytes), limits);

  const lines = abc.split(/\r?\n/);
  const diagnostics = new AbcDiagnosticCollector();
  diagnostics.inspectHeaders(lines);
  const title = lines
    .find((l) => l.startsWith('T:'))
    ?.slice(2)
    .trim();
  const [numerator, denominator] = parseAbcFraction(
    lines
      .find((l) => l.startsWith('M:'))
      ?.slice(2)
      .trim(),
    'meter',
    [4, 4],
  );
  const [uNum, uDen] = parseAbcFraction(
    lines
      .find((l) => l.startsWith('L:'))
      ?.slice(2)
      .trim(),
    'unit length',
    numerator / denominator < 0.75 ? [1, 16] : [1, 8],
  );
  const unitQuarters = new Rational(uNum * 4, uDen);

  // ABC information fields are not musical tokens. In particular, lower-case
  // `w:` lyric lines and `%` comments may contain C–G letters; feeding them to
  // the compact note regex would silently manufacture notes. Inspect the
  // source before stripping unsupported syntax so detailed callers still learn
  // what was normalised, then tokenize only playable content.
  const sourceBody = diagnostics.extractPlayableSource(lines);
  diagnostics.inspectBody(sourceBody);
  const body = stripUnsupportedNotationGroups(sourceBody);
  const builder = new ScoreBuilder();
  builder.setMetadata({ title });
  builder.addMeter({
    atQuarters: Rational.ZERO,
    measureNumber: 1,
    timeSignature: { numerator: numerator || 4, denominator: denominator || 4 },
  });
  const partId = PartId('abc');
  builder.addPart({ id: partId, name: 'ABC' });
  const voice = VoiceId(`${partId}-v1`);

  let cursor = Rational.ZERO;
  // ABC length suffixes have a compact shorthand in addition to `n/d`:
  // `/` halves the unit, `//` quarters it, and a leading multiplier still
  // applies (`C3/` = 3/2 units, `C3//` = 3/4 units). Keep the slash run and
  // optional explicit divisor separate so all of those forms are interpreted
  // before the cursor advances.
  const tokenRe = /([_=^]*)([A-Ga-gz])([',]*)(\d+)?(\/+)?(\d+)?/g;
  let tokenCount = 0;
  let previousTokenEnd = 0;
  const barAccidentals = new Map<string, string>();
  for (const match of body.matchAll(tokenRe)) {
    const [, accidentals, letter, octaveMarks, mult, slashes, divisor] = match;
    if (body.slice(previousTokenEnd, match.index).includes('|')) barAccidentals.clear();
    previousTokenEnd = match.index! + match[0].length;
    tokenCount += 1;
    if (tokenCount > limits.maxTokens) {
      throw new ABCParseLimitError(
        `ABC resource limit exceeded: token count is greater than maxTokens (${limits.maxTokens.toLocaleString()})`,
      );
    }
    const dur = unitQuarters.mul(parseAbcLength(mult, slashes, divisor));
    const durationQuarters = dur.toFloat();
    if (!Number.isFinite(durationQuarters) || durationQuarters <= 0) {
      throw new Error('Invalid ABC duration');
    }
    if (durationQuarters > limits.maxDurationQuarters) {
      throw new ABCParseLimitError(
        `ABC resource limit exceeded: note duration is ${durationQuarters} quarter notes (maxDurationQuarters is ${limits.maxDurationQuarters})`,
      );
    }

    if (letter.toLowerCase() === 'z') {
      builder.addNote(partId, {
        id: builder.newNoteId(),
        rest: true,
        onsetQuarters: cursor,
        duration: new Duration({ base: dur }),
        voice,
      });
    } else {
      // ABC's default accidental propagation applies to the same letter in
      // every octave until a barline or a replacement accidental.
      const pitchLetter = letter.toUpperCase();
      if (accidentals) barAccidentals.set(pitchLetter, accidentals);
      builder.addNote(partId, {
        id: builder.newNoteId(),
        pitch: abcLetterToPitch(accidentals || barAccidentals.get(pitchLetter) || '', letter, octaveMarks),
        onsetQuarters: cursor,
        duration: new Duration({ base: dur }),
        voice,
      });
    }
    cursor = cursor.add(dur);
  }

  const measureLength = new Rational(4 * numerator, denominator);
  const totalMeasures = Math.max(1, Math.ceil(cursor.div(measureLength).toFloat()));
  if (!Number.isSafeInteger(totalMeasures) || totalMeasures > limits.maxMeasures) {
    throw new ABCParseLimitError(
      `ABC resource limit exceeded: score would create ${Number.isFinite(totalMeasures) ? totalMeasures.toLocaleString() : 'too many'} measures (maxMeasures is ${limits.maxMeasures.toLocaleString()})`,
    );
  }
  for (let i = 0; i < totalMeasures; i++) {
    builder.addMeasure({
      id: MeasureId(`m${i + 1}`),
      number: i + 1,
      onsetQuarters: measureLength.mul(new Rational(i, 1)),
      durationQuarters: measureLength,
    });
  }

  return { score: builder.build(), diagnostics: diagnostics.toArray() };
}

/** Bounded, feature-level ABC diagnostics: never one warning per note token. */
class AbcDiagnosticCollector {
  private static readonly maximumEntries = 100;
  private readonly entries: ScoreDiagnostic[] = [];
  private readonly codes = new Set<string>();
  private truncated = false;

  inspectHeaders(lines: readonly string[]): void {
    const key = lines
      .filter((line) => line.startsWith('K:'))
      .map((line) => line.slice(2).trim())
      .find((value) => value && value.toLowerCase() !== 'c');
    if (key) {
      this.warn(
        'abc-key-signature-ignored',
        `ABC key header K:${key} is not currently mapped into the Score key-signature timeline`,
      );
    }
    const tempo = lines
      .find((line) => line.startsWith('Q:'))
      ?.slice(2)
      .trim();
    if (tempo) {
      this.warn(
        'abc-tempo-ignored',
        `ABC tempo header Q:${tempo} is not currently mapped into the Score tempo timeline`,
      );
    }
    if (lines.some((line) => line.startsWith('V:'))) {
      this.warn(
        'abc-voices-ignored',
        'ABC voice declarations are not currently preserved; the parser normalises the tune into one Part/voice stream',
      );
    }
  }

  /**
   * Remove non-musical ABC lines before the simple note tokenizer sees them.
   * This parser intentionally supports a small subset, but unsupported source
   * material must be skipped rather than reinterpreted as pitches.
   */
  extractPlayableSource(lines: readonly string[]): string {
    const body: string[] = [];
    for (const line of lines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('%%')) {
        this.warn('abc-directives-ignored', 'ABC %% directives are not currently preserved by the compact parser');
        continue;
      }
      if (trimmed.startsWith('%')) {
        this.warn('abc-comments-ignored', 'ABC comments are ignored by the compact parser');
        continue;
      }

      const field = /^([A-Za-z+]):/.exec(trimmed);
      if (field) {
        const name = field[1];
        if (name === 'w' || name === 'W') {
          this.warn(
            'abc-lyrics-ignored',
            'ABC lyric fields are not currently mapped into Score lyrics and are skipped',
          );
        } else if (name === '+') {
          this.warn(
            'abc-field-continuations-ignored',
            'ABC field-continuation lines are not currently preserved and are skipped',
          );
        } else if (!SUPPORTED_ABC_FIELDS.has(name) && name !== 'Q' && name !== 'V') {
          this.warn(
            'abc-header-fields-ignored',
            'Unsupported ABC information fields are skipped rather than parsed as note tokens',
          );
        }
        continue;
      }

      const commentAt = line.indexOf('%');
      if (commentAt >= 0) {
        this.warn('abc-comments-ignored', 'ABC comments are ignored by the compact parser');
        body.push(line.slice(0, commentAt));
      } else {
        body.push(line);
      }
    }
    return body.join(' ');
  }

  inspectBody(body: string): void {
    if (/\|:|:\|/.test(body)) {
      this.warn('abc-repeats-ignored', 'ABC repeat barlines are not currently mapped into Score repeat metadata');
    }
    if (/\(\d/.test(body)) {
      this.warn('abc-tuplets-ignored', 'ABC tuplet syntax is not currently mapped into Score tuplet metadata');
    }
    if (body.includes('[') || body.includes(']')) {
      this.warn('abc-chords-or-inline-fields-ignored', 'ABC chord or inline-field syntax is not currently preserved');
    }
    if (/[<>]/.test(body)) {
      this.warn('abc-broken-rhythm-ignored', 'ABC broken-rhythm syntax is not currently preserved');
    }
    if (/[{}]/.test(body)) {
      this.warn('abc-grace-notes-ignored', 'ABC grace-note groups are not currently preserved');
    }
    if (body.includes('&')) {
      this.warn('abc-overlay-ignored', 'ABC overlay syntax is not currently preserved');
    }
    if (body.includes('"')) {
      this.warn(
        'abc-quoted-annotations-ignored',
        'ABC quoted annotations (including chord symbols) are skipped rather than tokenized as notes',
      );
    }
    if (/![^!]*!|\+[^+]*\+/.test(body)) {
      this.warn(
        'abc-decorations-ignored',
        'ABC decoration text is skipped rather than tokenized as notes',
      );
    }
  }

  toArray(): readonly ScoreDiagnostic[] {
    return Object.freeze([...this.entries]);
  }

  private warn(code: string, message: string): void {
    if (this.codes.has(code)) return;
    this.codes.add(code);
    if (this.entries.length >= AbcDiagnosticCollector.maximumEntries) {
      if (!this.truncated) {
        this.entries.push({
          code: 'diagnostics-truncated',
          severity: 'warning',
          format: 'abc',
          message: `Suppressed additional ABC diagnostic families (maximum ${AbcDiagnosticCollector.maximumEntries})`,
        });
        this.truncated = true;
      }
      return;
    }
    this.entries.push({ code, severity: 'warning', format: 'abc', message });
  }
}

/** Information fields the minimal parser reads deliberately. */
const SUPPORTED_ABC_FIELDS = new Set(['X', 'T', 'M', 'L', 'K']);

/** Opaque ABC notation groups that must not expose their interior to note lexing. */
const IGNORED_ABC_GROUPS: Readonly<Record<string, {closing: string; supportsEscapes?: boolean}>> = Object.freeze({
  '"': {closing: '"', supportsEscapes: true},
  '[': {closing: ']'},
  '{': {closing: '}'},
  '!': {closing: '!'},
  '+': {closing: '+'},
});

/**
 * Remove unsupported, delimited ABC syntax with a stateful scanner. This is
 * intentionally fail-closed: an unmatched opener consumes the remaining body
 * rather than exposing annotation/grace/decorative letters to the note regex.
 */
function stripUnsupportedNotationGroups(source: string): string {
  let output = '';
  for (let index = 0; index < source.length; index += 1) {
    // A thick barline is not the opening of an opaque chord/inline field.
    if (source[index] === '[' && source[index + 1] === '|') {
      output += '|';
      index += 1;
      continue;
    }
    const group = IGNORED_ABC_GROUPS[source[index]];
    if (!group) {
      output += source[index];
      continue;
    }

    output += ' ';
    index += 1;
    while (index < source.length) {
      if (group.supportsEscapes && source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === group.closing) break;
      index += 1;
    }
  }
  return output;
}

function resolvePositiveIntegerLimit(name: keyof ABCParseLimits, value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`ABC parse option ${name} must be a positive safe integer`);
  }
  return value;
}

function resolvePositiveNumberLimit(name: keyof ABCParseLimits, value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`ABC parse option ${name} must be a positive finite number`);
  }
  return value;
}

function parseAbcFraction(value: string | undefined, label: string, fallback: [number, number]): [number, number] {
  if (value == null || value === '') return fallback;
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid ABC ${label} "${value}" (expected numerator/denominator)`);
  return [
    parsePositiveAbcInteger(match[1], `${label} numerator`),
    parsePositiveAbcInteger(match[2], `${label} denominator`),
  ];
}

function parsePositiveAbcInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ABC ${label} "${value}" (expected a positive safe integer)`);
  }
  return parsed;
}

/**
 * Parse the common ABC note-length forms after a pitch/rest token.
 *
 * `C2` is two unit lengths, `C/` is one half, `C//` one quarter,
 * `C3/` three halves, and `C3/2` three halves. An explicit divisor after
 * more than one slash is accepted as successive halving too (`C//2` = 1/4)
 * rather than leaving a partial suffix silently unconsumed.
 */
function parseAbcLength(
  multiplier: string | undefined,
  slashes: string | undefined,
  explicitDivisor: string | undefined,
): Rational {
  const numerator = parsePositiveAbcInteger(multiplier ?? '1', 'duration multiplier');
  if (!slashes) return new Rational(numerator, 1);

  const divisor = parsePositiveAbcInteger(explicitDivisor ?? '1', 'duration denominator');
  // A bare slash denotes /2. When a numerical denominator is present, the
  // first slash introduces it (`/3` = /3); every additional slash halves the
  // result once more. This covers the standard short forms and avoids
  // accepting a matched slash run while accidentally ignoring its tail.
  const halvings = slashes.length - (explicitDivisor === undefined ? 0 : 1);
  if (halvings > 52) {
    throw new Error('Invalid ABC duration: too many slash divisions');
  }
  const slashDivisor = 2 ** halvings;
  const denominator = divisor * slashDivisor;
  if (!Number.isSafeInteger(denominator)) {
    throw new Error('Invalid ABC duration: denominator exceeds safe integer range');
  }
  return new Rational(numerator, denominator);
}

/** Count UTF-8 bytes without allocating a second large buffer; stop after limit. */
function utf8ByteLengthAtMost(value: string, limit: number): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
    if (bytes > limit) return bytes;
  }
  return bytes;
}

/**
 * Serialize a Score into minimal, single-voice ABC and expose every deliberate
 * loss through stable diagnostics. In particular, gaps become explicit `z`
 * rests and overlapping/zero-duration notes are skipped rather than silently
 * shifted earlier in time.
 */
export function serializeABCDetailed(score: Score): ScoreSerializeResult<string> {
  const timeSig = scoreTimeSignatures(score)[0] ?? {
    tick: 0,
    numerator: 4,
    denominator: 4,
  };
  const keySig = scoreKeySignatures(score)[0];
  const tokens: string[] = [];
  const diagnostics: ScoreDiagnostic[] = [];
  const part = score.parts[0];

  if (score.parts.length > 1) {
    diagnostics.push({
      code: 'abc-only-first-part-serialized',
      severity: 'warning',
      format: 'abc',
      message: 'Minimal ABC serialization emits only the first Part',
    });
  }

  if (part) {
    let cursor = Rational.ZERO;
    let reportedOverlap = false;
    let reportedZeroDuration = false;
    for (const note of part.notes) {
      if (note.duration.quarters.isZero()) {
        if (!reportedZeroDuration) {
          diagnostics.push({
            code: 'abc-zero-duration-notes-skipped',
            severity: 'warning',
            format: 'abc',
            message:
              'Minimal ABC serialization skips zero-duration notes because the compact token subset has no grace-note form',
          });
          reportedZeroDuration = true;
        }
        continue;
      }
      if (note.onsetQuarters.lt(cursor)) {
        if (!reportedOverlap) {
          diagnostics.push({
            code: 'abc-overlapping-notes-skipped',
            severity: 'warning',
            format: 'abc',
            message: 'Minimal ABC serialization is single-voice; overlapping notes are skipped rather than retimed',
          });
          reportedOverlap = true;
        }
        continue;
      }
      if (note.onsetQuarters.gt(cursor)) {
        tokens.push(`z${abcLengthSuffix(note.onsetQuarters.sub(cursor))}`);
        cursor = note.onsetQuarters;
      }
      tokens.push(`${note.rest ? 'z' : pitchToAbc(note.pitch)}${abcLengthSuffix(note.duration.quarters)}`);
      cursor = note.offsetQuarters;
    }
  }

  const data = [
    'X:1',
    `T:${scoreTitle(score) ?? 'Untitled'}`,
    `M:${timeSig.numerator}/${timeSig.denominator}`,
    'L:1/4',
    `K:${keySig?.mode === 'minor' ? 'Am' : 'C'}`,
    tokens.join(' '),
  ].join('\n');
  return { data, diagnostics: Object.freeze(diagnostics) };
}

/** Compatibility wrapper for callers that only need the ABC source string. */
export function serializeABC(score: Score): string {
  return serializeABCDetailed(score).data;
}

/** ABC lengths are relative to `L:1/4`, so a quarter is the empty suffix. */
function abcLengthSuffix(quarters: Rational): string {
  if (quarters.eq(Rational.ONE)) return '';
  if (quarters.den === 1) return String(quarters.num);
  if (quarters.num === 1) return `/${quarters.den}`;
  return `${quarters.num}/${quarters.den}`;
}

function abcLetterToPitch(accidentals: string, letter: string, octaveMarks = ''): Pitch {
  const scientific = abcToScientificNotation(`${accidentals}${letter}${octaveMarks}`);
  const parsed = /^([A-G])([#b]*)(-?\d+)$/.exec(scientific);
  if (parsed) {
    const [, step, accidentalText, octaveText] = parsed;
    const alter = Array.from(accidentalText).reduce<number>((sum, c) => sum + (c === '#' ? 1 : -1), 0) as Alter;
    return new Pitch(step as Step, alter, Number(octaveText));
  }

  const upper = letter.toUpperCase();
  const baseOctave = letter === upper ? 4 : 5;
  const octave =
    baseOctave +
    Array.from(octaveMarks).filter((m) => m === "'").length -
    Array.from(octaveMarks).filter((m) => m === ',').length;
  const alter = Array.from(accidentals).reduce<number>((sum, c) => {
    if (c === '^') return sum + 1;
    if (c === '_') return sum - 1;
    return sum;
  }, 0) as Alter;
  return new Pitch(upper as Step, alter, octave);
}

function pitchToAbc(pitch: Pitch): string {
  // Emit the pitch's own spelling whenever it is internally consistent
  // (step + alter + octave resolve to the pitch's MIDI number). Respelling
  // through midiToPitch — which normalizes to sharps only — and then
  // re-applying the ORIGINAL alter to the respelled step corrupted flats by
  // 1-2 semitones: Bb4 (midi 70) normalized to A#4, then alter -1 produced
  // Ab4 (midi 68). Fall back to the normalized spelling with the NORMALIZED
  // alter only when the spelling does not round-trip.
  const own = new Pitch(pitch.step, (pitch.alter ?? 0) as Alter, pitch.octave);
  const spelled = own.midi === pitch.midi ? own : midiToPitch(pitch.midi);
  const accidental = spelled.alter > 0 ? '#'.repeat(spelled.alter) : 'b'.repeat(Math.abs(spelled.alter));
  const token = scientificToAbcNotation(`${spelled.step}${accidental}${spelled.octave}`);
  // The compact output has no authored barlines. A natural must explicitly
  // cancel any preceding accidental when another ABC reader consumes it.
  return spelled.alter === 0 ? `=${token}` : token;
}
