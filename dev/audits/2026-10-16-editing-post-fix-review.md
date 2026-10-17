# Editing post-fix release review — 2026-10-16

## Baseline and verdict

This independent review follows the [recheck repairs](2026-10-16-editing-recheck-fixes.md).
Baseline: uncommitted `editing-capabilities`, based on
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`, macOS, Node 26.8.1/npm 11.19.0.
The review changes no production code, version, commit, authentication or
published artifact. Temporary reproduction tests were removed from the test
tree; their source and results are retained beside this report.

The checkout is not ready for formal release. Two new P2 defects are reproduced
below. Package publication prerequisites and the separate site-asset clearance
gap also remain open. Passing maintained tests do not cover the newly failing
cases and do not close the existing browser/device acceptance boundary.

## Reproduced findings

### P2 — Waveform commands retain targets changed during cancellation

[`mountWaveformEditor.execute`](../../packages/audio/src/view/render/waveform-editor.ts)
at lines 124–133 validates the document revision after `cancel()`, but not the
selection or segment used to prepare its operations. Range-based buttons capture
selection before this boundary (lines 79 and 136–138); gain captures the selected
segment at line 83. Public synchronous subscriptions can change these targets
without committing a content revision.

Three probes reproduce the resulting wrong-target mutations:

- A view-state cancellation publication redirects selection from frames 100–300
  to 500–800 in a 1,000-frame document. Trim still keeps the old 200 frames.
- The same selection redirect leaves Delete removing frames 100–300, producing
  an 800-frame document and a new revision.
- With an actual draft active, a session cancellation subscriber changes the
  Segment control from `left` to `right`. Apply gain changes `left` to 0.25 while
  the control displays `right`.

The range probes use the unlocked view-state publication following
`session.cancelDraft()`, not a prohibited nested session mutation. The final
run has no thrown or swallowed reentrancy error. Abandon a prepared operation
when its required target changes across cancellation, in addition to checking
revision, availability and editability. Cover range and segment commands with
regressions comparable to the repaired piano-roll context checks.

Evidence: [three failing probes](2026-10-16-editing-post-fix-review/audio-target-probe.txt)
and [results](2026-10-16-editing-post-fix-review/audio-target-results.txt).

### P2 — Replacing a Score interaction session loses paused playback state

The [`ScoreViewElement.interactionSession` setter](../../packages/score/src/view/element/score-view.ts)
at lines 263–267 calls `bindEditor()` without refreshing the still-bound player.
Editor detachment clears `documentPlayback` at line 885, and editor resolution
resets `playheadSeconds` at line 924. A paused player does not send another time
event to restore the snapshot.

With real Score Player/View Elements sharing one editor, prepare playback and
seek to one second while paused. Assign a new interaction session belonging to
the same document and wait a macrotask. The player remains at one second, while
the View reports zero seconds, removes the playhead and renders playback as
`unbound`. Refresh the compatible player snapshot when rebuilding the editing
session; retain the existing generation and reentrancy guards. Add coverage for
replacing and clearing a shared session while paused.

Evidence: [probe source](2026-10-16-editing-post-fix-review/score-session-probe.txt)
and [results](2026-10-16-editing-post-fix-review/score-session-results.txt).
The second case in that probe passes: disabling one View may cancel its shared
draft under the current public contract, so that behavior is not a finding.

## Verification scope

Independent domain and composition review inspected Score Core/Edit commands,
history, staff entry, MIDI/JSON compatibility, playback revisions, Audio asset
history/processing, sequence playback, waveform editing and Element lifetimes.
No additional actionable defect was confirmed within that bounded scope.

- Score Core/Edit/Play/View focused suites: 8 files / 143 tests passed
  ([log](2026-10-16-editing-post-fix-review/score-domain-tests.txt)).
- Audio Core/Edit/Play/View focused suites: 7 files / 175 tests passed
  ([log](2026-10-16-editing-post-fix-review/audio-domain-tests.txt)).
- Existing Element/lifecycle suites: Score 4 files / 23 tests and Audio 3 files /
  65 tests passed ([Score](2026-10-16-editing-post-fix-review/score-lifecycle-tests.txt),
  [Audio](2026-10-16-editing-post-fix-review/audio-lifecycle-tests.txt)).
- `npm run check:packages`: passed against current built outputs, including
  exports, artifact receipts and bundle notices
  ([log](2026-10-16-editing-post-fix-review/package-check.txt)).
- `npm run audit:production`: passed, zero vulnerabilities
  ([log](2026-10-16-editing-post-fix-review/production-audit.txt)).
- `npm run check`: passed, 371 workspace test files / 4,631 tests, plus
  dev-server/script regressions, architecture, documentation/snippets,
  source/test types, licenses, built exports/receipts and release manifests
  ([full log](2026-10-16-editing-post-fix-review/full-check.txt)).

Focused totals overlap; do not add them together. Failing review probes are
retained as evidence outside the maintained test suite. No new rendered browser,
download, acoustic or device checks were performed in this review. The preceding
repair's site build, external-consumer checks, WAV download/PCM comparison and
browser screenshots remain dated evidence, not new results. MusicXML download,
native select-popup keyboard navigation, touch/screen-reader and acoustic/device
acceptance remain unverified as described in EDIT-01.

## Publication prerequisites

Fresh read-only registry checks still report all five packages at `0.2.0`, with
`latest: 0.2.0`. The remote `v0.2.0` tag dereferences to
`2e06a571d9d0b4bcb820aa685c66adedb8456bfa`. Those identifiers cannot be reused
for this editing delivery. `npm whoami` returns E401; publisher identity and
scope rights are not established. The working tree has no clean producing
release commit or CI run covering these uncommitted changes. The existing
[migration guide](../release/EDITING-MIGRATION.md) does not replace those steps.
The [observation summary](2026-10-16-editing-post-fix-review/publication-observations.json)
records the commands and returned metadata, without authentication data.

[STATUS](../STATUS.md) owns the live work: repair the two defects, prepare a new
shared version and lockfile, validate the reviewed release commit and CI, verify
publisher access, then follow [Publishing](../release/PUBLISHING.md). The eight
site binaries with unverified redistribution terms remain a separate deployment
gate; they are excluded from npm tarballs. No publication or deployment was
attempted.
