// Internal reusable implementation for @webmusic/score/play. Public consumers use
// the API or headless entries; element code also shares the models here.
export {
  DEFAULT_SFZ_PARSE_LIMITS,
  parseSfz,
  parseSfzKey,
  resolveSfzZones,
  type SfzParseOptions,
  type SfzRegion,
  type SampleZone,
} from './sfz';
export {notesToScore, type RecordedNote, type RecordToScoreOptions} from './record';
export {pianoKeys, type PianoKey} from './piano-keys';
