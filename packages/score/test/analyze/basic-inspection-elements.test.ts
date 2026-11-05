// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {
  defineAllAnalysisElements, type IntervalAnalysisElement, type ScaleAnalysisElement,
  type RhythmAnalysisElement,
} from '../../src/analyze/element';

vi.mock('@webmusic/ui/harmony', () => import('../../../ui/src/harmony'));
vi.mock('@webmusic/ui/workbench', () => import('../../../ui/src/workbench'));
defineAllAnalysisElements();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function fixture(meter = {numerator: 4, denominator: 4}) {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Melody'});
  builder.addMeasure({id: builder.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO,
    durationQuarters: Rational.from(meter.numerator * 4 / meter.denominator), timeSignature: meter});
  const ids = ['C4', 'F#4', 'Gb4'].map((pitch, index) => {
    const id = builder.newNoteId();
    builder.addNote(part, {id, pitch: Pitch.parse(pitch), onsetQuarters: Rational.from(index / 2),
      duration: Duration.eighth(), voice: VoiceId('melody')});
    return String(id);
  });
  return {score: builder.build(), ids};
}

describe('basic theory Elements', () => {
  it.each([
    {tag: 'score-interval-analysis', ids: ['notes', 'motion', 'semitones']},
    {tag: 'score-scale-analysis', ids: ['note', 'reference', 'relation']},
    {tag: 'score-rhythm-analysis', ids: ['bar', 'beat', 'duration']},
  ])('$tag updates named fields in place when seeking to the next reading', async ({tag, ids}) => {
    const element = document.createElement(tag) as IntervalAnalysisElement | ScaleAnalysisElement | RhythmAnalysisElement;
    element.score = fixture().score;
    element.setAttribute('motion', 'stepped');
    if (tag === 'score-scale-analysis') element.setAttribute('tonic', 'C');
    document.body.append(element);
    await flush();
    const pinned = element.querySelector<HTMLElement>('.wui-harmony-flow__pinned')!;
    const fields = [...pinned.querySelectorAll<HTMLElement>('[data-readout-field]')];
    expect(fields.map((field) => field.dataset.readoutField)).toEqual(ids);
    const values = () => fields.map((field) => field.querySelector('.wui-harmony-flow__pinned-field-value')?.textContent);
    const before = values();
    expect(pinned.querySelector<HTMLElement>('.wui-harmony-flow__pinned-note')?.hidden).toBe(true);
    expect(fields.every((field) => !field.textContent?.includes('·'))).toBe(true);
    element.querySelector('[role="slider"]')!.dispatchEvent(new KeyboardEvent('keydown', {key: ']', bubbles: true}));
    const after = [...pinned.querySelectorAll('[data-readout-field]')];
    expect(after.every((field, index) => field === fields[index])).toBe(true);
    expect(values()).not.toEqual(before);
    expect(fields.every((field) => !field.textContent?.includes('·'))).toBe(true);
    expect(element.querySelector('[part~="index"]')?.textContent).toContain(`${ids[0] === 'notes' ? 'Notes' : ids[0] === 'note' ? 'Note' : 'Bar'}:`);
  });

  it('inspects spelled melodic intervals and supports explicit note selection', async () => {
    const {score, ids} = fixture();
    const element = document.createElement('score-interval-analysis') as IntervalAnalysisElement;
    element.score = score;
    document.body.append(element);
    await flush();
    expect(element.analysis?.kind).toBe('interval');
    expect(element.analysis?.headline).toBe('4A');
    expect(element.analysis?.evidence).toHaveLength(2);
    element.selectNotes([ids[0]!, ids[2]!]);
    expect(element.analysis?.headline).toBe('5d');
    element.setAttribute('kind', 'harmonic');
    expect(element.analysis).toBeUndefined();
    element.setAttribute('kind', 'melodic');
    element.selectNotes([]);
    expect(element.analysis?.headline).toBe('4A');
    element.selectNotes([ids[2]!]);
    element.score = fixture().score;
    await flush();
    expect(element.analysis?.headline).toBe('4A');
    element.setAttribute('pitch-mode', 'concert');
    expect(element.analysis).toBeUndefined();
    expect(element.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('error');
    element.pitchMode = 'written';
    element.selectNotes([ids[2]!]);
    element.remove();
    element.score = fixture().score;
    document.body.append(element);
    await flush();
    expect(element.analysis?.headline).toBe('4A');
  });

  it('requires an explicit tonic and distinguishes enharmonic scale degrees', async () => {
    const {score, ids} = fixture();
    const element = document.createElement('score-scale-analysis') as ScaleAnalysisElement;
    element.score = score;
    document.body.append(element);
    await flush();
    expect(element.analysis).toBeUndefined();
    expect(element.textContent).toContain('Choose a tonic');
    element.tonic = 'C';
    element.selectNotes([ids[1]!]);
    expect(element.analysis?.headline).toBe('#4');
    element.selectNotes([ids[2]!]);
    expect(element.analysis?.headline).toBe('b5');
    element.scale = 'natural-minor';
    expect(element.analysis?.detail).toContain('C natural-minor (chosen)');
    element.tonic = 'H';
    expect(element.analysis).toBeUndefined();
    expect(element.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('error');
    element.tonic = 'C';
    expect(element.analysis?.headline).toBe('b5');
  });

  it('shows the selected lower-row reading for overlapping notes', async () => {
    const builder = new ScoreBuilder();
    const part = builder.newPartId();
    builder.addPart({id: part, name: 'Two voices'});
    ['C4', 'E4'].forEach((pitch, index) => builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(), voice: VoiceId(`v${index}`),
    }));
    const element = document.createElement('score-scale-analysis') as ScaleAnalysisElement;
    element.score = builder.build();
    element.tonic = 'C';
    document.body.append(element);
    await flush();
    expect(element.querySelector('.wui-harmony-flow__pinned-name')?.textContent).toBe('Degree 1');
    element.querySelector('.wui-harmony-flow__band[data-track="1"]')!
      .dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(element.analysis?.headline).toBe('3');
    expect(element.querySelector('.wui-harmony-flow__pinned-name')?.textContent).toBe('Degree 3');
    element.clearSelection();
    expect(element.querySelector('.wui-harmony-flow__pinned-name')?.textContent).toBe('Degree 1');
  });

  it('uses compound meter beats and requires an explicit asymmetric grouping', async () => {
    const element = document.createElement('score-rhythm-analysis') as RhythmAnalysisElement;
    element.score = fixture({numerator: 6, denominator: 8}).score;
    document.body.append(element);
    await flush();
    expect(element.analysis?.kind).toBe('rhythm');
    const slider = element.querySelector<HTMLElement>('[role="slider"]')!;
    slider.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
    expect(slider.getAttribute('aria-valuetext')).toContain('quarter-note units from start');
    expect(element.querySelector('[part~="index"]')?.textContent).not.toContain('bar 1 · beat');
    element.selectRegion(0.5, 1);
    expect(element.analysis?.evidence.join(' ')).toContain('1:1 + 1/3');
    element.score = fixture({numerator: 5, denominator: 8}).score;
    await flush();
    expect(element.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('error');
    element.setAttribute('beat-groups', '2+3');
    expect(element.analysis?.kind).toBe('rhythm');
    element.selectRegion(1, 1.5);
    expect(element.analysis?.evidence.join(' ')).toContain('1:2');
    element.setAttribute('beat-groups', '3+2');
    expect(element.analysis?.evidence.join(' ')).toContain('1:1 + 2/3');
    element.setAttribute('beat-groups', '2+2');
    expect(element.analysis).toBeUndefined();
    // Several lists cover several irregular numerators; the matching one applies to 5/8.
    element.setAttribute('beat-groups', '2+2+3, 2+3');
    expect(element.analysis?.kind).toBe('rhythm');
    element.selectRegion(1, 1.5);
    expect(element.analysis?.evidence.join(' ')).toContain('1:2');
    element.setAttribute('beat-groups', '2+3 3+2');
    expect(element.analysis).toBeUndefined();
    expect(element.querySelector('.wui-workbench')?.getAttribute('data-phase')).toBe('error');
    element.setAttribute('subdivision', 'x');
    element.setAttribute('beat-groups', '2+3');
    expect(element.analysis).toBeUndefined();
    element.removeAttribute('subdivision');
    expect(element.analysis?.kind).toBe('rhythm');
  });

  it('ignores attributes a tool does not observe instead of entering an error state', async () => {
    const chord = document.createElement('score-chord-analysis') as HTMLElement & {analysis?: {kind: string}};
    chord.setAttribute('subdivision', 'x');
    chord.setAttribute('kind', 'sideways');
    (chord as HTMLElement & {score?: unknown}).score = fixture().score;
    document.body.append(chord);
    await flush();
    expect(chord.analysis?.kind).toBe('chord');
    expect(chord.querySelector('.wui-workbench')?.getAttribute('data-phase')).not.toBe('error');
  });

  it('ignores an unobserved pitch mode on the rhythm tool', async () => {
    const element = document.createElement('score-rhythm-analysis') as RhythmAnalysisElement;
    element.setAttribute('pitch-mode', 'concert');
    element.score = fixture().score;
    document.body.append(element);
    await flush();
    expect(element.analysis?.kind).toBe('rhythm');
    expect(element.querySelector('.wui-workbench')?.getAttribute('data-phase')).not.toBe('error');
    element.setAttribute('subdivision', '3');
    expect(element.analysis?.kind).toBe('rhythm');
  });

  it.each([' 2 + 3 ', '2 + 3 2 + 2 + 3', '2 + 3, 2 + 2 + 3'])(
    'preserves whitespace around + in beat-groups="%s"', async (groups) => {
      const element = document.createElement('score-rhythm-analysis') as RhythmAnalysisElement;
      element.setAttribute('beat-groups', groups);
      element.score = fixture({numerator: 5, denominator: 8}).score;
      document.body.append(element);
      await flush();
      expect(element.analysis?.kind).toBe('rhythm');
      element.selectRegion(1, 1.5);
      expect(element.analysis?.evidence.join(' ')).toContain('1:2');
      expect(element.querySelector('.wui-workbench')?.getAttribute('data-phase')).not.toBe('error');
    },
  );
});
