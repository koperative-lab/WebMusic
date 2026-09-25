# audio/view Web Component Expansion Plan (final plan in the six-plan series)

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

## Errata and implementation boundaries — 2026-09-05

These errata correct factual judgments in the implementation record. They do
not replace the historical proposal or authorize new components.

- **A beat axis does not depend on downbeats.** Original Section 7 rejected
  `units="beats"` as unavailable because no producer supplied
  `BeatGrid.downbeats`. That inference does not hold.
  [BeatGrid](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/packages/audio/src/core/time/BeatGrid.ts) defines downbeats
  as an optional subset marking bar starts; `secondsToBeat()` and
  `beatToSeconds()` use beats and bpm.
  [Tempo analysis](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/packages/audio/src/analyze/core/tempo.ts) produces
  ordinary beats, which
  [audio-analysis-timeline](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/packages/audio/src/analyze/element/audio-analysis-timeline.ts)
  already displays. Downbeats only add optional bar labels. The gap is
  automatic downbeat/bar detection, not unavailable beat-axis data. Whether
  a separate ruler tag is useful remains a distinct design question.
- **"All of them shipped" overstates delivery.** Original Section 7 describes
  all differentiators of the waveform/spectrogram split as delivered, but
  the original list includes `webaudio:probe {seconds, frequency, db}`. That
  event is absent from the
  [audio-view implementation](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/packages/audio/src/view/element/audio-view.ts),
  and the `audio-color-scale` binding was not delivered. The paragraph's
  named features — `peaks-src`, `annotate`, waveform attributes,
  `.frequencyData` and empty states — are a delivered subset, not acceptance
  evidence for every item in the original list.
- **Shared prerequisites landed.**
  [LiveScrollBuffer / createLiveViewController](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/packages/audio/src/view/headless/live.ts)
  and [AudioRecorder.inputAnalyser](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/packages/audio/src/play/headless/recorder.ts),
  marked absent in original Section 2, now exist and are used by
  [audio-live-view](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/packages/audio/src/view/element/audio-live-view.ts).
  The original statements describe the implementation before those additions.
- **Counts and integration steps are historical.** The closing 30-element,
  five-per-capability count describes an earlier release surface. A later
  declaration element means it no longer describes the repository total.
  Reviewed tags and import closures live in
  [element-composition-policy.mjs](../../scripts/element-composition-policy.mjs);
  the count gate is in [check-architecture.mjs](../../scripts/check-architecture.mjs).
  Original Section 5's six-item checklist was not applied retroactively as
  claimed, and Section 4's "only policy edit" cannot guide current expansion.
  Follow [DEVELOPMENT.md](../DEVELOPMENT.md) and
  [ARCHITECTURE.md](../ARCHITECTURE.md) for the current workflow rather
  than maintaining another integration checklist here.

**Reliable scope:** the original text records why the unified view survived,
why specialized tags were reduced, and parts of the implementation outcome.
It does not prove that every proposed spectrogram interaction shipped.

<!-- docs:historical-body -->

---

> The compliance criterion remains the one defined earlier
> (ARCHITECTURE.md:196). This plan covers **1 existing element -> 12 elements
> across 4 categories** (1 fix and 11 additions). All 12 items passed
> verification, producing zero rejections for a third consecutive round.
>
> **Honest count statement:** 12 is below the target range of 15-20 and below
> score/view's 14. This is an **evidence ceiling**, not an incomplete delivery.
> Notation has multiple rendering traditions (piano roll, staff, waterfall, and
> engraving), which gives score/view six notation surfaces. An audio signal has
> only **two** offline projections (waveform and spectrogram), plus real-time
> variants and one inherited matrix surface. In addition, sibling plans have
> already claimed seven naturally view-oriented jobs
> (waveform-player/clip-timeline/loop-editor in play;
> loudness-graph/pitch-track/analysis-timeline/feature-lane/histogram in
> analyze), while the Section 2D boundary prohibits the entire meter direction.
> The 15-row exclusion table in Section 3 is the workload evidence: every
> remaining candidate either lacks a data producer or fails the waterfall
> zero-difference criterion.

