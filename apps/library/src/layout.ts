// The reel: cards of different footprints packed into a fixed number of
// columns down a vertical scroll (packColumns), using the row packer on its side. Order is topological — every element follows the
// element it attaches to (a view its player, a part its desk, a recorder its
// note input) — so related cards sit next to each other. Packing lets a card
// a few places later take a hole the next card cannot fill, then grows cards
// into whatever cells stay empty.
import type {CardSize, Recipe} from './recipes.ts';

/** The element a recipe attaches to in a composition, if any. */
export function parentOf(recipe: Recipe): string | undefined {
  if (recipe.requires?.length) return recipe.requires[0];
  switch (recipe.slot) {
    case 'score-companion': case 'score-free': case 'score-desk': return 'score-player';
    case 'audio-companion': case 'audio-mix': return 'audio-player';
    default: return undefined;
  }
}

interface Ordered { readonly tag: string; readonly recipe: Recipe }

/**
 * Depth-first order over the attachment tree. Roots are elements whose parent
 * is absent from `entries`; siblings and roots keep their order in `entries`.
 */
export function topologicalOrder<T extends Ordered>(entries: readonly T[]): T[] {
  const present = new Set(entries.map((entry) => entry.tag));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const entry of entries) {
    const parent = parentOf(entry.recipe);
    if (parent && present.has(parent) && parent !== entry.tag) children.set(parent, [...(children.get(parent) ?? []), entry]);
    else roots.push(entry);
  }
  const order: T[] = [];
  const visit = (entry: T) => {
    order.push(entry);
    for (const child of children.get(entry.tag) ?? []) visit(child);
  };
  roots.forEach(visit);
  return order;
}

