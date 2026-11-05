import {Part, Rational, Score, TimeMap} from '@webmusic/score';
import {loadScoreFromUrl} from '@webmusic/score/io';

export type ArabesqueFormat = 'midi' | 'mxl';

const paths: Record<ArabesqueFormat, string> = {
  midi: 'midi/Arabesque%20No.1.mid',
  mxl: 'mxl/Arabesque%20No.1.mxl',
};
const loads = new Map<ArabesqueFormat, Promise<Score>>();

export function arabesqueUrl(format: ArabesqueFormat = 'midi'): string {
  return `${import.meta.env.BASE_URL}${paths[format]}`;
}

export function loadArabesqueScore(format: ArabesqueFormat = 'midi'): Promise<Score> {
  const cached = loads.get(format);
  if (cached) return cached;
  const pending = loadScoreFromUrl(arabesqueUrl(format), {format})
    .then((score) => score.withMetadata({title: 'Arabesque No. 1', composer: 'Claude Debussy'}))
    .catch((error: unknown) => {
      if (loads.get(format) === pending) loads.delete(format);
      throw error;
    });
  loads.set(format, pending);
  return pending;
}

/** Keep an opening passage for quick controls without inventing new notes. */
export function arabesqueExcerpt(score: Score, quarters = 16): Score {
  const end = new Rational(quarters);
  const notesAndMeasures = score.edit((edit) => {
    for (const part of score.parts) {
      for (const note of part.notes) {
        if (note.onsetQuarters.gte(end)) edit.removeNote(note.id);
      }
    }
    for (const measure of score.measures) {
      if (measure.onsetQuarters.gte(end)) edit.removeMeasure(measure.id);
    }
  });
  return new Score({
    id: notesAndMeasures.id,
    metadata: notesAndMeasures.metadata,
    parts: notesAndMeasures.parts.map((part) => new Part({
      ...part,
      directions: part.directions?.filter((direction) => direction.onsetQuarters.lt(end)),
      clefChanges: part.clefChanges?.filter((change) => change.onsetQuarters.lt(end)),
    })),
    measures: notesAndMeasures.measures,
    timeMap: new TimeMap(
      notesAndMeasures.timeMap.tempi.filter((entry) => entry.atQuarters.lt(end)),
      notesAndMeasures.timeMap.meters.filter((entry) => entry.atQuarters.lt(end)),
      notesAndMeasures.measures,
    ),
  });
}
