import {describe, expect, it} from 'vitest';
import {
  ACCIDENTAL_GLYPHS,
  CLEF_GLYPHS,
  DIATONIC_TO_STEP,
  GRAND_STAFF_STAVE_OFFSET,
  MIDDLE_C_DIATONIC,
  accidentalForAlter,
  diatonicOf,
  keySignatureAccidentals,
  keySignatureAlters,
  keyFifths,
  keySignatureFifths,
  pitchOfDiatonic,
  staffPlacement,
  toDisplayName,
} from '../../src/analyze/core/staff-placement';

/** `'F5'` for a diatonic step, so a signature reads as letters and not numbers. */
function nameOf(diatonic: number): string {
  const {step, octave} = pitchOfDiatonic(diatonic);
  return `${step}${octave}`;
}

/** The same, for a run of steps. Reads better than a map inside an assertion. */
function namesOf(diatonics: readonly number[]): string[] {
  return diatonics.map(nameOf);
}

/** The letters a key signature writes, in the order a scribe writes them. */
function signatureNames(tonic: string, mode: 'major' | 'minor' = 'major', system?: 'treble' | 'bass'): string[] {
  return keySignatureAccidentals({tonic, mode}, system).map((entry) => nameOf(entry.diatonic));
}

describe('staffPlacement', () => {
  it('puts middle C between the staves, on one ledger line of its own', () => {
    // A grand system is one continuous ladder: the treble's bottom line is G4
    // (30) and the bass's top line is A3 (26), so middle C (28) falls exactly
    // between them and reads from the treble stave with a single ledger.
    expect(staffPlacement(28)).toEqual({y: 10, systemY: 10, staff: 'upper', ledgers: [28]});
    expect(nameOf(28)).toBe('C4');
  });

  it('gives C6 TWO upper ledgers, not four', () => {
    // A ledger line sits only on a LINE position, and adjacent lines are two
    // diatonic steps apart. The treble's top line is F5 (38), so above it there
    // are only A5 (40) and C6 (42) — two lines, four half spaces. Counting half
    // spaces gives four ledgers, which is what the design first wrote down.
    expect(staffPlacement(42)).toEqual({y: -4, systemY: -4, staff: 'upper', ledgers: [40, 42]});
    expect(namesOf([40, 42])).toEqual(['A5', 'C6']);
    // B5 sits in the SPACE just under C6 and needs only the line below it.
    expect(staffPlacement(41)).toEqual({y: -3, systemY: -3, staff: 'upper', ledgers: [40]});
  });

  it('gives a pitch under the bass stave its ledgers too, ascending', () => {
    // The bass's bottom line is G2 (18); below it lie E2 (16) and C2 (14).
    expect(staffPlacement(14)).toMatchObject({y: 12, staff: 'lower', ledgers: [14, 16]});
    expect(staffPlacement(16)).toMatchObject({y: 10, staff: 'lower', ledgers: [16]});
    expect(namesOf(staffPlacement(14).ledgers)).toEqual(['C2', 'E2']);
  });

  it('draws no ledger for a pitch already on the stave', () => {
    expect(staffPlacement(30)).toMatchObject({y: 8, staff: 'upper', ledgers: []}); // G4, the treble's bottom line
    expect(staffPlacement(38)).toMatchObject({y: 0, staff: 'upper', ledgers: []}); // F5, its top line
    expect(staffPlacement(27)).toMatchObject({y: -1, staff: 'lower', ledgers: []}); // B3, over the bass stave
  });

  it('measures a single-stave system against that stave alone', () => {
    // On a grand system middle C reads from the treble. Asked for the bass
    // stave it keeps its ledger but is measured from A3 instead of F5 — and
    // with one stave in the system, `systemY` and `y` are the same number.
    expect(staffPlacement(28, 'treble')).toEqual(staffPlacement(28));
    expect(staffPlacement(28, 'bass')).toEqual({y: -2, systemY: -2, staff: 'lower', ledgers: [28]});
    expect(staffPlacement(20, 'treble').staff).toBe('upper');
    for (const step of [14, 20, 27, 28, 34, 42]) {
      expect(staffPlacement(step, 'bass').systemY, `${step}`).toBe(staffPlacement(step, 'bass').y);
      expect(staffPlacement(step, 'treble').systemY, `${step}`).toBe(staffPlacement(step, 'treble').y);
    }
  });

  it('re-bases the lower stave so a grand system reads as ONE ladder', () => {
    // `y` restarts at each stave, so on a grand system B3 is -1 and middle C —
    // a semitone HIGHER — is 10. A presenter multiplying `y` by a half space
    // and drawing would put B3 eleven half spaces above middle C, which is the
    // bass stave laid on top of the treble.
    expect(staffPlacement(27)).toMatchObject({y: -1, systemY: 11, staff: 'lower'});
    expect(staffPlacement(28)).toMatchObject({y: 10, systemY: 10, staff: 'upper'});
    expect(GRAND_STAFF_STAVE_OFFSET).toBe(12);

    // Ascending pitch, descending systemY, with no discontinuity at the split.
    const ladder = [14, 18, 22, 26, 27, 28, 30, 34, 38, 42];
    expect(ladder.map((step) => staffPlacement(step).systemY)).toEqual([24, 20, 16, 12, 11, 10, 8, 4, 0, -4]);
    for (const step of ladder) {
      const placed = staffPlacement(step);
      expect(placed.systemY, `${step}`).toBe(placed.y + (placed.staff === 'lower' ? GRAND_STAFF_STAVE_OFFSET : 0));
      expect(placed.systemY, `${step}`).toBe(38 - step);
    }
  });

  it('falls back to middle C rather than placing a non-finite step', () => {
    expect(staffPlacement(Number.NaN)).toEqual(staffPlacement(MIDDLE_C_DIATONIC));
    expect(staffPlacement(28.4)).toEqual(staffPlacement(28));
  });

  it('clamps a step no instrument can reach instead of allocating for it', () => {
    // `Number.isFinite` catches NaN and Infinity but not a large FINITE number,
    // and a malformed MusicXML <octave> makes one: `diatonicOf('C', 1e9)` is
    // 7e9, which passes every guard and then asks `ledgerLines` for an array of
    // 3.5 billion entries. 1e7 took half a second and 280 MB; 1e9 threw.
    for (const octave of [1e3, 1e5, 1e7, 1e9]) {
      const placed = staffPlacement(diatonicOf('C', octave));
      expect(placed.ledgers.length, `${octave}`).toBeLessThan(64);
      expect(Number.isFinite(placed.y), `${octave}`).toBe(true);
    }
    expect(staffPlacement(-1e9).ledgers.length).toBeLessThan(64);
    // Everything a real instrument can play is inside the clamp and still gets
    // every ledger it needs: MIDI 0 is C-1 (diatonic -7) and MIDI 127 is G9
    // (67). A ledger only ever sits on a LINE, so the outermost one is even.
    const lowest = staffPlacement(-7).ledgers;
    expect(lowest[0]).toBe(-6);
    expect(lowest[lowest.length - 1]).toBe(16);
    const highest = staffPlacement(67).ledgers;
    expect(highest[0]).toBe(40);
    expect(highest[highest.length - 1]).toBe(66);
  });
});

