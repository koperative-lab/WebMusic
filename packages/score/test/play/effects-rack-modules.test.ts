import {describe, expect, it} from 'vitest';
import {Effect, Rack} from '../../src/play/headless';
import {Effect as EffectFacade} from '../../src/play/headless/effects';
import {makeBitcrushCurve, makeDistortionCurve} from '../../src/play/headless/effects/builders';
import {Rack as RackFacade} from '../../src/play/headless/rack';
import {clampRackVolume, rackMemberGain} from '../../src/play/headless/rack/mixer';

describe('effects and rack module boundaries', () => {
  it('keeps the headless public entry on the stable facades', () => {
    expect(Effect).toBe(EffectFacade);
    expect(Rack).toBe(RackFacade);
  });

  it('builds finite, bounded DSP curves independently of AudioContext', () => {
    const crushed = makeBitcrushCurve(4);
    expect(crushed).toHaveLength(1024);
    expect(new Set(crushed).size).toBeLessThanOrEqual(16);
    expect([...crushed].every((value) => Number.isFinite(value) && value >= -1 && value <= 1)).toBe(true);

    const distorted = makeDistortionCurve(0.4);
    expect(distorted).toHaveLength(1024);
    expect([...distorted].every(Number.isFinite)).toBe(true);
  });

  it('calculates member volume, mute, and solo gating without audio nodes', () => {
    const member = {volume: 0.7, muted: false, solo: false};
    expect(rackMemberGain(member, false)).toBe(0.7);
    expect(rackMemberGain(member, true)).toBe(0);
    expect(rackMemberGain({...member, solo: true}, true)).toBe(0.7);
    expect(rackMemberGain({...member, muted: true, solo: true}, true)).toBe(0);
    expect(clampRackVolume(-1)).toBe(0);
    expect(clampRackVolume(2)).toBe(1);
  });
});
