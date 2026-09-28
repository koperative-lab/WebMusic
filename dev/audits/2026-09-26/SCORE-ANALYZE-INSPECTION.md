# Score Analyze inspection tools

## Baseline and scope

2026-09-26, local `dev` at `ae0742a` with the preserved uncommitted Audio,
Bridge and documentation work; Node 26.8.1. This record covers the
maintainer-approved DEC-038 exception in this checkout, not a change to main.

The public Score Analyze Element inventory is now exactly five tags:
`live-chord-analysis`, `chord-analysis`, `key-analysis`, `interval-analysis` and
`rhythm-analysis`. The former Roman and voice-leading Elements and their pages
are retired, while their analysis algorithms remain in API/Headless. Interval
and rhythm inspection have reusable nonvisual algorithms. The three score-based
inspection surfaces expose local selection and evidence; choosing a reading
does not edit the Score. Documentation demos use one player and one Analyze
Element. A short two-bar MusicXML fixture keeps interval and rhythm inspection
legible in the documentation canvas.

The shared UI Kit flow lane needed a pointer-capture repair: its click now uses
the band pressed at gesture start, even if the browser retargets the resulting
click. Nameplate candidate buttons can expose an optional pressed state and
stable candidate identity, so the current key can be pinned directly and focus
returns to the same reading when Follow ranking appears. Tests cover both.

## Verification

- `npm run docs:sync`: 236 documents, 28 Elements and 25 presenters indexed.
- `npm run docs:build`: five packages and 116 pages built; the site verified
  114 public references and its license notices.
- `npm run check:architecture`, `check:docs`, `check:dev-docs`,
  `check:site-notices`, `check:doc-snippets`, `typecheck`, `typecheck:tests`,
  `check:licenses`, `check:packages` and `check:release-manifests` passed.
  Snippet checking compiled 253 examples against built declarations.
- `npm test` passed all 337 test files and 4,178 tests across Kernel, UI,
  Score, Audio, Bridge and the documentation site. Focused Score/UI suites
  cover selection, candidate pinning, pointer capture, partial-meter beat
  boundaries, note provenance and local interpretation.
- `npm run check` reached lint and stopped at the same seven unchanged
  Score/UI findings tracked by DEV-06. Scoped lint of the changed Score/UI
  files passed; no lint rule was disabled.

In the in-app browser, the five pages loaded with no console errors or
horizontal page overflow at ordinary and 390px viewport widths. The interval
and rhythm demos showed nine and seventeen flow bands, respectively, from the
short score. Key candidate Enter pinned the currently detected key, exposed
the pressed state and retained focus on that candidate. Rhythm ArrowRight
advanced the lane from 0 to 1 and the bound player's seek value from 0 to
20.83%, confirming one borrowed navigation owner in that smoke test.

The browser automation's pointer click left both an analysis candidate and
the documentation Parameters control unchanged, so it did not establish a
successful real-browser pointer assertion. Pointer-target behavior is covered
by unit regressions but remains browser acceptance work. Audible non-unit-rate
seeking, device input, screen-reader use, large-score performance, and broad
music-theory corpus accuracy were not measured. This record does not establish
main promotion, remote CI, publication or deployment.
