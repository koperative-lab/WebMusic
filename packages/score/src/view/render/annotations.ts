import type {ScoreAnnotation} from '../core/annotations';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_SIZE = 12;
const LANE_HEIGHT = 18;

interface HorizontalAnnotationOptions {
  xAtQuarter(quarter: number): number;
  width: number;
  color?: string;
  /** Overview density is bounded; abbreviated labels retain a complete title. */
  maxLanes?: number;
}

function element<K extends keyof SVGElementTagNameMap>(parent: SVGElement, tag: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = parent.ownerDocument.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  parent.append(node);
  return node;
}

function annotationGroup(parent: SVGElement, annotation: ScoreAnnotation): SVGGElement {
  const group = element(parent, 'g', {'data-webscore-direction': annotation.source.kind,
    'data-webscore-direction-onset': annotation.startQuarters,
    'data-webscore-direction-text': annotation.label,
    'data-webscore-direction-part': annotation.partId,
    'data-webscore-direction-staff': annotation.source.staff ?? 1,
    ...(annotation.endQuarters === undefined ? {} : {'data-webscore-direction-end': annotation.endQuarters}),
    'aria-label': annotation.label,
  });
  element(group, 'title').textContent = annotation.label;
  return group;
}

function text(parent: SVGElement, annotation: ScoreAnnotation, value: string, x: number, y: number, maxWidth: number): SVGTextElement {
  const source = annotation.source;
  const node = element(parent, 'text', {x, y, 'font-size': FONT_SIZE,
    'font-family': 'Georgia, Times New Roman, serif',
    'font-style': 'fontStyle' in source ? source.fontStyle ?? 'normal' : source.kind === 'dynamics' || source.kind === 'pedal' ? 'italic' : 'normal',
    'font-weight': 'fontWeight' in source ? source.fontWeight ?? 'normal' : source.kind === 'rehearsal' ? 'bold' : 'normal',
  });
  node.textContent = value.replace(/\s+/g, ' ');
  // Font fallback and wide capitals can exceed the conservative lane estimate.
  // Fit actual browser text into its assigned width without moving its onset.
  try {
    if (node.getComputedTextLength() > maxWidth) {
      const original = node.textContent.replace(/…$/, '');
      let low = 0; let high = original.length; let fitted = '';
      while (low <= high) {
        const count = (low + high) >>> 1;
        node.textContent = `${original.slice(0, count)}…`;
        if (node.getComputedTextLength() <= maxWidth) { fitted = node.textContent; low = count + 1; }
        else high = count - 1;
      }
      node.textContent = fitted;
    }
  } catch { /* Detached/nonvisual SVG uses the bounded estimate above. */ }
  return node;
}

function abbreviated(label: string, width: number): string {
  const chars = Math.floor(width / (FONT_SIZE * .62));
  const normalized = label.replace(/\s+/g, ' ');
  return normalized.length <= chars ? normalized : chars >= 2 ? `${normalized.slice(0, chars - 1)}…` : '';
}

