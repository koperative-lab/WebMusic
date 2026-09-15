import {XMLBuilder} from 'fast-xml-parser';
import {
  DEFAULT_PPQ,
  Duration,
  Rational,
  noteDurationTicks,
  noteMidi,
  scoreKeySignatures,
  scoreTempos,
  scoreTimeSignatures,
  scoreTitle,
  type Clef,
  type BarlineStyle,
  type Note,
  type Part,
  type PartDirection,
  type PartClefChange,
  type Score,
  type TupletMark,
} from '../../../core';

const DURATION_TYPES: Record<string, number> = {
  maxima: 32,
  long: 16,
  breve: 8,
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125,
  '64th': 0.0625,
  '128th': 0.03125,
  '256th': 0.015625,
  '512th': 0.0078125,
  '1024th': 0.00390625,
};

type XmlBuildNode = Record<string, unknown>;

interface SerializeContext {
  ppq: number;
  keySignatures: ReturnType<typeof scoreKeySignatures>;
  timeSignatures: ReturnType<typeof scoreTimeSignatures>;
  tempi: ReturnType<typeof scoreTempos>;
  tupletMarks: ReadonlyMap<Note, readonly TupletMark[]>;
}

interface GridMeasure {
  number: number;
  onsetQuarters: Rational;
  offsetQuarters: Rational;
  clef?: Clef;
  clefs?: Readonly<Record<number, Clef>>;
  barlineStart?: BarlineStyle;
  barlineEnd?: BarlineStyle;
}

/** Serialize a Score to score-partwise MusicXML 4.0. */
export function serializeMusicXML(
  score: Score,
  options: {ppq?: number} = {},
): string {
  const ppq = options.ppq ?? DEFAULT_PPQ;
  if (!Number.isSafeInteger(ppq) || ppq < 1) {
    throw new RangeError('MusicXML PPQ must be a positive safe integer');
  }
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    preserveOrder: true,
    suppressEmptyNode: true,
  });
  const context: SerializeContext = {
    ppq,
    keySignatures: scoreKeySignatures(score, ppq),
    timeSignatures: scoreTimeSignatures(score, ppq),
    tempi: scoreTempos(score, ppq),
    tupletMarks: inferredTupletMarks(score),
  };
  const grid = measureGrid(score);
  const title = scoreTitle(score);
  const document: XmlBuildNode[] = [
    {'?xml': [{'#text': ''}], ':@': {'@_version': '1.0', '@_encoding': 'UTF-8'}},
    element(
      'score-partwise',
      [
        ...(title != null ? [leaf('movement-title', title)] : []),
        element(
          'part-list',
          score.parts.map((part) => element(
            'score-part',
            [leaf('part-name', part.name)],
            {id: part.id},
          )),
        ),
        ...score.parts.map((part) => element(
          'part',
          grid.map((measure, index) => serializeMeasure(
            part,
            measure,
            index,
            grid.length,
            context,
          )),
          {id: part.id},
        )),
      ],
      {version: '4.0'},
    ),
  ];
  return builder.build(document);
}

