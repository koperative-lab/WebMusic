# Score Headless reliability review — 2026-09-10

## Outcome and scope

The review found reproducible timing, identity, numerical and lifecycle defects,
and repaired them with regression coverage. The review covers the three public
Score Headless entries and their directly used pure algorithms. It does not
establish universal musical-analysis accuracy, browser rendering acceptance or
sample-accurate physical audio/MIDI delivery.

Baseline: main `f074cd8b5f7cdf8f288c77d988384a359c873cfb`, clean before this task.
Implementation evidence is the working-tree changes following that baseline.
The environment used installed dependencies, Node v26.8.1 and Score's Vitest v3.2.7;
no dependency installation, commit, push or frontend redesign was part of this
review. The project component-review skill and contributor verification workflow
were followed. Earlier review records remain historical evidence.

| Public entry | Runtime exports traced | Detailed record |
|---|---:|---|
| `@webmusic/score/play/headless` | 65 | [Play algorithms, scheduling and resources](SCORE-HEADLESS-PLAY.md) |
| `@webmusic/score/analyze/headless` | 22 | [Analyze algorithms, sessions and workers](SCORE-HEADLESS-ANALYZE.md) |
| `@webmusic/score/view/headless` | 2 | [View identity, projection and observation](SCORE-HEADLESS-VIEW.md) |

These 89 values include helpers, constants and compatibility aliases; they are
not 89 separate components. Public types, owning references and tests were read
with the implementation. Rendering adapters and Elements were included only
where existing tests checked compatibility. Core/I/O review concentrated on
the shared timing, tie and query paths below, rather than claiming a complete
audit of every importer/exporter.

## Shared algorithm corrections

| Priority | Reproduction and impact before repair | Result and durable evidence |
|---|---|---|
| P1 | Half-note = 60 projected as 60 quarter notes/minute through `scoreTempos` and `Score.tempos`. MusicXML playback therefore slowed after export/import. | Both compatibility views fold in `TempoEntry.unit`, while TimeMap retains the authored unit. A score with two quarters at half-note = 60 followed by two at dotted-quarter = 60 retains its independently calculated `7/3` second duration through MusicXML. [Compatibility source](../../../packages/score/src/core/compat.ts), [model](../../../packages/score/src/core/model/Score.ts), [round-trip regression](../../../packages/score/test/io/tempo-unit-roundtrip.test.ts). |
| P1 | A `start`/`stop` tie pair separated by a gap, or overlapping in notated time, was merged into one attack. Duration summation could bridge silence, lose an attack or double-count overlap. | Tie chains require exact Rational contiguity. Malformed chains end and disconnected events remain separate; a disconnected `continue` can begin a new valid chain. Cross-staff ties in the same voice and exact tuplets still merge. [Tie source](../../../packages/score/src/core/query/ties.ts), [foundation regressions](../../../packages/score/test/core/headless-foundations.test.ts). |
| P2 | Empty or reversed overlap windows could still contain a long held note. A zero-duration ordinary event could also enter a nonempty overlap query. | Empty/reversed intervals return no notes. Ordinary zero-length spans are empty; explicitly marked grace events retain their documented onset policy. Point and onset queries remain separate APIs. [Query source](../../../packages/score/src/core/query/queries.ts), [foundation regressions](../../../packages/score/test/core/headless-foundations.test.ts). |

TimeMap itself already integrates `bpm * unit` correctly and validates tempo
entries through `assertTempoEntry` / `assertValidTempo`. It did not need a
replacement algorithm. An independent piecewise-time fixture checks 445
positions; inverse conversion remains within half a 480-PPQ tick (`1/960` of a
quarter), consistent with its explicit quantization. This tolerance is not an
audio scheduling precision claim.

MusicXML's playback `sound.tempo` uses quarter notes per minute; a metronome
mark separately retains its beat unit and dots. These published units support
the compatibility correction. Exact-contiguity recovery for malformed ties is
the toolkit's policy, rather than a claim that the XML specification prescribes
this particular repair. See the primary [MusicXML sound reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/sound/),
[metronome reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/metronome/)
and [tie reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/tie/).

## Headless findings by responsibility

The detailed records contain source paths, reproduction cases and individual
fixes. The following groups explain their practical consequences.

