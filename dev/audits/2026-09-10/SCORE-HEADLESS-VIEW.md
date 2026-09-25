# Score Headless View algorithm and lifecycle review — 2026-09-10

Read the [combined audit](SCORE-HEADLESS.md) for final integrated verification.
This record also includes the subsequently assigned TonePlayer supplement.

## Scope and baseline

Reviewed main at `f074cd8b5f7cdf8f288c77d988384a359c873cfb`, with the root agent concurrently reviewing Core/I/O and other agents reviewing Analyze/Play. This contribution changes only View's Headless/pure algorithms, their tests, and the owning Headless/View API references. It makes no commits, pushes, package builds, dependency changes, or frontend design changes. `dist/` remained untouched.

Read AGENTS, the development entry/product/status/decision/architecture/development owners, `.agent/skills/webmusic-component-review/SKILL.md`, its workflow, the View family design (DEC-015), player binding design (DEC-011), public Headless pages, actual package exports and relevant tests. The current layout and delivered APIs take precedence over historical examples.

## Complete Headless export coverage

`packages/score/src/view/headless/index.ts` exports **two runtime values and nine types**. No exported factory was sampled or omitted.

| Export | Contract and review coverage | Result |
|---|---|---|
| `createScoreView` | Immutable fixed Score and cached sequence; mode, nominal position, viewport, active identity, borrowed source, synchronous subscriptions, disposal | Repaired identity, publication, cleanup and rejected-input atomicity; retain |
| `ScoreView` | Reviewed all properties and commands: score/sequence/state, setType, setViewport, clearViewport, seek, noteOn/off, clearActiveNotes, end, reset, subscribe, updatePlayback, dispose | Source/reference reconciled |
| `ScoreViewOptions` | Three renderer modes, copied/frozen initial viewport, optional borrowed playback subscription | Initial callback and failure path covered; no acquisition of a player or clock |
| `ScoreViewState` | Frozen snapshot/arrays; actual sequence-note references; candidate vs exact visible set | Reentrant state supersession now explicit |
| `ScoreViewTimeRange` | Finite `0 <= startTime <= endTime`, nominal seconds | Exact viewport and sounding interval boundaries documented |
| `ScoreViewListener` | Synchronous, no initial callback, unsubscribe, reentrant command/disposal, error propagation | Repaired resumed stale publication and removed-listener delivery |
| `ScoreViewType` | `piano-roll`, `staff`, `waterfall`; no map/thumbnail renderer-lifecycle expansion | Correct separation from five-type Element contract |
| `createActiveNoteTracker` | Score-independent integer MIDI 0…127 reference counts; sorted immutable pitch set | Repaired publication reentrancy/unsubscribe; retain |
| `ActiveNoteTracker` | state, noteOn/off, clear, subscribe; no dispose/clock/input adapter | All commands covered; caller owns input subscriptions |
| `ActiveNoteState` | Frozen ascending unique MIDI array; repeated attack counts retained internally | Existing duplicate-holder coverage passes |
| `ActiveNoteListener` | No initial delivery; synchronous committed state, errors propagate | New supersession/unsubscribe coverage passes |

## Direct pure algorithm coverage

The pure View entry (`@webmusic/score/view`) exposes eight functions; all were inspected alongside the Headless dependency paths.

