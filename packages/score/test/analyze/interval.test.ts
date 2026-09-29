import { describe, expect, it } from "vitest";
import {
  Duration,
  NoteId,
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
  options: { unpitched?: boolean; chord?: boolean } = {},
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
    ).toEqual([]);
    expect(() => analyzeIntervals(score, { fromQuarters: 0 })).toThrow(
      TypeError,
    );
    expect(() =>
      analyzeIntervals(score, { fromQuarters: 2, toQuarters: 1 }),
    ).toThrow(RangeError);
    expect(() => analyzeIntervals(score, {})).toThrow(TypeError);
  });
});
