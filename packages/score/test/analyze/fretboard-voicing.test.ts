import {describe, expect, it} from 'vitest';
import {spellChord, type ChordSpelling} from '../../src/analyze/core/chord-spelling';
import {
  DEFAULT_TUNING_ID,
  TUNINGS,
  fretPositionsFor,
  fretboardVoicing,
  resolveTuning,
  tuningLabels,
  type FretboardVoicing,
  type FretboardVoicingOptions,
} from '../../src/analyze/core/fretboard-voicing';

/** Every tuning the table answers for, so no test can quietly cover only six strings. */
const TUNING_IDS = ['standard', 'drop-d', 'dadgad', 'open-g', 'ukulele', 'bass'] as const;

/**
 * A spread wide enough that a bug shows up somewhere: a seventh with the root
 * on the bottom, a plain triad, two inversions, a half-diminished, a dyad
 * nothing can name and a single pitch.
 *
 * The doubled E is here for one rule alone: E sounds twice with two DIFFERENT
 * roles (`bass` underneath, `third` on top), so a board that took the highest
 * of them instead of the lowest disagrees with the stave about the same note.
 */
const CHORDS: readonly {name: string; midis: readonly number[]}[] = [
  {name: 'Cmaj7', midis: [48, 64, 67, 71]},
  {name: 'C', midis: [48, 52, 55]},
  {name: 'Am7', midis: [45, 60, 64, 67]},
  {name: 'Dm7', midis: [50, 65, 69, 72]},
  {name: 'G7', midis: [43, 59, 62, 65]},
  {name: 'Cmaj7 over E', midis: [52, 55, 59, 60]},
  {name: 'C over E with the E doubled', midis: [52, 55, 60, 64]},
  {name: 'F#m7b5', midis: [54, 57, 60, 64]},
  {name: 'a bare dyad', midis: [60, 64]},
];

/**
 * Twelve roots by eighteen qualities, for the properties that have to hold of
 * EVERY answer rather than of one pinned shape. 1296 (chord, tuning) pairs is
 * small enough to run in a test and wide enough that a rule with a hole in it
 * falls through somewhere.
 */
const QUALITIES: readonly (readonly number[])[] = [
  [0, 4, 7], [0, 3, 7], [0, 3, 6], [0, 4, 8], [0, 5, 7], [0, 2, 7],
  [0, 4, 7, 11], [0, 4, 7, 10], [0, 3, 7, 10], [0, 3, 6, 10], [0, 3, 6, 9],
  [0, 4, 7, 9], [0, 3, 7, 9], [0, 4, 8, 10], [0, 4, 6, 10],
  [0, 4, 7, 10, 14], [0, 4, 7, 11, 14], [0, 3, 7, 10, 14],
];

/** Every chord in the sweep, in every tuning, as `(where, spelling, voicing)`. */
function sweep(): {where: string; spelling: ChordSpelling; voicing: FretboardVoicing}[] {
  const rows: {where: string; spelling: ChordSpelling; voicing: FretboardVoicing}[] = [];
  for (let root = 0; root < 12; root += 1) {
    for (const quality of QUALITIES) {
      const spelling = spellChord(quality.map((step) => 48 + root + step));
      for (const id of TUNING_IDS) {
        rows.push({
          where: `${id} ${spelling.primary?.symbol ?? '?'}`,
          spelling,
          voicing: fretboardVoicing(spelling, {tuning: id}),
        });
      }
    }
  }
  return rows;
}

/** The shape as players write it down: `'x-3-2-0-1-0'`, `'x'` for a muted string. */
function shape(voicing: FretboardVoicing): string {
  return voicing.label;
}

/** `'string 4 fret 1'` reads better in a failure than a pair of numbers. */
function places(voicing: FretboardVoicing): string[] {
  return voicing.marks.map((mark) => `string ${mark.stringIndex} fret ${mark.fret}`);
}

/** What each dot says it is doing, in board order. */
function figures(voicing: FretboardVoicing): string[] {
  return voicing.marks.map((mark) => `${mark.noteName} ${mark.role} ${mark.label}`);
}

/** The fret on each string, `-1` for a muted one — the shape as the search holds it. */
function frets(voicing: FretboardVoicing): number[] {
  const held = voicing.tuning.midis.map(() => -1);
  for (const mark of voicing.marks) held[mark.stringIndex] = mark.fret;
  return held;
}

function voicingFor(midis: readonly number[], options: FretboardVoicingOptions = {}): FretboardVoicing {
  return fretboardVoicing(spellChord(midis), options);
}

/** Pitch class to the role and figure `spellChord` gave it — the answer the dots must repeat. */
function spelledByChroma(spelling: ChordSpelling): Map<number, string> {
  const table = new Map<number, string>();
  for (const pitch of spelling.pitches) {
    const chroma = ((pitch.midi % 12) + 12) % 12;
    if (!table.has(chroma)) table.set(chroma, `${pitch.role} ${pitch.degreeLabel}`);
  }
  return table;
}

describe('TUNINGS', () => {
  it('answers for the six tunings a player would ask for, by their own names', () => {
    expect(Object.keys(TUNINGS).sort()).toEqual([...TUNING_IDS].sort());
    expect(TUNING_IDS.map((id) => TUNINGS[id].name))
      .toEqual(['Standard', 'Drop D', 'DADGAD', 'Open G', 'Ukulele', 'Bass']);
    expect(TUNING_IDS.map((id) => TUNINGS[id].midis.length)).toEqual([6, 6, 6, 6, 4, 4]);
    expect(TUNINGS[DEFAULT_TUNING_ID]).toBe(TUNINGS.standard);
  });

  it('derives the open-string labels from the pitches instead of keeping a second table', () => {
    expect(TUNINGS.standard.labels.join(' ')).toBe('E A D G B E');
    expect(TUNINGS['drop-d'].labels.join(' ')).toBe('D A D G B E');
    expect(TUNINGS.dadgad.labels.join(' ')).toBe('D A D G A D');
    expect(TUNINGS['open-g'].labels.join(' ')).toBe('D G D G B D');
    expect(TUNINGS.ukulele.labels.join(' ')).toBe('G C E A');
    expect(TUNINGS.bass.labels.join(' ')).toBe('E A D G');
  });

  it('orders strings physically, which on the ukulele is NOT ascending pitch', () => {
    // Five of the six read as ascending pitch because their thickest string is
    // also their lowest. The ukulele's fourth string is G4, a FIFTH above the
    // third string's C4 — the re-entrant tuning every soprano uke ships with.
    for (const id of ['standard', 'drop-d', 'dadgad', 'open-g', 'bass'] as const) {
      const midis = TUNINGS[id].midis;
      expect([...midis].sort((a, b) => a - b), id).toEqual([...midis]);
    }
    expect(TUNINGS.ukulele.midis).toEqual([67, 60, 64, 69]);
    expect(TUNINGS.ukulele.midis[0]).toBeGreaterThan(TUNINGS.ukulele.midis[1]);
  });

  it('hands out frozen records, so one caller cannot retune everyone else', () => {
    expect(Object.isFrozen(TUNINGS)).toBe(true);
    expect(Object.isFrozen(TUNINGS.standard)).toBe(true);
    expect(Object.isFrozen(TUNINGS.standard.midis)).toBe(true);
    expect(Object.isFrozen(TUNINGS.standard.labels)).toBe(true);
  });
});

describe('resolveTuning', () => {
  it('reads a name the way an attribute would be written', () => {
    expect(resolveTuning('standard')).toBe(TUNINGS.standard);
    expect(resolveTuning('  Drop-D  ')).toBe(TUNINGS['drop-d']);
    expect(resolveTuning('DADGAD')).toBe(TUNINGS.dadgad);
  });

  it('reads a comma-separated MIDI list, and names it after its own strings', () => {
    const tuning = resolveTuning('40, 45, 50, 55, 59, 64');
    expect(tuning?.midis).toEqual(TUNINGS.standard.midis);
    expect(tuning?.id).toBe('custom');
    expect(tuning?.name).toBe('E A D G B E');
    expect(tuning?.labels).toEqual(TUNINGS.standard.labels);
  });

  it('also takes a plain array and an already-built tuning', () => {
    expect(resolveTuning([28, 33, 38, 43])?.labels.join(' ')).toBe('E A D G');
    const round = resolveTuning(TUNINGS.ukulele);
    expect(round?.midis).toEqual(TUNINGS.ukulele.midis);
    expect(round?.name).toBe('Ukulele');
  });

  it('returns undefined — never throws — for everything an attribute can get wrong', () => {
    const nonsense: unknown[] = [
      undefined,
      '',
      '   ',
      'drop-e', // a tuning nobody named
      '40,,45', // a hole in the list: Number('') is 0, which is a low C
      '40,x,45',
      '40.5,45,50',
      '40', // one string is not an instrument
      [40],
      '-1,40,45',
      '40,45,200', // outside MIDI
      Array.from({length: 13}, (_unused, index) => 40 + index),
      {},
      {midis: 'nope'},
      // Every one of these is a key of Object.prototype. A plain `TUNINGS[name]`
      // lookup answers `constructor` with the Object FUNCTION, and the caller
      // then reads `.midis.length` off it — an exception on the one path this
      // function promises never to throw on.
      'constructor',
      '__proto__',
      'toString',
      'valueOf',
      'hasOwnProperty',
    ];
    for (const spec of nonsense) {
      expect(() => resolveTuning(spec as never), String(spec)).not.toThrow();
      expect(resolveTuning(spec as never), String(spec)).toBeUndefined();
    }
  });
});

