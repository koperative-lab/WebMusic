# Implementation status and open work

> Checkout baseline: `dev` at `ae0742a` with the restored five-package migration in the working tree. Main `1e0fb7b` is the Score and Agent Toolkit authority; this tree adds Audio and Bridge. Current-tree checks and the reproduced main lint baseline are recorded in [the alignment audit](audits/2026-09-25/MAIN-AUTHORITY-ALIGNMENT.md); earlier results remain tied to their earlier tree. Product direction is accepted in [PRODUCT](PRODUCT.md) and [DECISIONS](DECISIONS.md). This file owns current work and verification gaps.

## Checkout profile

This checkout contains main's Kernel/UI/Score baseline plus Audio and Bridge
work. Inspect local and remote Git refs separately when describing availability.

Score follows main except for explicitly requested Analyze component-frame
defaults (DEC-034), the two-chord-tool Analyze inventory (DEC-043), and
domain-prefixed Web Component tags (DEC-045) in this `dev` checkout. Public
references and parameter catalogs also retain the standalone Score Recorder
page/demo (DEC-032) and Analyze demo layout alignment (DEC-033).
Agent Toolkit behavior follows
main; its demo inventory includes this new canonical page. Audio/Bridge
retain their domain capabilities, including Audio timeline and synchronized
viewport bindings. Shared Kernel/UI differences are limited to required domain
compatibility with explicit source, contract and regression ownership.

The earlier extra Score controllers, parked Elements and unrelated public UI
applications are removed from the current surface. UI documentation uses main's
six canonical groups; Audio additions live in their owning presenter references.

The earlier `cfa90b2` integration and [2026-09-11 CI reconciliation](log/2026-09-11-dev-ci-reconciliation.md)
describe a historical source baseline. Their outcomes do not establish this
restored worktree's checks, remote CI or deployment. The root package scripts
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
The change is present in this checkout, not yet a main baseline.
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
routes redirect to the renamed Element pages. This is local to the `dev`
checkout until separately accepted and synchronized to main.

## How to read status

“Implemented” means a source path exists and its stated behavior was inspected. “Verified” names the checks or environment used. “Accepted target” states intended behavior that still requires design or implementation. An automated check is not proof of real audio, device, browser, remote publication, or complete API documentation.

The current public surface is generated in [COMPONENTS](COMPONENTS.md); documentation coverage is mapped in [DOCUMENTATION-MAP](DOCUMENTATION-MAP.md). Versions and dependency ranges belong to manifests, not a copied status table.

## Capability readiness

| Area | Current evidence | Boundary |
|---|---|---|
| Models, APIs, Headless, Elements, UI presenters | Main Score/Toolkit baseline, Audio and Bridge workspaces, and their required shared compatibility contracts | Entry-specific environments and optional dependencies still apply |
| Score/Audio coordination | Revisioned group commands/snapshots, Bridge delegation, affine follower mapping and explicit native-loop phase mapping | Engines still own separate clocks; group loop boundaries depend on watcher delivery and native timing belongs to the selected backend. A clockless master without an observed forward position step cannot be safely inferred to have stopped from repeated samples alone. |
| Cross-domain conversion | Timeline mapping, score rendering, transcription-result assembly in Bridge | No lossless audio-to-score round-trip guarantee |
| Interaction and visual customization | UI bindings, presenter-owned resources/styles, public tokens and handles, composed Elements | Device, accessibility, and browser acceptance are not implied by unit tests |
| Analyze/View attachment to Play | Score core source contract, native Headless/Element `.playback`, borrowed Score data and snapshots in Analyze/ScoreView, optional Headless ScoreView binding | Controller/Rack single-score data remains unavailable; legacy event targets retain partial capabilities. PitchView follows held-note sources; readout/log tags and chord preview remain targets in [Player binding](design/PLAYER-BINDING.md) |
| Documentation organization | Product/design/decision/architecture owners, generated component/file indexes, four page templates, archived history, and a source-based pass across all Headless reference leaves | Semantic review, automated coverage, and demo/browser acceptance remain distinct; see the open checks below |
| Prior runtime repairs | [Repair record](audits/2026-09-05/FIXES.md): 197 test files / 2,205 tests, full check and docs build on local Node 22 | This is dated evidence; it is not a new Node 24/device/external-install result |

## Current work queue

