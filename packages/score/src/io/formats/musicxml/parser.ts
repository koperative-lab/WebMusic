import {
  Duration,
  MeasureId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  type Alter,
  type Articulation,
  type BarlineStyle,
  type BeamMark,
  type Clef,
  type GraceNote,
  type KeySignature,
  type PartDirection,
  type Score,
  type SlurMark,
  type Step,
  type StemDirection,
  type Transpose,
  type TupletMark,
} from '../../../core';
import type { ScoreDiagnostic, ScoreParseResult } from '../../diagnostics';
import { walkMusicXmlMeasure, type MusicXmlNoteEvent } from './measure-walker';
import {
  attrsOf,
  childList,
  childOf,
  childText,
  childrenOf,
  parseOrderedXml,
  requireNumber,
  tagOf,
  textOf,
  type OrderedXmlNode,
  type OrderedXmlParseOptions,
} from './ordered-tree';

export type MusicXMLParseOptions = OrderedXmlParseOptions;

/**
 * Parse score-partwise MusicXML into a Score and recoverable diagnostics.
 * This is the explicit boundary for callers that need to inspect information
 * the normalised Score model could not represent.
 */
export function parseMusicXMLDetailed(xml: string, options: MusicXMLParseOptions = {}): ScoreParseResult {
  const document = parseOrderedXml(xml, options);
  if (document.some((node) => tagOf(node) === 'score-timewise')) {
    throw new Error('score-timewise MusicXML documents are not supported — ' + 'convert to score-partwise first.');
  }
  const root = document.find((node) => tagOf(node) === 'score-partwise');
  if (!root) {
    throw new Error('Unsupported MusicXML document: expected score-partwise');
  }

  const diagnostics = new MusicXmlDiagnosticCollector();
  const builder = new ScoreBuilder();
  builder.setMetadata({ title: textOf(childOf(root, 'movement-title')) });
  const partInfo = collectPartInfo(root);
  const parts = childList(root, 'part');
  const partIds = parts.map((part, index) => {
    const id = PartId(String(attrsOf(part).id ?? `P${index + 1}`));
    const info = partInfo.get(String(id));
    builder.addPart({
      id,
      name: info?.name ?? id,
      abbreviation: info?.abbreviation,
      staves: detectPartStaves(part),
      transpose: detectPartTranspose(part),
      clefChanges: [],
      directions: [],
    });
    return id;
  });

  const masterGrid = parseMasterTimeline(parts[0], builder, diagnostics);
  parts.forEach((part, index) => {
    parsePartNotes(part, partIds[index], masterGrid, builder, diagnostics);
  });

  return { score: builder.build(), diagnostics: diagnostics.toArray() };
}

/** Parse a score-partwise MusicXML document into the immutable Score model. */
export function parseMusicXML(xml: string, options: MusicXMLParseOptions = {}): Score {
  return parseMusicXMLDetailed(xml, options).score;
}

/** One authoritative measure position from the first (master) MusicXML part. */
interface MasterMeasure {
  readonly number: number;
  readonly onsetQuarters: Rational;
  readonly durationQuarters: Rational;
}

