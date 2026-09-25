# Score API capability review — 2026-09-10

Checkout: `/Users/mamingchen/GitHub/WebMusic`, main baseline `f074cd8b5f7cdf8f288c77d988384a359c873cfb`, including the preceding uncommitted Headless corrections as the baseline. Scope is the public stateless Analyze/Play/View capability entries and their algorithms/types. Core/IO/React findings and integrated acceptance are recorded in the [API review](SCORE-API.md). No package build, dist rewrite, commit, push, browser or device work was performed here.

## Complete Analyze export coverage

`src/analyze/index.ts` re-exports `src/analyze/api/index.ts`: exactly 12 runtime names. Stateful clients and projections are distinct Headless exports, not added to this count.

| Runtime export | Implementation and independent checks |
|---|---|
| `identifyChord` | `core/chords.ts`; filters pitched notes, orders actual bass, retains notated spelling and deduplicates chroma. New 36-case major-triad position/transposition loop, C-flat inversion and malformed Tonal-candidate cases. |
| `identifyChordFromMidi` | Same path with fixed mixed accidental names. Bass/doubling conventions, conventional inversions, augmented/diminished ambiguity and omitted perfect fifth tested. |
| `segmentChords` | Event sweep over note onsets/offsets; same-label contiguous merge, gap separation, optional intermediate length cap. Independent two-harmony-within-one-window test plus existing boundary/rest suite. |
| `detectKey` | Duration weights at compatibility 480 PPQ, 24 Pearson-correlated Krumhansl–Kessler profiles, winner/runner-up separation. New overlap-weight and tempo/onset-shift invariants; prior 24 published-profile rotations and uniform/empty cases retained. |
| `distributions` | Duration-weighted chroma; signed per-voice interval counts; exact Rational duration bins for sounding notes. New exact aggregate weights and sub-tick interval preservation. |
| `findMotifs` | Per-part/per-voice exact interval and Rational duration windows; highest chord tone, rest/percussion phrase split, transposition equivalence, nonshared-note support. New provenance/highest-tone/length-one case; existing rest, triplet and overlap tests. |
| `rhythmPatterns` | Per-part adjacent durations, including explicit rests and simultaneous notes, overlapping windows and count ranking. Independent `[1,2,1,2]` vocabulary expectations; previous invalid-length regression retained. |
| `romanNumeralForChord` | Parsed root minus tonic, major/natural-minor degree, flat-neighbor chromatic preference and quality suffix. Major inversions, minor-major alias, seventh/slash, chromatic and unknown cases. No contextual function/figured-bass claim. |
| `romanNumerals` | Same label function over owned or supplied segments. Explicit precomputed bounds/labels test. |
| `voiceLeading` | Representative first sounding member at an exact onset, >12-semitone leaps, shared-onset pair motion and mean-register crossing heuristic. New nearby Rational onsets prevent false pairs and lost leaps; previous rest/part-identity cases retained. |
| `chordTimeline` | Fixed-window aggregate of all overlapping pitched notes, minimum distinct chroma, optional equal-label merge. New complete merged evidence, finite options and deliberate distinction from event-exact segmentation. |
| `summarizeScore` | Metadata, structural/sounding-note counts, extent/time map, first authored tempo/meter/key, pitched range. Independently checked rest exclusion and octave range. `tempoBpm` is the authored beat-unit tempo value; this record does not reinterpret it as a normalized quarter-note rate. |

All 18 exported type names were checked against their owners:
`DistributionBin`, `Distributions`, `RomanNumeralOptions`, `ChordTimelineOptions`, `ChordTimelineSegment`, `ScoreSummary`, `ChordSegment`, `ChordWindowOptions`, `Key`, `KeyResult`, `Motif`, `MotifOptions`, `RhythmPattern`, `RNAResult`, `VoiceLeadingIssue`, `AnalysisResult`, `AnalysisSessionOptions`, `LiveChordState`.
The last three are type-only links to Headless contracts. `AnalysisSession` itself is not a root Analyze export.

Internal spelling/voicing dependencies were reviewed without misrepresenting them as public root exports: `spellChord`, candidate parsing/ranking, key-wheel/staff helpers, tuning resolution, fret arithmetic and bounded fingering search. New tests enumerate exact G4 locations on reentrant ukulele strings and check every built-in tuning's returned shape against its neck window, unique strings and supplied chord chromas. The previous extensive naming/fingering suites remain in the run.

