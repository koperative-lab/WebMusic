import {Measure} from '../model/Measure';
import {Note} from '../model/Note';
import {Part} from '../model/Part';
import {Score} from '../model/Score';
import {Duration} from '../primitives/Duration';
import {Pitch} from '../primitives/Pitch';
import {Rational} from '../primitives/Rational';
import {setTimeMapExplicitEntries, TimeMap, type MeterEntry, type TempoEntry} from '../time/TimeMap';
import {MeasureId, NoteId, PartId, ScoreId, VoiceId} from '../types/ids';
import {assertValidScore} from '../validate';
import {
  SCORE_JSON_SCHEMA_ID,
  ScoreJSONError,
  type ScoreJSONErrorCode,
} from './schema';

type Json = any;

function fail(message: string, code: ScoreJSONErrorCode = 'invalid-json'): never {
  throw new ScoreJSONError(code, message);
}

function expectObject(j: Json, what: string): void {
  if (typeof j !== 'object' || j === null || Array.isArray(j)) {
    fail(`${what} must be an object`);
  }
}

function expectArray(j: Json, what: string): void {
  if (!Array.isArray(j)) fail(`${what} must be an array`);
}

function expectString(j: Json, what: string): void {
  if (typeof j !== 'string') fail(`${what} must be a string`);
}

function expectNumber(j: Json, what: string): void {
  if (typeof j !== 'number' || !Number.isFinite(j)) fail(`${what} must be a finite number`);
}

function expectPositiveNumber(j: Json, what: string): void {
  expectNumber(j, what);
  if (j <= 0) fail(`${what} must be positive`);
}

function expectBoolean(j: Json, what: string): void {
  if (typeof j !== 'boolean') fail(`${what} must be a boolean`);
}

function expectSafeInteger(j: Json, what: string): void {
  if (!Number.isSafeInteger(j)) fail(`${what} must be a safe integer`);
}

function expectPositiveSafeInteger(j: Json, what: string): void {
  expectSafeInteger(j, what);
  if (j < 1) fail(`${what} must be a positive safe integer`);
}

function expectOptionalString(j: Json, what: string): void {
  if (j !== undefined) expectString(j, what);
}

function expectOptionalBoolean(j: Json, what: string): void {
  if (j !== undefined) expectBoolean(j, what);
}

function expectEnum(j: Json, values: ReadonlyArray<string>, what: string): void {
  expectString(j, what);
  if (!values.includes(j)) fail(`${what} must be one of ${values.join(', ')}`);
}

function expectStringArray(j: Json, what: string, allowed?: ReadonlyArray<string>): void {
  expectArray(j, what);
  j.forEach((value: Json, index: number) => {
    const label = `${what}[${index}]`;
    if (allowed) expectEnum(value, allowed, label);
    else expectString(value, label);
  });
}

function expectRationalPair(j: Json, what: string): void {
  if (
    !Array.isArray(j) ||
    j.length !== 2 ||
    !Number.isSafeInteger(j[0]) ||
    !Number.isSafeInteger(j[1]) ||
    j[1] === 0
  ) {
    fail(`${what} must be a [safe integer numerator, non-zero safe integer denominator] pair`);
  }
}

function rational(j: Json): Rational {
  return new Rational(j[0], j[1]);
}

function pitch(j: Json): Pitch {
  expectObject(j, 'pitch');
  if (!['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(j.step)) {
    fail('pitch.step must be one of A, B, C, D, E, F, or G');
  }
  if (!Number.isSafeInteger(j.alter) || j.alter < -2 || j.alter > 2) {
    fail('pitch.alter must be an integer from -2 to 2');
  }
  if (!Number.isSafeInteger(j.octave)) {
    fail('pitch.octave must be a safe integer');
  }
  return Pitch.fromJSON(j);
}

function duration(j: Json): Duration {
  expectObject(j, 'duration');
  expectRationalPair(j.base, 'duration.base');
  if (!Number.isSafeInteger(j.dots) || j.dots < 0 || j.dots > 4) {
    fail('duration.dots must be an integer from 0 to 4');
  }
  expectRationalPair(j.tuplet, 'duration.tuplet');
  if (j.tuplet[0] <= 0 || j.tuplet[1] <= 0) {
    fail('duration.tuplet must contain positive integers');
  }
  return Duration.fromJSON(j);
}

const ARTICULATIONS = ['staccato', 'accent', 'tenuto', 'marcato', 'staccatissimo'] as const;
const ORNAMENTS = ['trill', 'mordent', 'turn', 'fermata'] as const;
const TIE_TYPES = ['start', 'continue', 'stop'] as const;
const KEY_MODES = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'aeolian', 'locrian'] as const;
const CLEF_SIGNS = ['G', 'F', 'C', 'percussion', 'TAB'] as const;

