import {
  harmonyInline,
  harmonyParts,
  harmonyRootDeclarations,
  harmonyRule,
  harmonySheet,
  harmonyValues,
  severityFill,
} from './harmony-style';
import {markEmptyState} from './internal/dom';
import {claimHost, createErrorSink, createUpdateLoop, runCleanups} from './internal/lifecycle';
import {bindLocalization, formatNumber, formatPercent, message, type UILocalization} from './localization';
import type {Declarations} from './styles';
import {componentSurfaceDeclarations} from './internal/surface';
export interface AnalysisKeyResult { tonic: string; mode: string; confidence: number; scores: readonly {tonic: string; mode: string; score: number}[]; }
export interface AnalysisChordSegment { chord: string; startQuarters: number; endQuarters: number; }
export interface AnalysisRomanSegment extends AnalysisChordSegment { roman: string; }
export interface AnalysisLiveChordState { chord: string; midis: readonly number[]; history: readonly string[]; }
export interface AnalysisMotif { intervals: readonly number[]; rhythm: readonly number[]; occurrences: readonly {startQuarters: number}[]; }
export interface AnalysisVoiceIssue { type: string; severity: "info" | "warning" | "error"; voices: readonly string[]; startQuarters: number; endQuarters: number; }
export interface LiveChordPanel { paint(state: AnalysisLiveChordState): void; }
export interface AnalysisHistogramBin { label: string; value: number; }
export interface AnalysisSummaryCard { title: string; subtitle?: string; rows: readonly {label: string; value: string}[]; }
export interface AnalysisRhythmPattern { pattern: readonly number[]; count: number; onsets: readonly number[]; }
export type AudioAnalysisCardType = "key" | "tempo" | "loudness" | "onsets" | "pitch";
export interface AudioAnalysisCardResult {
  key?: {tonic: string; mode: string; confidence: number};
  tempo?: {bpm: number; confidence: number; grid: {beats: ArrayLike<number>}};
  loudness: {integratedLufs: number; truePeakDb: number; rms: number};
  onsets?: readonly number[];
  /**
   * `times` are the frame timestamps in seconds. Without them the contour is
   * plotted against frame index, which silently mislabels the axis whenever
   * frames are not uniformly spaced.
   */
  pitchTrack?: {frequencies: ArrayLike<number>; times?: ArrayLike<number>};
}

export interface AnalysisLocalizationOptions {
  /** Borrowed text and formatting source; one-shot helpers read it when rendering. */
  localization?: UILocalization;
}

export interface AudioAnalysisCardOptions extends AnalysisLocalizationOptions {
  /**
   * Clip length in seconds. The onset track is a time axis, so without it the
   * marks are normalized by the LAST onset — which draws a clip whose last
   * onset is halfway through as if the events filled it end to end.
   */
  durationSeconds?: number;
  /** Render a failure state instead of the card body. */
  error?: string;
}

const analysisSurface = componentSurfaceDeclarations('analysis', {
  padding: harmonyParts.root.padding,
  border: harmonyParts.root.border,
  radius: 'var(--wm-analysis-radius, var(--wm-control-radius, 0))',
  background: harmonyParts.root.background,
});

/**
 * The root, muted and timeline rules — generated from the same records the
 * helpers paint inline, so the two paths cannot drift apart. Exported, never
 * installed: these helpers render into a caller's light DOM, where an injected
 * rule would escape into the whole page. A consumer that owns a shadow root can
 * install it; everyone else gets the identical box from `cssText`.
 *
 * The sheet is built for `.wui-analysis` — the class `createAnalysisRoot`
 * actually stamps — so its `data-density` / `data-scheme` switches select the
 * node they claim to. Those two attributes are the only skin decisions a host
 * cannot make from `cssText` alone, which is the whole reason to install it.
 */
export const analysisStyle = [
  harmonySheet('.wui-analysis'),
  harmonyRule('.wui-analysis', analysisSurface),
  harmonyRule('.wui-analysis__muted', harmonyParts.inkMuted),
  harmonyRule('.wui-analysis__timeline', harmonyParts.stackList),
].join('\n\n');

