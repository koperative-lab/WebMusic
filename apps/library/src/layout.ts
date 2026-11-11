// The reel: cards as large as the elements they show, packed down a vertical
// page. Order is topological — every element follows the element it attaches
// to (a view its player, a part its desk, a recorder its note input) — so
// related cards sit near each other. A skyline packs the exact card sizes,
// then cards whose element stretches widen into the free space beside them.
import type {Recipe} from './recipes.ts';

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

/**
 * A card to place. A `fill` card's element stretches to any width without
 * changing height: `width` is the least it needs and `preferred` the width it
 * takes when the row has room for more cards beside it.
 */
export interface Box {
  readonly width: number;
  readonly height: number;
  readonly fill: boolean;
  readonly preferred?: number;
}

export interface Placed {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface Segment { x: number; end: number; y: number }

/** The highest (then leftmost) spot where a card `w` wide fits under the skyline. */
function bestSpot(skyline: readonly Segment[], w: number, width: number, gap: number): {x: number; y: number} {
  let best: {x: number; y: number} | undefined;
  for (const start of skyline) {
    const x = start.x;
    if (x + w > width + 1e-6) continue;
    // The card and the gap after it must clear everything under them.
    const reach = Math.min(x + w + gap, width);
    const y = Math.max(...skyline.filter((segment) => segment.x < reach && segment.end > x).map((segment) => segment.y));
    if (!best || y < best.y - 1e-6 || (Math.abs(y - best.y) <= 1e-6 && x < best.x)) best = {x, y};
  }
  return best ?? {x: 0, y: Math.max(...skyline.map((segment) => segment.y))};
}

/** How far right a card starting at `x` on edge `y` can reach before something is in the way. */
function freeEnd(skyline: readonly Segment[], x: number, y: number): number {
  let end = x;
  for (const segment of skyline) {
    if (segment.end <= end) continue;
    if (segment.x > end + 1e-6 || segment.y > y + 1e-6) break;
    end = segment.end;
  }
  return end;
}

/**
 * Pack cards into a column `containerWidth` wide. A skyline tracks the lowest
 * free edge across the width. Each step looks at the next `lookahead` cards
 * and places the one whose best spot is highest (the earliest on a tie), so a
 * small card can take the hole beside a wide one while the order stays close
 * to the topological one. A fill card takes its preferred width when the row
 * still has room for the next card beside it, and the whole free span when
 * the space left would be too narrow for any of them — rows close up without
 * every stretching card running the full width. Cards are `gap` apart, never
 * wider than the container, and returned in input order.
 */
export function packSkyline(boxes: readonly Box[], containerWidth: number, gap: number, lookahead = 3): Placed[] {
  const width = Math.max(1, containerWidth);
  let skyline: Segment[] = [{x: 0, end: width, y: 0}];
  const placed: Placed[] = new Array(boxes.length);
  const remaining = boxes.map((_, index) => index);
  const least = (box: Box) => Math.min(box.width, width);
  while (remaining.length) {
    let pick = remaining[0]!;
    let spot = bestSpot(skyline, least(boxes[pick]!), width, gap);
    for (const index of remaining.slice(1, lookahead)) {
      const other = bestSpot(skyline, least(boxes[index]!), width, gap);
      if (other.y < spot.y - 1e-6) { pick = index; spot = other; }
    }
    const box = boxes[pick]!;
    remaining.splice(remaining.indexOf(pick), 1);
    const {x, y} = spot;
    let span = least(box);
    if (box.fill) {
      const end = freeEnd(skyline, x, y);
      const free = end >= width - 1e-6 ? width - x : end - x - gap;
      const preferred = Math.max(span, Math.min(box.preferred ?? span, free));
      // The narrowest card that might come next decides whether the rest of the row is usable.
      const next = remaining.slice(0, lookahead).map((index) => least(boxes[index]!));
      const smallest = next.length ? Math.min(...next) : Infinity;
      span = Math.max(span, free - preferred >= smallest + gap ? preferred : free);
    }
    const bottom = y + box.height + gap;
    const right = x + span + gap;
    const next: Segment[] = [];
    for (const segment of skyline) {
      if (segment.end <= x || segment.x >= right) { next.push(segment); continue; }
      if (segment.x < x) next.push({x: segment.x, end: x, y: segment.y});
      if (segment.end > right) next.push({x: right, end: segment.end, y: segment.y});
    }
    next.push({x, end: Math.min(right, width), y: bottom});
    skyline = next.sort((a, b) => a.x - b.x).reduce<Segment[]>((merged, segment) => {
      const last = merged.at(-1);
      if (last && last.end >= segment.x - 1e-6 && Math.abs(last.y - segment.y) <= 1e-6) last.end = Math.max(last.end, segment.end);
      else merged.push({...segment});
      return merged;
    }, []);
    placed[pick] = {x, y, width: span, height: box.height};
  }
  return placed;
}

/**
 * Widen every `fill` card into the free space beside it — up to the next
 * card that overlaps its height, or the container edge — so rows close up.
 * Heights do not change: a fill element keeps its height at any width.
 */
export function stretchFills(placed: readonly Placed[], boxes: readonly Box[], containerWidth: number, gap: number): Placed[] {
  const result = placed.map((card) => ({...card}));
  result.forEach((card, index) => {
    if (!boxes[index]?.fill) return;
    const beside = result.filter((other, j) => j !== index && other.y < card.y + card.height && card.y < other.y + other.height);
    const right = Math.min(containerWidth, ...beside.filter((other) => other.x >= card.x + card.width).map((other) => other.x - gap));
    const left = Math.max(0, ...beside.filter((other) => other.x + other.width <= card.x).map((other) => other.x + other.width + gap));
    card.x = left;
    card.width = right - left;
  });
  return result;
}

/** The height a packed column takes. */
export function packedHeight(placed: readonly Placed[]): number {
  return placed.reduce((end, card) => Math.max(end, card.y + card.height), 0);
}

export interface Size { readonly width: number; readonly height: number }

/** How a card shows its element: the scale and the centred offset. */
export interface PreviewFit {
  readonly scale: number;
  readonly left: number;
  readonly top: number;
}

/**
 * Scale an element down — never up — until its laid-out width fits the
 * frame, and centre it across. The card's height follows the scaled element,
 * so nothing is left above or below it.
 */
export function fitPreview(frame: Size, content: Size): PreviewFit {
  const width = Math.max(content.width, 1);
  const scale = Math.min(1, frame.width / width);
  return {scale, left: Math.max(0, (frame.width - width * scale) / 2), top: 0};
}
