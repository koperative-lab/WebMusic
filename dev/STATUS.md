# Implementation status and open work

> Historical integration baseline: reviewed main `74699f7` plus original main work `7340408` (2026-09-09). Product direction is accepted in [PRODUCT](PRODUCT.md) and [DECISIONS](DECISIONS.md). This file owns current work and verification gaps; historical plans and audit snapshots do not.

## First-release boundary

`main` contains Kernel, UI Kit and Score. Audio and Bridge source, tests, public
references and demos are outside the first release. At the 2026-09-25 repository
review, the new repository's published `dev` branch did not yet contain their
workspaces or references. The accepted design is retained here; a source and
documentation migration needs its own tracked branch state and verification.
UI Kit remains the independent presenter dependency for Score visual
integrations. The branch split alone does not establish npm publication. The
[split record](log/2026-09-10-first-release-split.md) records the local checks,
production dependency audit and fresh external consumer validation.

Cross-domain loop acceptance (TIME-02) and the Score/Audio compositions (APP-01)
remain open design and verification work. Their earlier `dev` queue and evidence
retain their original package scope; they do not imply those packages have been
delivered in this repository.

## Checkout profile

This checkout combines the reviewed Score Analyze/View/Play changes with the
original main work on shared playback sources, command authority and documentation
navigation. The [workflow log](log/2026-09-09-score-review-workflow.md)
records the review sequence and an Audio starting brief; it does not establish
Audio review or browser/device acceptance.

- Analyze retains five live musical surfaces. Whole-score report algorithms
  remain API/Headless capabilities; obsolete report/omnibus tags are removed.
- View uses `score-view` types, `pitch-view` types and separate `sheet-view`
  page engraving. Staff views project written Score notation through VexFlow,
  preserving source rhythm, staff structure, timed clefs and supported expressions; remaining
  engraving and verification limits stay in the queue below.
- Native Score players expose the shared core playback-source contract for
  Analyze, ScoreView and optional Headless ScoreView attachment. PitchView borrows
  held notes. Controller/Rack single-score data and shared-instance clock
  injection remain separate work.
- Play keeps five interactive roles and nonvisual `rack-part`, with the existing
  `simple-score-player` compatibility tag over canonical `score-player`.
  Scheduler, capture/source and graph replacement regressions are retained
  alongside main's Rack effects, Synth configuration and factory cleanup.
- UIKit responsive changes and demo Parameters are integrated with main's
  surface styling and lifecycle helpers. Play source/DOM evidence does not
  establish final browser layout, touch, audible timing or device acceptance.

## How to read status

“Implemented” means a source path exists and its stated behavior was inspected. “Verified” names the checks or environment used. “Accepted target” states intended behavior that still requires design or implementation. An automated check is not proof of real audio, device, browser, remote publication, or complete API documentation.

The current public surface is generated in [COMPONENTS](COMPONENTS.md); documentation coverage is mapped in [DOCUMENTATION-MAP](DOCUMENTATION-MAP.md). Versions and dependency ranges belong to manifests, not a copied status table.

## Capability readiness

| Area | Current evidence | Boundary |
|---|---|---|
| Models, APIs, Headless, Elements, UI presenters | Three release package workspaces, explicit public exports and element/presenter catalogs | Entry-specific environments and optional dependencies still apply |
| Interaction and visual customization | UI bindings, presenter-owned resources/styles, public tokens and handles, composed Elements | Device, accessibility, and browser acceptance are not implied by unit tests |
| Analyze/View attachment to Play | Score core source contract, native Headless/Element `.playback`, borrowed Score data and snapshots in Analyze/ScoreView, optional Headless ScoreView binding | Controller/Rack single-score data remains unavailable; legacy event targets retain partial capabilities. PitchView follows held-note sources; readout/log tags and chord preview remain targets in [Player binding](design/PLAYER-BINDING.md) |
| Documentation organization | Product/design/decision/architecture owners, generated component/file indexes, four page templates, archived history, and a source-based pass across all Headless reference leaves | Semantic review, automated coverage, and demo/browser acceptance remain distinct; see the open checks below |
| Prior runtime repairs | [Repair record](audits/2026-09-05/FIXES.md): 197 test files / 2,205 tests, full check and docs build on local Node 22 | This is dated evidence; it is not a new Node 24/device/external-install result |

