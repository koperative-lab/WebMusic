// The projections, tested as what they are: plain objects out of plain data.
// Nothing here mounts anything — that is the claim the whole layer is making.

import {describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type PartId, type Score} from '../../src/core';
import {createAnalysisSession} from '../../src/analyze/headless/session';
import {
  formatMetricalPosition,
  projectKeyCandidates,
  projectKeyFlow,
  projectMotifFlow,
  projectPitchClassMeters,
  projectProgression,
  projectSounding,
  projectTonality,
  projectVoiceFlow,
  soundingMidisAt,
} from '../../src/analyze/headless/workbench';
import {distributions} from '../../src/analyze/core/distributions';
import {TUNINGS} from '../../src/analyze/core/fretboard-voicing';

type NoteSpec = [pitch: string, onset: number, duration: number];

function scoreFrom(voices: Record<string, NoteSpec[]>): Score {
  const builder = new ScoreBuilder();
  const partId: PartId = builder.newPartId();
  builder.addPart({id: partId, name: 'Chorale'});
  for (const [voiceName, notes] of Object.entries(voices)) {
    const voice = VoiceId(`${partId}-${voiceName}`);
    for (const [name, onset, duration] of notes) {
      builder.addNote(partId, {
        id: builder.newNoteId(),
        pitch: Pitch.parse(name),
        onsetQuarters: new Rational(Math.round(onset * 4), 4),
        duration: new Duration({base: new Rational(Math.round(duration * 4), 4)}),
        voice,
      });
    }
  }
  return builder.build();
}

/** Four bars of triads: C – F – G – C, three voices, one chord per bar. */
function chorale(): Score {
  return scoreFrom({
    s: [['G4', 0, 4], ['A4', 4, 4], ['B4', 8, 4], ['C5', 12, 4]],
    a: [['E4', 0, 4], ['F4', 4, 4], ['D4', 8, 4], ['E4', 12, 4]],
    b: [['C4', 0, 4], ['C4', 4, 4], ['G3', 8, 4], ['C4', 12, 4]],
  });
}

/** A tune whose first four notes come back twice, note for note. */
function withMotif(): Score {
  return scoreFrom({
    s: [
      ['E4', 0, 1], ['D4', 1, 1], ['C4', 2, 1], ['D4', 3, 1],
      ['G4', 4, 1], ['A4', 5, 1], ['B4', 6, 1], ['C5', 7, 1],
      ['E4', 8, 1], ['D4', 9, 1], ['C4', 10, 1], ['D4', 11, 1],
    ],
  });
}

const analyse = (score: Score) => createAnalysisSession(score).update(score);

