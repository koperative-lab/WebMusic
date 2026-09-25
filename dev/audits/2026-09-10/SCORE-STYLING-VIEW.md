# Score View styling review — 2026-09-10

## Scope and baseline

Reviewed the current main checkout at `/Users/mamingchen/GitHub/WebMusic`, preserving the preceding uncommitted algorithm audits and concurrent documentation changes. This task owns View Element/render source, View regression tests and the three owning Element references plus API View color prose. UIKit is owned by the parallel UI review. No package builds, dist writes, commits, pushes or browser automation were performed here; root coordinates those acceptance gates.

Read the repository guide, frontend-review skill/workflow and current View design. This is source/DOM/paint evidence, with real OSMD SVG backend validation; root's browser measurements remain the visual acceptance authority.

## Coverage and changes

| Surface | Drawing/background review | Result |
| --- | --- | --- |
| score-view piano-roll | Public factory uses SVG; note and active fills contain live CSS expressions; drawing is transparent; stage owns frame | Existing theme propagation preserved. Added stable `drawing` part on the render surface. |
| score-view staff | Real staffrender SVG supplies note/stem/flag/line paint through the existing scoped palette; signature background is transparent RGBA | No new recoloring algorithm needed. Existing active union, rhythm layout, split-staves and live colors preserved; added `drawing` part. |
| score-view waterfall | Notes are SVG; embedded keyboard is UIKit, or existing SVG keyboard fallback beyond the UIKit range | Added UIKit `surface: 'none'` to the embedded keyboard so generic component borders/padding/background do not create a second frame or change column geometry. Existing key colors and explicit active-note color remain. Added `drawing` part. |
| score-view map | UIKit timeline renders cells, ruler, interaction and cursor; density cells had only generic accent | Cells now honor explicit `.options.noteColor`, `.options.noteRGB` and `note-color`, before dedicated `--wm-score-view-map` / generic accent. Density remains opacity. Timeline owns frame and controls. |
| score-view thumbnail | Fitted SVG, passive, transparent drawing | Fixed ignored `.options.noteColor`. Explicit CSS color > explicit RGB > attribute > `--wm-score-view-note` > currentColor. Added `drawing` part. |
| pitch-view keyboard | Entire paint/geometry delegated to UIKit; host adds sizing only | No duplicate View style implementation. UI owner adds canonical surface chain and shared key fallbacks. Existing held notes/source binding remain. |
| pitch-view staff | UIKit SVG/current marks; no View-private ink overrides | UI owner supplies public staff-line token/shared ink. No domain edits needed. |
| pitch-view fretboard | UIKit SVG/current marks; no View-private paint overrides | UI owner supplies public neck/wire/nut/string/inlay tokens. No domain edits needed. |
| sheet-view | Stage paper was always white unless sheet-specific token; OSMD default black was fixed into SVG | Paper now `--wm-sheet-background` > `--wm-surface` > white. Element-created OSMD gets a legal private default hex paint, mapped only at that scoped SVG paint boundary to `--wm-sheet-foreground` > `--wm-foreground` > black. OSMD drawing page itself is transparent. Mapping survives OSMD reflow because stylesheet is outside its mutable backend surface. |
| Internal canvas piano-roll adapter | Found that `noteColor`/`activeNoteColor` were ignored; only RGB used | Resolves full CSS colors in inherited canvas context once per layer paint, preserving velocity opacity. Repainting at the same nominal time updates changed static ink and active paint without losing that sample. Scroll and resize also use current colors; temporary probes removed synchronously. |

Important export boundary: `PianoRollCanvasVisualizer` is an internal exported class, **not exported by the public `/view/render` barrel**. No public Canvas constructor or new public refresh method was added. The user-facing factories and ScoreView Element use SVG, so CSS changes apply live without a refresh API. Earlier intermediate wording that described a public Canvas constructor was corrected in the owning API reference.

## Styling precedence and supported hooks