---

## 1. Current state

There is one 663-line
`<audio-view type="waveform|spectrogram|meter">`, one documentation page
per type, and a mixed-purpose options.mdx page. The catalog marks the element
`partial` because its geometry (zoom/offset/playhead/hitTest) bypasses
its own headless `AudioTimeline`
(view/headless/timeline.ts:28, with **zero consumers**), while the renderer
maintains parallel renderOffset bookkeeping. Other dormant assets include
`WaveformViewModel` and `SpectrogramViewModel` (exported but
never adopted), BBC-compatible `peaksFromWaveformData` (present in core
but exposed by no element), and the `draggableRegions` drag-to-create
path (implemented in render/binding.ts but never enabled). Despite the claim at
audio-view.ts:16, **no code path emits** `webaudio:regionchange`; the
documentation has drifted.

## 2. Target categories and element inventory (12 elements)

### Category A - Clip Projection Surfaces (4 elements)

> Responsibility: project the signal of a loaded AudioClip into a readable
> surface: waveform, STFT spectrogram, or feature-frame grid. Signal
> **projection** is the view charter, as established by the audio-analyze
> Section 3 boundary; derived facts remain in analyze.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-view>` | Fix | `AudioTimeline` [ready] (wire it in) | mountStage + mountMeter [ready] | M |
| `<audio-waveform-view>` | New | render/waveform [ready] + nominal VM adoption | Same engine, with element-layer styling | M |
| `<audio-spectrogram-view>` | New | `SpectrogramViewModel` [ready] (first adopter) | render/spectrogram-view [ready] | M |
| `<audio-frame-grid>` | New | **New** `FrameGridViewModel` | **New** render/frame-grid | L |

**`<audio-view>` fix** (the compatibility umbrella and gateway for all
specialized subclass tags):

1. Migrate to WebMusicElement and add protected
   renderStage/renderOptions hooks.
2. Connect element geometry to the headless `AudioTimeline`, changing
   the catalog status from `partial` to `composed`.
3. Correct the drifted `webaudio:regionchange` documentation and state
   that the waveform-view `annotate` contract will take ownership.
4. Warning: scope the rerender fix according to verification. Zoom and regions
   **already** bypass a full rebuild (audio-view.ts:207-213 and :260-263). The
   paths that actually call `stage.update()` and then
   replaceChildren are the `.options`, `.peaks`,
   `.spectrogram`, and `.clip` setters, plus color, height, and
   mode attributes. Fix only those paths.
5. Warning: bridging the `--wm-waveform` token is **not** a meter-style
   fallback chain. Canvas cannot resolve `var()`, and waveColor must pass
   through parseHexRGB for multiband coloring. The bridge must resolve the token
   with getComputedStyle before supplying it to the renderer.
6. Expose `virtualization` as an attribute. **New minimap prerequisite:**
   add setOffset and viewport read/notification hooks to
   `RenderedAudioVisualizer`; expose pan/visibleRange APIs on the element;
   and emit
   `webaudio:viewportchange {startSeconds, endSeconds}` on user pan or
   zoom.
7. `type=meter` **stays here permanently**. Section 2D prohibits new
   meter/spectrum tags, and the meter path is already pure display composition
   over ui mountMeter. Having no work to add is the conclusion.

**`<audio-waveform-view>`** (a dedicated zoomable waveform surface).
Its boundary with the audio-play plan's `<audio-waveform-player>` uses
the wording corrected during that plan's Section 2A verification:
**a bindable visualization surface** (borrowing through `player=`) vs.
self-contained transport.

Its real differences are:

1. A `peaks-src` attribute that fetches BBC audiowaveform v2 JSON and
   hydrates it through `peaksFromWaveformData`, rendering **without
   decoding audio**.
2. An `annotate` attribute that connects the dormant
   draggableRegions code and genuinely emits
   `webaudio:regionchange {regions}`. Strictly limit this to drag
   **creation**, not editing; editing remains parked. Also note that
   render/binding.ts:78 starts from an empty array, so it must first receive
   `clip.regions` as its initial value or the emitted region list will
   become disconnected from the clip.
3. A waveform-specific attribute surface:
   channel-layout/color-mode/bands/color-map/history. This dissolves the mixed
   options table in options.mdx.
4. Promotion of `.frequencyData` to a first-class property.

Warning: verification found an internal conflict in the geometry model.
render/waveform **does not consume** WaveformViewModel and calculates columns
itself. Choose **nominal adoption**: retain the VM as a parallel headless API
and leave the renderer unchanged. Score-view Section 0 already accepts a
render/ renderer as the engine, so this satisfies the compliance criterion.
Reworking the renderer around the VM would push the task to L and is out of
scope.

**`<audio-spectrogram-view>`** (a dedicated precomputed STFT surface,
where the "spectrogram element" parked by audio-play Section 3 belongs):

1. An explicit data contract: structured SpectrogramData through
   `.spectrogram` is required. view must not import analyze under policy
   `view:["core","play"]`. Render a visible empty-state prompt instead of
   today's silent blank surface.
2. A new hover-crosshair event:
   `webaudio:probe {seconds, frequency, db}`.
3. Frequency-axis labels.
4. A first-class colormap function property plus an
   `<audio-color-scale>` binding point.
5. Attribute forms of `virtualization` and `bufferScreens`.

Warning: `SpectrogramViewModel` currently has **zero consumers**. This
element is its first adopter, following the convention of crediting the use of
a dormant asset. Choose exactly **one** owner for probe and axis windowing
mathematics, either the VM or an extended renderer hitTest; do not implement
the y-to-bin mapping twice.

Also narrow the mel claim. The presenter's pixel mapping is linear, so saying
that labels "respect the frequencies array" is valid only within a linear
scale. Mel pixel mapping must be a separate increment or explicitly documented
as unsupported.

**`<audio-frame-grid>`** (an MFCC/chroma feature-matrix heatmap, the
frame-grid surface explicitly assigned to view by audio-analyze Section 3):

- Its real differences from a spectrogram are a discrete category axis
  (`.rowLabels` for 12 pitch classes or coefficient indices), row/global
  normalization modes, and no logarithmic-frequency or dB semantics. Data
  enters through the structured
  `.frames {times, values[frame][row]}` property, mirroring
  `.spectrogram` so view need not import analyze.
- Warning: `packColormap` is **module-private** in
  spectrogram-view.ts. Move about 15 lines to view/core/colormaps.ts and share
  them between both renderers. Correct the windowing reference to
  `AudioTimeline.visibleRange -> visibleTimeRange`, not the pair of
  waveform-column functions.

### Category B - Live Projection (2 elements)

> Responsibility: render a scrolling time-axis projection from a borrowed
> AnalyserNode. Record this Section 2D reconciliation in both family documents:
> instantaneous level/spectrum **readouts** remain the two modes of
> `<audio-meter>`, with no new meter tags; these two elements render
> historical time-axis **projections** of a signal, which is view's charter.
> Follow the borrowing idiom: never own or dispose the analyser.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-live-spectrogram>` | New | **New shared work** in `view/headless/live.ts` | New append-scroll canvas core | L |
| `<audio-live-waveform>` | New | Same shared work | Reuse the same core | M |