/** Use the first part as the authoritative measure, meter and tempo timeline. */
function parseMasterTimeline(
  masterPart: OrderedXmlNode | undefined,
  builder: ScoreBuilder,
  diagnostics: MusicXmlDiagnosticCollector,
): readonly MasterMeasure[] {
  const tempoEntries: Array<{
    atQuarters: Rational;
    bpm: number;
    declarationOrder: number;
  }> = [];
  let nextTempoDeclarationOrder = 0;
  const meterEntries: Array<{
    atQuarters: Rational;
    measureNumber: number;
    timeSignature: { numerator: number; denominator: number };
    declarationOrder: number;
  }> = [];
  let nextMeterDeclarationOrder = 0;
  const masterGrid: MasterMeasure[] = [];
  const state = { divisions: 1 };
  let cumulativeQuarters = Rational.ZERO;
  let measureNumber = 0;

  for (const measure of masterPart ? childList(masterPart, 'measure') : []) {
    measureNumber += 1;
    let timeSignature: { numerator: number; denominator: number } | undefined;
    let keySignature: KeySignature | undefined;
    let measureClefs: Map<number, Clef> | undefined;

    const durationQuarters = walkMusicXmlMeasure(measure, state, (event) => {
      if (event.kind === 'tempo') {
        tempoEntries.push({
          atQuarters: cumulativeQuarters.add(event.atQuarters),
          bpm: event.bpm,
          declarationOrder: nextTempoDeclarationOrder++,
        });
        return;
      }
      if (event.kind !== 'attributes') return;
      const atMeasureBoundary = event.atQuarters.eq(Rational.ZERO);
      const time = parseTimeSignature(event.node);
      if (time) {
        if (atMeasureBoundary) {
          meterEntries.push({
            atQuarters: cumulativeQuarters,
            measureNumber,
            timeSignature: time,
            declarationOrder: nextMeterDeclarationOrder++,
          });
          // The Score Measure model represents declarations at its start;
          // retain the final same-position declaration, matching TimeMap.
          timeSignature = time;
        } else {
          diagnostics.warnMidMeasureAttribute('time', measureNumber, event.atQuarters);
        }
      }
      const key = parseKeySignature(event.node);
      if (key) {
        if (atMeasureBoundary) {
          keySignature = key;
        } else {
          diagnostics.warnMidMeasureAttribute('key', measureNumber, event.atQuarters);
        }
      }
      for (const clefNode of childList(event.node, 'clef')) {
        const clef = parseClef(clefNode);
        if (!clef) continue;
        if (!atMeasureBoundary) {
          // The per-part clef stream below retains the exact position. The
          // compatibility Measure field represents only boundary declarations.
          continue;
        }
        const staff = Number(attrsOf(clefNode).number ?? 1);
        if (!measureClefs) measureClefs = new Map();
        measureClefs.set(Number.isFinite(staff) ? staff : 1, clef);
      }
    });

    const clefList = measureClefs ? ([...measureClefs.entries()] as Array<[number, Clef]>) : [];
    const barlines = childList(measure, 'barline');
    const barlineStart = barlines.find((barline) => attrsOf(barline).location === 'left');
    const barlineEnd = barlines.find((barline) => (attrsOf(barline).location ?? 'right') === 'right');
    builder.addMeasure({
      id: MeasureId(`m${measureNumber}`),
      number: measureNumber,
      onsetQuarters: cumulativeQuarters,
      durationQuarters,
      timeSignature,
      keySignature,
      barlineStart: barlineStart ? childText(barlineStart, 'bar-style') as BarlineStyle | undefined : undefined,
      barlineEnd: barlineEnd ? childText(barlineEnd, 'bar-style') as BarlineStyle | undefined : undefined,
      clef: clefList.length === 1 && clefList[0][0] === 1 ? clefList[0][1] : undefined,
      clefs:
        clefList.length > 1 || (clefList.length === 1 && clefList[0][0] !== 1)
          ? Object.fromEntries(clefList)
          : undefined,
    });
    masterGrid.push({
      number: measureNumber,
      onsetQuarters: cumulativeQuarters,
      durationQuarters,
    });
    cumulativeQuarters = cumulativeQuarters.add(durationQuarters);
  }

  tempoEntries.sort(
    (left, right) => left.atQuarters.cmp(right.atQuarters) || left.declarationOrder - right.declarationOrder,
  );
  if (tempoEntries.length > 0 && !tempoEntries[0].atQuarters.eq(Rational.ZERO)) {
    tempoEntries.unshift({
      atQuarters: Rational.ZERO,
      // MusicXML, like SMF, does not let a later declaration retroactively
      // change the opening tempo. Keep Core's documented default before it.
      bpm: 120,
      declarationOrder: -1,
    });
  }
  let previousTempoPosition: Rational | undefined;
  for (const entry of tempoEntries) {
    if (previousTempoPosition?.eq(entry.atQuarters)) {
      diagnostics.warnSamePositionTempo(entry.atQuarters);
    }
    builder.addTempo({ atQuarters: entry.atQuarters, bpm: entry.bpm });
    previousTempoPosition = entry.atQuarters;
  }

  meterEntries.sort(
    (left, right) => left.atQuarters.cmp(right.atQuarters) || left.declarationOrder - right.declarationOrder,
  );
  for (const entry of meterEntries) {
    builder.addMeter({
      atQuarters: entry.atQuarters,
      measureNumber: entry.measureNumber,
      timeSignature: entry.timeSignature,
    });
  }

  return Object.freeze(masterGrid);
}

