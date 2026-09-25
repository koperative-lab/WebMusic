# Score API model, edit and repeat-transform review — 2026-09-10

## Scope and evidence baseline

Reviewed current main at `f074cd8b5f7cdf8f288c77d988384a359c873cfb`, preserving the uncommitted Headless review and concurrent API work. Ownership was `core/model/**`, `core/transform/**`, `core/validate.ts` and corresponding tests. Root owns primitives, time, queries, compatibility, types, events, playback, serialization and the public Score API page. No package builds, dist changes, commits or pushes were performed.

Read the current agent/development/product/architecture/status/decision owners, package architecture, component-review skill/workflow, actual core exports, public Score API reference and model/edit/validation/extension tests. This is a source/algorithm review with deterministic regressions, not a browser or audible playback review.

## Complete owned public export and method coverage

The owned portion of `core/index.ts` exports ten runtime values and seventeen type contracts. All were inspected; the methods below are actual members, not inferred toolkit features.

| Runtime value | Complete method/property coverage and conclusions |
|---|---|
| `Note` | Constructor; `offsetQuarters`, `onset`, `endTick`, `durationTicks`, `velocity`; `with`, `toJSON`. Requires real Rational/Duration/Pitch values where applicable, non-negative duration, valid finite performed timing/velocity and a pitch for non-rest notes. Nested notation arrays/records are snapshotted. Notated and performed fields remain independent; `with` changes only supplied fields. Legacy tick views use 480 PPQ. |
| `Measure` | Constructor; `offsetQuarters`, `startTick`, `durationTicks`, `endTick`, `toJSON`. Safe-integer display number, Rational positions/duration, non-negative duration, tempo/meter guards, nested metadata snapshots. Added repeat-count validation before any expansion loop. |
| `Part` | Constructor and `toJSON`; all properties `id`, `name`, abbreviation, MIDI program/channel, staves, transpose and notes. Note-instance validation, stable exact onset sorting, immutable notes, integer/range metadata checks and snapshotted transpose. Internal query-index and id-lookup caches reviewed with the edit paths. |
| `Score` | Constructor; `getNote`, `getPart`, `getMeasure`, `allNotes`; `durationQuarters`, `durationSeconds`, `ppq`, `durationTicks`, `notes`, `title`, `composer`, `tempos`, `timeSignatures`, `keySignatures`; `withMetadata`, `withPart`, `withoutPart`, `edit`, `toJSON`. Part order is retained; measures are onset-sorted; legacy notes are sounding-only and part-major; allNotes includes rests. Derived Scores reuse unaffected immutable structures/caches. Fixed event-record immutability, metadata property preservation, failed edit closure and large-part flattening. |
| `ScoreBuilder` | `setMetadata`, `addPart`, `addNote`, `addMeasure`, `addTempo`, `addMeter`; `newScoreId`, `newPartId`, `newMeasureId`, `newNoteId`, `newVoiceId`; `build`. Mutable accumulation snapshots inputs at entry, rejects duplicate global note IDs/part IDs/measure IDs/display numbers, and supplies synthetic origin defaults. Explicit tempo/meter entries win over inferred measure entries; last explicit declaration wins. Builder remains reusable; each build creates a new Score ID/value. |
| `ScoreEditSession` | Six supported commands: `updateNote`, `removeNote`, `addNote`, `updateMeasure`, `addMeasure`, `removeMeasure`. Also inspected constructor, `_commit` and new `_close` internals plus lookup/merge/provenance helpers. ID replacement is rejected; removal/re-addition/movement between parts, stable simultaneous-onset order, incremental cache overlays, touched-part rebuild and measure-map reconciliation retain existing contracts. Success, callback failure and commit failure close the transaction. |
| `validateScore` | All thirteen diagnostic code paths inspected: duplicate part/measure/measure-number/note IDs; equal-onset/overlapping measure grids; duplicate tempo/meter positions; TimeMap measure snapshot mismatch; missing measure tempo/meter entries; inferred tempo/meter mismatches. Frozen diagnostics do not mutate or “repair” the Score. Explicit overrides and unknown provenance intentionally remain independent. |
| `assertValidScore` | Calls the same validator and throws the aggregated structural diagnostics. It does not add a separate musical-content validation policy. |
| `expandRepeats` | Playback-order construction, pass/volta filtering, measure remapping, note selection by onset, derived identities, tempo/meter replay and performed-onset shifting. Fixed collision, validation consistency, one-pass selection and empty-order defects. Unsupported routing structures remain bounded below. |
| `playedDurationSeconds` | Exactly `expandRepeats(score).durationSeconds`. It measures the expanded notated extent through TimeMap, not arbitrary performed tails beyond that extent. |