describe('fretPositionsFor', () => {
  it('finds every string that can sound one exact pitch, at most one fret each', () => {
    // Middle C sits at the 5th fret of the G string and the 1st of the B.
    expect(fretPositionsFor(60, TUNINGS.standard.midis)).toEqual([
      {stringIndex: 3, fret: 5},
      {stringIndex: 4, fret: 1},
    ]);
  });

  it('excludes the nut once the window starts above it', () => {
    // G3 is the open 4th string and the 5th fret of the D string.
    expect(fretPositionsFor(55, TUNINGS.standard.midis)).toEqual([
      {stringIndex: 2, fret: 5},
      {stringIndex: 3, fret: 0},
    ]);
    expect(fretPositionsFor(55, TUNINGS.standard.midis, {firstFret: 1}))
      .toEqual([{stringIndex: 2, fret: 5}]);
  });

  it('counts the window inclusively at both ends', () => {
    // `fretCount: 5` from the nut is the open string plus frets 1 to 5, which
    // is what a five-fret diagram draws, so fret 5 is inside it and fret 6 is not.
    expect(fretPositionsFor(55, TUNINGS.standard.midis, {fretCount: 5}))
      .toContainEqual({stringIndex: 2, fret: 5});
    expect(fretPositionsFor(55, TUNINGS.standard.midis, {fretCount: 4}))
      .toEqual([{stringIndex: 3, fret: 0}]);
  });

  it('returns an empty list, and never throws, for a pitch out of reach', () => {
    for (const midi of [0, 24, 127, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => fretPositionsFor(midi, TUNINGS.standard.midis)).not.toThrow();
      expect(fretPositionsFor(midi, TUNINGS.standard.midis), String(midi)).toEqual([]);
    }
    expect(fretPositionsFor(60, [])).toEqual([]);
  });

  it('never names a string the instrument does not have', () => {
    for (const id of TUNING_IDS) {
      const midis = TUNINGS[id].midis;
      for (let midi = 20; midi <= 90; midi += 1) {
        for (const position of fretPositionsFor(midi, midis, {fretCount: 24})) {
          expect(position.stringIndex, `${id} ${midi}`).toBeLessThan(midis.length);
          expect(position.fret, `${id} ${midi}`).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('does not assume the strings ascend, so a re-entrant ukulele still answers', () => {
    // C4 is the open 3rd string, index 1 — not index 0, which is the high G.
    expect(fretPositionsFor(60, TUNINGS.ukulele.midis)).toEqual([{stringIndex: 1, fret: 0}]);
    // And that high G sounds twice: open on the string above C4, and again at
    // the 3rd fret of the string below it. Only a re-entrant tuning does that.
    expect(fretPositionsFor(67, TUNINGS.ukulele.midis)).toEqual([
      {stringIndex: 0, fret: 0},
      {stringIndex: 2, fret: 3},
    ]);
  });
});

/**
 * The shapes a player TAKES, chord by chord — a chord book's first-position
 * page, in standard tuning, lowest string first.
 *
 * These are the point of the module. A technically-legal shape no hand can
 * form is worse than no answer at all, so this table is the acceptance test
 * for the search and not a snapshot of it: every row is a shape somebody has
 * played, and a change that moves one has to argue with a guitarist.
 *
 * Three rows are NOT what a chord book prints, and `instead` records what it
 * prints so the difference stays visible rather than quietly disappearing.
 * Each is one declared ranking key doing its declared job.
 */
const CHORD_BOOK: readonly {
  readonly name: string;
  readonly midis: readonly number[];
  readonly shape: string;
  readonly instead?: string;
  readonly why?: string;
}[] = [
  {name: 'C', midis: [48, 52, 55], shape: 'x-3-2-0-1-0'},
  {name: 'Cmaj7', midis: [48, 52, 55, 59], shape: 'x-3-2-0-0-0'},
  {
    name: 'C7',
    midis: [48, 52, 55, 58],
    shape: 'x-3-5-3-5-3',
    instead: 'x-3-2-3-1-0',
    // The open C7 has no G in it. Coverage is the first ranking key, so a
    // shape that sounds all four tones wins over one that sounds three, and
    // the fifth costs a finger at the 5th fret. What it buys is the A-shape
    // barre every book prints one page later, so this is a deviation towards
    // another real chord and not away from all of them.
    why: 'the chord-book shape drops the fifth',
  },
  {name: 'G', midis: [43, 47, 50], shape: '3-2-0-0-0-3'},
  {name: 'G7', midis: [43, 47, 50, 53], shape: '3-2-0-0-0-1'},
  {name: 'Gmaj7', midis: [43, 47, 50, 54], shape: '3-2-0-0-0-2'},
  {name: 'Dm', midis: [50, 53, 57], shape: 'x-x-0-2-3-1'},
  {name: 'B7', midis: [47, 51, 54, 57], shape: 'x-2-1-2-0-2'},
  {name: 'Am', midis: [45, 48, 52], shape: 'x-0-2-2-1-0'},
  {name: 'Am7', midis: [45, 48, 52, 55], shape: 'x-0-2-0-1-0'},
  {name: 'A', midis: [45, 49, 52], shape: 'x-0-2-2-2-0'},
  {name: 'A7', midis: [45, 49, 52, 55], shape: 'x-0-2-0-2-0'},
  {name: 'D', midis: [50, 54, 57], shape: 'x-x-0-2-3-2'},
  {name: 'D7', midis: [50, 54, 57, 60], shape: 'x-x-0-2-1-2'},
  {name: 'Dm7', midis: [50, 53, 57, 60], shape: 'x-x-0-2-1-1'},
  {name: 'Bm', midis: [47, 50, 54], shape: 'x-2-4-4-3-2'},
  {name: 'E', midis: [52, 56, 59], shape: '0-2-2-1-0-0'},
  {name: 'E7', midis: [52, 56, 59, 62], shape: '0-2-0-1-0-0'},
  {name: 'Em', midis: [52, 55, 59], shape: '0-2-2-0-0-0'},
  {
    name: 'Em7',
    midis: [52, 55, 59, 62],
    shape: '0-2-0-0-0-0',
    instead: '0-2-2-0-3-0',
    // Both are Em7 in first position with six strings sounding. Open strings
    // are the third key and this one has five of them to the book shape's
    // three — it is the same chord under one finger.
    why: 'five open strings beat three',
  },
  {name: 'F', midis: [53, 57, 60], shape: '1-3-3-2-1-1'},
  {
    name: 'Fmaj7',
    midis: [53, 57, 60, 64],
    shape: '1-3-2-2-1-0',
    instead: 'x-x-3-2-1-0',
    // Six strings against four, with the root underneath either way: the
    // strings-sounding key takes the barre. Among the six-string shapes the
    // fret-sum key then prefers the E on the D string to the F of the book's
    // other barre shape `1-3-3-2-1-0`.
    why: 'a six-string shape sounds more of it than the four-string one',
  },
  {name: 'Bb', midis: [58, 62, 65], shape: 'x-1-3-3-3-1'},
  {name: 'Cmaj7/E', midis: [52, 55, 59, 60], shape: '0-3-2-0-0-0'},
];

/** The same page for a soprano ukulele, whose G string sounds ABOVE its C. */
const UKULELE_BOOK: readonly {readonly name: string; readonly midis: readonly number[]; readonly shape: string}[] = [
  {name: 'Cmaj7', midis: [48, 52, 55, 59], shape: '0-0-0-2'},
  {name: 'C', midis: [48, 52, 55], shape: '0-0-0-3'},
  {name: 'Am', midis: [45, 48, 52], shape: '2-0-0-0'},
  {name: 'F', midis: [53, 57, 60], shape: '2-0-1-0'},
];

describe('fretboardVoicing', () => {
  it('takes the shapes a guitarist takes, chord by chord', () => {
    for (const row of CHORD_BOOK) {
      expect(shape(voicingFor(row.midis)), row.name).toBe(row.shape);
      // The three deviations are deviations from a DIFFERENT shape, not from
      // nothing — and this asks the FUNCTION, not the fixture. Comparing
      // `row.shape` with `row.instead` would be the table checking itself, and
      // would pass for an implementation that returned a constant.
      if (row.instead !== undefined) {
        expect(shape(voicingFor(row.midis)), row.name).not.toBe(row.instead);
      }
    }
    expect(CHORD_BOOK.filter((row) => row.instead !== undefined)).toHaveLength(3);
  });

  it('takes the shapes a ukulele player takes, on four re-entrant strings', () => {
    for (const row of UKULELE_BOOK) {
      expect(shape(voicingFor(row.midis, {tuning: 'ukulele'})), row.name).toBe(row.shape);
    }
  });

  it('reaches Cmaj7 in first position on a guitar', () => {
    const voicing = voicingFor([48, 64, 67, 71]);
    expect(shape(voicing)).toBe('x-3-2-0-0-0');
    expect(voicing.tuning).toBe(TUNINGS.standard);
    expect(voicing.firstFret).toBe(0);
    expect(voicing.span).toBe(2);
    expect(voicing.muted).toEqual([0]);
    expect(places(voicing)).toEqual([
      'string 1 fret 3',
      'string 2 fret 2',
      'string 3 fret 0',
      'string 4 fret 0',
      'string 5 fret 0',
    ]);
    // Five strings, four chord tones, the root on the bottom of them.
    expect(figures(voicing)).toEqual([
      'C root R',
      'E third 3',
      'G fifth 5',
      'B seventh 7',
      'E third 3',
    ]);
    // The low E is muted for a MUSICAL reason: it can only sound E, F, F# or
    // G down here, and every one of those is under the C.
    expect(voicing.marks.every((mark) => mark.midi >= 48)).toBe(true);
  });

  it('reaches the same chord on four open ukulele strings', () => {
    const voicing = voicingFor([48, 64, 67, 71], {tuning: 'ukulele'});
    expect(shape(voicing)).toBe('0-0-0-2');
    expect(voicing.firstFret).toBe(0);
    expect(voicing.span).toBe(1);
    expect(figures(voicing)).toEqual(['G fifth 5', 'C root R', 'E third 3', 'B seventh 7']);
    // Three open strings and one stopped: an open string is finger 0.
    expect(voicing.marks.map((mark) => mark.finger)).toEqual(['0', '0', '0', '1']);
  });

  it('says the same thing about a pitch that spellChord does', () => {
    // The whole reason this search takes a ChordSpelling instead of a MIDI
    // list: the board, the keyboard and the stave read one answer, so a
    // sounding C# cannot be a third on one surface and an extension on another.
    for (const id of TUNING_IDS) {
      for (const chord of CHORDS) {
        const spelling = spellChord(chord.midis);
        const expected = spelledByChroma(spelling);
        for (const mark of fretboardVoicing(spelling, {tuning: id}).marks) {
          expect(`${mark.role} ${mark.label}`, `${id} ${chord.name} pc ${mark.pitchClass}`)
            .toBe(expected.get(mark.pitchClass));
          expect(mark.midi % 12, `${id} ${chord.name}`).toBe(mark.pitchClass);
        }
      }
    }
  });

  it('sounds nothing that is not in the chord — R1', () => {
    for (const {where, spelling, voicing} of sweep()) {
      const tones = new Set(spelling.pitches.map((pitch) => ((pitch.midi % 12) + 12) % 12));
      for (const mark of voicing.marks) {
        expect(tones.has(mark.pitchClass), `${where} ${voicing.label} string ${mark.stringIndex}`).toBe(true);
      }
    }
  });

  it('puts the root underneath instead of answering a plain triad with an inversion — R2', () => {
    // `0-3-2-0-1-0` is the shape a per-string greedy falls into: it sounds C,
    // E and G, and a reader plays it and hears C/E under a name plate reading
    // C. The low E is muted for that reason and no other.
    const plain = voicingFor([48, 52, 55]);
    expect(spellChord([48, 52, 55]).primary?.symbol).toBe('CM');
    expect(shape(plain)).toBe('x-3-2-0-1-0');
    expect(plain.muted).toEqual([0]);
    expect(plain.marks[0].noteName).toBe('C');
    expect(plain.marks[0].role).toBe('root');

    // Five more the same rule fixes, each of which the greedy answered as an
    // inversion of itself.
    expect(shape(voicingFor([50, 54, 57]))).toBe('x-x-0-2-3-2'); //     not 2-0-0-2-3-2, a D/F#
    expect(shape(voicingFor([50, 53, 57, 60]))).toBe('x-x-0-2-1-1'); // not 1-0-0-2-1-1, a Dm7/F
    expect(shape(voicingFor([45, 48, 52]))).toBe('x-0-2-2-1-0'); //     not 0-0-2-2-1-0, an Am/E
    expect(shape(voicingFor([58, 62, 65]))).toBe('x-1-3-3-3-1'); //     not 1-1-0-3-3-1, a Bb/F
    expect(shape(voicingFor([48, 52, 55, 59]))).toBe('x-3-2-0-0-0'); // not 3-2-2-4-1-3, a Cmaj7/G

    // And the property, on every guitar: 216 chords a piece in four tunings,
    // and the lowest sounding pitch is the root of 863 of the 864.
    //
    // The two four-string instruments are the exceptions and both are the
    // ranking saying what it says it says — coverage outranks R2. A ukulele
    // cannot put a root under its own C string without losing half the chord;
    // a bass reaches C at its 8th fret and no lower, so twenty of its answers
    // (`Cm6` is one) keep the sixth and give up the bass note.
    //
    // `A#m9` is the ONE guitar answer that trades the same way, and it is
    // named here rather than excused by a wildcard. Five pitch classes on six
    // strings within one hand leaves no shape that sounds all of them, puts A#
    // underneath and can be held: coverage wins and F goes to the bottom. Any
    // OTHER chord joining it is a regression, which is what the list is for.
    const inverted: string[] = [];
    for (const {where, spelling, voicing} of sweep()) {
      if (where.startsWith('ukulele') || where.startsWith('bass')) continue;
      const root = spelling.primary?.rootPitchClass;
      if (root === undefined || voicing.marks.length === 0) continue;
      const lowest = voicing.marks.reduce((left, right) => (left.midi <= right.midi ? left : right));
      if (lowest.pitchClass !== root) inverted.push(`${where} ${voicing.label}`);
    }
    expect(inverted).toEqual(['standard A#m9 1-3-3-3-2-4']);
  });

  it('lets the re-entrant ukulele keep the chord instead of the bass note — R2', () => {
    // The uke's C string sounds UNDER both its neighbours, so `Am` played
    // `2-0-0-0` has a C at the bottom that no player can do anything about:
    // silencing it would break the run of sounding strings. R2 asks only for
    // what a hand could have muted, so the shape every uke book prints stands.
    const am = voicingFor([45, 48, 52], {tuning: 'ukulele'});
    expect(shape(am)).toBe('2-0-0-0');
    const lowest = am.marks.reduce((left, right) => (left.midi <= right.midi ? left : right));
    expect(lowest.midi).toBe(60);
    expect(lowest.role).toBe('third');
    // It is not that the root cannot be underneath — it is that paying for it
    // costs the third and half the neck.
    expect(shape(voicingFor([45, 48, 52], {tuning: 'ukulele', firstFret: 7}))).toBe('9-9-8-7');
  });

  it('never puts an open string where a finger is already holding it down — R3', () => {
    // `1-0-3-2-1-1` is the E-shape F with the A string ringing: the barre that
    // holds fret 1 on the low E and the top two strings is cut in two by that
    // open string, and frets 3 and 2 sit between its halves.
    expect(shape(voicingFor([53, 57, 60]))).toBe('1-3-3-2-1-1');
    expect(shape(voicingFor([58, 62, 65]))).toBe('x-1-3-3-3-1');

    // What R3 does NOT forbid is two fingers at one fret with an open string
    // between and nothing stopped higher — that is A7, and G's two fingers at
    // fret 3 with a LOWER one between them.
    expect(shape(voicingFor([45, 49, 52, 55]))).toBe('x-0-2-0-2-0');
    expect(shape(voicingFor([43, 47, 50]))).toBe('3-2-0-0-0-3');

    // Nor two fingers at one fret with a FRETTED string between them: that
    // finger lies in front of the pair, and it is what makes the D a D.
    expect(shape(voicingFor([50, 54, 57]))).toBe('x-x-0-2-3-2');
    expect(shape(voicingFor([47, 51, 54, 57]))).toBe('x-2-1-2-0-2');

    // The property: an OPEN or MUTED string in the gap between two fingers at
    // one fret cuts them apart, and then nothing in that gap may be stopped
    // higher than they are. A fretted string in the gap is not a cut — it is
    // another finger, and R8 is the rule that counts them.
    for (const {where, voicing} of sweep()) {
      const held = frets(voicing);
      const byFret = new Map<number, number[]>();
      for (const mark of voicing.marks) {
        if (mark.fret === 0) continue;
        byFret.set(mark.fret, [...(byFret.get(mark.fret) ?? []), mark.stringIndex]);
      }
      for (const [fret, strings] of byFret) {
        for (let index = 1; index < strings.length; index += 1) {
          let cut = false;
          for (let between = strings[index - 1] + 1; between < strings[index]; between += 1) {
            if (held[between] <= 0) cut = true;
          }
          if (!cut) continue;
          for (let between = strings[index - 1] + 1; between < strings[index]; between += 1) {
            expect(held[between], `${where} ${voicing.label} fret ${fret} across string ${between}`)
              .toBeLessThanOrEqual(fret);
          }
        }
      }
    }
  });

  it('lets only the INDEX lie flat with other fingers standing on it — R7', () => {
    // `2-4-3-3-2-1` is what the search answered F#maj7 with before R7: fret 2
    // is held on strings 0 and 4, so a MIDDLE finger lies flat across five
    // strings — with fingers 3 and 4 on top of it and the index stranded at
    // fret 1 on the far side. The E-shape barre is the shape that exists.
    expect(shape(voicingFor([54, 58, 61, 65]))).toBe('2-4-3-3-2-2');
    expect(shape(voicingFor([54, 57, 61, 65]))).toBe('2-4-3-2-2-2');
    // Same defect up the neck, and the same fix: a Cmaj7 that broke a perfectly
    // good barre to put one finger a fret lower now takes the barre.
    expect(shape(voicingFor([48, 52, 55, 59], {firstFret: 7}))).toBe('8-10-9-9-8-8');

    // And the property. A finger lying under another one — a string inside its
    // run stopped HIGHER than it — is a barre, and a barre is the hand's
    // lowest fret. Fingers sharing a HIGHER fret are ordinary and stay legal:
    // the A-shape's ring across three strings at fret 7 is not touched by this.
    for (const {where, voicing} of sweep()) {
      const held = frets(voicing);
      const byFinger = new Map<string, number[]>();
      for (const mark of voicing.marks) {
        if (mark.fret === 0 || mark.finger === undefined) continue;
        byFinger.set(mark.finger, [...(byFinger.get(mark.finger) ?? []), mark.stringIndex]);
      }
      const fretted = held.filter((fret) => fret > 0);
      if (fretted.length === 0) continue;
      const lowest = Math.min(...fretted);
      for (const [finger, strings] of byFinger) {
        if (strings.length < 2) continue;
        const fret = held[strings[0]];
        if (fret === lowest) continue;
        for (let between = strings[0] + 1; between < strings[strings.length - 1]; between += 1) {
          expect(held[between], `${where} ${voicing.label} finger ${finger} carries string ${between}`)
            .toBeLessThanOrEqual(fret);
        }
      }
    }
  });

  it('does not splay the hand around its own fingers — R8', () => {
    // `4-3-1-1-1-4` was the answer for Ab: an index barre at fret 1, the middle
    // at fret 3, and then the ring on the low E and the pinky on the high E,
    // both at fret 4, five strings apart with the whole hand in between.
    expect(shape(voicingFor([56, 60, 63]))).not.toBe('4-3-1-1-1-4');
    expect(shape(voicingFor([56, 59, 63]))).not.toBe('4-2-1-1-4-4');
    // `x-3-2-2-1-3` bought a doubled G with the same straddle. Dropping it is
    // what lets the open C6 be reachable at all.
    expect(shape(voicingFor([48, 52, 55, 57]))).not.toBe('x-3-2-2-1-3');

    // What R8 allows, because a hand does: two fingers at one fret with OPEN
    // strings between them, and one finger tucked up to two frets in front.
    expect(shape(voicingFor([43, 47, 50]))).toBe('3-2-0-0-0-3');
    expect(shape(voicingFor([48, 51, 55, 58, 62]))).toBe('x-3-1-3-3-3');
    expect(shape(voicingFor([48, 52, 55, 58]))).toBe('x-3-5-3-5-3');

    // The property: nothing three frets in front of a pair sharing a fret.
    for (const {where, voicing} of sweep()) {
      const held = frets(voicing);
      const byFret = new Map<number, number[]>();
      for (const mark of voicing.marks) {
        if (mark.fret === 0) continue;
        byFret.set(mark.fret, [...(byFret.get(mark.fret) ?? []), mark.stringIndex]);
      }
      for (const [fret, strings] of byFret) {
        for (let index = 1; index < strings.length; index += 1) {
          for (let between = strings[index - 1] + 1; between < strings[index]; between += 1) {
            if (held[between] <= 0) continue;
            expect(fret - held[between], `${where} ${voicing.label} string ${between} in front of fret ${fret}`)
              .toBeLessThanOrEqual(2);
          }
        }
      }
    }
  });

  it('needs no fifth finger, ever — R4', () => {
    // `3-2-2-4-1-3` is the shape the first draft of this module answered
    // Cmaj7 with: four frets wide, six strings, every pitch inside one hand's
    // reach, and five fingers to hold. It is not in the answer set now.
    expect(shape(voicingFor([48, 64, 67, 71]))).not.toBe('3-2-2-4-1-3');
    for (const {where, voicing} of sweep()) {
      const fingers = new Set<string>();
      for (const mark of voicing.marks) {
        if (mark.fret === 0) continue;
        // Every fretted dot is numbered. The number used to run out at four;
        // now the SHAPE runs out at four instead, so the diagram never prints
        // a dot it cannot advise on.
        expect(mark.finger, `${where} ${voicing.label} string ${mark.stringIndex}`).toBeDefined();
        fingers.add(mark.finger ?? '');
      }
      expect(fingers.size, `${where} ${voicing.label}`).toBeLessThanOrEqual(4);
    }
  });

  it('mutes only from the edges — R6', () => {
    // A silent string in the middle of a strum is a separate skill, and it is
    // also what would otherwise send the ukulele up to the 5th fret: `5-x-5-7`
    // is an Am with the root underneath and a hole in the middle.
    for (const {where, voicing} of sweep()) {
      const sounding = voicing.marks.map((mark) => mark.stringIndex);
      if (sounding.length === 0) continue;
      const first = sounding[0];
      const last = sounding[sounding.length - 1];
      expect(sounding, `${where} ${voicing.label}`)
        .toEqual(Array.from({length: last - first + 1}, (_unused, index) => first + index));
    }
  });

  it('ranks more of the chord first, and the guide tones inside that', () => {
    // Key 1. A voicing drops the fifth before it drops a third or a seventh:
    // the guide tones are what tell a major seventh from a minor one, and the
    // ear supplies a missing fifth for itself.
    const ninth = voicingFor([48, 52, 55, 58, 62], {tuning: 'bass'});
    expect(shape(ninth)).toBe('8-7-8-7');
    expect(ninth.marks.map((mark) => mark.role)).toEqual(['root', 'third', 'seventh', 'extension']);
    const minorNinth = voicingFor([48, 51, 55, 58, 62], {tuning: 'ukulele'});
    expect(shape(minorNinth)).toBe('3-3-3-3');
    expect(minorNinth.marks.map((mark) => mark.role)).toEqual(['seventh', 'third', 'fifth', 'root']);

    // And nowhere in 1296 answers does a shape drop a guide tone while
    // sounding the fifth. Flatten the weights and the two above are the first
    // to break.
    for (const {where, spelling, voicing} of sweep()) {
      const sounded = new Set(voicing.marks.map((mark) => mark.pitchClass));
      const missing = spelling.pitches.filter((pitch) => !sounded.has(((pitch.midi % 12) + 12) % 12));
      const roles = new Set(missing.map((pitch) => pitch.role));
      expect(roles.has('third') || roles.has('seventh'), `${where} ${voicing.label}`).toBe(false);
    }
  });

  it('ranks open strings above position, and position above string count', () => {
    // Key 3 against key 4. `Cmaj7/E` can be had at the 1st fret as
    // `0-2-2-0-1-0` — same six strings, same four tones — and the answer is
    // the 2nd-position shape because it has four open strings to that one's
    // three.
    expect(shape(voicingFor([52, 55, 59, 60]))).toBe('0-3-2-0-0-0');

    // Key 4 against key 5. Bm barred at the 7th fret sounds SIX strings to the
    // 2nd-position shape's five, and it is still the worse answer: a diagram
    // is something a reader has to find on their own neck.
    expect(shape(voicingFor([47, 50, 54], {firstFret: 7}))).toBe('7-9-9-7-7-7');
    expect(shape(voicingFor([47, 50, 54]))).toBe('x-2-4-4-3-2');
    // The same trade one fret lower down, for a chord everybody knows.
    expect(shape(voicingFor([48, 52, 55], {firstFret: 8}))).toBe('8-10-10-9-8-8');
    expect(shape(voicingFor([48, 52, 55]))).toBe('x-3-2-0-1-0');
  });

  it('ranks string count above the fret sum, and the fret sum above nothing', () => {
    // Key 5. `0-0-0-x` is the open C on a ukulele with the A string left out:
    // same three open strings, same coverage, one string fewer.
    expect(shape(voicingFor([48, 52, 55], {tuning: 'ukulele'}))).toBe('0-0-0-3');

    // Key 6. Two shapes tie on everything above it, and the one whose frets
    // add up to less is the one a hand travels less to hold.
    expect(shape(voicingFor([53, 57, 60, 64, 67], {tuning: 'dadgad'}))).toBe('3-3-2-0-0-2');
  });

  it('answers the same shape for the same chord, however it was voiced', () => {
    // Nothing in the ranking depends on the order candidates were walked in,
    // so a chord read an octave lower draws the same diagram.
    expect(shape(voicingFor([36, 40, 43]))).toBe('x-3-2-0-1-0');
    expect(shape(voicingFor([60, 64, 67]))).toBe('x-3-2-0-1-0');
    expect(shape(voicingFor([48, 52, 55, 64, 67]))).toBe('x-3-2-0-1-0');

    // BELOW the piano too. A pitch class is a remainder and `-12 % 12` is
    // `-0` in this language, so a chroma taken without the second wrap turns
    // every negative MIDI number into a chord the board cannot find at all.
    expect(spellChord([-12, -8, -5]).pitches.map((pitch) => pitch.name)).toEqual(['C-2', 'E-2', 'G-2']);
    expect(shape(voicingFor([-12, -8, -5]))).toBe('x-3-2-0-1-0');
  });

  it('settles two shapes that tie on every musical key, in one direction', () => {
    // Key 6, the last word: the frets read left to right, LOWER first. That
    // the answer is stable is tested above; this pins which of the two stable
    // answers it is, at a position the rest of the file never visits.
    expect(shape(voicingFor([48, 52, 55], {firstFret: 22, lastFret: 24}))).toBe('24-22-22-x-x-x');
  });

  it('answers from the memo without answering a different question', () => {
    // One cache, keyed on the spelling AND on every option that moves the
    // shape. A second call is the same object; a different window, a different
    // hand or a different instrument is a different answer.
    const spelling = spellChord([48, 52, 55, 59]);
    const first = fretboardVoicing(spelling);
    expect(fretboardVoicing(spelling)).toBe(first);
    expect(fretboardVoicing(spelling, {tuning: 'standard'})).toBe(first);
    expect(shape(fretboardVoicing(spelling, {tuning: 'ukulele'}))).toBe('0-0-0-2');
    expect(shape(fretboardVoicing(spelling, {firstFret: 5}))).toBe('8-10-9-9-8-8');
    expect(shape(fretboardVoicing(spelling, {span: 1}))).toBe('x-x-5-5-5-x');
    expect(shape(fretboardVoicing(spelling, {minStrings: 6}))).toBe('8-10-9-9-8-8');
    // `lastFret` moves the shape like the rest of them, and it is the one a
    // memo keyed on four of the five options would serve stale.
    expect(shape(fretboardVoicing(spelling, {lastFret: 2}))).toBe('0-2-2-0-1-0');
    expect(shape(fretboardVoicing(spelling, {lastFret: 1}))).toBe('x-x-x-0-1-0');
    expect(shape(fretboardVoicing(spelling, {firstFret: 5, lastFret: 8}))).toBe('7-7-5-5-5-x');

    // The tuning is HANDED BACK on the answer, so its identity is part of the
    // question even though its strings are what move the shape. These three
    // ask for the same six strings under three different names, and each has
    // to get its own name back — assert `tuning.id`, not the shape, because
    // the shape is identical by construction and cannot catch this.
    expect(fretboardVoicing(spelling, {tuning: '40,45,50,55,59,64'}).tuning.id).toBe('custom');
    expect(fretboardVoicing(spelling, {tuning: '40,45,50,55,59,64'}).tuning.name).toBe('E A D G B E');
    expect(fretboardVoicing(spelling, {tuning: 'standard'}).tuning.name).toBe('Standard');
    const mine = fretboardVoicing(spelling, {
      tuning: {id: 'my-guitar', name: 'My Guitar', midis: [40, 45, 50, 55, 59, 64], labels: []},
    });
    expect(mine.tuning.id).toBe('my-guitar');
    expect(mine.tuning.name).toBe('My Guitar');
    expect(shape(mine)).toBe('x-3-2-0-0-0');
    expect(shape(fretboardVoicing(spelling, {tuning: [67, 60, 64, 69]}))).toBe('0-0-0-2');
    expect(shape(fretboardVoicing(spelling))).toBe('x-3-2-0-0-0');
  });

  it('marks the slash bass as the bass, not as a third', () => {
    const voicing = voicingFor([52, 55, 59, 60]);
    const spelling = spellChord([52, 55, 59, 60]);
    expect(spelling.primary?.symbol).toBe('Cmaj7/E');
    const roles = new Map(voicing.marks.map((mark) => [mark.pitchClass, mark.role]));
    expect(roles.get(4)).toBe('bass');
    expect(roles.get(0)).toBe('root');
    // A shape that dropped either the root or the slash bass would be a
    // different chord under the same name plate.
    expect(voicing.marks.some((mark) => mark.pitchClass === 0)).toBe(true);
    expect(voicing.marks.some((mark) => mark.pitchClass === 4)).toBe(true);
  });

  it('puts the slash bass UNDER the chord, not merely somewhere in it', () => {
    // `Cmaj7/E` sounds the same four pitch classes as `Cmaj7`, so a search
    // that only checked membership answers both with the same shape. It does
    // not: the low E string sounds the bass here and is muted there, which is
    // the one move a hand has and what a chord book prints.
    const over = voicingFor([52, 55, 59, 60]);
    expect(shape(over)).toBe('0-3-2-0-0-0');
    expect(over.muted).toEqual([]);
    expect(shape(voicingFor([48, 52, 55, 59]))).toBe('x-3-2-0-0-0');

    // Unlike the plain root, a DECLARED bass is a filter and not a ranking
    // key: every naming with a slash, in every tuning, has it at the bottom.
    const slashes: readonly (readonly number[])[] = [
      [52, 55, 59, 60], // Cmaj7/E
      [60, 64, 69], //     Am/C
      [47, 50, 55], //     G/B
      [52, 55, 60, 64], // C/E
      [53, 57, 62], //     Dm/F
      [55, 60, 64], //     C/G
      [48, 53, 57], //     F/C
    ];
    for (const id of TUNING_IDS) {
      for (const midis of slashes) {
        const spelling = spellChord(midis);
        const bass = spelling.primary?.bassPitchClass;
        const voicing = fretboardVoicing(spelling, {tuning: id});
        const where = `${id} ${spelling.primary?.symbol ?? '?'}`;
        expect(bass, where).not.toBeUndefined();
        if (voicing.marks.length === 0) continue;
        const lowest = voicing.marks.reduce((left, right) => (left.midi <= right.midi ? left : right));
        expect(lowest.pitchClass, where).toBe(bass);
      }
    }
    // The three a chord book prints, since the slash chords are exactly the
    // shapes the old generator could only reach by climbing the neck.
    expect(shape(voicingFor([55, 60, 64]))).toBe('3-3-2-0-1-0');
    expect(shape(voicingFor([48, 53, 57]))).toBe('x-3-3-2-1-1');
    expect(shape(voicingFor([47, 50, 55]))).toBe('x-2-0-0-0-3');
  });

  it('always sounds the root, in every tuning, for every chord it answers at all', () => {
    for (const id of TUNING_IDS) {
      for (const chord of CHORDS) {
        const spelling = spellChord(chord.midis);
        const voicing = fretboardVoicing(spelling, {tuning: id});
        if (voicing.marks.length === 0) continue;
        const anchor = spelling.primary?.rootPitchClass ?? ((spelling.pitches[0].midi % 12) + 12) % 12;
        expect(voicing.marks.map((mark) => mark.pitchClass), `${id} ${chord.name}`).toContain(anchor);
      }
    }
  });

  it('answers every chord anyone would ask about, in every tuning', () => {
    // An empty board is the honest answer to an impossible ask, and it must
    // stay a rare one: five rules and a ranking are only useful if the search
    // still finds something for 1296 (chord, tuning) pairs.
    for (const {where, voicing} of sweep()) {
      expect(voicing.marks.length, where).toBeGreaterThanOrEqual(3);
    }
  });

  it('returns an empty shape rather than a wrong one when the root is out of the window', () => {
    // A one-fret window at the 2nd fret of a guitar sounds B and E and nothing
    // else — no C, so there is no Cmaj7 to draw here.
    const voicing = voicingFor([48, 64, 67, 71], {firstFret: 2, lastFret: 2, span: 1});
    expect(voicing.marks).toEqual([]);
    expect(voicing.muted).toEqual([]);
    expect(voicing.label).toBe('');
    expect(voicing.span).toBe(0);
    expect(voicing.tuning).toBe(TUNINGS.standard);

    // One pitch on a ukulele reaches at most two strings anywhere on the neck,
    // and a shape has to sound three: an empty answer, not a two-dot guess.
    expect(voicingFor([60], {tuning: 'ukulele'}).label).toBe('');
    // Nothing sounding is nothing to draw.
    expect(fretboardVoicing(spellChord([]), {tuning: 'bass'}).label).toBe('');
  });

  it('never throws, whatever the caller passes', () => {
    const cluster = Array.from({length: 13}, (_unused, index) => 48 + index);
    const abuse: FretboardVoicingOptions[] = [
      {tuning: 'drop-e'},
      {tuning: ''},
      {tuning: [] as readonly number[]},
      {tuning: '40,,45'},
      {span: 0},
      {span: -4},
      {span: Number.NaN},
      {firstFret: -12, lastFret: -1},
      {firstFret: 20, lastFret: 3},
      {minStrings: 99},
      {minStrings: 0},
      {firstFret: Number.NaN, lastFret: Number.POSITIVE_INFINITY, span: 2},
      // Infinity is caught by the finite check; a LARGE FINITE number is the
      // one that would walk every fret it names, and `last-fret` is an
      // attribute a typo can write.
      {lastFret: 1e7},
      {firstFret: 1e7},
      {span: 1e7},
    ];
    for (const options of abuse) {
      for (const midis of [[], [60], cluster, [48, 64, 67, 71]]) {
        expect(() => voicingFor(midis, options), JSON.stringify(options)).not.toThrow();
      }
    }
    // An unresolvable tuning falls back rather than blanking the board — the
    // element is the layer that warns about the attribute.
    expect(voicingFor([48, 64, 67, 71], {tuning: 'drop-e'}).tuning).toBe(TUNINGS.standard);
  });

  it('clamps the window and the hand to sizes that exist', () => {
    // A neck ends and so does a hand: the search may be told to look further
    // than either, and answers within both anyway.
    for (const id of TUNING_IDS) {
      for (const chord of CHORDS) {
        const wild = fretboardVoicing(spellChord(chord.midis), {tuning: id, span: 99, lastFret: 1e7});
        const where = `${id} ${chord.name}`;
        for (const mark of wild.marks) expect(mark.fret, where).toBeLessThanOrEqual(24);
        expect(wild.span, where).toBeLessThanOrEqual(5);
      }
    }
    // Asking for a hand ten frets wide is asking for a five-fret one — the
    // widest reach the module will describe as a shape a hand takes.
    expect(shape(voicingFor([48, 51, 54], {span: 5}))).toBe('x-3-1-5-1-2');
    expect(shape(voicingFor([48, 51, 54], {span: 99}))).toBe('x-3-1-5-1-2');
    expect(shape(voicingFor([48, 51, 54]))).toBe('x-3-4-5-4-x');

    // The fret clamp, asked where it BINDS. At the default position the
    // ranking never sends a shape near fret 24 anyway, so `lastFret: 1e7`
    // there proves nothing; push the window up to the last fret and the clamp
    // is the only thing between the answer and fret 25.
    const top = voicingFor([48, 52, 55], {firstFret: 24, lastFret: 1e7});
    expect(top.label).toBe('');
    expect(top.marks).toEqual([]);
    for (const mark of voicingFor([48, 52, 55], {firstFret: 21, lastFret: 1e7}).marks) {
      expect(mark.fret).toBeLessThanOrEqual(24);
    }

    // A position past the last fret is the last fret, and the window it opens
    // ends there too: `firstFret: 24, span: 4` cannot reach fret 27.
    const past = voicingFor([48, 64, 67, 71], {firstFret: 1e7});
    expect(past.firstFret).toBe(24);
    expect(past.marks).toEqual([]);
    for (const mark of voicingFor([48, 64, 67, 71], {firstFret: 20, lastFret: 40}).marks) {
      expect(mark.fret).toBeLessThanOrEqual(24);
    }
  });

  it('answers a twelve-string tuning without freezing the tab', () => {
    // The clamps bound the RANGE the loop walks; they do not bound the WORK,
    // and the walk multiplies by roughly five per added string. A twelve-string
    // tuning over a dense chord — both of which the API accepts — used to cost
    // seventeen seconds at every default and about ten minutes with the two
    // options below it, on the main thread, on every chord change.
    const twelve = Array.from({length: 12}, (_unused, index) => 28 + index * 4);
    const cluster = Array.from({length: 12}, (_unused, index) => 48 + index);
    for (const options of [{}, {lastFret: 24}, {span: 5}, {span: 5, lastFret: 24}]) {
      const started = Date.now();
      const voicing = fretboardVoicing(spellChord(cluster), {tuning: twelve, ...options});
      expect(Date.now() - started, JSON.stringify(options)).toBeLessThan(2000);
      // And the budget buys a legal shape, never a wrong one: every rule runs
      // before a candidate becomes the incumbent, so abandoning the walk can
      // only answer a worse shape than an exhaustive one would.
      expect(voicing.marks.length, JSON.stringify(options)).toBeGreaterThanOrEqual(3);
      expect(voicing.label.split('-')).toHaveLength(12);
    }
  });

  it('stays inside the hand and inside the instrument, in every tuning', () => {
    for (const id of TUNING_IDS) {
      const tuning = TUNINGS[id];
      for (const chord of CHORDS) {
        for (const span of [3, 4, 5]) {
          const voicing = fretboardVoicing(spellChord(chord.midis), {tuning: id, span});
          const where = `${id} ${chord.name} span ${span}`;
          const held = voicing.marks.map((mark) => mark.fret);
          const fretted = held.filter((fret) => fret > 0);
          for (const mark of voicing.marks) {
            expect(mark.stringIndex, where).toBeLessThan(tuning.midis.length);
            expect(mark.fret, where).toBeGreaterThanOrEqual(0);
            expect(mark.midi, where).toBe(tuning.midis[mark.stringIndex] + mark.fret);
          }
          if (fretted.length > 0) {
            expect(Math.max(...fretted) - Math.min(...fretted) + 1, where).toBeLessThanOrEqual(span);
            expect(voicing.span, where).toBe(Math.max(...fretted) - Math.min(...fretted) + 1);
          } else {
            expect(voicing.span, where).toBe(0);
          }
          // The diagram starts at the nut when anything is open, and at the
          // lowest fretted fret when nothing is.
          if (voicing.marks.length > 0) {
            expect(voicing.firstFret, where)
              .toBe(held.some((fret) => fret === 0) ? 0 : Math.min(...fretted));
          }
          // Every string is accounted for exactly once, and the written shape
          // is the same fact in the players' notation.
          const strings = [...voicing.marks.map((mark) => mark.stringIndex), ...voicing.muted];
          if (voicing.marks.length > 0) {
            expect([...strings].sort((a, b) => a - b), where)
              .toEqual(tuning.midis.map((_unused, index) => index));
            expect(voicing.label.split('-').length, where).toBe(tuning.midis.length);
          }
        }
      }
    }
  });

  it('mutes a string it could not use, and writes it as x', () => {
    // Two notes with no name: the G string can only sound G, G#, A or A# down
    // here and none of them is C or E, so the shape leaves first position
    // rather than putting a hole in the middle of a strum.
    const voicing = voicingFor([60, 64], {span: 4});
    expect(shape(voicing)).toBe('x-3-2-5-5-x');
    expect(voicing.muted).toEqual([0, 5]);
    expect(voicing.marks.map((mark) => mark.stringIndex)).toEqual([1, 2, 3, 4]);
    // Nothing names a bare dyad, so every dot is honestly 'other' with no figure.
    expect(new Set(voicing.marks.map((mark) => mark.role))).toEqual(new Set(['other']));
    expect(new Set(voicing.marks.map((mark) => mark.label))).toEqual(new Set(['.']));
  });

  it('reports one barre at a time, at the shape lowest fretted fret', () => {
    // E minor: the 2nd fret on two adjacent strings with nothing open between.
    const minor = voicingFor([52, 55, 59]);
    expect(shape(minor)).toBe('0-2-2-0-0-0');
    expect(minor.barre).toEqual({fret: 2, firstString: 1, lastString: 2});

    // Open G tuning reaches the same chord as 2-0-2-0-0-2. The 2nd fret is
    // still the lowest, but every pair of strings holding it has an open
    // string between: a finger laid there would stop it, so no barre at all.
    const spread = voicingFor([52, 55, 59], {tuning: 'open-g'});
    expect(shape(spread)).toBe('2-0-2-0-0-2');
    expect(spread.barre).toBeUndefined();

    // One fretted string at the lowest fret is a finger, not a barre.
    expect(voicingFor([48, 52, 55]).barre).toBeUndefined();

    // Four fretted strings and four fingers: nothing here has to lie flat, so
    // nothing is reported as doing it. Bb7 used to be dressed with a barre
    // across strings 3 to 5 because the grouping merged whatever shared a fret
    // whether or not the hand needed it to.
    const seventh = voicingFor([58, 62, 65, 68]);
    expect(shape(seventh)).toBe('x-1-0-1-3-1');
    expect(seventh.barre).toBeUndefined();

    // Three strings in a row at one fret IS a finger laid flat, and the hand
    // takes it that way whether or not it has fingers to spare.
    const dmaj7 = voicingFor([50, 54, 57, 61]);
    expect(shape(dmaj7)).toBe('x-x-0-2-2-2');
    expect(dmaj7.barre).toEqual({fret: 2, firstString: 3, lastString: 5});

    // But break that run with a string stopped higher and it is three fingers,
    // which is how every teacher writes the D: 1 on the G, 3 on the B, 2 on
    // the high E. The old grouping printed `barre 2 across strings 3 to 5` and
    // told a beginner to squeeze a second finger inside their own first one.
    const plainD = voicingFor([50, 54, 57]);
    expect(shape(plainD)).toBe('x-x-0-2-3-2');
    expect(plainD.barre).toBeUndefined();
    expect(plainD.marks.map((mark) => mark.finger)).toEqual(['0', '1', '3', '2']);

    // The full six-string barre, which is what fret 1 is doing in an F: six
    // strings is two more than a hand has, so the index carries three of them.
    const barred = voicingFor([53, 57, 60]);
    expect(shape(barred)).toBe('1-3-3-2-1-1');
    expect(barred.barre).toEqual({fret: 1, firstString: 0, lastString: 5});

    // And here fret 1 is held on the bottom two strings and the top two, with
    // the D and G strings stopped at fret 3 between them. Four fingers is
    // enough to COUNT them, but not to place them: a finger laid flat needs
    // the length of the fret and cannot step over the ring the way a fingertip
    // steps over it in a D. So the index takes all six, and the diagram says
    // so rather than printing two two-string fingers a hand cannot make.
    const sus = voicingFor([53, 58, 60]);
    expect(shape(sus)).toBe('1-1-3-3-1-1');
    expect(sus.barre).toEqual({fret: 1, firstString: 0, lastString: 5});
    expect(sus.marks.map((mark) => mark.finger)).toEqual(['1', '1', '2', '2', '1', '1']);

    // The rule reads both sides of the gap, so here it is with the flat finger
    // on each in turn. The E-shape Cm barre up the neck holds one string at
    // fret 8, two at fret 10, then three more at fret 8: the flat finger is on
    // the RIGHT of the gap, and read as separate fingers it is a three-string
    // finger stepping over the ring.
    const shifted = voicingFor([48, 51, 55], {firstFret: 7});
    expect(shape(shifted)).toBe('8-10-10-8-8-8');
    expect(shifted.barre).toEqual({fret: 8, firstString: 0, lastString: 5});
    expect(shifted.marks.map((mark) => mark.finger)).toEqual(['1', '2', '2', '1', '1', '1']);

    // And the same chord in open G puts the flat finger on the LEFT of it.
    const mirrored = voicingFor([48, 51, 55], {tuning: 'open-g', firstFret: 5});
    expect(shape(mirrored)).toBe('x-5-5-8-8-5');
    expect(mirrored.barre).toEqual({fret: 5, firstString: 1, lastString: 5});
    expect(mirrored.marks.map((mark) => mark.finger)).toEqual(['1', '1', '2', '2', '1']);

    // The WIDEST group at the lowest fret, not the narrowest and not the first.
    // DADGAD's Eb holds fret 1 on strings 0 to 2 and again on strings 4 to 5,
    // with the open G string between: three strings under one finger, and two
    // under another.
    const dadgadEb = voicingFor([51, 55, 58], {tuning: 'dadgad'});
    expect(shape(dadgadEb)).toBe('1-1-1-0-1-1');
    expect(dadgadEb.barre).toEqual({fret: 1, firstString: 0, lastString: 2});

    // And where two are equally wide, the FIRST by string — so the answer
    // never depends on which the walk happened to find first. Both of these
    // hold their lowest fret on two strings, twice over.
    const dadgadCsus4 = voicingFor([48, 53, 55], {tuning: 'dadgad'});
    expect(shape(dadgadCsus4)).toBe('x-3-3-0-3-3');
    expect(dadgadCsus4.barre).toEqual({fret: 3, firstString: 1, lastString: 2});
    const openAbmaj7 = voicingFor([56, 60, 63, 67], {tuning: 'open-g'});
    expect(shape(openAbmaj7)).toBe('x-1-1-0-1-1');
    expect(openAbmaj7.barre).toEqual({fret: 1, firstString: 1, lastString: 2});

    // Nothing above the lowest fret is ever reported as a second barre: the
    // shape has exactly one lowest fret, so it has at most one barre.
    for (const {where, voicing} of sweep()) {
      const barre = voicing.barre;
      if (barre === undefined) continue;
      const held = voicing.marks.map((mark) => mark.fret);
      expect(barre.fret, where).toBe(Math.min(...held.filter((fret) => fret > 0)));
      expect(barre.lastString, where).toBeGreaterThan(barre.firstString);
      // Both ends hold the barre fret, and nothing under it needs a lower
      // one, an open string or a mute.
      const at = (stringIndex: number) =>
        voicing.marks.find((mark) => mark.stringIndex === stringIndex)?.fret ?? -1;
      expect(at(barre.firstString), where).toBe(barre.fret);
      expect(at(barre.lastString), where).toBe(barre.fret);
      for (let index = barre.firstString + 1; index < barre.lastString; index += 1) {
        expect(at(index), `${where} string ${index}`).toBeGreaterThanOrEqual(barre.fret);
      }
    }
  });

  it('numbers one finger per fret it can actually be laid across', () => {
    // Frets 2 and 3 take one finger each, lowest first, and an open string is
    // finger 0.
    expect(voicingFor([48, 64, 67, 71]).marks.map((mark) => mark.finger))
      .toEqual(['2', '1', '0', '0', '0']);
    // A barre takes finger 1 across both strings it covers.
    expect(voicingFor([52, 55, 59]).marks.map((mark) => mark.finger))
      .toEqual(['0', '1', '1', '0', '0', '0']);
    // Fret 2 on the D string and fret 2 on the B string are TWO fingers: the
    // open G between them is exactly what one flat finger cannot do.
    expect(voicingFor([45, 49, 52, 55]).marks.map((mark) => mark.finger))
      .toEqual(['0', '1', '0', '2', '0']);
    // And a finger DOES lie under a string stopped higher up: one finger holds
    // the whole of fret 1 in an F, four frets of chord over the top of it.
    expect(voicingFor([53, 57, 60]).marks.map((mark) => mark.finger))
      .toEqual(['1', '3', '3', '2', '1', '1']);
  });

  it('never asks one finger to be in two places, in any tuning', () => {
    // This number is printed inside the dot on a diagram, so a wrong one is
    // worse than an absent one: two dots may share a finger only when it can
    // lie flat from the first to the second.
    for (const {where, voicing} of sweep()) {
      const held = new Map(voicing.marks.map((mark) => [mark.stringIndex, mark.fret]));
      const shared = new Map<string, number[]>();
      for (const mark of voicing.marks) {
        if (mark.finger === undefined || mark.finger === '0') continue;
        shared.set(mark.finger, [...(shared.get(mark.finger) ?? []), mark.stringIndex]);
      }
      for (const [finger, strings] of shared) {
        const fret = held.get(strings[0]);
        // One finger, one fret: it cannot press two of them.
        for (const stringIndex of strings) {
          expect(held.get(stringIndex), `${where} finger ${finger}`).toBe(fret);
        }
        for (let index = strings[0] + 1; index < strings[strings.length - 1]; index += 1) {
          expect(held.get(index) ?? -1, `${where} finger ${finger} crosses string ${index}`)
            .toBeGreaterThanOrEqual(fret ?? 0);
        }
      }
    }
  });

  it('prints the note name without its octave, negative octaves included', () => {
    // A guitar re-octavates freely, so the dot says `C` and not `C4`. Below
    // MIDI 12 the spelled name is `C-1`, and a rule that only stripped digits
    // would print `C-` on the diagram.
    expect(spellChord([0, 4, 7]).pitches.map((pitch) => pitch.name)).toEqual(['C-1', 'E-1', 'G-1']);
    expect(voicingFor([0, 4, 7], {tuning: 'bass'}).marks.map((mark) => mark.noteName))
      .toEqual(['C', 'E', 'G']);
  });

  it('works on a four-string bass and never assumes six strings', () => {
    const voicing = voicingFor([48, 64, 67, 71], {tuning: 'bass'});
    expect(voicing.tuning.midis).toHaveLength(4);
    // A bass reaches C at its 8th fret and nowhere lower, and the root goes
    // underneath there rather than the B of a first-position shape.
    expect(shape(voicing)).toBe('8-10-9-9');
    expect(shape(voicingFor([48, 52, 55], {tuning: 'bass'}))).toBe('x-3-2-0');
    expect(figures(voicingFor([48, 52, 55], {tuning: 'bass'})))
      .toEqual(['C root R', 'E third 3', 'G fifth 5']);
    // Four labels, four frets, four strings — the written shape counts strings,
    // not guitars.
    expect(voicing.label.split('-')).toHaveLength(4);
  });

  it('reads the ukulele re-entrantly: string 0 is the high G, not the lowest note', () => {
    const voicing = voicingFor([45, 60, 64, 67], {tuning: 'ukulele'});
    expect(shape(voicing)).toBe('0-0-0-0');
    // All four open, and the highest-numbered string sounds the LOWEST role
    // in the chord's own reading — the root A, up on the 1st string.
    expect(voicing.marks.map((mark) => mark.midi)).toEqual([67, 60, 64, 69]);
    expect(voicing.marks.map((mark) => mark.role)).toEqual(['seventh', 'third', 'fifth', 'root']);
  });
});

describe('the instrument, not just its strings', () => {
  it('carries the position dots of the neck', () => {
    // Nothing else in the repo knows where a neck's dots go, and a presenter
    // drawing one has nowhere else to read them from. They are a fact about the
    // INSTRUMENT, so every guitar tuning wears the same pattern.
    expect(TUNINGS.standard.inlays).toEqual([3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);
    expect(TUNINGS.dadgad.inlays).toEqual([...TUNINGS.standard.inlays]);
    expect(TUNINGS['drop-d'].inlays).toEqual([...TUNINGS.standard.inlays]);
    expect(TUNINGS.bass.inlays).toEqual([...TUNINGS.standard.inlays]);
    // A ukulele's are its own, and they are fewer.
    expect(TUNINGS.ukulele.inlays).toEqual([5, 7, 10, 12]);
    for (const id of TUNING_IDS) {
      expect(Object.isFrozen(TUNINGS[id].inlays), id).toBe(true);
    }
    // A tuning nobody named is a guitar until told otherwise.
    expect(resolveTuning('40,45,50,55,59,64')?.inlays).toEqual([...TUNINGS.standard.inlays]);
  });

  it('stops each neck where that neck stops', () => {
    expect(TUNINGS.standard.frets).toBe(24);
    expect(TUNINGS.ukulele.frets).toBe(15);
    // The window is clamped to the NECK and not to the longest neck anyone
    // builds. Without this a soprano ukulele answers `17-19-20-19`, which is a
    // chord box for an instrument nobody is holding.
    const high = fretboardVoicing(spellChord([60, 64, 67, 71]), {
      tuning: 'ukulele',
      firstFret: 16,
      lastFret: 24,
    });
    for (const mark of high.marks) expect(mark.fret).toBeLessThanOrEqual(15);
    expect(high.firstFret).toBeLessThanOrEqual(15);
    // A guitar is unaffected: 24 frets is 24 frets.
    const guitar = fretboardVoicing(spellChord([60, 64, 67, 71]), {firstFret: 16, lastFret: 24});
    expect(guitar.marks.length).toBeGreaterThan(0);
    for (const mark of guitar.marks) expect(mark.fret).toBeLessThanOrEqual(24);
  });

  it('answers a name a reader is likely to type', () => {
    // `tuning="uke"` used to resolve to nothing and fall back to a guitar,
    // which is a six-string chord box under a nameplate reading Ukulele.
    expect(resolveTuning('uke')).toBe(TUNINGS.ukulele);
    expect(resolveTuning('guitar')).toBe(TUNINGS.standard);
    expect(resolveTuning('dropd')).toBe(TUNINGS['drop-d']);
    expect(resolveTuning('drop d')).toBe(TUNINGS['drop-d']);
    expect(resolveTuning('drop_d')).toBe(TUNINGS['drop-d']);
    expect(resolveTuning('OPEN G')).toBe(TUNINGS['open-g']);
    expect(resolveTuning('openg')).toBe(TUNINGS['open-g']);
    // And an alias table that cannot be walked into: a Map, not an object.
    for (const hostile of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(resolveTuning(hostile), hostile).toBeUndefined();
    }
  });

  it('names a string from a spelling and never from a chroma table', () => {
    // An Eb-tuned guitar is `Eb Ab Db Gb Bb Eb` on every chart in print. The
    // fixed sharp table prints `D# G# C# F# A# D#` next to a nameplate reading
    // `Eb`: two panels in one frame, two spellings of one note.
    const eFlat = resolveTuning('39,44,49,54,58,63');
    expect(eFlat).toBeDefined();
    expect(tuningLabels(eFlat!, {key: {tonic: 'Eb', mode: 'major'}}))
      .toEqual(['D#', 'G#', 'C#', 'F#', 'A#', 'D#'].map((name) => FLAT_FOR[name]));
    expect(tuningLabels(eFlat!, {spelling: 'sharp', key: {tonic: 'Eb', mode: 'major'}}))
      .toEqual(['D#', 'G#', 'C#', 'F#', 'A#', 'D#']);
    // With no key it spells sharps and says so, rather than pretending to have
    // chosen: nothing inside a tuning prefers `Eb` to `D#`.
    expect(tuningLabels(eFlat!)).toEqual(['D#', 'G#', 'C#', 'F#', 'A#', 'D#']);
    expect(tuningLabels(TUNINGS.standard)).toEqual([...TUNINGS.standard.labels]);
    // It asks where the key SITS, never what it signs — the clamped answer is
    // 0 for a theoretical key and would spell F-flat major sharp.
    expect(tuningLabels(eFlat!, {key: {tonic: 'Fb', mode: 'major'}})[0]).toBe('Eb');
  });

  it('says which chord tone a hand could not reach', () => {
    // A read-out that draws five dots for a six-note chord should be able to
    // say which note went, rather than leaving a reader to assume it is in
    // there somewhere.
    expect(voicingFor([60, 64, 67]).missing).toEqual([]);
    const wide = fretboardVoicing(spellChord([60, 64, 67, 70, 74, 77, 81]), {tuning: 'ukulele'});
    for (const chroma of wide.missing) {
      expect(wide.marks.map((mark) => mark.pitchClass)).not.toContain(chroma);
    }
    expect([...wide.missing]).toEqual([...wide.missing].sort((a, b) => a - b));
    // An empty answer voiced nothing, so nothing is missing FROM it.
    expect(fretboardVoicing(spellChord([])).missing).toEqual([]);
  });
});

/** The flat spelling of each sharp name, so the expectation above reads as a table. */
const FLAT_FOR: Readonly<Record<string, string>> = {
  'D#': 'Eb',
  'G#': 'Ab',
  'C#': 'Db',
  'F#': 'Gb',
  'A#': 'Bb',
};