function parsePartNotes(
  part: OrderedXmlNode,
  partId: PartId,
  masterGrid: readonly MasterMeasure[],
  builder: ScoreBuilder,
  diagnostics: MusicXmlDiagnosticCollector,
): void {
  const state = { divisions: 1 };
  const measures = childList(part, 'measure');
  const tupletGroups = new MusicXmlTupletGroups(String(partId));
  let unmatchedMeasureStart =
    masterGrid.length > 0
      ? masterGrid[masterGrid.length - 1].onsetQuarters.add(masterGrid[masterGrid.length - 1].durationQuarters)
      : Rational.ZERO;
  for (const [measureIndex, measure] of measures.entries()) {
    const measureNumber = measureDiagnosticNumber(measure, measureIndex + 1);
    const masterMeasure = masterGrid[measureIndex];
    const measureStartQuarters = masterMeasure?.onsetQuarters ?? unmatchedMeasureStart;
    const measureQuarters = walkMusicXmlMeasure(measure, state, (event) => {
      if (event.kind === 'attributes') {
        for (const node of childList(event.node, 'clef')) {
          const clef = parseClef(node);
          if (clef) builder.addClefChange(partId, {
            onsetQuarters: measureStartQuarters.add(event.atQuarters),
            staff: requireNumber(attrsOf(node).number ?? 1, '<clef number>'), clef,
          });
        }
        return;
      }
      if (event.kind === 'direction') {
        for (const direction of parseDirections(event.node, measureStartQuarters.add(event.atQuarters), () =>
          diagnostics.warnUnsupportedDirection(String(partId), measureNumber))) builder.addDirection(partId, direction);
        return;
      }
      if (event.kind !== 'note') return;
      const staffText = childText(event.node, 'staff');
      const tupletMarks = parseTupletMarks(event.node);
      const common = {
        id: builder.newNoteId(),
        onsetQuarters: measureStartQuarters.add(event.onsetQuarters),
        duration: noteDuration(event, childList(event.node, 'dot').length, () =>
          diagnostics.warnDurationMismatch(String(partId), measureNumber)),
        voice: VoiceId(`${partId}-${event.voiceLabel}`),
        staff: staffText == null ? undefined : requireNumber(staffText, '<staff>'),
        tupletId: tupletGroups.noteGroup(event, tupletMarks),
        tupletMarks,
        beams: parseBeams(event.node),
        stem: parseStem(event.node),
        printObject: attrsOf(event.node)['print-object'] === 'no' ? false :
          attrsOf(event.node)['print-object'] === 'yes' ? true : undefined,
        slur: parseSlurs(event.node),
        articulations: parseArticulations(event.node),
      };
      if (event.isRest) {
        const rest = childOf(event.node, 'rest')!;
        const step = childText(rest, 'display-step');
        const octave = childText(rest, 'display-octave');
        builder.addNote(partId, { ...common, rest: true,
          restDisplay: step != null && octave != null ? {step: step as Step, octave: requireNumber(octave, '<rest><display-octave>')} : undefined,
        });
        return;
      }
      const pitch = parseNotePitch(event.node);
      if (!pitch) {
        diagnostics.warnMissingPitch(String(partId), measureNumber);
        return;
      }
      builder.addNote(partId, {
        ...common,
        pitch: pitch.pitch,
        unpitched: pitch.unpitched || undefined,
        grace: event.isGrace ? parseGrace(event.node) : undefined,
        chord: event.isChord,
        tie: parseTie(childList(event.node, 'tie')),
        tiePlacement: parseTiePlacement(event.node),
      });
    });
    if (masterMeasure) {
      if (!measureQuarters.eq(masterMeasure.durationQuarters)) {
        diagnostics.warnPartMeasureDurationMismatch(
          String(partId),
          measureNumber,
          measureQuarters,
          masterMeasure.durationQuarters,
        );
      }
    } else {
      diagnostics.warnPartMeasureOutsideMasterGrid(String(partId), measureNumber);
      unmatchedMeasureStart = unmatchedMeasureStart.add(measureQuarters);
    }
  }
  if (masterGrid.length > measures.length) {
    diagnostics.warnPartMeasureCountMismatch(String(partId), measures.length, masterGrid.length);
  }
}

