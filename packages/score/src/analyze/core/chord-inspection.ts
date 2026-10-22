import {Pitch, Rational, type Score} from '../../core';
import type {IntervalPitchMode, IntervalSelection} from './interval';
import {inspectionNotes, validatePitchMode, type InspectionNote, type TheoryNoteEvidence} from './inspection-notes';
import {degreeAccidental, theoryPitchName, theoryScalePitches} from './scale-inspection';
import {rhythmBeatSpans, type BeatGroups} from './rhythm-inspection';
import type {Key} from './types';

export type BasicChordQuality = 'major' | 'minor' | 'diminished' | 'augmented'
  | 'major-seventh' | 'dominant-seventh' | 'minor-seventh' | 'half-diminished-seventh'
  | 'diminished-seventh' | 'minor-major-seventh' | 'augmented-major-seventh';

export interface BasicChordCandidate {
  readonly symbol: string;
  readonly root: string;
  /** Lowest supplied pitch, retaining its spelling and omitting octave. */
  readonly bass: string;
  readonly quality: BasicChordQuality;
  readonly family: 'triad' | 'seventh';
  /** 0 = root position; 1/2/3 = third/fifth/seventh in the bass. */
  readonly inversion: 0 | 1 | 2 | 3;
  /** Explicit-key degree plus quality and inversion figures; never a function. */
  readonly roman?: string;
}

export interface ChordInspection {
  /** Distinct spelled supplied pitches, ascending, including octave. */
  readonly pitches: readonly string[];
  /** Only complete, exactly spelled triads and seventh chords. */
  readonly candidates: readonly BasicChordCandidate[];
  /** A deterministic first reading, not a probability or harmonic-function claim. */
  readonly primary?: BasicChordCandidate;
  /** Primary symbol, else supplied pitch names; silence is an empty string. */
  readonly label: string;
}

export type ScoreChordGrouping = 'simultaneous' | 'beat';

export interface ScoreChordInspectionOptions {
  readonly pitchMode?: IntervalPitchMode;
  /** Exact simultaneous spans by default; beat collects notes across each metrical pulse. */
  readonly grouping?: ScoreChordGrouping;
  /** Explicit pulse groups per meter numerator; used only by beat grouping, with rhythm inspection's meter rules. */
  readonly beatGroups?: BeatGroups;
  /** Optional explicit source subset; range clips spans to its half-open limits. */
  readonly selection?: IntervalSelection;
  /** Explicit major/natural-minor reference; absent means no Roman degree. */
  readonly key?: Key;
}

export interface ScoreChordSpan extends ChordInspection {
  /** Whether pitches overlap simultaneously or are collected across a notated beat. */
  readonly grouping: ScoreChordGrouping;
  readonly id: string;
  readonly startQuarters: number;
  readonly endQuarters: number;
  readonly notes: readonly TheoryNoteEvidence[];
}

export interface ScoreChordInspection {
  readonly pitchMode: IntervalPitchMode;
  readonly grouping: ScoreChordGrouping;
  /** Positive-duration simultaneous slices or metrical groups; groups without pitched notes are omitted. */
  readonly spans: readonly ScoreChordSpan[];
}

interface Template {
  quality: BasicChordQuality;
  intervals: readonly number[];
  suffix: string;
  lower?: boolean;
  mark?: string;
}

const TEMPLATES: readonly Template[] = [
  {quality: 'major', intervals: [0, 4, 7], suffix: ''},
  {quality: 'minor', intervals: [0, 3, 7], suffix: 'm', lower: true},
  {quality: 'diminished', intervals: [0, 3, 6], suffix: 'dim', lower: true, mark: '°'},
  {quality: 'augmented', intervals: [0, 4, 8], suffix: 'aug', mark: '+'},
  {quality: 'major-seventh', intervals: [0, 4, 7, 11], suffix: 'maj7', mark: 'maj'},
  {quality: 'dominant-seventh', intervals: [0, 4, 7, 10], suffix: '7'},
  {quality: 'minor-seventh', intervals: [0, 3, 7, 10], suffix: 'm7', lower: true},
  {quality: 'half-diminished-seventh', intervals: [0, 3, 6, 10], suffix: 'm7b5', lower: true, mark: 'ø'},
  {quality: 'diminished-seventh', intervals: [0, 3, 6, 9], suffix: 'dim7', lower: true, mark: '°'},
  {quality: 'minor-major-seventh', intervals: [0, 3, 7, 11], suffix: 'mMaj7', lower: true, mark: 'maj'},
  {quality: 'augmented-major-seventh', intervals: [0, 4, 8, 11], suffix: 'augMaj7', mark: '+maj'},
];

