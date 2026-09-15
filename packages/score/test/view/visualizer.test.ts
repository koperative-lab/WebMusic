import {describe, expect, it} from 'vitest';
import {BaseSVGVisualizer} from '../../src/view/render/renderers/svg';
import type {ScoreNoteSequence, ScoreSequenceNote} from '../../src/view/core/types';

/**
 * Lightweight stand-in for an SVG <rect> — enough surface for the
 * fill/unfill bookkeeping, which no longer touches the DOM tree
 * (no querySelectorAll), so plain objects suffice in Node.
 */
function stubRect(index: number) {
  const classes = new Set<string>();
  return {
    attrs: {} as Record<string, string>,
    dataset: {index: String(index)},
    isConnected: true,
    setAttribute(key: string, value: string) {
      this.attrs[key] = value;
    },
    getAttribute(key: string) {
      return this.attrs[key] ?? null;
    },
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
  };
}
type StubRect = ReturnType<typeof stubRect>;

function makeSequence(): ScoreNoteSequence {
  const notes: ScoreSequenceNote[] = [
    {pitch: 60, velocity: 80, startTime: 0, endTime: 0.5},
    {pitch: 64, velocity: 80, startTime: 0.5, endTime: 1},
    {pitch: 67, velocity: 80, startTime: 1, endTime: 1.5},
  ];
  return {
    ticksPerQuarter: 220,
    tempos: [{time: 0, qpm: 120}],
    timeSignatures: [],
    keySignatures: [],
    partInfos: [],
    notes,
    totalTime: 1.5,
  };
}

/** Exposes the protected active-rect bookkeeping for testing. */
class TestVisualizer extends BaseSVGVisualizer {
  fill(element: StubRect, note: ScoreSequenceNote): void {
    this.fillActiveRect(element as unknown as Element, note);
  }

  unfill(): void {
    this.unfillActiveRect(undefined as unknown as SVGSVGElement);
  }

  get activeCount(): number {
    return this.activeElements.size;
  }

  clearAll(): void {
    this.clear();
  }
}

describe('BaseSVGVisualizer active-rect bookkeeping', () => {
  it('registers rects in fillActiveRect and restores them in unfillActiveRect', () => {
    const sequence = makeSequence();
    const visualizer = new TestVisualizer(sequence);
    const rect0 = stubRect(0);
    const rect1 = stubRect(1);

    visualizer.fill(rect0, sequence.notes[0]);
    visualizer.fill(rect1, sequence.notes[1]);
    expect(visualizer.activeCount).toBe(2);
    expect(rect0.classList.contains('active')).toBe(true);
    const activeFill = rect0.getAttribute('fill');

    visualizer.unfill();
    expect(visualizer.activeCount).toBe(0);
    expect(rect0.classList.contains('active')).toBe(false);
    expect(rect1.classList.contains('active')).toBe(false);
    // Fill restored to the inactive color (different from the active one).
    expect(rect0.getAttribute('fill')).not.toBe(activeFill);
  });

  it('is idempotent: unfill twice and re-fill the same rect without duplicates', () => {
    const sequence = makeSequence();
    const visualizer = new TestVisualizer(sequence);
    const rect = stubRect(0);

    visualizer.fill(rect, sequence.notes[0]);
    visualizer.fill(rect, sequence.notes[0]);
    expect(visualizer.activeCount).toBe(1);

    visualizer.unfill();
    visualizer.unfill();
    expect(visualizer.activeCount).toBe(0);
  });

  it('clear() resets the active set', () => {
    const sequence = makeSequence();
    const visualizer = new TestVisualizer(sequence);
    visualizer.fill(stubRect(0), sequence.notes[0]);
    expect(visualizer.activeCount).toBe(1);
    visualizer.clearAll();
    expect(visualizer.activeCount).toBe(0);
  });

  it('clearActiveNotes() clears via the set when an svg is present', () => {
    const sequence = makeSequence();
    const visualizer = new TestVisualizer(sequence);
    // clearActiveNotes only runs when this.svg is set; a stub is enough since
    // unfillActiveRect no longer queries the tree.
    (visualizer as unknown as {svg: unknown}).svg = {};
    const rect = stubRect(2);
    visualizer.fill(rect, sequence.notes[2]);
    visualizer.clearActiveNotes();
    expect(visualizer.activeCount).toBe(0);
    expect(rect.classList.contains('active')).toBe(false);
  });
});
