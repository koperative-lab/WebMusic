import type { ScorePlaybackSource } from "@webmusic/score";
import { defineScoreViewElement } from "@webmusic/score/view/element";
import { defineChordAnalysisElement } from "@webmusic/score/analyze/element";
import { computePeaks } from "@webmusic/audio/analyze";
import { renderWaveformVisualizer } from "@webmusic/audio/view/render";
import {
  createSyncedPlayback,
  renderScoreToClip,
  type TransportCommand,
} from "@webmusic/bridge";
import { mountTransport } from "@webmusic/ui/transport";
import type { DemoScope } from "../demo-lifecycle";
import {
  arabesqueExcerpt,
  loadArabesqueScore,
} from "../headless/arabesque-score";

let nextOwner = 0;
type Pair = ReturnType<typeof createSyncedPlayback>;
type Waveform = ReturnType<typeof renderWaveformVisualizer>;
type PlaybackHost = HTMLElement & { playback?: ScorePlaybackSource };

/** Application composition only: public package entries, explicit resources and commands. */
export function mountBridgeComposition(
  root: HTMLElement,
  scope: DemoScope,
): void {
  defineScoreViewElement();
  defineChordAnalysisElement();
  const query = <T extends HTMLElement>(selector: string): T =>
    root.querySelector<T>(selector)!;
  const load = query<HTMLButtonElement>("[data-load]");
  const replace = query<HTMLButtonElement>("[data-replace]");
  const disposeButton = query<HTMLButtonElement>("[data-dispose]");
  const attach = query<HTMLButtonElement>("[data-attach]");
  const rate = query<HTMLSelectElement>("[data-rate]");
  const loop = query<HTMLInputElement>("[data-loop]");
  const status = query<HTMLOutputElement>("[data-status]");
  const position = query<HTMLOutputElement>("[data-position]");
  const events = query<HTMLElement>("[data-events]");
  const views = query<HTMLElement>("[data-score-views]");
  const waveHost = query<HTMLElement>("[data-wave-surface]");
  const owner = query<PlaybackHost>("[data-playback-owner]");
  owner.id = `wm-composition-owner-${++nextOwner}`;
  let generation = 0;
  let context: AudioContext | undefined;
  let pair: Pair | undefined;
  let wave: Waveform | undefined;
  let offSync: (() => void) | undefined;
  let loading = false;
  let attached = false;
  let extended = false;
  let duration = 0;
  let frame = 0;
  let lastPaint = 0;
  const observers = new Set<() => void>();
  const history: string[] = [];

  const message = (value: string) => {
    if (scope.active) status.textContent = value;
  };
  const report = (error: unknown) =>
    message(error instanceof Error ? error.message : String(error));
  const notify = () => {
    for (const observer of observers) observer();
  };
  const refresh = () => {
    const unavailable = !pair || loading;
    if (pair && !loading) {
      rate.value = String(pair.sync.snapshot.rate);
      loop.checked = !!pair.sync.snapshot.loop;
    }
    replace.disabled = unavailable;
    attach.disabled = unavailable;
    rate.disabled = unavailable;
    loop.disabled = unavailable;
    load.disabled = loading || !!pair;
    disposeButton.disabled = !pair && !loading && !context;
    attach.textContent = attached ? "Detach Score views" : "Attach Score views";
    notify();
  };
  const appendEvent = (entry: string) => {
    history.push(entry);
    if (history.length > 6) history.shift();
    events.textContent = history.join("\n");
  };
  const detachViews = () => {
    views.replaceChildren();
  };
  const mountViews = () => {
    detachViews();
    if (!pair || !attached) return;
    const roll = document.createElement("score-view");
    roll.setAttribute("type", "piano-roll");
    roll.setAttribute("player", `#${owner.id}`);
    roll.setAttribute(
      "aria-label",
      "Score view borrowing the current score player",
    );
    const analysis = document.createElement("score-chord-analysis");
    analysis.setAttribute("player", `#${owner.id}`);
    analysis.setAttribute(
      "aria-label",
      "Chord analysis borrowing the same score",
    );
    views.append(roll, analysis);
  };
  const releasePair = () => {
    // Remove borrowers before releasing their playback owner.
    const previous = pair;
    const previousWave = wave;
    const previousSubscription = offSync;
    pair = undefined;
    offSync = undefined;
    wave = undefined;
    owner.playback = undefined;
    for (const release of [
      detachViews,
      previousSubscription,
      () => previousWave?.dispose(),
      () => previous?.sync.dispose(),
    ]) {
      try {
        release?.();
      } catch (error) {
        report(error);
      }
    }
  };
  const disposeSession = () => {
    generation++;
    loading = false;
    releasePair();
    const previousContext = context;
    context = undefined;
    if (previousContext && previousContext.state !== "closed") {
      void previousContext.close().catch(report);
    }
    duration = 0;
    attached = false;
    rate.value = "1";
    loop.checked = false;
    position.textContent = "No active session";
    message("Disposed. Load an example to start a new session.");
    refresh();
  };
  const command = async (input: TransportCommand) => {
    const current = pair;
    if (!current || loading) return;
    const expected = generation;
    // Resume directly in the click callback, before any asynchronous command work.
    if (input.type === "play") await context?.resume();
    if (!scope.active || expected !== generation || current !== pair) return;
    try {
      const result = await current.sync.dispatch(input);
      if (!scope.active || expected !== generation || current !== pair) return;
      if (result.status === "committed") {
        message(`${input.type} applied; revision ${result.revision}.`);
      }
    } finally {
      if (scope.active && expected === generation && current === pair) refresh();
    }
  };
  const ui = mountTransport(
    query("[data-transport]"),
    {
      snapshot: () => {
        const snapshot = pair?.sync.snapshot;
        const seconds = snapshot?.position ?? 0;
        return {
          playing: !!snapshot && !snapshot.paused,
          seconds,
          duration,
          progress: duration > 0 ? Math.min(1, seconds / duration) : 0,
          disabled: !pair || loading || !!snapshot?.pending,
        };
      },
      play: () => command({ type: "play" }),
      pause: () => {
        void command({ type: "pause" }).catch(report);
      },
      seekFraction: (fraction) =>
        command({ type: "seek", position: fraction * duration }),
      subscribe: (observer) => {
        observers.add(observer);
        return () => {
          observers.delete(observer);
        };
      },
    },
    { label: "Coordinated playback", showTime: "full", onError: report },
  );

  const loadSource = async (nextExtended: boolean) => {
    const expected = ++generation;
    loading = true;
    refresh();
    message("Preparing score and rendering its backing track…");
    let candidate: Pair | undefined;
    try {
      context ??= new AudioContext();
      await context.resume(); // invoked in the Load / Replace gesture
      if (!scope.active || expected !== generation) return;
      if (pair) await pair.sync.dispatch({ type: "pause" });
      if (!scope.active || expected !== generation) return;
      const source = await loadArabesqueScore("midi");
      if (!scope.active || expected !== generation) return;
      const score = arabesqueExcerpt(source, nextExtended ? 24 : 16);
      const clip = await renderScoreToClip(score, { tailSeconds: 0 });
      if (!scope.active || expected !== generation) return;
      const channels = clip.channels();
      if (!channels)
        throw new Error("The rendered clip has no decoded samples.");
      const peaks = computePeaks(channels, clip.sampleRate, {
        baseSamplesPerPeak: 512,
      });
      const candidateOwner: { pair?: Pair } = {};
      candidate = createSyncedPlayback(score, clip, {
        context,
        onOperationError: (operation, error) => {
          if (scope.active && pair === candidateOwner.pair)
            report(new Error(`${operation}: ${String(error)}`));
        },
      });
      candidateOwner.pair = candidate;
      candidate.scorePlayer.setVolume(0); // only the rendered clip sounds
      // Render the candidate before replacing the old working composition.
      const candidateHost = document.createElement("div");
      waveHost.append(candidateHost);
      let candidateWave: Waveform;
      try {
        candidateWave = renderWaveformVisualizer(candidateHost, peaks, {
          height: 88,
          durationSeconds: clip.duration,
          pixelsPerSecond: 120,
        });
      } catch (error) {
        candidateHost.remove();
        throw error;
      }
      releasePair();
      pair = candidate;
      candidate = undefined;
      waveHost.replaceChildren(candidateHost);
      wave = candidateWave;
      duration =
        pair.scorePlayer.playback.snapshot().nominalDurationSeconds ??
        clip.duration;
      const observedPair = pair;
      owner.playback = {
        snapshot: () => observedPair.scorePlayer.playback.snapshot(),
        subscribe: (listener) =>
          observedPair.scorePlayer.playback.subscribe(listener),
        seekNominal: async (seconds) => {
          const result = await observedPair.sync.dispatch({
            type: "seek",
            position: seconds,
          });
          if (result.status !== "committed")
            throw new Error(
              "The seek was superseded by a newer session command.",
            );
        },
      };
      extended = nextExtended;
      rate.value = "1";
      loop.checked = false;
      offSync = pair.sync.subscribe((event) => {
        if (!scope.active || pair !== observedPair) return;
        if (event.type === "commit") {
          appendEvent(
            `r${event.commit.revision}: ${event.commit.status} at ${event.snapshot.position.toFixed(2)} score s`,
          );
        } else if (event.type === "error" || event.type === "operation-error")
          report(event.error);
        refresh();
      });
      mountViews();
      wave.redraw(pair.clipPlayer.seconds);
      message(
        `Arabesque No. 1 opening (${extended ? 24 : 16} quarter-note beats) ready. Click Play, then attach views.`,
      );
    } catch (error) {
      candidate?.sync.dispose();
      if (scope.active && expected === generation) {
        const reason = error instanceof Error ? error.message : String(error);
        report(
          pair
            ? `Replacement failed; the previous source remains paused. ${reason}`
            : error,
        );
        if (!pair) {
          const failedContext = context;
          context = undefined;
          if (failedContext && failedContext.state !== "closed")
            void failedContext.close().catch(report);
        }
      }
    } finally {
      if (scope.active && expected === generation) {
        loading = false;
        refresh();
      }
    }
  };

  scope.listen(load, "click", () => loadSource(false));
  scope.listen(replace, "click", () => loadSource(!extended));
  scope.listen(disposeButton, "click", disposeSession);
  scope.listen(rate, "change", () =>
    command({ type: "rate", rate: Number(rate.value) }).catch(report),
  );
  scope.listen(loop, "change", () =>
    command({
      type: "loop",
      loop: loop.checked ? { startSeconds: 0, endSeconds: duration } : null,
    }).catch(report),
  );
  scope.listen(attach, "click", () => {
    attached = !attached;
    mountViews();
    message(
      attached
        ? "Views attached to the current score and playback snapshot."
        : "Views detached; playback remains owned by the session.",
    );
    refresh();
  });
  const draw = (now: number) => {
    if (!scope.active) return;
    if (pair && now - lastPaint >= 80) {
      lastPaint = now;
      const snapshot = pair.sync.snapshot;
      wave?.redraw(pair.clipPlayer.seconds, true);
      position.textContent = `${snapshot.position.toFixed(2)} score s · ${pair.clipPlayer.seconds.toFixed(2)} clip s · ${snapshot.rate}×`;
      notify();
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  scope.add(() => cancelAnimationFrame(frame));
  scope.add(() => ui.destroy());
  scope.add(disposeSession);
  refresh();
}