const STEPS = 'CDEFGAB';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const pitchName = (pitch: Pitch) => `${pitch.step}${degreeAccidental(pitch.alter)}`;
const chroma = (pitch: Pitch) => ((pitch.midi % 12) + 12) % 12;

function validateKey(key: Key | undefined): void {
  if (!key) return;
  if (key.mode !== 'major' && key.mode !== 'minor') throw new RangeError('Chord key must be major or minor');
  theoryPitchName(key.tonic);
}

function romanFor(root: Pitch, template: Template, inversion: number, key: Key): string {
  const reference = theoryScalePitches(key.tonic, key.mode === 'major' ? 'major' : 'natural-minor');
  const degree = (STEPS.indexOf(root.step) - STEPS.indexOf(reference[0]!.step) + 7) % 7;
  const alteration = root.alter - reference[degree]!.alter;
  const numeral = template.lower ? ROMAN[degree]!.toLowerCase() : ROMAN[degree]!;
  const figures = template.intervals.length === 3 ? ['', '6', '64'] : ['7', '65', '43', '42'];
  return `${degreeAccidental(alteration)}${numeral}${template.mark ?? ''}${figures[inversion]}`;
}

/**
 * Match complete textbook triads/sevenths against supplied spelled pitches.
 * Doublings are allowed; omitted tones, rootless readings and enharmonic
 * respellings are not inferred. Callers of MIDI data choose its spelling.
 * Roman alterations are relative to the explicit major or natural-minor
 * scale; e.g. G#-B-D in A minor is #vii°, not a claim about tonal function.
 */
export function inspectChordPitches(pitches: readonly Pitch[], key?: Key): ChordInspection {
  validateKey(key);
  const ordered = [...pitches].sort((a, b) => a.midi - b.midi || pitchName(a).localeCompare(pitchName(b)));
  const distinct = [...new Map(ordered.map((pitch) => [pitch.toString(), pitch])).values()];
  const classes = [...new Map(ordered.map((pitch) => [pitchName(pitch), pitch])).values()];
  const candidates: BasicChordCandidate[] = [];
  const bass = ordered[0];
  if (bass && (classes.length === 3 || classes.length === 4)) {
    for (const root of classes) {
      for (const template of TEMPLATES) {
        if (template.intervals.length !== classes.length) continue;
        const rootStep = STEPS.indexOf(root.step);
        const members = template.intervals.map((interval, index) => classes.find((pitch) =>
          STEPS.indexOf(pitch.step) === (rootStep + index * 2) % 7
          && (chroma(pitch) - chroma(root) + 12) % 12 === interval));
        if (members.some((member) => member === undefined)) continue;
        const inversion = members.findIndex((member) => pitchName(member!) === pitchName(bass)) as 0 | 1 | 2 | 3;
        const rootName = pitchName(root);
        candidates.push({
          symbol: `${rootName}${template.suffix}${inversion ? `/${pitchName(bass)}` : ''}`,
          root: rootName, bass: pitchName(bass), quality: template.quality,
          family: classes.length === 3 ? 'triad' : 'seventh', inversion,
          ...(key ? {roman: romanFor(root, template, inversion, key)} : {}),
        });
      }
    }
  }
  const primary = candidates[0];
  return {
    pitches: distinct.map((pitch) => pitch.toString()), candidates,
    ...(primary ? {primary} : {}),
    label: primary?.symbol ?? distinct.map((pitch) => pitch.toString()).join(' '),
  };
}

