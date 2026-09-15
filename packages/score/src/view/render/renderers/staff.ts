import {
  Accidental, Articulation, Beam, ClefNote, Dot, GraceNote, Modifier, ModifierContext, Stave,
  StaveConnector, StaveNote, Stem, SVGContext, TickContext, Tuplet,
} from 'vexflow/bravura';
import {
  Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId,
  type Clef, type Note, type Score,
} from '../../../core';
import {secondsToQuarters} from '../../core/note-sequence';
import {projectStaffNotation, type StaffNotationEvent} from '../../core/staff-notation';
import {groupStaffBeams} from '../../core/staff-beaming';
import type {ScoreNoteSequence, ScoreSequenceNote, StaffRenderOptions} from '../../core/types';
import {BaseVisualizer, makeClipped, makeScrollable, setExplicitSize} from './base';
import {getStaffOverlap, type StaffInkBounds} from './staff-spacing';
import {drawStaffDirections} from './staff-directions';
import {drawStaffBarline} from './staff-barlines';
import {layoutStaffCurve, pairStaffCurves, staffBeamInk, type StaffCurveAnchor, type StaffCurveEvent, type StaffCurveObstacle} from './staff-curves';

export enum ScrollType { PAGE = 0, NOTE = 1, BAR = 2 }
export type StaffSVGVisualizerConfig = StaffRenderOptions;

type Projection = ReturnType<typeof projectStaffNotation>;
interface DrawnEvent {event: StaffNotationEvent; note: StaveNote; voice: string; layer: number; measure: number}
interface Paint {element: SVGElement; ids: readonly string[]}
interface Anchor {quarter: number; x: number}
interface DrawnClef {note: ClefNote; layer: number; onset: Rational; clef: Clef}
interface MeasureLayout {x: number; end: number; start: number; stop: number; staves: Stave[]; events: DrawnEvent[]; beams: Beam[]; tuplets: Tuplet[]; clefs: DrawnClef[]}

