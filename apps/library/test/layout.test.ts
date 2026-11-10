import {describe, expect, it} from 'vitest';
import {LIBRARY} from '../src/catalog.ts';
import {emptyCells, fillHoles, fitPreview, packColumns, packMosaic, packReel, reelRows, parentOf, reelColumns, topologicalOrder, type Placement} from '../src/layout.ts';

const overlaps = (a: Placement, b: Placement) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('reel topology', () => {
  it('puts every element right after an ancestor chain that starts at its root', () => {
    const order = topologicalOrder(LIBRARY).map((entry) => entry.tag);
    expect(order).toHaveLength(LIBRARY.length);
    expect(new Set(order).size).toBe(order.length);
    expect(order[0]).toBe('score-player');
    for (const entry of LIBRARY) {
      const parent = parentOf(entry.recipe);
      if (parent) expect(order.indexOf(parent), entry.tag).toBeLessThan(order.indexOf(entry.tag));
    }
    // A child directly follows its parent's earlier subtree: the desk's part follows the desk.
    expect(order.indexOf('score-rack-part')).toBe(order.indexOf('score-rack-control') + 1);
    expect(order.indexOf('score-recorder')).toBe(order.indexOf('score-note-input') + 1);
  });

  it('makes an element a root when its parent is filtered out', () => {
    const audioViews = LIBRARY.filter((entry) => entry.category.id === 'audio-views');
    expect(topologicalOrder(audioViews).map((entry) => entry.tag)).toEqual(audioViews.map((entry) => entry.tag));
  });
});

describe('reel packing', () => {
  it('places every card inside the rows without overlap', () => {
    for (const rows of [1, 2, 3, 4, 6]) {
      const sizes = LIBRARY.map((entry) => entry.recipe.size);
      const placed = packReel(sizes, rows);
      expect(placed).toHaveLength(sizes.length);
      placed.forEach((a, i) => {
        expect(a.y + a.h, `rows ${rows}`).toBeLessThanOrEqual(rows);
        placed.slice(i + 1).forEach((b) => expect(overlaps(a, b), `rows ${rows}`).toBe(false));
      });
    }
  });

  it('fills a hole with a later card that fits, without reaching far back', () => {
    // A 1×1 hole under the first wide card is filled by the 1×1 card, not left empty.
    expect(packReel([{w: 2, h: 1}, {w: 2, h: 2}, {w: 1, h: 1}, {w: 1, h: 1}], 2))
      .toEqual([{x: 0, y: 0, w: 2, h: 1}, {x: 2, y: 0, w: 2, h: 2}, {x: 0, y: 1, w: 1, h: 1}, {x: 1, y: 1, w: 1, h: 1}]);
    const far = packReel([{w: 1, h: 1}, ...Array.from({length: 8}, () => ({w: 1, h: 2})), {w: 1, h: 1}], 2, Infinity, 2);
    expect(far.at(-1)!.x).toBeGreaterThan(2);
  });

  it('clamps footprints to the rows and columns available', () => {
    expect(packReel([{w: 4, h: 3}], 2, 2)).toEqual([{x: 0, y: 0, w: 2, h: 2}]);
    expect(reelColumns(packReel([{w: 3, h: 1}, {w: 2, h: 1}], 1))).toBe(5);
  });
});

describe('closing holes', () => {
  const cells = (placements: readonly Placement[]) => placements.reduce((sum, p) => sum + p.w * p.h, 0);

  it('grows cards into free neighbouring cells without overlap or shrinking', () => {
    for (const rows of [2, 4, 5, 6]) {
      const packed = packReel(LIBRARY.map((entry) => entry.recipe.size), rows);
      const filled = fillHoles(packed, rows);
      filled.forEach((a, i) => {
        const before = packed[i]!;
        expect(a.x).toBeLessThanOrEqual(before.x);
        expect(a.y).toBeLessThanOrEqual(before.y);
        expect(a.x + a.w).toBeGreaterThanOrEqual(before.x + before.w);
        expect(a.y + a.h).toBeGreaterThanOrEqual(before.y + before.h);
        expect(a.y + a.h).toBeLessThanOrEqual(rows);
        expect(a.x + a.w).toBeLessThanOrEqual(reelColumns(packed));
        filled.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false));
      });
      expect(cells(filled)).toBeGreaterThanOrEqual(cells(packed));
    }
  });

  it('closes a hole a neighbour can grow across', () => {
    // A 3-wide card over a 2-wide one leaves one free cell under its end.
    const filled = fillHoles([{x: 0, y: 0, w: 3, h: 1}, {x: 0, y: 1, w: 2, h: 1}], 2);
    expect(cells(filled)).toBe(6);
  });
});