function serializeMeasure(
  part: Part,
  measure: GridMeasure,
  index: number,
  _gridLength: number,
  context: SerializeContext,
): XmlBuildNode {
  const {ppq} = context;
  const notes = notesForMeasure(part.notes, measure);
  const content: XmlBuildNode[] = [];
  if (measure.barlineStart) content.push(element('barline', [leaf('bar-style', measure.barlineStart)], {location: 'left'}));
  const measureStartTicks = Math.round(measure.onsetQuarters.toFloat() * ppq);

  const attributes = attributesAt(part, measure, index, measureStartTicks, context);
  if (attributes.length > 0) content.push(element('attributes', attributes));
  content.push(
    ...tempoSoundsInMeasure(
      measureStartTicks,
      Math.round(measure.offsetQuarters.toFloat() * ppq),
      context,
    ),
  );
  for (const direction of part.directions ?? []) {
    if ((index === 0 || direction.onsetQuarters.gte(measure.onsetQuarters)) &&
        (direction.onsetQuarters.lt(measure.offsetQuarters) || index === _gridLength - 1)) {
      content.push(serializeDirection(direction, Math.round(direction.onsetQuarters.sub(measure.onsetQuarters).toFloat() * ppq)));
    }
  }

  const voiceGroups = new Map<string, Note[]>();
  for (const note of notes) {
    const label = voiceLabel(part.id, note);
    const group = voiceGroups.get(label);
    if (group) group.push(note);
    else voiceGroups.set(label, [note]);
  }
  const labels = [...voiceGroups.keys()].sort(compareVoiceLabels);
  const changes = (part.clefChanges ?? []).filter((change) => change.onsetQuarters.gt(measure.onsetQuarters) &&
    (change.onsetQuarters.lt(measure.offsetQuarters) || index === _gridLength - 1 && change.onsetQuarters.eq(measure.offsetQuarters)));
  const changeVoices = new Map<PartClefChange, string>();
  for (const change of changes) changeVoices.set(change,
    labels.find((label) => voiceGroups.get(label)!.some((note) => (note.staff ?? 1) === change.staff)) ?? labels[0] ?? '1');
  if (!labels.length && changes.length) { labels.push('1'); voiceGroups.set('1', []); }
  let previousEndTicks = measureStartTicks;

  labels.forEach((label, groupIndex) => {
    const voiceNotes = voiceGroups.get(label)!
      .slice()
      .sort((left, right) => left.onsetQuarters.cmp(right.onsetQuarters));
    if (groupIndex > 0 && previousEndTicks > measureStartTicks) {
      content.push(element('backup', [
        leaf('duration', previousEndTicks - measureStartTicks),
      ]));
    }
    let cursor = measureStartTicks;
    let previousOnset: number | undefined;
    let previousDuration = 0;
    let previousGrace = false;
    const ordered: Array<{at: Rational; note?: Note; change?: PartClefChange}> = [
      ...voiceNotes.map((note) => ({at: note.onsetQuarters, note})),
      ...changes.filter((change) => changeVoices.get(change) === label).map((change) => ({at: change.onsetQuarters, change})),
    ];
    ordered.sort((a, b) => a.at.cmp(b.at) || (a.change ? -1 : b.change ? 1 : 0));
    for (const entry of ordered) {
      if (entry.change) {
        const at = Math.round(entry.at.toFloat() * ppq);
        if (at !== cursor) content.push(element(at > cursor ? 'forward' : 'backup', [leaf('duration', Math.abs(at - cursor))]));
        cursor = at;
        content.push(element('attributes', [createClefNode(entry.change.clef,
          (part.staves ?? 1) > 1 || entry.change.staff !== 1 ? entry.change.staff : undefined)]));
        continue;
      }
      const note = entry.note!;
      const onsetTicks = Math.round(note.onsetQuarters.toFloat() * ppq);
      const durationTicks = Math.max(1, noteDurationTicks(note, ppq));
      // A copied/split chord marker cannot override the Score's actual onset.
      // MusicXML also forbids a chord member outlasting its anchor note.
      const isChord = Boolean(note.chord && previousOnset === onsetTicks &&
        previousGrace === Boolean(note.grace) && durationTicks <= previousDuration);
      if (!isChord && onsetTicks !== cursor) {
        content.push(element(onsetTicks > cursor ? 'forward' : 'backup', [
          leaf('duration', Math.abs(onsetTicks - cursor)),
        ]));
        cursor = onsetTicks;
      }
      content.push(serializeNote(note, label, ppq, isChord, context.tupletMarks.get(note)));
      if (!isChord) {
        previousOnset = onsetTicks;
        previousDuration = durationTicks;
        previousGrace = Boolean(note.grace);
        if (!note.grace) cursor += durationTicks;
      }
    }
    previousEndTicks = cursor;
  });

  // Preserve the supplied measure grid even when its final beats are silent.
  // Without an explicit forward, a parser that derives bar length from events
  // shortens every trailing-rest measure during a round-trip.
  const measureEndTicks = Math.round(measure.offsetQuarters.toFloat() * ppq);
  if (previousEndTicks < measureEndTicks) {
    content.push(element('forward', [leaf('duration', measureEndTicks - previousEndTicks)]));
  }

  if (measure.barlineEnd) content.push(element('barline', [leaf('bar-style', measure.barlineEnd)], {location: 'right'}));
  return element('measure', content, {number: measure.number});
}