function measureDiagnosticNumber(measure: OrderedXmlNode, fallback: number): number {
  const parsed = Number(attrsOf(measure).number);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

/**
 * Bound and aggregate diagnostics so malformed input cannot allocate one
 * warning per note. Entries aggregate by family and part; the first measure
 * is retained as a useful location hint.
 */
class MusicXmlDiagnosticCollector {
  private static readonly maximumEntries = 100;
  private readonly entries = new Map<
    string,
    {
      diagnostic: ScoreDiagnostic;
      occurrences: number;
    }
  >();
  private omitted = 0;

  warnUnsupportedDirection(partId: string, measureNumber: number): void {
    const code = 'musicxml-direction-unsupported';
    this.add(code, 'A direction outside the supported text, dynamics, metronome, pedal and wedge subset was not retained',
      {partId, measureNumber}, `${code}\u0000${partId}`);
  }

  warnDurationMismatch(partId: string, measureNumber: number): void {
    const code = 'musicxml-notation-duration-mismatch';
    this.add(code,
      `Notated type, dots and time-modification disagree with <duration> in part ${partId}; ` +
      'the encoded musical timing is retained with a compatible duration base',
      {partId, measureNumber}, `${code}\u0000${partId}`);
  }

  warnMissingPitch(partId: string, measureNumber: number): void {
    const code = 'musicxml-note-without-pitch';
    const key = `${code}\u0000${partId}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.occurrences += 1;
      return;
    }
    if (this.entries.size >= MusicXmlDiagnosticCollector.maximumEntries) {
      this.omitted += 1;
      return;
    }
    this.entries.set(key, {
      diagnostic: {
        code,
        severity: 'warning',
        format: 'musicxml',
        message: `Skipped a note without <pitch> or <unpitched> in part ${partId}`,
        location: { partId, measureNumber },
      },
      occurrences: 1,
    });
  }

  /** Report the documented last-declaration-wins policy for one tempo position. */
  warnSamePositionTempo(atQuarters: Rational): void {
    const code = 'musicxml-tempo-same-position-normalized';
    const key = `${code}\u0000${atQuarters.toString()}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.occurrences += 1;
      return;
    }
    if (this.entries.size >= MusicXmlDiagnosticCollector.maximumEntries) {
      this.omitted += 1;
      return;
    }
    this.entries.set(key, {
      diagnostic: {
        code,
        severity: 'warning',
        format: 'musicxml',
        message: `Multiple tempo declarations occur at quarter ${atQuarters}; ` + 'the final declaration is retained',
      },
      occurrences: 1,
    });
  }

  /**
   * A real Measure grid owns MBS coordinates. Moving a time-signature event
   * into its middle would make q → MBS → q non-invertible, so every
   * mid-measure attribute is deliberately reported rather than relocated.
   */
  warnMidMeasureAttribute(attribute: 'time' | 'key' | 'clef', measureNumber: number, atQuarters: Rational): void {
    const messages = {
      time:
        `A <time> declaration occurs ${atQuarters} quarters into measure ${measureNumber}; ` +
        'it is not added to the TimeMap because the Score measure grid cannot represent a partial-bar meter change without breaking MBS round-trips',
      key:
        `A <key> declaration occurs ${atQuarters} quarters into measure ${measureNumber}; ` +
        'the Score model only stores key signatures at measure boundaries, so it was not moved',
      clef:
        `A <clef> declaration occurs ${atQuarters} quarters into measure ${measureNumber}; ` +
        'the Score model only stores clefs at measure boundaries, so it was not moved',
    } as const;
    const code = `musicxml-mid-measure-${attribute}-ignored`;
    this.add(code, messages[attribute], { measureNumber }, `${code}\u0000${measureNumber}\u0000${atQuarters}`);
  }

  warnPartMeasureDurationMismatch(
    partId: string,
    measureNumber: number,
    partDuration: Rational,
    masterDuration: Rational,
  ): void {
    const code = 'musicxml-part-measure-duration-mismatch';
    this.add(
      code,
      `Part ${partId} measure ${measureNumber} encodes ${partDuration} quarters, ` +
        `but the master measure encodes ${masterDuration}; note positions use the master start`,
      { partId, measureNumber },
      `${code}\u0000${partId}\u0000${measureNumber}`,
    );
  }

  warnPartMeasureOutsideMasterGrid(partId: string, measureNumber: number): void {
    const code = 'musicxml-part-measure-outside-master-grid';
    this.add(
      code,
      `Part ${partId} contains measure ${measureNumber} beyond the authoritative master grid; ` +
        'it is placed after the final master measure',
      { partId, measureNumber },
      `${code}\u0000${partId}`,
    );
  }

  warnPartMeasureCountMismatch(partId: string, partCount: number, masterCount: number): void {
    const code = 'musicxml-part-measure-count-mismatch';
    this.add(
      code,
      `Part ${partId} contains ${partCount} measures while the master grid contains ${masterCount}; ` +
        'missing measures retain the master timeline without synthesized notes',
      { partId },
      `${code}\u0000${partId}`,
    );
  }

  private add(code: string, message: string, location: ScoreDiagnostic['location'], key: string): void {
    const existing = this.entries.get(key);
    if (existing) {
      existing.occurrences += 1;
      return;
    }
    if (this.entries.size >= MusicXmlDiagnosticCollector.maximumEntries) {
      this.omitted += 1;
      return;
    }
    this.entries.set(key, {
      diagnostic: {
        code,
        severity: 'warning',
        format: 'musicxml',
        message,
        location,
      },
      occurrences: 1,
    });
  }

  toArray(): readonly ScoreDiagnostic[] {
    const diagnostics = [...this.entries.values()].map(({ diagnostic, occurrences }) =>
      occurrences === 1
        ? diagnostic
        : {
            ...diagnostic,
            message: `${diagnostic.message} (${occurrences} occurrences; first location shown)`,
          },
    );
    if (this.omitted > 0) {
      diagnostics.push({
        code: 'diagnostics-truncated',
        severity: 'warning',
        format: 'musicxml',
        message:
          `Suppressed ${this.omitted} additional diagnostic famil${this.omitted === 1 ? 'y' : 'ies'} ` +
          `(maximum ${MusicXmlDiagnosticCollector.maximumEntries})`,
      });
    }
    return Object.freeze(diagnostics);
  }
}

