import {describe, expect, it, vi} from 'vitest';
import {scoreFromJSON, Rational} from '../../src/core';
import {parseMusicXML, parseMusicXMLDetailed} from '../../src/io';

const missingPitch = `
  <score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
    <part id="P1">
      <measure number="7">
        <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><duration>1</duration><voice>1</voice></note>
      </measure>
    </part>
  </score-partwise>
`;

describe('MusicXML structured diagnostics', () => {
  it('returns a stable, located diagnostic for a recoverably skipped note', () => {
    const result = parseMusicXMLDetailed(missingPitch);

    expect(result.score.notes).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        code: 'musicxml-note-without-pitch',
        severity: 'warning',
        format: 'musicxml',
        message: 'Skipped a note without <pitch> or <unpitched> in part P1',
        location: {partId: 'P1', measureNumber: 7},
      },
    ]);
  });

  it('keeps the historical wrapper silent and score-only', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(parseMusicXML(missingPitch).notes).toEqual([]);
      expect(warning).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });

  it('aggregates repeated issues rather than allocating a warning per note', () => {
    const repeated = missingPitch.replace(
      '<note><duration>1</duration><voice>1</voice></note>',
      '<note><duration>1</duration><voice>1</voice></note>'.repeat(200),
    );
    const [diagnostic] = parseMusicXMLDetailed(repeated).diagnostics;

    expect(diagnostic.code).toBe('musicxml-note-without-pitch');
    expect(diagnostic.message).toContain('200 occurrences');
  });

  it('normalizes same-position tempo directions with the final declaration winning', () => {
    const duplicateTempo = `
      <score-partwise version="4.0">
        <part-list><score-part id="P1"><part-name>Test</part-name></score-part></part-list>
        <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>
          <direction><sound tempo="120"/></direction>
          <direction><sound tempo="90"/></direction>
          <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>
        </measure></part>
      </score-partwise>
    `;
    const result = parseMusicXMLDetailed(duplicateTempo);

    expect(result.score.timeMap.tempi).toHaveLength(1);
    expect(result.score.timeMap.tempoAt(Rational.ZERO).bpm).toBe(90);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'musicxml-tempo-same-position-normalized'}),
    ]));
    expect(scoreFromJSON(result.score.toJSON()).toJSON()).toEqual(result.score.toJSON());
  });
});