/** Attributes that begin this measure. Later entries are emitted only when a
 * key/time signature actually changes at this measure boundary. */
function attributesAt(
  part: Part,
  measure: GridMeasure,
  index: number,
  tick: number,
  context: SerializeContext,
): XmlBuildNode[] {
  const attributes: XmlBuildNode[] = [];
  if (index === 0) attributes.push(leaf('divisions', context.ppq));

  const key = index === 0
    ? lastAtOrBefore(context.keySignatures, tick)
    : exactAt(context.keySignatures, tick);
  if (key) {
    attributes.push(element('key', [
      leaf('fifths', key.fifths),
      ...(key.mode ? [leaf('mode', key.mode)] : []),
    ]));
  }

  const time = index === 0
    ? lastAtOrBefore(context.timeSignatures, tick)
    : exactAt(context.timeSignatures, tick);
  if (time) {
    attributes.push(element('time', [
      leaf('beats', time.numerator),
      leaf('beat-type', time.denominator),
    ]));
  }

  if (index === 0 && part.staves && part.staves > 1) {
    attributes.push(leaf('staves', part.staves));
  }
  const storedClefs = part.clefChanges !== undefined
    ? part.clefChanges.filter((change) => change.onsetQuarters.eq(measure.onsetQuarters)).map((change) => createClefNode(change.clef,
      (part.staves ?? 1) > 1 || change.staff !== 1 ? change.staff : undefined))
    : clefNodes(measure);
  if (index === 0) {
    attributes.push(...(storedClefs.length > 0 ? storedClefs : clefsForPart(part)));
  } else {
    attributes.push(...storedClefs);
  }
  if (index === 0 && part.transpose) {
    attributes.push(element('transpose', [
      ...(part.transpose.diatonic != null
        ? [leaf('diatonic', part.transpose.diatonic)]
        : []),
      leaf('chromatic', part.transpose.chromatic),
      ...(part.transpose.octaveChange
        ? [leaf('octave-change', part.transpose.octaveChange)]
        : []),
    ]));
  }
  return attributes;
}

function exactAt<T extends {tick: number}>(entries: readonly T[], tick: number): T | undefined {
  return entries.find((entry) => entry.tick === tick);
}

function lastAtOrBefore<T extends {tick: number}>(entries: readonly T[], tick: number): T | undefined {
  let result: T | undefined;
  for (const entry of entries) {
    if (entry.tick > tick) break;
    result = entry;
  }
  return result;
}

function tempoSoundsInMeasure(
  startTick: number,
  endTick: number,
  context: SerializeContext,
): XmlBuildNode[] {
  return context.tempi
    .filter((tempo) => tempo.tick >= startTick && tempo.tick < endTick)
    // Playback-only tempos belong directly in the measure. A <direction>
    // requires a visual <direction-type>; omitting it makes real readers
    // abandon the measure, while inventing one changes the authored notation.
    .map((tempo) => element('sound', [
      ...(tempo.tick === startTick ? [] : [leaf('offset', tempo.tick - startTick)]),
    ], {tempo: tempo.bpm}));
}

/**
 * Split any note crossing a measure boundary into sound-preserving fragments.
 * The core model permits a note to span bars; MusicXML does not. Fragments
 * gain the required stop/start tie state while an existing tie chain remains
 * connected to its neighbouring source notes.
 */
