# Implementation status and open work

> This checkout prepares the shared `0.3.0` modular release. A public registry
> query on 2026-10-15 (America/New_York) confirmed all five `0.2.0` packages
> already exist; the new module/Session entries require updated foundations.
> [Release instructions](release/0.3.0.md) own adoption and version-specific gates.
> The earlier integration at `eaa88af4` through
> [PR #25](https://github.com/koperative-lab/WebMusic/pull/25) and its
> [successful CI run](https://github.com/koperative-lab/WebMusic/actions/runs/36516020568)
> are historical evidence, not validation of this modular working tree.
> The original verified `0.1.0` Agent Toolkit release receipt is preserved;
> preparing `0.3.0` does not publish it or create a new verified receipt.
> Product direction is accepted in [PRODUCT](PRODUCT.md) and [DECISIONS](DECISIONS.md).
> Historical plans and audit snapshots retain their recorded baselines.

## Checkout profile

This checkout contains the reviewed Kernel/UI/Score foundation plus Audio
and Bridge work. Inspect local and remote Git refs separately when describing
availability.

Score follows main except for explicitly requested Analyze component-frame
defaults (DEC-034), the two-chord-tool Analyze inventory (DEC-043), and
domain-prefixed Web Component tags (DEC-045). Public
references and parameter catalogs also retain the standalone Score Recorder
page/demo (DEC-032) and Analyze demo layout alignment (DEC-033).
Agent Toolkit behavior preserves the verified first-release baseline; its
five-package adapter identifies this checkout as a source snapshot. Audio/Bridge
retain their domain capabilities, including Audio timeline and synchronized
viewport bindings. Shared Kernel/UI differences are limited to required domain
compatibility with explicit source, contract and regression ownership.

The earlier extra Score controllers, parked Elements and unrelated public UI
applications are removed from the current surface. UI documentation uses the
six canonical groups; Audio additions live in their owning presenter references.

The earlier `cfa90b2` integration and [2026-09-11 CI reconciliation](log/2026-09-11-dev-ci-reconciliation.md)
describe a historical source baseline. Their outcomes do not establish this
merged worktree's checks, remote CI or deployment. The root package scripts
and the current workflow determine today's executable gates.

The [Audio Player composition follow-up](audits/2026-09-26/AUDIO-PLAYER-COMPOSITION.md)
records the central `audio-player`, linked playlist/mixer/recorder and the then-
View meter migration. Source selection and disposal/late-load regressions are covered;
recording hardware and acoustic group timing remain separate acceptance work.
DEC-030 removes the temporary old Element aliases and routes; current demos
and exports use canonical names. The [development workflow](DEVELOPMENT.md#documentation-server-lifecycle)
defines reuse on ordinary startup and explicit stop/restart for rebuilds;
ordinary startup must not terminate another active terminal's server.
The later [Audio Play layout follow-up](audits/2026-09-26/AUDIO-PLAY-LAYOUT.md)
records DEC-031's canonical `audio-recorder` naming, full-width hosts and
Score-aligned spacing, including normal and 320px browser checks.

The [Score Recorder documentation follow-up](audits/2026-09-26/SCORE-RECORDER-PAGE.md)
records DEC-032's standalone recorder page, linked input demo and updated
navigation. Demo lifecycle tests and browser recording checks passed; the full
check at that recorded baseline retained the DEV-06 lint blocker.

The [Analyze demo alignment](audits/2026-09-26/ANALYZE-DEMO-ALIGNMENT.md)
records the common full-width composition, single type-controlled Audio result
demo, visible-host sizing and Histogram source recovery. All ten Element demos
were checked at ordinary and narrow widths; acoustic/device acceptance remains
separate. DEV-06 blocked the complete gate at that recorded baseline.
DEC-035 first replaced that Audio Analyze inventory with onset, beat and
live-pitch surfaces; DEC-036 superseded those interim tags with level, spectrum
and tuner tools. DEC-037 now selects five live Analyze tools, including the
returning meter, oscilloscope and transient analyzer, without a tuner. The dated
demo record remains evidence for its former baseline, not acceptance of the
new surfaces.
The five current Analyze demos passed desktop and 390px browser smoke checks;
the bundled WAV drove meter, oscilloscope and transient live readings. Real
device input, acoustic accuracy and screen-reader interaction remain unverified.
The [frame and startup correction](audits/2026-09-26/ANALYZE-FRAME-AND-DEV-STARTUP.md)
supersedes that pass's acceptance of bare Score surfaces: DEC-034 restores the
shared component border and padding. Ordinary development starts now reuse the
tracked server; replacement is explicit.

DEC-043 parks the motif and rhythm-pattern Elements from DEC-040 on the local
`codex/score-pattern-analysis-research` branch for later study. The current
Score Analyze Elements are live chord and chord progression; recurrence
algorithms and projections remain API/Headless capabilities. Selection stays
local to a component and does not edit Score or create playback authority.
The change is present in the integrated `main` baseline.
[The earlier inspection record](audits/2026-09-26/SCORE-ANALYZE-INSPECTION.md)
describes DEC-038's former five-tool tree and does not verify this inventory.
DEC-041 still governs the retained chord readings: candidates remain in
`.analysis` instead of Element buttons, and live alternate names are static
text below the symbol. DEC-042's dense chord projection also remains.

DEC-044 retires the three narrower Audio View Elements
`audio-clip-thumbnail`, `audio-minimap` and `audio-region-list`. Audio View now
exposes `audio-view` and `audio-live-view` as its current tags; lower-layer
clip/region and UI Kit capabilities remain available. The late-binding issue
formerly tracked as AUDIO-VIEW-01 applied to the removed companions.

DEC-045 gives all current Score Element and public demo tags a `score-` prefix,
matching Audio's existing `audio-` convention. It retires the old unprefixed
registrations and the deprecated `simple-score-player` alias; old documentation
routes redirect to the renamed Element pages. DEC-046 accepts this source
surface for the main integration.

## How to read status

“Implemented” means a source path exists and its stated behavior was inspected. “Verified” names the checks or environment used. “Accepted target” states intended behavior that still requires design or implementation. An automated check is not proof of real audio, device, browser, remote publication, or complete API documentation.

The current public surface is generated in [COMPONENTS](COMPONENTS.md); documentation coverage is mapped in [DOCUMENTATION-MAP](DOCUMENTATION-MAP.md). Versions and dependency ranges belong to manifests, not a copied status table.

## Capability readiness

| Area | Current evidence | Boundary |
|---|---|---|
| Models, APIs, Headless, Elements, UI presenters | Five source package workspaces, explicit public exports and element/presenter catalogs | Entry-specific environments and optional dependencies still apply; source presence is not registry publication |
| Score/Audio coordination | Session-owned shared scheduling anchors, mapped native Score/Audio readers, future loop segments and revisioned legacy group commands; measured native renders in the third modular delivery | Media/external participants remain approximate; bounded lookahead can starve, and device/plugin latency is not automatically compensated. A legacy clockless master without an observed forward position step cannot be safely inferred to have stopped from repeated samples alone. |
| Cross-domain conversion | Timeline mapping, score rendering, transcription-result assembly in Bridge | No lossless audio-to-score round-trip guarantee |
| Interaction and visual customization | UI bindings, presenter-owned resources/styles, public tokens and handles, composed Elements | Device, accessibility, and browser acceptance are not implied by unit tests |
| Analyze/View attachment to Play | Score core source contract, native Headless/Element `.playback`, borrowed Score data and snapshots in Analyze/ScoreView, optional Headless ScoreView binding | Controller/Rack single-score data remains unavailable; legacy event targets retain partial capabilities. PitchView follows held-note sources; readout/log tags and chord preview remain targets in [Player binding](design/PLAYER-BINDING.md) |
| Documentation organization | Product/design/decision/architecture owners, generated component/file indexes, four page templates, archived history, and a source-based pass across all Headless reference leaves | Semantic review, automated coverage, and demo/browser acceptance remain distinct; see the open checks below |
| Prior runtime repairs | [Repair record](audits/2026-09-05/FIXES.md): 197 test files / 2,205 tests, full check and docs build on local Node 22 | This is dated evidence; it is not a new Node 24/device/external-install result |

## Current work queue

The modular redesign's three deliveries (steps 1–12) are complete and locally
verified in the `modular-redesign` working tree. The
[first acceptance record](audits/2026-10-15/MODULAR-FIRST-DELIVERY.md) covers
composition, routing and shared controls. The
[second acceptance record](audits/2026-10-15/MODULAR-SECOND-DELIVERY.md) adds
complete per-voice ADSR, occurrence-owned note input, native CV/LFO, shared
macros and absolute audio-clock automation. The
[third acceptance record](audits/2026-10-15/MODULAR-THIRD-DELIVERY.md) covers
shared-anchor scheduling, seek/loop-relative automation and LFO phase, effect
generation transitions, versioned project restoration and accessible patch
editing. Each record owns the checks, measurements and limitations of its
stated baseline. Their contracts are
[DEC-047](DECISIONS.md#dec-047--modular-composition-separates-resources-routing-and-session-authority)
and DEC-048, with [Modular composition](design/MODULAR-COMPOSITION.md); current public usage
is in the [runnable guide](../apps/doc/webmusic/src/content/docs/bridge/modular-composition.mdx).
The [2026-10-16 review follow-up](audits/2026-10-16/MODULAR-REVIEW-FIXES.md)
repairs 20 independently reproduced mixing, lifecycle, scheduling, control,
project transaction and focus defects. Its verification record supersedes any
inference that the earlier acceptance covered those boundary cases. The complete
check passed 4,620 tests, the documentation build passed, and final native/public
page checks verified the repaired behavior against the rebuilt outputs.

The subsequent [release-readiness repairs](audits/2026-10-15/MODULAR-RELEASE-FIXES.md)
close eight further defects and one adjacent mixer reentry defect, with 50 new
regressions. At that baseline the complete check passed 4,670 tests; documentation build,
independent `0.3.0` tarball installation and final native/public-page acceptance
also pass. Package versions and internal peer floors are prepared as `0.3.0` /
`^0.3.0`; an incompatible published `0.2.0` Kernel is rejected during installation.
These are local working-tree results, not a verified release-commit CI or registry
delivery receipt. The dated record owns reproduction details and finite test limits.

The next [release follow-up](audits/2026-10-16/MODULAR-RELEASE-FOLLOWUP-FIXES.md)
addresses twelve further project automation, readiness ownership, envelope,
lazy LFO, CommonJS identity and editor reentry findings, with 65 new regressions.
The complete check passes 4,735 tests across 371 files; documentation build,
independent tarball installation and final native/browser acceptance pass.
Installed CommonJS entry identity, automatic retry focus and manual-override
save/restore are now covered directly. The new record retains original failures
separately from the repaired behavior; final-commit CI and registry delivery
remain RELEASE-01.

The [release hardening follow-up](audits/2026-10-16/MODULAR-RELEASE-HARDENING.md)
closes two further initial-attachment/mixer reentry failures. The full check
passes 4,743 workspace tests plus eight original-media checks. DEP-02's remaining
ten reports are cleared; DEV-05's unresolved resources are replaced or removed.
Normal and Pages site builds and native/browser playback, resource, license and
narrow-layout checks pass. The dated record retains original failures, exact
artifact fingerprints and the final external-install checks separately from
the release-commit CI and registry work in RELEASE-01.

The subsequent [read-only candidate review](audits/2026-10-16/MODULAR-RELEASE-CANDIDATE-REVIEW.md)
revalidates the unchanged implementation and packed inputs but finds eight
additional defects: factory-disposal graph publication, stale natural-end
commands, mixed built-in mixer starts, lazy channel-ID collisions, sampler
capability forwarding, analyzer binding cleanup and error payloads, and combined
browser-global meter identity. The subsequent
[recovery and candidate repairs](audits/2026-10-17/MODULAR-RECOVERY-AND-RELEASE-FIXES.md)
restore the uncommitted implementation from retained task history and close all
eight findings, including analyzer teardown/reconnection. Both fresh Node 22.22.3
and independent Node 24.19.0 full gates pass 4,833 tests across 373 files, with
90 added regressions. Final installed-package checks pass 174 runtime entries,
all declaration variants, 65 native browser cases and 36 Session/Group cases;
both dependency audits report zero vulnerabilities. New receipts and frozen
input hashes are retained with that record. Some older generated evidence was
not recoverable and is explicitly marked unavailable; earlier reports remain
historical rather than fresh verification.

| ID | Work and state | Acceptance | Owning reference |
|---|---|---|---|
| MOD-RC-01 | Closed locally: RC-01–08 repaired with 90 added regressions; dual-Node full gates and final installed public/native cases pass | Preserve the frozen-input and package receipts; remote final-commit CI and actual publication remain RELEASE-01 | [Candidate repairs and recovery](audits/2026-10-17/MODULAR-RECOVERY-AND-RELEASE-FIXES.md), [original review](audits/2026-10-16/MODULAR-RELEASE-CANDIDATE-REVIEW.md) |
| MOD-11 | Implemented: shared-anchor native scheduling, future loop passes, relative automation/LFO and explicit effect crossfades/tails | MC-18; native render measurements and cancellation regressions in the third acceptance record. Media/external timing, device latency and scheduling starvation retain explicit limits | [Shared-clock design](../platform/shared-clock-injection.md), Modular composition, DEC-048 |
| MOD-12 | Implemented: versioned project save/restore and accessible audio/CV connection editing | MC-19; stable identity, transactional rollback, missing-plugin recovery and keyboard-equivalent editing; application retains persistence/undo | Modular composition, third acceptance record, DEC-048 |
| MOD-13 | Audio leaves and desks follow a provider's destination-only change in place; Score leaves and Racks still rebind, recreating engines and Rack channel levels/mute/solo | Give `ScorePlayerModule` and `ScoreRackModule` an in-place re-route, use `moduleScopeChange()` in the Score player and Rack Elements, and verify that a mixed root destination change keeps sounding notes and Rack levels | [Modular composition](design/MODULAR-COMPOSITION.md), DEC-049 |
| DEP-02 | The remaining ten moderate reports are cleared by a scoped Expressive Code override to postcss-nested 7.0.2. Fresh installation, twenty CSS/render compatibility checks and both audits pass with zero findings | Retain the scoped override until a supported parent release adopts the safe dependency. Integrated checks and exact local evidence belong to the hardening record | [Release hardening](audits/2026-10-16/MODULAR-RELEASE-HARDENING.md), [Development](DEVELOPMENT.md) |
| TIME-01 | Implemented for native participants: one Session scheduling authority with mapped readers, synchronous invalidation and borrowed participant lifetimes; legacy group authority remains supported | Third-delivery tests and native renders verify shared-anchor consumption and cancellation. Broader device/browser acceptance remains VERIFY-01 | [Shared-clock design](../platform/shared-clock-injection.md), DEC-018, DEC-048 |
| BIND-01 | Native Score data/state attachment is implemented; external controller/Rack and legacy event capabilities remain partial | Extend only explicitly supported source/part/activity capabilities; preserve readiness, source identity and borrowed lifetimes. Do not invent a single Score for a multi-source owner | [Player binding design](design/PLAYER-BINDING.md), DEC-011 and DEC-017 |
| BIND-02 | Readout/log tags and scored-chord preview remain targets; retained PitchView supports player/source binding | Resolve the spec's open member/unit choices; implement the supported modes, part/note identity and bounded logs; align public entries, presenters, catalogs, references and accessible demos | Player binding design and component/page templates |
| PLAY-01 | Algorithm/lifecycle and responsive UI source changes are implemented; earlier external-theme browser checks cover transparent surfaces, colors, radii, narrow/wide geometry and transport keyboard focus | Verify the merged Play demos' rendered state, keyboard and touch behavior at narrow/wide widths; measure device suspend/resume and MIDI separately | [Play design](design/PLAY-COMPONENTS.md), [implementation audit](audits/2026-09-09/SCORE-PLAY.md), [frontend source audit](audits/2026-09-09/SCORE-PLAY-FRONTEND.md), [styling review](audits/2026-09-10/SCORE-STYLING.md) |
| VIEW-01 | Written-time projection and VexFlow replace the quantized staffrender path. Timed Part clefs/directions, source tuplet visibility, no-source clef inference and independent slur/tie geometry are implemented. The ten-page, 107-measure PDF review also led to full-Part slur pairing, articulation/barline/rest-position preservation and compact ink packing; final automated and Chrome results are recorded in the contract | Cross-staff/cross-measure beams, nested tuplets, complete grace/expression/font fidelity, per-articulation placement, credits/labels and page/editor layout remain bounded or unsupported. The cross-staff curve collision solver is bounded and does not establish complete engraving parity. Complete cross-browser/accessibility acceptance, including keyboard access; MIDI notation remains inferred. Do not claim full MuseScore parity | [Staff notation contract and acceptance](design/STAFF-NOTATION.md#acceptance), [PDF coverage](design/STAFF-NOTATION.md#pdf-comparison), [ScoreView notation limits](../apps/doc/webmusic/src/content/docs/score/element/view/score-view.mdx), DEC-024 |
| CHORDIO-01 | DEC-043 selects two Score Analyze Elements and parks recurrence UI; the 2026-09-27 reduced-inventory checks are recorded for their earlier tree | Verify chord passage selection and seeking, multiple companions, source replacement, pointer/keyboard/screen-reader behavior, audible non-unit-rate navigation and real-device layout on the merged tree | [Analyze component design](design/ANALYZE-COMPONENTS.md), DEC-043 and owning Element/API pages |
| ANALYZE-01 | Deterministic regression cases cover key-profile rotations, triads and inference boundaries; empirical musical accuracy remains unmeasured | Evaluate an annotated real-music corpus with declared genres, ground truth, metrics and ambiguity policy before claiming accuracy percentages or calibrated confidence | [Score Headless review](audits/2026-09-10/SCORE-HEADLESS.md), [Analyze algorithm record](audits/2026-09-10/SCORE-HEADLESS-ANALYZE.md) |
| ANALYZE-02 | Score-based analysis reads written Note pitches and ignores Part.transpose; mixed transposing-instrument harmony and cross-part voice results are not reliable concert-pitch analysis | Establish written/concert pitch-basis contracts and one normalization path across stateless algorithms, incremental caches, workers and projections. Preserve source IDs/notation, define spelling, avoid double transposition, and verify piano/B♭ clarinet chord and parallel-fifth fixtures | [API transposition finding](audits/2026-09-10/SCORE-API.md#open-transposing-instrument-contract), [public pitch basis](../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx#pitch-basis-and-transposing-instruments) |
| SCOREIO-01 | MIDI/MusicXML/ABC/MXL correctness repairs cover supported format subsets; full interchange and navigation fidelity remain limited | Define and test supported complex features before expansion: SMPTE timing, richer ABC syntax, cross-measure notation splitting and nested/alternative repeat routing. Preserve documented unsupported-input errors and lossy boundaries | [Score API review](audits/2026-09-10/SCORE-API.md), [IO detail](audits/2026-09-10/SCORE-API-IO.md), [repeat contracts](audits/2026-09-10/SCORE-API-MODEL.md) |
| DEV-05 | The unresolved resources were removed or replaced with original MIT-licensed study media. The [public inventory](../apps/doc/webmusic/ASSETS.md) records seven files, exact provenance and distributed notices; source and site build gates verify generated bytes and independent hash pins | Review changes through the asset gate and final Pages build before manual deployment. This source replacement does not alter existing deployments or clear rights for removed files | [Release hardening](audits/2026-10-16/MODULAR-RELEASE-HARDENING.md), [Development](DEVELOPMENT.md) |
| TIME-02 | Native Score/Audio future-loop scheduling and phase mapping are implemented and measured | Third-delivery native fixtures measure loop boundaries, seek, pause, rate edits and wider-loop silence at 48 kHz. Committed graph precision does not establish unlimited background scheduling or hardware latency | Shared-clock design, Bridge and third acceptance record |
| AUDIO-ANALYZE-01 | DEC-037 selects five live Analyze Elements: meter, level, spectrum, oscilloscope and transient. Source/documentation integration and browser/acoustic acceptance remain | Verify exact five-tag canonical inventory and one idempotent legacy View meter alias; real player and explicit-analyser binding; meter tap ownership, threshold/freeze/hold, spectrum probing, bounded oscilloscope trigger/timebase/probe and transient sensitivity/refractory behavior; pause/seek/end/source changes, graph loss and cleanup; normal/narrow layout, keyboard and device behavior. Distinguish normalized meter from sampled dBFS level, FFT output from calibrated SPL, and transient cues from BPM or a beat grid. Verify beat-grid API/Headless output composed with `audio-view.regions` without a retired Analyze tag | [Audio Analyze design](design/AUDIO-ANALYZE-COMPONENTS.md), owning Element/API/Headless pages |
| AUDIO-VIEW-02 | Live View retains a fixed number of caller-paced observations and paints them at equal spacing; `windowSeconds` is not a precise elapsed-time display at variable capture rates | Decide timestamp spacing versus an explicit fixed capture cadence; verify pause, background/foreground and high-refresh behavior without creating another playback clock | [Audio View design](design/AUDIO-VIEW-COMPONENTS.md), owning live projection types and tests |
| DOC-02 | Headless demo/control catalog coverage remains partial; authored Related navigation is now the supported reference path | Implement missing object demos and catalog controls where meaningful, or document the input/environment needed to demonstrate them; validate options, commands, state, events, reset and cleanup against the authoring contract | [Headless template](docs/HEADLESS-PAGE-TEMPLATE.md) and source catalogs |
| DOC-04 | Public API and Headless completeness checks are narrower than the templates | Check actual member/reference ownership, types and target content where mechanical; retain manual review for semantics | Conventions and page templates |
| DOC-05 | Element/Headless/API page-shape and demo layout enforcement is incomplete | Define accepted exceptions, enforce applicable order/count rules, and align page-specific demo placement without breaking working demos | [Site plan](docs/DOCS-SITE-PLAN.md) |
| DOC-06 | The family start pages and the two form inventories are in place; `checkLinks` now rejects a repository link that only resolves through a redirect, but no check constrains the title or section shape of the two inventories, and the retired capability-Overview title rule was not replaced | Decide whether the inventories need a title/section-shape rule of their own, and whether the family element inventory's per-capability sections should be asserted the way its absence of demos already is | [Site plan](docs/DOCS-SITE-PLAN.md), [Conventions](docs/DOCS-CONVENTIONS.md), DEC-020 |
| VERIFY-01 | Source/package checks and dated browser evidence cover their stated scenarios; broader cross-browser/audio/MIDI/microphone acceptance, background timing and accessibility remain separate | Record actual environment, procedure and results separately; use the release gates for package delivery and device tests for acoustic/interaction claims | [Kernel release review](audits/2026-09-11/KERNEL-RELEASE.md), [Development](DEVELOPMENT.md), [Publishing](release/PUBLISHING.md) |
| RELEASE-01 | Shared `0.3.0` metadata and dependency floors are prepared; MOD-RC-01 is closed and fresh Node 22/24 local gates plus installed-package acceptance pass. Publication and current registry state have not been reverified in this recovery task; prior release receipts remain unchanged | Verify remote CI for the final reviewed commit (GitHub API access currently returns 403), recheck registry versions and publisher rights, publish in dependency order, verify registry installation, then tag the producing commit and record delivery; site deployment remains separate | [Candidate repairs and recovery](audits/2026-10-17/MODULAR-RECOVERY-AND-RELEASE-FIXES.md), [0.3.0 preparation](release/0.3.0.md), [Publishing](release/PUBLISHING.md), [Releasing](release/RELEASING.md) |
| APP-01 | Score/Audio playback reference and independent-loop examples are implemented; workstation/project scenarios remain product goals | Use the reference to validate new capabilities before expansion; application project/undo/storage and installation deployment remain application-owned concerns | [Reference composition](../apps/doc/webmusic/src/content/docs/bridge/composition.mdx), [Product](PRODUCT.md), DEC-019 |

REPO-01 and DEV-06 are closed by the merged integration and successful remote CI
linked above. Their earlier failures and repairs remain in the
[local CI repair record](audits/2026-09-28/CI-LINT-AND-ATTRIBUTION.md).
That earlier deployment did not establish asset rights. DEV-05 now records the
original-media replacement in the current source; already deployed files are unchanged.

The prior dev-doc audit is [historical evidence](audits/2026-09-05/DEV-DOCS-REVIEW.md). Its stale-rule and ownership findings are addressed by this documentation reorganization. DOC-01's missing Headless reference sections have been completed: the leaf pages now have Import, grouped API, lifecycle/time responsibilities, and Related navigation, with public types routed through the family Headless inventory. This is source-based reference work, not proof from the value-name gate alone. Verification and the snapshot's limits are recorded in the [documentation reorganization record](audits/2026-09-05/DOCUMENTATION-REORGANIZATION.md); work requiring implementation or broader acceptance remains above.

The [code-alignment record](audits/2026-09-05/CODE-ALIGNMENT.md) records the
completed symmetric factory guards (TIME-03), expanded snippet checker and
explicit authoring boundary (DOC-03), and repairs to Score wrappers, Rack
effects and existing demo lifetimes. Missing Headless demo/catalog coverage
remains in the queue above; the third modular delivery implements the native
shared-clock protocol with separately stated legacy and device limits.

The [documentation synchronization record](audits/2026-09-06/DOCUMENTATION-SYNC.md) records the shared guidance update, preserved branch baselines and actual verification results.

The [design-contract record](audits/2026-09-08/DESIGN-CONTRACTS.md) records native
snapshot and nominal-seek acceptance (BIND-03), revisioned command authority,
mode configuration and runnable reference compositions. The remaining engine
clock injection, timing precision and companion capabilities stay in the queue.

## Retained Score evidence

The [Score Headless review](audits/2026-09-10/SCORE-HEADLESS.md) records the
2026-09-10 timing, identity, numerical and lifecycle repairs across Score's
public Headless entries and their shared foundations. Its regression evidence
does not close the browser/device, engraving or empirical-analysis gaps above.

The subsequent [Score API review](audits/2026-09-10/SCORE-API.md) records exact
arithmetic, PPQ conversion, model/edit/repeat, format interchange and stateless
capability corrections on top of that Headless baseline. Public API references
describe the implemented algorithms and their representational limits; this
does not establish full notation interchange or measured musical inference accuracy.

The [Audio visual alignment record](log/2026-09-25-audio-visual-alignment.md)
records shared neutral defaults, repaired theme inheritance and representative
rendered/keyboard checks. Broader device and accessibility acceptance remains
subject to the existing work queue.

The [Audio Play repair record](audits/2026-09-25/AUDIO-PLAY.md) records the
callback/lifecycle, source-binding, mixer/queue, recorder and meter corrections
and their bounded test evidence. [Audio Play design](design/AUDIO-PLAY-COMPONENTS.md)
owns the accepted responsibilities. The third modular delivery adds measured
native clock precision; VERIFY-01 retains broader device and browser acceptance.

The [Audio View review](audits/2026-09-25/AUDIO-VIEW.md) records lazy shared demo
analysis, bounded spectrogram storage, cached data/readiness and interaction
repairs. CPU probes and browser DOM observations remain separate from measured
browser opening latency, visual screenshots and real-device acceptance.

The [main Score/Agent Toolkit synchronization](audits/2026-09-25/MAIN-SCORE-TOOLKIT-SYNC.md)
records local checks and browser observations for the earlier, broader
integration. Its retained-controller scope is superseded by the current main
authority above; the dated record remains unchanged and does not verify this
corrected tree.

The [main-authority follow-up](audits/2026-09-25/MAIN-AUTHORITY-ALIGNMENT.md) records
the exact Score/Toolkit baseline, current workspace tests, site build, packaging,
external-consumer and browser checks. At that recorded baseline, full `check`
inherited the seven main lint findings; no rules or tests were disabled. The
[local CI repair](audits/2026-09-28/CI-LINT-AND-ATTRIBUTION.md) records the later
source fixes and their separate `dev` and `main` verification boundaries.

## Change discipline

Keep each open item here until acceptance has evidence, then link a dated record and remove it from the active queue. Historical completion descriptions stay in their dated records. New scope changes update the owning decision or contract as well as this queue; they do not silently turn a product goal into a shipped claim.
