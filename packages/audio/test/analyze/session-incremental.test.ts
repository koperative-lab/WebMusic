import {describe, expect, it} from 'vitest';
import {createAudioClip} from '../../src/core';
import {createAudioAnalysisSession} from '../../src/analyze/headless/session';

const SR = 44100;
const EDIT_START = Math.round(0.5 * SR);
const EDIT_LENGTH = 2_048;

/** Impulses at the given sample offsets, shaped like the shared click helper. */
function clicksAt(lengthSamples: number, offsets: number[]): Float32Array {
  const out = new Float32Array(lengthSamples);
  const clickLen = Math.round(0.005 * SR);
  for (const start of offsets) {
    for (let i = 0; i < clickLen && start + i < lengthSamples; i++) {
      out[start + i] = Math.exp(-i / (clickLen / 4)) * (1 - (2 * i) / clickLen);
    }
  }
  return out;
}

function clipFrom(channel: Float32Array) {
  return createAudioClip({sampleRate: SR, channelData: [channel]});
}

/** Silence the edited span, keeping the length identical. */
function editedInPlace(source: Float32Array): Float32Array {
  const next = Float32Array.from(source);
  next.fill(0, EDIT_START, EDIT_START + EDIT_LENGTH);
  return next;
}

function sourceClicks(): Float32Array {
  return clicksAt(3 * SR, [
    Math.round(0.1 * SR),
    EDIT_START,
    EDIT_START + EDIT_LENGTH + 512,
    Math.round(2 * SR),
  ]);
}

/**
 * The stitch splices three sources into one onset list — a retained head, a
 * recomputed window and a shifted tail — so the list it returns must still
 * read as a single detection pass: strictly ascending, with no two onsets
 * closer than a hop (which is what a boundary claimed by two sources looks
 * like), and never growing as edits remove material.
 */
function expectSingleDetectionPass(onsets: readonly number[]): void {
  for (let i = 1; i < onsets.length; i++) {
    expect(onsets[i] - onsets[i - 1]).toBeGreaterThan(0.01);
  }
}

describe('incremental analysis session', () => {
  it('splices one coherent onset list across an edit', async () => {
    const source = sourceClicks();
    const session = createAudioAnalysisSession(clipFrom(source), {tasks: ['onsets']});

    const first = await session.analyze();
    const baseline = first.onsets ?? [];
    expect(baseline.length).toBeGreaterThan(0);
    expectSingleDetectionPass(baseline);

    const updated = await session.update(clipFrom(editedInPlace(source)));
    const onsets = updated.onsets ?? [];

    expectSingleDetectionPass(onsets);
    // The edit removes a click and adds nothing.
    expect(onsets.length).toBeLessThanOrEqual(baseline.length);
    // Material outside the edit is preserved exactly, not re-detected.
    expect(onsets[0]).toBeCloseTo(baseline[0], 9);
    expect(onsets[onsets.length - 1]).toBeCloseTo(baseline[baseline.length - 1], 9);
  });

  it('stays coherent across several successive updates', async () => {
    const source = sourceClicks();
    const session = createAudioAnalysisSession(clipFrom(source), {tasks: ['onsets']});
    const first = await session.analyze();
    const baseline = (first.onsets ?? []).length;

    let current = source;
    for (let round = 0; round < 3; round++) {
      current = editedInPlace(current);
      const result = await session.update(clipFrom(current));
      const onsets = result.onsets ?? [];
      expectSingleDetectionPass(onsets);
      // A boundary owned by two sources compounds its extra onsets per update.
      expect(onsets.length).toBeLessThanOrEqual(baseline);
    }
  });

  it('reuses the cached result when only metadata changed', async () => {
    const source = sourceClicks();
    const session = createAudioAnalysisSession(clipFrom(source), {tasks: ['onsets']});
    const first = await session.analyze();

    // A sample-identical clip must hit the cache rather than recompute — the
    // session no longer keeps its own PCM copy, so this pins that the diff
    // still reads the retained clip correctly.
    const same = await session.update(clipFrom(Float32Array.from(source)));
    expect(same).toBe(first);
  });

  it('recomputes sample-dependent axes when only the sample rate changes', async () => {
    const samples = sourceClicks();
    const session = createAudioAnalysisSession(clipFrom(samples), {tasks: ['onsets']});
    const first = await session.analyze();
    const resampledMetadata = createAudioClip({sampleRate: SR / 2, channelData: [samples]});

    const updated = await session.update(resampledMetadata);

    expect(updated).not.toBe(first);
    expect(updated.peaks.sampleRate).toBe(SR / 2);
    expect(updated.onsets?.length).toBeGreaterThan(0);
    expect(updated.onsets?.[0]).toBeCloseTo((first.onsets?.[0] ?? 0) * 2, 1);
    expect(session.clip).toBe(resampledMetadata);
  });

  it('rebuilds the peaks layout when a channel is added without changing length', async () => {
    const samples = sourceClicks();
    const session = createAudioAnalysisSession(clipFrom(samples));
    const first = await session.analyze();
    const stereo = createAudioClip({sampleRate: SR, channelData: [samples, samples]});

    const updated = await session.update(stereo);

    expect(updated.peaks.channels).toBe(2);
    expect(updated.peaks.levels[0]!.data.length).toBe(first.peaks.levels[0]!.data.length * 2);
    expect(session.clip).toBe(stereo);
  });
});
