import {Glyph, TextDynamics, type SVGContext} from 'vexflow/bravura';
import type {PartDirection} from '../../../core';
import type {StaffInkBounds} from './staff-spacing';

type SpanMark = Extract<PartDirection, {kind: 'pedal' | 'wedge'}>;
interface Span {start: SpanMark; end?: SpanMark; changes: SpanMark[]}
interface PointMark {source: PartDirection; x: number; y: number; width: number; height: number}

export interface StaffDirectionLayoutOptions {
  xAtQuarter(quarter: number): number;
  endQuarters: number;
  ink: string;
  /** Musical ink only, in unscaled staff coordinates (top line = 40). */
  obstacles: readonly StaffInkBounds[];
}

/** Pair numbered, staff-local expression lines in source order across bars. */
export function pairStaffDirectionSpans(directions: readonly PartDirection[]): Span[] {
  const result: Span[] = [];
  const open = new Map<string, Span>();
  for (const direction of directions) {
    if (direction.kind !== 'pedal' && direction.kind !== 'wedge') continue;
    const key = `${direction.kind}:${direction.staff ?? 1}:${direction.number ?? 1}`;
    const previous = open.get(key);
    if (direction.type === 'continue') continue;
    if (direction.type === 'change' && previous) { previous.changes.push(direction); continue; }
    if (direction.type === 'stop' || direction.type === 'discontinue') {
      if (previous) { previous.end = direction; open.delete(key); }
      continue;
    }
    if (previous) previous.end = direction;
    const span = {start: direction, changes: []};
    open.set(key, span); result.push(span);
  }
  return result;
}

function above(mark: PartDirection): boolean {
  return mark.placement ? mark.placement === 'above' : ['words', 'rehearsal', 'metronome'].includes(mark.kind);
}
function baseline(mark: PartDirection): number {
  return (mark.defaultY === undefined ? above(mark) ? 25 : mark.kind === 'pedal' ? 116 : 110 : 40 - mark.defaultY) - (mark.relativeY ?? 0);
}
function xPosition(mark: PartDirection, options: StaffDirectionLayoutOptions): number {
  return options.xAtQuarter(mark.onsetQuarters.toFloat()) + (mark.defaultX ?? 0) + (mark.relativeX ?? 0);
}
function intersects(a: StaffInkBounds, b: StaffInkBounds, gap = 4): boolean {
  return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
}
function place(left: number, width: number, preferred: number, height: number, isAbove: boolean, obstacles: readonly StaffInkBounds[]): number {
  let y = preferred;
  // Move outwards only. Source positioning is retained when it is readable.
  for (let pass = 0; pass <= obstacles.length; pass += 1) {
    const colliding = obstacles.filter((box) => intersects({left, right: left + width, top: y - height, bottom: y + 3}, box));
    if (!colliding.length) break;
    y = isAbove ? Math.min(...colliding.map((box) => box.top)) - 7 : Math.max(...colliding.map((box) => box.bottom)) + height + 7;
  }
  return y;
}
function textSize(mark: PartDirection): number {
  return 'fontSize' in mark && mark.fontSize !== undefined ? mark.fontSize * 4 / 3 : mark.kind === 'rehearsal' ? 18 : 16;
}
function plainText(mark: PartDirection): string {
  if (mark.kind === 'words' || mark.kind === 'rehearsal') return mark.text;
  if (mark.kind === 'dynamics') return mark.values.join(' ');
  return '';
}
function dynamicsWidth(text: string): number {
  return [...text].reduce((sum, letter) => sum + (TextDynamics.GLYPHS[letter]?.width ?? 8), 0);
}

