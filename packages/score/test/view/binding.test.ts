import {describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import type {RenderedScoreVisualizer} from '../../src/view/core/types';
import {createScoreView} from '../../src/view/headless';
import {scoreToNoteSequence} from '../../src/view/core/note-sequence';
import {bindPlayerToVisualizer, type PlayerBindingHandlers} from '../../src/view/render/binding';

function chordScore() {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Chord'});
  for (const pitch of ['C4', 'E4']) {
    builder.addNote(part, {
      id: builder.newNoteId(),
      pitch: Pitch.parse(pitch),
      onsetQuarters: Rational.ZERO,
      duration: Duration.whole(),
      voice: VoiceId(`${part}-v1`),
    });
  }
  return builder.build();
}

describe('bindPlayerToVisualizer with a ScoreView controller', () => {
  it('updates headless state before drawing and retains unreleased chord notes', () => {
    const controller = createScoreView(chordScore());
    const order: string[] = [];
    controller.subscribe(() => order.push('controller'));
    const rendered: RenderedScoreVisualizer = {
      noteSequence: controller.sequence,
      visualizer: {},
      redraw: vi.fn(() => {
        order.push('renderer');
        return null;
      }),
      clearActiveNotes: vi.fn(() => order.push('clear')),
    };
    let handlers!: PlayerBindingHandlers;
    const unbind = bindPlayerToVisualizer(
      rendered,
      (next) => {
        handlers = next;
        return vi.fn();
      },
      controller,
    );

    handlers.noteOn(60, 0);
    expect(order.slice(0, 2)).toEqual(['controller', 'renderer']);
    handlers.noteOn(64, 0);
    handlers.noteOff(60, 0);
    expect(controller.state.activeNotes.map((note) => note.pitch)).toEqual([64]);
    expect(rendered.redraw).toHaveBeenLastCalledWith(
      expect.objectContaining({pitch: 64}),
      false,
    );

    handlers.end();
    expect(controller.state.activeNotes).toEqual([]);
    expect(rendered.clearActiveNotes).toHaveBeenCalled();
    unbind();
  });
});

function unisonScore() {
  const builder = new ScoreBuilder();
  for (const name of ['First', 'Second']) {
    const part = builder.newPartId();
    builder.addPart({id: part, name});
    builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
      duration: Duration.whole(), voice: VoiceId(name),
    });
  }
  return builder.build();
}

