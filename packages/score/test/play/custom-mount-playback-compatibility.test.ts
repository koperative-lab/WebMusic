// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, locateSeconds, type Score} from '../../src/core';
import {ScorePlayerElement} from '../../src/play/element/score-player';
import type {PresetPlayerHandle, PresetPlayerOptions} from '../../src/play/element/internal/preset-player';
import {VoiceLeadingAnalysisElement} from '../../src/analyze/element/voice-leading-analysis';
import {bindAnalysisPlayer} from '../../src/analyze/element/internal/player-binding';
import {ScoreViewElement as PreviewScoreViewElement} from '../../src/view/element/score-view';
class ScorePreviewElement extends PreviewScoreViewElement {
  override connectedCallback(): void { this.type = 'map'; super.connectedCallback(); }
}
import {ScoreViewElement} from '../../src/view/element/score-view';

const visual = vi.hoisted(() => ({redraw: vi.fn(), clearActiveNotes: vi.fn(), dispose: vi.fn()}));
vi.mock('../../src/view/render/score-visualizer', () => ({
  renderScoreVisualizer: () => ({
    ...visual,
    visualizer: {},
    noteSequence: {
      ticksPerQuarter: 220, tempos: [{time: 0, qpm: 120}],
      timeSignatures: [], keySignatures: [], partInfos: [], totalTime: 2,
      notes: [{pitch: 60, startTime: 0, endTime: 2}],
    },
  }),
}));

class CustomMountPlayer extends ScorePlayerElement {
  callbacks?: PresetPlayerOptions;
  readonly seekCalls: number[] = [];
  readonly destroyHandle = vi.fn();

  protected override mountScore(score: Score, options: PresetPlayerOptions): PresetPlayerHandle {
    this.callbacks = options;
    return {
      element: document.createElement('div'),
      button: document.createElement('button'),
      progress: document.createElement('div'),
      progressFill: document.createElement('span'),
      play: async () => {}, pause() {}, stop() {}, isPlaying: () => false,
      setChrome() {}, destroy: this.destroyHandle,
      // Existing custom handles can implement playback without exposing
      // the built-in ScorePlayer through the optional .player property.
      seek: (seconds) => {
        this.seekCalls.push(seconds);
        options.onCursor?.(locateSeconds(score, seconds * this.rate));
      },
    };
  }
}

customElements.define('compat-custom-mount-player', CustomMountPlayer);
customElements.define('compat-custom-mount-timeline', VoiceLeadingAnalysisElement);
customElements.define('compat-custom-mount-map', ScorePreviewElement);
customElements.define('compat-custom-mount-view', ScoreViewElement);

const detachments: Array<() => void> = [];
const flush = async () => { for (let index = 0; index < 20; index += 1) await Promise.resolve(); };

function music(): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Part'});
  builder.addNote(part, {
    id: builder.newNoteId(), pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO, duration: Duration.whole(), voice: VoiceId('voice'),
  });
  return builder.build();
}

afterEach(() => {
  for (const detach of detachments.splice(0)) detach();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('ScorePlayerElement custom mount compatibility', () => {
  it('keeps legacy Analyze/View events and nominal companion seeks when the native source is unavailable', async () => {
    const score = music();
    const player = document.createElement('compat-custom-mount-player') as CustomMountPlayer;
    player.id = 'custom-owner';
    player.score = score;
    player.rate = 2;
    document.body.append(player);
    await flush();
    expect(player.playback.snapshot().readiness).toBe('unavailable');
    expect(player.callbacks).toBeDefined();

    const timeline = document.createElement('compat-custom-mount-timeline') as VoiceLeadingAnalysisElement;
    const map = document.createElement('compat-custom-mount-map') as ScorePreviewElement;
    const view = document.createElement('compat-custom-mount-view') as ScoreViewElement;
    for (const follower of [timeline, map, view]) {
      follower.score = score;
      follower.setAttribute('player', '#custom-owner');
      document.body.append(follower);
    }
    const analysis = document.createElement('div');
    analysis.setAttribute('player', '#custom-owner');
    document.body.append(analysis);
    const noteOn = vi.fn();
    const noteOff = vi.fn();
    const timeUpdate = vi.fn();
    const end = vi.fn();
    const detach = bindAnalysisPlayer(analysis, {noteOn, noteOff, timeUpdate, end});
    if (detach) detachments.push(detach);
    await flush();

    const note = score.parts[0]!.notes[0]!;
    player.callbacks!.onNoteOn?.(note);
    player.callbacks!.onCursor?.(locateSeconds(score, 0.5));
    expect(noteOn).toHaveBeenCalledExactlyOnceWith(60);
    expect(timeUpdate).toHaveBeenCalledExactlyOnceWith(0.5, expect.objectContaining({nominalSeconds: 0.5}));
    expect(map.currentTime).toBeCloseTo(0.5);
    expect(visual.redraw).toHaveBeenCalledWith(expect.objectContaining({pitch: 60}), true);

    for (const [follower, quarters, expectedTransportSeconds] of [
      [timeline, 4, 1], [map, 4, 1],
    ] as const) {
      if (follower === timeline) {
        const seek = follower.querySelector('[role="slider"]');
        expect(seek).not.toBeNull();
        seek!.dispatchEvent(new KeyboardEvent('keydown', {key: 'End', bubbles: true}));
      } else {
        const seek = follower.querySelector<HTMLInputElement>('input[type=range]');
        expect(seek).not.toBeNull();
        seek!.value = String(quarters);
        seek!.dispatchEvent(new Event('input', {bubbles: true}));
      }
      await flush();
      expect(player.seekCalls.at(-1)).toBe(expectedTransportSeconds);
      expect(map.currentTime).toBeCloseTo(quarters / 2);
    }

    player.callbacks!.onNoteOff?.(note);
    player.callbacks!.onEnd?.();
    expect(noteOff).toHaveBeenCalledExactlyOnceWith(60);
    expect(end).toHaveBeenCalledTimes(1);
    expect(visual.clearActiveNotes).toHaveBeenCalled();

    detach?.();
    view.remove();
    visual.redraw.mockClear();
    noteOn.mockClear();
    player.callbacks!.onNoteOn?.(note);
    expect(noteOn).not.toHaveBeenCalled();
    expect(visual.redraw).not.toHaveBeenCalled();
    player.remove();
    expect(player.destroyHandle).toHaveBeenCalledTimes(1);
  });
});