function parseTimeSignature(attributes: OrderedXmlNode): { numerator: number; denominator: number } | undefined {
  const time = childOf(attributes, 'time');
  if (!time) return undefined;
  return {
    numerator: requireNumber(childText(time, 'beats') ?? 4, '<time><beats>'),
    denominator: requireNumber(childText(time, 'beat-type') ?? 4, '<time><beat-type>'),
  };
}

function parseKeySignature(attributes: OrderedXmlNode): KeySignature | undefined {
  const key = childOf(attributes, 'key');
  if (!key) return undefined;
  return {
    fifths: requireNumber(childText(key, 'fifths') ?? 0, '<key><fifths>'),
    mode: childText(key, 'mode') as KeySignature['mode'],
  } as KeySignature;
}

const DURATION_BASES: Readonly<Record<string, readonly [number, number]>> = {
  maxima: [32, 1], long: [16, 1], breve: [8, 1], whole: [4, 1], half: [2, 1], quarter: [1, 1],
  eighth: [1, 2], '16th': [1, 4], '32nd': [1, 8], '64th': [1, 16], '128th': [1, 32],
  '256th': [1, 64], '512th': [1, 128], '1024th': [1, 256],
};

function noteDuration(event: MusicXmlNoteEvent, dots: number, mismatch: () => void): Duration {
  if (event.isGrace || event.durationQuarters.eq(Rational.ZERO)) {
    return new Duration({ base: Rational.ZERO });
  }
  const modification = childOf(event.node, 'time-modification');
  const tuplet = modification ? [
    requireNumber(childText(modification, 'actual-notes'), '<time-modification><actual-notes>'),
    requireNumber(childText(modification, 'normal-notes'), '<time-modification><normal-notes>'),
  ] as const : [1, 1] as const;
  const writtenBase = DURATION_BASES[childText(event.node, 'type') ?? ''];
  if (writtenBase) {
    const written = new Duration({base: writtenBase, dots, tuplet});
    if (written.quarters.eq(event.durationQuarters)) return written;
    mismatch();
  }
  const numerator = Math.pow(2, dots);
  const denominator = Math.pow(2, dots + 1) - 1;
  const base = event.durationQuarters.mul(new Rational(numerator, denominator)).mul(new Rational(tuplet[0], tuplet[1]));
  return new Duration({ base, dots, tuplet });
}

