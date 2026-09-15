/**
 * The clock layer: ONE `requestAnimationFrame` loop per document, and the two
 * shapes a mount reads a position through.
 *
 * ## Why a shared loop, and not one per mount
 *
 * The two precedents in this kit each own a private rAF — `meter.ts` and
 * `stage.ts` — and for one independent widget on a page that is right. A
 * workbench is six read-outs on one time axis, and six private loops are six
 * wake-ups a second with no shared budget between them; worse, nothing can
 * enforce that all six read the SAME instant, so two docks that are supposed to
 * bite together drift by a frame and the eye sees the join.
 *
 * So the loop is here, keyed by the view that owns the `requestAnimationFrame`
 * — which is one per document — and every mount in that document is one
 * callback inside it. With no subscribers there is no loop at all: a page
 * holding a parked workbench costs nothing.
 *
 * ## The three layers, and which one this is
 *
 * 1. A domain event arrives at ~20 Hz and is turned into one sample.
 * 2. A domain-side predictor turns samples into a position at any instant.
 * 3. **This module** wakes the page 60 times a second and says WHEN, never
 *    WHAT. It is handed a number it has never been told the meaning of.
 *
 * That is the whole reason the loop never touches the DOM: it emits `atMs` and
 * every subscriber decides for itself. It can therefore be driven by a fake
 * `view` in a test, deterministically, which is the only way any of this is
 * testable at all — jsdom's own rAF is a real ~16 ms wall-clock timer.
 *
 * ## Degrading rather than throwing
 *
 * A view with no `requestAnimationFrame` — a server, a jsdom document someone
 * stripped, a detached iframe — gets a subscription that never fires and an
 * unsubscribe that does nothing. A mount built on this reads its position from
 * its own state instead and renders a correct still frame. No motion is a
 * supported outcome; an exception at mount is not.
 */

/**
 * How much a live surface is allowed to move.
 *
 * `'auto'` is the default. It asks the nearest ancestor's `data-motion` FIRST,
 * because these mounts render into a caller's light DOM where a shell answers
 * that question once for a whole workbench and six surfaces must not disagree.
 * With nothing declared above it, it asks `prefers-reduced-motion` itself —
 * guarded, because an environment without `matchMedia` must get an answer and
 * not an exception.
 *
 * Reduced motion changes the DRIVER, never the layout: a `stepped` lane holds
 * the identical nodes at the identical offsets and re-anchors on a band change
 * instead of on a frame. Turning the movement off is allowed; turning the view
 * into a different view would undo the redesign the movement is part of.
 *
 * The preference is read ONCE, at mount. Following a live change of it needs a
 * listener with an owner and a repaint policy; until that lands, a host that
 * wants an OS toggle to take effect immediately passes `motion` explicitly or
 * writes `data-motion` on an ancestor, and the stylesheets carry the same
 * escape as a media query for the case where no JavaScript ever asked.
 */
export type MotionMode = 'auto' | 'continuous' | 'stepped' | 'none';

/** What a surface resolved `motion` to. Written to the root's `data-motion`. */
export type ResolvedMotion = 'continuous' | 'stepped' | 'none';

/** Either kind of host a presenter mounts into. */
export type MotionHost = HTMLElement | ShadowRoot;

/**
 * One frame, as every live mount sees it.
 *
 * `at` is the frame's own timestamp and `now` is the caller's position on an
 * axis this module has never been told the meaning of. They are separate
 * because they are separate FACTS: the frame is when the browser is ready to
 * paint, and the position is where the material had got to — a shell takes that
 * reading exactly once per frame and hands the same number to every dock, so
 * two surfaces cannot answer differently about one instant.
 */
export interface FrameTick {
  /** The frame's timestamp in milliseconds, on the view's own clock. */
  at: number;
  /** The single position reading for this frame, in the caller's own units. */
  now: number;
  /** True from a frame loop, false when a domain event drove this tick. */
  continuous: boolean;
  /**
   * Bumps on any discontinuity — a seek, a loop wrap, a stop. A presenter
   * SNAPS on a change and interpolates otherwise; without it a backwards seek
   * is tweened as a long glide across material nobody heard.
   */
  epoch?: number;
  /** The loop is running at half rate to keep the page responsive. */
  degraded?: boolean;
}

/**
 * A clock somebody else owns.
 *
 * A mount given one of these does NOT open a loop: it is a passenger. That is
 * how a shell keeps "one reading per frame" true for every dock it holds —
 * `read()` answers with the same tick for the whole frame, however many
 * presenters ask.
 */
export interface FrameClock {
  /** Subscribe to the owner's ticks. Returns the unsubscribe. */
  subscribe(draw: (tick: FrameTick) => void): () => void;
  /** The current tick, for a mount that joins between frames. */
  read(): FrameTick;
}

/**
 * One subscriber's callback. `degraded` is the loop telling the truth about
 * itself; a mount that wants to show it writes `data-motion="degraded"`, and
 * one that does not can ignore the second argument entirely — which is why the
 * loop's own contract reads as `(atMs) => void` everywhere it is described.
 */
export type FrameDraw = (atMs: number, degraded: boolean) => void;