- Warning: verification confirmed that
  `view/headless/live.ts` / LiveScrollBuffer **does not exist in the
  repository**. Mark this as NEW shared work and follow the "first implementer
  builds it" ledger convention from audio-analyze Section 5. Whichever element
  lands first creates live.ts and the append-scroll canvas core; the other adds
  its projection. If either element is cut, the survivor bears the shared work
  alone and remains M/L.
- State the live-spectrogram difference relative to the **existing**
  `<audio-view type="spectrogram">`, which requires precomputed data at
  :419-421. Share the packColormap extraction from A4.
- Warning: the live-waveform recording-companion story must **declare an
  increment**. `AudioRecorder` keeps its analyser in a private field and
  exposes no getter (recorder.ts:39). Coordinate with the audio-play plan's
  `<audio-clip-recorder>` fix to add a public getter and record it in the
  cross-plan ledger.
- Time-domain frames from getByteTimeDomainData have no dB mapping. Design the
  shared core interface around the two different frame types.

### Category C - Navigation & Alignment (3 elements)

> Responsibility: show where the user is in a clip and let them move there:
> a static thumbnail for lists, a viewport brush that drives a bound view, and
> a ruler aligned with a bound view.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-clip-thumbnail>` | New | Coarse `AudioPeaks` layer [ready] | **Cross-plan** mountWaveformTrack (transitional custom drawing) | S |
| `<audio-minimap>` | New | AudioTimeline + VM [ready] + audio-view increment | **Viewport-brush extension** to waveform-track (owned by this plan) | L |
| `<audio-ruler>` | New | AudioTimeline + BeatGrid [ready] | **Cross-plan** `mountRuler` (score-view P3 extraction) | M |

- **Thumbnail** (the twin of score-thumbnail): static, noninteractive, and
  fit-to-width. Warning: the element must provide fitting by calculating
  pixelsPerSecond and recalculating it on resize because the renderer cannot do so.
  Describe it as "each draw reads one coarse layer", not O(1). State the
  difference relative to the **existing** `<audio-view>`. Following the
  mountCurve precedent, add this element's requirements to the audio-play
  mountWaveformTrack specification.
- **Minimap** (the twin of score-map): a whole-clip overview with a draggable
  and resizable viewport brush that navigates a bound view.
  `webaudio:viewportchange` is **bidirectional**: A1 item 6 requires the
  audio-view to emit it on user pan/zoom, while dragging the minimap brush emits
  it as well. The viewport-brush extension is an unclaimed differentiator, so
  **this plan owns it** and adds the standard ui touchpoints. The specification
  must settle one of two player-resolution approaches: either the minimap owns
  `player=` or audio-view exposes its bound player.
- **Ruler** (the twin of score-ruler,
  `units="time|beats"`): correct the presenter mismatch.
  mountTimeline requires seek input and a region lane, which conflicts with a
  "thin, scale-only strip." Use the **cross-plan `mountRuler`** instead.
  Score-view P3 already needs to extract it from timeline.ts, where the closure
  is isolated. Adopt it if score-view lands first; perform the extraction if
  this family lands first. The only remaining dependency on the audio-play
  `<audio-clip-timeline>` is seek-contract glue, not presenter adoption.

### Category D - Regions & Reference Chrome (3 elements)

> Responsibility: inspect and index annotations already carried by a clip, and
> explain color encodings. Real producers populate Region data through
> loadClip, the recorder, or user code. A Region without endSeconds is a marker
> (Region.ts:41-43).

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-region-list>` | New | Pure mapping of clip.regions [ready] | **Cross-plan coordination** mountTrackList (score-view) | M |
| `<audio-region-inspector>` | New | Region event stream [ready] | Card using the appendSummaryRow idiom | S |
| `<audio-color-scale>` | New | colormap/band edges [ready] (small export) | **New** ui `mountLegend` | S |