describe('bindPlayerToVisualizer counted events and ownership', () => {
  it.each([false, true])('retains cross-part unisons until the final release (controller=%s)', (withController) => {
    const score = unisonScore();
    const controller = withController ? createScoreView(score) : undefined;
    const rendered: RenderedScoreVisualizer = {
      noteSequence: scoreToNoteSequence(score), visualizer: {},
      redraw: vi.fn(() => null), clearActiveNotes: vi.fn(), dispose: vi.fn(),
    };
    let handlers!: PlayerBindingHandlers;
    const unbind = bindPlayerToVisualizer(rendered, (next) => { handlers = next; return vi.fn(); }, controller);
    handlers.noteOn(60, 0);
    handlers.noteOn(60, 0);
    const redraws = vi.mocked(rendered.redraw).mock.calls.length;
    handlers.noteOff(60, 1); // different onset cannot consume either event
    handlers.noteOff(64, 0); // different pitch cannot consume either event
    handlers.noteOff(60, 1e-8); // the sequence's documented onset tolerance
    expect(rendered.clearActiveNotes).not.toHaveBeenCalled();
    if (controller) expect(controller.state.activeNotes.map((note) => note.pitch)).toEqual([60, 60]);
    else expect(rendered.redraw).toHaveBeenCalledTimes(redraws);
    handlers.noteOff(60, 0);
    expect(rendered.clearActiveNotes).toHaveBeenCalledOnce();
    if (controller) expect(controller.state.activeNotes).toEqual([]);
    unbind();
    expect(rendered.dispose).not.toHaveBeenCalled();
    if (controller) expect(() => controller.seek(0)).not.toThrow();
  });

  it('resets counts on end, ignores unmatched releases and permits a fresh performance', () => {
    const rendered: RenderedScoreVisualizer = {
      noteSequence: scoreToNoteSequence(chordScore()), visualizer: {},
      redraw: vi.fn(() => null), clearActiveNotes: vi.fn(),
    };
    let handlers!: PlayerBindingHandlers;
    const unbind = bindPlayerToVisualizer(rendered, (next) => { handlers = next; return vi.fn(); });
    handlers.noteOn(60, 0);
    handlers.noteOn(60, 0);
    handlers.noteOn(64, 0);
    handlers.noteOff(60, 0);
    handlers.noteOff(60, 0);
    expect(rendered.redraw).toHaveBeenLastCalledWith(expect.objectContaining({pitch: 64}), false);
    handlers.end();
    expect(rendered.clearActiveNotes).toHaveBeenCalledOnce();
    handlers.noteOff(64, 0);
    expect(rendered.clearActiveNotes).toHaveBeenCalledOnce();
    handlers.noteOn(60, 0);
    handlers.noteOff(60, 0);
    expect(rendered.clearActiveNotes).toHaveBeenCalledTimes(2);
    unbind();
  });

  it('makes teardown idempotent, ignores queued events and clears even if unsubscribe throws', () => {
    const controller = createScoreView(unisonScore());
    const rendered: RenderedScoreVisualizer = {
      noteSequence: controller.sequence, visualizer: {},
      redraw: vi.fn(() => null), clearActiveNotes: vi.fn(),
    };
    let handlers!: PlayerBindingHandlers;
    const unsubscribe = vi.fn(() => { handlers.noteOn(60, 0); throw new Error('unsubscribe failed'); });
    const unbind = bindPlayerToVisualizer(rendered, (next) => { handlers = next; return unsubscribe; }, controller);
    handlers.noteOn(60, 0);
    expect(() => unbind()).toThrow('unsubscribe failed');
    expect(controller.state.activeNotes).toEqual([]);
    expect(rendered.clearActiveNotes).toHaveBeenCalledOnce();
    handlers.noteOn(60, 0);
    handlers.noteOff(60, 0);
    handlers.end();
    unbind();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(rendered.redraw).toHaveBeenCalledOnce();
    expect(rendered.clearActiveNotes).toHaveBeenCalledOnce();
  });

  it('does not repaint after controller subscribers synchronously unbind the owner', () => {
    const controller = createScoreView(unisonScore());
    const rendered: RenderedScoreVisualizer = {
      noteSequence: controller.sequence, visualizer: {},
      redraw: vi.fn(() => null), clearActiveNotes: vi.fn(),
    };
    let handlers!: PlayerBindingHandlers;
    const unbind = bindPlayerToVisualizer(rendered, (next) => { handlers = next; return vi.fn(); }, controller);
    controller.subscribe((state) => { if (state.activeNotes.length) unbind(); });
    handlers.noteOn(60, 0);
    expect(rendered.redraw).not.toHaveBeenCalled();
    expect(rendered.clearActiveNotes).toHaveBeenCalledOnce();
  });

  it('releases controller-seek state even if the binding did not observe its noteOn', () => {
    const controller = createScoreView(unisonScore());
    controller.seek(1);
    const rendered: RenderedScoreVisualizer = {
      noteSequence: controller.sequence, visualizer: {},
      redraw: vi.fn(() => null), clearActiveNotes: vi.fn(),
    };
    let handlers!: PlayerBindingHandlers;
    const unbind = bindPlayerToVisualizer(rendered, (next) => { handlers = next; return vi.fn(); }, controller);
    handlers.noteOff(60, 0);
    expect(controller.state.activeNotes).toEqual([]);
    expect(rendered.clearActiveNotes).toHaveBeenCalledOnce();
    unbind();
  });

  it('cleans synchronously delivered events when subscription initialization fails', () => {
    const rendered: RenderedScoreVisualizer = {
      noteSequence: scoreToNoteSequence(unisonScore()), visualizer: {},
      redraw: vi.fn(() => null), clearActiveNotes: vi.fn(),
    };
    let handlers!: PlayerBindingHandlers;
    expect(() => bindPlayerToVisualizer(rendered, (next) => {
      handlers = next;
      next.noteOn(60, 0);
      throw new Error('subscribe failed');
    })).toThrow('subscribe failed');
    expect(rendered.clearActiveNotes).toHaveBeenCalledOnce();
    handlers.noteOn(60, 0);
    expect(rendered.redraw).toHaveBeenCalledOnce();
  });
});
