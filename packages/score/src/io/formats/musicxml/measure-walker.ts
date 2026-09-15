import { Rational } from '../../../core';
import {
  attrsOf,
  childList,
  childOf,
  childText,
  childrenOf,
  requireNumber,
  tagOf,
  type OrderedXmlNode,
} from './ordered-tree';

export interface MusicXmlNoteEvent {
  kind: 'note';
  node: OrderedXmlNode;
  onsetQuarters: Rational;
  durationQuarters: Rational;
  isChord: boolean;
  isRest: boolean;
  isGrace: boolean;
  voiceLabel: string;
}

export interface MusicXmlTempoEvent {
  kind: 'tempo';
  bpm: number;
  atQuarters: Rational;
}

export interface MusicXmlAttributesEvent {
  kind: 'attributes';
  node: OrderedXmlNode;
  /** Position of the declaration within this measure. */
  atQuarters: Rational;
}

export interface MusicXmlDirectionEvent {
  kind: 'direction';
  node: OrderedXmlNode;
  /** Exact position after applying the direction's signed offset. */
  atQuarters: Rational;
}

export type MusicXmlMeasureEvent = MusicXmlNoteEvent | MusicXmlTempoEvent | MusicXmlAttributesEvent | MusicXmlDirectionEvent;

/**
 * Walk one measure in document order. Explicit backup/forward elements use one
 * global cursor; legacy files without them retain independent voice cursors.
 */
export function walkMusicXmlMeasure(
  measure: OrderedXmlNode,
  state: { divisions: number },
  emit?: (event: MusicXmlMeasureEvent) => void,
): Rational {
  const elements = childrenOf(measure);
  const hasMoves = elements.some((element) => {
    const tag = tagOf(element);
    return tag === 'backup' || tag === 'forward';
  });
  let cursor = Rational.ZERO;
  const voiceCursors = new Map<string, Rational>();
  let maximum = Rational.ZERO;
  let lastOnset = Rational.ZERO;

  // Files that omit explicit <backup>/<forward> moves still commonly put a
  // direction or a second <attributes> after the preceding single voice. In
  // that compact form `cursor` remains at zero while `maximum` is the only
  // reliable musical position. Explicit moves, on the other hand, make the
  // document cursor authoritative (including after a backup).
  const declarationPosition = () => (hasMoves ? cursor : maximum);

  for (const element of elements) {
    const tag = tagOf(element);
    if (tag === 'attributes') {
      const divisions = childText(element, 'divisions');
      if (divisions != null) {
        state.divisions = requireNumber(divisions, '<divisions>') || 1;
      }
      emit?.({
        kind: 'attributes',
        node: element,
        atQuarters: declarationPosition(),
      });
      continue;
    }
    if (tag === 'backup' || tag === 'forward') {
      const duration = new Rational(
        requireNumber(childText(element, 'duration'), `<${tag}><duration>`),
        state.divisions,
      );
      cursor = tag === 'backup' ? cursor.sub(duration) : cursor.add(duration);
      if (cursor.lt(Rational.ZERO)) cursor = Rational.ZERO;
      if (cursor.gt(maximum)) maximum = cursor;
      continue;
    }
    if (tag === 'sound') {
      const tempo = attrsOf(element).tempo;
      if (tempo != null) {
        const offsetText = childText(element, 'offset');
        const offset = offsetText == null ? Rational.ZERO :
          new Rational(requireNumber(offsetText, '<sound><offset>'), state.divisions);
        emit?.({
          kind: 'tempo',
          bpm: requireNumber(tempo, '<sound tempo>'),
          atQuarters: declarationPosition().add(offset),
        });
      }
      continue;
    }
    if (tag === 'direction') {
      const offsetText = childText(element, 'offset');
      const offset =
        offsetText == null
          ? Rational.ZERO
          : new Rational(requireNumber(offsetText, '<direction><offset>'), state.divisions);
      emit?.({kind: 'direction', node: element, atQuarters: declarationPosition().add(offset)});
      for (const sound of childList(element, 'sound')) {
        const tempo = attrsOf(sound).tempo;
        if (tempo != null) {
          // MusicXML sound offsets override their enclosing direction offset.
          const soundOffsetText = childText(sound, 'offset');
          const soundOffset = soundOffsetText == null ? offset :
            new Rational(requireNumber(soundOffsetText, '<sound><offset>'), state.divisions);
          emit?.({
            kind: 'tempo',
            bpm: requireNumber(tempo, '<sound tempo>'),
            atQuarters: declarationPosition().add(soundOffset),
          });
        }
      }
      continue;
    }
    if (tag !== 'note') continue;

    const isGrace = childOf(element, 'grace') != null;
    const isChord = childOf(element, 'chord') != null;
    const isRest = childOf(element, 'rest') != null;
    const voiceLabel = childText(element, 'voice') ?? '1';
    const durationText = childText(element, 'duration');
    const durationQuarters =
      isGrace || durationText == null
        ? Rational.ZERO
        : new Rational(requireNumber(durationText, '<note><duration>'), state.divisions);
    const base = hasMoves ? cursor : (voiceCursors.get(voiceLabel) ?? Rational.ZERO);
    const onsetQuarters = isChord ? lastOnset : base;

    emit?.({
      kind: 'note',
      node: element,
      onsetQuarters,
      durationQuarters,
      isChord,
      isRest,
      isGrace,
      voiceLabel,
    });
    if (!isChord) lastOnset = onsetQuarters;
    if (!isChord && !isGrace) {
      const next = base.add(durationQuarters);
      if (hasMoves) cursor = next;
      else voiceCursors.set(voiceLabel, next);
      if (next.gt(maximum)) maximum = next;
    }
  }

  return maximum;
}
