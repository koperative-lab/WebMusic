import {Rational, type Note, type Score} from '../../core';
import {
  analyzeIntervals, inspectScale, inspectScoreChords, inspectScoreRhythm,
  type IntervalPitchMode, type IntervalSelection, type Key, type ScaleKind,
} from '../core';
import type {FlowBandView, FlowLaneView, FlowTrackView} from './workbench';
import {rhythmBeatSpans} from '../core/rhythm-inspection';

export type BasicAnalysisKind = 'chord' | 'interval' | 'scale' | 'rhythm';
export interface AnalysisSelection {
  readonly id: string;
  readonly startQuarters: number;
  readonly endQuarters: number;
}
export interface AnalysisInspectionCandidate {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly selected: boolean;
}
export interface AnalysisInspection {
  readonly kind: BasicAnalysisKind;
  readonly selection: AnalysisSelection;
  readonly headline: string;
  readonly detail: string;
  readonly evidence: readonly string[];
  readonly candidates: readonly AnalysisInspectionCandidate[];
}
export interface BasicInspectionOptions {
  readonly pitchMode?: IntervalPitchMode;
  readonly selection?: IntervalSelection;
  readonly intervalKind?: 'melodic' | 'harmonic' | 'both';
  readonly key?: Key;
  /** Defaults to simultaneous; Elements explicitly choose beat collection. */
  readonly chordGrouping?: 'simultaneous' | 'beat';
  readonly tonic?: string;
  readonly scale?: ScaleKind;
  readonly beatGroups?: readonly number[];
  readonly subdivision?: 1 | 2 | 3 | 4;
}
export interface BasicInspectionProjection {
  readonly lane: FlowLaneView;
  readonly inspections: readonly AnalysisInspection[];
  readonly message?: string;
}

function intervalTitle(number: number, quality: string): string {
  const suffix = number % 100 >= 11 && number % 100 <= 13 ? 'th'
    : ({1: 'st', 2: 'nd', 3: 'rd'} as Record<number, string>)[number % 10] ?? 'th';
  const name = ({P: 'Perfect', M: 'Major', m: 'Minor', A: 'Augmented', d: 'Diminished'} as Record<string, string>)[quality]
    ?? `${quality.length === 2 ? 'Doubly' : quality.length === 3 ? 'Triply' : `${quality.length}×`} ${quality[0] === 'A' ? 'augmented' : 'diminished'}`;
  return `${name} ${number === 1 ? 'unison' : number === 8 ? 'octave' : `${number}${suffix}`}`;
}

/** Read authored notation, rather than guessing a note value from performed time. */
function durationReading(note: Note): {compact: string; full: string} {
  const duration = note.duration;
  const base = ({'8': ['Double whole', 'Double whole'], '4': ['Whole', 'Whole'], '2': ['Half', 'Half'],
    '1': ['Quarter', 'Quarter'], '1/2': ['8th', 'Eighth'], '1/4': ['16th', 'Sixteenth'],
    '1/8': ['32nd', 'Thirty-second'], '1/16': ['64th', 'Sixty-fourth'], '1/32': ['128th', '128th']} as Record<string, readonly [string, string]>)[duration.base.toString()];
  if (!base) return {compact: `${duration.quarters.toString()} qn`, full: `${duration.quarters.toString()} quarter-note units`};
  const dots = duration.dots === 1 ? 'Dotted ' : duration.dots > 1 ? `${duration.dots}-dot ` : '';
  const tuplet = duration.tuplet[0] !== duration.tuplet[1];
  const ratio = `${duration.tuplet[0]}:${duration.tuplet[1]}`;
  return {
    compact: `${dots}${base[0]}${tuplet ? ` (${ratio})` : ''}`,
    full: `${dots}${dots ? base[1].toLowerCase() : base[1]}${tuplet ? `-note ${ratio === '3:2' ? 'triplet' : `${ratio} tuplet`}` : ' note'}`,
  };
}

