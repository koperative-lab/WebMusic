# score/view Web Component Expansion Plan

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

The corrections distinguish the delivered unified score-view, sheet-view,
score-map, keyboard-view and score-thumbnail, and identify unfinished Phase 1
viewport attributes, seek/noteclick behavior and inheritance hooks. These
unfinished items record the outcome of the original proposal; current design
decisions and the work queue determine whether to pursue them. The original
claim that fourteen elements passed verification does not mean fourteen
components shipped.

The old four-item presenter checklist and "package-policy does not change"
statement cannot guide current expansion. Adding a tag or public presenter
must follow the reviewed policies and verification workflow linked from
[ARCHITECTURE.md](../ARCHITECTURE.md) and
[DEVELOPMENT.md](../DEVELOPMENT.md).

**Reliable scope:** this file preserves specialized-view tradeoffs and partial
Phase 1 outcomes. It is not the current component count, complete interaction
contract, or a list of public inheritance hooks.

<!-- docs:historical-body -->

---

> Goal: align with score/play (3 groups, 19 elements) and score/analyze
> (planned as 4 groups, 16 elements). The compliance standard is the same as
> before (ARCHITECTURE.md:196):
>
> ```
> domain Headless object + @webmusic/ui presenter
>                   composed by the concrete Element class
>                               = domain Web Component
> ```
>
> This plan expands **1 existing element -> 14 elements in 3 categories**
> (1 repaired and 13 added). It is the broadest expansion of the four parts, so
> the anti-padding rule was applied most strictly. Adversarial verification
> **rejected** two initial proposals (a zero-difference duplicate and a
> composition that depended on nonexistent child elements), and one proposal
> survived only after revision. All 14 final elements rest on data that the
> Score model actually stores and importers actually populate.

---

## 0. Renderer Ownership Rule (Applies Throughout This Plan)

Following the audio-family precedent, where
`renderWaveform/SpectrogramVisualizer` remains under
`audio/src/view/render`, **score-domain renderers remain in
`packages/score/src/view/render`**. They are engines, analogous to headless
objects. Only **domain-neutral chrome** belongs in `@webmusic/ui`.

New UI presenters are mountRuler, a value-lane presenter, and mountTrackList.
Adopted presenters are mountTimeline, mountNoteSurface, mountInspector, and
stage. The element layer owns skinning, while renderers remain neutral, following
the audio-view.ts:376 precedent.

## 1. Current State

score/view has only **one** element,
`<score-view type="piano-roll|staff|waterfall">`, and ui-catalog marks it
partial. The central problem is that the element **bypasses its own headless
`createScoreView` controller** and has never composed it. Playback binding
also drops `webscore:noteoff`: every player emits it, but view's
`PlayerBindingHandlers` alone lacks the hook. Existing headless capabilities
for viewport, virtualization, and staff/part filtering have no attribute
surface.

Unused assets include `renderOSMDStaffVisualizer` (a complete engraved-score
rendering path with **no element surface**), the dormant
`PianoRollCanvasVisualizer` (implemented and tested, but absent from the
factory), the pure layout API `createPianoRollLayout` (no consumers), and
`mountTimeline` (a presenter with no consumers, shared with the analyze plan).

---

## 2. Target Categories and Element Inventory (14 Elements)

### Category A - Notation Surfaces - 6 Elements

