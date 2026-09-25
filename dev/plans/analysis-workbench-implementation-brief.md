# `<analysis-view>` harmony workbench — implementation brief

> Chordio design and implementation history, retained during documentation
> synchronization on 2026-09-06. Proposed steps, counts and source-line citations
> describe the recorded work; they are not the current work queue or proof that
> each proposed surface shipped. [STATUS.md](../STATUS.md) owns branch readiness,
> [DECISIONS.md](../DECISIONS.md) owns shared accepted choices, and
> [DOCUMENTATION-MAP.md](../DOCUMENTATION-MAP.md) routes to current references.
> Preserve the recorded body below when updating present-day guidance.

<!-- docs:historical-body -->

Companion to `dev/plans/analysis-workbench-design.md`. **This file does not restate the design.**
It records only what an implementer would otherwise get wrong: where the design is factually wrong
about this repo, what blocks a planned commit, the exact file list and gate command per commit, a
corrected commit order, and the risks.

Every fact below was re-verified against the worktree at
`/Users/mamingchen/GitHub/WebMusic/.claude/worktrees/debug-branch-db7bf5`
(branch `claude/analysis-view-chord-design-693b7b`, HEAD `086905c`). Where the seven recon reports
disagreed with each other, the line numbers here are the ones I read out of the scripts myself; the
losing citation is named so nobody re-litigates it.

**Read §0.1 first.** Five commits of this series have LANDED, twice over, from two independent
sessions working from the same starting point, and the tree this brief now describes is the
consolidation of the two.

Baseline: `check:architecture` passes (5 packages, 350 modules) · `check:docs` clean (120 pages,
31 elements) · `check:format` passes · full `npm run check` = **75.6 s and PASSES** once `.probe/`
is out of eslint's path. `npm run lint` is **red right now** — see §0.

---

## 0.1 The consolidation: what landed, and which of two implementations it is

C.3, C.4, C.5 and C.6 were each written twice — once on `claude/analysis-view-chord-design-693b7b`
and once on `claude/kind-swartz-c081f5` — from the same commit, with different code. Seven
module-by-module comparisons decided each one on evidence, and this tree is the result. **Nothing
below is a preference; each row names the property that decided it.**

