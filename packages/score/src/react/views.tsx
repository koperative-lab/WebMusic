import React from 'react';
import {
  renderOSMDStaffVisualizer,
  renderPianoRollVisualizer,
  renderStaffVisualizer,
  renderWaterfallVisualizer,
  type OSMDStaffOptions,
} from '../view/render';
import type {ViewLayoutOptions} from '../view/api';
import {useCursor, usePlayer} from './context';
import {componentSurfaceStyle} from './surface';
import {useScoreViewRenderer, type ReactScoreRenderer, type ReactScoreViewSource} from './view-lifecycle';

const stageSurfaceStyle = componentSurfaceStyle('stage');
const transportSurfaceStyle = componentSurfaceStyle('transport');

export interface ViewProps extends ViewLayoutOptions, ReactScoreViewSource {
  /** Show score expression directions; default true. OSMD uses its own options. */
  showAnnotations?: boolean;
  /** CSS width or numeric pixel width. Defaults to the containing block. */
  width?: number | string;
  /** CSS height or numeric pixel height. */
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;
  /** Accessible name for the rendered score graphic. */
  ariaLabel?: string;
}

export interface StaffViewProps extends ViewProps {
  /** Optional page engraving. Supply MusicXML or a converter and the optional OSMD peer. */
  osmd?: OSMDStaffOptions;
}

export function PianoRollView({
  width = '100%', height = 240, className, style, ariaLabel = 'Piano roll',
  score, playback, onStateChange, laneHeight, pixelsPerSecond, showAnnotations,
}: ViewProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const renderer = React.useCallback<ReactScoreRenderer>((currentScore, surface) => {
    const svg = surface.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(height));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.style.display = 'block';
    surface.append(svg);
    return renderPianoRollVisualizer(currentScore, svg, {
      noteHeight: laneHeight, pixelsPerSecond, showAnnotations,
    });
  }, [height, laneHeight, pixelsPerSecond, showAnnotations]);
  useScoreViewRenderer(containerRef, {score, playback, onStateChange}, 'piano-roll', renderer);
  return <div ref={containerRef} className={className}
    style={{...stageSurfaceStyle, width, maxWidth: '100%', ...style}}
    role="img" aria-label={ariaLabel} />;
}

export function StaffView({
  width = '100%', height = 220, className, style, ariaLabel = 'Musical staff', osmd,
  score, playback, onStateChange, laneHeight, pixelsPerSecond, showAnnotations,
}: StaffViewProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  // Preserve the existing options contract: inline object identity does not
  // restart OSMD. Remount to apply changed options within an enabled mode.
  const osmdRef = React.useRef(osmd);
  osmdRef.current = osmd;
  const osmdEnabled = Boolean(osmd);
  const renderer = React.useCallback<ReactScoreRenderer>((currentScore, surface, signal) => {
    const options = osmdRef.current;
    if (!osmdEnabled || !options) {
      return renderStaffVisualizer(currentScore, surface, {
        noteHeight: laneHeight, pixelsPerSecond: pixelsPerSecond ?? 0, showAnnotations,
      });
    }
    const controller = new AbortController();
    const externalSignal = options.signal;
    const abortExternal = (): void => controller.abort(externalSignal?.reason);
    const abortOwned = (): void => {
      controller.abort(signal.reason);
      externalSignal?.removeEventListener('abort', abortExternal);
    };
    if (signal.aborted) abortOwned();
    else signal.addEventListener('abort', abortOwned, {once: true});
    if (externalSignal?.aborted) abortExternal();
    else externalSignal?.addEventListener('abort', abortExternal, {once: true});
    const detachSignals = (): void => {
      signal.removeEventListener('abort', abortOwned);
      externalSignal?.removeEventListener('abort', abortExternal);
    };
    return renderOSMDStaffVisualizer(currentScore, surface, {...options, signal: controller.signal})
      .then((rendered) => ({
        ...rendered,
        dispose() {
          detachSignals();
          rendered.dispose?.();
        },
      }), (error) => {
        detachSignals();
        throw error;
      });
  }, [osmdEnabled, laneHeight, pixelsPerSecond, showAnnotations]);
  useScoreViewRenderer(containerRef, {score, playback, onStateChange}, 'staff', renderer);
  return <div ref={containerRef} className={className}
    style={{...stageSurfaceStyle, width, height, overflow: 'auto', ...style}}
    role="img" aria-label={ariaLabel} />;
}

export function WaterfallView({
  width = '100%', height = 320, className, style, ariaLabel = 'Waterfall score view',
  score, playback, onStateChange, laneHeight, pixelsPerSecond, showAnnotations,
}: ViewProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const renderer = React.useCallback<ReactScoreRenderer>((currentScore, surface) => renderWaterfallVisualizer(currentScore, surface, {
    noteHeight: laneHeight, pixelsPerSecond, showAnnotations,
  }), [laneHeight, pixelsPerSecond, showAnnotations]);
  useScoreViewRenderer(containerRef, {score, playback, onStateChange}, 'waterfall', renderer);
  return <div ref={containerRef} className={className}
    style={{...stageSurfaceStyle, width, height, overflow: 'hidden', ...style}}
    role="img" aria-label={ariaLabel} />;
}

