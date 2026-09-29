import {describe, expect, it} from 'vitest';
import {detectAudioKey, keyFromChroma} from '../../src/analyze/core/key';
import {cMajorArpeggio, silence} from './signals';

describe('detectAudioKey', () => {
  it('identifies C major from a C-major arpeggio', () => {
    const sr = 22050;
    const channel = cMajorArpeggio(2, sr);
    const result = detectAudioKey([channel], sr, {fftSize: 4096, hopSize: 2048});
    expect(result.mode).toBe('major');
    expect(result.tonic).toBe('C');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('keyFromChroma scores a clean C-major chroma as C major', () => {
    // Emphasize C, E, G (the tonic triad) over the rest.
    const chroma = new Float64Array(12);
    chroma[0] = 10; // C
    chroma[4] = 8; // E
    chroma[7] = 9; // G
    chroma[2] = 3; // D
    chroma[5] = 3; // F
    chroma[9] = 3; // A
    chroma[11] = 3; // B
    const result = keyFromChroma(chroma);
    expect(result.tonic).toBe('C');
    expect(result.mode).toBe('major');
    // 24 candidates ranked best-first.
    expect(result.scores?.length).toBe(24);
  });

  it('returns the 24 ranked candidates best-first', () => {
    const sr = 22050;
    const result = detectAudioKey([cMajorArpeggio(1.5, sr)], sr);
    const scores = result.scores ?? [];
    expect(scores.length).toBe(24);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1].score).toBeGreaterThanOrEqual(scores[i].score);
    }
  });

  it('does not crash on silence and returns zero confidence', () => {
    const result = detectAudioKey([silence(0.5, 22050)], 22050);
    expect(result.confidence).toBe(0);
    expect(['major', 'minor']).toContain(result.mode);
  });
});
