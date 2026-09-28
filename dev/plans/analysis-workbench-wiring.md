# The wiring contract: every new surface reaches a Score/Analyze element

> Chordio design and implementation history, retained during documentation
> synchronization on 2026-09-06. Proposed steps, counts and source-line citations
> describe the recorded work; they are not the current work queue or proof that
> each proposed surface shipped. [STATUS.md](../STATUS.md) owns branch readiness,
> [DECISIONS.md](../DECISIONS.md) owns shared accepted choices, and
> [DOCUMENTATION-MAP.md](../DOCUMENTATION-MAP.md) routes to current references.
> Preserve the recorded body below when updating present-day guidance.

<!-- docs:historical-body -->

Companion to `analysis-workbench-design.md` and `analysis-workbench-implementation-brief.md`.

The design describes seven new kit surfaces. This file answers a different question, and it is the
one that decides whether any of it was worth building: **which element actually mounts which
surface, and what proves it.**

The failure this exists to prevent is specific and easy to reach. `check-architecture.mjs`'s
`30-element UI import closure` (`:1296`) compares the `ui` array in
`scripts/element-composition-policy.mjs` against the element's *static imports*. An import is not a
mount. A bare `import '@webmusic/ui/pitch';` satisfies that gate with nothing on screen — the
implementation brief even proposes exactly that as a workaround (§B2). **That escape hatch is
closed: it is not used in any commit of this series, and the test below is what closes it.**

---

## 1. The matrix

`Score Analyze` has five elements (`EXPECTED_ELEMENTS['Score Analyze'] = 5`,
`check-architecture.mjs:31`). All five end up on the same skin; only one becomes the full workbench.

| element | `ui` closure, at the end of the series | mounts | lands in |
|---|---|---|---|
| `<analysis-view>` | `analysis`, `pitch`, `harmony`, `workbench` | the shell, plus every stage and dock in §2 | **C.11** makes the closure edit; C.12 adds the two attributes |
| `<score-analysis>` | `analysis`, `workbench` | `mountWorkbench({chrome:'bare'})` around `renderSummaryCard` | C.14 |
| `<rhythm-patterns>` | `analysis`, `workbench` | `mountWorkbench({chrome:'bare'})` around `renderRhythmPatternList` | C.13 (figures) / C.14 (skin) |
| `<analysis-histogram>` | `analysis`, `workbench` | `mountWorkbench({chrome:'bare'})` around `renderHistogram` | C.13 |
| `<analysis-timeline>` | `timeline`, `harmony` | keeps `mountTimeline` (it owns seek); takes the 12-slot tone table so its colours match the workbench | C.14, and its rate≠1 seek bug is C.10a |

The `pitch` entry is **already** in that closure and already earned: `analysis-view.ts` imports
`mountKeyboard` by name and calls it at `:251`, so the row is a mount and not a declaration. The
rest arrive with the commits named above.

Every row is an edit to `scripts/element-composition-policy.mjs:21-25` **in the same commit as the
import that justifies it**, per `ARCHITECTURE.md:368-369` ("Changing architecture means changing a
policy table in the same commit — there is no other knob").

## 2. What `<analysis-view>` renders, per view

The stage answers "what does the whole piece look like"; the docks answer "what is sounding now"
and are byte-identical across all six views because they read one `projectSounding()`.

**Every stage is the same machine.** Since the conveyor pivot (design §5, commit `ed2b55d`) there is
no ribbon and no highlight box: `mountFlowLane` is one lane with the now-line pinned a third of the
way across and bands flowing right to left, so a reader sees the next chord approaching. A view is
not a different stage — it is a different set of **tracks** on the one lane, plus at most one pinned
companion beside it. That is what "six views, one instrument" means physically: one now-line, one
reel, one clock.

| `type` | stage — all `mountFlowLane`, differing only in its tracks | pinned beside the lane | docks open by default |
|---|---|---|---|
| `chords` | one track; band width **is** the chord's real duration, so harmonic rhythm is the picture. Second row: a sounding-notch mini piano roll (design §5.3) | — | nameplate, staff, fretboard, keyboard |
| `key` | one track of **stable key verdicts**; `weight = confidence` sets band height, so the piece's tonal narrative is a shape (§5.2) | `mountWheel` (it does not scroll, it **turns**: the detected tonic stays at twelve o'clock) + `mountChipStrip` `meter` for the 12 pitch-class weights | nameplate, staff, fretboard, keyboard |
| `roman` | **two coupled tracks plus a top band**, sharing one now-line and one reel: key band on top, function T/S/D below it (adjacent same-function segments merge into one band), numerals under that (§5.4) | — | nameplate, staff, keyboard |
| `motifs` | **one track per motif** (top 4 by occurrence, the rest folded into `+N more`), each carrying that motif's occurrence bands on real time, with its contour polyline drawn inside (§5.5) | — | nameplate, staff, keyboard |
| `voice-leading` | **one track per voice** from `buildVoiceLanes()`, drawn as a scrolling pitch polyline; an issue is a `FlowBracket` joining the two tracks it implicates — the error is drawn **on** the counterpoint, not in a table beside it (§5.6) | — | nameplate, staff (**2 columns**), keyboard |
| `live-chord` | one track, and the **only** view whose right-hand 67% is drawn EMPTY (`future: false` — no ruler, no ghost track, no ticks): four score views have a known future, this one does not, and drawing that is more honest than faking it. Left of the line, a **wake** whose band widths are how long each chord actually sounded — the old 8-chip history strip is now a timeline that grew itself. Lane units are **seconds** here, `spans: false` | `mountNameplate({emphasis:'hero'})` pinned **on** the now-line | staff, fretboard, keyboard (**nameplate dock hides** — one nameplate per screen) |

