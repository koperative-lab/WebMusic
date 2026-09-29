import {describe, expect, it} from 'vitest';
import {formatTime, parseLoopAttr} from '../../src/play/core/format';

describe('formatTime', () => {
  it('formats whole seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
  });

  it('floors fractional seconds', () => {
    expect(formatTime(9.9)).toBe('0:09');
    expect(formatTime(59.99)).toBe('0:59');
  });

  it('clamps negatives to 0:00', () => {
    expect(formatTime(-5)).toBe('0:00');
  });
});

describe('parseLoopAttr', () => {
  it('treats null as no loop', () => {
    expect(parseLoopAttr(null)).toBe(false);
  });

  it('treats empty / "true" / "loop" as whole-clip loop', () => {
    expect(parseLoopAttr('')).toBe(true);
    expect(parseLoopAttr('true')).toBe(true);
    expect(parseLoopAttr('loop')).toBe(true);
    expect(parseLoopAttr('  ')).toBe(true); // trimmed to empty
  });

  it('treats "false" as no loop', () => {
    expect(parseLoopAttr('false')).toBe(false);
  });

  it('parses an A-B window with several separators', () => {
    expect(parseLoopAttr('1.5-3.0')).toEqual({start: 1.5, end: 3.0});
    expect(parseLoopAttr('2:4')).toEqual({start: 2, end: 4});
    expect(parseLoopAttr('0.25, 0.75')).toEqual({start: 0.25, end: 0.75});
  });

  it('rejects a window where end <= start', () => {
    expect(parseLoopAttr('4-2')).toBe(false);
    expect(parseLoopAttr('2-2')).toBe(false);
  });

  it('rejects malformed windows', () => {
    expect(parseLoopAttr('abc')).toBe(false);
    expect(parseLoopAttr('1-')).toBe(false);
  });
});
