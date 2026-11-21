// The blank score a View or Analyze Element draws before its data arrives
// (DEC-082). Internal: not exported from the core barrel.
import {Rational} from '../primitives/Rational';
import type {Score} from './Score';
import {ScoreBuilder} from './ScoreBuilder';

let empty: Score | undefined;

/**
 * A score with nothing in it — one unnamed part and one empty 4/4 bar — so a
 * staff, a roll, a waterfall or an analysis lane has a blank surface to draw.
 */
export function emptyScore(): Score {
  if (empty) return empty;
  const builder = new ScoreBuilder();
  builder.addPart({id: builder.newPartId(), name: ''});
  builder.addMeasure({id: builder.newMeasureId(), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: Rational.from(4),
    timeSignature: {numerator: 4, denominator: 4}});
  return empty = builder.build();
}