- **Region list** (an accessibility-first index of regions and markers whose
  rows seek when clicked). Warning: correct the presenter position.
  Score-view's `<part-list-view>` already proposes mountTrackList for
  rows with swatches and inline actions. Declare this a cross-plan coordination
  point under the "first implementer builds it" ledger. The interaction
  contracts differ: active/seekable rows vs. visibility-toggle rows. Unify them
  during implementation or document an explicit fork.
- **Region inspector** (a card for the current region and the twin of
  note-inspector). Warning: complete the update mechanism.
  `webaudio:seek {seconds, region?}` includes a region only for
  interactive clicks; keyboard seeking omits it, and crossing a boundary during
  playback **does not emit seek**. Also adopt the already shipped
  `webaudio:regionenter/regionleave` events, which clip-player already
  forwards at :202-203, for real-time tracking under `player=`. Add
  regionchange for annotation updates.
- **Color scale** (a colormap legend with gradient strip and min/max labels,
  making the dB-to-color mapping visible). Warning: discrete-band mode needs a
  small view/core export for hueRGB/bandPalette, which are currently
  module-private, so hue mathematics has one source of truth.
  Assigning `.options` emits no event; observe attribute changes through
  MutationObserver and require manual refresh for property-only changes.
  Document that contract. Add **two missing standard touchpoints** for the new
  ui module: ui/package.json exports (`./legend`) and package-policy
  expectedPublicEntries. The previous five plans omitted both, so amend them
  retroactively as well.

