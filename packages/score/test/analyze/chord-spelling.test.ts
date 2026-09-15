import {describe, expect, it} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, scoreNotes, type Note} from '../../src/core';
import {
  FLAT_NAMES,
  NO_CHORD_LABEL,
  SHARP_NAMES,
  spellChord,
  spellChordNotes,
  toneMarkFor,
  type ChordSpelling,
  type SpellChordOptions,
  type ToneRole,
} from '../../src/analyze/core/chord-spelling';

/** The job every sounding pitch is given, low to high. */
function roles(spelling: ChordSpelling): ToneRole[] {
  return spelling.pitches.map((pitch) => pitch.role);
}

/** The same jobs, order-free — what a role SET assertion is really about. */
function roleSet(spelling: ChordSpelling): ToneRole[] {
  return [...new Set(roles(spelling))].sort();
}

/** One line per pitch: `'Ab4 seventh 7'`. The whole read-out of a chord. */
function figures(spelling: ChordSpelling): string[] {
  return spelling.pitches.map((pitch) => `${pitch.name} ${pitch.role} ${pitch.degreeLabel}`);
}

function names(spelling: ChordSpelling): string[] {
  return spelling.pitches.map((pitch) => pitch.name);
}

function symbols(spelling: ChordSpelling): string[] {
  return spelling.namings.map((naming) => naming.symbol);
}

/** Notes carrying a REAL notated spelling, the way a parsed score would. */
function notated(pitchNames: readonly string[]): readonly Note[] {
  const builder = new ScoreBuilder();
  const partId = builder.newPartId();
  builder.addPart({id: partId, name: 'Test'});
  const voice = VoiceId(`${partId}-v1`);
  for (const name of pitchNames) {
    builder.addNote(partId, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(name),
      onsetQuarters: new Rational(0, 4),
      duration: new Duration({base: new Rational(4, 4)}),
      voice,
    });
  }
  return scoreNotes(builder.build());
}