describe('projectSounding', () => {
  it('answers one sounding set once, for four surfaces at a time', () => {
    const sounding = projectSounding([60, 64, 67], {key: {tonic: 'C', mode: 'major'}});

    expect(sounding.naming.primary?.symbol).toBe('CM');
    expect(sounding.marks.map((mark) => mark.label)).toEqual(['C4', 'E4', 'G4']);
    expect(sounding.marks.map((mark) => mark.role)).toEqual(['root', 'third', 'fifth']);
    // Middle C is diatonic step 28, and the stave follows the SPELLING.
    expect(sounding.staff.marks.map((mark) => mark.diatonic)).toEqual([28, 30, 32]);
    expect(sounding.description).toBe('CM — C major');
  });

  it('never lets the docks disagree about a sounding pitch', () => {
    // The claim the whole module exists for: keyboard, stave and neck read one
    // answer, so the same pitch class carries the same role on all three.
    const sounding = projectSounding([43, 59, 62, 65], {key: {tonic: 'C', mode: 'major'}});
    const roleOfClass = new Map(
      sounding.marks.map((mark) => [((mark.midi % 12) + 12) % 12, mark.role]),
    );

    expect(sounding.naming.primary?.symbol).toBe('G7');
    for (const mark of sounding.staff.marks) {
      expect(mark.role).toBe(roleOfClass.get(((mark.midi % 12) + 12) % 12));
    }
    for (const dot of sounding.fret.marks) {
      expect(dot.role).toBe(roleOfClass.get(((dot.midi! % 12) + 12) % 12));
    }
    expect(sounding.fret.marks.length).toBeGreaterThan(0);
  });

  it('frames the neck the caller is holding', () => {
    const ukulele = projectSounding([60, 64, 67], {tuning: TUNINGS.ukulele});
    expect(ukulele.fret.strings).toBe(4);
    expect(ukulele.fret.stringLabels).toEqual(['G', 'C', 'E', 'A']);
    expect(ukulele.fret.inlays).toEqual([...TUNINGS.ukulele.inlays]);
  });

  it('preserves the retained domain search\'s playable shape and barre', () => {
    const c = projectSounding([60, 64, 67]);
    expect(c.fret.muted).toEqual([0]);
    expect(c.fret.marks.map((mark) => mark.fret)).toEqual([3, 2, 0, 1, 0]);
    expect(c.fret.firstFret).toBe(0);

    const f = projectSounding([53, 57, 60]);
    expect(f.fret.marks.map((mark) => mark.fret)).toEqual([1, 3, 3, 2, 1, 1]);
    expect(f.fret.barre).toEqual([{fret: 1, fromString: 0, toString: 5}]);
  });

  it('projects accidentals against the signature instead of repeating alterations', () => {
    const key = {tonic: 'G', mode: 'major'} as const;
    const natural = projectSounding([65], {key});
    const sharp = projectSounding([66], {key});
    expect(natural.staff.marks[0].accidental).toBe('natural');
    expect(sharp.staff.marks[0].accidental).toBeUndefined();
  });

  it('draws the key signature and stands up with nothing sounding', () => {
    const flats = projectSounding([], {key: {tonic: 'Eb', mode: 'major'}});
    expect(flats.marks).toEqual([]);
    expect(flats.staff.keySignature).toHaveLength(3);
    expect(flats.staff.keySignature?.[0].accidental).toBe('flat');
    expect(flats.naming.primary).toBeUndefined();
    expect(flats.fret.marks).toEqual([]);
    // A read-out with nothing to say still has something to print.
    expect(flats.naming.emptyLabel).toBe('—');
  });

  it('offers the other readings, ranked but never scored', () => {
    const sixth = projectSounding([60, 64, 67, 69]);
    expect(sixth.naming.primary?.symbol).toBe('C6');
    expect(sixth.naming.alternates?.map((entry) => entry.symbol)).toContain('Am7/C');
    expect(sixth.naming.alternates?.[0].note).toBe('inversion');
    // Rank is an ordinal. Presenting it as a confidence would invent a fact.
    expect(sixth.naming.confidence).toBeUndefined();
  });
});

describe('soundingMidisAt', () => {
  it('reads real octaves out of the score rather than inventing them', () => {
    const score = chorale();
    // A `ChordSegment` at this position carries {0, 4, 7} and no octaves at
    // all; these are the notes that are actually written.
    expect(soundingMidisAt(score, 0)).toEqual([60, 64, 67]);
    expect(soundingMidisAt(score, 9)).toEqual([55, 62, 71]);
  });

  it('answers a position between two attacks with the chord that is held', () => {
    const score = chorale();
    expect(soundingMidisAt(score, 2.5)).toEqual([60, 64, 67]);
  });

  it('never reads across a chord change, however close the change is', () => {
    const score = chorale();
    // The last instant of bar 1. A window that opens FORWARD reaches into bar 2
    // for its whole width and answers with both triads at once — six pitches
    // under a name plate that then blanks, because no chord is called
    // C-major-and-F-major. It happens at EVERY chord change, so it is what a
    // reader sees most.
    for (const at of [3.8, 3.9, 3.99]) expect(soundingMidisAt(score, at)).toEqual([60, 64, 67]);
    expect(soundingMidisAt(score, 4)).toEqual([60, 65, 69]);
  });

  it('holds the last attack through a rest, and past the double bar', () => {
    const score = scoreFrom({s: [['C4', 0, 1], ['E4', 4, 1]]});
    // A rest is not silence to a reader looking at a workbench: the honest
    // answer is the chord they last heard, which is what "docking is not
    // blankness" means at both ends of the piece.
    expect(soundingMidisAt(score, 1.1)).toEqual([60]);
    expect(soundingMidisAt(score, 5)).toEqual([64]);
  });
});

