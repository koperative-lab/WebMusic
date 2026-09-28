// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {existsSync, readFileSync} from 'node:fs';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {loadScore} from '../../src/io';
import {ChordAnalysisElement} from '../../src/analyze/element/score-chord-analysis';
import {projectChordCells} from '../../src/analyze/element/internal/chord-cells';

vi.mock('@webmusic/ui/harmony', () => import('../../../ui/src/harmony'));
vi.mock('@webmusic/ui/workbench', () => import('../../../ui/src/workbench'));

let serial = 0;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function arabesqueBytes(format: 'midi' | 'mxl'): Uint8Array {
  const asset = `apps/doc/webmusic/public/${format === 'midi' ? 'midi/Arabesque No.1.mid' : 'mxl/Arabesque No.1.mxl'}`;
  return readFileSync(existsSync(asset) ? asset : `../../${asset}`);
}

function score(): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  const tones = [
    [0, 'C4', 'lead'], [0, 'E4', 'middle'], [0, 'G4', 'top'],
    [1, 'D4', 'lead'], [1, 'F#4', 'middle'], [1, 'A4', 'top'],
    [2, 'E4', 'lead'], [2.5, 'G4', 'lead'],
  ] as const;
  for (const [at, pitch, voice] of tones) {
    builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse(pitch),
      onsetQuarters: Rational.from(at), duration: Duration.quarter(), voice: VoiceId(voice),
      ...(at === 2.5 ? {articulations: ['accent' as const],
        performed: {onsetSec: 1.31, durationSec: 0.5, velocity: 96}} : {}),
    });
  }
  return builder.build();
}

function chromaticScore(): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Chromatic'});
  for (let index = 0; index < 12; index += 1) {
    builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.fromMidi(60 + index),
      onsetQuarters: Rational.from(0), duration: Duration.quarter(), voice: VoiceId(`v${index}`),
    });
  }
  return builder.build();
}