describe('spellChord (naming and roles)', () => {
  it('hears E-G-B-C as a C major seventh over its own third, and calls the E the BASS', () => {
    // The single most easily-got-wrong case in this design. `(pc - rootPc + 12) % 12`
    // makes E a THIRD, which is true of the chord and false of this voicing: the
    // lowest sounding pitch is what a reader needs told, and the slash in the
    // symbol is the same fact. Get this wrong and every read-out reads a slash
    // chord as root position.
    const spelling = spellChord([52, 55, 59, 60]);
    expect(spelling.primary).toMatchObject({symbol: 'Cmaj7/E', root: 'C', bass: 'E', kind: 'primary'});
    expect(spelling.label).toBe('Cmaj7/E');
    expect(spelling.primary?.fullName).toBe('C major seventh over E');
    expect(roles(spelling)).toEqual(['bass', 'fifth', 'seventh', 'root']);
    expect(spelling.pitches[0]).toMatchObject({name: 'E3', role: 'bass'});
    expect(spelling.pitches[3]).toMatchObject({name: 'C4', role: 'root'});
    // The E is the bass AND the chord's third, so the mark says both. It has
    // to: the mark is the colour's second channel, and a reader looking at a
    // greyscale print of a bare `3` cannot tell a bass from a third.
    expect(spelling.pitches[0].degreeLabel).toBe('B3');
    // And the figures are counted from the ROOT, not from the bass. Tonal's own
    // `get('Cmaj7/E').intervals` is bass-relative — ['3M','5P','7M','8P'] —
    // which would call the C an OCTAVE. Assert the interval itself: the label
    // reduces a compound and would hide the difference.
    expect(spelling.pitches.map((pitch) => pitch.interval)).toEqual(['3M', '5P', '7M', '1P']);
  });

  it('reads a first-inversion major triad as one, not as the augmented chord Tonal ranks first', () => {
    // detect() weights root position 1 and an inversion 0.5, so E-G-C comes back
    // as `Em#5` (E-G-B#, a chord no lead sheet writes) ahead of `CM/E`. Left
    // alone that is EVERY first-inversion major triad in the language, and the
    // spelling moves the note on the stave with it: B#4 instead of C5.
    const spelling = spellChord([64, 67, 72]);
    expect(spelling.label).toBe('CM/E');
    expect(names(spelling)).toEqual(['E4', 'G4', 'C5']);
    expect(figures(spelling)).toEqual(['E4 bass B3', 'G4 fifth 5', 'C5 root R']);
    // Demoted, not dropped: the reading is still on offer.
    expect(symbols(spelling)).toEqual(['CM/E', 'Em#5']);
    // Second inversions too, and the double sharp goes with them.
    expect(spellChord([68, 71, 76]).label).toBe('EM/G#');
    expect(names(spellChord([68, 71, 76]))).toEqual(['G#4', 'B4', 'E5']);
    expect(spellChord([75, 80, 84]).label).toBe('G#M/D#');
  });

  it('refuses a name that leaves a sounding pitch unexplained', () => {
    // detect() offers `Cb9sus` for C-Db-F-G-Bb, meaning "C, flat ninth,
    // suspended" — and Tonal reads the symbol back with a C-FLAT tonic. The
    // sounding root then prints as the BASS, F and G both print `5` (neither is
    // a fifth of C-flat), and every figure moves a semitone. detect's own
    // second candidate is the same chord, correctly rooted.
    const spelling = spellChord([60, 61, 65, 67, 70]);
    expect(spelling.label).toBe('C11b9');
    expect(spelling.primary).toMatchObject({root: 'C', rootPitchClass: 0});
    expect(figures(spelling)).toEqual([
      'C4 root R', 'Db4 extension b9', 'F4 extension 11', 'G4 fifth 5', 'Bb4 seventh 7',
    ]);
    // No two pitches may claim the same degree.
    const printed = spelling.pitches.map((pitch) => pitch.degreeLabel);
    expect(new Set(printed).size).toBe(printed.length);
    // Same shape on B: a B7sus(b9) must not be read as a B-FLAT chord.
    expect(spellChord([71, 72, 76, 78, 81]).primary?.root).toBe('B');
  });

  it('names every inversion of a minor-major seventh, not only its root position', () => {
    // detect() answers `'Cm/ma7/D#'` — a slash bass appended to a type whose own
    // alias already contains a slash — and `get()` cannot read that back. The
    // tonic chord of harmonic minor is the most common chord in the repertoire,
    // and left alone this module could name it in exactly one voicing.
    expect(spellChord([60, 63, 67, 71]).label).toBe('Cm/ma7');
    for (const midis of [[63, 67, 71, 72], [67, 71, 72, 75], [71, 72, 75, 79]]) {
      const spelling = spellChord(midis);
      expect(spelling.primary, `${midis}`).toMatchObject({root: 'C', kind: 'primary'});
      expect(spelling.label, `${midis}`).toContain('Cm/ma7');
      expect(roleSet(spelling), `${midis}`).not.toEqual(['other']);
    }
    const first = spellChord([63, 67, 71, 72]);
    expect(figures(first)).toEqual(['D#4 bass B3', 'G4 fifth 5', 'B4 seventh 7', 'C5 root R']);
    expect(first.primary?.bass).toBe('D#');
  });

  it('offers both readings of C-E-G-A, each with its own set of jobs', () => {
    const sixth = spellChord([60, 64, 67, 69]);
    expect(symbols(sixth)).toEqual(['C6', 'Am7/C']);
    expect(sixth.namings.map((naming) => naming.kind)).toEqual(['primary', 'inversion']);
    expect(roleSet(sixth)).toEqual(['extension', 'fifth', 'root', 'third']);

    // Clicking the alternate name is `prefer`, and every role is recomputed
    // against it: the same four keys, a different four jobs.
    const minorSeventh = spellChord([60, 64, 67, 69], {prefer: 'Am7/C'});
    expect(minorSeventh.primary).toMatchObject({symbol: 'Am7/C', root: 'A', kind: 'primary'});
    expect(symbols(minorSeventh)).toContain('C6');
    expect(roleSet(minorSeventh)).toEqual(['bass', 'fifth', 'root', 'seventh']);
    expect(roles(minorSeventh)).toEqual(['bass', 'fifth', 'seventh', 'root']);
  });

  it('prints something honest for every set nothing can name', () => {
    // `detect()` returns [] for one note, two notes and a full chromatic
    // cluster. A read-out that went blank in those states would go blank in the
    // middle of a performance, so the fallback is the pitch names themselves.
    const silence = spellChord([]);
    expect(silence.label).toBe(NO_CHORD_LABEL);
    expect(silence.namings).toEqual([]);
    expect(silence.primary).toBeUndefined();
    expect(silence.pitches).toEqual([]);

    const cluster = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72];
    for (const midis of [[60], [60, 61], cluster]) {
      const spelling = spellChord(midis);
      expect(spelling.namings).toEqual([]);
      expect(spelling.primary).toBeUndefined();
      expect(spelling.label.length).toBeGreaterThan(0);
      // No naming means no root to measure against, so no pitch gets a job.
      expect(roleSet(spelling)).toEqual(['other']);
      expect(spelling.pitches.map((pitch) => pitch.degreeLabel)).toEqual(spelling.pitches.map(() => '.'));
    }
    expect(spellChord([60]).label).toBe('C');
    expect(spellChord([60, 61]).label).toBe('C C#');
    expect(spellChord(cluster).pitches).toHaveLength(13);
  });
});