function grace(j: Json, what: string): Json {
  if (typeof j === 'boolean') return j;
  expectObject(j, what);
  expectOptionalBoolean(j.slash, `${what}.slash`);
  if (j.stealQuarters !== undefined) {
    expectNumber(j.stealQuarters, `${what}.stealQuarters`);
    if (j.stealQuarters < 0) fail(`${what}.stealQuarters must not be negative`);
  }
  return j;
}

function performed(j: Json, what: string): Json {
  expectObject(j, what);
  expectNumber(j.onsetSec, `${what}.onsetSec`);
  if (j.onsetSec < 0) fail(`${what}.onsetSec must not be negative`);
  expectNumber(j.durationSec, `${what}.durationSec`);
  if (j.durationSec < 0) fail(`${what}.durationSec must not be negative`);
  expectSafeInteger(j.velocity, `${what}.velocity`);
  if (j.velocity < 1 || j.velocity > 127) fail(`${what}.velocity must be an integer from 1 to 127`);
  return j;
}

function slurMark(j: Json, what: string): Json {
  expectObject(j, what);
  expectEnum(j.type, TIE_TYPES, `${what}.type`);
  if (j.number !== undefined) {
    expectSafeInteger(j.number, `${what}.number`);
    if (j.number < 1 || j.number > 6) fail(`${what}.number must be an integer from 1 to 6`);
  }
  if (j.placement !== undefined) expectEnum(j.placement, ['above', 'below'], `${what}.placement`);
  return j;
}

function slur(j: Json, what: string): Json {
  if (typeof j === 'string') {
    expectEnum(j, TIE_TYPES, what);
    return j;
  }
  if (Array.isArray(j)) return j.map((mark, index) => slurMark(mark, `${what}[${index}]`));
  return slurMark(j, what);
}

function note(j: Json): Note {
  expectObject(j, 'note');
  expectString(j.id, 'note.id');
  expectOptionalBoolean(j.unpitched, `note ${j.id}: unpitched`);
  expectOptionalBoolean(j.rest, `note ${j.id}: rest`);
  if (j.grace !== undefined) grace(j.grace, `note ${j.id}: grace`);
  // Rest notes are the only notes allowed to omit pitch.
  if (j.pitch === undefined && j.rest !== true) fail(`note ${j.id}: missing pitch`);
  if (j.pitch === null) fail(`note ${j.id}: pitch must be an object when present`);
  expectRationalPair(j.onsetQuarters, `note ${j.id}: onsetQuarters`);
  if (j.duration == null) fail(`note ${j.id}: missing duration`);
  expectString(j.voice, `note ${j.id}: voice`);
  expectOptionalString(j.tupletId, `note ${j.id}: tupletId`);
  if (j.tupletMarks !== undefined) expectArray(j.tupletMarks, `note ${j.id}: tupletMarks`);
  if (j.beams !== undefined) expectArray(j.beams, `note ${j.id}: beams`);
  if (j.stem !== undefined) expectEnum(j.stem, ['up', 'down', 'none', 'double'], `note ${j.id}: stem`);
  expectOptionalBoolean(j.printObject, `note ${j.id}: printObject`);
  if (j.performed !== undefined) performed(j.performed, `note ${j.id}: performed`);
  expectOptionalBoolean(j.chord, `note ${j.id}: chord`);
  if (j.articulations !== undefined) {
    expectStringArray(j.articulations, `note ${j.id}: articulations`, ARTICULATIONS);
  }
  if (j.ornaments !== undefined) expectStringArray(j.ornaments, `note ${j.id}: ornaments`, ORNAMENTS);
  if (j.tie !== undefined) expectEnum(j.tie, TIE_TYPES, `note ${j.id}: tie`);
  if (j.tiePlacement !== undefined) expectEnum(j.tiePlacement, ['above', 'below'], `note ${j.id}: tiePlacement`);
  if (j.slur !== undefined) slur(j.slur, `note ${j.id}: slur`);
  expectOptionalString(j.dynamic, `note ${j.id}: dynamic`);
  expectOptionalString(j.lyric, `note ${j.id}: lyric`);
  if (j.staff !== undefined) expectPositiveSafeInteger(j.staff, `note ${j.id}: staff`);
  if (j.tags !== undefined) expectStringArray(j.tags, `note ${j.id}: tags`);
  return new Note({
    id: NoteId(j.id),
    pitch: j.pitch !== undefined ? pitch(j.pitch) : undefined,
    unpitched: j.unpitched,
    rest: j.rest,
    restDisplay: j.restDisplay,
    grace: j.grace,
    onsetQuarters: rational(j.onsetQuarters),
    duration: duration(j.duration),
    tupletId: j.tupletId,
    tupletMarks: j.tupletMarks,
    performed: j.performed,
    voice: VoiceId(j.voice),
    chord: j.chord,
    beams: j.beams,
    stem: j.stem,
    printObject: j.printObject,
    articulations: j.articulations,
    ornaments: j.ornaments,
    tie: j.tie,
    tiePlacement: j.tiePlacement,
    slur: j.slur,
    dynamic: j.dynamic,
    lyric: j.lyric,
    staff: j.staff,
    tags: j.tags,
  });
}