describe('diatonicOf / pitchOfDiatonic', () => {
  it('anchors the ladder on MIDDLE C = 28', () => {
    // The whole placement layer is quoted against this one number. `view/core/
    // layout.ts` counts the same ladder from C4 = 0, so the two differ by
    // exactly 28 and one must never be read as the other.
    expect(MIDDLE_C_DIATONIC).toBe(28);
    expect(diatonicOf('C', 4)).toBe(MIDDLE_C_DIATONIC);
    expect(pitchOfDiatonic(MIDDLE_C_DIATONIC)).toEqual({step: 'C', octave: 4});
    expect(diatonicOf('C', 0)).toBe(0);
    expect(diatonicOf('B', 3)).toBe(27);
    expect(diatonicOf('C', 4) - diatonicOf('B', 3)).toBe(1);
  });

  it('round-trips every letter across several octaves', () => {
    for (let octave = 0; octave <= 8; octave += 1) {
      for (const step of DIATONIC_TO_STEP) {
        const diatonic = diatonicOf(step, octave);
        expect(pitchOfDiatonic(diatonic)).toEqual({step, octave});
      }
    }
    // And the other way round, over the same span of steps.
    for (let diatonic = 0; diatonic <= 62; diatonic += 1) {
      const {step, octave} = pitchOfDiatonic(diatonic);
      expect(diatonicOf(step, octave)).toBe(diatonic);
    }
  });

  it('reads a lower-case letter, and answers middle C for anything it cannot read', () => {
    expect(diatonicOf('g', 4)).toBe(diatonicOf('G', 4));
    expect(diatonicOf('H', 4)).toBe(MIDDLE_C_DIATONIC);
    expect(diatonicOf('C', Number.NaN)).toBe(MIDDLE_C_DIATONIC);
    expect(pitchOfDiatonic(Number.NaN)).toEqual({step: 'C', octave: 4});
    // A fractional octave rounds to a whole one rather than landing between steps.
    expect(diatonicOf('C', 3.6)).toBe(diatonicOf('C', 4));
    expect(diatonicOf('E', 4.4)).toBe(diatonicOf('E', 4));
  });
});