const INK = 'var(--webscore-staff-current, var(--webscore-staff-note))';
const KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
function keyName(fifths: number): string { return KEY_NAMES[Math.max(0, Math.min(14, fifths + 7))] ?? 'C'; }
function clefName(clef: Clef): string {
  if (clef.sign === 'F') return clef.line === 3 ? 'baritone-f' : clef.line === 5 ? 'subbass' : 'bass';
  if (clef.sign === 'C') return clef.line === 4 ? 'tenor' : clef.line === 1 ? 'soprano' : clef.line === 2 ? 'mezzo-soprano' : clef.line === 5 ? 'baritone-c' : 'alto';
  return clef.sign === 'percussion' ? 'percussion' : clef.sign === 'G' && clef.line === 1 ? 'french' : 'treble';
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function noteKey(note: Note): string { return `${note.pitch.step.toLowerCase()}${note.pitch.alter > 0 ? '#'.repeat(note.pitch.alter) : 'b'.repeat(-note.pitch.alter)}/${note.pitch.octave}`; }
function durationCode(duration: Duration): string {
  if (duration.base.eq(new Rational(8, 1))) return '1/2';
  const value = 4 / duration.base.toFloat();
  // Imported written values are exact. Non-notated MIDI durations use the
  // nearest readable head; their exact onset/duration still owns the timeline.
  return String(Math.max(1, Math.min(256, 2 ** Math.round(Math.log2(value || 8)))));
}

/** Synchronous, notation-aware scrolling staff; playback remains borrowed. */
export class StaffSVGVisualizer extends BaseVisualizer {
  private readonly container: HTMLDivElement;
  private readonly staffConfig: StaffSVGVisualizerConfig;
  private readonly source: Score;
  private projection!: Projection;
  private context!: SVGContext;
  private headerContext!: SVGContext;
  private viewport!: HTMLDivElement;
  private header!: HTMLDivElement;
  private playhead!: HTMLDivElement;
  private rows: SVGGElement[] = [];
  private rowInk: StaffInkBounds[][] = [];
  private rowY: number[] = [];
  private paints: Paint[] = [];
  private active = new Set<SVGElement>();
  private anchors: Anchor[] = [];
  private measures: MeasureLayout[] = [];
  private hiddenTupletNumbers = new Map<Tuplet, number>();
  private headerWidth = 150;
  private currentHeader = '';
  private scale = 1;
  private logicalWidth = 0;
  private position?: number;
  private followRequested = false;
  private geometryPending = false;
  private cleanups: Array<() => void> = [];

  constructor(sequence: ScoreNoteSequence, container: HTMLDivElement, config: StaffSVGVisualizerConfig = {}, score?: Score) {
    super(sequence, config);
    this.container = container;
    this.staffConfig = config;
    this.source = score ?? scoreFromSequence(sequence);
    try { this.render(); } catch (error) { this.dispose(); throw error; }
  }

  protected clear(): void { this.clearActiveNotes(); }
  public redraw(note?: ScoreSequenceNote, follow = false): number | null {
    if (this.disposed) return null;
    if (!note) { this.clearActiveNotes(); return null; }
    return this.redrawAtTime(note.startTime, follow);
  }
  public redrawAtTime(seconds: number, follow = true): number | null {
    if (this.disposed) return null;
    if (!Number.isFinite(seconds)) throw new RangeError('Score view time must be finite.');
    const ids = new Set<string>();
    const range = this.getActiveTimeCandidateRange(seconds);
    for (let i = range.start; i < range.end; i += 1) {
      const note = this.noteSequence.notes[i];
      if (note.startTime <= seconds && seconds < note.endTime) ids.add(note.noteId ?? `sequence-${i}`);
    }
    const next = new Set<SVGElement>();
    for (const paint of this.paints) if (paint.ids.some((id) => ids.has(id))) next.add(paint.element);
    for (const element of this.active) if (!next.has(element)) this.setActive(element, false);
    for (const element of next) if (!this.active.has(element)) this.setActive(element, true);
    this.active = next;
    this.position = seconds;
    this.followRequested = follow && seconds >= 0 && seconds <= this.noteSequence.totalTime;
    const quarter = secondsToQuarters(this.noteSequence.tempos, Math.max(0, seconds));
    const x = this.xAtQuarter(quarter) * this.scale;
    if (this.followRequested) this.follow(x, quarter);
    this.paintViewport();
    return x;
  }
  public clearActiveNotes(): void {
    if (this.disposed) return;
    for (const element of this.active) this.setActive(element, false);
    this.active.clear();
    this.position = undefined;
    this.followRequested = false;
    if (this.playhead) this.playhead.hidden = true;
  }
  public override dispose(): void {
    if (this.disposed) return;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.paints = [];
    this.active.clear();
    this.container.replaceChildren();
    super.dispose();
  }
  private setActive(element: SVGElement, active: boolean): void {
    element.toggleAttribute('data-active', active);
    element.style.setProperty('--webscore-staff-current', active ? 'var(--webscore-staff-active)' : 'var(--webscore-staff-note)');
  }
  private register(element: SVGElement | undefined, ids: readonly string[]): void {
    if (!element) return;
    element.style.setProperty('--webscore-staff-current', 'var(--webscore-staff-note)');
    this.paints.push({element, ids});
  }

  private render(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.rows = []; this.rowInk = []; this.rowY = []; this.paints = []; this.active.clear();
    this.anchors = []; this.measures = []; this.currentHeader = '';
    this.hiddenTupletNumbers.clear();
    const document = this.container.ownerDocument;
    this.projection = projectStaffNotation(this.source, this.staffConfig);
    this.scale = this.config.noteHeight / 10;
    this.container.replaceChildren();
    this.container.style.position = 'relative';
    this.container.style.minWidth = '0';
    this.container.style.setProperty('--webscore-staff-note', this.config.noteColor ?? `rgb(${this.config.noteRGB})`);
    this.container.style.setProperty('--webscore-staff-active', this.config.activeNoteColor ?? `rgb(${this.config.activeNoteRGB})`);
    makeClipped(this.container);
    this.viewport = document.createElement('div');
    this.viewport.dataset.webscoreStaffTimeline = '';
    this.viewport.setAttribute('role', 'region');
    this.viewport.setAttribute('aria-label', 'Staff timeline');
    this.viewport.style.cssText = 'width:100%;min-width:0;position:relative;';
    makeScrollable(this.viewport, 'x');
    makeClipped(this.viewport, 'y');
    this.container.append(this.viewport);
    this.context = new SVGContext(this.viewport);
    this.context.setFillStyle(INK).setStrokeStyle(INK);
    this.context.svg.dataset.webscoreStaffDrawing = '';
    this.context.svg.setAttribute('aria-hidden', 'true');
    this.header = document.createElement('div');
    this.header.dataset.webscoreStaffHeader = '';
    this.header.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:hidden;';
    this.container.append(this.header);
    this.headerContext = new SVGContext(this.header);
    this.headerContext.setFillStyle(INK).setStrokeStyle(INK);
    this.headerContext.svg.setAttribute('aria-hidden', 'true');
    this.prepareMeasures();
    this.drawRows();
    this.packRows();
    this.drawCrossStaffCurves();
    this.drawConnections();
    this.drawHeader(0);
    const divider = document.createElement('div');
    divider.dataset.webscoreStaffDivider = '';
    divider.style.cssText = `position:absolute;top:0;bottom:0;left:${this.headerWidth * this.scale}px;width:1px;opacity:.35;pointer-events:none;background:var(--webscore-staff-note);`;
    this.container.append(divider);
    this.playhead = document.createElement('div');
    this.playhead.dataset.webscoreStaffPlayhead = '';
    this.playhead.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;pointer-events:none;background:var(--webscore-staff-active);';
    this.playhead.hidden = true;
    this.container.append(this.playhead);
    const scroll = (): void => { this.followRequested = false; this.paintViewport(); };
    this.viewport.addEventListener('scroll', scroll, {passive: true});
    this.cleanups.push(() => this.viewport.removeEventListener('scroll', scroll));
    const resize = (): void => {
      if (this.disposed) return;
      if (this.geometryPending && this.container.getBoundingClientRect().width > 0) {
        this.geometryPending = false;
        const position = this.position; const follow = this.followRequested; const scroll = this.viewport.scrollLeft;
        this.render();
        if (position !== undefined) this.redrawAtTime(position, follow);
        if (!follow) { this.viewport.scrollLeft = scroll; this.paintViewport(); }
        return;
      }
      if (this.followRequested && this.position !== undefined) this.redrawAtTime(this.position, true);
      else this.paintViewport();
    };
    const view = document.defaultView;
    if (view?.ResizeObserver) {
      const observer = new view.ResizeObserver(resize);
      observer.observe(this.container);
      this.cleanups.push(() => observer.disconnect());
    }
    this.paintViewport();
  }

  private prepareMeasures(): void {
    let x = 20;
    const context = this.context;
    // Every later key/meter needs the same fixed-header space while panning.
    this.headerWidth = Math.max(80, ...this.projection.layers.flatMap((layer) => layer.measures.map(({clef, measure}) =>
      new Stave(20, 0, 400).addClef(clefName(clef)).addKeySignature(keyName(measure.keySignature.fifths))
        .addTimeSignature(`${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`).getNoteStartX(),
    )));
    for (const measure of this.projection.measures) {
      const index = measure.index;
      const staves = this.projection.layers.map((layer) => {
        const current = layer.measures[index];
        const previous = layer.measures[index - 1];
        const stave = new Stave(x, 0, 300, {left_bar: false, right_bar: false}).setContext(context);
        stave.setStyle({fillStyle: INK, strokeStyle: INK});
        const previousClef = previous?.clefChanges[previous.clefChanges.length - 1]?.clef ?? previous?.clef;
        if (!previous || !same(current.clef, previousClef)) stave.addClef(clefName(current.clef), undefined, current.clef.octaveChange === 1 ? '8va' : current.clef.octaveChange === -1 ? '8vb' : undefined);
        if (!previous || !same(measure.keySignature, previous.measure.keySignature)) stave.addKeySignature(keyName(measure.keySignature.fifths));
        if (!previous || !same(measure.timeSignature, previous.measure.timeSignature)) stave.addTimeSignature(`${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`);
        return stave;
      });
      const startX = Math.max(index === 0 ? this.headerWidth : x + 12, ...staves.map((stave) => stave.getNoteStartX()));
      for (const stave of staves) stave.setNoteStartX(startX);
      const events: DrawnEvent[] = [];
      const beams: Beam[] = [];
      const tuplets: Tuplet[] = [];
      const clefs: DrawnClef[] = [];
      this.projection.layers.forEach((layer, layerIndex) => {
        const layerMeasure = layer.measures[index];
        for (const change of layerMeasure.clefChanges) {
          const clef = change.clef;
          const note = new ClefNote(clefName(clef), 'small', clef.octaveChange === 1 ? '8va' : clef.octaveChange === -1 ? '8vb' : undefined)
            .setStave(staves[layerIndex]).setContext(context);
          note.setStyle({fillStyle: INK, strokeStyle: INK});
          clefs.push({note, layer: layerIndex, onset: change.onsetQuarters, clef});
        }
        const accidentalState = new Map<string, number>();
        const fifths = measure.keySignature.fifths;
        const keyAlter = new Map<string, number>();
        const order = fifths >= 0 ? ['F', 'C', 'G', 'D', 'A', 'E', 'B'] : ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
        for (let i = 0; i < Math.abs(fifths); i += 1) keyAlter.set(order[i % 7], fifths > 0 ? 1 : -1);
        for (const voice of layerMeasure.voices) {
          const drawn = voice.events.map((event) => {
            // VexFlow sorts its head geometry internally while retaining key
            // indexes. Keep the authored chord anchor and its notation marks.
            const notes = [...event.notes];
            const source = notes[0];
            const clef = event.clef;
            const direction = source?.stem === 'up' ? Stem.UP : source?.stem === 'down' ? Stem.DOWN : undefined;
            const NoteClass = source?.grace ? GraceNote : StaveNote;
            const note = new NoteClass({
              keys: event.rest ? [source?.restDisplay ? `${source.restDisplay.step.toLowerCase()}/${source.restDisplay.octave}` : 'r/4'] : notes.map(noteKey),
              duration: `${source?.grace ? '8' : durationCode(event.duration)}${event.rest ? 'r' : ''}`,
              dots: event.duration.dots,
              ...(source?.grace ? {slash: typeof source.grace === 'object' && source.grace.slash === true} : {}),
              clef: clefName(clef), octave_shift: clef.octaveChange ?? 0,
              ...(direction ? {stem_direction: direction} : layerMeasure.voices.length > 1 ? {stem_direction: layerMeasure.voices.indexOf(voice) % 2 ? Stem.DOWN : Stem.UP} : {auto_stem: true}),
            }).setStave(staves[layerIndex]).setContext(context);
            note.setStyle({fillStyle: INK, strokeStyle: INK});
            if (source?.stem === 'none') {
              note.getStem()?.setVisibility(false);
              note.setFlagStyle({fillStyle: 'transparent', strokeStyle: 'transparent'});
            }
            for (let dot = 0; dot < event.duration.dots; dot += 1) Dot.buildAndAttach([note], {all: true});
            if (!event.continuedFromPrevious) {
              const codes = {staccato: 'a.', accent: 'a>', tenuto: 'a-', marcato: 'a^', staccatissimo: 'av'};
              for (const type of new Set(notes.flatMap((source) => source.articulations ?? []))) {
                note.addModifier(new Articulation(codes[type]).setPosition(note.getStemDirection() === Stem.UP ? Modifier.Position.BELOW : Modifier.Position.ABOVE));
              }
            }
            const result = {event: {...event, notes}, note, voice: voice.id, layer: layerIndex, measure: index};
            events.push(result);
            return result;
          });
          const groups = groupStaffBeams(drawn.map(({event}) => ({
            onset: event.onsetQuarters.toFloat(), duration: event.duration.quarters.toFloat(), base: event.duration.base.toFloat(),
            rest: event.rest, voice: voice.id, tupletId: event.notes[0]?.tupletId, beams: event.continuedFromPrevious ? undefined : event.notes[0]?.beams,
          })), {start: measure.startQuarters.toFloat(), ...measure.timeSignature});
          for (const group of groups) {
            const notes = group.indices.map((i) => drawn[i].note);
            const direction = group.indices.map((i) => drawn[i].event.notes[0]?.stem).find((stem) => stem === 'up' || stem === 'down');
            const authored = direction !== undefined;
            if (authored) for (const note of notes) note.setStemDirection(direction === 'up' ? Stem.UP : Stem.DOWN);
            const beam = new Beam(notes, !authored);
            beam.breakSecondaryAt(group.secondaryBreaks.map((index) => group.indices.indexOf(index)));
            for (const hook of group.hooks) beam.setPartialBeamSideAt(group.indices.indexOf(hook.index), hook.direction === 'forward' ? 'R' : 'L');
            beams.push(beam);
          }
          const tupletGroups = new Map<string, DrawnEvent[]>();
          let automatic = 0;
          let automaticWritten = 0;
          let automaticBase = Infinity;
          let complete = false;
          let previousEnd = -Infinity;
          let previousRatio = '';
          for (const draw of drawn) {
            const [actual, normal] = draw.event.duration.tuplet;
            if (actual === normal) { previousRatio = ''; continue; }
            const ratio = `${actual}:${normal}`;
            if (ratio !== previousRatio || complete || Math.abs(draw.event.onsetQuarters.toFloat() - previousEnd) > 1e-8) {
              automatic += 1; automaticWritten = 0; automaticBase = Infinity;
            }
            const id = draw.event.notes[0]?.tupletId ?? `inferred-${automatic}`;
            const group = tupletGroups.get(id) ?? [];
            group.push(draw); tupletGroups.set(id, group);
            previousRatio = ratio;
            automaticWritten += draw.event.duration.quarters.toFloat() * actual / normal;
            automaticBase = Math.min(automaticBase, draw.event.duration.base.toFloat());
            complete = Math.abs(automaticWritten / automaticBase - actual) < 1e-8;
            previousEnd = draw.event.onsetQuarters.add(draw.event.duration.quarters).toFloat();
          }
          for (const group of tupletGroups.values()) {
            const [actual, normal] = group[0].event.duration.tuplet;
            const mark = group.flatMap((draw) => draw.event.notes[0]?.tupletMarks ?? []).find((mark) => mark.type === 'start');
            if (mark?.showNumber === 'none' && mark.bracket !== true) continue;
            const location = mark?.placement === 'below' ? -1 : mark?.placement === 'above' ? 1 : group[0].note.getStemDirection() === Stem.DOWN ? -1 : 1;
            const tuplet = new Tuplet(group.map((draw) => draw.note), {
              num_notes: actual, notes_occupied: normal,
              ratioed: mark?.showNumber === 'both',
              bracketed: mark?.bracket ?? !group.every((draw) => !!draw.note.getBeam()),
              location,
            });
            tuplets.push(tuplet);
            if (mark?.showNumber === 'none') this.hiddenTupletNumbers.set(tuplet, location);
          }
        }
        // Accidentals are shared by a staff in chronological order, rather
        // than letting the last event in voice 1 affect the start of voice 2.
        const chronological = events.filter((draw) => draw.layer === layerIndex)
          .sort((a, b) => a.event.onsetQuarters.toFloat() - b.event.onsetQuarters.toFloat());
        for (let first = 0; first < chronological.length;) {
          let last = first + 1;
          while (last < chronological.length && chronological[last].event.onsetQuarters.eq(chronological[first].event.onsetQuarters)) last += 1;
          const changes = new Map<string, number>();
          for (const draw of chronological.slice(first, last)) if (!draw.event.rest) draw.event.notes.forEach((sourceNote, noteIndex) => {
            const pitch = sourceNote.pitch;
            const position = `${pitch.step}/${pitch.octave}`;
            const previous = accidentalState.get(position) ?? keyAlter.get(pitch.step) ?? 0;
            if (previous !== pitch.alter && !draw.event.continuedFromPrevious && sourceNote.tie !== 'stop' && sourceNote.tie !== 'continue') {
              draw.note.addModifier(new Accidental(pitch.alter === 0 ? 'n' : pitch.alter === 2 ? '##' : pitch.alter === -2 ? 'bb' : pitch.alter > 0 ? '#' : 'b'), noteIndex);
            }
            changes.set(position, changes.has(position) && changes.get(position) !== pitch.alter ? NaN : pitch.alter);
          });
          for (const [position, alter] of changes) accidentalState.set(position, alter);
          first = last;
        }
      });
      const columns = new Map<string, {quarter: number; tick: TickContext; modifiers: Map<number, ModifierContext>; clefs: DrawnClef[]}>();
      for (const draw of events) {
        const key = draw.event.onsetQuarters.toString();
        let column = columns.get(key);
        if (!column) { column = {quarter: draw.event.onsetQuarters.toFloat(), tick: new TickContext(), modifiers: new Map(), clefs: []}; columns.set(key, column); }
        let modifiers = column.modifiers.get(draw.layer);
        if (!modifiers) { modifiers = new ModifierContext(); column.modifiers.set(draw.layer, modifiers); }
        draw.note.addToModifierContext(modifiers);
        column.tick.addTickable(draw.note);
      }
      for (const clef of clefs) {
        const key = clef.onset.toString();
        let column = columns.get(key);
        if (!column) { column = {quarter: clef.onset.toFloat(), tick: new TickContext(), modifiers: new Map(), clefs: []}; columns.set(key, column); }
        column.clefs.push(clef);
      }
      const ordered = [...columns.values()].sort((a, b) => a.quarter - b.quarter);
      let offset = 12;
      let previousQuarter = measure.startQuarters.toFloat();
      const quarterWidth = this.staffConfig.pixelsPerSecond && this.staffConfig.pixelsPerSecond > 0
        ? this.staffConfig.pixelsPerSecond * 60 / (this.noteSequence.tempos[0]?.qpm ?? 120) / this.scale : 54;
      for (const column of ordered) {
        for (const modifiers of column.modifiers.values()) modifiers.preFormat();
        column.tick.preFormat();
        const metrics = column.tick.getMetrics();
        offset += Math.max((column.quarter - previousQuarter) * quarterWidth, metrics.totalLeftPx + 8);
        if (column.clefs.length) {
          for (const clef of column.clefs) clef.note.setTickContext(new TickContext().setX(offset)).preFormat();
          offset += Math.max(...column.clefs.map((clef) => clef.note.getWidth())) + 12;
        }
        column.tick.setX(offset);
        this.anchors.push({quarter: column.quarter, x: startX + offset + 12});
        offset += metrics.totalRightPx + 12 + this.config.noteSpacing / this.scale;
        previousQuarter = column.quarter;
      }
      const width = Math.max(100, startX - x + offset + Math.max(18, (measure.endQuarters.toFloat() - previousQuarter) * quarterWidth));
      for (const stave of staves) stave.setWidth(width);
      for (const beam of beams) beam.postFormat();
      this.measures.push({x, end: x + width, start: measure.startQuarters.toFloat(), stop: measure.endQuarters.toFloat(), staves, events, beams, tuplets, clefs});
      if (!this.anchors.some((anchor) => anchor.quarter === measure.startQuarters.toFloat())) this.anchors.push({quarter: measure.startQuarters.toFloat(), x: startX + 12});
      x += width;
    }
    this.logicalWidth = x + 20;
    this.anchors.push({quarter: this.source.durationQuarters.toFloat(), x});
    this.anchors.sort((a, b) => a.quarter - b.quarter);
  }

  private drawRows(): void {
    const ctx = this.context;
    this.projection.layers.forEach((layer, layerIndex) => {
      const row = ctx.openGroup('staff-layer');
      row.dataset.webscoreStaffLayer = String(layer.staff);
      row.dataset.webscorePart = String(layer.partIndex);
      this.rows.push(row);
      const ink: StaffCurveObstacle[] = [];
      const partDraws = this.measures.flatMap((measure) => measure.events.filter((draw) => this.projection.layers[draw.layer].partIndex === layer.partIndex));
      for (const [measureIndex, measure] of this.measures.entries()) {
        measure.staves[layerIndex].draw();
        const source = this.projection.measures[measureIndex].source;
        if (source?.barlineStart) drawStaffBarline(ctx, source.barlineStart, measure.x, 40, 80);
        drawStaffBarline(ctx, source?.barlineEnd ?? 'regular', measure.end, 40, 80);
        for (const clef of measure.clefs.filter((clef) => clef.layer === layerIndex)) {
          const group = ctx.openGroup('staff-clef-change');
          group.dataset.webscoreClef = `${clef.clef.sign}${clef.clef.line ?? ''}`;
          group.dataset.webscoreClefOnset = clef.onset.toString();
          clef.note.draw(); ctx.closeGroup();
        }
        const draws = measure.events.filter((draw) => draw.layer === layerIndex);
        for (const draw of draws) {
          draw.note.draw();
          const group = draw.note.getSVGElement();
          if (draw.event.notes.every((note) => note.printObject === false)) group?.setAttribute('visibility', 'hidden');
          if (group) { group.dataset.webscoreOnset = draw.event.onsetQuarters.toString(); group.dataset.webscoreVoice = draw.voice; }
          const ids = draw.event.notes.filter((note) => !note.rest).map((note) => String(note.id));
          this.register(group, ids);
          draw.note.noteHeads.forEach((head, i) => {
            const note = draw.event.notes[i];
            if (!note || note.rest) return;
            const element = head.getSVGElement();
            if (element) { element.dataset.webscoreNote = String(note.pitch.midi); element.dataset.noteId = String(note.id); }
            this.register(element, [String(note.id)]);
          });
          if (!draw.event.notes.every((note) => note.printObject === false)) {
            if (group) ink.push(...this.pathInk(group, 'note'));
            for (const head of draw.note.noteHeads) {
              const box = head.getBoundingBox();
              ink.push({left: box.getX(), right: box.getX() + box.getW(), top: box.getY(), bottom: box.getY() + box.getH(), kind: 'note'});
            }
            if (!draw.event.rest && draw.event.notes[0]?.stem !== 'none' && draw.note.hasStem()) {
              const extents = draw.note.getStemExtents(); const x = draw.note.getStemX();
              ink.push({left: x - .7, right: x + .7, top: Math.min(extents.topY, extents.baseY), bottom: Math.max(extents.topY, extents.baseY), kind: 'stem'});
            }
          }
        }
        for (const beam of measure.beams) {
          if (!draws.some((draw) => beam.getNotes().includes(draw.note) && draw.event.notes.some((note) => note.printObject !== false))) continue;
          const element = ctx.openGroup('staff-beam');
          element.dataset.webscoreBeam = '';
          beam.setContext(ctx).setStyle({fillStyle: INK, strokeStyle: INK}); beam.draw();
          ctx.closeGroup();
          ink.push(...this.pathInk(element, 'beam'));
          this.register(element, draws.filter((draw) => beam.getNotes().includes(draw.note)).flatMap((draw) => draw.event.notes.map((note) => String(note.id))));
        }
        for (const tuplet of measure.tuplets) {
          if (!draws.some((draw) => tuplet.getNotes().includes(draw.note) && draw.event.notes.some((note) => note.printObject !== false))) continue;
          const element = ctx.openGroup('staff-tuplet');
          element.dataset.webscoreTuplet = String(tuplet.getNoteCount());
          tuplet.setContext(ctx).setStyle({fillStyle: INK, strokeStyle: INK});
          const hiddenLocation = this.hiddenTupletNumbers.get(tuplet);
          if (hiddenLocation !== undefined) {
            const notes = tuplet.getNotes(); const y = tuplet.getYPosition();
            const x = notes[0].getTieLeftX() - 5; const right = notes[notes.length - 1].getTieRightX() + 5;
            ctx.fillRect(x, y, right - x, 1);
            ctx.fillRect(x, y, 1, hiddenLocation * 10); ctx.fillRect(right, y, 1, hiddenLocation * 10);
          } else tuplet.draw();
          ctx.closeGroup();
          ink.push(...this.pathInk(element, 'tuplet'));
        }
      }
      this.drawCurves(partDraws, ink, layerIndex);
      this.rowInk[layerIndex] = ink;
      if (this.staffConfig.showAnnotations !== false) ink.push(...drawStaffDirections(ctx, layer.directions, {
        xAtQuarter: (quarter) => this.xAtQuarter(quarter), endQuarters: this.projection.measures[this.projection.measures.length - 1].endQuarters.toFloat(),
        ink: INK, obstacles: ink,
      }));
      ctx.closeGroup();
    });
  }

  private pathInk(element: SVGElement, kind: StaffCurveObstacle['kind']): StaffCurveObstacle[] {
    const boxes: StaffCurveObstacle[] = [];
    for (const path of element.querySelectorAll<SVGGraphicsElement>('path,rect,text')) {
      if (kind === 'beam' && path.tagName.toLowerCase() === 'path') {
        // VexFlow draws beam faces with absolute M/L polygon commands. Keep
        // their sloping ink rather than treating empty bbox corners as solid.
        const d = path.getAttribute('d') ?? '';
        if (!/[ACQSTHV]/i.test(d)) {
          const points = [...d.matchAll(/[ML]\s*([-+\d.e]+)[,\s]+([-+\d.e]+)/gi)]
            .map((match) => ({x: Number(match[1]), y: Number(match[2])}));
          if (points.length >= 4) { boxes.push(...staffBeamInk(points)); continue; }
        }
      }
      try {
        const box = path.getBBox();
        if (box.width || box.height) boxes.push({left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height, kind});
      } catch { /* Nonvisual DOM: note/stem metrics still provide obstacles. */ }
    }
    return boxes;
  }

  private drawCurves(draws: readonly DrawnEvent[], ink: StaffCurveObstacle[], layerIndex?: number): void {
    const events: StaffCurveEvent[] = [];
    const anchors = new Map<string, {draw: DrawnEvent; note: Note; index: number}>();
    for (const draw of draws) draw.event.notes.forEach((note, index) => {
      if (note.rest || note.printObject === false) return;
      const id = `${draw.layer}:${draw.measure}:${draw.voice}:${draw.event.onsetQuarters}:${note.id}`;
      anchors.set(id, {draw, note, index});
      events.push({id, sourceId: String(note.id), voice: draw.voice, staff: draw.layer + 1,
        onset: draw.event.onsetQuarters.toFloat(), end: draw.event.onsetQuarters.add(draw.event.duration.quarters).toFloat(),
        pitch: `${note.pitch.step}:${note.pitch.alter}:${note.pitch.octave}`, tie: note.tie, tiePlacement: note.tiePlacement,
        slurs: typeof note.slur === 'string' ? [{type: note.slur}] : Array.isArray(note.slur) ? note.slur : note.slur ? [note.slur] : [],
        continuedFromPrevious: draw.event.continuedFromPrevious, continuesToNext: draw.event.continuesToNext,
      });
    });
    const anchor = (id: string, kind: 'tie' | 'slur'): StaffCurveAnchor => {
      const {draw, index} = anchors.get(id)!;
      const shift = layerIndex === undefined ? this.rowY[draw.layer] : 0;
      const heads = (kind === 'tie' ? [draw.note.noteHeads[index]] : draw.note.noteHeads).map((head) => head.getBoundingBox());
      const box = {left: Math.min(...heads.map((head) => head.getX())), right: Math.max(...heads.map((head) => head.getX() + head.getW())),
        top: shift + Math.min(...heads.map((head) => head.getY())), bottom: shift + Math.max(...heads.map((head) => head.getY() + head.getH()))};
      const voices = this.projection.layers[draw.layer].measures[draw.measure].voices;
      const ys = draw.note.noteHeads.map((head) => head.getY());
      return {head: box,
        stem: draw.note.hasStem() && draw.event.notes[0]?.stem !== 'none' ? {x: draw.note.getStemX(), tipY: shift + draw.note.getStemExtents().topY} : undefined,
        stemDirection: draw.note.getStemDirection() === Stem.UP ? 'up' : 'down',
        voiceSide: voices.length > 1 ? voices.findIndex((voice) => voice.id === draw.voice) % 2 ? 'below' : 'above' : undefined,
        chordPosition: ys.length > 1 ? ys[index] === Math.min(...ys) ? 'top' : ys[index] === Math.max(...ys) ? 'bottom' : 'inner' : undefined,
      };
    };
    for (const connection of pairStaffCurves(events)) {
      const first = anchors.get(connection.startId)!; const last = anchors.get(connection.endId)!;
      if (layerIndex === undefined ? first.draw.layer === last.draw.layer : first.draw.layer !== layerIndex || last.draw.layer !== layerIndex) continue;
      const interior = draws.filter((draw) => (draw.voice === first.draw.voice || draw.voice === last.draw.voice) &&
        !draw.event.rest && draw.event.notes.some((note) => note.printObject !== false) && draw.event.notes[0]?.stem !== 'none' && draw.note.hasStem() &&
        draw.event.onsetQuarters.gte(first.draw.event.onsetQuarters) && draw.event.onsetQuarters.lte(last.draw.event.onsetQuarters));
      const request = {kind: connection.kind, start: anchor(connection.startId, connection.kind), end: anchor(connection.endId, connection.kind),
        space: 10, placement: connection.placement,
        staffLines: layerIndex === undefined ? this.rowY.flatMap((y) => [40, 50, 60, 70, 80].map((line) => line + y)) : [40, 50, 60, 70, 80],
        stemDirections: interior.map((draw): 'up' | 'down' => draw.note.getStemDirection() === Stem.UP ? 'up' : 'down'),
      };
      let curve = layoutStaffCurve({...request, obstacles: layerIndex === undefined ? [] : ink});
      if (!curve) continue;
      if (layerIndex === undefined) {
        // A cross-staff slur passes through the inter-staff corridor; it need
        // not clear every unrelated note on the far side of either staff.
        const path = curve.obstacles;
        const nearby = ink.filter((box) => path.some((strip) => box.left < strip.right + 2 && box.right + 2 > strip.left &&
          box.top < strip.bottom + 2 && box.bottom + 2 > strip.top));
        if (nearby.length) curve = layoutStaffCurve({...request, obstacles: nearby}) ?? curve;
      }
      const group = this.context.openGroup('staff-curve');
      group.dataset.webscoreCurve = connection.kind;
      if (layerIndex === undefined) group.dataset.webscoreCrossStaff = '';
      group.dataset.webscoreCurveStart = String(first.note.id); group.dataset.webscoreCurveEnd = String(last.note.id);
      group.dataset.webscoreCurveSide = curve.side;
      const path = this.context.create('path'); path.setAttribute('d', curve.path); path.setAttribute('fill', INK); path.setAttribute('stroke', 'none');
      this.context.add(path); this.context.closeGroup();
      ink.push(...curve.obstacles);
      if (connection.kind === 'tie') this.register(group, [String(first.note.id), String(last.note.id)]);
    }
  }

  private drawCrossStaffCurves(): void {
    const ink: StaffCurveObstacle[] = this.rowInk.flatMap((boxes, index) => boxes.map((box) => ({...box,
      top: box.top + this.rowY[index], bottom: box.bottom + this.rowY[index],
    })));
    for (const partIndex of new Set(this.projection.layers.map((layer) => layer.partIndex))) {
      const draws = this.measures.flatMap((measure) => measure.events.filter((draw) => this.projection.layers[draw.layer].partIndex === partIndex));
      this.drawCurves(draws, ink);
    }
  }

  private packRows(): void {
    let measured = false;
    const boxes = this.rows.map((row, index) => {
      const bounds: StaffInkBounds[] = [...this.rowInk[index]];
      // The SVG context is still at unit scale; all rows share the same local
      // coordinate system, and getBBox includes offscreen notes and curves.
      for (const element of row.querySelectorAll<SVGGraphicsElement>('path,rect,text')) {
        // Hidden spacing notes retain time and horizontal layout, but browser
        // getBBox() still reports their geometry; it must not expand row height.
        if (element.closest('[visibility="hidden"]')) continue;
        // Curves and sloping beams use narrow ink strips. Their whole bounding
        // rectangles contain empty space and can inflate every staff in a song.
        if (element.closest('[data-webscore-curve],[data-webscore-beam]')) continue;
        try {
          const rect = element.getBBox();
          const matrix = element.getCTM();
          if (!matrix || !(rect.width || rect.height)) continue;
          const p1 = this.context.svg.createSVGPoint(); p1.x = rect.x; p1.y = rect.y;
          const p2 = this.context.svg.createSVGPoint(); p2.x = rect.x + rect.width; p2.y = rect.y + rect.height;
          const a = p1.matrixTransform(matrix); const b = p2.matrixTransform(matrix);
          bounds.push({left: Math.min(a.x, b.x), right: Math.max(a.x, b.x), top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y)});
          measured = true;
        } catch { /* No SVG layout in a nonvisual DOM; use conservative metrics. */ }
      }
      bounds.push({left: 0, right: this.logicalWidth, top: 40, bottom: 80});
      // Headers can change while panning. Measure each distinct source header,
      // rather than reserving the tallest possible clef across its full width.
      bounds.push(...this.headerInk(index));
      return {ink: bounds, top: Math.min(...bounds.map((box) => box.top)), bottom: Math.max(...bounds.map((box) => box.bottom))};
    });
    this.geometryPending = !measured && this.rows.length > 0 && typeof this.rows[0].getBBox === 'function';
    const padding = 6;
    let y = boxes.length ? padding - boxes[0].top : 0;
    for (let index = 0; index < this.rows.length; index += 1) {
      if (index > 0) {
        const upper = boxes[index - 1]; const lower = boxes[index];
        const distance = Math.max(100, upper.bottom - lower.top + 12);
        const samePart = this.projection.layers[index - 1].partIndex === this.projection.layers[index].partIndex;
        y += distance - (samePart ? getStaffOverlap(upper.ink, lower.ink, {rowDistance: distance, upperBottomLine: 80, lowerTopLine: 40, noteHeight: 10}) : 0);
      }
      this.rowY.push(y);
      this.rows[index].setAttribute('transform', `translate(0 ${y})`);
    }
    this.height = (y + (boxes[boxes.length - 1]?.bottom ?? 80) + padding) * this.scale;
    this.width = this.logicalWidth * this.scale;
    this.context.resize(this.width, this.height).setViewBox(0, 0, this.logicalWidth, this.height / this.scale);
    setExplicitSize(this.context.svg, this.width, this.height);
  }

  private headerInk(layerIndex: number): StaffInkBounds[] {
    const ctx = this.headerContext;
    const layer = this.projection.layers[layerIndex];
    const seen = new Set<string>();
    const bounds: StaffInkBounds[] = [];
    for (const current of layer.measures) for (const clef of [current.clef, ...current.clefChanges.map((change) => change.clef)]) {
      const {keySignature, timeSignature} = current.measure;
      const key = JSON.stringify([clef, keySignature, timeSignature]);
      if (seen.has(key)) continue;
      seen.add(key);
      const stave = new Stave(20, 0, this.headerWidth - 20, {left_bar: false, right_bar: false}).setContext(ctx);
      stave.addClef(clefName(clef), undefined, clef.octaveChange === 1 ? '8va' : clef.octaveChange === -1 ? '8vb' : undefined)
        .addKeySignature(keyName(keySignature.fifths)).addTimeSignature(`${timeSignature.numerator}/${timeSignature.denominator}`);
      const group = ctx.openGroup('staff-header-measurement');
      stave.draw(); ctx.closeGroup();
      bounds.push(...this.pathInk(group, undefined));
      group.remove();
    }
    // A hidden/detached browser surface is measured again on reveal. Nonvisual
    // DOM callers retain a conservative header envelope until then.
    return bounds.length ? bounds : [{left: 0, right: this.headerWidth, top: 10, bottom: 110}];
  }

  private drawConnections(): void {
    const ctx = this.context;
    ctx.openGroup('staff-system').dataset.webscoreSystemBars = '';
    for (let index = 1; index < this.projection.layers.length; index += 1) {
      if (this.projection.layers[index - 1].partIndex !== this.projection.layers[index].partIndex) continue;
      for (const [measureIndex, measure] of this.measures.entries()) {
        const source = this.projection.measures[measureIndex].source;
        if (source?.barlineStart) drawStaffBarline(ctx, source.barlineStart, measure.x, this.rowY[index - 1] + 80, this.rowY[index] + 40, true);
        drawStaffBarline(ctx, source?.barlineEnd ?? 'regular', measure.end, this.rowY[index - 1] + 80, this.rowY[index] + 40, true);
      }
    }
    ctx.closeGroup();
  }
  private drawHeader(index: number, quarter = this.projection.measures[index]?.startQuarters.toFloat() ?? 0): void {
    if (!this.projection.measures.length) return;
    const activeClefs = this.projection.layers.map((layer) => {
      let clef = layer.measures[index].clef;
      for (const change of layer.clefChanges) if (change.onsetQuarters.toFloat() <= quarter) clef = change.clef; else break;
      return clef;
    });
    const key = JSON.stringify([index, activeClefs]);
    if (key === this.currentHeader) return;
    this.currentHeader = key;
    const ctx = this.headerContext;
    ctx.clear(); ctx.setFillStyle(INK).setStrokeStyle(INK);
    const measure = this.projection.measures[index];
    const staves = this.projection.layers.map((_layer, i) => {
      const stave = new Stave(20, this.rowY[i], this.headerWidth - 20, {left_bar: false, right_bar: false}).setContext(ctx);
      stave.setStyle({fillStyle: INK, strokeStyle: INK});
      const clef = activeClefs[i];
      stave.addClef(clefName(clef), undefined, clef.octaveChange === 1 ? '8va' : clef.octaveChange === -1 ? '8vb' : undefined).addKeySignature(keyName(measure.keySignature.fifths));
      stave.addTimeSignature(`${measure.timeSignature.numerator}/${measure.timeSignature.denominator}`);
      const group = ctx.openGroup('staff-header-clef');
      group.dataset.webscoreHeaderClef = `${clef.sign}${clef.line ?? ''}`;
      group.dataset.webscoreStaffLayerIndex = String(i);
      stave.draw(); ctx.closeGroup(); return stave;
    });
    if (staves.length > 1) {
      ctx.openGroup('staff-system-connector').dataset.webscoreSystemConnector = '';
      new StaveConnector(staves[0], staves[staves.length - 1]).setType('singleLeft').setContext(ctx).draw();
      ctx.closeGroup();
    }
    for (let start = 0; start < staves.length;) {
      let end = start + 1;
      while (end < staves.length && this.projection.layers[end].partIndex === this.projection.layers[start].partIndex) end += 1;
      if (end - start > 1) {
        ctx.openGroup('staff-system-brace').dataset.webscoreSystemBrace = '';
        new StaveConnector(staves[start], staves[end - 1]).setType('brace').setContext(ctx).draw();
        ctx.closeGroup();
      }
      start = end;
    }
    ctx.resize(this.headerWidth * this.scale, this.height).setViewBox(0, 0, this.headerWidth, this.height / this.scale);
    setExplicitSize(ctx.svg, this.headerWidth * this.scale, this.height);
  }
  private xAtQuarter(quarter: number): number {
    if (!this.anchors.length) return this.headerWidth;
    let low = 0; let high = this.anchors.length;
    while (low < high) { const middle = (low + high) >>> 1; if (this.anchors[middle].quarter <= quarter) low = middle + 1; else high = middle; }
    const before = this.anchors[Math.max(0, low - 1)]; const after = this.anchors[low];
    if (!after || after.quarter === before.quarter) return before.x;
    return before.x + (after.x - before.x) * Math.max(0, (quarter - before.quarter) / (after.quarter - before.quarter));
  }
  private follow(x: number, quarter: number): void {
    if (quarter <= 0) { this.viewport.scrollLeft = 0; return; }
    const width = this.viewport.clientWidth || this.container.getBoundingClientRect().width;
    if (!(width > 0)) return;
    const inset = this.headerWidth * this.scale;
    const outside = x < this.viewport.scrollLeft + inset || x > this.viewport.scrollLeft + width - this.config.noteHeight * 2;
    const mode = this.staffConfig.scrollType ?? ScrollType.PAGE;
    if (mode === ScrollType.NOTE) this.viewport.scrollLeft = Math.max(0, x - inset - (width - inset) / 2);
    else if (outside) {
      const measure = this.measures.find((measure) => measure.start <= quarter && quarter < measure.stop);
      const bar = mode === ScrollType.BAR && measure ? measure.x * this.scale : x - inset - this.config.noteHeight * 2;
      this.viewport.scrollLeft = Math.max(0, x - bar < width - this.config.noteHeight * 2 ? bar : x - inset - this.config.noteHeight * 2);
    }
  }
  private paintViewport(): void {
    if (this.disposed || !this.context) return;
    const scroll = this.viewport.scrollLeft;
    this.context.svg.style.clipPath = `inset(0 0 0 ${scroll + this.headerWidth * this.scale}px)`;
    let measure = 0;
    for (let i = 1; i < this.measures.length; i += 1) if (this.measures[i].x * this.scale <= scroll) measure = i; else break;
    const leftEdge = (scroll + this.headerWidth * this.scale) / this.scale;
    let quarter = this.measures[measure]?.start ?? 0;
    for (const anchor of this.anchors) if (anchor.x <= leftEdge) quarter = anchor.quarter; else break;
    this.drawHeader(measure, quarter);
    if (!this.playhead || this.position === undefined) return;
    const x = this.xAtQuarter(secondsToQuarters(this.noteSequence.tempos, Math.max(0, this.position))) * this.scale - scroll;
    const width = this.viewport.clientWidth || this.container.getBoundingClientRect().width;
    this.playhead.hidden = this.position < 0 || this.position > this.noteSequence.totalTime || x < this.headerWidth * this.scale || (width > 0 && x > width);
    this.playhead.style.left = `${x}px`;
    this.playhead.dataset.time = String(this.position);
  }
}

