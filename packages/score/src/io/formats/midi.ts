import * as TonejsMidi from '@tonejs/midi';

// @tonejs/midi ships CJS only; in plain Node ESM its named exports are not
// statically detectable, so they only appear on the namespace's `default`.
const {Midi} = ((TonejsMidi as {default?: typeof TonejsMidi}).default ?? TonejsMidi) as typeof TonejsMidi;
import {
  DEFAULT_PPQ,
  Duration,
  PartId,
  Rational,
  Score,
  ScoreBuilder,
  VoiceId,
  midiToPitch,
  mergedTiedNotes,
  noteVelocity,
  soundingPitch,
  ticksToQuarters,
} from '../../core';
import type {ScoreDiagnostic, ScoreParseResult} from '../diagnostics';

export interface MIDIParseLimits {
  /** Maximum source size accepted by the direct parser. */
  maxInputBytes: number;
  /** Maximum number of `MTrk` chunks. */
  maxTracks: number;
  /** Maximum number of channel, meta and system events across all tracks. */
  maxEvents: number;
}

export type MIDIParseOptions = Partial<MIDIParseLimits>;

export const DEFAULT_MIDI_PARSE_LIMITS: Readonly<MIDIParseLimits> = Object.freeze({
  maxInputBytes: 32 * 1024 * 1024,
  maxTracks: 512,
  maxEvents: 1_000_000,
});

export class MIDIParseLimitError extends Error {
  readonly code = 'midi-parse-limit';

  constructor(message: string) {
    super(message);
    this.name = 'MIDIParseLimitError';
  }
}

export function resolveMIDIParseLimits(options: MIDIParseOptions = {}): MIDIParseLimits {
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MIDI_PARSE_LIMITS.maxInputBytes;
  const maxTracks = options.maxTracks ?? DEFAULT_MIDI_PARSE_LIMITS.maxTracks;
  const maxEvents = options.maxEvents ?? DEFAULT_MIDI_PARSE_LIMITS.maxEvents;
  if (!Number.isSafeInteger(maxInputBytes) || maxInputBytes < 1) {
    throw new RangeError('MIDI maxInputBytes must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maxTracks) || maxTracks < 1) {
    throw new RangeError('MIDI maxTracks must be a positive safe integer');
  }
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) {
    throw new RangeError('MIDI maxEvents must be a positive safe integer');
  }
  return {maxInputBytes, maxTracks, maxEvents};
}

/**
 * MIDI permits several meta events at one tick. Preserve their source order
 * explicitly: the shared TimeMap contract resolves a same-position collision
 * to the final declaration.
 */
function sortByTicks<T extends {ticks: number}>(entries: ReadonlyArray<T>): T[] {
  return entries
    .map((entry, declarationOrder) => ({entry, declarationOrder}))
    .sort((left, right) => left.entry.ticks - right.entry.ticks || left.declarationOrder - right.declarationOrder)
    .map(({entry}) => entry);
}

/** Number of source declarations shadowed by a later declaration at the same tick. */
function shadowedSameTickEntries<T extends {ticks: number}>(entries: ReadonlyArray<T>): number {
  let shadowed = 0;
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1].ticks === entries[index].ticks) shadowed += 1;
  }
  return shadowed;
}

/**
 * `sortByTicks` keeps source order for diagnostics; consumers of a timeline
 * need just its observable value, for which the final same-tick declaration
 * wins.
 */
function retainLastEntryAtEachTick<T extends {ticks: number}>(entries: ReadonlyArray<T>): T[] {
  return entries.filter(
    (entry, index) => index === entries.length - 1 || entry.ticks !== entries[index + 1].ticks,
  );
}

/**
 * SMF text meta events carry raw bytes, and writers routinely pad or terminate
 * them with NUL — a track literally named `"Piano\0"` is common. Those bytes are
 * not printable text, and NUL in particular is illegal in XML 1.0, so leaving it
 * on the part name and id corrupts every downstream consumer (a MusicXML export
 * becomes unparseable). Strip C0/C1 controls on the way in and trim the result;
 * everything else, including non-ASCII names, is preserved as authored.
 */
