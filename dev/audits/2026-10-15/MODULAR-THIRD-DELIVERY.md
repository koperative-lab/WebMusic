# Modular third delivery: precision and project editing

> Recovery notice (2026-10-17): The generated evidence marked unavailable below
> was not recovered. The results in this report describe the historical run,
> not current verification. Original artifact paths are retained as text.
> See the [recovery record](../2026-10-17/MODULAR-RECOVERY-AND-RELEASE-FIXES.md).

This record covers steps 11–12 (MOD-11/12, MC-18/19) in the local
`modular-redesign` working tree based on `ef8664d`. It extends the uncommitted
[first](MODULAR-FIRST-DELIVERY.md) and [second](MODULAR-SECOND-DELIVERY.md)
deliveries without changing their dated evidence. The environment is Node
24.19.0, npm 11.9.0 and Chromium 151.0.7922.173 on Linux. No publication,
deployment, commit or remote push is implied.

## Delivered behavior

- Session owns the reference-to-position anchor. Native Score and decoded Audio
  participants borrow mapped readers and loop segments; commands synchronously
  invalidate owned scheduled work. Preparation and activation finish before the
  start origin is selected. Detaching a participant leaves the authority and
  other participants alive.
- Score commits future attacks and duration gates by occurrence and iteration.
  Loop-crossing notes clip and retrigger; supported native voices preserve
  sounding notes through rate changes. Audio uses native buffer looping where
  possible and scheduled intersections with silence outside shorter clips.
  Legacy callbacks, media engines and external transports retain explicit
  capability limits.
- Session automation and LFO phase share the position axis, with repeat/once
  policies, seek re-evaluation and audio-clock pause behavior. Manual parameter
  overrides and automation baselines are included in project state. Saved
  transport positions retain the unwrapped coordinate across loop passes.
- `TransitionInsertChain` explicitly creates fresh owned generations behind
  stable ports, with native gain fades and bounded outgoing tails. Ordinary
  `InsertChain` retains its immediate replacement and unchanged-slot reuse.
  Parameter handles, modulation and automation belong to their generation;
  they are not silently copied to a new effect circuit.
- Versioned project data records stable IDs, exact plugin versions, nested
  scopes, assets, parameters, audio patches, CV mappings, macros, automation
  and separate presentation layout. Runtime restoration validates and stages
  a private muted graph before committing. Failure or cancellation preserves
  the active project; plugin export and snapshot capture are validated before
  activation. Missing plugins retain their data and incident routes.
- Trusted Bridge factories realize Score/Audio players, a Score Rack, audio
  buses, effects and Session LFOs. Applications resolve assets and own storage,
  import/export and undo. Kernel never evaluates code from project JSON.
- The neutral patch editor uses the same runtime commands for native keyboard
  controls and pointer wiring. Layout/label edits preserve graph identity;
  audio/CV edits change only their owned connections. Missing modules and
  unambiguous default routes remain inspectable, including inherited scopes
  and custom input names; unmounting UI leaves DSP alive.

The public modular composition guide includes the running mixed-domain project,
Session controls, save/load, JSON import/export, a macro, label editing and
missing-plugin recovery. The separate UI reference demonstrates the structural
presenter contract without domain imports.

## Verification

`npm run check` (unavailable: `third-evidence/full-check.json`) passed as one complete command
(exit 0). It includes formatting, lint, architecture and documentation policies,
all five package builds, 256 compiled documentation examples, source/test type
checks, licenses, package verification and release manifests. The workspace
suites passed 367 files and 4,548 tests:

| Workspace | Files | Tests |
| --- | ---: | ---: |
| Kernel | 25 | 349 |
| UI | 37 | 673 |
| Score | 194 | 2,195 |
| Audio | 75 | 901 |
| Bridge | 8 | 192 |
| Documentation | 28 | 238 |

`npm run docs:build` (unavailable: `third-evidence/docs-build.json`) also passed as one complete
command (exit 0), including the five-package rebuild, 114 generated pages, 112
public search/Markdown references and site license verification (74 records,
356 files). The check log (unavailable: `third-evidence/full-check-output.txt`),
site build log (unavailable: `third-evidence/docs-build-output.txt`) and
[reproducible fixtures](third-evidence/README.md) are retained. Acceptance was
rebundled after the final site build so measurements use the final package output.

### Native signal evidence

