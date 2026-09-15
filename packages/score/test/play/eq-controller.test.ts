import {describe, expect, it, vi} from "vitest";
import {
  EqController,
  eqFrequencyToX,
  eqGainToY,
  eqXToFrequency,
  eqYToGain,
} from "../../src/play/headless/eq";

function node(extra: Record<string, unknown> = {}) {
  return Object.assign({connect: vi.fn(), disconnect: vi.fn()}, extra);
}

function context(sampleRate = 48_000) {
  const gains = [node(), node()];
  const filters: ReturnType<typeof node>[] = [];
  const value = {
    sampleRate,
    createGain: vi.fn(() => gains.shift()!),
    createBiquadFilter: vi.fn(() => {
      const filter = node({
        type: "lowpass",
        frequency: {value: 0},
        gain: {value: 0},
        Q: {value: 0},
        getFrequencyResponse: vi.fn((frequencies: Float32Array, magnitude: Float32Array) => {
          frequencies.forEach((frequency, index) => {
            magnitude[index] = frequency >= 0 && frequency <= sampleRate / 2 ? 1 : NaN;
          });
        }),
      });
      filters.push(filter);
      return filter;
    }),
  };
  return {value: value as unknown as AudioContext, filters, gains};
}

describe("EqController", () => {
  it("owns a transactional peaking-filter graph on a borrowed context", () => {
    const audio = context();
    const controller = new EqController({
      context: audio.value,
      bands: [{frequency: 1_000, gain: 4, q: 0.7}],
    });

    expect(audio.filters).toHaveLength(1);
    expect(audio.filters[0].type).toBe("peaking");
    expect((audio.filters[0].frequency as {value: number}).value).toBe(1_000);
    expect(controller.snapshot().response).toHaveLength(64);
    expect(controller.input).toBeDefined();
    expect(controller.output).toBeDefined();

    controller.dispose();
    expect(audio.filters[0].disconnect).toHaveBeenCalledTimes(1);
  });

  it("updates a band in place and notifies subscribers", () => {
    const audio = context();
    const controller = new EqController({context: audio.value, bands: [{frequency: 100}]});
    const notify = vi.fn();
    controller.subscribe(notify);
    controller.setBand(0, {frequency: 2_000, gain: -5});

    expect(controller.snapshot().bands[0]).toMatchObject({frequency: 2_000, gain: -5});
    expect((audio.filters[0].frequency as {value: number}).value).toBe(2_000);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("leaves the current graph usable when a replacement build fails", () => {
    const first = context();
    const controller = new EqController({context: first.value, bands: [{frequency: 100}]});
    const previousInput = controller.input;
    const failure = new Error("filter failed");
    const broken = {
      createGain: vi.fn(() => node()),
      createBiquadFilter: vi.fn(() => {
        throw failure;
      }),
    } as unknown as AudioContext;

    expect(() => controller.setContext(broken)).toThrow(failure);
    expect(controller.context).toBe(first.value);
    expect(controller.input).toBe(previousInput);
  });

  it("maps logarithmic frequency and gain coordinates round-trip", () => {
    expect(eqFrequencyToX(30)).toBe(0);
    expect(eqFrequencyToX(18_000)).toBe(1);
    expect(eqXToFrequency(0.5)).toBeCloseTo(Math.sqrt(30 * 18_000));
    expect(eqGainToY(18)).toBe(0);
    expect(eqGainToY(-18)).toBe(1);
    expect(eqYToGain(0.25)).toBe(9);
  });

  it("keeps low-sample-rate responses finite on the original frequency axis", () => {
    const audio = context(22_050);
    const controller = new EqController({context: audio.value});
    const response = controller.snapshot().response;

    expect(response.length).toBeGreaterThan(0);
    expect(response.every(({gain}) => Number.isFinite(gain) && gain === 0)).toBe(true);
    expect(response.every(({x}) => eqXToFrequency(x) <= 11_025)).toBe(true);
    expect(response.at(-1)!.x).toBeLessThan(1);
    controller.dispose();
  });

  it("adds cascaded filter responses in decibels", () => {
    const audio = context();
    const controller = new EqController({
      context: audio.value,
      bands: [{frequency: 100}, {frequency: 1_000}],
    });
    for (const [index, filter] of audio.filters.entries()) {
      filter.getFrequencyResponse = (_: Float32Array, magnitude: Float32Array) => {
        magnitude.fill(index === 0 ? 0.5 : 2);
      };
    }
    expect(controller.snapshot().response.every(({gain}) => Math.abs(gain) < 1e-6)).toBe(true);
    controller.dispose();
  });
});
