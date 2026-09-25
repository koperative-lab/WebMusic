# Score API algorithm and contract review — 2026-09-10

## Outcome and baseline

The review found and repaired reproducible numeric, model, format, analysis and
projection defects. Independent expected-value fixtures complement existing
round trips and lifecycle tests. Deterministic correctness within the documented
representation and format limits is distinct from empirical musical inference
accuracy; no universal accuracy percentage is claimed.

One substantial unresolved contract gap was confirmed during final cross-review:
Score-based Analyze ignores part transposition. Mixed transposing-instrument
results cannot yet be claimed reliable in concert pitch; see the explicit
finding and reproduction below. This audit is complete as a review and set of
bounded repairs, not a declaration that every Score API input is fully supported.

Baseline: main `f074cd8b5f7cdf8f288c77d988384a359c873cfb` **plus the preceding
uncommitted [Headless review](SCORE-HEADLESS.md)**. That work was preserved and
forms this API review's starting point. This report attributes only the new API
findings below to this pass; a Git diff against HEAD contains both passes.
No commit, push, dependency installation or frontend redesign was requested or
performed. Environment: installed lockfile dependencies, Node v26.8.1,
TypeScript 5.9.3, Score Vitest 3.2.7. The project component-review skill and
contributor workflow were applied.

The API-start patch and per-file SHA-256 inventory were captured locally before
editing. Durable regression files below reproduce the important contracts;
temporary session logs are supplemental evidence, not required test fixtures.

## Public entry coverage

The actual package export map and TypeScript source checker were inspected.
Counts below are value exports and type-only exports, not component counts;
classes and branded-ID constructors also supply types. Re-exported symbols
overlap between entries and must not be summed as distinct algorithms.

| Public entry | Values / type-only names | Review ownership |
|---|---:|---|
| `@webmusic/score` | 67 / 47 | Numeric/time/query/JSON review below; [model/edit/repeat detail](SCORE-API-MODEL.md) |
| `@webmusic/score/io` | 41 / 14 | [MIDI, MusicXML, MXL, ABC and loader detail](SCORE-API-IO.md) |
| `/io/load` | 14 / 3 | Loader subset and supported format/error/limit contracts |
| `/io/formats` | 29 / 11 | Format subset and format-specific limits |
| `/io/worker-client` | 3 / 4 | Cancellation, replacement, validation and resource ownership |
| `/io/worker-protocol` | 3 / 8 | Message/version/error contracts; `/io/worker` has no named exports and installs runtime handlers |
| `@webmusic/score/analyze` | 12 / 18 | [Stateless capability algorithms](SCORE-API-CAPABILITIES.md) |
| `@webmusic/score/play` | 30 / 31 | SFZ, recording conversion, input geometry and WAV byte layout |
| `@webmusic/score/view` | 8 / 20 | Layout, sequence/time helpers and complete map coverage |
| `@webmusic/score/react` | 17 / 12 | Provider, hooks, observer lifecycle, presets and analysis evidence presentation |

The [source export inventory](SCORE-API-EXPORTS.json) records every name and
declaration owner for these entries. Public references were aligned with the
actual entry forms. In particular, stateful Play engines use `/play/headless`,
browser adapters use `/play/drivers`, View's pure layouts/maps use `/view`, and
`/view/headless` exports `createScoreView` and `createActiveNoteTracker`.
The root reference now includes omitted runtime names and grouped public types.

Stateful Headless and Analyze-worker behavior has the preceding dedicated
review. Browser renderers, Elements, registration bundles, demo conveniences and
device drivers were mapped to their owners and exercised by existing tests;
this pass is not renewed visual, acoustic or hardware acceptance of those forms.

## New foundation findings

