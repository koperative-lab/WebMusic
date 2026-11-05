# Editing review fixes

## Baseline and scope

This follow-up reviews and repairs the uncommitted P0–P4 editing work on
`editing-capabilities`, based on commit
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`. It follows the
[interaction acceptance record](2026-10-15-editing-interaction-acceptance.md)
without replacing that record's results or remaining device checks.

Environment: macOS, Node 26.8.1 and npm 11.19.0. The scope is six reproduced
review findings and adjacent instances of the same callback/error contract.
No package versions, public entry points or accepted ownership decisions change.

## Findings and repair contracts

| Finding | Reproduction | Required repaired behavior |
|---|---|---|
| Audio editor resurrection | A processor abort listener or borrowed lease release callback disposes the editor during commit, abandoned-redo cleanup or checkpoint restoration. | Disposal remains terminal. An interrupted pre-adoption command fails and releases candidate ownership without publishing a later ready revision. |
| Staff deletion target changes | Select the note at quarter 0; a synchronous selection observer moves the entry cursor to quarter 1 before deletion continues. | Delete the captured event, preserving newer local input intent. A changed document revision or disposed controller prevents the stale command from committing. |
| Shared waveform draft cancellation | Two consumers borrow one session; dispose, blur or zoom the passive surface while the other consumer has a trim draft. | Passive lifecycle cleanup preserves the borrowed draft; an owned active gesture is cancelled, and explicit cancel still discards the shared draft. |
| Non-atomic Audio View source conflict | Assign an independent clip to an editor-bound view, or assign an editor with an independent source already configured. | Reject before field mutation, load cancellation or binding disposal. Attribute conflicts remain observable unavailable states. |
| Leftward keyboard selection | From frame 100, press Shift+Left twice. | Select frames 98–100, retaining a fixed anchor and moving endpoint across repeated keys and direction changes. |
| Missing failure error | A synchronous state observer clears local feedback before a failed command returns. | Return the command's captured typed error independently of subsequent local state. Applies to Staff, Score View and Audio View editing controllers. |

Production owners are the Audio Clip Editor, Staff input controller, Score/Audio
View editing controllers, waveform editor renderer and Audio View Element.
Regression tests live beside those owners; they exercise observable content,
revision, lease, selection and result contracts rather than private implementation
shape.

Cross-review also reproduced a terminal-state observation window: disposal set
the document snapshot to disposed before cancelling processors, but an abort or
lease cleanup callback could still read or initially subscribe to the previous
ready editor state. Disposal now detaches history/clipboard ownership and makes
both snapshots terminal before external callbacks; terminal processing state
remains false even when cancelled DSP settles late.

## Verification

- Score Staff and editing controller focused tests: 2 files, 26 tests passed.
- Audio sequence/editing controller focused tests: 1 file, 11 tests passed.
- Audio editor, asset, operation, processor and rendering focused tests:
  7 files, 110 tests passed, including eight new callback/disposal regressions.
- Audio View suite: 23 files, 310 tests passed; the final waveform/Element
  suite passed 40 tests after strengthening shared-draft disconnect coverage.
- Audio source typecheck, repository test typecheck and targeted lint passed.

- Final `npm run check` passed after the terminal-state follow-up: 369 workspace
  test files and 4,543 tests, including 36 added regressions relative to the
  earlier 4,507-test interaction baseline. The full gate also passed startup,
  architecture, documentation/snippets, source/test types, license, package
  export/receipt and release-manifest checks. Its log is
  `/tmp/webmusic-editing-review-fixes-final-check.log`.

- `npm run docs:build` passed: 117 pages, 115 public documentation references,
  and 74 license records covering 367 files. Log:
  `/tmp/webmusic-editing-review-fixes-docs-build.log`.

## Browser keyboard follow-up

The rebuilt production preview at `http://127.0.0.1:4335` was opened in the
in-app browser. The Audio View editing demo loaded the 48,000-frame fixture at
document and applied playback revision 0. Through the visible frame controls,
both selection endpoints were set to frame 100. Two actual Shift+Left key
presses produced frames 98–100. Four subsequent Shift+Right presses crossed the
anchor and produced frames 100–102; four Shift+Left presses returned to 98–100.
The document stayed saved at revision 0 and playback stayed ready at revision 0.
No browser console errors were reported.

Screenshots retain the visible frame values, selection status and waveform:

- [Repeated leftward extension](2026-10-15-editing-review-fixes/audio-keyboard-left-extension.png)
- [Crossing the fixed anchor](2026-10-15-editing-review-fixes/audio-keyboard-cross-anchor.png)

## Limits

Mocked DOM tests cover shared-session cleanup, source conflicts and callback
reentry. These do not establish screen-reader behavior, touch interaction,
physical audio latency or file-picker/download completion. The remaining
acceptance boundaries in the earlier interaction record still apply.