function notesForMeasure(notes: readonly Note[], measure: GridMeasure): Note[] {
  const out: Note[] = [];
  for (const note of notes) {
    if (note.grace) {
      if (note.onsetQuarters.gte(measure.onsetQuarters) && note.onsetQuarters.lt(measure.offsetQuarters)) {
        out.push(note);
      }
      continue;
    }
    const start = note.onsetQuarters.gt(measure.onsetQuarters)
      ? note.onsetQuarters
      : measure.onsetQuarters;
    const end = note.offsetQuarters.lt(measure.offsetQuarters)
      ? note.offsetQuarters
      : measure.offsetQuarters;
    if (end.lte(start)) continue;

    if (start.eq(note.onsetQuarters) && end.eq(note.offsetQuarters)) {
      out.push(note);
      continue;
    }

    const incoming = start.gt(note.onsetQuarters) || note.tie === 'stop' || note.tie === 'continue';
    const outgoing = end.lt(note.offsetQuarters) || note.tie === 'start' || note.tie === 'continue';
    const firstFragment = start.eq(note.onsetQuarters);
    out.push(note.with({
      onsetQuarters: start,
      duration: new Duration({base: end.sub(start)}),
      tie: tieState(incoming, outgoing),
      // Beam levels and tuplet glyphs describe the original written duration;
      // newly split durations need fresh grouping. Other note annotations are
      // anchored to the original onset, not repeated on every tied fragment.
      beams: undefined,
      tupletId: undefined,
      tupletMarks: undefined,
      slur: firstFragment ? note.slur : undefined,
      articulations: firstFragment ? note.articulations : undefined,
    }));
  }
  return out;
}

function tieState(incoming: boolean, outgoing: boolean): Note['tie'] {
  if (incoming && outgoing) return 'continue';
  if (incoming) return 'stop';
  if (outgoing) return 'start';
  return undefined;
}

function serializeNote(
  note: Note, voice: string, ppq: number, isChord: boolean,
  inferredMarks?: readonly TupletMark[],
): XmlBuildNode {
  const durationTicks = Math.max(1, noteDurationTicks(note, ppq));
  const dots = note.duration.dots ?? 0;
  const isGrace = note.grace != null && note.grace !== false;
  const children: XmlBuildNode[] = [];
  if (isGrace) {
    const slash = typeof note.grace === 'object' && note.grace.slash === true;
    children.push(element('grace', [], slash ? {slash: 'yes'} : undefined));
  }
  if (isChord) children.push(element('chord'));
  if (note.rest) {
    children.push(element('rest', note.restDisplay ? [leaf('display-step', note.restDisplay.step), leaf('display-octave', note.restDisplay.octave)] : []));
  } else if (note.unpitched) {
    children.push(element('unpitched', [
      leaf('display-step', note.pitch.step),
      leaf('display-octave', note.pitch.octave),
    ]));
  } else {
    children.push(element('pitch', [
      leaf('step', note.pitch.step),
      ...(note.pitch.alter ? [leaf('alter', note.pitch.alter)] : []),
      leaf('octave', note.pitch.octave),
    ]));
  }
  if (!isGrace) children.push(leaf('duration', durationTicks));
  const tieTypes: Array<'start' | 'stop'> = note.tie === 'continue'
    ? ['stop', 'start']
    : note.tie
      ? [note.tie]
      : [];
  if (tieTypes.length > 0) {
    // MusicXML represents a continuing tie with both endpoints on the same
    // note. Writing only `start` disconnects the previous segment on import.
    for (const type of tieTypes) children.push(element('tie', [], {type}));
  }
  children.push(leaf('voice', voice));
  children.push(leaf(
    'type',
    isGrace ? 'eighth' : inferDurationType(note.duration.base.toFloat()),
  ));
  if (!isGrace) {
    for (let index = 0; index < dots; index += 1) children.push(element('dot'));
  }
  const [actual, normal] = note.duration.tuplet;
  if (!isGrace && actual !== normal) children.push(element('time-modification', [
    leaf('actual-notes', actual),
    leaf('normal-notes', normal),
  ]));
  if (note.stem != null) children.push(leaf('stem', note.stem));
  if (note.staff != null) children.push(leaf('staff', note.staff));
  for (const beam of note.beams ?? []) children.push(leaf('beam', beam.type, {number: beam.number}));
  // The MusicXML schema puts notations after voice/type/staff, while sound
  // ties precede those fields. Keep both semantics in their declared order.
  const notations = tieTypes.map((type) => element('tied', [], {type, placement: note.tiePlacement}));
  const slurs = typeof note.slur === 'string' ? [{type: note.slur}] :
    Array.isArray(note.slur) ? note.slur : note.slur ? [note.slur] : [];
  for (const slur of slurs) notations.push(element('slur', [], {type: slur.type, number: slur.number, placement: slur.placement}));
  if (note.articulations?.length) notations.push(element('articulations', note.articulations.map((mark) => element(mark === 'marcato' ? 'strong-accent' : mark))));
  for (const mark of note.tupletMarks ?? inferredMarks ?? []) notations.push(element('tuplet', [], {
    type: mark.type,
    number: mark.number,
    bracket: mark.bracket === undefined ? undefined : mark.bracket ? 'yes' : 'no',
    placement: mark.placement,
    'show-number': mark.showNumber,
  }));
  if (notations.length > 0) children.push(element('notations', notations));
  return element('note', children, note.printObject === undefined ? undefined :
    {'print-object': note.printObject ? 'yes' : 'no'});
}

