import {describe, expect, it} from 'vitest';
import {getStaffOverlap, type StaffInkBounds} from '../../src/view/render/renderers/staff-spacing';

const options = {rowDistance: 100, upperBottomLine: 40, lowerTopLine: 20, noteHeight: 6};
const box = (left: number, right: number, top: number, bottom: number): StaffInkBounds => ({left, right, top, bottom});

describe('compact staff spacing', () => {
  it('reaches the target gap when separated note columns leave room', () => {
    const upper = [box(0, 300, 16, 40), box(40, 48, 30, 58)];
    const lower = [box(0, 300, 20, 44), box(220, 228, 2, 28)];
    const overlap = getStaffOverlap(upper, lower, options);
    expect(overlap).toBe(56);
    expect(options.rowDistance - overlap + options.lowerTopLine - options.upperBottomLine).toBe(24);
  });

  it('retains clearance for stems and ledger notes in the same column', () => {
    const upper = [box(0, 300, 16, 40), box(40, 48, 30, 68)];
    const lower = [box(0, 300, 20, 44), box(42, 50, -6, 28)];
    const overlap = getStaffOverlap(upper, lower, options);
    expect(overlap).toBe(20);
    expect(options.rowDistance - overlap + lower[1].top - upper[1].bottom).toBe(6);
  });

  it('preserves the existing layout when the available clearance is already small', () => {
    expect(getStaffOverlap([box(0, 10, 0, 96)], [box(0, 10, 0, 24)], options)).toBe(0);
    expect(getStaffOverlap([box(0, 10, 0, 20)], [box(0, 10, 0, 24)], {...options, rowDistance: 44})).toBe(0);
  });

  it('includes zero-width stems and zero-height staff lines', () => {
    const upper = [box(0, 300, 40, 40), box(70, 70, 20, 80)];
    const lower = [box(0, 300, 20, 20), box(70, 70, -10, 30)];
    expect(getStaffOverlap(upper, lower, options)).toBe(4);
  });

  it('remains conservative for very long scores and does not mutate measured geometry', () => {
    const upper = Object.freeze([Object.freeze(box(0, 1e9, 40, 40)), Object.freeze(box(50e6, 50e6 + 10, 20, 80))]);
    const lower = Object.freeze([Object.freeze(box(0, 1e9, 20, 20)), Object.freeze(box(50e6 + 5, 50e6 + 15, -10, 20))]);
    expect(getStaffOverlap(upper, lower, options)).toBe(4);
  });

  it('never packs beyond the exact collision bound across many note columns', () => {
    const upper = Array.from({length: 128}, (_, index) => {
      const left = (index * 137) % 1800 - 500;
      const top = 10 + index % 9 * 4;
      return box(left, left + 8 + index % 5, top, top + 18);
    });
    const lower = Array.from({length: 128}, (_, index) => {
      const left = (index * 83) % 1800 - 500;
      const top = -10 + index % 8 * 3;
      return box(left, left + 8 + index % 7, top, top + 16);
    });
    const overlap = getStaffOverlap(upper, lower, options);
    expect(overlap).toBeGreaterThan(0);
    for (const before of upper) for (const after of lower) {
      if (before.left - options.noteHeight / 2 > after.right + options.noteHeight / 2 ||
        after.left - options.noteHeight / 2 > before.right + options.noteHeight / 2) continue;
      expect(options.rowDistance - overlap + after.top - before.bottom).toBeGreaterThanOrEqual(options.noteHeight);
    }
  });

  it('skips compaction when measurements are missing or invalid', () => {
    const ink = [box(0, 30, 0, 40)];
    expect(getStaffOverlap([], ink, options)).toBe(0);
    expect(getStaffOverlap(ink, [], options)).toBe(0);
    expect(getStaffOverlap([box(10, 0, 0, 40)], ink, options)).toBe(0);
    expect(getStaffOverlap([box(0, 30, NaN, 40)], ink, options)).toBe(0);
    expect(getStaffOverlap(ink, ink, {...options, noteHeight: 0})).toBe(0);
    expect(getStaffOverlap(ink, ink, {...options, rowDistance: Infinity})).toBe(0);
  });
});