| ID | Work and state | Acceptance | Owning reference |
|---|---|---|---|
| DEV-06 | Seven Score/UI lint findings are fixed locally in `dev` and an isolated `main` worktree; the Node 24 `dev` check passes. The main fix is not on its remote branch | Integrate the main patch with a reviewed release identity, update its verified agent-context mapping, and run the complete main gate and remote CI on that commit | [Local repair](audits/2026-09-28/CI-LINT-AND-ATTRIBUTION.md), [earlier alignment audit](audits/2026-09-25/MAIN-AUTHORITY-ALIGNMENT.md) |
| DEV-05 | Audio/Bridge static-asset provenance inventory remains separate from restored main build and Toolkit checks | Review authorship, redistribution terms and complete resource inventory before publication | [Development](DEVELOPMENT.md), [Contributing](../CONTRIBUTING.md) |
| TIME-01 | Group command authority, revisioned observation and participant re-entry are implemented; same-instance clock injection remains open | Specify/verify engine consumption of one shared anchor if introducing injection; preserve the existing command outcome, cancellation and participant ownership guarantees | [Shared-clock design](../platform/shared-clock-injection.md), DEC-018 |
| TIME-02 | Native follower loops have explicit phase mapping; sample-accurate cross-domain group loop behavior still needs evidence and scheduler work | Verify next-pass scheduling before group boundaries and measure actual discontinuities; native loop metadata alone does not prove acoustic precision | Shared-clock design and Bridge |
| BIND-01 | Native Score data/state attachment is implemented; external controller/Rack and legacy event capabilities remain partial | Extend only explicitly supported source/part/activity capabilities; preserve readiness, source identity and borrowed lifetimes. Do not invent a single Score for a multi-source owner | [Player binding design](design/PLAYER-BINDING.md), DEC-011 and DEC-017 |
| BIND-02 | Readout/log tags and scored-chord preview remain targets; retained PitchView supports player/source binding | Resolve the spec's open member/unit choices; implement the supported modes, part/note identity and bounded logs; align public entries, presenters, catalogs, references and accessible demos | Player binding design and component/page templates |
| PLAY-01 | Algorithm/lifecycle and responsive UIKit/source changes implemented; browser visual acceptance pending | Verify Play demos at narrow/wide widths with screenshots, keyboard and touch; current browser tool was unavailable. Measure real-device suspend/resume and MIDI behavior separately | [Play design](design/PLAY-COMPONENTS.md), [implementation audit](audits/2026-09-09/SCORE-PLAY.md), [frontend source audit](audits/2026-09-09/SCORE-PLAY-FRONTEND.md) |
| VIEW-01 | Main's written-Score/VexFlow path is the implementation baseline; broader engraving acceptance remains | Verify browser/accessibility and supported source-notation scenarios against the unchanged main contract | [Staff notation](design/STAFF-NOTATION.md), [ScoreView reference](../apps/doc/webmusic/src/content/docs/score/element/view/score-view.mdx), DEC-024 |
| AUDIO-ANALYZE-01 | DEC-037 selects five live Analyze Elements: meter, level, spectrum, oscilloscope and transient. Source/documentation integration and browser/acoustic acceptance remain | Verify exact five-tag canonical inventory and one idempotent legacy View meter alias; real player and explicit-analyser binding; meter tap ownership, threshold/freeze/hold, spectrum probing, bounded oscilloscope trigger/timebase/probe and transient sensitivity/refractory behavior; pause/seek/end/source changes, graph loss and cleanup; normal/narrow layout, keyboard and device behavior. Distinguish normalized meter from sampled dBFS level, FFT output from calibrated SPL, and transient cues from BPM or a beat grid. Verify beat-grid API/Headless output composed with `audio-view.regions` without a retired Analyze tag | [Audio Analyze design](design/AUDIO-ANALYZE-COMPONENTS.md), owning Element/API/Headless pages |
| AUDIO-VIEW-02 | Live View retains a fixed number of caller-paced observations and paints them at equal spacing; `windowSeconds` is not a precise elapsed-time display at variable capture rates | Decide timestamp spacing versus an explicit fixed capture cadence; verify pause, background/foreground and high-refresh behavior without creating another playback clock | [Audio View design](design/AUDIO-VIEW-COMPONENTS.md), owning live projection types and tests |
| CHORDIO-01 | DEC-043 selects two Score Analyze Elements and parks the recurrence UI for research; DEC-041 and DEC-042 still refine chord readings and dense-score layout. On 2026-09-27 the reduced inventory passed Score Analyze tests (530), full workspace tests, source/test typechecks, architecture/docs/dev-docs checks, package exports, snippets and docs build. The full `npm run check` still stops at DEV-06's seven unrelated lint findings; the earlier four-tool desktop/mobile walkthrough belongs to its prior tree | Verify chord passage selection and seeking, multiple companions, source replacement, pointer/keyboard/screen-reader behavior, audible non-unit-rate navigation and real-device layout before promoting the approved Score/UI exception to main | [Analyze component design](design/ANALYZE-COMPONENTS.md), DEC-043 and owning Element/API pages; [former inspection record](audits/2026-09-26/SCORE-ANALYZE-INSPECTION.md) |
| DOC-02 | Headless demo/control catalog coverage remains partial; authored Related navigation is now the supported reference path | Implement missing object demos and catalog controls where meaningful, or document the input/environment needed to demonstrate them; validate options, commands, state, events, reset and cleanup against the authoring contract | [Headless template](docs/HEADLESS-PAGE-TEMPLATE.md) and source catalogs |
| DOC-04 | Public API and Headless completeness checks are narrower than the templates | Check actual member/reference ownership, types and target content where mechanical; retain manual review for semantics | Conventions and page templates |
| DOC-05 | Element/Headless/API page-shape and demo layout enforcement is incomplete | Define accepted exceptions, enforce applicable order/count rules, and align page-specific demo placement without breaking working demos | [Site plan](docs/DOCS-SITE-PLAN.md) |
| DOC-06 | The family start pages and the two form inventories are in place; `checkLinks` now rejects a repository link that only resolves through a redirect, but no check constrains the title or section shape of the two inventories, and the retired capability-Overview title rule was not replaced | Decide whether the inventories need a title/section-shape rule of their own, and whether the family element inventory's per-capability sections should be asserted the way its absence of demos already is | [Site plan](docs/DOCS-SITE-PLAN.md), [Conventions](docs/DOCS-CONVENTIONS.md), DEC-020 |
| APP-01 | Score/Audio playback reference and independent-loop examples are implemented; workstation/project scenarios remain product goals | Use the reference to validate new capabilities before expansion; application project/undo/storage and installation deployment remain application-owned concerns | [Reference composition](../apps/doc/webmusic/src/content/docs/bridge/composition.mdx), [Product](PRODUCT.md), DEC-019 |
| VERIFY-01 | Current-tree automated checks are recorded in the alignment audit; broader external/device verification remains | Run full local checks and site builds, then record actual external-consumer, dependency, browser/device and eventual remote CI evidence separately | [Development](DEVELOPMENT.md), [Publishing](release/PUBLISHING.md) |
| RELEASE-01 | npm publication, remote tags, repository archival and deployment require a fresh external-state check | Check registry, relevant remotes and hosting evidence immediately before acting; local tags alone do not establish publication | Publishing and releasing runbooks |