/** Compatibility for direct sequence renderers; the public factory passes Score. */
function scoreFromSequence(sequence: ScoreNoteSequence): Score {
  const builder = new ScoreBuilder();
  const parts = new Map<number, ReturnType<typeof PartId>>();
  sequence.notes.forEach((note, index) => {
    const partIndex = note.part ?? note.instrument ?? 0;
    let part = parts.get(partIndex);
    if (!part) { part = PartId(`sequence-part-${partIndex}`); builder.addPart({id: part, name: sequence.partInfos.find((info) => info.part === partIndex)?.name ?? '', staves: Math.max(1, ...sequence.notes.filter((other) => (other.part ?? other.instrument ?? 0) === partIndex).map((other) => other.staff ?? 1))}); parts.set(partIndex, part); }
    const start = secondsToQuarters(sequence.tempos, note.startTime);
    const end = secondsToQuarters(sequence.tempos, note.endTime);
    builder.addNote(part, {id: NoteId(note.noteId ?? `sequence-${index}`), pitch: Pitch.fromMidi(note.pitch), onsetQuarters: Rational.from(start), duration: new Duration({base: Rational.from(end - start)}), voice: VoiceId(String(note.voice ?? 1)), staff: note.staff});
  });
  for (const tempo of sequence.tempos) builder.addTempo({atQuarters: Rational.from(secondsToQuarters(sequence.tempos, tempo.time)), bpm: tempo.qpm});
  sequence.timeSignatures.forEach((meter, index) => builder.addMeter({atQuarters: Rational.from(secondsToQuarters(sequence.tempos, meter.time)), timeSignature: {numerator: meter.numerator, denominator: meter.denominator}, measureNumber: index + 1}));
  return builder.build();
}