The final native suite (unavailable: `third-evidence/timing-results.json`) passed all 11 cases
at 48 kHz with no browser errors. Five mixed Score/Audio cases cover native loops,
future seek/pause, rate changes during a sounding note and wider loops with a
shorter clip and negative offset. Their 263,747 compared frames have maximum
absolute sample error `1.2101617152815436e-8` against tolerance `2e-6`.
Observed Score/Audio onset and release boundaries differ by 0 frames (allowed
tolerance: 2 frames). Independent expected-signal checks exclude four frames
around discontinuities; relative edge alignment is checked separately.

Four relative automation/LFO cases cover repeat/once phase, seek cancellation,
rate mapping and frozen audio-clock time. Their maximum error is
`4.4219164607728345e-7`. Actual native gain crossfades and finite DelayNode tails
have maximum errors `1.0108947745557373e-7` and `9.655952453169192e-7`, respectively,
against the unchanged `3e-5` tolerance. Ports remain stable and outgoing effect
handles retire at their audio deadline.

The run receipt (unavailable: `third-evidence/timing-run-receipt.json`),
build metadata (unavailable: `third-evidence/timing-build.json`) and
fingerprint verification (unavailable: `third-evidence/timing-fingerprint-verification.json`)
match all six public entries and the final fixture bundle. No repository source
imports were bundled. Native acceptance exposed a decimal loop-boundary rounding
failure; the corrected segment calculation derives boundaries from the shared
anchor and integer iteration, with its original failure retained separately.

### Browser evidence

The structural editor fixture (unavailable: `third-evidence/modular-third-editor-results.json`)
passed keyboard audio/CV wiring, collision-safe parameter ports, signed layout,
stable module identity during movement, JSON round-trip, missing-plugin recovery
and editor unmount without disposing the native oscillator. It uses public built
Kernel/UI entries and retains desktop (unavailable: `third-evidence/modular-third-editor-desktop.png`)
and narrow (unavailable: `third-evidence/modular-third-editor-narrow.png`) screenshots.

The actual public guide and UI Kit reference (unavailable: `third-evidence/modular-third-project-docs-results.json`)
passed user-gesture activation, play/pause, rename and keyboard layout edits,
browser save/load, JSON download/import, CV connection/disconnection, missing-plugin
recovery and invalid-schema import without damage to the active graph. Loading
and recovery remain paused. The guide and reference both fit a 320px page; the
guide's 832px module canvas scrolls within its 239px viewport. No browser errors
occurred. Retained screenshots show the
desktop project (unavailable: `third-evidence/modular-third-project-docs-desktop.png`),
narrow project (unavailable: `third-evidence/modular-third-project-docs-narrow.png`) and
narrow UI reference (unavailable: `third-evidence/modular-third-editor-uikit-narrow.png`).
Only fixed documentation chrome was hidden during screenshot capture; interaction
and geometry assertions used the unchanged page. The invalid-import message is
intentionally visible in the project screenshots.

Final output verification (unavailable: `third-evidence/final-output-verification.json`) matches
all eight recorded public entries, both fixture bundles and 43 loaded guide
JavaScript assets, and records both tested public page fingerprints. Final
status/evidence edits are followed by documentation synchronization, inventory,
public-documentation, formatting and diff checks. Earlier failed command receipts
remain alongside the successful final receipts; test fixture fixes did not relax
type checking or timing thresholds.

## Measurement boundaries

Native render fixtures compare real Web Audio output against independent
reference signals. Score's public player requires a live AudioContext; its
deterministic timing harness hides only the OfflineAudioContext render marker
and supplies pre-render readiness while retaining native context identity,
audio time and DSP. This verifies the scheduled graph, not a newly supported
offline ScorePlayer API. The actual public demo separately exercises normal
browser playback and user-gesture activation.

Committed audio-clock events do not establish unlimited background execution,
physical device latency or behavior on every browser. Lookahead can starve;
media/external timing remains approximate. There is no automatic device/plugin
latency compensation. Tail retention is bounded and explicit; project restore
uses a muted candidate and an immediate commit, with paused restoration by
default. Unknown domain signal connectors remain unresolved until an application
provides a matching adapter. The editor does not own storage or undo history.
Default-route projection uses the runtime's effective audio owner and its sole
declared audio input. Multiple owner inputs without endpoint metadata and
external destinations are omitted rather than assigned an invented endpoint.