describe('projectProgression', () => {
  it('lays the chords out at their real duration, on two rulers', () => {
    const score = chorale();
    const lane = projectProgression(analyse(score), score, 'chords');
    const chords = lane.bands.filter((band) => band.track === 0);

    expect(chords.length).toBeGreaterThan(0);
    for (const band of chords) {
      // Seconds on the lane axis, quarters on the stamping axis. Two rulers,
      // because a ritardando must stretch the band and not the playhead's idea
      // of where the bar is.
      expect(band.end).toBeGreaterThan(band.start);
      expect(band.stampEnd!).toBeGreaterThan(band.stampStart!);
      expect(band.stampStart).not.toBe(band.start === 0 ? undefined : band.start);
    }
    expect(chords[0].primary).toContain('C');
    expect(chords[0].tone).toBe(0);
  });

  it('draws the sounding notes underneath, as the evidence for the names', () => {
    const score = chorale();
    const lane = projectProgression(analyse(score), score, 'chords');
    const roll = lane.bands.filter((band) => band.track === 1);

    expect(lane.tracks?.map((track) => track.id)).toEqual(['chords', 'sounding']);
    expect(roll).toHaveLength(score.notes.length);
    // Height is pitch: the bottom voice sits lowest in the row.
    const first = roll.slice(0, 3).map((band) => band.weight!);
    expect(Math.min(...first)).toBeLessThan(Math.max(...first));
    for (const band of roll) expect(band.primary).toBeUndefined();
  });

  it('pins the metrical position, and reads it parked at bar 1', () => {
    const score = chorale();
    const lane = projectProgression(analyse(score), score, 'chords');
    expect(lane.pinned?.secondary).toBe('bar 1 · beat 1');
    expect(lane.now).toBe(0);
    expect(lane.ruler?.[0]).toMatchObject({at: 0, label: '1'});
  });

  it('merges adjacent same-function segments into the phrase they make', () => {
    const score = chorale();
    const result = analyse(score);
    const lane = projectProgression(result, score, 'roman');

    expect(lane.tracks?.map((track) => track.id)).toEqual(['key', 'function', 'roman']);
    const numerals = lane.bands.filter((band) => band.track === 2);
    const functions = lane.bands.filter((band) => band.track === 1);
    expect(numerals).toHaveLength(result.roman.length);
    expect(functions.length).toBeLessThan(numerals.length);
    for (const band of functions) expect(['T', 'S', 'D']).toContain(band.primary);
    expect(lane.pinned?.secondary).toBe('in C major');
  });

  it('says so when the numerals are relative to a key it did not detect', () => {
    const silent = scoreFrom({s: [['C4', 0, 1]]});
    const lane = projectProgression(
      {...analyse(silent), key: {tonic: 'C', mode: 'major', confidence: 0, scores: []}},
      silent,
      'roman',
    );
    expect(lane.pinned?.secondary).toBe('Key unknown — numerals are relative to C major.');
    // The key strip and the function row are GONE, not muted. A band printing
    // `C major` next to a caption that says the key is unknown answers the same
    // question twice, once with a guess and once with an admission — and a
    // labelled row holding nothing is the static this redesign removes.
    expect(lane.tracks).toEqual([{id: 'roman', label: 'Numerals'}]);
    expect(lane.bands.every((band) => (band.track ?? 0) === 0)).toBe(true);
    expect(lane.bands.some((band) => band.primary === 'C major')).toBe(false);
    // …and the numerals still own the instant, wherever they were put.
    expect(lane.primaryTrack).toBe(0);
  });
});

