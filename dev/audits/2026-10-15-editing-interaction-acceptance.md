# Editing interaction acceptance and startup cleanup follow-up

Date: 2026-10-15. Branch: `editing-capabilities`, based on
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`, with the existing uncommitted
P0–P4 implementation retained. Environment: macOS, Node 26.8.1, npm 11.19.0.

This follow-up investigates the intermittent documentation-startup failure
and extends browser interaction acceptance. It preserves the original
[P2](2026-10-15-score-editing-p2.md), [P3](2026-10-15-audio-editing-p3.md) and
[P4](2026-10-15-staff-editing-p4.md) records, including their earlier failures
and unverified interaction boundaries. [STATUS](../STATUS.md) owns current
delivery; [Development](../DEVELOPMENT.md#documentation-server-lifecycle) owns
the operator workflow.

## Reproduced startup failure

A repeated `npm run check:dev-server` stress run passed 38 times and failed
on run 39. The failed process-tree test expected the interrupted builder's
termination exit code `143`, but received `1`. Its retained stderr identifies
the overriding error: `process.kill(-pid, 0)` raised `EPERM` inside the
post-exit `drainProcessGroup` cleanup probe. The uncaught cleanup error replaced
the original command outcome.

Evidence is retained without rewriting the failed run:

- [Per-run results](2026-10-15-editing-interaction-acceptance/dev-flake-stress-results.json):
  39 invocations, exit codes and elapsed milliseconds.
- [Run 39 failure](2026-10-15-editing-interaction-acceptance/dev-flake-stress-failure-39.txt):
  complete test output, assertion and the `kill EPERM` stack.

Retained JSON evidence has a final newline added where the temporary writer
omitted it, satisfying the repository format gate. Parsed values, ordering,
exit codes and timings are unchanged; the original run's failure is preserved.

A controlled macOS probe created a separate process group, let its child exit
without reaping it, and called `killpg(pid, 0)`. Before `wait()`, the probe
returned `EPERM` (errno 1); after reaping, it returned `ESRCH` (errno 3).
This directly demonstrates that an unreaped exited process can produce the
permission result seen by the cleanup probe. It does not make every `EPERM`
evidence that a group has disappeared or establish a universal macOS guarantee.

- [Probe source](2026-10-15-editing-interaction-acceptance/dev-zombie-group-probe.py).
- [Observed probe output](2026-10-15-editing-interaction-acceptance/dev-zombie-group-probe.json).

## Implemented cleanup behavior

[The startup script](../../scripts/docs-dev.mjs) now treats `EPERM` from the
post-exit group probe and graceful-termination attempt as unverified cleanup.
It retains startup ownership and retries with a 20 ms interval, bounded by
`cleanupTimeoutMs` (default 5,000 ms). `ESRCH` establishes that the group is gone.
At the deadline, a successful `SIGKILL` establishes that surviving processes
cannot continue writing package output; the OS may still need to reap zombies.
A failed final kill is an explicit cleanup error, not permission to restart.

Cleanup failure reports `ERR_DEV_PROCESS_GROUP_CLEANUP`, the group ID and the
underlying error, retaining any original build/termination failure separately
as `commandError`. Successful cleanup preserves the original command outcome,
including ordinary SIGTERM exit code `143`.

`withStartupLock` records unresolved cleanup in `cleanup-failed.json` and
retains the checkout's startup lock. A later automatic start refuses that
marker even when the lock-owning process has exited. Operator recovery requires
verifying that the recorded group has stopped before removing the lock; stale
numeric PIDs are not sufficient authority to kill a process after PID reuse.
The [maintained lifecycle guidance](../DEVELOPMENT.md#documentation-server-lifecycle)
describes that recovery boundary.

## Automated verification

The final `npm run check:dev-server` passed all 16 tests. In addition to existing
startup, restart, lock and interruption coverage, the added cases exercise
transient post-exit probe denial, transient graceful-termination denial,
persistent cleanup denial retaining a restart barrier after the owner exits,
and successful deadline `SIGKILL` preserving the original command result.
The denial cases inject the relevant signal results; the real macOS probe
above separately establishes the observed operating-system behavior.

After implementation and tests were frozen, 50 consecutive invocations of
that command passed: 50 exit codes `0`, no failures, and approximately 53.8
seconds total recorded execution time. This is a bounded local stress result,
not a guarantee against every future operating-system or process failure.

- [Final 16-test output](2026-10-15-editing-interaction-acceptance/dev-flake-final-tests.txt).
- [Final stress summary](2026-10-15-editing-interaction-acceptance/dev-flake-final-stress.txt).
- [All 50 invocation results](2026-10-15-editing-interaction-acceptance/dev-flake-final-stress-results.json).
- [Stress runner](2026-10-15-editing-interaction-acceptance/dev-flake-final-stress.mjs),
  retained with the original checkout path and temporary output destinations.

An [intervening test failure](2026-10-15-editing-interaction-acceptance/dev-flake-after-stress-failure-2.txt)
is retained separately: its assertion expected a numeric startup-owner marker.
The final implementation atomically renames that marker to
`cleanup-failed.json`, and the final regression checks the replacement marker
and its refusal to permit another start. The earlier result is not counted in
the frozen 50-run acceptance above.

`npm run check` then completed with exit code `0` on the final cleanup
implementation, before the browser-discovered upload-layout CSS repair below.
It passed 4,505 workspace tests across 369 files: Kernel 163, UI 653, Score
2,268, Audio 984, Bridge 182 and Documentation 255. Architecture checked five
packages and 437 source modules; package artifact and release-manifest gates
also completed. The [compact check excerpt](2026-10-15-editing-interaction-acceptance/cleanup-check-excerpt.txt)
retains source-log line numbers and its SHA-256, including the terminal
`Release manifests are consistent at 0.2.0.` result.

The final `npm run check` subsequently completed with exit code `0`, including
the upload-layout CSS, piano-roll ResizeObserver repair, two additional
regressions and public reference updates. Its workspace results are:

| Workspace | Files | Tests |
| --- | ---: | ---: |
| Kernel | 14 | 163 |
| UI | 36 | 653 |
| Score | 198 | 2,270 |
| Audio | 82 | 984 |
| Bridge | 7 | 182 |
| Documentation | 32 | 255 |
| Total | 369 | 4,507 |

Architecture again passed for five packages and 437 source modules; artifact
validation passed for all five packages, and the release-manifest gate reached
its terminal success. The [final check excerpt](2026-10-15-editing-interaction-acceptance/final-check-excerpt.txt)
preserves the complete source log's SHA-256 and the relevant numbered lines.
This final gate supersedes the earlier pre-CSS check for the repaired source.

The final `npm run docs:build` also exited successfully: 117 pages built,
115 public documentation references verified and site licenses checked across
74 records and 367 files. The [build excerpt](2026-10-15-editing-interaction-acceptance/final-docs-build-excerpt.txt)
retains the source log's SHA-256 and terminal results. Rebuilt-browser resize
acceptance is recorded below. Earlier P2–P4 results remain owned by their dated
records.

## Browser interaction and visual acceptance

### Score editing

The production documentation build was exercised in the embedded Chromium browser
at `http://127.0.0.1:4335/`, using real mouse input and captured screenshots.
The shared staff/piano-roll composition used its authored two-measure fixture.
The sequence below records committed document revisions; note positions and
durations are written quarters.

