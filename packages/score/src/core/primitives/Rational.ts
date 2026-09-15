import {gcd} from '../utils/gcd';

/**
 * Immutable rational number, always in lowest terms with a positive denominator.
 *
 * Used everywhere durations need to add exactly — triplets, tuplets, ties,
 * MusicXML offset accumulation. Float arithmetic accumulates error
 * (1/3 + 1/3 + 1/3 !== 1) and causes drift in long scores.
 */
export class Rational {
  readonly num: number;
  readonly den: number;

  constructor(num: number, den = 1) {
    if (!Number.isInteger(num) || !Number.isInteger(den)) {
      throw new TypeError('Rational requires integers');
    }
    if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
      throw new RangeError('Rational overflow: numerator/denominator exceeds safe integer range');
    }
    if (den === 0) throw new RangeError('Denominator cannot be zero');
    if (den < 0) {
      num = -num;
      den = -den;
    }
    const g = gcd(Math.abs(num), den);
    this.num = num / g;
    this.den = den / g;
    if (!Number.isSafeInteger(this.num) || !Number.isSafeInteger(this.den)) {
      throw new RangeError('Rational overflow: reduced value exceeds safe integer range');
    }
    Object.freeze(this);
  }

  static readonly ZERO = new Rational(0, 1);
  static readonly ONE = new Rational(1, 1);

  /**
   * Coerce a number, Rational, or [num, den] pair into a Rational.
   *
   * WARNING: non-integer floats are *approximated* by rounding against a fixed
   * 1e6 denominator (e.g. `Rational.from(1/3)` → 333333/1000000, not 1/3).
   * Prefer exact `[num, den]` pairs when the true ratio is known.
   * Throws on non-finite numbers (NaN / ±Infinity).
   */
  static from(value: number | Rational | readonly [number, number]): Rational {
    if (value instanceof Rational) return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new RangeError('Rational.from requires a finite number');
      }
      if (Number.isInteger(value)) return new Rational(value, 1);
      const den = 1_000_000;
      return new Rational(Math.round(value * den), den);
    }
    return new Rational(value[0], value[1]);
  }

  add(o: Rational): Rational {
    const left = this.num * o.den;
    const right = o.num * this.den;
    const den = this.den * o.den;
    if ([left, right, left + right, den].every(Number.isSafeInteger)) {
      return new Rational(left + right, den);
    }
    return fromExactIntegers(BigInt(this.num) * BigInt(o.den) + BigInt(o.num) * BigInt(this.den), BigInt(this.den) * BigInt(o.den));
  }
  sub(o: Rational): Rational {
    const left = this.num * o.den;
    const right = o.num * this.den;
    const den = this.den * o.den;
    if ([left, right, left - right, den].every(Number.isSafeInteger)) {
      return new Rational(left - right, den);
    }
    return fromExactIntegers(BigInt(this.num) * BigInt(o.den) - BigInt(o.num) * BigInt(this.den), BigInt(this.den) * BigInt(o.den));
  }
  mul(o: Rational): Rational {
    const num = this.num * o.num;
    const den = this.den * o.den;
    return Number.isSafeInteger(num) && Number.isSafeInteger(den)
      ? new Rational(num, den)
      : fromExactIntegers(BigInt(this.num) * BigInt(o.num), BigInt(this.den) * BigInt(o.den));
  }
  div(o: Rational): Rational {
    if (o.num === 0) throw new RangeError('Division by zero');
    const num = this.num * o.den;
    const den = this.den * o.num;
    return Number.isSafeInteger(num) && Number.isSafeInteger(den)
      ? new Rational(num, den)
      : fromExactIntegers(BigInt(this.num) * BigInt(o.den), BigInt(this.den) * BigInt(o.num));
  }

  neg(): Rational {
    return new Rational(-this.num, this.den);
  }

  eq(o: Rational): boolean {
    return this.num === o.num && this.den === o.den;
  }

  /**
   * Three-way comparison: -1 if this < o, 0 if equal, 1 if this > o.
   * Cross products are reduced by the denominators' gcd. Unsafe Number
   * intermediates use exact BigInt arithmetic instead of rounded comparisons.
   */
  cmp(o: Rational): -1 | 0 | 1 {
    const g = gcd(this.den, o.den);
    const a = this.num * (o.den / g);
    const b = o.num * (this.den / g);
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
      const exactA = BigInt(this.num) * BigInt(o.den);
      const exactB = BigInt(o.num) * BigInt(this.den);
      return exactA < exactB ? -1 : exactA > exactB ? 1 : 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }

  lt(o: Rational): boolean {
    return this.cmp(o) < 0;
  }
  lte(o: Rational): boolean {
    return this.cmp(o) <= 0;
  }
  gt(o: Rational): boolean {
    return this.cmp(o) > 0;
  }
  gte(o: Rational): boolean {
    return this.cmp(o) >= 0;
  }
  isZero(): boolean {
    return this.num === 0;
  }
  sign(): -1 | 0 | 1 {
    return this.num === 0 ? 0 : this.num > 0 ? 1 : -1;
  }

  toFloat(): number {
    return this.num / this.den;
  }
  toString(): string {
    return this.den === 1 ? `${this.num}` : `${this.num}/${this.den}`;
  }
  toJSON(): readonly [number, number] {
    return [this.num, this.den] as const;
  }
}

/** Reduce exactly before converting back to the public safe-integer model. */
function fromExactIntegers(num: bigint, den: bigint): Rational {
  if (den < 0n) { num = -num; den = -den; }
  let a = num < 0n ? -num : num;
  let b = den;
  while (b !== 0n) [a, b] = [b, a % b];
  num /= a;
  den /= a;
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (num < -maximum || num > maximum || den > maximum) {
    throw new RangeError('Rational overflow: reduced value exceeds safe integer range');
  }
  return new Rational(Number(num), Number(den));
}
