import type {SVGContext} from 'vexflow/bravura';
import type {BarlineStyle} from '../../../core';

/** Draw a MusicXML bar style at the right boundary of its occupied width. */
export function drawStaffBarline(ctx: SVGContext, style: BarlineStyle, x: number, top: number, bottom: number, connector = false): void {
  if (style === 'none' || connector && (style === 'tick' || style === 'short')) return;
  const group = ctx.openGroup('staff-barline');
  group.dataset.webscoreBarline = style;
  ctx.save();
  if (style === 'tick') { bottom = top + 5; top -= 5; }
  if (style === 'short') { top += 10; bottom -= 10; }
  const lines = style === 'light-light' ? [[-4, 1], [0, 1]] :
    style === 'light-heavy' ? [[-6, 1], [-1.5, 3]] :
    style === 'heavy-light' ? [[-6, 3], [0, 1]] :
    style === 'heavy-heavy' ? [[-7, 3], [-1.5, 3]] : [[0, style === 'heavy' ? 3 : 1]];
  ctx.setLineDash(style === 'dotted' ? [1, 3] : style === 'dashed' ? [5, 4] : []);
  for (const [offset, width] of lines) {
    ctx.setLineWidth(width).beginPath().moveTo(x + offset, top).lineTo(x + offset, bottom).stroke();
  }
  ctx.restore(); ctx.closeGroup();
}
