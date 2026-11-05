# P4 staff-input editing verification

Date: 2026-10-15. Branch: `editing-capabilities`, based on
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`, with the existing uncommitted P0–P3
implementation retained. Environment: Node 26.8.1, npm 11.19.0, macOS.
This record concerns bounded notation entry under DEC-048; the
[editing contract](../design/EDIT-COMPONENTS.md) owns the P0–P4 roadmap.

## Implemented contract

- `enter-notation` atomically enters a spelled note/rest and completes one
  authored measure's chosen voice/staff with real rests. Duration bases, dots,
  rational positions, generated IDs and rest fragmentation are validated.
  Unsupported structures and ambiguous or destructive replacements fail before
  publishing. Other voices/staves and untouched performed timing are retained.
- `createStaffViewEditing` owns local cursor/spelling/duration settings over a
  borrowed `ScoreViewEditing`. It creates no editor, history, clock or DOM.
  Staff and piano roll use the same document, monotonic revisions and undo stack.
- `mountStaffEditor` reuses the scrolling staff renderer. It supplies armed,
  focused note input, A–G and duration shortcuts, rest entry, selection/deletion,
  numeric alternatives, cursor/selection feedback and shared undo/redo.
  `<score-view type="staff" editor="#id" editable>` composes that behavior
  without a new tag. Passive staff and the separate OSMD sheet remain supported.
- The public Element workflow uses an authored two-measure MusicXML fixture
  beside a piano roll and one native player. The original MIDI editing demo
  remains intact. A separate Headless reference demonstrates custom UI.

## Automated verification

An earlier complete `npm run check` passed with 4,502 workspace tests. After the
final cursor and demo fixes, the aggregate command stopped at the intermittent
dev-server termination test described below. Its separate rerun passed all 12
tests. Every remaining stage was then executed successfully: lint, architecture,
public/dev documentation, site notices, package builds, snippets, source/test
types, workspace tests, licenses, bundled exports, artifact receipts and release
manifests. Format and lockfile checks had passed in the aggregate run. This is
separate-stage verification, not a claim that the last aggregate invocation
passed. Final workspace results:

| Workspace | Files | Tests |
| --- | ---: | ---: |
| Kernel | 14 | 163 |
| UI | 36 | 653 |
| Score | 198 | 2,268 |
| Audio | 82 | 984 |
| Bridge | 7 | 182 |
| Documentation | 32 | 255 |
| Total | 369 | 4,505 |

Architecture checked 437 source modules across five packages. Astro check
reported zero errors/warnings and three existing `keyCode` deprecation hints.
The built ESM and CommonJS tests compose Core, Edit and Staff View values,
execute notation entry and undo, and verify the render export is populated.

The final `npm run docs:build` passed: 117 built pages, 115 public documentation
references and site-license verification for 74 records across 367 files.

Focused integration verifies staff entry, a subsequent piano-roll pitch edit,
native applied revisions, shared undo and MIDI silence for real rests. Semantic
tests cover exact duration/spelling and JSON/MusicXML round trips, deterministic
rest IDs, untouched microtiming, voice/staff isolation, structural rejection,
atomic failure and reentrant cursor changes. MusicXML parsing namespaces voice
IDs; the round-trip assertion checks preserved voice membership rather than
claiming identical parser-generated IDs.

Renderer tests cover armed shortcuts, numeric alternatives, active-field
submission, cursor reveal, focus retention, shared preview/cancel, readonly
gating, playback compatibility and borrowed-resource cleanup. Review removed an
accidental optional-UIKit dependency from the standalone renderer; the resulting
render and React dependency closures pass without widening the policy.

Final review corrected the staff-input cursor predicate for combined staves:
when `split-staves` is false, input targeting a part's second staff can still
display its cursor on that part's combined layer. The focused 17-test renderer
suite and Score typecheck passed after the correction. The final workspace
tests and package/site build include this correction.

Two aggregate reruns failed the documentation dev-server process-tree test:
they observed exit code `1` where termination should produce `143`; another
complete run between them passed. Twelve isolated diagnostic reproductions and
four complete temporary instrumented test copies produced the expected `143`.
The final unmodified `npm run check:dev-server` rerun passed. No EPERM evidence
was captured. The intermittent failure's cause remains unknown; no dev-server
fix or permanent resolution is claimed.

Export review identified that default MusicXML PPQ 480 rounds the supported
double-dotted sixty-fourth duration (7/64 quarter). The demo now requests PPQ 960.
An additional regression verifies an entry at 257/64 quarters, its 7/64 duration
and every generated rest's exact timing after MusicXML export/import. This
preserves the P4 binary grid; it does not promise arbitrary rational-resolution
MusicXML export. In the notation demo only MusicXML export marks the matching
content saved; performance-only MIDI export leaves notation dirty.

## Browser evidence and limitations

The production preview was exercised in the embedded Chromium browser at
`http://127.0.0.1:4335/score/element/view/score-view/#staff-input`:

