# Audio visual alignment — 2026-09-25

## Baseline and scope

This pass used the local `dev` worktree at `ae0742a`, its restored five-package
migration, and the preceding guidance alignment. Existing staged and unstaged
work was preserved. The target was Audio Web Component visual consistency with
Score under [Design principles](../DESIGN-PRINCIPLES.md) and the shared
[UI contracts](../../packages/ui/README.md).

All Audio leaf demos already use the shared ElementPlayground/LiveDemoCanvas
chrome. The drift came from Audio-specific blue compatibility defaults,
`audio-view`'s extra blue/dark skin, three canonical demos forcing blue, and
remaining blue meter/selection defaults in UIKit.

## Repairs

- Shared neutral defaults now apply to Audio playback, mixing, metering,
  playlist selection, waveform, minimap and analysis timeline surfaces.
  Existing control geometry, one-frame composition and interaction remain.
- Audio legacy aliases feed internal compatibility seams instead of declaring
  public `--wm-*` tokens locally. Inherited presenter-specific themes therefore
  apply to both Score and Audio; legacy aliases keep their precedence.
- Audio View consumes semantic waveform, progress and playhead colors. The
  waveform renderer resolves CSS colors in its actual DOM inheritance scope,
  supports named/translucent colors, and redraws when ancestor theme attributes
  change without replacing the view or moving its viewport. Observation and
  queued rendering are released on disposal.
- Meter rendering leaves unspecified palette options to UIKit. Explicit
  options and application tokens remain supported; the inner meter no longer
  forces a dark panel.
- Removed forced blue from the canonical thumbnail, minimap and live-view
  examples. Updated owning references, parameter hints and the shared design
  rule. Explicit reskin examples, spectral color maps, caller region colors
  and meaningful peak/recording/playhead colors remain intentional.
- The complete check exposed missing Vite environment types in the root test
  configuration after the earlier Rack asset-base correction. Added
  `vite/client` to the test environment; the focused test typecheck then passed.

## Browser evidence

Used the Codex in-app browser, canonical Score player / Audio View / Audio
Minimap pages, the existing audio fixture, and a temporary local theme fixture.
The temporary page was removed after acceptance; no extra public route ships.

| Scenario | Observation |
|---|---|
| Canonical Score transport compared with Audio | Shared square controls, spacing and neutral surfaces; Audio retains its duration readout |
| Canonical Audio waveform | Gray default wave and semantic playhead replace the earlier blue/red skin |
| Canonical minimap | Inherited neutral waveform; selection computes to a black border and translucent gray fill |
| Public theme override | Audio transport and mixer both compute to the supplied `rgb(122, 41, 79)`; waveform follows its supplied theme |
| Legacy override over the public theme | Transport and mixer both compute to the supplied legacy `rgb(33, 110, 57)` |
| Light/dark switching while paused | Waveform redraws; scroll offset remains 400 CSS pixels |
| 320 CSS-pixel host viewport | No page-level horizontal overflow; controls wrap; waveform keeps its local scroll surface |
| Keyboard operation | ArrowRight on Audio position changes the accessible value to 1; focus remains on Audio View |
| Wider layout | Checked at 1280 CSS pixels; canonical comparison screenshots also captured near 644 CSS pixels |

Accepted local screenshots were captured for the before/after waveform,
Score reference, neutral minimap, custom theme, dark theme and narrow keyboard
state. Audio View's inspected browser console contained no errors. Browser
observations here cover representative visual and interaction scenarios, not
all modes, assistive technologies, browsers or real audio/device timing.

## Automated verification

- Audio Element focused tests: 7 files, 68 tests passed.
- Shared UIKit focused tests: 7 files, 70 tests passed.
- Waveform renderer/viewport and meter facade tests: 3 files, 17 tests passed,
  including CSS color handling, inherited palette preservation, unchanged
  viewport on theme redraw and observation cleanup.
- `npm run check`: passed, including documentation/architecture checks, package
  builds, snippet checks, typechecks, workspace tests, license policy, 112 public
  export entries and release-manifest consistency.
- `npm run docs:build`: passed; 182 pages built. Existing Sandpack directive,
  bundle-size and missing sitemap `site` warnings remain informational.
- `git diff --check`: passed. The 1,125 pre-existing staged changes were
  preserved; this pass remains unstaged on `dev`.

The separate dependency-audit findings remain DEP-01 in [STATUS](../STATUS.md).
This visual pass does not upgrade the toolchain or establish publication,
deployment, audible synchronization, microphone/MIDI or full accessibility
acceptance.