/** Compact shared expression strip. All source marks retain their own title. */
export function drawHorizontalScoreAnnotations(svg: SVGSVGElement, annotations: readonly ScoreAnnotation[], options: HorizontalAnnotationOptions): {height: number; group: SVGGElement} {
  const group = element(svg, 'g', {'data-webscore-annotations': 'horizontal', fill: options.color ?? 'currentColor', color: options.color ?? 'currentColor'});
  if (!annotations.length || !(options.width > 0)) return {height: 0, group};
  const width = options.width;
  const limit = Math.max(1, Math.floor(options.maxLanes ?? 3));
  const ends: number[] = [];
  const placements: Array<{annotation: ScoreAnnotation; x: number; end: number; lane: number; labelWidth: number}> = [];
  const overflow: Array<{annotation: ScoreAnnotation; x: number}> = [];
  for (const annotation of annotations) {
    const x = Math.max(0, Math.min(width - 2, options.xAtQuarter(annotation.startQuarters)));
    const labelWidth = Math.min(width - x, Math.max(10, annotation.label.length * FONT_SIZE * .62 + 5));
    const end = Math.max(x + 2, Math.min(width, annotation.endQuarters === undefined ? x + labelWidth : options.xAtQuarter(annotation.endQuarters)));
    let lane = ends.findIndex((right) => right <= x);
    if (lane < 0 && ends.length < limit) lane = ends.length;
    if (lane < 0) {
      lane = ends.indexOf(Math.min(...ends));
      // Text can yield to the next anchored mark. A live musical span cannot:
      // shortening or painting over it would change the apparent duration.
      let previous: typeof placements[number] | undefined;
      for (let index = placements.length - 1; index >= 0; index -= 1) {
        if (placements[index].lane === lane) { previous = placements[index]; break; }
      }
      if (!previous || previous.annotation.endQuarters !== undefined && previous.end > x || x <= previous.x + 4) {
        overflow.push({annotation, x});
        continue;
      }
      previous.labelWidth = Math.max(0, x - previous.x - 3);
    }
    ends[lane] = Math.max(x + labelWidth, end) + 4;
    placements.push({annotation, x, end, lane, labelWidth});
  }
  for (const placement of placements) {
    const {annotation, x, end, lane, labelWidth} = placement;
    const mark = annotationGroup(group, annotation);
    const y = lane * LANE_HEIGHT + FONT_SIZE + 1;
    const value = abbreviated(annotation.label, labelWidth);
    const span = annotation.source.kind === 'pedal' || annotation.source.kind === 'wedge';
    if (value) text(mark, annotation, value, x, y, labelWidth);
    else element(mark, 'path', {d: `M${x} ${y - 4}v4`, stroke: 'currentColor', fill: 'none'});
    if (!span) continue;
    const lineY = y + 3;
    const source = annotation.source;
    if (source.kind === 'wedge') {
      const narrow = source.type === 'diminuendo' ? end : x;
      const wide = source.type === 'diminuendo' ? x : end;
      element(mark, 'path', {d: `M${wide} ${lineY - 2}L${narrow} ${lineY}L${wide} ${lineY + 2}`, stroke: 'currentColor', 'stroke-width': 1, fill: 'none'});
    } else if (source.kind === 'pedal') {
      // Duration stays visible in overview mode even when the source uses signs.
      let path = `M${x} ${lineY - 3}V${lineY}`;
      for (const quarter of annotation.changes) {
        const change = options.xAtQuarter(quarter);
        if (change > x + 3 && change < end - 3) path += `H${change - 2}L${change} ${lineY - 3}L${change + 2} ${lineY}`;
      }
      path += `H${end}`;
      if (annotation.endSource && 'type' in annotation.endSource && annotation.endSource.type !== 'discontinue') path += `V${lineY - 3}`;
      element(mark, 'path', {d: path, stroke: 'currentColor', 'stroke-width': 1, fill: 'none'});
    }
  }
  // A bounded overflow rail keeps simultaneous long spans from obscuring one
  // another. Its exact-time markers expose complete labels and ranges in their
  // title; coincident marks share that title instead of hiding behind a sibling.
  const overflowMarkers = new Map<number, SVGGElement>();
  for (const {annotation, x} of overflow) {
    const mark = annotationGroup(group, annotation);
    mark.dataset.webscoreAnnotationOverflow = '';
    const description = annotation.endQuarters === undefined ? annotation.label
      : `${annotation.label} (${annotation.startQuarters}–${annotation.endQuarters} quarters)`;
    const previous = overflowMarkers.get(x);
    if (previous) previous.querySelector('title')!.textContent += `; ${description}`;
    else {
      mark.querySelector('title')!.textContent = description;
      element(mark, 'path', {d: `M${x} ${ends.length * LANE_HEIGHT + 1}v4`, stroke: 'currentColor', fill: 'none'});
      overflowMarkers.set(x, mark);
    }
  }
  return {height: ends.length * LANE_HEIGHT + (overflow.length ? 8 : 2), group};
}

