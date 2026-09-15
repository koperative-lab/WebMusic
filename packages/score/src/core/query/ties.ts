import type {Note} from '../model/Note';
import type {Part} from '../model/Part';
import type {Rational} from '../primitives/Rational';

/** A merged sounding event produced by `mergedTiedNotes`. */
export interface MergedNoteEvent {
  /** The first (attack) note of the tie chain. */
  first: Note;
  /** All notes in the chain, in onset order (length 1 for untied notes). */
  notes: ReadonlyArray<Note>;
  /** Onset of the first note, in quarters. */
  onsetQuarters: Rational;
  /** Sum of the chained notes' durations, in quarters. */
  durationQuarters: Rational;
}

/** Chain key: ties only connect notes in the same voice at the same (MIDI) pitch. */
function tieKey(n: Note): string {
  return `${n.voice}|${n.pitch.midi}`;
}

/**
 * Group a part's notes into tie chains: runs of notes connected by
 * `tie: 'start' | 'continue' | 'stop'` within the same voice and at the same
 * sounding pitch, in onset order. Untied notes appear as single-element
 * chains. Rest notes (no pitch) are skipped.
 *
 * Malformed ties are handled gracefully:
 * - a 'stop' (or 'continue') with no open chain starts/stands alone;
 * - a 'start' while a chain is already open closes the previous chain;
 * - a gap or overlap at a connection closes the previous chain; the next
 *   'continue' starts a new chain and the next 'stop' stands alone;
 * - chains left open at the end of the part are emitted as-is.
 *
 * Chains are returned ordered by their first note's onset.
 */
export function tieChains(part: Part): Note[][] {
  const chains: Note[][] = [];
  const open = new Map<string, Note[]>();

  // part.notes is already sorted by onset (Part constructor invariant).
  for (const n of part.notes) {
    if (n.rest || n.pitch == null) continue;
    if (n.tie == null) {
      chains.push([n]);
      continue;
    }
    const key = tieKey(n);
    let chain = open.get(key);
    // A tie sustains one contiguous notated event. Summing disconnected
    // durations would shift a later attack into a gap or double an overlap.
    // Compare exact quarter positions so tuplets and cross-staff ties keep
    // their intended connections without an arbitrary floating tolerance.
    if (chain && !chain[chain.length - 1].offsetQuarters.eq(n.onsetQuarters)) {
      chains.push(chain);
      open.delete(key);
      chain = undefined;
    }
    switch (n.tie) {
      case 'start':
        // 'start' while open = malformed: close the previous chain first.
        if (chain) chains.push(chain);
        open.set(key, [n]);
        break;
      case 'continue':
        if (chain) chain.push(n);
        else open.set(key, [n]); // 'continue' without 'start': treat as start.
        break;
      case 'stop':
        if (chain) {
          chain.push(n);
          chains.push(chain);
          open.delete(key);
        } else {
          chains.push([n]); // 'stop' without 'start': standalone.
        }
        break;
    }
  }
  // Unterminated chains (missing 'stop') are still valid groups.
  for (const chain of open.values()) chains.push(chain);

  chains.sort((a, b) => a[0].onsetQuarters.cmp(b[0].onsetQuarters));
  return chains;
}

/**
 * Effective sounding events of a part: each tie chain merged into one event
 * with the chain's first onset and the summed duration. Untied notes become
 * single-element events. See `tieChains` for malformed-tie handling.
 */
export function mergedTiedNotes(part: Part): MergedNoteEvent[] {
  return tieChains(part).map((notes) => {
    let duration = notes[0].duration.quarters;
    for (let i = 1; i < notes.length; i++) duration = duration.add(notes[i].duration.quarters);
    return {
      first: notes[0],
      notes,
      onsetQuarters: notes[0].onsetQuarters,
      durationQuarters: duration,
    };
  });
}