describe('spellChord (a preferred symbol must still name what is sounding)', () => {
  it('keeps the semitone table for a pitch the chosen naming does not cover', () => {
    // `prefer: 'C'` names a plain triad over a dominant seventh's four pitches.
    // The Bb is outside that naming, so it has no interval to read and falls
    // back to the table — a plausible job rather than a blank.
    const spelling = spellChord([60, 64, 67, 70], {prefer: 'C'});
    expect(spelling.primary?.symbol).toBe('C');
    expect(spelling.pitches[3]).toMatchObject({role: 'seventh', degreeLabel: '7'});
    expect(spelling.pitches[3].interval).toBeUndefined();
    expect(spelling.pitches[0].interval).toBe('1P');
  });

  it('gives that fallback figure a TRUE name, not the role generic', () => {
    // A role is a coarse bucket — 2, 4, 6, 9, 11 and 13 all land on
    // `'extension'` — so printing `toneMarkFor(role)` here would write `9` on a
    // perfect fourth and `9` on a major sixth. Both are wrong about an interval
    // that is perfectly well known, and `degreeLabel` exists to be right.
    expect(figures(spellChord([60, 64, 67, 69], {prefer: 'CM'}))).toEqual([
      'C4 root R', 'E4 third 3', 'G4 fifth 5', 'A4 extension 6',
    ]);
    expect(figures(spellChord([60, 64, 65, 67], {prefer: 'CM'}))[2]).toBe('F4 extension 4');
    expect(figures(spellChord([60, 61, 64, 67], {prefer: 'CM'}))[1]).toBe('C#4 extension b9');
    expect(figures(spellChord([60, 64, 66, 67], {prefer: 'CM'}))[2]).toBe('F#4 fifth b5');
  });

  it('drops a preference that shares no pitch with what is sounding', () => {
    // A workbench that carries `prefer` across a moving playhead hits this on
    // the very next beat. `Cmaj7` over a sounding D-F#-A-C# would print three
    // figures that are false — F# as a `5`, A as a `9`, C# as a `9` — under a
    // name whose root is not being played at all.
    const stale = spellChord([62, 66, 69, 73], {prefer: 'Cmaj7'});
    expect(stale.label).toBe('Dmaj7');
    expect(symbols(stale)).not.toContain('Cmaj7');
    expect(stale).toEqual(spellChord([62, 66, 69, 73]));
    // Nor one whose root is silent and whose tones do not cover the set.
    expect(spellChord([60, 63, 66, 69], {prefer: 'A#dim7'}).label).toBe('Cdim7');
    // But a preference whose ROOT is sounding stands, even partly covering.
    expect(spellChord([65, 69, 72, 76], {prefer: 'Cmaj7'}).label).toBe('Cmaj7');
    // And a rootless one stands when it covers everything: C-E-G-B as Am9.
    expect(spellChord([60, 64, 67, 71], {prefer: 'Am9'}).label).toBe('Am9');
  });

  it("lists a chord once, under the caller's own spelling of it", () => {
    // `'C'` and `'CM'` are one chord under two symbols, and a nameplate showing
    // both would be offering the reader a choice that is not one.
    const spelling = spellChord([60, 64, 67], {prefer: 'C'});
    expect(symbols(spelling)).toEqual(['C', 'Em#5/C']);
    expect(spelling.namings.map((naming) => naming.kind)).toEqual(['primary', 'inversion']);
  });

  it('ignores a symbol Tonal cannot parse at all', () => {
    expect(spellChord([60, 64, 67], {prefer: 'Xyz'})).toEqual(spellChord([60, 64, 67]));
  });
});