function parseBeams(node: OrderedXmlNode): BeamMark[] | undefined {
  const beams = childList(node, 'beam').map((beam) => ({
    number: requireNumber(attrsOf(beam).number ?? 1, '<beam number>'),
    type: textOf(beam) as BeamMark['type'],
  }));
  return beams.length > 0 ? beams : undefined;
}

function parseStem(node: OrderedXmlNode): StemDirection | undefined {
  return childText(node, 'stem') as StemDirection | undefined;
}

function notationChildren(node: OrderedXmlNode, tag: string): OrderedXmlNode[] {
  return childList(node, 'notations').flatMap((notations) => childList(notations, tag));
}

function parseTupletMarks(node: OrderedXmlNode): TupletMark[] | undefined {
  const marks = notationChildren(node, 'tuplet').map((tuplet) => {
    const attrs = attrsOf(tuplet);
    return {
      type: attrs.type as TupletMark['type'],
      ...(attrs.number != null ? {number: requireNumber(attrs.number, '<tuplet number>')} : {}),
      ...(attrs.bracket != null ? {bracket: attrs.bracket === 'yes'} : {}),
      ...(attrs.placement != null ? {placement: attrs.placement as TupletMark['placement']} : {}),
      ...(attrs['show-number'] != null ? {showNumber: attrs['show-number'] as TupletMark['showNumber']} : {}),
    };
  });
  return marks.length > 0 ? marks : undefined;
}

function parseSlurs(node: OrderedXmlNode): SlurMark[] | undefined {
  const marks = notationChildren(node, 'slur').map((slur) => {
    const attrs = attrsOf(slur);
    return {
      type: attrs.type as SlurMark['type'],
      ...(attrs.number != null ? {number: requireNumber(attrs.number, '<slur number>')} : {}),
      ...(attrs.placement != null ? {placement: attrs.placement as SlurMark['placement']} : {}),
    };
  });
  return marks.length > 0 ? marks : undefined;
}

function parseArticulations(node: OrderedXmlNode): Articulation[] | undefined {
  const supported: Record<string, Articulation> = {staccato: 'staccato', accent: 'accent', tenuto: 'tenuto', 'strong-accent': 'marcato', staccatissimo: 'staccatissimo'};
  const marks = notationChildren(node, 'articulations').flatMap((group) => childrenOf(group).flatMap((mark) => {
    const value = supported[tagOf(mark) ?? ''];
    return value ? [value] : [];
  }));
  return marks.length ? marks : undefined;
}

function parseTiePlacement(node: OrderedXmlNode): 'above' | 'below' | undefined {
  const attrs = notationChildren(node, 'tied').map(attrsOf).find((attrs) => attrs.placement != null || attrs.orientation != null);
  if (attrs?.placement === 'above' || attrs?.placement === 'below') return attrs.placement;
  return attrs?.orientation === 'over' ? 'above' : attrs?.orientation === 'under' ? 'below' : undefined;
}