describe('look-ahead packing', () => {
  it('lets a later card take a hole near the previous card, but not one behind the look-back', () => {
    // Two tall cards cannot use the bottom cell beside the first short card; the 1×1 three places later can.
    const sizes = [{w: 1, h: 1}, {w: 1, h: 2}, {w: 1, h: 2}, {w: 1, h: 1}];
    expect(packReel(sizes, 2)[3]).toEqual({x: 0, y: 1, w: 1, h: 1});
    // With no look-back and no look-ahead the hole is left behind.
    expect(packReel(sizes, 2, Infinity, 0, 1)[3]!.x).toBeGreaterThan(0);
  });

  it('packs the whole library with fewer empty cells than strict order', () => {
    const sizes = LIBRARY.map((entry) => entry.recipe.size);
    const empty = (placements: readonly Placement[]) => reelColumns(placements) * 5 - placements.reduce((sum, p) => sum + p.w * p.h, 0);
    expect(empty(packReel(sizes, 5))).toBeLessThanOrEqual(empty(packReel(sizes, 5, Infinity, 3, 1)));
  });
});

describe('mosaic', () => {
  it('leaves no empty cell for the whole library at common row counts', () => {
    const sizes = topologicalOrder(LIBRARY).map((entry) => entry.recipe.size);
    for (const rows of [2, 3, 4, 5, 6]) {
      const placed = packMosaic(sizes, rows);
      expect(placed).toHaveLength(sizes.length);
      expect(emptyCells(placed, rows), `rows ${rows}`).toBe(0);
      placed.forEach((a, i) => placed.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    }
  });
});

describe('narrow reels', () => {
  it('never grows a card wider than the columns a narrow window shows', () => {
    const sizes = topologicalOrder(LIBRARY).map((entry) => entry.recipe.size);
    for (const rows of [3, 4, 5]) {
      const placed = packMosaic(sizes, rows, 2);
      expect(Math.max(...placed.map((placement) => placement.w)), `rows ${rows}`).toBeLessThanOrEqual(2);
      placed.forEach((a, i) => placed.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
    }
  });
});

describe('vertical reel', () => {
  it('packs into the columns, top band first, without overlap', () => {
    const entries = topologicalOrder(LIBRARY);
    for (const columns of [1, 2, 4, 6, 9]) {
      const placed = packColumns(entries.map((entry) => entry.recipe.size), columns);
      expect(placed).toHaveLength(entries.length);
      placed.forEach((a, i) => {
        expect(a.x + a.w, `columns ${columns}`).toBeLessThanOrEqual(columns);
        placed.slice(i + 1).forEach((b) => expect(overlaps(a, b), `columns ${columns}`).toBe(false));
      });
      // The first card starts the reel at the top left.
      expect(placed[0]).toMatchObject({x: 0, y: 0});
      expect(reelRows(placed)).toBeGreaterThan(0);
    }
  });

  it('never shrinks a footprint that fits, and clamps one wider than the reel', () => {
    const sizes = LIBRARY.map((entry) => entry.recipe.size);
    packColumns(sizes, 9).forEach((placement, i) => {
      expect(placement.w).toBeGreaterThanOrEqual(sizes[i]!.w);
      expect(placement.h).toBeGreaterThanOrEqual(sizes[i]!.h);
    });
    expect(packColumns([{w: 5, h: 4}], 2)).toEqual([{x: 0, y: 0, w: 2, h: 4}]);
  });
});

describe('vertical growth', () => {
  it('lets a card grow down the page by one row at most', () => {
    const sizes = topologicalOrder(LIBRARY).map((entry) => entry.recipe.size);
    for (const columns of [2, 4, 7, 9]) {
      packColumns(sizes, columns).forEach((placement, i) => {
        expect(placement.h, `${columns} columns`).toBeLessThanOrEqual(sizes[i]!.h + 1);
      });
    }
  });
});

describe('preview fit', () => {
  it('lays out at least at the minimum width and scales down to fit, never up', () => {
    // A small element in a large card stays at its own size, centred.
    expect(fitPreview({width: 600, height: 300}, {width: 600, height: 100})).toEqual({design: 600, scale: 1, left: 0, top: 100});
    // A narrow card lays out at 480 and scales to its width.
    const narrow = fitPreview({width: 240, height: 400}, {width: 480, height: 200});
    expect(narrow.design).toBe(480);
    expect(narrow.scale).toBeCloseTo(0.5);
    // A tall element scales to the card's height and is centred across it.
    const tall = fitPreview({width: 800, height: 300}, {width: 800, height: 600});
    expect(tall.scale).toBeCloseTo(0.5);
    expect(tall.left).toBeCloseTo(200);
    // A fixed-width element wider than its layout width still fits.
    expect(fitPreview({width: 500, height: 500}, {width: 1000, height: 100}).scale).toBeCloseTo(0.5);
  });

  it('keeps every element inside its card at any card size', () => {
    for (const frame of [{width: 120, height: 90}, {width: 343, height: 600}, {width: 1200, height: 150}]) {
      for (const content of [{width: 480, height: 50}, {width: 900, height: 700}, {width: 300, height: 2000}]) {
        const placed = fitPreview(frame, content);
        const width = Math.max(placed.design, content.width) * placed.scale;
        expect(placed.left + width).toBeLessThanOrEqual(frame.width + 1e-6);
        expect(placed.top + content.height * placed.scale).toBeLessThanOrEqual(frame.height + 1e-6);
      }
    }
  });
});
