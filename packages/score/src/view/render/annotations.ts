import type {ScoreAnnotation} from '../core/annotations';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FONT_SIZE = 12;

/** Thumbnail overview geometry; only the thumbnail renderer draws expressions off-staff. */
interface ThumbnailAnnotationOptions {
  xAtQuarter(quarter: number): number;
  width: number;
  color?: string;
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

/** Fitted overview: nearby expressions share one readable, inspectable marker. */
export function drawThumbnailScoreAnnotations(svg: SVGSVGElement, annotations: readonly ScoreAnnotation[], options: ThumbnailAnnotationOptions): {height: number; group: SVGGElement} {
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