| module | taken from | why, in one line |
|---|---|---|
| `analyze/core/chord-spelling.ts` | **A**, wholesale | Every disagreement the 5133-case corpus produced resolves in A's favour on musical correctness: a forced `spelling` keeps the naming's own letters (407 pitches), first-inversion major triads stay `CM/E` and do not become `Em#5`, `covers()` deletes the `Cb9sus` artifact, minor-major-seventh inversions get named at all. |
| `analyze/core/staff-placement.ts` | **A**, plus one port | A is oracle-correct on all 231 placements and 30 real key signatures, and it alone has `systemY` (B's `y` is non-monotone across the grand-staff split), the `[-7, 70]` clamp (B exhausts the heap on a corrupt step) and `keySignatureAlters` (the natural-sign rule). **Ported from B: `keyFifths`** — the UNCLAMPED circle position, because the clamped answer erases the sign and cannot seat a key past seven accidentals. |
| `analyze/core/fretboard-voicing.ts` | **A**, plus four ports | A answers 12/12 of the chord book to B's 11/12, produces **0** unholdable shapes to B's 190 of 1440, reaches the A-shape barre family B structurally cannot, and is 4.4× faster cold. **Ported from B: `Tuning.inlays`, `Tuning.frets` + the neck clamp, `tuningLabels()`, the tuning aliases** — plus `missing`, which A had no way to say. |
| `analyze/core/key-wheel.ts` | **A** base, five ports from **B** | A is right about every NUMBER — B's weights are geometry from the reference, so in ring order they are the same 24 numbers for every piece ever analysed (2 distinct vectors over 9 pieces, up to 124/276 inversions against the detector) — and A alone survives silence, a flat tie and a non-string tonic. B is right about the SHAPE the conveyor design asks for. **Ported: the ring rotation and `index`, the needle, `keyRelatedness` as its own `relatedness` field beside `weight`, `fifthsStepOf`, memoisation.** |
| `ui/src/pitch.ts`, `ui/src/internal/pitch-geometry.ts` | **B** base, eleven ports from **A** | B's extra 844 lines are the conveyor: `follow:'anchor'` with derived `data-when`, node-level diffing of noteheads and dots, the auto fret window with hysteresis, attack/sustain/release phases, ancestor-first motion, and a vertical chord box that is not 78% dead space. **See §0.2 for the eleven.** |
| `ui/src/harmony-style.ts` | **A**, wholesale | `harmonyValues.paint` and `--wui-harmony-paint`: a paint chain that ends at a colour instead of `inherit`. A `var()` substituting `inherit` is invalid at computed-value time, so `fill` paints black and `stroke` paints nothing. Independent of which `pitch.ts` won. |
| `analyze/element/analysis-view.ts` | **A**, wholesale | It **mounts** `mountKeyboard` and wires it into the live-chord tracker. B ships three presenters and a bare side-effect import, so nothing reaches the screen. |
| `test/analyze/elements.test.ts` | **A** base, four ports from **B** | A's real-`<div>` player stub catches a listener-lifetime bug B is structurally blind to, and does not go red on correct `event.target` code. **Ported: B's space-joining text reader and the three assertions it makes expressible** — without them, an element that stops re-analysing on repeated `.score` and a summary card that loses its note count both ship green — **and B's 40-line jsdom map**, with its one wrong number fixed. **Plus one new case**: the shadow-root seam, which recovers `getRootNode()` coverage honestly. |
| `test/analyze/elements-ssr.test.ts` | **B**, wholesale | Same four tests, and it saves and restores `globalThis.customElements` instead of unconditionally deleting it. |
| `dev/plans/analysis-workbench-design.md` | **B**, wholesale | The adopted conveyor pivot, and a strict superset of A's §1–§4 spine. |
| `dev/plans/analysis-workbench-wiring.md` | **A** (B has none) | The only mount-vs-import proof in either plan, and the gap it closes is live: `mountStaff` and `mountFretboard` are referenced by nothing in `packages/score/src`. |

### 0.2 The eleven ports back into `pitch.ts`, each with the defect it closes

1. **The ladder is clamped** to `[-7, 70]` in `staffPlacement`. Unclamped, `staffPlacement(1e6)` returns 499,981 ledger positions and `mountStaff` turns each into an SVG `<line>`: 4,981 nodes at diatonic 10,000, and a 4 GB heap abort at 1e7. `staffPlacement` is a published export.
2. **`columns` is a FLOOR, never a cap.** Read as an override it truncated: six marks in columns 0–5 under `columns: 3` drew three noteheads, and on a conveyor the dropped column is the one the now-line is on.
3. **The mount tail is guarded** in all three mounts: `if (destroyed || !claim.isCurrent()) return handle;`, and a teardown handed back after destruction is called rather than stored. Measured before: 1 leaked subscription.
4. **The root is named at creation.** A binding that throws on its first `snapshot()` left a `role="img"` with `aria-label: null` — an image a screen reader can neither read nor skip.
5. **An open string is a RING**, a stopped one a filled disc. The distinction every chord chart in print makes.
6. **`stringLabels` are DRAWN**, in the fixed gutter, and the position marker reads `5fr` rather than a bare `5`. They used to reach the accessible name and nowhere else.
7. **The role abbreviation is legible.** Measured in Chrome at the default board height: `font-size: 3.6` rendered at **4.33 CSS px**. The dot text and disc now carry the keyboard's own proportion, ~7.6 px.
8. **A mark the window cannot hold is not drawn.** `firstFret: 5, fretCount: 5` with a mark at fret 99 emitted `cx="1576"` into a 122-unit viewBox — clipped, but live in the DOM and counted into the accessible sentence.
9. **`weight` is spent**, through the `--wui-pitch-weight` the shared age-fade expression reads, on all three surfaces. A field the type declares and nothing reads is a promise.
10. **The token layer is declared on each root**, with `density` and `scheme` as options. §2.2 needs the compact tier, and a surface in a bare `<div>` must not depend on an ancestor for its colours.
11. **The keyboard edge is fixed in the shared `pianoKeyLayout`** — a lead/tail half-white reserve — and the mount's local root padding is **deleted**. The two are alternatives, and this is the version that reaches `<keyboard-view>` and `<note-input>`, which call the helper directly.

### 0.3 Properties carried back so the merge lost nothing

Each of these existed on the losing side of a decision and was ported rather than dropped. They are
pinned by tests in the tree, so a later commit cannot quietly undo one:

- `keyFifths` in `staff-placement.ts` — and the rule that follows it: **any "is this a flat key?" test must ask `keyFifths`, never `keySignatureFifths`**, because the clamped answer is `0` for F-flat major and `0 < 0` is false. `tuningLabels()` was rewritten onto it for exactly this reason.
- `keySignatureAlters` stayed exported, because `chord-spelling.ts` computes `SpelledPitch.accidental` from it and the losing `staff-placement.ts` had no such function anywhere on its branch.
- The key wheel keeps BOTH `weight` (evidence, min-max normalised over `KeyResult.scores`) and `relatedness` (geometry from the reference). Collapsing them leaves a dial that either cannot show a reading or cannot answer "what if it were this one instead".
- The key wheel's rotation is implemented on `pitchClassOfName` + `FIFTHS_TO_MAJOR_KEY.indexOf` — verified equal to the other implementation over all 70 spellings — so `segmentOf` still derives `fifths` and the spelling at the ABSOLUTE position. **Rotation changes the order and never a signature.**
- `@webmusic/ui`'s `staffPlacement(NaN)` answers **middle C**, matching `@webmusic/score`'s. Two modules of one name answering differently about one ladder is the drift both their headers warn about.
- `harmony-style.ts`'s `--wui-harmony-paint` and its `token-chain.test.ts` case ("never lets a PAINT bottom out at a CSS-wide keyword").
- `packages/ui/README.md`, `uikit/api.mdx:107` and `uikit/index.mdx:31` all still say **19** published subpaths, which is what the exports map holds and what `EXPECTED_UI_SUBPATHS` checks. The losing branch's prose said 18 while publishing 19.
- `check-architecture.mjs`'s `EXPECTED_UI_SUBPATHS` constant, read by both the threshold and the message, so the gate can never print "must publish exactly 19 …; found 19."
- `chords.ts`'s paragraph on `identifyChordFromMidi` disagreeing with `spellChord` on 34% of sets. **Still true** — D1 below is still open — so the warning stays until the commit that closes it.

---

---

## 0.0 What the live turn changed in this brief

The design turned after §A/§B/§C were written: the user's correction is that **listing a result is a data
concern and a web component's job is the performance** (design §0). That is a layering correction, not a
styling one, and it moves real work in this file. **Nothing in §A's drift ledger or §F's gate facts was
invalidated by it** — those were verified against the tree and are still true. What changed:

| section | change |
|---|---|
| §A.3 | **four new gate risks**: A.3.16 (`overflow: clip`, not `hidden`), A.3.17 (`internal/frame.ts` reachability and the type re-export), A.3.18 (the `outline` substring is reserved for `createAnalysisPlayhead`), A.3.19 (`scroll` default on `createPlayheadHighlighter` is pinned by a test) |
| §B | **five new blockers** B15–B19, all of them found by reading the live turn against the tree |
| §C.7 | unchanged in scope; the flow lane is **not** in it |
| **§C.7b** | **new** — one frame loop and the lane that rides it. No subpath churn: `mountFlowLane` moves into the already-registered `harmony.ts` |
| §C.9 | **shrunk to a small refactor.** The renderers adopt the shared stamp and skin; they do **not** delegate to live mounts |
| **§C.10** | **WITHDRAWN.** Design §7.1 reverses the delegation promise; there is nothing left for this commit to do |
| **§C.10a / §C.10b** | **new** — the rate≠1 seek fix, and the transport clock + live distribution tracker |
| §C.11 / §C.12 | projections now return flow-lane views; the element gains `motion` and `window` |
| **§C.13 / §C.14** | old C.13 **split**: the histogram and the rhythm figures go live in their own commit; the skin sweep is last |
| **§G** | **new section** — the other four elements, their live form, the headless boundary, and the 39-row breaking-assertion ledger |

**The single most valuable consequence, and it is a de-risking one:** design §7.1 now keeps the six
span-carrying renderers static, so `packages/ui/test/analysis.test.ts` stays green **without a character
changing** — not as a bar to clear, but as a consequence of the layering. **R1, the highest-ranked risk in
§E, is retired.**

---

## 0.4 The remaining series — nine commits

**C.7 and C.7b have LANDED** (working tree, not yet committed), salvaged from the
`kind-swartz-c081f5` worktree before it was deleted and ported onto this tree. See §0.6 for what the
port carried, what it deliberately did not, and the three-lens review that followed it. The list
below is what is left.

C.1 is **moot** (the working tree is clean; `.probe/` is gone). C.2 **landed inside C.6**:
`harmony-style.ts` is the token record — `harmonyValues`, `harmonyTokens`, `harmonyParts`,
`harmonyDensity`, `harmonyMotion.full`/`.reduced`, `harmonyScheme`, `toneFill`, `progressionTone` —
and `analysis.ts` imports it and holds **zero** hex literals. Do not re-file C.2; carry only its
unfinished residue (B11) forward. C.3, C.4, C.5 and C.6 are landed, in the consolidated form §0.1
records.

**C.10 is WITHDRAWN and must not be resurrected.** The reason is B15 — design §7.1 keeps the six
render helpers static and undeprecated — not scheduling. Its two orphaned deferrals are re-homed
below.

| # | commit | note |
|---|---|---|
| ~~—~~ | ~~`feat(ui): harmony read-outs — nameplate, chip-strip, wheel` (C.7)~~ | **LANDED.** 19→20 subpaths, all 13 sites + both ungated conventions present (§0.6.2). `internal/spans.ts` shipped with `restampActiveStyle` as a fourth rule the design did not have. **D-2** and **A.2.20 D2, D9** absorbed as planned. |
| ~~—~~ | ~~`feat(ui): one frame loop, and the lane that rides it` (C.7b)~~ | **LANDED**, with two departures from the plan below it, both deliberate: `internal/motion.ts` was **not** created — `resolveMotion` lives in `internal/frame.ts` and `pitch.ts` re-exports `MotionMode`/`FrameClock`/`FrameTick` from there, which is A.3.17's requirement met with one module instead of two — and `frame-loop.test.ts` was not created either; its rows are the first `describe` of `flow-lane.test.ts`. `internal/flow-geometry.ts` is new and unplanned: the axis, box, zone, boundary and shift arithmetic, pure and separately tested. **C.6.1 F2 (`watchReducedMotion`) did NOT land** — see §0.6.3. |
| 1 | `fix(ui): every read-out that can be pressed can be reached` (**C.7c, NEW**) | The a11y-operability half of C.7/C.7b, deferred out of the port's review rather than bolted onto it. See §0.6.4 for the six items and why they are one commit. **No subpath churn — the count stays 20.** |
| 2 | `feat(ui): the workbench is the shell every analysis view sits in` (C.8) | 20→21. Absorbs **F1** (the one debounced `role="status"`), **D-1** (host-scoped `installStyle` de-duplication — now with a measurement: three presenters sharing one host install three `<style data-webmusic-ui="harmony">`) and **C.6.1 F2**, the `watchReducedMotion` subscription C.7b did not land. Also **§0.6.6 F1 and F2**: a root holding a lane takes `createAnalysisPlayhead(root, {scroll: false})`, and `apply()`'s scroll target becomes the first NEWLY-active row rather than the first active in document order. |
| 3 | `refactor(ui): the span-carrying renderers share the stamp and the skin` (C.9) | **FOUR renderers**, not six — see C.9. Not deprecated, no delegation, no motion. Also **§0.6.6 F5**: fold `HARMONY_MOTION` and `PITCH_MOTION` into `harmonyMotion.full`/`.reduced`, which touches `token-chain.test.ts`'s `PREDECESSOR` table. |
| 4 | `fix(score): a seek at rate != 1 lands where it was clicked` (C.10a) | B17. Independent; needs only the landed jsdom harness. `seekNominal()` already exists at `score-player-scheduler.ts:240`, `score-player.ts:231` and `tone-player.ts:404`, so the fix is implementable as written. |
| 5 | `feat(score): the transport clock is arithmetic, not a DOM event` (C.10b) | B16 + B18's `createLiveDistributionTracker`. |
| 6 | `feat(score): six views, one workbench` (C.11) | Adds `element-composition-policy.mjs:21` → `['analysis','pitch','harmony','workbench']` **in-commit** (`analysis`, `pitch`, `harmony` are already there and already earned — `analysis-view.ts` mounts `mountKeyboard` and `mountNameplate`). **Also lands `element-surfaces.test.ts`** (`analysis-workbench-wiring.md` §3) and re-homed **A.2.20 D1, D3, D5**. Now also owns the twin's ORDER and CONTENT (§0.6.4 items 4 and 5), the dangling `renderLiveChordPanel` re-export (§0.6.4), and **§0.6.6 F4 and F6** — the three unimplemented §3.6.5 fields, and the first real-browser profile of the drain. |
| 7 | `feat(score): the view says how dense it is and how it moves` (C.12) | 13 attributes (`+motion`, `+window`), same order in `params/score-analyze.ts`. `observedAttributes` is `['src','format','type','player']` today. |
| 8 | `feat(score): the histogram accumulates and the figures fire` (C.13) | B18's element half. |
| 9 | `feat(score,audio): the analysis family shares one skin` (C.14) | Absorbs the orphaned **B11**, the 21-subpath prose sweep, and §0.6.4 item 6 (`confidence` / `alternate.weight` / `WheelSegment.active` — style them, voice them, or delete them from the API). |

**Optional standalone, best placed before C.7:** `fix(ui): a mount superseded during its first
update still releases its subscription`. `pitch.ts` fixed its own three tails in C.6 (§0.2 item 3),
but `status.ts` is the original of that shape and `stage.ts`, `macro.ts`, `minimap.ts`, `mixer.ts`,
`note.ts` and `transport.ts` all copied it. Audit every `mounted*` presenter.

### 0.5 Blockers and deferrals, after the consolidation

**Moot now (9).** B1 (tree clean, `.probe/` gone) · B2 (`elements.test.ts` is jsdom, 511 lines, no
`StubNode` — so the bare side-effect-import escape hatch is never needed, and the wiring doc's
"declared closed" is satisfied by `analysis-view.ts` calling `mountKeyboard`) · B3
(`elements-ssr.test.ts` exists with `// @vitest-environment node`) · B4 · B6 · B10 · B13 (C.3/C.4/C.6
landed) · **C.6.1 F3** and **C.6.2 site 6**, both false on this tree and deleted above.

**Still binding (12).** B5 (`rootDegree` NaN) · B7 (four views lack MIDI) · B8 (error phase
unplumbed) · B9 (the 43 taken `.wui-*` names — `apps/doc/shared/ui.css` declares exactly 43) ·
**B11** (`analysisStyle` is exported at `analysis.ts:60` and **never installed**; its owner C.2
landed inside C.6 without it, so re-home to C.14) · B12 (Am9-no-root) · B14 (empty copy) ·
**B15–B19**, all five confirmed against source.

**Deferrals — done (2).** D4 (`ACCIDENTAL_GLYPHS` and `toDisplayName` landed in
`staff-placement.ts`) · D6, resolved by omission: `SpelledPitch` ships neither `weight` nor
`active`. Note the KIT's `PitchMark.weight` is a different field and is now spent — §0.2 item 9.

**Deferrals — orphaned by C.10's withdrawal, re-home to C.11 (3).** **D1** —
`identifyChordFromMidi` still does not call `spellChord`, and `chords.ts` still carries the warning
paragraph saying so. **D3** — `roman.ts:47,65` still keeps a private `MAJOR_SCALE`/`MINOR_SCALE` and
there is no `scalePitchClasses` in `core/key.ts`; note that `key-wheel.ts`'s `keyPitchClasses` is
now the producer `ghostPitchClasses` needed, so D3 is a de-duplication rather than a gap. **D5** —
no `Supplies<>` contract test exists anywhere; it belongs in C.11's `ui-contract.test.ts`.

**Deferrals — still binding with owners intact (4).** ~~D2, D9 (C.7)~~ — **both landed with the
salvage port** · D7 (`MIDDLE_C_DIATONIC = 28` hard-wired, low priority) · D8 (the `+28` identity is
untested and has no owner in the remaining series — an accepted gap, recorded).

**Deferrals opened by the salvage port and its reviews (13), all owned.** Six in §0.6.4 — five to
the new **C.7c**, two of those re-homed onward to **C.11** (twin order, twin content) and one to
**C.14** (`confidence` / `alternate.weight` / `WheelSegment.active`) — plus the dangling
`renderLiveChordPanel` re-export to **C.11** (§0.6.4, last paragraph), and the salvage session's own
six (§0.6.6): **F1, F2, F3** to **C.8**, **F5** to **C.9**, **F4** and **F6** to **C.11**. F3 is
C.6.1 F2 re-inherited, counted once.

Also binding, from C.6.2: **sites 10, 15 and 14**. Site 10 is verified —
`apps/doc/webmusic/tsconfig.json` is `{extends, exclude}` with **no `include`**, so the whole of
`apps/doc/shared/` is typechecked by nothing in CI, and every future subpath registration inherits
that hole.

---

## 0.6 The salvage port: C.7 and C.7b, carried off a worktree that was deleted

C.7 and C.7b were written on `claude/kind-swartz-c081f5` and never committed there. They were
ported onto this tree as a working-tree change, not applied as a patch: their delta was a delta
against **their** consolidated base, and four files here had already diverged.

### 0.6.1 What the port had to merge rather than copy

| file | why a copy would have lost something |
|---|---|
| `packages/ui/src/pitch.ts` | Ours is theirs **plus the eleven ports of §0.2**. Their delta genuinely adds only one thing — `MotionMode`/`ResolvedMotion`/`resolveMotion` move OUT of `pitch.ts` and into `internal/frame.ts`, re-exported by name. That, and only that, was applied. |
| `packages/score/src/analyze/element/analysis-view.ts` | Theirs carried bare side-effect imports of `@webmusic/ui/pitch` and `/harmony` with a comment conceding the docks were "published but not yet wired" — the exact escape hatch `analysis-workbench-wiring.md` exists to close. Ours mounts. The port kept ours and added `mountNameplate` on top, off the same `spellChord` result, and `elements.test.ts` grew a case that asserts both mounted nodes are in the document. |
| `packages/ui/src/harmony-style.ts` | Ours, and absent from their patch entirely. `harmony.ts` reads its palette, `--wui-harmony-paint` included. |
| the ten registration sites | Each already carried OUR `pitch` registration; theirs registered `harmony` on top of THEIRS. Merged by intent, not by text. |

**Nothing was lost.** Verified at token level rather than by reading the diff: `internal/frame.ts`,
`internal/spans.ts`, `internal/flow-geometry.ts`, `harmony.test.ts` and `spans-contract.test.ts` are
byte-identical to the salvage; `flow-lane.test.ts` has **zero** tokens removed and 31 of 31 original
rows intact; `harmony.ts` loses exactly five identifiers — `chips`, `items`, `stamping`, `style`,
`cssText` — and every one is a local inlined into a memoisation guard the salvage did not have.

### 0.6.2 The 13-site registration, confirmed on this tree

All thirteen plus both ungated conventions: `src/harmony.ts` · the tsup entry string · the exports
block (`.d.ts`/`.d.cts` shapes correct) · `package-policy.mjs` · `ssr.test.ts` · `stylesheet-option.test.ts`
· `check-architecture.mjs:58` and `EXPECTED_UI_SUBPATHS = 20` (**one constant, feeding both the
condition and the message** — the salvage had reverted `cffecea`'s refactor back to two bare
literals; the landed version keeps the better shape) · `analysis-view.ts`'s **value** import
· the catalog entry · `UiPresenterName` · a real 350-line `mountHarmonyDemo` · `harmony.mdx` at
sidebar order 6 · `api.mdx` · `index.ts`'s `export *` · `element-composition-policy.mjs:21`.
Published subpaths = 20 = `EXPECTED_UI_SUBPATHS`. The prose that said 19 in four places is fixed.

### 0.6.3 Departures from the C.7b plan, and the one that is a deferral

- `internal/motion.ts` does not exist. `resolveMotion` is in `internal/frame.ts`; A.3.17's type
  re-export requirement is met from there. **Do not create the second module later** — create the
  subscription inside the first.
- `frame-loop.test.ts` does not exist. Its fifteen rows are `flow-lane.test.ts`'s opening `describe`,
  against a fake `view` exactly as specified.
- **C.6.1 F2 is still open.** `watchReducedMotion` did not land; every mount still reads the
  preference **once, at mount**. An OS toggle mid-session repaints nothing until the next mount.
  The `@media` escape in the sheet is the no-JavaScript floor and covers the sheet path only.
  **Owner: C.8**, with the shell's `data-motion`, because a shell answering for its whole subtree is
  the thing that has to hear the change first.

### 0.6.4 Deferred out of the port's three-lens review — owner C.7c unless named otherwise

Six findings, all real, none fixed in the port. They are one commit because they are one decision:
**a hidden `<ol>` twin that is the accessible representation of a surface has to carry everything
that surface says, and be operable wherever the surface is.**

1. **`selectSegment`, `selectItem` and `selectBand` are mouse-only.** The wheel's click listener is
   on a `focusable="false" aria-hidden="true"` `<svg>`; there are **zero** focusable nodes in a
   wheel or a chip mount; band nodes have no `tabindex`, no `role` and no `aria-label`. `Enter` and
   `Space` do nothing. WCAG 2.1.1. The fix is the same in all three: where a handler exists, the
   twin's entries become `<button>`s — they are already one per item and already in order.
2. **A lane without `binding.seek` has no tab stop and no live channel.** `flow-lane.test.ts`
   pins `role === null` and `tabIndex === -1` there, deliberately and with a written reason ("a
   value a reader is told about and cannot move is a promise nothing keeps"), so this is a decision
   to re-open rather than a bug to fix. The double-exposure half of it **is** fixed: the reel is
   now `aria-hidden` on both paths.
3. **The lane's `<ol>` and the nameplate's `<ul>` have no accessible name.** A reader hears
   `status "C major seventh"` and then `list, 2 items` with nothing saying these are alternative
   readings *of that*.
4. **The twin's order is the caller's array order, not the axis order** (`update()`'s
   `index.replaceChildren` runs only when `structural` or the child count changed, so retiming a
   band without adding or removing one leaves the twin stale). Geometry is unaffected —
   `flowBoundaries` sorts — so this is a twin-fidelity bug only. **Owner: C.11**, with the rest of
   the twin's content.
5. **`severity`, flags and brackets never reach AT.** Entry text is `[primary, secondary, trailing]`;
   a warning arrives as a colour and a bare `title` on a role-less `<div>`. **Owner: C.11.**
6. **Documented inputs with no effect anywhere.** `NameplateState.confidence` (written as
   `data-confidence`, read by no rule and in no text — a reading held at 31% presents identically to
   one held at 99%), `ChordNameCandidate.weight`, and `WheelSegment.active` (opacity-only, which is
   colour carrying a fact alone — the thing the lane's own `role` stripe comment forbids). **Owner:
   C.14**, with the skin sweep: style them, voice them, or delete them from the API. The other three
   of this shape — `FlowTrack.muted`, `ruler[].major`, `data-selectable` — were **fixed in the
   port**, since each was one rule.

Also deferred, and smaller: `mountChipStrip` alone of the four has no `motion` option, no
`data-motion` and no `dressMotion`, so a host's `--wm-harmony-motion-*` override is unreachable on a
chip (**C.7c**); and a focused lane slider writes `aria-valuetext` once per wheel notch instead of
once per settle (**C.7c**).

And one that is not about accessibility at all: `analysis-view.ts` stopped importing
`renderLiveChordPanel` when the nameplate replaced the panel, so
`analyze/element/internal/renderers.ts:9,16,17` now re-export `renderLiveChordPanel`,
`LiveChordPanel` and `LiveChordPanelOptions` to nobody. Harmless — that file is the element layer's
curated list of what it may take from `@webmusic/ui/analysis`, and the helper is still published and
still documented on `analysis.mdx`. **Owner: C.11**, which decides whether `live-chord` still wants
it; deleting the three lines before then would only have to guess.

### 0.6.5 Fixed in the port, after the review

Sixteen regression rows landed with them, each verified to go red when its fix is reverted.

| what | where it bit |
|---|---|
| `mountFlowLane` called `binding.subscribe` through a local alias | A class-shaped binding threw `TypeError`, the mount's own `catch` swallowed it into `onError`, and the lane showed its first snapshot for ever. The other three mounts already called it on the object. |
| a `stepped` lane joined no frame loop | `tickAt` is the only caller of `readPosition`, so a lane with no clock never sampled at all — and `motion: 'auto'`, the default, resolves to `stepped` under `prefers-reduced-motion: reduce`. That was every reduced-motion reader of the shipped docs demo: a parked reel, a highlight walking off the right edge, and a pinned read-out naming bar one. The saving is taken in `tickAt`'s short-circuit instead — frame RATE, event COST. |
| `spans` judged on input length, not on survivors | A non-empty occurrence list whose entries are all still unplaced un-stamped the band **and** its honest `start`/`end`, dropping it out of `ANALYSIS_SPAN_SELECTOR` for good. Both `paintBand` and the chip strip. |
| `dress()` called AFTER the datum writes | Inline path only, and it cost two facts: `flowParts.flag`'s `top: 0; bottom: 0` erased every row-scoped flag's row, and `flowParts.bracket`'s `border` SHORTHAND reset every bracket's severity colour to the neutral rule grey. The part record is the floor a datum stands on, never a coat of paint over it. |
| `[data-focus]` dead inline, and dimming the sounding band in the sheet | `focusGroup` — the reason `motifs` draws one track per motif — did nothing without a sheet; and at equal specificity the focus rule out-ordered `[data-zone="now"]`, so focusing a group dimmed the one band that must never dim. Now `:not([data-zone="now"])`, said the same way on both paths. |
| `emphasis: 'hero'` dead inline | The one option that says "this read-out is standing alone on a stage", and `live-chord` — the view it exists for — pins its nameplate on the now line. |
| the wheel twin announced `0%` for every segment of an unweighted ring | Twelve segments each claiming to be impossible. A share is said only where there is a denominator. |
| the wheel twin marked `aria-current` on id alone | `sectors` was already keyed on `ring:id`. An outer `C` and an inner `C` — ordinary, not contrived — were both told they were the answer. |
| the wheel's centre was `aria-atomic` | `update()` runs on every `subscribe` notify, so a confidence ticking a percent re-announced the key name with it. The nameplate stays atomic: its two children are one fact said twice, and these two are different facts. |
| `readingKey` omitted `candidate.key` and `weight` | The guard keeps a focused `<button>` alive across a chord change and every button closes over the candidate it was built from, so a field the guard omits is a field `selectAlternate` is handed a stale copy of — and `key` is documented as "the opaque identity of this naming". |
| the inert alternate `<li>` got no class, and the pressable one shared its `cursor` | A bare run of text beside a row of bordered chips on the sheet path, and a pointer cursor over a node that does nothing on the inline one. `cursor` now lives in a button-only record. |
| the reel was the one visible child of the viewport that was not `aria-hidden` | With `seek` the `slider` role suppressed it; without one, every band label was announced twice — once off the reel, once out of the twin. |
| `destroy()` mid-drag never released pointer capture | Zero `releasePointerCapture` calls; the pointer stayed captured by a node about to leave the document. |
| `FlowTrack.muted`, `ruler[].major`, `data-selectable` | All three written since the first draft and read by nothing. One rule each, plus the inline equivalent. |
| four counts of "19 published subpaths" | `api.mdx:108`, `uikit/index.mdx:31`, `README.md:280` ("Eighteen") and `README.md:430`; the README's entry table had no `@webmusic/ui/harmony` row at all, and `ui-catalog.ts:34` did not mention the harmony nameplate `<analysis-view>` now mounts. |

### 0.6.6 Their own review of the same commit, carried across whole

The salvage worktree did not stop at the snapshot this port was cut from: it went on to **commit**
the work as `d86004e` and start C.8. Three things were only in that later state, and are now here:
the `ResizeObserver` catch that disconnects and clears a constructed-but-not-observing observer
(without it `update()`'s `if (!resizeObserver) measure()` pins the lane to its fallback width for
life), four test rows (`restampActiveStyle` ×2 in `spans-contract.test.ts`, focus-survival on the
nameplate and highlight-survival on the chip strip in `harmony.test.ts`), and two paragraphs of
`harmony.mdx` — the `scrollIntoView` diagnostic and the "the reel's width is never transitioned"
rule. **Their C.7.1 deferral table came with them, and it is the rest of this section.**

| # | finding | owner | why not in the port |
|---|---|---|---|
| **F1** | 🔴 **A root that holds a lane must take `createAnalysisPlayhead(root, {scroll: false})`.** `overflow: clip` keeps the LANE from scrolling, but a clip box is *skipped* by `scrollIntoView`, which then scrolls the nearest real scrollport — the page. Measured: a multi-span band whose lit occurrence is not the one on the anchor is handed to `scrollIntoView` 3465px outside the viewport. | **C.8** | Not reachable yet: nothing mounts a lane inside a root running `createPlayheadHighlighter`. It becomes live the moment the shell does, which is C.8's own deliverable, and design §3.6.4's "second guard" is already specified there. |
| **F2** | `AnalysisPlayheadOptions.scroll` is documented as "the first **newly-active** row" (`analysis.ts:76`); `:175` scrolls `next[0]` — first active in DOCUMENT order — whenever the set changed at all. Harmless with non-overlapping list rows; wrong the moment a lane band overlaps them, which is every row boundary. | **C.8** | `analysis.ts` is frozen for this work, and `packages/score/test/analyze/playhead.test.ts:61,66,69` pins the scroll COUNT byte for byte. It is a one-line change to `apply()` and belongs with the `{scroll: false}` wiring that makes it observable. |
| **F3** | `motion: 'auto'` reads `prefers-reduced-motion` **once, at mount**; `watchReducedMotion` did not land. | **C.8** | Already recorded at §0.6.3. The watcher has to repaint a whole subtree at once, and the shell is the node that owns one — a per-mount listener gives six read-outs six chances to disagree, which is what `resolveMotion`'s ancestor lookup exists to prevent. |
| **F4** | Three §3.6.5 fields declared in the design and not implemented: `FlowLaneState.window` (programmatic zoom — today only ⌘+wheel, so a caller cannot offer the zoom control the field was justified with), `pinned.caption`, `FlowTrack.weight`. | **C.11** | None is a defect in what shipped; each is an optional field with no consumer until a view asks. `window` needs a measured width to mean anything, which makes it a shell question. |
| **F5** | The motion budget is split: `--wui-harmony-motion-pop` / `-turn` live in a local `HARMONY_MOTION` in `harmony.ts` and `-release` / `-column` in `PITCH_MOTION` in `pitch.ts`, rather than in `harmonyMotion.full` / `.reduced` as C.7b's "Must contain" row says. | **C.9** | Both records are painted on every path, so the chains resolve and a host's `--wm-*` override is reachable — the bug is gone and only the shape is wrong. Moving four names into `harmonyMotion` touches `token-chain.test.ts`'s `PREDECESSOR` table and both pitch and harmony at once; C.9 already opens `harmony-style.ts`. |
| **F6** | The drain writes one `background: linear-gradient(...)` per frame on the sounding band's `__fill`. jsdom prices it at 0.03 ms/frame, and jsdom has no style recalc, layout or paint — the browser-relevant number was never measured. | **C.11** | The mechanism is right (a CHILD of the band, so no idle style is disturbed; off entirely under reduced motion) and the invalidation is one band-sized rect, not the reel. It needs a profile in a real browser against real material, which is what C.11 first has. The fallback if it does cost: a static overlay pinned at `anchor%` of the VIEWPORT — one node, zero per-frame writes — at the price of dimming every ahead band rather than draining the sounding one. |

**`--wui-harmony-motion-flow` is DELETED, not deferred, and this supersedes the port's version.**
The port kept it declared-and-unspent in `HARMONY_MOTION` with a comment saying so; their later
commit removed the name from source and from the doc table, and that is the version now here. The
reason is measured: the reel's offset is absolute pixels while every band's box is a percentage of
the reel's WIDTH, so easing the width beside an instant transform describes two different scales for
the length of the ease — the material sat **1890px** off the now line for 120ms after one ⌘+wheel
notch, and worse the further into the piece the listener had got. The stepped re-anchor is
`transition: none` by §2.5.3's own table. So the family spends **four** motion durations, not five.
`check-docs.mjs`'s `checkDocumentedCssVariables` (`:656`) independently refuses a documented `--wui-*`
that no source READS (`var(--x`), WRITES (`setProperty('--x'`) or DECLARES (`--x:`) — restoring the
doc row turns `check:docs` red, which is how this was re-found here before their record was read. A
zoom ease, if ever wanted, has to ease `pxPerUnit` in JS and write the width and the transform
together from one scale each frame: a feature, not a fix. **Design §2.5.2 and its token table at
`analysis-workbench-design.md:296` are now stale on this row** — leave them, and let C.14's prose
sweep correct them, but do not re-file the token from them.

**Rejected there, with reasons, so nobody re-finds them:** `--wui-harmony-flow-scale` as a token
(reading a length back out of a custom property means `getComputedStyle`; custom properties do not
inherit under jsdom and `parseFloat('')` is `NaN` — `scale` stays an option with a documented
default, and the module header says so) · `role="option"` on the twin's `<li>` (invalid without a
`listbox` parent; plain `<ol>`/`<li>` with `aria-current` is the better shape) · bar numbers in the
twin (the kit has no bars; a caller puts them in `trailing`, which the entry already prints).

---

## 0. Before commit 1: the tree is red

`npm run lint` (`eslint .`) fails on an untracked scratch file:

```
.probe/probe1.mjs
  4:9  error  'note' is defined but never used  no-unused-vars
```

`.gitignore` (12 lines) does not list `.probe/`, and `eslint.config.mjs:9-19` does not ignore it.
So `npm run check` dies at 7 s, at step 3 of 13, before touching any of this work.

**Do this first, as its own commit:** `rm -rf .probe/`. Do not add it to `eslint.config.mjs`
ignores — that ships a workspace wart into a published config.

Two more untracked paths will be swept up by a careless `git add -A`:

| path | decide once |
|---|---|
| `dev/plans/analysis-workbench-design.md` | commit deliberately (the `dev/plans/` directory is already tracked; 7 plan files) |
| `dev/prototypes/harmony-workbench.html` | 82 KB, **invisible to every gate** — `.html` is not in `check-format.mjs`'s extension set and not in eslint's globs. Committing it is defensible (design §10 calls it a deliverable) but it is an unchecked blob. Decide, don't drift. |

**Never `git add -A` in this series. Use explicit paths.** There are no git hooks
(`.git/hooks/` is samples only, no husky, `core.hooksPath` unset) — every gate is opt-in.

---

## A. DRIFT LEDGER

### A.1 — §11 "verified gate facts" that are FALSE

The design's §11 table is its foundation. **Three of its rows are wrong, and two of those will
silently produce broken code.** This is the most important section of this brief.

---

**A.1.1 — §11 row 7 / §4.1(1): `detect()` does NOT return weights. `ChordNaming.score` has no data source.**

> Design line 689: "`detect()` 返回按 weight 降序的**候选数组**"
> Design line 437: `score: number;  // 0…1`
> Design line 446: "（按 weight 降序，原位 1、转位 0.5）… **备选命名的数据源本来就在手里**"

Published signature — `node_modules/@tonaljs/chord-detect/dist/index.d.ts:4`:

```ts
declare function detect(source: string[], options?: Partial<DetectOptions>): string[];
```

The implementation computes weights (root position `1`, inversion `0.5`) and then throws them away:

```js
return found.filter((chord) => chord.weight).sort((a, b) => b.weight - a.weight).map((chord) => chord.name);
```

**The ordering is real. The numbers are not obtainable.** The only recoverable signal from a
returned string is "does it contain `/`" — two buckets, not a 0…1 scale. Worse, ties are common and
their relative order is *mode index*, not merit: `detect(['B','D','F','Ab'])` →
`["Bdim7","Ddim7/B","Fdim7/B","Abdim7/B"]`, where candidates 2–4 all had weight `0.5`. Deriving
`score` from array position presents three equally-weighted names as a ranked list.

**Fix:** make `ChordNaming.score` explicitly ordinal, or drop it. Concretely:
`kind: 'primary' | 'inversion' | …` (derivable: `symbol.includes('/')` ⇒ inversion) plus a
`rank: number` (array index), and delete `score`/`NameplateState.confidence` or document them as
"caller-supplied, never derived from `detect()`".

---

**A.1.2 — §11 row 8 / §4.1(2): `rootDegree` is `NaN`, not `null`. `??` does not catch it.**

> Design lines 447, 690: "`rootDegree` 实测可为 `null`，与 d.ts 声明不符，取值要防御"

`node_modules/@tonaljs/chord/dist/index.js:107`:

```js
const rootDegree = bassIndex === -1 ? NaN : bassIndex + 1;
```

plus a literal `rootDegree: 0` for the empty chord (`index.js:52`). Measured:
`Cmaj7`/`C`/`E7b9`/`Am7`/`Em#5/C` → `NaN`; `Am7/C` → `2`; `G6/E` → `4`; `Xyz`/`''` → `0`.
The d.ts says `number`, which `NaN` satisfies — so "与 d.ts 声明不符" is also wrong.

The author almost certainly probed through `JSON.stringify`, which prints `NaN` as `null`.
That has a second consequence: **`rootDegree` differs across the analyze worker's two transports** —
`structuredClone`/`postMessage` preserves `NaN`, any JSON hop turns it into `null`.

The bug this causes if the design's wording is followed:

```
g.rootDegree ?? 1  ->  NaN      (?? does NOT catch NaN)
g.rootDegree || 1  ->  1
```

**Required guard: `Number.isFinite(g.rootDegree) ? g.rootDegree : fallback`.** `rootDegree > 0` is
the clean single test for "usable". Do not put `rootDegree` on any type that crosses the worker
boundary.

---

**A.1.3 — §11 row 11: "仓库内没有任何指板 / 调弦 / 五度圈实现或依赖 | 全仓 grep 零命中" is FALSE on two of four, and the correction is a design decision, not a footnote.**

| thing | design says | truth |
|---|---|---|
| fretboard / tuning tables | none in repo | **CONFIRMED for repo source.** `node_modules/vexflow/src/tuning.js:10-19` ships `{standard, dagdad, dropd, eb, standardBanjo}` + `getValueForFret`, but vexflow is a transitive of the optional peer `opensheetmusicdisplay` and `devOptional: true` in the lock — unusable. Reword the claim to "no usable implementation". No fret-position search exists anywhere. |
| circle of fifths | none in repo | **FALSE.** `packages/score/src/view/core/note-sequence.ts:18` — `const FIFTHS_TO_MAJOR_KEY = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];`, used at `:213-215`. |
| diatonic-step / ledger math | (implied new) | **FALSE.** `packages/score/src/view/core/layout.ts:73` `STEP_TO_DIATONIC`, `:81-90` `diatonicStepsFromMiddleC`, ledger count at `:99`. Tested at `packages/score/test/view/layout.test.ts:51, :80`. |

**And neither existing copy is reachable.** `scripts/package-policy.mjs:142` sets
`analyze: ["core", "io"]` — the analyze capability may never import `view`, enforced at
`check-architecture.mjs:628-651`. So `core/key-wheel.ts` cannot import `FIFTHS_TO_MAJOR_KEY` and
`core/staff-placement.ts` cannot import `diatonicStepsFromMiddleC`.

Also note the two diatonic origins differ: `view` uses **C4 = 0**, the design specifies **C4 = 28**
(design lines 257, 428). They are the same ladder offset by 28.

**Decision the design owes and does not make** (make it in commit 2, write it in the module header):

- **(a) Duplicate in `analyze/core/`** — 12-entry array + 7-entry record, ~10 lines. Cheap. Requires
  a comment in both files naming the other copy and stating the `+28` offset, or the repo now has
  two silently divergent conventions.
- **(b) Lift into `packages/score/src/core/`** (`core: []`, so every capability may import it) and
  have `view/core/layout.ts` reuse it. Cleaner, but it drags `view` and `test/view/layout.test.ts`
  into "the commit with no ui changes".

**Recommendation: (a), with the cross-reference comment.** Option (b) is a separate cleanup commit,
not part of this refactor.

---

**A.1.4 — §11 row 2 is an undercount with one bogus citation.**

> "新增 ui 子路径 = 11 处登记，含 4 处 `compareExactSet` + 硬编码计数 `!== 18` + 必须被元素静态 import
> | `check-architecture.mjs:1048, 1288-1293, 1327-1350, 1385-1398, 1409-1476`、
> `check-package-exports.mjs:63-122`、`package-policy.mjs`"

| claim | truth |
|---|---|
| "11 处登记" | **13 mandatory edits across 9 files**, plus 1 required-but-ungated (`UiPresenterName` union) and 1 convention (`src/index.ts` barrel). Full checklist in §C.0. |
| "4 处 `compareExactSet`" | **5** subpath-scoped: `check-architecture.mjs:1288` (import closure), `:1327` (class policy), `:1345` (catalog pairs), `:1393` (live displays), `:1476` (uikit pages). Plus a 6th exact-both-ways check that is not `compareExactSet` — `checkPublicEntryPolicy` at `:152-166`. Plus a length equality at `:1342`. (`:1470` compares class *slugs* and only moves if a new class is added — it is not one of the five.) |
| "1 处硬编码计数 (:1048)" | **Two lines.** The condition `:1048` and the message string `:1049` (`must publish exactly 18 presenter subpaths`). Missing `:1049` leaves a lying error message that nothing catches. |
| "必须被元素静态 import" | **CONFIRMED** (`:1288-1293`). Two refinements the design omits: the import may live anywhere in the element's **static closure**, not the element file itself (`<analysis-view>` already reaches `@webmusic/ui/analysis` only via `element/internal/renderers.ts`); and it must be a **runtime, non-`type`, non-dynamic** import (`:1090` filters `imported.runtime && !imported.dynamic`). A bare side-effect `import '@webmusic/ui/pitch';` **does** count — `isTypeOnlyDeclaration` (`:454-457`) returns `false` when there is no import clause. |
| `check-package-exports.mjs:63-122` as a registration site | **WRONG — nothing to edit there.** That file has no ui subpath list; it iterates `expectedPublicEntries` from `package-policy.mjs`. The real site is `scripts/package-policy.mjs:38-59`. |
| "每个子路径都必须原子落地" | **CONFIRMED and stronger.** Nine partial states were replayed in an rsync sandbox; **every one fails**. There is no ordering of the 13 edits that keeps `npm run check` green partway. Three subpaths ⇒ three atomic commits, bumping 18→19→20→21, is fine — nothing couples them to each other. |

---

**A.1.5 — §11 line citations that are off (substance confirmed in every case)**

| §11 claim | corrected |
|---|---|
| glyph ban `check-architecture.mjs:784-798`, scope `packages/ui/src/**` excluding test | **CONFIRMED exactly.** Function `:784-798`, regex `:786`, message `:794` ends "take a formatter callback instead.", scope is `pkg.files` = `sourceFiles(<pkg>/src)` (`:63-64`). Executed: the seven `♩`–`♯` glyphs and all of `U+1D100–1D1FF` (incl. the double sharp) are banned; `× ○ · ° − ∞` are allowed. Zero current hits. |
| `EXPECTED_ELEMENTS['Score Analyze'] = 5` at `:29-37` | **CONFIRMED**; the object is `:29-36`, the row is `:31`, `EXPECTED_ELEMENT_TOTAL = 31` at `:37`. |
| playhead whitelist `:1267-1284` | Block is `:1269-1285` (`if (entry.tag === 'analysis-view') {` at `:1269`); `:1267-1268` is its comment. Substance **CONFIRMED verbatim**, including that the `.style` ban is `/\.(?:style\|cssText)\b/` — it also bans `.cssText`, and it is a **plain text scan of the whole file, comments included**. |
| params ↔ `observedAttributes` order equality `:137-144` | Block is `check-docs.mjs:126-149`; `const got` at `:137`, missing/extra at `:140-141`, **the order comparison `got.join() !== truth.join()` is `:142-143`**. (The `subpath-registration` recon's claim of `:146-148` is wrong — I read the file.) |
| uikit page shape `:1409-1449` | The loop is `:1400-1453`; per-page checks `:1405-1452` (title `:1414`, skeleton `:1419-1424`, exactly-one `:1428-1431`, ordered sections `:1433-1447`, ends-with-Related `:1448-1450`); final `compareExactSet` pair `:1470` / `:1476`. |
| `stage.ts:195, 308, 577` multi-mount precedent | **CONFIRMED exactly.** |
| ui zero runtime deps | **CONFIRMED and stronger** — `packages/ui/package.json` has no `dependencies` **and no `peerDependencies` key at all**. devDeps: `jsdom ^24.1.3, tsup ^8.5.0, typescript ^5.4.0, vitest ^3.2.6`. |
| score direct deps only `abc-notation`/`chord`/`chord-detect` (`package.json:280-282`); `pitch-note` transitive (`package-lock.json:3575`) | **CONFIRMED, exact lines.** Imprecise as prose: score also depends on `@tonejs/midi`, `fast-xml-parser`, `fflate`, `staffrender` (`:283-286`). |
| `elements.test.ts` 648 lines, StubNode `:12-154`, jsdom already a devDep, two sibling jsdom files | **CONFIRMED, all four.** But the *conclusion* drawn from them is wrong — see A.2.1. |

---

### A.2 — Body-text drift that changes what a commit must do

**A.2.1 — §7.3 row 1 / §8 step 6: "迁 jsdom … 删掉 :12-154 的 143 行脚手架。零成本" is WRONG. It is a full rewrite.**

Verified empirically on vitest 3.2.7 + jsdom 24.

Six assertions **fail or throw** under jsdom:

| line | assertion | under jsdom |
|---|---|---|
| `:179`, `:180` | `expect(() => new ScoreAnalysisElement()).not.toThrow()` | **THROWS** `TypeError: Invalid constructor, the constructor is not part of the custom element registry` — `HTMLElementBase` becomes the real `HTMLElement` (`platform/kernel/src/elements.ts:13-15`) |
| `:184` | `expect(globalThis.customElements).toBeUndefined()` | **FAILS** — it is an object |
| `:583`, `:586` | `rows.some(…)` | **THROWS** — real `querySelectorAll` returns a `NodeList`, which has no `.some`/`.filter` |
| `:639`, `:645` | `segments.filter(…)` | **THROWS**, same |
| `:296-299` | `root.children.find(…)` | **THROWS** — `HTMLCollection` has no `.find` |

Five more are **structurally inexpressible**: `:424-426`, `:499`, `:503`, `:541-542` use
`stubPlayer.count(type)`. **jsdom exposes no listener count**, so `:136-154` cannot be deleted.

And "delete `:12-154`" is not survivable arithmetic: that range also holds `flush` (`:76`),
`ViewCtor` (`:78-83`), `createHost` (`:85-134`) and `stubPlayer` (`:136-154`). References **after**
line 154: `flush` 25, `createHost` 17, `stubPlayer` 9, `installStubDocument` 7, `ViewCtor` 2 =
**60 broken references in the remaining 494 lines**.

**Corrected plan:** split. Move `:175-234` (SSR safety + `define*` idempotence) into a new
`// @vitest-environment node` file (precedent: `packages/ui/test/ssr.test.ts:1`,
`platform/kernel/test/element-ssr.test.ts:1`); port `:236-648` onto the harness that already works in
this very directory — `new-elements.test.ts:12-17` (unique tag + `customElements.define` +
`document.body.append` + `await flush()`, `afterEach(() => document.body.replaceChildren())` at
`:49-51`); keep a listener-counting player stub; convert every `NodeList`/`HTMLCollection` consumer
to `[...root.querySelectorAll(…)]`.

**Landmine even after the split:** `elements.test.ts:192-194`'s
`afterEach(() => delete globalThis.customElements)` *works* under jsdom and also nukes
`window.customElements`. Any later `describe` in the same file loses the registry.

**A.2.2 — §7.3 rows 2 and 3: the pinned-assertion lists are incomplete.**

Microcopy list (`design:613`) is missing: `'A minor'` (`elements.test.ts:351`), the note count `'13'`
(`:257`), and **three negative assertions** that are equally binding —
`not.toContain('confidence')` (`:337`), `not.toContain('live ·')` (`:477`), `not.toContain('live ·')` (`:504`).

Structural list (`design:614`) names 3 of 27. Also pinned: `host.children.length === 0` when there is
no score (`:264`); `ol.children.length > 0` (`:299`); the sorted 5-tag registry array and the
`define` call counts 2 and 5 (`:209`, `:225-232`); `chordchange` `detail.midis` deep-equals
`[60,64,67]` and `[62,66,69]` (`:411`, `:551-552`); all four listener-count assertions; and the
filtered active set `toHaveLength(1)` with `active[0] === segments[0]` (the **one-active-segment** case (`:465-471` today)).

**A.2.3 — §7.4 item 1: "步骤 1 落地即免费 … audio 的 5 个元素一行不改就拿到 … 暗色主题" is WRONG.**

`analysisStyle` is **exported and never installed anywhere**. Verified — the only three references in
the repo are its own declaration (`packages/ui/src/analysis.ts:38`), prose in
`packages/ui/README.md:422` ("exported but never installed by the analysis helpers, which style
their nodes inline"), and prose in `uikit/views-analysis/analysis.mdx:135`. `createAnalysisRoot`
(`analysis.ts:199-203`) writes `root.style.cssText` and appends no `<style>`.

A media query cannot ride in `cssText` or in `paint()` (`setProperty`). **So step 1 as written gives
the six legacy renderers and audio's five elements the light literal only, forever.** Two honest
options, pick one in commit 1:

- **(a)** Make `createAnalysisRoot` install `analysisStyle` via `installStyle(document, 'analysis', …)`
  and append the node into the returned root. Behaviour change; the blast radius is bounded — I
  checked the pinned assertions and none of them breaks on a `<style>` child
  (`analysis.test.ts:126-130` asserts `ownerDocument === foreign` for every node, which a
  `documentOf(root)`-created style satisfies; `elements.test.ts:339` counts `host.children`, not root
  children). Still: run the ui, score and audio suites before believing it.
- **(b)** Accept that only the new `mountX` surfaces get dark mode, and delete the §7.4 claim.

**A.2.4 — §3.1 / §3.3: the design's own sample JSDoc would red-line the gate the design itself cites.**

`dev/plans/analysis-workbench-design.md:175` and `:235` both contain the sharp glyph inside code
blocks destined for `packages/ui/src/pitch.ts`. `checkUiDomainVocabulary` reads the **whole file
text, comments included**. Verified: planting that glyph in `packages/ui/src/pitch.ts` produces the
gate error. **Rewrite the JSDoc to `F#4` / `Gb` before pasting.**

Related, harmless: §3.0 line 167's "`toneMark()` 返回 ASCII" is wrong — §2.3's `other` mark is `·`
(U+00B7). Not banned. Just do not write a test asserting ASCII-ness.

**A.2.5 — §3.2: `pianoKeyLayout` is only two-thirds of the geometry, and importing it costs the whole of `note.ts`.**

`packages/ui/src/note.ts:12-36` gives `left`/`width` as **percentages 0–100**, `width = 100/whiteCount`
for a white, `× 0.62` for a black, and `left` for a black is the **boundary** between its two whites.
The centring `transform: translateX(-50%)`, the `height: 62%` and the `z-index: 2` live in
`noteStyle` at `note.ts:108`, **not** in the function. Without them every black key renders half a
key-width to the right.

Second: a runtime `import {pianoKeyLayout} from './note'` drags `PointerSurface` (`note.ts:177-322`)
and `NoteSurfaceInteractions` (`:330-596`) — ~470 lines — into the `pitch` chunk, contradicting
`packages/ui/README.md:280-286` ("Importing `@webmusic/ui/eq` pulls the EQ presenter and its shared
chunk, nothing else").

**Fix:** move the bodies of `isBlackKey` / `pianoKeyLayout` / `NotePianoKey` into
`packages/ui/src/internal/pitch-geometry.ts` and re-export from `note.ts`. `@webmusic/ui/note`'s
public API stays byte-identical (its consumers are `packages/score/src/view/element/keyboard-view.ts:79`,
`packages/score/src/play/element/note-input.ts:201`,
`apps/doc/webmusic/src/lib/ui-presenter-demos/mixing-notes.ts:710,712`,
`packages/score/test/play/note-input-modules.test.ts:27`).
`checkInternalSourceReachability` (`:954-972`) is satisfied and `checkInternalCycles` (`:974-1000`)
stays green — the edge is one-directional.

Also: `pianoKeyLayout(0, 20000)` allocates 20001 objects and `pianoKeyLayout(NaN, NaN)` returns `[]`.
Clamp `low`/`high` through `internal/dom.ts:61-68` `clamp()` before calling.

**A.2.6 — §3.6: "`playhead.ts` 一行不用改" is conditionally true, and the condition is not stated.**

`createAnalysisPlayhead` restores a node with a **full `cssText` overwrite** —
`analysis.ts:135` `element.style.cssText = readAnalysisIdleStyle(element) ?? "";` and sets active at
`:142` by concatenating the idle string with `ANALYSIS_ACTIVE_STYLE`.

Any declaration `paint()` wrote onto a chip node that is **not also inside**
`data-webscore-idle-style` is destroyed the first time the playhead leaves that node.
`stampSpans()` must therefore serialise the node's **complete** inline style
(`node.style.cssText` after painting), not a hand-written subset. Make that an explicit assertion in
the promised `spans-contract.test.ts`.

**A.2.7 — §4.1(4): `pcName()` cannot implement `spelling`, and the design's own test fails against it.**

`packages/score/src/analyze/core/pitch-class.ts:1`:

```ts
export const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
```

A **fixed mixed-accidental table** — sharps for pc 1 and 6, flats for pc 3, 8 and 10. It can never
emit `D#`/`G#`/`A#`/`Db`/`Gb`. The design's own test (`design:452`, "`spelling:'flat'` 把 C♯ 拼成 D♭")
**fails**: `pcName(1) === 'C#'`.

The *conclusion* (no `@tonaljs/pitch-note`, no new dependency) is CONFIRMED. The *reason* is wrong.
Two new 12-entry tables (`SHARP_NAMES`, `FLAT_NAMES`) must be written — ~4 lines, still zero deps.

Related: the same table is baked into `KeyResult.tonic` (`core/key.ts:48` iterates `NOTE_NAMES`), so
the wheel's outer ring **cannot** be labelled from `KeyResult.tonic` without a re-spelling pass.
And `pcName` can never produce `B#`/`Cb`/`E#`/`Fb` or double accidentals, which `get().notes` **can**
(see A.2.9) — so any name→pc→name round-trip through `pcName` destroys the enharmonic identity the
design's "enharmonic grouping" test depends on.

Free fix while you are there: `core/chords.ts:153-154` documents `identifyChordFromMidi` as
"Pitch classes are spelled with sharps" — false for pc 3/8/10.

**A.2.8 — §4.1(5): the cache limit you are "copying" is 10000, not 4096.**

`core/chords.ts:188` `const DETECT_CACHE_LIMIT = 10000;`. Sibling `ROMAN_CACHE_LIMIT`
(`headless/session.ts:382`) is also 10000. The *strategy* (clear the whole map on overflow) is copied
correctly. Pick a number deliberately; do not write "copying the existing 4096" in a commit message.

Memoization is a hard requirement, not a nicety: measured `detect()` ≈ **59–62 µs/call** regardless
of set size; `get()` ≈ 3 µs. Live tracking calls it on every note-on.

**A.2.9 — §4.1: four more `@tonaljs` behaviours that will produce wrong output if not handled.**

1. **Input order is load-bearing.** `detect()` treats `source[0]` as the assumed bass:
   `['C','E','G','A']` → `["C6","Am7/C"]` but `['A','C','E','G']` → `["Am7","C6/A"]`.
   `spellChord(midis)` **must** sort ascending and dedupe by pitch class keeping the lowest — which
   `identifyChordFromMidi` already does at `chords.ts:156-167`. Copy it, don't re-derive it.
2. **`detect()` returns `[]` for 1 note, 2 notes, and any 12-pc cluster.** In `live-chord`, "two keys
   held" is a very common state with **no naming**. The existing space-joined pc-name fallback
   (`chords.ts:182`) must be kept or the nameplate goes blank mid-performance.
3. **Slash-chord `intervals` and `notes` are BASS-relative.** `Am7/C` → `intervals: ["3m","5P","7m","8P"]`;
   `G6/E` → `["6M","8P","10M","12P"]`. `SpelledPitch.interval` (design line 431) **cannot** be read
   off `get().intervals` for a slash naming — compute from the tonic, or accept compound
   bass-relative labels.
4. **`detect()` can emit a slash name whose bass is not a chord tone.** `get('Em#5/C')` →
   `root: ""`, `rootDegree: NaN`, `bass: "C"`, `notes: ["C","E","G","B#"]` — **four names for a
   three-note input**, with `B#` duplicating C's chroma. §4.1(4)'s "`'auto'` 跟随 primary 的 `notes`
   拼写" needs a documented same-chroma tiebreak.

Confirmed as designed: `symbol` vs `name` (`"Am7/C"` vs `"A minor seventh over C"`);
`get(s).symbol === s` round-trips for every candidate `detect()` emits; the role formula
`(pc − rootPc + 12) % 12` with the lowest non-root overridden to `bass` — **E-G-B-C really does give
`52:E=bass 55:G=fifth 59:B=seventh 60:C=root`**. Two wrinkles to write down before the test file:
semitone 6 maps to `fifth`, so a sharp-11 paints as a fifth; semitone 9 maps to `extension`, so C6's
A has no `degreeLabel` in the stated `'R'|'3'|'5'|'7'|'9'|'B'|'·'` set.

**A.2.10 — §5 / §10: the flagship "Am9 (no root)" demo cannot be built from `detect()`.**

`detect(['C','E','G','B'])` → `["Cmaj7"]` — **exactly one candidate**, with or without
`assumePerfectFifth`. `Am9` needs an `A` that is not sounding, and `detect()` structurally cannot add
a pitch class (it matches `chordType.chroma === mode` exactly). The **role recompute arithmetic is
right** (`rootPc = 9` → `48:bass 64:fifth 67:seventh 71:extension`, exactly design line 672) — only
the naming source is missing.

**Fix:** either drop the rootless alternate from the demo copy and the prototype's claim, or budget
an unspecified superset search (`extended()` / `reduced()` filtered to supersets adding ≤ 1 pc) into
commit 2. It is not "the data source is already in hand".

**A.2.11 — §4 / §5: four of the six views have no MIDI notes to project.**

`projectSounding()`'s `timeupdate` branch is specified as "the representative notes of the
`ChordSegment` under the playhead". `ChordSegment` (`core/types.ts:25-34`) carries only
`startQuarters`, `endQuarters`, `pitchClasses: number[]` (0–11) and `chord: string` — **no octaves,
no `Note`**. The octave-bearing variant lives on a different API (`ChordTimelineSegment.notes`,
`core/summary.ts:39`) that `AnalysisSession` never produces.

Three options; the design mentions none:

- **(a) Pass the `Score` into the projection** and use `notesOverlapping` the way `core/summary.ts:86`
  already does. Changes the §4.1 signatures to `projectProgression(result, score, mode)`.
  **Recommended** — the element already holds the `Score`.
- (b) Add a field to `AnalysisResult` — but that is *also* the worker wire payload
  (`headless/worker-protocol.ts:91`) and is deep-frozen by `freezeAnalysisResult` (`session.ts:46-79`).
- (c) Synthesise octaves from pitch classes — fake precision. Reject.

**A.2.12 — §2.5: neither the `empty` phase nor the `error` phase has any existing plumbing.**

- `markEmptyState` (`packages/ui/src/internal/dom.ts:87-90`) is reachable from **exactly one**
  renderer — `renderHistogram` (`analysis.ts:300`). **None of the six `<analysis-view>` renderers
  call it.** `renderChordTimeline` renders an empty `<ol>` with no message (`analysis.ts:214-218`);
  `renderRomanStrip` renders a caption + empty strip (`:220-224`). So §2.5's per-view empty
  sentences are **new behaviour**, and they are only compatible with step 7's "`analysis.test.ts`
  unchanged" bar if the empty copy lives in the **workbench shell**, not in the six delegating
  renderers. State this before writing step 7.
- **`error` has no channel at all.** `element/internal/score-source.ts:61-64` catches,
  `console.error`s and returns `undefined`; `#refresh` then cannot distinguish "no `src`" from
  "`src` failed" and leaves the element **completely empty**. A "danger card + raw message" requires
  changing `ScoreSource.load()`'s return shape (`score-source.ts:8`). Not listed in §7.3.

**A.2.13 — §6 line 542: "不能追加到末尾" is WRONG and contradicts §6's own signature.**

`check-docs.mjs:142-143` compares the two lists **only to each other** (`got.join() !== truth.join()`),
and only after the sets already agree. Appending the seven new names to the end of **both**
`observedAttributes` and `SCORE_ANALYZE_PARAMS['analysis-view'].params` passes — which is exactly
what design line 536 does. **The actionable rule is: keep the two lists byte-for-byte in the same
order. Appending is fine.**

**A.2.14 — §9 line 655: "`ui-presenter-demos/views-analysis.ts`（三个 `case`）" is wrong about the form.**

That file dispatches with `if (presenter === '…')` at `:702-705`; only the other three demo files use
`switch`/`case`. The gate regex accepts both, but follow the file's style. (Each existing presenter
also has a real ~150-line demo there — these are not three one-liners.)

**A.2.15 — §9's file list gets `scripts/element-composition-policy.mjs` backwards.**

The design lists it as a required change. It is **not** gate-enforced in the direction you would
assume: adding the `@webmusic/ui/pitch` import while leaving `entry.ui` as `['analysis']` is fully
green — the loop at `check-architecture.mjs:1097-1106` only walks *declared ⇒ reached*, never
*reached ⇒ declared*. The **reverse is enforced**: declaring `'pitch'` before the import exists gives
`<analysis-view> does not reach its required published presenter @webmusic/ui/pitch.`

**Consequence for sequencing: never add a subpath to `entry.ui` in a commit where the import does not
yet exist.** Adding it in the same commit as the import is correct and is what the file's own header
intends — but it is documentation, not a gate.

**A.2.16 — §7.3(1) over-states the StubNode's missing `querySelector`.**

`StubNode` **does** implement a minimal `querySelectorAll` for `[data-*]` presence selectors
(`elements.test.ts:43-58`) — which is precisely why playhead assertions pass under the stub today.
The migration is still right; just don't be surprised. **And the mirror of that is a real hazard:**
a class selector such as `.wui-analysis__rhythms > li` returns `[]` **silently** under the stub.
Do not add structural assertions to `elements.test.ts` before it is on jsdom — they pass vacuously.

**A.2.17 — §6.1: the hash colouring you are replacing lives in score, not ui.**

`rootColor` is `packages/score/src/analyze/element/analysis-timeline.ts:24-29`, and that element
declares `ui: ['timeline']` (`element-composition-policy.mjs:23`). If the 12-tone table becomes a
`@webmusic/ui/harmony` import, `element-composition-policy.mjs:23` must gain `'harmony'` **in the
same commit** — otherwise the doc-site catalog drifts (the gate itself will not complain about a
reached-but-undeclared subpath, per A.2.15).

**A.2.18 — §11 / §9: the `@tonaljs/progression` doc bug has two copies, not one.**

`apps/doc/webmusic/src/content/docs/score/api/analyze.mdx:15` — **CONFIRMED stale** (not a dep, 0 hits
in `package-lock.json`, absent from `node_modules/@tonaljs/`). The design misses the second copy:
`packages/score/docs/README-analyze.md:23`. Same file, `:20`, also still says `@webscore/io`
(pre-rename scope). And `score/api/analyze.mdx:7` omits `live-chord` from the `type` list.

---

**A.2.19 — §4.1: four `@tonaljs` behaviours that make `spellChord` print things that are FALSE, measured over the whole language. LANDED — this is the record of a policy, not an instruction.**

Method for every count below: all 12144 closed voicings of every 3–6 note pitch-class set, in all
12 rotations. All four are LANDED in `chord-spelling.ts` — `covers()`, `DEMOTED_TYPES`, the
double-accidental fallback and the last-slash rebuild. They are recorded here because each one is a
policy a later commit could quietly undo, and because the source's header comments explain the
shapes while carrying none of these counts.

1. **A name that does not account for every sounding pitch.** `detect(['C','C#','F','G','A#'])`
   returns `'Cb9sus'` — meaning "C, flat ninth, suspended" — and `get('Cb9sus')` reads the tonic as
   **C-flat**. The sounding root then prints as the `bass`, F and G *both* print `5` (neither is a
   fifth of C-flat), and every degree moves a semitone. **Guard: keep only candidates whose chord
   tones cover every sounding chroma.** SUBSET, never equality — `assumePerfectFifth` correctly
   names C-E-B `Cmaj7`, and 742 legitimate namings are that shape. Rejects exactly 10 primaries in
   the language, all of them that one symbol.
2. **A chord type that is only a spelling artifact.** detect() weights root position 1 and an
   inversion 0.5, so E-G-C comes back `Em#5` (E-G-B#) ahead of `CM/E` — i.e. **every first-inversion
   major triad**, with a double sharp on the stave. **Guard: a small `DEMOTED_TYPES` set, stable-sorted
   to the back of detect's own order.** Measured: `minor augmented` is the ONLY type that reaches
   rank 0 with an ordinary chord behind it (16 cases). `D7no5/C` losing to `D7/C` is *not* one —
   with `assumePerfectFifth` on, `no5` is the honest name of the two, so do not "fix" it.
3. **A symbol detect() emits and `get()` cannot read back.** `detect(['D#','G','B','C'])` returns
   `'Cm/ma7/D#'`; `get('Cm/ma7/D#').empty` is `true`, because the alias already contains a slash.
   Every inversion of a minor-major seventh — the tonic chord of harmonic minor — arrives this way,
   60 candidates in the sweep. **Guard: split at the LAST slash and rebuild with
   `getChord(type, tonic, bass)`, and only when the tail parses as a pitch class**, or `'Cm/ma7'`
   itself is read as a C minor triad over a bass called `ma7`.
4. **The default table writes a double sharp on a natural key.** With no `key` (the live note-on
   path has none) the sharp table names D#-G-A# `D#M`, spelled `D# F## A#`. **Guard: when the first
   answer carries a double accidental, ask the other table and keep the tidier one.** Fires 1065
   times, improves 845, makes 0 worse, and cannot fire before a double accidental exists.

Two more, smaller: a role is a coarse bucket, so the **semitone fallback needs its own mark table** —
`toneMarkFor(role)` prints `9` on a perfect fourth and `9` on a major sixth. And Tonal's `name` is
`${tonic} ${type}`, so a chord with an empty `type` (`C7b13`) gives `'C '` — non-empty, so
`?? symbol` and `=== ''` both sail past it; **test `chord.type`, not `chord.name`**.

---

**A.2.20 — Findings this review DEFERRED, and which commit owns each.**

Raised while auditing C.3; each is real, none is C.3's to fix.

| # | Finding | Owner | Note |
|---|---|---|---|
| D1 | `createLiveChordTracker` names with `identifyChordFromMidi`, the workbench will name with `spellChord`, and over 10000 random voicings the two disagree on **34.2%** of the sets both can name (`Abmaj13/G` vs `G#maj13/G`) — plus a differently-ordered unnamed-set fallback (pitch-class order vs sounding order). §1's whole argument is one truth source. | **C.10** (`the key, roman and live-chord read-outs delegate`) | Reduce `identifyChordFromMidi` to `spellChord(midis).label`. NOT in C.3: it is published API (`dist/analyze/index.d.ts`), and its output feeds `elements.test.ts` microcopy and two doc pages this commit may not touch. A pointer comment now lives on `identifyChordFromMidi`. |
| D2 | No alternates without `includeRootless`: over 168 common chords, 84/168 have ≥2 namings by default and 168/168 with the flag — but the flag costs 537 µs against 72 µs, which the note-on path must not pay. §5's flagship "click `Am9 (no root)`" is therefore off by default. | **C.7** (nameplate) | Split the work: `spellChord` sync for the primary, a separate alternates call the workbench runs on idle. Decide the shape with the dock in hand. |
| D3 | `ghostPitchClasses` (§3.2's "调内但未响的音级") has no source: nothing in `analyze/core` exports a key's scale, and `roman.ts` keeps a private `MAJOR_SCALE`/`MINOR_SCALE`. | **C.4** | `export function scalePitchClasses(key: Key)` in `core/key.ts`; have `roman.ts` read it instead of its own copy. |
| D4 | `SpelledPitch` has no `display` (`'F♯4'`) and `ChordNaming` no `displaySymbol`. C.3 ships `ACCIDENTAL_GLYPHS` + `toDisplayName()` so the docks can build them — the kit **cannot**, `checkUiDomainVocabulary` bans U+266D/266E/266F from `packages/ui/src/**`. | **C.6 / C.7** | Two derived strings per pitch on a memoised hot-path record, with no measured consumer yet; add them when a dock asks. |
| D5 | §4.1's proposed contract test (`const _mark: PitchMark = {} as PitchMarkView`) is **structurally vacuous** — every field the docks actually render is optional on the kit side, so it compiles green while the keyboard prints no labels and the staff draws no accidentals. It proves `midi: number` and nothing else. | **C.6** | Assert SUPPLY, not assignability: `type Supplies<S,T,K> = [K] extends [keyof S] ? … : never`, plus one runtime test per dock asserting `Object.keys()` of a real projection. |
| D6 | `SpelledPitch.weight` and `.active` have no source: `spellChord` takes `readonly number[]` and `createLiveChordTracker`'s `sounding` is `Map<midi, refcount>`, not velocity. | **C.6** | `active` is derivable (everything in a result sounds) and only bites the ghost case; `weight` is not derivable at all — drop it or feed it from a caller that has velocity. |
| D7 | The octave convention is hard-wired: `respell()` fixes C4 = MIDI 60 and `MIDDLE_C_DIATONIC` bakes it, while §3.2 calls this a naming convention the caller owns and gives the kit an `octaveLabels` escape hatch. | **C.6** | `SpellChordOptions.middleCOctave?: number` if a dock ever needs it; the ladder itself does not move. |
| D8 | The `+28` identity binding `staff-placement.ts` to `view/core/layout.ts` has **no test**, because `STEP_TO_DIATONIC` and `diatonicStepsFromMiddleC` are module-private in `layout.ts`. | the B6 lift-into-`core/` commit | Exporting them to test them would drag `view` into a commit with no rendering changes — which is the same reason the duplication exists. The header comment states the identity and its one exception (an unspelled note falls back on both sides, to different things). |
| D9 | Three primary labels read as something else: `CM` for a plain triad, `Cm/ma7` (the `/` means slash bass everywhere else in this module's output), and `C4` for a quartal stack — which collides exactly with `SpelledPitch.name`'s format for the pitch C4. | **C.7** (nameplate) | These are Tonal's own symbols. A display-vocabulary map belongs next to the thing that displays them, not as a second naming authority in `core`. |

---

---

### A.3 — Gates the design never mentions at all

**A.3.1 — 🔴 `.wui-*` class-name collision with the docs stylesheet. The single most likely surprise failure, and it lands in the subpath commits before any doc page exists.**

`check-docs.mjs:611-637` (`checkDocsCssNamespace`) harvests every `wui-…` token out of **all of
`packages/ui/src/**.ts`** — string literals, stylesheet text **and comments**, via
two regexes (one matching a `wui-…` token right after a quote or backtick, one matching a
`.wui-…` selector) — and
fails for any name `apps/doc/shared/ui.css` also declares.

The 43 names the docs stylesheet already owns (read out of the file):

```
wui-badge wui-btn wui-btn--icon wui-chip wui-cluster wui-data wui-dot wui-empty
wui-field wui-grid wui-key wui-keyboard wui-label wui-metric wui-pad wui-pad-grid
wui-panel wui-panel--flow wui-panel__hint wui-panel__title wui-player wui-player__label
wui-player__params wui-range wui-range--wide wui-readout wui-readout--strong
wui-readout--wide wui-row wui-row--between wui-row--end wui-seg wui-select wui-spectrum
wui-step wui-step-grid wui-surface wui-tab wui-tabs wui-toolbar wui-track
wui-track__fill wui-track__region
```

**Every natural root class in this design is taken:** `mountKeyboard` → `.wui-keyboard` ✗, `.wui-key` ✗;
`mountChipStrip` → `.wui-chip` ✗; `mountWorkbench` → `.wui-tabs` ✗ `.wui-tab` ✗ `.wui-panel` ✗
`.wui-surface` ✗; `mountNameplate` → `.wui-readout` ✗ `.wui-label` ✗ `.wui-badge` ✗;
`mountWheel` → `.wui-dot` ✗; the empty state → `.wui-empty` ✗; a spans track → `.wui-track` ✗.

**Rule: namespace every new root class.** `.wui-pitch-keyboard`, `.wui-pitch-staff`,
`.wui-pitch-fretboard`, `.wui-harmony-nameplate`, `.wui-harmony-chip`, `.wui-harmony-wheel`,
`.wui-workbench`. The `__` element form is a distinct token, so `.wui-pitch-keyboard__key` is fine —
but `.wui-keyboard` as a root is not, **even inside a comment**.

Mirror ban: `checkWuiInternalNamespace` (`check-architecture.mjs:848-859`) forbids any
`wui-x__y` literal in `packages/{score,audio}` and `platform/kernel` sources. The score element must
reach nodes through `KeyboardHandle.key(midi)` / `WorkbenchHandle.dock(id)` / part tokens, never a
class selector.

**A.3.2 — 🔴 a `switch` with string cases inside any of the four demo files breaks `check:architecture`.**

`check-architecture.mjs:1390-1392`'s extraction regex is
`/(?:presenter\s*===\s*|case\s+)['"]([^'"]+)['"]/g`, applied as a **blind text scan** over exactly
four hard-coded files, and `compareExactSet` at `:1393` is exact in both directions.

Planting an ordinary helper `switch (mode) { case 'sharp': … }` inside `views-analysis.ts` produces
`UI presenter live displays has unreviewed published presenter subpath: sharp.`

The workbench demos want exactly that shape (spelling `'sharp'|'flat'|'auto'`, tuning
`'standard'|'drop-d'|'ukulele'`, density, scheme, shell).
**Never write `switch` with string cases, and never write `presenter === '…'` for anything but the
dispatcher, inside `apps/doc/webmusic/src/lib/ui-presenter-demos/*.ts`.** Use if/else or an object map.

**A.3.3 — a `--wui-*` token documented on a doc page must already be live in `packages/*/src`.**

`check-docs.mjs:656-685` (`checkDocumentedCssVariables`) scans every doc page for a backticked
variable with the regex ``/`(--(?!wm-)[a-z][a-z0-9-]*)`/g`` — `--wm-*` is exempt, `--wui-*` is
**not** — and fails unless the name appears as `var(--x`, `setProperty('--x'` or `--x:` somewhere in
`packages/{score,audio,ui}/src`.

Verified failure: documenting `--wui-harmony-ink` before the source declares it gives
`uikit/views-analysis/pitch.mdx documents --wui-harmony-ink, which nothing in packages/*/src reads,
writes or declares.`

**This cuts both ways at the last commit:** `score/element/analyze/analysis-view.mdx:64` currently
backticks eight `--webscore-analyze-*` names. Keep the compat fallback alive in source **or** delete
the names from the page in the same commit.

**A.3.4 — an element source may not `setProperty('--wm-…')`.**

`check-architecture.mjs:1232-1235`. `<analysis-view>` writing `--wm-degree-root` fails with
`<analysis-view> writes the kit token --wm-degree-root in …; presenters take options, not token
writes from their elements.` This constrains how `scheme`/`density` reach the presenters: push them
through **mount options** and `data-*` attributes, never token writes. (`data-scheme` is fine.)

**A.3.5 — the element layer may not create interactive or SVG nodes.**

`check-architecture.mjs:1184-1197`: an element source may not `createElement`/write markup for
`button|input|select|option|canvas|svg`, nor touch `.innerHTML`/`.outerHTML`. The workbench tabs,
dock switches and SVG must be built by `mountWorkbench` / `mountStaff` / `mountWheel`, never by
`analysis-view.ts`. (The design already puts them there; do not "just add a button" during step 9.)

**A.3.6 — new score `core/*.ts` files are orphans unless barrelled.**

`checkInternalSourceReachability` (`check-architecture.mjs:954-972`) is **generic, not ui-only**.
Commit 2's four new modules must be reachable from a score build entry
(`packages/score/tsup.config.mjs:13-40`, `moduleEntries`). The cheap route: add
`export * from './chord-spelling';` etc. to `packages/score/src/analyze/core/index.ts`, which is
reachable (`analyze/api/index.ts:11` imports from `'../core'`). This does **not** widen the public
surface — `api/index.ts` re-exports by name, so the new symbols stay internal.

**A.3.7 — `check:doc-snippets` compiles the new pages' `## Import` fences against `dist`.**

`scripts/check-doc-snippets.mjs` extracts every fenced `ts` block containing `from '@webmusic/` and
type-checks it against the **built** `.d.ts`. The three new uikit `## Import` blocks are real
compilation units — a wrong option key or argument count is a gate failure. They only resolve after
the exports map lands **and** `npm run build:packages` has run. The root chain already orders it
(`package.json:27`: `check:docs → build:packages → check:doc-snippets`).

**A.3.8 — `npm run docs:build` is a separate CI job that `npm run check` does not cover.**

`.github/workflows/ci.yml` has two jobs: `check` (matrix Node **22 and 24**) and `docs`
(`npm run docs:build`). An `.mdx` that type-checks but fails to build — a bad component import, a
missing demo module, an unknown `consumerTag` (`UiPresenterRelated.astro:19` **throws at build**) —
passes `npm run check` and reds CI. **Add `npm run docs:build` to the acceptance criteria of every
commit that touches `.mdx` or the demo files.**

Also from that workflow: `NODE_OPTIONS: --max-old-space-size=6144` exists because score's 25-entry
tsup dts worker OOMs on hosted runners. **Adding score export entries risks a CI-only OOM invisible
locally** (score builds in 14 s at the default heap here). This plan adds no score export entries —
keep it that way.

**A.3.9 — `packages/ui/tsconfig.json:14` excludes `test`.**

`npm run typecheck -w @webmusic/ui` does **not** typecheck ui's tests. Only the root
`npm run typecheck:tests` (`tsconfig.test.json:21-24`) does. Never skip it on a test-touching commit.
And note `check:source` runs `typecheck:tests` **before** `npm test`, so a half-migrated
`elements.test.ts` fails the gate before vitest even runs.

**A.3.10 — `packages/score/test/dist-exports.test.ts:14` is `describe.skipIf(!hasDist)`.**

With no `packages/score/dist` the whole built-dist regression suite **silently skips and exits 0**.
Always build score before trusting its test run. Likewise: score/audio source imports
`@webmusic/ui/analysis`, whose exports map points at `./dist/` — on a cold tree, **build ui before
running score/audio tests**.

**A.3.11 — `observedAttributes` is parsed out of source text, and the parser is brittle.**

`check-docs.mjs:76-95`. The regex requires the array to close with a literal `];`. `return [...] as const;`,
`return [...].slice()`, or returning a module-level const **by name** all produce
`no \`static get observedAttributes()\` found`. A `...SPREAD` is resolved only from an
`UPPER_SNAKE` const **in the same file** (`:52-72`) — a cross-file import is not resolved. Each
comma-separated segment yields at most one literal. Keep the array inline.

**A.3.12 — two per-subpath test files nobody auto-discovers.**

`packages/ui/test/ssr.test.ts:4-25` is a hand-written import list — new mounts are otherwise **not
SSR-covered**. `packages/ui/test/stylesheet-option.test.ts:17-46` has a `MOUNTS` table — new mounts
are otherwise **not dual-path-covered**. Neither is gated. Extend both in each subpath commit.

**A.3.13 — splitting `views-analysis.ts` breaks the gate.**

`check-architecture.mjs:1381-1386` hard-codes exactly four demo filenames. A new
`views-analysis-workbench.ts` would be invisible and its dispatch would fail `compareExactSet`.
The file is already 707 lines / 23 KB and three real demos plus a shared `WORKBENCH_FIXTURE` will
roughly double it. **If you split it, you must edit that hard-coded array in the same commit.**

**A.3.14 — a phantom npm dependency passes every gate.**

`check-architecture.mjs:734` — `if (!packages.has(dependency)) continue;` skips all third-party
specifiers. `import {note} from '@tonaljs/pitch-note'` inside `packages/score/src` would pass
architecture, typecheck and tests, and break only for a published consumer whose installer hoists
differently. **Do not reach for `pitch-note`.** If anyone does, the `package.json` edit is
mandatory — and regenerating the lock means deleting `node_modules` *and* `package-lock.json` first
(`dev/DEVELOPMENT.md:243-246`; npm `overrides` are silently ignored over a stale lock, and the root
has one: `"@astrojs/sitemap": "3.1.6"`).

**A.3.15 — a real product bug in `analysis.ts` that only the jsdom migration will surface.**

`ANALYSIS_ACTIVE_STYLE` (`analysis.ts:99-100`) begins with `background:` and is concatenated onto
idle strings that **do not end with `;`** (`:217, :223, :246, :252, :282`). The result is one
malformed declaration — `…padding:.2rem .45rembackground:var(…)` — so **the idle string's last
declaration and the active `background` are both dropped, in every real browser.** Only `outline`
survives, which is exactly why `.includes('outline')` still passes everywhere.
`playhead.test.ts:33` is the one fixture that uses a trailing `;`, and its `:100` assertion is
written against jsdom's normalised `'display: flex'` — proof someone already hit this.

**Fix it in commit 1** (every idle string ends with `;`) and add an assertion. No existing test
asserts the absence of the background, so the fix is safe.

Distinguish it from a **jsdom-only artifact**: jsdom's `cssstyle` truncates a declaration list at a
`;;`, so the `muted()` + `x.style.cssText += ";font-size:…"` idiom (`analysis.ts:209, 222, 239, 287,
308, 317`) silently loses everything after the doubled semicolon **under jsdom** (real browsers skip
an empty declaration correctly). Consequence for the migration commit: **do not write an assertion on
any declaration that follows a `muted()` call.**

**A.3.16 — 🔴 the flow viewport must be `overflow: clip`, not `overflow: hidden`, and it must be commented as such.**

An `overflow: hidden` box **is** a scroll container in the programmatic sense. `createAnalysisPlayhead`
calls `next[0]?.scrollIntoView?.({block:'nearest', inline:'nearest'})` on every newly active node
(`analysis.ts:168-171`, `options.scroll` defaults to true). Inside a lane that writes a `transform` every
frame, that permanently shoves the reel relative to the viewport and the anchor is finished.
`overflow: clip` creates **no** scroll container at all, so `scrollIntoView` is a no-op inside it.

Write both, in this order — an old engine takes the first and the transform still works:

```css
.wui-harmony-flow__viewport { overflow: hidden; overflow: clip; }
```

Belt-and-braces: the viewport listens for `scroll` and zeroes `scrollLeft`/`scrollTop` when it fires.
That costs nothing until something actually scrolls — **do not read `scrollLeft` per frame**, it forces
a synchronous layout.

**And it is a diagnostic, not just a guard.** The node that gets scrolled into view is always the one whose
span contains `now` — i.e. the one sitting on the anchor, which is by construction on screen. **If the page
starts scrolling sideways, the lane's stamp units and the playhead's units have diverged.** The page tells
you.

---

**A.3.17 — `internal/frame.ts` must be reachable from all three build entries, and its three types must be re-exported.**

`checkInternalSourceReachability` (`check-architecture.mjs:954-972`) is generic: an internal module that no
build entry reaches is an orphan-source error. `internal/frame.ts` is imported by `harmony.ts` (the lane) and
`workbench.ts` (the shell); `pitch.ts` only needs its **types**, and a type-only import does **not** satisfy
reachability — so either give `pitch.ts` a runtime use or accept that two entries reach it (two is enough).

Separately: `FrameClock`, `FrameTick` and `MotionMode` appear in the **public signatures** of
`mountFlowLane`, `mountNameplate`, `mountKeyboard`, `mountStaff`, `mountFretboard` and `mountWorkbench`.
Each subpath must `export type {FrameClock, FrameTick, MotionMode} from './internal/frame';` or a consumer
gets a type they cannot name. All three subpaths re-export the **same original binding**, so the three
`export *` lines in `packages/ui/src/index.ts` do not collide (§C.0 note 14's collision warning is about
*different* declarations sharing a name).

`checkInternalCycles` (`:974-1000`) still holds: `harmony.ts` must not import `pitch.ts` or vice versa.
Both may import `internal/frame.ts` — the edges are one-directional.

---

**A.3.18 — 🔴 the substring `outline` is reserved for `createAnalysisPlayhead`. No other live highlight may contain it.**

Six assertions detect "is it lit" with `cssText.includes('outline')`:
`elements.test.ts:583, 586, 607, 639, 645` and `analysis.test.ts:89`. The substring test also matches
`outline-offset` and `outline-color`, so an approach-shading rule using either one flips a negative
assertion to a false positive.

The sharpest of the six is `elements.test.ts`'s **one-active-segment** case (`:465-471` today; find it by its `filter(includes('outline'))`): **exactly one** active segment, and
`active[0] === segments[0]`. A scrolling ribbon that lights both the sounding chord and the approaching one
takes that count to 2 the instant approach shading touches `outline`.

**Rule:** `createAnalysisPlayhead` owns the `outline` property exclusively (`harmonyParts.activeSpan`,
`harmony-style.ts:681`). Every other live state in this family — `data-zone`, approach shading, motif
sibling highlight, voice-leading attention narrowing, rhythm pre-light — paints with `background`,
`opacity`, `border-color` or a custom property. **One rule keeps ~7 assertions green for free.**
Make it an explicit acceptance criterion of C.7b, C.11 and C.13.

---

**A.3.19 — `createPlayheadHighlighter`'s scrolling is pinned by a test; do not change its default.**

`packages/score/test/analyze/playhead.test.ts:61, 66, 69` assert exact `scrollIntoView` counts through
`createPlayheadHighlighter`, which calls `createAnalysisPlayhead(root)` with **no options**
(`element/internal/playhead.ts:21`). Flipping that call to `{scroll: false}` reds the test **and** silently
removes auto-scroll from the legacy list elements.

**Correct shape:** `createPlayheadHighlighter(options?: {scroll?: boolean})`, default unchanged; only the
workbench passes `false`. Adding a parameter does not violate the playhead whitelist — that scan bans the
literal texts `querySelector`, `.style` / `.cssText` and `ANALYSIS_SPAN_SELECTOR` (comments included), not
arguments (`check-architecture.mjs:1269-1285`). A.3.16's `overflow: clip` is the second guard, so a host that
ignores the option still cannot desync the lane.

**A.3.20 — 🔴 what jsdom does NOT provide. Measured in C.5, and the reason four C.7b acceptance rows would
otherwise pass while measuring nothing.**

Measured on vitest 3.2.7 / jsdom 24.1.3, inside the C.5 harness (a real custom element appended to
`document.body`). The failure mode is the dangerous one: **every gap reads back as `0` or `undefined`, never
as a throw at the point that matters.**

| what | jsdom 24 | consequence for the live turn |
|---|---|---|
| `document.createElementNS`, `setAttribute`, `classList`, `dataset`, `MutationObserver`, `performance.now`, `document.visibilityState` | ✅ real | C.5 delivers exactly the dependency §8 names — B2 is discharged |
| `requestAnimationFrame` / `cancelAnimationFrame` | ✅ present, but a **real ~16 ms wall-clock timer** | a self-driving lane ticks nondeterministically in any test that merely `await`s |
| `getBoundingClientRect()`, `offsetWidth`, `clientWidth` | ⚠️ present, **all `0`**, even after an inline width | anything sized from a measurement is **vacuously green** |
| `matchMedia` | ❌ absent (zero occurrences in the repo today — `watchReducedMotion` is the first use) | an unguarded call throws on the first mount |
| `ResizeObserver`, `IntersectionObserver`, `Element.prototype.animate`, `Element.prototype.scrollIntoView` | ❌ absent | ditto. `analysis.ts:175` survives only because it is written `next[0]?.scrollIntoView?.(…)`; `playhead.test.ts:36` hand-installs its own |
| custom-property **inheritance** | ❌ — `getComputedStyle(el).getPropertyValue('--x')` resolves only where the declaring rule matches `el` itself, or where the property is inline on `el`. A token declared on `:root` reads back as `''` on a descendant | `parseFloat('')` is `NaN`, and C.7b's own rule is that a non-finite number writes **no attribute at all** |
| `style.cssText` | normalising serialiser: spaces after colons, lowercased, `.2rem` → `0.2rem`, trailing `;` always appended | compare against the normalised form or use `getPropertyValue`. A.3.15 |
| a constructor registered under a **second** tag | ✅ **allowed** — jsdom 24 does not raise `NotSupportedError` here | do not build a test split on the belief that it does |
| assigning over `globalThis.customElements` under jsdom | ✅ succeeds, and overwrites `window.customElements` for the rest of the file | why `elements-ssr.test.ts` keeps the fake-registry cases in `node` |

**Three consequences, each owned by a later commit:**

1. **C.6** — `pitch.ts` must not call `matchMedia` at mount time (its live scope declares `MotionMode` on all
   three mounts, but `watchReducedMotion` does not land until C.7b): make `motion` an explicit option or a
   `data-motion` read, or every jsdom case in `packages/ui/test/pitch.test.ts` throws on the first mount. And
   no numeric geometry may be read from a `--wui-*` token through `getComputedStyle`.
2. **C.7b** — `FlowLaneOptions` (design §3.6.5) has `scale` and **no width fallback**. Add
   `fallbackWidth?: number`, mirroring `mountMinimap`'s `{fallbackWidth, fallbackHeight}`
   (`packages/ui/src/minimap.ts:36-37,161-162,176-177`, which falls back
   `root.clientWidth || canvas.clientWidth || fallbackWidth`). Without it, four accept rows are **vacuously
   green rather than red** at W=0: the reel transform (`anchor·W − now·pxPerUnit` loses its anchor term, so
   "stepped and continuous differ only in the reel transform" compares 0 to 0), viewport culling / the
   `IntersectionObserver` rejoin case, ⌘+wheel zoom, and pointer-drag → `seek(p,'drag')`. The rows that
   **do** survive W=0 are the band boxes (`left`/`width` as a percentage of `axis.span`), because design
   §3.6.1 makes an item node's inline style a pure function of its own fields — keep them.
   C.7b's own test files must therefore install: a fake `ResizeObserver` whose callback the test fires
   (copy `packages/ui/test/minimap.test.ts:148-157`), a fake `matchMedia` returning
   `{matches, addEventListener, removeEventListener}`, and a per-element `getBoundingClientRect` override
   (copy `packages/ui/test/stage.test.ts:324-325`). **These belong in `packages/ui/test/`, not in
   `packages/score/test/`** — a score test module cannot be imported across the package boundary, and C.5
   would otherwise ship a support file with no consumer.
3. **C.11** — `packages/score/test/analyze/workbench-views.test.ts` has **no deterministic clock seam**.
   C.7b's accept ("assert against a fake `view`") and C.8's `WorkbenchHandle.tick()` both work only where the
   test constructs the mount; the element reaches `ownerDocument.defaultView` itself and the test never sees
   the mount. And the obvious reach is a trap: `elements.test.ts`'s `flush()` is `setTimeout(…, 0)`, so a
   blanket `vi.useFakeTimers()` **deadlocks every existing case** unless each `await flush()` is advanced
   with `advanceTimersByTimeAsync` (measured). Decide the seam in C.11 — an injected clock on the element, or
   an exported `tick()` on the recipe — before writing the first case.

---

---

## B. BLOCKERS

Each blocker makes a planned commit impossible or materially harder than the design assumes.
The "which commit" column uses the **§C labels**, which are the post-live-turn numbering (§D.5).

| # | Blocker | Which commit | Concrete workaround |
|---|---|---|---|
| **B1** | `npm run lint` is red on untracked `.probe/probe1.mjs` — no commit in this series can be gate-green until it goes | all | `rm -rf .probe/` as commit 0. §0. |
| **B2** | Design steps 3/4/5 have `<analysis-view>` mount a new presenter into a dock while `elements.test.ts` is still on `StubNode`. `mountStaff`/`mountFretboard`/`mountWheel` call `document.createElementNS` — **absent from the stub document** (`elements.test.ts:69` grafts only `createElement`). `markEmptyState` and `setParts` call `setAttribute` — **absent from `StubNode`**. Any of these **throws**. | C.6, C.7, C.7b, C.8 (and C.11) | **Move the jsdom migration to before the three subpath commits — it is now C.5.** See §D. If you refuse to reorder: use a bare side-effect `import '@webmusic/ui/pitch';` in `analysis-view.ts` — verified to satisfy `compareExactSet('30-element UI import closure')` because `isTypeOnlyDeclaration` (`check-architecture.mjs:454-457`) returns `false` for a clause-less import — and wire the real docks only in the shell commit. |
| **B3** | Design step 6's instruction ("delete `:12-154`, zero cost") does not compile: 60 references break and 6 assertions fail/throw. | C.5 | Split the file. `:175-234` → new `elements-ssr.test.ts` with `// @vitest-environment node`. `:236-648` → jsdom, ported onto the `new-elements.test.ts:12-51` harness. Keep the listener-counting player stub — jsdom has no substitute. Budget a real commit. A.2.1. |
| **B4** | `ChordNaming.score: number` has no data source; `detect()` returns `string[]`. | C.3 | Replace with `kind` + ordinal `rank`, or delete. Do not derive a 0…1 score from array position — ties are frequent. A.1.1. |
| **B5** | `rootDegree` is `NaN`; `??` does not catch it; it differs across the worker's JSON vs structuredClone paths. | C.3, C.12 | `Number.isFinite(...)` guards everywhere. Do not put it on a type that crosses the worker boundary. A.1.2. |
| **B6** | Circle-of-fifths and diatonic-step math exist but live in `view`, which `analyze` may never import (`package-policy.mjs:142`). And the two conventions differ (C4 = 0 vs C4 = 28). | C.3, C.4 | Duplicate in `analyze/core/` with a header comment naming `packages/score/src/view/core/{note-sequence.ts:18, layout.ts:73-90}` and the `+28` offset. Lifting into `packages/score/src/core/` is the clean alternative but drags `view` and `test/view/layout.test.ts` into commit 2. A.1.3. |
| **B7** | Four of six views have no MIDI notes to feed `projectSounding()` — `ChordSegment` carries only pitch classes. | C.11 | Change the projection signatures to take the `Score`: `projectProgression(result, score, mode)`. Use `notesOverlapping` the way `core/summary.ts:86` does. Do **not** add a field to `AnalysisResult` — it is the frozen worker payload. A.2.11. |
| **B8** | The `error` phase has no plumbing at all: `score-source.ts:61-64` console-errors and returns `undefined`; `#refresh` cannot tell "no `src`" from "load failed". | C.11 | Change `ScoreSource.load()`'s return to `{score?: Score; error?: string}` (private module, no public API break) and surface it through the workbench status bar. Add to §7.3's break list. A.2.12. |
| **B9** | The natural `.wui-*` root class for essentially every new mount is already declared by `apps/doc/shared/ui.css` — `check:docs` goes red the moment the ui source lands, **before** any doc page exists, and **comments count**. | C.6, C.7, C.7b, C.8 | Namespace every root: `.wui-pitch-keyboard`, `.wui-harmony-chip`, `.wui-workbench`, … A.3.1. |
| **B10** | The design's own sample JSDoc (`design:175`, `:235`) contains the sharp glyph, which red-lines the very gate §11 cites. | C.6 | Rewrite to `F#4` / `Gb` before pasting. A.2.4. |
| **B11** | §7.4's promised "free dark theme for audio's five elements" is impossible: `analysisStyle` is never installed and `cssText`/`paint()` cannot carry `@media`. | C.2 | Either make `createAnalysisRoot` install `analysisStyle` (bounded behaviour change — run all three suites) or scope the commit message and §7.4 down to "new surfaces only". A.2.3. |
| **B12** | The "Am9 (no root)" alternate — the design's flagship interaction and its stated verification experiment — is not producible by `detect()`. | C.4, C.11 | Drop it from the demo copy, or budget an `extended()`/`reduced()` superset search in commit 2. A.2.10. |
| **B13** | `spelling: 'sharp' \| 'flat'` cannot be implemented with `pcName()`; the design's own test fails against it. | C.3 | Write `SHARP_NAMES` and `FLAT_NAMES` (12 entries each). Still zero new deps. A.2.7. |
| **B14** | The `empty` phase's per-view sentences would break `analysis.test.ts` if they were added to the six span-carrying renderers. | C.9, C.11 | Empty copy lives in the workbench shell, never in the six static renderers. A.2.12. |
| **B15** | **The design's original promise that the six renderers become thin shells over the live mounts cannot be kept.** `(data, root) => void` returns nothing to drive, and `analysis.test.ts:29-30` pins exactly 2 span nodes with no others — a live lane whose now-line carries `data-start-quarters` makes it 3. Delegation forces the live mount to be less live so the shim's node budget survives. | 9 (was 7a/7b) | Design §7.1 reverses it: the six stay static, unchanged, **not** deprecated, as shims *beside* the live mounts, sharing only `harmony-style.ts` and `internal/spans.ts`. C.10 is withdrawn; C.9 shrinks. **This retires risk R1.** |
| **B16** | **`bindAnalysisPlayer` throws away everything but `detail.seconds`** (`element/internal/player-binding.ts:26-28`), including the rate. Rate is the one quantity that **cannot** be recovered by differencing — a finite difference cannot tell a tempo change from a seek. Without it a scrolling lane is wrong for a whole cursor interval after every `retune()`. | 11 (C.10b) | Widen the handler to `timeUpdate?(seconds, update: AnalysisTimeUpdate)`. `seconds` stays first, so `score-map.ts:240` and `analysis-timeline.ts:196` are untouched. Read rate as `nominalDuration / transportDurationSeconds` — defined even at position 0, where `nominal/transport` is 0/0. |
| **B17** | 🔴 **`<analysis-timeline>` seeks to the wrong place at `rate ≠ 1`.** `#seek` computes `score.timeMap.quartersToSeconds(...)` — **nominal** seconds — and hands it to `player.seek(seconds)`, which takes **rate-scaled transport** seconds: `score-player-scheduler.ts:216-229` clamps against `duration = timeline.duration / rate`, then `seekTo(clamped * rate)`; `simple-score-player.ts:410-416` forwards unchanged. At `rate = 1` they coincide, which is why no test caught it. | 10 (C.10a) | `player?.seekNominal?.(seconds) ?? player?.seek?.(seconds / rate)`. **Keep the event detail in nominal seconds** — it is documented, and nominal is the analysis axis. Fix `<analysis-timeline>` and the workbench the same way. Its own tiny commit with a `rate = 2` jsdom regression. |
| **B18** | **`<analysis-histogram>` cannot bind a player at all** — `observedAttributes` is `['src','format','type']` (`analysis-histogram.ts:33-35`) — and the two candidate data sources use **different units**: `createLiveKeyTracker` (`live-trackers.ts:82-103`) is **count-weighted** and never exposes its bins; `distributions().pitchClasses` (`core/distributions.ts:87`) is **duration-weighted**. Drawing a count-weighted "heard" bar over a duration-weighted "total" ghost is two units on one axis. | 14 (C.13) | Add `player` to `observedAttributes` **and** to `params/score-analyze.ts:113-131` at the same index, in the same commit. Add `createLiveDistributionTracker` to `headless/live-trackers.ts` — duration-weighted (`noteOn`/`noteOff` pairs give the length), exposing `bins()` and `heard`, same file, same shape, same `validateMidi` guard, exported from `headless/index.ts`. |
| **B19** | **A frame loop per mount is the wrong default and the two existing precedents teach it.** `meter.ts:245-249` and `stage.ts:667-674` each own a private rAF — correct for one independent widget, six wake-ups with no shared budget on one workbench page. But the shell cannot own the loop either: the docs site mounts a lone `mountFlowLane` with no shell, and `pitch.ts`/`harmony.ts` may not import each other (`checkInternalCycles`). | 7 (C.7b) | Three layers (design §0.5 #3): `internal/frame.ts` owns **one rAF per document**; `mountWorkbench` owns **the single reading per frame** and hands slot mounts a `FrameClock`; score's `headless/transport-clock.ts` owns the prediction. A mount given no `clock` joins the shared loop itself. |
---

#### C.5 aftermath — read these anchors as DESCRIPTIONS, not line numbers

The jsdom migration cut `elements.test.ts` from 648 lines to 511, so **every line anchor above 418
in the pre-C.5 numbering is dead**, and C.11 / C.13 / C.14 will move them again. The four this brief
leans on, located by content in the landed tree:

| assertion | pre-C.5 | today | find it by |
|---|---|---|---|
| exactly one active segment, and it is the first | `:639-641` | `:465-471` | `filter(… includes('outline'))` |
| the chords view's root has a direct `<ol>` child with children | `:296-299` | `:207-210` | `find(child => child.tagName === 'OL')` |
| `<score-analysis>` with no score renders nothing | `:260-264` | `:185` | `expect(host.children).toHaveLength(0)` |
| the listener-counting player stub | `:541-542` | `:85-115` | `stubPlayer`'s wrapped `add/removeEventListener` |

C.5 also **re-expressed the incremental-analysis assertions**. The bare `toContain('C major')` /
`toContain('A minor')` passed on BOTH renders, because the key wheel prints neighbour keys and a
C-major render already contains the string `A minor` — the file's only test that a second `.score`
assignment is analysed at all could not fail. They now read `toContain('C major confidence')` and
`toContain('A minor confidence')` (`:244`, and the incremental case), which only work because the
harness reads text node by node and joins with a space; `textContent` fuses the two into
`C majorconfidence`. **The reader and the assertion move together — never change one alone.**

---

## C. Commit-by-commit

Numbering below is the **corrected** order argued in §D. The parenthetical is the row number in
design §8, which was itself renumbered by the live turn (16 rows now: three added, one withdrawn,
one split). C.10 is **withdrawn** — read its stub before assuming it was forgotten.

### C.0 — Reusable block: THE 13-SITE SUBPATH REGISTRATION

Substitute `<name>` = `pitch` / `harmony` / `workbench`; class slug is `views-analysis` for all three;
`<N>` = the new count (19 / 20 / 21). **All 13 land in one commit — every partial state was replayed
and every one fails.**

| # | Site | Edit |
|---|---|---|
| 1 | `packages/ui/src/<name>.ts` (**new**) | the module. Orphan-source error without site 2. |
| 2 | `packages/ui/package.json:179` (the `build` script string) | insert ` src/<name>.ts`. Position irrelevant. `packages/ui` has **no `tsup.config.mjs`** — entries are regex-scanned out of this string (`check-architecture.mjs:99-124`). |
| 3 | `packages/ui/package.json` `exports` (`:10-172`) | add the nested block below. Key order not gated. `files` and `sideEffects` need no edit. |
| 4 | `scripts/package-policy.mjs:38-59` | insert `"./<name>",` into `expectedPublicEntries['@webmusic/ui']`. |
| 5 | `scripts/check-architecture.mjs:1048` | `!== 18` → `!== <N>` |
| 6 | `scripts/check-architecture.mjs:1049` | the message string `exactly 18` → `exactly <N>` |
| 7 | `scripts/check-architecture.mjs:51` | `'views-analysis': ['stage','status','track-list','analysis', …, '<name>']` |
| 8 | a **runtime, non-type, non-dynamic** import of `@webmusic/ui/<name>` anywhere in `<analysis-view>`'s static closure | most naturally `packages/score/src/analyze/element/analysis-view.ts` or `element/internal/renderers.ts` |
| 9 | `apps/doc/shared/ui-presenter-catalog.ts` (`UI_PRESENTER_CATALOG`, `:115+`) | new entry — `presenter:` **immediately before** `classSlug:` (the scrape regex at `:1336-1338` is lazy) |
| 10 | `apps/doc/shared/ui-presenter-catalog.ts:7-25` | add the name to `UiPresenterName`. **Required but ungated** — `astro check` only reports diagnostics for files inside `apps/doc/webmusic/`, and `apps/doc/shared/` is outside the Astro root. Verified: `astro check` returns 0 errors with the union broken. |
| 11 | `apps/doc/webmusic/src/lib/ui-presenter-demos/views-analysis.ts:702-705` | `if (presenter === '<name>') return mount<Name>Demo(host);` **plus the real ~150-line demo** |
| 12 | `apps/doc/webmusic/src/content/docs/uikit/views-analysis/<name>.mdx` (**new**) | see skeleton below |
| 13 | `apps/doc/webmusic/src/content/docs/uikit/api.mdx` (table at `:41-58`) | a row containing the literal `@webmusic/ui/<name>` and a link to `/uikit/views-analysis/<name>/` |
| (14) | `packages/ui/src/index.ts` | `export * from './<name>';` — **ungated**, but omitting it silently breaks the root barrel that `packages/ui/README.md:430` and `uikit/api.mdx:36` promise. Watch for `export *` name collisions with the other barrels — that **is** a `tsc` error. |
| (15) | `scripts/element-composition-policy.mjs:21` | `['analysis','pitch','harmony','workbench']` — ungated in this direction, but never add a name before its import exists (A.2.15). |

Exports block, verbatim shape (`check-package-exports.mjs:77-89` requires `import.types` to end
`.d.ts` and `require.types` to end `.d.cts`):

```json
    "./<name>": {
      "import": { "types": "./dist/<name>.d.ts",  "default": "./dist/<name>.js" },
      "require": { "types": "./dist/<name>.d.cts", "default": "./dist/<name>.cjs" }
    },
```

Minimal uikit page that passes every check (`check-architecture.mjs:1405-1452` + `check-docs.mjs:174`):

````mdx
---
title: '@webmusic/ui/<name>'
description: '…'
sidebar:
  label: '<name>'
  order: 5
---

import UiPresenterLiveDemo from '../../../../components/UiPresenterLiveDemo.astro';
import UiPresenterRelated from '../../../../components/UiPresenterRelated.astro';

One to three paragraphs of positioning prose.

<UiPresenterLiveDemo presenter="<name>" />

## Import

```ts
import {mountKeyboard} from '@webmusic/ui/<name>';

const handle = mountKeyboard(host, binding);
```

<details class="component-section">
<summary>API</summary>
…
</details>

<details class="component-section">
<summary>Styling</summary>
…
</details>

<UiPresenterRelated presenter="<name>" />
````

Order is checked by `page.indexOf` on all five markers and the file must **end** with Related.
Title must be the exact string. Existing `views-analysis` sidebar orders: stage 1, status 2,
track-list 3, analysis 4 → new pages take 5 / 6 / 7. No `astro.config.mjs` edit — the sidebar is
`autogenerate: {directory: 'uikit/<slug>'}` (`:65-68`). The relative import depth is exactly four
`../` from `content/docs/uikit/<class>/<page>.mdx`; `dev/UIKIT-PAGE-TEMPLATE.md:60-100` omits the
`UiPresenterRelated` import in its printed skeleton — that is a bug in the template, every real page
has it (`uikit/views-analysis/analysis.mdx:9-10`).

Catalog entry minimum (`UiPresenterEntry`, `ui-presenter-catalog.ts:22-40`):
`presenter`, `classSlug`, `label`, `summary`, `api` (a template literal), `consumerTags`
(every tag must exist in `UI_COMPOSITION_CATALOG` or `UiPresenterRelated.astro:19` **throws at
`docs:build`**), and `state`/`options` — **without at least one of those two the live demo renders no
control strip** (`UiPresenterLiveDemo.astro:16-19`). A three-mount subpath should also supply
`invocation: {name, arguments}`, or the readout picks whichever `mount*` appears first in `api`
(`UiPresenterLiveDemo.astro:26`). The demo must return a `UiPresenterDemoHandle` or a bare cleanup
function; returning `undefined` for a catalogued presenter throws at `ui-presenter-demos/index.ts:23`.

Gate command for any subpath commit:

```
npm run build -w @webmusic/ui && npm run check:architecture && npm run check:docs   # ~4 s pre-flight
npm run check                                                                       # ~76 s
npm run docs:build                                                                  # separate CI job
```

---

### C.1 (commit 0) — `chore: the probe scratch is not part of the repo`

| | |
|---|---|
| **Delete** | `.probe/` (`.probe/probe1.mjs`) |
| **Decide** | whether `dev/plans/analysis-workbench-design.md` and `dev/prototypes/harmony-workbench.html` are committed here (recommended: yes, both, explicitly — `dev/plans/` is already tracked) |
| **Gate** | `npm run lint` |
| **Accept** | `eslint .` exits 0; `npm run check` reaches the end (75.6 s) |

---

### C.2 (design step 1) — `refactor(ui): the analysis skin is one token record, not eight literals`

| | |
|---|---|
| **Create** | `packages/ui/src/harmony-style.ts` — `ToneRole`, `toneFill/toneInk/toneMark`, `harmonyTokens`, `harmonyLiterals`, `harmonyStyle`. Model it on `packages/ui/src/styles.ts` (`Declarations` `:28`, `rule()`/`body()` generators `:167-174`, `states` block `:180-243`). Import `Declarations` **type-only** (`import type {Declarations} from './styles';`) — a plain named import drags `faderStyle`/`knobStyle` in at runtime. |
| **Create** | `packages/ui/test/token-chain.test.ts` |
| **Modify** | `packages/ui/src/analysis.ts` — inline `cssText` strings read from the record; old `--webscore-analyze-*` / `--wm-analysis-*` names as the innermost fallbacks; **every idle string now ends with `;`** (A.3.15) |
| **Decide** | B11 — install `analysisStyle` in `createAnalysisRoot`, or scope the dark-mode promise down |
| **Gate** | `npx eslint packages/ui/src packages/ui/test && npm run typecheck -w @webmusic/ui && npm run typecheck:tests && npm test -w @webmusic/ui && npm run check:architecture && npm run check:docs && npm run build -w @webmusic/ui && npm test -w @webmusic/score && npm test -w @webmusic/audio` (~20 s) |
| **Accept** | `packages/ui/test/analysis.test.ts` (236 lines, 16 tests, 45 expects) unchanged and green · `packages/score/test/analyze/**` (146 tests) green · `packages/audio/test/analyze/analyze-elements.test.ts` green · `token-chain.test.ts` asserts each `--wui-harmony-*` chain contains its `--webscore-analyze-*` predecessor · a new assertion proves the active highlight now carries `background` |
| **Do not** | use any of the 43 reserved `.wui-*` names (A.3.1) — not even in a comment |
| **Note** | `harmony-style.ts` stays unpublished; that is legal because `analysis.ts` imports it (`checkInternalSourceReachability`, `check-architecture.mjs:954-972`) |
| **B11 decided** | Scope down, and one step further than the design's own wording: `createAnalysisRoot` installs nothing AND declares no `color-scheme`. Dark mode arrives by INHERITING the host page's scheme, so it reaches a dark-capable page and leaves a light-only one alone. That is what lets every A-group `light-dark()` keep the old byte on its light side — see the `LIGHT_DEFAULT` table in `token-chain.test.ts`, which pins the eight defaults printed on five docs pages. Light mode moves no pixel; the one deliberate exception is `--wui-harmony-warning` (`#d98c00` → `#a86a00`, 2.73:1 → 4.44:1 on white). |

**Deferred OUT of C.2 — pick these up where they are named.** Each was raised in adversarial review of
the C.2 tree, is real, and is cheaper to do with a caller than without one.

| # | Item | Where it lands | Why not now |
|---|---|---|---|
| **X1** | Keyboard geometry tokens — `-keyboard-key-white/-key-black/-key-border/-key-label/-key-radius`, plus the black-key width/height ratios and the key gap (design §3.2 names five and declares none) | **C.6** `pitch.ts` | Five ratios guessed without a rendered keyboard are five numbers to re-guess. `--wui-harmony-keyboard-height` (the one the density record switches) already exists. |
| **X2** | Staff geometry — line width and COLOUR (`--wui-harmony-line` is 1.38:1 on the surface: right for a row hairline, invisible as a staff line), notehead rx/ry, ledger width and extent, the second-interval offset (§3.3 makes it kit geometry, so it must be a token), accidental gap, brace width | **C.6** | Same, and the staff-line colour needs a drawn staff to judge. |
| **X3** | Fretboard geometry — fret-wire and nut widths, string width, dot/inlay size, fretboard surface (the only candidate today is `--wui-harmony-track` at 1.18:1), string colour, and `-fretboard-width` for `orientation:'vertical'` | **C.6** | Same. |
| **X4** | Wheel tokens — size, ring width, inner-ring width, segment gap, centre size | **C.7** `harmony.ts` | Nothing at all exists; all five are pure geometry. |
| **X5** | `toneMark()` override — `other` and `ghost` both print `.`, and `extension` prints `9` for every 9/11/13 and altered tone, so a sharp-11 is labelled a 9. The caller always knows the real figure. | **C.6** (first mount that prints a mark) | Adding a parameter no caller passes means seven mounts each pick a default. §2.3 records both. |
| **X6** | `--wui-harmony-size-hero` — §3.5's `emphasis: 'hero' \| 'display'` is two sizes and the ladder has one | **C.7** `mountNameplate` | The second size only means something next to the first. |
| **X7** | Container-query shell — `container-type`, the 720/440px breakpoints, `data-rail="false"`, `--wui-harmony-rail-width`, the §2.1 `grid-template-areas`, `box-sizing: border-box` on the shell root | **C.8** `workbench.ts` | There is no shell yet. Note `box-sizing` deliberately stays OFF the analysis card root — adding it changes the outer size of every existing consumer's box. |
| **X8** | `data-phase` — the five states, `--wui-harmony-phase-dot`, and the 1.6s `listening` breathe keyframes (§2.5) | **C.8** | The phase lives on the shell; `harmonyMotion` and the reduced-motion escape are already in place for it. |
| **X9** | Rewrite the legacy `harmonyParts` lengths onto `--wui-harmony-space-1…5` — 23 length literals, 14 distinct values, only two on the 4px grid | **never, or its own commit** | They are transcriptions of the boxes `analysis.ts` hard-coded. Re-gridding them is a **redesign of those read-outs** — and the live turn decided those read-outs do not get redesigned (design §7.1, B15). C.9 no longer touches their geometry and C.10 is withdrawn, so this has no host commit any more. The scale still exists so the NEW mounts do not invent one. |
| **X10** | Move `Declarations` out of `./styles` into `internal/` — the harmony family currently takes its shared type from the transport's skin module | any later commit | Touches `styles.ts` and its consumers for no behaviour change. |
| **X11** | `/* @__PURE__ */` on `harmonyStyle` so it tree-shakes out of `./analysis` (esbuild keeps the `harmonySheet(...)` call) | resolves itself at **C.6/C.7** | ~2KB, and it stops being dead the moment a mount reads it. |

---

### C.3 (design step 2) — `feat(score): a pitch knows how it is spelled before it knows where it sits`

| | |
|---|---|
| **Create** | `packages/score/src/analyze/core/chord-spelling.ts` · `core/staff-placement.ts` |
| **Create** | `packages/score/test/analyze/chord-spelling.test.ts` · `test/analyze/staff-placement.test.ts` |
| **Modify** | `packages/score/src/analyze/core/index.ts` — `export * from './chord-spelling'; export * from './staff-placement';` (**required**, A.3.6) |
| **Modify** | `packages/score/src/analyze/core/chords.ts:153-154` — the false "spelled with sharps" comment |
| **Must contain** | `SHARP_NAMES` + `FLAT_NAMES` (B13) · `Number.isFinite` guards on `rootDegree` (B5) · ascending sort + lowest-wins pitch-class dedupe copied from `chords.ts:156-167` (A.2.9) · the empty-result fallback for 1-, 2- and 12-note inputs (A.2.9) · a documented same-chroma tiebreak for `'auto'` (A.2.9) · a header comment recording the C4 = 28 origin and its `+28` relation to `view/core/layout.ts` (B6) |
| **Must not contain** | `ChordNaming.score` as a derived 0…1 number (B4) · any `@tonaljs/pitch-note` import (A.3.14) · any import from `../../view` (B6) |
| **Gate** | `npm run typecheck -w @webmusic/score && npm run typecheck:tests && npm test -w @webmusic/score && npm run check:architecture` (~13 s) |
| **Accept** | `spellChord([52,55,59,60])` → primary `Cmaj7/E`, and **E is `bass`, not `third`** · `spellChord([60,64,67,69])` yields both `C6` and `Am7/C` with the role sets `{root,third,fifth,extension}` and `{bass,fifth,seventh,root}` · `spellChord([])` / `[60]` / a 13-note cluster return without throwing and with a non-empty fallback label · `spelling:'flat'` spells pc 1 as `Db` · `staffPlacement(28)` gives middle C with exactly one ledger; `staffPlacement(42)` (C6) gives **2** upper ledgers, `[40, 42]` — a ledger sits only on a LINE position, two diatonic steps apart, and the treble's top line is F5 (38), so A5 and C6 are the only two above it. (The design's "4 条上加线" counted half-spaces; do not "fix" the code back to it.) |

---

### C.4 (design step 3) — `feat(score): a chord knows where a hand can reach it`

| | |
|---|---|
| **Create** | `packages/score/src/analyze/core/fretboard-voicing.ts` (~150 lines, from scratch) · `core/key-wheel.ts` |
| **Create** | `packages/score/test/analyze/fretboard-voicing.test.ts` · `test/analyze/key-wheel.test.ts` |
| **Modify** | `packages/score/src/analyze/core/index.ts` — two more `export *` lines |
| **Modify** | `packages/score/src/analyze/core/staff-placement.ts` — split `keyFifths` (unclamped) out of `keySignatureFifths` (clamped to seven accidentals). The wheel needs a POSITION on the circle and a signature stops at seven, so reading the position off the clamp seats `G#` major on `Db` — a different key, four stops away, not an enharmonic respelling |
| **Must contain** | the circle-of-fifths table duplicated locally with a comment naming `packages/score/src/view/core/note-sequence.ts:18` (B6) |
| **Gate** | same as C.3 |
| **Accept** | `Cmaj7` on standard tuning → `x-3-2-0-0-0` (the design's `3-2-2-4-1-3` is not a shape; it is neither this notation nor a chord) and ukulele → `0-0-0-2` · window-out-of-range and unreachable-midi cases return `[]` without throwing · `projectTonality` labels come from a re-spelling pass, **not** from `KeyResult.tonic` (A.2.7) |
| **Cost model** | `PREFERENCES` prices a mute in TWO ways and the split is load-bearing: a muted string BELOW the shape's own bass is a register choice (`silentString: 2` — `x-x-0-2-3-2` is D major on every chart) and one at or above it is a hole that costs a damping fingertip (`deadString: 7` — the number is set by the ukulele C major that would otherwise come back `0-0-0-x`). A barre is a saving and not an obligation: it is taken when the shape NEEDS one or when it saves more finger than it costs, so `maxBarres: 0` rejects only shapes that genuinely need one |
| **Measured** | cold search on a six-string at the defaults: <1 ms triad or seventh, 2 ms thirteenth, 5 ms seven pitch classes; 7 strings 21 ms, 8 strings 70 ms, 12 strings did not return inside a minute — hence `MAX_STRINGS = 8`. Branch-and-bound was prototyped against this and **rejected**: with an admissible allowance for the barre's finger saving the bound is looser than the walk's own span prune and measured slower. The 3–4× that was taken came from pricing candidates without allocating them (`price` counts, `buildVoicing` writes the winner out once) |

**Deferred OUT of C.4 — pick these up where they are named.** Each was raised in adversarial review of the
C.4 tree, is real, and is cheaper to do with a caller than without one.

| # | Item | Where it lands | Why not now |
|---|---|---|---|
| **Y1** | `FretMark.finger` (design §3.4) — WHICH finger presses which string. `FretVoicing.fingers` is a count and says so; nothing in the repo can produce an assignment | **C.6** `mountFretboard` | An assignment is a second search (finger order, barre coverage, crossing) and it has no consumer until something prints it. |
| **Y2** | The cost model has no term for how a hand DISTRIBUTES fingers across strings. 8 of 144 guitar answers are a four-fret span on four separate fingers with no barre — `B major = x-2-1-4-0-2` reaches fret 4 on the G string while another finger arches over an open B. Every one is fingerable on paper and awkward in a hand | **C.6**, with Y1 | Measured: a super-linear span penalty halves the population and does not fix `B major`; at the strength that does, it breaks the DADGAD `5-2-0-0-2-0` the suite pins as "the widest reach this search will ask for". The honest fix needs the assignment. |
| **Y3** | `FretVoicingOptions.near` — a soft continuity term so consecutive chords do not make the hand leap. `findFretVoicing` is a pure function of one chord and has no memory; the window is the only lever and it is a HARD constraint, so sliding it one fret can change which strings are muted | **C.6/C.11** | The smoothing belongs here, not in the kit — but "how far did the hand move" needs the projection that feeds it chord after chord, and a weight tuned without one is a weight tuned against nothing. |
| **Y4** | `WheelState.trail` (design §3.7) — recent needle positions, the comet tail. `keyWheel` is memoryless by design and returns one needle | **C.7/C.11** | A trail is a history, and history is `projectTonality`'s or the element's to keep. Adding a ring buffer to a memoised pure function would make the memo lie. |
| **Y5** | `packages/score/test/analyze/ui-contract.test.ts` — design §4.1 mandates it, and it cannot exist yet: it imports `@webmusic/ui/pitch` and `@webmusic/ui/harmony` | **C.6** and **C.7**, one row each as the subpaths land | The types it would pin are not written. Until then the assignability was checked by hand against §3.4/§3.7 and holds for whole records. |
| **Y6** | A source-text gate pinning the two twelve-integer fifths tables together (`view/core/note-sequence.ts:18` and `analyze/core/key-wheel.ts`) — idiomatic beside `checkUiDomainVocabulary`, which already `readFileSync`s and regexes | with **B6's lift** into `packages/score/src/core/` | "Change one, check the other" is now written in three prose comments and enforced by nothing. The gate and the lift are the same commit: once the table is shared there is nothing to pin. |
| **Y7** | Public API export of `spellChord` / `staffPlacement` / `findFretVoicing` / `keyWheel`. None of the four is reachable from `analyze/api`, so both new modules tree-shake to zero bytes in `dist` today | **C.11**, once | A batch decision, and C.3 made the same one. Widening the surface per commit means four separate `check:packages` moves for one API. |
| **Y8** | An algorithmic rework of the search — the walk is exhaustive and exponential in string count | no host commit | Measured and priced above. A cap plus a published cost is honest for the instruments this workbench is for; a beam or a position-outer-loop rewrite is a redesign with no caller asking for one. |
| **Y9** | A per-instrument `maxSpan`. Frets 1–4 is a 97 mm index-to-pinky reach on a 25.5" guitar, 130 mm on a 34" bass and 44 mm on a 13" soprano ukulele; `DEFAULT_MAX_SPAN = 4` is one number for all three | **C.6**, with Y1/Y2 | The neck LENGTH half of this shipped in C.4 — `Tuning.frets`, so a ukulele stops at fifteen instead of answering `16-16-15-15`. The reach half needs a scale-length model this module does not have, and it is the same missing model as Y2. A caller who knows better already passes `maxSpan`. |

---

### C.5 (design step 4, **MOVED UP**) — `test(score): the analysis elements run in a real document`

| | |
|---|---|
| **Create** | `packages/score/test/analyze/elements-ssr.test.ts` — `// @vitest-environment node`, holding today's `elements.test.ts:175-234` (`new X()` does not throw, `customElements` undefined, `define*` no-ops, `define` call counts, the sorted 5-tag registry array) |
| **Modify** | `packages/score/test/analyze/elements.test.ts` — `// @vitest-environment jsdom` line 1; harness ported onto `new-elements.test.ts:12-51`; the player stub **kept** (listener counting has no jsdom equivalent); every `NodeList`/`HTMLCollection` consumer spread into an array; `afterEach(() => delete globalThis.customElements)` **removed** (A.2.1) |
| **Preserve, verbatim** | all 32 positive microcopy assertions **plus** `'A minor'` (`:351`), `'13'` (`:257`) **plus** the three negatives at `:337`, `:477`, `:504` (A.2.2) |
| **Preserve** | all 27 structural assertions, notably `host.children.length === 0` (`:264`), the direct `<ol>` child with children (`:296-299`), `host.children.length === 1` (`:339`), `detail.midis` deep-equals, the four listener counts, and `filter(includes('outline')).toHaveLength(1)` with `active[0] === segments[0]` (the **one-active-segment** case (`:465-471` today)) |
| **Forward pointers** | two of those are later, deliberate breaks — `:264` is rewritten in **C.14** (`<score-analysis>` gains an idle skeleton) and the histogram cases in `new-elements.test.ts:146-165` are rewritten in **C.13**. **This commit changes neither.** Porting them faithfully now is what makes the later rewrite a reviewable one-line intent rather than an untraceable diff. See §G.1 rows 24 and 27 |
| **Gate** | `npm run build -w @webmusic/ui && npm run typecheck:tests && npm test -w @webmusic/score` (~13 s) |
| **Accept** | test **count** unchanged or higher across the two files (24 today); no assertion deleted, only re-expressed; `npm test -w @webmusic/score` = 146+ passing |
| **Note** | this commit changes no product code. It is the load-bearing prerequisite for C.6–C.14 (B2) — and the live turn strengthens the reason: `mountFlowLane` calls `createElementNS` for its now-line and `setAttribute` for `data-zone`, neither of which `StubNode` has. |
| **Landed, beyond the port** | (1) the file header is a **ledger of what jsdom does not provide** rather than a claim that rendering is real — the measurements are A.3.20 · (2) `createHost` **wraps** `dispatchEvent` instead of listening for one type, so `dispatched` is again a complete log and the two `filter(type === 'webscore:chordchange')` calls stay meaningful when C.12 adds `webscore:viewchange` / `-chordpick` / `-seek` · (3) two assertions **re-expressed to be stronger**, both mutation-verified: `'13'` → `` `Notes ${C_MAJOR.length}` `` (§G.1 row 26) and `'C major'`/`'A minor'` → `'C major confidence'`/`'A minor confidence'` (§G.1 row 29b) · (4) `elements-ssr.test.ts` restores `globalThis.customElements` instead of deleting it, and its header carries the **measured** reason the fake-registry cases stay in `node` (assigning over `window.customElements` under jsdom succeeds and persists for the rest of the file; jsdom 24 does **not** raise `NotSupportedError` for a constructor registered under a second tag) |
| **Deliberately NOT here** | a shared live-DOM stub module. Its consumers are `packages/ui/test/flow-lane.test.ts` and `frame-loop.test.ts` (C.7b), which cannot import across the package boundary — landing it in `packages/score/test/` would ship a support file with no consumer. See A.3.20 consequences 2 and 3 |

---

### C.6 (design step 5) — `feat(ui): pitch surfaces — keyboard, staff, fretboard`

| | |
|---|---|
| **Create** | `packages/ui/src/pitch.ts` (`mountKeyboard`, `mountStaff`, `mountFretboard`, `staffPlacement`, `fretPositionsFor`, `pitchStyle`) · `packages/ui/src/internal/pitch-geometry.ts` · `packages/ui/test/pitch.test.ts` · `packages/ui/test/no-notation-glyphs.test.ts` · `apps/doc/.../uikit/views-analysis/pitch.mdx` |
| **Modify** | `packages/ui/src/note.ts` — move `isBlackKey`/`pianoKeyLayout`/`NotePianoKey` bodies out, re-export (A.2.5) · `packages/ui/src/index.ts` · `packages/ui/test/ssr.test.ts` · `packages/ui/test/stylesheet-option.test.ts` (A.3.12) · **plus registration sites 2–13 and 15 of §C.0** (18 → 19) |
| **Live scope in this commit** | `PitchMark.since` + the `data-phase` attack/sustain/release diff (design §3.2/§3.4) · `StaffState.follow` + the `data-when` past/now/next/far diff (§3.3) · `FretboardState.firstFret: 'auto'` with one-fret hysteresis · `MotionMode` on all three. **None of the three runs a frame loop** (design R2) — every one of these is one attribute write plus a CSS transition |
| **Gate** | `npm run build -w @webmusic/ui && npm run check:architecture && npm run check:docs` → `npm run check` → `npm run docs:build` |
| **Accept** | the 5 `compareExactSet` calls + `checkPublicEntryPolicy` green · `key(midi)` out of range returns `undefined` · repeated `update()` **diffs by `data-midi`** and does not `replaceChildren` — under live this is a **functional** requirement, not an efficiency one: a rebuild restarts every transition, so the keyboard would be stuck on the first frame of `attack` forever · `clefs` omitted ⇒ **no `<text>` node in the DOM** · `orientation:'vertical'` produces the identical node set and `data-*` as horizontal · `follow:'anchor'` and `follow:'none'` produce the **identical notehead set and `data-*`**, differing only in the reel transform · `data-phase` write count ≤ set-change count over 60 `update()` calls with an unchanged mark set · `no-notation-glyphs.test.ts` green |
| **Watch** | root classes `.wui-pitch-keyboard` / `.wui-pitch-staff` / `.wui-pitch-fretboard` (B9) · **no sharp glyph in any comment** (B10) — design §3.1/§3.3 now spell `F#4` / `Gb4`, keep it that way · SVG gets `fill`/`stroke` as **presentation attributes**, not CSS (`transport.ts:197-200`), or `stylesheet:false` renders black-on-black · the black-key `transform: translateX(-50%)`, `height:62%`, `z-index:2` must be re-declared in `pitchStyle` **and** painted in inline mode (A.2.5) · all three mounts pass `'pitch'` as the `installStyle` id · one `WeakMap` **per mount kind** (`stage.ts:168-170`) · `export type {FrameClock, FrameTick, MotionMode}` (A.3.17) |
| **Copy verbatim** | the mount tail from `packages/ui/src/status.ts:146-169` — `claimHost` → `destroyPrevious()` → `isCurrent()` → `host.append(...(style ? [style] : []), root)` → second `isCurrent()` → `update()` → guarded `subscribe`; and `destroy()` calls `claim.release()` **before** `root.remove(); style?.remove();`. First line of every mount is `const document = host.ownerDocument;` — **never** copy `analysis.ts:196,199`'s `globalThis.document` fallback. |
| **Deferred in** | X1 / X2 / X3 / X5 from C.2's deferral table land here |
| **From C.5's review** | **A.3.20 consequence 1**: `motion` must not be read through `matchMedia` **unguarded** (absent in jsdom), and no numeric geometry may be read from a `--wui-*` token through `getComputedStyle` (custom properties do not inherit in jsdom). **Amended by C.6's own review**: the correct shape is `view?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches` as `resolveMotion`'s LAST resort, after the ancestor `data-motion` read — an absent `matchMedia` answers `'continuous'` and never throws, and design §3.1's definition of `'auto'` is then actually met. Also: `elements-ssr.test.ts` is now the score-side SSR tripwire for C.0 site 8's runtime `import '@webmusic/ui/pitch'` — it imports the element module in the `node` environment, so it reds the moment `pitch.ts` touches a browser global at module scope |

#### C.6.1 — Carried forward out of C.6's own three-lens review

Everything below was found by review of the landed `pitch.ts`, judged real, and deliberately NOT fixed
in C.6. Each names the commit that owns it. (Everything else the review found — the staff's frame, the
accidental stack, the key-signature gutter, the nut at a high window, the vertical board, the notehead
rebuild, the unspent `--wui-harmony-age`, the doubled release tail, `FretMark.midi`, `ageSpan` on all
three, the black-key edge, the octave ruler, the column cap, the reduced-motion escape — was fixed in
C.6 itself.)

| # | Finding | Owner | Why not C.6 |
|---|---|---|---|
| **F1** | 🔴 **A changed sounding set is never announced.** Each root is `role="img"` with a correct accessible name, and rewriting an `aria-label` on a static `role="img"` announces nothing in NVDA, JAWS or VoiceOver. The only live region on a pitch surface is the empty-state `<p>` that `markEmptyState` stamps `role="status"` (`internal/dom.ts:87-90`) — so the family announces **silence** and stays silent about **sound**. | **C.8** (`mountWorkbench`) | The fix is one visually-hidden `role="status" aria-live="polite" aria-atomic="true"`, debounced (~250 ms, on SET change, not on repaint — a keyboard at 20 Hz would otherwise machine-gun it). It belongs to the shell for the same reason §3.2 refuses 49 focusable keys: four docks each announcing the same chord is four announcements of one fact. §3.8 already makes the shell the holder of the frame's one reading, so it is the only node that can say it once. `aria-label` stays on each `role="img"` for on-demand reading — two jobs, two nodes. |
| **F2** | `motion: 'auto'` reads `prefers-reduced-motion` **once, at mount**. An OS toggle mid-session does not repaint. | **C.7b** | `internal/motion.ts`'s `watchReducedMotion()` is already C.7b's deliverable (design §3.0, §2.5.3). C.6 lands the one-shot read plus the sheet's `@media` escape; C.7b turns the read into a subscription and every `pitch.ts` mount joins it. |
<!-- F3 (dead CJS pitch chunk) DELETED: false on this tree. `analysis-view.ts` imports
     `mountKeyboard` BY NAME and calls it — a real mount, not a bare side-effect import — so the
     chunk it pulls runs for real behaviour. The escape hatch C.6.1 feared is closed; see
     `analysis-workbench-wiring.md` for what closes it. -->

#### C.6 — deferred out, and who owns each

Three adversarial reviews of the landed C.6 tree (gates, craft, drawing) produced nineteen findings.
Fifteen are fixed in C.6; four are real, out of its budget, and recorded here so none is lost.

| # | Finding | Why not here | Owner |
|---|---|---|---|
| **D-1** | `installStyle` is called once per mount, so three surfaces in ONE host install three identical 9 KB sheets (27 KB duplicated) all tagged `data-webmusic-ui="pitch"`. | `internal/style.ts:9-13` refuses de-duplication ON PURPOSE ("would change cascade order and break mounts into a detached host, and no caller asked for it"). Host-scoped de-duplication is a different proposal from the one that doc rejects, and it needs ownership bookkeeping so `destroy()` removes the sheet only if this mount appended it. The normal layout is one surface per dock host, where the cost is zero. | **C.8** — the workbench is what decides whether a dock ever holds more than one surface. Fix it there, for every subpath at once, or record that it never does. |
| **D-2** | `classNames`/`parts` reach only the root, while the mounts stamp nine part tokens (`board`, `ruler`, `tick`, `key`, `key-black`, `key-white`, `key-label`, `svg`, `empty`). `mountStatus`, a two-node presenter, offers both of its nodes. | The named `PitchClassNames` / `PitchParts` interfaces landed in C.6 (the house shape — 17 presenters export one), so adding keys later is additive and breaks nothing. Choosing the key names for three surfaces at once is the same question C.7 has to answer for three more. | **C.7** — settle the per-node key vocabulary for all six mounts in one go, then widen `pitch`'s two interfaces to match. |
| **D-3** | The mount tail this brief says to copy verbatim leaks a subscription: `update()` runs caller code that may mount a replacement into the same host, which destroys this handle while `unsubscribe` is still `undefined`; the `subscribe` that follows then assigns a teardown onto a handle whose `destroy()` short-circuits forever. Measured: 2 live subscriptions after the outer mount returns, still 2 after destroying the superseded handle. | `packages/ui/src/status.ts:161-168` is the original and **has the same hole**, and so does every mount that copied it. C.6 fixed its own three tails (and the "Copy verbatim" row above now says so), but sweeping the kit is a change to landed presenters with their own tests, in a commit whose subject is three new surfaces. | **its own commit, before C.7** — `fix(ui): a mount superseded during its first update still releases its subscription`. Audit every `mounted*` presenter, not just `status.ts`. |
| **D-4** | `mountStaff` and `mountFretboard` `replaceChildren` the whole vector every update; only the keyboard diffs by `data-midi`. The 90 ms tone budget survives only because nothing in the sheet transitions a notehead or a dot. | C.6's acceptance bar is about the keyboard, which does diff, and the SVG rebuild is measurably cheap (0.30 ms and 0.39 ms per update in jsdom). The trap is latent, not live. A comment now marks it at the `replaceChildren` call. | **whoever adds the first `transition` to `__head` or `__dot`** — it will silently never fire, and that is the commit that has to diff the vector first. |

Rejected, with the reason, so they are not re-filed: **one `role="img"` per surface carrying the
caller's whole sentence, and no `<title>`/`<desc>` twin** is the design's own decision
(`analysis-workbench-design.md:295`, "49 focusable nodes would be a screen-reader disaster") — what
C.6 fixed is the narrower defect that the ROLE was stamped before any name existed. **`dot(midi)`
keyed by string index** matches `FretboardVoicing.marks`, which is one dot per sounding string.
**148 unconditional style writes per keyboard update** cost 0.23 ms for 37 keys. **The module
header's `##` sections** are a house-style question this series should settle once, not in a
review of one file.

---

#### C.6.2 — Gate-hardening follow-ups (a separate commit, not part of this series)

C.6 replayed all 13 registration sites by reverting each one and running the gates. Ten fail loudly. **Four
are silent**, and they are the reason a partial registration is worth fearing:

| Site | Silent failure | Minimal fix |
|---|---|---|
| 10 (`ui-presenter-catalog.ts:26`, `UiPresenterName`) | 🔴 Deleting `\| 'pitch'` passes `check:architecture`, `check:docs`, `eslint` **and** `npm run typecheck -w webmusic-doc` (`astro check` → "0 errors"). Only `npx tsc --noEmit` on the file catches it. Root cause: `apps/doc/webmusic/tsconfig.json` has no `include`, so Astro's project root is `apps/doc/webmusic/` and **the whole of `apps/doc/shared/` is typechecked by nothing in CI**. | `"include": ["src", "../shared"]` in that tsconfig, or a `check:doc-shared` step running `tsc --noEmit` over `apps/doc/shared`. |
| 15 (`element-composition-policy.mjs:21`) | Reverting to `['analysis']` while the runtime import stands passes both gates: the closure check is one-directional (an element must *reach* what it declares; it may reach more). The composition ledger can quietly become a lie. | Make the check bidirectional, or accept it and say so in the file. |
| 14 (`packages/ui/src/index.ts`) | Dropping the barrel line passes everything; the root-barrel promise in `packages/ui/README.md:430` and `uikit/api.mdx:36` is on the honour system. | Assert in `ssr.test.ts` that every published subpath is reachable from the barrel. |
<!-- Site 6 (two literals) DELETED: already fixed on this tree. `check-architecture.mjs:44`
     declares `const EXPECTED_UI_SUBPATHS = 19;` and interpolates it into both the threshold and
     the message, with a comment recording the drift that motivated it. -->

---

### C.7 (design step 6) — `feat(ui): harmony read-outs — nameplate, chip-strip, wheel` — **LANDED**

**Read §0.6 with this section.** It is in the working tree, ported off a deleted worktree, and the
rows below are kept as the record of what it was asked to contain rather than as work to do.

**The flow lane is NOT in this commit.** This one carries the 13-site registration; C.7b carries the new
machinery. Splitting them isolates the registration risk from the content risk, which is §D.2's own logic.

| | |
|---|---|
| **Create** | `packages/ui/src/harmony.ts` (`mountNameplate`, `mountChipStrip`, `mountWheel`) · `packages/ui/src/internal/spans.ts` (`stampSpans`, `stampIdleStyle`) · `packages/ui/test/harmony.test.ts` · `packages/ui/test/spans-contract.test.ts` · `apps/doc/.../uikit/views-analysis/harmony.mdx` |
| **Modify** | `packages/ui/src/index.ts` · `ssr.test.ts` · `stylesheet-option.test.ts` · **registration sites 2–13, 15** (19 → 20) |
| **Live scope in this commit** | the nameplate's WAAPI pop + `ChordNameCandidate.key` + `NameplateState.next` + `--wui-harmony-approach` · the wheel's `needle` / `trail` / **unwrapped angle** · `ChipItem.meterGhost`. `mountNameplate.approach` is declared but the frame plumbing arrives in C.7b — until then `animate` resolves false and `next` is a static ghost |
| **Gate / Accept** | as C.6, plus: `spans-contract.test.ts` proves `stampSpans` output is read back **unchanged** by the existing `readAnalysisSpans` (`data-spans` = space-separated `start:end` for the multi form; `data-start-quarters`/`-end-quarters` for the single form; **the two forms are mutually exclusive** — writing both makes `readAnalysisSpans` return 1+N spans and breaks `analysis.test.ts:31` and `:47-50`) **and** that `data-webscore-idle-style` serialises the node's **complete** inline style after painting, byte for byte (A.2.6) · non-finite numbers write **no attribute at all**, never `NaN` — a `NaN` node matches `ANALYSIS_SPAN_SELECTOR` but never parses, i.e. a zombie the playhead walks every tick · the wheel's `rotate` value **increases** when the needle moves from segment 11 to segment 0 · `harmonyMotion.full['--wui-harmony-motion-pop']` parses to exactly `DEFAULT_POP_MS` (design §3.5, the one duration written twice) |
| **Watch** | `.wui-harmony-chip` not `.wui-chip`; `.wui-harmony-nameplate` not `.wui-readout`/`.wui-label`/`.wui-badge`; `.wui-harmony-wheel` not `.wui-dot` (B9) · `harmony.ts` must not import `pitch.ts` (`checkInternalCycles`) · the nameplate's primary symbol node **identity must survive `update()`**, and the wheel's centre readout is now live, so **its** text node identity must survive too · history and `__next` stay **out** of the live region · `symbol.animate` must be feature-detected (jsdom has none; `ssr.test.ts` hits it first) · pop keyframes touch **`opacity` only** — the symbol is the one line the reader is actually reading · `createAnalysisPlayhead` stays in `analysis.ts` only |
| **Deferred in** | X4 / X6 from C.2's deferral table |

---

### C.7b (design step 7, **NEW**) — `feat(ui): one frame loop, and the lane that rides it` — **LANDED**

**Read §0.6.3 with this section**: two of the rows below were satisfied differently on purpose
(`internal/motion.ts` and `frame-loop.test.ts` do not exist), and one — `watchReducedMotion` — did
not land at all and is now C.8's.

The live turn's centre of gravity. **Zero subpath churn** — `mountFlowLane` moves into the already-registered
`harmony.ts`, so none of §C.0's 13 sites moves and the hardcoded count stays at 20.

| | |
|---|---|
| **Create** | `packages/ui/src/internal/frame.ts` (`joinFrameLoop`, `FrameTick`, `FrameClock`, `MotionMode`) · `packages/ui/src/internal/motion.ts` (`watchReducedMotion`) · `packages/ui/test/flow-lane.test.ts` · `packages/ui/test/frame-loop.test.ts` |
| **Modify** | `packages/ui/src/harmony.ts` — add `mountFlowLane` and the type re-exports (A.3.17) · `packages/ui/src/pitch.ts` + `workbench.ts` — the same type re-exports · `packages/ui/test/ssr.test.ts` and `stylesheet-option.test.ts` — **one row each** (A.3.12; nothing auto-discovers them) · `harmony.mdx` — the lane's API/Styling blocks and a demo that actually scrolls · `ui-presenter-demos/views-analysis.ts` — a fake clock in the harmony demo plus a reduced-motion toggle |
| **Must contain** | `harmony-style.ts` gains `--wui-harmony-motion-flow` / `-pop` / `-release` / `-column` / `-turn` in **both** `harmonyMotion.full` and `.reduced` (reduced all `0s`), and `--wui-harmony-flow-scale` / `-flow-height` / `-flow-now` / `--wui-harmony-lane-height` in `harmonyTokens` + both `harmonyDensity` rows |
| **Gate** | ui-source row of §F (~10 s), then `npm run build -w @webmusic/ui && npm test -w @webmusic/score && npm run check:docs && npm run docs:build` |
| **Accept** | **item geometry is a pure function of the item's own fields, never of `now`** — assert an item node's `cssText` is byte-identical before and after 60 `tick()` calls that move the position across it · `data-zone` write count ≤ crossing count over those 60 ticks · **band node identity is stable** across playback (no `replaceChildren`) · `stepped` and `continuous` produce **pixel-identical layout** (same node set, same `left`/`width`, differing only in the reel transform) · `handle.index`'s `<li>` list corresponds item-for-item with `bands`, and the current one carries `aria-current="true"` · **with zero subscribers, `requestAnimationFrame` is never called** (assert against a fake `view`) · a non-intersecting viewport leaves the loop and rejoins in one frame with the correct position · `stampSpans` output round-trips through `readAnalysisSpans` for a lane whose axis is seconds and whose `stampStart`/`stampEnd` are quarters |
| **Watch** | 🔴 `overflow: hidden; overflow: clip;` on the viewport, **with the comment explaining why** (A.3.16) · 🔴 no live state may contain the substring `outline` (A.3.18) · `.wui-harmony-flow__reel`, **never** `__track` at the root of the scroll layer — `wui-track` is one of the 43 taken names and comments are scanned (A.3.1) · `will-change: transform` on the reel only, never on a band · **offscreen bands are never removed** — `content-visibility: auto` + `contain-intrinsic-size` instead; removal silently kills the playhead's `querySelectorAll` discovery and makes the pinned span-node counts a function of scroll position · do not reuse `mountSurfaceSlider` for pointer semantics (it drags its `WeakMap` into the harmony chunk and `claimHost` silently splits) · no `getBoundingClientRect()` inside the frame callback — width comes from a `ResizeObserver` (`stage.ts:722-729` pattern) |
| **Note** | above ~2000 items the correct answer is **to merge in the headless projection**, not to virtualise in the kit. Say so in the module header — it is the user's own point, restated as a performance rule |
| **From C.5's review** | 🔴 **A.3.20 consequence 2.** Add `fallbackWidth?: number` to `FlowLaneOptions` **in this commit** (design §3.6.5 has none), and install the three fakes — `ResizeObserver`, `matchMedia`, per-element `getBoundingClientRect` — in `flow-lane.test.ts` / `frame-loop.test.ts`. Without both, the reel transform, viewport culling, ⌘+wheel zoom and pointer-drag rows are **vacuously green at width 0**, which is worse than red. The band-box rows survive W=0 unaided (§3.6.1) — keep them as the load-bearing ones |
| **From C.6's review** | **C.6.1 F2.** `pitch.ts` already reads `prefers-reduced-motion` once at mount (`resolveMotion`'s last resort) and already carries the `@media` escape in `pitchStyle`. `watchReducedMotion` turns the one-shot read into a subscription: the three pitch mounts must join it here so an OS toggle repaints **on the spot**, which is §2.5.3's actual requirement and the whole reason it is JS and not a media query. The `@media` block stays as the no-JavaScript floor — do not delete it when the watcher lands |

---

### C.7c (**NEW**) — `fix(ui): every read-out that can be pressed can be reached`

The a11y-operability half of C.7/C.7b, deferred out of the port's three-lens review (§0.6.4) rather
than bolted onto a commit that was already landing. It is one commit because it is one decision: a
hidden `<ol>` twin that is the accessible representation of a surface has to be operable wherever the
surface is, and carry what the surface says.

**Zero subpath churn — the count stays 20. No new module.**

| | |
|---|---|
| **Modify** | `packages/ui/src/harmony.ts` — the twin builders in `mountFlowLane`, `mountChipStrip` and `mountWheel`, plus `mountChipStrip`'s options · `packages/ui/test/flow-lane.test.ts` and `harmony.test.ts` · `harmony.mdx`'s Accessibility paragraph |
| **Must contain** | where `selectSegment` / `selectItem` / `selectBand` exists, that surface's twin entry is a real `<button type="button">` — the twin is already one node per item and already in document order, so this is the whole fix and it costs no new node · an `aria-label` on the lane's `<ol>`, the wheel's `<ol>` and the nameplate's `<ul>` · one labelled list **per ring** on the wheel, because two rings normalised against two denominators in one flat unnamed list is three siblings and a lie · `mountChipStrip` gains `motion`, `data-motion` and `dressMotion`, the only one of the four without them · the lane's `aria-valuetext` moves onto the wheel's settle timer |
| **Gate / Accept** | for each of the three handlers: a `keydown` of `Enter` and of `Space` on the twin entry fires it with the same arguments a click does, and **the count of focusable nodes in the mount is greater than zero** (it is zero today in the wheel and the chip strip) · without a handler the entry stays an inert `<li>` with no `tabindex` — a focusable node with no behaviour is a trap, and that rule already governs the nameplate's alternates · a wheel with an outer and an inner ring publishes **two** named lists · 40 wheel notches on a focused lane slider write `aria-valuetext` **once**, not 24 times |
| **Watch** | the element layer may not `createElement('button')` (`check-architecture.mjs:1184-1197`) — every one of these is the KIT's, which is the point · `.wui-harmony-*` prefixes only (B9) · the twin must keep carrying **no** spans: `flow-lane.test.ts` pins `index.querySelectorAll(ANALYSIS_SPAN_SELECTOR)` at zero, and a second span-carrying node per item doubles every pinned span count in the repo |
| **Explicitly NOT in this commit** | §0.6.4 item 2 — giving a `seek`-less lane a role and a tab stop. `flow-lane.test.ts` pins `role === null` and `tabIndex === -1` there with a written reason, so that is a decision to re-open in C.11 against a real view, not a fix to make in passing. |
#### C.7.1 — Carried forward out of C.7's own three-lens review

C.7 and C.7b landed as ONE commit (`feat(ui): harmony read-outs — the flow lane, nameplate, chip strip
and wheel`). Everything below was found by review of that commit, judged real, and deliberately NOT
fixed in it. Each names the commit that owns it.

Fixed in C.7 itself, for the record, so nothing below is mistaken for the whole list: the chip strip
and the lane both handing a highlight back after a re-stamp (`internal/spans.ts`'s
`restampActiveStyle`, rule 4 of the stamp contract); `spans: []` no longer un-stamping a band that has
a perfectly good start and end; a pointer drag outranking a running `binding.position()` for as long
as the pointer is down; a stepped lane on a shell's clock placing only where a boundary was crossed;
`bandAt` answering from the LOWEST track rather than from array order; the aria pair leaving the
per-frame path; the reel's `transition: width` removed (it threw the anchor 1890px off on a zoom); the
nameplate's two `replaceChildren` guarded so a reader keeps focus on an alternate; the now line's
arrival flash actually firing, on `scaleX` rather than `width`; `measure()` off the domain path where a
`ResizeObserver` answers; `paintBand`'s signature built by concatenation instead of `JSON.stringify`;
`dressMotion` painting `harmonyMotion.full` as well as its own record; the empty future field drawn as
visibly empty; and `--wui-harmony-flow-height` / `--wui-harmony-lane-height` added to both
`harmonyDensity` rows, without which `data-density="compact"` changed every read-out in the family
except the lane.

| # | Finding | Owner | Why not C.7 |
|---|---|---|---|
| **F1** | 🔴 **A root that holds a lane must take `createAnalysisPlayhead(root, {scroll: false})`.** `overflow: clip` keeps the LANE from scrolling, but a clip box is skipped by `scrollIntoView`, which then scrolls the nearest real scrollport — the page. Measured: a multi-span band whose lit occurrence is not the occurrence on the anchor is handed to `scrollIntoView` 3465px outside the viewport. | **C.8** | Not reachable today — `analysis-view.ts` only side-effect-imports `@webmusic/ui/harmony`, and the demo mounts the lane on its own host. It becomes live the moment the shell mounts a lane inside a root running `createPlayheadHighlighter`, which is C.8's own deliverable, and design §3.6.4's "second guard" is already specified there. C.7 corrected the two comments that claimed `clip` made the call a no-op outright. |
| **F2** | `AnalysisPlayheadOptions.scroll` is documented as "the first **newly-active** row" (`analysis.ts:76`); `:175` scrolls `next[0]` — first active in DOCUMENT order — whenever the set changed at all. Harmless with today's non-overlapping list rows; wrong the moment a lane band overlaps them, which is every row boundary. | **C.8** | `analysis.ts` is frozen for this commit, and `packages/score/test/analyze/playhead.test.ts:61,66,69` pins the scroll COUNT byte for byte. Fixing the target is a one-line change to `apply()` and belongs with the `{scroll: false}` wiring that makes it observable. |
| **F3** | `motion: 'auto'` still reads `prefers-reduced-motion` **once, at mount** (C.6.1 F2, re-inherited). `internal/motion.ts` / `watchReducedMotion` did not land. | **C.8** | It was C.7b's nominal deliverable and C.7b merged into C.7, whose scope was already the lane. The watcher has to repaint every mount in a subtree at once, and C.8's shell is the node that owns that subtree — a per-mount listener would give six read-outs six chances to disagree, which is the thing `resolveMotion`'s ancestor lookup exists to prevent. The `@media` block stays as the no-JavaScript floor. |
| **F4** | Three §3.6.5 fields declared in the design and not implemented: `FlowLaneState.window` (programmatic zoom — today only ⌘+wheel, so a caller cannot offer the zoom control the field was justified with), `pinned.caption`, and `FlowTrack.weight`. | **C.11** | None is a defect in what shipped; each is an optional field with no consumer until a view asks for it, and `window` in particular needs a measured width to mean anything, which makes it a shell question. Add them with the view that needs them, not before. |
| **F5** | The motion budget is still split: `--wui-harmony-motion-flow` / `-pop` / `-turn` live in a local `HARMONY_MOTION` record in `harmony.ts` and `-release` / `-column` in `PITCH_MOTION` in `pitch.ts`, rather than in `harmonyMotion.full` / `.reduced` as C.7b's "Must contain" row says. | **C.9** | Both records are painted on every path now, so the chains resolve and a host's `--wm-*` override is reachable — the bug is gone and only the shape is wrong. Moving five names into `harmonyMotion` touches `token-chain.test.ts`'s `PREDECESSOR` table and both pitch and harmony at once; C.9 is the commit that already opens `harmony-style.ts` for the renderers to share. |
| **F6** | The drain writes one `background: linear-gradient(...)` per frame on the sounding band's `__fill`. jsdom prices it at 0.03ms/frame, and jsdom has no style recalc, layout or paint — the browser-relevant number was not measured. | **C.11** | The mechanism is right (a CHILD of the band, so no idle style is disturbed, and off entirely under reduced motion) and the invalidation is one band-sized rect, not the reel. It needs a profile in a real browser against real material, which is what C.11 first has. If it does cost, the fallback is a static overlay pinned at `anchor%` of the VIEWPORT — one node, zero per-frame writes — at the price of dimming every ahead band rather than draining the sounding one. |

**One token was removed rather than deferred.** `--wui-harmony-motion-flow` (design §2.5.2, C.7b's
"Must contain") is gone from `HARMONY_MOTION` and from `harmony.mdx`. The budget names it for "the
re-anchor ease and the zoom transition" and the lane can honestly ease neither: the reel's offset is
absolute pixels while every band's box is a percentage of the reel's WIDTH, so an eased width beside
an instant transform describes two different scales for the length of the ease — measured at 1890px
off the now line for 120ms after one ⌘+wheel notch, and worse the further into the piece the listener
has got. The stepped re-anchor is `transition: none` by §2.5.3's own table. So the family spends four
motion durations, not five, and `check-docs.mjs:657-671` is right to refuse a documented name that no
source reads. If a zoom ease is ever wanted it has to ease `pxPerUnit` in JS, writing the width and the
transform together from one scale on each frame — which needs a loop a still lane does not have, and
is a feature rather than a fix.

**Rejected, with the reason, so they are not re-found:** `--wui-harmony-flow-scale` as a token —
reading a length back out of a custom property means `getComputedStyle`, custom properties do not
inherit under jsdom and `parseFloat('')` is `NaN`; `scale` stays an option with a documented default,
and the module header says so. `role="option"` on the semantic twin's `<li>` — invalid without a
`listbox` parent, and the plain `<ol>`/`<li>` with `aria-current` is the better shape. Bar numbers in
the twin — the kit has no bars; a caller puts them in `trailing`, which the entry already prints.

---

### C.8 (design step 8) — `feat(ui): the workbench is the shell every analysis view sits in`

| | |
|---|---|
| **Create** | `packages/ui/src/workbench.ts` · `packages/ui/test/workbench.test.ts` · `apps/doc/.../uikit/views-analysis/workbench.mdx` |
| **Modify** | `packages/ui/src/index.ts` · `ssr.test.ts` · `stylesheet-option.test.ts` · **registration sites 2–13, 15** (20 → 21) |
| **Live scope** | `WorkbenchHandle.clock` (the single reading per frame, over `joinFrameLoop`) · `WorkbenchHandle.tick()` (the deterministic seam for tests — do not make the suite depend on jsdom's rAF) · `WorkbenchBinding.now()` / `epoch()` · `WorkbenchHandle.index` (the semantic `<ol>` slot) · `data-motion` via `watchReducedMotion` |
| **Gate / Accept** | as C.6, plus `workbench.test.ts`: roving tabindex + **manual** activation · `Home`/`End` · focus does **not** move into the tabpanel on switch · `dock(id)` returns `undefined` for hidden and unknown ids · **`update()` is idempotent and does not rebuild slot nodes** — under live this has a second meaning: an `update()` called per frame silently unmounts every child presenter once per frame, so **assert that a `clock` tick calls `tick()` and never `update()`** · with `phase` neither `playing` nor `listening`, **no rAF is scheduled** · `motion` resolving to `stepped` starts **no loop at all** and instead emits a `continuous: false` tick per `subscribe` notification · `handle.index` is a **direct child of the mount host, a sibling of the workbench frame** (this is what keeps `elements.test.ts`'s **direct-`<ol>`-child** case (`:207-210` today) and `:339` both green) · `chrome:'bare'` renders stage only |
| **Watch** | `.wui-workbench*` — `.wui-tab`, `.wui-tabs`, `.wui-panel`, `.wui-surface`, `.wui-empty`, `.wui-grid` are all taken (B9) · `mountWorkbench` plausibly needs `createUpdateLoop` (`internal/lifecycle.ts:77-114`), since a tab switch re-projects and can re-enter `update()` · the `stage`/`dock()` slots follow the HOST pattern |
| **Deferred in** | X7 / X8 from C.2's deferral table · **C.6.1 F1** (the one debounced `role="status"` live region for the sounding set — the shell says it once, the four docks say it none) · **C.6.1 F3** (the policy import in `analysis-view.ts` becomes a real one here) |
| **Note** | this is where the 21-subpath prose sweep can land, or defer it to C.14 |

---

#### C.8.1 — Carried forward out of C.8's own three-lens review

Three lenses (gates / slots / ux) went over the landed `workbench.ts`. **Everything they found that is
this commit's to own was fixed in C.8 itself** — the slot destroyed in silence when `docks` churns, the
dead handle still handing slots out, the duplicate `aria-labelledby` ids, `hidden` that did not hide,
the shadow-root roving tabindex, the focus thrown away by a reorder, the breakpoints measured through
the card's padding, the token layer and the state-driven grids missing from the inline path, the
`data-motion="degraded"` that never cleared, the orphan dock header, the re-activation of the view
already on screen, the detached `statusMessage` under bare chrome, and the blank idle stage. The rows
below are what was deliberately left.

| # | Finding | Owner | Why not C.8 |
|---|---|---|---|
| **F1** | **`claimHost` protects against same-kind remounts only.** Every presenter owns a private `WeakMap`, so a workbench and any other kit mount coexist on one host in both orders, both alive, DOM interleaved. The workbench is where it bites, because it is the one presenter that *hosts* others: remounting a shell on a host whose stage still holds a tenant leaves that tenant running detached. | **C.6.2** (gate hardening, a separate commit) | The fix is one shared `WeakMap<host, {destroy()}>` in `internal/lifecycle.ts` that all 20 `claimHost` call sites pass through, so any kit mount deposes any other on the same host. That is a decision about the whole kit's mount contract and it touches every subpath; it is not a drive-by inside a subpath commit. |
| **F2** | The **debounce** on the shell's one live region. C.8 lands the mechanism C.6.1 F1 asked for — `message` is the shell's single `role="status" aria-live="polite"`, the four docks carry none, and `setText`'s exact-string equality means an unchanged sentence announces nothing. What it does not do is rate-limit a caller that changes the sentence at 20 Hz. | **C.11** | Only the layer producing the string knows its rate. A timer inside the shell would delay an `error` message too, and the shell cannot tell a sounding set from a failure — it is handed one sentence. §2.5.1's table now says so explicitly: the position goes in `detail`, which is not a live region, and never in `message`. |
| **F3** | `harmonyMotion` still lacks `-flow` / `-pop` / `-release` / `-column` / `-turn` in both records (§2.5.2). | **C.9** | Already recorded as C.7.1 F5, unchanged by this commit. |
| **F4** | `stylesheet: false` has **no focus ring and no keyframes**: `harmonySheet`'s `:focus-visible` rule and `@keyframes wui-workbench-breathe` are sheet-only, so the inline path has neither. | none — documented | This is a property of the inline path shared by every harmony mount, not a workbench defect: a declaration record cannot hold a pseudo-class or an animation. C.8 did move the two things that are **not** responsive niceties onto the inline path (the token layer, and the `data-rail` / `bare` grids), and narrowed the page's "documented cost" sentence to the two container queries that really are. |
| **F5** | The rest of the **21-subpath prose sweep**: `ARCHITECTURE.md:243-263`, `:352`, `:501-503` · `dev/UIKIT-PAGE-TEMPLATE.md:5`, `:48` · `dev/DEVELOPMENT.md:17`, `:42` · `apps/doc/webmusic/src/lib/params/index.ts:1` (says 30 elements, already stale at 31). | **C.14** | C.8 finished only the three lines that had come to **contradict another line in the same document** — `uikit/api.mdx:109`, `uikit/index.mdx:31`, `packages/ui/README.md:280` — because a document at war with itself is worse for a reader than one uniformly a commit behind. The rest is ungated and stays in C.14's sweep row. |

**Two findings were rejected, recorded so they are not re-raised.** (a) *The dock `<section>` has no
accessible name.* Naming it would announce the dock's label twice, once for the section and once for
the `role="group"` body the caller actually mounts into; the body is the node that needs the name.
(b) *`main.tabIndex = 0` is unconditional, and APG makes a tabpanel focusable only when it has no
focusable descendants.* The shell cannot know what the caller mounts, and the failure modes are not
symmetric: a spare tab stop is a keystroke, an unreachable panel is a view a keyboard cannot read.

**One brief row is now known to be optimistic.** C.8's *Deferred in* cell says C.6.1 F3 — the
`import '@webmusic/ui/workbench'` in `analysis-view.ts` — "becomes a real one here". It does not:
`<analysis-view>` does not call `mountWorkbench` until **C.11**, so the import is still registration
weight that only a source-level gate can see. Removing it before then reds `check:architecture`.

---

### C.9 (design step 9, **SHRUNK**) — `refactor(ui): the span-carrying renderers share the stamp and the skin`

**Design §7.1 reversed the delegation promise (B15).** This commit is now small and safe.

**And it is FOUR renderers, not six.** Measured per function body in `packages/ui/src/analysis.ts`:
`renderChordTimeline` (`:248`) and `renderRomanStrip` (`:255`) write `dataset.startQuarters` /
`dataset.endQuarters`; `renderMotifList` (`:280`) writes `dataset.spans`; `renderVoiceLeadingList`
(`:287`) writes the start/end pair. `renderKeyView` (`:239`) and `renderLiveChordPanel` (`:273`)
write **no span attribute at all** — they take the `harmonyParts` skin and nothing else, because
`stampSpans()` has nothing to stamp on them. An earlier count of six was arrived at by collapsing
the two groups; an earlier split put `renderRomanStrip` on the wrong side of it. Both are wrong.

| | |
|---|---|
| **Modify** | `packages/ui/src/analysis.ts` — the FOUR span-carrying renderers call `stampSpans()` / `stampIdleStyle()` from `internal/spans.ts` instead of hand-writing the dataset, and take their boxes from `harmonyParts`. **They keep their DOM, their signatures, their behaviour, and they are NOT marked `@deprecated`** |
| **Must not** | delegate to `mountFlowLane`, `mountChipStrip`, `mountWheel` or `mountNameplate` · add motion of any kind · add a `@deprecated` tag (they are not superseded by a same-shape replacement; it would be a lie, and it only buys `ts(6385)` noise) |
| **Gate** | `npx eslint packages/ui/src && npm run typecheck -w @webmusic/ui && npm run typecheck:tests && npm test -w @webmusic/ui && npm run check:architecture && npm run build -w @webmusic/ui && npm test -w @webmusic/score && npm test -w @webmusic/audio` (~20 s) |
| **Accept — still the hard bar, now a cheap one** | `packages/ui/test/analysis.test.ts` **unchanged, character for character** and green: exactly **2** `ANALYSIS_SPAN_SELECTOR` nodes for 2 chord segments and **no other** span-carrying node under the root (`:29-30`) · `readAnalysisSpans(rows[0])` deep-equals `[{startQuarters:0, endQuarters:4}]` with **no `data-spans` on the same node** (`:31`) · document order == input order (`:32`) · motif spans PARSED — `readAnalysisSpans(rows[0])` deep-equals `[{0,3},{8,11}]` (`:47-50`); the `data-spans` STRING `'0:3 4:7 8:11'` is at `:219` and belongs to the rhythm case, not this one · voice-leading `{2,2}` clamps to `[{2,3}]` (`:59-60`) · every node's `ownerDocument === foreign` (`:126-130`) |
| **Also unchanged** | `new-elements.test.ts` · `packages/audio/test/analyze/analyze-elements.test.ts` · `playhead.test.ts` · the published class table at `uikit/views-analysis/analysis.mdx:156-165` |
| **Docs** | `uikit/views-analysis/analysis.mdx` — say what these six now are (the four above plus `renderKeyView` and `renderLiveChordPanel`, which this commit only re-skins): **one-shot painters; for a live surface use `mountFlowLane` / `mountChipStrip` / `mountNameplate` / `mountWheel`**. Do not write "deprecated" |

---

### ~~C.10 (design step 7, split B)~~ — **WITHDRAWN**

`refactor(ui): the key, roman and live-chord read-outs delegate` has nothing left to do.
Design §7.1 keeps `renderKeyView` / `renderRomanStrip` / `renderLiveChordPanel` static and undeprecated;
the live versions are new mounts in `harmony.ts`, not a rewrite of these three. **Do not resurrect it** —
the reason is B15, not scheduling.

---

### C.10a (design step 10, **NEW**) — `fix(score): a seek at rate != 1 lands where it was clicked`

Independent of everything else; needs only the jsdom harness from C.5.

| | |
|---|---|
| **Modify** | `packages/score/src/analyze/element/analysis-timeline.ts` — `#seek` passes **transport** seconds to `player.seek()`: `player?.seekNominal?.(seconds) ?? player?.seek?.(seconds / rate)` |
| **Preserve** | the `webscore:seek` **detail stays in nominal seconds** — it is documented (`dev/plans/score-analyze-elements.md`) and nominal is the analysis axis · `new-elements.test.ts:83-88` (exactly one `webscore:seek` with `{quarters, seconds}`) unchanged |
| **Gate** | `npm run typecheck -w @webmusic/score && npm run typecheck:tests && npm test -w @webmusic/score && npm run check:architecture` (~13 s) |
| **Accept** | a jsdom regression with a stub player reporting `rate = 2` (`transportDurationSeconds = nominalDuration / 2`): clicking a region at nominal `t` calls `seek()` with `t / 2`, and the dispatched detail still carries nominal `t` |
| **Why now** | B17. At `rate = 1` the two coincide, which is why no test caught it. The workbench would inherit the same bug, so fix the seam before four more views start using it |

---

### C.10b (design step 11, **NEW**) — `feat(score): the transport clock is arithmetic, not a DOM event`

| | |
|---|---|
| **Create** | `packages/score/src/analyze/headless/transport-clock.ts` — `createTransportClock()`, `TransportSample`, `TransportReading`. **DOM-free by construction: every time is an argument** (`checkFeatureLayers` `:502-626` fails on `.style`, `createElement(NS)`, `getBoundingClientRect`, `.innerHTML`, a runtime `document`/`window`, **and even an `HTMLElement` type annotation** `:290-292`) |
| **Create** | `packages/score/test/analyze/transport-clock.test.ts` — **integer milliseconds throughout, mounts nothing** |
| **Modify** | `packages/score/src/analyze/headless/index.ts` — barrel it (A.3.6) · `packages/score/src/analyze/element/internal/player-binding.ts` — `timeUpdate?(seconds, update: AnalysisTimeUpdate)` (B16) · `packages/score/src/analyze/headless/live-trackers.ts` — `createLiveDistributionTracker` (B18), **duration-weighted**, exposing `bins()` and `heard` |
| **Preserve** | `seconds` stays the **first** parameter, so `packages/score/src/view/element/score-map.ts:240` and `analyze/element/analysis-timeline.ts:196` are **byte-unchanged** |
| **Gate** | score element/headless row of §F (~13 s) |
| **Accept** | pause coasts with a **bounded, decelerating** overshoot and flips `held` at the cap (60–140 ms, twice the EWMA-observed interval) · a residual beyond tolerance bumps `epoch`; a normal late tick does not · a `retune()` sample changes `rate` **without** an epoch bump (rate is read, never differenced) · a loop wrap takes the same path as a seek · `stop()` anchors at rest with `rate = 0` · `hold()`/`release()` ignore the player's echo of our own seek for 250 ms or until it agrees · `createLiveDistributionTracker`'s bins and `distributions().pitchClasses` agree to within rounding for a fully-played score — **the assertion that proves the unit mismatch is gone** |
| **Watch** | do not put `rootDegree` or any other `NaN`-capable field on a type crossing the worker boundary (A.1.2) · the clock never reads `performance`/`Date` — the element passes `view.performance?.now?.() ?? Date.now()` |
| **Honest limits to write in the module header** | the loop **region** is unreadable (`ScorePlayer` has `setLoop`/`clearLoop` and no getter, `play/headless/score-player.ts:260-266`), so the lane **detects** a wrap and cannot **predict** one — which is fine, the wrap cursor is on time. Do **not** add a player getter in this series (D3 puts `play` out of scope) |

---

### C.11 (design step 12) — `feat(score): six views, one workbench`

| | |
|---|---|
| **Create** | `packages/score/src/analyze/headless/workbench.ts` (**strictly DOM-free**, see C.10b's citation) · `packages/score/src/analyze/element/internal/recipes.ts` |
| **Create** | `packages/score/test/analyze/workbench-views.test.ts` (one jsdom case per view) · `packages/score/test/analyze/ui-contract.test.ts` (the pure type-compat test) |
| **Modify** | `packages/score/src/analyze/element/analysis-view.ts` — recipe-driven shell; real dock mounts; the lane wired to `createTransportClock` · `element/internal/score-source.ts` (error channel, B8) · `element/internal/playhead.ts` — **only** to accept `createPlayheadHighlighter({scroll})`; the workbench passes `false` (A.3.19) · `headless/index.ts` if the projections are exported · `scripts/element-composition-policy.mjs:21` → `['analysis','pitch','harmony','workbench']` **in this commit** |
| **Signature change** | the five projections take the `Score` and return **flow-lane views**: `projectProgression(result, score, mode)`, `projectKeyFlow(score, opts)`, `projectMotifFlow(result, score)`, `projectVoiceFlow(result, score)`; `projectSounding` / `projectTonality` keep their shape; `projectKeyCandidates` (no time axis) returns `ChipItemView[]` (B7) |
| **Unit rule** | each band carries `start`/`end` in **nominal seconds** (lane axis) and `stampStart`/`stampEnd` in **quarters** (playhead stamp). The quarters→seconds conversion happens **once per analysis change**, never per frame — `TimeMap.secondsToQuarters` allocates a `Rational` and quantises to 1/480 on every call (`core/time/TimeMap.ts:479-486`) |
| **Preserve** | `attributeChangedCallback('player')` does **not** re-render unless the type is `key`/`live-chord` (`analysis-view.ts:104-111`) — `elements.test.ts`'s **listener-counting stub** (`:85-115` today) and the player-swap case pins the listener transfer · `webscore:chordchange` detail shape `{chord, midis}` with midis sorted ascending |
| **Add** | a re-entrancy guard on `attributeChangedCallback` — the attribute write-back re-enters it and there is no guard today · an explicit `destroy()` on disconnect — `analysis-view.ts:97-102` never disposes its `AnalysisSession` and never clears `#rendered`; `claimHost` assumes one owner per host, and a live mount holding a frame subscription makes the leak visible instead of merely wasteful |
| **Must not** | `setProperty('--wm-…')` (A.3.4) · `createElement` a `button`/`input`/`select`/`option`/`canvas`/`svg` or touch `.innerHTML` (A.3.5) — the now-line, the pointer handling and every SVG belong to the mounts · embed any `wui-x__y` literal (A.3.1) · put `querySelector`, `.style`, `.cssText`, `ANALYSIS_SPAN_SELECTOR`, `readAnalysisSpans` or `readAnalysisIdleStyle` into `element/internal/playhead.ts`, **including in a comment** (the whitelist is a plain text scan and reads that file by hard-coded path) · use the substring `outline` for any approach state (A.3.18) |
| **Empty copy** | lives in the shell, not in the six renderers (B14) |
| **Gate** | score element/headless row of §F (~13 s), then `npm run docs:build` |
| **Accept** | one jsdom test per view: switching `type` mounts the right stage primitives, opens the right dock set, and the empty-state copy is unchanged · **every string in design §7.6 still found by `text()`** · `elements.test.ts`'s **direct-`<ol>`-child** case (`:207-210` today) green **without editing the test** (the `index` slot) · `host.children.length === 1` after a type switch · `elements.test.ts`'s **one-active-segment** case (`:465-471` today; find it by its `filter(includes('outline'))`) still exactly one active segment · `elements-ssr.test.ts` + `new-elements.test.ts` green |
| **From C.5's review** | **A.3.20 consequence 3** — settle the deterministic clock seam before the first case: a blanket `vi.useFakeTimers()` deadlocks every `await flush()` in `elements.test.ts`, and the element reaches `ownerDocument.defaultView` itself so C.7b's "fake `view`" and C.8's `WorkbenchHandle.tick()` are both out of reach from a score element test · **`'updates output across repeated .score assignments'` re-lands here.** C.5 re-expressed its two assertions to `toContain('C major confidence')` / `toContain('A minor confidence')` because the wheel prints neighbour keys, so the old bare `toContain('C major')` / `toContain('A minor')` passed on **both** renders and the file's only incremental-analysis test could not fail. Design §7.6 moves the headline to the wheel **centre readout** and its confidence to the **sub-readout** — keep them adjacent in the flattened text, or re-point the assertion at the centre readout node in this commit · the case named `'type="motifs" renders motifs or the empty note'` only ever exercises the motif branch; the empty branch is this commit's empty copy (B14), so either add the second case here or rename the test |
#### C.11.1 — Carried forward out of C.11's own three-lens review

Everything the three reviewers CONFIRMED was fixed in C.11 itself. What follows
is what was deferred, each with the commit that owns it and the reason it is not
C.11's to do. Anything not listed here was either fixed or rejected in the
triage; the rejections are in the commit message, not here.

**To C.12 (it is the motion/attribute commit, and each of these is a switch or a
budget the attribute surface is about to name):**

| # | What | Why it waits for C.12 |
|---|---|---|
| 1 | **`listening` still opens a frame loop.** C.11 stopped the two burns it could reach — a paused transport and a finished one both drop to `idle` and the loop stops — but `mountWorkbench.wants()` runs the loop for `listening` too (`ui/src/workbench.ts:1058-1066`), and `ui/test/workbench.test.ts:930-947` pins that by name. Design §2.5.1 says listening's driver is off *until the first sample*. Narrowing the kit's gate to `playing` is a kit change with its own test edit; C.12 is where `motion` is being wired anyway. | A landed, named kit assertion. Changing it needs its own licence, and C.11's element-side mitigation already removes the unbounded cases. |
| 2 | **A view switch rebuilds every presenter.** `#alignSlots` keys slots `` `${recipe.id}:${spec.id}` `` (`analysis-view.ts`), so `chords → roman → motifs` destroys and remounts one `mountFlowLane` each time: measured 118–193 ms and 8 400 rebuilt nodes for `motifs` on a 300-chord score, of which **under 1 ms is projection**. Keying on `kind:id` (plus `source` for chips) would let one lane reconcile instead. The catch is `options.label`, which is fixed at mount (`harmony.ts:1926`) — a reused lane would keep the previous view's `aria-label`, so the fix needs `FlowLaneState` to carry the label, or `FlowLaneHandle` to accept a new one. | It is a per-SWITCH cost, not a per-frame one: 60 fps is unaffected (2.37 DOM writes and 0.03 ms per frame, measured). The a11y regression makes the one-line version wrong. |
| 3 | **`show="-root-motion"` names an arc that does not exist.** C.11 set the toggle to `false` so the table stops promising it. §5.3(c)'s root-motion arc is unbuilt in `packages/ui`; C.12 either builds it or deletes the `ToggleId`. | A toggle with nothing behind it is a doc bug, and C.12 owns the `show` vocabulary. |

**To C.13 (all four are kit work in `mountFlowLane`, and C.13 is the other commit
that has to open `harmony.ts` for the rhythm ribbon):**

| # | What | Design |
|---|---|---|
| 4 | `FlowLaneState.focusGroup` is one string, so only one motif can light at a time. Two figures sounding together should light two rows. | §5.5(c) |
| 5 | `[` / `]` step to the next band *anywhere on the reel*; in `motifs` they should step within the focused row, and in `voice-leading` between **issues**. | §5.5(e), §5.6(e) |
| 6 | A bracket is a bare `<div>` in `decorations` with no listener: clicking one seeks nowhere and pins nothing. With it comes the two-column stave (`StaffState.columns = 2, activeColumn = 1`) showing the implicated voices before and after — the pair is one feature, and half of it is not worth landing. | §5.6(b), §5.6(e) |
| 7 | Clicking a hairline in the sounding roll emits `webscore:seek`; §5.3(e) wants it to emphasise that one pitch in the four docks and emit **nothing**. Needs the lane to distinguish a click on a decorative track. | §5.3(e) |
| 8 | The now line is never dashed while the held notes have no name, so §5.7(c)'s "still listening" and "understood" are one state. Needs a `FlowLaneState` channel, and a readable one beside the colour — same for `FlowBracket.severity`, which is colour only today. | §5.7(c) |

**Two errors in `dev/plans/analysis-workbench-design.md` §5.0, found by running its
own worked example.** They are wrong in the DESIGN, not in the code, and nobody
should "fix" `chord-spelling.ts` to match them:

1. §5.0 promises `Bø7/G` as an alternate for `projectSounding([43,59,62,65])`.
   `detect()` returns one candidate for that set, and `rootlessCandidates`
   excludes Bø7/G because its root B **is** sounding. §5.7's own note already
   says `detect()` cannot add an unsounded pitch class; §5.0 forgot to apply it.
2. §5.0 gives the four stave marks `diatonic` 21/34/35/38. §4.1 fixes `C4 = 28`,
   which makes them 18/27/29/31 — what the code emits, and what
   `staff-placement.test.ts` pins.

---

### C.12 (design step 13) — `feat(score): the view says how dense it is and how it moves`

| | |
|---|---|
| **Modify** | `packages/score/src/analyze/element/analysis-view.ts` — `observedAttributes` **inline, closing with a literal `];`** (A.3.11), **13** names in the order `src, format, type, player, show, density, scheme, range, tuning, spelling, shell, motion, window`; `.show/.density/.spelling/.scheme/.motion/.window/.chord` properties; `webscore:viewchange` / `webscore:chordpick` / `webscore:seek` |
| **Modify** | `apps/doc/webmusic/src/lib/params/score-analyze.ts` — the **same 13 names in the same order**. Appending to the end of **both** lists is fine (A.2.13). Kinds: `show`→`text`, `density`→`enum`, `scheme`→`enum`, `range`→`text`, `tuning`→`text`, `spelling`→`enum`, `shell`→`enum`, **`motion`→`enum` (`auto`/`continuous`/`stepped`/`none`)**, **`window`→`text` (`auto` or seconds)**. **`note` is required on every param** (`params/types.ts:12-54`) |
| **Modify** | `apps/doc/.../score/element/analyze/analysis-view.mdx` — API table 7 rows → ~20; Styling rewritten. **The eight backticked `--webscore-analyze-*` names at `:64` must stay live in `packages/*/src` or be deleted from the page in this commit** (A.3.3). New `--wui-harmony-flow-*` / `-motion-*` names may only be documented once the source declares them (C.7b did) |
| **Modify** | `score/api/analyze.mdx:15` (`@tonaljs/progression` → `@tonaljs/chord`) and `:7` (add `live-chord`) · `packages/score/docs/README-analyze.md:23` and `:20` (A.2.18) · `apps/doc/shared/ui-catalog.ts:34` |
| **Docs must add** | design §5.8's "what to call instead" column, per view. **Removing the printed table from a component is only honest if the same page says where to get it** |
| **Gate** | `npm run check:docs && npm run typecheck -w @webmusic/score && npm run typecheck:tests && npm test -w @webmusic/score && npm run check:architecture` → `npm run docs:build` |
| **Accept** | `check:docs` reports no `params` failure of any of the three kinds · `<ElementPlayground>` auto-generates **13** controls · the markup readout reflects a tab click and a `⌘`+wheel zoom, which requires the attribute write-back **and** its re-entrancy guard to both work |
| **Also lands here** | C.11.1 rows 1–3: narrow the shell's frame gate to `playing` (with the `workbench.test.ts:930-947` edit that licenses), key the slots on `kind:id` so a view switch reconciles one lane instead of rebuilding it, and either build §5.3(c)'s root-motion arc or delete the `root-motion` toggle |

---

### C.13 (design step 14, **SPLIT from old C.13**) — `feat(score): the histogram accumulates and the figures fire`

| | |
|---|---|
| **Modify** | `packages/score/src/analyze/element/analysis-histogram.ts` — `observedAttributes` gains `player`; `bindAnalysisPlayer` on connect, **unbind on disconnect** (`:45-47` currently only cancels the source); renders `mountChipStrip` with `meter` (heard) + `meterGhost` (whole score) under `chrome:'bare'` |
| **Modify** | `apps/doc/webmusic/src/lib/params/score-analyze.ts:113-131` — `[SRC, FORMAT, type, PLAYER]`, same index, **same commit** |
| **Modify** | `packages/score/src/analyze/element/rhythm-patterns.ts` — the figure becomes a **proportional ribbon** (segment widths are the pattern's quarter values; the kit is handed four numbers, no theory moves into `packages/ui`), each row gains an occurrence rail, a now-line crosses the stack, and `×3` becomes `2 / 3` as occurrences pass |
| **Preserve — the five rhythm assertions, byte for byte** | `<ol class="wui-analysis__rhythms">` with **direct `<li>` children** (`new-elements.test.ts:104-106`) · `/×\d+/` still in the text after the counter is added (`:106`) · `data-spans` **stays on the `<li>`**, geometry goes inside it, and every value matches `/^\d+(\.\d+)?:\d+(\.\d+)?$/` — **no negative numbers and no exponent form** (`:112-115`) · re-analysis on `length` (`:119-126`) · clamp to 2 (`:130-131`) · the empty copy (`:135-136`) |
| **Rewrite in this commit** | `new-elements.test.ts:146-165` — the histogram's three cases move to the new root class: 12 rows for pitch-class, a non-12 non-zero count for intervals, unknown type falls back to `pitch-class`, **and a new case: bin order is stable across a `type` switch and across playback** |
| **Must contain** | 🔴 **rows never reorder.** A bar chart whose rows swap places while playing is unreadable. Bin order is fixed at first render, for every `type`. This is an acceptance criterion, not a preference |
| **Must not** | use the substring `outline` for pre-light or approach (A.3.18) · touch `renderHistogram` or `renderRhythmPatternList` — audio depends on their DOM byte-for-byte and is out of scope (D3) · take the root class `.wui-analysis__histogram` (audio still owns it) or `.wui-track` (one of the 43) |
| **Gate** | score element row of §F, then `npm run check && npm run docs:build` |
| **Also lands here** | C.11.1 rows 4–8, all in `mountFlowLane`: a multi-group `focusGroup`, `[`/`]` scoped to the focused row and to issues, a clickable bracket with the two-column stave it pins, a decorative track that emphasises without seeking, and a readable channel for "heard but not yet named" |
| **Accept** | `packages/audio/test/analyze/analyze-elements.test.ts` **unchanged and green** — it pins `.wui-analysis__histogram > div` at 3 (`:353`), >0 (`:367`) and 12 (`:377`) · with **no** player bound the histogram still renders 12 rows, ghost track full, heard track empty — **one implementation, both states** · `rhythm-patterns.mdx:38-45` and `:54` updated (the ribbon changes what a row *is*) · `analysis-histogram.mdx:26-31` gains `player`, and `:42`'s "bar track / fill" prose is wrong once ghost and heard are two tokens |

---

### C.14 (design step 15, old C.13 + prose sweep) — `feat(score,audio): the analysis family shares one skin`

| | |
|---|---|
| **Modify** | `packages/score/src/analyze/element/score-analysis.ts` — `chrome:'bare'` wrapper **around** `renderSummaryCard`, never replacing it; an `idle` skeleton and an `error` card; `Range: C4–C6` as two marks on a rail and `Confidence 82%` as a meter (`harmonyParts.meterTrack`/`meterFill` already exist); a 120 ms load transition; **at most one live readout** — the transport position in the status strip, which is a fact about the transport, not about the score |
| **Modify** | `packages/score/src/analyze/element/analysis-timeline.ts:24-29` — drop `rootColor`'s string hash for `progressionTone(pitchClass)`; set `TimelineRegion.selected` from the playhead (`#snapshot()` `:155-165` never sets it today, so regions are inert while the line sweeps); approach shading on `--wui-harmony-motion-chip`; lane crossfade instead of teardown. **`element-composition-policy.mjs:23` gains `'harmony'` in this same commit** (A.2.17) |
| **Modify** | audio's three analyze elements + `<audio-analysis-timeline>` — `chrome:'bare'`, tone table, and the `--waa-*` bridge's four shape properties falling back **before** `--wui-harmony-*`. **No live turn for audio** (D3) |
| **Rewrite in this commit** | 🔴 `elements.test.ts`'s **`<score-analysis>` renders nothing** case (`:185` today) — `<score-analysis>` with no score now renders an `idle` skeleton, so `host.children` is no longer empty. Assert the idle phase instead (`[data-phase="idle"]` present, no `<dl>`) **and say why in the commit message**: rendering literally nothing is the worst possible idle state, because the reader cannot tell it from a typo. The alternative — deferring the shell until a score arrives — keeps the line green and throws away the only honest upgrade this element gets |
| **Docs** | `score-analysis.mdx:33` — replace "The card is static" with *"The card states whole-piece facts; they do not change while the piece plays — the live key read-out is `<analysis-view type=\"key\">`."* **Saying why is worth more than the sentence it replaces.** `:42`'s token list · `analysis-timeline.mdx:36` (the hash is gone; name the 12-tone table **and the two motion models**, design §0.2) and `:48` · `score/element/analyze/index.mdx:31` · `uikit/views-analysis/analysis.mdx:124-125`, `:133-150` |
| **Prose sweep (ungated, all now false at 21)** | `README.md:8` · `packages/ui/README.md:430`, `:432-453`, `:280` · `ARCHITECTURE.md:243-263`, `:352`, `:501-503` · `apps/doc/shared/ui-presenter-catalog.ts:114` · `uikit/index.mdx:31`, `:206` · `uikit/catalog.mdx:3` · `uikit/api.mdx:3`, `:36`, `:60`, `:106` · `dev/UIKIT-PAGE-TEMPLATE.md:5` and its "all eighteen pages" line · `dev/DEVELOPMENT.md:17`, `:42` · `apps/doc/webmusic/src/lib/params/index.ts:1` says "30 elements" and is **already** stale (31) |
| **Optional free fix** | `dev/DEVELOPMENT.md:125` claims CI runs `npm run audit:production` "beside the gate" — `.github/workflows/ci.yml` has no audit step |
| **Gate** | `npm run check && npm run docs:build` |
| **Accept** | `packages/audio/test/analyze/analyze-elements.test.ts` unchanged and green — audio runs vitest **^2.1.9**, not ^3.2.6 · `new-elements.test.ts:59-93` (the timeline's region buttons, the lane switch without remount, exactly one `webscore:seek`) unchanged — **approach shading must not add a second click target** · `new-elements.test.ts:175-178` (`<score-analysis>`'s title and `dt` labels) unchanged, because the bare shell **wraps** the card |

---

## D. ORDERING REVIEW

**The design's original 10-step order was not safe. Three steps could not be green on their own as
written, and one dependency ran backwards.** §D.1–D.4 record that analysis and its fix; **§D.5 folds in
the live turn**, which adds three commits, withdraws one and splits one. Read D.5 for the final sequence.

### D.1 — The one hard reorder: the jsdom migration must move to position 3

**Design step 3 says `<analysis-view>` statically imports `@webmusic/ui/pitch` and "先只在
`live-chord` 用坞位".** `elements.test.ts` exercises exactly that path (`:376-430`, `:530-560`) and
is still on `StubNode` until design step 6. The stub document has **only** `createElement`
(`elements.test.ts:69`) and `StubNode` has **no** `setAttribute` (`:17-59`). Therefore:

- `mountStaff` / `mountFretboard` / `mountWheel` → `document.createElementNS` → **`TypeError`**
- `markEmptyState` (`internal/dom.ts:87-90`) and `setParts` → `node.setAttribute` → **`TypeError`**
- even `mountKeyboard` setting `role="img"` → `setAttribute` → **`TypeError`**

The same argument holds for step 8's `empty` phase — the test-contracts recon flagged "step 6 must
land before step 8", but the constraint actually starts at **step 3**.

**Fix: move design step 6 to sit immediately after step 2.** New order:
`0 → 1 → 2a → 2b → 6 → 3 → 4 → 5 → 7a → 7b → 8 → 9 → 10`.

This is strictly better than the alternative, because the jsdom rewrite is then done **against
known-good current behaviour** rather than against a shell that is being rewritten underneath it.
It also front-loads the second-riskiest commit while the tree is otherwise untouched, so a failure
there costs nothing else.

**If you refuse to reorder:** at steps 3/4/5 use a bare side-effect import
`import '@webmusic/ui/pitch';` in `analysis-view.ts` and wire no docks until step 8. Verified to
satisfy `compareExactSet('30-element UI import closure')` — `isTypeOnlyDeclaration`
(`check-architecture.mjs:454-457`) returns `false` when there is no import clause, so the import is
counted as runtime. Cost: an unused import sits in the element for five commits, and eslint accepts
it only in the clause-less form.

### D.2 — Two splits

**Step 2 → 2a + 2b.** Four new domain modules with unit tests is a 600-line commit whose two halves
share nothing. `chord-spelling` + `staff-placement` (both about a single sounding chord) and
`fretboard-voicing` + `key-wheel` (both a search over a table) are independently green and
independently reviewable. Cheap split, real review benefit.

**Step 7 → 7a + 7b.** This is the design's own "hardest acceptance bar", and its two halves are
pinned by *different* test files:

- 7a (`renderChordTimeline`, `renderMotifList`, `renderVoiceLeadingList`) is pinned by
  `packages/ui/test/analysis.test.ts`'s span-serialisation assertions — exact `data-spans` strings,
  exact node counts, exact document order.
- 7b (`renderKeyView`, `renderRomanStrip`, `renderLiveChordPanel`) is **not imported by
  `analysis.test.ts` at all** — it is pinned by `packages/score/test/analyze/elements.test.ts`'s 32
  microcopy assertions and 3 negatives.

Landing them together means a red run gives you two independent suspects. Split them and each
failure names its own cause.

### D.3 — Steps that are fine as-is

- **Step 1** is genuinely independent and genuinely green on its own — *provided* its scope is
  corrected per B11. As written its headline payoff (§7.4.1) cannot be delivered.
- **Steps 3/4/5 relative to each other** are independent; nothing couples the three subpaths, and
  each just bumps the hardcoded count by one (18→19→20→21). Order among them is free, but `pitch`
  first is right: `harmony`'s chip strip is what step 7a delegates to, and `workbench` depends on
  neither.
- **Steps 9 and 10** are correctly last. Step 9's attribute set is only meaningful once the shell
  exists; step 10's tone table only matters once `harmony` ships.

### D.4 — Dependencies the design leaves implicit

| requires | because |
|---|---|
| 1 before the three subpath commits | `harmony-style.ts` is the single palette source all seven mounts read |
| 2a before the shell commit | the projections call `spellChord` |
| the jsdom migration before 3, 4, 5, 7, 8 | B2 / A.2.12 |
| `pitch` before 7a/7b | the delegating renderers mount the new surfaces |
| `harmony` before 7a | `renderChordTimeline` delegates to `mountChipStrip` |
| build ui before running score/audio tests | score source imports `@webmusic/ui/analysis`, whose exports map points at `dist/` (A.3.10) |
| `check:docs` + `build:packages` before `check:doc-snippets` | the `## Import` fences compile against `.d.ts` (A.3.7) |

---

### D.5 — What the live turn does to the order

The corrected order in D.1 still holds; the turn **adds three commits, removes one, and splits one**.
Final sequence, in §C labels:

```
C.1 → C.2 → C.3 → C.4 → C.5 → C.6 → C.7 → C.7b → C.8 → C.9 → C.10a → C.10b → C.11 → C.12 → C.13 → C.14
```

**Four splits, each for the same reason: a red run should name one suspect.**

| split | why |
|---|---|
| **C.7 / C.7b** | C.7 carries the 13-site registration; C.7b carries the new machinery. Landing them together means a red `check:architecture` could be a missing `compareExactSet` entry **or** a broken frame loop. Split, and the pre-flight (`build -w @webmusic/ui && check:architecture && check:docs`, 4 s) tells you which. C.7b costs **zero** registration churn — the lane moves into a subpath that already exists. |
| **C.10a alone** | The rate≠1 seek fix (B17) touches one method and is verifiable with one stub player. Burying it inside the clock commit makes a one-line behaviour change indistinguishable from a 200-line new module. |
| **C.10b before C.11** | The six views' `binding.position()` is a two-line adapter over `createTransportClock`. Landing the clock first means C.11 has nothing to invent about time. |
| **C.13 / C.14** | Old C.13 was "the family shares one skin" and would now also carry two elements going live plus one test rewrite plus a 20-site prose sweep. The two live elements have real acceptance criteria; the skin sweep has none. Different failure modes, different commits. |

**One removal:** C.10 is withdrawn (B15). Design §7.1 reverses the delegation promise, so there is nothing
left for it to do.

**New dependencies the turn introduces:**

| requires | because |
|---|---|
| C.7 before C.7b | `mountFlowLane` lands in `harmony.ts`, and `internal/spans.ts` is C.7's |
| C.7b before C.8 | the shell's `FrameClock` wraps `internal/frame.ts` |
| C.5 before C.7b | `flow-lane.test.ts` is jsdom, and the lane is what `elements.test.ts` will mount |
| C.10b before C.11 | the clock is the element's per-frame answer |
| C.10a **any time after C.5**, before C.11 | it needs the jsdom harness to test, and C.11 would otherwise inherit the bug into four more views |
| C.12 before C.13/C.14 | the params ↔ `observedAttributes` order is edited twice (view, then histogram); doing them in one commit each keeps the failure message readable |

**What the turn does NOT change:** the jsdom migration is still the load-bearing prerequisite (B2), it is
still at position 5, and the reason is unchanged and now stronger — a `mountFlowLane` calls
`createElementNS` for its now-line and `setAttribute` for `data-zone`, both absent from `StubNode`.

---

## E. RISK TABLE

Ranked by expected cost × probability.

| # | Risk | Early-warning signal | Rollback |
|---|---|---|---|
| ~~**R1**~~ | ~~Step 7 cannot preserve the pinned DOM.~~ **RETIRED by the live turn.** Design §7.1 keeps the six span-carrying renderers static, so `packages/ui/test/analysis.test.ts` needs no edit and C.9 is a small refactor. The risk it described was real; the cure was to stop making the shims live (B15). | — | — |
| **R2** | **The jsdom migration (C.5) balloons.** 60 broken references, 6 failing assertions, 5 inexpressible ones, plus jsdom's `cssText` normalisation and `;;` truncation changing what assertions can see. **Now the top risk.** | After the split, `npm run typecheck:tests` before running vitest — it fails first and cheaply. If the port is still red after re-expressing the six known failures, the harness is wrong, not the assertions. | Revert. Fallback: keep `StubNode` and graft `createElementNS`/`setAttribute`/`classList` onto it, deferring the migration. Costs a permanently divergent test environment but unblocks everything else. |
| **R3** | **A `.wui-*` collision reds `check:docs` in a subpath commit**, and the fix is a rename across the module + its page + its demo. **Comments count.** The lane's natural names are among the worst offenders: `.wui-track` is taken, so the scroll layer must be `__reel`. | `npm run check:docs` (0.3 s) after the very first `.wui-` string is written — before the module is finished. | Rename the class. Cheap if caught early; a 3-file sweep at commit time. |
| **R4** | **`rootDegree` / any `NaN` propagates silently** into widths, angles and sort keys — nothing looks wrong until a wheel segment collapses. **The lane widens this**: a `NaN` in `stampSpans` produces a node that matches `ANALYSIS_SPAN_SELECTOR` and never parses, i.e. a zombie the playhead walks every tick and never lights. | A unit test in C.3 asserting `Number.isFinite` on every numeric field of `SpelledPitch` / `ChordNaming`, and a C.7 assertion that a non-finite span writes **no attribute at all**. | Local. `Number.isFinite` instead of `??`; skip the attribute instead of writing `NaN`. |
| **R5** | **CI reds on `docs:build` while `npm run check` is green** — a bad component import, an unknown `consumerTag` (`UiPresenterRelated.astro:19` throws), a demo returning `undefined` for a catalogued presenter. | Run `npm run docs:build` locally on every commit that touches `.mdx` or `ui-presenter-demos/`. It is not in `npm run check`. | Fix forward — the failure names the tag or presenter. |
| **R6** | **A subpath commit lands partially and the branch is unbuildable.** 13 edits across 9 files, 5 exact-set couplings; the ungated `UiPresenterName` union is caught by no gate. | The 4-second pre-flight `npm run build -w @webmusic/ui && npm run check:architecture && npm run check:docs`. For the union: `npx tsc --noEmit apps/doc/shared/ui-presenter-catalog.ts`. | `git reset --soft HEAD~1` and finish the checklist. Never split a subpath across two commits. |
| **R7** | **`projectSounding`'s `timeupdate` branch has no notes** and someone "solves" it by synthesising octaves from pitch classes — fake precision visible to any musician looking at the staff. | Code review of C.11: the projections must take a `Score`. If one takes only `AnalysisResult`, the octaves are being invented. | Change the signature. |
| **R8** | **A `switch` with string cases lands in a demo file and produces a phantom presenter.** The control strips (spelling/tuning/density/scheme/shell/**motion**) all want exactly that shape. | `npm run check:architecture` (1.1 s) after writing each demo. The error names the phantom. | Rewrite as if/else or an object map. |
| **R9** | **CI-only OOM in score's tsup dts worker** if anyone adds score export entries. | Nothing local. Only the CI log shows it. | This plan adds no score export entries. Keep the new `core/*` and `headless/transport-clock.ts` behind their barrels (A.3.6). |
| **R10** | **The compat token layer is dropped from source while `analysis-view.mdx:64` still backticks the eight `--webscore-analyze-*` names**, reddening `check:docs` at a commit that "only touched styles". | `npm run check:docs` on any commit editing `analysis.ts` or `harmony-style.ts`. | Restore the fallback, or delete the name from the page. Same commit either way. |
| **R11** | **`dist-exports.test.ts` skips silently** after a `git clean -xdf` or a half-failed build. | Its describe block reports as **skipped**, not failed — read the vitest summary line, not the exit code. | `npm run build:packages` and re-run. |
| **R12** | **A phantom `@tonaljs/pitch-note` import passes every gate** and breaks only for a published consumer. | `grep -rn "@tonaljs/pitch-note" packages/*/src` in C.3/C.4 review. No gate does this. | Add the direct dependency **and** regenerate the lock properly, or remove the import. |
| **R13** | 🔴 **An approach / pre-light state uses `outline` and silently flips six assertions.** It is the obvious property to reach for, and `outline-offset` counts. The worst case is `elements.test.ts`'s **one-active-segment** case (`:465-471` today; find it by its `filter(includes('outline'))`) going from 1 active segment to 2 — a failure whose message says nothing about approach shading. | `npm test -w @webmusic/score` after the **first** approach state is written, not after all six views. Grep the diff for `outline`. | Repaint with `background`/`opacity`/`border-color`. A.3.18. |
| **R14** | **The lane writes something per frame onto an item node, and `createAnalysisPlayhead` erases it** the moment that item reaches the now-line — i.e. the only moment that matters. It looks like "the current chord loses its box", which reads as a rendering bug rather than an ownership bug. | The C.7b assertion: an item's `cssText` is byte-identical before and after 60 ticks that cross it. Write that test **first**. | Move the write to the reel. The invariant is design §3.6.1. |
| **R15** | **Someone "simplifies" reduced motion into `transition: none` plus a frozen lane**, quietly undoing the whole turn for every user who set the preference — and no test notices, because the layout still renders. | The C.7b assertion that `stepped` and `continuous` produce **pixel-identical layout**. It is the only thing standing between a preference and a regression. | Restore the stepped driver. Design §2.5.3. |
| **R16** | **The frame loop keeps running on an idle page.** Six lanes × one rAF each was the shape both existing precedents teach (`meter.ts`, `stage.ts`), and a shared loop that forgets to stop is worse than six that do. Symptom: a docs page with a stopped workbench burns a core. | The C.7b assertion: with zero subscribers, `requestAnimationFrame` is **never called** on a fake `view`. Plus the C.8 assertion that a non-`playing`/`listening` phase schedules no frame. | Both are cheap tests; write them with the loop, not after it. |

---

## F. Gate command cheat-sheet (measured, warm `dist/`)

| change kind | command | ≈ s |
|---|---|---|
| ui source, no new subpath | `npx eslint packages/ui/src packages/ui/test && npm run typecheck -w @webmusic/ui && npm run typecheck:tests && npm test -w @webmusic/ui && npm run check:architecture` | 10 |
| …plus its score/audio consumers | `+ npm run build -w @webmusic/ui && npm test -w @webmusic/score && npm test -w @webmusic/audio` | +12 |
| **new ui subpath** | `npm run build -w @webmusic/ui && npm run check:architecture && npm run check:docs` (pre-flight, 4 s), then **`npm run check`**, then **`npm run docs:build`** | 76 + docs |
| score core | `npm run typecheck -w @webmusic/score && npm run typecheck:tests && npm test -w @webmusic/score && npm run check:architecture` | 13 |
| score element / headless | `+ npm run check:docs` | 13 |
| docs / mdx only | `npm run check:docs && npm run check:doc-snippets && npm run typecheck -w webmusic-doc` (**needs a current `dist`**) | 8 |
| always, free | `npm run check:format && npm run check:lockfile` | 0.5 |
| before push | `npm run check` (`dev/DEVELOPMENT.md:110`) | 76 |

Individual baseline timings: format 0.4 · lockfile 0.1 · lint 5.9 · architecture 1.1 · docs 0.3 ·
build:packages 27.0 · doc-snippets 2.3 · typecheck 10.1 · typecheck:tests 5.0 · test 18.6 ·
licenses 0.5 · packages 3.6 · release-manifests 0.2 · **full chain 75.6**.
Inner loop: `npm test -w @webmusic/ui` 2.7 · single-file vitest 1.1 · `npm run build -w @webmusic/ui` 2.2 ·
`npm run typecheck -w webmusic-doc` (astro check) 5.4 · `npm run build -w @webmusic/score` 14.1.

`npm run check` chain (`package.json:27,31`):
`format → lockfile → lint → architecture → docs → build:packages → doc-snippets → typecheck →
typecheck:tests → test → licenses → packages → release-manifests`.
`check:external-install` is **not** in it (publish-time only, 10.9 s).
`npm run docs:build` is **not** in it (separate CI job).

Binding repo rules, quoted:
`ARCHITECTURE.md:368-369` — "Changing architecture means changing a policy table in the same commit —
there is no other knob." · `dev/DEVELOPMENT.md:238-240` — "Add or remove an entry in the policy table,
the manifest, and the build in the same commit — the gate enforces it." · `dev/DEVELOPMENT.md:110` —
`npm run check` before any push. There is **no `CLAUDE.md`** in this repo.

---

## G. The live turn: the layering rule, and every assertion it touches

Design §0 and §5 say what the five elements become. This section says what it **costs**, assertion by
assertion. Nothing here restates the design.

### G.0 The rule, written down so future elements are measured by it

> **A tag in `score/analyze` earns its custom element only if it does something a `<table>` built from
> `session.result` cannot.** Three things qualify: **(a)** it changes with time, **(b)** it changes with
> pointer/keyboard input, **(c)** it draws a geometry no list can draw (ribbon, keyboard, staff, wheel, rail).
> An element that does none of the three is a **report** — and a report belongs either in the consumer's own
> markup fed by a headless call, or on an honest static card that does not pretend otherwise.

Two consequences the pre-turn plan did not carry:

1. **Motion is not the same as liveness.** `createAnalysisPlayhead` (`ui/src/analysis.ts:147-219`) moves an
   `outline` box across a static `<ol>`. That satisfies (a) in the weakest possible way and is exactly what
   the user called static. The bar is D2.
2. **A one-shot `render*(data, root): void` cannot deliver (a) or (b).** It returns nothing to drive. That is
   B15, and it is why C.10 is withdrawn.

Applied to the five, the answers are **not** uniform, which is the point:

| element | (a) | (b) | (c) | verdict |
|---|---|---|---|---|
| `<analysis-view>` | ✓ | ✓ | ✓ | full workbench, six flow-lane stages |
| `<rhythm-patterns>` | ✓ | ✓ | ✓ | ribbon + occurrence rails + a now-line across the stack |
| `<analysis-histogram>` | ✓ | — | ✓ | two tracks: whole-score ghost, heard fill. Needs a **new** headless tracker |
| `<analysis-timeline>` | ✓ | ✓ | ✓ | **already live, in the other model.** Keep the map; do not convert it |
| `<score-analysis>` | — | — | — | **a report. It stays one.** Every row is a whole-piece scalar |

### G.1 Compatibility ledger — every assertion the live turn touches

Status: **🔴 breaks regardless** · **🟡 breaks unless the stated rule is followed** · **🟢 preserved by the
design's decisions** (listed because the pre-turn plan assumed it breaks, or because a careless step breaks it)

#### `packages/ui/test/analysis.test.ts` (236 lines)

| # | line | assertion | status | disposition |
|---|---|---|---|---|
| 1 | `:29-30` | exactly **2** `ANALYSIS_SPAN_SELECTOR` nodes for 2 chord segments; no other span node under the root | 🟢 | Only breaks under delegation. Design §7.1 keeps `renderChordTimeline` static → green untouched. **This assertion is the reason delegation was cancelled** (B15). |
| 2 | `:31-32` | `readAnalysisSpans(rows[0])` deep-equals `[{0,4}]`; document order == input order | 🟢 | `stampSpans()` must reproduce this format byte-for-byte in the **new** mounts (C.7 acceptance). |
| 3 | `:34-35` | every row has a truthy idle style and non-empty `cssText` | 🟢 | — |
| 4 | `:45, :47-50` | motif: exactly **1** span node; `data-spans === '0:3 8:11'` | 🟢 | Same as #1. |
| 5 | `:59-60` | voice-leading `{2,2}` clamps to `[{2,3}]` | 🟢 | — |
| 6 | `:87-90` | `activeClassName` applied · `aria-current="true"` · `style.outline` contains `'2px'` · `scrollIntoView` called exactly **1** | 🟡 | Holds **only if** `createAnalysisPlayhead` keeps exclusive ownership of `outline` (A.3.18) and no live mount steals `scrollIntoView` (A.3.16). |
| 7 | `:92-97` | rewriting `dataset.spans` invalidates the cache; second row scrolls exactly once | 🟡 | Same rules. |
| 8 | `:110-117` | a second `createAnalysisPlayhead` on one root deposes the first | 🟡 | The new mounts must claim a **different host node** than the playhead's root, or `claimHost` deposes one of them silently. |
| 9 | `:128-130` | every node's `ownerDocument === foreign` | 🟡 | Every new mount resolves `document` from the host (`host.ownerDocument`), never `globalThis.document`. |
| 10 | `:143-147` | histogram fills: exactly **3** `span > span`, widths `'100%' / '50%' / '0%'` | 🟢 | `renderHistogram` stays untouched; the live histogram is a **new** mount with a **new** root class (#24). |
| 11 | `:154-155` | all-zero bins → every fill `'0%'` | 🟢 | — |
| 12 | `:162-163` | empty label text; `.wui-analysis__histogram` absent | 🟢 | — |
| 13 | `:172` | formatter output `'1235t'` | 🟢 | — |
| 14 | `:191-195` | `.wui-analysis__title === 'Prelude'` · subtitle · `dl` with `dt` `['Key','Notes']`, `dd` `['C major','544']` | 🟢 | `<score-analysis>`'s bare shell must **wrap** `renderSummaryCard`, never replace it (C.14). |
| 15 | `:202-203` | exactly 1 `dt` with no subtitle | 🟢 | — |
| 16 | `:215-217` | `.wui-analysis__rhythms > li` exactly **2**, direct children; row text contains `'×3'` | 🟢 | `renderRhythmPatternList` stays static; `<rhythm-patterns>` moves to the live mount. |
| 17 | `:219` | `dataset.spans === '0:3 4:7 8:11'` | 🟢 | — |
| 18 | `:226, :233-234` | `'0.333'` fallback · `'No repeated rhythms found.'` · `.wui-analysis__rhythms` absent when empty | 🟢 | Empty copy must stay reachable from the shell too (B14). |

**Net: this file needs no edit at all.** That is the payoff of B15's reversal, not a coincidence.

#### `packages/score/test/analyze/new-elements.test.ts` (180 lines, jsdom, real elements)

| # | line | assertion | status | disposition |
|---|---|---|---|---|
| 19 | `:59-60` | `<analysis-timeline>` renders `> 0` `<button>` regions | 🟢 | Preserved **only** by keeping the map model (design §7.5). Converting it to a now-line kills every timeline assertion here **and** collides with `EXPECTED_ELEMENTS = 5` and D1. |
| 20 | `:64-73` | lane switch changes the button count without remounting | 🟢 | The lane crossfade must not remount `mountTimeline`. |
| 21 | `:83-88` | region click dispatches exactly **1** `webscore:seek` with `{quarters, seconds}` | 🟢 | Approach shading must not add a second click target. C.10a changes the **player call**, not the event. |
| 22 | `:92-93` | unknown lane → `'chords'` | 🟢 | — |
| 23 | `:104-106`, `:112-115`, `:119-126`, `:130-131`, `:135-136` | `<rhythm-patterns>`: `.wui-analysis__rhythms > li` count · `/×\d+/` · `data-spans` matching `/^\d+(\.\d+)?:\d+(\.\d+)?$/` · re-analysis on `length` · clamp to 2 · empty copy | 🟡 | **All five preservable and all five must be preserved** (C.13). The live mount keeps the `<ol>` and its direct `<li>` children; `data-spans` stays on the `<li>`; the ribbon writes no negative or exponent-form number into a span (the regex rejects both); `×N` stays in the text beside the `2 / 3` counter. |
| 24 | `:146-148`, `:152-160`, `:164-165` | `<analysis-histogram>`: `.wui-analysis__histogram > div` exactly **12** for pitch-class, `≠12` and `>0` for intervals, text contains `'C'`, unknown type → `'pitch-class'` | 🔴 | **Rewrite, in C.13.** The live element leaves `renderHistogram` for a two-track `mountChipStrip` under a namespaced root class (never `.wui-analysis__histogram` — audio owns it — and never `.wui-track`, one of the 43). New assertions: 12 rows in the new class, each with a ghost track **and** a heard fill; **bin order stable** across a `type` switch and across playback. |
| 25 | `:175-178` | `<score-analysis>`: `.wui-analysis__title` present; `dt` labels contain `'Key'` and `'Chord segments'` | 🟢 | Preserved because the bare shell wraps the card. |

#### `packages/score/test/analyze/elements.test.ts` (648 lines) — content breaks on top of the C.5 jsdom migration

| # | line | assertion | status | disposition |
|---|---|---|---|---|
| 26 | `:253-257` | `<score-analysis>` text contains `'Key'`, `'C major'`, `'Notes'`, `'13'` | 🟢 | Bare shell wraps the card. **C.5 tightened the last one to `` `Notes ${C_MAJOR.length}` ``** — the card also prints `Chord segments 13`, so a bare `'13'` matched whichever figure happened to be 13. The adjacency holds as long as the shell wraps `renderSummaryCard` rather than replacing it, which is the same condition this row already carries. |
| 27 | **`:264`** | **`host.children` has length 0 when there is no score** | 🔴 | **Breaks, unavoidably, and the change is the point.** Rewrite to assert the idle phase, in C.14, with the reason in the commit message. Today the element renders literally nothing (`score-analysis.ts:49` returns silently) and the reader cannot tell it from a typo. |
| 28 | `:296-299` | the chords view's root has a **direct `<ol>` child with children** | 🟡 | Held by `mountWorkbench`'s `index` slot (design §3.6.7): the semantic `<ol>` is a **direct child of the mount host, sibling of the workbench frame**. **Do not edit the test** — it is the only structural assertion protecting "this view has structured output". |
| 29 | `:300`, `:308`, `:317`, `:325`, `:333`, `:337-339`, `:347`, `:351` | `'beat 1'` · `'in C major'` · `'intervals'` · `'clean'` · `'confidence'` present then absent · `'A minor'` · **`host.children.length === 1`** after a type switch | 🟡 | ~35 microcopy strings survive verbatim inside the new structure (assertions walk a depth-first text join). Landing sites: design §7.6. `children.length === 1` requires the shell to be **one** root node and requires the type switch to `destroy()` the previous mount (C.11). |
| 29b | `:347`, `:351` | the incremental case now reads `'C major confidence'` / `'A minor confidence'` | 🟡 | **C.5 re-expressed these two.** The key wheel prints neighbour keys, so a C-major render's flattened text already contains `'A minor'` and vice versa (measured) — the old pair passed on **both** renders and the file's only test of a second `.score` assignment could not fail. The headline-then-confidence adjacency is the discriminator. Design §7.6 puts both in the wheel's centre: keep them adjacent in the text join, or re-point at the centre readout node in **C.11**. |
| 30 | `:380-382`, `:391-396`, `:408-411`, `:421`, `:424-426`, `:450`, `:457-458`, `:473`, `:477-478`, `:496`, `:503-505`, `:541-543`, `:551-552` | the live-chord and live-key copy, listener counts, and event shapes | 🟡 | All land in design §7.6. The four listener-count assertions constrain C.10b: **widening `AnalysisPlayerHandlers` must not change how many listeners `bindAnalysisPlayer` attaches.** |
| 31 | `:579-586` | motif rows found by `[data-spans]`; `cssText` includes `'outline'` on a hit, absent past the end | 🟡 | A.3.18. |
| 32 | `:601-607` | voice-leading row found by `[data-start-quarters]`; `cssText` contains `'outline'` | 🟡 | A.3.18. |
| 33 | **the **one-active-segment** case (`:465-471` today)** | **exactly `1` active segment, and `active[0] === segments[0]`** | 🟡 | **The assertion the now-line most endangers.** A scrolling lane that lights the sounding chord *and* the approaching one takes the count to 2 the moment approach shading touches `outline`. A.3.18 is what keeps it green; make it an explicit acceptance criterion of C.7b and C.11. |
| 34 | `:645-646` | zero active past the end of the piece | 🟡 | Same. |

#### Other suites and gates

| # | file:line | what it pins | status |
|---|---|---|---|
| 35 | `packages/audio/test/analyze/analyze-elements.test.ts:353, 367, 377` | `.wui-analysis__histogram > div` at 3 / >0 / 12 | 🟡 — green **iff** audio keeps calling `renderHistogram` and the live mount takes a new class (#24). Audio runs vitest **^2.1.9**. |
| 36 | `packages/score/test/analyze/playhead.test.ts:33-34, 46-47` | idle style ending in `';'`; `lit()` = `is-playing` **and** `aria-current="true"` | 🟡 — the default `activeClassName` and the ARIA write cannot move. |
| 37 | `packages/score/test/analyze/playhead.test.ts:61, 66, 69` | exact `scrollIntoView` counts through `createPlayheadHighlighter` | 🟡 — **A.3.19**: the `scroll` default must not change. Add the option; only the workbench passes `false`. |
| 38 | `packages/ui/test/ssr.test.ts:4-25` | hand-written import list; `*Style` strings contain their root selector | 🟡 — **not auto-discovered.** Every new mount, `mountFlowLane` included, needs a row in its own commit or it is silently SSR-uncovered. |
| 39 | `packages/ui/test/stylesheet-option.test.ts:17-46` | the `MOUNTS` table — every mount honours `{stylesheet:false}` | 🟡 — same. **`mountFlowLane` in particular**: its `overflow: clip` and its now-line must be painted inline too, or the inline path renders a lane with no clipping. |
| 40 | `scripts/element-composition-policy.mjs:21-26` | `analysis-view`/`score-analysis`/`rhythm-patterns`/`analysis-histogram` → `['analysis']`; `analysis-timeline` → `['timeline']` | 🔴 — must gain `'pitch'`/`'harmony'`/`'workbench'` **in the same commit** the element statically imports them (A.2.17). |
| 41 | `apps/doc/webmusic/src/lib/params/score-analyze.ts:113-131` | `<analysis-histogram>` params = `[SRC, FORMAT, type]` | 🔴 — adding `player` to `observedAttributes` requires the same name at the same index here; `check-docs.mjs` compares set **then** order. |
| 42 | `check-docs.mjs:76-95` | `observedAttributes` parsed from source text | 🟡 — keep the array **inline, closing with a literal `];`** (A.3.11). |

### G.2 Headless additions — the complete list

| # | addition | file | why the existing API is not enough |
|---|---|---|---|
| 1 | `projectProgression(result, score, mode)` + `projectKeyFlow` / `projectMotifFlow` / `projectVoiceFlow` / `projectKeyCandidates` | `headless/workbench.ts` (new, C.11) | `regionsFor()` (`analysis-timeline.ts:31-64`) is a pure `AnalysisResult → labelled boxes` projection **living inside an element**. Moving it is the literal answer to *"that kind of thing should be headless."* Strictly DOM-free — **not even an `HTMLElement` type annotation**. |
| 2 | `createTransportClock` | `headless/transport-clock.ts` (new, C.10b) | Nothing today turns a 20 Hz cursor stream into a per-frame position, and doing it in the kit would put rate and seek detection — domain knowledge — inside a domain-neutral presenter. B16/B19. |
| 3 | **`createLiveDistributionTracker`** | `headless/live-trackers.ts` (C.10b) | `createLiveKeyTracker` (`:82-103`) is **count-weighted** and never exposes its bins; `distributions().pitchClasses` (`core/distributions.ts:87`) is **duration-weighted**. Drawing one over the other is two units on one axis. B18. |
| 4 | `ScoreReport` row `value?: number` | `headless/report.ts:19` | Rows are display strings, so a consumer drawing their own confidence meter must re-parse `'82%'`. Additive, no break. |
| 5 | *(none)* | — | `rhythmPatterns`, `segmentChords`, `chordTimeline`, `distributions`, `findMotifs`, `voiceLeading`, `romanNumerals`, `detectKey`, `createScoreReport`, `createAnalysisSession`, `useScoreAnalysis` are all **sufficient** for a consumer rendering their own table. **Say so on each element's page** — that is the promise that makes removing the printed table from the component honest rather than lossy. |

### G.3 Doc pages that go stale

| page:line | what goes stale |
|---|---|
| `score/element/analyze/score-analysis.mdx:33` | *"The card is static"* → say **why**, and point at `<analysis-view type="key">` (C.14). |
| `score/element/analyze/score-analysis.mdx:42` | token list — the card now resolves `--wui-harmony-*`. |
| `score/element/analyze/analysis-histogram.mdx:26-31` | API table gains `player`. |
| `score/element/analyze/analysis-histogram.mdx:29` | *"No events."* — still true; the player-binding sentence is missing. |
| `score/element/analyze/analysis-histogram.mdx:42` | `--wm-analysis-track` / `-accent` as "bar track / fill" — wrong once ghost and heard are two tokens. |
| `score/element/analyze/rhythm-patterns.mdx:38-45` | "Rows are ordered by occurrence count… Dyadic values render as note glyphs" — the ribbon changes what a row *is*. |
| `score/element/analyze/rhythm-patterns.mdx:54` | token list. |
| `score/element/analyze/analysis-timeline.mdx:36` | *"Regions are coloured by chord root, motif identity or issue severity"* — the hash is gone; name the 12-tone table, **and name the two motion models** (design §0.2). |
| `score/element/analyze/analysis-timeline.mdx:48` | `--wm-timeline-*` only — the tone table is `--wui-progression-tone-*`. |
| `score/element/analyze/analysis-view.mdx` | API table 7 rows → ~20; Styling rewritten; the eight `--webscore-analyze-*` names at `:64` (A.3.3). |
| `score/element/analyze/index.mdx:31` | the seven `--wm-analysis-*` names as the family's whole token story. |
| `uikit/views-analysis/analysis.mdx:124-125` | *"Timelines and repeated-pattern output use real ordered lists"* — still true of these six; must now say the live surfaces live elsewhere. |
| `uikit/views-analysis/analysis.mdx:133-150` | the nine-row `--wm-analysis-*` token table. |
| **A.3.3 trap** | every `--wui-*` name backticked on any page must already appear as `var(--x`, `--x:` or `setProperty('--x'` in `packages/{score,audio,ui}/src`. `--wm-*` is exempt; **`--wui-*` is not.** Document the flow, motion and ghost/heard tokens only in the commit that declares them. |

### G.4 Reduced motion, per element, non-negotiable

Every transition above resolves a `--wui-harmony-motion-*` token, and the
`@media (prefers-reduced-motion: reduce)` block already exists in `harmonySheet` (`harmony-style.ts:743-744`).
**The inline path — which is what these light-DOM elements actually use — must paint
`harmonyMotion.reduced` via `harmonyRootDeclarations({motion:'reduced'})` when the host reads the
preference.** A stylesheet-only escape does not reach them, and a media query cannot ride in `cssText`.

And a media query cannot stop a rAF-driven `transform` at all. So reduced motion means **a different driver,
not a disabled one** (design §2.5.3): the layout is pixel-identical, the anticipation survives, and the page
stops scheduling frames. Assert the pixel-identical layout in `flow-lane.test.ts`; it is the assertion that
stops someone "simplifying" reduced motion into a frozen list and quietly undoing the whole turn.
