import {
  Duration,
  MeasureId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  type NoteData,
  type Transpose,
} from "../../src/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TonePlayer,
  type HeadlessSynth,
  type ToneLike,
  type ToneTransportLike,
} from "../../src/play/headless";

type ScoreNote = Partial<NoteData> &
  Pick<NoteData, "pitch" | "onsetQuarters" | "duration">;

interface ScheduledTransportEvent {
  id: number;
  callback: (time: number) => void;
  time: number | string;
  cancelled: boolean;
}

type TransportLifecycleEvent = "start" | "pause" | "stop";

function scoreWith(notes: ScoreNote[], transpose?: Transpose) {
  const builder = new ScoreBuilder();
  const part = builder.addPart({ id: PartId("p"), name: "Piano", transpose });
  const voice = VoiceId("v");
  builder.addMeasure({
    id: MeasureId("m1"),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature: { numerator: 4, denominator: 4 },
  });
  for (const note of notes) {
    builder.addNote(part, {
      id: builder.newNoteId(),
      voice,
      ...note,
    } as NoteData);
  }
  return builder.build();
}

function score() {
  return scoreWith([
    {
      pitch: Pitch.parse("C4"),
      onsetQuarters: Rational.ZERO,
      duration: Duration.quarter(),
    },
  ]);
}

function performedTieScore() {
  return scoreWith(
    [
      {
        pitch: Pitch.parse("B4"),
        onsetQuarters: Rational.ZERO,
        duration: new Duration({ base: 0 }),
        grace: true,
      },
      {
        pitch: Pitch.parse("D4"),
        onsetQuarters: Rational.ZERO,
        duration: Duration.quarter(),
        tie: "start",
      },
      {
        pitch: Pitch.parse("D4"),
        onsetQuarters: Rational.ONE,
        duration: Duration.quarter(),
        tie: "stop",
        performed: { onsetSec: 2.5, durationSec: 0.5, velocity: 100 },
      },
    ],
    { chromatic: -2, diatonic: -1 },
  );
}

function overlappingC4Score() {
  return scoreWith([
    {
      pitch: Pitch.parse("C4"),
      onsetQuarters: Rational.ZERO,
      duration: Duration.half(),
    },
    {
      pitch: Pitch.parse("C4"),
      onsetQuarters: Rational.ONE,
      duration: Duration.quarter(),
    },
  ]);
}

function toneMock({ events = true }: { events?: boolean } = {}): {
  tone: ToneLike;
  transport: ToneTransportLike;
  scheduled: ScheduledTransportEvent[];
  setNow(time: number): void;
} {
  let nextScheduleId = 0;
  let now = 0;
  const scheduled: ScheduledTransportEvent[] = [];
  const listeners = new Map<
    TransportLifecycleEvent,
    Set<(time: number) => void>
  >();
  const emit = (event: TransportLifecycleEvent, time = 0): void => {
    for (const listener of listeners.get(event) ?? []) listener(time);
  };
  const transport: ToneTransportLike = {
    bpm: { value: 120 },
    seconds: 0,
    state: "stopped",
    start() {
      this.state = "started";
      emit("start");
    },
    pause() {
      this.state = "paused";
      emit("pause");
    },
    stop() {
      this.state = "stopped";
      emit("stop");
    },
    schedule: vi.fn(
      (callback: (time: number) => void, time: number | string) => {
        const id = ++nextScheduleId;
        scheduled.push({ id, callback, time, cancelled: false });
        return id;
      },
    ),
    clear: vi.fn((id: number) => {
      const event = scheduled.find((candidate) => candidate.id === id);
      if (event) event.cancelled = true;
    }),
    cancel: vi.fn(() => {
      for (const event of scheduled) event.cancelled = true;
    }),
  };
  if (events) {
    transport.on = vi.fn(
      (
        event: TransportLifecycleEvent,
        listener: (time: number) => void,
      ) => {
        const eventListeners = listeners.get(event) ?? new Set();
        eventListeners.add(listener);
        listeners.set(event, eventListeners);
        return transport;
      },
    );
    transport.off = vi.fn(
      (
        event: TransportLifecycleEvent,
        listener: (time: number) => void,
      ) => {
        listeners.get(event)?.delete(listener);
        return transport;
      },
    );
  }
  return {
    tone: {
      start: vi.fn(async () => undefined),
      now: () => now,
      Transport: transport,
    },
    transport,
    scheduled,
    setNow: (time) => {
      now = time;
    },
  };
}

const synth = (): HeadlessSynth => ({ noteOn: vi.fn(), noteOff: vi.fn() });