The prior dev-doc audit is [historical evidence](audits/2026-09-05/DEV-DOCS-REVIEW.md). Its stale-rule and ownership findings are addressed by this documentation reorganization. DOC-01's missing Headless reference sections have been completed: the leaf pages now have Import, grouped API, lifecycle/time responsibilities, and Related navigation, with public types routed through the family Headless inventory. This is source-based reference work, not proof from the value-name gate alone. Verification and the snapshot's limits are recorded in the [documentation reorganization record](audits/2026-09-05/DOCUMENTATION-REORGANIZATION.md); work requiring implementation or broader acceptance remains above.

The [code-alignment record](audits/2026-09-05/CODE-ALIGNMENT.md) records the
completed symmetric factory guards (TIME-03), expanded snippet checker and
explicit authoring boundary (DOC-03), and repairs to Score wrappers, Rack
effects and existing demo lifetimes. Missing Headless demo/catalog coverage
and the shared-clock protocol remain in the queue above.

The [documentation synchronization record](audits/2026-09-06/DOCUMENTATION-SYNC.md) records the shared guidance update, preserved branch baselines and actual verification results.

The [design-contract record](audits/2026-09-08/DESIGN-CONTRACTS.md) records native
snapshot and nominal-seek acceptance (BIND-03), revisioned command authority,
mode configuration and runnable reference compositions. The remaining engine
clock injection, timing precision and companion capabilities stay in the queue.

The [Audio visual alignment record](log/2026-09-25-audio-visual-alignment.md)
records shared neutral defaults, repaired theme inheritance and representative
rendered/keyboard checks. Broader device and accessibility acceptance remains
subject to the existing work queue.

The [Audio Play repair record](audits/2026-09-25/AUDIO-PLAY.md) records the
callback/lifecycle, source-binding, mixer/queue, recorder and meter corrections
and their bounded test evidence. [Audio Play design](design/AUDIO-PLAY-COMPONENTS.md)
owns the accepted responsibilities; VERIFY-01 and TIME-01/TIME-02 retain the
remaining device, browser and clock precision acceptance.

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
