import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadScore} from '@webmusic/score/io';
import {describe, expect, it} from 'vitest';
import {SCORE_ANALYZE_PARAMS} from '../src/lib/params/score-analyze';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tags = [
  'score-chord-analysis',
  'score-interval-analysis',
  'score-scale-analysis',
  'score-rhythm-analysis',
] as const;
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Score Analyze live-tool demos', () => {
  it('documents four elementary tools with the existing Arabesque notation source', () => {
    expect(Object.keys(SCORE_ANALYZE_PARAMS)).toEqual(tags);
    for (const tag of tags) {
      const page = read(`src/content/docs/score/element/analyze/${tag}.mdx`);
      expect(page).toContain(`<AnalysisFeaturePlayground tag="${tag}" />`);
      expect(page).toContain('<score-player id="piece" src="/mxl/Arabesque%20No.1.mxl"></score-player>');
      expect(page).toContain(`<${tag} player="#piece"`);
      expect(page).not.toContain('/xml/pattern-recurrence.musicxml');
    }
  });

  it('copies one player and the selected analysis surface from the real composition', () => {
    const demo = read('src/components/elements/AnalysisFeaturePlayground.astro');
    expect(demo).toContain('markup="[data-demo-composition]"');
    expect(demo).toContain('<ElementComposition>');
    expect(demo.match(/<score-player\b/g)).toHaveLength(1);
    expect(demo).toContain('const SRC = `${import.meta.env.BASE_URL}mxl/Arabesque%20No.1.mxl`;');
    expect(demo).toContain('<score-player id={playerId} src={SRC}></score-player>');
    for (const tag of tags) expect(demo).toContain(`<${tag} player={`);
    expect(demo).not.toContain('<motif-analysis');
    expect(demo).not.toContain('<rhythm-pattern-analysis');
    expect(demo).not.toContain('<score-live-chord-analysis');
    expect(demo).not.toContain('pattern-recurrence.musicxml');
    expect(demo).toContain('defineScorePlayerElement()');
    expect(demo).toContain('defineAllAnalysisElements()');
  });

  it('offers explicit chord modes and scale context without a key-estimation control', () => {
    expect(SCORE_ANALYZE_PARAMS['score-chord-analysis'].params.find((param) => param.name === 'mode')).toMatchObject({options: ['score', 'live'], fallback: 'score'});
    expect(SCORE_ANALYZE_PARAMS['score-chord-analysis'].params.find((param) => param.name === 'grouping')).toMatchObject({options: ['beat', 'simultaneous'], fallback: 'beat'});
    expect(SCORE_ANALYZE_PARAMS['score-scale-analysis'].params.find((param) => param.name === 'scale')).toMatchObject({options: ['major', 'natural-minor', 'harmonic-minor', 'melodic-minor-ascending', 'melodic-minor-descending']});
    const demo = read('src/components/elements/AnalysisFeaturePlayground.astro');
    expect(demo).toContain('tonic="E" scale="major"');
    expect(demo).toContain('window="1" grouping="beat"');
  });

  it('loads the bundled Arabesque MXL as a playable spelled score', async () => {
    const bytes = readFileSync(resolve(root, 'public/mxl/Arabesque No.1.mxl'));
    const score = await loadScore(bytes, {format: 'mxl'});
    expect(score.notes.length).toBeGreaterThan(0);
    expect(score.durationSeconds).toBeGreaterThan(0);
    expect(score.notes.some((note) => note.pitch?.step === 'F' && note.pitch.alter === 1)).toBe(true);
  });
});
