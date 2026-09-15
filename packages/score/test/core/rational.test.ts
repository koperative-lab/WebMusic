import {describe, expect, it} from 'vitest';
import {Rational} from '../../src/core';

describe('Rational', () => {
  it('reduces to lowest terms with positive denominator', () => {
    const r = new Rational(-6, -8);
    expect(r.num).toBe(3);
    expect(r.den).toBe(4);
  });

  it('1/3 + 1/3 + 1/3 = 1 exactly', () => {
    const third = new Rational(1, 3);
    expect(third.add(third).add(third).eq(Rational.ONE)).toBe(true);
  });

  it('supports basic arithmetic and ordering', () => {
    const a = new Rational(2, 3);
    const b = new Rational(3, 4);
    expect(a.mul(b).eq(new Rational(1, 2))).toBe(true);
    expect(a.div(b).eq(new Rational(8, 9))).toBe(true);
    expect(a.lt(b)).toBe(true);
    expect(b.gt(a)).toBe(true);
  });

  it('rejects zero denominator', () => {
    expect(() => new Rational(1, 0)).toThrow();
  });

  it('round-trips JSON', () => {
    const r = new Rational(7, 12);
    const back = Rational.from(r.toJSON());
    expect(back.eq(r)).toBe(true);
  });
});

describe('Rational overflow protection', () => {
  it('rejects unsafe-integer construction', () => {
    expect(() => new Rational(2 ** 53, 1)).toThrow(RangeError);
    expect(() => new Rational(1, 2 ** 53)).toThrow(RangeError);
  });

  it('add/sub/mul throw instead of silently overflowing', () => {
    const big = new Rational(2 ** 52, 1);
    expect(() => big.mul(big)).toThrow(RangeError);
    expect(() => big.add(Rational.ONE)).not.toThrow(); // safe case still works
  });

  it('comparison reduces by denominator gcd to stay safe', () => {
    const a = new Rational(1, 2 ** 26);
    const b = new Rational(3, 2 ** 26);
    expect(a.lt(b)).toBe(true);
    expect(b.gte(a)).toBe(true);
    expect(a.cmp(a)).toBe(0);
  });

  it('Rational.from throws on non-finite input', () => {
    expect(() => Rational.from(NaN)).toThrow(RangeError);
    expect(() => Rational.from(Infinity)).toThrow(RangeError);
    expect(() => Rational.from(-Infinity)).toThrow(RangeError);
  });

  it('Rational.from approximates floats via 1e6 denominator', () => {
    expect(Rational.from(0.5).eq(new Rational(1, 2))).toBe(true);
    expect(Rational.from(1 / 3).eq(new Rational(333333, 1000000))).toBe(true);
  });
});
