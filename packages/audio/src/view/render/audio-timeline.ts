import {
  mountTimeline,
  type TimelineBinding,
  type TimelineHandle,
  type TimelineHost,
  type TimelineOptions,
  type TimelineRange,
  type TimelineSelectOptions,
  type TimelineTick,
} from '@webmusic/ui/timeline';
import type {BeatGrid, Region} from '../../core';
import type {AudioViewportHandle, PlayerLike} from '../core/types';
import {bindPlayerToAudioTimeline, type AudioTimelineBinding} from '../headless/binding';
import type {AudioTimeline} from '../headless/timeline';
import {
  bindAudioTimelineViewport,
  type AudioTimelineViewportBinding,
} from './viewport-binding';

export interface AudioTimelineRange {
  startSeconds: number;
  endSeconds: number;
}

type OptionalSource<T> = T | (() => T | undefined);

export interface AudioTimelinePresenterBindingOptions {
  /** Non-uniform detected or authored beats used for ruler ticks. */
  beatGrid?: OptionalSource<BeatGrid>;
  /** Controlled time selection; call the mounted handle's `update()` after changing it. */
  selection?: OptionalSource<AudioTimelineRange>;
  /** Controlled active loop. It is explicit because a clip may contain several loop regions. */
  loop?: OptionalSource<AudioTimelineRange>;
  /** Controlled selected region ids; Region instances remain immutable. */
  selectedRegionIds?: OptionalSource<readonly string[]>;
  /** Real seek command. When omitted, the timeline presenter is read-only. */
  seek?: (seconds: number) => Promise<void> | void;
  /** Controlled region-selection command, receiving the original Region instance. */
  selectRegion?: (
    region: Region,
    options: TimelineSelectOptions,
  ) => Promise<void> | void;
}

export interface MountAudioTimelineOptions
  extends TimelineOptions,
    AudioTimelinePresenterBindingOptions {
  /** Borrowed waveform viewport kept in strict zoom/scroll sync. */
  viewport?: AudioViewportHandle;
  /** Optional borrowed player used for seek and playhead updates. */
  player?: PlayerLike;
  followPlayhead?: boolean;
  followAnchor?: number;
  resetOnEnd?: boolean;
}

export interface AudioTimelinePresenterHandle extends TimelineHandle {
  /** Borrowed headless model; destroying the handle never disposes it. */
  readonly timeline: AudioTimeline;
}

const mountedAudioTimelines = new WeakMap<TimelineHost, AudioTimelinePresenterHandle>();
const MAX_VISIBLE_TICKS = 200;

/** Convert an Audio BeatGrid into stable, non-uniform UI ruler ticks. */
export function audioTimelineTicks(
  beatGrid: BeatGrid,
  viewport?: AudioTimelineRange,
): readonly TimelineTick[] {
  const start = viewport?.startSeconds ?? Number.NEGATIVE_INFINITY;
  const end = viewport?.endSeconds ?? Number.POSITIVE_INFINITY;
  const firstBeat = lowerBound(beatGrid.beats, start);
  const afterLastBeat = upperBound(beatGrid.beats, end);
  const visibleCount = Math.max(0, afterLastBeat - firstBeat);
  if (visibleCount === 0) return [];

  const indices = new Set<number>();
  if (visibleCount <= MAX_VISIBLE_TICKS) {
    for (let index = firstBeat; index < afterLastBeat; index += 1) indices.add(index);
  } else {
    const downbeats = beatGrid.downbeats;
    if (downbeats?.length) {
      const firstDownbeat = lowerBound(downbeats, start);
      const afterLastDownbeat = upperBound(downbeats, end);
      for (const downbeatIndex of sampleIndices(
        firstDownbeat,
        afterLastDownbeat,
        MAX_VISIBLE_TICKS,
      )) {
        const beatIndex = lowerBound(beatGrid.beats, downbeats[downbeatIndex]);
        if (beatIndex < afterLastBeat) indices.add(beatIndex);
      }
    }
    const remaining = MAX_VISIBLE_TICKS - indices.size;
    if (remaining > 0) {
      for (const index of sampleIndices(firstBeat, afterLastBeat, remaining)) {
        indices.add(index);
      }
    }
  }

  return [...indices].sort((left, right) => left - right).map((index) => {
    const position = beatGrid.beats[index];
    const downbeatIndex = beatGrid.downbeats
      ? exactIndex(beatGrid.downbeats, position)
      : -1;
    const major = beatGrid.downbeats ? downbeatIndex >= 0 : true;
    return {
      id: `beat-${index}`,
      position,
      level: major ? 'major' : 'minor',
      // Empty minor labels deliberately suppress the UI presenter's numeric
      // fallback; only bar starts (or every beat without downbeat data) label.
      label: major ? String(beatGrid.downbeats ? downbeatIndex + 1 : index + 1) : '',
    };
  });
}