/** Plain-data projection shared by Elements and application-owned UI. No playback resources. */
export function projectBasicInspection(
  score: Score,
  kind: BasicAnalysisKind,
  options: BasicInspectionOptions = {},
): BasicInspectionProjection {
  const inspections: AnalysisInspection[] = [];
  const bands: FlowBandView[] = [];
  const tracks: FlowTrackView[] = [];
  const ends: number[] = [];
  const seconds = (q: number) => score.timeMap.quartersToSeconds(Rational.from(q));
  const pitchMode = options.pitchMode ?? 'written';
  const requested = options.selection;
  const selection: IntervalSelection = requested && Object.values(requested).some((value) => value !== undefined)
    ? requested : {fromQuarters: 0, toQuarters: score.durationQuarters.toFloat()};
  const add = (id: string, start: number, end: number, primary: string, secondary: string,
    detail: string, evidence: readonly string[], candidates: readonly AnalysisInspectionCandidate[] = [],
    presentation?: Pick<FlowBandView, 'primary' | 'secondary' | 'readout'>) => {
    if (end <= start) return;
    bands.push({id, start: seconds(start), end: seconds(end), stampStart: start, stampEnd: end,
      primary, secondary, group: id, ...presentation});
    inspections.push({kind, selection: {id, startQuarters: start, endQuarters: end},
      headline: primary, detail, evidence, candidates});
  };
  let message: string | undefined;
  let ruler: FlowLaneView['ruler'];
  if (kind === 'chord') {
    const grouping = options.chordGrouping ?? 'simultaneous';
    const result = inspectScoreChords(score, {pitchMode, key: options.key, selection, grouping,
      beatGroups: grouping === 'beat' ? options.beatGroups : undefined});
    for (const span of result.spans) {
      if (selection.fromQuarters !== undefined && span.endQuarters <= selection.fromQuarters) continue;
      if (selection.toQuarters !== undefined && span.startQuarters >= selection.toQuarters) continue;
      const chord = span.primary;
      const notes = span.pitches.join(' ');
      const scope = grouping === 'beat' ? 'Beat collection' : 'Simultaneous notes';
      const context = options.key ? `in ${options.key.tonic} ${options.key.mode} (chosen)` : 'No key context — choose a key for degrees';
      add(span.id, span.startQuarters, span.endQuarters, span.label,
        chord?.roman ?? '',
        `${scope} · ${pitchMode} pitches · ${context}${grouping === 'beat' ? '; bass denotes the lowest collected pitch, not an inferred harmonic bass' : ''}`,
        span.notes.map((note) => `${note.pitch}${note.spellingInferred ? ' (spelling inferred)' : ''} · ${note.partId}/${note.voiceId} · ${note.noteId}`),
        span.candidates.map((candidate, index) => ({id: candidate.symbol, label: candidate.symbol,
          detail: `${candidate.quality}; bass ${candidate.bass}; inversion ${candidate.inversion}${candidate.roman ? `; ${candidate.roman}` : ''}`,
          selected: index === 0})), {
          primary: chord?.symbol ?? '',
          secondary: notes,
          readout: {
            primary: chord?.symbol ?? '',
            secondary: chord ? [notes, chord.roman,
              options.key ? `${options.key.tonic} ${options.key.mode}` : undefined].filter(Boolean).join(' · ') : notes,
          },
        });
    }
  } else if (kind === 'interval') {
    const result = analyzeIntervals(score, selection, {pitchMode});
    const intervalKind = options.intervalKind ?? 'melodic';
    for (const interval of [...result.intervals].sort((a, b) => a.startQuarters - b.startQuarters || a.endQuarters - b.endQuarters)) {
      if (intervalKind !== 'both' && interval.kind !== intervalKind) continue;
      const pitches = interval.evidence.map((note) => note.pitch).join(interval.kind === 'harmonic' ? ' + ' : ' → ');
      add(interval.id, interval.startQuarters, interval.endQuarters, interval.label, pitches,
        `${interval.kind} · ${interval.direction} · ${interval.semitones} semitones · ${pitchMode} pitches`,
        interval.evidence.map((note) => `${note.pitch}${note.spellingInferred ? ' (spelling inferred)' : ''} (written ${note.writtenPitch}) · ${note.partId}/${note.voiceId} · ${note.noteId}`), [], {
          readout: {primary: intervalTitle(interval.number, interval.quality),
            secondary: `${pitches} · ${interval.kind === 'harmonic' ? 'simultaneous' : interval.direction} · ${Math.abs(interval.semitones)} semitones`,
            fields: [
              {id: 'notes', label: 'Notes', value: pitches},
              {id: 'motion', label: 'Motion', value: interval.kind === 'harmonic' ? 'Simultaneous'
                : `${interval.direction[0]!.toUpperCase()}${interval.direction.slice(1)}`},
              {id: 'semitones', label: 'Semitones', value: String(Math.abs(interval.semitones))},
            ]},
        });
    }
  } else if (kind === 'scale') {
    if (!options.tonic) {
      message = 'Choose a tonic and scale. A key is not inferred from these notes.';
    } else {
      const result = inspectScale(score, selection, {tonic: options.tonic, scale: options.scale, pitchMode});
      for (const note of [...result.notes].sort((a, b) => a.onsetQuarters - b.onsetQuarters || a.offsetQuarters - b.offsetQuarters)) {
        add(JSON.stringify(['degree', note.partId, note.noteId]), note.onsetQuarters, note.offsetQuarters,
          note.label, note.pitch,
          `${result.tonic} ${result.scale} (chosen) · ${pitchMode} pitch · ${note.inScale ? 'in reference scale' : 'altered degree, not an error'}`,
          [`${note.pitch}${note.spellingInferred ? ' (spelling inferred)' : ''} (written ${note.writtenPitch}) · ${note.partId}/${note.voiceId} · ${note.noteId}`,
            `Reference scale: ${result.pitches.map((pitch) => pitch.pitch).join(' ')}`], [], {
            readout: {primary: `Degree ${note.label}`,
              secondary: `${note.pitch} · ${result.tonic} ${result.scale.replace(/-/g, ' ')}${note.inScale ? '' : ' · altered'}`,
              fields: [
                {id: 'note', label: 'Note', value: note.pitch},
                {id: 'reference', label: 'Reference', value: `${result.tonic} ${result.scale.replace(/-/g, ' ')}`},
                {id: 'relation', label: 'Relation', value: note.inScale ? 'In scale' : 'Altered'},
              ]},
          });
      }
    }
  } else {
    const result = inspectScoreRhythm(score, {beatUnit: 'meter', beatGroups: options.beatGroups,
      subdivision: options.subdivision, partId: selection.partId,
      startQuarters: selection.fromQuarters, endQuarters: selection.toQuarters});
    ruler = [
      ...result.beats.map((beat) => ({at: seconds(beat.atQuarters), label: `${beat.measure}:${beat.beat}`, major: true})),
      ...result.subdivisions.map((division) => ({at: seconds(division.atQuarters),
        label: '', major: false})),
    ].sort((a, b) => a.at - b.at);
    const ids = selection.noteIds === undefined ? undefined : new Set(selection.noteIds);
    const selected = (note: Note) => (selection.voiceId === undefined || note.voice === selection.voiceId)
      && (ids === undefined || ids.has(note.id));
    const notes = new Map(score.parts.flatMap((part) => part.notes.map((note) => [JSON.stringify([String(part.id), String(note.id)]), note] as const)));
    const rhythmFields = (measure: number | undefined, beat: number | undefined, subbeat: string | undefined, durations: string[]) => [
      {id: 'bar', label: 'Bar', value: measure === undefined ? '' : String(measure)},
      {id: 'beat', label: 'Beat', value: beat === undefined ? '' : `${beat}${subbeat && subbeat !== '0' ? ` + ${subbeat}` : ''}`},
      {id: 'duration', label: 'Duration (qn)', value: durations.join(', ')},
    ];
    const notation = (note: Note): string => {
      const duration = note.duration;
      return `${note.id}: ${duration.quarters.toString()} quarter-note units; base ${duration.base.toString()}`
        + (duration.dots ? `; dots ${duration.dots}` : '')
        + (duration.tuplet[0] !== duration.tuplet[1] ? `; tuplet ${duration.tuplet[0]} in the time of ${duration.tuplet[1]}` : '')
        + (note.tie ? `; tie ${note.tie}` : '');
    };
    for (const onset of result.onsets) {
      const members = onset.noteIds.map((id) => notes.get(JSON.stringify([onset.partId, id])))
        .filter((note): note is Note => note !== undefined && selected(note));
      if (members.length === 0) continue;
      const end = members.reduce((last, note) => Math.max(last, note.offsetQuarters.toFloat()), onset.atQuarters);
      const durations = [...new Set(members.map((note) => note.duration.quarters.toString()))];
      const readings = [...new Map(members.map((note) => {const reading = durationReading(note); return [reading.full, reading] as const;})).values()];
      const authoredAccent = members.some((note) => note.articulations?.includes('accent')
        || note.articulations?.includes('marcato'));
      const position = `${onset.measure}:${onset.beat}${onset.subbeat ? ` + ${onset.subbeatExact}` : ''}`;
      add(onset.id, onset.atQuarters, end,
        position,
        `${durations.join(', ')} quarter-note units`,
        `Grouped beat position · ${onset.offbeat ? 'within a beat' : 'on a beat'}${authoredAccent ? ' · notated accent' : ''}`,
        [`${onset.partId}/${onset.voiceId} · ${members.map((note) => note.id).join(', ')}`,
          ...members.map(notation),
          'Tied continuations are not new attacks; metrical position is not a groove or syncopation verdict.'], [], {
          primary: readings.length === 1 ? readings[0]!.compact : `${readings.length} durations`, secondary: position,
          readout: {primary: readings.map((reading) => reading.full).join(' / '),
            secondary: `Bar ${onset.measure} · beat ${onset.beat}${onset.subbeat ? ` + ${onset.subbeatExact}` : ''} · ${durations.join(', ')} quarter-note units`,
            fields: rhythmFields(onset.measure, onset.beat, onset.subbeatExact, durations)},
        });
    }
    for (const part of score.parts) {
      if (selection.partId !== undefined && part.id !== selection.partId) continue;
      for (const note of part.notes) {
        if (!selected(note) || (!note.rest && note.tie !== 'continue' && note.tie !== 'stop')) continue;
        const start = note.onsetQuarters.toFloat();
        const end = note.offsetQuarters.toFloat();
        if (result.range.endQuarters <= result.range.startQuarters || start >= result.range.endQuarters || end <= result.range.startQuarters) continue;
        let measure: number | undefined;
        let beat: number | undefined;
        let subbeat: string | undefined;
        try {
          const pulse = rhythmBeatSpans(score, note.onsetQuarters, note.offsetQuarters, 'meter', options.beatGroups).next();
          if (!pulse.done) {
            measure = pulse.value.measure;
            beat = pulse.value.beat;
            subbeat = note.onsetQuarters.sub(pulse.value.start).div(pulse.value.length).toString();
          }
        } catch (error) {
          // The selected range has already validated its meter grouping. A
          // continuation can begin in an earlier, differently grouped meter;
          // retain its authored bar without inventing that out-of-range beat.
          if (!(error instanceof RangeError) || start >= result.range.startQuarters) throw error;
          measure = score.timeMap.quartersToMBS(note.onsetQuarters).measure;
        }
        add(JSON.stringify(['rhythm-written', part.id, note.id]), start, end,
          note.rest ? 'Rest' : 'Tie continuation', `${note.duration.quarters.toString()} quarter-note units`,
          note.rest ? 'Notated rest in this voice' : 'Notated tie continuation; not a new attack',
          [`${part.id}/${note.voice} · ${note.id}`, notation(note)], [], {
            primary: note.rest ? 'Rest' : 'Tie', secondary: durationReading(note).compact,
            readout: {primary: note.rest ? `${durationReading(note).full.replace(/ note$/, '')} rest` : `Tied ${durationReading(note).full.toLowerCase()}`,
              secondary: note.rest ? 'Notated rest' : 'Held continuation · no new attack',
              fields: rhythmFields(measure, beat, subbeat, [note.duration.quarters.toString()])},
          });
      }
    }
  }
  const arranged = bands.sort((a, b) => a.start - b.start || a.end - b.end).map((band) => {
    let track = ends.findIndex((value) => value <= band.start);
    if (track === -1) {
      track = ends.length;
      tracks.push({id: track === 0 ? (kind === 'chord' ? 'chords' : kind) : `row-${track}`});
    }
    ends[track] = band.end;
    return {...band, track};
  });
  inspections.sort((a, b) => a.selection.startQuarters - b.selection.startQuarters
    || a.selection.endQuarters - b.selection.endQuarters);
  return {lane: {bands: arranged, tracks, ruler, span: {start: 0, end: score.durationSeconds}, now: 0}, inspections, message};
}