// ---------------------------------------------------------------------------
// Playhead-follow contract. Rows, chips and motif entries carry the quarter
// span(s) they cover plus the inline style to restore when a highlight ends.
// Consumers read the data through this API; the attribute names themselves are
// presenter internals.
// ---------------------------------------------------------------------------

export interface AnalysisSpan { startQuarters: number; endQuarters: number; }

export interface AnalysisPlayheadOptions {
  /** Scroll the first newly-active row into view. Defaults to `true`. */
  scroll?: boolean;
  /** Extra class applied while a row is active. */
  activeClassName?: string;
  onError?: (error: unknown) => void;
}

export interface AnalysisPlayheadHandle {
  element: HTMLElement;
  /** Highlight every rendered analysis span containing this quarter position. */
  update(quarters: number): void;
  clear(): void;
  destroy(): void;
}

/** Matches every span-carrying node a presenter rendered under an analysis root. */
export const ANALYSIS_SPAN_SELECTOR = "[data-start-quarters],[data-spans]";

/** All quarter spans an analysis node covers (single range and/or multi-span). */
export function readAnalysisSpans(element: HTMLElement): AnalysisSpan[] {
  const spans: AnalysisSpan[] = [];
  const start = Number(element.dataset.startQuarters);
  const end = Number(element.dataset.endQuarters);
  if (Number.isFinite(start) && Number.isFinite(end)) spans.push({startQuarters: start, endQuarters: end});
  for (const pair of element.dataset.spans?.split(" ") ?? []) {
    const [from, to] = pair.split(":").map(Number);
    if (Number.isFinite(from) && Number.isFinite(to)) spans.push({startQuarters: from, endQuarters: to});
  }
  return spans;
}

/** The idle inline style stamped at render time, to restore after a highlight. */
export function readAnalysisIdleStyle(element: HTMLElement): string | undefined {
  return element.dataset.webscoreIdleStyle;
}

interface CachedAnalysisSpans {
  startQuarters: string | undefined;
  endQuarters: string | undefined;
  spans: string | undefined;
  parsed: AnalysisSpan[];
}

const mountedAnalysisPlayheads = new WeakMap<HTMLElement, AnalysisPlayheadHandle>();
const analysisSpanCache = new WeakMap<HTMLElement, CachedAnalysisSpans>();
// Concatenated onto a node's idle string, which is why every idle string this
// module stamps is generated by `harmonyInline` and therefore ends with `;`.
// Without that terminator the browser reads the join as one malformed
// declaration and drops BOTH the idle string's last declaration and this
// `background` — for a long time only the outline ever survived a highlight.
const ANALYSIS_ACTIVE_STYLE = harmonyInline(harmonyParts.activeSpan);

function cachedAnalysisSpans(element: HTMLElement): AnalysisSpan[] {
  const {startQuarters, endQuarters, spans} = element.dataset;
  const cached = analysisSpanCache.get(element);
  if (
    cached &&
    cached.startQuarters === startQuarters &&
    cached.endQuarters === endQuarters &&
    cached.spans === spans
  ) return cached.parsed;
  const parsed = readAnalysisSpans(element);
  analysisSpanCache.set(element, {startQuarters, endQuarters, spans, parsed});
  return parsed;
}

/**
 * Create a playhead controller over nodes rendered by the analysis helpers.
 * Span discovery, active styling, ARIA state and scrolling remain UI-owned;
 * callers supply only the current numeric quarter position.
 */