Owned type coverage:

- Note: `NoteData`, `PerformedAttributes`, `Articulation`, `Ornament`, `Tie`, `Slur`, `SlurMark`, `SlurValue`, `GraceNote`.
- Measure: `MeasureData`, `MeasureRepeat`, `Clef`.
- Part: `PartData`, `Transpose`.
- Score: `ScoreData`.
- Validation: `ScoreValidationIssue`, `ScoreValidationIssueCode`.

There are no `Score.transpose`, `Score.quantize`, `Score.slice` or `Score.merge` methods in this public surface. Written/sounding pitch conversion belongs to root's query review. No duplicate transform API or stateful component was added.

## Reproduced findings and repairs

1. **P2 — cached event records remained mutable.** Score froze the `tempos`, `timeSignatures` and `keySignatures` arrays but left each record writable. Mutating `score.tempos[0].bpm` changed the stable cached view shared by metadata-only derived Scores without changing TimeMap. Each record is now frozen as well as the array. The prior Headless `tempo.unit` → quarter-per-minute conversion is retained.
2. **P2 — metadata snapshotting changed legitimate property/prototype semantics.** Assignment of a JSON own `__proto__` key invoked the inherited setter instead of creating a data property. Score's snapshot also changed null-prototype records into ordinary records. Builder and Score now define copied own enumerable data properties explicitly; Score retains the source plain/null prototype. The regression checks own-key existence, normal outer prototype, null nested prototype and JSON round-trip preservation. This is value preservation, not a claim about global prototype pollution.
3. **P2 — failed edit callbacks left an escaped transaction open.** The base remained immutable, but a leaked session could still accept updates after `score.edit` threw. `Score.edit` now closes the session in `finally`; `_commit` still marks successful/failed commit use closed. New regression verifies original state and rejected late mutation after abort. Synchronous callback semantics remain explicit; this does not introduce async transactions.
4. **P2 — repeat occurrence IDs collided with legal source IDs.** Source note `n` repeated to `n@2`, colliding with an original note already named `n@2`; measures had the same problem. The transform reserves all source IDs and each new occurrence ID, keeping first occurrences untouched and adding `~N` only when the conventional `id@occurrence` name conflicts. The regression verifies unique measure/note identities and preservation of the original suffixed source identities.
5. **P2 — repeat output failed its own structural validator.** Repeated measures retained explicit tempo/time-signature declarations, while expandedTimeMap removed equal-valued redundant entries. `validateScore(expandRepeats(validScore))` then reported missing entries at repeated declaration positions. Map replay now preserves every played measure's explicitly declared tempo/meter position while still deduplicating otherwise redundant state. Existing mid-measure event/performed-time replay tests remain green.
6. **P2 — invalid repeat counts admitted an unbounded expansion loop.** Measure accepted Infinity/NaN/fractional/negative/unsafe counts. Playback order's pass loop is unbounded for positive Infinity (this was established by source control flow; the suite deliberately does not execute that loop). Constructor regressions demonstrated acceptance of all six invalid cases before repair. Repeat times now require a non-negative safe integer. Omitted count remains 2; zero retains the existing minimum-one-pass policy. No arbitrary new expansion-size cap was invented.
7. **P2 — one-pass volta selection was discarded; empty selection threw.** The old `changed` flag depended only on `times > 1`, so a one-pass repeat whose volta filter altered the order returned the original Score. If no requested pass selected a measure, new TimeMap construction received empty tempo/meter arrays and failed. Change detection now compares the final order with source order; an empty order receives valid origin tempo/meter entries and returns an empty Score with zero duration. Both cases failed before repair and now pass.
8. **P2 — flattening many parts exceeded JavaScript argument limits.** `[].concat(...segments)` threw “Maximum call stack size exceeded” for a valid Score with 150,000 unique parts and one note. Iterative part/note append preserves part-major order, sounding filtering, frozen output and identity caching without spreading a part collection into function arguments. The new large-input regression failed before repair and passes afterward.

Changed source files: `core/model/Score.ts`, `ScoreBuilder.ts`, `ScoreEditSession.ts`, `Measure.ts`, `core/transform/expandRepeats.ts`. New regression file: `test/core/api-model-regressions.test.ts`. `Note.ts`, `Part.ts` and `validate.ts` were inspected but did not require edits. No shared TimeMap, primitive, query, serializer or type-owner files were changed by this contribution.

## Repeat policy and independent reference comparison

Primary reference: [MusicXML 4.0 repeat](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/repeat/) defines `times` as a non-negative integer and describes it as the section's play count. [MusicXML 4.0 ending](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/ending/) describes pass selection and separate start/stop/discontinue bracket structure. Version 4.0 is the pinned specification; consulted 2026-09-10. These definitions justify integer/pass-selection examples but do not establish general MusicXML playback equivalence.