function transpose(j: Json, what: string): Json {
  if (j === undefined) return undefined;
  expectObject(j, what);
  expectSafeInteger(j.chromatic, `${what}.chromatic`);
  if (j.diatonic !== undefined) expectSafeInteger(j.diatonic, `${what}.diatonic`);
  if (j.octaveChange !== undefined) expectSafeInteger(j.octaveChange, `${what}.octaveChange`);
  return j;
}

function clef(j: Json, what: string): Json {
  if (j === undefined) return undefined;
  expectObject(j, what);
  expectEnum(j.sign, CLEF_SIGNS, `${what}.sign`);
  if (j.line !== undefined) expectPositiveSafeInteger(j.line, `${what}.line`);
  if (j.octaveChange !== undefined) expectSafeInteger(j.octaveChange, `${what}.octaveChange`);
  return j;
}

function part(j: Json): Part {
  expectObject(j, 'part');
  expectString(j.id, 'part.id');
  expectString(j.name, `part ${j.id}: name`);
  expectArray(j.notes, `part ${j.id}: notes`);
  expectOptionalString(j.abbreviation, `part ${j.id}: abbreviation`);
  if (j.midiProgram !== undefined) {
    expectSafeInteger(j.midiProgram, `part ${j.id}: midiProgram`);
    if (j.midiProgram < 0 || j.midiProgram > 127) fail(`part ${j.id}: midiProgram must be an integer from 0 to 127`);
  }
  if (j.midiChannel !== undefined) {
    expectSafeInteger(j.midiChannel, `part ${j.id}: midiChannel`);
    if (j.midiChannel < 0 || j.midiChannel > 15) fail(`part ${j.id}: midiChannel must be an integer from 0 to 15`);
  }
  if (j.staves !== undefined) expectPositiveSafeInteger(j.staves, `part ${j.id}: staves`);
  for (const key of ['clefChanges', 'directions']) if (j[key] !== undefined) expectArray(j[key], `part ${j.id}: ${key}`);
  return new Part({
    id: PartId(j.id),
    name: j.name,
    abbreviation: j.abbreviation,
    midiProgram: j.midiProgram,
    midiChannel: j.midiChannel,
    staves: j.staves,
    transpose: transpose(j.transpose, `part ${j.id}: transpose`),
    clefChanges: j.clefChanges?.map((change: Json) => {
      expectObject(change, 'clef change');
      expectRationalPair(change.onsetQuarters, 'clef change onsetQuarters');
      return {...change, onsetQuarters: rational(change.onsetQuarters), clef: clef(change.clef, 'clef change clef')};
    }),
    directions: j.directions?.map((direction: Json) => {
      expectObject(direction, 'direction');
      expectRationalPair(direction.onsetQuarters, 'direction onsetQuarters');
      return {...direction, onsetQuarters: rational(direction.onsetQuarters),
        ...(direction.kind === 'metronome' ? {beatUnit: duration(direction.beatUnit)} : {})};
    }),
    notes: j.notes.map(note),
  });
}

