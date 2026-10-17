# Editing release recheck — 2026-10-16

## Verdict and baseline

**No-Go for publication.** Four new P2 finding groups have seven failing
regression probes; a separate P3 waveform label defect was observed in the
browser. The [previous repair](2026-10-16-editing-release-fixes.md) remains valid
for its five findings, but does not cover these adjacent paths.

Reviewed the uncommitted `editing-capabilities` checkout based on
`ef8664dbb68ece9dc8c1d328141989a0ae86f888` on macOS, Node 26.8.1/npm 11.19.0.
Production source was not changed. Temporary probes were removed from package
test directories; their source and results are retained below. Findings were
independently reviewed across Score semantics, Audio semantics and Elements.

## P2 findings

### View cleanup can replace a newer editor binding and lose owned sessions

`packages/score/src/view/element/score-view.ts:884–887` and
`packages/audio/src/view/element/audio-view.ts:1669–1671` invoke disposal before
detaching their fields, and continue without rechecking the binding generation.
The same ordering appears in their `unbindEditor()` methods (Score 863–870,
Audio 1645–1650).

A View borrows A through a selector. Its owned session's disposal listener
assigns `view.editor = C`. When the declaration announces B, cleaning up A
synchronously creates the C binding, but the outer notification continues and
creates B. Score's `.editor` reports C while its interaction session belongs to
B; Audio's `.editor` reports B. Direct property replacement also loses cleanup
handles for intermediate C sessions, which remain live after removing the View.
Detach the old resource fields before cleanup and validate the attempt after
each callback-bearing phase.

Four failing tests: [Score probe](2026-10-16-editing-release-recheck/score-view-probe.txt)
and [result](2026-10-16-editing-release-recheck/score-view-result.txt),
[Audio probe](2026-10-16-editing-release-recheck/audio-view-probe.txt)
and [result](2026-10-16-editing-release-recheck/audio-view-result.txt).

### Cancelling an AudioDocument load can overwrite a newer explicit clip

`packages/audio/src/edit/element/audio-document.ts:46–51` prepares a candidate,
assigns the input, cancels the old load and then adopts the candidate without
checking whether cancellation changed the input again. An injected loader's
AbortSignal handler assigns B (160 frames) during an outer assignment of A
(80 frames). The outer setter then adopts A: `.clip` is B but `.editor` contains
A's 80 frames, with status ready. Validate request/input identity after abort
and release an obsolete candidate instead of adopting it.

One failing [probe](2026-10-16-editing-release-recheck/audio-document-probe.txt)
and [result](2026-10-16-editing-release-recheck/audio-document-result.txt).

### Piano-roll keyboard resize can overwrite an external revision

`packages/score/src/view/render/piano-roll-editor.ts:147–154` guards cancellation
reentry only when callers provide `expectedContext`. The keyboard resize call
at line 424 omits it. Select a duration-1 note with a shared draft; a draft
cancellation subscriber changes its duration to 4. Shift+Right captures the
old duration before cancellation, then commits 5/4 against the new revision.
The result is revision 2 and a successful commit callback, instead of retaining
the external duration 4 at revision 1 and rejecting the stale command. Apply
the guard to every command path using captured selection/content values.

One failing [probe](2026-10-16-editing-release-recheck/score-keyboard-probe.txt)
and [result](2026-10-16-editing-release-recheck/score-keyboard-result.txt).

### Audio clearHistory permits nested content edits during lease cleanup

`packages/audio/src/edit/headless/audio-clip-editor.ts:148` checks writability
but does not hold the busy lock around `releaseHistory()`. An injected lease's
release callback synchronously executes a gain edit. Clearing history then
returns with revision changed from 1 to 2 and one new undo entry. This violates
the nested-command exclusion and auxiliary operation contract. The nested
commit remains internally coherent and the probe releases all leases on final
disposal; this is not evidence of PCM corruption. Guard the whole operation,
as `clearClipboard()` now does.

One failing [probe](2026-10-16-editing-release-recheck/audio-history-probe.txt)
and [result](2026-10-16-editing-release-recheck/audio-history-result.txt).

## P3 waveform label finding and browser evidence

`packages/audio/src/view/render/waveform-editor.ts:185–192` refreshes segment
options only when IDs change, although the text includes segment length.
Trimming preserves an ID and changes its bounds, leaving a stale length label.

In the actual documentation demo, the native file chooser successfully imported
the repository's `Editing.wav` (48,000 frames at 8 kHz). Numeric selection
8,000–16,000 followed by Trim and gain 0.5 produced an 8,000-frame document at
revision 2 with matching ready playback. The Segment menu still read
`1: asset, 48000 frames`. The document status and range correctly reported
8,000 frames. Preserve the current choice and pending gain while updating the
option's displayed type/length when committed content changes.

The browser download operation timed out and the browser automation session
reset. Recovery did not provide a completed download or saved screenshot.
WAV download completion and file-content validation therefore remain unverified;
the tool failure alone is not a confirmed product export defect. MusicXML
download, native select-popup keyboard, touch, screen-reader and physical audio
checks also remain open. No browser state was injected to create these results.

## Automated verification and release identity

Current maintained focused suites pass, separately from the failing probes:

- Score semantic/Core/playback/staff/renderer review: 15 files / 177 tests
  ([log](2026-10-16-editing-release-recheck/score-focused-tests.txt)).
- Audio Core/Edit/document binding: 7 files / 127 tests
  ([log](2026-10-16-editing-release-recheck/audio-focused-tests.txt)).
- Element/surface review: Score 6 files / 58 tests and Audio 3 files / 66 tests
  ([Score](2026-10-16-editing-release-recheck/score-surface-tests.txt),
  [Audio](2026-10-16-editing-release-recheck/audio-surface-tests.txt)). These
  overlap the semantic suites and must not be summed as unique coverage.
- `npm run check:packages` passed, including artifact receipts, exports and
  notices ([log](2026-10-16-editing-release-recheck/package-check.txt)).

`npm run check` also passed again: 369 workspace test files / 4,573 tests plus
script tests, source/type/documentation/license/package/release-manifest gates
([full log](2026-10-16-editing-release-recheck/full-check.txt)). The seven new
failing probes were kept separate and were not added as passing maintained
coverage. Generated documentation now includes 269 Markdown/MDX files. The
documentation build and external install recorded in the preceding repair audit
were not repeated in this review; production source and public site references
were unchanged by this review.

Read-only registry checks still report `0.2.0` for all five packages. Remote
`v0.2.0` dereferences to `2e06a571d9d0b4bcb820aa685c66adedb8456bfa`.
`npm whoami` returned E401, so publisher identity and scope rights are unverified.
The [CI and Pages run](https://github.com/koperative-lab/WebMusic/actions/runs/37711139468)
passed for HEAD `ef8664db`; it does not cover uncommitted editing changes.
The migration guide is now present. New version preparation, a clean reviewed
release commit and its CI remain required. The separate eight-file site asset
redistribution gap remains in STATUS DEV-05; those assets are excluded from npm
packages. This review did not publish, commit, change authentication or deploy.
