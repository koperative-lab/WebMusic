import { describe, expect, it } from "vitest";
import {
  Duration,
  NoteId,
  Part,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
} from "../../src/core";
import { analyzeIntervals } from "../../src/analyze/core/interval";

function add(
  builder: ScoreBuilder,
  part: string,
  voice: string,
  id: string,
  pitch: string | null,
  onset: number,
  duration = 1,
  options: { unpitched?: boolean; chord?: boolean; tie?: "start" | "continue" | "stop" } = {},
): void {
  builder.addNote(PartId(part), {
    id: NoteId(id),
    ...(pitch === null ? { rest: true } : { pitch: Pitch.parse(pitch) }),
    onsetQuarters: Rational.from(onset),
    duration: new Duration({ base: Rational.from(duration) }),
    voice: VoiceId(voice),
    ...options,
  });
}

describe("analyzeIntervals", () => {
  it("names consecutive melodic motion from spelling, with signed semitones and note provenance", () => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("solo"), name: "Solo" });
    add(builder, "solo", "v1", "a", "C4", 0);
    add(builder, "solo", "v1", "b", "E4", 1);
    add(builder, "solo", "v1", "c", "Db4", 2);
    const score = builder.build();

    const result = analyzeIntervals(score, { partId: "solo", voiceId: "v1" });
    expect(result.pitchMode).toBe("written");
    expect(result.intervals).toHaveLength(2);
    expect(result.intervals[0]).toMatchObject({
      kind: "melodic",
      label: "3M",
      number: 3,
      quality: "M",
      semitones: 4,
      direction: "ascending",
      startQuarters: 0,
      endQuarters: 1,
      evidence: [
        { noteId: "a", partId: "solo", voiceId: "v1", pitch: "C4" },
        { noteId: "b", partId: "solo", voiceId: "v1", pitch: "E4" },
      ],
    });
    expect(result.intervals[1]).toMatchObject({
      kind: "melodic",
      label: "2A",
      semitones: -3,
      direction: "descending",
      evidence: [{ noteId: "b" }, { noteId: "c" }],
    });
    expect(
      analyzeIntervals(score, { partId: "solo", voiceId: "v1" }).intervals.map(
        (interval) => interval.id,
      ),
    ).toEqual(result.intervals.map((interval) => interval.id));
    expect(score.getNote(NoteId("c"))?.pitch?.toString()).toBe("Db4");
  });

  it("finds vertical pairs within a chord and across sustaining voices, clipping to a range", () => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("keys"), name: "Keys" });
    builder.addPart({ id: PartId("lead"), name: "Lead" });
    add(builder, "keys", "chord", "c", "C4", 0, 2);
    add(builder, "keys", "chord", "e", "Eb4", 0, 2, { chord: true });
    add(builder, "lead", "melody", "g", "G4", 1, 1);

    const intervals = analyzeIntervals(builder.build(), {
      fromQuarters: 1,
      toQuarters: 1.5,
    }).intervals;
    expect(intervals.map((interval) => interval.label)).toEqual([
      "3m",
      "5P",
      "3M",
    ]);
    expect(intervals.every((interval) => interval.kind === "harmonic")).toBe(
      true,
    );
    expect(
      intervals.every((interval) => interval.direction === "vertical"),
    ).toBe(true);
    expect(
      intervals.every(
        (interval) =>
          interval.startQuarters === 1 && interval.endQuarters === 1.5,
      ),
    ).toBe(true);
    expect(
      intervals.map((interval) => interval.evidence.map((note) => note.noteId)),
    ).toEqual([
      ["c", "e"],
      ["c", "g"],
      ["e", "g"],
    ]);
  });

  it("compares explicitly selected chord members without creating a melodic step", () => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("p"), name: "P" });
    add(builder, "p", "v", "a", "C#4", 0);
    add(builder, "p", "v", "b", "Db4", 0, 1, { chord: true });
    add(builder, "p", "v", "c", "G4", 1);

    const result = analyzeIntervals(builder.build(), { noteIds: ["a", "b"] });
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0]).toMatchObject({
      kind: "harmonic",
      label: "2d",
      semitones: 0,
      evidence: [{ noteId: "a" }, { noteId: "b" }],
    });
  });

  it("uses part transposition and its diatonic hint only in sounding mode", () => {
    const builder = new ScoreBuilder();
    builder.addPart({
      id: PartId("clarinet"),
      name: "Clarinet",
      transpose: { chromatic: -2, diatonic: -1 },
    });
    builder.addPart({ id: PartId("piano"), name: "Piano" });
    add(builder, "clarinet", "cl", "f", "F4", 0);
    add(builder, "piano", "pn", "g", "G4", 0);
    const score = builder.build();
    const selection = { noteIds: ["f", "g"] };

    expect(analyzeIntervals(score, selection).intervals[0]).toMatchObject({
      label: "2M",
      semitones: 2,
    });
    const sounding = analyzeIntervals(score, selection, {
      pitchMode: "sounding",
    });
    expect(sounding.pitchMode).toBe("sounding");
    expect(sounding.intervals[0]).toMatchObject({
      label: "3M",
      semitones: 4,
      evidence: [
        { writtenPitch: "F4", pitch: "Eb4" },
        { writtenPitch: "G4", pitch: "G4" },
      ],
    });
  });

  it("keeps a harmonic pair ID when transposition reverses its pitch order", () => {
    const builder = new ScoreBuilder();
    builder.addPart({
      id: PartId("octave"),
      name: "Octave",
      transpose: { chromatic: 0, diatonic: 0, octaveChange: 1 },
    });
    builder.addPart({ id: PartId("concert"), name: "Concert" });
    add(builder, "octave", "a", "low", "C4", 0);
    add(builder, "concert", "b", "high", "G4", 0);
    const score = builder.build();

    const written = analyzeIntervals(score, { noteIds: ["low", "high"] })
      .intervals[0]!;
    const sounding = analyzeIntervals(
      score,
      { noteIds: ["low", "high"] },
      { pitchMode: "sounding" },
    ).intervals[0]!;
    expect(written).toMatchObject({ label: "5P", semitones: 7 });
    expect(sounding).toMatchObject({ label: "4P", semitones: 5 });
    expect(written.evidence.map((note) => note.noteId)).toEqual([
      "low",
      "high",
    ]);
    expect(sounding.evidence.map((note) => note.noteId)).toEqual([
      "high",
      "low",
    ]);
    expect(sounding.id).toBe(written.id);
  });

  it("keeps selected voices separate and lets rests or unpitched-only onsets break a melody", () => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("p"), name: "P" });
    add(builder, "p", "v1", "a", "C4", 0);
    add(builder, "p", "v1", "rest", null, 1);
    add(builder, "p", "v1", "b", "G4", 2);
    add(builder, "p", "v1", "drum", "C3", 3, 1, { unpitched: true });
    add(builder, "p", "v1", "c", "C5", 4);
    add(builder, "p", "v2", "d", "E4", 1);

    const score = builder.build();
    expect(
      analyzeIntervals(score, { partId: "p", voiceId: "v1" }).intervals,
    ).toEqual([]);
    expect(analyzeIntervals(score, { noteIds: ["a", "b"] }).intervals).toEqual(
      [],
    );
    expect(
      analyzeIntervals(score, { fromQuarters: 1, toQuarters: 2 }).intervals,
    ).toEqual([]);
  });

  it("rejects ambiguous ranges and treats the upper quarter bound as exclusive", () => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("p"), name: "P" });
    add(builder, "p", "v", "a", "C4", 0, 2);
    add(builder, "p", "v", "b", "D4", 1);
    const score = builder.build();

    expect(
      analyzeIntervals(score, { fromQuarters: 0, toQuarters: 1 }).intervals,
    ).toEqual([]);
    expect(
      analyzeIntervals(score, {
        noteIds: ["a", "b"],
        fromQuarters: 1,
        toQuarters: 2,
      }).intervals,
    ).toMatchObject([{
      kind: "harmonic", label: "2M", startQuarters: 1, endQuarters: 2,
      evidence: [{ noteId: "a" }, { noteId: "b" }],
    }]);
    expect(() => analyzeIntervals(score, { fromQuarters: 0 })).toThrow(
      TypeError,
    );
    expect(() =>
      analyzeIntervals(score, { fromQuarters: 2, toQuarters: 1 }),
    ).toThrow(RangeError);
    expect(() => analyzeIntervals(score, {})).toThrow(TypeError);
  });

  it("includes a sustained same-voice overlap even when the selected notes attack separately", () => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("p"), name: "P" });
    add(builder, "p", "v", "held", "C4", 0, 4);
    add(builder, "p", "v", "later", "E4", 1);
    add(builder, "p", "v", "after", "G4", 4);
    const score = builder.build();
    const selected = analyzeIntervals(score, { noteIds: ["held", "later"] });
    expect(selected.intervals).toMatchObject([
      { kind: "melodic", label: "3M", startQuarters: 0, endQuarters: 1 },
      {
        kind: "harmonic", label: "3M", startQuarters: 1, endQuarters: 2,
        evidence: [{ noteId: "held" }, { noteId: "later" }],
      },
    ]);
    expect(analyzeIntervals(score, { noteIds: ["held", "after"] }).intervals)
      .toMatchObject([{ kind: "melodic", label: "5P", startQuarters: 0, endQuarters: 4 }]);
  });

  it("does not manufacture a harmonic unison between adjacent tied fragments", () => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("p"), name: "P" });
    add(builder, "p", "v", "start", "C4", 0, 1, { tie: "start" });
    add(builder, "p", "v", "stop", "C4", 1, 1, { tie: "stop" });
    add(builder, "p", "v", "overlap", "E4", 0.5, 1);
    const intervals = analyzeIntervals(builder.build(), { partId: "p" }).intervals;
    expect(intervals.filter(({ kind }) => kind === "harmonic")).toMatchObject([
      {
        label: "3M", startQuarters: 0.5, endQuarters: 1,
        evidence: [{ noteId: "start" }, { noteId: "overlap" }],
      },
      {
        label: "3M", startQuarters: 1, endQuarters: 1.5,
        evidence: [{ noteId: "stop" }, { noteId: "overlap" }],
      },
    ]);
    expect(intervals.some(({ label }) => label === "1P")).toBe(false);
    expect(intervals.filter(({ kind }) => kind === "melodic")).toMatchObject([
      { label: "3M", evidence: [{ noteId: "start" }, { noteId: "overlap" }] },
    ]);
  });

  it("does not invent a melody from the order of simultaneous chord members", () => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("p"), name: "P" });
    add(builder, "p", "v", "before", "C4", 0);
    add(builder, "p", "v", "lower", "E4", 1);
    add(builder, "p", "v", "upper", "G4", 1, 1, { chord: true });
    add(builder, "p", "v", "after", "D5", 2);
    const score = builder.build();

    const automatic = analyzeIntervals(score, { partId: "p", voiceId: "v" });
    expect(automatic.intervals.map(({ kind, label }) => [kind, label])).toEqual([
      ["harmonic", "3m"],
    ]);
    const selected = analyzeIntervals(score, { noteIds: ["before", "upper", "after"] });
    expect(selected.intervals.map(({ kind, label, evidence }) => [
      kind, label, evidence.map(({ noteId }) => noteId),
    ])).toEqual([
      ["melodic", "5P", ["before", "upper"]],
      ["melodic", "5P", ["upper", "after"]],
    ]);
    expect(analyzeIntervals(score, { noteIds: ["before", "after"] }).intervals[0])
      .toMatchObject({ kind: "melodic", label: "9M", semitones: 14 });
  });

  it("retains tied pitches as harmonic evidence but never treats continuations as melodic attacks", () => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("p"), name: "P" });
    add(builder, "p", "v", "start", "C4", 0, 1, { tie: "start" });
    add(builder, "p", "v", "continue", "C4", 1, 1, { tie: "continue" });
    add(builder, "p", "v", "stop", "C4", 2, 1, { tie: "stop" });
    add(builder, "p", "v", "next", "E4", 3);
    add(builder, "p", "other", "sounding", "G4", 1, 2);

    const intervals = analyzeIntervals(builder.build(), { partId: "p" }).intervals;
    expect(intervals.filter(({ kind }) => kind === "melodic")).toMatchObject([{
      label: "3M", startQuarters: 0, endQuarters: 3,
      evidence: [{ noteId: "start" }, { noteId: "next" }],
    }]);
    expect(intervals.filter(({ kind }) => kind === "harmonic").map(({ evidence }) =>
      evidence.map(({ noteId }) => noteId),
    )).toEqual([["continue", "sounding"], ["stop", "sounding"]]);
    expect(analyzeIntervals(builder.build(), { noteIds: ["continue", "next"] }).intervals)
      .toEqual([]);
  });

  it("marks transposition spelling fallbacks while retaining the original written evidence", () => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("clarinet"), name: "Clarinet", transpose: { chromatic: -2 } });
    builder.addPart({ id: PartId("piano"), name: "Piano" });
    add(builder, "clarinet", "v", "f", "F4", 0);
    add(builder, "piano", "v", "g", "G4", 0);
    const score = builder.build();
    const selection = { noteIds: ["f", "g"] };
    const written = analyzeIntervals(score, selection).intervals[0]!;
    expect(written.evidence.every(({ spellingInferred }) => !spellingInferred)).toBe(true);
    const sounding = analyzeIntervals(score, selection, { pitchMode: "sounding" }).intervals[0]!;
    expect(sounding).toMatchObject({
      label: "4d", semitones: 4,
      evidence: [
        { writtenPitch: "F4", pitch: "D#4", spellingInferred: true },
        { writtenPitch: "G4", pitch: "G4", spellingInferred: false },
      ],
    });
    const diatonic = score.withPart(new Part({ ...score.parts[0]!, transpose: { chromatic: -2, diatonic: -1 } }));
    expect(analyzeIntervals(diatonic, selection, { pitchMode: "sounding" }).intervals[0])
      .toMatchObject({ label: "3M", evidence: [{ pitch: "Eb4", spellingInferred: false }, { spellingInferred: false }] });
  });

  it.each([
    [{ chromatic: 0 }, "Db4", "Eb4"],
    [{ chromatic: 0, octaveChange: 1 }, "Db5", "Eb5"],
    [{ chromatic: -12 }, "Db3", "Eb3"],
  ])("preserves spelling for a no-op or whole-octave transposition %j", (transpose, first, second) => {
    const builder = new ScoreBuilder();
    builder.addPart({ id: PartId("p"), name: "P", transpose });
    add(builder, "p", "v", "d", "Db4", 0);
    add(builder, "p", "v", "e", "Eb4", 1);
    const result = analyzeIntervals(builder.build(), { partId: "p" }, { pitchMode: "sounding" });
    expect(result.intervals[0]).toMatchObject({ label: "2M", evidence: [
      { writtenPitch: "Db4", pitch: first, spellingInferred: false },
      { writtenPitch: "Eb4", pitch: second, spellingInferred: false },
    ] });
  });
});