| Priority | Reproduction before repair | Correction and evidence |
|---|---|---|
| P1 | `Rational(9007199254740991, 3) - Rational(6004799503160661, 2)` returned `-1/3`, although exact cancellation is `-1/6`. Unsafe intermediate multiplication could silently round before a safe final constructor value. | Arithmetic uses a Number fast path only when every intermediate is safe, otherwise exact BigInt reduction before converting the final representable numerator/denominator back. Comparison also uses exact cross products when necessary. Public representation and JSON remain numeric pairs. |
| P2 | Tick 1 at 960 PPQ converted to seconds and back as tick 2 because the inverse first rounded to 480 PPQ. | `TimeMap.secondsToQuarters(seconds, ppq = 480)` uses the requested grid; `secondsToTick` propagates its PPQ. Tests use independently calculated seconds on both sides of a tempo-unit change at 96, 480, 960 and 1920 PPQ. |
| P2 | Tick projections accepted zero/negative/fractional/nonfinite PPQ inconsistently and could return unsafe tick positions. | Positive safe-integer PPQ is required at both conversion directions; projected ticks outside the safe range reject. Existing nearest-tick rounding and default 480 PPQ remain. |
| P2 | Invalid Pitch construction admitted NaN/octave fractions; fractional `fromMidi` failed incidentally; nonpositive tuning returned unusable frequency; plain `pitchToMidi` accepted inherited property names. | Constructor/fromMidi/transpose validate their integer representation. A4 must be finite and positive. Plain pitch objects use the same validated construction. Signed integer pitches outside protocol MIDI range remain supported by the model. |
| P2 | The shared semitone table could be mutated, changing the MIDI value of an already frozen Pitch instance. | The table itself is frozen. Tests retain the preexisting C4 while attempting mutation. |
| P2 | React `AnalysisSummary` displayed `C major` for an empty score with no candidate evidence. | The adapter checks the existing `key.scores` evidence list and renders `Unknown`, matching the Headless report contract. Server-rendered output verifies the actual public component behavior. |

Sources: [Rational](../../../packages/score/src/core/primitives/Rational.ts),
[Pitch](../../../packages/score/src/core/primitives/Pitch.ts),
[compatibility helpers](../../../packages/score/src/core/compat.ts),
[TimeMap](../../../packages/score/src/core/time/TimeMap.ts),
[React analysis](../../../packages/score/src/react/analysis.tsx).
New regressions: [numeric/API boundaries](../../../packages/score/test/core/api-numeric-regressions.test.ts),
[React evidence](../../../packages/score/test/react/summary-evidence.test.tsx).

The arithmetic fixture checks 500 signed near-limit cancellations against an
independent integer oracle, representable reductions, exact comparison and true
overflow rejection. Pitch controls check every MIDI note 0–127, enharmonic
boundary spellings, signed pitches and the octave-frequency ratio of 2.
ECMAScript explains why Number integers outside the safe range cannot always
be distinguished. The implementation uses that representational boundary,
not a larger fictional exact Number range. [ECMAScript living specification,
Number.MAX_SAFE_INTEGER](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.max_safe_integer),
consulted 2026-09-10; the retrieved draft identifies itself as ECMAScript 2027.

## Model, formats and capability findings

The detailed reports retain each reproduction, source owner and test boundary.

| Area | New verified defects repaired |
|---|---|
| Model and editing | Mutable cached tempo/meter/key entries; lost own `__proto__` metadata keys/null prototypes; escaped transactions accepting edits after callback failure; large part flattening exceeding the function argument limit. |
| Repeat transform | Derived note/measure IDs colliding with source IDs; declared tempo/meter positions removed from expanded maps; invalid repeat counts entering unbounded loops; changed one-pass volta order discarded; empty selected order failing TimeMap construction. |
| MIDI | Authored beat-unit tempo exported with the wrong quarter-note rate; transposing tied notes emitted as separate written-pitch attacks; invalid PPQ and unsupported SMPTE division handled misleadingly. |
| MusicXML/ABC/MXL | Overlapping same-voice MusicXML events moved to wrong onsets; notation element order violated the supported schema; ABC omitted unit-length defaults and bar accidental/natural cancellation were wrong; an MXL score path could overwrite the container manifest. |
| IO lifecycle | Malformed null diagnostic locations escaped the Worker error path; a Worker factory disposing its own client could leave a late resource and wrong cancellation settlement. |
| Analyze | Equal-label windows lost later note/chroma evidence; nonfinite options behaved inconsistently; rounded onset identity erased leaps or fabricated shared attacks; direct naming differed from the accepted inversion policy; detector aliases lost parseable root/quality information. |
| Play/View | Recording PPQ/timing could enter invalid allocation loops; SFZ absent-key defaults were incorrect; keyboard mapping read prototype properties; an empty assignment became MIDI zero; map cells omitted notes outside authored measure spans. |

