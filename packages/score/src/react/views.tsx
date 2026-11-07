import React from 'react';
import {noteMidi, noteOnsetSeconds, type Score} from '../core';
import type {ScorePlayer} from '../play/headless';
import {
  bindPlayerToVisualizer,
  renderPianoRollVisualizer,
  renderStaffVisualizer,
  renderWaterfallVisualizer,
} from '../view/render';
import type {RenderedScoreVisualizer, ViewLayoutOptions} from '../view/api';
import {useCursor, usePlayer, useScore} from './context';
import {componentSurfaceStyle} from './surface';

const stageSurfaceStyle = componentSurfaceStyle('stage');
const transportSurfaceStyle = componentSurfaceStyle('transport');

/**
 * Wire a `@webmusic/score/play` Player's noteOn/end events to a rendered visualizer
 * via the shared `bindPlayerToVisualizer` helper. Returns an unbind function
 * that also clears any remaining highlight.
 */
function bindPlayer(rendered: RenderedScoreVisualizer, player: ScorePlayer, score: Score): () => void {
  return bindPlayerToVisualizer(rendered, ({noteOn, end}) => {
    const offNoteOn = player.on('noteOn', (note) =>
      noteOn(noteMidi(note), noteOnsetSeconds(note, score)),
    );
    const offEnd = player.on('end', end);
    return () => {
      offNoteOn();
      offEnd();
    };
  });
}

export interface ViewProps extends ViewLayoutOptions {
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
  /** Show score expression directions on the scrolling staff; default true. Only the staff draws annotations. */
  showAnnotations?: boolean;
}

export function PianoRollView({
  width = '100%',
  height = 240,
  className,
  style,
  ariaLabel = 'Piano roll',
  ...layoutOptions
}: ViewProps) {
  const score = useScore();
  const player = usePlayer();
  const svgRef = React.useRef<SVGSVGElement>(null);

  React.useEffect(() => {
    if (!svgRef.current) return;
    const rendered = renderPianoRollVisualizer(score, svgRef.current, {
      noteHeight: layoutOptions.laneHeight,
      pixelsPerSecond: layoutOptions.pixelsPerSecond,
    });
    const unbind = bindPlayer(rendered, player, score);
    return () => {
      unbind();
      // Undo the visualizer's DOM side effects: it reparents the svg into a
      // scroll-viewport wrapper; dispose restores the svg under our ref's
      // original parent and removes the wrapper + drawn notes.
      rendered.dispose?.();
    };
  }, [score, player, layoutOptions.laneHeight, layoutOptions.pixelsPerSecond]);

  // The renderer reparents the SVG into its horizontal scroll viewport. Keep
  // the public surface on this stable wrapper so the frame stays fixed around
  // the viewport instead of becoming part of the full-width scrolling score.
  // No viewBox on the SVG: the visualizer owns its explicit content size.
  return (
    <div
      className={className}
      style={{...stageSurfaceStyle, width, maxWidth: '100%', ...style}}
      role="img"
      aria-label={ariaLabel}
    >
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        style={{display: 'block'}}
        aria-hidden="true"
        focusable="false"
      />
    </div>
  );
}

export function StaffView({
  width = '100%',
  height = 220,
  className,
  style,
  ariaLabel = 'Musical staff',
  ...layoutOptions
}: StaffViewProps) {
  const score = useScore();
  const player = usePlayer();
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const staging = document.createElement('div');
    staging.style.width = '100%';
    staging.style.minHeight = '100%';
    container.replaceChildren(staging);
    const rendered = renderStaffVisualizer(score, staging, {
      noteHeight: layoutOptions.laneHeight,
      pixelsPerSecond: layoutOptions.pixelsPerSecond ?? 0,
      showAnnotations: layoutOptions.showAnnotations,
    });
    const unbind = bindPlayer(rendered, player, score);
    return () => {
      if (staging.parentNode === container) staging.remove();
      unbind();
      rendered.dispose?.();
      staging.replaceChildren();
    };
  }, [score, player, layoutOptions.laneHeight, layoutOptions.pixelsPerSecond, layoutOptions.showAnnotations]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{...stageSurfaceStyle, width, height, overflow: 'auto', ...style}}
      role="img"
      aria-label={ariaLabel}
    />
  );
}


export function WaterfallView({
  width = '100%',
  height = 320,
  className,
  style,
  ariaLabel = 'Waterfall score view',
  ...layoutOptions
}: ViewProps) {
  const score = useScore();
  const player = usePlayer();
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rendered = renderWaterfallVisualizer(score, container, {
      noteHeight: layoutOptions.laneHeight,
      pixelsPerSecond: layoutOptions.pixelsPerSecond,
    });
    const unbind = bindPlayer(rendered, player, score);
    return () => {
      unbind();
      rendered.dispose?.();
      container.replaceChildren();
    };
  }, [score, player, layoutOptions.laneHeight, layoutOptions.pixelsPerSecond]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{...stageSurfaceStyle, width, height, overflow: 'hidden', ...style}}
      role="img"
      aria-label={ariaLabel}
    />
  );
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
  // During a ScorePlayer replacement, old state can survive until the ownership
  // effect runs. Render from the replacement immediately, and tag every
  // asynchronous update with the ScorePlayer that owns it.
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