function parseDirections(node: OrderedXmlNode, onsetQuarters: Rational, unsupported: () => void): PartDirection[] {
  const result: PartDirection[] = [];
  const parent = attrsOf(node);
  const staff = childText(node, 'staff');
  for (const directionType of childList(node, 'direction-type')) for (const child of childrenOf(directionType)) {
    const kind = tagOf(child);
    if (!kind) continue;
    const attrs = {...parent, ...attrsOf(child)};
    const common = {
      onsetQuarters,
      ...(staff != null ? {staff: requireNumber(staff, '<direction><staff>')} : {}),
      ...(attrs.placement ? {placement: attrs.placement as 'above' | 'below'} : {}),
      ...(attrs['print-object'] != null ? {printObject: attrs['print-object'] !== 'no'} : {}),
      ...Object.fromEntries(['default-x', 'default-y', 'relative-x', 'relative-y'].flatMap((key) =>
        attrs[key] == null ? [] : [[key.replace(/-([xy])/g, (_, letter: string) => letter.toUpperCase()), requireNumber(attrs[key], `<${kind} ${key}>`)]])),
    };
    if (kind === 'words' || kind === 'rehearsal') {
      const size = attrs['font-size'] == null ? undefined : Number(attrs['font-size']);
      result.push({...common, kind, text: textOf(child) ?? '',
        ...(attrs['font-style'] ? {fontStyle: attrs['font-style'] as 'normal' | 'italic'} : {}),
        ...(attrs['font-weight'] ? {fontWeight: attrs['font-weight'] as 'normal' | 'bold'} : {}),
        ...(Number.isFinite(size) ? {fontSize: size} : {}),
      });
    } else if (kind === 'dynamics') {
      result.push({...common, kind, values: childrenOf(child).flatMap((mark) => {
        const tag = tagOf(mark);
        return tag ? [tag === 'other-dynamics' ? textOf(mark) ?? '' : tag] : [];
      })});
    } else if (kind === 'pedal') {
      result.push({...common, kind, type: attrs.type as Extract<PartDirection, {kind: 'pedal'}>['type'],
        ...(attrs.number != null ? {number: requireNumber(attrs.number, '<pedal number>')} : {}),
        ...(attrs.line != null ? {line: attrs.line === 'yes'} : {}),
        ...(attrs.sign != null ? {sign: attrs.sign === 'yes'} : {}),
      });
    } else if (kind === 'wedge') {
      result.push({...common, kind, type: attrs.type as Extract<PartDirection, {kind: 'wedge'}>['type'],
        ...(attrs.number != null ? {number: requireNumber(attrs.number, '<wedge number>')} : {}),
        ...(attrs.spread != null ? {spread: requireNumber(attrs.spread, '<wedge spread>')} : {}),
        ...(attrs.niente != null ? {niente: attrs.niente === 'yes'} : {}),
      });
    } else if (kind === 'metronome') {
      const base = DURATION_BASES[childText(child, 'beat-unit') ?? ''];
      const perMinute = Number(childText(child, 'per-minute'));
      if (!base || !Number.isFinite(perMinute) || perMinute <= 0) { unsupported(); continue; }
      result.push({...common, kind, beatUnit: new Duration({base, dots: childList(child, 'beat-unit-dot').length}), perMinute,
        ...(attrs.parentheses != null ? {parentheses: attrs.parentheses === 'yes'} : {}),
      });
    } else unsupported();
  }
  return result;
}

/** Tuplet numbers repeat; pair endpoints independently in each source voice. */
class MusicXmlTupletGroups {
  private readonly voices = new Map<string, Map<number, string>>();
  private readonly chordGroups = new Map<string, {onset: Rational; group?: string}>();
  private nextGroup = 0;

  constructor(private readonly partId: string) {}

  noteGroup(event: MusicXmlNoteEvent, marks: readonly TupletMark[] | undefined): string | undefined {
    let active = this.voices.get(event.voiceLabel);
    if (!active) this.voices.set(event.voiceLabel, active = new Map());
    for (const mark of marks ?? []) if (mark.type === 'start') {
      active.set(mark.number ?? 1, `${this.partId}:${event.voiceLabel}:tuplet-${++this.nextGroup}`);
    }
    const previous = this.chordGroups.get(event.voiceLabel);
    const groups = [...active.values()];
    const group = event.isChord && previous?.onset.eq(event.onsetQuarters)
      ? previous.group
      : groups[groups.length - 1];
    for (const mark of marks ?? []) if (mark.type === 'stop') active.delete(mark.number ?? 1);
    if (!event.isChord) this.chordGroups.set(event.voiceLabel, {onset: event.onsetQuarters, group});
    return group;
  }
}