The implemented expansion policy is intentionally smaller:

- It pairs one forward start with the first backward end before any intervening start. Counts default to 2 and use at least one pass. Volta filtering applies to measures inside that paired span.
- The common first ending inside a repeated span and second ending immediately after it works under this simple model. Subsequent measures, including volta-marked ones outside the span, are otherwise played linearly. Multiple alternative endings/backward bars and nested repeat routing are not fully interpreted.
- An unmatched end is ignored; the implementation does not infer “repeat from the beginning.” An unmatched/interrupted outer start plays linearly, though a later locally matched pair may still expand. This is partial graceful fallback, not validation of the entire nested structure.
- Segno/coda/D.C./D.S. jumps are not represented in MeasureData. No algorithm was added for them.
- Notes are assigned by onset to a source measure; notes in gaps/outside all source measures are dropped only when actual expansion changes the order. Notes crossing measure/repeat boundaries are not clipped or split, and tuplet/slur/tie identities are not re-authored as a full engraving graph.
- Repeated notated onsets move by exact Rational deltas. Performed onset retains its offset from the original notated TimeMap onset; performed duration and velocity remain unchanged. This does not re-express a held note's seconds duration through every later tempo change.

## Editing, validation and immutable-state limits

- Model updates are field patches, not automatic musical restructuring. Moving/deleting a measure changes the grid and inferred map metadata, not the notes at that position. Moving a note's notated onset does not implicitly shift absolute `performed.onsetSec`. Explicitly update both when that is the intended edit.
- Score notated duration includes rest offsets and measure ends, not just `score.notes` sounding entries. Source comments were corrected accordingly. Playback timelines have their own performed-tail extent; `playedDurationSeconds` retains its documented notated-transform definition.
- JSON-like custom/encoding metadata is snapshotted and frozen. Date/Map/class-instance extensions remain borrowed by the existing open-ended metadata contract. This is not an arbitrary-object deep-clone API.
- The structural validator intentionally does not reject notes outside a measure, mismatched musical voice ranges, malformed notation artistry or every optional raw field. Constructors accept supported model values; ScoreData is not a raw JSON decoder. Use the root-owned JSON boundary for serialized input and `validateScore`/`assertValidScore` where unambiguous identities and a coherent grid are needed.
- A Score constructed with duplicate identities can be inspected and diagnosed. The id-based edit path assumes an unambiguous base; duplicate-id fallback lookup order is not an editing repair policy.
- No empirical editing-performance claim was measured. Existing incremental tests compare against full reconstruction, exercise moved/equal-onset notes and long cache-overlay chains, and verify untouched structures are shared. Large input tests establish the absence of one argument-count failure, not real-time throughput guarantees.
- Very large but safe integer repeat counts can still request impractical output. Arbitrary resource quotas, complex repeat graph correctness, general async edit functions, extreme representational overflow and full engraving-group reconstruction remain outside this bounded implementation.

## Verification

| Evidence | Result |
|---|---|
| Initial new model regressions | 11 failures before repairs; `/private/tmp/webmusic-api-model-red.log` |
| Volta boundary regressions | 2 failures before repairs; `/private/tmp/webmusic-api-model-volta-red.log` |
| Large-part flattening regression | 1 failure before repair; `/private/tmp/webmusic-api-model-parts-red.log` |
| Initial focused model/edit/extensions/validation suite | 5 files / 74 tests passed; `/private/tmp/webmusic-api-model-focused.log` |
| `npm run test --workspace @webmusic/score -- test/core` after final owned edits | **19 files / 211 tests passed**, including 14 new model regressions; `/private/tmp/webmusic-api-model-core-tests.log` |
| Focused ESLint on five changed source files plus new regression file | Exit 0; `/private/tmp/webmusic-api-model-lint.log` |
| Owned-file `git diff --check` | Exit 0 |

The 211-test aggregate reflects the concurrent root API snapshot; it is not attribution of every test/change to this subtask. No package build, full repository check, documentation build, audible test or real browser validation was performed here. Root owns integrated acceptance after all source writers freeze.

The [public root reference](../../../apps/doc/webmusic/src/content/docs/score/api/index.mdx) was updated with: snapshot/borrowed metadata distinction, frozen legacy event records, synchronous transaction closure, independent notation/performed patches, bounded repeat routing, identity collision suffixes, valid empty expansion, preserved map declarations and notated versus performed duration. Broader repeat routing remains a visible implementation limit and is tracked in STATUS; the function does not promise full MusicXML playback fidelity.