## Current work queue

| ID | Work and state | Acceptance | Owning reference |
|---|---|---|---|
| REPO-01 | Audio and Bridge design is retained, but their source, tests and public references were absent from this repository's published `dev` branch at the 2026-09-25 review | Migrate the relevant work on a tracked branch, reconcile with current Kernel/Score/UI contracts, verify package policies and actual public APIs, then update branch-specific status and links | [Product](PRODUCT.md), [Architecture](ARCHITECTURE.md), DEC-021 |
| TIME-01 | Group command authority, revisioned observation and participant re-entry are implemented; same-instance clock injection remains open | Specify/verify engine consumption of one shared anchor if introducing injection; preserve the existing command outcome, cancellation and participant ownership guarantees | [Shared-clock design](../platform/shared-clock-injection.md), DEC-018 |
| BIND-01 | Native Score data/state attachment is implemented; external controller/Rack and legacy event capabilities remain partial | Extend only explicitly supported source/part/activity capabilities; preserve readiness, source identity and borrowed lifetimes. Do not invent a single Score for a multi-source owner | [Player binding design](design/PLAYER-BINDING.md), DEC-011 and DEC-017 |
| BIND-02 | Readout/log tags and scored-chord preview remain targets; retained PitchView supports player/source binding | Resolve the spec's open member/unit choices; implement the supported modes, part/note identity and bounded logs; align public entries, presenters, catalogs, references and accessible demos | Player binding design and component/page templates |
| PLAY-01 | Algorithm/lifecycle and responsive UIKit/source changes implemented; external-theme browser checks recorded | Styling checks cover transparent surfaces, colors, radii, narrow/wide computed geometry and transport keyboard focus. Complete rendered-state, touch and device acceptance remains; measure suspend/resume and MIDI behavior separately | [Play design](design/PLAY-COMPONENTS.md), [implementation audit](audits/2026-09-09/SCORE-PLAY.md), [frontend source audit](audits/2026-09-09/SCORE-PLAY-FRONTEND.md), [styling review](audits/2026-09-10/SCORE-STYLING.md) |
| VIEW-01 | Written-time projection and VexFlow replace the quantized staffrender path. Timed Part clefs/directions, source tuplet visibility, no-source clef inference and independent slur/tie geometry are implemented. The ten-page, 107-measure PDF review also led to full-Part slur pairing, articulation/barline/rest-position preservation and compact ink packing; final automated and Chrome results are recorded in the contract | Cross-staff/cross-measure beams, nested tuplets, complete grace/expression/font fidelity, per-articulation placement, credits/labels and page/editor layout remain bounded or unsupported. The cross-staff curve collision solver is bounded and does not establish complete engraving parity. Complete cross-browser/accessibility acceptance, including keyboard access; MIDI notation remains inferred. Do not claim full MuseScore parity | [Staff notation contract and acceptance](design/STAFF-NOTATION.md#acceptance), [PDF coverage](design/STAFF-NOTATION.md#pdf-comparison), [ScoreView notation limits](../apps/doc/webmusic/src/content/docs/score/element/view/score-view.mdx), DEC-024 |
| CHORDIO-01 | Atomic Analyze surfaces and explicit pitch-view siblings are implemented; browser/audio acceptance remains | Validate layout, keyboard/pointer interaction, two or more companions, source replacement and audible non-unit-rate navigation against actual contracts | [Analyze component design](design/ANALYZE-COMPONENTS.md), owning Element pages |
| ANALYZE-01 | Deterministic regression cases cover key-profile rotations, triads and inference boundaries; empirical musical accuracy remains unmeasured | Evaluate an annotated real-music corpus with declared genres, ground truth, metrics and ambiguity policy before claiming accuracy percentages or calibrated confidence | [Score Headless review](audits/2026-09-10/SCORE-HEADLESS.md), [Analyze algorithm record](audits/2026-09-10/SCORE-HEADLESS-ANALYZE.md) |
| ANALYZE-02 | Score-based analysis reads written Note pitches and ignores Part.transpose; mixed transposing-instrument harmony and cross-part voice results are not reliable concert-pitch analysis | Establish written/concert pitch-basis contracts and one normalization path across stateless algorithms, incremental caches, workers and projections. Preserve source IDs/notation, define spelling, avoid double transposition, and verify piano/B♭ clarinet chord and parallel-fifth fixtures | [API transposition finding](audits/2026-09-10/SCORE-API.md#open-transposing-instrument-contract), [public pitch basis](../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx#pitch-basis-and-transposing-instruments) |
| SCOREIO-01 | MIDI/MusicXML/ABC/MXL correctness repairs cover supported format subsets; full interchange and navigation fidelity remain limited | Define and test supported complex features before expansion: SMPTE timing, richer ABC syntax, cross-measure notation splitting and nested/alternative repeat routing. Preserve documented unsupported-input errors and lossy boundaries | [Score API review](audits/2026-09-10/SCORE-API.md), [IO detail](audits/2026-09-10/SCORE-API-IO.md), [repeat contracts](audits/2026-09-10/SCORE-API-MODEL.md) |
| DOC-02 | Headless demo/control catalog coverage remains partial; authored Related navigation is now the supported reference path | Implement missing object demos and catalog controls where meaningful, or document the input/environment needed to demonstrate them; validate options, commands, state, events, reset and cleanup against the authoring contract | [Headless template](docs/HEADLESS-PAGE-TEMPLATE.md) and source catalogs |
| DOC-04 | Public API and Headless completeness checks are narrower than the templates | Check actual member/reference ownership, types and target content where mechanical; retain manual review for semantics | Conventions and page templates |
| DOC-05 | Element/Headless/API page-shape and demo layout enforcement is incomplete | Define accepted exceptions, enforce applicable order/count rules, and align page-specific demo placement without breaking working demos | [Site plan](docs/DOCS-SITE-PLAN.md) |
| DOC-06 | The family start pages and the two form inventories are in place; `checkLinks` now rejects a repository link that only resolves through a redirect, but no check constrains the title or section shape of the two inventories, and the retired capability-Overview title rule was not replaced | Decide whether the inventories need a title/section-shape rule of their own, and whether the family element inventory's per-capability sections should be asserted the way its absence of demos already is | [Site plan](docs/DOCS-SITE-PLAN.md), [Conventions](docs/DOCS-CONVENTIONS.md), DEC-020 |
| VERIFY-01 | The full checkout check passes on Node 24.21.0 (2026-09-11). Kernel clean installs/builds/tests on Node 22/24, real Chrome worker/lifecycle smoke and external tarball imports/types are recorded. Broader cross-browser/audio/MIDI/microphone acceptance, background timing and accessibility remain separate | Record actual environment, procedure and results separately; use existing external-install/release runbooks where applicable | [Kernel release review](audits/2026-09-11/KERNEL-RELEASE.md), [Development](DEVELOPMENT.md), [Publishing](release/PUBLISHING.md) |
| RELEASE-01 | The 2026-09-11 Kernel preparation passed local gates but its unauthenticated registry query returned `ENEEDAUTH` / `E404`, so that audit did not establish publication. A separate read-only `npm view` check on 2026-09-25 returned version `0.1.0` and registry tarballs for `@webmusic/kernel`, `@webmusic/ui` and `@webmusic/score`. Local `v0.1.0` still refers to an older commit; the registry result does not identify this change as published | For a future release, check package provenance, intended versions, a clean release commit, CI, registry, remotes and hosting evidence immediately before acting. Existing package versions do not establish publication of this PR or deployment of its docs | [Kernel release review](audits/2026-09-11/KERNEL-RELEASE.md), publishing and releasing runbooks |

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

## Change discipline

The [Score Headless review](audits/2026-09-10/SCORE-HEADLESS.md) records the
2026-09-10 timing, identity, numerical and lifecycle repairs across Score's
public Headless entries and their shared foundations. Its regression evidence
does not close the browser/device, engraving or empirical-analysis gaps above.

The subsequent [Score API review](audits/2026-09-10/SCORE-API.md) records exact
arithmetic, PPQ conversion, model/edit/repeat, format interchange and stateless
capability corrections on top of that Headless baseline. Public API references
describe the implemented algorithms and their representational limits; this
does not establish full notation interchange or measured musical inference accuracy.

Keep each open item here until acceptance has evidence, then link a dated record and remove it from the active queue. Historical completion descriptions stay in their dated records. New scope changes update the owning decision or contract as well as this queue; they do not silently turn a product goal into a shipped claim.
