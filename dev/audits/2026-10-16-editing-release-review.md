# Editing release review — 2026-10-16

## Verdict and baseline

**No-Go for publication of the current editing changes.** Five additional P2
defects have reproducible failures. Release identity, migration guidance and
manual acceptance also remain incomplete. A passing existing test suite does
not cover these newly reproduced paths.

Reviewed the uncommitted `editing-capabilities` tree based on
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`, after the
[previous repairs](2026-10-15-editing-release-follow-up.md), on macOS with
Node 26.8.1/npm 11.19.0. This was a review: production code was not changed.
Temporary probes were removed from workspace test directories after execution;
their sources and failing results are retained below. Current work belongs to
[STATUS](../STATUS.md), EDIT-01 and RELEASE-01.

## Reproduced code findings

### P2 — Numeric Apply can target a newly selected note using the old note's values

In `packages/score/src/view/render/piano-roll-editor.ts:287–292`, a focused form
prevents field refresh even when an external consumer changes the shared
session's selected note. The picker reflects the new note, but `numeric()` at
lines 176–183 reads the old fields and targets the current selection.

Select a at quarter 0/C4, focus Pitch, then let another consumer select b at
quarter 3/E4. Clicking Apply without editing any field moves b to quarter 0/C4.
Bind pending form values to their note identity, refreshing or invalidating them
when that identity changes while preserving pending values for the same target.
The [probe](2026-10-16-editing-release-review/score-selection-probe.txt) failed
its expected unchanged-b assertion. Existing relevant Score suites passed
8 files/99 tests.

### P2 — Audio commands can report failure after silently adopting new content

`packages/audio/src/edit/headless/audio-clip-editor.ts:379–380` adopts the new
root before history accounting. An injected asset reader's `getReferenceCount`
throwing from line 389 causes `execute()` to return `failed`, while
`getSnapshot()` reports revision 1 and `getState()` plus subscribers still report
revision 0. Playback receives no revision notification.

The public asset-reader port does not require a nonthrowing statistics method;
the editor's documented atomic failure contract must hold for this boundary.
Complete fallible accounting before adoption, or guarantee a coherent committed
result and publication once adoption has occurred. See the first
[Audio Edit probe](2026-10-16-editing-release-review/audio-edit-probe.txt).

### P2 — Clipboard cleanup reentry leaks a retained asset

`packages/audio/src/edit/headless/audio-clip-editor.ts:216` releases the clipboard
before clearing ownership and without guarding the entire mutation. If the
retired lease's release callback calls `copy()`, the outer call overwrites that
new clipboard with `undefined`. A real memory-store probe retains one asset,
one lease and 32 bytes after releasing caller handles and disposing both editor
and store. Detach retired ownership and guard the complete cleanup operation.
See the second [Audio Edit probe](2026-10-16-editing-release-review/audio-edit-probe.txt).

### P2 — A retired document's disposal can erase a new playback request

`packages/audio/src/play/headless/audio-document-binding.ts:141–145` continues
after `supersede()` without checking whether cleanup replaced the attachment.
While A is preparing, dispose A and bind B synchronously from A's released
attempt lease. B eventually becomes the ready/applied source, but the old
notification clears B's `requested` state: `waitForDocumentRevision(B)` reports
`superseded` and retry cannot find the current request. Recheck attachment
generation after callback-bearing cleanup before clearing request state.
See the [playback probe](2026-10-16-editing-release-review/audio-play-probe.txt).
All three Audio probes failed their correct-behavior assertions; the complete
[failure log](2026-10-16-editing-release-review/audio-probe-results.txt) is retained.

### P2 — Audio playback synchronization overwrites pending numeric inputs

`packages/audio/src/view/render/waveform-editor.ts:183–186` protects only the
currently focused input. Its public `updatePlayback(binding, seconds)` at line
298 invokes this refresh. Enter Start 101, move to End and enter 303, then sync
playback: Select frames commits 0–303. Enter gain 0.25, Tab to Apply and sync
playback: Apply uses 1 instead.

This affects API + UI integrations using the documented method to synchronize
observed time. The built-in Element's regular frame loop uses `redrawFrame`, so
this is not a claim that every built-in playback tick triggers it. Preserve a
pending form transaction across same-document playback updates, and explicitly
invalidate it when its content/target changes. Both
[waveform probes](2026-10-16-editing-release-review/waveform-probe.txt) failed;
see the [failure log](2026-10-16-editing-release-review/waveform-probe-results.txt).

## Documentation and compatibility findings

- `apps/doc/webmusic/src/content/docs/score/index.mdx:35–38` still says Audio and
  Bridge and their references have not entered this checkout. That contradicts
  the current five-package source and site. Correct this public description
  before deploying updated documentation.
- The next release needs an explicit migration record. Registry `0.2.0`
  tarballs were downloaded with scripts disabled and inspected: Score writes
  JSON schema `0.1`, and Audio declares `AudioPlayerSourceDetail` as the old
  `{clip, revision}` interface. The current tree writes schema `0.2` (older
  readers reject that marker) and requires the `kind` discriminant in Audio
  source-detail types. New-reader backward compatibility does not provide
  old-reader compatibility; coordinate persisted-data readers and source-detail
  integrations. Record these changes with the new shared release version.
  The [registry metadata](2026-10-16-editing-release-review/registry-package-metadata.json)
  identifies the inspected tarballs; inspecting them is not a full installed
  registry-release functional test.

## Verification and delivery boundaries

- Current `npm run check:packages` passed, including source/output receipts,
  exports and notices; see the [log](2026-10-16-editing-release-review/package-check.txt).
- Final `npm run check` passed again: 369 files/4,554 existing tests, including
  all architecture, documentation, types, licenses and package checks. See the
  [full gate log](2026-10-16-editing-release-review/final-check.txt). The six
  separate failing probes cover the five findings above and were not folded
  into that maintained-suite count. The preceding site build had 117 pages;
  public site source was not changed in this review.
- Final `npm run check:external-install -- --keep` passed against the rebuilt
  packages: 184 runtime imports and strict checks of 96 ESM/browser plus 92
  CommonJS declaration entries. See the
  [external-install log](2026-10-16-editing-release-review/external-install.txt).
- `npm run audit:production` returned zero vulnerabilities. The full dependency
  audit passed its high-severity threshold with ten moderate reports in the
  existing documentation dependency chain; see the
  [audit output](2026-10-16-editing-release-review/dependency-audit.txt). No forced
  dependency update was applied.
- In the in-app browser, the real file-chooser flow imported `Editing.mid`.
  The second note was changed from MIDI 64 to 66 and Export MIDI completed a
  download. Parsing the actual 141-byte downloaded file recovered eight notes,
  including pitch 66 at quarter 1. Document and applied playback revision were
  both 1. The [browser result](2026-10-16-editing-release-review/score-export.png)
  is retained. This closes that bounded MIDI import/edit/download path, not
  Audio/MusicXML file flows, OS select-popup keyboard navigation, touch,
  screen-reader or physical audio-device acceptance.
- All five npm packages still have latest `0.2.0`; remote `v0.2.0` dereferences
  to `2e06a571d9d0b4bcb820aa685c66adedb8456bfa`. Changed artifacts require a new
  shared version. `npm whoami` again returned E401; publisher identity and scope
  rights are not established.
- [HEAD CI](https://github.com/koperative-lab/WebMusic/actions/runs/37711139468)
  is successful but covers `ef8664d`, not this uncommitted editing tree. A clean,
  reviewed release commit and its matching CI remain necessary.
- Documentation deployment separately remains blocked by the eight unverified
  media resources in the [asset inventory](../../apps/doc/webmusic/ASSETS.md).
  These resources are excluded from npm tarballs. No package publication, tag,
  credential change or deployment was performed.