describe('keyFifths', () => {
  it('seats a key on the circle by its spelling', () => {
    expect(keyFifths({tonic: 'C', mode: 'major'})).toBe(0);
    expect(keyFifths({tonic: 'G', mode: 'major'})).toBe(1);
    expect(keyFifths({tonic: 'Eb', mode: 'major'})).toBe(-3);
    expect(keyFifths({tonic: 'F#', mode: 'major'})).toBe(6);
    expect(keyFifths({tonic: 'Gb', mode: 'major'})).toBe(-6);
    expect(keyFifths({tonic: 'A', mode: 'minor'})).toBe(0);
    expect(keyFifths({tonic: 'D', mode: 'minor'})).toBe(-1);
  });

  it('seats a key past seven accidentals where it belongs, and does not clamp', () => {
    // The difference from keySignatureFifths, and the reason both exist: a
    // signature stops at seven, a POSITION does not. Clamping G# to 7 would
    // seat it on Db and turn a dial to the wrong key.
    expect(keyFifths({tonic: 'G#', mode: 'major'})).toBe(8);
    expect(keyFifths({tonic: 'D#', mode: 'major'})).toBe(9);
    expect(keyFifths({tonic: 'Fb', mode: 'major'})).toBe(-8);
    expect(keyFifths({tonic: 'C##', mode: 'major'})).toBe(14);
    expect(keySignatureFifths({tonic: 'G#', mode: 'major'})).toBe(0);
  });

  it('keeps the SIGN a signature erases, so a flat key still reads flat', () => {
    // keySignatureFifths(Fb major) is 0, and `0 < 0` is false. Any caller
    // asking "is this a flat key" must ask this one.
    expect(keyFifths({tonic: 'Fb', mode: 'major'})).toBeLessThan(0);
    expect(keyFifths({tonic: 'Bbb', mode: 'major'})).toBeLessThan(0);
    expect(keyFifths({tonic: 'G#', mode: 'major'})).toBeGreaterThan(0);
  });

  it('answers the middle of the circle for a tonic it cannot read, and never throws', () => {
    expect(keyFifths({tonic: 'H', mode: 'major'})).toBe(0);
    expect(keyFifths({tonic: '', mode: 'major'})).toBe(0);
    expect(keyFifths({tonic: undefined as unknown as string, mode: 'major'})).toBe(0);
    expect(keyFifths({tonic: 7 as unknown as string, mode: 'major'})).toBe(0);
  });
});