## New Analyze corrections

1. **Merged timeline evidence stopped at its first window.** `src/analyze/core/summary.ts`: rearticulated C–E–G over two windows previously extended the segment endpoint but omitted the later notes. Equal `N.C.` windows likewise lost later chromas. Merging now accumulates a deduplicated note union with a persistent Set and a chromatic pitch-class union. Sustained notes are not duplicated; notes represent evidence across the span, not simultaneous sound. This avoids rebuilding the growing note union on every merge.
2. **Timeline options could fail inconsistently or produce misleading results.** `chordTimeline` now validates finite `windowQuarters` and `minNotes` before even an empty-score scan. Existing defaults/clamps remain: window 1/minimum 0.125, distinct pitch-class threshold 2/minimum 1, merge true. Fractional minimums retain their effective ceiling semantics.
3. **Compatibility ticks changed symbolic onset identity.** `voice-leading.ts` grouped and paired events after rounding to 480 ticks/quarter. Distinct onsets 0 and 1/1000 could erase a melodic leap; two voices offset by 1/1000 could fabricate simultaneous parallel fifths. Internal lanes now use canonical Rational onset strings and exact comparison. Interval distributions reuse these lanes, and session caches still cache them by immutable Part identity. No core time API changed.
4. **Direct naming and the accepted spelling policy disagreed.** E–G–C could become `Em#5` in `identifyChord`/progression, while the established spelling projection prefers `CM/E`. A naming-only helper now shares candidate coverage/ranking while preserving caller-provided names. This resolves inconsistent policy for an ambiguous pitch set; it does not assert that `Em#5` is theoretically impossible or change all ambiguity rankings. No staff/fret data is computed. Missing-perfect-fifth behavior stays enabled; rootless/preferred spelling options remain with the existing projection.
5. **Detector-emitted minor-major slash symbols could not be parsed by downstream APIs.** The existing repaired parser is now shared with Roman and timeline analysis: `Cm/ma7/D#` no longer falls through to an uninterpreted symbol or `N.C.`. Its root/quality and `imaj7` label are available.
6. **Malformed detector spellings could misidentify the root.** Shared candidate coverage rejects `Cb9sus` interpreted as C-flat when the actual input is C–Db–F–G–Bb; the already accepted `C11b9` naming is used instead. This is parsing/coverage consistency, not a new harmonic-cognition rule.

Public `score/api/analyze.mdx` now includes the formerly omitted single-chord functions and `RomanNumeralOptions`, corrects the false dependency-free timeline claim and fixed-window segmentation description, and explains actual rhythm/rest/voice/ambiguity semantics. The internal tuning comment now distinguishes rounded numeric arrays from integer-only text; runtime normalization remains unchanged.

## Play and View coverage beyond the prior Headless audit

A delegated source audit enumerated all 30 Play runtime exports:

- SFZ/record: `DEFAULT_SFZ_PARSE_LIMITS`, `parseSfz`, `parseSfzKey`, `resolveSfzZones`, `notesToScore`.
- Offline/WAV actions: `renderScoreToBuffer`, `renderScoreToWav`, `bufferToWav`. Resource lifecycle fixes are the prior Headless baseline. Independent 48kHz stereo/3-frame WAV bytes verified RIFF lengths, channels, byte rate, alignment, clipping and channel interleave.
- Note-surface mappings: `DEFAULT_CHORDS`, `DEFAULT_TR808_GRID_MAP`, `GRID_ROW_LETTERS`, `gridCellMidi`, `gridIndexToRef`, `gridKeyboardMidi`, `gridPadIndex`, `gridPadMidi`, `gridQwertyCellMidi`, `gridRefToCoords`, `gridRefToIndex`, `normalizeNoteInputLayout`, `parseGridMap`, `qwertyLabelMap`, `qwertyMidi`, `qwertyOffsetIsBlack`, `QWERTY_GRID_COLS`, `QWERTY_GRID_KEYS`, `QWERTY_GRID_ROWS`, `QWERTY_KEY_LABEL`, `QWERTY_KEY_MAP`, `QWERTY_SPAN`.

