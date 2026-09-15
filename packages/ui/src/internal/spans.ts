/**
 * The playhead-follow stamp: the four attributes a node carries so that
 * `createAnalysisPlayhead` can find it, light it, and put it back.
 *
 * The reader is `analysis.ts` — `readAnalysisSpans`, `readAnalysisIdleStyle`
 * and `ANALYSIS_SPAN_SELECTOR` — and this module is deliberately the WRITER
 * for the same contract. Six renderers used to write those attributes by hand,
 * each in its own idiom, and every new live surface was about to write a
 * seventh. The contract is four exact byte sequences; it belongs in one place.
 *
 * It is internal for the same reason `./dom` and `./lifecycle` are: it is
 * plumbing, not a presenter, so it travels inside the modules that import it
 * rather than becoming a published subpath.
 *
 * ## The three rules, each of which was a bug before it was a rule
 *
 * 1. **The two forms are mutually exclusive.** A node carrying both
 *    `data-start-quarters`/`data-end-quarters` AND `data-spans` reads back as
 *    `1 + N` spans, because `readAnalysisSpans` collects both. Two renderers
 *    pin their span COUNT, so writing both silently changes a number a test is
 *    holding still.
 * 2. **A non-finite number writes no attribute at all.** `String(NaN)` is
 *    `'NaN'`, which matches `ANALYSIS_SPAN_SELECTOR` and parses to nothing: a
 *    zombie node the playhead walks on every tick and can never light.
 * 3. **The idle style is the node's COMPLETE inline style, stamped last.** The
 *    playhead REPLACES `style.cssText` with the idle string when a highlight
 *    ends, so anything painted after the stamp is erased by the first
 *    de-highlight — for a lane's bands that means the geometry, and a band
 *    collapsing to `left: 0` the moment it stops sounding.
 * 4. **A re-stamp hands the highlight back** ({@link restampActiveStyle}). The
 *    playhead lights a node ONCE, on the frame it becomes active, and skips it
 *    for as long as it stays active — so a writer that rewrites a lit node's
 *    box does not drop one frame of highlight, it leaves the node dark for the
 *    rest of the span while `aria-current` goes on claiming otherwise.
 */

import {harmonyInline, harmonyParts} from '../harmony-style';

/** One range on the stamping axis, in whatever unit the caller's playhead reads. */
export interface SpanStamp {
  start: number;
  end: number;
}

function finiteRange(span: SpanStamp | undefined): SpanStamp | undefined {
  if (!span) return undefined;
  const {start, end} = span;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return {start, end};
}

/**
 * Stamp the span contract onto one node.
 *
 * A single {@link SpanStamp} takes the RANGE form — `data-start-quarters` plus
 * `data-end-quarters` — and an array takes the LIST form, `data-spans` as
 * space-separated `start:end` pairs. Which form a node uses is the caller's
 * decision and not a function of the count: one occurrence of a motif is still
 * an occurrence LIST, and reading it back as a range would give the playhead a
 * different node shape for a one-occurrence motif than for a two-occurrence one.
 *
 * Whatever is not written is REMOVED. A node that carried a range and now
 * carries a list must not keep the range, or rule 1 is broken on the way past.
 *
 * Passing `undefined`, an empty array, or values that are not finite clears the
 * stamp entirely: a node with no honest span does not pretend to have one.
 */
export function stampSpans(
  node: HTMLElement,
  spans: SpanStamp | readonly SpanStamp[] | undefined,
): void {
  if (Array.isArray(spans)) {
    const pairs = (spans as readonly SpanStamp[])
      .map(finiteRange)
      .filter((span): span is SpanStamp => span !== undefined)
      .map((span) => `${span.start}:${span.end}`);
    delete node.dataset.startQuarters;
    delete node.dataset.endQuarters;
    if (pairs.length === 0) delete node.dataset.spans;
    else node.dataset.spans = pairs.join(' ');
    return;
  }
  const range = finiteRange(spans as SpanStamp | undefined);
  delete node.dataset.spans;
  if (!range) {
    delete node.dataset.startQuarters;
    delete node.dataset.endQuarters;
    return;
  }
  node.dataset.startQuarters = String(range.start);
  node.dataset.endQuarters = String(range.end);
}

/**
 * Record the node's inline style so a highlight can be undone.
 *
 * Call it LAST, after every paint. It reads `style.cssText` back out of the
 * node rather than taking a string, which is what makes the round trip exact:
 * a browser normalises what it stores, and a hand-built string that merely
 * ought to match is the version of this that shipped broken.
 *
 * The terminating `;` is not cosmetic. The playhead concatenates its active
 * declarations onto this string, and without the terminator the join is one
 * malformed declaration — which drops BOTH the idle string's last declaration
 * and the highlight's first. Every real engine appends the `;` itself when
 * serialising; the guard is for the ones that do not.
 */
export function stampIdleStyle(node: HTMLElement): void {
  const css = node.style.cssText;
  node.dataset.webscoreIdleStyle = css === '' || css.endsWith(';') ? css : `${css};`;
}

/**
 * The declarations a lit node carries on top of its idle string.
 *
 * Generated from the same record `analysis.ts` concatenates, so the two strings
 * are equal by construction rather than by anyone remembering. It is written
 * here as well as there because `harmony.ts` may not import `analysis.ts`: that
 * module holds `createAnalysisPlayhead`'s registry in a module-level `WeakMap`,
 * and a second bundler entry pulling it into its own chunk would give the
 * single-owner claim two copies to disagree over.
 */
const ACTIVE_SPAN_STYLE = harmonyInline(harmonyParts.activeSpan);

/**
 * Hand a highlight back to a node whose box has just been re-stamped.
 *
 * Call it LAST, after {@link stampIdleStyle}, and only from a writer that
 * replaces `style.cssText` wholesale.
 *
 * The playhead writes `idle + active` ONCE, on the frame a node joins its
 * active set, and then skips that node until it leaves — so a writer that
 * overwrites `cssText` underneath it does not lose one frame of highlight, it
 * leaves the node dark for the rest of the span while `aria-current="true"`
 * goes on saying that node is the one sounding. Measured on a chip strip, that
 * is every snapshot update; on a lane, every change of a lit band's geometry.
 *
 * `aria-current` is the question rather than a private flag on purpose: the
 * playhead is the sole owner of that attribute on a span-carrying node, which
 * makes it the only honest way to ask whether this node is lit, and a writer
 * that kept its own answer could disagree with the module that decides.
 */
export function restampActiveStyle(node: HTMLElement): void {
  if (node.getAttribute('aria-current') !== 'true') return;
  node.style.cssText = `${node.dataset.webscoreIdleStyle ?? ''}${ACTIVE_SPAN_STYLE}`;
}