/** Programmatic tuplet IDs supply endpoints when no authored endpoints exist. */
function inferredTupletMarks(score: Score): ReadonlyMap<Note, readonly TupletMark[]> {
  const marks = new Map<Note, readonly TupletMark[]>();
  for (const part of score.parts) {
    const groups = new Map<string, Note[]>();
    for (const note of part.notes) if (note.tupletId) {
      const key = `${note.voice}\u0000${note.tupletId}`;
      const group = groups.get(key);
      if (group) group.push(note);
      else groups.set(key, [note]);
    }
    for (const group of groups.values()) {
      if (group.some((note) => note.tupletMarks?.length)) continue;
      group.sort((left, right) => left.onsetQuarters.cmp(right.onsetQuarters));
      const first = group[0];
      const last = group[group.length - 1];
      marks.set(first, first === last ? [{type: 'start'}, {type: 'stop'}] : [{type: 'start'}]);
      if (last !== first) marks.set(last, [{type: 'stop'}]);
    }
  }
  return marks;
}

function voiceLabel(partId: string, note: Note): string {
  const voice = String(note.voice);
  const prefix = `${partId}-`;
  return voice.startsWith(prefix) ? voice.slice(prefix.length) : voice;
}

function compareVoiceLabels(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}

function createClefNode(clef: Clef, staff?: number): XmlBuildNode {
  return element(
    'clef',
    [
      leaf('sign', clef.sign),
      ...(clef.line != null ? [leaf('line', clef.line)] : []),
      ...(clef.octaveChange
        ? [leaf('clef-octave-change', clef.octaveChange)]
        : []),
    ],
    staff != null ? {number: staff} : undefined,
  );
}

function clefNodes(measure: GridMeasure): XmlBuildNode[] {
  const nodes: XmlBuildNode[] = [];
  if (measure.clef) nodes.push(createClefNode(measure.clef));
  if (measure.clefs) {
    for (const [staff, clef] of Object.entries(measure.clefs)) {
      nodes.push(createClefNode(clef, Number(staff)));
    }
  }
  return nodes;
}

const DYNAMIC_MARKS = new Set(['p', 'pp', 'ppp', 'pppp', 'ppppp', 'pppppp', 'f', 'ff', 'fff', 'ffff', 'fffff', 'ffffff', 'mp', 'mf', 'sf', 'sfp', 'sfpp', 'fp', 'rf', 'rfz', 'sfz', 'sffz', 'fz', 'n', 'pf', 'sfzp']);

