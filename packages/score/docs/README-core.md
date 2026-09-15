# @webscore/core

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current core API reference](../../../apps/doc/webmusic/src/content/docs/score/api/index.mdx).
> See the [archive index](README.md) for scope, the
> [contribution guide](../../../CONTRIBUTING.md) for setup and validation, and
> [Score architecture](../ARCHITECTURE.md) for current package boundaries.

<!-- docs:historical-body -->

---

The **thin foundation** of WebScore: the immutable `Score` model, the musical
primitives (`Rational`, `Pitch`, `Duration`), the `TimeMap`, note queries, a
typed `EventEmitter`, and JSON serialization. **Zero runtime dependencies, no
functional APIs, no UI** — it touches no browser APIs, so it is safe in Node,
workers, and SSR.

Functional capabilities live in the feature packages, each of which pulls
`core` in as a dependency: playback and file I/O in
[`@webscore/play`](../play), analysis in [`@webscore/analyze`](../analyze),
visualization in [`@webscore/view`](../view), React bindings in
[`@webscore/react`](../react). Install `core` directly only when you build
entirely against the model — a custom importer, exporter, engine, or analyzer.

```bash
npm install @webscore/core
```

> **Note:** not yet published to npm — clone the monorepo and use the workspace
> packages locally until then.

## Build a Score in code

`ScoreBuilder` collects metadata, parts, measures, tempo, meter, and notes,
then returns an immutable `Score`:

```ts
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '@webscore/core';

const builder = new ScoreBuilder();
const partId = PartId('piano');
const timeSignature = {numerator: 4, denominator: 4};

builder
  .setMetadata({title: 'Etude', composer: 'WebScore'})
  .addTempo({atQuarters: Rational.ZERO, bpm: 96})
  .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});

builder.addPart({id: partId, name: 'Piano', midiProgram: 0, staves: 2});
builder.addMeasure({
  id: MeasureId('m1'),
  number: 1,
  onsetQuarters: Rational.ZERO,
  durationQuarters: new Rational(4),
  timeSignature,
  keySignature: {fifths: 0, mode: 'major'},
});

builder.addNote(partId, {
  id: builder.newNoteId(),
  pitch: Pitch.parse('C4'),
  onsetQuarters: Rational.ZERO,
  duration: Duration.quarter(),
  performed: {onsetSec: 0, durationSec: 0.5, velocity: 90},
  voice: VoiceId('piano-v1'),
  staff: 1,
});

const score = builder.build();
```

The resulting `Score` (with its `Part` / `Measure` / `Note` objects) is
immutable — share it between a player, a renderer, an analyzer, or a worker
without one consumer mutating another's data. `score.withMetadata(...)` returns
a modified copy; `scoreFromJSON(score.toJSON())` round-trips it.

`Score.toJSON()` emits `SCORE_JSON_SCHEMA_ID` (`v0.1`). The reader accepts that
exact marker or an unmarked legacy payload; an unknown marked version throws
`ScoreJSONError` with `code: 'unsupported-schema'` instead of guessing future
semantics. Present known fields are runtime-validated before model construction;
malformed metadata, notation, tempo, meter, or Note fields reject with
`code: 'invalid-json'`, while unknown metadata extension values remain open.
With a complete timeline provenance vector, an `explicit: false` tempo/meter
entry must still match the Measure it claims to derive from or rehydration
rejects with `code: 'invalid-score'`. Intentional `explicit: true` overrides and
legacy TimeMaps with no complete provenance remain valid.

## Time, queries, events

```ts
import {Rational, TimeMap, notesAt, notesIn, notesOverlapping, EventEmitter} from '@webscore/core';

const map = new TimeMap(score);
map.quartersToSeconds(new Rational(2)); // musical time → wall clock
map.quartersToMBS(new Rational(5));     // → {measure, beat, subbeat}

notesAt(score, new Rational(2));        // notes sounding at a position
notesIn(score, Rational.ZERO, new Rational(4));
notesOverlapping(score, new Rational(1), new Rational(3));

const events = new EventEmitter<{ready: {id: string}}>();
events.once('ready', ({id}) => console.log(id));
```

`emit()` retains ordinary exception propagation. Lifecycle-sensitive owners
can opt into `emitSafely(event, payload, onError)`, which snapshots listeners,
continues after synchronous throws, and observes rejected listener Promises
without creating an unhandled rejection.

Compatibility helpers (`pitchToMidi`, `quartersToTicks`, `noteMidi`,
`tickToMeasureBeat`, `locateSeconds`, …) expose MIDI-style fixed 480 PPQ ticks
and second-based readings for legacy integrations.

## Documentation

Full API docs live in the monorepo's documentation site
([`apps/doc/webmusic-score`](../../../apps/doc/webmusic-score), `npm run docs:dev:score`) — see the **Core API** page.

## License

MIT
