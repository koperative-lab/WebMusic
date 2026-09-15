import {isPitchedNote, noteMidi, noteVoiceString, type Note, type Part, type Score} from '../../core';
import type {VoiceLeadingIssue} from './types';

/**
 * Scan the score for classic voice-leading problems:
 *
 * - `large-leap`: a melodic leap larger than an octave within one voice.
 * - `parallel-fifth` / `parallel-octave`: two voices moving in the same
 *   direction while keeping a perfect fifth (7 semitones mod 12) or
 *   octave/unison (0 semitones mod 12) between them. Repeated (static)
 *   intervals are NOT flagged — both voices must actually move.
 * - `voice-crossing`: at a shared onset, the nominally lower voice sounds
 *   above the nominally upper voice.
 *
 * Voice pairs are checked across ALL parts (an SATB chorale split over two
 * parts is standard), not just within a single part.
 */
/**
 * @internal A voice with its exact onset keys precomputed (once, not per voice
 * pair). Exported for the incremental analyzer, which caches lanes per part.
 */
export interface VoiceLane {
  partId: string;
  voice: string;
  notes: Note[];
  /** Canonical Rational onset of `notes[i]`. */
  onsetKeys: string[];
  /** The representative sounding note at each exact onset. */
  byOnset: Map<string, Note>;
  /** Index of the representative note at each exact onset. */
  byOnsetIndex: Map<string, number>;
  /** A notated rest occurs between the previous sounding note and `notes[i]`. */
  breakBefore: boolean[];
}

/** @internal Build the voice lanes of one part, in canonical (map insertion) order. */
export function buildVoiceLanes(part: Part): VoiceLane[] {
  const lanes: VoiceLane[] = [];
  const voices = groupByVoice(part.id, [...part.notes]);
  for (const [voice, sourceNotes] of voices) {
    const notes: Note[] = [];
    const onsetKeys: string[] = [];
    const byOnset = new Map<string, Note>();
    const byOnsetIndex = new Map<string, number>();
    const breakBefore: boolean[] = [];
    let restSinceLastSounding = false;

    // A voice can contain chord members at the same onset. Treat that onset
    // as one melodic event (the first sounding member mirrors MusicXML's
    // non-`<chord/>` event), so vertical chord intervals cannot be mistaken
    // for enormous melodic jumps. A rest-only or unpitched-only onset terminates
    // tonal continuity.
    for (let start = 0; start < sourceNotes.length; ) {
      const onset = sourceNotes[start].onsetQuarters;
      let firstSounding: Note | undefined;
      while (start < sourceNotes.length && sourceNotes[start].onsetQuarters.eq(onset)) {
        const note = sourceNotes[start++];
        if (isPitchedNote(note) && !firstSounding) firstSounding = note;
      }
      if (!firstSounding) {
        if (notes.length > 0) restSinceLastSounding = true;
        continue;
      }
      const index = notes.length;
      notes.push(firstSounding);
      const key = onset.toString();
      onsetKeys.push(key);
      byOnset.set(key, firstSounding);
      byOnsetIndex.set(key, index);
      breakBefore.push(restSinceLastSounding);
      restSinceLastSounding = false;
    }
    if (notes.length > 0) lanes.push({partId: part.id, voice, notes, onsetKeys, byOnset, byOnsetIndex, breakBefore});
  }
  return lanes;
}

/** @internal Melodic large-leap issues within a single lane. */
export function laneLeapIssues(lane: VoiceLane): VoiceLeadingIssue[] {
  const {voice, notes, breakBefore} = lane;
  const issues: VoiceLeadingIssue[] = [];
  for (let index = 1; index < notes.length; index += 1) {
    if (breakBefore[index]) continue;
    const leap = Math.abs(noteMidi(notes[index]) - noteMidi(notes[index - 1]));
    if (leap > 12) {
      issues.push({
        type: 'large-leap',
        startQuarters: notes[index - 1].onsetQuarters.toFloat(),
        endQuarters: notes[index].onsetQuarters.toFloat(),
        voices: [voice],
        voiceParts: [lane.partId],
        severity: 'warning',
      });
    }
  }
  return issues;
}