export function createAnalysisPlayhead(
  root: HTMLElement,
  options: AnalysisPlayheadOptions = {},
): AnalysisPlayheadHandle {
  let active = new Set<HTMLElement>();
  let destroyed = false;
  const activeClassNames = (options.activeClassName ?? "is-playing")
    .trim().split(/\s+/).filter(Boolean);

  const apply = (next: readonly HTMLElement[]): void => {
    const nextSet = new Set(next);
    let changed = false;
    for (const element of active) {
      if (nextSet.has(element)) continue;
      element.style.cssText = readAnalysisIdleStyle(element) ?? "";
      element.classList?.remove?.(...activeClassNames);
      element.removeAttribute?.("aria-current");
      changed = true;
    }
    for (const element of nextSet) {
      if (active.has(element)) continue;
      element.style.cssText = `${readAnalysisIdleStyle(element) ?? ""}${ANALYSIS_ACTIVE_STYLE}`;
      element.classList?.add?.(...activeClassNames);
      element.setAttribute?.("aria-current", "true");
      changed = true;
    }
    active = nextSet;
    if (changed && options.scroll !== false) {
      next[0]?.scrollIntoView?.({block: "nearest", inline: "nearest"});
    }
  };

  const handle: AnalysisPlayheadHandle = {
    element: root,
    update(quarters) {
      if (destroyed) return;
      try {
        const position = Number.isFinite(quarters) ? quarters : 0;
        const matches: HTMLElement[] = [];
        for (const candidate of root.querySelectorAll<HTMLElement>(ANALYSIS_SPAN_SELECTOR)) {
          if (cachedAnalysisSpans(candidate).some(
            (span) => position >= span.startQuarters && position < span.endQuarters,
          )) matches.push(candidate);
        }
        apply(matches);
      } catch (error) {
        options.onError?.(error);
      }
    },
    clear() {
      if (destroyed) return;
      try {
        apply([]);
      } catch (error) {
        options.onError?.(error);
      }
    },
    destroy() {
      if (destroyed) return;
      try {
        apply([]);
      } catch (error) {
        options.onError?.(error);
      }
      destroyed = true;
      claim.release();
    },
  };
  const claim = claimHost(mountedAnalysisPlayheads, root, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;
  return handle;
}

function makeEl(document: Document) { return (tag: string, text?: string): HTMLElement => { const node=document.createElement(tag); if(text!=null)node.textContent=text; return node; }; }
function documentOf(node: HTMLElement): Document { return node.ownerDocument ?? globalThis.document; }
// One node's whole box, from the record. Always replaces `cssText` rather than
// appending to it: the `cssText += ";…"` idiom this replaced left a doubled
// semicolon that some parsers treat as the end of the declaration list.
function paint(node: HTMLElement, ...groups: Declarations[]): HTMLElement { node.style.cssText=harmonyInline(...groups); return node; }
function muted(node: HTMLElement): HTMLElement { node.style.color=harmonyParts.inkMuted.color; return node; }

export function createAnalysisRoot(document: Document = globalThis.document): HTMLElement {
  const root=makeEl(document)("div"); root.className="wui-analysis webscore-analyze";
  // The root is where the token layer lives, so every descendant resolves the
  // same skin. It declares no `color-scheme`: the light-dark() values inside
  // the tokens follow the HOST page's, so a light-only page keeps the colours
  // it has always had and a dark-capable one takes the card with it.
  root.style.cssText=harmonyInline(harmonyRootDeclarations(),harmonyParts.root,analysisSurface);
  return root;
}

export function renderKeyView(result: AnalysisKeyResult|undefined, root: HTMLElement, caption?: string, options: AnalysisLocalizationOptions = {}): void {
  const el=makeEl(documentOf(root));
  const l = options.localization;
  const text = (key: string, fallback: string, values?: Readonly<Record<string, string | number>>): string => message(l, `analysis.${key}`, fallback, values);
  if(caption)root.append(paint(el("div",caption),harmonyParts.inkMuted,harmonyParts.caption));
  const head=paint(el("div",result?text("keyName", "{tonic} {mode}", {tonic: result.tonic, mode: result.mode}):text("emptyValue", "—")),harmonyParts.headline);
  const sub=paint(el("div",result?text("confidence", "confidence {value}", {value: formatPercent(l, result.confidence), confidence: result.confidence}):text("noNotes", "no notes heard yet")),harmonyParts.inkMuted,harmonyParts.subhead);root.append(head,sub);if(!result)return;
  const top=result.scores.slice(0,5);const max=Math.max(...top.map(x=>x.score),1e-6);const list=paint(el("div"),harmonyParts.meterList);
  for(const candidate of top){const row=paint(el("div"),harmonyParts.candidateRow);const label=paint(el("span",text("keyName", "{tonic} {mode}", {tonic: candidate.tonic, mode: candidate.mode})),harmonyParts.inkMuted,harmonyParts.monoLabel);const track=paint(el("span"),harmonyParts.meterTrack);const fill=paint(el("span"),harmonyParts.meterFill,{width:`${Math.max(2,candidate.score/max*100)}%`});track.append(fill);row.append(label,track);list.append(row)}root.append(list);
}

export function renderChordTimeline(chords: readonly AnalysisChordSegment[], root: HTMLElement, options: AnalysisLocalizationOptions = {}): void {
  const el=makeEl(documentOf(root));
  const l = options.localization;
  const text = (key: string, fallback: string, values?: Readonly<Record<string, string | number>>): string => message(l, `analysis.${key}`, fallback, values);
  const list=documentOf(root).createElement("ol");list.className="wui-analysis__timeline webscore-analyze__timeline";list.style.cssText=harmonyInline(harmonyParts.stackList);
  const idle=harmonyInline(harmonyParts.timelineRow);
  for(const segment of chords){const row=el("li");row.style.cssText=idle;row.dataset.webscoreIdleStyle=idle;row.dataset.startQuarters=String(segment.startQuarters);row.dataset.endQuarters=String(segment.endQuarters);const chord=paint(el("span",segment.chord||text("emptyValue", "—")),harmonyParts.chordName);chord.className="webscore-analyze__chord";const at=paint(el("span",text("beat", "beat {value}", {value: formatNumber(l, segment.startQuarters + 1, (segment.startQuarters + 1).toFixed(0)), beat: segment.startQuarters + 1})),harmonyParts.inkMuted,harmonyParts.beatLabel);at.className="webscore-analyze__beat";row.append(chord,at);list.append(row)}root.append(list);
}

export function renderRomanStrip(key: AnalysisKeyResult, roman: readonly AnalysisRomanSegment[], root: HTMLElement, options: AnalysisLocalizationOptions = {}): void {
  const el=makeEl(documentOf(root));
  const l = options.localization;
  const text = (key: string, fallback: string, values?: Readonly<Record<string, string | number>>): string => message(l, `analysis.${key}`, fallback, values);
  root.append(paint(el("div",text("inKey", "in {tonic} {mode}", {tonic: key.tonic, mode: key.mode})),harmonyParts.inkMuted,harmonyParts.captionSpaced));const strip=paint(el("div"),harmonyParts.chipStrip);
  const idle=harmonyInline(harmonyParts.chip);
  for(const segment of roman){const chip=el("div");chip.style.cssText=idle;chip.dataset.webscoreIdleStyle=idle;chip.dataset.startQuarters=String(segment.startQuarters);chip.dataset.endQuarters=String(segment.endQuarters);const numeral=paint(el("div",segment.roman),harmonyParts.chipNumeral);const chord=paint(el("div",segment.chord),harmonyParts.inkMuted,harmonyParts.chipCaption);chip.append(numeral,chord);strip.append(chip)}root.append(strip);
}

export interface LiveChordPanelOptions extends AnalysisLocalizationOptions {
  /**
   * Spell one MIDI note number. Defaults to the number itself, because how a
   * pitch is SPELLED is domain knowledge: sharps or flats, ASCII or Unicode,
   * and which enharmonic a key implies. @webmusic/score answers that with
   * `pcName`, and its answer and this module's used to disagree in the same
   * panel — a sharp here against the equivalent flat there.
   */
  formatPitch?: (midi: number) => string;
}

export function renderLiveChordPanel(root: HTMLElement, options: LiveChordPanelOptions = {}): LiveChordPanel {
  const el=makeEl(documentOf(root));
  const l = options.localization;
  const text = (key: string, fallback: string, values?: Readonly<Record<string, string | number>>): string => message(l, `analysis.${key}`, fallback, values);
  const caption=paint(el("div",text("soundingNow", "sounding now")),harmonyParts.inkMuted,harmonyParts.caption);const chord=paint(el("div",text("emptyValue", "—")),harmonyParts.nameplate);const notes=paint(el("div",text("waiting", "waiting for playback…")),harmonyParts.inkMuted,harmonyParts.voicing);const history=paint(el("div"),harmonyParts.history);root.append(caption,chord,notes,history);
  const chipIdle=harmonyInline(harmonyParts.historyChip);const chipSounding=harmonyInline(harmonyParts.historyChip,harmonyParts.historyChipActive);
  return{paint(state){caption.textContent=text("soundingNow", "sounding now");chord.textContent=state.chord||text("emptyValue", "—");notes.textContent=state.midis.length?state.midis.map(options.formatPitch ?? ((midi) => formatNumber(l, midi))).join("  "):text("waiting", "waiting for playback…");history.replaceChildren(...state.history.map(label=>{const chip=el("span",label);chip.style.cssText=label===state.chord&&state.midis.length?chipSounding:chipIdle;return chip}))}};
}

export function renderMotifList(motifs: readonly AnalysisMotif[], root: HTMLElement, options: AnalysisLocalizationOptions = {}): void {
  const el=makeEl(documentOf(root));
  const l = options.localization;
  const text = (key: string, fallback: string, values?: Readonly<Record<string, string | number>>): string => message(l, `analysis.${key}`, fallback, values);
  if(!motifs.length){root.append(muted(el("div",text("noMotifs", "No repeated motifs found."))));return}const list=paint(el("ol"),harmonyParts.stackList,harmonyParts.stackGap);
  const idle=harmonyInline(harmonyParts.stackRow);
  for(const motif of motifs.slice(0,8)){const row=el("li");row.style.cssText=idle;row.dataset.webscoreIdleStyle=idle;const length=motif.rhythm.reduce((sum,value)=>sum+value,0);row.dataset.spans=motif.occurrences.map(x=>`${x.startQuarters}:${x.startQuarters+length}`).join(" ");const count=paint(el("span",text("count", "×{value}", {value: formatNumber(l, motif.occurrences.length), count: motif.occurrences.length})),harmonyParts.count);const shape=paint(el("span",text("intervals", "intervals [{values}]", {values: motif.intervals.map(value => formatNumber(l, value)).join(", ")})),harmonyParts.inkMuted,harmonyParts.monoLabel);row.append(count,shape);list.append(row)}root.append(list);
}

export function renderVoiceLeadingList(issues: readonly AnalysisVoiceIssue[], root: HTMLElement, options: AnalysisLocalizationOptions = {}): void {
  const el=makeEl(documentOf(root));
  const l = options.localization;
  const text = (key: string, fallback: string, values?: Readonly<Record<string, string | number>>): string => message(l, `analysis.${key}`, fallback, values);
  if(!issues.length){root.append(muted(el("div",text("noVoiceIssues", "No voice-leading issues — clean."))));return}const list=paint(el("ol"),harmonyParts.stackList,harmonyParts.stackGap);
  const idle=harmonyInline(harmonyParts.issueRow);
  for(const issue of issues.slice(0,12)){const row=el("li");row.style.cssText=idle;row.dataset.webscoreIdleStyle=idle;row.dataset.startQuarters=String(issue.startQuarters);row.dataset.endQuarters=String(Math.max(issue.endQuarters,issue.startQuarters+1));const dot=paint(el("span"),harmonyParts.severityDot,{background:severityFill(issue.severity)});const label=el("span",text("voiceIssue", "{label}", {type: issue.type, label: issue.type.replace(/-/g," ")}));const where=muted(el("span",text("issueLocation", "{voices} · {beat}", {voices: issue.voices.join(" / "), beat: text("beat", "beat {value}", {value: formatNumber(l, issue.startQuarters + 1, (issue.startQuarters + 1).toFixed(0)), beat: issue.startQuarters + 1})})));row.append(dot,label,where);list.append(row)}root.append(list);
}

/**
 * Note-value glyph for one duration in quarter notes. Only the dyadic values
 * have a glyph; anything else (triplets, dotted ties, imported oddities) falls
 * back to the number, which is why the row stays readable for any rhythm.
 */

/**
 * The score's recurring rhythmic figures, most frequent first. Each row carries
 * every occurrence's span, so a bound playhead lights the figure that is
 * sounding — the same `data-spans` contract the motif list uses.
 */
export interface RhythmPatternListOptions extends AnalysisLocalizationOptions {
  limit?: number;
  /**
   * Name one duration, in quarters. Defaults to the number itself, because
   * notating a duration is domain knowledge: which glyph a value takes, and
   * that a dot means half again, are conventions of Western notation rather
   * than facts about a layout. @webmusic/score answers this one.
   */
  formatDuration?: (quarters: number) => string;
}

export function renderRhythmPatternList(patterns: readonly AnalysisRhythmPattern[], root: HTMLElement, options: RhythmPatternListOptions = {}): void {
  const el=makeEl(documentOf(root));
  const l = options.localization;
  const text = (key: string, fallback: string, values?: Readonly<Record<string, string | number>>): string => message(l, `analysis.${key}`, fallback, values);
  if(!patterns.length){root.append(muted(el("div",text("noRhythms", "No repeated rhythms found."))));return}
  const list=paint(el("ol"),harmonyParts.stackList,harmonyParts.stackGap);list.className="wui-analysis__rhythms";
  const idle=harmonyInline(harmonyParts.stackRow);
  for(const entry of patterns.slice(0,options.limit??8)){
    const row=el("li");row.style.cssText=idle;row.dataset.webscoreIdleStyle=idle;
    const length=entry.pattern.reduce((sum,value)=>sum+value,0);
    row.dataset.spans=entry.onsets.map(onset=>`${onset}:${onset+length}`).join(" ");
    const count=paint(el("span",text("count", "×{value}", {value: formatNumber(l, entry.count), count: entry.count})),harmonyParts.count);
    const figure=paint(el("span",entry.pattern.map(options.formatDuration ?? ((value) => formatNumber(l, value))).join(" ")),harmonyParts.figure);
    const span=paint(el("span",text("quarters", "{value} q", {value: formatNumber(l, length, String(Math.round(length*100)/100)), quarters: length})),harmonyParts.inkMuted,harmonyParts.microNote);
    row.append(count,figure,span);list.append(row)}
  root.append(list);
}

/**
 * A labelled bar distribution — pitch classes, intervals, durations, or any
 * other aggregate. Bars scale against the largest bin, so an all-zero set
 * renders flat rather than dividing by zero. `format` styles the readout;
 * omit it to show the raw number.
 */
export interface AnalysisHistogramOptions extends AnalysisLocalizationOptions {
  emptyLabel?: string;
  format?: (value: number) => string;
  /** Selecting a nonempty bin, from a pointer or a native keyboard button. */
  onSelect?: (index: number, bin: AnalysisHistogramBin) => Promise<void> | void;
  onError?: (error: unknown) => void;
}

export interface AnalysisHistogramHandle {
  /** Reflect active bin indexes without rebuilding focused controls. */
  setActive(indexes: readonly number[]): void;
  destroy(): void;
}

export function renderHistogram(
  bins: readonly AnalysisHistogramBin[],
  root: HTMLElement,
  options: AnalysisHistogramOptions = {},
): AnalysisHistogramHandle {
  const el = makeEl(documentOf(root));
  const nodes: HTMLElement[] = [];
  const buttons: HTMLButtonElement[] = [];
  const valueNodes: HTMLElement[] = [];
  const report = createErrorSink(options.onError);
  const cleanups: (() => void)[] = [];
  let destroyed = false;
  let empty: HTMLElement | undefined;
  if (!bins.length) {
    empty = muted(el("div"));
    markEmptyState(empty);
    root.append(empty);
    nodes.push(empty);
  } else {
    const max = Math.max(...bins.map(bin => bin.value), 0);
    const list = paint(el("div"), harmonyParts.meterList);
    list.className = "wui-analysis__histogram";
    for (const [index, bin] of bins.entries()) {
      const row = paint(el("div"), harmonyParts.histogramRow);
      const label = paint(el(options.onSelect ? "button" : "span", bin.label), harmonyParts.inkMuted, harmonyParts.monoLabel);
      if (options.onSelect) {
        const button = label as HTMLButtonElement;
        button.type = "button";
        button.disabled = !(bin.value > 0);
        button.style.cursor = button.disabled ? "default" : "pointer";
        const select = (): void => {
          if (destroyed || button.disabled) return;
          try {
            void Promise.resolve(options.onSelect?.(index, bin)).catch(report);
          } catch (error) {
            report(error);
          }
        };
        button.addEventListener("click", select);
        cleanups.push(() => button.removeEventListener("click", select));
        buttons[index] = button;
      }
      const track = paint(el("span"), harmonyParts.meterTrack);
      const fill = paint(el("span"), harmonyParts.meterFill, {width: `${max > 0 ? Math.max(0, bin.value / max * 100) : 0}%`});
      track.append(fill);
      const value = paint(el("span"), harmonyParts.inkMuted, harmonyParts.monoValue);
      valueNodes[index] = value;
      row.append(label, track, value);
      list.append(row);
    }
    root.append(list);
    nodes.push(list);
  }
  const refresh = createUpdateLoop({
    name: 'Analysis histogram',
    isCurrent: () => !destroyed,
    report,
    pass: () => {
      try {
        if (empty) {
          const text = options.emptyLabel ?? message(options.localization, 'analysis.histogramEmpty', 'Nothing to show.');
          if (!destroyed) empty.textContent = text;
          return;
        }
        const rows = bins.map((bin) => {
          const value = options.format?.(bin.value) ?? formatNumber(
            options.localization, bin.value, String(Math.round(bin.value * 100) / 100),
          );
          const label = options.onSelect ? message(
            options.localization, 'analysis.histogramSelect', '{label}: {value}. Go to next occurrence',
            {label: bin.label, value, rawValue: bin.value},
          ) : undefined;
          return {value, label};
        });
        if (destroyed) return;
        rows.forEach(({value, label}, index) => {
          valueNodes[index]!.textContent = value;
          if (label !== undefined) buttons[index]!.setAttribute('aria-label', label);
        });
      } catch (error) {
        report(error);
      }
    },
  });
  const handle: AnalysisHistogramHandle = {
    setActive(indexes) {
      if (destroyed) return;
      const active = new Set(indexes);
      buttons.forEach((button, index) => {
        const row = button.parentElement!;
        row.style.cssText = harmonyInline(harmonyParts.histogramRow, ...(active.has(index) ? [harmonyParts.activeSpan] : []));
        if (active.has(index)) button.setAttribute("aria-current", "true");
        else button.removeAttribute("aria-current");
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      refresh.cancel();
      runCleanups([
        ...cleanups.splice(0),
        ...nodes.splice(0).map(node => () => node.remove()),
      ], report);
    },
  };
  cleanups.push(bindLocalization(options.localization, refresh.run, () => !destroyed, report));
  if (!destroyed) refresh.run();
  return handle;
}

export interface AnalysisSummaryCardHandle {
  /** Update values for a named row while preserving the report's DOM. */
  setValue(label: string, value: string): void;
}

/** A title plus a definition grid of scalar facts — the at-a-glance card. */
export function renderSummaryCard(card: AnalysisSummaryCard, root: HTMLElement): AnalysisSummaryCardHandle {
  const el=makeEl(documentOf(root));
  const title=paint(el("strong",card.title),harmonyParts.summaryTitle);title.className="wui-analysis__title webscore-analyze__title";root.append(title);
  if(card.subtitle)root.append(paint(el("div",card.subtitle),harmonyParts.inkMuted,harmonyParts.captionSpaced));
  const list=documentOf(root).createElement("dl");list.className="wui-analysis__list webscore-analyze__list";list.style.cssText=harmonyInline(harmonyParts.summaryList);
  const values = new Map<string, HTMLElement[]>();
  for (const row of card.rows) {
    appendSummaryRow(list, row.label, row.value);
    const nodes = values.get(row.label) ?? [];
    nodes.push(list.lastElementChild as HTMLElement);
    values.set(row.label, nodes);
  }
  root.append(list);
  return {
    setValue(label, value) {
      for (const node of values.get(label) ?? []) {
        if (node.textContent !== value) node.textContent = value;
      }
    },
  };
}

export function appendSummaryRow(list: HTMLDListElement,label:string,value:string):void{const el=makeEl(documentOf(list));const term=paint(el("dt",label),harmonyParts.inkMuted,harmonyParts.summaryTerm);const description=paint(el("dd",value),harmonyParts.summaryValue);list.append(term,description)}

export function renderAudioAnalysisCard(type: AudioAnalysisCardType, result: AudioAnalysisCardResult | undefined, root = createAnalysisRoot(), options: AudioAnalysisCardOptions = {}): HTMLElement {
  const el=makeEl(documentOf(root));
  const l = options.localization;
  const text = (key: string, fallback: string, values?: Readonly<Record<string, string | number>>): string => message(l, `analysis.${key}`, fallback, values);
  root.classList.add("wui-analysis--audio", "waa-card");
  root.replaceChildren();
  if(options.error){const failure=paint(el("div",options.error),harmonyParts.failure);failure.setAttribute("role","status");root.append(failure);return root}
  if(!result){root.append(muted(el("div",text("noAnalysis", "No analysis yet."))));return root}
  if(type==="key"){const value=result.key;if(!value){root.append(muted(el("div",text("keyUnavailable", "Key not analyzed."))));return root}const head=paint(el("div",text("keyName", "{tonic} {mode}", {tonic: value.tonic, mode: value.mode})),harmonyParts.headline);root.append(head,muted(el("div",text("confidence", "confidence {value}", {value: formatPercent(l, value.confidence), confidence: value.confidence}))));return root}
  if(type==="tempo"){const value=result.tempo;if(!value){root.append(muted(el("div",text("tempoUnavailable", "Tempo not analyzed."))));return root}const head=paint(el("div",text("tempo", "{value} BPM", {value: formatNumber(l, value.bpm, String(Math.round(value.bpm))), bpm: value.bpm})),harmonyParts.headline);root.append(head,muted(el("div",text("tempoDetails", "confidence {confidence} · {value} beats", {confidence: formatPercent(l, value.confidence), value: formatNumber(l, value.grid.beats.length), count: value.grid.beats.length}))));return root}
  if(type==="loudness"){const dl=documentOf(root).createElement("dl");dl.style.cssText=harmonyInline(harmonyParts.factList);const db=(value:number)=>Number.isFinite(value)?formatNumber(l, value, value.toFixed(1)):text("negativeInfinity", "−∞");appendSummaryRow(dl,text("integrated", "Integrated"),text("lufs", "{value} LUFS", {value: db(result.loudness.integratedLufs)}));appendSummaryRow(dl,text("truePeak", "True peak"),text("dbfs", "{value} dBFS", {value: db(result.loudness.truePeakDb)}));appendSummaryRow(dl,text("rms", "RMS"),formatNumber(l, result.loudness.rms, result.loudness.rms.toFixed(4)));root.append(dl);return root}
  if(type==="onsets"){const onsets=result.onsets;if(!onsets){root.append(muted(el("div",text("onsetsUnavailable", "Onsets not analyzed."))));return root}const head=paint(el("div",text("onsets", "{value} onsets", {value: formatNumber(l, onsets.length), count: onsets.length})),harmonyParts.strong);const track=paint(el("div"),harmonyParts.onsetTrack);const span=options.durationSeconds&&options.durationSeconds>0?options.durationSeconds:(onsets[onsets.length-1]??1);for(const time of onsets.slice(0,400))track.append(paint(el("span"),harmonyParts.onsetMark,{left:`${time/(span||1)*100}%`}));root.append(head,track);return root}
  const values=result.pitchTrack?.frequencies;if(!values?.length){root.append(muted(el("div",text("pitchUnavailable", "Pitch not analyzed."))));return root}const voiced=Array.from(values).filter(value=>value>0);if(!voiced.length){root.append(muted(el("div",text("noVoicedPitch", "No voiced pitch found."))));return root}const min=Math.min(...voiced),max=Math.max(...voiced),width=240,height=48,range=max-min||1;const svg=documentOf(root).createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox",`0 0 ${width} ${height}`);svg.style.cssText=harmonyInline(harmonyParts.contour);const times=result.pitchTrack?.times;const lastTime=times?.length?times[times.length-1]:0;const span=options.durationSeconds&&options.durationSeconds>0?options.durationSeconds:lastTime;let d="";let broken=true;Array.from(values).forEach((value,index)=>{if(value<=0){broken=true;return}const at=times?.length&&span>0?Number(times[index])/span:index/Math.max(1,values.length-1);const x=at*width;const y=height-(value-min)/range*height;d+=`${broken?"M":"L"}${x.toFixed(1)} ${y.toFixed(1)} `;broken=false});const path=documentOf(root).createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("d",d.trim());path.setAttribute("fill","none");path.setAttribute("stroke",harmonyValues.accent);path.setAttribute("stroke-width","1.5");svg.append(path);root.append(el("div",text("pitchRange", "{minimum}–{maximum} Hz", {minimum: formatNumber(l, min, String(Math.round(min))), maximum: formatNumber(l, max, String(Math.round(max)))})),svg);return root
}
