import type {ScorePlayerElement} from '@webmusic/score/play/element';

/** Show loading and failures; keep the status row hidden during normal playback. */
export function mountQuickStartStatus(player: ScorePlayerElement, status: HTMLElement): () => void {
  let lastState = '';
  const write = (message: string): void => {
    status.hidden = message.length === 0;
    if (status.textContent !== message) status.textContent = message;
  };
  const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
  const unsubscribe = player.playback.subscribe((snapshot) => {
    const state = `${snapshot.sourceRevision}:${snapshot.readiness}:${snapshot.state}`;
    if (state === lastState) return;
    lastState = state;
    if (snapshot.readiness === 'error') {
      write(`Could not load the score: ${message(snapshot.error)}`);
    } else if (snapshot.readiness !== 'ready') {
      write('Loading score…');
    } else {
      write('');
    }
  });
  const onError = (event: Event): void => {
    const {error} = (event as CustomEvent<{error: unknown}>).detail;
    write(`Playback failed: ${message(error)}`);
  };
  player.addEventListener('webscore:error', onError);
  return () => {
    unsubscribe();
    player.removeEventListener('webscore:error', onError);
  };
}
