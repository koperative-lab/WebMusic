# Editing recheck repairs — 2026-10-16

## Scope and baseline

This repair follows the [release recheck](2026-10-16-editing-release-recheck.md):
four P2 finding groups and the P3 stale waveform segment label. It also covers
the reproduced ScoreDocument equivalent of the AudioDocument abort-callback
defect. The previous dated findings and evidence remain unchanged.

Baseline: uncommitted `editing-capabilities`, based on
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`, macOS, Node 26.8.1/npm 11.19.0.
No version, commit, registry authentication, publication or deployment is changed.

## Repairs and regression evidence

All reproduced recheck findings and the adjacent lifecycle defects described
below are repaired. Integrated gates and the bounded browser verification below
pass; publication prerequisites remain separate.

Both View Elements detach captured resources before invoking cleanup callbacks,
then validate the binding generation and the individual selector resolution
before adopting resources. Stale candidates are disposed. Direct replacement,
nested source notifications and disconnect/reconnect preserve the latest
binding and release all owned sessions. Score presentation cleanup now similarly
detaches its resources and DOM before cancelling a draft; an interrupted render
cannot overwrite a newer presentation or lose its global-listener cleanup.
This adjacent leak was independently reproduced during the repair
([before-fix test](2026-10-16-editing-recheck-fixes/score-presentation-before-test.txt)).
Sixteen dedicated lifecycle cases cover both domains, including active-draft
cancellation and initial subscription reentry. Related tests pass for
[Score](2026-10-16-editing-recheck-fixes/score-view-tests.txt) and
[Audio](2026-10-16-editing-recheck-fixes/audio-view-tests.txt); Score's complete
[View suite](2026-10-16-editing-recheck-fixes/score-all-view-tests.txt) also passes
51 files / 549 tests.

Score and Audio document declarations capture their cancellation generation
before abort callbacks. The setter checks that generation, the input and the
connected lifetime before adopting a prepared editor; obsolete candidates are
disposed. A superseded reload returns `superseded`, and an abort-triggered
reconnection survives the older unmount. Disconnect first detaches the previous
owner, then aborts only that lifetime's captured load; a new pending or failed
URL load cannot retain the disconnected editor. Cross-review reproduced that
additional branch in [Score](2026-10-16-editing-recheck-fixes/score-reconnect-before-test.txt)
and [Audio](2026-10-16-editing-recheck-fixes/audio-reconnect-before-test.txt).
The original Score counterpart was reproduced
before repair ([failing cases](2026-10-16-editing-recheck-fixes/score-document-before-test.txt)).
Each domain adds nine declaration regressions, including restoring URL loading
from an explicit input inside the cancellation callback. Focused declaration
and player-Element suites pass for [Score](2026-10-16-editing-recheck-fixes/score-declaration-tests.txt)
and [Audio](2026-10-16-editing-recheck-fixes/audio-declaration-tests.txt).

`AudioClipEditor.clearHistory()` holds the command lock through history lease
release, error reporting and state publication. Nested edits fail with
`reentrant-command`; disposal from cleanup remains terminal. Three regressions
cover nested edits, disposal and throwing cleanup/error callbacks, with complete
lease release and subsequent commands proving that the lock is released.

Piano-roll commands now share a pre/post-cancellation context guard for document
identity, revision and selection, followed by availability/editability checks.
Keyboard edits and history traversal cannot overwrite changes made by a cancel
callback. Pointer setup and commit also retain their captured context across
focus, selection and cancellation; renderer disposal becomes terminal before
cancelling a gesture. Twenty new cases cover stale revisions, redirected
selection, read-only/disposal and pointer cancellation. The focused
[renderer suites](2026-10-16-editing-recheck-fixes/score-keyboard-tests.txt) pass
47 tests across three files, retaining one-history-item drag and numeric-entry
coverage.

The waveform segment selector now keys its options by ID, type and frame length.
Trim, undo and redo update the displayed lengths while retaining a surviving
selected segment. Playback updates still preserve pending gain input. The new
regression failed before the repair and passes afterwards; the complete waveform
editing suite passes 46 tests.

## Integrated automated verification

The maintained suite adds 58 cases: 16 View lifecycle, 20 piano-roll, 18 document
declaration, three Audio history and one waveform-label regression. Independent
cross-review checked the command and label changes; its document-lifetime
finding was reproduced and repaired before the integrated run.

- `npm run check`: passed, 371 workspace files / 4,631 tests, plus script
  regressions, architecture, docs/snippets, source/test types, licenses,
  built exports, artifact receipts and release manifests
  ([full log](2026-10-16-editing-recheck-fixes/full-check.txt)).
- `npm run typecheck:tests`: passed after correcting test-spy result inference
  ([log](2026-10-16-editing-recheck-fixes/test-types.txt)).
- `npm run audit:production`: passed, zero vulnerabilities
  ([log](2026-10-16-editing-recheck-fixes/production-audit.txt)).
- `npm run docs:build`: passed, 117 pages, 115 public references, 74 license
  records and 367 covered files
  ([log](2026-10-16-editing-recheck-fixes/docs-build.txt)).
- `npm run check:external-install`: passed, 184 ESM/CJS runtime entries,
  96 ESM/browser and 92 CommonJS declarations, `skipLibCheck: false`
  ([log](2026-10-16-editing-recheck-fixes/external-install.txt)).

Focused suite totals overlap the complete run and must not be added together.
After writing the final evidence, `docs:sync`, `check:dev-docs`, `check:docs`,
`check:format` and `git diff --check` pass. The inventories contain 270
Markdown/MDX documents; public checks cover 115 routes, 74 live-demo pages and
89 demo instances.

## Browser evidence

The existing documentation demo retained the preceding review's imported WAV,
8,000-frame trimmed document and gain 0.5. The status showed revision 2 and
matching ready playback, while the Segment selector incorrectly displayed
48,000 frames. The [before screenshot](2026-10-16-editing-recheck-fixes/waveform-before.png)
preserves that mismatch.

After rebuilding, the embedded Chromium browser reloaded the actual documentation
route at `http://127.0.0.1:4335/audio/element/view/audio-view/#waveform-editing`,
using its configured `Editing.wav` URL. Light theme, 1280 × 720 CSS-pixel
viewport, 537.8125 px demo container; browser version was not recorded. Native
controls selected frames 8,000–16,000 and trimmed to 8,000 frames at revision 1.
Undo restored the 48,000-frame label at revision 2; redo returned it to 8,000 at
revision 3. Applying gain 0.5 produced revision 4 with matching ready playback.
The [after screenshot](2026-10-16-editing-recheck-fixes/waveform-after.png) and
[rendered status](2026-10-16-editing-recheck-fixes/browser-after.txt) show the
correct label and document state. No application state was injected.

The Export WAV control completed an actual browser download to
`/Users/mamingchen/Downloads/edited-audio.wav`. The browser-tool wait was prolonged;
it is not evidence for export latency. Independent RIFF/PCM inspection of the
download found 8,000 mono frames at 8 kHz, 16-bit PCM, 16,044 total bytes. Every
sample matches the fixture's frames 8,000–16,000 at gain 0.5 within 0.5 int16 LSB,
consistent with output quantization. The [download copy](2026-10-16-editing-recheck-fixes/edited-audio.wav)
and [validation result](2026-10-16-editing-recheck-fixes/wav-download-validation.json)
close the previously unverified WAV download/content path. This does not establish
MusicXML downloads, acoustic playback timing or device behavior.

## Release boundary

Repair verification does not establish publication readiness. Current release
identity, publisher access, clean-commit CI and site asset redistribution work
remain in [STATUS](../STATUS.md). Native select-popup keyboard navigation,
touch/screen-reader, MusicXML downloads and acoustic/device checks retain the
earlier review's explicit verification boundary. No release version or clean
producing commit has been prepared, and this repair does not authenticate a
publisher or deploy the site.