export function voiceLeading(score: Score): VoiceLeadingIssue[] {
  const issues: VoiceLeadingIssue[] = [];
  const voiceEntries: VoiceLane[] = [];

  for (const part of score.parts) {
    for (const lane of buildVoiceLanes(part)) voiceEntries.push(lane);
  }

  for (const lane of voiceEntries) {
    for (const issue of laneLeapIssues(lane)) issues.push(issue);
  }

  // Pair every voice with every other voice, including across parts.
  for (let a = 0; a < voiceEntries.length; a += 1) {
    for (let b = a + 1; b < voiceEntries.length; b += 1) {
      for (const issue of pairIssues(voiceEntries[a], voiceEntries[b])) issues.push(issue);
    }
  }

  return issues;
}

function groupByVoice(partId: string, notes: readonly Note[]): Map<string, Note[]> {
  const voices = new Map<string, Note[]>();
  for (const note of notes) {
    const voice = noteVoiceString(note) || `${partId}-staff-${note.staff ?? 1}`;
    const list = voices.get(voice) ?? [];
    list.push(note);
    voices.set(voice, list);
  }
  for (const list of voices.values()) {
    list.sort((a, b) => a.onsetQuarters.cmp(b.onsetQuarters));
  }
  return voices;
}

/** Real interval between two pitches in semitones, folded to one octave (0–11). */
function intervalMod12(midiA: number, midiB: number): number {
  return Math.abs(midiB - midiA) % 12;
}

/**
 * @internal Parallel-motion and voice-crossing issues between two lanes.
 * A pure function of the two lanes, so the incremental analyzer caches its
 * result per (laneA, laneB) identity pair.
 */
export function pairIssues(a: VoiceLane, b: VoiceLane): VoiceLeadingIssue[] {
  const {voice: voiceA, notes: notesA, onsetKeys: onsetsA} = a;
  const voiceB = b.voice;
  const issues: VoiceLeadingIssue[] = [];
  const pairs: Array<{a: Note; b: Note; breakBefore: boolean}> = [];
  let previousA = -1;
  let previousB = -1;
  for (let index = 0; index < notesA.length; index += 1) {
    const match = b.byOnset.get(onsetsA[index]);
    const matchIndex = b.byOnsetIndex.get(onsetsA[index]);
    if (match && matchIndex !== undefined) {
      pairs.push({
        a: notesA[index],
        b: match,
        breakBefore: a.breakBefore.slice(previousA + 1, index + 1).some(Boolean) ||
          b.breakBefore.slice(previousB + 1, matchIndex + 1).some(Boolean),
      });
      previousA = index;
      previousB = matchIndex;
    }
  }

  if (pairs.length === 0) return issues;

  // Voice crossing: decide which voice is nominally upper by mean pitch, then
  // flag every shared onset where that ordering is inverted.
  const meanA = mean(pairs.map((pair) => noteMidi(pair.a)));
  const meanB = mean(pairs.map((pair) => noteMidi(pair.b)));
  const upperIsA = meanA >= meanB;
  for (const {a: noteA, b: noteB} of pairs) {
    const crossed = upperIsA ? noteMidi(noteA) < noteMidi(noteB) : noteMidi(noteB) < noteMidi(noteA);
    if (crossed) {
      issues.push({
        type: 'voice-crossing',
        startQuarters: noteA.onsetQuarters.toFloat(),
        endQuarters: noteA.offsetQuarters.toFloat(),
        voices: [voiceA, voiceB],
        voiceParts: [a.partId, b.partId],
        severity: 'warning',
      });
    }
  }

  for (let index = 1; index < pairs.length; index += 1) {
    const previous = pairs[index - 1];
    const next = pairs[index];
    if (next.breakBefore) continue;
    const {a: prevA, b: prevB} = previous;
    const {a: nextA, b: nextB} = next;
    const deltaA = noteMidi(nextA) - noteMidi(prevA);
    const deltaB = noteMidi(nextB) - noteMidi(prevB);
    // Both voices must actually move, and in the same direction. Repeated
    // notes (oblique / static motion) are not parallel motion.
    if (deltaA === 0 || deltaB === 0) continue;
    if (Math.sign(deltaA) !== Math.sign(deltaB)) continue;

    const previousInterval = intervalMod12(noteMidi(prevA), noteMidi(prevB));
    const nextInterval = intervalMod12(noteMidi(nextA), noteMidi(nextB));

    if (previousInterval === nextInterval && (nextInterval === 7 || nextInterval === 0)) {
      issues.push({
        type: nextInterval === 7 ? 'parallel-fifth' : 'parallel-octave',
        startQuarters: prevA.onsetQuarters.toFloat(),
        endQuarters: nextA.onsetQuarters.toFloat(),
        voices: [voiceA, voiceB],
        voiceParts: [a.partId, b.partId],
        severity: 'error',
      });
    }
  }

  return issues;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