| Area | Confirmed failures repaired | Contract retained or clarified |
|---|---|---|
| Analyze evidence and geometry | Empty reports claiming C major; lost zero-duration clock bounds; invalid rhythm lengths; motif/voice bands ending at a duration sum or last attack instead of the actual final offset; tuning-cache collisions | Unknown evidence remains unknown; projections use the supplied immutable Score. Statistical confidence/rank remains a heuristic. |
| Analyze voice identity | Parallel-motion checks crossed an intervening rest; equal voice IDs in different parts could place an issue on the wrong row | `VoiceLeadingIssue.voiceParts` is an optional additive field paired with unchanged raw `voices`. New results populate it; legacy ambiguous identities are not guessed. |
| Analyze worker | Serialization/setup failure leaks and mixed reanalysis/update ordering | Caller and worker resources retain explicit ownership; the detailed record and session reference define promise settlement and latest-input behavior. |
| Play time and pitch | Release timers consumed gates while audio time was suspended; duplicate MIDI release; preload used written rather than sounding pitch; AbPlayer quarter pulses lost authored tempo units | AudioContext time decides due events. The same timeline supplies sounding pitch to preload and attack; written Score data remains unchanged. Timer wake-up latency remains a device-verification topic. |
| Play replacement and cleanup | Stale async source loads overwrote newer sources; active identity became stale on same-ID replacement; source selection carried an unwanted cursor; offline resource failures skipped cleanup | Latest source intent wins. Borrowed resources remain borrowed, and every acquired cleanup gets an attempt while the primary failure is preserved. |
| Play callback supersession | Controller stop rewound a newer seek/play; Tone release callbacks could be followed by obsolete reset/reschedule writes; failed or infinite rate writes left invalid state | New transport intent wins without losing cleanup of old note occurrences. Pending audio unlock remains distinct from synchronous position/rate edits. |
| Play signal math | Distortion/overdrive used the wrong WaveShaper sample grid, creating a nonzero response for zero input; EQ queried frequencies above Nyquist and exposed NaN | Curves use both endpoints and preserve zero under linear interpolation. EQ omits samples above `sampleRate / 2` while retaining the fixed logarithmic axis. |
| View state and identity | Legal `(partId, noteId)` pairs collided; reentrant notifications resumed obsolete rounds; failed unsubscribe left local state live; invalid playback time partly cleared hidden activity | Structured identity, immutable publication generations, local disposal before foreign cleanup, and validation before mutation. No player or clock is created by a View. |
| View pure geometry | MIDI pitches outside 21…108 folded onto A0; invalid scales emitted unusable geometry; large map arrays exceeded call argument limits; invalid budgets and times failed inconsistently | All MIDI 0…127 have physical columns, preserving the A0 origin. Used scales are finite and positive; finite budgets retain rounding/minimum-one behavior. Time conversion consistently clamps the origin. |

Additional root-owned Play regressions are in
[controller tests](../../../packages/score/test/play/controller.test.ts) and
[EQ tests](../../../packages/score/test/play/eq-controller.test.ts):

- `PlayerController.stop()` no longer rewinds over a newer play or seek issued
  from the pause notification/backend. A newer destroy also prevents the old
  rewind through the existing generation guard.
- A failed `setRate` tempo write restores the prior rate unless a newer
  reentrant rate has superseded it. Non-finite rates throw `RangeError` before
  changing state. Finite values retain the existing `0.1…4` clamp.
- At 22,050 Hz, EQ response samples remain finite and stay below 11,025 Hz on
  the original frequency axis. Independent cascade magnitudes `0.5` and `2`
  sum to zero dB. At 48,000 Hz the normal 64-sample response remains intact.

The separate [Tone regression suite](../../../packages/score/test/play/tone-player.test.ts)
covers callback-driven seek/play/dispose, pending unlock compatibility and
both owned/shared transport modes. Multi-note replay cases additionally require
every old handle to be released and exactly one fresh schedule to remain;
stopping an obsolete command must not strand the other notes of a chord.

