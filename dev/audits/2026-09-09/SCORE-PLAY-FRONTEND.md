# Score Play frontend source audit — 2026-09-09

Scope: responsive layout, UIKit reuse, interaction and demo composition on
`claude/analysis-view-chord-design-693b7b`. This is source and DOM-test evidence,
not a completed screenshot audit. [Play design](../../design/PLAY-COMPONENTS.md) owns
the presentation contract; [STATUS](../../STATUS.md) owns remaining acceptance.

## Changes

- Note piano/grid layouts retain usable minimum key/cell dimensions inside a
  local scroll viewport; chord buttons and long labels wrap. QWERTY mode reuses
  the input's keyboard focus, with arrow keys scrolling without emitting notes.
- Mixer member names wrap and its fader bank retains a keyboard-accessible
  horizontal viewport. Recorder status, actions and exports wrap. Element hosts
  allow flex/grid shrinking, respect `hidden` and preserve inherited theme tokens.
- Envelope and EQ values occupy a normal-flow footer below the plot. Plot height
  and pointer coordinates remain independent of that footer. EQ native range
  inputs are available to keyboard users, with band/axis labels, units and a
  visible selected-band focus cue.
- Parameter groups, labels and macro targets can shrink and wrap. Synth Panel
  uses UIKit section-panel layout and public tokens for its frameless outer
  surface. The transport shares focus and disabled feedback through the new
  `transportStateStyle` export from the existing UIKit transport entry.
- Note demo Parameters react to the selected layout. Recorder/Synth demos expose
  their real component composition without duplicate demo frames. Rack member
  Parameters keep stable targets through id edits; Reset removes added members.
- The Synth demo supplies inputs for every selectable section and owns its audio
  graph routing, async input guard and cleanup. Default sections stay
  `sound,envelope`; the oscillator applies envelope attack/release only.

## Verification

- `npm run docs:sync`: generated the checkout's inventories.
- `npm run check`: passed. All 2,780 tests in 229 files passed, including 1,598
  Score tests. Formatting, lint, architecture, documentation, package builds,
  source/test typechecking, licenses and release-manifest checks passed. All 158
  scanned documentation snippets compiled; 89 public entries passed export checks.
- `npm run docs:build`: passed; 122 pages built. The unconfigured sitemap `site`
  warning is unchanged and does not block the local documentation build.
- `git diff --check`: passed.

The first full run caught an obsolete facade assertion that prohibited every
style node. Its replacement checks the shared UIKit state stylesheet and its
cleanup; the final full run passed. The cross-review also removed the Synth
demo's permanent readiness cache: each press now uses Headless `preload()` so a
suspended audio clock can resume, with the existing pending-note identity guard.

These totals include prior Analyze/View and Play algorithm work in the shared
branch. No unrelated uncommitted work was reset or replaced.

## Evidence boundaries

The browser tool could not connect to an in-app browser, any alternative browser
or native app. No Play screenshots were captured. Direct local Playwright
verification was requested and remains dependent on user authorization. DOM
tests establish interaction contracts, not rendered width, clipping, touch
accuracy, audible behavior or accessibility across real browsers/devices.

Pending rendered scenarios include the five interactive Play roles at narrow
and wide container widths, piano/grid scroll and held notes, long Rack labels,
all Synth sections, keyboard focus and dark-theme contrast. Physical MIDI and
audible timing remain separate device acceptance.