| Function or internal group | Units, boundaries and limitations checked |
|---|---|
| `scoreToNoteSequence` | Core onset/end conversion including performed overrides; rest filtering; written MIDI pitch; sorted onset/pitch; immutable identity cache; total duration includes performed note tails; qpm includes tempo unit; staff preserved/inferred |
| `findSequenceNote` | Start-sorted binary search; strict `< 1e-6` second onset tolerance; returns first matching unison, not all identities; empty/no-match behavior |
| `secondsToQuarters` | Piecewise nominal seconds integration, tempo units, unordered/mutable marker input, default 120 qpm, first-marker extension, segment boundaries, clamped origin and invalid input |
| `createPianoRollLayout` | Nominal-seconds x; pitch lanes; positive scales; minimum glyph width; rests/empty input; existing 150,000-note regression |
| `createWaterfallLayout` | Full duration and performed-tail origin; descending time axis; white/black pitch columns; all 128 MIDI notes; preserved A0 origin and standard 88-key coordinates |
| `createStaffLayout` | Written diatonic spelling (C# shares C, Db shares D), octave steps, part origins, positive spacing; approximate ledger-line count without clef model explicitly bounded |
| `createScoreMap` | Quarter-note axis; measure grouping and no-measure fallback; sounding span overlap including long held notes; point notes/end boundary; normalized density; empty input; finite budgets and 150,000 cells |
| `validateScoreViewConfiguration` | Three-mode discriminated options; malformed mode/options/key rejection; key validation remains separate from renderer value semantics; map/thumbnail remain Element modes |
| Windowing helpers | `lowerBoundByStartTime`, `upperBoundByStartTime`, `isSortedByStartTime`, `maxNoteDuration`, `visibleNoteRange`, `activeNoteCandidateRange`: ascending-input precondition, duplicate onsets, held notes, widened candidate interval, exact filter, empty/inverted/beyond-score windows |
| Pixel/resource helpers | `bufferedScrollRange`, `clampCanvasBackingSize`, `resolveVirtualization`, their constants/types: scroll-buffer axis, finite size/DPR fallbacks, dimension cap, effective x/y scales, threshold/config fallback; no browser allocation claim |
| Pitch readout helpers | `readoutPitch`, `currentStaffMarks`, `parseViewTuning`, `currentFretMarks`, `STANDARD_VIEW_TUNING`: chosen sharp/flat spelling, exact diatonic steps, valid MIDI/tuning boundary, physical string order, exact MIDI-minus-open fret, inclusive fret window, no octave folding or inferred fingering |

The Headless layer has no resize observer, DOM coordinate system, pointer hit testing, renderer acquisition, source-load promise, source-replacement method or asynchronous render cancellation. Resize/coordinate round trips belong to the renderer/input adapter. Its explicit viewport is a time range; layouts can be recomputed at a new positive scale. Fixed-score models must be recreated for a different immutable Score. Existing renderer/Element tests were executed for compatibility, but those surfaces did not receive a new frontend audit here.

## Reproducible findings and repairs

1. **P2 — legal identity pairs collided.** `score-view.ts:75`: concatenating `partId + ':' + noteId` makes (`a:b`, `c`) collide with (`a`, `b:c`). A native-style snapshot containing one occurrence lit both pitches. Structured pair serialization now keeps these identities distinct. Test: `headless-score-view.test.ts`, “keeps distinct part/note identity pairs…”.
2. **P2 — reentrant publication resumed an obsolete notification round.** `score-view.ts:121`, `active-notes.ts:26`: listener A could reset/clear while handling a command; listener B then received the new state both from the nested publish and the resumed outer loop. Removed listeners could still be called. Each publication now retains its own immutable snapshot, abandons the remaining old round after a newer snapshot, and checks current subscriber membership. Disposal also stops pending callbacks. Both factories have regression cases, including the state returned after reentrant commands.
3. **P2 — throwing borrowed cleanup prevented local disposal.** `score-view.ts:229`: the old code invoked foreign unsubscribe before marking disposed/clearing active state/listeners. Cleanup failure retained a live local view. Local cleanup now completes first; the foreign error propagates once, repeat dispose is safe, and late source emissions are ignored. A throwing-cleanup regression verifies all of these outcomes.
4. **P2 — rejected playback time partly mutated hidden state.** `score-view.ts:216`: after an active seek, applying `nominalSeconds: NaN` cleared the internal active set before throwing. The published snapshot appeared unchanged, but the next mode change lost those notes. Validation now occurs before clearing activity. Regression checks both immediately observed state identity and the following mode command.
5. **P2 — waterfall folded valid out-of-piano-range pitches onto A0.** `layout.ts:48,138`: only MIDI 21…108 had key entries; other valid MIDI notes defaulted to `x=0` and white-key width. All 128 pitches yielded only 88 distinct columns. Direct chromatic/white-key arithmetic now covers MIDI 0…127 while preserving the A0 origin and all standard coordinates. Lower notes deliberately have negative x for renderer translation. Regression checks unique ascending columns, black width, MIDI 0/21/22/60/108/127 positions.
6. **P2 — invalid layout scales emitted unusable geometry.** `layout.ts:153`, `types.ts`: zero, negative, NaN or infinite used pixel scales produced collapsed/negative/non-finite positions or dimensions. All three projections now reject non-positive/non-finite used scales with RangeError, even for an empty score. Defaults are unchanged; irrelevant mode options are still ignored.
7. **P2 — score-map budgets and array argument limit.** `map.ts:145,185`: NaN/Infinity maxCells computed invalid measure indices and threw an incidental TypeError. **Infinity did not hang**: a separate child-process probe confirmed immediate access to an undefined last measure. The initial suspicion of a non-progressing loop was corrected. Both budgets now require finite numbers, retaining rounding and minimum-one behavior. `Math.max(...counts)` also failed at 150,000 cells with “Maximum call stack size exceeded”; iterative maximum removes the function argument limit. Both failures have regressions. maxMarks is documented as a target because major landmarks survive thinning.
8. **P2 — inconsistent/non-finite time conversion.** `note-sequence.ts:136`: at -1 seconds an empty tempo map returned -2 quarters while an explicit default tempo returned 0. NaN/Infinity time and malformed marker time/qpm propagated invalid numerical results. Negative finite time now consistently clamps to zero, matching the Score time-axis origin; non-finite seconds, negative/non-finite marker times, and non-positive/non-finite qpm throw RangeError. Eleven new cases failed before repair. Positive tempo-segment and immutable/mutable-cache tests still pass.

## Lifecycle and ownership conclusions

- Headless `subscribe` intentionally has no initial callback; `ScorePlaybackSource.subscribe` intentionally does. Construction applies the borrowed initial playback snapshot synchronously, uses nominal rather than rate-scaled transport seconds, and does not seek or dispose the owner.
- A custom source must clean a subscription whose synchronous initial callback throws. Root independently verified native PlaybackPublisher does this. The new construction test models that compliant source contract; no generic adapter was expanded to compensate for a source violating it.
- `observeScorePlayback` orders revisions and disables delivery before foreign cleanup. New tests cover stale revision rejection, non-unit-rate nominal positioning, local seek not delegating, unavailable data, and late emissions after disposal.
- Incompatible/unavailable/disposed input clears activity while retaining local time. Compatible `nominalSeconds: null` retains time but applies identity. No second clock, player, source file load, or async replacement is introduced.
- Callback failures still propagate and do not roll back already committed state. A newer reentrant state supersedes remaining callbacks from the older round. Clear/reset/end remain distinct; active-note counts require matching releases from the owning input adapter.

## Retain / merge / extract decision

Retain both Headless factories. ScoreView projects exact fixed-score note identity and time-window visibility. ActiveNoteTracker is a score-independent MIDI reference counter. Their similar subscribe shape does not justify merging different data/time contracts or exposing meaningless score/viewport options to live pitch input. Pure map/layout/time functions remain stateless APIs. No new Web Component, deprecated alias, UI switch, UIKit extraction or renderer factory is necessary for these repairs.

## Documentation changes

- `score/headless/view/score-view.mdx`: cached-sequence ownership, exact visible/sounding predicates, mode/resize boundary, matching pitch/identity, source availability/time, validation, initial subscription failure, reentrancy, disposal ordering.
- `score/headless/view/active-note-tracker.mdx`: synchronous supersession, unsubscribe and committed-state-on-callback-error behavior.
- `score/api/view.mdx`: scale validation, full-MIDI waterfall/A0 coordinates, simple staff-layout limit, map units/budgets, sorted sequence matching, and the previously omitted public `secondsToQuarters` contract/table row.

## Executed verification

| Command/evidence | Actual result |
|---|---|
| Initial Headless regression run | Six new cases failed before repair: `/private/tmp/webmusic-view-headless-red.log` |
| Headless repair run | 2 files / 14 tests passed: `/private/tmp/webmusic-view-headless-green.log`; later expanded in final full-View run |
| Map baseline | 2 expected failures: TypeError for NaN budget, RangeError from spread at 150,000 cells; `/private/tmp/webmusic-view-map-red.log` |
| Separate Infinity probe | Immediate TypeError, no hang; `/private/tmp/webmusic-view-map-infinity-repro.log` |
| Layout baseline | 5 new cases failed (88 versus 128 unique columns; four invalid-scale cases): `/private/tmp/webmusic-view-layout-red.log` |
| Rejected snapshot baseline | 1 new case failed on subsequent active-note loss: `/private/tmp/webmusic-view-playback-red.log` |
| Time baseline | 11 new cases failed: `/private/tmp/webmusic-view-time-red.log` |
| `npm run test --workspace @webmusic/score -- test/view` | **28 files / 299 tests passed**, 1.98 seconds reported by Vitest; `/private/tmp/webmusic-view-all-tests.log` |
| Focused `npx eslint` on all 11 changed View TS source/test files | Exit 0; `/private/tmp/webmusic-view-lint.log` |
| `git diff --check --` on owned View source/tests/references | Exit 0 |

The full View suite used Node v26.8.1 / Vitest v3.2.7. jsdom's existing Canvas/OSMD “not implemented” messages and Node localStorage experimental warnings appear in the passing run; they are not evidence of real browser rendering. No build, built-declaration check, full repository check, docs build, audible test, or browser visual/accessibility audit was performed by this subagent. Root owns integrated final gates after all writers finish.

## Remaining limits / independent evidence

- These fixes follow independent identity, state-machine, interval, MIDI-column and piecewise-integration examples. No new third-party algorithm was adopted. The pinned baseline source, exported types and native playback contract above are the relevant primary implementation evidence; no upstream-equivalence claim is made.
- Lightweight staff and full engraving are different contracts. `createStaffLayout.ledgerLines` lacks clef input and remains an explicitly documented heuristic, not a validated treble/bass engraving algorithm. Renderer dependency behavior (locked staffrender 0.2.1 / OSMD 1.9.9) and visual clipping/highlights require the later rendering phase.
- Sequence `voice` is numeric legacy metadata: nonnumeric VoiceIds become undefined, though exact part/note IDs remain. `instrument`/`program` currently identify the part index and do not constitute a general MIDI export. No new MIDI fidelity guarantee is made.
- Binary-search helpers require sorted valid spans. Custom malformed Score internals, extreme arithmetic overflow despite individually finite inputs, maximal-duration adversarial viewport candidate sets, and allocation performance beyond the 150,000-cell/note probes were not exhaustively verified.
- The canvas helper caps individual dimensions; device-specific area/memory limits and actual CSS-to-device coordinate rendering were not established. Its optional internal maxDimension argument's malformed values are outside the caller paths inspected.
- Core tempo acceptance (bpm/unit validation), tie continuity, overlap range semantics and I/O conversion belong to the root review. Root confirmed `normalizeTempoEntriesByPosition` invokes `assertTempoEntry` / `assertValidTempo`; the initial concern about missing tempo validation was resolved and is not a remaining finding.

## Play supplement: bounded TonePlayer command reentrancy

After the View report, root assigned only `packages/score/src/play/headless/tone-player.ts`, its existing test file, and the owning `score/headless/play/tone-player.mdx` for a final release-command supersession audit. Root and the Play agent own all other Play changes and integrated checks.

### Findings and final implementation

- **P2 — old commands overwrote callback commands.** With one active note, a `noteOff` listener calling `seek(0.25)` inside `stop()` was overwritten to zero in both owned and shared modes. With `noteOff` calling `dispose()` during `setTempo(240)`, the disposed player was still assigned rate 2. The initial regression run had three failures; two additional dispose-during-pause/seek cases already passed and were retained as boundaries.
- A new synchronous `operationGeneration` guards the continuation after release/backend cleanup. It is separate from `playGeneration`, which preserves the existing asynchronous browser-unlock contract. Play, pause, stop, seek, valid tempo/synth changes, shared disarm/rearm, end and disposal participate in supersession where applicable. Later callbacks cannot resume an obsolete command's transport writes or rebuild.
- Root's cross-review correctly rejected an intermediate approach that stopped releasing old voices when the generation changed. The **final code always finishes its captured list of old voices**. `clearScheduleAndReleaseVoices` snapshots old voices, marks the schedule absent, invalidates/clears its old entries, then releases only those captured voices. A newer pass can be installed during a callback without being included in the old cleanup snapshot.
- Reentrant `play()` on an already running owned or shared transport re-arms an invalidated pass. A nested seek on a running owned transport also schedules even when an older lifecycle command has just invalidated the schedule. Shared disarm commits its retained local position only after old-voice cleanup and the generation check, so position observed inside a callback is not double-counted.
- Four two-note chord regressions cover owned/shared × pause/stop → callback play. They prove both old handles are released, the callback observes the correct position, exactly one fresh five-event pass (two attacks/two releases/end) survives, the fresh voices are released on final disposal, and shared host pause/stop/seconds remain untouched.
- **P2 — infinite tempo scale poisoned duration/position.** Root identified that `setRate(Infinity)` previously produced infinite rate, zero duration and non-finite nominal position. A new regression failed before the repair. Non-finite resulting tempo scales are now ignored, consistent with the existing ignored-invalid-tempo policy, without releasing voices or replacing the pass.

### Tone verification and limits

- `npm run test --workspace @webmusic/score -- test/play/tone-player.test.ts`: **53 tests passed**, including existing shared-transport ownership, exact voice cancellation, pending unlock cancellation and rolling-window tests. Log: `/private/tmp/webmusic-tone-final-tests.log`.
- Initial supersession failures: `/private/tmp/webmusic-tone-reentry-red.log` (3 failed / 42 passed). Infinity failure: `/private/tmp/webmusic-tone-infinity-red.log`.
- New seek/tempo-during-pending-unlock tests confirm those commands retain the pending play intent and schedule the updated position/rate. Existing pause/stop/dispose-during-unlock tests remain green.
- Focused ESLint for the two Tone TS files: exit 0 (`/private/tmp/webmusic-tone-lint.log`). Owned-file `git diff --check`: exit 0.
- The Tone public page now documents synchronous supersession, old-voice cleanup, fresh pass rearming, separate unlock intent, post-disposal command behavior and non-finite tempo handling.
- This supplement uses deterministic injected transport/backend callbacks and voice-handle traces. It is not a real Tone/browser audio-timing measurement or a new audit of Tone's scheduler internals. No builds, dependencies, public exports, clock ownership, frontend UI, commits or pushes were changed.

All View and assigned Tone source/reference/test work is now frozen for root integration.