describe('spellChord (spelling follows the naming, under every preference)', () => {
  it('ships a sharp table and a flat table, twelve entries each', () => {
    // `pitch-class.ts`'s NOTE_NAMES is a fixed mixed table that can emit neither
    // `D#` nor `Db`, so a preference needs these two.
    expect(SHARP_NAMES).toHaveLength(12);
    expect(FLAT_NAMES).toHaveLength(12);
    expect(SHARP_NAMES[1]).toBe('C#');
    expect(FLAT_NAMES[1]).toBe('Db');
  });

  it("names pitch class 1 D-flat under 'flat' and C-sharp under 'sharp', and lets the NAME spell", () => {
    // The table picks between enharmonic READINGS; the winning reading then
    // spells its own notes. C# major writes its third `E#` and D-flat major
    // writes `F` — the same key on a keyboard, a line apart on the stave.
    const flat = spellChord([61, 65, 68], {spelling: 'flat'});
    expect(flat.label).toBe('DbM');
    expect(names(flat)).toEqual(['Db4', 'F4', 'Ab4']);
    expect(flat.pitches[1]).toMatchObject({step: 'F', alter: 0, diatonic: 31});

    const sharp = spellChord([61, 65, 68], {spelling: 'sharp'});
    expect(sharp.label).toBe('C#M');
    expect(names(sharp)).toEqual(['C#4', 'E#4', 'G#4']);
    expect(sharp.pitches[1]).toMatchObject({step: 'E', alter: 1, diatonic: 30});
    // A forced table that overrode the name's own letters would label this
    // `C#M` and draw C#-F-G#: a major triad written as a diminished fourth.
    expect(sharp.pitches.map((pitch) => pitch.pitchClass)).toEqual(flat.pitches.map((pitch) => pitch.pitchClass));
  });

  it('takes the first occurrence when the primary spells one chroma twice', () => {
    // `get('Em#5/C').notes` is ["C","E","G","B#"] — four names for three pitch
    // classes, with `B#` repeating C's. The list's own order is the only
    // ranking Tonal offers, and the alternative reads C5 as B#4, a line away.
    const spelling = spellChord([60, 64, 67, 72], {prefer: 'Em#5/C'});
    expect(spelling.primary?.symbol).toBe('Em#5/C');
    expect(names(spelling)).toEqual(['C4', 'E4', 'G4', 'C5']);
    expect(spelling.pitches.map((pitch) => pitch.diatonic)).toEqual([28, 30, 32, 35]);
  });

  it('reaches for the other table rather than write a double sharp on a natural key', () => {
    // The live note-on path has no key to go on. Asked with sharps, D#-G-A#
    // comes back `D#M` spelled `D# F## A#` — which is a correct spelling of a
    // chord every musician reads as E-flat major. The retry cannot fire until
    // the first answer already carries a double accidental.
    expect(names(spellChord([63, 67, 70]))).toEqual(['Eb4', 'G4', 'Bb4']);
    expect(spellChord([63, 67, 70]).label).toBe('EbM');
    expect(names(spellChord([70, 74, 77]))).toEqual(['Bb4', 'D5', 'F5']);
    // A caller that has chosen a side keeps it, double accidental or not.
    expect(names(spellChord([63, 67, 70], {spelling: 'sharp'}))).toEqual(['D#4', 'F##4', 'A#4']);
    expect(names(spellChord([63, 67, 70], {key: {tonic: 'B', mode: 'major'}}))).toEqual(['D#4', 'F##4', 'A#4']);
  });

  it('derives the octave from the LETTER, so a spelling may cross the octave line', () => {
    // B#3 and C4 are one key, and Cb4 is B3. Taking the octave from the MIDI
    // number alone puts every such pitch a full octave out on the stave, and
    // nothing else in the read-out would show it.
    const sharp = spellChord([60, 63, 67], {prefer: 'B#m'});
    expect(names(sharp)).toEqual(['B#3', 'D#4', 'F##4']);
    expect(sharp.pitches.map((pitch) => pitch.diatonic)).toEqual([27, 29, 31]);
    expect(sharp.pitches[0]).toMatchObject({midi: 60, octave: 3, pitchClass: 0});

    const flat = spellChord([59], {prefer: 'CbM'});
    expect(names(flat)).toEqual(['Cb4']);
    expect(flat.pitches[0]).toMatchObject({midi: 59, octave: 4, diatonic: 28, pitchClass: 11});
  });
});

describe('spellChordNotes (a notated spelling is never thrown away)', () => {
  it("keeps the score's own letters even against an opposing preference", () => {
    // The one thing a score must never do. `spelling` is ignored here, and the
    // stave line follows the notation.
    const flatKeys = notated(['Gb4', 'Bb4', 'Db5']);
    for (const options of [{}, {spelling: 'sharp'}, {spelling: 'flat'}] as SpellChordOptions[]) {
      const spelling = spellChordNotes(flatKeys, options);
      expect(names(spelling), JSON.stringify(options)).toEqual(['Gb4', 'Bb4', 'Db5']);
      expect(spelling.label, JSON.stringify(options)).toBe('GbM');
    }
    expect(spellChordNotes(notated(['B#3', 'D#4', 'F##4'])).pitches.map((pitch) => pitch.diatonic))
      .toEqual([27, 29, 31]);
  });

  it('puts F#4 and Gb4 on different lines, which is the whole reason it exists', () => {
    const sharp = spellChordNotes(notated(['F#4', 'A4', 'C#5']));
    const flat = spellChordNotes(notated(['Gb4', 'A4', 'C#5']));
    expect(sharp.pitches[0]).toMatchObject({name: 'F#4', step: 'F', diatonic: 31});
    expect(flat.pitches[0]).toMatchObject({name: 'Gb4', step: 'G', diatonic: 32});
    expect(sharp.pitches[0].midi).toBe(flat.pitches[0].midi);
  });

  it('still names, still dedupes by key, and still hands back one job per pitch', () => {
    const doubled = spellChordNotes(notated(['C4', 'C4', 'E4', 'G4']));
    expect(doubled.label).toBe('CM');
    expect(names(doubled)).toEqual(['C4', 'E4', 'G4']);
    expect(figures(doubled)).toEqual(['C4 root R', 'E4 third 3', 'G4 fifth 5']);
    expect(spellChordNotes([])).toMatchObject({label: NO_CHORD_LABEL, pitches: [], namings: []});
  });
});

