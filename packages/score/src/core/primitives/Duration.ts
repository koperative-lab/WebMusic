import {Rational} from './Rational';

export interface DurationOpts {
  /** Base value in quarters before dots and tuplet. quarter=1, eighth=1/2, whole=4. */
  base: Rational | number | readonly [number, number];
  /** Augmentation dots (0..4). */
  dots?: number;
  /** Tuplet ratio [actual, normal], e.g. [3, 2] for a triplet (3 in the time of 2). */
  tuplet?: readonly [number, number];
}

/**
 * A notated duration, expressed in quarter notes (tempo-independent).
 * Dotted and tuplet logic are folded into a single Rational `quarters`.
 */
export class Duration {
  readonly base: Rational;
  readonly dots: number;
  readonly tuplet: readonly [number, number];
  /** Final sounding length in quarter notes. */
  readonly quarters: Rational;

  constructor(opts: DurationOpts) {
    this.base = Rational.from(opts.base);
    this.dots = opts.dots ?? 0;
    // `Duration` is an immutable value object. Do not retain the caller's
    // tuple array: `Object.freeze(this)` is shallow, so doing so would let a
    // later external mutation make `toJSON().tuplet` disagree with the
    // already-computed `quarters` value.
    const tuplet = opts.tuplet ?? [1, 1] as const;
    if (this.base.lt(Rational.ZERO)) throw new RangeError('duration base must not be negative');
    if (!Number.isInteger(this.dots) || this.dots < 0 || this.dots > 4) {
      throw new RangeError('dots must be an integer from 0 to 4');
    }
    if (
      !Number.isSafeInteger(tuplet[0]) ||
      !Number.isSafeInteger(tuplet[1]) ||
      tuplet[0] <= 0 ||
      tuplet[1] <= 0
    ) {
      throw new RangeError('tuplet ratio must contain positive integers');
    }
    this.tuplet = Object.freeze([tuplet[0], tuplet[1]]) as readonly [number, number];

    // dotted factor = 1 + 1/2 + 1/4 + ... for `dots` terms
    let mul = Rational.ONE;
    let inc = Rational.ONE;
    for (let i = 0; i < this.dots; i++) {
      inc = inc.div(new Rational(2, 1));
      mul = mul.add(inc);
    }
    this.quarters = this.base.mul(mul).mul(new Rational(this.tuplet[1], this.tuplet[0]));
    Object.freeze(this);
  }

  static whole() {
    return new Duration({base: 4});
  }
  static half() {
    return new Duration({base: 2});
  }
  static quarter() {
    return new Duration({base: 1});
  }
  static eighth() {
    return new Duration({base: [1, 2]});
  }
  static sixteenth() {
    return new Duration({base: [1, 4]});
  }
  static thirtySecond() {
    return new Duration({base: [1, 8]});
  }
  static dotted(d: Duration, dots = 1) {
    return new Duration({base: d.base, dots, tuplet: d.tuplet});
  }
  static triplet(d: Duration) {
    return new Duration({base: d.base, dots: d.dots, tuplet: [3, 2]});
  }

  /** Seconds at a constant tempo (bpm refers to a quarter note). */
  toSeconds(bpm: number): number {
    if (!Number.isFinite(bpm) || bpm <= 0) {
      throw new RangeError('bpm must be a finite positive number');
    }
    return (this.quarters.toFloat() * 60) / bpm;
  }

  toJSON() {
    return {base: this.base.toJSON(), dots: this.dots, tuplet: this.tuplet};
  }

  static fromJSON(json: {base: readonly [number, number]; dots: number; tuplet: readonly [number, number]}): Duration {
    return new Duration({base: json.base, dots: json.dots, tuplet: json.tuplet});
  }
}
