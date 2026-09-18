import React, {createContext, useContext, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {type Score, type TimePosition} from '../core';
import {Player, type PlayerOptions} from '../play/headless';

export interface ScoreProviderProps {
  score: Score;
  playerOptions?: PlayerOptions;
  children: React.ReactNode;
}

const ScoreContext = createContext<Score | null>(null);
const PlayerContext = createContext<Player | null>(null);
const CursorContext = createContext<TimePosition | null>(null);

// Player construction is a side effect, so it must not run during render:
// React may invoke render twice (StrictMode) or discard a render entirely,
// leaking never-disposed instances — and StrictMode's mount → cleanup →
// remount cycle must end with a live player, not the disposed one a
// render-memoized instance would be. Construction therefore lives in a
// commit-phase effect. useLayoutEffect keeps the pre-player window from ever
// painting in the browser; during SSR (where layout effects warn and never
// run) fall back to useEffect — the provider renders nothing on the server
// either way.
const useIsomorphicLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

/**
 * The provided score/player pair always comes from the same effect commit, so
 * consumers never observe a new score with the outgoing score's player (or
 * vice versa) while a replacement is in flight.
 */
interface ProvidedPlayback {
  score: Score;
  player: Player;
}

export function ScoreProvider({score, playerOptions, children}: ScoreProviderProps) {
  // `playerOptions` is captured on first render. Parents often write the
  // options object inline ({...}), giving it a new identity every render —
  // putting it in the effect deps would tear down and recreate the audio
  // player on every parent render. Behavior: later changes to `playerOptions`
  // are intentionally ignored; remount the provider (e.g. with a React `key`)
  // to apply new options.
  const playerOptionsRef = useRef(playerOptions);
  const [provided, setProvided] = useState<ProvidedPlayback | null>(null);
  const [cursorState, setCursorState] = useState<{player: Player; cursor: TimePosition} | null>(
    null,
  );

  // Construct, subscribe and dispose as one ownership unit: every player this
  // effect creates is disposed by exactly this effect's cleanup, which is what
  // makes the StrictMode remount cycle safe (the remounted setup constructs a
  // fresh player instead of resubscribing to the disposed one). The active
  // flag prevents a callback already queued by the old Player from publishing
  // after a score replacement. Unsubscribe before stop/dispose because
  // transport teardown itself may synchronously emit a final cursor event.
  useIsomorphicLayoutEffect(() => {
    const player = new Player(score, playerOptionsRef.current);
    let active = true;
    const offCursor = player.on('cursor', (nextCursor) => {
      if (active) setCursorState({player, cursor: nextCursor});
    });
    setProvided({score, player});

    return () => {
      active = false;
      offCursor();
      try {
        player.stop?.();
      } finally {
        player.dispose?.();
      }
    };
  }, [score]);

  // Children need a live Player synchronously during their render (controls
  // read transport fields, useCursor reads the initial cursor), so rather than
  // widening every hook to a nullable seam, withhold children for the single
  // pre-effect commit. The layout effect above then provides the player and
  // synchronously re-renders before the browser paints.
  if (!provided) return null;

  // State from the previous Player may still exist during the render that
  // replaces it. Derive the public cursor from the new Player immediately;
  // the owned state catches up on its first cursor event.
  const cursor =
    cursorState && cursorState.player === provided.player
      ? cursorState.cursor
      : provided.player.currentTime;

  return (
    <ScoreContext.Provider value={provided.score}>
      <PlayerContext.Provider value={provided.player}>
        <CursorContext.Provider value={cursor}>{children}</CursorContext.Provider>
      </PlayerContext.Provider>
    </ScoreContext.Provider>
  );
}

/** Like {@link useScore} but returns null outside a ScoreProvider instead of throwing. */
export function useOptionalScore(): Score | null {
  return useContext(ScoreContext);
}

/** Internal optional seam for views that also support static or borrowed data. */
export function useOptionalPlayer(): Player | null {
  return useContext(PlayerContext);
}

export function useScore(): Score {
  const score = useContext(ScoreContext);
  if (!score) {
    throw new Error('useScore must be used inside ScoreProvider');
  }
  return score;
}

export function usePlayer(): Player {
  const player = useContext(PlayerContext);
  if (!player) {
    throw new Error('usePlayer must be used inside ScoreProvider');
  }
  return player;
}

export function useCursor(): TimePosition {
  const cursor = useContext(CursorContext);
  if (!cursor) {
    throw new Error('useCursor must be used inside ScoreProvider');
  }
  return cursor;
}