function parseNotePitch(node: OrderedXmlNode): { pitch: Pitch; unpitched: boolean } | undefined {
  const pitched = childOf(node, 'pitch');
  if (pitched) {
    const alter = childText(pitched, 'alter');
    return {
      pitch: new Pitch(
        childText(pitched, 'step') as Step,
        (alter == null ? 0 : requireNumber(alter, '<pitch><alter>')) as Alter,
        requireNumber(childText(pitched, 'octave'), '<pitch><octave>'),
      ),
      unpitched: false,
    };
  }
  const unpitched = childOf(node, 'unpitched');
  if (!unpitched) return undefined;
  const step = (childText(unpitched, 'display-step') ?? 'C') as Step;
  const octaveText = childText(unpitched, 'display-octave');
  const octave = octaveText == null ? 4 : requireNumber(octaveText, '<unpitched><display-octave>');
  return { pitch: new Pitch(step, 0 as Alter, octave), unpitched: true };
}

function parseTie(ties: OrderedXmlNode[]): 'start' | 'stop' | 'continue' | undefined {
  const hasStart = ties.some((tie) => attrsOf(tie).type === 'start');
  const hasStop = ties.some((tie) => attrsOf(tie).type === 'stop');
  if (hasStart && hasStop) return 'continue';
  if (hasStart) return 'start';
  if (hasStop) return 'stop';
  return undefined;
}

function parseClef(node: OrderedXmlNode): Clef | undefined {
  const sign = childText(node, 'sign');
  if (!sign) return undefined;
  const clef: Clef = { sign: sign as Clef['sign'] };
  const line = childText(node, 'line');
  if (line != null) clef.line = requireNumber(line, '<clef><line>');
  const octave = childText(node, 'clef-octave-change');
  if (octave != null) {
    const change = requireNumber(octave, '<clef><clef-octave-change>');
    if (change !== 0) clef.octaveChange = change;
  }
  return clef;
}

function parseGrace(node: OrderedXmlNode): GraceNote | true {
  const grace = childOf(node, 'grace');
  return grace && attrsOf(grace).slash === 'yes' ? { slash: true } : true;
}

function detectPartTranspose(part: OrderedXmlNode): Transpose | undefined {
  for (const measure of childList(part, 'measure')) {
    for (const attributes of childList(measure, 'attributes')) {
      const node = childOf(attributes, 'transpose');
      if (!node) continue;
      const transpose: Transpose = {
        chromatic: requireNumber(childText(node, 'chromatic') ?? 0, '<transpose><chromatic>'),
      };
      const diatonic = childText(node, 'diatonic');
      if (diatonic != null) {
        transpose.diatonic = requireNumber(diatonic, '<transpose><diatonic>');
      }
      const octave = childText(node, 'octave-change');
      if (octave != null) {
        const change = requireNumber(octave, '<transpose><octave-change>');
        if (change !== 0) transpose.octaveChange = change;
      }
      return transpose;
    }
  }
  return undefined;
}

function collectPartInfo(root: OrderedXmlNode): Map<string, { name?: string; abbreviation?: string }> {
  const partList = childOf(root, 'part-list');
  const entries = partList ? childList(partList, 'score-part') : [];
  return new Map(
    entries.map((entry) => [
      String(attrsOf(entry).id),
      {
        name: childText(entry, 'part-name'),
        abbreviation: childText(entry, 'part-abbreviation'),
      },
    ]),
  );
}

function detectPartStaves(part: OrderedXmlNode): number | undefined {
  let maximumStaff = 0;
  for (const measure of childList(part, 'measure')) {
    for (const attributes of childList(measure, 'attributes')) {
      const declared = Number(childText(attributes, 'staves') ?? 0);
      if (Number.isFinite(declared)) maximumStaff = Math.max(maximumStaff, declared);
    }
    for (const note of childList(measure, 'note')) {
      const staff = Number(childText(note, 'staff') ?? 0);
      if (Number.isFinite(staff)) maximumStaff = Math.max(maximumStaff, staff);
    }
  }
  return maximumStaff > 1 ? maximumStaff : undefined;
}
