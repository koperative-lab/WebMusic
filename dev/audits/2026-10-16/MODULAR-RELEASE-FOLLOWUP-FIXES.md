# Modular release follow-up repairs

This record covers the twelve defects reproduced in the next release-readiness
review after the [previous repairs](../2026-10-15/MODULAR-RELEASE-FIXES.md).
The baseline is branch `modular-redesign`, HEAD `ef8664d`, with the existing
uncommitted implementation preserved. The date uses America/New_York; raw
receipts retain UTC timestamps. This record does not establish publication,
deployment or validation of a final release commit.

## Scope and regression ownership

| ID | Defect and repair boundary | Maintained regression owner |
| --- | --- | --- |
| R01 | Ordinary manual base edits left the latest subscribed project snapshot with automation enabled. Report the terminal ownership transition so the final save restores the manual value. | Kernel `module-project.test.ts` |
| R02 | Playback started by a readiness observer lost its engine when outer preparation resumed. Retain the current engine and cancel superseded preparation. | Audio `audio-player.test.ts` |
| R03 | Direct same-ID mixer admission during readiness orphaned a channel. Revalidate the candidate before committing and preserve the nested committed owner. | Audio `mixer-routing.test.ts` |
| R04 | Score Rack same-ID admission leaked its overwritten channel and insert. Reject the stale candidate without releasing the newer owner. | Score `score-rack-module-lifecycle.test.ts` |
| R05 | Initial child Rack preparation accepted an upstream lease revoked during acquisition. Reject and retire that candidate; an already prepared borrowed child retains its own lifetime. | Score `score-rack-module-lifecycle.test.ts` |
| R06 | Reentrant manual writes during automation scheduling or pause were mistaken for automation's own writes. Track the precise authored base revision and stop continuation after takeover. | Kernel `session-modulation.test.ts` |
| R07 | Default envelope trigger/release could reject when the native clock advanced between two reads. Capture one current-time anchor per command. | Kernel `param-modulation.test.ts` |
| R08 | Completed envelope model points accumulated indefinitely. Retain the required predecessor and future events while pruning completed history. | Kernel `param-modulation.test.ts` |
| R09 | Explicit attached LFO start did not prepare a lazy default instrument. Start preparation for that command while retaining target/lifetime cancellation. | Score `synth-panel-modulation.test.ts` |
| R10 | Audio CommonJS subpaths duplicated `AudioClip` and Bridge rejected clips returned by the loader. Share CommonJS chunks and exercise loader-to-project composition from installed tarballs. | External consumer Audio composition fixture |
| R11 | UI CommonJS entries duplicated presenter host ownership, leaving two editors after remount. Share chunks and check entry identity plus same-host replacement. | External consumer identity gate and existing presenter lifecycle tests |
| R12 | An older editor completion cleared the selection of a new command started by its error callback. Check command ownership before applying completion side effects. | UI `patch-editor.test.ts` |

R12 cross-review also reproduced native button blur during automatic retries,
including a synchronous retry failure during a coalesced refresh. The repair
must preserve the retry's selection and recover its eligible focus after its
controls are enabled, while honoring any focus move made by the user.

Public contracts are maintained in the owning Kernel, Audio, Score and patch
editor references. `SessionAutomationOptions.onRelease` observes final ownership
release after cleanup; it provides the project runtime with an explicit
notification instead of relying on parameter subscriber order.

The maintained suites add 65 regressions: Kernel 25, UI 11, Score 16 and Audio
13. Independent reviews checked the automation/envelope pair, Audio/Score
admission pair, and packaging/editor pair. Focused failures were retained before
the fixes, including both native editor focus corrections found during review.

## Verification

Verification uses Node `24.19.0`, npm `11.9.0` and Chromium `151.0.7922.173`.
The [evidence directory](release-followup-evidence/README.md) retains command
receipts, original failures, focused repairs, cross-reviews and public probes.
The source inventory covers 1,170 implementation, test, public documentation,
manifest and build inputs, including untracked modular files.