describe('spellChord (figures read off the naming, not off a semitone count)', () => {
  it('calls a diminished seventh a seventh, though it sounds like a sixth', () => {
    // `get('Bdim7').intervals` is ['1P','3m','5d','7d']: the Ab is nine
    // semitones above the B, exactly like C6's sixth, and a different job.
    const spelling = spellChord([59, 62, 65, 68]);
    expect(spelling.primary?.symbol).toBe('Bdim7');
    expect(figures(spelling)).toEqual(['B3 root R', 'D4 third 3', 'F4 fifth b5', 'Ab4 seventh 7']);
    expect(spelling.pitches[3].interval).toBe('7d');
  });

  it('calls a suspended fourth a fourth, and gives the chord no third at all', () => {
    // Five semitones above the root is a suspended fourth here and a raised
    // eleventh elsewhere; no table can tell them apart, and a sus chord has no
    // third for a table to find.
    const spelling = spellChord([60, 65, 67]);
    expect(spelling.primary?.symbol).toBe('Csus4');
    expect(figures(spelling)).toEqual(['C4 root R', 'F4 extension 4', 'G4 fifth 5']);
    expect(roles(spelling)).not.toContain('third');
  });

  it('figures an altered dominant as the lead sheet writes it', () => {
    expect(figures(spellChord([60, 64, 67, 70, 73]))).toEqual([
      'C4 root R', 'E4 third 3', 'G4 fifth 5', 'Bb4 seventh 7', 'Db5 extension b9',
    ]);
    // A raised ninth is three semitones above the root and is NOT a third; a
    // raised eleventh is six and is NOT a fifth.
    expect(figures(spellChord([60, 64, 67, 70, 75]))[4]).toBe('D#5 extension #9');
    expect(figures(spellChord([60, 64, 67, 70, 78]))[4]).toBe('F#5 extension #11');
  });

  it('figures an altered fifth, and keeps a sixth apart from a ninth', () => {
    expect(figures(spellChord([60, 64, 68]))).toEqual(['C4 root R', 'E4 third 3', 'G#4 fifth #5']);
    expect(figures(spellChord([60, 63, 66, 70]))[2]).toBe('Gb4 fifth b5');
    const sixNine = spellChord([60, 64, 67, 69, 74]);
    expect(sixNine.pitches.map((pitch) => pitch.degreeLabel)).toEqual(['R', '3', '5', '6', '9']);
  });

  it('prints the bass BOTH facts, because the mark is the colour\'s second channel', () => {
    // The D of a C9/D is role `bass` and figure `9`. Printing only `B` throws
    // away the one thing a slash chord exists to state; printing only `9`
    // makes a crimson 9 and a gold 9 the same glyph in greyscale. `B9` is one
    // character for both, and the role is still the single colour source.
    const spelling = spellChord([50, 60, 64, 67, 70, 74]);
    expect(spelling.primary?.symbol).toBe('C9/D');
    expect(figures(spelling)[0]).toBe('D3 bass B9');
    // A bass that IS the root keeps role `root` and mark `R` — no `B` prefix,
    // because there is no second fact to carry.
    expect(figures(spellChord([60, 64, 67]))[0]).toBe('C4 root R');
    expect(toneMarkFor('bass')).toBe('B');
    expect(toneMarkFor(undefined)).toBe('.');
  });

  it('pins all eight roles and all eight marks, because nothing else does', () => {
    // `ToneRole` here and `ToneRole` in `packages/ui/src/harmony-style.ts` are
    // two declarations of one contract, kept in step BY HAND: a score test
    // importing the kit's source would cross the optional-peer boundary to
    // check it, which is a worse problem than the one it solves. So the members
    // and their marks are written down, and adding a ninth role to either union
    // means editing this list.
    const every: ToneRole[] = ['root', 'third', 'fifth', 'seventh', 'extension', 'bass', 'other', 'ghost'];
    expect(every.map(toneMarkFor)).toEqual(['R', '3', '5', '7', '9', 'B', '.', '.']);
  });
});