All 31 Play type exports: `SfzParseOptions`, `SfzRegion`, `SampleZone`, `RecordedNote`, `RecordToScoreOptions`, `NoteInputChord`, `NoteInputDetail`, `NoteInputLayout`, `NoteInputPad`, `RenderOptions`, `HeadlessSynth`, `OscillatorSynthOptions`, `PlayerEvents`, `PlayerOptions`, `PlayerTimeUpdate`, `ReverbOptions`, `ScorePlayerEvents`, `ScorePlayerOptions`, `SoundfontSynthOptions`, `SynthBackend`, `SynthOwnership`, `InteractivePlayerEvents`, `InteractivePlayerOptions`, `AddSourceOptions`, `AddVoiceOptions`, `AdvanceOptions`, `RackAddOptions`, `RackEvents`, `RackOptions`, `LoopPlayerOptions`, `AbPlayerOptions`. Headless-only configuration aliases add no new runtime behavior.

Four new pure Play fixes, separately owned and frozen by the subagent:

- `core/record.ts`: reject invalid PPQ/tempo/captured times/derived extent before measure allocation. PPQ 0 previously led to an infinite measure-allocation loop; guarded regressions throw if allocation begins. Zero note duration still notates at least one tick; finite nonpositive quantization still disables snapping.
- `core/sfz.ts`: independent absent `lokey`/`hikey`/`pitch_keycenter` defaults are 0/127/60, not a root-only range or root derived from the low bound. Explicit/inherited `key` shorthand remains intact; no opcode expansion.
- `core/note-input-model.ts`: reject inherited prototype keys rather than returning a function-derived string from `qwertyMidi`; downstream grid fallback remains available.
- Same file: ignore empty mapping assignments such as `a1=` instead of converting them to MIDI 0 or erasing an earlier valid mapping. Explicit zero remains valid.

View's 8 runtime exports were traced: `createPianoRollLayout`, `createStaffLayout`, `createWaterfallLayout`, `createScoreMap`, `validateScoreViewConfiguration`, `scoreToNoteSequence`, `findSequenceNote`, `secondsToQuarters`.
Its 20 types are `PianoRollNote`, `RenderedScoreVisualizer`, `ScoreMap`, `ScoreMapCell`, `ScoreMapMark`, `ScoreMapOptions`, `ScoreNoteSequence`, `ScoreSequenceNote`, `ScoreViewType`, `ScoreViewConfiguration`, `ScoreViewOptionsByType`, `StaffRenderOptions`, `StaffGlyph`, `VisualizerRenderOptions`, `ViewLayoutOptions`, `WaterfallRenderOptions`, `WaterfallNote`, `ScoreViewOptions`, `ScoreViewState`, `ScoreViewTimeRange`.
The prior Headless audit's finite geometry guards, note-sequence cache/time handling and map numeric-budget fixes remain baseline. Layouts are pure geometry; `validateScoreViewConfiguration` validates mode/key shape, while renderer owners normalize values.

New View correction: measured-cell construction omitted valid notes before, between or after supplied measures. A measure[0,4] plus note[8,9] produced duration9 but only a cell[0,4] with count0. `src/view/core/map.ts` now streams complete non-negative axis coverage in two passes, grouping measured/unmeasured spans under the same `maxCells` budget. Real measure labels remain; unmeasured spans do not invent numbers. Overlapping/nested measures coalesce, negative coverage clips at 0, and zero-width measures remain ruler marks only. Retained cell geometry is O(maxCells), not O(measures). The API barrel's incorrect claim of package-root re-export was removed. `score/api/view.mdx` describes the complete coverage contract.

The new durable regressions are [pure Play boundaries](../../../packages/score/test/play/stateless-api-boundaries.test.ts) and [View map coverage](../../../packages/score/test/view/api-map-coverage.test.ts). A manual 48 kHz/stereo/3-frame PCM probe independently produced 56 bytes, byte rate 192000, block alignment 4, data size 12 and interleaved samples `[-32768,16383,0,-16384,32767,32767]`. The supplemental session inventory/probe record is `/private/tmp/webmusic-score-stateless-play-view-review-20260910.md`.

## Primary references and version boundary