function serializeDirection(direction: PartDirection, offset: number): XmlBuildNode {
  const attrs: Record<string, unknown> = {};
  for (const key of ['defaultX', 'defaultY', 'relativeX', 'relativeY'] as const) if (direction[key] !== undefined) {
    attrs[key.replace(/[XY]/g, (axis) => `-${axis.toLowerCase()}`)] = direction[key];
  }
  let mark: XmlBuildNode;
  if (direction.kind === 'words' || direction.kind === 'rehearsal') {
    mark = leaf(direction.kind, direction.text, {...attrs, 'font-style': direction.fontStyle, 'font-weight': direction.fontWeight, 'font-size': direction.fontSize});
  } else if (direction.kind === 'dynamics') {
    mark = element('dynamics', direction.values.map((value) => DYNAMIC_MARKS.has(value) ? element(value) : leaf('other-dynamics', value)), attrs);
  } else if (direction.kind === 'metronome') {
    mark = element('metronome', [leaf('beat-unit', inferDurationType(direction.beatUnit.base.toFloat())),
      ...Array.from({length: direction.beatUnit.dots}, () => element('beat-unit-dot')), leaf('per-minute', direction.perMinute)],
    {...attrs, parentheses: direction.parentheses === undefined ? undefined : direction.parentheses ? 'yes' : 'no'});
  } else if (direction.kind === 'pedal') {
    mark = element('pedal', [], {...attrs, type: direction.type, number: direction.number,
      line: direction.line === undefined ? undefined : direction.line ? 'yes' : 'no',
      sign: direction.sign === undefined ? undefined : direction.sign ? 'yes' : 'no'});
  } else if (direction.kind === 'wedge') {
    mark = element('wedge', [], {...attrs, type: direction.type, number: direction.number, spread: direction.spread,
      niente: direction.niente === undefined ? undefined : direction.niente ? 'yes' : 'no'});
  } else {
    throw new TypeError('Unsupported direction kind');
  }
  return element('direction', [element('direction-type', [mark]),
    ...(offset ? [leaf('offset', offset)] : []), ...(direction.staff !== undefined ? [leaf('staff', direction.staff)] : [])],
  {placement: direction.placement, 'print-object': direction.printObject === undefined ? undefined : direction.printObject ? 'yes' : 'no'});
}

function clefsForPart(part: Part): XmlBuildNode[] {
  if (part.staves && part.staves > 1) {
    return Array.from({length: part.staves}, (_, index) => {
      const staff = index + 1;
      const clef = clefForNotes(
        part.notes.filter((note) => (note.staff ?? 1) === staff),
        staff,
      );
      return element('clef', [
        leaf('sign', clef.sign),
        leaf('line', clef.line),
      ], {number: staff});
    });
  }
  const clef = clefForNotes(part.notes, 1);
  return [element('clef', [leaf('sign', clef.sign), leaf('line', clef.line)])];
}

function clefForNotes(
  notes: ReadonlyArray<Note>,
  staff: number,
): {sign: string; line: number} {
  const midiValues = notes.filter((note) => !note.rest).map(noteMidi);
  if (midiValues.length === 0 && staff > 1) return {sign: 'F', line: 4};
  const average = midiValues.length > 0
    ? midiValues.reduce((sum, midi) => sum + midi, 0) / midiValues.length
    : 64;
  return average < 56 ? {sign: 'F', line: 4} : {sign: 'G', line: 2};
}