> Responsibility: project a Score into readable notation: "what the music looks
> like." This includes one combined engine surface and specialized projection
> tags. The thin-shell pattern is accepted, as in analyze, but each shell must
> have a genuine contract difference.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<score-view>` | Repair | `createScoreView` available (currently bypassed) | `@webmusic/ui/stage` available | M |
| `<piano-roll-view>` | Add | Render factory available + promote dormant canvas renderer | stage available (shared shell) | M |
| `<staff-view>` | Add | `renderStaffVisualizer` available | stage available (shared shell) | S |
| `<waterfall-view>` | Add | `renderWaterfallVisualizer` available + **new** interactive keyboard | stage available (shared shell) | M |
| `<sheet-view>` | Add | `renderOSMDStaffVisualizer` available (the only renderer path with no element) | stage available | M |
| `<score-thumbnail>` | Add | `createPianoRollLayout` available (first consumer of the pure layout API) | stage available | S |

**`<score-view>` repair** (foundation for all downstream work, upper end of
M):

1. Compose `createScoreView` as the state backbone, moving catalog status from
   partial to composed.
2. Add the `noteOff` hook to `render/binding.ts`. That file is 38 lines, and
   headless already exposes the behavior to delegate.
3. Add attributes for headless-only capabilities:
   `viewport-start/end`, `virtualization`, and `instruments`. Today these
   are available only through the `.options` property bag.
4. Expose `seek(seconds)`. Click-to-seek dispatches
   `webscore:seek {quarters,seconds}` **and directly calls** `seek()` on the
   bound player. This contract is shared with the analyze plan.
5. Add `webscore:noteclick`. **Verified correction:** this can cover only
   piano-roll and waterfall. Staff uses the staffrender glyph layer and has no
   per-note rect. Notes outside a virtualized window have no DOM, so use event
   delegation on the SVG. The detail must identify the model note with part
   index, MIDI value, and onset for note-inspector.
6. **Expose the Score parsed from `src`.** The current `get score()` returns only
   explicit assignments. note-inspector and part-list-view depend on this fix.
7. Change `renderScore`, `renderOptions`, and `refresh` from private to
   protected. ARCHITECTURE requires subclass hooks, and every thin shell depends
   on them.
8. Dispatch click-coordinate math by type. Roll uses
   x/pixelsPerSecond; waterfall's time axis is **vertical and bottom-to-top**;
   staff is undefined and forces pixelsPerSecond to 0.

**`<piano-roll-view>`** (a dedicated piano-roll tag with two real
differences):

- `renderer="svg|canvas"`: promote the dormant
  `PianoRollCanvasVisualizer`. Its class and tests already exist; only the
  factory entry and /render export are missing.
- `color-by="none|part"`: version 1 supports only part. A
  `data-voice` attribute **does not exist**, and the view layer loses voice
  values from imported scores because note-sequence.ts:181-185 coerces
  `'P1-1'`-style IDs with `Number()`. Voice coloring therefore requires a
  voice-ID-to-part-index map and is deferred. Coloring is SVG-only because the
  canvas path uses fillRect and has no CSS hooks. CSS rules must exclude
  `.active` while preserving `--midi-velocity` opacity.
- Copy the remaining roll-specific attributes, such as pixels-per-second and
  note-height, but do not expose staff or waterfall attributes.

**`<staff-view>`** (compact staff notation, S):

- Its real difference is that `instruments` becomes a true attribute for part
  filtering; today it is available only through `.options`.
- Remove the proposed min/max-pitch attributes. The staff renderer does not read
  them, so they would be dead attributes on a specialized tag. Subclass
  ScoreViewElement directly. A shared shell base does not exist, extracting one
  would be extra work, and the Phase 1 protected hooks are sufficient.
- Data behavior: XML assigns staves explicitly; otherwise infer them with
  `midi < 60`. XML populates clefs.

**`<waterfall-view>`** (falling notes plus an **interactive keyboard**, M):

- The initial proposal was rejected because a fixed type alone is a
  zero-difference duplicate, and the repository deliberately merged
  `<simple-waterfall>` into score-view years ago (element/index.ts:9-13).
  Reversing that decision is not acceptable.
- The revised proposal has a real difference: the keyboard already rendered by
  waterfall.ts:273-321 is currently read-only rects (there is no pointer handling
  at lines 331-351). Add pointer handling that emits
  `webscore:noteon/noteoff {midi, velocity}`. This turns it into a play-along
  surface connected to the existing note-event bus, so any player, recorder, or
  `Sound.midiOut` can consume it.
- If that difference is not implemented, delete this item and keep waterfall
  only as a score-view type.

**`<sheet-view>`** (fully engraved notation through OSMD, M):

- Lazily load `serializeMusicXML`
  (io/formats/musicxml/serializer.ts:46) to bridge any input format. OSMD is an
  optional peer; when it is absent, render the descriptive error already
  produced by the engine.
- Describe MIDI degradation precisely. It is **not** missing a measure grid or barlines:
  the serializer's `measureGrid()` synthesizes barlines from TimeMap meter
  data. The actual losses are staff assignment, key signatures because MIDI
  key-signature metadata is not mapped, and clefs, which are guessed from
  average pitch. Documentation should say this and prefer XML/MXL.
- The `zoom` attribute needs an approximately five-line engine extension
  because OSMDLike does not model osmd.Zoom.
- mountStage's render callback is synchronous, while OSMD rendering is
  asynchronous. Use the supersession-guard pattern already present in
  react/views.tsx.

**`<score-thumbnail>`** (static preview, S):

- Designed for cards and lists: no player, scrolling, or virtualization. Run
  `createPianoRollLayout` once and render a fixed-aspect SVG through viewBox
  and preserveAspectRatio. The layout API has no width or pitch-crop options, so
  aspect fitting belongs at the element layer. **This minimal contract is the
  difference from piano-roll-view.**

### Category B - Navigation & Interaction - 5 Elements

> Responsibility: show where the user is in the score, move there, and interact
> with visible content through a whole-score overview, alignment ruler, change
> markers, note inspection, and part visibility.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<score-map>` | Add | **New** `createScoreMapState` (pure mapping) | `mountTimeline` available | M |
| `<signature-strip>` | Add | Thin shell over the score-map engine | `mountTimeline` available | S |
| `<score-ruler>` | Add | `TimeMap` available + **new** pure tick function | **New** `mountRuler` extracted from timeline.ts | M |
| `<note-inspector>` | Add | Phase 1 noteclick + **new** correlation/formatter | `mountInspector` available | M |
| `<part-list-view>` | Add | **New** part-filter controller | **New** `mountTrackList` | L |

