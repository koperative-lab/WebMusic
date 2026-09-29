# Audio Player and companion composition

Task started 2026-09-25; verification completed 2026-09-26. Working-tree baseline:
`dev` at `ae0742a`, preserving the earlier migration and main-authority alignment.
Node 24.21.0 on macOS. No commit, push or publication is part of this record.

## Scope and implementation

The maintainer requested a central `audio-player`, playlist/mixer/recorder
companions and View-owned metering. [DEC-029](../../DECISIONS.md#dec-029--audio-player-controls-playback-and-play-companions-attach-to-it)
and [Audio Play](../../design/AUDIO-PLAY-COMPONENTS.md) own the accepted contract.

- `AudioPlayer` is a stable Headless facade over an owned clip engine or a borrowed
  queue/mix backend. It creates no clock. `AudioClipPlayer` and its scratch engine
  retain their single-clip role.
- The canonical Element lives in `play/element/audio-player.ts`. The old tag is
  a small subclass/registration compatibility surface in that same module.
  Element `.player` now expects AudioPlayer; low-level injection requires migration.
- Playlist and mixer attach their backend to the central owner. Linked surfaces
  omit their transport bars. Recorder capture remains separate; take audition
  selects the clip through the central owner. Standalone compatibility remains.
- Selector/object/nested composition handles late insertion/upgrade, replacement,
  removal and ambiguous selectors. Unresolved explicit targets do not silently
  start independent playback. Detach checks the exact installed backend identity.
- Selecting a new nonempty source pauses the previous backend to prevent hidden
  overlap; simple detachment/disposal does not stop or dispose borrowed objects.
  Explicit source selection invalidates pending Element URL/input loads. Final
  disposal publishes empty source/state before removing subscriptions. Nested
  central AudioPlayer objects are rejected rather than offering partial binding.
- Meter controller, math, Element, auto registration, tests, docs and catalogs
  moved from Play to View, preserving the `audio-meter` tag. Play never imports View.
  Meter borrows a player's optional analyser; a mix has no aggregate analyser.
- UI Playlist adds `transport: false` with its existing default preserved.
  Source exports, executable policies, parameter catalogs, canonical routes,
  redirects and the Audio/Bridge Toolkit source mapping were updated together.

Main checkout remains clean at `1e0fb7b`. Hash comparison against the pre-task
snapshot found no Score source/test/reference changes. Main Toolkit behavior
remains unchanged; its Audio-specific extension maps the new owning files.

## Automated evidence

| Check | Observed result |
|---|---|
| `npm test` | 323 files / 4,139 tests pass: Kernel 155, UI 627, Score 2,115, Audio 867, Bridge 154, docs 221 |
| `npm run typecheck` | Workspace checks pass; Astro reports 0 errors, 0 warnings, 3 inherited keyCode deprecation hints across 161 files |
| `npm run typecheck:tests` | Pass |
| `npm run check:doc-snippets` | 242 examples compile against the built declarations; scanner regressions pass |
| `npm run docs:build` | Five package builds and 112-page site pass; search and Toolkit verify 110 public references; 86 site-license records / 335 files |
| `npm run check:architecture` | Five-package boundary and composition checks pass |
| `npm run check:docs` | 71 demo pages / 87 instances, 110 authored pages, 29 canonical Elements; pass |
| `npm run check:dev-docs`, `check:format` | Regenerated inventories/local navigation and text checks pass |
| `npm run check:packages` | Public exports, source/output receipts and bundle notices pass |
| `npm run check:licenses`, `check:release-manifests` | Pass |
| `npm run check` | Stops at the same seven main lint findings recorded in [main alignment](../2026-09-25/MAIN-AUTHORITY-ALIGNMENT.md); no new lint failures or disabled rules |

Regressions include source switch/reentry, borrowed ownership, clear/dispose
notifications, late play/load completion, missing targets, initial binding and
reconnect, queue policy preservation, recorder handoff and meter graph ownership.
The first full pass found three demo fixtures still mocking the old registration;
only their canonical name/markup was migrated, with assertions preserved.

## Browser evidence

Codex in-app browser at localhost:4321, normal viewport (screenshot 1264×728),
neutral light theme. Temporary verification tab closed afterward; user tabs kept.

- Playlist: one central Play/Pause/seek/time row and three entry buttons; keyboard
  Play starts the queue, selecting Take 2 retains the shared transport, time reaches
  0:12 / 5:19 and Pause updates correctly. No console errors observed.
- Mixer: one central transport, master and two member strips; playback advances,
  Solo track A checks successfully, Pause stops the central state.
- Meter: breadcrumb/sidebar under View; two borrowed readouts react after Play
  (level 6, spectrum 59 in the observed frame), without another transport.
- Audio View: lazy data load becomes ready, canonical player starts, waveform and
  Audio position update. Existing centered scrub controls remain present.
- Recorder: linked empty player and capture/audition controls render without
  console errors; no microphone permission was requested during this smoke test.
- Headless demo: load sample, play clip, select queue (old source pauses), play the
  queue, clear to empty. Source revisions advance 1 → 2 → 3 and controls track state.

This is interaction/rendering evidence, not microphone hardware, sample-accurate
mix timing, fresh acoustic scratch measurements or full browser/accessibility
acceptance. Existing timing/capture limitations remain in STATUS and their owners.

## Local recovery and logs

Pre-task authored files and both Git patches were captured at
`/private/tmp/webmusic-audio-player-before-0f531nxm` before edits. Logs remain under
`/private/tmp/webmusic-player-*` for this local session; they are not portable
release evidence. Source and tests are the durable regression record.

## Later follow-up: canonical names and repeatable development startup

The maintainer subsequently removed the compatibility requirement (DEC-030).
The retired `audio-clip-player` Element registration/class/function/detail
aliases, deprecated recorder Element aliases, old player-name styling fallback
and former player/Play-meter redirects are now removed. AudioClipPlayer remains
the real low-level Headless clip engine. Existing independent queue, mixer and
recorder behavior remains supported. Earlier compatibility statements above
record the initial migration only.

The root development command now stops this checkout's tracked Astro server
before rebuilding package outputs. The site command uses `--force=true` to
replace a tracked instance on repeat starts; the explicit value prevents Astro
from consuming `status` or `stop` as a flag argument. The implementation reuses
Astro's checkout lock and does not kill arbitrary listeners by port.

Verification on Node 24.21.0: 66 Audio test files / 869 tests passed, including
canonical and retired-registration coverage. `npm run dev -- --host localhost
--port 4321` stopped the old daemon, built all five packages and started normally.
A subsequent `npm run docs:dev -- --host localhost --port 4321` replaced that
instance successfully; `status` preserved its PID, `stop` stopped it, and a
second `stop` returned success with no server running. Architecture, documentation
and format checks passed. Full `npm run check` still stops at the same seven
inherited main Score/UI lint errors; no new lint findings were introduced.
Logs are retained locally under `/private/tmp/webmusic-no-legacy-*.log`; the
pre-edit Audio source/test/design backup is
`/private/tmp/webmusic-no-legacy-before-rk1y8omi/files.tar.gz`.