function measureGrid(score: Score): GridMeasure[] {
  if (score.measures.length > 0) {
    const grid: GridMeasure[] = score.measures.map((measure) => ({
      number: measure.number,
      onsetQuarters: measure.onsetQuarters,
      offsetQuarters: measure.offsetQuarters,
      clef: measure.clef,
      clefs: measure.clefs,
      barlineStart: measure.barlineStart,
      barlineEnd: measure.barlineEnd,
    }));
    // A hand-built Score can legitimately contain a note that outlives its
    // supplied measure list. Extend the grid rather than putting that whole
    // note in the final bar (which creates invalid MusicXML timing).
    let cursor = grid[grid.length - 1]?.offsetQuarters ?? Rational.ZERO;
    let number = (grid[grid.length - 1]?.number ?? 0) + 1;
    let guard = 0;
    while (cursor.lt(score.durationQuarters) && guard < 100_000) {
      const timeSignature = score.timeMap.timeSignatureAt(cursor);
      const duration = new Rational(4 * timeSignature.numerator, timeSignature.denominator);
      grid.push({
        number,
        onsetQuarters: cursor,
        offsetQuarters: cursor.add(duration),
      });
      cursor = cursor.add(duration);
      number += 1;
      guard += 1;
    }
    return grid;
  }
  const total = score.durationQuarters;
  const grid: GridMeasure[] = [];
  let cursor = Rational.ZERO;
  let number = 1;
  let guard = 0;
  while (cursor.lt(total) && guard < 100_000) {
    const timeSignature = score.timeMap.timeSignatureAt(cursor);
    const length = new Rational(
      4 * timeSignature.numerator,
      timeSignature.denominator,
    );
    grid.push({
      number,
      onsetQuarters: cursor,
      offsetQuarters: cursor.add(length),
    });
    cursor = cursor.add(length);
    number += 1;
    guard += 1;
  }
  if (grid.length === 0) {
    const timeSignature = score.timeMap.timeSignatureAt(Rational.ZERO);
    const length = new Rational(
      4 * timeSignature.numerator,
      timeSignature.denominator,
    );
    grid.push({
      number: 1,
      onsetQuarters: Rational.ZERO,
      offsetQuarters: length,
    });
  }
  return grid;
}

function inferDurationType(baseQuarters: number): string {
  const exact = Object.entries(DURATION_TYPES).find(
    ([, value]) => Math.abs(value - baseQuarters) < 0.001,
  );
  if (exact) return exact[0];
  let closest = 'quarter';
  let closestDistance = Infinity;
  for (const [name, value] of Object.entries(DURATION_TYPES)) {
    const distance = Math.abs(
      Math.log2(Math.max(1e-6, baseQuarters) / value),
    );
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = name;
    }
  }
  return closest;
}

/**
 * Characters XML 1.0 forbids outright — they cannot be escaped, so a document
 * containing one is not parseable at all (§2.2 Char excludes C0 apart from tab,
 * LF and CR, plus the two non-characters and unpaired surrogates).
 *
 * Real inputs carry them: MIDI text meta events are frequently NUL-padded, so a
 * `.mid` whose track name is `"Piano\0"` round-trips into
 * `<score-part id="Piano\0">` and every downstream XML reader rejects the whole
 * file. Serialization is the single chokepoint where a Score becomes XML, so
 * scrubbing here keeps the output well-formed no matter how the Score was made.
 */
const XML_FORBIDDEN =
  // C0 controls except tab/LF/CR, the two non-characters, and unpaired surrogates.
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Drop characters that no XML 1.0 document may contain. Non-strings pass through. */
function xmlSafe(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(XML_FORBIDDEN, '') : value;
}

function element(
  name: string,
  children: XmlBuildNode[] = [],
  attrs?: Record<string, unknown>,
): XmlBuildNode {
  const node: XmlBuildNode = {[name]: children};
  if (attrs) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (value != null) cleaned[`@_${key}`] = xmlSafe(value);
    }
    if (Object.keys(cleaned).length > 0) node[':@'] = cleaned;
  }
  return node;
}

function leaf(
  name: string,
  value: unknown,
  attrs?: Record<string, unknown>,
): XmlBuildNode {
  return element(name, value == null ? [] : [{'#text': xmlSafe(value)}], attrs);
}