- Full Score note views retain `.options` over attributes over Element theme defaults; within `.options`, CSS `noteColor` / `activeNoteColor` win over RGB counterparts.
- Idle Score notes: `--wm-score-view-note` > `--wm-foreground` > existing light/dark default. Active Score notes: `--wm-score-view-active-note` > existing red `(240, 84, 119)`; generic accent does not silently replace the active-note default.
- Map/thumbnail use the explicit precedence above and their type-specific CSS fallback.
- UIKit canonical outer surface tokens `--wm-<presenter>-surface-*` override shared `--wm-component-{background,border,radius,padding}`. Shared `--wm-surface`, `--wm-foreground`, `--wm-accent` remain palette fallbacks; legacy presenter tokens remain in UIKit's chains.
- Setting both `--wm-component-background: transparent` and `--wm-surface: transparent` clears outer and nested default backgrounds. Dedicated presenter/token overrides retain their explicit precedence. Individual keyboard keys/fretboard necks can be customized through their own paint tokens.
- These Elements use light DOM: use ordinary selectors for `[part~="root"]`, `[part~="surface"]`, new `[part~="drawing"]`, or Pitch's `board`/`svg` parts; do not imply shadow `::part` semantics.
- Runtime changes to class/inline/ancestor CSS update the same SVG/DOM nodes. No source fetch/reload, playback seek or extra clock is introduced.
- Explicitly adopted `.osmd` instances retain the caller's rendering options/ink. Native OSMD cursor retains its own drawing style. The low-level OSMD renderer still accepts caller `osmdOptions` and is not globally recolored.

## Regression evidence

New `packages/score/test/view/styling.test.ts`:

1. Thumbnail CSS/RGB/attribute/token precedence; no remount for CSS-only changes.
2. Map equivalent precedence and identity preservation.
3. Canvas actual fill calls use resolved CSS color rather than RGB fallback; velocity alpha remains 0.6 for velocity 40; same-time repaint picks up changed inherited color and retains active paint; no retained probe DOM.
4. Actual OpenSheetMusicDisplay **1.9.9** SVG backend with independently authored MusicXML: note/music ink and lines carry themed default paint, no white drawing fills, matching stylesheet paints the actual SVG node (computed fill checked with a concrete color), class/token updates retain its SVG. Font metrics/skyline pixels are stubbed in jsdom, so this is paint-contract evidence rather than visual-layout evidence.

The existing Sheet layout regression was updated to assert the expanded legacy paper fallback, without altering its source/load/cursor/size assertions.

Commands and results:

- `npx vitest run test/view/styling.test.ts test/view/canvas-visualizer.test.ts test/view/sheet-view-layout.test.ts test/view/responsive-score-view.test.ts test/view/score-view-modes.test.ts test/view/staff-timeline.test.ts test/view/pitch-readouts.test.ts test/view/elements.test.ts` (Score workspace): **102 tests / 8 files passed**.
- Focused ESLint on the changed View source/tests: **passed**.
- `git diff --check` scoped to View source/tests/references: **passed**.
- `npx tsc --noEmit -p packages/score/tsconfig.json`: only four stale UIKit declaration errors (Analyze frame/surface x3 and Score keyboard surface), awaiting root's coordinated UI build.
- `npx tsc --noEmit -p tsconfig.test.json`: same stale declarations plus two parallel UIKit fixture errors (`FlowLaneState.now`, `ChipItem.start/end`), reported to UI owner. No other View test errors.

During initial test setup, jsdom lacked CSS var/currentColor resolution and native cursor scrolling. The Canvas test supplies the browser-computed result only at that boundary, then verifies real paint calls. The real OSMD test disables cursor follow and uses an independent valid engraving fixture. Those limits are explicit rather than a claim of browser parity.

## Final ownership/freeze

View source, tests and owning references are frozen for root's integrated build/browser/full checks. Root owns the tiny common type-comment correction from SVG-only to SVG/canvas capability (no type shape change). UI owns the new Pitch surface option/tokens and the canonical frames. Remaining verification: actual browser computed CSS variable resolution, transparent backgrounds against ancestor surfaces, responsive layout/focus/accessibility and combined component behavior. No new public API declarations were introduced by this View work.

## Final integration follow-up

The parent integration subsequently added shared `--wm-accent` between the
specific active-note token and the existing red fallback, at the user's request
for inherited customization. This supersedes the earlier active-note precedence
sentence in this handoff report. Explicit renderer colors/attributes still win.
The final repository gates and actual browser evidence, including the resolved
stale-declaration checks, are in [the integrated report](SCORE-STYLING.md).
