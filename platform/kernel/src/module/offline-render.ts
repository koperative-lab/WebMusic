import {SessionTransport} from '../session';
import {ModuleContext} from './context';
import {createOfflineModuleEnvironment, type OfflineEnvironmentOptions} from './sinks';

export interface ModuleGraphRenderOptions extends OfflineEnvironmentOptions {
  /** Root scope ID. Default `offline`. */
  id?: string;
  /** Session position the render starts from, in Session seconds. Default 0. */
  startSeconds?: number;
  /**
   * Build the graph in the offline scope: create modules (players, Racks,
   * effects) with this context, exactly as live. Return a cleanup to run
   * after rendering; modules left registered are not disposed for you.
   */
  build(scope: ModuleContext): void | (() => void) | Promise<void | (() => void)>;
}

/**
 * Realize a whole module graph offline (DEC-068): the graph is built in an
 * offline scope with its own Session, started on that Session, and rendered
 * once. Routes, Racks, inserts and Session scheduling are the live ones;
 * lookahead schedulers are ticked in rendered time, so the render runs faster
 * than real time without dropping events. The Session is disposed afterwards.
 */
export async function renderModuleGraph(options: ModuleGraphRenderOptions): Promise<AudioBuffer> {
  const offline = createOfflineModuleEnvironment(options);
  const session = new SessionTransport(() => offline.context.currentTime, {driftCheckIntervalMs: 0});
  const scope = new ModuleContext({id: options.id ?? 'offline', audio: offline.environment, session});
  let cleanup: void | (() => void) = undefined;
  try {
    cleanup = await options.build(scope);
    if (options.startSeconds) await session.seek(options.startSeconds);
    await session.play();
    return await offline.render();
  } finally {
    try { await session.stop(); } catch { /* The rendered result stands. */ }
    try { if (typeof cleanup === 'function') cleanup(); } finally { session.dispose(); }
  }
}