- Focused `N`, `D`, `Escape` replaced the opening C4 with D4, advanced the
  cursor and synchronized document/player revision 1. A letter key while
  input was off made no edit.
- Numeric input at quarter 4, duration 1/2, pitch F and sharp inserted F#4.
  The piano roll exposed the same onset/duration and the player acknowledged
  revision 2. This also rechecked the pending-field repair discovered during
  earlier development-server testing.
- A new voice `2`, cursor 0 and C4 quarter submitted with Enter inside the
  cursor field preserved voice `P1-1` and produced six pitched notes at revision
  3. Ctrl+Z and Ctrl+Shift+Z removed/restored that entry with matching native
  playback revisions 4 and 5.
- MIDI export requested revision 5 and retained `unsaved`; MusicXML export
  requested the same content and changed the demo to `saved`. These are UI and
  serialization checks, not confirmation that browser downloads completed.
- The public width control constrained the staff surface to 320px and 480px.
  DOM geometry reported equal client/scroll widths, including the 320px input
  controls. The default width was restored. This does not establish rendered
  visual quality or mobile-device behavior.

The production Headless demo at `/score/headless/view/staff-editing/` exposed
another pending-field issue: a typed voice/cursor could be replaced by a redraw
before its change event committed. The demo now preserves pending text and
applies it before note/rest/delete commands; invalid text blocks mutation and
remains available for correction. Two real-controller DOM regressions cover
these cases. After the final build, the original browser sequence succeeded:
C4 in voice 1, then voice 2/cursor 0/rest produced distinct completed voices at
revision 2. Undo/redo removed/restored voice 2 at revisions 3/4. An invalid cursor
showed its error without advancing revision 4. The page reported no console
errors. The Element preview was reloaded to its initial fixture for handoff.

Screenshot capture returned `Unable to capture screenshot`, and a bounded
pointer click failed at `Input.dispatchMouseEvent` despite a unique visible,
enabled target. No screenshot or real pointer acceptance is claimed. Touch,
screen-reader navigation, file-picker/download completion and acoustic/device
playback remain unverified.

After the combined-staff cursor repair, built packages passed
`npm run check:external-install` in a fresh consumer: 184 ESM/CommonJS runtime
entries, Score model composition in both formats, and 96 ESM/browser plus 92
CommonJS declarations without skipLibCheck. Subsequent changes clarified one
shortcut hint and repaired the documentation-only Headless form; they did not
alter package export contracts.

## Scope boundary

Entry requires actual authored measures. MIDI import's inferred display bars do
not satisfy that requirement. Chord/tie/tuplet/grace authoring, measure-grid
editing, full engraving and page layout remain outside this bounded P4 delivery.
The P0–P4 roadmap does not include multi-track/project editing, spectral repair
or seamless playback replacement. No commit, push, publication or deployment is
part of this work.
