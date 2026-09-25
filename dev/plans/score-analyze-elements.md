# score/analyze Web Component Expansion Plan

> **Historical snapshot, not the current work queue. Organized 2026-09-05.**
> This file preserves the original plan, source judgments, review evidence and
> subsequent implementation notes. Counts, branch descriptions, phases and
> statements about what is "current" belong to the dates recorded in the text;
> they do not define today's rules or unfinished work.
> Current work lives in [STATUS.md](../STATUS.md), accepted design in
> [DECISIONS.md](../DECISIONS.md), and document ownership in
> [DOCUMENTATION-MAP.md](../DOCUMENTATION-MAP.md).
> Use [COMPONENT-DESIGN.md](../design/COMPONENT-DESIGN.md) for new component designs;
> do not execute the old phase list directly.

## Implementation boundary addendum — 2026-09-05

The `rhythm-patterns` element shipped without the session/worker extension
proposed in original Section 2.
[rhythm-patterns at the retained source snapshot](https://github.com/mrsteamedbun/WebMusic/blob/7b8b0ee8057d4d77051a8b3fcd0dea616ac45519/packages/score/src/analyze/element/rhythm-patterns.ts)
calls core `rhythmPatterns()` directly;
[AnalysisResult / AnalysisSession](../../packages/score/src/analyze/headless/session.ts)
has no `result.rhythms`. Original Section 7 only notes that `analysis-view`'s
type union did not grow. The fuller boundary is that the delivered element
does not imply expanded session, freezer or worker contracts. This is not an
automatically approved backlog item.

On 2026-09-08, [DEC-013](../DECISIONS.md#dec-013--live-analyze-elements-and-headless-score-reports)
removed the summary, histogram and rhythmic-vocabulary Elements from this branch.
Their data functions remain available through the
[report workflow](../../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx#reports).
Later that day, [DEC-014](../DECISIONS.md#dec-014--five-task-specific-analyze-elements)
further narrowed the Element collection to five performance/practice tasks,
retiring diagnostic wrappers and generic aliases. The
[Analyze inventory](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze)
owns that current inventory. The earlier delivery notes below remain historical evidence.

Original Section 7's statement that main is frozen at five elements per
capability belongs to an earlier release snapshot. The current repository
inventory and count gate are in
[element-composition-policy.mjs](../../scripts/element-composition-policy.mjs)
and [check-architecture.mjs](../../scripts/check-architecture.mjs).

**Reliable scope:** the corrections explain which old analysis elements were
deleted, retained or replaced. They do not commit to future analysis engines
or unadopted session/worker fields.

<!-- docs:historical-body -->

---

> Goal: align with score/play by providing 3-4 responsibility categories and
> 15-20 Web Components, each of which strictly follows the framework's
> composition pattern (ARCHITECTURE.md:196):
>
> ```
> domain Headless object + @webmusic/ui presenter
>                   composed by the concrete Element class
>                               = domain Web Component
> ```
>
> This plan expands **8 existing elements into 16 elements across 4 categories**
> (retain 2, repair 6, and add 8). All 14 additions and repairs have been
> validated individually against the source for engine availability, presenter
> contracts, Score model data, and estimated effort.

---

## 1. Current State and Asset Inventory

### Compliance status of the 8 existing elements

| Element | Headless side | Presenter side | Compliance issue |
| --- | --- | --- | --- |
| `<analysis-view>` | ✅ `createAnalysisSession` + live trackers | ✅ `@webmusic/ui/analysis` render* | None (combined element and reference implementation) |
| `<live-chord>` | ✅ `createLiveChordTracker` | ✅ `renderLiveChordPanel` | None |
| `<key-detector>` | ⚠️ Element contains an inline live/one-shot/end-fallback state machine | ✅ `renderKeyView` | Orchestration should move into a headless controller |
| `<chord-timeline>` | ❌ `#refresh` calls `segmentChords` directly (`element/chord-timeline.ts:71`) | ✅ `renderChordTimeline` | Bypasses the session and loses O(edit) incremental updates |
| `<roman-analysis>` | ❌ Calls `detectKey` + `romanNumerals` directly (`:72-73`) | ✅ `renderRomanStrip` | Same issue |
| `<motif-list>` | ❌ Calls `findMotifs` directly (`:71`) | ✅ `renderMotifList` | Same issue |
| `<voice-leading>` | ❌ Calls `voiceLeading` directly (`:71`) | ✅ `renderVoiceLeadingList` | Same issue |
| `<score-analysis>` | ❌ Calls three core functions directly and merges their output itself | ❌ Hand-written `<strong>`/`<dl>` + inline `cssText` (`:61-89`) | **Least compliant element**; both sides need repair, and it has no documentation page |

### Unused assets (the strongest leverage for expansion)

- **`mountTimeline`** (`@webmusic/ui/timeline`) - **no consumers**.
  `TimelineState {duration, playhead, regions[{id,start,end,label,color,selected}]}`
  plus the `seek`/`selectRegion` binding contract is exactly the proportional,
  addressable presentation surface that analysis regions lack.
- **`mountInspector`** (`@webmusic/ui/inspector`) - used only by `<sound-font>`.
  Its tabs, summary definition list, and sticky-header table match the shape of
  `AnalysisResult` exactly.
- **`createAnalysisWorker`** (`headless/worker-client.ts`) - **no element in the
  score package uses it**; only the React hook does. Offline worker analysis is
  therefore unused by elements.
- **`rhythmPatterns`** (`core/motif.ts:220`) - the only core analysis function
  with **no element presentation at all**. It is already exported from
  `analyze/api`.

---

## 2. Target Categories and Element Inventory (16 Elements)

### Category A - Live Performance - 3 elements

> Responsibility: answer "what is being played right now" through per-note
> trackers driven by `webscore:noteon/noteoff`. These bind to a player or MIDI
> input and do not require a complete score.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<live-chord>` | Retain | `createLiveChordTracker` ✅ | `renderLiveChordPanel` ✅ | - |
| `<key-detector>` | Repair | **New** `createKeyDetectorController` | `renderKeyView` ✅ | M |
| `<key-wheel>` | Add | Shares the controller above | **New** `renderKeyWheel` | M |

**Key points for repairing `key-detector`** (confirmed by validation):

- The new controller wraps the existing `createLiveKeyTracker` +
  `detectKey(score)` and owns the live/one-shot/end-fallback state machine; the
  element becomes a pure binding layer.
- ⚠️ `createLiveKeyTracker` **intentionally has no `noteOff`** (the histogram
  only accumulates onsets). The controller should either omit `noteOff` or
  document that it is ignored.
- The snapshot must include `heard` (the number of notes heard) and a phase
  discriminator (`live`/`score`/`listening`); otherwise, the element cannot keep
  its three title branches while remaining a pure binding.
- ⚠️ **`<analysis-view>` contains a second copy of the same orchestration**
  (`analysis-view.ts:82-161`). Both locations must share the controller, or the
  refactor will still leave duplicated logic.

**Key design points for `key-wheel`**:

- Render a circle-of-fifths SVG wheel with 24 candidate keys (major and minor
  concentric rings), highlight the tonic, and map opacity to the correlation
  coefficients in the 24-entry `detectKey().scores` array. Correlations may be
  negative, so normalization requires an explicit decision.
- Derive fifths order from `NOTE_NAMES` (semitone order) using multiplication by
  7 modulo 12.
- Follow the analysis module's existing `--wm-analysis-*` variable family, not
  the `uiTokens` object.
- Position it as an alternate skin for the key view: a spatial presentation of
  fifth relationships that a bar list cannot show, not a new analysis. Also
  consider registering it as a new `<analysis-view>` `type` value.

### Category B - Harmony & Tonality - 4 elements

> Responsibility: whole-score harmonic reading - what the chords are, which
> key they are in, how they progress, and where they arrive or depart.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<chord-timeline>` | Repair | `createAnalysisSession` ✅ (binds `result.chords`) | `renderChordTimeline` ✅ | S |
| `<roman-analysis>` | Repair | Session ✅ (binds `result.key` + `result.roman`) | `renderRomanStrip` ✅ | S |
| `<modulation-track>` | Add | **New** core `keyTimeline(score, {windowQuarters})` | `mountTimeline` ✅ | M |
| `<cadence-list>` | Add | **New** core `findCadences(roman, key)` | **New** `renderCadenceList` | L |

**Session repair pattern** (shared by the four S-level repairs in categories
B/C/D):

- The template already exists in the same directory: the lazy `#session` +
  `session.update(score)` in `analysis-view.ts:183-187`. Each element needs
  approximately 6-10 changed lines.
- ⚠️ The S estimate applies only when **each element owns its own session**. The
  repository has no context/provider mechanism, so sharing a session supplied
  by a parent is out of scope.
- Multiple sessions on one page are acceptable. The WeakMap caches in
  `session.ts` (histogram/lane/motif entries) are shared at module scope, so only
  the chord sweep and Roman map remain duplicated work.
- The four repairs should share a small internal session-binding helper instead
  of creating five copies.

**`modulation-track`** (local-key path/modulation track):

- `keyTimeline` uses a duration-weighted sliding-window Krumhansl analysis,
  reuses `keyFromHistogram` (`key.ts`, currently `@internal`, so it must become a
  public API next to `chordTimeline`), merges adjacent identical keys, and uses
  confidence hysteresis to suppress flicker. Follow the sliding-window precedent
  in `summary.ts`'s `chordTimeline` (approximately 70 lines).
- Add the incremental session field `result.keyPath`. As an additive field, it
  remains compatible with worker protocol v1.
- ⚠️ Dispatching `webscore:seek` alone does nothing: the element **must also call
  `seek(seconds)` on the bound player**. `bindAnalysisPlayer` currently returns
  only an unbind function, so it needs a small extension that exposes the
  resolved player. Reuse the existing `timeMapMapping`
  (`core/time/timeline-mapping.ts`) for quarters-to-seconds conversion rather
  than implementing the conversion again.

**`cadence-list`**:

- `findCadences` performs adjacent-pair pattern matching over the existing
  `romanNumerals` output: V-to-I/i authentic, IV-to-I plagal, V-to-vi deceptive,
  and phrase-final-to-V half cadences.
- ⚠️ Normalize Roman-numeral suffixes before matching (V7 to V, Imaj7 to I,
  diminished suffixes, and so on).
- ⚠️ The Score model has **no phrase-boundary data**. The "phrase end" used for
  half cadences must be described as a heuristic based on the final segment,
  rest gaps, or bar boundaries; the specification should say "heuristic
  phrase-final."
- ⚠️ The existing presenter shows only a `beat ${startQuarters+1}` label,
  not bar numbers. Either follow the sibling components and
  use beats or have the element provide a preformatted position label.
- The L estimate is confirmed because session integration must preserve the
  update-deep-equals-from-scratch invariant, freezing, and worker structured-
  clone parity tests. It can be reduced to M by deriving cadences from Roman
  output in the element first and deferring session integration.

### Category C - Structure & Patterns - 4 elements

> Responsibility: present how a piece is constructed - recurring material,
> rhythmic vocabulary, phrase boundaries, and a navigable whole-piece map.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<motif-list>` | Repair | Session ✅ (binds `result.motifs`) | `renderMotifList` ✅ | S |
| `<analysis-timeline>` | Add | Session ✅ (pure mapping to `TimelineState`) | `mountTimeline` ✅ | S |
| `<rhythm-patterns>` | Add | `rhythmPatterns` ✅ + additive session field | **New** `renderRhythmPatternList` | M |
| `<phrase-map>` | Add | **New** core `segmentPhrases(score, {partId})` | `mountTimeline` ✅ | M |

**`<analysis-timeline>`** (whole-piece, combined-mode map):

- The `lane="chords"|"motifs"|"issues"` attribute switches lanes. Color regions
  by chord root, motif ID, or severity. Approximately 40-60 lines of pure
  mapping and pass-through binding make this the **first adopter** of
  `mountTimeline`; it also establishes the `webscore:seek {quarters, seconds}`
  event contract that categories B and C reuse.
- ⚠️ Name confusion with `<chord-timeline>` is the main risk. Documentation must
  clearly distinguish the list view (`chord-timeline`) from the proportional,
  addressable timeline (`analysis-timeline`).
- The precedent for combined modes is `<analysis-view type>` and
  `<score-view type>`, not the play family.

**`<rhythm-patterns>`**:

- Present the only analyzer without an element. A span ends at its onset plus
  the sum of the pattern durations (the same convention as `renderMotifList`).
  Rhythmic notation needs a numeric fallback for non-binary values such as
  triplets (`0.333...`).
- Touchpoints for the session field `result.rhythms`: `AnalysisResult` +
  `freezeAnalysisResult`; add a `length` option to
  `validateAnalysisWorkerOptions`; and extend the `isAnalysisResult` strict
  validation in `worker-client.ts` with `isRhythmPattern`.
- Also add `'rhythms'` to the `<analysis-view>` type union.

**`<phrase-map>`**:

- `segmentPhrases` promotes the internal rest-splitting `voiceLines()` from
  `motif.ts:166-204` to a public function and adds fermata boundaries. Add the
  session field `result.phrases`.
- ⚠️ **Fermatas are supported by the model but starved by importers**. The
  MusicXML parser does not extract fermatas (they are `<notations>` children,
  not ornaments), ABC explicitly skips decorations, and MIDI has no such
  concept. Consequently, `src=` file paths produce only rest boundaries unless
  MusicXML fermata parsing is added at the same time, which pushes the effort
  toward the high end of M. `fromJSON` and `ScoreBuilder` paths work immediately.
- ⚠️ A `mountTimeline` region click calls `selectRegion`, not `seek`. The element
  should implement `selectRegion` as seek-to-phrase-start.
- This is the **first element in the analyze area to mount an `@webmusic/ui`
  presenter**; the existing elements all use internal renderers. Expect a small
  amount of first-adopter glue for style injection and the `part` attribute
  pipeline.

### Category D - Craft & Overview - 5 elements

> Responsibility: evaluate and summarize the whole score - rule checking,
> statistical profiles, and at-a-glance reports for documentation, dashboards,
> and teaching.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<voice-leading>` | Repair | Session ✅ (binds `result.issues`) | `renderVoiceLeadingList` ✅ | S |
| `<analysis-view>` | Retain | Session + live trackers ✅ | render* by type ✅ | - |
| `<score-analysis>` | Repair | **New** `createScoreReport` | **New** `renderSummaryCard` | M |
| `<analysis-inspector>` | Add | Session ✅ / `createAnalysisWorker` ✅ | `mountInspector` ✅ | S |
| `<analysis-histogram>` | Add | **New** core `distributions(score)` | **New** `renderHistogram` | M |

**Repairing `<score-analysis>`** (both sides):

- Headless side: `createScoreReport` combines `summarizeScore` with the session's
  key/chords into one plain-data `ReportState` (approximately `ScoreSummary` +
  `KeyResult` + `chordSegmentCount`). Design decision: accept a Score and create
  an internal session, or accept an `AnalysisResult` and compose an external
  session. Keep the field-parity convention with `useScoreAnalysis` from
  `@webmusic/score/react` in mind.
- Presenter side: `renderSummaryCard` promotes the hand-written `<dl>` container
  into a published presenter while continuing to use the existing
  `appendSummaryRow` internally. Match the visual language of
  `renderAudioAnalysisCard`. **Add the missing documentation page** after the
  repair.

**`<analysis-inspector>`** (developer/power-user surface):

- Provide Summary, Key, Chords, Motifs, and Issues tabs. A Boolean `worker`
  attribute selects `createAnalysisWorker`, making this the **first element in
  the score package to adopt the worker client**. The audio package has a
  parallel precedent in `packages/audio/src/analyze/element/`.
- ⚠️ Tables in `mountInspector` **cannot be sorted** (`InspectorState` has no
  sorting concept and headers have no click hooks). Do not promise sorting in
  the specification, or track it separately as a small presenter extension.
- Include Roman data as a column in the Chords tab because their indices align,
  or add a sixth tab. The Summary tab additionally calls `summarizeScore`.
- Existing template: `<sound-font>` in the play area (approximately 130 lines,
  using the same presenter and shape).
- Preempt the question "why not extend `analysis-view`?": this is a developer-
  oriented table view and the only option for offline worker analysis, whereas
  `analysis-view` is a page-oriented visualization.

**`<analysis-histogram>`** (statistical profile, combined-mode element):

- `type="pitch-class"|"intervals"|"durations"` selects pitch-class distribution
  (export the existing duration-weighted histogram from `key.ts`), melodic-
  interval distribution, or duration distribution.
- ⚠️ For intervals, use the **exported** `buildVoiceLanes` used by voice leading,
  not the private `voiceLines()` in `motif.ts`. They use different chord-
  collapsing rules (first versus highest); choose one and document it.
- ⚠️ Group durations with exact Rational keys
  (`duration.quarters.toString()`), converting to floating point only for
  display. `motif.ts` documents how floating-point keys split equivalent
  triplets by onset.
- Use a stateless API layer (`analyze/api`), not the session or worker. The
  effort is therefore **M, not L** (revised after validation).
- Accepted design tension: this area gains a second combined element with a
  `type` switch. `analysis-view` is session/player-driven, whereas the histogram
  is a static one-shot view, so their responsibilities remain distinct.

---

## 3. Implementation Order

**Phase 1 - Compliance (add no new tags; make all 8 existing elements
"composed" first)**

1. Repair the four session users: `chord-timeline`, `roman-analysis`,
   `motif-list`, and `voice-leading` (S x 4, sharing one internal helper, in one
   commit).
2. Add `createKeyDetectorController` and refactor `key-detector`, while **also
   replacing the duplicated orchestration in `analysis-view`** (M).
3. Add `createScoreReport` + `renderSummaryCard`, refactor `score-analysis`, and
   add its documentation page (M).

**Phase 2 - S-level quick wins (both engine and presenter already exist)**

4. Add `<analysis-timeline>` as the first `mountTimeline` adopter; establish the
   `webscore:seek` contract and make the small player-binding extension that
   exposes the player. Every later M item reuses it.
5. Add `<analysis-inspector>` as the first adopter of `mountInspector` and the
   worker client.

**Phase 3 - M-level items (build one new side, ordered by reuse chain)**

6. Add `<rhythm-patterns>` (the core function exists and needs only a small
   presenter; use it to establish the four-file pattern for additive session
   fields).
7. Add `<modulation-track>` and `<phrase-map>` (small core functions that reuse
   Phase 2's timeline mapping and seek pipeline).
8. Add `<key-wheel>` (reuse the Phase 1 controller and add the new wheel
   presenter).

**Phase 4 - Finish the larger items**

9. Add `<analysis-histogram>` (export the `key.ts` histogram and add the
   `renderHistogram` bar-distribution primitive, which also fills the same gap
   on the audio side).
10. Add `<cadence-list>` (new core algorithm + new presenter). To move it
    earlier, first implement the M version derived in the element and defer
    session integration.

**Fixed touchpoints for each additive session field
(`rhythms`/`keyPath`/`phrases`/`cadences`)**:

core function -> `session.ts` (calculation + incremental invariant) ->
`freezeAnalysisResult` -> worker protocol/client validation -> React hook
parity. All fields are additive, so worker protocol v1 does not need a version
bump.

---

## 4. Cross-Cutting Conventions

- **Keep surface contracts unchanged**: retain the `src`/`format`/`player`
  attributes, `.score` override, `webscore:*` CustomEvents, and `data-span`
  playhead hook. Existing documentation pages and the generated sidebar require
  no migration.
- **New event** `webscore:seek {quarters, seconds}`: established first by
  `analysis-timeline` and reused by `modulation-track`/`phrase-map`. The element
  must also call `seek(seconds)` directly on the player, because the player does
  not listen for the event.
- **Styles**: every new presenter uses the `--wm-analysis-*` variable family
  (black, white, gray, square corners), matching the existing vocabulary in
  `analysis.ts`.
- **Incidental cleanup** (alongside Phase 1): move the highlight styling from
  `element/internal/playhead.ts` up into `@webmusic/ui/analysis`, so the active
  state is part of the published surface rather than private inline CSS. Before
  the first release, also add the protected mount/controller hooks required by
  `ARCHITECTURE.md`.
- **Documentation**: the analyze sidebar currently uses `autogenerate`. With 16
  elements, switch it to four explicit groups matching categories A/B/C/D, as
  the play sidebar does, and rewrite the overview `index.mdx` around those
  responsibilities.

## 5. Deliberate Exclusions (Avoiding Arbitrary Component Counts)

| Candidate | Reason for exclusion |
| --- | --- |
| Tension/dissonance curves and tempo/dynamics analysis | Require entirely new mathematics and a new time-series curve presenter; both sides are L. Revisit after a curve presenter exists. |
| Two-score comparison element | No engine-layer support exists. |
| Read-only chord-layout keyboard | `note.ts` is an input surface, so the reuse benefit is marginal. |
| Context/provider shared session | The repository has no such mechanism; element-owned sessions plus module-level WeakMap caches are sufficient. |

## 6. Validation Record

All 14 additions and repairs were independently validated against the source.
Engine and presenter availability was confirmed down to file and line. Two
effort estimates were revised (`analysis-histogram` from L to M and
`score-analysis` toward the low end of M), and every correction was incorporated
into the relevant item above: the fermata importer gap, lack of sorting in
`mountInspector`, no-op `noteOff`, Rational grouping, derivation of fifths order,
and others.

The total is 16 = 2 retained + 6 repaired + 8 added, within the 15-20 target.
Every addition presents information that existing elements do not show. Three
are combined multi-mode surfaces (`analysis-timeline`, `analysis-histogram`, and
the new `analysis-view` type at no additional element cost).

---

## 7. Corrections found during implementation

This plan was written on 2026-08-17 against a capability that had eight
elements and a score/play family that had thirteen. Neither is true now, and
the corrections below are recorded rather than edited away so the reasoning
that survived stays readable next to the premises that did not.

### What shipped: five elements, not sixteen

`main` is deliberately frozen at five elements per capability. score/analyze
ended at `<analysis-view>`, `<score-analysis>`, `<analysis-timeline>`,
`<rhythm-patterns>` and `<analysis-histogram>` — one retained, one repaired
and three added, against the plan's 2 + 6 + 8.

Of the plan's inventory:

| Plan element | Outcome |
| --- | --- |
| `<analysis-view>` | Retained, as planned. |
| `<score-analysis>` | **Repaired as planned**, both sides: `createScoreReport` (`analyze/headless/report.ts`) and the published `renderSummaryCard`, plus the documentation page the capability never had. |
| `<analysis-timeline>` | **Added as planned** — first `mountTimeline` adopter, and it established `webscore:seek {quarters, seconds}` exactly as Section 4 specified. |
| `<analysis-histogram>` | **Added as planned**, over a new core `distributions()`. |
| `<rhythm-patterns>` | **Added**, and it took `<analysis-inspector>`'s seat (below). |
| `<live-chord>`, `<key-detector>`, `<chord-timeline>`, `<roman-analysis>`, `<motif-list>`, `<voice-leading>` | **Deleted** in `1747022`, not repaired. The commit's reasoning: three of the five then-shipping elements presented the same analysis result in different containers, and these six carried no attributes and no events of their own. They live on `dev` for review. |
| `<key-wheel>`, `<modulation-track>`, `<cadence-list>`, `<phrase-map>` | Never built. Their core functions (`keyTimeline`, `findCadences`, `segmentPhrases`) do not exist, and `renderKeyWheel` / `renderCadenceList` were never written. |
| `<analysis-inspector>` | **Built and reverted inside the same day**: added in `1747022`, removed in `fdaa04e` ("swap the inspector for rhythm-patterns"). Everything it showed was reachable from the other elements plus devtools, while `rhythmPatterns` was still the one core analyzer with no element at all. |

### Section 1's asset inventory is now wrong in four places

The "unused assets" list was the plan's main leverage argument. Every entry
has since moved:

- **`mountTimeline` "no consumers"** — it has three:
  `<analysis-timeline>`, score/view's `<score-map>` and audio/analyze's
  `<audio-analysis-timeline>`.
- **`mountInspector` "used only by `<sound-font>`"** — false twice over.
  `<sound-font>` was deleted in `c75de86`, and `packages/ui/src/inspector.ts`
  itself was deleted in `ad2bbff` when `main` was cut back to the eighteen
  release presenters. Every proposal in this plan that reaches for
  `mountInspector` needs that module back from `dev` first.
- **`rhythmPatterns` "the only core analysis function with no element
  presentation at all"** — `<rhythm-patterns>` closed that gap.
- **`createAnalysisWorker` "no element in the score package uses it"** —
  still true, and now more so: the element that was to fix it was the one
  that got reverted. Only `react/analysis.tsx` consumes the worker client.

### Smaller corrections

- **The compliance table in Section 1 describes a surface that no longer
  exists.** Six of its eight rows were deleted; only `<analysis-view>` and
  `<score-analysis>` remain, and `<score-analysis>` is no longer the "least
  compliant element" — it is composed.
- **Phase 2 step 5 is dead work.** It schedules `<analysis-inspector>` as
  the first adopter of both `mountInspector` and the worker client; the
  element was reverted and the presenter deleted.
- **`'rhythms'` was never added to the `<analysis-view>` type union.**
  Section 2C asks for it; the union is still
  `'key' | 'chords' | 'roman' | 'motifs' | 'voice-leading' | 'live-chord'`.
  The new element carries rhythm instead, which is why the union did not
  need to grow.
- **Section 4's documentation milestone is spent.** It plans four explicit
  sidebar groups for sixteen elements; the capability has five, and the
  sidebar is the autogenerated `elementCapability('score', 'analyze')` group
  every capability now uses.