/** Fitted overview: nearby expressions share one readable, inspectable marker. */
export function drawThumbnailScoreAnnotations(svg: SVGSVGElement, annotations: readonly ScoreAnnotation[], options: HorizontalAnnotationOptions): {height: number; group: SVGGElement} {
  const group = element(svg, 'g', {'data-webscore-annotations': 'overview', fill: options.color ?? 'currentColor', color: options.color ?? 'currentColor'});
  if (!annotations.length || !(options.width > 0)) return {height: 0, group};
  const count = Math.max(1, Math.floor(options.width / 120));
  const cellWidth = options.width / count;
  const clusters = new Map<number, ScoreAnnotation[]>();
  for (const annotation of annotations) {
    const x = Math.max(0, Math.min(options.width, options.xAtQuarter(annotation.startQuarters)));
    const index = Math.min(count - 1, Math.floor(x / cellWidth));
    const cluster = clusters.get(index) ?? [];
    cluster.push(annotation); clusters.set(index, cluster);
  }
  for (const [index, marks] of clusters) {
    const cluster = element(group, 'g', {'data-webscore-annotation-cluster': marks.length, role: 'img'});
    const description = marks.map(annotationDescription).join('; ');
    cluster.setAttribute('aria-label', description);
    element(cluster, 'title').textContent = description;
    // Keep every source mark identifiable without drawing a miniature text or
    // pedal line for every measure of a whole-score preview.
    for (const annotation of marks) annotationGroup(cluster, annotation);
    const representative = marks.find((mark) => mark.source.kind === 'words' || mark.source.kind === 'rehearsal') ?? marks[0];
    const suffix = marks.length > 1 ? ` +${marks.length - 1}` : '';
    const available = Math.max(0, cellWidth - 10);
    const full = `${representative.label.replace(/\s+/g, ' ')}${suffix}`;
    const label = full.length * FONT_SIZE * .62 <= available ? full : `${marks.length} ${marks.length === 1 ? 'mark' : 'marks'}`;
    text(cluster, representative, label, index * cellWidth + 4, FONT_SIZE + 1, available);
    const positions = marks.map((mark) => Math.max(0, Math.min(options.width - 1, options.xAtQuarter(mark.startQuarters))));
    const left = Math.min(...positions); const right = Math.max(...positions);
    element(cluster, 'path', {d: `M${left} 18v3M${left} 20H${Math.max(left + 1, right)}M${right} 18v3`, stroke: 'currentColor', fill: 'none', 'stroke-width': 1});
  }
  return {height: 24, group};
}

function annotationDescription(annotation: ScoreAnnotation): string {
  return annotation.endQuarters === undefined ? `${annotation.label} (quarter ${annotation.startQuarters})`
    : `${annotation.label} (quarters ${annotation.startQuarters}–${annotation.endQuarters})`;
}

