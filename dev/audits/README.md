# Audit records

Audits preserve findings, remediation and verification for a named source
baseline and environment. A copied report or a later merge does not validate
another checkout. [STATUS](../STATUS.md) owns current gaps;
[the development map](../README.md) routes to accepted contracts and the
[workflow logs](../log/README.md) explain completed review sequences.

| Date | Records | Evidence and reading boundary |
|---|---|---|
| 2026-09-05 | [Project audit](2026-09-05/README.md), [repairs](2026-09-05/FIXES.md), [code alignment](2026-09-05/CODE-ALIGNMENT.md) | Read the original findings with the later repair records. Raw reproductions and logs remain in [evidence](2026-09-05/evidence/) and [repair evidence](2026-09-05/repair-evidence/); the [portable evidence manifest](2026-09-05/evidence/portable-evidence.json) locates retained log copies. |
| 2026-09-05 | [Development documentation review](2026-09-05/DEV-DOCS-REVIEW.md), [documentation reorganization](2026-09-05/DOCUMENTATION-REORGANIZATION.md) | Ownership, source alignment, checker coverage and the limits of the recorded documentation pass. |
| 2026-09-06 | [Documentation synchronization](2026-09-06/DOCUMENTATION-SYNC.md) | Branch-specific documentation checks; shared guidance did not merge runtime implementations. |
| 2026-09-08 | [Design contracts and reference compositions](2026-09-08/DESIGN-CONTRACTS.md) | Playback attachment, command authority and recorded browser smoke. Read its later integration note for the current decision identifiers and source ownership. |
| 2026-09-09 | [Score Play implementation](2026-09-09/SCORE-PLAY.md), [Score Play frontend source review](2026-09-09/SCORE-PLAY-FRONTEND.md) | Algorithm/lifecycle and source/DOM checks. The frontend report explicitly leaves rendered screenshot, touch and device acceptance open. |
| 2026-09-10 | [Score Headless reliability review](2026-09-10/SCORE-HEADLESS.md) | Public Play/Analyze/View export coverage, shared Core/I/O timing, independent algorithm cases, lifecycle repairs and integrated verification. Musical inference and browser/audio/device acceptance retain explicit limits. |
| 2026-09-10 | [Score API algorithm and contract review](2026-09-10/SCORE-API.md) | Root/model/time/JSON, complete I/O, stateless Analyze/Play/View and React contract coverage; independent arithmetic/format fixtures, reproduced repairs and explicit representation, interchange and inference limits. Builds on the preceding uncommitted Headless baseline. |
| 2026-09-10 | [Score and UIKit external styling review](2026-09-10/SCORE-STYLING.md) | Public token propagation, transparent surfaces, renderer colors, rounded frames, styling hooks and browser verification across Play/Analyze/View and UIKit. |
| 2026-09-11 | [Kernel release preparation](2026-09-11/KERNEL-RELEASE.md) | Runtime lifecycle and synchronization repairs, CommonJS export identity, public contract coverage, package/consumer validation and observed release prerequisites. |
| 2026-09-25 | [Audio Play review and repairs](2026-09-25/AUDIO-PLAY.md) | Playback callbacks, mix/queue state, source binding, capture readiness and stable meter ports; source tests and device acceptance remain separate. |
| 2026-09-25 | [Audio View review and opening performance](2026-09-25/AUDIO-VIEW.md) | Shared lazy demo analysis, bounded rendering, data caches and pointer/readiness regressions; CPU probes, browser observations and remaining binding gaps are distinguished. |
| 2026-09-25 | [Audio View track dragging](2026-09-25/AUDIO-VIEW-DRAG.md) | Relative scrubbing, viewport-only browsing, shared gesture ownership and compatibility; source and browser evidence have separate scopes. |
| 2026-09-25 | [Centered Audio View scratching](2026-09-25/AUDIO-VIEW-SCRATCH.md) | Follow-up to position dragging: scratch-session ownership, centered rendering and playback restoration; full checks, browser interaction and native output samples, with device acceptance limits. |
| 2026-09-25 | [Audio View inertia and spectral stability](2026-09-25/AUDIO-VIEW-INERTIA.md) | Follow-up to the original scratch backend: continuous audio phase, shared release motion/sound and stable spectral layers; native output, full checks, built CommonJS interoperability, site build and browser interaction results recorded; physical-device listening and latency remain unverified. |
| 2026-09-25 | [Audio waveform raster and spacing](2026-09-25/AUDIO-WAVEFORM-RASTER.md) | Follow-up to the gray waveform report: fractional bar opacity seams, a bounded integer-column raster and shared padding; native alpha measurements, full checks, site build and final layout/playback observations recorded. |
| 2026-09-25 | [Audio View frame cadence and demo density](2026-09-25/AUDIO-VIEW-FRAME-CADENCE.md) | Optional live-player frame observation, same-frame rendering and a fixed compact demo preset; verification pending. |
| 2026-09-25 | [Main Score and Agent Toolkit synchronization](2026-09-25/MAIN-SCORE-TOOLKIT-SYNC.md) | Main implementation restored alongside dev extensions; branch preservation, five-package checks and native page verification. |
| 2026-09-25 | [Main authority alignment](2026-09-25/MAIN-AUTHORITY-ALIGNMENT.md) | Corrected scope: exact main Score and Toolkit baseline with Audio/Bridge additions; current tests and inherited lint failures are distinguished. |
| 2026-09-26 | [Audio Player and companion composition](2026-09-26/AUDIO-PLAYER-COMPOSITION.md) | Central transport, linked queue/mixer/recorder, View meter migration, source-race fixes and current automated/browser evidence. |
| 2026-09-26 | [Audio Recorder naming and Play layout](2026-09-26/AUDIO-PLAY-LAYOUT.md) | Canonical recorder name, full-width Audio Play hosts, Score spacing parity, narrow-layout and interaction evidence. |
| 2026-09-26 | [Score Recorder standalone page](2026-09-26/SCORE-RECORDER-PAGE.md) | Dedicated page ownership, linked input demo, lifecycle and parameter regressions, browser recording and documentation build. |
| 2026-09-26 | [Analyze demo alignment](2026-09-26/ANALYZE-DEMO-ALIGNMENT.md) | Shared full-width layout, one demo per type-selected component, Audio host/Histogram repairs, and ten-page normal/narrow browser checks. |
| 2026-09-26 | [Score Analyze frame and startup correction](2026-09-26/ANALYZE-FRAME-AND-DEV-STARTUP.md) | Follow-up correcting the earlier bare-surface acceptance and destructive repeated Astro startup. |
| 2026-09-26 | [Score Analyze inspection redesign](2026-09-26/SCORE-ANALYZE-INSPECTION.md) | DEC-038 five-tool inventory, reusable interval/rhythm inspection, current-tree checks and bounded desktop/mobile browser evidence. |
| 2026-09-28 | [Local CI lint and attribution repair](2026-09-28/CI-LINT-AND-ATTRIBUTION.md) | Seven Score/UI diagnostics and Koperative metadata repaired in the dev tree and a local main worktree; Node 24 gates and main's release-baseline boundary are recorded separately. |

For a new audit, record the commit or working-tree baseline, scope, environment,
procedure, findings and actual command outcomes. Distinguish source inspection,
test doubles, rendered browser checks, audible measurements and device tests.
Link durable evidence beside the report and name unverified behavior explicitly.

Preserve previous measurements and failures. Add a dated correction or follow-up
when needed, linking to the earlier finding and the resulting change. Promote
accepted design into its owning document and current work into STATUS; an audit
is not a second live checklist. [Development](../DEVELOPMENT.md) owns the current
verification workflow.