- [Humdrum keycor](https://extras.humdrum.org/man/keycor/), retrieved 2026-09-10: published Krumhansl–Kessler weights, duration histograms and Pearson rotation/ranking. The preceding 24-profile fixture uses these coefficients. No published corpus accuracy is transferred to WebMusic.
- Installed and lock-resolved Tonal versions were read directly: `@tonaljs/chord-detect` 4.9.1, `@tonaljs/chord` 6.1.2, `@tonaljs/chord-type` 5.1.1. Their local published `dist` files/source maps establish the exact implementation reviewed. [Official source](https://github.com/tonaljs/tonal/tree/main/packages/chord-detect) is a project reference, not a pinned claim about main. Versioned npm/unpkg retrieval failed during this pass; no remote snapshot is falsely claimed as inspected.
- [Open Music Theory: Inversion](https://viva.pressbooks.pub/openmusictheory/chapter/inversion/) and [Roman Numerals](https://viva.pressbooks.pub/openmusictheory/chapter/roman-numerals/), retrieved 2026-09-10: distinguish bass/inversion from chord root and explain chord-degree/quality notation. WebMusic's explicit `maj7`, flat-neighbor and omitted-figure conventions are documented local choices, not a claim to implement the textbook's entire notation scheme.
- Official SFZ specification opcode pages: [lokey](https://sfzformat.com/opcodes/lokey/), [hikey](https://sfzformat.com/opcodes/hikey/), [pitch_keycenter](https://sfzformat.com/opcodes/pitch_keycenter/), retrieved 2026-09-10 by the delegated reviewer. These establish the SFZ v1 default values used in the fix.

## Verification and remaining boundaries

Final cross-review found an additional **unresolved** pitch-basis gap: Score
algorithms and incremental sessions ignore `Part.transpose`, so stored written
pitches in mixed transposing parts are not reliable concert harmony or
cross-part voice evidence. The exact piano/B♭ clarinet reproduction and required
shared contract are recorded in the [API review](SCORE-API.md#open-transposing-instrument-contract)
and STATUS `ANALYZE-02`. This is distinct from statistical inference ambiguity.

- New Analyze file `test/analyze/api-capabilities-review.test.ts`: 22 tests, including 36 root/position combinations. Full Analyze:31 files / 498 tests passed. Log `/private/tmp/webmusic-score-api-analyze-suite-20260910.log`.
- New pure Play file `test/play/stateless-api-boundaries.test.ts`: 18 tests. Full Play:61 files / 688 tests passed; focused 6 files / 88 tests passed. Log `/private/tmp/webmusic-score-stateless-play-suite-20260910.log`.
- New View file `test/view/api-map-coverage.test.ts`: 9 tests. Full View:29 files / 308 tests passed; focused 3 files / 39 tests passed. Final test fixture explicitly supplies its required voice. Scoped Analyze, Play and View ESLint passed; root owns full repository check and docs/build gates.
- Final `npm run typecheck -w @webmusic/score`, `npx tsc -p tsconfig.test.json --noEmit`, `git diff --check`, and the 31-test Analyze/View regression rerun all passed after concurrent Pitch/React and required-voice fixture corrections. Logs: `/private/tmp/webmusic-score-api-capabilities-typecheck-20260910.log`, `/private/tmp/webmusic-score-api-capabilities-test-types-20260910.log`, `/private/tmp/webmusic-score-api-final-regressions-20260910.log`.
- Pre-fix Analyze log `/private/tmp/webmusic-score-api-analyze-before-20260910.log` includes proven failures plus two initial expectation errors: `Score.notes` excludes rests, and fret-position windows use `fretCount`, not `lastFret`. Later review corrected an expected Tonal extension alias and numeric tuning rounding. These expectation corrections are not counted as bugs.

The tests establish deterministic examples, data preservation, input boundaries and implementation consistency. They do not establish a genre-independent accuracy rate or calibrated confidence. Key weights still round each duration to 480 ticks/quarter; sub-tick note weights may disappear. Chord segmentation uses floating-point boundaries with 1e-9-quarter tolerance. Roman uses major/natural-minor pitch-class degrees and may choose `bI` for B in C minor; it does not infer harmonic-minor leading-tone function, modulation or figured bass. Voice checks reduce chords to one representative and match exact shared attacks; crossing uses mean register rather than explicit SATB roles. Motif duration equivalence does not infer phrasing across unnotated silence. Fretboard ranking is a bounded fingering heuristic, not proof of playability for every hand. SFZ is still a limited parser; note mappings assume sensible caller-selected MIDI geometry. Offline rendering, browsers, audio/MIDI devices, library packaging and external consumers are not newly accepted by this source-level API audit.
