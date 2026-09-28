// ============================================================================
// @webmusic/audio/react — thin React bindings over the @webmusic/audio/* packages.
// Mirrors the role of @webscore/react: hooks that own object lifecycles +
// component wrappers around the renderers. React is an external peer; the audio
// work lives in the underlying packages, so these stay deliberately thin.
// ============================================================================

import {useCallback, useEffect, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent, ReactElement} from 'react';
import type {AudioClip} from '../core';
import {loadClipFromUrl} from '../play/api';
import {AudioClipPlayer, AudioRecorder, type AudioClipPlayerOptions} from '../play/headless';
import {computePeaks, type AudioAnalysisResult, type AudioAnalysisTask} from '../analyze/api';
import {
  createAudioAnalysisSession,
  type AudioAnalysisSessionOptions,
} from '../analyze/headless';
import type {WaveformRenderOptions} from '../view/api';
import {bindPlayerToWaveform, renderWaveformVisualizer} from '../view/render';

const waveformSurfaceStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding:
    'var(--wm-audio-view-surface-padding, var(--wm-component-padding, .6rem))',
  border:
    'var(--wm-audio-view-surface-border, var(--wm-component-border, 1px solid var(--wm-border, #d8d8d8)))',
  borderRadius:
    'var(--wm-audio-view-surface-radius, var(--wm-component-radius, var(--wm-control-radius, 0)))',
  background:
    'var(--wm-audio-view-surface-background, var(--wm-component-background, var(--wm-surface, #fff)))',
  color:
    'var(--wm-audio-view-surface-foreground, var(--wm-component-foreground, var(--wm-foreground, #444)))',
};

// ---------------------------------------------------------------------------
// useAudioClip — load (and decode) a clip from a URL.
// ---------------------------------------------------------------------------

export interface UseAudioClipResult {
  clip: AudioClip | null;
  loading: boolean;
  error: Error | null;
}

export function useAudioClip(src: string | null): UseAudioClipResult {
  const [clip, setClip] = useState<AudioClip | null>(null);
  const [loading, setLoading] = useState<boolean>(src != null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (src == null) {
      setClip(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setClip(null);
    setLoading(true);
    setError(null);
    loadClipFromUrl(src, {signal: controller.signal})
      .then((c) => {
        if (!cancelled) {
          setClip(c);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setClip(null);
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [src]);

  return {clip, loading, error};
}

// ---------------------------------------------------------------------------
// useAudioClipPlayer — own an AudioClipPlayer and surface reactive transport.
// ---------------------------------------------------------------------------

export interface UseAudioClipPlayerResult {
  player: AudioClipPlayer | null;
  playing: boolean;
  seconds: number;
  duration: number;
  progress: number;
  error: Error | null;
  play: () => Promise<void>;
  pause: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  setRate: (rate: number) => void;
  setVolume: (volume: number) => void;
}

export function useAudioClipPlayer(
  clip: AudioClip | null,
  options?: AudioClipPlayerOptions,
): UseAudioClipPlayerResult {
  const playerRef = useRef<AudioClipPlayer | null>(null);
  const [player, setPlayer] = useState<AudioClipPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  // Options are captured once per player; reading from a ref avoids re-creating
  // the player when a caller passes a fresh options object each render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    setPlaying(false);
    setSeconds(0);
    setDuration(0);
    setProgress(0);
    setError(null);
    if (!clip) {
      playerRef.current = null;
      setPlayer(null);
      return;
    }
    const p = new AudioClipPlayer(clip, optionsRef.current);
    playerRef.current = p;
    setPlayer(p);
    setDuration(p.duration);

    const offTime = p.on('timeupdate', (u) => {
      setSeconds(u.seconds);
      setDuration(u.duration);
      setProgress(u.progress);
    });
    const offEnd = p.on('end', () => setPlaying(false));
    const offError = p.on('error', (nextError) => {
      if (playerRef.current !== p) return;
      setPlaying(false);
      setError(nextError);
    });

    return () => {
      offTime();
      offEnd();
      offError();
      if (playerRef.current === p) playerRef.current = null;
      p.dispose();
    };
  }, [clip]);

  const play = useCallback(async () => {
    const current = playerRef.current;
    if (!current) return;
    setError(null);
    try {
      await current.play();
      if (playerRef.current === current) setPlaying(current.playing);
    } catch (cause) {
      if (playerRef.current === current) {
        setPlaying(false);
        setError(toError(cause));
      }
      throw cause;
    }
  }, []);
  const pause = useCallback(() => {
    const current = playerRef.current;
    if (!current) return;
    try {
      current.pause();
      setPlaying(false);
    } catch (cause) {
      setError(toError(cause));
    }
  }, []);
  const stop = useCallback(() => {
    const current = playerRef.current;
    if (!current) return;
    try {
      current.stop();
      setPlaying(false);
      setSeconds(0);
      setProgress(0);
    } catch (cause) {
      setError(toError(cause));
    }
  }, []);
  const seek = useCallback((s: number) => {
    try {
      playerRef.current?.seek(s);
    } catch (cause) {
      setError(toError(cause));
    }
  }, []);
  const setRate = useCallback((r: number) => {
    try {
      playerRef.current?.setRate(r);
    } catch (cause) {
      setError(toError(cause));
    }
  }, []);
  const setVolume = useCallback((v: number) => {
    try {
      playerRef.current?.setVolume(v);
    } catch (cause) {
      setError(toError(cause));
    }
  }, []);

  return {player, playing, seconds, duration, progress, error, play, pause, stop, seek, setRate, setVolume};
}

// ---------------------------------------------------------------------------
// useAudioAnalysis — run an incremental analysis session for a clip.
// ---------------------------------------------------------------------------

export interface UseAudioAnalysisResult {
  result: AudioAnalysisResult | null;
  analyzing: boolean;
  error: Error | null;
}

export function useAudioAnalysis(
  clip: AudioClip | null,
  tasks?: readonly AudioAnalysisTask[],
  options?: Omit<AudioAnalysisSessionOptions, 'tasks'>,
): UseAudioAnalysisResult {
  const [result, setResult] = useState<AudioAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Serialize tasks to a stable dep key.
  const tasksKey = tasks ? tasks.join(',') : '';
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!clip) {
      setResult(null);
      setAnalyzing(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setResult(null);
    setAnalyzing(true);
    setError(null);
    const session = createAudioAnalysisSession(clip, {
      ...optionsRef.current,
      ...(tasks ? {tasks} : {}),
    });
    session
      .analyze()
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          setAnalyzing(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setAnalyzing(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip, tasksKey]);

  return {result, analyzing, error};
}

// ---------------------------------------------------------------------------
// useAudioRecorder — microphone capture into an AudioClip.
// ---------------------------------------------------------------------------

export interface UseAudioRecorderResult {
  recording: boolean;
  level: number;
  clip: AudioClip | null;
  error: Error | null;
  start: () => Promise<void>;
  stop: () => Promise<AudioClip | null>;
}

export function useAudioRecorder(): UseAudioRecorderResult {
  const recorderRef = useRef<AudioRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [clip, setClip] = useState<AudioClip | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const rec = new AudioRecorder();
    recorderRef.current = rec;
    const offLevel = rec.on('level', (l: number) => setLevel(l));
    const offError = rec.on('error', (nextError: Error) => {
      if (recorderRef.current !== rec) return;
      setRecording(false);
      setError(nextError);
    });
    return () => {
      offLevel();
      offError();
      if (recorderRef.current === rec) recorderRef.current = null;
      rec.dispose();
    };
  }, []);

  const start = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    setError(null);
    try {
      await rec.start();
      if (recorderRef.current === rec) setRecording(rec.isRecording);
    } catch (cause) {
      if (recorderRef.current === rec) {
        setRecording(false);
        setError(toError(cause));
      }
      throw cause;
    }
  }, []);

  const stop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return null;
    try {
      const c = await rec.stop();
      if (recorderRef.current === rec) {
        setRecording(false);
        setLevel(0);
        setClip(c);
      }
      return c;
    } catch (cause) {
      if (recorderRef.current === rec) {
        setRecording(false);
        setError(toError(cause));
      }
      throw cause;
    }
  }, []);

  return {recording, level, clip, error, start, stop};
}

