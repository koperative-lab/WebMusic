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
 * changing height: `width` is the least it needs, and packing gives it the
 * whole free span where it lands.
 */
export interface Box {
  readonly width: number;
  readonly height: number;
  readonly fill: boolean;
}

export interface Placed {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Pack cards into a column `containerWidth` wide, in order. A skyline tracks
 * the lowest free edge across the width; each card takes the position where
 * its top is highest (then leftmost) and its width fits. A fill card then
 * widens to the free span at that height — up to the next card that is in the
 * way, a gap before it, or the container edge — so it closes the row its
 * neighbours leave. Cards are `gap` apart and never wider than the container.
 */
export function packSkyline(boxes: readonly Box[], containerWidth: number, gap: number): Placed[] {
  const width = Math.max(1, containerWidth);
  // Segments of the skyline: [x, end) has its free edge at y.
  let skyline = [{x: 0, end: width, y: 0}];
  return boxes.map((box) => {
    const w = Math.min(box.width, width);
    let best: {x: number; y: number} | undefined;
    for (const start of skyline) {
      const x = start.x;
      if (x + w > width + 1e-6) continue;
      // The card and the gap after it must clear everything under them.
      const reach = Math.min(x + w + gap, width);
      const y = Math.max(...skyline.filter((segment) => segment.x < reach && segment.end > x).map((segment) => segment.y));
      if (!best || y < best.y - 1e-6 || (Math.abs(y - best.y) <= 1e-6 && x < best.x)) best = {x, y};
    }
    const {x, y} = best ?? {x: 0, y: Math.max(...skyline.map((segment) => segment.y))};
    let span = w;
    if (box.fill) {
      // Walk right while the skyline stays at or below this card's top.
      let end = x;
      for (const segment of skyline) {
        if (segment.end <= end) continue;
        if (segment.x > end + 1e-6 || segment.y > y + 1e-6) break;
        end = segment.end;
      }
      span = Math.max(w, end >= width - 1e-6 ? width - x : end - x - gap);
    }
    const bottom = y + box.height + gap;
    const right = x + span + gap;
    const next: typeof skyline = [];
    for (const segment of skyline) {
      if (segment.end <= x || segment.x >= right) { next.push(segment); continue; }
      if (segment.x < x) next.push({x: segment.x, end: x, y: segment.y});
      if (segment.end > right) next.push({x: right, end: segment.end, y: segment.y});
    }
    next.push({x, end: Math.min(right, width), y: bottom});
    skyline = next.sort((a, b) => a.x - b.x)
      .reduce<typeof skyline>((merged, segment) => {
        const last = merged.at(-1);
        if (last && last.end >= segment.x - 1e-6 && Math.abs(last.y - segment.y) <= 1e-6) last.end = Math.max(last.end, segment.end);
        else merged.push({...segment});
        return merged;
      }, []);
    return {x, y, width: span, height: box.height};
  });
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