describe('keySignatureFifths', () => {
  it('counts from the tonic SPELLING, so enharmonic keys sign differently', () => {
    expect(keySignatureFifths({tonic: 'C', mode: 'major'})).toBe(0);
    expect(keySignatureFifths({tonic: 'G', mode: 'major'})).toBe(1);
    expect(keySignatureFifths({tonic: 'Eb', mode: 'major'})).toBe(-3);
    expect(keySignatureFifths({tonic: 'F#', mode: 'major'})).toBe(6);
    expect(keySignatureFifths({tonic: 'Gb', mode: 'major'})).toBe(-6);
    expect(keySignatureFifths({tonic: 'C#', mode: 'major'})).toBe(7);
    expect(keySignatureFifths({tonic: 'Cb', mode: 'major'})).toBe(-7);
  });

  it('signs a minor key what its relative major signs', () => {
    expect(keySignatureFifths({tonic: 'A', mode: 'minor'})).toBe(0);
    expect(keySignatureFifths({tonic: 'D', mode: 'minor'})).toBe(-1);
    expect(keySignatureFifths({tonic: 'E', mode: 'minor'})).toBe(1);
    expect(keySignatureFifths({tonic: 'C', mode: 'minor'})).toBe(-3);
  });

  it('answers no accidentals for a tonic it cannot parse, rather than a guess', () => {
    expect(keySignatureFifths({tonic: 'H', mode: 'major'})).toBe(0);
    expect(keySignatureFifths({tonic: '', mode: 'major'})).toBe(0);
    expect(keySignatureAccidentals({tonic: 'H', mode: 'major'})).toEqual([]);
  });

  it('answers the same for a THEORETICAL key, instead of a neighbour signature', () => {
    // G# major signs eight sharps and D# major nine; no signature can write
    // them. Clamping to seven draws C# major's signature — seven accidentals
    // that are not this key's, which is the one answer worse than none. The
    // pitches still carry their own accidentals either way.
    expect(keySignatureFifths({tonic: 'G#', mode: 'major'})).toBe(0);
    expect(keySignatureFifths({tonic: 'D#', mode: 'major'})).toBe(0);
    expect(keySignatureFifths({tonic: 'Fb', mode: 'major'})).toBe(0);
    expect(keySignatureFifths({tonic: 'C##', mode: 'major'})).toBe(0);
    expect(keySignatureAccidentals({tonic: 'G#', mode: 'major'})).toEqual([]);
    // The last key that CAN be written keeps its full signature.
    expect(keySignatureFifths({tonic: 'A#', mode: 'minor'})).toBe(7);
    expect(keySignatureFifths({tonic: 'D#', mode: 'minor'})).toBe(6);
  });
});

describe('keySignatureAccidentals', () => {
  it('writes sharps in the order F C G D A E B', () => {
    expect(signatureNames('C#')).toEqual(['F5', 'C5', 'G5', 'D5', 'A4', 'E5', 'B4']);
    expect(signatureNames('G')).toEqual(['F5']);
    expect(signatureNames('D')).toEqual(['F5', 'C5']);
    expect(signatureNames('A')).toEqual(['F5', 'C5', 'G5']);
  });

  it('writes flats in the mirror order B E A D G C F', () => {
    expect(signatureNames('Cb')).toEqual(['B4', 'E5', 'A4', 'D5', 'G4', 'C5', 'F4']);
    expect(signatureNames('F')).toEqual(['B4']);
    expect(signatureNames('Bb')).toEqual(['B4', 'E5']);
    expect(signatureNames('Eb')).toEqual(['B4', 'E5', 'A4']);
  });

  it('draws as many accidentals as the key signs, all of one kind', () => {
    for (const [tonic, count] of [['C', 0], ['G', 1], ['Eb', 3], ['F#', 6], ['Cb', 7]] as const) {
      const drawn = keySignatureAccidentals({tonic, mode: 'major'});
      expect(drawn, tonic).toHaveLength(count);
      const expected = keySignatureFifths({tonic, mode: 'major'}) > 0 ? 'sharp' : 'flat';
      for (const entry of drawn) expect(entry.accidental).toBe(expected);
    }
    expect(signatureNames('C', 'minor')).toEqual(signatureNames('Eb'));
    expect(keySignatureAccidentals({tonic: 'A', mode: 'minor'})).toEqual([]);
  });

  it('draws the same letters two octaves lower on the bass stave', () => {
    expect(signatureNames('F#', 'major', 'bass')).toEqual(['F3', 'C3', 'G3', 'D3', 'A2', 'E3']);
    const treble = keySignatureAccidentals({tonic: 'F#', mode: 'major'}, 'treble');
    const bass = keySignatureAccidentals({tonic: 'F#', mode: 'major'}, 'bass');
    expect(bass.map((entry) => entry.diatonic + 14)).toEqual(treble.map((entry) => entry.diatonic));
    // A grand system returns the treble shapes; the caller asks again for the
    // lower stave, because one flat list could not say which stave a step is on.
    expect(keySignatureAccidentals({tonic: 'F#', mode: 'major'}, 'grand')).toEqual(treble);
  });
});