| Gate | Result |
| --- | --- |
| `npm run check` | Passed, exit 0: 4,735 tests across 371 files. Kernel 424, UI 697, Score 2,236, Audio 941, Bridge 192 and documentation 245. Format, lint, architecture, documentation, snippets, builds, types, licenses, exports, artifacts and release manifests also pass. |
| Dependency audits | Production: zero findings. Full audit: zero high/critical, ten existing moderate development-toolchain reports; exit 0 at the declared high threshold. No dependencies were upgraded for this repair. |
| `npm run docs:build` | Passed, exit 0: 114 pages, 112 public references and local search; site notices verified 74 records and 356 files. |
| `npm run check:external-install -- --keep` | Passed from five actual `0.3.0` tarballs: 174 ESM/CJS runtime entries, 91 ESM/browser and 87 CommonJS declarations, strict resolution checks, UI entry identity, Score composition and Audio loader-to-Bridge asset admission. |
| Installed entry order and cleanup | UI root-first and subpath-first each pass 14 identity/remount/ID/cleanup assertions. Audio passes four independent ESM/CJS and loading-order processes. Score passes four IO-first processes with nine model/analysis assertions each. Emitted CommonJS static relative-require graphs contain no strongly connected components; AudioClip and patch-editor each have one shared implementation. This bounds the observed Score re-export build warnings; it does not claim every possible loading order. |
| Project and automation ownership | Public ESM project checks pass 3/3: final subscribed saves, exports and restores preserve base `0.3` with automation disabled. Public CJS scheduling/pause reentry checks pass 2/2: manual base `0.9` remains with an inactive lease after another worker tick. Fixtures control the clock; these checks do not measure hardware timing. |
| Envelope clock, history and curves | Public native live-context stress: 100,000 trigger and 100,000 release commands, zero exceptions. Three offline trajectories pass, maximum sampled error below `0.00000061`. A separate deterministic 10,000-gate fixture retains two model points at every checkpoint; future-event retention has maintained tests and a 60,000-query differential review. |
| Audio and Score native acceptance | New Audio cases pass 3/3: one source, one native stop, zero remaining cursor intervals and zero sampled output after stop/dispose; duplicate admission preserves the committed channel and removal silences it. Score passes 10/10 Rack/lazy-LFO cases. Prior Audio scenarios pass 10/10 and broader timing/effect acceptance passes 11/11. |
| Prior native automation | Twenty real-time trials and six offline sampled-curve scenarios pass again on the final public outputs, with input and bundle hashes retained. |
| Editor and actual documentation | Public lifecycle cases pass 8/8; installed public UI passes the native 18-case retry/focus matrix. Prior editor scenarios pass 11/11, with 47 served HTML/JS/CSS responses matching the final documentation output. The broader project guide and UI Kit flows pass at desktop/narrow sizes; screenshots are retained. No browser/page/asset verification errors were reported. |
| Tarball contents and peer floor | All five inspected tarballs contain only package metadata, README, LICENSE and built outputs. Published Kernel/UI `0.2.0` with candidate Audio `0.3.0` rejects with the expected `ERESOLVE` for Kernel `^0.3.0`; no peer bypass flags. The lockfile hash is unchanged from the preceding validated candidate. |

Public probes reject workspace source inputs and record the built files they
actually consume. The editor focus matrix consumes the independent installation.
The final source inventory remained unchanged through acceptance. Native PCM
checks use their recorded sample rates and selected observations; live context
stress is a regression exercise, not a daily failure-rate estimate or a device
latency/listening certification. Browser interaction and DOM-emulator remount
evidence are identified separately in the retained reports.
After recording these results, `docs:sync`, `check:dev-docs`, `check:docs`,
`check:format` and `git diff --check` also passed. The evidence manifest preserves
the raw bytes and fingerprints of the archived before/after records.

## Release boundary

These repairs do not publish `0.3.0`. Final-commit Node 22.22.3/24 CI, publisher
authentication, registry delivery and verification remain release steps in
[Publishing](../../release/PUBLISHING.md). The site's eight media attribution
gaps remain a separate deployment condition; npm tarballs exclude those assets.
The existing development-only PostCSS advisory chain remains tracked by DEP-02.