Two differences across the six, and neither is an exception — each is one dock eating a
differently-shaped projection: `voice-leading`'s `staff` dock takes **2 columns**
(`StaffState.columns = 2, activeColumn = 1`, same `mountStaff`, no new parameter), and
`live-chord` hides the `nameplate` dock.

Fretboard defaults follow the user's decision: on for `chords` / `key` / `live-chord`, off for
`roman` / `motifs` / `voice-leading`, and `show="fretboard"` / `show="-fretboard"` overrides either
way.

**What the pivot deleted from this file:** the old per-view `mountChipStrip({layout:'ribbon'|'stack'|'flow'})`
stage column. The chip strip survives — as `key`'s pinned pitch-class meter — but it is no longer any
view's stage, because a strip is a list and a list is what the pivot rejected. Correspondingly, the
six published `render*` helpers in `analysis.ts` stay **unchanged and undeprecated** (design §7.1),
which is why the old C.10 is withdrawn: there is no delegation for it to do.

## 3. The proof: `packages/score/test/analyze/element-surfaces.test.ts`

A jsdom, table-driven test that mounts each element for real and asserts the surfaces are **on
screen**, not merely imported. It lands with C.11 and grows in C.13.

It asserts against **contract-level signals**, not kit class names, so it does not re-break every
time a class is renamed:

| surface | signal it must leave in the DOM |
|---|---|
| keyboard | at least one `[data-midi]` node, and the sounding pitches carry `[data-role]` |
| staff | an `<svg>` in the staff dock, with one notehead per sounding pitch |
| fretboard | an `<svg>` in the fretboard dock, with a dot per stopped string |
| nameplate | a `[role="status"]` whose text is the chord symbol |
| flow lane | nodes matching `ANALYSIS_SPAN_SELECTOR`, with **stable band identity across ticks** — the same node for the same band on frame N and frame N+1, because a lane that rebuilds its bands restarts every transition it owns. This is the one signal that a conveyor is a conveyor rather than a list redrawn 60 times a second |
| chip strip | nodes matching `ANALYSIS_SPAN_SELECTOR` — the same contract `createAnalysisPlayhead` already follows |
| wheel | an `<svg>` plus its visually-hidden `<ol>` twin (12 items for the circle of fifths) |
| workbench | `[role="tablist"]` with six tabs for `shell="full"`; absent for `shell="bare"` |

Three assertions matter more than the rest, because each one fails *only* if a surface was imported
but never mounted:

1. **Switching `type` across all six values keeps the four docks byte-identical.** Same node count,
   same `data-role` per `data-midi`, same nameplate text. If a view re-implements a dock instead of
   reusing the projection, this is what catches it.
2. **A sounding C-sharp carries the same `data-role` on the keyboard, the staff and the fretboard
   at the same instant.** This is the design's whole thesis — one source of truth — expressed as an
   assertion rather than as a paragraph.
3. **Picking an alternate naming re-colours all four docks together.** `Cmaj7` &rarr; pick the
   alternate, and the roles change everywhere at once or the projection is not the only source.

Plus one negative, which is the actual answer to "are these really applied": **for each of the six
view types, the old hand-rolled markup is gone** — no node carries the shapes that only the
pre-workbench renderers produced.

## 4. Where this can still go wrong

- `checkWuiInternalNamespace` (`check-architecture.mjs:859`) scans `pkg.files`, which is
  `<pkg>/src` only — tests may name kit classes, sources may not. The element must reach nodes
  through `KeyboardHandle.key(midi)`, `WorkbenchHandle.dock(id)` and part tokens.
- The element layer may not `createElement` a `button`, `input`, `select`, `option`, `canvas` or
  `svg`, nor touch `.innerHTML` (`:1184-1197`). Every interactive and vector node is the kit's.
- The element may not `setProperty('--wm-…')` (`:1232-1235`); `density` and `scheme` travel as mount
  options and `data-*`, never as token writes.
- `npm run docs:build` is a separate CI job that `npm run check` does not cover. Every commit that
  touches an `.mdx` or a demo runs it too.