/** A callback slower than this, often enough, means the page is struggling. */
const SLOW_FRAME_MS = 4;
/** How many frames the loop judges itself over. */
const JUDGE_WINDOW = 60;
/** Slow frames within that window before the loop halves its own rate. */
const SLOW_LIMIT = 30;

interface DocumentLoop {
  draws: Set<FrameDraw>;
  wake(): void;
  sleep(): void;
  retire(): void;
}

const loops = new WeakMap<object, DocumentLoop>();

type View = (Window & typeof globalThis) | null | undefined;

function createLoop(view: Window & typeof globalThis): DocumentLoop {
  const draws = new Set<FrameDraw>();
  // A ring of the last `JUDGE_WINDOW` verdicts plus their running sum, so the
  // judgement costs one add and one subtract per frame rather than a scan.
  const history = new Array<boolean>(JUDGE_WINDOW).fill(false);
  let cursor = 0;
  let slow = 0;
  let degraded = false;
  let parity = false;
  let frame: number | undefined;
  const clock = (): number => view.performance?.now?.() ?? Date.now();

  const loop: DocumentLoop = {
    draws,
    wake(): void {
      if (frame !== undefined || draws.size === 0) return;
      // rAF is already throttled in a hidden tab; this covers the other case,
      // a document whose whole view was hidden by the page around it.
      if (view.document?.visibilityState === 'hidden') return;
      frame = view.requestAnimationFrame(run);
    },
    sleep(): void {
      if (frame === undefined) return;
      view.cancelAnimationFrame?.(frame);
      frame = undefined;
    },
    retire(): void {
      loop.sleep();
      view.document?.removeEventListener?.('visibilitychange', onVisibility);
      loops.delete(view);
    },
  };

  function onVisibility(): void {
    if (view.document?.visibilityState === 'hidden') loop.sleep();
    else loop.wake();
  }

  function run(at: number): void {
    frame = undefined;
    if (draws.size === 0) return;
    parity = !parity;
    // Half rate while degraded. The loop still re-arms, so the moment the
    // callbacks get cheap again the window empties and full rate returns.
    if (!degraded || parity) {
      const started = clock();
      // A snapshot: a callback is allowed to unsubscribe itself, or another.
      for (const draw of [...draws]) {
        if (!draws.has(draw)) continue;
        try {
          draw(at, degraded);
        } catch {
          // One struggling subscriber may not take the other five down with
          // it. Reporting belongs to the mount, which has the caller's sink.
        }
      }
      const cost = clock() - started;
      const late = cost > SLOW_FRAME_MS;
      if (history[cursor] !== late) slow += late ? 1 : -1;
      history[cursor] = late;
      cursor = (cursor + 1) % JUDGE_WINDOW;
      degraded = slow >= SLOW_LIMIT;
    }
    loop.wake();
  }

  view.document?.addEventListener?.('visibilitychange', onVisibility);
  return loop;
}

/**
 * Join this document's frame loop, starting it if nobody else has.
 *
 * The returned function leaves the loop, and the loop stops as soon as its last
 * subscriber has gone — a subscription is the only thing that keeps a page
 * awake, and dropping it is the only way to let it sleep. Leaving twice is
 * harmless; the second call is a no-op rather than a second removal.
 *
 * A view without `requestAnimationFrame` gets a subscription that never fires.
 * That is the deliberate degradation: no motion, no exception, and a caller
 * that renders correctly from its own state either way.
 */
export function joinFrameLoop(view: View, draw: FrameDraw): () => void {
  if (!view?.requestAnimationFrame) return () => {};
  let loop = loops.get(view);
  if (!loop) {
    loop = createLoop(view);
    loops.set(view, loop);
  }
  const joined = loop;
  joined.draws.add(draw);
  joined.wake();
  let attached = true;
  return (): void => {
    if (!attached) return;
    attached = false;
    joined.draws.delete(draw);
    if (joined.draws.size === 0) joined.retire();
  };
}

/**
 * Resolve `motion`, in the order the answers actually rank.
 *
 * The caller's own option wins. Then the nearest ancestor carrying
 * `data-motion`, which is how a workbench shell answers for its whole subtree
 * with one decision and how six surfaces are stopped from disagreeing. Only
 * with nothing declared above it does a surface ask the viewer directly —
 * every call optional-chained, because `matchMedia` is absent in more than one
 * environment this module is imported into and an absent answer is
 * `'continuous'`, not an exception.
 */
export function resolveMotion(
  host: MotionHost,
  motion: MotionMode | undefined,
  view: View,
): ResolvedMotion {
  if (motion === 'continuous' || motion === 'stepped' || motion === 'none') return motion;
  // Duck-typed rather than `instanceof Element`: this module is imported in a
  // node environment by the SSR tripwire, where that global does not exist.
  const owner =
    typeof (host as HTMLElement).closest === 'function'
      ? (host as HTMLElement)
      : (host as ShadowRoot).host;
  const declared = owner?.closest?.('[data-motion]')?.getAttribute('data-motion');
  if (declared === 'stepped' || declared === 'none' || declared === 'continuous') return declared;
  if (view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return 'stepped';
  return 'continuous';
}
