# Audio and Bridge development integration — 2026-09-10

## Scope and preserved histories

The release split keeps Score, Kernel and their required UI package on main.
Audio and Bridge development remains on dev. Local dev `9d69d02` and remote dev
`40a445f` were merged as `0a78098`, then pre-split main `f074cd8` was integrated.
The separate main working tree's uncommitted Score review is not included.
No remote branch was pushed by this integration.

## Source choices

- Audio retains its dev timeline renderer, viewport binding, synchronized
  waveform/spectrogram behavior and corresponding tests, together with main's
  playlist/mixer, React, Element lifecycle and styling fixes.
- Bridge and Kernel match the frozen main baseline, including factory guards,
  ownership cleanup and transport contracts.
- The UI manifest is the union of dev's extended entries and main's current
  primitives. Dev's playlist and recorder state normalization, callback handling,
  reentrancy and teardown remain; main's surface styling and stylesheet opt-out
  are integrated into those implementations. Both independent regression suites
  are retained where they cover different behavior.
- Current Score Elements use main's accepted family composition. Additional dev
  Headless controllers and parked Element sources remain present. Legacy attrs
  stay available for the parked level-meter and step-sequencer sources.
- Current guidance follows its main owners; dev's checkout status distinguishes
  the broader source tree from the initial main release. Dated history retains
  its original baseline.

## Score contract reconciliation still required

The four suites below are byte-identical on original local dev `9d69d02`, remote
dev `40a445f`, the local/remote merge `0a78098`, and this integration. They are
absent on the frozen main baseline. Source comparison shows their injection hooks
already missing from the corresponding local dev Elements at `9d69d02`; remote
dev `40a445f` implements those hooks. This is evidence of a pre-existing local/
remote contract mismatch, not a claim that the original local suite was run here.

| Retained test | Failed assertions on this integration | Remote contract |
|---|---:|---|
| `packages/score/test/play/score-recorder-element.test.ts` | 11 | `createScoreRecorderController`, controller lifecycle and source mapping |
| `packages/score/test/play/synth-panel-audio-composition.test.ts` | 5 | `createSynthAudioController`, EffectEqChainController composition |
| `packages/score/test/play/synth-panel-macro.test.ts` | 5 | `mountSynthMacroUI`, per-macro presenter ownership |
| `packages/score/test/view/score-view-element.test.ts` | 9 | `createScoreViewController`, renderer and stage injection |

The corresponding implementations remain recoverable at `40a445f`:

- `packages/score/src/play/element/score-recorder.ts`
- `packages/score/src/play/element/synth-panel.ts`
- `packages/score/src/play/element/internal/synth-panel-model.ts`
- `packages/score/src/view/element/score-view.ts`

These canonical files in the integration match frozen main `f074cd8`, retaining
its current playback-source/view modes, public LFO state and panel composition.
A bounded trial restoring all four remote files made those controller suites
pass but introduced 69 failures in 17 newer suites and seven missing public-type
errors; that trial was completely reverted. Resolving both contracts requires
component design work beyond moving Audio and Bridge. The remote Headless
controllers and all four suites remain in the tree, and both original dev heads
remain ancestors. No tests were disabled or reclassified to claim a green gate.

## Verification

- Isolated committed-lockfile installation passed.
- All five package builds and UI, Score, Audio and Bridge source typechecks passed.
- Audio: 60 files / 599 tests passed, including retained viewport/timeline tests.
- Bridge: seven files / 144 tests passed, including main factory validation and
  cleanup coverage. Bridge and Kernel source trees match frozen main exactly.
- Score: 154 files passed / four failed; 1,906 tests passed / 30 failed, with five
  reported errors from the competing controller fixtures described above.
- Development inventory/link checks and formatting passed. The site built 177
  pages after restoring the retained UI gallery module required by its dev page.
- UI: 55 files / 953 tests passed. The retained piano-roll default now displays
  numeric MIDI values; callers retain the existing `formatPitch` and
  `keyboardLabels` hooks for musical labels. The new regression verifies all
  three paths and label replacement on notifications; the owning reference was
  updated. The full notation gate passes without exempting extended modules.
- `npm run check` passes format, lockfile and lint, then stops on 93 architecture
  problems: parked source reachability and missing extended-UI composition,
  class-policy and live-display catalog coverage. This is the expanded checker
  applied to preserved dev scope, not the previous local check's problem total.
- `npm run check:docs` reports 74 missing extended Element/catalog/API/Headless
  reference entries. Development local-file links and generated inventories pass.
- Final `npm run docs:build` passed, rebuilding all five packages and 177 site
  pages from the final source. Sitemap generation was skipped because no site
  URL was configured; this does not assert deployment.

These results do not establish browser/device, audible timing or publication
acceptance. Architecture and public-documentation readiness remain incomplete
for the extended development surface.