function cleanMetaText(value: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (value ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
}

/** Exact ceiling used for synthetic MIDI measure labels without float drift. */
function ceilNonNegativeRational(value: Rational): number {
  if (value.num <= 0) return 0;
  const whole = Math.floor(value.num / value.den);
  return value.num % value.den === 0 ? whole : whole + 1;
}

function nominalMeasureLength(timeSignature: readonly number[]): Rational {
  const numerator = timeSignature[0];
  const denominator = timeSignature[1];
  if (
    !Number.isSafeInteger(numerator) || numerator < 1 ||
    !Number.isSafeInteger(denominator) || denominator < 1
  ) {
    throw new Error('MIDI time signature must contain positive integer numerator and denominator');
  }
  return new Rational(4 * numerator, denominator);
}

/**
 * Convert SMF ticks through the canonical tempo stream. We cannot use
 * `@tonejs/midi`'s cached note.time here: when its first tempo event is late,
 * it applies that event backwards instead of the SMF 120 BPM default.
 */
function createTicksToSeconds(
  tempoEntries: ReadonlyArray<{ticks: number; bpm: number}>,
  ppq: number,
): (ticks: number) => number {
  return (ticks: number): number => {
    if (ticks <= 0) return 0;
    let seconds = 0;
    let previousTick = tempoEntries[0].ticks;
    let bpm = tempoEntries[0].bpm;
    for (let index = 1; index < tempoEntries.length && tempoEntries[index].ticks <= ticks; index += 1) {
      const next = tempoEntries[index];
      seconds += ((next.ticks - previousTick) / ppq) * (60 / bpm);
      previousTick = next.ticks;
      bpm = next.bpm;
    }
    return seconds + ((ticks - previousTick) / ppq) * (60 / bpm);
  };
}

/**
 * Build a Score from a SMF byte buffer. MIDI is a Performed-view source:
 * we preserve exact onset/duration/velocity via Note.performed and
 * project the same timing into notated quarter-positions for the model.
 */
export function parseMIDI(buffer: ArrayBuffer, options: MIDIParseOptions = {}): Score {
  return parseMIDIDetailed(buffer, options).score;
}

/**
 * Parse SMF data while recording normalisations that the Score model does not
 * reconstruct from MIDI's performance-oriented representation.
 */
export function parseMIDIDetailed(buffer: ArrayBuffer, options: MIDIParseOptions = {}): ScoreParseResult {
  assertMIDIStructureLimits(buffer, options);
  const header = new Uint8Array(buffer);
  if (header.length >= 14 && ascii(header, 0) === 'MThd' && readU32(header, 4) >= 6) {
    if ((header[12] & 0x80) !== 0) {
      throw new Error('SMPTE-timed MIDI is not supported; convert to quarter-note PPQ timing first');
    }
    if (header[12] === 0 && header[13] === 0) throw new Error('MIDI PPQ must be positive');
    if (header[8] !== 0 || header[9] > 1) {
      throw new Error('MIDI format 2 independent sequences are not supported; load a format 0 or 1 file');
    }
  }
  const midi = new Midi(buffer);
  const ppq = midi.header.ppq || DEFAULT_PPQ;
  const builder = new ScoreBuilder();
  const diagnostics: ScoreDiagnostic[] = [
    {
      code: 'midi-measure-grid-not-reconstructed',
      severity: 'info',
      format: 'midi',
      message: 'MIDI time signatures are preserved in TimeMap, but an authored Score.measure grid is not reconstructed',
    },
  ];
  if (midi.header.keySignatures.length > 0) {
    diagnostics.push({
      code: 'midi-key-signatures-ignored',
      severity: 'warning',
      format: 'midi',
      message: 'MIDI key-signature meta events are not currently mapped into Score measure key signatures',
    });
  }
  let deduplicatedPartIds = 0;
  let ignoredExpressionTracks = 0;

  const tempoEntries = sortByTicks(
    midi.header.tempos.length ? midi.header.tempos : [{ticks: 0, bpm: 120}],
  );
  const shadowedTempoEvents = shadowedSameTickEntries(tempoEntries);
  // SMF's default tempo applies until its first tempo meta event. Do not
  // retroactively apply a future declaration to the score's opening span.
  if (tempoEntries[0].ticks > 0) tempoEntries.unshift({ticks: 0, bpm: 120});
  const canonicalTempoEntries = retainLastEntryAtEachTick(tempoEntries);
  const ticksToSeconds = createTicksToSeconds(canonicalTempoEntries, ppq);
  for (const t of canonicalTempoEntries) {
    builder.addTempo({atQuarters: ticksToQuarters(t.ticks, ppq), bpm: t.bpm});
  }

  const meterEntries = sortByTicks(
    midi.header.timeSignatures.length
      ? midi.header.timeSignatures
      : [{ticks: 0, timeSignature: [4, 4] as [number, number]}],
  );
  const shadowedMeterEvents = shadowedSameTickEntries(meterEntries);
  if (shadowedTempoEvents > 0) {
    diagnostics.push({
      code: 'midi-same-tick-tempo-normalized',
      severity: 'warning',
      format: 'midi',
      message:
        `Retained the last tempo declaration at each shared MIDI tick ` +
        `(${shadowedTempoEvents} earlier declaration${shadowedTempoEvents === 1 ? '' : 's'} normalised)`,
    });
  }
  if (shadowedMeterEvents > 0) {
    diagnostics.push({
      code: 'midi-same-tick-meter-normalized',
      severity: 'warning',
      format: 'midi',
      message:
        `Retained the last meter declaration at each shared MIDI tick ` +
        `(${shadowedMeterEvents} earlier declaration${shadowedMeterEvents === 1 ? '' : 's'} normalised)`,
    });
  }
  // SMF's default meter applies until its first time-signature meta event.
  if (meterEntries[0].ticks > 0) {
    meterEntries.unshift({ticks: 0, timeSignature: [4, 4] as [number, number]});
  }

  // TimeMap resolves shared-position collisions to the final declaration.
  // Canonicalise before deriving synthetic measure labels so a shadowed
  // same-tick event cannot advance a label that never reaches the TimeMap.
  const canonicalMeterEntries = retainLastEntryAtEachTick(meterEntries);

  // MIDI does not contain an authored measure grid. Derive the same synthetic
  // labels as TimeMap's no-grid path: any consumed fraction of the preceding
  // nominal bar advances the next label (ceil, not floor). That prevents a
  // mid-bar change from arriving as m2 and being canonically exposed as m3.
  let measureNumber = 1;
  let previousAtQuarters = ticksToQuarters(canonicalMeterEntries[0].ticks, ppq);
  let previousMeasureLength = nominalMeasureLength(canonicalMeterEntries[0].timeSignature);
  canonicalMeterEntries.forEach((sig, i) => {
    const atQuarters = ticksToQuarters(sig.ticks, ppq);
    if (i > 0) {
      const consumedMeasures = ceilNonNegativeRational(
        atQuarters.sub(previousAtQuarters).div(previousMeasureLength),
      );
      measureNumber += Math.max(1, consumedMeasures);
    }
    builder.addMeter({
      atQuarters,
      measureNumber,
      timeSignature: {numerator: sig.timeSignature[0], denominator: sig.timeSignature[1]},
    });
    previousAtQuarters = atQuarters;
    previousMeasureLength = nominalMeasureLength(sig.timeSignature);
  });

  // Same-named tracks must not collapse into one part (that silently merges /
  // drops notes) — deduplicate ids with a -2, -3, … suffix.
  const usedPartIds = new Set<string>();
  midi.tracks.forEach((track, index) => {
    const trackName = cleanMetaText(track.name);
    const baseId = trackName || `track-${index + 1}`;
    let candidate = baseId;
    for (let n = 2; usedPartIds.has(candidate); n += 1) candidate = `${baseId}-${n}`;
    if (candidate !== baseId) deduplicatedPartIds += 1;
    usedPartIds.add(candidate);
    const partId = PartId(candidate);
    builder.addPart({
      id: partId,
      name: trackName || `Track ${index + 1}`,
      midiProgram: track.instrument?.number,
      midiChannel: track.channel,
    });
    const voice = VoiceId(`${partId}-v1`);

    if (
      Object.keys(track.controlChanges ?? {}).length > 0 ||
      (track.pitchBends?.length ?? 0) > 0
    ) {
      ignoredExpressionTracks += 1;
    }

    for (const note of track.notes) {
      const onsetSec = ticksToSeconds(note.ticks);
      builder.addNote(partId, {
        id: builder.newNoteId(),
        pitch: midiToPitch(note.midi),
        onsetQuarters: ticksToQuarters(note.ticks, ppq),
        duration: new Duration({base: ticksToQuarters(Math.max(1, note.durationTicks), ppq)}),
        voice,
        performed: {
          onsetSec,
          durationSec: ticksToSeconds(note.ticks + note.durationTicks) - onsetSec,
          velocity: Math.round(note.velocity * 127),
        },
      });
    }
  });

  if (deduplicatedPartIds > 0) {
    diagnostics.push({
      code: 'midi-track-id-deduplicated',
      severity: 'warning',
      format: 'midi',
      message: `Deduplicated ${deduplicatedPartIds} same-named MIDI track${deduplicatedPartIds === 1 ? '' : 's'} into distinct Score Part ids`,
    });
  }
  if (ignoredExpressionTracks > 0) {
    diagnostics.push({
      code: 'midi-expression-events-ignored',
      severity: 'warning',
      format: 'midi',
      message: `Ignored control-change or pitch-bend data from ${ignoredExpressionTracks} MIDI track${ignoredExpressionTracks === 1 ? '' : 's'}`,
    });
  }

  return {score: builder.build(), diagnostics: Object.freeze(diagnostics)};
}

/** Count SMF chunks/events before @tonejs/midi materializes its object graph. */
export function assertMIDIStructureLimits(buffer: ArrayBuffer, options: MIDIParseOptions = {}): void {
  const limits = resolveMIDIParseLimits(options);
  if (buffer.byteLength > limits.maxInputBytes) {
    throw new MIDIParseLimitError(
      `MIDI resource limit exceeded: input is ${buffer.byteLength.toLocaleString()} bytes (maxInputBytes is ${limits.maxInputBytes.toLocaleString()})`,
    );
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 8 || ascii(bytes, 0) !== 'MThd') return; // preserve the parser's normal malformed-file error

  const headerLength = readU32(bytes, 4);
  let cursor = 8 + headerLength;
  let tracks = 0;
  let events = 0;

  while (cursor + 8 <= bytes.length) {
    const type = ascii(bytes, cursor);
    const length = readU32(bytes, cursor + 4);
    const start = cursor + 8;
    const end = start + length;
    if (!Number.isSafeInteger(end) || end > bytes.length) return; // let @tonejs/midi report truncation
    cursor = end;
    if (type !== 'MTrk') continue;

    tracks += 1;
    if (tracks > limits.maxTracks) {
      throw new MIDIParseLimitError(
        `MIDI resource limit exceeded: more than ${limits.maxTracks.toLocaleString()} tracks`,
      );
    }
    events = countTrackEvents(bytes, start, end, events, limits.maxEvents);
  }
}

function countTrackEvents(
  bytes: Uint8Array,
  start: number,
  end: number,
  initialEvents: number,
  maxEvents: number,
): number {
  let cursor = start;
  let runningStatus = 0;
  let events = initialEvents;
  while (cursor < end) {
    cursor = skipVlq(bytes, cursor, end); // delta time
    if (cursor >= end) return events;

    let status = bytes[cursor];
    if (status < 0x80) {
      if (runningStatus === 0) return events; // malformed; defer the detailed error to @tonejs/midi
      status = runningStatus;
    } else {
      cursor += 1;
      runningStatus = status < 0xf0 ? status : 0;
    }

    events += 1;
    if (events > maxEvents) {
      throw new MIDIParseLimitError(
        `MIDI resource limit exceeded: more than ${maxEvents.toLocaleString()} events`,
      );
    }

    if (status === 0xff) {
      if (cursor >= end) return events;
      cursor += 1; // meta type
      const length = readVlq(bytes, cursor, end);
      cursor = Math.min(end, length.next + length.value);
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      const length = readVlq(bytes, cursor, end);
      cursor = Math.min(end, length.next + length.value);
      continue;
    }

    const high = status & 0xf0;
    const dataBytes = high === 0xc0 || high === 0xd0 ? 1 : high >= 0x80 && high <= 0xe0 ? 2 : systemDataBytes(status);
    if (dataBytes < 0) return events;
    cursor = Math.min(end, cursor + dataBytes);
  }
  return events;
}

function skipVlq(bytes: Uint8Array, cursor: number, end: number): number {
  return readVlq(bytes, cursor, end).next;
}

function readVlq(bytes: Uint8Array, cursor: number, end: number): {value: number; next: number} {
  let value = 0;
  for (let count = 0; cursor < end && count < 4; count += 1) {
    const byte = bytes[cursor++];
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return {value, next: cursor};
}

function systemDataBytes(status: number): number {
  if (status === 0xf1 || status === 0xf3) return 1;
  if (status === 0xf2) return 2;
  if (status === 0xf6 || status >= 0xf8) return 0;
  return -1;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

function ascii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * Serialize a Score back to SMF. Uses each note's performed timing when
 * available, otherwise derives ticks from the notated quarters via PPQ.
 */
export function serializeMIDI(score: Score, opts: {ppq?: number} = {}): Uint8Array {
  const ppq = opts.ppq ?? DEFAULT_PPQ;
  if (!Number.isInteger(ppq) || ppq < 1 || ppq > 0x7fff) {
    throw new RangeError('MIDI PPQ must be an integer between 1 and 32767');
  }
  const midi = new Midi();
  const performedSecondsToQuarters = createPerformedSecondsProjector(score);
  midi.header.fromJSON({
    ...midi.header.toJSON(),
    ppq,
    tempos: score.timeMap.tempi.map((t) => ({
      ticks: Math.round(t.atQuarters.toFloat() * ppq),
      bpm: t.bpm * (t.unit ?? 1),
    })),
    timeSignatures: score.timeMap.meters.map((m) => ({
      ticks: Math.round(m.atQuarters.toFloat() * ppq),
      timeSignature: [m.timeSignature.numerator, m.timeSignature.denominator],
    })),
    keySignatures: [],
  });

  for (const part of score.parts) {
    const track = midi.addTrack();
    track.name = part.name ?? part.id;
    if (part.midiChannel != null) track.channel = part.midiChannel;
    if (part.midiProgram != null) track.instrument.number = part.midiProgram;

    for (const event of mergedTiedNotes(part)) {
      const note = event.first;
      if (note.grace) continue; // no inferred steal time for notation-only grace notes
      // MIDI sources can carry a performed-time overlay that deliberately
      // differs from their notated position (human timing, swing, recording
      // capture). Convert that clock time through this score's tempo map so
      // the emitted SMF preserves the performed event rather than silently
      // snapping it back to notation. Project directly at the requested PPQ:
      // TimeMap.secondsToQuarters() is a legacy 480-PPQ compatibility inverse
      // and would otherwise erase sub-480 timing before this final rounding.
      const ticks = note.performed
        ? Math.round(performedSecondsToQuarters(note.performed.onsetSec) * ppq)
        : Math.round(note.onsetQuarters.toFloat() * ppq);
      let endTicks = ticks;
      for (const member of event.notes) {
        const memberEnd = member.performed
          ? performedSecondsToQuarters(member.performed.onsetSec + member.performed.durationSec)
          : member.offsetQuarters.toFloat();
        endTicks = Math.max(endTicks, Math.round(memberEnd * ppq));
      }
      const durationTicks = Math.max(1, endTicks - ticks);
      const midiPitch = soundingPitch(note, part).midi;
      if (!Number.isInteger(midiPitch) || midiPitch < 0 || midiPitch > 127) {
        throw new RangeError(`MIDI sounding pitch must be an integer between 0 and 127 (got ${midiPitch})`);
      }
      track.addNote({
        midi: midiPitch,
        ticks,
        durationTicks,
        velocity: Math.max(0, Math.min(1, noteVelocity(note) / 127)),
      });
    }
  }

  return midi.toArray();
}

/**
 * Build an O(log tempo-events) inverse for performed seconds. Unlike the
 * public legacy TimeMap inverse, this keeps float quarter precision until the
 * final target-PPQ tick rounding in serializeMIDI().
 */
function createPerformedSecondsProjector(score: Score): (seconds: number) => number {
  const segments = score.timeMap.tempi.map((tempo) => ({
    seconds: score.timeMap.quartersToSeconds(tempo.atQuarters),
    quarters: tempo.atQuarters.toFloat(),
    secondsPerQuarter: 60 / (tempo.bpm * (tempo.unit ?? 1)),
  }));

  return (seconds: number): number => {
    if (!(seconds > 0)) return 0;
    let low = 0;
    let high = segments.length - 1;
    let index = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (segments[mid].seconds <= seconds) {
        index = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const segment = segments[index];
    return segment.quarters + (seconds - segment.seconds) / segment.secondsPerQuarter;
  };
}
