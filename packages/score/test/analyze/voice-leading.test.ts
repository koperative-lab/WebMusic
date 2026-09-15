import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type PartId} from '../../src/core';
import {describe, expect, it} from 'vitest';
import {voiceLeading} from '../../src/analyze/core/voice-leading';

type NoteSpec = [pitch: string, onset: number, dur: number];

/** Build a score from parts → voices → notes. */
function scoreFrom(parts: Array<Record<string, NoteSpec[]>>) {
  const builder = new ScoreBuilder();
  for (const voices of parts) {
    const partId: PartId = builder.newPartId();
    builder.addPart({id: partId, name: String(partId)});
    for (const [voiceName, notes] of Object.entries(voices)) {
      const voice = VoiceId(`${partId}-${voiceName}`);
      for (const [name, onset, dur] of notes) {
        builder.addNote(partId, {
          id: builder.newNoteId(),
          pitch: Pitch.parse(name),
          onsetQuarters: new Rational(Math.round(onset * 4), 4),
          duration: new Duration({base: new Rational(Math.round(dur * 4), 4)}),
          voice,
        });
      }
    }
  }
  return builder.build();
}

describe('voiceLeading', () => {
  it('detects parallel fifths between two voices in the same part', () => {
    // C4–G4 moving to D4–A4: both perfect fifths, both voices ascending.
    const score = scoreFrom([
      {
        v1: [
          ['C4', 0, 1],
          ['D4', 1, 1],
        ],
        v2: [
          ['G4', 0, 1],
          ['A4', 1, 1],
        ],
      },
    ]);
    const fifths = voiceLeading(score).filter((issue) => issue.type === 'parallel-fifth');
    expect(fifths).toHaveLength(1);
    expect(fifths[0]).toMatchObject({startQuarters: 0, endQuarters: 1, severity: 'error'});
  });

  it('detects parallel compound fifths (a twelfth apart)', () => {
    const score = scoreFrom([
      {
        v1: [
          ['C3', 0, 1],
          ['D3', 1, 1],
        ],
        v2: [
          ['G4', 0, 1],
          ['A4', 1, 1],
        ],
      },
    ]);
    expect(voiceLeading(score).filter((issue) => issue.type === 'parallel-fifth')).toHaveLength(1);
  });

  it('does not flag parallel fourths as fifths', () => {
    // C4–F4 to D4–G4: perfect fourths, must NOT be conflated with fifths.
    const score = scoreFrom([
      {
        v1: [
          ['C4', 0, 1],
          ['D4', 1, 1],
        ],
        v2: [
          ['F4', 0, 1],
          ['G4', 1, 1],
        ],
      },
    ]);
    const issues = voiceLeading(score);
    expect(issues.filter((issue) => issue.type === 'parallel-fifth')).toHaveLength(0);
    expect(issues.filter((issue) => issue.type === 'parallel-octave')).toHaveLength(0);
  });

  it('does not flag repeated (static) octaves or fifths', () => {
    // Both voices repeat the same notes: oblique/static motion, not parallel.
    const score = scoreFrom([
      {
        v1: [
          ['C4', 0, 1],
          ['C4', 1, 1],
        ],
        v2: [
          ['C5', 0, 1],
          ['C5', 1, 1],
        ],
      },
    ]);
    expect(voiceLeading(score).filter((issue) => issue.type === 'parallel-octave')).toHaveLength(0);
  });

  it('does not flag when only one voice moves (oblique motion)', () => {
    const score = scoreFrom([
      {
        v1: [
          ['C4', 0, 1],
          ['C4', 1, 1],
        ],
        v2: [
          ['G4', 0, 1],
          ['G5', 1, 1],
        ],
      },
    ]);
    expect(
      voiceLeading(score).filter(
        (issue) => issue.type === 'parallel-fifth' || issue.type === 'parallel-octave',
      ),
    ).toHaveLength(0);
  });

  it('detects parallel octaves', () => {
    const score = scoreFrom([
      {
        v1: [
          ['C4', 0, 1],
          ['D4', 1, 1],
        ],
        v2: [
          ['C5', 0, 1],
          ['D5', 1, 1],
        ],
      },
    ]);
    expect(voiceLeading(score).filter((issue) => issue.type === 'parallel-octave')).toHaveLength(1);
  });

  it('detects parallel fifths across two parts', () => {
    // SATB split over two parts: soprano in part 1, bass in part 2.
    const score = scoreFrom([
      {
        soprano: [
          ['G4', 0, 1],
          ['A4', 1, 1],
        ],
      },
      {
        bass: [
          ['C4', 0, 1],
          ['D4', 1, 1],
        ],
      },
    ]);
    const fifths = voiceLeading(score).filter((issue) => issue.type === 'parallel-fifth');
    expect(fifths).toHaveLength(1);
    expect(fifths[0].voices).toHaveLength(2);
  });

  it('detects voice crossing when the lower voice goes above the upper voice', () => {
    const score = scoreFrom([
      {
        upper: [
          ['G4', 0, 1],
          ['C4', 1, 1], // dips below the other voice here
        ],
        lower: [
          ['C4', 0, 1],
          ['E4', 1, 1],
        ],
      },
    ]);
    const crossings = voiceLeading(score).filter((issue) => issue.type === 'voice-crossing');
    expect(crossings).toHaveLength(1);
    expect(crossings[0]).toMatchObject({startQuarters: 1, severity: 'warning'});
  });

  it('reports no crossing for well-ordered voices', () => {
    const score = scoreFrom([
      {
        upper: [
          ['E4', 0, 1],
          ['F4', 1, 1],
        ],
        lower: [
          ['C4', 0, 1],
          ['D4', 1, 1],
        ],
      },
    ]);
    expect(voiceLeading(score).filter((issue) => issue.type === 'voice-crossing')).toHaveLength(0);
  });

  it('ignores pitchless rests and does not compare notes across them', () => {
    const b = new ScoreBuilder();
    const partId = b.addPart({id: b.newPartId(), name: 'Solo'});
    const voice = b.newVoiceId();
    b.addNote(partId, {
      id: b.newNoteId(),
      pitch: Pitch.parse('C3'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice,
    });
    b.addNote(partId, {
      id: b.newNoteId(),
      rest: true,
      onsetQuarters: Rational.ONE,
      duration: Duration.quarter(),
      voice,
    });
    b.addNote(partId, {
      id: b.newNoteId(),
      pitch: Pitch.parse('C6'),
      onsetQuarters: new Rational(2),
      duration: Duration.quarter(),
      voice,
    });

    expect(voiceLeading(b.build()).filter((issue) => issue.type === 'large-leap')).toHaveLength(0);
  });

  it('collapses same-voice chord members before checking melodic leaps', () => {
    const b = new ScoreBuilder();
    const partId = b.addPart({id: b.newPartId(), name: 'Solo'});
    const voice = b.newVoiceId();
    // MusicXML chord members share a voice and onset. The vertical C3–G5
    // interval is harmony, not a pair of consecutive melodic notes.
    b.addNote(partId, {
      id: b.newNoteId(),
      pitch: Pitch.parse('C3'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice,
    });
    b.addNote(partId, {
      id: b.newNoteId(),
      pitch: Pitch.parse('G5'),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
      voice,
      chord: true,
    });
    b.addNote(partId, {
      id: b.newNoteId(),
      pitch: Pitch.parse('D3'),
      onsetQuarters: Rational.ONE,
      duration: Duration.quarter(),
      voice,
    });

    expect(voiceLeading(b.build()).filter((issue) => issue.type === 'large-leap')).toHaveLength(0);
  });
});
