# Analyze demo alignment

## Baseline and scope

2026-09-26, Node 24.21.0, local `dev` working tree at `ae0742a` with the restored
migration and prior follow-ups. The maintainer reported that Analyze demos did
not follow the existing design. This pass covers all five Score and all five
Audio Analyze Element pages. DEC-033 records the explicit Score demo exception
to main's baseline. Score runtime source and the separate main checkout were
not changed; main remained clean.

## Findings and repairs

- Score's shared demo used a 16px gap and a local player-height override. It now
  uses ElementComposition: full-width siblings with an 8px gap and package
  control defaults. Analysis keeps its intentionally bare presenter contract.
- Audio compositions used unrelated margin/display fixes and omitted supporting
  elements from Copy. Every page now uses the same composition, with runner and
  player Parameters scoped to their own element and complete fragment markup.
- Audio Analysis View had five panels and five runners for type variants. One
  main demo now supplies all five types from one result. The shared 12-second
  fixture is the original demo.wav PCM at [30,42) seconds, 44.1kHz stereo; the
  original asset is unchanged. Detailed fixture/binding prose follows Import.
- The invisible runner's demo readout now owns and cleans up listeners and
  observation, adopts retained results, distinguishes missing input and failure,
  and does not clear a failure on a no-op parameter write.
- Audio's four visible Analyze hosts wrote inline display:block, overriding
  native hidden and caller layout. Low-specificity host rules now provide fluid
  defaults while preserving visibility and application CSS.
- Histogram used an adopted runner clip as explicit input, leaving stale chroma
  after source changes. Borrowed clips/results now have separate lifetimes and
  explicit inputs retain priority. Obsolete URL loads cannot replace the latest
  view; clearing a failed override restores the borrowed chroma cache correctly.

## Automated verification

- `npm run check:docs`: passed, 72 live-demo pages, 84 instances and 111 routes.
- `npm run check:dev-docs`, `npm run check:format`: passed.
- `npm run check:architecture`: five packages and 395 source modules passed.
- `npm run test -w webmusic-doc`: 223 tests passed, including five actual-demo
  feedback/lifecycle regressions.
- `npm run test -w @webmusic/audio`: 886 tests passed, including nine host layout
  cases and eight histogram source/recovery cases.
- Audio typecheck, docs typecheck and test typecheck passed. Astro retained the
  same three keyCode deprecation hints, with no errors or warnings.
- `npm run check:doc-snippets`: 244 examples passed against rebuilt declarations.
- Scoped lint on changed code/tests passed. `npm run check` still stops at the
  seven inherited Score/UI findings in the [main alignment audit](../2026-09-25/MAIN-AUTHORITY-ALIGNMENT.md).
- `npm run docs:build` passed for all five packages and 113 site pages. After
  shortening the final page introductions, `npm run build -w webmusic-doc` also
  passed: 111 public references and the Toolkit catalog verified.

## Rendered browser evidence

All ten pages were inspected in the local in-app browser at its ordinary
1265px viewport and at 320px. Visible siblings had equal widths (about 538px
and 218px respectively); the shared gap was 8px, hidden runners occupied no
space, and the pages did not overflow horizontally. Each page had one main demo.

Roman lane ArrowRight updated the linked Score seek control. Function-row
Parameters, Copy feedback and Reset worked. The Audio timeline's ArrowRight
moved its linked player to 0.5 seconds. Audio Analysis View changed among all
five populated modes using the same runner (G major, 120 BPM, loudness, 72 onsets,
and the measured pitch range for this fixture). A deliberately missing histogram
src produced a visible 404 error; Reset and a return to chroma restored the same
12-bin profile. The rendered code readouts include the supporting runner/player.

Screenshots were captured for the Roman lane and Audio timeline. These browser
checks establish layout and interaction, not acoustic quality, physical-device
performance, screen-reader acceptance or external publication.

## Remaining boundary

A URL-only runner retains its result but does not expose a decoded-clip snapshot
after completion. A later Histogram can adopt its result, but chroma needs an
explicit clip/src or a subsequent completion event. No new runner API was added;
AUDIO-ANALYZE-01 in STATUS owns that future contract. Current demos attach before
the runner completes.