| Interaction | Observed result |
| --- | --- |
| Drag C4 at quarter 0 right 32 px and up 18 px | C♯4 at quarter 0.5, duration 1; revision 1. |
| Drag that note's right edge right 32 px | Duration 1.5; revision 2. Playback's applied revision matched both edits. |
| Cmd+Z twice | Duration 1 at revision 3, then original C4 at quarter 0 at revision 4; document returned to saved state. |
| Shift-click E4, then double-click empty roll space | Shift-click produced a two-note selection. Double-click inserted A4 at quarter 5.25, duration 1, revision 5; undo restored revision 6. |
| Click staff E4 and the whole rest; enable note input, open controls and insert a quarter note at quarter 4 | Existing note and rest were selectable. C4 entry committed revision 7; both views and playback matched. Undo/Redo produced revisions 8/9. |
| Undo to saved state, then horizontally scroll the roll at a 480 px viewport and drag C5 at quarter 3 | Saved state at revision 10; the scrolled drag produced B4 at quarter 4, revision 11; undo produced revision 12. |
| Select staff E4 and use Delete selected | A real quarter rest replaced E4 at revision 13, leaving three sounding notes. Selecting G4 made the replacement rest visible in the captured staff. |

Evidence: [roll drag](2026-10-15-editing-interaction-acceptance/piano-roll-drag.jpg),
[scrolled 480 px roll](2026-10-15-editing-interaction-acceptance/piano-roll-scrolled-480.jpg),
and [staff deletion/rest](2026-10-15-editing-interaction-acceptance/staff-delete-rest.jpg).
The observed browser console error list was empty.

Responsive captures at [480 px](2026-10-15-editing-interaction-acceptance/staff-input-480.jpg)
and [320 px](2026-10-15-editing-interaction-acceptance/staff-input-320.jpg)
showed the staff command controls staying within the narrow layout. At 320 px,
document scroll width was 320 px and the demo's client/scroll widths were both
233 px. Desktop width was restored afterward. Under
[dark site chrome](2026-10-15-editing-interaction-acceptance/staff-site-dark.jpg),
the demo retained a readable light canvas; this does not verify the component's
own dark theme.