/** Draw source text and expression lines without converting them to playback commands. */
export function drawStaffDirections(ctx: SVGContext, directions: readonly PartDirection[], options: StaffDirectionLayoutOptions): StaffInkBounds[] {
  // Expressions can approach the staff, but never its lines. The renderer's
  // note/curve obstacles alone do not include otherwise empty staff columns.
  const musicalInk = [...options.obstacles, {left: 0, right: options.xAtQuarter(options.endQuarters), top: 40, bottom: 80}];
  const occupied = [...musicalInk];
  const points: PointMark[] = [];
  const groupFor = (mark: PartDirection) => {
    const group = ctx.openGroup('staff-direction');
    group.dataset.webscoreDirection = mark.kind;
    group.dataset.webscoreDirectionOnset = mark.onsetQuarters.toString();
    group.dataset.webscoreDirectionStaff = String(mark.staff ?? 1);
    return group;
  };
  for (const mark of directions) {
    if (mark.printObject === false || mark.kind === 'pedal' || mark.kind === 'wedge') continue;
    const group = groupFor(mark);
    const text = plainText(mark);
    const size = textSize(mark);
    const symbolicDynamic = mark.kind === 'dynamics' && [...text].every((letter) => !!TextDynamics.GLYPHS[letter]);
    ctx.save(); ctx.setFillStyle(options.ink).setStrokeStyle(options.ink);
    ctx.setFont('Times New Roman, serif', size, 'fontWeight' in mark ? mark.fontWeight : undefined, 'fontStyle' in mark ? mark.fontStyle : undefined);
    const width = mark.kind === 'metronome' ? 55 + String(mark.perMinute).length * 8
      : symbolicDynamic ? dynamicsWidth(text) : Math.max(size / 2, ctx.measureText(text).width || text.length * size * .55);
    const height = symbolicDynamic ? 25 : size;
    const x = xPosition(mark, options);
    const y = place(x, width, baseline(mark), height, above(mark), occupied);
    if (symbolicDynamic) {
      let cursor = x;
      for (const letter of text) {
        Glyph.renderGlyph(ctx, cursor, y, 39, TextDynamics.GLYPHS[letter].code);
        cursor += TextDynamics.GLYPHS[letter].width;
      }
      group.dataset.webscoreDirectionText = text;
    } else if (mark.kind === 'metronome') {
      // Use real notation glyphs; a text font need not include musical Unicode.
      const whole = mark.beatUnit.base.toFloat() >= 4;
      const half = mark.beatUnit.base.toFloat() >= 2;
      let cursor = x;
      if (mark.parentheses) { ctx.fillText('(', cursor, y); cursor += 8; }
      Glyph.renderGlyph(ctx, cursor, y - 3, 30, whole ? 'noteheadWhole' : half ? 'noteheadHalf' : 'noteheadBlack');
      if (!whole) ctx.beginPath().moveTo(cursor + 8, y - 3).lineTo(cursor + 8, y - 24).stroke();
      const flags = Math.max(0, Math.round(Math.log2(.5 / mark.beatUnit.base.toFloat())) + 1);
      if (!whole && flags > 0) Glyph.renderGlyph(ctx, cursor + 8, y - 24, 30, `flag${Math.min(256, 2 ** (flags + 2))}thUp`);
      cursor += 13;
      for (let dot = 0; dot < mark.beatUnit.dots; dot += 1) { ctx.fillText('·', cursor, y - 2); cursor += 5; }
      ctx.fillText(` = ${mark.perMinute}${mark.parentheses ? ')' : ''}`, cursor, y);
      group.dataset.webscoreDirectionText = `${mark.beatUnit.base} = ${mark.perMinute}`;
    } else {
      const lines = text.split(/\r?\n/);
      lines.forEach((line, index) => ctx.fillText(line, x, y + index * size * 1.2));
      if (mark.kind === 'rehearsal') ctx.rect(x - 4, y - height - 3, width + 8, height + 8, {fill: 'none', stroke: options.ink});
      group.dataset.webscoreDirectionText = text;
    }
    ctx.restore(); ctx.closeGroup();
    const point = {source: mark, x, y, width, height};
    points.push(point); occupied.push({left: x, right: x + width, top: y - height, bottom: y + 4});
  }
  for (const span of pairStaffDirectionSpans(directions)) {
    const mark = span.start;
    if (mark.printObject === false) continue;
    let left = xPosition(mark, options);
    const terminal = span.end?.onsetQuarters.toFloat() ?? options.endQuarters;
    let right = span.end ? xPosition(span.end, options) : options.xAtQuarter(terminal);
    if (!(right > left)) continue;
    const group = groupFor(mark);
    group.dataset.webscoreDirectionEnd = String(terminal);
    group.dataset.webscoreDirectionType = mark.type;
    ctx.save(); ctx.setFillStyle(options.ink).setStrokeStyle(options.ink).setLineWidth(1.1);
    if (mark.kind === 'wedge') {
      // Like other notation, hairpins leave horizontal room for dynamics at
      // their endpoints, rather than drawing a line through the text.
      const localPoints = points.filter((point) => above(point.source) === above(mark) && point.source.kind === 'dynamics');
      for (const point of localPoints) {
        if (point.source.onsetQuarters.eq(mark.onsetQuarters)) left = Math.max(left, point.x + point.width + 6);
        if (span.end?.onsetQuarters.eq(point.source.onsetQuarters)) right = Math.min(right, point.x - 6);
      }
      const opening = Math.max(4, mark.spread ?? (span.end?.kind === 'wedge' ? span.end.spread : undefined) ?? 12);
      const y = place(left, Math.max(0, right - left), baseline(mark) + opening / 2, opening, above(mark), occupied) - opening / 2;
      if (right > left) {
        const crescendo = mark.type === 'crescendo';
        const narrow = crescendo ? left : right;
        const wide = crescendo ? right : left;
        const radius = mark.niente ? 2.5 : 0;
        const tip = narrow + (crescendo ? radius * 2 : -radius * 2);
        ctx.beginPath().moveTo(wide, y - opening / 2).lineTo(tip, y).lineTo(wide, y + opening / 2).stroke();
        if (radius) ctx.beginPath().arc(narrow + (crescendo ? radius : -radius), y, radius, 0, Math.PI * 2, false).stroke();
        occupied.push({left, right, top: y - opening / 2, bottom: y + opening / 2});
      }
    } else {
      const showSign = mark.sign !== false && mark.type !== 'resume';
      const line = mark.line === true;
      const textWidth = showSign ? Glyph.getWidth('keyboardPedalPed', 39, 'pedalMarking') : 0;
      // Leave room for the next pedal sign at a shared release/depress time.
      // Otherwise sequential spans collide at their touching endpoints and
      // each following line is pushed another text-height away from the staff.
      if (span.end && directions.some((next) => next.kind === 'pedal' && next !== span.end && next.type === 'start' &&
        next.onsetQuarters.eq(span.end!.onsetQuarters) && (next.number ?? 1) === (mark.number ?? 1))) right -= 10;
      let y = baseline(mark);
      for (let pass = 0; pass < 4; pass += 1) {
        const before = y;
        if (showSign) y = place(left, textWidth, y, 24, above(mark), occupied);
        y = place(left + textWidth + (showSign ? 5 : 0), Math.max(0, right - left - textWidth), y, line ? 9 : 24, above(mark), occupied);
        if (y === before) break;
      }
      if (showSign) { Glyph.renderGlyph(ctx, left, y, 39, 'keyboardPedalPed', {category: 'pedalMarking'}); group.dataset.webscoreDirectionText = 'Ped.'; }
      if (line) {
        const start = left + textWidth + (showSign ? 5 : 0);
        if (right > start) {
          ctx.beginPath().moveTo(start, showSign ? y : y - 9).lineTo(start, y);
          for (const change of span.changes) {
            const x = xPosition(change, options);
            if (x > start + 4 && x < right - 4) ctx.lineTo(x - 4, y).lineTo(x, y - 8).lineTo(x + 4, y);
          }
          ctx.lineTo(right, y);
          if (span.end?.type !== 'discontinue' && span.end) ctx.lineTo(right, y - 9);
          ctx.stroke();
        }
      } else {
        for (const change of span.changes) {
          const x = xPosition(change, options);
          Glyph.renderGlyph(ctx, x - 10, y, 39, 'keyboardPedalUp', {category: 'pedalMarking'});
          Glyph.renderGlyph(ctx, x + 4, y, 39, 'keyboardPedalPed', {category: 'pedalMarking'});
        }
        if (span.end && span.end.type !== 'discontinue') Glyph.renderGlyph(ctx, right - 12, y, 39, 'keyboardPedalUp', {category: 'pedalMarking'});
      }
      if (showSign) occupied.push({left, right: left + textWidth, top: y - 24, bottom: y + 2});
      occupied.push({left: left + textWidth + (showSign ? 5 : 0), right, top: y - (line ? 9 : 24), bottom: y + 2});
    }
    ctx.restore(); ctx.closeGroup();
  }
  return occupied.slice(musicalInk.length);
}
