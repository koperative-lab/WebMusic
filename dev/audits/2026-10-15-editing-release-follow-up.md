# Editing release-readiness follow-up

## Baseline and scope

This follow-up covers the uncommitted editing work on `editing-capabilities`,
based on `ef8664dbb68ece9dc8c1d328141989a0ae86f888`. It follows the
[earlier review repairs](2026-10-15-editing-review-fixes.md). Environment:
macOS, Node 26.8.1 and npm 11.19.0. Final layout verification continued on
October 16, 2026.

The release review found two additional defects: Audio interaction-session
lease handoff permitted synchronous callback reentry, and the piano roll lacked
a keyboard-operated way to select one existing note. This record separates
their repair verification from package publication and website deployment.

## Reproduced defects and repair requirements

### Audio interaction-session resource handoff

Retiring an old draft lease can invoke an application adapter. Reentering
`preview()` from that callback leaked an overwritten lease; disposing the
session from the callback still allowed the outer preview to install a new
lease. Both paths retained one asset and one lease after final cleanup.
Document-change cleanup could also overwrite a disposed session with
`disposed: false`. Three focused probes reproduced these failures.

Session mutations must reject nested modification, detach retired ownership
before external cleanup, preserve terminal state and release every unadopted
candidate. Disposal and document invalidation must still supersede an active
operation. A revision check alone cannot detect a nested preview on the same
document revision.

The repaired session guards complete mutations, including adapter acquisition
and release callbacks. It adopts replacement ownership before retiring the old
lease, detaches cancelled ownership before cleanup and exposes disposal before
external callbacks. Document invalidation preserves the enclosing operation's
guard while superseding its draft. Nested modifications fail explicitly;
document changes and disposal can still invalidate the operation.

The [original failing probe output](2026-10-15-editing-release-follow-up/audio-session-before.txt)
and [probe source](2026-10-15-editing-release-follow-up/audio-session-probe.txt)
retain the reproduction baseline. Maintained regression cases are in
`packages/audio/test/edit/audio-clip-editor.test.ts`.

### Piano-roll keyboard selection

The eight-note MIDI demo started with no selection. Arrow, Enter and Space
could not select a note; Cmd+A selected all eight, leaving the single-note
Apply button disabled. The numeric alternative therefore required an initial
pointer action. Source inspection and actual browser input confirmed this.

The existing numeric controls need a labeled native note selector that can
select any existing pitched note through the shared interaction session.
Selection, note labels and availability must follow external edits, deletion,
undo and shared multi-selection without silently replacing that multi-selection.

The repaired disclosure includes **Select existing note**, a native select with
stable note-ID values and musical labels ordered by part, onset, pitch and ID.
Its labels distinguish part and note order without exposing internal IDs.
It reflects multi-selection without reducing it, offers an explicit empty
selection and follows committed content. Selecting a note updates the numeric
fields while the selector keeps focus. Playback redraws preserve uncommitted
form values after Tab moves focus to Apply.

The [before screenshot](2026-10-15-editing-release-follow-up/piano-roll-keyboard-before.png)
shows eight selected notes and the disabled single-note Apply command.

The first rebuilt 320px browser check found that the disclosure's automatic
Grid minimum width stretched its form and select to 416px inside a 233px
component. The disclosure now declares `min-width: 0; max-width: 100%`.
An intermediate check showed that its label's implicit Grid track still retained
the select's intrinsic width; `grid-template-columns: minmax(0, 1fr)` on the
label removes that second minimum. The select now shrinks with the container.
The [narrow failure screenshot](2026-10-15-editing-release-follow-up/piano-roll-keyboard-320-before.png)
retains that finding; a DOM style-string test would not establish its layout.

Rebuilt-browser verification measured a 233px component and scroll width at a
320px viewport, with a 232.8125px selector. At 480px, the component and scroll
width were both 393px, with a 392.8125px selector. The page had no horizontal
overflow at either size. See the [320px result](2026-10-15-editing-release-follow-up/piano-roll-keyboard-320-after.png)
and [480px result](2026-10-15-editing-release-follow-up/piano-roll-keyboard-480-after.png).

Desktop browser input selected the second note, changed E4 to F4 using the
numeric field and Enter on Apply, deleted that note and restored it with Undo.
Document and playback revisions stayed aligned at each commit. See the
[desktop edit result](2026-10-15-editing-release-follow-up/piano-roll-keyboard-after.png).
The [final-build selection view](2026-10-15-editing-release-follow-up/piano-roll-keyboard-final.png)
also confirms that the second note populates the fields and enables Apply.
Tab focus and Enter commands were verified. The automation could not operate
the native OS select popup through arrow keys, so selecting its option used the
browser's native-select operation. Actual OS-popup keyboard navigation and
screen-reader announcement remain manual acceptance items.

## Verification

- Audio editor focused suite: 59 tests passed, including nine new session
  ownership and callback regressions; 14 related tests also passed. Audio source
  typecheck and targeted lint passed. Six independent callback/revision/cleanup
  probes passed without repeated releases or retained assets.
- Score View suite: 50 files, 515 tests passed. The new cases cover single-note
  selection, labels/order, multi-selection, deletion/undo, external changes and
  form values retained across playback redraws. Score source and repository test
  typechecks passed.
- Final `npm run check`, including both narrow-layout corrections, passed: 369 workspace
  test files and 4,554 tests, eleven
  more than the preceding review baseline. Startup, architecture, documentation,
  snippets, source/test types, licenses, package receipts/exports and release
  metadata checks also passed. See the [final check log](2026-10-15-editing-release-follow-up/final-check.txt).
- Final `npm run docs:build` passed: 117 pages, 115 public references,
  74 license records and 367 files. See the [site build log](2026-10-15-editing-release-follow-up/final-docs-build.txt).
- Final `npm run check:external-install -- --keep` passed: all 184 runtime
  entries imported, Score IO/model composition ran in ESM and CommonJS, and
  96 ESM/browser plus 92 CommonJS declaration entries passed strict checks
  without `skipLibCheck`. See the [external-install log](2026-10-15-editing-release-follow-up/final-external-install.txt).
  The isolated consumer was retained at
  `/var/folders/nj/gm4hv_s13fz1b1g0cn78qp000000gn/T/webmusic-external-sNMnd7`.

## Release boundary observed during review

Before these repairs, the five-package external-install check passed: 184
runtime entries, 96 ESM/browser declarations and 92 CommonJS declarations.
All five dry-run tarballs included their public export targets and relative
runtime/declaration/resource references. These pre-repair results do not replace
validation of the repaired artifacts.

The registry listed `0.2.0` and `latest: 0.2.0` for all five packages. Remote
`v0.2.0` dereferenced to `2e06a571d9d0b4bcb820aa685c66adedb8456bfa`.
Changed editing artifacts need a new shared version. The current uncommitted
tree has no corresponding release-commit CI result. `npm whoami` and scope
access inspection returned E401; publisher identity and rights remain unverified.
This metadata inspection does not verify registry artifact integrity or install
the registry release, and does not replace the historical verified receipt.

Production audit reported zero vulnerabilities. The full dependency audit
passed its high-severity threshold with ten moderate reports in the existing
documentation PostCSS dependency chain, tracked by STATUS DEP-02. No forced
dependency downgrade was applied.

Website deployment remains separately blocked by the eight media resources
whose redistribution evidence is missing from the [asset inventory](../../apps/doc/webmusic/ASSETS.md).
Those public assets are excluded from npm tarballs. Touch, screen-reader,
file-picker/download completion and physical audio-device acceptance remain
unverified; desktop keyboard evidence does not establish those claims.