describe('ChordNaming (ordinal rank, derived kind, no invented confidence)', () => {
  it('ranks by array position and by nothing else', () => {
    // `detect(['B','D','F','Ab'])` returns four names of which three tie at
    // weight 0.5 — Tonal computes the weights and throws them away before
    // returning. Rank records the order it did return, and claims nothing more.
    const spelling = spellChord([59, 62, 65, 68]);
    expect(symbols(spelling)).toEqual(['Bdim7', 'Ddim7/B', 'Fdim7/B', 'G#dim7/B']);
    expect(spelling.namings.map((naming) => naming.rank)).toEqual([0, 1, 2, 3]);
    spelling.namings.forEach((naming, index) => {
      expect(naming.rank).toBe(index);
    });
    expect(spelling.primary).toBe(spelling.namings[0]);
    expect(spellChord([59, 62, 65, 68], {maxNamings: 1}).namings).toHaveLength(1);
    // A cap below one is still one naming, not none.
    expect(spellChord([59, 62, 65, 68], {maxNamings: 0}).namings).toHaveLength(1);
  });

  it('reads a slash symbol as an inversion and an exact respelling as enharmonic', () => {
    expect(spellChord([60, 64, 67, 69]).namings[1]).toMatchObject({symbol: 'Am7/C', bass: 'C', kind: 'inversion'});
    expect(spellChord([59, 62, 65, 68]).namings[3]).toMatchObject({kind: 'inversion'});
    // Same four pitch classes, another name for them.
    const preferred = spellChord([60, 64, 67, 70], {prefer: 'C'});
    expect(preferred.namings[1]).toMatchObject({symbol: 'C7', kind: 'enharmonic'});
    expect(preferred.namings[1].bass).toBeUndefined();

    // And `alias` for a naming that covers MORE than is sounding. C-E-Bb has no
    // fifth; `assumePerfectFifth` still offers `C7`, and `C7no5` — which names
    // the omission and is the honest reading of the two — keeps rank 0.
    const noFifth = spellChord([60, 64, 70]);
    expect(symbols(noFifth)).toEqual(['C7no5', 'C7']);
    expect(noFifth.namings.map((naming) => naming.kind)).toEqual(['primary', 'alias']);
  });

  it('offers the rootless reading only when asked, and marks it as one', () => {
    // One `detect()` per absent pitch class, which the live note-on path should
    // not pay for — so it is off by default and the flag is the whole feature.
    const plain = spellChord([60, 64, 67, 71]);
    expect(symbols(plain)).toEqual(['Cmaj7']);

    const wide = spellChord([60, 64, 67, 71], {includeRootless: true});
    expect(symbols(wide)).toEqual(['Cmaj7', 'Am9']);
    expect(wide.namings.map((naming) => naming.kind)).toEqual(['primary', 'rootless']);
    // The root of the rootless reading is genuinely not sounding.
    expect(wide.namings[1]).toMatchObject({root: 'A', rootPitchClass: 9});
    expect(wide.pitches.map((pitch) => pitch.pitchClass)).not.toContain(9);
  });

  it('carries the root and bass as PITCH CLASSES, not only as letters', () => {
    // A colour wheel keys on the root's chroma and a fretboard search asks
    // whether the root is reachable; neither can do anything with `'Db'`.
    expect(spellChord([52, 55, 59, 60]).primary).toMatchObject({
      root: 'C', rootPitchClass: 0, bass: 'E', bassPitchClass: 4,
    });
    expect(spellChord([61, 65, 68], {spelling: 'flat'}).primary).toMatchObject({root: 'Db', rootPitchClass: 1});
    expect(spellChord([61, 65, 68], {spelling: 'sharp'}).primary).toMatchObject({root: 'C#', rootPitchClass: 1});
    expect(spellChord([60, 64, 67]).primary?.bassPitchClass).toBeUndefined();
  });

  it('gives every naming a spoken name, a quality and a DOM-safe id', () => {
    // Tonal builds `name` as `${tonic} ${type}`, so a chord it can spell but has
    // no words for comes back as `'C '` — non-empty, so `?? symbol` and
    // `=== ''` both sail past it and a name plate renders a letter and a space.
    const altered = spellChord([60, 64, 67, 68, 70], {prefer: 'C7b13'});
    expect(altered.primary).toMatchObject({symbol: 'C7b13', fullName: 'C7b13', quality: 'Major'});
    expect(spellChord([52, 55, 59, 60]).primary?.quality).toBe('Major');
    expect(spellChord([59, 62, 65, 68]).namings.map((naming) => naming.quality))
      .toEqual(['Diminished', 'Diminished', 'Diminished', 'Diminished']);

    // Ids are slugs — no `#`, no `/`, nothing a selector would choke on — and
    // unique within one result even when two symbols slug the same.
    expect(spellChord([59, 62, 65, 68]).namings.map((naming) => naming.id))
      .toEqual(['bdim7', 'ddim7_b', 'fdim7_b', 'gsdim7_b']);
    expect(spellChord([52, 55, 59, 60]).primary?.id).toBe('cmaj7_e');
    // `Cm` and `CM` are different chords whose symbols slug the SAME, and an
    // id is what a read-out puts on a DOM node and reads back from a click.
    const collision = spellChord([60, 64, 67], {prefer: 'Cm'});
    expect(symbols(collision)).toEqual(['Cm', 'CM', 'Em#5/C']);
    expect(collision.namings.map((naming) => naming.id)).toEqual(['cm', 'cm-2', 'ems5_c']);
    for (const {midis, options} of SPREAD) {
      const ids = spellChord(midis, options).namings.map((naming) => naming.id);
      expect(new Set(ids).size, `${midis}`).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it('carries no 0…1 confidence anywhere, on any input', () => {
    // `detect()` returns `string[]`. A score derived from array position would
    // present three tied names as a ranked list, so there is no such field —
    // and every number on a naming is a whole one naming a position or a chroma.
    for (const {midis, options} of SPREAD) {
      for (const naming of spellChord(midis, options).namings) {
        const keys = Object.keys(naming);
        expect(keys).not.toContain('score');
        expect(keys).not.toContain('confidence');
        expect(keys).not.toContain('weight');
        expect(keys).not.toContain('rootDegree');
        for (const [key, value] of Object.entries(naming)) {
          if (typeof value !== 'number') continue;
          expect(['rank', 'rootPitchClass', 'bassPitchClass']).toContain(key);
          expect(Number.isInteger(value), `${naming.symbol}.${key} = ${value}`).toBe(true);
        }
        expect(naming.fullName.trim().length, `${naming.symbol}.fullName`).toBeGreaterThan(0);
        expect(naming.quality.length, `${naming.symbol}.quality`).toBeGreaterThan(0);
      }
    }
  });
});

describe('SpelledPitch.accidental (what the stave actually draws)', () => {
  it('draws a natural where the signature has already altered the letter', () => {
    // Without this a presenter holding only `alter` draws NOTHING on the F of
    // an F major triad in G major — and the reader sees F sharp, because the
    // signature put one there.
    const key = {tonic: 'G', mode: 'major'} as const;
    const natural = spellChord([65, 69, 72], {key});
    expect(natural.pitches.map((pitch) => pitch.accidental)).toEqual(['natural', undefined, undefined]);
    expect(natural.pitches[0]).toMatchObject({name: 'F4', alter: 0});

    // The signature's own sharp is not drawn again; a sharp it does not sign is.
    const sharps = spellChord([66, 69, 73], {key});
    expect(names(sharps)).toEqual(['F#4', 'A4', 'C#5']);
    expect(sharps.pitches.map((pitch) => pitch.accidental)).toEqual([undefined, undefined, 'sharp']);
  });

  it('draws every alteration and no natural when there is no key', () => {
    const spelling = spellChord([59, 62, 65, 68]);
    expect(spelling.pitches.map((pitch) => pitch.accidental)).toEqual([undefined, undefined, undefined, 'flat']);
    expect(spellChord([61, 65, 68], {spelling: 'sharp'}).pitches.map((pitch) => pitch.accidental))
      .toEqual(['sharp', 'sharp', 'sharp']);
    // A key that signs nothing behaves the same as no key at all.
    expect(spellChord([59, 62, 65, 68], {key: {tonic: 'A', mode: 'minor'}}).pitches.map((p) => p.accidental))
      .toEqual([undefined, undefined, undefined, 'flat']);
  });

  it('says nothing rather than guess for an alteration no stave can draw', () => {
    const tripled = spellChordNotes(notated(['C4'])).pitches[0];
    expect(tripled.accidental).toBeUndefined();
    expect(spellChord([63, 67, 70], {spelling: 'sharp'}).pitches[1])
      .toMatchObject({name: 'F##4', alter: 2, accidental: 'double-sharp'});
  });
});

/** A spread wide enough that a NaN leaking anywhere has to show up in it. */
const SPREAD: ReadonlyArray<{name: string; midis: number[]; options?: SpellChordOptions}> = [
  {name: 'silence', midis: []},
  {name: 'one note', midis: [60]},
  {name: 'two notes', midis: [60, 61]},
  {name: 'a chromatic cluster', midis: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]},
  {name: 'a seventh over its third', midis: [52, 55, 59, 60]},
  {name: 'a sixth chord', midis: [60, 64, 67, 69]},
  {name: 'a ninth over a bass that is not a chord tone', midis: [50, 60, 64, 67, 70, 74]},
  {name: 'a diminished seventh', midis: [59, 62, 65, 68]},
  {name: 'a minor-major seventh in its first inversion', midis: [63, 67, 71, 72]},
  {name: 'a first-inversion major triad', midis: [64, 67, 72]},
  {name: 'a suspended dominant with a flat ninth', midis: [60, 61, 65, 67, 70]},
  {name: 'a preferred naming that omits a sounding pitch', midis: [60, 64, 67, 70], options: {prefer: 'C'}},
  {name: 'a preferred naming detect() never offered', midis: [60, 64, 67, 68, 70], options: {prefer: 'C7b13'}},
  {name: 'a preferred symbol Tonal cannot parse', midis: [60, 64, 67], options: {prefer: 'Xyz'}},
  {name: 'a preferred symbol that names nothing sounding', midis: [62, 66, 69, 73], options: {prefer: 'Cmaj7'}},
  {name: 'a rootless reading', midis: [60, 64, 67, 71], options: {includeRootless: true}},
  {name: 'a flat spelling in a flat key', midis: [61, 65, 68], options: {spelling: 'flat', key: {tonic: 'Eb', mode: 'major'}}},
  {name: 'junk mixed into the input', midis: [Number.NaN, Number.POSITIVE_INFINITY, 67, 60.4, 64, 60, 72]},
];

describe('spellChord (numeric hygiene)', () => {
  // The early warning for `get(symbol).rootDegree`, which is NaN for a
  // root-position chord and 0 for an unparsable one, and which `??` does not
  // catch. It is read nowhere and must reach no field — not least because
  // structuredClone preserves NaN and a JSON hop turns it into null, so a leak
  // would read differently on either side of the analyze worker.
  for (const {name, midis, options} of SPREAD) {
    it(`gives every number a real value: ${name}`, () => {
      const spelling = spellChord(midis, options);
      expect(spelling.label.length).toBeGreaterThan(0);

      for (const pitch of spelling.pitches) {
        for (const field of ['midi', 'alter', 'octave', 'pitchClass', 'diatonic'] as const) {
          expect(Number.isFinite(pitch[field]), `${pitch.name}.${field} = ${pitch[field]}`).toBe(true);
        }
        // Every number on the record, including any field added later.
        for (const [key, value] of Object.entries(pitch)) {
          if (typeof value === 'number') expect(Number.isFinite(value), `${pitch.name}.${key}`).toBe(true);
        }
        expect(Object.keys(pitch)).not.toContain('score');
        expect(Object.keys(pitch)).not.toContain('confidence');
        expect(pitch.pitchClass).toBeGreaterThanOrEqual(0);
        expect(pitch.pitchClass).toBeLessThan(12);
        // NEGATIVE ZERO is a number `=== 0` accepts and `Object.is` rejects,
        // and `-accidentals.length` on a natural produces one.
        expect(Object.is(pitch.alter, -0), `${pitch.name}.alter is -0`).toBe(false);
        expect(pitch.degreeLabel.length).toBeGreaterThan(0);
        expect(pitch.name.length).toBeGreaterThan(0);
      }

      spelling.namings.forEach((naming, index) => {
        expect(Number.isFinite(naming.rank)).toBe(true);
        expect(naming.rank).toBe(index);
        expect(naming.symbol.length).toBeGreaterThan(0);
        expect(naming.id.length).toBeGreaterThan(0);
      });
    });
  }

  it('names a chord that accounts for every sounding pitch, on every input in the spread', () => {
    // The one relation that has to hold between a label and the keys under it.
    for (const {name, midis, options} of SPREAD) {
      const spelling = spellChord(midis, options);
      const primary = spelling.primary;
      if (primary === undefined || options?.prefer !== undefined) continue;
      const uncovered = spelling.pitches.filter((pitch) => pitch.interval === undefined);
      expect(uncovered.map((pitch) => pitch.name), `${name}: ${primary.symbol}`).toEqual([]);
    }
  });

  it('drops non-finite MIDI numbers, rounds the rest and dedupes by key', () => {
    const dirty = spellChord([Number.NaN, Number.POSITIVE_INFINITY, 67, 60.4, 64, 60, 72]);
    expect(dirty).toEqual(spellChord([60, 64, 67, 72]));
    expect(dirty.pitches.map((pitch) => pitch.midi)).toEqual([60, 64, 67, 72]);
  });
});

describe('spellChord (memoisation)', () => {
  it('returns the cached answer for a repeated input, and keys the cache on the spelling policy', () => {
    // Every note-on in a live session calls this, so the cache is load-bearing
    // — and a cache key that forgot the policy would hand a caller asking for
    // flats the sharp answer somebody else asked for a moment ago.
    const midis = [61, 65, 68];
    const auto = spellChord(midis);
    expect(spellChord(midis)).toBe(auto);
    expect(spellChord([...midis])).toBe(auto);

    const flat = spellChord(midis, {spelling: 'flat'});
    expect(flat).not.toBe(auto);
    expect(flat.label).toBe('DbM');
    expect(auto.label).toBe('C#M');

    const sharp = spellChord(midis, {spelling: 'sharp'});
    expect(names(sharp)).toEqual(['C#4', 'E#4', 'G#4']);
    expect(names(flat)).toEqual(['Db4', 'F4', 'Ab4']);

    // The first answer is still the first answer after all of that.
    expect(spellChord(midis)).toBe(auto);
    expect(spellChord(midis, {spelling: 'flat'})).toBe(flat);
  });

  it('keys on the preferred symbol, the key, the rootless flag and the naming cap as well', () => {
    const midis = [60, 64, 67, 69];
    const plain = spellChord(midis);
    expect(spellChord(midis, {prefer: 'Am7/C'}).primary?.symbol).toBe('Am7/C');
    expect(spellChord(midis)).toBe(plain);
    expect(spellChord(midis, {maxNamings: 1}).namings).toHaveLength(1);
    expect(spellChord(midis).namings.length).toBeGreaterThan(1);
    expect(spellChord(midis, {key: {tonic: 'F', mode: 'major'}})).not.toBe(plain);
    expect(spellChord([60, 64, 67, 71], {includeRootless: true}))
      .not.toBe(spellChord([60, 64, 67, 71]));
  });

  it('hands back the SAME object, which is why every record is frozen', () => {
    // A caller reaching into a shared cached graph would rewrite what the next
    // four read-outs draw. The neighbours in `analyze/core/` state that
    // contract; this module memoises, so it enforces it.
    const spelling = spellChord([60, 64, 67]);
    expect(Object.isFrozen(spelling)).toBe(true);
    expect(Object.isFrozen(spelling.pitches)).toBe(true);
    expect(Object.isFrozen(spelling.pitches[0])).toBe(true);
    expect(Object.isFrozen(spelling.namings)).toBe(true);
    expect(Object.isFrozen(spelling.namings[0])).toBe(true);
  });
});