describe("TonePlayer transport adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["owned", "shared"] as const)("preserves a newer seek from noteOff during %s stop", async (transportOwnership) => {
    const {tone, transport, scheduled} = toneMock();
    const player = new TonePlayer(score(), {tone, transportOwnership, synth: synth()});
    await player.play();
    if (transportOwnership === "shared") transport.start();
    scheduled[0].callback(0);
    player.on("noteOff", () => player.seek(0.25));
    player.stop();
    expect(player.seconds).toBeCloseTo(0.25);
    expect(player.isPlaying()).toBe(true);
    player.dispose();
  });

  it.each(["pause", "seek", "tempo"] as const)("does not recreate schedule after noteOff disposes during %s", async (operation) => {
    const {tone, scheduled} = toneMock();
    const player = new TonePlayer(score(), {tone, synth: synth()});
    await player.play();
    scheduled[0].callback(0);
    player.on("noteOff", () => player.dispose());
    if (operation === "pause") player.pause();
    else if (operation === "seek") player.seek(0.25);
    else player.setTempo(240);
    expect(scheduled.filter((event) => !event.cancelled)).toEqual([]);
    expect(player.rate).toBe(1);
  });

  it("allows noteOff to resume a paused owned transport with a fresh sustained-note schedule", async () => {
    const {tone, transport, scheduled} = toneMock();
    const player = new TonePlayer(score(), {tone, synth: synth()});
    await player.play();
    scheduled[0].callback(0);
    transport.seconds = 0.25;
    let resumed: Promise<void> | undefined;
    const off = player.on("noteOff", () => { resumed = player.play(); });
    player.pause();
    await resumed;
    expect(player.isPlaying()).toBe(true);
    expect(scheduled.filter((event) => !event.cancelled).map((event) => event.time)).toEqual([0.25, 0.5, 2]);
    off();
    player.dispose();
  });

  it.each([
    {ownership: "owned" as const, command: "pause" as const},
    {ownership: "owned" as const, command: "stop" as const},
    {ownership: "shared" as const, command: "pause" as const},
    {ownership: "shared" as const, command: "stop" as const},
  ])("finishes old chord releases and rearms one new pass for $ownership $command → play", async ({ownership, command}) => {
    const {tone, transport, scheduled, setNow} = toneMock();
    const chord = scoreWith(["C4", "E4"].map((pitch) => ({
      pitch: Pitch.parse(pitch), onsetQuarters: Rational.ZERO, duration: Duration.half(),
    })));
    let nextHandle = 0;
    const noteOn = vi.fn(() => ++nextHandle);
    const noteOffById = vi.fn();
    const player = new TonePlayer(chord, {tone, transportOwnership: ownership, synth: {noteOn, noteOffById}});
    await player.play();
    if (ownership === "shared") transport.start();
    scheduled.filter((event) => event.time === 0).forEach((event) => event.callback(0));
    transport.seconds = 0.25;
    setNow(0.25);
    const globalPause = vi.spyOn(transport, "pause");
    const globalStop = vi.spyOn(transport, "stop");
    let resumed: Promise<void> | undefined;
    let observedPosition: number | undefined;
    const off = player.on("noteOff", () => {
      observedPosition ??= player.seconds;
      resumed ??= player.play();
    });
    player[command]();
    await resumed;
    expect(noteOffById.mock.calls.map(([handle]) => handle)).toEqual([1, 2]);
    expect(observedPosition).toBeCloseTo(0.25);
    expect(player.isPlaying()).toBe(true);
    const live = scheduled.filter((event) => !event.cancelled);
    expect(live).toHaveLength(5);
    const attackTime = ownership === "shared" ? 0.27 : 0.25;
    const attacks = live.filter((event) => event.time === attackTime);
    expect(attacks).toHaveLength(2);
    attacks.forEach((event) => event.callback(attackTime));
    expect(noteOn).toHaveBeenCalledTimes(4);
    if (ownership === "shared") {
      expect(globalPause).not.toHaveBeenCalled();
      expect(globalStop).not.toHaveBeenCalled();
      expect(transport.seconds).toBe(0.25);
    }
    off();
    player.dispose();
    expect(noteOffById.mock.calls.map(([handle]) => handle)).toEqual([1, 2, 3, 4]);
  });

  it.each(["seek", "tempo"] as const)("preserves pending unlock intent while applying a newer %s", async (operation) => {
    const {tone, scheduled} = toneMock();
    let unlock!: () => void;
    tone.start = vi.fn(() => new Promise<void>((resolve) => { unlock = resolve; }));
    const player = new TonePlayer(score(), {tone, synth: synth()});
    const pending = player.play();
    if (operation === "seek") player.seek(0.25);
    else player.setRate(2);
    unlock();
    await pending;
    expect(player.isPlaying()).toBe(true);
    expect(scheduled[0].time).toBe(operation === "seek" ? 0.25 : 0);
    expect(player.rate).toBe(operation === "tempo" ? 2 : 1);
    player.dispose();
  });

  it("ignores infinite tempo scales without releasing or replacing the current pass", async () => {
    const {tone, transport, scheduled} = toneMock();
    const backend = synth();
    const player = new TonePlayer(score(), {tone, synth: backend});
    player.setRate(2);
    await player.play();
    scheduled[0].callback(0);
    transport.seconds = 0.125;
    const count = scheduled.length;
    player.setRate(Number.POSITIVE_INFINITY);
    expect(player.rate).toBe(2);
    expect(player.nominalSeconds).toBe(0.25);
    expect(player.duration).toBe(1);
    expect(backend.noteOff).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(count);
    player.dispose();
  });

  it("isolates note and end listeners from Tone transport callbacks", async () => {
    const { tone, scheduled } = toneMock();
    const noteOffById = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      synth: { noteOn: vi.fn(() => "voice"), noteOffById },
    });
    const laterOn = vi.fn();
    const laterOff = vi.fn();
    const laterEnd = vi.fn();
    const listenerErrors: string[] = [];
    player.on("noteOn", () => {
      throw new Error("Tone noteOn listener");
    });
    player.on("noteOn", laterOn);
    player.on("noteOff", () => {
      throw new Error("Tone noteOff listener");
    });
    player.on("noteOff", laterOff);
    player.on("end", () => {
      throw new Error("Tone end listener");
    });
    player.on("end", laterEnd);
    player.on("listenerError", ({ event }) => listenerErrors.push(event));

    await player.play();
    expect(() => scheduled[0].callback(10)).not.toThrow();
    expect(() => scheduled[1].callback(10.5)).not.toThrow();
    expect(() => scheduled[2].callback(12)).not.toThrow();

    expect(noteOffById).toHaveBeenCalledWith("voice", 10.5);
    expect(laterOn).toHaveBeenCalledTimes(1);
    expect(laterOff).toHaveBeenCalledTimes(1);
    expect(laterEnd).toHaveBeenCalledTimes(1);
    expect(listenerErrors).toEqual(["noteOn", "noteOff", "end"]);
    player.dispose();
  });

  it("preserves a sub-10ms logical gate", async () => {
    const { tone, scheduled, setNow } = toneMock();
    const noteOn = vi.fn();
    const player = new TonePlayer(scoreWith([
      {
        pitch: Pitch.parse("C4"),
        onsetQuarters: Rational.ZERO,
        duration: Duration.quarter(),
        performed: { onsetSec: 0, durationSec: 0.005, velocity: 100 },
      },
    ]), { tone, synth: { noteOn } });

    await player.play();
    setNow(9);
    scheduled[0].callback(10);

    expect(noteOn).toHaveBeenCalledWith(
      Pitch.parse("C4").midi,
      100,
      10,
      expect.closeTo(0.005, 6),
    );
    player.dispose();
  });

  it("shortens a late callback to its remaining logical gate", async () => {
    const { tone, scheduled, setNow } = toneMock();
    const noteOn = vi.fn();
    const player = new TonePlayer(score(), { tone, synth: { noteOn } });

    await player.play();
    setNow(10.2);
    scheduled[0].callback(10);

    expect(noteOn).toHaveBeenCalledTimes(1);
    expect(noteOn).toHaveBeenCalledWith(
      Pitch.parse("C4").midi,
      80,
      10.2,
      expect.closeTo(0.3, 6),
    );
    player.dispose();
  });

  it("drops a late callback after its logical gate has expired", async () => {
    const { tone, scheduled, setNow } = toneMock();
    const noteOn = vi.fn();
    const emittedOn = vi.fn();
    const emittedOff = vi.fn();
    const player = new TonePlayer(score(), { tone, synth: { noteOn } });
    player.on("noteOn", emittedOn);
    player.on("noteOff", emittedOff);

    await player.play();
    setNow(10.5);
    scheduled[0].callback(10);
    scheduled[1].callback(10.5);

    expect(noteOn).not.toHaveBeenCalled();
    expect(emittedOn).not.toHaveBeenCalled();
    expect(emittedOff).not.toHaveBeenCalled();
    player.dispose();
  });

  it("releases a voice created by a reentrant stop inside noteOn", async () => {
    const { tone, scheduled } = toneMock();
    const released = vi.fn();
    const backend: HeadlessSynth = {
      noteOn: () => {
        player.stop();
        return "stale-tone-voice";
      },
      noteOffById: released,
    };
    const player = new TonePlayer(score(), { tone, synth: backend });
    const logicalOn = vi.fn();
    player.on("noteOn", logicalOn);

    await player.play();
    expect(() => scheduled[0].callback(10)).not.toThrow();

    expect(player.isPlaying()).toBe(false);
    expect(logicalOn).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledWith("stale-tone-voice", 0);
    player.dispose();
  });

  it("falls back from a throwing scheduled cancellation to exact release", async () => {
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    const { tone, scheduled, setNow } = toneMock();
    const cancelScheduledNote = vi.fn(() => {
      throw new Error("cancel failed");
    });
    const noteOffById = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      synth: {
        supportsScheduledCancellation: true,
        noteOn: vi.fn(() => "future-voice"),
        cancelScheduledNote,
        noteOffById,
      },
    });

    await player.play();
    scheduled[0].callback(10);
    setNow(5);
    expect(() => player.pause()).not.toThrow();

    expect(cancelScheduledNote).toHaveBeenCalledWith("future-voice", 5);
    expect(noteOffById).toHaveBeenCalledWith("future-voice", 5);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reported).toHaveBeenCalled();
    player.dispose();
  });

  it("continues multi-voice release and owned disposal after backend throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { tone, scheduled, setNow } = toneMock();
    let nextHandle = 0;
    const noteOffById = vi.fn(() => {
      throw new Error("exact release failed");
    });
    const noteOff = vi.fn(() => {
      throw new Error("pitch release failed");
    });
    const dispose = vi.fn();
    const player = new TonePlayer(overlappingC4Score(), {
      tone,
      synth: {
        noteOn: () => ++nextHandle,
        noteOffById,
        noteOff,
        dispose,
      },
      synthOwnership: "owned",
    });
    const operations: string[] = [];
    player.on("operationError", ({ operation }) => operations.push(operation));

    await player.play();
    const ons = scheduled.filter((event) => event.time === 0 || event.time === 0.5);
    ons[0].callback(10);
    ons[1].callback(10.5);
    setNow(10.75);
    expect(() => player.stop()).not.toThrow();
    expect(() => player.dispose()).not.toThrow();

    expect(noteOffById).toHaveBeenCalledTimes(2);
    expect(noteOff).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(operations).toEqual(["noteOffById", "noteOffById", "noteOff"]);
  });

  it("cleans voices and invalidates its schedule when transport pause throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { tone, transport, scheduled } = toneMock();
    const noteOffById = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      synth: { noteOn: () => "voice", noteOffById },
    });
    await player.play();
    scheduled[0].callback(10);
    transport.pause = vi.fn(() => {
      throw new Error("transport pause failed");
    });

    expect(() => player.pause()).not.toThrow();

    expect(noteOffById).toHaveBeenCalledWith("voice", 0);
    expect(scheduled.every((event) => event.cancelled)).toBe(true);
    player.dispose();
  });

  it("finishes cleanup and emits end when Tone's terminal pause throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 42));
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const { tone, transport, scheduled } = toneMock();
    const noteOffById = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      synth: { noteOn: () => "voice", noteOffById },
    });
    const ended = vi.fn();
    player.on("end", ended);
    await player.play();
    scheduled[0].callback(10);
    transport.pause = vi.fn(() => {
      throw new Error("terminal pause failed");
    });

    expect(() => scheduled[2].callback(12)).not.toThrow();

    expect(noteOffById).toHaveBeenCalledWith("voice", 12);
    expect(scheduled.every((event) => event.cancelled)).toBe(true);
    expect(cancelFrame).toHaveBeenCalledWith(42);
    expect(ended).toHaveBeenCalledTimes(1);
    player.dispose();
  });

  it("clears remaining work when transport stop throws", async () => {
    const { tone, transport, scheduled } = toneMock();
    const noteOffById = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      synth: { noteOn: () => "voice", noteOffById },
    });
    await player.play();
    scheduled[0].callback(10);
    transport.stop = vi.fn(() => {
      throw new Error("transport stop failed");
    });

    expect(() => player.stop()).not.toThrow();

    expect(noteOffById).toHaveBeenCalledWith("voice", 0);
    expect(scheduled.every((event) => event.cancelled)).toBe(true);
    player.dispose();
  });

  it("implements the rate-aware driver transport surface", async () => {
    const { tone, transport } = toneMock();
    const player = new TonePlayer(score(), {
      tone,
      synth: synth(),
    });

    await player.play();
    expect(player.isPlaying()).toBe(true);
    expect(player.duration).toBeCloseTo(2, 5);

    player.seekFraction(0.5);
    expect(player.seconds).toBeCloseTo(1, 5);
    expect(player.currentTime.seconds).toBeCloseTo(1, 5);

    player.setRate(2);
    expect(player.rate).toBe(2);
    expect(player.duration).toBeCloseTo(1, 5);
    expect(player.seconds).toBeCloseTo(0.5, 5); // preserves the musical point

    player.scrub(0.25);
    expect(player.seconds).toBeCloseTo(0.75, 5);
    expect(player.progress).toBeCloseTo(0.75, 5);

    player.pause();
    expect(player.isPlaying()).toBe(false);
    expect(transport.state).toBe("paused");
    // No transportOwnership option: the legacy default still controls the
    // injected Transport for self-contained playback.
    player.stop();
    expect(transport.state).toBe("stopped");
    expect(transport.seconds).toBe(0);
    player.dispose();
  });

  it("clips an owned seek into a sustained note to one attack at the seek position", async () => {
    const { tone, transport, scheduled } = toneMock();
    const noteOn = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      transportOwnership: "owned",
      synth: { noteOn },
    });

    await player.play();
    player.seek(0.25);

    // Regression: owned rebuilds used to reschedule the historical onset (0)
    // behind the new transport position, which Tone.Transport never fires —
    // the note spanning the seek point was silently dropped. The unified
    // scheduleFrom() primitive now clips it exactly like shared mode.
    expect(transport.seconds).toBe(0.25);
    const active = scheduled.filter((event) => !event.cancelled);
    expect(active.map((event) => event.time)).toEqual([0.25, 0.5, 2]);
    active[0].callback(10);
    expect(noteOn).toHaveBeenCalledWith(Pitch.parse("C4").midi, 80, 10, 0.25);
    player.dispose();
  });

  it("re-attacks a sustained note after an owned pause and resume", async () => {
    const { tone, transport, scheduled, setNow } = toneMock();
    const noteOn = vi.fn(() => "voice");
    const noteOffById = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      transportOwnership: "owned",
      synth: { noteOn, noteOffById },
    });

    await player.play();
    scheduled[0].callback(10); // the C4 attack has fired
    setNow(10.25);
    transport.seconds = 0.25; // transport advanced mid-note before pause()
    player.pause();

    expect(noteOffById).toHaveBeenCalledWith("voice", 10.25);
    // Regression: the paused rebuild used to reinstall the onset at 0, so
    // resuming from 0.25 stayed silent until the next onset. The rebuilt
    // schedule now holds one clipped re-attack at the pause position.
    const rebuilt = scheduled.filter((event) => !event.cancelled);
    expect(rebuilt.map((event) => event.time)).toEqual([0.25, 0.5, 2]);

    await player.play();
    expect(player.isPlaying()).toBe(true);
    rebuilt[0].callback(10.3);
    expect(noteOn).toHaveBeenLastCalledWith(
      Pitch.parse("C4").midi,
      80,
      10.3,
      0.25,
    );
    player.dispose();
  });

  it("schedules a fresh owned play from zero without clipping", async () => {
    const { tone, scheduled } = toneMock();
    const player = new TonePlayer(overlappingC4Score(), {
      tone,
      transportOwnership: "owned",
      synth: synth(),
    });

    await player.play();

    // Position 0 through the unified scheduleFrom() must clip nothing: every
    // onset/off pair plus the end event, at their historical times.
    expect(scheduled.map((event) => event.time)).toEqual([0, 1, 0.5, 1, 2]);
    expect(scheduled.some((event) => event.cancelled)).toBe(false);
    player.dispose();
  });

  it("uses explicit shared ownership without controlling an already-running clock", async () => {
    const { tone, transport, scheduled } = toneMock();
    transport.state = "started";
    transport.seconds = 7;
    const start = vi.fn(transport.start.bind(transport));
    const pause = vi.fn(transport.pause.bind(transport));
    const stop = vi.fn(transport.stop.bind(transport));
    transport.start = start;
    transport.pause = pause;
    transport.stop = stop;
    const noteOn = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      synth: {noteOn},
      transportOwnership: "shared",
    });

    await player.play();

    // This player attaches a local pass to an existing global clock instead of
    // returning early or starting/stopping another Tone user's Transport.
    expect(player.isPlaying()).toBe(true);
    expect(start).not.toHaveBeenCalled();
    expect(scheduled.filter((event) => !event.cancelled).map((event) => event.time)).toEqual([
      7.02,
      7.52,
      9.02,
    ]);

    player.seek(0.25);
    expect(transport.seconds).toBe(7);
    const clippedOn = scheduled.find(
      (event) => !event.cancelled && event.time === 7.02,
    );
    clippedOn?.callback(10);
    expect(noteOn).toHaveBeenCalledWith(Pitch.parse("C4").midi, 80, 10, 0.25);

    player.pause();
    expect(transport.state).toBe("started");
    expect(pause).not.toHaveBeenCalled();
    player.stop();
    expect(transport.state).toBe("started");
    expect(stop).not.toHaveBeenCalled();
    player.dispose();
  });

  it("observes host pause and stop without controlling the shared Transport", async () => {
    const { tone, transport, scheduled, setNow } = toneMock();
    transport.state = "started";
    transport.seconds = 7;
    const hostStart = vi.fn(transport.start.bind(transport));
    const hostPause = vi.fn(transport.pause.bind(transport));
    const hostStop = vi.fn(transport.stop.bind(transport));
    transport.start = hostStart;
    transport.pause = hostPause;
    transport.stop = hostStop;
    const requestFrame = vi.fn(() => 42);
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    try {
      const noteOn = vi.fn(() => "voice");
      const noteOffById = vi.fn();
      const player = new TonePlayer(score(), {
        tone,
        synth: { noteOn, noteOffById },
        transportOwnership: "shared",
      });

      await player.play();
      const firstAttack = scheduled.find((event) => event.time === 7.02);
      firstAttack?.callback(10);
      setNow(10.25);
      transport.seconds = 7.5;
      hostPause();

      // The host made the one pause call. TonePlayer only removes its own
      // entries, releases its voice, and stops its own cursor frame.
      expect(hostPause).toHaveBeenCalledTimes(1);
      expect(player.isPlaying()).toBe(false);
      expect(player.seconds).toBeCloseTo(0.48, 5);
      expect(noteOffById).toHaveBeenCalledWith("voice", 10.25);
      expect(scheduled.every((event) => event.cancelled)).toBe(true);
      expect(cancelFrame).toHaveBeenCalledWith(42);

      // A host start alone does not implicitly restart a score that it paused.
      // Re-arm only this player, then let the host start its global clock.
      await player.rearmSharedTransport(0.5);
      expect(player.isPlaying()).toBe(false);
      hostStart();
      expect(hostStart).toHaveBeenCalledTimes(1);
      expect(player.isPlaying()).toBe(true);

      hostStop();
      expect(hostStop).toHaveBeenCalledTimes(1);
      expect(player.isPlaying()).toBe(false);
      expect(scheduled.filter((event) => !event.cancelled)).toHaveLength(0);
      player.dispose();
      expect(transport.off).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("starts the cursor when a host starts a pre-armed shared transport", async () => {
    const { tone, transport } = toneMock();
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    try {
      const player = new TonePlayer(score(), {
        tone,
        transportOwnership: "shared",
      });
      await player.play(); // arm while the host clock is stopped
      expect(player.isPlaying()).toBe(false);
      expect(requestFrame).not.toHaveBeenCalled();

      transport.start();
      expect(player.isPlaying()).toBe(true);
      expect(requestFrame).toHaveBeenCalledTimes(1);
      frames.shift()?.(0);
      player.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rearms only local entries after an unobservable host cancel or seek", async () => {
    const { tone, transport, scheduled } = toneMock();
    transport.state = "started";
    transport.seconds = 7;
    const hostStart = vi.fn(transport.start.bind(transport));
    const hostPause = vi.fn(transport.pause.bind(transport));
    const hostStop = vi.fn(transport.stop.bind(transport));
    transport.start = hostStart;
    transport.pause = hostPause;
    transport.stop = hostStop;
    const player = new TonePlayer(score(), {
      tone,
      transportOwnership: "shared",
    });

    await player.play();
    transport.cancel(); // Tone exposes no lifecycle event for this operation.
    expect(scheduled.filter((event) => !event.cancelled)).toHaveLength(0);

    await player.rearmSharedTransport(0.25);
    expect(transport.seconds).toBe(7);
    expect(hostStart).not.toHaveBeenCalled();
    expect(hostPause).not.toHaveBeenCalled();
    expect(hostStop).not.toHaveBeenCalled();
    expect(scheduled.filter((event) => !event.cancelled).map((event) => event.time)).toEqual([
      7.02,
      7.27,
      8.77,
    ]);

    // A direct host seek is equally opaque. Supplying the desired score
    // position rebuilds just this player's future segment at the new anchor.
    transport.seconds = 11;
    await player.rearmSharedTransport(0.25);
    expect(transport.seconds).toBe(11);
    expect(scheduled.filter((event) => !event.cancelled).map((event) => event.time)).toEqual([
      11.02,
      11.27,
      12.77,
    ]);
    player.dispose();
  });

  it("keeps a minimal shared transport without on/off hooks usable", async () => {
    const { tone, transport, scheduled } = toneMock({ events: false });
    const player = new TonePlayer(score(), {
      tone,
      transportOwnership: "shared",
    });

    await player.play();
    expect(player.isPlaying()).toBe(false);
    expect(scheduled.filter((event) => !event.cancelled).map((event) => event.time)).toEqual([
      0,
      0.5,
      2,
    ]);

    await player.rearmSharedTransport(0.25);
    expect(transport.seconds).toBe(0);
    expect(scheduled.filter((event) => !event.cancelled).map((event) => event.time)).toEqual([
      0,
      0.25,
      1.75,
    ]);

    // A minimal adapter cannot emit host lifecycle notifications, so its host
    // explicitly re-arms after starting the clock.
    transport.start();
    await player.rearmSharedTransport(0.25);
    expect(player.isPlaying()).toBe(true);
    player.dispose();
  });

  it("uses the shared timeline for ties, grace notes, transposition, and performed tails", async () => {
    const { tone, scheduled } = toneMock();
    const noteOn = vi.fn(() => "tied-voice");
    const noteOff = vi.fn();
    const noteOffById = vi.fn();
    const player = new TonePlayer(performedTieScore(), {
      tone,
      transportOwnership: "owned",
      synth: { noteOn, noteOff, noteOffById },
    });
    const emittedOn = vi.fn();
    const emittedOff = vi.fn();
    player.on("noteOn", emittedOn);
    player.on("noteOff", emittedOff);

    await player.play();

    // The notation ends at 2s, but the performed tie reaches 3s. The grace
    // note is skipped and the two tied D4s become one transposed C4 attack.
    expect(player.duration).toBeCloseTo(3, 5);
    expect(scheduled.map((event) => event.time)).toEqual([0, 3, 3]);

    scheduled[0].callback(10);
    scheduled[1].callback(13);

    expect(noteOn).toHaveBeenCalledWith(Pitch.parse("C4").midi, 80, 10, 3);
    expect(noteOffById).toHaveBeenCalledWith("tied-voice", 13);
    expect(noteOff).not.toHaveBeenCalled();
    expect(emittedOn).toHaveBeenCalledTimes(1);
    expect(emittedOff).toHaveBeenCalledTimes(1);
  });

  it("releases overlapping same-pitch voices by their individual handles", async () => {
    const { tone, scheduled } = toneMock();
    const noteOn = vi
      .fn()
      .mockReturnValueOnce("first")
      .mockReturnValueOnce("second");
    const noteOff = vi.fn();
    const noteOffById = vi.fn();
    const player = new TonePlayer(overlappingC4Score(), {
      tone,
      transportOwnership: "owned",
      synth: { noteOn, noteOff, noteOffById },
    });

    await player.play();
    const eventsAt = (time: number) =>
      scheduled.filter((event) => event.time === time);
    const [firstOn] = eventsAt(0);
    const [secondOn] = eventsAt(0.5);
    const offs = eventsAt(1);

    firstOn.callback(10);
    secondOn.callback(10.5);
    offs[0].callback(11);
    offs[1].callback(12);

    expect(noteOffById).toHaveBeenNthCalledWith(1, "first", 11);
    expect(noteOffById).toHaveBeenNthCalledWith(2, "second", 12);
    expect(noteOff).not.toHaveBeenCalled();
  });

  it("falls back to pitch release when a synth does not provide a voice handle", async () => {
    const { tone, scheduled } = toneMock();
    const noteOn = vi.fn();
    const noteOff = vi.fn();
    const noteOffById = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      transportOwnership: "owned",
      synth: { noteOn, noteOff, noteOffById },
    });

    await player.play();
    scheduled[0].callback(5);
    scheduled[1].callback(6);

    expect(noteOff).toHaveBeenCalledWith(Pitch.parse("C4").midi, 6);
    expect(noteOffById).not.toHaveBeenCalled();
  });

  it("keeps an overlapping pitch alive until the final handle-less occurrence ends", async () => {
    const { tone, scheduled } = toneMock();
    const noteOn = vi.fn();
    const noteOff = vi.fn();
    const player = new TonePlayer(overlappingC4Score(), {
      tone,
      transportOwnership: "owned",
      synth: { noteOn, noteOff },
    });

    await player.play();
    const eventsAt = (time: number) =>
      scheduled.filter((event) => event.time === time);
    eventsAt(0)[0].callback(10);
    eventsAt(0.5)[0].callback(10.5);
    const offs = eventsAt(1);
    offs[0].callback(11);

    // A pitch-only backend cannot distinguish the two C4s. Releasing the
    // first one must not truncate the later overlap.
    expect(noteOff).not.toHaveBeenCalled();
    offs[1].callback(12);
    expect(noteOff).toHaveBeenCalledTimes(1);
    expect(noteOff).toHaveBeenCalledWith(Pitch.parse("C4").midi, 12);
  });

  it.each([
    ["pause", (player: TonePlayer) => player.pause()],
    ["stop", (player: TonePlayer) => player.stop()],
    ["seek", (player: TonePlayer) => player.seek(0.25)],
    ["rate change", (player: TonePlayer) => player.setRate(2)],
    ["dispose", (player: TonePlayer) => player.dispose()],
  ])("releases a fired exact voice on %s", async (_label, action) => {
    const { tone, scheduled, setNow } = toneMock();
    const noteOn = vi.fn(() => "voice");
    const noteOffById = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      transportOwnership: "owned",
      synth: { noteOn, noteOffById },
    });
    const emittedOff = vi.fn();
    player.on("noteOff", emittedOff);

    await player.play();
    scheduled[0].callback(10);
    setNow(10.25);
    action(player);

    expect(noteOffById).toHaveBeenCalledTimes(1);
    expect(noteOffById).toHaveBeenCalledWith("voice", 10.25);
    expect(emittedOff).toHaveBeenCalledTimes(1);
    player.dispose();
  });

  it("cancels a lookahead attack before its AudioContext onset", async () => {
    const { tone, scheduled, setNow } = toneMock();
    const cancelScheduledNote = vi.fn();
    const noteOffById = vi.fn();
    const player = new TonePlayer(score(), {
      tone,
      transportOwnership: "owned",
      synth: {
        supportsScheduledCancellation: true,
        noteOn: vi.fn(() => "future-voice"),
        noteOffById,
        cancelScheduledNote,
      },
    });

    await player.play();
    scheduled[0].callback(10); // Tone's lookahead callback schedules a future attack.
    setNow(5);
    player.pause();

    expect(cancelScheduledNote).toHaveBeenCalledWith("future-voice", 5);
    expect(noteOffById).not.toHaveBeenCalled();
    player.dispose();
  });

  it("binds a voice release to the synth that created it and invalidates stale callbacks", async () => {
    const { tone, scheduled, setNow } = toneMock();
    const oldSynth = {
      noteOn: vi.fn(() => "old-voice"),
      noteOffById: vi.fn(),
      dispose: vi.fn(),
    } satisfies HeadlessSynth;
    const replacement = {
      noteOn: vi.fn(() => "new-voice"),
      noteOffById: vi.fn(),
    } satisfies HeadlessSynth;
    const player = new TonePlayer(score(), {
      tone,
      transportOwnership: "owned",
      synth: oldSynth,
      synthOwnership: "owned",
    });

    await player.play();
    const staleOn = scheduled[0];
    staleOn.callback(10);
    setNow(10.25);
    player.setSynth(replacement);

    expect(oldSynth.noteOffById).toHaveBeenCalledWith("old-voice", 10.25);
    expect(replacement.noteOffById).not.toHaveBeenCalled();
    expect(oldSynth.dispose).toHaveBeenCalledTimes(1);

    // Rate rebuilding clears transport ids, but a callback that escaped Tone's
    // own lookahead must still be harmless in user code.
    player.setRate(2);
    staleOn.callback(20);
    expect(replacement.noteOn).not.toHaveBeenCalled();
    const freshOn = scheduled.find(
      (event) => !event.cancelled && event.time === 0,
    );
    freshOn?.callback(21);
    expect(replacement.noteOn).toHaveBeenCalledTimes(1);
    player.dispose();
  });

  it("leaves an injected borrowed synth untouched and disposes only owned synths", () => {
    const borrowed = {
      noteOn: vi.fn(),
      disconnect: vi.fn(),
      dispose: vi.fn(),
    } satisfies HeadlessSynth;
    const borrowedPlayer = new TonePlayer(score(), {
      tone: toneMock().tone,
      transportOwnership: "owned",
      synth: borrowed,
    });
    borrowedPlayer.dispose();
    expect(borrowed.disconnect).not.toHaveBeenCalled();
    expect(borrowed.dispose).not.toHaveBeenCalled();

    const owned = {
      noteOn: vi.fn(),
      disconnect: vi.fn(),
      dispose: vi.fn(),
    } satisfies HeadlessSynth;
    const ownedPlayer = new TonePlayer(score(), {
      tone: toneMock().tone,
      transportOwnership: "owned",
      synth: owned,
      synthOwnership: "owned",
    });
    ownedPlayer.dispose();
    expect(owned.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    {ownership: "owned" as const, action: "pause" as const},
    {ownership: "owned" as const, action: "stop" as const},
    {ownership: "owned" as const, action: "dispose" as const},
    {ownership: "shared" as const, action: "pause" as const},
    {ownership: "shared" as const, action: "stop" as const},
    {ownership: "shared" as const, action: "dispose" as const},
  ])("does not resurrect a $ownership transport after pending play is cancelled by $action", async ({
    ownership,
    action,
  }) => {
    const {tone, transport, scheduled} = toneMock();
    let unlock!: () => void;
    tone.start = vi.fn(() => new Promise<void>((resolve) => {
      unlock = resolve;
    }));
    const start = vi.spyOn(transport, "start");
    const player = new TonePlayer(score(), {
      tone,
      transportOwnership: ownership,
      synth: synth(),
    });

    const pending = player.play();
    if (action === "pause") player.pause();
    else if (action === "stop") player.stop();
    else player.dispose();
    unlock();
    await pending;

    expect(scheduled).toHaveLength(0);
    expect(start).not.toHaveBeenCalled();
    expect(player.isPlaying()).toBe(false);
    if (action !== "dispose") player.dispose();
  });

  it("treats a rejected unlock as cancelled after pause", async () => {
    const {tone} = toneMock();
    let rejectUnlock!: (error: unknown) => void;
    tone.start = vi.fn(() => new Promise<void>((_resolve, reject) => {
      rejectUnlock = reject;
    }));
    const player = new TonePlayer(score(), {tone, synth: synth()});
    const pending = player.play();
    player.pause();
    rejectUnlock(new Error("autoplay denied after cancellation"));

    await expect(pending).resolves.toBeUndefined();
    player.dispose();
  });

  describe("rolling schedule window", () => {
    afterEach(() => vi.useRealTimers());

    /** 60 quarters at 120 bpm — half a second each, so 30 seconds of score. */
    const longScore = () =>
      scoreWith(
        Array.from({length: 60}, (_, index) => ({
          pitch: Pitch.parse("C4"),
          onsetQuarters: new Rational(index),
          duration: Duration.quarter(),
        })),
      );

    const liveEvents = (scheduled: ScheduledTransportEvent[]) =>
      scheduled.filter((event) => !event.cancelled).length;

    it("installs a bounded window instead of the whole score", async () => {
      vi.useFakeTimers();
      const {tone, transport, scheduled} = toneMock();
      const player = new TonePlayer(longScore(), {tone, synth: synth()});

      await player.play();

      // Two callbacks per note plus one end event. The whole score would be
      // 121; the window covers only the notes within the horizon.
      const installed = scheduled.length;
      expect(installed).toBeLessThan(30);
      expect(installed).toBeGreaterThan(2);

      // As the transport advances the window follows it.
      transport.seconds = 10;
      await vi.advanceTimersByTimeAsync(200);
      expect(scheduled.length).toBeGreaterThan(installed);

      // ...and by the end of the score every note has been installed exactly
      // once, so nothing is dropped by the windowing.
      transport.seconds = 30;
      await vi.advanceTimersByTimeAsync(200);
      expect(scheduled.length).toBe(121);
      player.dispose();
    });

    it("keeps a seek's teardown and rebuild bounded too", async () => {
      vi.useFakeTimers();
      const {tone, transport, scheduled} = toneMock();
      const player = new TonePlayer(longScore(), {tone, synth: synth()});

      await player.play();
      scheduled.length = 0;
      player.seek(20);

      // The rebuild installs the window around the new position, not the
      // fifteen seconds of score that remain after it.
      expect(scheduled.length).toBeLessThan(30);
      // The cursor re-seats at the seek, so the first entry installed there
      // belongs to the new position rather than the top of the score.
      expect(liveEvents(scheduled)).toBe(scheduled.length);
      expect(transport.seconds).toBe(20);
      player.dispose();
    });
  });
});
