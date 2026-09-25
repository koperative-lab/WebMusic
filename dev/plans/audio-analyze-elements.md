# audio/analyze Web Component Expansion Plan

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

## Reading boundary addendum — 2026-09-05

The implementation corrections record the analysis components actually
selected and the pre-existing summary/histogram presenters. Read those before
using the original phase list's cross-plan dependency judgments. Retained
proposals for tuner, curve or inspector do not automatically become current
work.

The closing statement that every capability "now" has exactly five elements
belongs to an earlier release snapshot, not the current repository total.
See [element-composition-policy.mjs](../../scripts/element-composition-policy.mjs)
for the reviewed inventory. The original four-item presenter checklist is
also not a complete current procedure; follow
[ARCHITECTURE.md](../ARCHITECTURE.md).

**Reliable scope:** this file traces component selection and invalidated
presenter assumptions. It is not a promise of today's realtime analysis or
transcription capabilities, or a future delivery queue.

<!-- docs:historical-body -->

---

> Goal: align with score/play (3 groups, 19 elements), score/analyze (4 groups,
> 16 elements), score/view (3 groups, 14 elements), and audio/play (4 groups,
> 15 elements). The compliance criterion remains the one defined earlier
> (ARCHITECTURE.md:196).
>
> This plan covers **2 existing elements -> 16 elements across 4 categories**
> (2 fixes and 14 additions, with no unchanged elements because both existing
> elements have audited defects). All 16 items were independently verified
> against the source by agents, with zero rejections in a second consecutive
> review round.

---

## 0. Defining constraint for this family: an honest three-tier optional-peer classification

The verification pass checked every guarded import and established the final
classification:

| Tier | Members | Element specification requirement |
| --- | --- | --- |
| **Bundled** (regular bundled dependencies, not peers) | The complete peaks/loudness/onsets/key/chromagram/spectrogram chain, plus meyda, fft.js, music-tempo, and pitchy (all under `dependencies`) | No degradation story is needed |
| **Fallback + upgrade** (guarded imports in core) | tempo: essentia.js\|aubiojs -> bundled music-tempo fallback; pitch: pitchfinder\|aubiojs -> bundled pitchy fallback (guarded `await import()` + console.warn, never fails) | Document the peer upgrade and silent fallback |
| **Peer-only** (no fallback) | Transcription: @spotify/basic-pitch or @magenta/music, both requiring @tensorflow/tfjs; absence throws peerError | **Must** provide a standardized UI state with installation guidance for a missing peer |
| **Fence** (declared but never imported; no element may promise it) | webfft (interface slot only, zero imports) and realtime-bpm-analyzer (the deliberate null stub in tempo.ts:140-145) | Exclusions in Section 3, items 3 and 4 |

## 1. Current state

Two elements are crammed into one 279-line file, contrary to the repository's
one-element-per-file convention: `<audio-analysis>` (a DOM-free headless
runner that emits `webaudio:analysisdone`) and
`<audio-analysis-view>` (a result card for each metric). Both extend
HTMLElementBase. The composition gap in `<audio-analysis-view>` explains
its `partial` catalog status: pairing it with the runner requires users to
write event-forwarding JavaScript themselves.