/**
 * Inspect exact simultaneous spans or explicitly collect notes across notated
 * beats. Beat collections retain every selected pitch: no implied tones,
 * non-chord-tone removal, or harmonic-rhythm inference. Their bass/inversion
 * describes the lowest collected pitch, not an inferred structural bass.
 */
export function inspectScoreChords(score: Score, options: ScoreChordInspectionOptions = {}): ScoreChordInspection {
  const pitchMode = options.pitchMode ?? 'written';
  validatePitchMode(pitchMode);
  validateKey(options.key);
  const grouping = options.grouping ?? 'simultaneous';
  if (grouping !== 'simultaneous' && grouping !== 'beat') throw new RangeError('Chord grouping must be simultaneous or beat');
  const notes = inspectionNotes(score, pitchMode, options.selection);
  // A float range is only approximated when it falls strictly inside the
  // Score: its exact ends, which a full-score selection names as floats,
  // keep their authored Rational so a span ending on a triplet is not rounded.
  const duration = score.durationQuarters;
  const from = options.selection?.fromQuarters === undefined || options.selection.fromQuarters <= 0
    ? Rational.ZERO : Rational.from(options.selection.fromQuarters);
  const to = options.selection?.toQuarters === undefined || options.selection.toQuarters >= duration.toFloat()
    ? duration : Rational.from(options.selection.toQuarters);
  if (grouping === 'beat') {
    const candidates = notes.filter((entry) => entry.note.offsetQuarters.gt(entry.note.onsetQuarters))
      .sort((a, b) => a.note.onsetQuarters.cmp(b.note.onsetQuarters));
    const spans: ScoreChordSpan[] = [];
    let cursor = 0;
    let active: InspectionNote[] = [];
    for (const beat of rhythmBeatSpans(score, from, to, 'meter', options.beatGroups)) {
      const start = beat.start.lt(from) ? from : beat.start;
      const end = beat.end.gt(to) ? to : beat.end;
      while (cursor < candidates.length && candidates[cursor]!.note.onsetQuarters.lt(end)) {
        active.push(candidates[cursor++]!);
      }
      active = active.filter((entry) => entry.note.offsetQuarters.gt(start));
      if (active.length === 0) continue;
      spans.push({
        id: `chord-beat-${start.toString()}-${end.toString()}`, grouping,
        startQuarters: start.toFloat(), endQuarters: end.toFloat(),
        notes: active.map((entry) => entry.evidence),
        ...inspectChordPitches(active.map((entry) => entry.pitch), options.key),
      });
    }
    return {pitchMode, grouping, spans};
  }
  const events = new Map<string, {at: Rational; on: InspectionNote[]; off: InspectionNote[]}>();
  const event = (at: Rational) => {
    const token = at.toString();
    let value = events.get(token);
    if (!value) {
      value = {at, on: [], off: []};
      events.set(token, value);
    }
    return value;
  };
  for (const note of notes) {
    const start = note.note.onsetQuarters.lt(from) ? from : note.note.onsetQuarters;
    const end = note.note.offsetQuarters.gt(to) ? to : note.note.offsetQuarters;
    if (!end.gt(start)) continue;
    event(start).on.push(note);
    event(end).off.push(note);
  }
  const active = new Set<InspectionNote>();
  const spans: ScoreChordSpan[] = [];
  let previous: Rational | undefined;
  for (const boundary of [...events.values()].sort((a, b) => a.at.cmp(b.at))) {
    if (previous && boundary.at.gt(previous) && active.size > 0) {
      const notes = [...active];
      spans.push({
        id: `chord-span-${previous.toString()}-${boundary.at.toString()}`,
        grouping,
        startQuarters: previous.toFloat(), endQuarters: boundary.at.toFloat(),
        notes: notes.map((note) => note.evidence),
        ...inspectChordPitches(notes.map((note) => note.pitch), options.key),
      });
    }
    for (const note of boundary.off) active.delete(note);
    for (const note of boundary.on) active.add(note);
    previous = boundary.at;
  }
  return {pitchMode, grouping, spans};
}
