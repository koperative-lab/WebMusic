import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Rational} from '@webmusic/score';
import {loadScore} from '@webmusic/score/io';
import {describe, expect, it} from 'vitest';
import {studyExcerpt, studyUrl} from '../src/components/headless/study-score';

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

describe('shared WebMusic Study demo source', () => {
  it('uses browser-safe paths for the two available Score formats', () => {
    expect(studyUrl('midi')).toMatch(/midi\/webmusic-study-no-1\.mid$/);
    expect(studyUrl('mxl')).toMatch(/mxl\/webmusic-study-no-1\.mxl$/);
  });

  it.each(['midi', 'mxl'] as const)('derives a bounded %s passage without changing the imported score', async (format) => {
    const file = format === 'midi' ? 'midi/webmusic-study-no-1.mid' : 'mxl/webmusic-study-no-1.mxl';
    const score = await loadScore(readFileSync(resolve(publicRoot, file)), {format});
    const originalNotes = score.notes.length;
    const excerpt = studyExcerpt(score);

    expect(excerpt.notes.length).toBeGreaterThan(0);
    expect(excerpt.notes.length).toBeLessThan(originalNotes);
    expect(excerpt.durationSeconds).toBeLessThan(score.durationSeconds);
    expect(score.notes.length).toBe(originalNotes);
    expect(excerpt.metadata.title).toBe(score.metadata.title);
    if (format === 'mxl') expect(excerpt.measures.length).toBeGreaterThan(0);
    const end = new Rational(16);
    for (const part of excerpt.parts) {
      expect(part.directions?.every((direction) => direction.onsetQuarters.lt(end))).not.toBe(false);
      expect(part.clefChanges?.every((change) => change.onsetQuarters.lt(end))).not.toBe(false);
    }
    expect(excerpt.timeMap.tempi.every((entry) => entry.atQuarters.lt(end))).toBe(true);
    expect(excerpt.timeMap.meters.every((entry) => entry.atQuarters.lt(end))).toBe(true);
  });
});
