# Score Analyze Headless review — 2026-09-10

Read the [combined audit](SCORE-HEADLESS.md) for final integrated verification.
Its full check also verifies the later correction to the Play test fixture
mentioned in this subtask's intermediate typecheck result.

Checkout: `/Users/mamingchen/GitHub/WebMusic`, main baseline `f074cd8b5f7cdf8f288c77d988384a359c873cfb`.
Scope: all exports of `@webmusic/score/analyze/headless`, the Analyze worker entry/protocol behind that API, and their direct symbolic algorithms. Authorized source/test/reference fixes only; no builds, commits, pushes, frontend redesign, browser or device acceptance.

## Complete Headless export inventory

The public barrel is `packages/score/src/analyze/headless/index.ts`. The following 22 runtime exports were traced to their implementations:

| Export | Input/state/resource contract reviewed |
|---|---|
| `createAnalysisSession` | Immutable Score plus fixed options; synchronous update; per-Part/voice WeakMap caches, chord splice and frozen result ownership. No listener, clock or dispose method. |
| `createLiveChordTracker` | Counted MIDI occurrences, synchronous name/history notifications, reentrant reset, defensive callback arrays. Caller owns note delivery and subscriptions. |
| `createLiveKeyTracker` | Equally weighted onset histogram, total heard count, callback/result/reset; no note-off, elapsed-time or decay model. |
| `createAnalysisWorker` | Owned/factory versus borrowed Worker, in-process fallback, protocol validation, serialization, queued update coalescing, failures, cleanup and frozen results. |
| `AnalysisWorkerRemoteError` | Structured remote error fields retained on Error. |
| `ANALYSIS_WORKER_PROTOCOL` | Stable wire identity string. |
| `ANALYSIS_WORKER_PROTOCOL_VERSION` | Version 1. |
| `createScoreReport` | One-shot formatted whole-score summary; no retained resource. |
| `createTransportClock` | Caller-supplied wall timestamps and nominal seconds/rate; bounded presentation coasting, hold/release/stop and epochs; no authoritative transport/scheduler. |
| `rateFromDurations` | Positive finite duration ratio with fallback 1 for unusable inputs. |
| `projectSounding` | Chord spelling/roles plus staff/fret/nameplate data; uses only supplied notes/context. |
| `soundingMidisAt` | Backward score lookup and deliberate recent-attack fallback during short rests; not an exact active-note source. |
| `projectProgression` | Chord/Roman bands through the score's time map; optional roll; coarse T/S/D grouping. |
| `projectKeyFlow` | Fixed consecutive window histograms, duration overlap weights and merged key readings. |
| `projectMotifFlow` | Ranked/folded recurrence bands linked to occurrence note indexes. |
| `projectVoiceFlow` | Limited voice rows, contours and correctly located issue brackets. |
| `projectTonality` | Circle-of-fifths data via `keyWheel`; relative profile weights and reference orientation. |
| `projectKeyCandidates` | Ranked correlation readout, not probability. |
| `projectPitchClassMeters` | Supplied-bin normalization; caller supplies compatible units for any comparison. |
| `formatMetricalPosition` | Score time-map measure/beat conversion. |
| `keyPitchClasses` | Major/natural-minor pitch classes or empty input. |
| `projectNameplate` | Nameplate-only projection from an existing chord spelling. |

All public type exports were also located and checked with their implementation:

- Session: `AnalysisResult`, `AnalysisSession`, `AnalysisSessionOptions`.
- Live: `LiveChordState`, `LiveChordTracker`, `LiveKeyTracker`.
- Worker: `AnalysisWorkerClient`, `AnalysisWorkerFactory`, `AnalysisWorkerLike`, `AnalysisWorkerEventLike`, `AnalysisWorkerRequest`, `AnalysisWorkerErrorCode`, `AnalysisWorkerErrorDetails`, `AnalysisWorkerResponse`, `AnalyzeRequestMessage`, `ScoreJSON`, `UpdateRequestMessage`.
- Report: `ScoreReport`.
- Prediction: `TransportClock`, `TransportClockOptions`, `TransportReading`, `TransportSample`.
- Projections: `PitchMarkView`, `StaffMarkView`, `StaffView`, `FretMarkView`, `FretboardBarreView`, `FretboardView`, `ChordNameView`, `HarmonyVoiceView`, `NameplateView`, `FlowBandView`, `FlowTrackView`, `FlowFlagView`, `FlowBracketView`, `FlowLaneView`, `ChipItemView`, `WheelSegmentView`, `WheelNeedleView`, `TonalityView`, `SoundingContext`, `SoundingProjection`, `FlowProjectionOptions`.

`freezeAnalysisResult` is an internal helper, not exported by the public Headless barrel. Worker handler/state/validation helpers are inspected dependencies, not invented Headless exports. `Score`, Note timing and the shared time-map/query implementation remain core-owned; root separately fixes empty/reversed overlap queries and tempo-unit compatibility.

## Direct algorithms and source evidence

