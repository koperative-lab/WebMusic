# Audio editing P3 implementation and verification

Date: 2026-10-15. Working tree: `editing-capabilities`, based on
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`, with the existing uncommitted P0–P2
work preserved. Environment: macOS, Node 26.8.1, npm 11.19.0, embedded Chromium
browser. These results describe this working tree, not a published release.
[STATUS](../STATUS.md), EDIT-01, owns remaining work; the
[editing contract](../design/EDIT-COMPONENTS.md) owns the P0–P4 roadmap.

## Delivered scope

- Audio Core has immutable contiguous asset/silence sequences, exact format and
  frame ranges, gain/envelopes, annotation anchoring, bounded reads and explicit
  resource leases. Structural edits and history retain PCM without full copies.
- `AudioClipEditor` provides guarded commands, synchronous atomic transactions,
  undo/redo, saved-content identity, checkpoints, clipboard and independent/shared
  interaction sessions. History defaults to 100 transactions and 256 MiB of
  assets held solely by history. Accounting includes complete retained backing
  buffers, conservatively counts distinct assets sharing storage, and rechecks
  limits on editor state transitions.
- Selected-range processing declares handles, raw output dimensions, latency and
  tails before allocation. Cancellation, stale revisions and incompatible output
  cannot commit. Built-in normalize/reverse processors yield bounded work. WAV
  rendering/export is explicit, bounded and cancellable between render chunks.
- Audio Play borrows the document through the stable facade/transport, reports
  requested/applied revisions, maps positions/loops, pauses on commits and stays
  paused. Its segment engine prepares bounded chunks, quantizes loops to output
  frames and never invents a dummy clip. Default prepared PCM limit is 64 MiB.
- Nonvisual `<audio-document>` owns a connected editor. Player/View accept
  `.editor` and `editor="#id"`, handle late/replaced/ambiguous owners and report
  source conflicts. The one reviewed Edit Element loader adapter imports only
  `loadClipFromUrl`, forces decoded input and forwards limits/cancellation.
- Existing waveform View gains selection, split/trim/delete/silence, clipboard,
  gain/fades, undo/redo, keyboard input and exact frame controls. Lazy waveform
  extrema reuse asset data without rendering the entire sequence per commit.
- API, Headless and Element references, three demos, parameter catalogs, package
  exports/policies and generated Agent Context references describe the real API.
  The generated WAV fixture has provenance in the [asset inventory](../../apps/doc/webmusic/ASSETS.md).

## Automated verification

The final `npm run check` passed, including source/test types, lint, architecture,
documentation, source/output receipts, runtime exports, bundled notices, licenses
and release manifests. Workspace tests:

| Workspace | Files | Tests |
| --- | ---: | ---: |
| Kernel | 14 | 163 |
| UI | 36 | 653 |
| Score | 194 | 2,228 |
| Audio | 82 | 984 |
| Bridge | 7 | 182 |
| Documentation | 30 | 249 |
| Total | 363 | 4,459 |

The source gate checked 434 source modules, 24 Elements, 114 public documentation
routes and 266 compiled examples. Astro check reported zero errors/warnings and
three existing `keyCode` deprecation hints. The dev-server process-tree test that
failed in the [P2 audit](2026-10-15-score-editing-p2.md) passed in this run; its
implementation was not changed here, so this does not claim its earlier
intermittent environment/cleanup failure has been permanently eliminated.

`npm run docs:build` passed: 116 pages built, 114 public references verified,
and site notices validated. `npm run check:external-install` passed using an
isolated temporary npm cache: 184 runtime entries, 96 ESM/browser and 92 CJS
declarations, plus Score composition in both formats. `npm run audit:dependencies`
passed its high-severity threshold and reported the ten existing moderate
PostCSS/Starlight chain findings tracked by DEP-02. No dependency migration was
attempted. `git diff --check` passed.

Initial integration failures were repaired before the final gate: View API
runtime exports incorrectly reached Headless state; parameter discovery missed
Audio Edit; new demo extraction was absent from Agent Context; a design link
pointed to a nonexistent page. Review also fixed split-buffer memory accounting,
processing/checkpoint/draft reentrancy, stale reads, loop frame alignment,
cancelled chunk reservations and cleanup after borrowed release errors.

## Browser and native audio evidence

The public workflow was tested at `/audio/element/view/audio-view/#waveform-editing`
using `/wav/Editing.wav` (48,000 mono frames at 8 kHz). Keyboard-driven browser
interactions confirmed:

1. Select frames 8,000–16,000 and delete: 40,000 frames, revision 1 in both document
   and playback. Undo: 48,000 frames/revision 2; redo: 40,000/revision 3.
2. Normalize/reverse selected audio, copy/paste, and delete-all to a ready empty
   sequence. A separate final-built normalization advanced both owners to revision
   1 and displayed the correct external-commit label. Clipboard paste added exactly
   8,000 frames. Play/Pause controls responded to keyboard activation.
3. Export displayed `WAV export requested for revision 1` and marked the matching
   content saved. Browser download completion was not established.
4. Explicit 320 and 480 CSS-pixel containers, with frame controls expanded, had
   matching host widths and no overflowing input/button/select/summary bounds.
   This is [DOM geometry evidence](2026-10-15-audio-editing-p3/geometry-result.json),
   not a screenshot-based visual review. The browser viewport override did not
   change its reported 1280px width and was reset.

A temporary local verification route exercised the **final built public APIs**
with native `OfflineAudioContext` nodes. Its adapter forwards native context
methods while reporting a running scheduling clock, avoiding device resume in
an offline graph. This is offline rendering, not human listening or hardware
latency evidence. The [retained harness](2026-10-15-audio-editing-p3/browser-verification.astro.txt)
was removed from the public site after use.

Two identical 512-frame channels at 48 kHz were edited in one transaction:
remove frames 128–256, insert 64 silent frames, set gain 0.5 and fade the final
256-frame segment from 0 to 1. Result: 448 frames. Three native loop cycles
matched explicit sequence rendering sample-for-sample; float WAV round-trip
also matched exactly. Undo restored 512 frames, redo restored 448, and the
transport object remained identical. [Measured results](2026-10-15-audio-editing-p3/pcm-result.json):
maximum playback error **0**, maximum WAV error **0**.

## Remaining acceptance boundaries

The browser's mouse injection timed out and both screenshot interfaces failed.
Keyboard and native PCM results are valid evidence, but they do not establish
rendered visual polish, pointer/touch operation, real screen-reader behavior,
file-picker completion or acoustic/device timing. Pointer preview/commit,
cancellation, external replacement and teardown have DOM regression coverage;
real-browser pointer and visual acceptance remain to be completed. No screenshot
was fabricated from DOM or source data.

P4 staff-input design/prototype remains next. Multi-track/project editing,
spectral repair, seamless playback replacement, pitch-preserving sequence rate
changes and broader DAW features are outside this P3 delivery. No commit, push,
publication or deployment was performed.
