import type {PartDirection, Score} from '../../core';

/** Source expression on the score's musical axis; no layout or playback state. */
export interface ScoreAnnotation {
  readonly partId: string;
  readonly source: PartDirection;
  readonly startQuarters: number;
  readonly endQuarters?: number;
  readonly endSource?: PartDirection;
  readonly changes: readonly number[];
  readonly label: string;
}

function label(direction: PartDirection): string {
  switch (direction.kind) {
    case 'words': case 'rehearsal': return direction.text;
    case 'dynamics': return direction.values.join(' ');
    case 'pedal': return direction.sign === false ? 'Pedal' : 'Ped.';
    case 'wedge': return direction.type === 'diminuendo' ? 'dim.' : 'cresc.';
    case 'metronome': {
      const unit = direction.beatUnit.base.toFloat();
      const name = unit === 4 ? '𝅝' : unit === 2 ? '𝅗𝅥' : unit === 1 ? '♩' : unit === .5 ? '♪' : `1/${4 / unit}`;
      const text = `${name}${'·'.repeat(direction.beatUnit.dots)} = ${direction.perMinute}`;
      return direction.parentheses ? `(${text})` : text;
    }
  }
}

/** Pair expression spans within each part/staff/number, including hidden stops. */
export function projectScoreAnnotations(score: Score, options: {part?: string} = {}): readonly ScoreAnnotation[] {
  const annotations: ScoreAnnotation[] = [];
  for (const part of score.parts) {
    if (options.part !== undefined && part.id !== options.part && part.name !== options.part) continue;
    const open = new Map<string, {source: PartDirection; changes: number[]}>();
    const append = (source: PartDirection, endSource?: PartDirection, changes: number[] = []) => {
      if (source.printObject === false) return;
      annotations.push({
        partId: part.id, source, label: label(source), changes,
        startQuarters: source.onsetQuarters.toFloat(),
        ...(source.kind === 'pedal' || source.kind === 'wedge' ? {
          endQuarters: endSource?.onsetQuarters.toFloat() ?? score.durationQuarters.toFloat(), endSource,
        } : {}),
      });
    };
    for (const source of part.directions ?? []) {
      if (source.kind !== 'pedal' && source.kind !== 'wedge') { append(source); continue; }
      const key = `${source.kind}:${source.staff ?? 1}:${source.number ?? 1}`;
      const previous = open.get(key);
      if (source.type === 'continue') continue;
      if (source.type === 'change' && previous) { previous.changes.push(source.onsetQuarters.toFloat()); continue; }
      if (source.type === 'stop' || source.type === 'discontinue') {
        if (previous) { append(previous.source, source, previous.changes); open.delete(key); }
        continue;
      }
      if (previous) append(previous.source, source, previous.changes);
      open.set(key, {source, changes: []});
    }
    for (const span of open.values()) append(span.source, undefined, span.changes);
  }
  const part = score.parts.find((candidate) => options.part === undefined || candidate.id === options.part || candidate.name === options.part);
  if (part) for (const measure of score.measures) {
    if (!measure.rehearsal || score.parts.some((candidate) =>
      (options.part === undefined || candidate.id === options.part || candidate.name === options.part)
      && candidate.directions?.some((direction) => direction.kind === 'rehearsal'
        && direction.onsetQuarters.eq(measure.onsetQuarters) && direction.text === measure.rehearsal))) continue;
    annotations.push({partId: part.id,
      source: {kind: 'rehearsal', text: measure.rehearsal, onsetQuarters: measure.onsetQuarters},
      startQuarters: measure.onsetQuarters.toFloat(), changes: [], label: measure.rehearsal,
    });
  }
  return annotations.sort((a, b) => a.startQuarters - b.startQuarters);
}