describe('keySignatureAlters', () => {
  it('says which LETTERS a signature binds, in every octave at once', () => {
    // The step list above tells a scribe where to draw. This one answers the
    // other question — does this sounding pitch still need an accidental of its
    // own — and a letter is the right key for it, because a signature binds F
    // in every octave and not only the F it drew.
    expect(keySignatureAlters({tonic: 'G', mode: 'major'})).toEqual({F: 1});
    expect(keySignatureAlters({tonic: 'Eb', mode: 'major'})).toEqual({B: -1, E: -1, A: -1});
    expect(keySignatureAlters({tonic: 'C', mode: 'major'})).toEqual({});
    expect(keySignatureAlters({tonic: 'A', mode: 'minor'})).toEqual({});
    expect(keySignatureAlters({tonic: 'G#', mode: 'major'})).toEqual({});
  });

  it('agrees letter for letter with the shapes a scribe draws', () => {
    for (const tonic of ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb']) {
      const alters = keySignatureAlters({tonic, mode: 'major'});
      const drawn = keySignatureAccidentals({tonic, mode: 'major'});
      expect(Object.keys(alters).sort(), tonic)
        .toEqual([...new Set(drawn.map((entry) => pitchOfDiatonic(entry.diatonic).step))].sort());
      for (const entry of drawn) {
        expect(alters[pitchOfDiatonic(entry.diatonic).step], `${tonic} ${entry.accidental}`)
          .toBe(entry.accidental === 'sharp' ? 1 : -1);
      }
    }
  });
});

describe('accidentalForAlter', () => {
  it('covers the double accidentals in both directions', () => {
    expect(accidentalForAlter(2)).toBe('double-sharp');
    expect(accidentalForAlter(1)).toBe('sharp');
    expect(accidentalForAlter(-1)).toBe('flat');
    expect(accidentalForAlter(-2)).toBe('double-flat');
  });

  it('draws nothing for a natural unless asked, and nothing at all beyond a double', () => {
    expect(accidentalForAlter(0)).toBeUndefined();
    expect(accidentalForAlter(0, true)).toBe('natural');
    expect(accidentalForAlter(3)).toBeUndefined();
    expect(accidentalForAlter(-3)).toBeUndefined();
    expect(accidentalForAlter(Number.NaN)).toBeUndefined();
  });

  it('ROUNDS a fractional alter rather than truncating it', () => {
    // `Math.trunc` passes 1.4 too, so the round trips only on a value that
    // crosses the halfway line.
    expect(accidentalForAlter(0.6)).toBe('sharp');
    expect(accidentalForAlter(1.6)).toBe('double-sharp');
    expect(accidentalForAlter(-0.6)).toBe('flat');
    expect(accidentalForAlter(0.4, true)).toBe('natural');
  });
});

describe('notation glyphs (they live in score, because the kit is forbidden them)', () => {
  it('ships the clef glyphs the kit may not write', () => {
    // `check-architecture.mjs`'s `checkUiDomainVocabulary` bans every notation
    // glyph from `packages/ui/src/**`, so a presenter positions a clef the
    // caller hands it. These are the strings to hand over, and treble is not
    // bass.
    expect(CLEF_GLYPHS.treble).toBe('\u{1D11E}');
    expect(CLEF_GLYPHS.bass).toBe('\u{1D122}');
    expect(CLEF_GLYPHS.alto).toBe('\u{1D121}');
    expect(CLEF_GLYPHS.tenor).toBe(CLEF_GLYPHS.alto);
    expect(CLEF_GLYPHS.percussion).toBe('\u{1D125}');
    expect(new Set(Object.values(CLEF_GLYPHS)).size).toBe(4);
  });

  it('turns an ASCII name into the one a reader wants to see', () => {
    expect(toDisplayName('F#4')).toBe('F♯4');
    expect(toDisplayName('Bbm7')).toBe('B♭m7');
    expect(toDisplayName('Cmaj7/E')).toBe('Cmaj7/E');
    expect(ACCIDENTAL_GLYPHS['#']).toBe('♯');
    expect(ACCIDENTAL_GLYPHS.b).toBe('♭');
    expect(toDisplayName('F##4')).toBe(`F${ACCIDENTAL_GLYPHS['##']}4`);
    expect(toDisplayName('Bbb4')).toBe(`B${ACCIDENTAL_GLYPHS.bb}4`);
  });

  it('leaves alone every `b` and `#` that is not an accidental', () => {
    // `Bdim7`'s `b` is a letter, `C7b13`'s is a figure, and neither is a flat.
    expect(toDisplayName('Bdim7')).toBe('Bdim7');
    expect(toDisplayName('Dm7b5')).toBe('Dm7b5');
    expect(toDisplayName('C7b13')).toBe('C7b13');
    expect(toDisplayName('')).toBe('');
    expect(toDisplayName('#fff')).toBe('#fff');
  });
});