/** Expression rail follows waterfall's inverted nominal-time axis. */
export function drawVerticalScoreAnnotations(svg: SVGSVGElement, annotations: readonly ScoreAnnotation[], options: {
  yAtQuarter(quarter: number): number; x: number; width: number; height: number; color?: string;
}): void {
  if (!annotations.length) return;
  const group = element(svg, 'g', {'data-webscore-annotations': 'vertical', fill: options.color ?? 'currentColor', color: options.color ?? 'currentColor'});
  const yAtQuarter = (quarter: number) => Math.max(1, Math.min(options.height - 1, options.yAtQuarter(quarter)));
  const ordered = annotations.map((annotation) => ({annotation, y: yAtQuarter(annotation.startQuarters), mark: annotationGroup(group, annotation)}))
    .sort((a, b) => a.y - b.y);
  // Coincident authored spans share a track; overlapping spans get separate
  // tracks, keeping their duration visible without running through the text.
  const spans = ordered.filter((item) => item.annotation.endQuarters !== undefined)
    .map((item) => ({...item, end: yAtQuarter(item.annotation.endQuarters!)}))
    .sort((a, b) => Math.min(a.y, a.end) - Math.min(b.y, b.end));
  const spanEnds: number[] = [];
  const maximumTracks = Math.max(1, Math.min(4, Math.floor(options.width / 30)));
  const drawnSpans = new Map<string, SVGGElement>();
  for (const {annotation, y, end, mark} of spans) {
    const key = `${annotation.source.kind}:${'type' in annotation.source ? annotation.source.type : ''}:${y}:${end}:${annotation.changes.join(',')}`;
    const same = drawnSpans.get(key);
    if (same) { same.querySelector('title')!.textContent += `; ${annotationDescription(annotation)}`; continue; }
    const top = Math.min(y, end); const bottom = Math.max(y, end);
    let lane = spanEnds.findIndex((last) => last + 2 < top);
    if (lane < 0 && spanEnds.length >= maximumTracks) {
      mark.dataset.webscoreAnnotationSpanOverflow = '';
      mark.querySelector('title')!.textContent = annotationDescription(annotation);
      continue;
    }
    if (lane < 0) lane = spanEnds.length;
    spanEnds[lane] = bottom;
    const rail = options.x + 4 + lane * 6;
    element(mark, 'path', {d: annotation.source.kind === 'wedge'
      ? annotation.source.type === 'diminuendo' ? `M${rail - 2} ${y}L${rail} ${end}L${rail + 2} ${y}` : `M${rail - 2} ${end}L${rail} ${y}L${rail + 2} ${end}`
      : `M${rail + 3} ${y}H${rail}V${end}h3`, stroke: 'currentColor', 'stroke-width': 1, fill: 'none'});
    drawnSpans.set(key, mark);
  }
  const left = options.x + Math.max(8, spanEnds.length * 6 + 6);
  const available = Math.max(1, options.width - (left - options.x) - 5);
  type Callout = {items: typeof ordered; top: number; bottom: number; lines: string[]};
  const callouts: Callout[] = [];
  const maximumLines = Math.max(0, Math.min(3, Math.floor((options.height - 2) / 15)));
  const linesFor = (items: typeof ordered): string[] => {
    const labels = [...new Set(items.map((item) => item.annotation.label.replace(/\s+/g, ' ')))];
    const lines: string[] = [];
    const limit = Math.max(1, Math.floor(available / (FONT_SIZE * .62)));
    let line = '';
    for (const label of labels) {
      const joined = line ? `${line} · ${label}` : label;
      if (joined.length <= limit) { line = joined; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const word of label.split(' ')) {
        if (line && line.length + word.length + 1 > limit) { lines.push(line); line = ''; }
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  const placeCallout = (block: Callout) => {
    block.lines = linesFor(block.items);
    if (block.lines.length > maximumLines) block.lines = maximumLines >= 2 ? [block.lines[0], `${block.items.length} marks`]
      : maximumLines ? [`${block.items.length} ${block.items.length === 1 ? 'mark' : 'marks'}`] : [];
    const desiredBottom = Math.max(...block.items.map((item) => item.y)) - 2;
    block.top = Math.max(0, Math.min(options.height - block.lines.length * 15, desiredBottom - block.lines.length * 15));
    block.bottom = block.top + block.lines.length * 15;
  };
  // Process from time zero upwards. A block finishes above its true anchor so
  // the first instruction is visible before the initial note starts to fall.
  for (const item of [...ordered].reverse()) {
    let block: Callout = {items: [item], lines: [], top: 0, bottom: item.y - 2};
    const initialLines = Math.min(maximumLines, linesFor(block.items).length);
    const initialTop = Math.max(0, block.bottom - initialLines * 15);
    const initialBottom = initialTop + initialLines * 15;
    const previous = callouts[callouts.length - 1];
    if (previous && previous.top < initialBottom + 3) {
      block = previous; block.items.unshift(item);
    } else callouts.push(block);
    placeCallout(block);
  }
  // Clamping a growing terminal block at the top can push its bottom down
  // into an earlier block. Revisit neighbours after every merge; a single
  // comparison with the latest source onset does not cover that reflow.
  const packed: Callout[] = [];
  for (const callout of callouts) {
    while (packed.length && callout.bottom + 3 > packed[packed.length - 1].top) {
      callout.items.push(...packed.pop()!.items);
      callout.items.sort((a, b) => a.y - b.y);
      placeCallout(callout);
    }
    packed.push(callout);
  }
  for (const callout of packed) {
    const cluster = element(group, 'g', {'data-webscore-annotation-callout': callout.items.length, role: 'img'});
    const description = callout.items.map((item) => annotationDescription(item.annotation)).join('; ');
    cluster.setAttribute('aria-label', description);
    element(cluster, 'title').textContent = description;
    const top = Math.max(0, callout.top);
    callout.lines.forEach((line, index) => text(cluster, callout.items[0].annotation, line, left, top + FONT_SIZE + index * 15, available));
    // Every onset remains explicit even when dense expressions share a label.
    for (const {annotation, y, mark} of callout.items) {
      mark.dataset.webscoreAnnotationAnchor = String(y);
      const labelY = Math.max(top + FONT_SIZE / 2, Math.min(callout.bottom - 3, y));
      element(mark, 'path', {d: `M${left - 3} ${y}h2L${left} ${labelY}`, stroke: 'currentColor', fill: 'none'});
      if (!mark.querySelector('title')!.textContent) mark.querySelector('title')!.textContent = annotationDescription(annotation);
    }
  }
}