async function mount<T extends HTMLElement>(constructor: {new(): T}, music = score()): Promise<T> {
  const tag = `inspection-${serial++}`;
  customElements.define(tag, class extends constructor {});
  const element = document.createElement(tag) as T & {score?: Score};
  element.score = music;
  element.setAttribute('motion', 'stepped');
  document.body.append(element);
  await flush();
  return element;
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('score inspection Elements', () => {
  it('inspects chord evidence without showing candidate controls', async () => {
    const element = await mount(ChordAnalysisElement);
    const initial = element.analysis;
    expect(initial?.kind).toBe('chord');
    expect(initial?.evidence.some((item) => item.includes('C4'))).toBe(true);
    expect(initial?.candidates.length).toBeGreaterThan(0);
    expect(element.querySelector('.webscore-analyze__candidate-host')).toBeNull();
    const picks: CustomEvent[] = [];
    element.addEventListener('webscore:chordpick', (event) => picks.push(event as CustomEvent));
    expect(element.querySelector('[part~="inspection"]')).toBeNull();
    const selected: CustomEvent[] = [];
    element.addEventListener('webscore:analysisselect', (event) => selected.push(event as CustomEvent));
    const bands = element.querySelectorAll('.wui-harmony-flow__lane[data-track="0"] > *');
    expect(bands.length).toBeGreaterThan(1);
    bands[1]!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(selected).toHaveLength(1);
    expect(selected[0].composed).toBe(true);
    expect(selected[0].detail.kind).toBe('chord');
    element.key = 'C major';
    expect(element.analysis?.detail).toContain('in C major (chosen)');
    expect(element.analysis?.evidence.length).toBeGreaterThan(0);
    expect(picks).toHaveLength(0);
    expect(element.score).toBeDefined();
  });

  it('keeps dense Arabesque harmony readable and cell inspection aligned with the lane', async () => {
    const music = await loadScore(arabesqueBytes('mxl'), {format: 'mxl'});
    const element = await mount(ChordAnalysisElement, music);
    const bands = [...element.querySelectorAll<HTMLElement>('.wui-harmony-flow__band')];
    expect(bands).toHaveLength(music.measures.length * 2);
    expect(bands.length).toBeLessThan(300);
    expect(element.selection).toMatchObject({startQuarters: 0, endQuarters: 2});
    expect(element.analysis?.headline).toBe(bands[0]?.querySelector('.wui-harmony-flow__label')?.textContent);
    expect(element.analysis?.evidence.length).toBeGreaterThan(3);
    expect(element.querySelector<HTMLElement>('.wui-harmony-flow__pinned')?.style.minHeight).toBe('1.1em');

    bands[1]!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(element.selection).toMatchObject({startQuarters: 2, endQuarters: 4});
    expect(element.analysis?.headline).toBe(bands[1]?.querySelector('.wui-harmony-flow__label')?.textContent);
  });

  it('uses the MIDI demo meter grid when the imported score has no measure objects', async () => {
    const music = await loadScore(arabesqueBytes('midi'), {format: 'midi'});
    expect(music.measures).toHaveLength(0);
    const lane = projectChordCells(music, {bands: [], now: 0}, {spelling: 'auto'});
    expect(lane.bands.length).toBeGreaterThan(200);
    expect(lane.bands.length).toBeLessThan(220);
    expect(lane.bands[0]).toMatchObject({stampStart: 0, stampEnd: 2});
    expect(lane.bands[1]).toMatchObject({stampStart: 2, stampEnd: 4});
    expect(lane.bands[lane.bands.length - 1]?.stampEnd).toBeCloseTo(music.durationQuarters.toFloat());
  });

  it('splits odd and changed meters at beat boundaries and keeps tiny scores to one cell', () => {
    const builder = new ScoreBuilder();
    builder.addMeasure({id: builder.newMeasureId(), number: 1,
      onsetQuarters: Rational.ZERO, durationQuarters: new Rational(5, 2),
      timeSignature: {numerator: 5, denominator: 8}});
    builder.addMeasure({id: builder.newMeasureId(), number: 2,
      onsetQuarters: new Rational(5, 2), durationQuarters: new Rational(3),
      timeSignature: {numerator: 3, denominator: 4}});
    const mixed = projectChordCells(builder.build(), {bands: [], now: 0}, {spelling: 'auto'});
    expect(mixed.bands.map((band) => [band.stampStart, band.stampEnd])).toEqual([
      [0, 1], [1, 2.5], [2.5, 3.5], [3.5, 5.5],
    ]);

    const tiny = new ScoreBuilder();
    const part = tiny.newPartId();
    tiny.addPart({id: part, name: 'Tiny'});
    tiny.addNote(part, {id: tiny.newNoteId(), pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO, duration: Duration.eighth(), voice: VoiceId('lead')});
    const shortLane = projectChordCells(tiny.build(), {bands: [], now: 0}, {spelling: 'auto'});
    expect(shortLane.bands.map((band) => [band.stampStart, band.stampEnd])).toEqual([[0, 0.5]]);
  });

  it('keeps publicly returned inspection data separate from local selection state', async () => {
    const element = await mount(ChordAnalysisElement);
    const original = element.selection;
    const inspection = element.analysis as unknown as {
      selection: {startQuarters: number};
      evidence: string[];
      candidates: Array<{label: string}>;
    };
    inspection.selection.startQuarters = 99;
    inspection.evidence.push('injected');
    if (inspection.candidates[0]) inspection.candidates[0].label = 'injected';
    expect(element.selection).toEqual(original);
    expect(element.analysis?.evidence).not.toContain('injected');
    expect(element.analysis?.candidates[0]?.label).not.toBe('injected');
  });

  it('does not infer a chord key-relative degree from evenly weighted pitch classes', async () => {
    const music = chromaticScore();
    const chord = await mount(ChordAnalysisElement, music);
    chord.selectRegion(0, 1);
    expect(chord.analysis?.detail).toContain('No reliable key context');
    chord.key = 'C major';
    expect(chord.analysis?.detail).toContain('in C major (chosen)');
  });

  it('does not seek a replaced owner after a band selection listener rebinds', async () => {
    const music = score();
    const player = Object.assign(document.createElement('div'), {
      resolvedScore: music, seekNominal: vi.fn(),
    });
    player.id = 'selection-owner';
    document.body.append(player);
    const element = await mount(ChordAnalysisElement, music);
    element.setAttribute('player', '#selection-owner');
    await flush();
    element.addEventListener('webscore:analysisselect', () => element.removeAttribute('player'), {once: true});
    const band = element.querySelectorAll('.wui-harmony-flow__lane[data-track="0"] > *')[1];
    expect(band).toBeDefined();
    band!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(player.seekNominal).not.toHaveBeenCalled();
  });

});