A separate [upload-layout capture](2026-10-15-editing-interaction-acceptance/staff-before-import-layout.jpg)
revealed a file-input container overflowing its fixed 32 px button height.
That discovery prompted a CSS repair across three editing demos. The rebuilt
staff demo was checked at desktop and 320 px, and the MIDI demo at 320 px:
the file chooser and filename no longer overlapped. Captures retain the
[desktop staff result](2026-10-15-editing-interaction-acceptance/staff-after-import-layout.jpg),
[320 px staff result](2026-10-15-editing-interaction-acceptance/staff-import-after-320.jpg)
and [320 px MIDI result](2026-10-15-editing-interaction-acceptance/midi-import-after-320.jpg).

The original MIDI demo was also edited with a real drag: C4 at quarter 0 moved
to C♯4 at quarter 0.5, retaining duration 1. Revision 1 reached its player and
the read-only staff followed the edit.

A further [piano-roll resize capture](2026-10-15-editing-interaction-acceptance/piano-roll-resize-before.jpg)
identified an actual component redraw defect. After returning from 320 px to
desktop width, the viewport measured 551 px but the virtualized grid retained
its old approximately 232 px drawing. Only C4/E4/G4/C5 at quarters 0–3 were
drawn; the remaining four fixture notes appeared only after another gesture
triggered redraw. The renderer now observes viewport dimensions, redraws newly
visible notes and cancels only its own active gesture when dimensions change.
Disposal disconnects the observer and ignores late callbacks. Two regressions
cover expanded visibility without document/focus changes, disposal, gesture
cancellation and preservation of another surface's shared draft.

The final production build passed the same browser sequence: at a 320 px
viewport the roll's client width was 231 px and four notes were visible;
resetting to desktop gave a 551 px roll with all eight notes immediately
present, before any further editor interaction. Document/player revision
remained 0 and saved. The [narrow capture](2026-10-15-editing-interaction-acceptance/piano-roll-resize-320.jpg)
and [desktop after capture](2026-10-15-editing-interaction-acceptance/piano-roll-resize-after.jpg)
retain the result. A subsequent real drag committed revision 1, and one undo
restored saved content at revision 2 with matching playback. No browser console
errors were reported. The temporary viewport override was reset, and the
final preview was retained for review.

Screenshot capture was available during this run. One large anchor jump
briefly produced a white browser view; changing the responsive viewport
triggered repaint and restored capture. This recovery is recorded as a tooling
observation, not an application rendering fix.

### Audio editing

The same production browser session exercised the six-second, 48,000-frame
audio fixture with real mouse input. Selection positions below are exact
integer frames; selection gestures alone did not change document revision.

| Interaction | Observed result |
| --- | --- |
| Drag a selection from x456 to x616, then its right edge from x615 to x696 | Selection 6,545–19,345 became 6,545–25,745; revision remained 0. |
| Split at start | Revision 1 contained asset segments of 6,545 and 41,455 frames. |
| Set gain to 0.5, then apply fade-in | Revisions 2/3; the waveform visibly showed the fade's triangular onset. |
| Use Trim to range and drag x454 to x654 | The selected 16,000 frames became the whole document at revision 4; the player reported two seconds. |
| Cmd+Z | Restored 48,000 frames at revision 5. |
| Select frames 8,000–16,000, Copy, Delete, then Paste | Delete produced 40,000 frames at revision 6; Paste restored 48,000 at revision 7. |
| Press Play, then immediately Reverse selection | Revision 8 committed and matched playback; Play's `aria-pressed` was false afterward, confirming the paused post-edit state. |
| Normalize selection | Revision 9 committed with matching playback. |

Captures show [range resizing](2026-10-15-editing-interaction-acceptance/audio-range-resize.jpg),
[gain and fade](2026-10-15-editing-interaction-acceptance/audio-gain-fade.jpg)
and [pointer trim](2026-10-15-editing-interaction-acceptance/audio-pointer-trim.jpg).
The observed Audio console error list was empty.

The [480 px](2026-10-15-editing-interaction-acceptance/audio-editing-480.jpg)
and [320 px](2026-10-15-editing-interaction-acceptance/audio-editing-320.jpg)
captures showed the controls remaining visually usable. At 320 px, the page
width was 320 px and the demo's client/scroll widths were both 233 px. The
[repaired upload row at 320 px](2026-10-15-editing-interaction-acceptance/audio-import-after-320.jpg)
kept the chooser and filename separate. A
[dark-site capture](2026-10-15-editing-interaction-acceptance/audio-site-dark.jpg)
records that surrounding site appearance; it is not component dark-theme
acceptance.

After verification, Reload restored the Audio fixture to revision 0, the
responsive viewport override was reset and the temporary browser tab was
closed. These cleanup actions do not establish leak-free browser/device
resource behavior.

### Remaining acceptance

Touch, screen-reader behavior, file-picker/download completion and
acoustic/device checks remain separate from the recorded
desktop mouse, keyboard, screenshot and DOM-geometry observations. The
completed scenarios do not claim that editing acceptance is exhaustive.
Alt-drag insertion and cancellation during a held pointer remain covered by
automated event tests rather than this real-pointer run.
