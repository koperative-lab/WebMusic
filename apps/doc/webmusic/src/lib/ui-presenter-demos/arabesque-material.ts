import {Pitch, Rational, type Score} from '@webmusic/score';
import {inspectScoreChords} from '@webmusic/score/analyze';
import type {HarmonyVoice} from '@webmusic/ui/harmony';
import {loadArabesqueScore} from '../../components/headless/arabesque-score';
import type {UiPresenterDemoHandle} from './types';

export interface DemoTone {
  midi: number;
  diatonic: number;
  label: string;
  role?: HarmonyVoice['role'];
}
export interface DemoChord {
  symbol: string;
  full: string;
  pitchNames: string;
  description: string;
  rootPitchClass: number;
  fifthsIndex: number;
  tones: readonly DemoTone[];
  voicing: readonly HarmonyVoice[];
  alternates: readonly {symbol: string; note: string}[];
  group?: string;
}
export interface DemoSpan {
  id: string;
  chord: DemoChord;
  start: number;
  end: number;
  stampStart: number;
  stampEnd: number;
}
export interface ArabesqueMaterial {
  spans: readonly DemoSpan[];
  chords: readonly DemoChord[];
  duration: number;
  quarters: number;
  pitchClasses: readonly number[];
  low: number;
  high: number;
}

/** Exact simultaneous source notes; no invented progression, function or key estimate. */
export function projectArabesqueMaterial(score: Score): ArabesqueMaterial {
  const quarters = Math.min(16, score.durationQuarters.toFloat());
  const source = inspectScoreChords(score, {
    pitchMode: 'written', selection: {fromQuarters: 0, toQuarters: quarters},
  });
  const chords = new Map<string, DemoChord>();
  const sounding = source.spans.map((span): DemoSpan => {
    const primary = span.primary;
    const pitches = span.pitches.map((name) => Pitch.parse(name));
    const root = primary ? Pitch.parse(`${primary.root}4`) : pitches[0];
    const rootPitchClass = ((root.midi % 12) + 12) % 12;
    const tones = pitches.map((pitch): DemoTone => {
      const degree = (7 + 'CDEFGAB'.indexOf(pitch.step) - 'CDEFGAB'.indexOf(root.step)) % 7;
      const role = primary ? ({0: 'root', 2: 'third', 4: 'fifth', 6: 'seventh'} as const)[degree as 0 | 2 | 4 | 6] : undefined;
      return {midi: pitch.midi, diatonic: pitch.octave * 7 + 'CDEFGAB'.indexOf(pitch.step), label: pitch.toString(), ...(role ? {role} : {})};
    });
    // Keep distinct voicings distinct: every displayed tone belongs to this span.
    const key = JSON.stringify(span.pitches);
    let chord = chords.get(key);
    if (!chord) {
      chord = {
        symbol: span.label,
        full: primary ? `${primary.root} ${primary.quality}` : `Source pitches ${span.label}`,
        pitchNames: span.pitches.join(' · '),
        description: primary ? 'Exact spelled chord' : 'Source pitch collection',
        rootPitchClass,
        fifthsIndex: (rootPitchClass * 7) % 12,
        tones,
        voicing: tones.map(({label, role}) => ({label, ...(role ? {role} : {})})),
        alternates: span.candidates.slice(1).map((entry) => ({symbol: entry.symbol, note: 'Exact spelled candidate'})),
        ...(primary ? {group: 'matched'} : {}),
      };
      chords.set(key, chord);
    }
    return {
      id: span.id, chord,
      start: score.timeMap.quartersToSeconds(Rational.from(span.startQuarters)),
      end: score.timeMap.quartersToSeconds(Rational.from(span.endQuarters)),
      stampStart: span.startQuarters, stampEnd: span.endQuarters,
    };
  });
  if (!sounding.length) throw new Error('The Arabesque excerpt contains no pitched notes.');
  const duration = score.timeMap.quartersToSeconds(Rational.from(quarters));
  const silence: DemoChord = {
    symbol: 'Silence', full: 'No sounding source notes', pitchNames: '', description: 'Source silence',
    rootPitchClass: -1, fifthsIndex: -1, tones: [], voicing: [], alternates: [],
  };
  const spans: DemoSpan[] = [];
  let previousSeconds = 0;
  let previousQuarters = 0;
  for (const span of sounding) {
    if (span.start > previousSeconds) spans.push({
      id: `silence-${previousQuarters}`, chord: silence,
      start: previousSeconds, end: span.start, stampStart: previousQuarters, stampEnd: span.stampStart,
    });
    spans.push(span);
    previousSeconds = span.end;
    previousQuarters = span.stampEnd;
  }
  if (previousSeconds < duration) spans.push({
    id: `silence-${previousQuarters}`, chord: silence,
    start: previousSeconds, end: duration, stampStart: previousQuarters, stampEnd: quarters,
  });
  const midis = spans.flatMap((span) => span.chord.tones.map((tone) => tone.midi));
  return {
    spans, chords: [...chords.values()], quarters, duration,
    pitchClasses: [...new Set(midis.map((midi) => ((midi % 12) + 12) % 12))],
    low: Math.min(...midis), high: Math.max(...midis),
  };
}

