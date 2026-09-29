import { TransportClock } from "@webmusic/kernel/transport";
import {
  TransportGroup,
  type SyncFollowerTransport,
  type SyncMasterTransport,
  type TransportCommand,
} from "@webmusic/kernel/sync";
import { createAudioClip } from "@webmusic/audio";
import { AudioClipPlayer } from "@webmusic/audio/play/headless";
import type { DemoScope } from "../demo-lifecycle";

/** A short decaying tone followed by silence; each clip's end is its native loop boundary. */
function pulseClip(seconds: number, frequency: number, sampleRate: number) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const length = Math.round(0.12 * sampleRate);
  for (let i = 0; i < length; i++) {
    const time = i / sampleRate;
    samples[i] =
      0.18 *
      Math.sin(2 * Math.PI * frequency * time) *
      Math.min(1, time / 0.004) *
      Math.exp(-45 * time);
  }
  return createAudioClip({ sampleRate, channelData: [samples] });
}

/** App-owned continuous master: only TransportGroup delegates mutations to it. */
function continuousMaster(context: AudioContext): SyncMasterTransport {
  const now = () => context.currentTime;
  const clock = new TransportClock(now);
  return {
    clock,
    get position() {
      return clock.position;
    },
    play: (when = now()) => clock.startAt(when, clock.position),
    pause: () => clock.pause(now()),
    stop: () => {
      clock.pause(now());
      clock.seekTo(0, now());
    },
    seekPosition: (position, when = now()) => {
      if (clock.paused) clock.seekTo(position, now());
      else clock.startAt(when, position);
    },
    setRate: (rate) => clock.setRate(rate, now()),
    dispose: () => clock.pause(now()),
  };
}

function follower(player: AudioClipPlayer): SyncFollowerTransport {
  return {
    get position() {
      return player.seconds;
    },
    get running() {
      return player.playing;
    },
    get clock() {
      return player.clock;
    },
    play: (when) => player.play(when),
    pause: () => player.pause(),
    stop: () => player.stop(),
    seek: (position) => player.seek(position),
    setRate: (rate) => player.setRate(rate),
    dispose: () => player.dispose(),
  };
}

export function mountIndependentLoops(
  root: HTMLElement,
  scope: DemoScope,
): void {
  const query = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const start = query<HTMLButtonElement>("[data-start]");
  const pause = query<HTMLButtonElement>("[data-pause]");
  const seek = query<HTMLButtonElement>("[data-seek]");
  const rate = query<HTMLSelectElement>("[data-rate]");
  const disposeButton = query<HTMLButtonElement>("[data-dispose]");
  const status = query<HTMLOutputElement>("[data-status]");
  const timeline = query<HTMLOutputElement>("[data-timeline]");
  const bars = [...root.querySelectorAll<HTMLProgressElement>("progress")];
  const periods = [1, 1.5];
  let context: AudioContext | undefined;
  let group: TransportGroup | undefined;
  let players: AudioClipPlayer[] = [];
  const unregistered = new Set<AudioClipPlayer>();
  let busy = false;
  let generation = 0;
  let frame = 0;
  let offGroup: (() => void) | undefined;
  const report = (error: unknown) => {
    if (scope.active)
      status.textContent =
        error instanceof Error ? error.message : String(error);
  };
  const refresh = () => {
    start.disabled = busy;
    pause.disabled = seek.disabled = rate.disabled = !group || busy;
    disposeButton.disabled = !group && !context;
  };
  const dispose = () => {
    generation++;
    try {
      offGroup?.();
    } catch (error) {
      report(error);
    }
    offGroup = undefined;
    try {
      group?.dispose();
    } catch (error) {
      report(error);
    }
    group = undefined;
    for (const player of unregistered) {
      try {
        player.dispose();
      } catch (error) {
        report(error);
      }
    }
    unregistered.clear();
    players = [];
    const oldContext = context;
    context = undefined;
    if (oldContext && oldContext.state !== "closed")
      void oldContext.close().catch(report);
    busy = false;
    rate.value = "1";
    for (const bar of bars) bar.value = 0;
    timeline.textContent = "No active session";
    if (scope.active)
      status.textContent = "Disposed. Play loops creates a new session.";
    refresh();
  };
  const run = async (command: TransportCommand) => {
    if (busy) return;
    const expected = generation;
    busy = true;
    refresh();
    try {
      if (command.type === "play") {
        context ??= new AudioContext();
        refresh();
        await context.resume();
        if (!scope.active || expected !== generation) return;
        if (!group) {
          const sessionContext = context;
          group = new TransportGroup(
            continuousMaster(sessionContext),
            () => sessionContext.currentTime,
            { onOperationError: (_operation, error) => report(error) },
          );
          for (const [index, period] of periods.entries()) {
            const player = new AudioClipPlayer(
              pulseClip(period, index ? 660 : 330, context.sampleRate),
              {
                audioContext: context,
                engine: "buffer",
                loop: { start: 0, end: period },
              },
            );
            players.push(player);
            unregistered.add(player);
            group.addFollower(follower(player), {
              loop: { startSeconds: 0, endSeconds: period },
            });
            unregistered.delete(player);
          }
          offGroup = group.subscribe((event) => {
            if (event.type === "error" || event.type === "operation-error")
              report(event.error);
          });
        }
      }
      const result = await group?.dispatch(command);
      if (
        scope.active &&
        expected === generation &&
        result?.status === "committed"
      ) {
        status.textContent = `${command.type} applied at master ${result.snapshot.position.toFixed(2)} s.`;
      }
    } catch (error) {
      if (scope.active && expected === generation) {
        dispose();
        report(error);
      }
    } finally {
      if (scope.active && expected === generation) {
        busy = false;
        refresh();
      }
    }
  };
  scope.listen(start, "click", () => run({ type: "play" }));
  scope.listen(pause, "click", () => run({ type: "pause" }));
  scope.listen(seek, "click", () => run({ type: "seek", position: 4.25 }));
  scope.listen(rate, "change", () =>
    run({ type: "rate", rate: Number(rate.value) }),
  );
  scope.listen(disposeButton, "click", dispose);
  const draw = () => {
    if (!scope.active) return;
    if (group) {
      const snapshot = group.snapshot;
      const phases = players.map(
        (player, index) => player.seconds % periods[index]!,
      );
      bars.forEach((bar, index) => {
        bar.value = phases[index] ?? 0;
      });
      timeline.textContent = `Master ${snapshot.position.toFixed(2)} s · 1 s loop ${phases[0]?.toFixed(2)} s · 1.5 s loop ${phases[1]?.toFixed(2)} s`;
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);
  scope.add(() => cancelAnimationFrame(frame));
  scope.add(dispose);
  refresh();
}