// ---------------------------------------------------------------------------
// <WaveformView> — render a clip's waveform and (optionally) follow a player.
// ---------------------------------------------------------------------------

export interface WaveformViewProps {
  clip: AudioClip;
  player?: AudioClipPlayer | null;
  options?: WaveformRenderOptions;
  followPlayhead?: boolean;
  seekOnClick?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function WaveformView({
  clip,
  player,
  options,
  followPlayhead = true,
  seekOnClick = true,
  className,
  style,
}: WaveformViewProps): ReactElement {
  const renderRef = useRef<HTMLDivElement | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const container = renderRef.current;
    const channels = clip.channels();
    if (!container || !channels) return;

    const peaks = computePeaks(channels, clip.sampleRate);
    const viz = renderWaveformVisualizer(container, peaks, optionsRef.current);

    let unbind: (() => void) | undefined;
    if (player) {
      const binding = bindPlayerToWaveform(player, viz, {
        followPlayhead,
        seekOnClick,
        surface: container,
      });
      unbind = binding.unsubscribe;
    }
    return () => {
      unbind?.();
      viz.dispose();
    };
  }, [clip, player, options, followPlayhead, seekOnClick]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!player || !seekOnClick) return;
      const step = Math.max(1, player.duration / 100);
      let seconds: number | undefined;
      if (event.key === 'ArrowLeft') seconds = player.seconds - step;
      else if (event.key === 'ArrowRight') seconds = player.seconds + step;
      else if (event.key === 'Home') seconds = 0;
      else if (event.key === 'End') seconds = player.duration;
      if (seconds === undefined) return;
      event.preventDefault();
      player.seek(Math.max(0, Math.min(player.duration, seconds)));
    },
    [player, seekOnClick],
  );

  return (
    <div
      className={className}
      style={{...waveformSurfaceStyle, ...style}}
      role={player && seekOnClick ? 'slider' : undefined}
      tabIndex={player && seekOnClick ? 0 : undefined}
      aria-label={player && seekOnClick ? 'Audio position' : undefined}
      aria-valuemin={player && seekOnClick ? 0 : undefined}
      aria-valuemax={player && seekOnClick ? player.duration : undefined}
      aria-valuenow={player && seekOnClick ? player.seconds : undefined}
      onKeyDown={onKeyDown}
    >
      <div ref={renderRef} style={{width: '100%', minWidth: 0}} />
    </div>
  );
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

// Re-export the underlying packages for convenience (`import { … } from '@webmusic/audio/react'`).
export type {AudioClip} from '../core';
export type {AudioClipPlayerOptions} from '../play/headless';
export type {AudioAnalysisResult, AudioAnalysisTask} from '../analyze/api';
export type {WaveformRenderOptions} from '../view/api';