let material: Promise<ArabesqueMaterial> | undefined;
export function loadArabesqueMaterial(): Promise<ArabesqueMaterial> {
  return material ??= loadArabesqueScore('mxl').then(projectArabesqueMaterial).catch((error: unknown) => {
    material = undefined;
    throw error;
  });
}

/** Find an exact active source span; a negative index represents source silence. */
export function sourceSpanAt(spans: readonly DemoSpan[], seconds: number): number {
  return spans.findIndex((span) => span.start <= seconds && seconds < span.end);
}

/** Shared load is cached; disposing one borrower prevents its late UI installation. */
export function mountArabesqueMaterial(
  host: HTMLElement,
  mount: (host: HTMLElement, data: ArabesqueMaterial) => UiPresenterDemoHandle,
): UiPresenterDemoHandle {
  let destroyed = false;
  let pending = false;
  let inner: UiPresenterDemoHandle | undefined;
  let off: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const state = new Map<string, unknown>();
  const options = new Map<string, unknown>();
  const status = host.ownerDocument.createElement('p');
  status.setAttribute('role', 'status');
  host.append(status);
  const notify = () => { for (const listener of listeners) listener(); };
  const load = async () => {
    if (destroyed || pending || inner) return;
    pending = true;
    status.textContent = 'Loading Arabesque No. 1…';
    delete host.dataset.presenterDemoError;
    try {
      const data = await loadArabesqueMaterial();
      if (destroyed) return;
      inner = mount(host, data);
      for (const [name, value] of state) inner.setState?.(name, value);
      for (const [name, value] of options) inner.setOption?.(name, value);
      off = inner.subscribe?.(notify);
      status.remove();
      notify();
    } catch (error) {
      if (destroyed) return;
      off?.(); off = undefined; inner?.destroy(); inner = undefined;
      host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error);
      status.textContent = `Could not load Arabesque No. 1: ${host.dataset.presenterDemoError}. `;
      const retry = host.ownerDocument.createElement('button');
      retry.type = 'button'; retry.textContent = 'Retry'; retry.onclick = () => { void load(); };
      status.append(retry);
    } finally { pending = false; }
  };
  void load();
  return {
    setState(name, value) { if (!destroyed) { state.set(name, value); inner?.setState?.(name, value); } },
    setOption(name, value) { if (!destroyed) { options.set(name, value); inner?.setOption?.(name, value); } },
    reset() { if (!destroyed) { state.clear(); options.clear(); if (inner) inner.reset?.(); else void load(); } },
    snapshot: () => inner?.snapshot?.() ?? Object.fromEntries(state),
    subscribe(listener) {
      if (destroyed) return () => {};
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; off?.(); inner?.destroy(); listeners.clear(); status.remove();
      delete host.dataset.presenterDemoError;
    },
  };
}