**`<score-map>`** (whole-score minimap/navigation strip; renamed from
score-timeline because the original name conflicted with both play's headless
`ScoreTimeline` class and analyze's `<analysis-timeline>`):

- Display per-part note-density regions, measure ticks, a playhead, and
  click-to-seek.
- Bind the playhead to `webscore:timeupdate`, which fires every tick and is
  smooth, rather than noteon, which jumps only at note starts. Produce ticks by
  iterating `timeMap.measures` and projecting them through
  `quartersToSeconds`. Reuse `timeMapMapping` for conversion, following the
  same non-negotiable rule as the analyze plan; do not hand-roll it.
- MIDI is not inherently missing measure ticks. Meter metadata enters TimeMap
  and can produce nominal MBS. Falling back to a numeric ruler is a version 1
  choice, not a data gap, and documentation must say so.
- mountTimeline is single-lane. Version 1 uses one density lane and leaves
  multi-part swimlanes to a future presenter extension.
- Define the `webscore:seek` contract once with analyze's analysis-timeline.
  Whichever implementation lands first establishes it, and the element also
  calls `player.seek(seconds)` directly.

**`<signature-strip>`** (key, meter, and tempo-change markers, S;
**score-map must land first**):

- It is a thin shell over the score-map engine that filters three sequences,
  already expressed in seconds, into point-like TimelineRegions.
- Key-signature labels must come from `Score.keySignatures` with the original
  fifths and mode. Do not use the tonic pitch class collapsed by note-sequence,
  which cannot distinguish F-sharp major from G-flat major.
- Tempo and meter lanes always contain at least one entry because importers
  inject synthetic defaults of 120 bpm and 4/4. The specification must choose
  one of two approaches: display the initial default, or expose TimeMap's
  currently `@internal` explicit-source marker (provenance) so non-author
  defaults can be hidden.

**`<score-ruler>`** (standalone measure/beat ruler, upper end of M):

- Extract `mountRuler` from timeline.ts into `@webmusic/ui`. The ruler is
  already closure-isolated, and domain-neutral chrome belongs in UI under the
  ownership rule.
- "Aligned above the view" applies only to piano-roll. Waterfall's time axis is
  vertical and bottom-to-top. Version 1 explicitly supports horizontal roll
  views only; waterfall support must either add an orientation mode or be
  declared out of scope.
- MIDI should fall back to a seconds ruler only when its meter is the injected
  4/4 default. This requires making `isExplicitMeterEntry`
  (TimeMap.ts:104, currently `@internal`) public or exposing an equivalent
  signal.
- Cross-Shadow-DOM scroll synchronization is the most involved part of this
  item.

**`<note-inspector>`** (click a note to see all of its details, M):

- Clicking a note in any linked view opens a detail panel with spelling
  (step/alter/octave), MIDI value, measure:beat, duration and dots, voice, staff,
  velocity, tie, and grace/chord flags.
- Scope is limited to piano-roll and waterfall because staff has no per-note
  rect. It depends on Phase 1 noteclick location data and exposure of the parsed
  Score.
- Mapping a sequence index to a model Note is not trivial. The flattened
  sequence is reordered by startTime/pitch and has no note ID, so correlation
  requires part index, MIDI value, and onset tolerance. `visitMatchingNotes`
  is the precedent.
- Reuse `mountInspector`. The approximately 130-line `<sound-font>` is a
  direct model.

**`<part-list-view>`** (track-header list and part visibility, L):

- Show name, abbreviation, program, staves, and a color swatch. Provide per-part
  show/hide filtering for linked views and emit `webscore:partfilter`.
- `partInfos` contains only `{part, name}`. Read abbreviation, program, and
  staves from `score.parts`, or extend partInfos. Both approaches are small;
  choose one.
- There are two rendering paths: staff rerenders through
  `options.instruments`, while SVG roll/waterfall receives a
  `display:none` stylesheet keyed by an injected `data-instrument`.
- Cross-proposal dependencies are the instruments attribute from Phase 1 and
  the piano-roll-view `color-by` palette. If the palette is unavailable,
  provide an internal fallback.

### Category C - Performance Lanes - 3 Elements

> Responsibility: display "what is sounding and how it is being played" through
> playback-driven highlighting and per-note performance-data lanes. Every
> element uses the existing `webscore:noteon/noteoff` bus.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<keyboard-view>` | Add | `createScoreView` available (first use of dormant controller) + active set | `mountNoteSurface` available | S |
| `<velocity-lane>` | Add | `createPianoRollLayout` available | **New** value-lane presenter | M |
| `<drum-view>` | Add | **New** DrumRoll renderer variant + isDrum pipeline | stage available | L |

**`<keyboard-view>`** (passive keyboard-highlight strip, S near the S/M
boundary):

- Highlight keys from playback or MIDI input; the strip can sit beneath any
  view.
- Two paths are required. Score mode uses the `createScoreView` controller,
  whose noteOn requires startTime to match a sequence onset within about one
  microsecond; only simple-score-player events include startTime. Live sources
  such as midi-input, note-input, and step-sequencer emit only
  `{midi, velocity}`, which the controller **cannot consume**, so they use a
  plain active Set following the live-chord precedent.
- Keyboard geometry `pianoKeys` currently lives in
  `play/core/piano-keys.ts`, but **view cannot import play**. Move the geometry
  calculation to `@webmusic/ui` beside note.ts, eliminating a fourth copy at
  the same time.

**`<velocity-lane>`** (velocity bars, M):

- Display explicit, comparable per-note velocity bars aligned to the piano
  roll. The roll currently encodes velocity implicitly through opacity.
- Follow family conventions for attributes: `player=` plus the shared
  `pixels-per-second`. The repository has no `for=` precedent; use
  `view=` if a view reference is genuinely needed.
- Do not call the presenter simply `mountLane`, because timeline.ts already
  has a `lane` part and `--wm-timeline-lane-height`. Avoid the collision;
  `mountValueLane` is the suggested name.
- Data note: only MIDI carries real velocity. XML and ABC always use the
  default 80; documentation must say so.

**`<drum-view>`** (percussion-row view, L):

- Display drum-channel notes in GM-named rows over a beat grid. Percussion is
  "supported by the model but never rendered."
- The channel test is `Part.midiChannel === 9` because the model stores
  zero-based indices, **not 10**.
- The repository has no GM percussion-name table, and view cannot import
  play's note names. Add a small local table under view.
- XML unpitched notes enter the sequence using display pitch, not a GM number.
  Propagating only isDrum will still mislabel rows; documentation must prefer
  MIDI and describe XML as degraded.
- Design record: this could instead become a fourth
  `<score-view type="drum">` mode. Because it needs a new row-label sidebar
  plus beat-grid chrome, the current preference is a separate tag; make the
  final decision during implementation.

---

## 3. Rejected and Parked Items

| Item | Decision |
| --- | --- |
| `waterfall-view` (initial version) | **Retained only after revision**: fixing the type alone was a zero-difference duplicate. It entered Category A only after adding an interactive keyboard. |
| `score-workbench` | **Delete**: three of its four proposed child elements do not exist; view cannot import play because an embedded player violates layering; it is also not equivalent to React's `SimpleScoreWorkspace`, which combines player controls and multiple simultaneous views; and docs CSS already uses the tag name. It is an application-level composition, not part of /view. |
| Lyrics/dynamics/articulations/slur lanes | Data does not land: **no importer populates `Note.lyric`**. The XML parser ignores `<lyric>`, ABC skips `w:` lines, and MIDI has none. Dynamics and articulations are likewise JSON-only. This is even more conclusive than analyze's fermata lesson because not even a partial path exists. |
| Tuplet brackets and repeat/volta/rehearsal navigation | Fields are never populated because XML barlines are not parsed. |
| Separate canvas-roll tag | No presentation difference; it is exactly the piano-roll-view `renderer` attribute. |
| Piano-roll editor | /view has no Score mutation engine; editing is another capability. |
| Read-only mountSequencer rhythm grid | Presenter contract mismatch: binding requires toggle/clear/setPlaying, and full rebuild density is suitable only for step-sequencer. |
| Tempo-curve lane | No time-series curve presenter exists, matching analyze's deferred tension curve. signature-strip already presents tempo changes as markers. |
| Separate minimap tag | Fold into score-map. The absence of viewport dragging in mountTimeline is a presenter gap, not a reason to paper over it with a second element. |
| Scrub bar / MBS readout | Transport belongs to the play family through mountTransport. |
| Scroll/zoom controller or layered stage | These are real gaps, but they are infrastructure presenters rather than elements that present information. Reconsider only if Phase 3 ruler alignment requires them. |

## 4. Implementation Order

**Phase 1 - score-view compliance repair and contract foundation (no new tags)**

Compose createScoreView; add noteOff to binding; change private hooks to
protected; expose the parsed Score; add viewport, virtualization, and instruments
attributes; add `seek()` and click-to-seek; and add
`webscore:noteclick` with a location payload. All downstream work depends on
this phase.

**Phase 2 - thin shells and quick wins**

Add five elements: `piano-roll-view` (promote canvas plus color-by=part),
`staff-view`, `waterfall-view` (interactive keyboard),
`score-thumbnail`, and `keyboard-view` (move geometry to UI).

At the same time, replace view-sidebar autogeneration with three explicit groups
mirroring scorePlayGroup, add ui-catalog rows, and rewrite the overview index.mdx
by responsibility.

**Phase 3 - navigation and engraving (M-level)**

`score-map` -> `signature-strip` (depends on its engine),
`score-ruler` (extract mountRuler into UI), `sheet-view`, and
`note-inspector` (consumes Phase 1 noteclick).

**Phase 4 - L-level completion**

`velocity-lane` (new value-lane presenter), `part-list-view` (new
controller plus mountTrackList), and `drum-view` (isDrum pipeline, DrumRoll
variant, and GM table).

Every new UI presenter uses the standard integration points: ui/src module,
barrel, `--wm-*` token vocabulary, and SSR test. All elements remain under
the existing `/view/element` subpath, so `scripts/package-policy.mjs` does
not change.

## 5. Cross-Cutting Conventions

- **`webscore:seek {quarters, seconds}`**: define the contract once with the
  analyze plan. Whichever of analysis-timeline and score-map lands first defines
  the identical contract. The element also calls `player.seek(seconds)`
  directly; the player does not listen for the event.
- **`webscore:noteclick`** (added in Phase 1): detail contains part index,
  MIDI value, and onset seconds, enough to correlate a model Note. Implement
  event delegation and do not promise a rect for every note.
- **`webscore:noteoff`**: view finally consumes the event already emitted by
  play.
- **`webscore:partfilter`** (added in Phase 4): part-list-view emits it and
  linked views consume it.
- Styling: the `--wm-*` uiTokens vocabulary already names note,
  noteSelected, playhead, gridMajor, and gridMinor. Skinning stays at the element
  layer while renderers remain neutral.
- ScoreNoteSequence discards spelling, tie, and measure information. Elements
  that require notation-level data, such as note-inspector and sheet-view,
  consume Score/TimeMap directly, following the createStaffLayout precedent.

## 6. Counts and Verification Record

**14 = 1 repaired + 13 added**; S x 4, M x 8, L x 2. Category sizes are 6/5/3.

The gap from the original 15-20 target is intentional. The initial design had
15 elements; adversarial verification rejected two for the reasons in Section 3
and revision recovered one. Two parked candidates - a tempo-curve lane waiting
for a time-series presenter, and workbench as an application-level composition -
violate either the anti-padding or layering rule, so they are not being forced
into the count. play 19 / analyze 16 / view 14 are already comparable in scale.
If an importer starts populating lyrics by parsing XML `<lyric>`,
`lyrics-line` is the natural fifteenth candidate and can start as soon as the
data lands.

Verification followed the analyze plan: an independent agent checked each of
the 15 additions or repairs against source for engine and presenter
availability, importer population, effort, and overlap. Every correction is
incorporated above: zero-based drum channel, no per-note rect in staff, vertical
waterfall time axis, voice values lost through `Number()` coercion, and
provenance for synthetic default meter, among others.

---

## 7. Corrections found during implementation

Written 2026-08-17 against a capability with one element. It now has five,
`main` is frozen there, and Section 1's premises have all moved. Recorded
here rather than edited into the plan, so the reasoning stays readable.

### What shipped: five elements, not fourteen

`<score-view>` plus `<sheet-view>`, `<score-map>`, `<keyboard-view>` and
`<score-thumbnail>` (`d13a051`). Never built: `<piano-roll-view>`,
`<staff-view>`, `<waterfall-view>`, `<signature-strip>`, `<score-ruler>`,
`<note-inspector>`, `<part-list-view>`, `<velocity-lane>`, `<drum-view>`.
Three of the four that did ship were Category A/B/C items exactly as
specified; `<keyboard-view>` shipped on a different engine (below).

### Section 1 "Current State" is false in every clause

Each of these was true when written and is not now:

- **"only one element … ui-catalog marks it partial"** — five elements, and
  `ui-catalog.ts` marks `score-view` `composed`. No catalog entry uses
  `partial` any more.
- **"the element bypasses its own headless `createScoreView` controller and
  has never composed it"** — it composes it (`score-view.ts:228`). This was
  Phase 1 item 1 and it landed.
- **"Playback binding also drops `webscore:noteoff`"** — `render/binding.ts`
  carries the `noteOff` hook and tracks the sounding set, so releasing one
  note mid-chord no longer blanks its siblings. Phase 1 item 2, landed.
- **`renderOSMDStaffVisualizer` "with no element surface"**, **`mountTimeline`
  "a presenter with no consumers"**, **`createPianoRollLayout` "no
  consumers"** — all three now have shipped consumers: `<sheet-view>`,
  `<score-map>` (and two more elements), `<score-thumbnail>`.

### Phase 1 landed three of its eight items

The repair was partial, and the five that did not land are what the unbuilt
Category A/B elements were counting on:

| Phase 1 item | State |
| --- | --- |
| 1. Compose `createScoreView` | **Done** (`score-view.ts:228`). |
| 2. `noteOff` hook in `render/binding.ts` | **Done**. |
| 6. Expose the `src`-parsed Score | **Done** (`get score()`, `:183`). |
| 3. `viewport-start/end`, `virtualization`, `instruments` attributes | **Not done** — none appears in `observedAttributes`; they remain `.options`-only. |
| 4. `seek(seconds)` + click-to-seek | **Not done** on `<score-view>`. `<score-map>` established the `webscore:seek {quarters, seconds}` contract and calls `player.seek()` directly, exactly as Section 5 specified — but the consolidated view element did not gain it. |
| 5. `webscore:noteclick` | **Not done** — zero occurrences repository-wide. `<note-inspector>` depended on it. |
| 7. `renderScore` / `renderOptions` / `refresh` protected | **Not done** — still `private` (`:273`, `:278`). Every thin shell in Category A depended on these hooks, which is part of why none was built. |
| 8. Per-type click-coordinate math | **Not done** (follows from 4). |

### Presenter premises invalidated by the release-surface trim

`ad2bbff` cut `main` to eighteen presenters. This plan names four modules
that are no longer there:

- **`mountInspector`** (Section 0 "adopted presenters"; `<note-inspector>`'s
  presenter) — deleted, along with the `<sound-font>` element Section 2B
  cites as its "direct model" (deleted earlier, in `c75de86`).
- **`uiTokens`** (Section 5: "the `--wm-*` uiTokens vocabulary already
  names note, noteSelected, playhead, gridMajor, gridMinor") —
  `packages/ui/src/tokens.ts` is gone. The `--wm-*` custom properties
  themselves are still read by the presenters; only the registry object was
  removed.
- **`mountSequencer`** — the Section 3 rejection of a "read-only
  mountSequencer rhythm grid" argues from a presenter that no longer exists.
  The rejection still holds on its own terms; the citation does not.
- **`mountTrackList`** — Section 0 books it as new work this plan would
  create. audio/view built and published it first (`6c97e78`), on the
  seekable/active interaction contract; `<part-list-view>` would now *adopt*
  it and add the visibility-toggle fork.

`mountRuler` was never built, and audio/view's own corrections refuted the
premise: `mountTimeline` already derives a windowed, labelled tick scale in
its `renderRuler` closure, so a scale-only strip is that presenter with two
children hidden — the same zero-difference test this plan applied to
`waterfall-view`.

### `<keyboard-view>` shipped on a different engine

Section 2C books it as the "first use of dormant controller
[`createScoreView`]". Two corrections: `<score-view>` adopted that controller
first, in the same batch, and `<keyboard-view>` does not use it at all — it
keys on MIDI alone through an active-note tracker, which is what lets live
sources (`<note-input>`, MIDI input) light it as well as playback. The plan
predicted the constraint that forced this in the same paragraph.

Its geometry move is **half done**: `pianoKeyLayout` / `isBlackKey` now live
in `@webmusic/ui/note`, so view no longer needs play's geometry — but
`packages/score/src/play/core/piano-keys.ts` still exports `pianoKeys`, so
the fourth copy the plan wanted eliminated is still there.