No new Web Component is needed for these repairs. Core remains the authoritative
immutable musical model; pure algorithms return projections, Headless owns
resources/state, and adapters consume those contracts. Chord naming now reuses
one existing naming policy without computing its staff or fretboard projections.
Similar method names across different resource/time owners do not justify merging
their components.

## Other inspected contracts and positive controls

- **Primitives:** `Rational.from(number)` still approximates noninteger input
  against a denominator of one million; explicit pairs remain the exact-input
  route. Duration computes base × dotted factor × normal/actual tuplet ratio.
  Zero duration is valid, negative base is rejected; dots are 0–4 and tuplet
  counts positive safe integers. `toSeconds` is a constant quarter-note-tempo
  projection. Convenience constructors retain these same rules.
- **Time:** piecewise tempo integration uses `bpm * unit`; duplicate positions
  resolve to the last declaration. Existing independently integrated fixtures,
  meter changes, pickup measures, partial measures and synthetic tail tests
  remain in the full suite. Quarters are exact, seconds are floating point,
  and inverse/mapping projections are explicitly quantized.
- **Queries and transposition:** point/onset/overlap queries, grace/rest policy,
  exact tie contiguity and written/sounding transposition reuse the prior
  foundation corrections. Existing indexed-query versus linear-oracle tests
  exercise edit/cache behavior. MIDI-based transposition intentionally loses
  diatonic spelling; it does not promise a notational transposition engine.
- **JSON/validation:** the exact v0.1 marker, legacy unmarked input, unsupported
  versions, malformed known fields, extension preservation, IDs, rich notation
  and TimeMap provenance paths were read with their tests. `scoreFromJSON`
  validates serialized input; model construction and `validateScore` serve
  different roles. No second parser/schema or invented Score transform was added.
- **Events/identity:** `on`, `off`, `once`, listener snapshots, exception
  propagation, safe delivery and rejected-Promise handling retain their tested
  contracts. Shared playback observation remains revision-aware and borrows
  the source. `makeId` is a local timestamp/salt/counter utility, not a globally
  stable or cryptographically unique identifier.
- **React:** context/provider, synchronous/incremental and asynchronous analysis,
  pending/error/current-input ownership, view attachment/cleanup and convenience
  compositions were read. Existing StrictMode/replacement/worker/view tests and
  the new empty-evidence SSR fixture pass; this is no screenshot/layout claim.

## Open transposing-instrument contract

**P2, unresolved — Score-based Analyze does not apply `Part.transpose`.**
The public documentation previously used “sounding” without naming this limit.
Stored `Note.pitch` is a written pitch, and `noteMidi` intentionally projects that
stored value. Changing it globally would also change written notation views.

A piano plays C4/E4 then D4/F♯4 while a B♭ clarinet is written A4 then B4.
The actual clarinet pitches are G4 then A4. Independently constructed concert
voicings are therefore C/E/G and D/F♯/A, with parallel fifths between the piano
bass and clarinet. Current `segmentChords` and `AnalysisSession` instead return
`Am/C → Bm/D`; `voiceLeading` misses that parallel fifth. The concert reference
returns `CM → DM` and a `parallel-fifth` issue over quarters [0,1]. Pitch-class
weights differ too. Both key labels happen to be D major in this short fixture;
only the weights/ranking/confidence differ, so it is not evidence of a wrong
key label in this particular example.

The [portable reproduction](score-api-transposition.mjs) runs against built
public entries, verifies the independently known concert control, and records
both paths. Run `node dev/audits/2026-09-10/score-api-transposition.mjs` after
building packages. [Recorded output](SCORE-API-TRANSPOSITION.json) preserves the
observed mismatch. This is a known-limit probe, not a green acceptance test
asserting that the incorrect concert interpretation is desirable.