describe('projectKeyFlow', () => {
  it('reads the key as evidence accumulating, not as an event', () => {
    const score = chorale();
    const lane = projectKeyFlow(score, {windowQuarters: 4});

    expect(lane.bands.length).toBeGreaterThan(0);
    for (const band of lane.bands) {
      expect(band.weight!).toBeGreaterThanOrEqual(0.25);
      expect(band.primary).toMatch(/ (major|minor)$/);
      expect(band.end).toBeGreaterThan(band.start);
    }
  });

  it('merges neighbouring windows that agree into one band', () => {
    const score = chorale();
    // Two windows of eight quarters, both reading C major, become one band —
    // which is what makes a long confident stretch LOOK like one.
    const coarse = projectKeyFlow(score, {windowQuarters: 8});
    expect(coarse.bands).toHaveLength(1);
    expect(coarse.bands[0].stampStart).toBe(0);
    expect(coarse.bands[0].stampEnd).toBe(16);
  });
});

describe('projectMotifFlow', () => {
  it('gives every appearance of a figure the same shape and the same group', () => {
    const score = withMotif();
    const lane = projectMotifFlow(analyse(score), score);

    expect(lane.tracks?.length).toBeGreaterThan(0);
    expect(lane.tracks?.[0].label).toBe('M1');
    expect(lane.tracks?.[0].sublabel).toMatch(/^×\d+$/);

    const group = lane.bands[0].group;
    const family = lane.bands.filter((band) => band.group === group);
    expect(family.length).toBeGreaterThan(1);
    // The visual rhyme is structural: one contour, drawn wherever it recurs.
    expect(family[1].points).toEqual(family[0].points);
    for (const point of family[0].points ?? []) {
      expect(point.at).toBeGreaterThanOrEqual(0);
      expect(point.at).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('projectVoiceFlow', () => {
  it('draws the voices, and puts the issues on top of them', () => {
    const parallels = scoreFrom({
      v1: [['C4', 0, 1], ['D4', 1, 1]],
      v2: [['G4', 0, 1], ['A4', 1, 1]],
    });
    const lane = projectVoiceFlow(analyse(parallels), parallels);

    expect(lane.tracks).toHaveLength(2);
    expect(lane.bands).toHaveLength(2);
    expect(lane.brackets!.length).toBeGreaterThan(0);
    const bracket = lane.brackets![0];
    // A bracket spans the two rows it implicates — the error is drawn ON the
    // counterpoint, not in a table beside it.
    expect(bracket.from).not.toBe(bracket.to);
    expect(bracket.severity).toBe('error');
    expect(bracket.label).toContain('parallel fifth');
    // Named by the ROW the reader can see. The gutter, the bracket and the
    // readable twin all say `voice 1` — one vocabulary, not the parser's
    // internal id in one place and a count from one in another.
    expect(bracket.label).toContain('voice 1');
    expect(lane.tracks!.map((track) => track.label)).toEqual(['voice 1', 'voice 2']);
    expect(lane.bands.map((band) => band.primary)).toEqual(['voice 1', 'voice 2']);
  });

  it('drops an issue it cannot draw rather than pinning it to the wrong voice', () => {
    // Eight voices, six rows. The parallel fifth is between the last two — the
    // two that did not get a row — and a bracket defaulting to row 0 would draw
    // it flat across a voice that did nothing. Legible and wrong is worse than
    // the table this replaced.
    const voices: Record<string, NoteSpec[]> = {};
    const line = (low: string, high: string): NoteSpec[] => [[low, 0, 1], [high, 1, 1]];
    voices.v1 = line('C4', 'C4');
    voices.v2 = line('E4', 'E4');
    voices.v3 = line('G4', 'G4');
    voices.v4 = line('C5', 'C5');
    voices.v5 = line('E5', 'E5');
    voices.v6 = line('G5', 'G5');
    voices.v7 = line('C3', 'D3');
    voices.v8 = line('G3', 'A3');
    const crowded = scoreFrom(voices);
    const result = analyse(crowded);
    const lane = projectVoiceFlow(result, crowded);

    expect(result.issues.length).toBeGreaterThan(0);
    expect(lane.tracks).toHaveLength(6);
    for (const bracket of lane.brackets ?? []) {
      expect(bracket.from).toBeLessThan(6);
      expect(bracket.to).toBeLessThan(6);
      // Never a zero-height bracket pinned to the top row.
      expect(bracket.from === 0 && bracket.to === 0).toBe(false);
    }
  });
});

describe('projectTonality', () => {
  it('keeps the wheel reading and the staff signature on one spelling', () => {
    const reading = {
      tonic: 'F#', mode: 'major', confidence: 0.8,
      scores: [
        {tonic: 'F#', mode: 'major', score: 1},
        {tonic: 'C', mode: 'major', score: 0},
      ],
    } as const;
    const tonality = projectTonality(reading);
    expect(tonality.centre.primary).toBe('G♭ major');
    expect(tonality.centre.key).toEqual({tonic: 'Gb', mode: 'major'});
    const staff = projectSounding([66, 70, 73], {key: tonality.centre.key}).staff;
    expect(staff.keySignature).toHaveLength(6);
    expect(staff.keySignature?.every((mark) => mark.accidental === 'flat')).toBe(true);
    expect(projectTonality(reading, {spelling: 'sharp'}).centre.key)
      .toEqual({tonic: 'F#', mode: 'major'});
  });

  it('does not restore a winner that the retained wheel rejected as a flat tie', () => {
    const tonality = projectTonality({
      tonic: 'C', mode: 'major', confidence: 0,
      scores: [
        {tonic: 'C', mode: 'major', score: 1},
        {tonic: 'G', mode: 'major', score: 1},
      ],
    });
    expect(tonality.centre.primary).toBe('—');
    expect(tonality.centre.key).toBeUndefined();
    expect(tonality.needle).toBeUndefined();
  });

  it('turns the ring to the reading and says how sure it is', () => {
    const score = chorale();
    const tonality = projectTonality(analyse(score).key);

    expect(tonality.outer).toHaveLength(12);
    expect(tonality.inner).toHaveLength(12);
    expect(tonality.outer[0].label).toBe('C');
    expect(tonality.needle?.at).toBe(0);
    // Adjacent, and in this order: the conclusion, then how far it stands out.
    expect(tonality.centre.primary).toBe('C major');
    expect(tonality.centre.secondary).toMatch(/^confidence \d+%$/);
  });

  it('stands the shape up before there is anything to read', () => {
    const empty = projectTonality(undefined);
    expect(empty.outer).toHaveLength(12);
    expect(empty.needle).toBeUndefined();
    expect(empty.outer.every((segment) => segment.weight === 0)).toBe(true);
    expect(empty.centre.primary).toBe('—');
  });
});

describe('projectKeyCandidates', () => {
  it('ranks the candidates against the winner', () => {
    const chips = projectKeyCandidates(analyse(chorale()).key);
    expect(chips).toHaveLength(5);
    expect(chips[0].meter).toBe(1);
    expect(chips[0].primary).toBe('C major');
    for (const chip of chips) expect(chip.meter!).toBeLessThanOrEqual(1);
  });

  it('is empty rather than wrong when nothing has been heard', () => {
    expect(projectKeyCandidates(undefined)).toEqual([]);
  });
});

describe('projectPitchClassMeters', () => {
  it('keeps the twelve bars in chromatic order, always', () => {
    const bins = distributions(chorale()).pitchClasses;
    const meters = projectPitchClassMeters(bins);
    // Sorting by weight would make a chart that rearranges itself while the
    // piece plays, which is a chart nobody can read.
    expect(meters.map((chip) => chip.id)).toEqual(
      Array.from({length: 12}, (_value, index) => `pc-${index}`),
    );
    expect(meters.map((chip) => chip.tone)).toEqual([...Array(12).keys()]);
    expect(Math.max(...meters.map((chip) => chip.meter!))).toBe(1);
  });

  it('draws what has been heard over the whole-piece answer', () => {
    const bins = distributions(chorale()).pitchClasses;
    const heard = bins.map((bin) => ({...bin, value: bin.value / 4}));
    const meters = projectPitchClassMeters(bins, {heard});
    expect(meters[0].meter!).toBeLessThan(meters[0].meterGhost!);
  });
});

describe('formatMetricalPosition', () => {
  it('reads a position in the written music, not in seconds', () => {
    const score = chorale();
    expect(formatMetricalPosition(score, 0)).toBe('bar 1 · beat 1');
    expect(formatMetricalPosition(score, 5)).toBe('bar 2 · beat 2');
    expect(formatMetricalPosition(score, 6.5)).toBe('bar 2 · beat 3.5');
  });
});
