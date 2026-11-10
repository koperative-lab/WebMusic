import {describe, expect, it} from 'vitest';
import {LIBRARY} from '../src/catalog.ts';
import {fitPreview, packSkyline, packedHeight, parentOf, stretchFills, topologicalOrder, type Box, type Placed} from '../src/layout.ts';

const GAP = 16;
const apart = (a: Placed, b: Placed) =>
  a.x + a.width + GAP <= b.x + 1e-6 || b.x + b.width + GAP <= a.x + 1e-6
  || a.y + a.height + GAP <= b.y + 1e-6 || b.y + b.height + GAP <= a.y + 1e-6;
const boxes = (): Box[] => topologicalOrder(LIBRARY).map((entry) => ({
  width: entry.recipe.preview.width, height: entry.recipe.preview.height, fill: entry.recipe.preview.fit === 'fill',
}));

describe('reel topology', () => {
  it('puts every element after the element it attaches to', () => {
    const order = topologicalOrder(LIBRARY).map((entry) => entry.tag);
    expect(order).toHaveLength(LIBRARY.length);
    expect(new Set(order).size).toBe(order.length);
    expect(order[0]).toBe('score-player');
    for (const entry of LIBRARY) {
      const parent = parentOf(entry.recipe);
      if (parent) expect(order.indexOf(parent), entry.tag).toBeLessThan(order.indexOf(entry.tag));
    }
    expect(order.indexOf('score-rack-part')).toBe(order.indexOf('score-rack-control') + 1);
    expect(order.indexOf('score-recorder')).toBe(order.indexOf('score-note-input') + 1);
  });

  it('makes an element a root when its parent is filtered out', () => {
    const audioViews = LIBRARY.filter((entry) => entry.category.id === 'audio-views');
    expect(topologicalOrder(audioViews).map((entry) => entry.tag)).toEqual(audioViews.map((entry) => entry.tag));
  });
});

describe('skyline packing', () => {
  it('keeps every card its own size, inside the column and a gap apart', () => {
    for (const width of [343, 736, 1408, 1800]) {
      const input = boxes();
      const placed = packSkyline(input, width, GAP);
      expect(placed).toHaveLength(input.length);
      placed.forEach((card, i) => {
        expect(card.width).toBe(Math.min(input[i]!.width, width));
        expect(card.height).toBe(input[i]!.height);
        expect(card.x).toBeGreaterThanOrEqual(0);
        expect(card.x + card.width).toBeLessThanOrEqual(width + 1e-6);
        placed.slice(i + 1).forEach((other) => expect(apart(card, other), `${width}px`).toBe(true));
      });
    }
  });

  it('starts at the top left and puts a card beside the previous one when it fits', () => {
    const placed = packSkyline([{width: 300, height: 100, fill: false}, {width: 200, height: 50, fill: false}, {width: 600, height: 40, fill: false}], 600, 10);
    expect(placed[0]).toMatchObject({x: 0, y: 0});
    expect(placed[1]).toMatchObject({x: 310, y: 0});
    // Too wide for the space left beside them: it goes under both.
    expect(placed[2]).toMatchObject({x: 0, y: 110});
  });

  it('fills the lowest free edge first', () => {
    const placed = packSkyline([{width: 290, height: 200, fill: false}, {width: 290, height: 50, fill: false}, {width: 290, height: 50, fill: false}], 600, 10);
    expect(placed[2]).toMatchObject({x: 300, y: 60});
  });
});

describe('stretching fill cards', () => {
  it('widens fill cards into the free space beside them, never over another card', () => {
    for (const width of [736, 1408]) {
      const input = boxes();
      const stretched = stretchFills(packSkyline(input, width, GAP), input, width, GAP);
      stretched.forEach((card, i) => {
        expect(card.height).toBe(input[i]!.height);
        if (!input[i]!.fill) expect(card.width).toBe(Math.min(input[i]!.width, width));
        expect(card.x + card.width).toBeLessThanOrEqual(width + 1e-6);
        stretched.slice(i + 1).forEach((other) => expect(apart(card, other)).toBe(true));
      });
      expect(packedHeight(stretched)).toBeGreaterThan(0);
    }
  });

  it('closes a row: a lone fill card takes the whole width', () => {
    expect(stretchFills([{x: 0, y: 0, width: 300, height: 50}], [{width: 300, height: 50, fill: true}], 900, 16))
      .toEqual([{x: 0, y: 0, width: 900, height: 50}]);
    // A content card beside it keeps its width; the fill card stops a gap before it.
    const placed = [{x: 0, y: 0, width: 300, height: 50}, {x: 316, y: 0, width: 200, height: 80}];
    expect(stretchFills(placed, [{width: 300, height: 50, fill: true}, {width: 200, height: 80, fill: false}], 900, 16))
      .toEqual([{x: 0, y: 0, width: 300, height: 50}, {x: 316, y: 0, width: 200, height: 80}]);
  });
});

describe('preview fit', () => {
  it('scales only an element wider than its card, and centres a narrower one', () => {
    expect(fitPreview({width: 600, height: 0}, {width: 600, height: 100})).toEqual({scale: 1, left: 0, top: 0});
    expect(fitPreview({width: 300, height: 0}, {width: 600, height: 100}).scale).toBeCloseTo(0.5);
    expect(fitPreview({width: 400, height: 0}, {width: 300, height: 100})).toEqual({scale: 1, left: 50, top: 0});
  });
});