export interface Placement {
  /** Column and row of the top-left cell. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Pack cards into `rows` rows, keeping their order as far as holes allow.
 * Each step looks for the earliest free cell at or after `lookback` columns
 * before the previous card. The first of the next `lookahead` cards that fits
 * there takes it; if none fits, the next card takes its own leftmost (then
 * topmost) free spot. Footprints are clamped to the rows and `maxColumns`.
 * Placements are returned in input order.
 */
export function packReel(sizes: readonly CardSize[], rows: number, maxColumns = Infinity, lookback = 3, lookahead = 4): Placement[] {
  const height = Math.max(1, Math.floor(rows));
  const taken: boolean[][] = [];
  const free = (x: number, y: number, w: number, h: number) => {
    if (y + h > height) return false;
    for (let column = x; column < x + w; column += 1) {
      for (let row = y; row < y + h; row += 1) if (taken[column]?.[row]) return false;
    }
    return true;
  };
  const clamp = (size: CardSize) => ({w: Math.max(1, Math.min(size.w, Math.floor(maxColumns))), h: Math.max(1, Math.min(size.h, height))});
  const placements: Placement[] = new Array(sizes.length);
  const remaining = sizes.map((_, index) => index);
  let previous = 0;
  while (remaining.length) {
    const from = Math.max(0, previous - lookback);
    let hole: [number, number] | undefined;
    for (let x = from; !hole; x += 1) {
      for (let y = 0; y < height; y += 1) if (!taken[x]?.[y]) { hole = [x, y]; break; }
    }
    const [hx, hy] = hole;
    let pick = remaining.slice(0, lookahead).find((index) => {
      const {w, h} = clamp(sizes[index]!);
      return free(hx, hy, w, h);
    });
    let spot: Placement | undefined;
    if (pick !== undefined) {
      spot = {x: hx, y: hy, ...clamp(sizes[pick]!)};
    } else {
      pick = remaining[0]!;
      const {w, h} = clamp(sizes[pick]!);
      for (let x = from; !spot; x += 1) {
        for (let y = 0; y + h <= height; y += 1) if (free(x, y, w, h)) { spot = {x, y, w, h}; break; }
      }
    }
    for (let column = spot.x; column < spot.x + spot.w; column += 1) {
      taken[column] ??= [];
      for (let row = spot.y; row < spot.y + spot.h; row += 1) taken[column]![row] = true;
    }
    placements[pick] = spot;
    remaining.splice(remaining.indexOf(pick), 1);
    previous = spot.x;
  }
  return placements;
}

/**
 * Grow cards into empty neighbouring cells until nothing moves, so the packed
 * reel closes up into a mosaic. A card grows one column or row at a time, to
 * the right, down, left or up, only across a strip that is entirely free and
 * inside the reel's rows and its first `columns` columns, never wider than
 * `maxColumns`, and at most `alongGrowth` columns wider than it was packed —
 * columns run along the scroll, so this keeps a card near its own length.
 * Cards never shrink, move or overlap.
 */
export function fillHoles(placements: readonly Placement[], rows: number, columns = reelColumns(placements), maxColumns = Infinity, alongGrowth = Infinity): Placement[] {
  const cards = placements.map((placement) => ({...placement}));
  const limit = placements.map((placement) => Math.min(maxColumns, placement.w + alongGrowth));
  const occupied = (x: number, y: number, skip: number) => x < 0 || y < 0 || x >= columns || y >= rows
    || cards.some((card, index) => index !== skip && x >= card.x && x < card.x + card.w && y >= card.y && y < card.y + card.h);
  const strip = (skip: number, cells: [number, number][]) => cells.every(([x, y]) => !occupied(x, y, skip));
  const range = (start: number, length: number) => Array.from({length}, (_, offset) => start + offset);
  for (let grew = true; grew;) {
    grew = false;
    cards.forEach((card, index) => {
      const wider = card.w < limit[index]!;
      if (wider && strip(index, range(card.y, card.h).map((y) => [card.x + card.w, y]))) { card.w += 1; grew = true; }
      if (strip(index, range(card.x, card.w).map((x) => [x, card.y + card.h]))) { card.h += 1; grew = true; }
      if (card.w < limit[index]! && strip(index, range(card.y, card.h).map((y) => [card.x - 1, y]))) { card.x -= 1; card.w += 1; grew = true; }
      if (strip(index, range(card.x, card.w).map((x) => [x, card.y - 1]))) { card.y -= 1; card.h += 1; grew = true; }
    });
  }
  return cards;
}

/** Cells inside the reel's span that no card covers. */
export function emptyCells(placements: readonly Placement[], rows: number): number {
  return reelColumns(placements) * rows - placements.reduce((sum, placement) => sum + placement.w * placement.h, 0);
}

/**
 * The reel layout: pack with growing look-ahead and look-back, close holes,
 * and keep the result with the fewest empty cells. Ties keep the smallest
 * look-ahead, which bends topological order least.
 */
export function packMosaic(sizes: readonly CardSize[], rows: number, maxColumns = Infinity, alongGrowth = Infinity): Placement[] {
  let best: Placement[] | undefined;
  let fewest = Infinity;
  for (let lookahead = 1; lookahead <= 8 && fewest > 0; lookahead += 1) {
    for (const lookback of [1, 3, 6]) {
      const packed = packReel(sizes, rows, maxColumns, lookback, lookahead);
      const filled = fillHoles(packed, rows, reelColumns(packed), maxColumns, alongGrowth);
      const empty = emptyCells(filled, rows);
      if (empty < fewest) { best = filled; fewest = empty; }
      if (fewest === 0) break;
    }
  }
  return best ?? [];
}

/**
 * The vertical reel: a fixed number of columns, growing downward. It is the
 * mosaic packed on its side — footprints and placements are transposed — so
 * cards fill each band left to right before the next one starts below.
 */
export function packColumns(sizes: readonly CardSize[], columns: number): Placement[] {
  const across = Math.max(1, Math.floor(columns));
  // Down the page a card may grow by one row at most, so tall cards stay their size.
  return packMosaic(sizes.map((size) => ({w: size.h, h: Math.min(size.w, across)})), across, Infinity, 1)
    .map((placement) => ({x: placement.y, y: placement.x, w: placement.h, h: placement.w}));
}

/** Rows the vertical reel spans. */
export function reelRows(placements: readonly Placement[]): number {
  return placements.reduce((end, placement) => Math.max(end, placement.y + placement.h), 0);
}

/** Columns the packed reel spans. */
export function reelColumns(placements: readonly Placement[]): number {
  return placements.reduce((end, placement) => Math.max(end, placement.x + placement.w), 0);
}

export interface Size { readonly width: number; readonly height: number }

/** How a card shows its element: the width it lays out at, the scale and the centred offset. */
export interface PreviewFit {
  readonly design: number;
  readonly scale: number;
  readonly left: number;
  readonly top: number;
}

/**
 * Lay the element out at the card's width, but never narrower than
 * `minDesign` so it keeps its own proportions on small cards. Then scale it
 * down — never up — until its laid-out width and height both fit the frame,
 * and centre it. `content` is measured at the design width; an element wider
 * than that (a fixed-width surface) still fits.
 */
export function fitPreview(frame: Size, content: Size, minDesign = 480): PreviewFit {
  const design = Math.max(frame.width, minDesign);
  const width = Math.max(design, content.width, 1);
  const height = Math.max(content.height, 1);
  const scale = Math.min(1, frame.width / width, frame.height / height);
  return {
    design,
    scale,
    left: Math.max(0, (frame.width - width * scale) / 2),
    top: Math.max(0, (frame.height - height * scale) / 2),
  };
}

/** The design width a card lays its element out at, before measuring it. */
export const designWidth = (frame: Size, minDesign = 480): number => Math.max(frame.width, minDesign);