There is an existing per-note `soundingPitch` primitive, but no whole-Score
normalizer or written/concert option shared by analysis, incremental histogram
and voice caches, Worker results and Headless projections. A partial direct-API
change would leave those paths inconsistent. The public reference now states the
current restriction; STATUS `ANALYZE-02` owns the required contract/implementation
work. Direct MIDI-based live trackers use the supplied actual pitches and do not
have this Score part-metadata omission. Empirical accuracy evaluation is a
separate issue from this deterministic pitch-basis mismatch.

## Compatibility corrections and remaining limits

Invalid numeric pitches, PPQ, recording data and repeat counts now reject early.
MIDI exporters use sounding tied events and quarter-note tempo; SFZ/ABC defaults
now follow the referenced format rules. Chord names can change when the prior
detector order contradicted the shared inversion/coverage policy. These are
observable corrections, not silent promises of unchanged malformed-input output.

Repeat expansion remains a flat start/first-end traversal, with in-span volta
filtering. Nested repeats, arbitrary alternative endings, unmatched backward
repeat-from-start and D.C./D.S. routing need a richer model. Notes outside
measure coverage are omitted when an actual expansion occurs; crossing notes
are not split into engraving graphs. Large finite output requests have no new
arbitrary resource cap. [Model detail](SCORE-API-MODEL.md) records these boundaries.

Pitch/Duration/TimeMap floating projections retain JavaScript range and rounding
limits; this review does not promise meaningful frequencies for astronomically
large octaves or sample-exact seconds. `playedDurationSeconds` measures expanded
notated extent, while performed tails belong to the player's timeline.

Key profiles, chord ambiguity, Roman function, representative-voice selection,
motifs and fretboard ranking remain bounded heuristics. Sub-tick key weights
still use the 480 PPQ compatibility histogram. Complex format features and
lossless interchange remain limited as documented in the IO record. Annotated
real-music corpus evaluation, full engraving fidelity, audible scheduling,
cross-browser/device behavior and external installation remain separate open work
in [STATUS](../../STATUS.md).

## Verification

Independent root probes first reproduced 7 numeric failures, then 2 compatibility
boundary failures and the empty-score React label failure. After repair, the
focused numeric/core-time/React run passed **12 files / 95 tests**. Model, format
and capability reports record their own focused runs; their totals overlap and
are not additive. Scoped root ESLint passed.

After all source owners froze, `NODE_OPTIONS=--max-old-space-size=6144 npm run
check` passed (exit 0). It includes:

- format, lockfile, ESLint, architecture and public/development documentation
  gates; 5 packages and 377 source modules in the architecture check;
- coordinated package builds and 9 snippet-scanner tests, followed by **240
  compiled documentation examples**;
- workspace source and test-declaration typechecks;
- **269 workspace test files / 3,324 tests**, including **Score 158 files /
  1,900 tests**; compared with the preceding Headless snapshot, this pass adds
  8 test files / 103 test cases (parameterized loops contain further assertions);
- license gate, **89 public-entry export checks** and release-manifest
  consistency. These do not claim external package installation or publication.

Supplemental full-check log:
`/private/tmp/webmusic-score-api-full-check-20260910.log`. Expected fault-injection
warnings and the existing optional Essentia fallback message did not fail the
suite. Documentation production-build evidence follows separately.

`NODE_OPTIONS=--max-old-space-size=6144 npm run docs:build` passed (exit 0):
**108 pages built / 107 pages indexed**. Existing optional sitemap-site and
bundle-size notices remain; no external deployment was performed. Supplemental
log: `/private/tmp/webmusic-score-api-docs-build-20260910.log`.

After the final transposition finding was documented, documentation gates and
the site build were repeated without rebuilding unchanged package sources:
`check:dev-docs`, `check:docs`, `check:format`, the portable probe's ESLint check
and `git diff --check` all passed. `npm run build -w webmusic-doc` passed with
**108 pages / 107 indexed pages**. The public-entry transposition probe passed
its independent concert controls and reproduced the unresolved written-input
mismatch; its JSON output is retained beside the report. Final site log:
`/private/tmp/webmusic-score-api-final-site-build-20260910.log`.
