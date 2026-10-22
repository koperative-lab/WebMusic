// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {ChordAnalysisElement} from '../../src/analyze/element/score-chord-analysis';
import {projectBasicInspection} from '../../src/analyze/headless';

vi.mock('@webmusic/ui/harmony', () => import('../../../ui/src/harmony'));
vi.mock('@webmusic/ui/workbench', () => import('../../../ui/src/workbench'));

let serial = 0;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it('uses simultaneous note boundaries rather than combining consecutive chords', async () => {
    const music = score();
    const element = await mount(ChordAnalysisElement, music);
    element.grouping = 'simultaneous';
    const bands = [...element.querySelectorAll<HTMLElement>('.wui-harmony-flow__band')];
    expect(element.selection).toMatchObject({startQuarters: 0, endQuarters: 1});
    expect(element.analysis?.headline).toBe('C');
    expect(element.analysis?.evidence).toHaveLength(3);
    bands[1]!.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(element.selection).toMatchObject({startQuarters: 1, endQuarters: 2});
    expect(element.analysis?.headline).toBe('D');
    expect(element.analysis?.evidence.every((note) => !note.startsWith('C4'))).toBe(true);
    element.selectRegion(0, 2);
    expect(element.analysis?.evidence.some((item) => item.includes('C'))).toBe(true);
    expect(element.analysis?.detail).toContain('separate');
  });

  it('defaults to beat collection and can switch to simultaneous evidence and recover from invalid grouping', async () => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'Arpeggio'});
    ['C#4', 'E4', 'A4'].forEach((pitch, index) => builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: new Rational(index, 3),
      duration: Duration.triplet(Duration.eighth()), voice: VoiceId('lead'),
    }));
    const element = await mount(ChordAnalysisElement, builder.build());
    expect(element.grouping).toBe('beat');
    expect(element.analysis?.headline).toBe('A/C#');
    expect(element.querySelector('.wui-harmony-flow__pinned-name')?.textContent).toBe('A/C#');
    expect(element.querySelector('.wui-harmony-flow__pinned-note')?.textContent).toBe('C#4 E4 A4');
    element.grouping = 'simultaneous';
    expect(element.getAttribute('grouping')).toBe('simultaneous');
    expect(element.analysis?.headline).toBe('C#4');
    expect(element.querySelector('.wui-harmony-flow__pinned-name')?.textContent).toBe('');
    expect(element.querySelector('.wui-harmony-flow__pinned-note')?.textContent).toBe('C#4');
    expect(element.querySelector('[part~="index"]')?.textContent).toContain('C#4');
    expect(element.textContent).not.toContain('Unclassified note set');
    element.setAttribute('grouping', 'unknown');
    expect(element.analysis).toBeUndefined();
    expect(element.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('error');
    element.grouping = 'beat';
    expect(element.analysis?.headline).toBe('A/C#');
  });

  it('does not invent chords from meter alone and preserves short-note boundaries', () => {
    const empty = new ScoreBuilder();
    empty.addMeasure({id: empty.newMeasureId(), number: 1,
      onsetQuarters: Rational.ZERO, durationQuarters: new Rational(5, 2),
      timeSignature: {numerator: 5, denominator: 8}});
    expect(projectBasicInspection(empty.build(), 'chord').lane.bands).toEqual([]);
    const tiny = new ScoreBuilder();
    const part = tiny.newPartId();
    tiny.addPart({id: part, name: 'Tiny'});
    tiny.addNote(part, {id: tiny.newNoteId(), pitch: Pitch.parse('C4'),
      onsetQuarters: Rational.ZERO, duration: Duration.eighth(), voice: VoiceId('lead')});
    const shortLane = projectBasicInspection(tiny.build(), 'chord').lane;
    expect(shortLane.bands.map((band) => [band.stampStart, band.stampEnd])).toEqual([[0, 0.5]]);
    expect(shortLane.bands[0]).toMatchObject({primary: '', secondary: 'C4'});
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
    expect(chord.analysis?.detail).toContain('No key context');
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