function scoreMetadata(j: Json): Json {
  if (j === undefined) return {};
  expectObject(j, 'score.metadata');
  for (const field of ['title', 'composer', 'arranger', 'lyricist', 'copyright', 'source']) {
    expectOptionalString(j[field], `score.metadata.${field}`);
  }
  if (j.encoding !== undefined) {
    expectObject(j.encoding, 'score.metadata.encoding');
    expectOptionalString(j.encoding.software, 'score.metadata.encoding.software');
    expectOptionalString(j.encoding.date, 'score.metadata.encoding.date');
  }
  if (j.custom !== undefined) expectObject(j.custom, 'score.metadata.custom');
  // Unknown metadata and encoding properties are extension data. Validate the
  // standard fields above, but retain the original object so extensions still
  // round-trip through Score's defensive snapshot.
  return j;
}

function timeSignature(j: Json, what: string): Json {
  expectObject(j, what);
  expectPositiveSafeInteger(j.numerator, `${what}.numerator`);
  expectPositiveSafeInteger(j.denominator, `${what}.denominator`);
  return j;
}

function keySignature(j: Json, what: string): Json {
  expectObject(j, what);
  expectSafeInteger(j.fifths, `${what}.fifths`);
  if (j.fifths < -7 || j.fifths > 7) fail(`${what}.fifths must be an integer from -7 to 7`);
  if (j.mode !== undefined) expectEnum(j.mode, KEY_MODES, `${what}.mode`);
  return j;
}

function tempo(j: Json, what: string): Json {
  expectObject(j, what);
  expectPositiveNumber(j.bpm, `${what}.bpm`);
  if (j.unit !== undefined) expectPositiveNumber(j.unit, `${what}.unit`);
  return j;
}

function repeat(j: Json, what: string): Json {
  expectObject(j, what);
  expectOptionalBoolean(j.start, `${what}.start`);
  expectOptionalBoolean(j.end, `${what}.end`);
  if (j.times !== undefined) expectPositiveSafeInteger(j.times, `${what}.times`);
  return j;
}

function volta(j: Json, what: string): Json {
  expectArray(j, what);
  j.forEach((ending: Json, index: number) => expectPositiveSafeInteger(ending, `${what}[${index}]`));
  return j;
}

function measure(j: Json): Measure {
  expectObject(j, 'measure');
  expectString(j.id, 'measure.id');
  expectSafeInteger(j.number, `measure ${j.id}: number`);
  expectRationalPair(j.onsetQuarters, `measure ${j.id}: onsetQuarters`);
  expectRationalPair(j.durationQuarters, `measure ${j.id}: durationQuarters`);
  expectOptionalString(j.rehearsal, `measure ${j.id}: rehearsal`);
  return new Measure({
    id: MeasureId(j.id),
    number: j.number,
    onsetQuarters: rational(j.onsetQuarters),
    durationQuarters: rational(j.durationQuarters),
    timeSignature:
      j.timeSignature === undefined ? undefined : timeSignature(j.timeSignature, `measure ${j.id}: timeSignature`),
    keySignature:
      j.keySignature === undefined ? undefined : keySignature(j.keySignature, `measure ${j.id}: keySignature`),
    tempo: j.tempo === undefined ? undefined : tempo(j.tempo, `measure ${j.id}: tempo`),
    rehearsal: j.rehearsal,
    repeat: j.repeat === undefined ? undefined : repeat(j.repeat, `measure ${j.id}: repeat`),
    barlineStart: j.barlineStart,
    barlineEnd: j.barlineEnd,
    volta: j.volta === undefined ? undefined : volta(j.volta, `measure ${j.id}: volta`),
    clef: clef(j.clef, `measure ${j.id}: clef`),
    clefs:
      j.clefs === undefined
        ? undefined
        : (expectObject(j.clefs, `measure ${j.id}: clefs`),
          Object.fromEntries(
            Object.entries(j.clefs).map(([staff, c]) => {
              if (!/^[1-9]\d*$/.test(staff) || !Number.isSafeInteger(Number(staff))) {
                fail(`measure ${j.id}: clefs key "${staff}" must be a positive safe integer staff number`);
              }
              return [staff, clef(c, `measure ${j.id}: clefs[${staff}]`)];
            }),
          )),
  });
}

function explicitEntry(j: Json, what: string): boolean | undefined {
  if (j.explicit === undefined) return undefined;
  if (typeof j.explicit !== 'boolean') fail(`${what}.explicit must be a boolean`);
  return j.explicit;
}

