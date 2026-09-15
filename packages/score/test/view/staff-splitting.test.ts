// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import type {StaffRenderOptions} from '../../src/view/api';
import {ScoreViewElement} from '../../src/view/element/score-view';
import {renderScoreVisualizer, renderStaffVisualizer} from '../../src/view/render';
import {SimpleScorePlayerElement} from '../../src/play/element/score-player';

const io = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: io.load}));
customElements.define('split-score-view', ScoreViewElement);
customElements.define('split-score-player', SimpleScorePlayerElement);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function music() {
  const builder = new ScoreBuilder();
  for (const [name, pitches] of [['Piano', ['C4', 'C3']], ['Organ', ['E4', 'E3']]] as const) {
    const part = builder.newPartId();
    builder.addPart({id: part, name});
    for (const [index, pitch] of pitches.entries()) builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse(pitch), onsetQuarters: Rational.ZERO,
      duration: Duration.whole(), voice: VoiceId(`${name}-${index}`), staff: index + 1,
    });
  }
  return builder.build();
}

function layers(host: Element) {
  return [...host.querySelectorAll<HTMLElement>('[data-webscore-staff-layer]')];
}

function active(host: Element) {
  return [...host.querySelectorAll<SVGElement>('[data-webscore-note][data-active]')]
    .map((group) => Number(group.dataset.webscoreNote)).sort((a, b) => a - b);
}

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('score staff splitting configuration', () => {
  it.each([undefined, true, false])('forwards splitStaves=%s through both public render factories without combining parts', (splitStaves) => {
    const score = music();
    const options: StaffRenderOptions = splitStaves === undefined ? {} : {splitStaves};
    for (const factory of [
      (host: HTMLDivElement) => renderStaffVisualizer(score, host, options),
      (host: HTMLDivElement) => renderScoreVisualizer(score, host, 'staff', options),
    ]) {
      const host = document.createElement('div');
      document.body.append(host);
      const rendered = factory(host);
      try {
        expect(layers(host)).toHaveLength(splitStaves === false ? 2 : 4);
        const partPitches = new Map<string, number[]>();
        for (const layer of layers(host)) {
          const part = layer.dataset.webscorePart!;
          const pitches = [...layer.querySelectorAll<SVGElement>('[data-webscore-note]')]
            .map((group) => Number(group.dataset.webscoreNote));
          partPitches.set(part, [...(partPitches.get(part) ?? []), ...pitches].sort((a, b) => a - b));
        }
        expect([...partPitches.values()]).toEqual([[48, 60], [52, 64]]);
        expect(new Map(rendered.noteSequence.notes.map((note) => [note.pitch, note.staff])))
          .toEqual(new Map([[48, 2], [52, 2], [60, 1], [64, 1]]));
        rendered.redrawAtTime!(1.25, false);
        expect(active(host)).toEqual([48, 52, 60, 64]);
      } finally {
        rendered.dispose?.();
        host.remove();
      }
    }
  });

  it('uses boolean attribute semantics and keeps options property precedence', async () => {
    const view = document.createElement('split-score-view') as ScoreViewElement;
    view.type = 'staff';
    view.score = music();
    document.body.append(view);
    await flush();
    expect(layers(view)).toHaveLength(4);
    for (const value of ['false', '0', 'no', 'off']) {
      view.setAttribute('split-staves', value);
      expect(layers(view)).toHaveLength(2);
    }
    for (const value of ['', 'true']) {
      view.setAttribute('split-staves', value);
      expect(layers(view)).toHaveLength(4);
    }
    view.options = {splitStaves: false};
    expect(layers(view)).toHaveLength(2);
    view.setAttribute('split-staves', 'false');
    view.options = {splitStaves: true};
    expect(layers(view)).toHaveLength(4);
    view.options = undefined;
    expect(layers(view)).toHaveLength(2);
    view.removeAttribute('split-staves');
    expect(layers(view)).toHaveLength(4);
  });

  it('preserves the borrowed native score, paused nominal position and highlights while switching layouts', async () => {
    const source = document.createElement('split-score-player') as SimpleScorePlayerElement;
    source.id = 'split-player';
    source.score = music();
    document.body.append(source);
    await flush();
    source.rate = 2;
    await source.seekNominal(1.25);
    const seek = vi.spyOn(source, 'seekNominal');
    const score = source.resolvedScore;
    const snapshot = source.getPlaybackSnapshot();
    const view = document.createElement('split-score-view') as ScoreViewElement;
    view.type = 'staff';
    view.setAttribute('player', '#split-player');
    document.body.append(view);
    await flush();
    for (const split of ['false', 'true', 'false']) {
      const oldLayer = layers(view)[0];
      view.setAttribute('split-staves', split);
      expect(oldLayer.isConnected).toBe(false);
      expect(layers(view)).toHaveLength(split === 'false' ? 2 : 4);
      expect(view.score).toBe(score);
      expect(view.currentTime).toBeCloseTo(1.25);
      expect(active(view)).toEqual([48, 52, 60, 64]);
      expect(source.getPlaybackSnapshot()).toEqual(snapshot);
    }
    expect(seek).not.toHaveBeenCalled();
    expect(io.load).not.toHaveBeenCalled();
  });

  it('rerenders an already loaded source without another load', async () => {
    const score = music();
    io.load.mockResolvedValueOnce(score);
    const view = document.createElement('split-score-view') as ScoreViewElement;
    view.type = 'staff';
    view.setAttribute('src', 'grand-staff.musicxml');
    document.body.append(view);
    await vi.waitFor(() => expect(layers(view)).toHaveLength(4));
    view.setAttribute('split-staves', 'false');
    expect(layers(view)).toHaveLength(2);
    view.removeAttribute('split-staves');
    expect(layers(view)).toHaveLength(4);
    expect(view.score).toBe(score);
    expect(io.load).toHaveBeenCalledTimes(1);
  });
});
