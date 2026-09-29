# Audio View track dragging — 2026-09-25

## Scope and contract

Implemented in the restored local `dev` working tree at `ae0742a`, preserving
existing staged/unstaged migration and the [preceding View repairs](AUDIO-VIEW.md).
Main remains a design reference at `1e0fb7b`. The maintainer requested both
DJ-style position dragging and independent browsing with a configurable switch.
[DEC-026](../../DECISIONS.md) and [Audio View design](../../design/AUDIO-VIEW-COMPONENTS.md)
own the accepted behavior.

The additive `drag-mode` attribute / `.dragMode` property selects:

- `seek`: existing absolute press/move seeking, retained as the library default.
- `scrub`: drag left toward later audio and right toward earlier audio, relative
  to the starting playback position and scale. The track and playhead move by
  the accepted time delta; the viewport remains bounded.
- `pan`: move only the viewport, with independent keyboard navigation.
- `none`: suppress drag commands while retaining stationary click/keyboard seek.

Seeking modes require `interactive`; pan requires `scrollable` and works without
a player. Annotation takes priority; meter ignores time-axis gestures. Pan
suspends follow while selected; scrub suspends it only during the gesture. No
mode creates or pauses a player, changes rate, or claims vinyl sound processing.

## Implementation and regressions

UIKit's existing Stage surface slider owns pointer geometry, a 4 px threshold,
capture, primary-pointer ownership, cursor feedback, keyboard and terminal
callbacks. Audio owns seconds/viewport conversion and one-frame command
coalescing. Pointerup uses its final coordinate; cancel, lost capture, blur,
disconnection and mode/zoom/source replacement discard pending commands.

The new scrub drag reads accepted player time, including loop wrapping, before
publishing its event and placing the viewport. Existing click/keyboard/absolute
seek listeners retain their request-before-command event ordering for compatible
legacy facades. No test was changed to silently redefine that ordering.

An existing annotation test used two sequential hit-test values even though a
real coordinate can be read again on release. Its fixture now maps coordinates
consistently, retaining the same region/no-seek assertion. New tests exercise
release coordinates separately.

Review caught and fixed viewport keyboard state after an external pan, and
accepted loop readback after a deduplicated final release. Error fixtures retain
the prior accepted position immediately when a scrub seek throws, even before
pointer release. Final-release callback tests also cover zoom changes and a
replacement gesture starting before the older callback returns. Both demos default to scrub,
expose the shared parameter, explain direction, and reset through the existing
playground mechanism. Interaction edits do not start spectral analysis.

## Verification

- Focused Audio Element coverage: 4 files / 65 tests passed, including 28 new
  drag scenarios, using current UIKit source through a temporary test alias.
- Demo/playground checks: 2 files / 24 tests passed; focused TypeScript passed.
- UIKit Stage: 35 tests passed (17 new), including pointer ownership, final
  release, terminal cleanup, accepted-value updates, cursor ownership and reentry.
- `npm run check` passed on Node 24.21.0: 309 test files / 4,058 tests;
  architecture, docs, 258 snippets, package/source/test types, licenses,
  112 package entries and release manifests passed.
- `npm run docs:build` passed: 182 pages; the local build retained the expected
  missing `site` sitemap warning.
- Connected in-app browser at the AudioView route, 565.3125 px host / 544.125 px
  plot: a 90 px left drag moved paused waveform time from 3.199811 to 4.199811 s;
  the reverse returned to 3.199811 s. Pan moved viewport start from 0 to 1 s
  while the player's transport slider remained at 10/1000. None kept 6.399623 s
  through a drag, while a stationary click changed it to 6.997539 s.
- Spectrogram: a 45 px left drag moved 10.197351 to 10.697351 s at 90 px/s.
  A brief playing-state trial retained `Pause` / `aria-pressed=true` through a
  scrub; the test then explicitly paused it (`Play` / `aria-pressed=false`).
  No captured warning/error logs appeared. This verifies control/state behavior,
  not device latency or audible scratch processing.
- Browser screenshots were available in this follow-up and showed the neutral
  surface, live position line, grab interaction area and mode-specific help.
  Screenshot evidence in the preceding review remains limited to its original
  run; it is not retrospectively replaced by this result.
- Final documentation sync/checks and diff check passed; the preview was restored
  on port 4321. Main remained clean; the original 1,125 staged migration paths
  were preserved. Work was left as local dev changes.

Native touch, screen readers, audio-device latency and bidirectional scratch
sound are separate acceptance domains. No commit, push or release was performed.
