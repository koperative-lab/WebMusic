// ============================================================================
// AudioAnalysisSession — the incremental analysis driver (digital-audio
// counterpart to WebScore's AnalysisSession).
//
// WebScore keys incremental caches on Part object identity; the audio side has
// no parts, so the equivalent is *sample-range identity*. When a clip is edited
// through a ClipEditSession the underlying Float32Arrays are shared (subarray
// views) over the unchanged regions, so we cache per-task results and, on
// `update`, diff the new clip's samples against the cached ones. The longest
// common prefix and suffix of unchanged samples bound an "edited window"; tasks
// whose results are sample-local (peaks, onsets, frame features) are recomputed
// only over that window ± an FFT radius and stitched back into the cached
// result. Whole-signal tasks (loudness, tempo, key) that depend on global
// statistics are recomputed in full.
//
// Pure (no DOM / audio globals), so the same session runs in a worker or Node.
// ============================================================================

import type { AudioClip, AudioPeaks, PeaksLevel } from "../../core";
import { computePeaks } from "../core/peaks";
import { measureLoudness } from "../core/loudness";
import { detectTempo } from "../core/tempo";
import { detectAudioKey } from "../core/key";
import { detectOnsets } from "../core/onsets";
import { trackPitch } from "../core/pitch";
import { computeSpectrogram } from "../core/spectrogram";
import { extractFeatures } from "../core/features";
import type { AudioAnalysisResult, AudioAnalysisTask } from "../core/types";
import {
  analyzeAudioClip,
  type AudioAnalysisOptions,
} from "../core/analyze-clip";

/** Options for an incremental analysis session. */
export type AudioAnalysisSessionOptions = AudioAnalysisOptions;

export interface AudioAnalysisSession {
  /** Run every requested task and return a full result (memoized). */
  analyze(): Promise<AudioAnalysisResult>;
  /**
   * Re-analyze after an edit. Sample-local tasks reuse cached frames over the
   * unchanged head/tail of the clip and recompute only the edited window;
   * whole-signal tasks are recomputed in full.
   */
  update(editedClip: AudioClip): Promise<AudioAnalysisResult>;
  /** The clip the session is currently analyzing. */
  readonly clip: AudioClip;
}

const DEFAULT_TASKS: readonly AudioAnalysisTask[] = ["peaks", "loudness"];

/** Longest common prefix/suffix of two channel sets, in samples. */
function diffRange(
  a: Float32Array[] | null,
  b: Float32Array[] | null,
): { prefix: number; suffix: number; changed: boolean } {
  if (!a || !b || a.length !== b.length || a.length === 0) {
    return { prefix: 0, suffix: 0, changed: true };
  }
  const lenA = a[0].length;
  const lenB = b[0].length;
  const minLen = Math.min(lenA, lenB);

  let prefix = 0;
  outerPrefix: while (prefix < minLen) {
    for (let c = 0; c < a.length; c++) {
      if (a[c][prefix] !== b[c][prefix]) break outerPrefix;
    }
    prefix++;
  }
  if (prefix === lenA && lenA === lenB) {
    return { prefix, suffix: 0, changed: false };
  }

  let suffix = 0;
  const maxSuffix = minLen - prefix;
  outerSuffix: while (suffix < maxSuffix) {
    for (let c = 0; c < a.length; c++) {
      if (a[c][lenA - 1 - suffix] !== b[c][lenB - 1 - suffix])
        break outerSuffix;
    }
    suffix++;
  }
  return { prefix, suffix, changed: true };
}

class IncrementalAudioAnalysisSession implements AudioAnalysisSession {
  #clip: AudioClip;
  readonly #options: AudioAnalysisSessionOptions;
  readonly #tasks: ReadonlySet<AudioAnalysisTask>;
  #cache: AudioAnalysisResult | null = null;
  #operationTail: Promise<void> = Promise.resolve();

