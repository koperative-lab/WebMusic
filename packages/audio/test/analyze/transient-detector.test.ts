import {describe, expect, it} from 'vitest';
import {createTransientDetector} from '../../src/analyze/headless/transient';

function input(time: number, value: number, rms = 0.2) {
  return {time, rms, frequencyData: new Uint8Array(16).fill(value)};
}

describe('createTransientDetector', () => {
  it('uses a baseline frame, fires on a rising attack and reports a later interval', () => {
    const detector = createTransientDetector();
    expect(detector.observe(input(0, 20)).hit).toBe(false);
    const first = detector.observe(input(50, 100));
    expect(first.hit).toBe(true);
    expect(first.strength).toBeGreaterThan(first.threshold);
    expect(detector.observe(input(100, 100)).hit).toBe(false);
    expect(detector.observe(input(150, 10)).hit).toBe(false);
    const second = detector.observe(input(250, 100));
    expect(second.hit).toBe(true);
    expect(second.intervalMs).toBe(200);
  });

  it('gates silence, respects refractory time and resets source history', () => {
    const detector = createTransientDetector();
    detector.observe(input(0, 10));
    expect(detector.observe(input(50, 200, 0)).hit).toBe(false);
    detector.observe(input(100, 10, 0));
    expect(detector.observe(input(150, 200)).hit).toBe(true);
    detector.observe(input(200, 10));
    expect(detector.observe(input(250, 200)).hit).toBe(false);
    detector.reset();
    expect(detector.observe(input(300, 200)).hit).toBe(false);
  });

  it('rejects unusable frames instead of presenting fake zeroes', () => {
    const detector = createTransientDetector();
    expect(() => detector.observe({time: Number.NaN, rms: 0, frequencyData: new Uint8Array(1)})).toThrow(TypeError);
    expect(() => detector.observe({time: 0, rms: 0, frequencyData: new Uint8Array()})).toThrow(TypeError);
    expect(() => detector.observe(input(0, 10, -1))).toThrow(TypeError);
    expect(() => detector.observe(input(0, 10), Number.NaN)).toThrow(TypeError);
    expect(() => detector.observe(input(0, 10), .5, Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});