/** Format seconds for a DAW-style ruler and native range announcement. */
export function formatAudioTimelinePosition(position: number): string {
  const safe = Number.isFinite(position) ? Math.max(0, position) : 0;
  const centiseconds = Math.round(safe * 100);
  const wholeSeconds = Math.floor(centiseconds / 100);
  const fraction = String(centiseconds % 100).padStart(2, '0');
  const seconds = String(wholeSeconds % 60).padStart(2, '0');
  const totalMinutes = Math.floor(wholeSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}.${fraction}`
    : `${totalMinutes}:${seconds}.${fraction}`;
}

/**
 * Adapt a borrowed AudioTimeline to the domain-neutral UI presenter contract.
 * This function creates no DOM and owns none of the supplied models or commands.
 */
export function createAudioTimelinePresenterBinding(
  timeline: AudioTimeline,
  options: AudioTimelinePresenterBindingOptions = {},
): TimelineBinding {
  const seek = options.seek;
  const selectRegion = options.selectRegion;

  return {
    snapshot: () => {
      const snapshot = timeline.snapshot;
      const visible = timeline.visibleRange();
      const viewport =
        snapshot.viewportWidth > 0 && visible.endSeconds > visible.startSeconds
          ? {start: visible.startSeconds, end: visible.endSeconds}
          : undefined;
      const selected = new Set(readSource(options.selectedRegionIds) ?? []);
      const beatGrid = readSource(options.beatGrid);
      return {
        duration: snapshot.durationSeconds,
        ...(viewport ? {viewport} : {}),
        playhead: snapshot.playheadSeconds,
        ...(beatGrid
          ? {
              ticks: audioTimelineTicks(beatGrid, {
                startSeconds: viewport?.start ?? 0,
                endSeconds: viewport?.end ?? snapshot.durationSeconds,
              }),
            }
          : {}),
        ...toTimelineRangeProperty('selection', readSource(options.selection)),
        ...toTimelineRangeProperty('loop', readSource(options.loop)),
        regions: timeline.regions.map((region) => ({
          id: String(region.id),
          label: region.label,
          start: region.startSeconds,
          ...(region.endSeconds !== undefined ? {end: region.endSeconds} : {}),
          ...(region.color !== undefined ? {color: region.color} : {}),
          ...(selected.has(String(region.id)) ? {selected: true} : {}),
        })),
      };
    },
    ...(seek
      ? {
          seek: (seconds: number) => {
            const result = seek(seconds);
            if (result !== undefined) {
              return Promise.resolve(result).then(() => {
                timeline.setPlayhead(seconds);
              });
            }
            timeline.setPlayhead(seconds);
          },
        }
      : {}),
    ...(selectRegion
      ? {
          selectRegion: (id: string, selectionOptions: TimelineSelectOptions) => {
            const region = timeline.regions.find((candidate) => String(candidate.id) === id);
            if (region) return selectRegion(region, selectionOptions);
          },
        }
      : {}),
    subscribe: (notify) => timeline.subscribe(notify),
  };
}

/**
 * Mount standalone Audio timeline chrome. It intentionally does not wrap
 * `<audio-view>` or its waveform scroller, avoiding a second viewport owner.
 */
export function mountAudioTimeline(
  host: TimelineHost,
  timeline: AudioTimeline,
  options: MountAudioTimelineOptions = {},
): AudioTimelinePresenterHandle {
  mountedAudioTimelines.get(host)?.destroy();

  const playerSeek = options.player
    ? (seconds: number): void => options.player!.seek(seconds)
    : undefined;
  const binding = createAudioTimelinePresenterBinding(timeline, {
    ...(options.beatGrid !== undefined ? {beatGrid: options.beatGrid} : {}),
    ...(options.selection !== undefined ? {selection: options.selection} : {}),
    ...(options.loop !== undefined ? {loop: options.loop} : {}),
    ...(options.selectedRegionIds !== undefined
      ? {selectedRegionIds: options.selectedRegionIds}
      : {}),
    ...(options.seek ?? playerSeek ? {seek: options.seek ?? playerSeek} : {}),
    ...(options.selectRegion ? {selectRegion: options.selectRegion} : {}),
  });

  const presenter = mountTimeline(host, binding, {
    ...(options.label !== undefined ? {label: options.label} : {}),
    ...(options.majorStep !== undefined ? {majorStep: options.majorStep} : {}),
    ...(options.keyboardStep !== undefined ? {keyboardStep: options.keyboardStep} : {}),
    formatPosition: options.formatPosition ?? formatAudioTimelinePosition,
    ...(options.classNames !== undefined ? {classNames: options.classNames} : {}),
    ...(options.parts !== undefined ? {parts: options.parts} : {}),
    ...(options.onError !== undefined
      ? {onError: (error: unknown) => reportBorrowedError(options.onError!, error)}
      : {}),
  });

  let viewportBinding: AudioTimelineViewportBinding | undefined;
  let playerBinding: AudioTimelineBinding | undefined;
  try {
    if (options.viewport) {
      viewportBinding = bindAudioTimelineViewport(timeline, options.viewport);
    }
    if (options.player) {
      timeline.setPlayhead(options.player.seconds);
      if (options.followPlayhead) timeline.followPlayhead(options.followAnchor);
      playerBinding = bindPlayerToAudioTimeline(options.player, timeline, {
        followPlayhead: options.followPlayhead,
        followAnchor: options.followAnchor,
        resetOnEnd: options.resetOnEnd,
      });
      presenter.update();
    }
  } catch (error) {
    try {
      playerBinding?.unsubscribe();
    } catch {
      // Preserve the setup failure.
    }
    try {
      viewportBinding?.unsubscribe();
    } catch {
      // Preserve the setup failure.
    }
    try {
      presenter.destroy();
    } catch {
      // Preserve the setup failure.
    }
    throw error;
  }

  let destroyed = false;
  const handle: AudioTimelinePresenterHandle = {
    timeline,
    element: presenter.element,
    ruler: presenter.ruler,
    lane: presenter.lane,
    seek: presenter.seek,
    regionElement: (id) => presenter.regionElement(id),
    update: () => presenter.update(),
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (mountedAudioTimelines.get(host) === handle) mountedAudioTimelines.delete(host);
      let failed = false;
      let firstError: unknown;
      try {
        playerBinding?.unsubscribe();
      } catch (error) {
        failed = true;
        firstError = error;
      }
      try {
        viewportBinding?.unsubscribe();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
      try {
        presenter.destroy();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
      if (failed) throw firstError;
    },
  };

  mountedAudioTimelines.set(host, handle);
  return handle;
}

function reportBorrowedError(
  reporter: (error: unknown) => void,
  error: unknown,
): void {
  try {
    const result = (reporter as (error: unknown) => unknown)(error);
    if (isPromiseLike(result)) void Promise.resolve(result).catch(() => {});
  } catch {
    // Error reporters are borrowed extensions and must never break presenter
    // rollback or surface their own rejected promise as an unhandled failure.
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  ) && typeof (value as {then?: unknown}).then === 'function';
}

function readSource<T>(source: OptionalSource<T> | undefined): T | undefined {
  return typeof source === 'function' ? (source as () => T | undefined)() : source;
}

function toTimelineRange(range: AudioTimelineRange | undefined): TimelineRange | undefined {
  return range ? {start: range.startSeconds, end: range.endSeconds} : undefined;
}

function toTimelineRangeProperty<Key extends 'selection' | 'loop'>(
  key: Key,
  range: AudioTimelineRange | undefined,
): Partial<Record<Key, TimelineRange>> {
  const mapped = toTimelineRange(range);
  return mapped ? ({[key]: mapped} as Partial<Record<Key, TimelineRange>>) : {};
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function exactIndex(values: readonly number[], target: number): number {
  const index = lowerBound(values, target);
  return values[index] === target ? index : -1;
}

function sampleIndices(
  start: number,
  end: number,
  maximum: number,
): readonly number[] {
  const count = Math.max(0, end - start);
  const limit = Math.max(0, Math.floor(maximum));
  if (count === 0 || limit === 0) return [];
  if (count <= limit) {
    return Array.from({length: count}, (_, index) => start + index);
  }
  if (limit === 1) return [start];
  return Array.from({length: limit}, (_, index) =>
    start + Math.floor((index * (count - 1)) / (limit - 1)),
  );
}