/**
 * TimeMap keeps only one event at each position. Mirror its
 * last-declaration-wins policy for provenance too: an earlier `explicit: true`
 * record must not survive when a later JSON declaration at the same position
 * replaces it.
 */
function finalExplicitEntries<T extends {atQuarters: Rational}>(
  entries: ReadonlyArray<{entry: T; explicit: boolean | undefined}>,
): T[] {
  const finalByPosition = new Map<string, {entry: T; explicit: boolean | undefined}>();
  for (const item of entries) {
    const {num, den} = item.entry.atQuarters;
    finalByPosition.set(`${num}/${den}`, item);
  }
  return [...finalByPosition.values()].filter(({explicit}) => explicit === true).map(({entry}) => entry);
}

/**
 * A partial flag vector is intentionally treated as unknown provenance. The
 * only safe way to re-install inferred-vs-authored classification is for every
 * serialized timeline entry to state it explicitly; otherwise a direct
 * TimeMap round-trip could turn independently authored events into inferred
 * ones and delete them on the next measure edit.
 */
function hasCompleteProvenance<T>(
  entries: ReadonlyArray<{entry: T; explicit: boolean | undefined}>,
): boolean {
  return entries.every(({explicit}) => explicit !== undefined);
}

function timeMap(j: Json, measures: ReadonlyArray<Measure>): TimeMap {
  expectObject(j, 'timeMap');
  expectArray(j.tempi, 'timeMap.tempi');
  expectArray(j.meters, 'timeMap.meters');
  const parsedTempi: Array<{entry: TempoEntry; explicit: boolean | undefined}> = j.tempi.map(
    (t: Json, index: number) => {
      const what = `timeMap.tempi[${index}]`;
      expectObject(t, what);
      expectRationalPair(t.atQuarters, `${what}.atQuarters`);
      tempo(t, what);
      return {
        entry: {atQuarters: rational(t.atQuarters), bpm: t.bpm, unit: t.unit},
        explicit: explicitEntry(t, what),
      };
    },
  );
  const parsedMeters: Array<{entry: MeterEntry; explicit: boolean | undefined}> = j.meters.map(
    (m: Json, index: number) => {
      const what = `timeMap.meters[${index}]`;
      expectObject(m, what);
      expectRationalPair(m.atQuarters, `${what}.atQuarters`);
      timeSignature(m.timeSignature, `${what}.timeSignature`);
      expectSafeInteger(m.measureNumber, `${what}.measureNumber`);
      return {
        entry: {
          atQuarters: rational(m.atQuarters),
          timeSignature: m.timeSignature,
          measureNumber: m.measureNumber,
        },
        explicit: explicitEntry(m, what),
      };
    },
  );
  const timeMap = new TimeMap(
    parsedTempi.map(({entry}) => entry),
    parsedMeters.map(({entry}) => entry),
    measures.length > 0 ? measures : undefined,
  );
  if (hasCompleteProvenance(parsedTempi) && hasCompleteProvenance(parsedMeters)) {
    setTimeMapExplicitEntries(
      timeMap,
      finalExplicitEntries(parsedTempi),
      finalExplicitEntries(parsedMeters),
    );
  }
  return timeMap;
}

/** Reconstruct a Score from the JSON output of `Score#toJSON()`. */
export function scoreFromJSON(j: Json): Score {
  try {
    return parseScoreJSON(j);
  } catch (error) {
    if (error instanceof ScoreJSONError) throw error;
    fail(error instanceof Error ? error.message : String(error));
  }
}

function parseScoreJSON(j: Json): Score {
  expectObject(j, 'score');
  if (j.$schema != null && j.$schema !== SCORE_JSON_SCHEMA_ID) {
    fail(
      `unsupported $schema "${String(j.$schema)}" (supported: ${SCORE_JSON_SCHEMA_ID})`,
      'unsupported-schema',
    );
  }
  expectString(j.id, 'score.id');
  expectArray(j.parts, 'score.parts');
  expectArray(j.measures, 'score.measures');
  expectObject(j.timeMap, 'score.timeMap');
  const measures = j.measures.map(measure);
  const score = new Score({
    id: ScoreId(j.id),
    metadata: scoreMetadata(j.metadata),
    parts: j.parts.map(part),
    measures,
    timeMap: timeMap(j.timeMap, measures),
  });
  try {
    assertValidScore(score);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 'invalid-score');
  }
  return score;
}