## 3. Exclusions (15 rows of workload evidence, all source-backed)

| Candidate | Reason |
| --- | --- |
| Any new meter/spectrum tag | Explicitly prohibited by audio-play Section 2D. The view meter path is already pure display composition over ui mountMeter, so there is no work to add. |
| Waterfall/3D spectrogram | A zero-difference wrapper around the spectrogram surface. The score-view waterfall rejection is the criterion: a different drawing style is not a different contract. |
| Zoom/scroll controller or toolbar | Score-view Section 3 ruled that infrastructure presenters are not elements. The minimap brush plus setZoom covers the zoom UX. |
| `<audio-channel-list>` | Channels have no names or metadata beyond L/R; channel-layout already renders them in layers; this would be a weak twin. |
| Tempo/key-signature strip | The data is too thin: BeatGrid has one bpm and key is a single whole-clip result. Tonality display belongs to audio-analyze. |
| Loudness/pitch/onset value lanes | Already claimed by audio-analyze as loudness-graph, pitch-track, analysis-timeline, and feature-lane. The three-way boundary assigns only signal projection to view. |
| Clip editor / drag-to-edit regions | Editing is another capability, parked by both audio-play Section 3 and score-view Section 3. Loop editing belongs to `<audio-loop-editor>` in play; `annotate` is strictly limited to drag creation. |
| Waveform transport/scrubber/time readout | Audio-play already owns `<audio-waveform-player>` and mountWaveformTrack. The corrected boundary is a bindable surface in view vs. transport in play. |
| Region/BeatGrid map strip | Audio-play already owns `<audio-clip-timeline>`. The view ruler supplies only a scale, and the minimap only an overview. |
| Detected-event timeline | Audio-analyze already owns `<audio-analysis-timeline>`. |
| Transcription piano roll | Already ruled by audio-analyze Section 3: Score assembly belongs to bridge and note lanes belong to score/view. |
| A/B comparison with dual waveforms | Two side-by-side `<audio-waveform-view>` elements already provide it; composition needs no element. |
| Any webfft surface | A fenced peer with zero imports, matching audio-analyze Section 0. |
| Peak-file generator | A production tool is not a display element. The consumer side of peaksFromWaveformData is already covered by peaks-src. |
| Separate tag per channel | This is a channel-layout attribute difference with zero contract increment. |

## 4. Implementation order

**Phase 1 - Compliance (no new tags):** complete all
`<audio-view>` fixes in Section 2A items 1-7, including the viewport
API/event prerequisite for the minimap.

**Phase 2 - Specialized split + thumbnail:** waveform-view,
spectrogram-view, and clip-thumbnail. The only policy edit is to add the new
tags to expectedBrowserGlobals (package-policy.mjs:227). Begin dissolving
options.mdx into dedicated pages.

**Phase 3 - Navigation and regions:** ruler (cross-plan mountRuler), minimap
(the viewport-brush extension is built by this plan), region-list, and
region-inspector.

**Phase 4 - Inherited surface + reference chrome + documentation milestone:**
live-spectrogram/live-waveform (shared live.ts, whose first implementer builds
the core), frame-grid, and color-scale (mountLegend). Replace sidebar
autogeneration with explicit groups, add catalog rows, and place the Section 2D
reconciliation text in both family documents. Record React parity
(SpectrogramView, FrameGridView, and so on) as follow-up work; react may import
all four capabilities under policy :154.

## 5. Contract stewardship and cross-plan ledger

