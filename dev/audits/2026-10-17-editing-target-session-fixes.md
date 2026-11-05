# Editing command-target and session repairs — 2026-10-17

## Scope and baseline

This repair closes the two P2 findings in the
[post-fix release review](2026-10-16-editing-post-fix-review.md), with regression
coverage for the changed command and attachment paths. It also repairs the
reproduced waveform disposal callback described below. Earlier dated evidence
remains unchanged.

Baseline: uncommitted `editing-capabilities`, based on
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`, macOS, Node 26.8.1/npm 11.19.0.
No version, release commit, authentication, publication or deployment is changed.

## Repairs

Waveform commands capture and revalidate their actual target across synchronous
draft cancellation. Trim/Delete require the same complete frame range;
Split/Insert silence require the same start frame; Gain/Fade require the same
segment ID. A changed target abandons the old operation without a content
revision, history entry or commit event. A document revision change still reports
`revision-conflict`, and unavailable/read-only/disposed controllers cannot commit.
Unrelated selection or segment changes do not invalidate a valid command, and
pending gain/silence values remain intact. The owning Audio View API reference
describes this boundary.

A bounded lifecycle regression also reproduced a mutation during waveform
teardown: cancellation of an active selection gesture could synchronously invoke
Delete before the renderer became unavailable. Disposal now prevents commands and
repeated cleanup from reentering while still cancelling its own gesture and
releasing resources. This is part of the changed cancellation path, not an
expansion into unrelated editing features.

Making renderer disposal terminal exposed an existing Audio Element lifecycle
test's dependence on repeated cleanup. Presentation teardown now captures and
detaches the old resources before calling them, and attempts every captured
cleanup even if one fails. Presentation/editor generations prevent old render,
unmount and viewport-restoration work from overwriting a newer binding. The
existing test again verifies one surface, released asset leases and removed
window listeners after a cancellation callback replaces the editor.

The Score View interaction-session setter rebuilds its editing attachment and
restores the current player snapshot through the existing player binding. The
editor generation and connected state prevent an older setter from reattaching
after cleanup replaces the session or disconnects the View. Assigning, replacing
or clearing a session keeps the paused position and playback overlay; a view
without a player remains usable, and borrowed sessions remain caller-owned.
Eight new regressions cover these cases and subsequent seeks. The public Score
View reference now states the replacement/clearing contract.

## Verification

The maintained suite adds 30 regressions: 22 Audio command-target/disposal cases
and eight Score session cases. Failures were reproduced before the corresponding
fix: [Audio targets](2026-10-17-editing-target-session-fixes/audio-targets-before.txt),
[Audio disposal](2026-10-17-editing-target-session-fixes/audio-disposal-before.txt),
[Audio Element integration](2026-10-17-editing-target-session-fixes/audio-integration-before.txt)
and [Score sessions](2026-10-17-editing-target-session-fixes/score-session-before.txt).

- Audio focused suites pass 4 files / 103 tests
  ([log](2026-10-17-editing-target-session-fixes/audio-focused-tests.txt)); the
  entire Audio View suite passes 24 files / 346 tests
  ([log](2026-10-17-editing-target-session-fixes/audio-view-tests.txt)).
- Score focused suites pass 4 files / 63 tests
  ([log](2026-10-17-editing-target-session-fixes/score-focused-tests.txt)).
- Both domains' source typechecks pass
  ([Audio](2026-10-17-editing-target-session-fixes/audio-types.txt),
  [Score](2026-10-17-editing-target-session-fixes/score-types.txt)).
- `npm run audit:production` passes with zero vulnerabilities
  ([log](2026-10-17-editing-target-session-fixes/production-audit.txt)).
- `npm run check` passes: 371 workspace test files / 4,661 tests, plus
  dev-server/script regressions, architecture, documentation/snippets,
  source/test types, licenses, built exports/receipts and release manifests
  ([log](2026-10-17-editing-target-session-fixes/full-check.txt)).
- `npm run docs:build` passes: 117 pages, 115 public references, 74 license
  records and 367 covered files
  ([log](2026-10-17-editing-target-session-fixes/docs-build.txt)).
- `npm run check:external-install` passes: 184 ESM/CJS runtime entries and
  96 ESM/browser plus 92 CommonJS declarations, with `skipLibCheck: false`
  ([log](2026-10-17-editing-target-session-fixes/external-install.txt)).

A bounded independent cross-review found no additional actionable issue in the
changed command, session and presentation-cleanup paths. Focused totals overlap
and must not be added together. After recording the evidence, `docs:sync`,
`check:dev-docs`, `check:docs`, `check:format` and `git diff --check` pass.
The inventory contains 272 Markdown/MDX documents; public checks cover 115
routes, 74 live-demo pages and 89 demo instances. The local preview was restored
with the repaired build. No new browser, acoustic or device acceptance is claimed
by these source/DOM regressions.

## Finite release exit criteria

The accepted delivery remains P0–P4 and its
[E1–E9 acceptance requirements](../design/EDIT-COMPONENTS.md#acceptance).
This repair reviews the changed and adjacent paths, then runs the integrated
gates. Unrelated STATUS backlog and future complete notation, seamless playback
replacement, spectral editing and multi-track/project features do not enlarge
this release's scope.

Release readiness requires these separate outcomes:

1. Close known in-scope defects with regressions and pass the local source,
   package, site-build and external-consumer gates. This report records this
   repair's actual results; validation must run again against the final producing
   release commit when its version and metadata are prepared.
2. Complete the remaining representative workflow acceptance already recorded in
   EDIT-01: native note-selector keyboard operation, MusicXML download/content,
   Alt-drag and held-pointer cancellation, touch/screen-reader interaction and
   actual playback/device checks. Reuse unaffected dated evidence for mouse,
   narrow layouts, MIDI download and WAV download/PCM comparison. This is bounded
   editing-workflow acceptance, not every possible device or full-library
   accessibility certification. An unverified item is not a pass.
3. Prepare an available new shared version and lockfile, a clean reviewed release
   commit and its passing CI; verify publisher identity and `@webmusic` scope
   rights, then follow [Publishing](../release/PUBLISHING.md). The previously
   observed five `0.2.0` registry versions cannot be reused for changed artifacts.
   Fresh `npm whoami` still returns E401
   ([log](2026-10-17-editing-target-session-fixes/npm-identity.txt)); no login or
   scope-access change was attempted.
4. For site deployment separately, resolve the eight binary assets without
   verified redistribution terms. Those files are excluded from npm packages;
   package publication does not require a site deployment.

[STATUS](../STATUS.md) remains the live work queue. Completing the applicable
requirements establishes readiness; repeated unbounded whole-repository reviews
are not an additional release criterion. No exact publication time is established
while representative manual acceptance and publisher access remain incomplete.
