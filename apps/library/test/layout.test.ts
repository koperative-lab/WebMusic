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
        if (input[i]!.fill) expect(card.width).toBeGreaterThanOrEqual(Math.min(input[i]!.width, width));
        else expect(card.width).toBe(Math.min(input[i]!.width, width));
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

describe('fill spans', () => {
  it('takes its preferred width when the next card still fits beside it', () => {
    const placed = packSkyline([
      {width: 200, height: 100, fill: false},
      {width: 300, height: 40, fill: true, preferred: 400},
      {width: 150, height: 300, fill: false},
    ], 1000, 10);
    expect(placed[1]).toEqual({x: 210, y: 0, width: 400, height: 40});
    // The next card goes beside it rather than under it.
    expect(placed[2]).toMatchObject({x: 620, y: 0});
  });

  it('takes the whole span when what is left would be too narrow for the next card', () => {
    const placed = packSkyline([
      {width: 200, height: 100, fill: false},
      {width: 300, height: 40, fill: true, preferred: 600},
      {width: 250, height: 300, fill: false},
    ], 1000, 10);
    // 790 free: 600 would leave 190, too little for a 250-wide card.
    expect(placed[1]).toEqual({x: 210, y: 0, width: 790, height: 40});
  });

  it('stops at a taller card in the way', () => {
    const placed = packSkyline([
      {width: 300, height: 50, fill: false},
      {width: 300, height: 200, fill: false},
      {width: 200, height: 40, fill: true},
    ], 640, 10);
    // No room at the top right: under the first card, up to the second one.
    expect(placed[2]).toEqual({x: 0, y: 60, width: 300, height: 40});
  });

  it('lets a nearby later card take a higher spot first', () => {
    const placed = packSkyline([
      {width: 600, height: 100, fill: false},
      {width: 500, height: 50, fill: false},
      {width: 300, height: 50, fill: false},
    ], 1000, 10);
    // The 500-wide card cannot sit beside the first; the 300-wide one can, so it goes first.
    expect(placed[2]).toMatchObject({x: 610, y: 0});
    expect(placed[1]!.y).toBeGreaterThan(0);
  });

  it('gives the library’s stretching cards varied widths', () => {
    const entries = topologicalOrder(LIBRARY);
    const input = entries.map((entry) => ({
      width: entry.recipe.preview.width, height: entry.recipe.preview.height,
      fill: entry.recipe.preview.fit === 'fill', preferred: entry.recipe.preview.width * 1.5,
    }));
    const width = 1408;
    const placed = stretchFills(packSkyline(input, width, GAP), input, width, GAP);
    const fills = placed.filter((_, i) => input[i]!.fill);
    const full = fills.filter((card) => card.width >= width - 1);
    expect(full.length).toBeLessThan(fills.length / 2);
    expect(new Set(fills.map((card) => Math.round(card.width))).size).toBeGreaterThan(3);
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