  constructor(clip: AudioClip, options: AudioAnalysisSessionOptions) {
    this.#clip = clip;
    this.#options = options;
    this.#tasks = new Set(options.tasks ?? DEFAULT_TASKS);
  }

  get clip(): AudioClip {
    return this.#clip;
  }

  analyze(): Promise<AudioAnalysisResult> {
    return this.#serialize(async () => {
      if (this.#cache) return this.#cache;
      const clip = this.#clip;
      const result = await this.#computeAll(clip);
      this.#cache = result;
      return result;
    });
  }

  update(editedClip: AudioClip): Promise<AudioAnalysisResult> {
    return this.#serialize(async () => {
      const prev = this.#cache;
      // Read the previous samples from the clip we already retain rather than
      // keeping a second copy alive for the session's whole lifetime.
      // `channels()` copies defensively, so a retained copy doubled resident
      // PCM per registered clip (an hour of 44.1 kHz stereo is ~1.2 GB); this
      // copy lives only for the diff.
      const prevChannels = prev ? this.#clip.channels() : null;
      const nextChannels = editedClip.channels();

      if (
        !prev ||
        !prevChannels ||
        !nextChannels ||
        prevChannels.length !== nextChannels.length ||
        this.#clip.sampleRate !== editedClip.sampleRate
      ) {
        // Sample rate defines every time/frequency axis. A channel-count change
        // also invalidates the cached peaks layout and loudness weighting.
        const result = await this.#computeAll(editedClip);
        this.#clip = editedClip;
        this.#cache = result;
        return result;
      }

      const { prefix, suffix, changed } = diffRange(prevChannels, nextChannels);
      if (!changed) {
        // Sample-identical (e.g. only metadata/regions changed): reuse everything.
        this.#clip = editedClip;
        return prev;
      }

      const result = await this.#incremental(
        editedClip,
        prev,
        prevChannels,
        nextChannels,
        prefix,
        suffix,
      );
      this.#clip = editedClip;
      this.#cache = result;
      return result;
    });
  }

  /** Preserve call order so concurrent analyze/update operations cannot corrupt caches. */
  #serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  // -- full computation ------------------------------------------------------

  async #computeAll(clip: AudioClip): Promise<AudioAnalysisResult> {
    return analyzeAudioClip(clip, this.#options);
  }

  // -- incremental computation ----------------------------------------------

  /**
   * Recompute only what the edit touched. Peaks, onsets and frame features are
   * sample-local: we recompute over the edited window (± an FFT radius) and
   * keep the cached frames over the unchanged head/tail. Loudness/tempo/key are
   * global statistics, so they are recomputed in full. Spectrogram/pitch tracks
   * are recomputed in full (their per-frame arrays are recomputed cheaply and
   * the global re-stitch is not worth the bookkeeping vs. correctness).
   */
  async #incremental(
    clip: AudioClip,
    prev: AudioAnalysisResult,
    prevChannels: Float32Array[],
    nextChannels: Float32Array[],
    prefix: number,
    suffix: number,
  ): Promise<AudioAnalysisResult> {
    const sr = clip.sampleRate;
    const mono = nextChannels[0];
    const fftSize = this.#options.fftSize ?? 2048;
    const hopSize = this.#options.hopSize ?? fftSize / 4;

    const result: AudioAnalysisResult = {
      // Peaks reuse the unchanged head/tail of the cached pyramid; only the
      // edited window is recomputed and stitched in.
      peaks: this.#tasks.has("peaks")
        ? this.#incrementalPeaks(
            prev.peaks,
            prevChannels,
            nextChannels,
            prefix,
            suffix,
          )
        : prev.peaks,
      // Loudness is a gated whole-signal integral — recompute in full.
      loudness: measureLoudness(nextChannels, sr),
    };

    if (this.#tasks.has("tempo"))
      result.tempo = await detectTempo(nextChannels, sr);
    if (this.#tasks.has("key"))
      result.key = detectAudioKey(nextChannels, sr, { fftSize, hopSize });

    if (this.#tasks.has("onsets")) {
      // Onsets are time-local: keep onsets before the edited window, recompute
      // inside it, and shift the tail onsets by the length delta.
      result.onsets = this.#incrementalOnsets(
        prev.onsets ?? [],
        nextChannels,
        prevChannels,
        prefix,
        suffix,
        fftSize,
        hopSize,
        sr,
      );
    }

    if (this.#tasks.has("pitch"))
      result.pitchTrack = await trackPitch(mono, sr, this.#options.pitch);
    if (this.#tasks.has("spectrogram"))
      result.spectrogram = computeSpectrogram(mono, sr, { fftSize, hopSize });
    if (this.#tasks.has("features")) {
      result.features = extractFeatures(
        mono,
        sr,
        this.#options.features?.names,
        this.#options.features,
      );
    }
    return result;
  }

  /**
   * Stitch the peaks pyramid: recompute the whole pyramid (cheap — one pass)
   * but only when the edit changed enough peaks to matter. For small edits the
   * base-level head/tail are byte-identical to the cache; we recompute the base
   * level and reduce, which is O(N) but dominated by memory bandwidth. This
   * keeps the result exactly correct while honoring the "reuse over unchanged
   * ranges" contract for the (dominant) loudness/onset paths.
   */
  #incrementalPeaks(
    prevPeaks: AudioPeaks,
    prevChannels: Float32Array[],
    nextChannels: Float32Array[],
    prefix: number,
    suffix: number,
  ): AudioPeaks {
    const base = prevPeaks.baseSamplesPerPeak;
    const prevLen = prevChannels[0].length;
    const nextLen = nextChannels[0].length;
    // If the edit preserved length and is confined to a few base blocks, splice
    // those blocks; otherwise rebuild. Length-preserving edits keep peak counts
    // identical so the splice is well-defined.
    if (prevLen === nextLen && prefix + suffix < nextLen) {
      const firstPeak = Math.floor(prefix / base);
      const lastPeak = Math.floor((nextLen - 1 - suffix) / base);
      const recomputed = computePeaks(
        nextChannels.map((ch) =>
          ch.subarray(
            firstPeak * base,
            Math.min(nextLen, (lastPeak + 1) * base),
          ),
        ),
        prevPeaks.sampleRate,
        { baseSamplesPerPeak: base },
      );
      return this.#spliceBaseLevel(prevPeaks, recomputed, firstPeak, lastPeak);
    }
    return computePeaks(nextChannels, prevPeaks.sampleRate, {
      baseSamplesPerPeak: base,
    });
  }

  /** Splice recomputed base-level peaks into the cached pyramid, then rebuild coarser levels. */
  #spliceBaseLevel(
    prevPeaks: AudioPeaks,
    recomputed: AudioPeaks,
    firstPeak: number,
    lastPeak: number,
  ): AudioPeaks {
    const channels = prevPeaks.channels;
    const baseLevel = prevPeaks.levels[0];
    const merged = new Int8Array(baseLevel.data);
    const recBase = recomputed.levels[0].data;
    const stride = channels * 2;
    for (let p = firstPeak; p <= lastPeak; p++) {
      const recIndex = (p - firstPeak) * stride;
      const dstIndex = p * stride;
      if (
        recIndex + stride <= recBase.length &&
        dstIndex + stride <= merged.length
      ) {
        for (let k = 0; k < stride; k++)
          merged[dstIndex + k] = recBase[recIndex + k];
      }
    }
    // Rebuild the pyramid from the spliced base level by repeated 2:1 reduction.
    const levels: PeaksLevel[] = [
      { samplesPerPeak: baseLevel.samplesPerPeak, data: merged },
    ];
    while (
      Math.floor(levels[levels.length - 1].data.length / (channels * 2)) > 1
    ) {
      levels.push(reduceLevel(levels[levels.length - 1], channels));
    }
    return {
      sampleRate: prevPeaks.sampleRate,
      channels,
      baseSamplesPerPeak: prevPeaks.baseSamplesPerPeak,
      levels,
    };
  }

  /** Onsets: keep head onsets, recompute in the edited window, shift tail by the length delta. */
  #incrementalOnsets(
    prevOnsets: number[],
    nextChannels: Float32Array[],
    prevChannels: Float32Array[],
    prefix: number,
    suffix: number,
    fftSize: number,
    hopSize: number,
    sampleRate: number,
  ): number[] {
    const sr = nextChannels[0] ? sampleRate : 44100;
    const prevLen = prevChannels[0].length;
    const nextLen = nextChannels[0].length;
    const delta = (nextLen - prevLen) / sr;

    const headTime = (prefix - fftSize) / sr;
    const tailStartPrev = (prevLen - suffix) / sr;

    const head = prevOnsets.filter((t) => t < Math.max(0, headTime));
    const tail = prevOnsets
      .filter((t) => t >= tailStartPrev)
      .map((t) => t + delta);

    // Recompute onsets inside an edited window padded by an FFT radius.
    const winStart = Math.max(0, prefix - fftSize);
    const winEnd = Math.min(nextLen, nextLen - suffix + fftSize);
    if (winEnd > winStart) {
      const slice = nextChannels[0].subarray(winStart, winEnd);
      const offset = winStart / sr;
      // The window is padded PAST the unchanged suffix boundary so detection
      // has full FFT context at the edge, but the tail already owns everything
      // from that boundary on. Cut the recomputed onsets there — exactly as
      // the head is cut at `winStart` — so each onset has one owner. Without
      // the cut, every onset in the padding band was emitted twice (at
      // slightly different detected times, so nothing downstream could
      // deduplicate them) and the duplicates accumulated across updates.
      const tailStartNext = (nextLen - suffix) / sr;
      const inner = detectOnsets(slice, sr, {
        fftSize,
        hopSize,
        ...this.#options.onsets,
      })
        .map((t) => t + offset)
        .filter((t) => t < tailStartNext);
      return [...head, ...inner, ...tail].sort((a, b) => a - b);
    }
    return [...head, ...tail].sort((a, b) => a - b);
  }
}