The Web Audio Recommendation explicitly defines out-of-range biquad response
values as NaN and WaveShaper lookup on a grid spanning both endpoints. The
tests use those equations rather than repeating the implementation's original
sampling expression. [Web Audio API Recommendation, 2021-06-17](https://www.w3.org/TR/2021/REC-webaudio-20210617/).

## Algorithm accuracy and component design

- **Deterministic foundations:** exact Rational tie adjacency, half-open query
  windows, piecewise time integration, MIDI identities, reference counts and
  signal equations have independent expected-value cases, including empty,
  boundary, repeated, transposed and malformed inputs.
- **Musical inference:** key detection is profile correlation; chord naming is
  pitch-set matching plus spelling/ranking policy; Roman labels are local
  tonic-relative interpretation; voice-leading and motifs apply explicitly
  limited rules. Tests cover all 24 major/minor triads and key-profile rotations,
  but these are not annotated-corpus accuracy measurements. No percentage
  accuracy or probabilistic confidence is claimed.
- **Notation:** `createStaffLayout` is a lightweight written-pitch projection
  without a complete clef-aware engraving model. Its approximate ledger count
  must not be used as evidence of correct grand-staff engraving. The existing
  renderer limitations remain in STATUS.
- **Component boundaries:** retain ScorePlayer, injected TonePlayer,
  externally advanced InteractivePlayer, fixed-score ScoreView and
  score-independent ActiveNoteTracker as distinct roles. Keep loop/A–B
  compositions, graph controllers, trackers and one-shot reports attached to
  their actual time/data/resource contracts. Similar method names are not
  sufficient reason to merge them. No additional Web Component or UIKit
  presenter is required by these algorithm repairs.

## Verification

Focused red/green probes were executed before and after repairs. Durable
regressions are in the repository; temporary local logs named by the detailed
records are supplemental session evidence, not a prerequisite for reproducing
the tests.

| Gate | Result |
|---|---|
| Core and I/O suites | 27 files / 324 tests passed |
| Root PlayerController and EQ suites | 2 files / 16 tests passed |
| Analyze suite | 30 files / 476 tests passed |
| View suite and Tone supplement | View: 28 files / 299 tests; Tone: 53 tests passed |
| Integrated Score suite | 150 files / 1,797 tests passed, including all final Play changes |
| Complete repository `npm run check` | Passed: 261 workspace test files / 3,221 tests; nine snippet-scanner tests; 240 documentation examples compile. Format, lockfile, lint, architecture, dev/public docs, package builds, source/test types, licenses, built exports and release manifests all passed. |
| Documentation `npm run docs:build` | Passed: packages rebuilt and 108 pages built; 107 pages indexed for search. |

Public references were updated with real validation, units, identity and
cleanup behavior. The documentation inventory is regenerated as part of final
verification. The full-repository run verifies the final source/test state and
resolves the temporary Play test-fixture type error noted in the Analyze handoff.
Focused runs overlap with the integrated suites; their totals must not be added.

Both full commands used `NODE_OPTIONS=--max-old-space-size=6144`. Temporary
session logs are `/private/tmp/webmusic-score-headless-check-20260910.log` and
`/private/tmp/webmusic-score-headless-docs-build-20260910.log`.
Expected fault-injection diagnostics, the optional Audio tempo-engine fallback,
and jsdom Canvas/OSMD warnings appeared in passing tests. The docs build reported
redirect pages without HTML for search indexing and skipped sitemap generation
because the local build has no configured site URL. These warnings do not
establish real-engine rendering, search/deployment acceptance or device behavior.

## Remaining verification boundaries

1. No annotated real-music corpus establishes key, chord, Roman or
   voice-leading accuracy across musical styles. Preserve that distinction
   when presenting ranked or confidence-bearing output.
2. No physical audio/MIDI hardware, background-tab timing, audible suspend/resume
   measurement, real module Worker/CSP deployment, or browser accessibility
   acceptance was performed. Test doubles verify command/clock/resource logic,
   not browser-engine or device precision.
3. This task does not revalidate staffrender/OSMD engraving, render clipping,
   frontend responsiveness or input hit-testing. Passing jsdom renderer tests
   is compatibility evidence only.
4. No new cross-domain shared clock, external consumer installation, registry
   publication or dependency vulnerability audit is claimed. Existing gaps in
   [STATUS](../../STATUS.md) retain their owners and acceptance criteria.

The current queue remains in STATUS; this is a dated audit, not a second live
implementation plan.