- `analyze/core/key.ts`: Krumhansl–Schmuckler Pearson correlation over the 24 rotations of the Krumhansl–Kessler major/minor profiles. Whole-score weights are rounded duration ticks; live weights are note-on counts. Empty input returns compatibility tonic/mode with zero confidence and no candidates. Uniform chromatic evidence gives zero correlations. The local confidence formula measures winner/runner-up separation, not a calibrated probability.
- The publisher's [Humdrum keycor reference](https://extras.humdrum.org/man/keycor/) specifies the profile coefficients, duration-weighting option and Pearson ranking used as the independent reference here. The [Humdrum key reference](https://www.humdrum.org/Humdrum/commands/key.html) describes the major/minor and enharmonic limitations. These are retrieved primary project references, accessed 2026-09-10; no externally reported accuracy figures are transferred to WebMusic.
- `analyze/core/chords.ts`: event sweep at note onsets/offsets, half-open sounding sets, deterministic bass-up pitch-class deduplication, optional fifth assumption, contiguous label merge. Naming uses installed/pinned `@tonaljs/chord-detect` **4.9.1**; parsing uses `@tonaljs/chord` **6.1.2**, with `chord-type` 5.1.1, `pitch-note` 6.1.0 and `pcset` 4.10.1. Exact code is in local `node_modules/@tonaljs/*/dist`, including source maps. The [publisher's versioned package](https://www.npmjs.com/package/@tonaljs/chord-detect/v/4.9.1) and [official detection source](https://github.com/tonaljs/tonal/blob/main/packages/chord-detect/index.ts) explain pitch-set matching and inversion ordering. Local installed versions, not the moving GitHub branch, establish the dependency reviewed.
- `chord-spelling.ts`: spelling-policy memoization, parsed-candidate coverage, ambiguous symbol repair, ordinal naming ranks, explicit preferred naming, optional rootless candidates, enharmonic spelling and root-relative roles. This is more opinionated than the direct string detector; rank is not accuracy/confidence.
- `roman.ts`: tonic/mode-relative root degree and quality suffix, flat-preferred chromatic degree, fallback for unparsable labels. It is not contextual secondary-dominant, cadence, borrowed-mode or inversion-figure analysis.
- `motif.ts`: exact Rational duration keys, per-voice highest-note reduction, explicit rest/percussion phrase boundaries, interval transposition invariance and non-overlapping support threshold. Rhythm vocabulary instead scans per-part duration sequences, includes simultaneous notes/rests and counts overlapping occurrences.
- `voice-leading.ts`: representative first sounding note per onset tick, shared-onset pairs, strict >12-semitone leap, same-direction moving fifth/octave checks, mean-pitch ordering for crossings. These are defined diagnostic heuristics rather than complete counterpoint rules.
- `summary.ts` and `distributions.ts`: metadata/scalars, pitch range, first tempo/meter, pitch duration weights, per-lane intervals and Rational duration bins. `chordTimeline` is a separate fixed-window aggregate and may combine multiple attacks inside a window; it is not the event-exact segmentation algorithm.
- `staff-placement.ts`: diatonic/accidental arithmetic, signature fifths, bounded ledger positions; no engraving engine.
- `key-wheel.ts`: fifths order, enharmonic signature choices, common normalization across 24 candidates and a design-defined relatedness decay. Relatedness is not measured modulation likelihood.
- `fretboard-voicing.ts`: bounded combinatorial search and explicit fingering/contiguity/slash-bass constraints; coverage/position tie-breaks are design choices. Search does not model individual hand size or preceding fingering and is not a proof that every rejected shape is unplayable.

No Chordcat comparison was repeated or used as an accuracy benchmark. No new dependency was installed.

## Confirmed corrections

1. **Empty report claimed C major.** `headless/report.ts:32` now prints `Unknown` when the detector has no tonal candidates, rather than its compatibility C-major placeholder. Empty and rest-only score regression.
2. **Zero duration lost its upper bound.** `headless/transport-clock.ts:143` now accepts an explicit zero duration as a clamp. Samples, hold/release and stop remain at zero.
3. **Invalid rhythm lengths produced inconsistent empty results or indexing errors.** `core/motif.ts:220` validates a positive safe integer before scanning. Covers zero, negative, fractional, NaN and Infinity plus valid one-note patterns.
4. **Parallel-motion checking crossed a rest hidden between matched onsets.** `core/voice-leading.ts:149` now carries all intervening phrase breaks to the next shared pair. A lower voice C–rest–C#–D against G–A no longer reports the endpoint fifths as uninterrupted motion.
5. **Equal raw voice IDs in different parts collapsed onto one row.** Added optional `VoiceLeadingIssue.voiceParts`, paired by index with existing raw `voices`. Local results populate it; sessions freeze it, worker validators/roundtrips retain it, and projections match part plus voice. Old results with no part field still locate globally unique voice IDs; ambiguous old results omit the bracket. No renaming of existing `voices`, separator-based synthetic identity, or core-model change.
6. **Motif bands used duration sums as elapsed extent.** `headless/workbench.ts:789` resolves occurrence indexes in the supplied Score and takes maximum actual offset. Notes at quarters 0 and 2 lasting one quarter end at 3, not 2; all overlapping candidate occurrences remain represented. A reduction avoids argument-count limits.
7. **Voice band ended before an earlier sustained note released.** `headless/workbench.ts:850` uses maximum offset rather than the final attack's offset. A note spanning 0–8 plus one at 1–2 keeps a band ending at 8.
8. **Fretboard cache aliased valid tuning metadata.** `core/fretboard-voicing.ts:625` uses structured keys including inlays and neck length. Same strings/window with different metadata, and `id/name` values containing `|`, no longer return a prior caller's instrument.
9. **Worker serialization threw synchronously after allocating a waiter.** `headless/worker-client.ts:153,181` serializes before waiter registration, rejects the Promise on failure, and rechecks disposal/failure after serialization reentry. No posted request or dangling promise remains.
10. **Partial Worker listener installation leaked resources.** `headless/worker-client.ts:137` cleans both listener channels if setup fails and terminates only an owned Worker. Borrowed ownership remains unchanged; cleanup attempts continue if a custom removal hook throws.
11. **Mixed commands could restore an older score under newer options.** An in-flight `update(A)`, queued `update(B)` and new `analyze(C)` previously sent A/C/B. `headless/worker-client.ts:153–310` now treats the newest analysis as a barrier: old queued inputs are discarded, already-sent old update replies are ignored, and their promises coalesce into C or a later queued update D. D waits for C to succeed. Each analysis still gets its own result/error, and only the newest analysis can release the queue. If the newest analysis fails, all pending updates reject with that error and queued input is dropped, preventing silent use of old options. Disposal and terminal failure settle every pending call. Nine regressions use the real worker handler with controlled request/reply delivery, including old replies before/after C, repeated analysis, option installation, failure, owned/borrowed disposal and runtime failure. No new cancellation error or wire-protocol revision.

Public updates: `score/headless/analyze/{analysis-session,live-trackers,score-report}.mdx` and `score/api/analyze.mdx`. References explain added identity, empty/error behavior, actual projection bounds, rhythm validation, confidence interpretation and mixed Worker command/error settlement. No new tag or capability was added; existing Headless roles remain distinct and appropriate.

## Regression and verification evidence

New file: `packages/score/test/analyze/headless-review-regressions.test.ts` (**31 tests**), including loops over all 24 published key-profile transpositions and 24 root-position major/minor triads, spelling roundtrips, C/E spelling, uniform/no-evidence input, exact harmony boundaries, live occurrence ownership/reentry, worker serialization/setup/mixed-command barriers, JSON worker identity delivery and projection/cache cases.

The profile tests establish correct rotation/correlation on deliberately constructed data; they are not an empirical key-accuracy measurement. Existing randomized session-versus-full and worker roundtrip suites establish implementation parity, not an independent musical oracle.

Commands completed without package builds:

- `npx vitest run test/analyze --root packages/score` — 30 files, **476 tests passed**. Log: `/private/tmp/webmusic-score-headless-analyze-suite-20260910.log`.
- `npm run typecheck -w @webmusic/score` — passed. Log: `/private/tmp/webmusic-score-headless-analyze-typecheck-20260910.log`.
- Scoped ESLint and `git diff --check` — passed. Lint log: `/private/tmp/webmusic-score-headless-analyze-lint-20260910.log`.
- `npx tsc -p tsconfig.test.json --noEmit` — initial pass before the mixed-command follow-up; final rerun reports one error in concurrent Play work, `packages/score/test/play/sounding-preload.test.ts:20` (incomplete object cast to `AudioBuffer`, TS2352), and no Analyze errors. Reported to root without editing the other agent's file. Log: `/private/tmp/webmusic-score-headless-analyze-test-types-20260910.log`.

The initial pre-fix log contains failing boundary probes and the serialization waiter leak. Two initial rest fixtures used the wrong builder property and were corrected to `rest`; the final tests use valid Score construction. This fixture correction is not counted as a library bug.

## Remaining boundaries

- Key/chord/music-theory quality has no new annotated real-music corpus evaluation. Symmetric sets, incomplete chords, profile ambiguity, spelling policy and candidate order remain context-dependent.
- A shared raw MIDI pitch has occurrence counts but no channel/port/sustain identity in these Headless trackers. Callers supply effective sounding-note releases and reset at chosen playback/source boundaries. No MIDI/audio-device test was performed.
- Presentation prediction does not schedule audio, anticipate unknown loop bounds or establish sample accuracy. Inputs use a common caller timestamp origin; arbitrary timestamp reordering was not turned into a new clock protocol.
- Worker supersession governs queued inputs and result settlement; it does not interrupt already-running CPU work. A failed latest analysis drops queued updates; applications should explicitly retry analysis with valid options to establish the intended session.
- Borrowed worker shims without `removeEventListener` cannot detach their registration; disposal gates late events. Custom workers and browser CSP/module-worker execution need real-environment verification. In-process fallback is synchronous CPU work behind Promises, not background execution.
- The fret search and presentation projections retain their declared heuristic/capacity limits. No hand-performance validation or browser rendering was performed. Consumers must respect read-only shared cache results.
- Final integrated `npm run check` and documentation build belong to root after all agents freeze; this subtask did not rebuild `dist` or run browser/device work.
