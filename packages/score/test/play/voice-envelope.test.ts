import {describe, expect, it, vi} from 'vitest';
import {VoiceEnvelope, envelopeSettings} from '../../src/play/headless/internal/voice-envelope';

function fixture(duration = Infinity, options = {}) {
  const param = {
    value: 999, // Deliberately unrelated to the scheduled contour.
    setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn(),
  };
  const settings = envelopeSettings({attackSeconds: 1, decaySeconds: 1, sustainLevel: 0.25, releaseSeconds: 0.5, ...options}, 0.01, 0.1);
  const envelope = new VoiceEnvelope(param as unknown as AudioParam, 2, 0.8, settings, duration);
  return {param, envelope};
}

describe('per-occurrence linear ADSR', () => {
  it('schedules attack, decay and held sustain without a finite release', () => {
    const {param, envelope} = fixture();
    expect(param.linearRampToValueAtTime.mock.calls).toEqual([[0.8, 3], [0.2, 4]]);
    expect([1, 2.5, 3.5, 7].map((time) => envelope.valueAt(time))).toEqual([0, 0.4, 0.5, 0.2]);
  });

  it.each([[2.5, 0.4], [3.5, 0.5], [5, 0.2]])('releases at %s from the scheduled stage value %s', (time, level) => {
    const {param, envelope} = fixture();
    expect(envelope.release(time)).toBe(time + 0.5);
    expect(param.linearRampToValueAtTime.mock.calls.slice(-2)).toEqual([[level, time], [0, time + 0.5]]);
    expect(envelope.valueAt(time + 0.25)).toBeCloseTo(level / 2);
    expect(envelope.valueAt(time + 0.5)).toBe(0);
  });

  it('releases short finite notes from attack and cancels future decay', () => {
    const {param} = fixture(0.25);
    expect(param.linearRampToValueAtTime.mock.calls).toEqual([[0.2, 2.25], [0, 2.75]]);
  });

  it('supports exact zero stages and a silent sustain without an exponential floor', () => {
    const {param, envelope} = fixture(1, {attackSeconds: 0, decaySeconds: 0, sustainLevel: 0, releaseSeconds: 0});
    expect(param.setValueAtTime).toHaveBeenCalledWith(0, 2);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0, 3);
    expect(envelope.valueAt(2.5)).toBe(0);
  });

  it('reaches the attack peak before an instantaneous decay to a lower sustain', () => {
    const {param, envelope} = fixture(Infinity, {decaySeconds: 0});
    expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 3);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.2, 3);
    expect(envelope.valueAt(2.5)).toBe(0.4);
    expect(envelope.valueAt(3)).toBe(0.2);
    param.linearRampToValueAtTime.mockClear();
    envelope.release(3);
    expect(param.linearRampToValueAtTime.mock.calls).toEqual([[0.8, 3], [0, 3.5]]);
    expect(param.setValueAtTime).toHaveBeenLastCalledWith(0.2, 3);
  });

  it('retimes a gate before its end without retaining the original release', () => {
    const {param, envelope} = fixture(3);
    param.linearRampToValueAtTime.mockClear();
    envelope.retime(8, 3.5);
    expect(param.cancelScheduledValues).toHaveBeenLastCalledWith(3.5);
    expect(param.linearRampToValueAtTime.mock.calls).toEqual([[0.5, 3.5], [0.2, 4], [0.2, 8], [0, 8.5]]);
    expect(envelope.valueAt(6)).toBe(0.2);
  });

  it('rejects malformed settings before scheduling', () => {
    for (const options of [{attackSeconds: -1}, {decaySeconds: NaN}, {sustainLevel: 2}, {releaseSeconds: Infinity}]) {
      expect(() => fixture(Infinity, options)).toThrow(/Invalid envelope/);
    }
  });
});
