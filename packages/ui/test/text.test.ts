import {describe, expect, it, vi} from 'vitest';
import {formatNumber, formatPercent, formatTime, readText, textValue} from '../src/text';

describe('external text boundary', () => {
  it('renders final text literally and passes raw context to application callbacks', () => {
    expect(textValue('Caller {value}', 'Default', {value: 3})).toBe('Caller {value}');
    const render = vi.fn(({count}: {count: number}) => `external(${count})`);
    expect(textValue(render, 'Default', {count: 3})).toBe('external(3)');
    expect(render).toHaveBeenCalledWith({count: 3});
  });

  it('falls back and reports failed external inputs without taking over their state', async () => {
    const onError = vi.fn(async () => { throw new Error('report failed'); });
    const failed = () => { throw new Error('external failure'); };
    expect(readText(failed, onError)).toBeUndefined();
    expect(textValue(failed, 'Default', {}, onError)).toBe('Default');
    expect(formatNumber({number: failed}, 1.25, '1.25', onError)).toBe('1.25');
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it('passes unrounded fractions and seconds to formatters while retaining existing defaults', () => {
    const percent = vi.fn(value => `${value}`);
    const time = vi.fn(value => `${value}s`);
    expect(formatPercent({percent}, 1 / 3)).toBe(String(1 / 3));
    expect(percent).toHaveBeenCalledWith(1 / 3);
    expect(formatTime({time}, 61.5)).toBe('61.5s');
    expect(time).toHaveBeenCalledWith(61.5);
    expect(formatTime(undefined, 61.5)).toBe('1:01');
  });
});
