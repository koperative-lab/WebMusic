// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadScore} from '@webmusic/score/io';
import {Pitch, Rational, isPitchedNote} from '@webmusic/score';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {projectArabesqueMaterial, sourceSpanAt} from '../src/lib/ui-presenter-demos/arabesque-material';

const boundaries = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../src/components/headless/arabesque-score', () => ({loadArabesqueScore: boundaries.load}));
const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
const scorePromise = loadScore(readFileSync(resolve(publicRoot, 'mxl/Arabesque No.1.mxl')), {format: 'mxl'});

afterEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); });

describe('UI presenter Arabesque material', () => {
  it('uses original simultaneous pitches, registers, spelling and time-map positions', async () => {
    const score = await scorePromise;
    const material = projectArabesqueMaterial(score);
    expect(material.quarters).toBe(16);
    expect(material.duration).toBe(score.timeMap.quartersToSeconds(new Rational(16)));
    expect(material.spans.length).toBeGreaterThan(10);
    const sourceNames = new Set(score.notes.filter(isPitchedNote).map((note) => note.pitch.toString()));
    for (const span of material.spans) {
      expect(span.start).toBe(score.timeMap.quartersToSeconds(Rational.from(span.stampStart)));
      expect(span.end).toBe(score.timeMap.quartersToSeconds(Rational.from(span.stampEnd)));
      expect(sourceSpanAt(material.spans, (span.start + span.end) / 2)).toBe(material.spans.indexOf(span));
      const active = new Set(score.notes.filter(isPitchedNote).filter((note) =>
        note.onsetQuarters.toFloat() < span.stampEnd && note.offsetQuarters.toFloat() > span.stampStart
      ).map((note) => note.pitch.toString()));
      expect(new Set(span.chord.tones.map((tone) => tone.label))).toEqual(active);
      for (const tone of span.chord.tones) {
        expect(sourceNames.has(tone.label)).toBe(true);
        expect(tone.midi).toBe(Pitch.parse(tone.label).midi);
      }
      expect(span.chord).not.toHaveProperty('confidence');
      expect(span.chord).not.toHaveProperty('roman');
    }
    for (let i = 1; i < material.spans.length; i++) expect(material.spans[i].start).toBe(material.spans[i - 1].end);
  });

  it('does not mount a destroyed borrower when shared loading completes', async () => {
    vi.resetModules();
    const {mountArabesqueMaterial} = await import('../src/lib/ui-presenter-demos/arabesque-material');
    let finish!: (score: Awaited<typeof scorePromise>) => void;
    boundaries.load.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const host = document.createElement('div'); document.body.append(host);
    const mount = vi.fn(() => ({destroy: vi.fn()}));
    const handle = mountArabesqueMaterial(host, mount);
    handle.destroy(); finish(await scorePromise);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(mount).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
  });

  it('retries an asset failure and applies controls selected during loading', async () => {
    vi.resetModules();
    const {mountArabesqueMaterial} = await import('../src/lib/ui-presenter-demos/arabesque-material');
    boundaries.load.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(await scorePromise);
    const host = document.createElement('div'); document.body.append(host);
    const inner = {destroy: vi.fn(), setState: vi.fn(), setOption: vi.fn()};
    const mount = vi.fn(() => inner);
    const handle = mountArabesqueMaterial(host, mount);
    handle.setState?.('position', 'half'); handle.setOption?.('stylesheet', false);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(host.textContent).toContain('offline');
    host.querySelector('button')!.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(boundaries.load).toHaveBeenLastCalledWith('mxl');
    expect(mount).toHaveBeenCalledOnce();
    expect(inner.setState).toHaveBeenCalledWith('position', 'half');
    expect(inner.setOption).toHaveBeenCalledWith('stylesheet', false);
    handle.destroy(); expect(inner.destroy).toHaveBeenCalledOnce();
  });

  it('releases a partial mount when replaying a control fails and permits retry', async () => {
    vi.resetModules();
    const {mountArabesqueMaterial} = await import('../src/lib/ui-presenter-demos/arabesque-material');
    boundaries.load.mockResolvedValue(await scorePromise);
    const host = document.createElement('div'); document.body.append(host);
    const failed = {destroy: vi.fn(), setOption: vi.fn(() => { throw new Error('option failed'); })};
    const replacement = {destroy: vi.fn(), setOption: vi.fn()};
    const mount = vi.fn().mockReturnValueOnce(failed).mockReturnValueOnce(replacement);
    const handle = mountArabesqueMaterial(host, mount);
    handle.setOption?.('label', 'Arabesque');
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(failed.destroy).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('option failed');
    host.querySelector('button')!.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(mount).toHaveBeenCalledTimes(2);
    expect(replacement.setOption).toHaveBeenCalledWith('label', 'Arabesque');
    handle.destroy(); expect(replacement.destroy).toHaveBeenCalledOnce();
  });
});