- **view is the origin of
  `webaudio:seek {seconds, region?}`**. Preserve that contract and honor
  play's additional `progress?` extension.
- New retained events:
  `webaudio:probe {seconds, frequency, db}`,
  `webaudio:viewportchange {startSeconds, endSeconds}` (bidirectional),
  and `webaudio:regionchange {regions}` (which finally has a real
  emitter).
- Consumes: mountWaveformTrack (audio-play), mountRuler (score-view), and
  mountTrackList (score-view coordination point).
- Contributes: the viewport-brush extension to waveform-track,
  `mountLegend`, the packColormap/hueRGB extraction, and a public
  AudioRecorder analyser getter coordinated with the audio-play recorder fix.
- **Touchpoint-list correction, applied retroactively to all six plans:** the
  fixed touchpoints for a new ui presenter are module + barrel +
  `--wm-*` token + SSR test + **ui/package.json exports +
  package-policy expectedPublicEntries**. The previous plans omitted the final
  two.

## 6. Count and verification record

**12 = 1 fix + 11 additions.** Effort: S x 3, M x 6, L x 3. Category counts:
4/2/3/3.

All 12 items passed a third consecutive verification round with zero
rejections. Every correction has been incorporated above: the choice between
two geometry models, the packColormap extraction, marking the nonexistent
live.ts as shared new work, correcting the mountTimeline-to-mountRuler
mismatch, adopting regionenter/regionleave, resolving the fact that canvas
cannot parse `var()` in the token bridge, and adding the two missing
touchpoints.

**Six-plan panorama (complete):** score/play 19 (implemented) / score-analyze
16 / score-view 14 / audio-play 15 / audio-analyze 16 / audio-view 12. The two
families total **92 Web Components**, all anchored to:

headless + @webmusic/ui presenter = Web Component.

---

## 7. Corrections found during implementation

The batch that shipped is **1 fix + 4 additions**, not the inventory above.
Three items in that inventory did not survive adversarial verification against
the source; the corrections are recorded here rather than edited into the plan,
so the reasoning that rejected them stays readable.

### `<audio-ruler>` was rejected

Section 2C item 3 already noticed the presenter mismatch and answered it with a
cross-plan `mountRuler` extraction. Verification found the premise itself was
wrong on two counts:

1. **`mountTimeline` already is the ruler.** It derives a windowed, labelled
   tick scale from its own `viewport` state — `state.ticks` when the domain
   supplies them, otherwise an even numeric ruler whose interval is derived
   from the visible span, with every tick clipped to the window and labelled
   (`ui/src/timeline.ts`, the `renderRuler` closure). A "thin, scale-only
   strip" is therefore that presenter with its region lane and its seek input
   hidden — an element whose entire contract is two children of an existing
   presenter it does not render. That is the same zero-difference test the
   score-view plan applied to `waterfall-view`, which it retained only after an
   interactive keyboard made it a different contract.
2. **`units="beats"` was vapor.** The beat axis depended on
   `BeatGrid.downbeats`, and **no non-test code in the repository writes it**.
   Every producer-side reference either preserves downbeats through a clip
   transform (`AudioClip.slice`, `ClipEditSession`) or reads them
   (`<audio-analysis-timeline>`); nothing analyses or decodes a downbeat into
   existence. Only the core tests construct one. A ruler whose distinguishing
   axis is unreachable in practice does not differ from the time axis it
   already had.

### `<audio-region-list>` took the fifth slot

It shipped from Category D, and only because the **same batch shipped its
producer**. Before `annotate`, a region list would have indexed data that
nothing in the load path creates: decoding produces no regions, no analyzer
writes any, and `clip.regions` is populated only by `createAudioClip` /
`withRegions` from user code or by a JSON round-trip. `<audio-view annotate>`
turning a drag into `webaudio:regionchange {regions}` is what gives the list a
real source, which is why it follows the *announcement* as well as `.regions`
and `.clip`. The plan's ordering (regions in Phase 3, `annotate` in Phase 2)
was right; the dependency simply has to be stated as a dependency.