export function PlayerControls({className}: {className?: string}) {
  const player = usePlayer();
  // The cursor context causes this component to re-render on the player's
  // cadence, but its TimePosition is nominal score time. Read the transport
  // fields from the player itself so progress and seek use one time domain.
  useCursor();
  const [playbackState, setPlaybackState] = React.useState(() => ({player, playing: false}));
  const playerOwnership = React.useMemo(() => ({active: true, player}), [player]);
  const playRequestGeneration = React.useRef(0);
  // During a Player replacement, old state can survive until the ownership
  // effect runs. Render from the replacement immediately, and tag every
  // asynchronous update with the Player that owns it.
  const playing =
    playbackState.player === player ? playbackState.playing : (player.isPlaying?.() ?? false);
  const transportDuration = Math.max(player.duration, 0.001);
  const transportSeconds = Math.max(0, Math.min(player.seconds, transportDuration));
  const progress = Math.max(0, Math.min(1, transportSeconds / transportDuration));

  // Keep `playing` in sync with the player's real state: 'end' fires when
  // playback runs out, and every 'cursor' tick re-reads isPlaying() so external
  // pause/stop calls (or play() failures elsewhere) cannot desync the button.
  React.useEffect(() => {
    playerOwnership.active = true;
    setPlaybackState({player, playing: player.isPlaying?.() ?? false});
    const offEnd = player.on('end', () => {
      setPlaybackState((current) =>
        current.player === player ? {...current, playing: false} : current,
      );
    });
    const offCursor = player.on('cursor', () => {
      setPlaybackState((current) =>
        current.player === player
          ? {...current, playing: player.isPlaying?.() ?? false}
          : current,
      );
    });
    return () => {
      playerOwnership.active = false;
      playRequestGeneration.current += 1;
      offEnd();
      offCursor();
    };
  }, [player, playerOwnership]);

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    player.seekFraction(Math.max(0, Math.min(1, fraction)));
  };

  return (
    <div className={['webscore-react-controls', className].filter(Boolean).join(' ')} style={controlStyles.root}>
      <button
        className="webscore-react-controls__button"
        type="button"
        aria-label={playing ? 'Pause' : 'Play'}
        title={playing ? 'Pause' : 'Play'}
        style={controlStyles.button}
        onClick={() => {
          if (playing) {
            playRequestGeneration.current += 1;
            player.pause();
            setPlaybackState({player, playing: false});
          } else {
            setPlaybackState({player, playing: true});
            const requestPlayer = player;
            const requestOwnership = playerOwnership;
            const requestGeneration = ++playRequestGeneration.current;
            player.play().catch((error) => {
              if (
                !requestOwnership.active ||
                playRequestGeneration.current !== requestGeneration
              ) return;
              // Autoplay policy or audio init failure: drop back to "paused".
              console.error('[WebScore] play failed', error);
              setPlaybackState((current) => {
                if (current.player !== requestPlayer) return current;
                return {...current, playing: false};
              });
            });
          }
        }}
      >
        <PlayerIcon playing={playing} />
      </button>
      <div
        className="webscore-react-controls__progress"
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={transportDuration}
        aria-valuenow={transportSeconds}
        tabIndex={0}
        style={controlStyles.progress}
        onPointerDown={seekFromPointer}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') player.seek(Math.max(0, transportSeconds - 1));
          if (event.key === 'ArrowRight') player.seek(Math.min(transportDuration, transportSeconds + 1));
          if (event.key === 'Home') player.seekFraction(0);
          if (event.key === 'End') player.seekFraction(1);
        }}
      >
        <span
          className="webscore-react-controls__progress-fill"
          style={{...controlStyles.progressFill, width: `${progress * 100}%`}}
        />
      </div>
    </div>
  );
}

function PlayerIcon({playing}: {playing: boolean}) {
  if (playing) {
    return (
      <svg
        className="webscore-react-controls__icon"
        viewBox="0 0 24 24"
        width="var(--webscore-react-icon-size, 1.25rem)"
        height="var(--webscore-react-icon-size, 1.25rem)"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="7" y="5" width="3.5" height="14" fill="currentColor" />
        <rect x="13.5" y="5" width="3.5" height="14" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg
      className="webscore-react-controls__icon"
      viewBox="0 0 24 24"
      width="var(--webscore-react-icon-size, 1.25rem)"
      height="var(--webscore-react-icon-size, 1.25rem)"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points="8 5 19 12 8 19 8 5" fill="currentColor" />
    </svg>
  );
}

const controlStyles = {
  root: {
    ...transportSurfaceStyle,
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--webscore-react-control-gap, 0.75rem)',
    width: '100%',
  } satisfies React.CSSProperties,
  button: {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'var(--webscore-react-button-width, 3.25rem)',
    height: 'var(--webscore-react-control-height, 3rem)',
    minWidth: 'var(--webscore-react-button-width, 3.25rem)',
    minHeight: 'var(--webscore-react-control-height, 3rem)',
    border: '1px solid var(--webscore-react-button-border, #111)',
    background: 'var(--webscore-react-button-bg, #111)',
    color: 'var(--webscore-react-button-color, #fff)',
    cursor: 'pointer',
    padding: 0,
    margin: 0,
  } satisfies React.CSSProperties,
  progress: {
    flex: '1 1 auto',
    height: 'var(--webscore-react-progress-height, 0.7rem)',
    border:
      '1px solid var(--webscore-react-progress-border, var(--wm-control-border, var(--wm-border, #d8d8d8)))',
    background: 'var(--webscore-react-progress-bg, #f3f3f3)',
    cursor: 'pointer',
    overflow: 'hidden',
  } satisfies React.CSSProperties,
  progressFill: {
    display: 'block',
    height: '100%',
    background: 'var(--webscore-react-progress-fill, #111)',
  } satisfies React.CSSProperties,
};