**Important dormant assets:** `createRealtimeAnalyzer` (real-time engine,
with **zero element coverage**), `summarizeClip` (API-only),
`LoudnessResult.momentary` (always calculated, with no presenter),
the 24 candidates in `AudioKeyResult.scores` (calculated and then discarded),
`PitchTrackResult.times` (the current card discards the real timeline and
uses frame indices on the x-axis), and `transcribe()` (audio -> note events,
this family's unique signal-to-symbol bridge, with no surface).

---

## 2. Target categories and element inventory (16 elements)

### Category A - Analysis Pipeline & Inspection (3 elements)

> Responsibility: run analysis and make its output inspectable through a
> headless offline runner, a developer-facing facts table, and a one-card
> overview.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-analysis>` | Fix | `AnalysisWorkerClient` [ready] | None (an accepted behavior-only case) | S |
| `<audio-analysis-inspector>` | New | Same engine / selector binding | `mountInspector` [ready] (first audio-analyze adopter) | M |
| `<audio-clip-summary>` | New | `summarizeClip` [ready] (bundled) | **Cross-plan** `renderSummaryCard` (score P1) | S |

**`<audio-analysis>` fix:** migrate to WebMusicElement
(`own()` absorbs token/abort/dispose bookkeeping), split to one element
per file, and correct the file header and catalog (the binding is to the
worker client, not the session). **Expose tempo-engine selection:**
`AudioAnalysisOptions` currently has no tempo field
(analyze-clip.ts:18-33), so the option is unreachable throughout the
pipeline. Add the field while preserving protocol v1 compatibility.
Warning: the audio package **does not** have a worker-options validation layer
like score; options flow through directly, so do not copy score terminology.
Also correct the bundled task inventory: `summary` is **not** an element
task (it is API-only), while `features` **is** one (bundled meyda).

**`<audio-analysis-inspector>`** (a developer facts table and the
isomorphic counterpart to score's `<analysis-inspector>`; the score plan
in fact cites this package as its precedent):

- Summary/Loudness/Tempo/Key/Onsets/Pitch/Features tabs; the only honest surface
  for vector features such as MFCC is a table; include a `worker` boolean
  switch.
- Warning: **`engineUsed` does not exist** (zero matches repository-wide).
  Showing engine identity in the Tempo/Pitch tabs requires a small headless
  increment: add an engine field to the result type and carry it through the
  protocol. The specification must either declare that increment or remove the
  row. Do not promise table sorting (InspectorState has no sort support; retain
  parity with the score version).

**`<audio-clip-summary>`** (a single-card overview corresponding to
`<score-analysis>`):

- Duration, channels, sample rate, metadata, and integrated LUFS.
- Warning: record the verified boundary in both family documents. Its
  difference from the audio-play plan's `<audio-clip-inspector>` is
  **measurement vs. reporting** (the inspector never measures a signal; this
  card calculates LUFS), plus **audience and form** (a page-oriented single
  card vs. developer tabs). It is not "different data"; apart from LUFS, the
  fields overlap substantially.
- Cross-plan dependency: score plan Phase 1 creates
  `renderSummaryCard`. If this family lands first, use the existing
  `appendSummaryRow` as a transition and switch after the presenter
  arrives.

### Category B - Clip Facts & Statistics (4 elements)

> Responsibility: visualize offline, whole-clip measurements through per-metric
> cards, a momentary-loudness curve, a scalar-feature lane, and distribution
> profiles. This category introduces the **curve primitive** that both score
> plans deferred while awaiting it.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-analysis-view>` | Fix | **New** `for=` / `.source` composition binding | `renderAudioAnalysisCard` [ready] (contract fix) | M |
| `<audio-loudness-graph>` | New | `measureLoudness` [ready] (bundled, in-house BS.1770) | **New** `mountCurve` (created by this plan) | M |
| `<audio-feature-lane>` | New | `extractFeatures` [ready] (bundled meyda) | Reuse the new B2 `mountCurve` presenter | S |
| `<audio-histogram>` | New | chromagram/key scores/onset intervals [ready] | **Cross-plan** `renderHistogram` (score P4) | M |

**`<audio-analysis-view>` fix** (make it composed):

- Warning: the proposed `for="..."` selector-valued naming must follow the repository convention
  (`player=` style; the view plan has confirmed there is no existing
  `for=` precedent). Bind to an `<audio-analysis>` element or
  session through a selector-valued attribute so pairing no longer requires
  user-written event forwarding. Preserve the bare `.result` mode.
- Repair the card contract: bridge `--waa-accent/muted/track` to
  `--wm-analysis-*` (the documentation claims eight CSS variables but the
  element bridges only five; make the documentation true). Render bars for the
  24 key-candidate scores that are currently discarded. During the transition,
  reuse existing rows from `renderKeyView`, then switch when
  `renderHistogram` lands. Add `times` to the pitch-card port so
  its x-axis represents real time, and normalize onset bars by clip duration.
- Warning: the port extension is a triple
  `(times, scores, durationSec)`. AudioAnalysisResult does not carry clip
  duration; in binding mode the source supplies it, while bare mode falls back
  to the final onset.

**`<audio-loudness-graph>`** (a momentary LUFS curve with integrated
and true-peak reference lines):

- `LoudnessResult.momentary` (types.ts:28, Float32Array) is always
  calculated and currently has no presenter.
- **`mountCurve` originates here:** a domain-neutral time-series curve
  (`{times | uniform dt, values, gaps?, refLines?}`, with linear or
  logarithmic y-axis). This is exactly what the deferred tension and velocity
  curves in the two score plans need, so delivering it unlocks them in return.
  Keep it independent of quarters vs. seconds. Add the four standard
  integration touchpoints in ui.
- Warning: `momentary?` is optional because a JSON round trip loses the
  Float32Array; guard it and provide an empty state. The 0.1-second hop is an
  unexported constant; add a one-line `momentaryHopSeconds` field so a
  uniform `dt` is self-describing.

**`<audio-feature-lane>`** (a curve for one scalar Meyda feature,
`feature="rms|spectralCentroid|spectralRolloff|spectralFlatness|zcr"`):

- The specification must require a direct, single-feature
  `extractFeatures` call. Do not invoke the entire
  `analyzeAudioClip` bundle, which calculates six features plus
  unconditional peaks and loudness.
- Honesty clause: vector features such as MFCC are **not** presented by this
  element. Send tables to the inspector and chroma to the histogram. Heatmaps
  belong to the view family, and no heatmap presenter exists yet.

**`<audio-histogram>`** (a combined distribution profile,
`type="chroma|key-candidates|onset-intervals"`):

- Warning: `renderHistogram` is a **cross-plan dependency** on score plan
  Phase 4; the presenter does not currently exist. Whichever plan lands first
  creates a neutral ui primitive whose caller supplies labels and values, with
  no quarters/data-span coupling. That neutrality requirement is itself an
  inference, so record it in the contract during implementation. The other
  family then adopts it.

### Category C - Music Intelligence (6 elements)

> Responsibility: expose estimated musical facts and the signal-to-symbol
> bridge: tonality as a one-shot estimate, a spatial display, or a timeline;
> detected onset/beat timelines; melodic contour; and transcription.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-key-wheel>` | New | `detectAudioKey` [ready] (bundled, 24 candidates) | **Cross-plan** `renderKeyWheel` (score P3) | M |
| `<audio-key-track>` | New | **New** core `audioKeyTimeline` (sliding window) | `mountTimeline` [ready] | L |
| `<audio-analysis-timeline>` | New | `detectOnsets` / TempoResult.beats [ready] | `mountTimeline` [ready] | M |
| `<audio-pitch-track>` | New | `trackPitch` [ready] (fallback + upgrade) | `mountCurve` (B2, with added requirements) | M |
| `<audio-transcriber>` | New | `transcribe()` [ready] (**peer-only**) | No DOM + installation-guidance state | L |
| `<audio-transcription-view>` | New | Pure rendering of TranscriptionResult | **New** `renderNoteList` | M |

**`<audio-key-wheel>`** (the signal-domain twin of score's
`<key-wheel>`, with the same 24-candidate Krumhansl shape): share the
presenter across plans and bake the audio-specific difference, where scores may
be absent and require a fallback state, into the contract.

**`<audio-key-track>`** (the tonality and modulation path through a
recording, and the signal-domain twin of score's
`<modulation-track>`):

- Add core `audioKeyTimeline` (sliding-window chromagram, same-key
  merging, and hysteresis). Warning: use score's sliding-window
  `chordTimeline` as the design precedent because it is **existing code**.
  Do not cite score's `keyTimeline`, which is a proposal rather than code.
- Warning: clicking a mountTimeline region invokes `selectRegion`, not
  seek. Implement seek-to-region-start, as annotated for phrase-map, and adopt
  the existing `webaudio:seek {seconds, region?}` event.
- Extend the four-file extra-field touchpoints and the element task-attribute
  surface (ALL_TASKS/parseTasksAttr) together.

**`<audio-analysis-timeline>`** (an addressable timeline for detected
time events, `marks="onsets|beats|both"`):

- Warning: state the justification accurately after verification. Onsets
  **already** have a static 400-marker bar in the analysis-view onsets card.
  The difference is **interactivity, addressability, a playhead, and the
  combined beat mode**, not first-time rendering. Beats genuinely have never
  been drawn; the tempo card only prints their count.
- Warning: state the three-way boundary explicitly: the audio-play plan's
  `<audio-clip-timeline>` displays the regions and BeatGrid the clip
  **already owns**; this element displays **detected** onsets and beats; the
  view family owns signal projections.

**`<audio-pitch-track>`** (a melodic contour with a real timeline,
logarithmic frequency, and a note-name grid):

- Warning: add three requirements to the B2 `mountCurve` specification:
  log-y, gap-separated segments for silent frames, and a **per-point
  confidence/intensity channel**. Confidence coloring cannot be delivered
  without that third capability.
- Fallback + upgrade: guard `engine="pitchfinder|aubio"` and silently
  fall back with console.warn to bundled pitchy when the peer is absent. The
  element must always remain operational.

**`<audio-transcriber>`** (the family-specific signal-to-symbol bridge):

- Run `transcribe()` and emit
  `webaudio:transcribed {notes, ...}`; support
  `engine="basic-pitch|magenta-oaf"`.
- Warning: cite the correct path. Everything lives in
  `api/transcribe.ts`; analyze/transcribe.ts is a three-line facade.
- **Peer-only:** absence throws peerError; render the descriptive installation
  guidance produced by the engine. Be precise: this is the first audio-side
  example of a **planned** pattern (sheet-view is the score-side first), not a
  pattern that has already shipped.
- Assembling a Score belongs to the bridge via
  `scoreFromTranscription`. This element stops at a neutral note table
  and event and must not import bridge or score.

**`<audio-transcription-view>`** (a transcription QA table: "Did it
hear that correctly?"):

- Show note name, start/end seconds, velocity, and result-level confidence.
  Apply three honesty corrections. The bpm column actually reads
  `clip.beatGrid?.bpm ?? 120`, so label it "clip grid tempo (default
  120)" or remove it; **never** present it as detected tempo. Confidence is the
  mean note velocity, not model probability, and must be labeled accurately.
  Per-note confidence does not exist: TranscribedNote contains only
  start/end/midi/velocity.
- Preserve an independent story: bare `.result` works without a
  transcriber.

### Category D - Live Monitoring (3 elements)

> Responsibility: expose facts derived in real time from the playing signal.
> `createRealtimeAnalyzer` currently has zero element coverage.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-realtime-analysis>` | New | `createRealtimeAnalyzer` [ready] | None (behavior-only) | S |
| `<audio-tuner>` | New | Real-time pitch [ready] (bundled pitchy) | **New** `mountTuner` | L |
| `<audio-realtime-readout>` | New | RealtimeFrame [ready] | **New** `renderRealtimePanel` | M |

**`<audio-realtime-analysis>`** (a real-time headless runner that emits
`webaudio:analysisframe {frame}` for every frame):

- Warning: an unconnected source must not throw. The engine's `start()`
  throws without an AnalyserNode, so remain idle until `.source` or
  `.analyser` is assigned.
- Warning: `fft-size` **mutates a borrowed analyser**, which may conflict
  when audio-meter or audio-view reads it concurrently. Document this and
  recommend omitting the attribute when borrowing an analyser.

**`<audio-tuner>`** (an instrument tuner showing note name, cents
offset, and clarity; the flagship consumer of real-time pitch):

- Warning: `--wm-analysis-*` is **not** in the uiTokens registry. Follow
  the fallback-chain idiom from analysis.ts; do not invent a tokens.ts edit.
- Warning: there is a startup window while pitchy loads asynchronously after
  `start()`. A first frame without pitch is the **initial state**, not an
  error path. Show the "no signal" state from the beginning.

**`<audio-realtime-readout>`** (per-frame numeric readout: RMS dB,
peak dB, spectral centroid in Hz, and optional pitch):

- State the differentiation honestly. The offline loudness card already prints
  RMS/peak/LUFS values. This element differs through **per-frame real-time
  updates** plus centroid and pitch; the documentation should answer the
  duplication concern in advance.

---

## 3. Exclusions (all supported by source evidence)

| Candidate | Reason |
| --- | --- |
| Spectrogram/waveform/peaks display elements | Crosses a family boundary: signal **projection** belongs to audio/view (`<audio-view type="spectrogram">` already exists, and peaks.ts:111 explicitly says waveform rendering lives in view). analyze presents only **derived facts**. |
| MFCC/chroma heatmap lanes | No heatmap presenter exists anywhere in the repository, and a frame-grid display has spectrogram form, which belongs to view. The honest surface for vector features is an inspector table plus histogram distributions. |
| Real-time BPM element | realtime-bpm-analyzer is a declared peer that is **never imported** (the deliberate null stub at tempo.ts:140-145; AudioWorklet-only, with no offline API). The signalsmith lesson from audio-play Section 0 applies unchanged. |
| Any webfft property or promise | webfft has zero guarded imports and only an `options.backend` interface slot. An element must not expose an FFT engine switch it cannot honor. |
| Real-time key/chord detection | There is no headless support: chromagram is based on offline channels; deriving chroma from an AnalyserNode byte spectrum requires new mathematics on both sides; chords belong to the symbolic domain in score/analyze. |
| More meter/spectrum tags | Prohibited by the meter boundary established in audio-play plan Section 2D. |
| Transcription piano roll / `<audio-score-view>` | Score assembly belongs to bridge; analyze cannot import bridge or score; note-lane rendering belongs to score/view. The transcription surface stops at a neutral note table and event. |
| Loudness target/compliance badge | Adds no calculation beyond the existing loudness card; it merely compares a number to an attribute. This has the strongest risk of being a zero-difference wrapper, so wait for a real standards engine. |
| Analysis diff/edit visualization | Incremental session updates are an internal optimization, not a presentable fact. ClipEditSession belongs to the play capability and is parked there for the same reason. |
| Separate timelines for onsets and beats | Nearly zero difference; combine them through the `marks` attribute. |

## 4. Implementation order

**Phase 1 - Compliance and contract foundation (no new tags)**

1. Fix `<audio-analysis>`: WebMusicElement migration, file split, header
   and catalog corrections, and tempo-engine option plumbing.
2. Fix `<audio-analysis-view>`: selector-valued composition binding,
   a truthful `--waa-*` bridge, and the upgraded triple-port card
   contract.

Also correct the documentation table and re-export internal/base.ts.

**Phase 2 - Quick wins with both sides ready**

`<audio-clip-summary>` (transitional appendSummaryRow),
`<audio-analysis-inspector>`, `<audio-analysis-timeline>`, and
`<audio-realtime-analysis>`. Schedule
`<audio-analysis-timeline>` **after audio-play Phase 2's
`<audio-clip-timeline>`** so it can reuse that element's mountTimeline
glue and seek adoption instead of rebuilding them.

Documentation milestone: replace autogeneration in the analyze sidebar with
four explicit groups, rewrite the overview around responsibilities, and add
catalog rows.

**Phase 3 - New presenter chain, ordered by reuse**

`<audio-loudness-graph>` creates `mountCurve` ->
`<audio-feature-lane>` reuses it -> `<audio-pitch-track>` adds
the log-y/gap/confidence requirements. Gate `<audio-histogram>` and
`<audio-key-wheel>` through cross-plan coordination with score P3/P4's
renderHistogram/renderKeyWheel: whichever plan lands first creates the
presenter and the other adopts it. Then implement
`<audio-realtime-readout>` -> `<audio-tuner>`
(mountTuner).

**Phase 4 - Complete the L-sized work**

`<audio-key-track>` (new core function, four-file extra fields, and
task-attribute surface) -> `<audio-transcriber>` +
`<audio-transcription-view>` (peer-only engines, missing-peer
installation-guidance state, and lazy-loaded /transcribe subpath).

## 5. Cross-plan coordination ledger

- **Consumes** new presenters from the score/analyze plan:
  `renderSummaryCard` (P1), `renderHistogram` (P4, whose plan
  explicitly says it also fills the audio-side gap), and
  `renderKeyWheel` (P3, extended in audio for the missing-scores
  fallback).
- **Contributes** presenters created by this plan that unlock score in return:
  `mountCurve` (the key that unlocks the parked score tension/velocity
  curves), `mountTuner`, `renderRealtimePanel`, and
  `renderNoteList`. All must be domain-neutral, follow the
  `--wm-*` / analysis fallback-chain idiom, and include the four
  standard touchpoints.
- Events use the `webaudio:` prefix. Adopt
  `webaudio:seek {seconds, region?}` and add
  `webaudio:analysisframe {frame}` and
  `webaudio:transcribed {notes, ...}`.

## 6. Count and verification record

**16 = 2 fixes + 14 additions**, with no unchanged elements because both
existing elements have defects. Effort: S x 4, M x 9, L x 3. Category counts:
3/4/6/3.

The verification method matches the earlier plans: every one of the 16 items
was checked against source, each optional-peer tier was traced to the exact
guarded-import file and line, and a second consecutive review round produced
zero rejections. All corrections have been incorporated above, including the
absence of engineUsed, the unreachable tempo-option pipeline, the optional
momentary type and hop constant, the fact that an onset bar already exists and
therefore requires a differentiated description, the truth behind the bpm
column's default of 120, the three mountCurve requirements, and the mutation of
a borrowed analyser by fft-size.

Five-plan panorama: play 19 / score-analyze 16 / view 14 / audio-play 15 /
audio-analyze 16. Only audio/view remains.

---

## 7. Corrections found during implementation

Two presenter facts in Sections 2 and 5 were wrong when the work actually
started. Both are recorded here rather than edited away, because they changed
which elements were buildable in this pass.

**`renderHistogram` and `renderSummaryCard` already existed.** Section 2A books
`renderSummaryCard` as a "**Cross-plan** dependency (score P1)", Section 2B
books `renderHistogram` as a "**cross-plan dependency** on score plan Phase 4;
the presenter does not currently exist", and Section 5 lists both under
*Consumes*. Both are in fact already exported from
`packages/ui/src/analysis.ts` — `renderHistogram(bins, root, {emptyLabel,
format})` and `renderSummaryCard({title, subtitle?, rows}, root)`, alongside
`appendSummaryRow`. No cross-plan gate applied, and the transitional
`appendSummaryRow` step planned for `<audio-clip-summary>` was unnecessary:
both elements composed the published presenter directly.

**`mountCurve`, `mountTuner`, `renderKeyWheel`, `renderNoteList` and
`renderRealtimePanel` do not exist anywhere in the repository.** A
repository-wide search returns zero matches for all five — they are named only
in the plans that propose them. Section 5 lists four of them under
*Contributes*, i.e. as work this plan would create; the plan does not schedule
that presenter work as a prerequisite of its own elements, which is what made
the Category B/C/D items unbuildable without first landing new `@webmusic/ui`
primitives:

| Missing presenter | Elements that need it |
| --- | --- |
| `mountCurve` | `<audio-loudness-graph>`, `<audio-feature-lane>`, `<audio-pitch-track>` |
| `renderKeyWheel` | `<audio-key-wheel>` |
| `renderNoteList` | `<audio-transcription-view>` |
| `mountTuner` | `<audio-tuner>` |
| `renderRealtimePanel` | `<audio-realtime-readout>` |

**What shipped: five elements, not sixteen.** Phase 1's two fixes
(`<audio-analysis>`, `<audio-analysis-view>`) plus the three additions whose
presenters were already published — `<audio-clip-summary>`
(`renderSummaryCard`), `<audio-analysis-timeline>` (`mountTimeline`) and
`<audio-histogram>` (`renderHistogram`). The remaining eleven are unchanged
proposals. Presenter availability was not the only gate, though:
`<audio-realtime-analysis>` needs no presenter and remains buildable exactly
as Phase 2 describes.

**Correction to the paragraph above (2026-08-22).** It originally also
counted `<audio-analysis-inspector>` as buildable, "since it has its
presenter (`mountInspector`, exported from `packages/ui/src/inspector.ts`)".
That stopped being true the next day: `ad2bbff` cut `main` to the eighteen
presenters the release surface composes, and `packages/ui/src/inspector.ts`
was one of the seven modules deleted. Section 2A's "`mountInspector` [ready]
(first audio-analyze adopter)" reads the same way and is wrong for the same
reason. The module still exists on `dev`; on `main`, this element now needs
a presenter before it needs anything else — and its score-side twin
`<analysis-inspector>`, which Section 2A calls its isomorphic counterpart,
was itself built and reverted in `fdaa04e`.

**The panorama figures in the header and Section 6 are stale.** "play 19 /
score-analyze 16 / view 14 / audio-play 15 / audio-analyze 16" describes an
intent, not a repository: score/play had thirteen elements when this plan
was written and five from `c75de86` onward, and every capability now ships
exactly five on `main`.