It consumes `mountTrackList`, which this batch **built** rather than adopted —
the "first implementer builds it" ledger entry in Section 2D resolved in this
family's favour. The interaction contract that landed is the seekable/active
one: rows are real `<button>`s under one roving tab stop, `select(id)` is the
only command, and visibility-toggle rows remain score-view's fork to add.

### The per-type split elements were rejected

`<audio-waveform-view>` and `<audio-spectrogram-view>` (Section 2A items 2 and
3) were the same thin shell the repository already rejected for
`waterfall-view`: a tag whose whole content is a fixed `type` on an element
that already has one. Their listed differentiators were real, but none of them
needed a new tag, and all of them shipped on `<audio-view>` instead —
`peaks-src`, `annotate`, the waveform attribute surface, `.frequencyData` as a
first-class property, and the empty state that replaced the silent blank
surface for **all three** types rather than two. `<audio-frame-grid>`,
`<audio-region-inspector>`, `<audio-color-scale>` and the live pair's split
into two tags remain unbuilt; the live pair landed as one
`<audio-live-view type="waveform|spectrogram">`, on the same one-element,
two-drawings reasoning that keeps waveform and spectrogram under one
`<audio-view type>`.

### Smaller corrections

- **`webaudio:regionchange` was documented in three published pages and
  dispatched by nothing.** It now has exactly one emitter — an `annotate` drag
  — and carries the element's **whole** region list, because
  `render/binding.ts` accumulates only the regions it created and would
  otherwise announce a list that silently dropped the clip's own.
- **`virtualization` shipped as an attribute but is the spectrogram's knob.**
  The waveform renderer paints only the columns in view unconditionally, so
  there is nothing there to switch off; the documentation says so rather than
  implying a shared option.
- **The minimap owns the coupling.** Section 2C left the player-resolution
  question open; the resolution is that `<audio-minimap>` holds `view="#id"`
  and drives `visibleRange()` / `panTo()` / `setZoom()`. It never touches a
  player, and it is the only element in either family that writes another
  element's state.
- **`options.mdx` is dissolved.** Its mixed table is now the per-mode API
  tables plus the per-element pages, as Phase 2 anticipated.

### Three presenter claims Section 7 did not retract (added 2026-08-22)

The corrections above cover the elements. Three presenter statements in
Sections 2C and 5 survived them and are also wrong:

- **`mountWaveformTrack` was never built.** Section 2C books
  `<audio-clip-thumbnail>` against it as a "**Cross-plan** … (transitional
  custom drawing)" and Section 5 lists it under *Consumes*. audio/play never
  created it — that plan's `<audio-waveform-player>`, its only producer,
  was not built either. The thumbnail shipped on the published
  `mountCanvasStage` instead, which is why it needed no cross-plan gate.
- **The minimap's presenter is a module, not an extension.** Section 2C
  calls it a "**Viewport-brush extension** to waveform-track (owned by this
  plan)" and Section 5 contributes it as such. What landed is a standalone
  published presenter, `@webmusic/ui/minimap` — a DPR-aware overview canvas
  with an accessible viewport range brush — created in `de26fee`. Nothing
  was extended, because there was no waveform-track to extend.
- **`mountLegend` was never built**, so `<audio-color-scale>` still has no
  presenter and Section 5's *Contributes* entry for it is a proposal.

Two smaller ones, for the same reason:

- **Section 5's "touchpoint-list correction, applied retroactively to all
  six plans" was not applied.** Only this file carries the corrected
  touchpoint list (module + barrel + `--wm-*` token + SSR test +
  `ui/package.json` exports + package-policy `expectedPublicEntries`). The
  other five still state the four-item version.
- **Section 1's "the catalog marks the element `partial`" is out of date**
  — `ui-catalog.ts` marks `audio-view` `composed`, and the file is now
  roughly 1,100 lines rather than 663. The panorama in Section 6
  ("score/play 19 (implemented) … 92 Web Components") never described the
  repository: score/play had thirteen elements when this plan was written
  and five from `c75de86` onward. Both families ship 30.