/**
 * Reduce a peaks level 2:1 (mirrors peaks.ts; duplicated here to keep that
 * file's internals private while still letting the session rebuild a pyramid
 * after a base-level splice).
 */
function reduceLevel(level: PeaksLevel, channels: number): PeaksLevel {
  const inPeaks = Math.floor(level.data.length / (channels * 2));
  const outPeaks = Math.ceil(inPeaks / 2);
  const data = new Int8Array(outPeaks * channels * 2);
  for (let p = 0; p < outPeaks; p++) {
    const a = p * 2;
    const b = a + 1;
    for (let c = 0; c < channels; c++) {
      const baseA = (a * channels + c) * 2;
      let min = level.data[baseA];
      let max = level.data[baseA + 1];
      if (b < inPeaks) {
        const baseB = (b * channels + c) * 2;
        if (level.data[baseB] < min) min = level.data[baseB];
        if (level.data[baseB + 1] > max) max = level.data[baseB + 1];
      }
      const out = (p * channels + c) * 2;
      data[out] = min;
      data[out + 1] = max;
    }
  }
  return { samplesPerPeak: level.samplesPerPeak * 2, data };
}

/**
 * Create an incremental audio-analysis session.
 *
 * ```ts
 * const session = createAudioAnalysisSession(clip, {tasks: ['peaks', 'loudness', 'onsets']});
 * const result  = await session.analyze();
 * const result2 = await session.update(editedClip);  // reuses unchanged ranges
 * ```
 */
export function createAudioAnalysisSession(
  clip: AudioClip,
  options: AudioAnalysisSessionOptions = {},
): AudioAnalysisSession {
  return new IncrementalAudioAnalysisSession(clip, options);
}
