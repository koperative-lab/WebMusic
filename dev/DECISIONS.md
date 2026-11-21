# Accepted design decisions

> Current decision register. The product direction was confirmed by the maintainer on 2026-09-05. “Accepted” describes a design choice, not implementation completion. [STATUS](STATUS.md) tracks the remaining work; source and technical contracts are linked by [Architecture](ARCHITECTURE.md).

Decision entries retain their dated wording. DEC-046 supersedes DEC-021's
three-package branch split for source integration; it does not change what was
published in the first npm release. Read [STATUS](STATUS.md) and the target
branch's tracked files before making a delivery claim.

To find a decision without reading the register in order, use the generated
[decision index](DECISION-INDEX.md). It groups every entry by topic, names the
document that owns the current rule, and lists the later decisions that cite
each entry, which is where a refinement or replacement is recorded.

## DEC-001 — A toolkit that grows from demos to music applications

**Decision:** optimize for composable musical capabilities that can support interactive demos, music software, online workstations, and artistic installations.

**Reason:** the same musical material and behavior should survive changes in scale and presentation.

**Consequence:** application concerns such as project persistence, undo, collaboration, and arrangement/session editing need explicit application-layer designs. They are not implied by the existence of a player or mixer.

**2026-10-13 refinement:** [DEC-053](#dec-053--document-owned-editing-and-borrowed-playback)
assigns optional single-document history to domain editors. Project/global
history, persistence and collaboration retain the application boundary above.

**Owner:** [Product](PRODUCT.md).

## DEC-002 — Three interoperable integration choices

**Decision:** support Web Components, Headless objects, and API + UI composition. APIs and UI may also be used independently.

**Reason:** convenience and control are both legitimate needs; choosing a custom UI should not discard the runtime.

**Consequence:** public state, commands, ownership, and events are usable without an Element. Framework adapters wrap these contracts rather than redefine them.

**Owners:** [Product](PRODUCT.md), [Component design](design/COMPONENT-DESIGN.md).

## DEC-003 — Separate musical domains and a neutral presenter layer

**Decision:** Score and Audio do not depend on each other. Kernel contains domain-neutral primitives; UI contains domain-neutral presentation. Bridge owns code that needs both families.

**Reason:** symbolic and sampled music have different models, units, dependencies, and processing needs.

**Consequence:** cross-domain assembly is explicit; adding a shared helper to kernel or UI requires a domain-neutral contract. An Element composes Headless behavior and UI directly; no mandatory extra adapter class is introduced.

**Owner:** [Architecture](ARCHITECTURE.md), including all listed policy tables.

## DEC-004 — One authoritative transport timeline per musical session

**Decision:** participants that perform together follow one session time authority. Musical positions and audio samples map to its timeline explicitly. Independent sessions may remain independent.

**Reason:** playback, recording, analysis followers, and visual projections must agree after time mutations.

**Consequence:** shared AudioContext time alone is insufficient. Sharing a TransportClock instance requires explicit mutation authority and invalidation/re-arm semantics for future scheduled work. The direction is accepted; the concrete protocol and migration still require technical decisions and implementation.

**Owners:** [Architecture](ARCHITECTURE.md), [Shared-clock design](../platform/shared-clock-injection.md). Current readiness: STATUS.

## DEC-005 — Conversion declares information loss and assumptions

**Decision:** Bridge connects domains through named operations, not an implicit claim of lossless equivalence.

**Reason:** rendering chooses a sound realization; transcription estimates notes and timing from audio.

**Consequence:** document units, offsets, tempo/BeatGrid assumptions, sample rate, engine requirements, and what is inferred or lost. Keep family-neutral note events in Audio and Score construction in Bridge.

**Owner:** [Bridge](../bridges/score-audio/README.md).

## DEC-006 — Reuse through explicit resource ports

**Decision:** integrate existing formats, engines, timbres, renderers, algorithms, workers, and external inputs through explicit interfaces and optional capabilities.

**Reason:** the toolkit should compose existing resources without forcing every application to install every engine.

**Consequence:** distinguish install-time optionality, static entry requirements, runtime capabilities, and licensing/resource costs. Report unavailable features through declared failure paths; do not silently reinterpret data.

**Owners:** [Architecture](ARCHITECTURE.md), package integration references.

## DEC-007 — State and resource ownership are reviewable contracts

**Decision:** each state value and resource has an explicit owner. Borrowed resources are retained by their owner; created resources have a cleanup path.

**Reason:** composition, asynchronous operations, and repeated mounting otherwise produce duplicate state, stale starts, and leaks.

**Consequence:** designs cover cancellation, late results, reentrancy, partial failure, and disposal as well as successful playback. A presenter owns its DOM and subscriptions, not the bound music engine.

**Owner:** [Component design](design/COMPONENT-DESIGN.md); concrete lifecycle contracts live with each capability.

## DEC-008 — Reusable behavior with replaceable visual expression

**Decision:** ship usable presenter defaults and expose stable styling/interaction seams, while allowing custom surfaces and entire replacement UIs.

**Reason:** dense music software and expressive installations can share behavior while looking different.

**Consequence:** public tokens, parts, and named node accessors are deliberate APIs. Private selectors and DOM order are not. Styling choices preserve interaction semantics; accessibility is included in acceptance.

**Owner:** [Design principles](DESIGN-PRINCIPLES.md), with package-specific mechanics in the UI reference.

## DEC-009 — Add components for distinct contracts

**Decision:** a new public component must provide a distinct task, data/lifecycle contract, or reusable interaction. Fixed configurations and compositions can remain examples or modes.

**Reason:** a large inventory of near-identical tags increases choice and maintenance cost without increasing capability.

**Consequence:** a declaration or companion may share one workflow page while retaining an explicit catalog entry. Historical expansion plans record options and rejections, not a target count to rebuild.

**Owner:** [Component design](design/COMPONENT-DESIGN.md), page ownership in [Site plan](docs/DOCS-SITE-PLAN.md).

## DEC-010 — Documentation has explicit owners and derived inventories

**Decision:** separate current intent, implementation status, public reference, contributor workflow, and historical evidence. Generate inventories from the files and catalogs they describe.

**Reason:** multiple hand-maintained copies of counts, completion states, and rules already drifted.

**Consequence:** STATUS is the current work list; historical reports link forward. Template rules map to named checks or manual acceptance. A green check proves only its documented scope.

**Organization update (2026-09-09):** repository-wide guidance lives under
`dev/`, with component design, documentation authoring and release operations in
their own directories. AGENTS and its tool-specific symlink route through maintained
directory indexes. Package/platform contracts remain beside source; archived
release machinery remains beside its historical scripts. Generated inventories
provide discovery without substituting for these reading routes.

**Organization update (2026-09-25):** `AGENTS.md` is the sole maintained agent
instruction entry point. The earlier tool-specific instruction symlink is retired; current
guidance and generated inventories no longer require it.

**Owner:** [Documentation entry point](README.md), [Conventions](docs/DOCS-CONVENTIONS.md).

## DEC-011 — Analyze and View can borrow a player's data and state

**Date / status:** 2026-09-06; accepted composition direction. Concrete new
members and unresolved options remain design work, not published APIs.

**Problem:** attaching companion components currently exposes inconsistent
event and data bindings, requiring application glue or repeated data inputs.

**Decision:** playback-connected Analyze and View may bind to Play as the source
of loaded data, current state, and authoritative playback position. The same
behavior must be composable through Web Components, Headless, and API + UI.
Data-only operation remains available where appropriate.

**Alternatives considered:** requiring repeated `src` inputs for every companion;
embedding all readouts and analysis inside the player; or creating a player per
view. These obscure data ownership, constrain layout, or duplicate playback state.

**Consequences:** companions borrow resources and subscribe to current state and
changes; they do not create another transport. Interactive companions delegate
authorized commands to the owner. Preserve the capability dependency rules through
structural contracts and explicit composition. This binding is distinct from
cross-domain shared-clock injection and does not require that protocol to ship first.

**2026-11-06 refinement:** under [DEC-068](#dec-068--modular-composition-is-the-only-composition-model), companions borrow through the Kernel `source` and `transport` port families, by containment or `input`; the `player=` attribute is retired. Borrowing semantics are unchanged: no second transport, delegated commands and data-only operation.

**Owner:** [Player binding design](design/PLAYER-BINDING.md), including the maintainer's
target markup and unresolved contract choices. STATUS owns delivery gaps.

**Verification implications:** cover initial attachment, data readiness and
replacement, pause/seek/rate/loop, note identity, multiple companions, rebind and
cleanup with actual supported player modes. Public examples must continue to use
implemented members until the corresponding contract ships.

## DEC-012 — Atomic musical surfaces with explicit sibling composition

The initial tag inventory below is narrowed by DEC-014; its composition rule remains in effect.

**Date / status:** 2026-09-08; accepted and implemented, browser acceptance pending.

**Problem:** moving a workbench into several differently named tags still leaves
keyboards, staffs, fretboards and settings inside each analysis. The application
cannot independently compose or reuse those surfaces.

**Decision:** every Analyze component owns one core musical surface. Key, chord,
Roman, motif and voice-leading lanes stay separate; live chord naming is only a
nameplate. Key wheels, candidate rankings, pitch evidence and chord history have
their own Analyze tags. Reusable keyboard, current-staff, fretboard and whole-score
views are explicit siblings bound to the same player.

Display configuration belongs to each tag's attributes and application-owned
controls. Each Analyze tag-owned live demo pairs one player with that component;
optional supporting views belong to separate composition examples. External
Parameters configure displayed elements and can set native `hidden` when a
composition includes optional siblings. Musical interactions, such as seeking a
chord or selecting an alternate interpretation, stay with the surface that gives
them meaning.

**Alternatives considered:** internally reproducing the full workbench in each
feature tag; merely hiding its dock controls; or building separate player engines.
These retain coupling, hidden computation or duplicated playback authority.

**Consequences:** reuse algorithms and lifecycle infrastructure while keeping
rendering and computation scoped to the selected surface. The `analysis-view`
name remains a type-selected single surface, but its combined-workbench UI and
`show`/`shell`/`range`/`tuning` controls are removed. Existing callers migrate
supporting displays to sibling tags. DEC-009 applies to distinct musical tasks;
DEC-011 supplies their shared data/state connection. Play retains audio ownership.

**Owner:** [Atomic Analyze and View design](design/ANALYZE-COMPONENTS.md).

**Verification implications:** exact public surfaces, one rendered core, no
internal pitch displays/settings, independent external control and visibility,
copy/reset round trips, player data/snapshot reuse, correct seek units,
evidence-unit labels, lifecycle cleanup and browser/audio acceptance.

## DEC-013 — Live Analyze Elements and Headless score reports

DEC-014 further narrows the retained live Element inventory; report ownership is unchanged.

**Date / status:** 2026-09-08; accepted.

**Problem:** whole-score summary cards, histograms and rhythmic vocabularies
remain reports even when decorated with a playback cursor or occurrence link.
They crowd the Analyze Element collection with interfaces whose main result
does not develop during a performance.

**Decision:** Score Analyze Elements present playback position, current notes or
accumulating performance evidence. Remove `score-analysis`,
`analysis-histogram` and `rhythm-patterns`, including their individual
registration helpers and the former `defineScoreAnalysisElements` pair helper.
Keep `createScoreReport` in Headless and `distributions`/`rhythmPatterns` in
the Analyze API; document their custom report workflow under Headless.

Player-bound key wheels, candidate rankings and pitch evidence consume actual
note activity. Waiting and reset states do not substitute full-score statistics.
Their existing explicit standalone inputs remain available without a player.
The score-following analysis lanes and timeline retain musical navigation.

**Consequences:** this refines DEC-012's atomic surface rule. Report logic and
neutral UI presenters remain reusable without retaining report custom elements.
Old report URLs redirect to the Headless workflow. Tag-owned live demos continue
to contain only their player and current component, configured by Parameters.

**Owner:** [Analyze component design](design/ANALYZE-COMPONENTS.md) and the
[Score report reference](../doc/src/content/docs/score/api/analyze.mdx#reports).

**Verification implications:** retired tags are absent from exports,
registration, catalogs and navigation; retained live evidence updates from note
events and clears appropriately; report APIs, demos and redirects remain usable.

## DEC-014 — Five task-specific Analyze Elements

DEC-038 supersedes this five-tag Element inventory; its distinction between
task-specific surfaces and code-only specialist algorithms remains relevant.

**Date / status:** 2026-09-08; accepted.

**Problem:** even after reports moved out of Elements, diagnostic rankings,
pitch evidence, secondary visualizations and generic aliases made the collection
hard to choose from. Atomic rendering alone does not justify a public tag.

**Decision:** retain five distinct performance and practice tasks:

| Element | Task |
|---|---|
| `chord-analysis` | Follow and navigate a score's chord progression |
| `live-chord-analysis` | Name the sounding chord and inspect alternate readings |
| `key-analysis` | Follow and navigate score key changes |
| `roman-analysis` | Read harmonic degrees and function in context |
| `voice-leading-analysis` | Inspect voice contours and navigate issues |

Remove `key-candidates`, `pitch-evidence`, `key-wheel`, `chord-history`,
`motif-analysis`, `analysis-view` and `analysis-timeline`, their classes,
registration helpers, demos and catalog entries. Prune their private Element
rendering and state paths. Do not recreate them as modes inside retained tags.
Headless/API algorithms and neutral presenters remain available. The removed
history wrapper does not imply a new Headless history factory.

**Alternatives considered:** hiding tags only in navigation would retain their
maintenance and selection cost. Merging every display into one configurable
Element would reverse DEC-012. Keeping separate current-chord and progression
tags is deliberate: one accepts note activity, the other supplies score context
and seeking. Key changes and Roman harmonic function also answer different tasks.
Voice-leading preserves the explicitly requested voice-inspection use case.

**Consequences:** this supersedes the inventories in DEC-012 and DEC-013 while
preserving their one-surface, external-Parameters and explicit-composition rules.
There is no note-only key-diagnostic Element; custom callers can use
`createLiveKeyTracker`. Former generic Element users choose the relevant fixed
tag. Old URLs redirect to the appropriate retained or Headless/API reference.

**Owner:** [Analyze component design](design/ANALYZE-COMPONENTS.md) and the
[Analyze Element reference](../doc/src/content/docs/score/element/index.mdx#analyze).

**Verification implications:** assert exactly five registrations and public
classes, preserve underlying Headless/API capabilities, migrate shared lifecycle
and seek regressions to retained tags, and verify the five isolated player-bound
demos, external Parameters, reset behavior and redirects.

## DEC-015 — Type-selected Score View families

**Date / status:** 2026-09-08; accepted.

**2026-10-13 extension:** [DEC-053](#dec-053--document-owned-editing-and-borrowed-playback)
adds optional document-bound editing and focused keyboard interaction to existing
View surfaces. The original passive usage below remains valid; runtime editing
is implemented, and STATUS EDIT-01 tracks its remaining verification.

**2026-11-04 refinement:** [DEC-056](#dec-056--score-view-draws-three-types-annotations-only-on-staff)
removes the `map` and `thumbnail` types below and limits score annotations to
`staff`. The three-family structure and the remaining type-switch guarantees
are unchanged.

**Problem:** separate tags for keyboard, current-note staff and fretboard repeat
one held-note input contract. Separate map and thumbnail tags repeat Score input
and loading, making the View catalog and composition examples harder to choose.

**Decision:** retain three View Elements. `score-view` selects `piano-roll`,
`staff`, `waterfall`, `map` or `thumbnail`; `pitch-view` selects `keyboard`,
`staff` or `fretboard`; `sheet-view` keeps its independent optional OSMD engraving
contract. Each instance renders only its selected type, and applications use
sibling instances to show several representations simultaneously. Parameters
controls type and presents only relevant options outside the component.

Type switches preserve resolved data and borrowed player state. Pitch types
share one held-note tracker; map and thumbnail do not instantiate a full
playback visualizer. Thumbnail stays a passive preview. Map borrows the same
native Score and nominal timeline as other score types and converts seek units
explicitly. No type owns a player, synth or musical clock.

**Alternatives considered:** retaining aliases would keep the redundant public
inventory. Combining every View into one tag would mix note activity with whole
Score input and optional engraving resources. Keeping map and thumbnail separate
would duplicate source loading and require separate player-binding fixes.

**Consequences:** remove the five old View tags and their class/registration
exports; redirect old pages to the retained families and document type migration.
The underlying API/Headless/render helpers remain. This refines DEC-012's View
inventory while preserving its explicit sibling composition and external control
rules; DEC-014's five Analyze tasks remain unchanged.

Responsive presentation preserves readable musical geometry inside a
shrinkable host. Reuse UIKit's scrolling pitch surfaces and Stage minimum
drawing width; settings must not reload borrowed data. Waterfall's Element
injects the shared keyboard through a structural render port, while the
explicit render entry retains its independent fallback and has no static UI
dependency. Source and owning references define the port and styling options.

**Owner:** [View component families](design/VIEW-COMPONENTS.md) and the
[View reference](../doc/src/content/docs/score/element/index.mdx#view).

**Verification implications:** exact registrations/exports; source and note
identity across type switches; no duplicate borrowed subscriptions; cheap
thumbnail/map paths; non-unit-rate and failed map seeks; responsive rendering;
conditional Parameters, Copy/Reset and old-route migration.

## DEC-016 — Play roles share transport behavior without merging unrelated tasks

**Date / status:** 2026-09-09; accepted.

**Problem:** Play's transport already accepts Score, Rack and borrowed controller,
but its imperative methods and documentation did not consistently reflect those
modes. A raw tag count obscures the separate role of a nonvisual declaration.

**Decision:** retain the five interactive roles `score-player`,
`rack-control`, `note-input`, `score-recorder` and `synth-panel`, plus nonvisual
`rack-part`. Reuse existing layout/section options and one player facade family.
Expose live readback and fraction seeking through each built-in handle, keeping
optional members for custom legacy handles. Rack uses its existing member
transport axis; nominal single-score seeking explicitly rejects there.

Preserve authored composition across player mode switches, use one authoritative
owner for input/recording state, and preserve Synth Panel route ports for
same-context DSP replacement. UI configuration remains external. No new tag,
shared-clock implementation or Rack companion snapshot is implied.

**Alternatives considered:** a player `type` combining mixing, input, recording
and synthesis would mix different inputs, clocks and resource owners. Additional
transport aliases would repeat the same command adapters. Retaining silent Rack
no-op methods would leave imperative and presenter behavior inconsistent.

**Consequences:** existing tag names remain stable. Callers using Rack nominal
seek must choose transport seconds or a fraction. Stable DSP ports avoid
reconnecting application routing after every same-context section edit; context
replacement still requires reconnecting. Frontend and real-device acceptance
remain distinct follow-up work.

**Main integration clarification:** retain the existing `score-player`
canonical entry and `simple-score-player` compatibility constructor/tag over
one implementation. Retain main's published Synth dry-bypass contract: with a
context, input/output ports remain available and stable even when no DSP section
is active. This preserves existing application routes while adding the reviewed
replacement and rollback guarantees. The earlier feature audit's dormant-port
behavior is historical evidence, not the integrated public contract.

**2026-11-06 refinement:** under [DEC-068](#dec-068--modular-composition-is-the-only-composition-model), the roles remain as module roles — `score-player` is a Source and, when outermost, the Session provider; `score-rack-control` a Rack; `score-rack-part` a Source; `score-note-input` a note Source; `score-recorder` a note sink producing a source; `score-synth-panel` a control view or processor. Rack member-axis seek becomes Session-seconds seek on the Session provider.

**Owner:** [Play component design](design/PLAY-COMPONENTS.md) and the
[Play Element reference](../doc/src/content/docs/score/element/index.mdx#play).

**Verification implications:** exercise actual engine failures, source/descriptor
replacement, callback reentrancy, suspended audio clocks and external connection
identity. Check exact mode capabilities and borrowed cleanup without claiming
sample-accurate group synchronization from unit tests.

The following decisions were integrated from the original main draft snapshot
`7340408`. That snapshot used DEC-013–DEC-016 for these contracts; they are
registered here as DEC-017–DEC-020 to preserve the reviewed Score decisions
already on main. Dated evidence keeps its original identifiers and states this
mapping explicitly.

## DEC-017 — Shared nonvisual playback attachment

**Date / status:** 2026-09-08; accepted. Checkout-specific delivery belongs to STATUS.

**Problem:** event-only connections omit initial state, resolved source data and
note occurrence identity. Repeating structural contracts in every Element makes
Headless composition and source replacement inconsistent.

**Decision:** place the Score playback-source contract in Score's shared core,
exported through its existing model entry. Play produces it; Analyze and View
consume it without importing Play. It exposes coherent snapshots and subscription,
source revision/readiness, explicit position units, note occurrences and optional
commands. DOM `player` selectors resolve this nonvisual connection.

**Alternatives considered:** importing sibling engines, putting Score models in
Kernel, or requiring every consumer to reconstruct state from DOM events.

**Consequences:** independent engines and domain boundaries remain intact. A
consumer requests only available capabilities. Native player data is borrowed;
explicit local data remains a separate, documented source choice. Compatibility
event sources remain usable with explicitly narrower guarantees.

**2026-11-06 refinement:** under [DEC-068](#dec-068--modular-composition-is-the-only-composition-model), the Score playback source stays in Score core as the payload of the Kernel `source` port (schema `webmusic.score`). DOM `player` selectors are replaced by `input` and containment; compatibility event sources are retired.

**Owner:** [Player binding](design/PLAYER-BINDING.md) and Architecture.

**Verification implications:** initial/reentrant subscription, late attachment,
source replacement, non-unit-rate seek, equal-pitch polyphony, unavailable data,
and teardown must be covered through public contracts.

## DEC-018 — Observable transport commands on a stable position axis

**Date / status:** 2026-09-08; accepted. Checkout-specific delivery belongs to STATUS.

**Problem:** a shared clock reader cannot invalidate previously scheduled sound;
ambiguous seconds and fire-and-forget commands can leave views reporting a
position that playback did not accept.

**Decision:** evolve the existing TransportGroup authority with revisioned command
outcomes and coherent snapshots. New position/seek contracts use the declared
content axis independent of playback rate. Participant mappings distinguish that
axis from local content position, audio reference time and loop phase. Existing
command methods remain compatibility surfaces over the same authority.

**Alternatives considered:** a globally shared writable clock, a separate Session
class in every domain, or rate conversion independently implemented by every view.

**Consequences:** successful, superseded and failed work are distinguishable;
participants cancel and re-arm through their actual scheduling capabilities.
Affine mapping remains a useful default, while arbitrary warping and precise
independent loop scheduling require separate contracts and evidence. The protocol
does not imply shared-instance clock injection or sample-accurate sound.

**2026-11-06 refinement:** under [DEC-068](#dec-068--modular-composition-is-the-only-composition-model), commands and outcomes are exposed through the Kernel `transport` port over the Session. `TransportGroup` becomes a Session internal and Kernel's `/sync` entry is no longer public; player command methods delegate to the transport port.

**Owner:** [Shared-clock design](../platform/shared-clock-injection.md), Kernel
transport/synchronization and Bridge references.

**Verification implications:** command ordering, reentrancy, preparation failure,
replacement, participant rate/offset mapping and two independent groups must be
verified; audible precision remains a measured acceptance boundary.

## DEC-019 — Compositions demonstrate the toolkit; modes have explicit contracts

**Date / status:** 2026-09-08; accepted. Checkout-specific delivery belongs to STATUS.

**Problem:** a full application shell can become the only reusable surface, while
permissive mode option bags hide unsupported configuration and introductory pages
expose architecture choices before a dependable musical result.

**Decision:** support Chordio and MVMNT experiences as compositions of reusable
musical behavior and presentation. Preserve convenient complete presets, while
allowing their constituent capabilities to be used independently. New programmatic
mode configuration selects the mode and compatible options together and reports
invalid combinations. Beginner routes first provide a runnable audible task;
subsequent examples show the same task at different integration depths.

**Alternatives considered:** a universal workbench as every application's layout,
a tag for each visual variation, and silently ignored programmatic options.

**Consequences:** existing permissive APIs may remain migration surfaces. Distinct
tasks/lifetimes justify separate components; counts and directory symmetry do not.
The reference application proves shared contracts through source replacement,
late followers, seek/rate/loop and cleanup before further primitive expansion.

**Owner:** [Component design](design/COMPONENT-DESIGN.md), [Product](PRODUCT.md),
[Site plan](docs/DOCS-SITE-PLAN.md) and each capability's public reference.

**Verification implications:** mode validation must preserve the current view on
failure. Reference examples must exercise real resources, user gestures and
teardown; documented limitations stay visible.

## DEC-020 — One page per family start, and one inventory per form

**Date / status:** 2026-09-08; accepted. Checkout-specific delivery belongs to STATUS.

The Score family page's walkthrough responsibility is refined by DEC-022 below;
the single family route and form-inventory decisions remain in effect.

**Problem:** a reader arriving at a family met two orientation pages before any
runnable result — a scope Overview and a separate Getting Started — and then met a
third Overview inside every capability group. Nine navigation pages per family
described the same nineteen owning pages. The split also forced each capability
Overview to restate the group's registration and theming, so a shared rule was
maintained in three places per family and could disagree with itself.

**Decision:** the family route `/<family>/` owns scope, the capability table, full
installation and the progressive walkthrough as one page. Each form keeps exactly
one inventory for the whole family — `/<family>/element/` for tags, registration
and shared theming, `/<family>/headless/` for export ownership — each with a
section per capability. A capability group expands directly to the pages that own
an element or an object; it has no Overview leaf, matching the rule UI presenter
classes already followed. Removed routes redirect to the surviving inventory, and
older redirects that targeted them were repointed rather than chained.

**Alternatives considered:** hiding the capability Overviews from the sidebar while
leaving the pages and their duplication in place; keeping the Overviews and
deleting only Getting Started; and distributing every export name onto its leaf
page with no inventory at all, which would have removed the completeness check.

**Consequences:** the Headless export table is the completeness check at family
level rather than capability level, and `check:docs` reads the family inventory
together with the capability's object pages. The two inventories stay hidden from
the sidebar, so the family page and the API pages are responsible for linking
them; a form inventory that nothing links becomes unreachable. Bridge keeps its
own Overview shape, because a single-entry package has no capability groups to
collapse.

**Owner:** [Site plan](docs/DOCS-SITE-PLAN.md), [Conventions](docs/DOCS-CONVENTIONS.md) and
the three page templates.

**Verification implications:** `checkCapabilityGroups` now rejects a capability
`index.mdx` instead of requiring one, and asserts the family element inventory
exists and carries no demo. The capability-Overview title rule is gone, and with
it the only machine check on those titles. A static redirect drops the URL
fragment, so an anchored inbound link must be repointed at the surviving heading
rather than left to bounce. `checkLinks` now fails a repository link that resolves
only through a redirect, so this cannot regress silently; a redirect still serves
an external bookmark.

## DEC-021 — First release contains Kernel, UI Kit and Score

**Date:** 2026-09-10. **Status:** Accepted for the first-release branch split.

**Problem:** Audio and Bridge need continued development while the initial
release concentrates on symbolic music and its shared infrastructure.

**Decision:** `main` contains Kernel, UI Kit and Score. Audio and Bridge source,
tests, public documentation and demos continue on `dev`. UI Kit remains a
separate package supporting Score Elements and visual renderers. Score retains
sound playback and its three integration choices. The long-term cross-domain
architecture remains accepted.

**Alternatives considered:** leaving deferred packages in the main workspace but
excluding only npm publication; removing UI without replacing Score's presenter
imports. Both would make the checkout disagree with its usable release surface.

**Consequences:** package policy, build order, workspace references, consumer
checks, release manifests, documentation catalogs and navigation must describe
the same three-package release. Keep dev-only Audio/UI capabilities while
integrating main fixes. Existing uncommitted Score work is preserved separately.

**Owner:** [Release policy](release/RELEASING.md), [Architecture](ARCHITECTURE.md)
and [Status](STATUS.md).

**Verification implications:** run the full check and docs build for `main`,
verify packed external-consumer imports, and validate the merged `dev` baseline
separately. Branch preparation does not publish npm packages or deploy docs.

## DEC-022 — Keep the Score overview focused on orientation and setup

**Date / status:** 2026-09-10; accepted from the maintainer's page review.

**Problem:** the Score overview repeats working examples already owned by Quick
Start and the capability references, including a live workbench above navigation.

**Decision:** `/score/` owns package scope, capability navigation, installation
and registration guidance. Remove its live workbench and capability code
walkthroughs. Quick Start owns the first composed player example; detailed usage
stays with the owning Element, Headless, API and presenter pages.

**Alternatives considered:** removing only the live widget while retaining the
long code walkthrough; keeping duplicate examples on both orientation pages.

**Consequences:** preserve installation instructions and the family/inventory
routes from DEC-020. Update inbound example links and Introduction's description
of the Score page. This is a documentation change, not a package API change.

**Owner:** [Site plan](docs/DOCS-SITE-PLAN.md).

**Verification implications:** check links and anchors, regenerate documentation
inventories, and verify the built Score page has no workbench or demo bundle.

## DEC-023 — Classify UI Kit by interaction and presentation responsibility

**Date / status:** 2026-09-10; accepted from the maintainer's UI Kit review.

**Problem:** the presenter catalog mixes value editors with generic panels and
mixes analytical readouts with render hosts, status and row navigation. The
overview also substitutes Element subclassing for the product's API + UI path,
making independent presenter use harder to discover.

**Decision:** use six functional groups: Transport and navigation, Parameters
and modulation, Mixing and capture, Note input, Views and analysis, and Layout
and feedback. Put TrackList beside transport/navigation and Panel, Stage,
Status and Workbench under layout/feedback. Preserve the independent contracts
for input versus passive pitch views, reports versus live readouts, and
snapshot, rendering and frame-pull lifecycles. Lead the overview with npm
installation and a direct mount against application-owned state.

**Alternatives considered:** preserving the five groups while changing only
labels; classifying by consuming Score Element; merging input/readout contracts
because they share a visual; creating one category for every API shape.

**Consequences:** npm subpaths remain unchanged. Keep existing category URL
segments when only their label changes; redirect moved page routes and update
all maintained inbound links. Catalog composition details are secondary to
choosing a presenter. A behavior-only Element has no applicable presenter,
and a presenter without a current Element consumer remains independently usable.

**Owner:** [Site plan](docs/DOCS-SITE-PLAN.md), the presenter catalog, the
classification policy and the UI package reference.

**Verification implications:** reconcile catalog membership, sidebar labels,
public pages, redirects and generated inventories; check the direct npm example
against public declarations. Layout categories do not establish uniform
rendering or accessibility; verify those against each entry's actual contract.

## DEC-024 — Engrave scrolling staff notation from written Score data

**Date / status:** 2026-09-11; accepted from the maintainer's staff-notation review.

**Problem:** the staffrender adapter receives pitch and quantized timing after
written duration, rests, voice relationships and clefs have been discarded.
Triplet eighths appear as individual flags with incorrect values, and authored
clefs and changing measure boundaries cannot be reproduced from that input.

**Decision:** keep `<score-view type="staff">` and its existing renderer API,
but project the original Score's written notes and measure grid separately from
the sounding-note sequence. Preserve notation metadata in the model and I/O.
Implement meter/voice-aware beam grouping in View core and use MIT-licensed
VexFlow 4.2.5 on the browser `/render` path for SVG glyphs and beam geometry.
Use the inspected MuseScore rules as a behavioral reference, with independent
implementation and tests. No MuseScore source is included in WebMusic.

**Alternatives considered:** adding beams over staffrender's quantized glyphs
would preserve incorrect durations and clefs; making OSMD mandatory would change
the optional page-engraving lifecycle; translating MuseScore's engraving engine
would introduce a different implementation and licensing scope.

**Consequences:** written rational time and source identity remain authoritative;
playback still uses the borrowed nominal timeline. No new Element option or
clock is introduced. Staff spacing becomes notation-aware, so explicit rhythmic
spacing can expand to fit glyphs. `sheet-view` remains the separate optional
page-engraving surface from DEC-015. Full MuseScore layout parity, cross-staff
or cross-measure beams, nested tuplets and complete expressive engraving are
not implied by this change.

**Owner:** [Scrolling staff notation](design/STAFF-NOTATION.md),
[View component families](design/VIEW-COMPONENTS.md), Core/I/O notation contracts.

**Verification implications:** test MusicXML metadata round trips, exact written
projection, variable meters, beam groups and note identity. Check built renderer
imports, synchronous teardown, source replacement, responsive scrolling,
highlighting, themes and actual notation in the browser. Keep unsupported and
unverified behavior in STATUS and the owning public pages.

## DEC-025 — Audio Play keeps state and stable resource ports with their owners

**Date / status:** 2026-09-25; accepted for dev following the Audio Play review.

**Problem:** Audio Elements duplicated mixer state, borrowed playback data could
remain stale, and changing meter parameters destroyed caller-owned routes.
Callback reentry and queue updates also lost newer intent or current position.

**Decision:** retain the five Audio Play responsibilities. Expose readonly clip
data and an Element source-change notification; make Headless mixer snapshots
and change notifications authoritative; update playlist policy without replacing
its queue; preserve meter ports through tuning; commit readiness/state before
callbacks and invalidate stale work. Group seeking distinguishes naturally ended
members from independently paused ones. Recorder level uses multichannel mean
square; context readiness precedes capture success.

**Alternatives considered:** merging unrelated Play tasks; copying Headless
values into each Element; rebuilding resources for every parameter; adopting
Score-specific payloads or silently claiming a new shared clock/capture backend.

**Consequences:** existing tags and entry paths stay stable. Additive readback and
configuration APIs support custom UI. Invalid selection/ranges fail before
mutating working state. Existing meter scaling/decay and ScriptProcessor capture
limits remain explicit; future precision improvements require their own contract.
Main's first-release package scope is unchanged.

**Owner:** [Audio Play design](design/AUDIO-PLAY-COMPONENTS.md), the applicable
Headless/Element references and shared Kernel meter contract.

**Verification implications:** regress callback reentry, future starts, source
replacement, multiple observers, cleanup failure, queue-preserving edits, capture
resume/cancellation and stable meter routes. Device and audible timing acceptance
remain separate from source and build checks.

## DEC-026 — Audio track gestures preserve transport and viewport authority

**Date / status:** 2026-09-25; accepted for dev following the maintainer's request
for switchable DJ-style seeking and independent waveform browsing.

**Follow-up:** [DEC-027](#dec-027--centered-audible-scrubbing-borrows-a-player-session)
supersedes the position-only scrub and no-pause policy below. The original
choice and its dated verification remain available as historical context.

**Problem:** an absolute position slider cannot move a track relatively without
jumping on press; a second pointer listener would conflict with annotation and
follow. Continuous high-rate pointer seeks also cause unnecessary engine work.

**Decision:** extend the existing neutral surface slider with gesture geometry,
lifecycle, thresholded drag/click modes and cancellation. AudioView adds explicit
seek/scrub/pan/none modes, retains absolute seek as its default, and keeps annotation
priority. Audio converts stable CSS deltas to content seconds and coalesces track
commands per frame. Playback owns accepted time; viewport-only panning never seeks.
Pan suspends follow while selected; scrub suspends it during the gesture.

**Alternatives considered:** creating a second DJ component or clock; installing
competing Element pointer handlers; silently replacing default seek behavior;
pausing and resuming borrowed playback; claiming ordinary seeks implement vinyl
sound processing.

**Consequences:** configuration and accessible labels describe the actual command.
New modes are opt-in, reusable UIKit behavior remains domain-neutral, and all
cancellation/replacement paths release capture and pending presentation work.
Main's first-release package scope is unchanged.

**Owner:** [Audio View design](design/AUDIO-VIEW-COMPONENTS.md), AudioView's public
reference and the [Stage presenter](../doc/src/content/docs/uikit/layout-feedback/stage.mdx).

**Verification implications:** exercise defaults, both directions, final release,
clamps/loops, coalescing, pointer ownership, follow, annotation, mode/source/zoom
changes and disconnect. Keep browser/device and audible behavior evidence separate.

## DEC-027 — Centered audible scrubbing borrows a player session

**Date / status:** 2026-09-25; accepted for dev after the maintainer clarified
that scrub must hold the playhead at the center, pause normal playback while
held, sound forward/reverse movement at gesture speed, and restore the prior
playing/paused state on release. This supersedes DEC-026's position-only scrub
and no-pause policy; its seek/pan/none compatibility remains accepted.

**Follow-up:** [DEC-028](#dec-028--scratch-inertia-and-continuous-phase-stay-with-play)
adds continuous audio phase and release inertia. The original grain-based
implementation and its dated verification remain historical evidence.

**Problem:** repeatedly seeking a running transport gives position navigation,
but does not produce a held, centered track or audible reverse motion. A View
must not create a second audio engine or dispose a borrowed player to supply it.

**Decision:** Audio Play owns an optional scratch session over decoded PCM and
its existing gain/pan/effect route. Beginning the session suspends ordinary
playback. Signed gesture movement produces bounded forward/reverse audio grains;
normal release ends the session and restores the state captured at its start.
Cancellation ends without automatic resume. External transport commands and
source/session replacement invalidate obsolete restoration work.

Audio View borrows that capability and keeps the renderer in centered-playhead
mode whenever scrub is selected and annotation is off. The waveform/spectrogram
moves beneath the line, including blank padding at either clip boundary. The
visible-range contract reports only its intersection with real clip time.
No-PCM or legacy players without the capability retain position-only scrubbing
without a playback-state promise. Pan remains viewport-only; default seek and
click/keyboard compatibility remain intact.

**Alternatives considered:** replacing the playback engine inside View;
pretending repeated seek commands provide reverse audio; requiring every player
backend to support decoded-buffer scratching; resuming a stale or replaced
source; centering only away from clip boundaries.

**Consequences:** the optional session is explicit and owned by Play. Gesture
speed affects sample playback speed and pitch; this is not pitch-preserving
time stretching or an independently synchronized clock. Centered rendering and
the scratch capability remain reusable outside the documentation demos. The
first-release main package scope does not change.

**Owner:** [Audio View design](design/AUDIO-VIEW-COMPONENTS.md), the owning
AudioView and AudioClipPlayer public references, and the shared timeline
renderer contract.

**Verification implications:** exercise center geometry at zero/end and on short
clips, signed/silent movement, prior paused/playing states, normal release versus
cancellation, pending context readiness, external invalidation, unsupported
players, resource teardown and two concurrent views. Automated DSP/graph checks,
rendered browser evidence and audible/device acceptance remain separate.

## DEC-028 — Scratch inertia and continuous phase stay with Play

**Date / status:** 2026-09-25; accepted for dev after the maintainer reported
spectrogram flicker and requested release inertia in both track motion and sound,
with a more continuous DJ-style response. This follows DEC-027 without changing
the public scratch-session method names or the seek/pan/none defaults.

**Problem:** restarting a short audio grain at each pointer update makes pointer
cadence audible. Ending sound and motion immediately on release lacks the
requested inertia. A separate View animation would diverge from audible position,
and native scrolling can displace layers between cached spectrogram paints.

**Decision:** Audio Play retains continuous native sample phase through bounded
local PCM windows, smooth rate changes and phase-aligned crossfades. Its scratch
session owns the release transition using AudioContext time: signed velocity
converges toward the configured normal rate if previously playing, or zero if
paused. Accepted position and sound share that transition, then restore the
captured playing intent. Silent clicks and stationary releases do not fling.

`end(true)` remains pending and the session remains active during the coast.
Cancellation stops it immediately and settles the pending completion. View keeps
the borrowed handle until completion; cancellation, replacement and re-grabbing
cannot allow obsolete restoration or detach the current owner. A new session
inherits the original playing intent. Legacy/no-PCM fallback remains positional.

Spectrogram image, region and playhead layers move as one viewport. Cached ticks
retain their backing pixels, and stripe replacement preserves overlap colors.
Native scroll remains a position-mode input, not a second presentation offset.

**Alternatives considered:** View-owned easing; event-by-event grain retriggering;
whole-clip reverse copies; ending the session before its release animation;
removing virtualization or repainting every spectral tick.

**Consequences:** Play owns all audible state and release time; View stays a
borrower. Scratch speed changes pitch. Local windows and visual stripes keep
resource use bounded. This contract does not promise pitch-preserving stretching,
seamless loop scratching, physical turntable equivalence or device latency.

**Owner:** [Audio View design](design/AUDIO-VIEW-COMPONENTS.md), AudioClipPlayer's
scratch-session reference, AudioView's gesture reference and the shared
spectrogram renderer contract.

**Verification implications:** cover uninterrupted sample phase, reversals,
refills, idle braking, release motion and sound, prior playing/paused states,
stationary clicks/holds, re-grabbing, cancellation/configuration changes,
context suspension and resource cleanup. Check spectrogram layer alignment and
cached/overlap pixel stability. Preserve the prior audit and record new automated,
native-output, browser and device evidence separately.

## DEC-029 — Audio Player controls playback and Play companions attach to it

**Date / status:** 2026-09-25; accepted following the maintainer's Audio Play
composition request. Supersedes DEC-025's tag/entry stability for the player and
meter organization; its algorithm and lifecycle requirements remain applicable.

**Follow-up:** DEC-030 removes the temporary Element compatibility surface at
the maintainer's request; the composition and ownership decision remains active.

**Problem:** the clip, queue and mixer Elements each presented transport controls,
while recorder audition created another player. Metering was classified as Play
although it only observes a signal. This obscured the session command owner.

**Decision:** expose `AudioPlayer` and `audio-player` as the stable central
transport over one selected clip, queue or mix. Retain tested clip/queue/mixer
engines underneath it. Playlist and mixer attach their backend to this owner;
their linked surfaces focus on selection and mix controls. Recorder owns capture
and sends take audition to the linked player. A selector or explicit object links
companions, with late binding, replacement and identity-checked detachment.
Meter controller, PCM helpers and Element belong to View; Play never imports View.

**Alternatives considered:** renaming only the tag; copying queue and mixer
algorithms into a monolithic player; keeping multiple linked transport bars;
removing low-level standalone APIs. The selected facade keeps the distinct
resource lifetimes and current low-level integration choices.

**Consequences:** `audio-clip-player` remains a compatibility registration;
`AudioClipPlayer` remains the single-clip engine. Meter imports migrate from Play
to View. Selecting a new nonempty source pauses the previous backend; detachment alone
does not stop borrowed playback. Borrowed transports are never disposed by the facade. A mixer has no
single-clip snapshot; a queue exposes its active clip. The facade adds no clock
and makes no new sample-accurate group scheduling claim. Main Score and Agent
Toolkit remain authoritative and unchanged.

**2026-11-06 refinement:** under [DEC-068](#dec-068--modular-composition-is-the-only-composition-model), `audio-player` remains the central Source and, when outermost, the Session provider. The playlist becomes a queue source and the recorder a microphone source plus capture sink, attached by containment or `input` instead of linked selectors. The mixer is a Rack; an outermost mixer owns a Session. "Adds no clock" now means no component adds a clock beside its Session.

**Owner:** [Audio Play design](design/AUDIO-PLAY-COMPONENTS.md),
[Audio View design](design/AUDIO-VIEW-COMPONENTS.md) and the owning public pages.

**Verification implications:** cover empty/clip/queue/mix transitions, stale async
work, callback reentry, ownership on detach/reconnect, no duplicate linked
transport, recorder source handoff, meter exports, and the rendered compositions.

## DEC-030 — Audio Elements expose only their current component names

**Date / status:** 2026-09-26; accepted at the maintainer's request. Supersedes
DEC-029's temporary old-player registration policy.

**Follow-up:** DEC-031 makes AudioRecorder the canonical Element name after the
maintainer simplified the tag. Its symbols are current definitions, not aliases.

**Problem:** retaining retired Element names, aliases, styling fallbacks and
page redirects creates parallel entry points for a development migration that
has no compatibility requirement.

**Decision:** remove the `audio-clip-player` registration, its Element class,
registration function and detail aliases; use `audio-player` and AudioPlayerElement.
Remove deprecated AudioRecorderElement, defineAudioRecorderElement and
AudioRecorderRecordedDetail aliases; use their AudioClipRecorder equivalents.
Remove old player-name surface tokens and the former player/Play-meter route
redirects. Current references and demos use the canonical component names.

**Alternatives considered:** maintaining aliases indefinitely or deleting the
underlying playback engines. AudioClipPlayer, AudioPlaylist, AudioMixer and
AudioRecorder remain real nonvisual capabilities with their existing ownership
contracts. Independent component usage and structural bindings remain supported.

**Consequences:** applications using retired Element symbols or tags must adopt
the current names; no deprecated registration is shipped by Element, auto or
global entries. Meter is registered through View. Dated evidence keeps the old
names as historical context. Main Score and Toolkit behavior remain unchanged.

**Owner:** [Audio Play design](design/AUDIO-PLAY-COMPONENTS.md) and the public
Audio Element references.

**Verification implications:** exercise canonical registration and playback,
assert retired exports/registrations are absent, validate built public entries,
and compile the updated examples.

## DEC-031 — Audio Recorder uses the task name and Play layouts follow Score

**Date / status:** 2026-09-26; accepted at the maintainer's request. Updates
DEC-030's recorder naming choice without restoring compatibility aliases.

**Problem:** the clip-qualified recorder tag is unnecessarily specific, while
Audio Play demonstrations differ from Score in component gaps and host sizing.

**Decision:** name the Element `audio-recorder`, with AudioRecorderElement,
defineAudioRecorderElement and AudioRecorder detail types. Remove the previous
clip-qualified Element, source/page paths and registration. Keep recording and
player ownership unchanged. Audio Play hosts fill their parent width, shrink
inside flex/grid layouts and respect hidden. Compositions use Score's 0.5rem
component gap; AudioPlayer uses the same 0.75rem default control gap. A queue
without its own transport has no reserved space above its first row.

**Alternatives considered:** keeping both recorder names or applying corrective
widths only inside demos. The canonical Element owns sizing; demo wrappers own
component spacing and preserve complete composed markup for Copy/Reset.

**Consequences:** imports, tags, styling tokens and page links use AudioRecorder
names. Historical evidence keeps its recorded baseline. Main Score and shared UI
defaults remain authoritative; the queue spacing change affects only the option
that omits its transport.

**Owner:** [Audio Play design](design/AUDIO-PLAY-COMPONENTS.md) and public Play pages.

**Verification implications:** canonical registration and recorder lifecycle;
rendered full-width layouts and equal gaps at ordinary and narrow widths;
connected playback, selection, reset and copied composition.

## DEC-032 — Score Recorder owns an independent recording page

**Date / status:** 2026-09-26; accepted at the maintainer's request.

**Problem:** the independently usable Score Recorder was nested in Note Input's
reference and optional demo editor, making the recording task harder to discover
than its Audio counterpart.

**Decision:** `/score/element/play/score-recorder/` owns the complete
`<score-recorder>` contract and a live sibling note-input/recorder composition.
Note Input owns its input surfaces and links to that recording page. Catalogs,
Toolkit demo mappings and related references point to the standalone owner.

**Alternatives considered:** keeping the optional recorder editor under Note
Input, or duplicating its contract across both pages.

**Consequences:** this is an explicit documentation/demo exception to the main
Score reference baseline. Runtime APIs, package tests and Toolkit behavior retain
main's authority. The new demo captures through `.source` once, with separately
owned input monitoring; it releases subscriptions and monitoring on navigation.

**Owner:** [Site plan](docs/DOCS-SITE-PLAN.md),
[component page template](docs/COMPONENT-PAGE-TEMPLATE.md) and the public recorder
reference.

**Verification implications:** canonical links, page order, copied source setup,
scoped parameters, recording/playback and disposal/remount after navigation.

## DEC-033 — Analyze demos use the common component composition

**Date / status:** 2026-09-26; accepted at the maintainer's request to align all
Analyze component demos with the existing demo design.

**Problem:** Score Analyze used a different sibling gap and player height, while
Audio Analyze mixed local margins, incomplete copied compositions and repeated
per-type panels.

**Decision:** use the shared ElementPlayground and ElementComposition with one
main demo per page, full-width sibling components and a `0.5rem` gap. Keep player
geometry at its package default. Configure types and supporting runners/players
through scoped Parameters; Copy includes the complete real composition and Reset
restores its attributes and bindings. Hidden runners reserve no visible space.

**Alternatives considered:** separate CSS corrections in each page, or keeping
multiple panels that only change the component's `type`.

**Consequences:** this explicitly updates Score demo layout from main's baseline;
Score analysis algorithms and runtime APIs retain main's authority. The initial
bare-surface interpretation was corrected by DEC-034 after rendered review. Audio host sizing/native visibility
belongs to the owning Element, not corrective documentation CSS.

**Owner:** [Component page template](docs/COMPONENT-PAGE-TEMPLATE.md) and the
owning Score/Audio Analyze references.

**Verification implications:** every Analyze page at normal and narrow widths,
mode changes, real player seeking, complete copied markup, scoped Parameters,
Reset and runner result/error lifecycle.

## DEC-034 — Score Analyze owns one standard component surface

**Date / status:** 2026-09-26; accepted at the maintainer's explicit correction
that Score Analyze still lacked borders and spacing after DEC-033.

**Problem:** the demo alignment changed sibling gaps, but both the workbench
and musical presenters remained bare. The result lacked the component border,
background and interior spacing used by Score Play.

**Decision:** all five Score Analyze Elements use one outer component surface
with the shared neutral background, border, radius and equal padding defaults.
Public component/workbench surface tokens and the existing `surface` part
remain the customization contract. Inner lanes/nameplates stay unframed; bare
workbench chrome continues to omit configuration controls. Demo composition
retains full-width siblings and a `0.5rem` gap.

**Alternatives considered:** adding a frame only around documentation demos,
or independently framing each internal presenter.

**Consequences:** this is a scoped Score runtime styling and regression-test
exception to main's baseline. It supersedes DEC-033's bare-surface interpretation;
analysis algorithms, transport authority and public behavior remain as before.

**Owner:** [Analyze design](design/ANALYZE-COMPONENTS.md) and the public Score
Analyze Styling references.

**Verification implications:** inspect the actual frame/padding, not only host
width and sibling gap, on every Analyze page. Check normal/narrow containers,
single background painting, inherited themes, caller overrides, native hidden,
reconfiguration/remount, and keyboard seeking against the same framed layout.

## DEC-035 — Audio Analyze Elements are performance tasks, not clip reports

**Date / status:** 2026-09-26; accepted for the dev Audio checkout at the
maintainer's request. Browser/audio acceptance remains in STATUS.

**Problem:** the five Audio Analyze tags mostly expose a hidden offline runner,
whole-clip metrics, file facts and distributions. A playhead on the generic
timeline does not make those reports useful musical performance surfaces, and
its dependency on a second clip load splits ownership from the player.

**Decision:** publish three task-specific Analyze Elements:
`audio-onset-analysis` for attack navigation, `audio-beat-analysis` for pulse
navigation, and `audio-pitch-analysis` for current sounding fundamental. The
lanes borrow the selected player's clip, position and seek command; the pitch
surface borrows its active analyser. Each owns only its derived state,
presenter and subscriptions. Retire the five previous Audio Analyze tags and
registration helpers without aliases. Keep whole-clip key, tempo, loudness,
pitch tracks, summaries, chroma, rankings and distributions in the existing
API/Headless and application-owned UI workflow.

**Alternatives considered:** leaving static cards in Element beside new live
tags; keeping a hidden runner that loads the same URL as Play; or treating a
cursor over a complete report as sufficient performance behavior. Those
retain the wrong responsibility or duplicate data ownership.

**Consequences:** Audio Element imports, catalogs, demos and routes move to the
three tasks; old bookmarks redirect to the relevant API/Headless or new task
reference. This narrows the public Audio Element contract before release while
preserving nonvisual algorithms and worker/session entries. DEC-033's shared
demo composition still applies, but its hidden-runner Audio clause is superseded.
DEC-013/014 retain their Score-specific inventory and are not rewritten.

**Owner:** [Audio Analyze design](design/AUDIO-ANALYZE-COMPONENTS.md) and the
public [Audio Analyze API](../doc/src/content/docs/audio/api/analyze.mdx)
and Element references.

**Verification implications:** exact registration/export inventory, no hidden
runner or report tags, one live surface per task, player snapshot/source
replacement, clip-second seek and actual accepted position, late async result
invalidation, realtime pause/seek/end cleanup, standalone data use, two
followers per owner, Copy/Reset and browser/keyboard/audio acceptance.

## DEC-036 — Audio Analyze Elements are live inspection tools

**Date / status:** 2026-09-26; accepted for the dev Audio checkout. This
supersedes DEC-035's three-tag Element inventory; nonvisual analysis ownership
and the player-borrowing rule remain. Browser and device acceptance remain in
STATUS.

**Problem:** replacing static reports with onset/beat navigation lanes and a
current-pitch readout still describes analysis as event display around a player.
It does not provide the concrete listening tools needed while adjusting a
signal: measuring levels against a threshold, probing a live spectrum, or
tuning to a reference. Beat and onset positions can remain Headless/API data
and be composed with the existing audio View surface.

**Decision:** publish `audio-level-analyzer`, `audio-spectrum-analyzer` and
`audio-tuner` as the three Audio Analyze Elements. Each is one live tool over
a borrowed player analyser or explicit caller-owned analyser. Level shows
sampled RMS/sample peak/crest with threshold, freeze and peak hold. Spectrum
provides log-frequency FFT inspection, freeze and peak hold. Tuner exposes
current note, frequency and cents against a configurable A4 reference.
Retire `audio-onset-analysis`, `audio-beat-analysis` and
`audio-pitch-analysis` from Element exports/registration/catalogs/pages,
without removing their underlying Analyze API or Headless capabilities.

**Alternatives considered:** retaining the navigation lanes as extra Analyze
tags, merging all measurements into a generic dashboard, or making a passive
View meter claim the same tool responsibility. Those obscure component choice
or place inspection/calibration controls in the wrong layer.

**Consequences:** the three tools borrow graph and playback state without
creating an AudioContext, player, microphone request or separate transport.
Their visual measurements are deliberately bounded: sampled level is not
integrated LUFS or true peak, FFT magnitudes are not calibrated SPL, and a
tuner cannot prove a unique note from ambiguous audio. Static tempo, onset,
key, loudness and pitch-track data stay in API/Headless. Applications can
convert a Headless/API beat grid into point regions for `audio-view.regions`
when they need performance markers. DEC-033's one-player, one-component demo
composition still applies, without a hidden runner.

**Owner:** [Audio Analyze design](design/AUDIO-ANALYZE-COMPONENTS.md), the
[Audio Analyze Element inventory](../doc/src/content/docs/audio/element/index.mdx#analyze)
and the owning tag references.

**Verification implications:** exact public tag inventory, independent tools
sharing one owner, explicit-analyser precedence, threshold/freeze/hold/probe/A4
interaction, play/pause/seek/source replacement, graph loss and cleanup,
Copy/Reset, keyboard/focus and browser/device measurements. Use actual API
members and units in each leaf reference; a static page or test cannot certify
acoustic precision.

## DEC-037 — Audio Analyze offers five distinct live tools

**Date / status:** 2026-09-26; accepted for the dev Audio checkout. This
supersedes DEC-036's three-tag Element inventory and its exclusion of the
independent meter. The API/Headless ownership of static reports and the
player-borrowing rule remain in force. Browser and device acceptance remain in
STATUS.

**Problem:** level and spectrum inspection are useful, but a dedicated tuner is
not a broadly useful analysis surface for the intended music-software workflow.
A compact meter is still needed alongside detailed inspection, and musicians
also need to examine short waveform structure and the attack evidence of a
live signal. Neither an offline report nor another generic dashboard serves
those operational tasks.

**Decision:** publish exactly five Audio Analyze tags: `audio-meter`,
`audio-level-analyzer`, `audio-spectrum-analyzer`, `audio-oscilloscope` and
`audio-transient-analyzer`. The existing meter is a compact normalized RMS/FFT
monitor with level/spectrum mode and caller-configured scale/hold; it does not
claim the dBFS history or threshold of the level analyzer. The oscilloscope
offers a trigger-aligned time-domain window, adjustable timebase, freeze and
time/amplitude probe. The transient analyzer uses successive spectral-flux and
energy observations, sensitivity and a refractory interval to expose recent
onset cues. It does not infer BPM or a beat grid. Remove `audio-tuner` from
Element exports, registration, catalogs and current pages while retaining
nonvisual pitch analysis.

**Compatibility boundary:** `audio-meter` is canonically exported and
registered by Analyze. Existing View Element imports and auto-registration
remain valid for the same tag and underlying implementation. The Analyze
Element facade has one explicit adapter to that implementation and its existing
View meter controller; this exception does not license a general
Analyze-to-View dependency, a duplicate custom element, or a new transport.
The `audio-view type="meter"` projection remains in View.

**Alternatives considered:** retaining the tuner as a sixth tool, removing the
meter or folding it into the level analyzer, calling a passive View projection
the independent meter, or surfacing whole-clip BPM/beat-grid results as a live
transient tool. These either blur the five tasks, break the compact monitor
workflow, or overstate what a borrowed live analyser can establish.

**Consequences:** level, spectrum, oscilloscope and transient tools borrow a
player analyser or explicit caller-owned analyser; the meter retains its
documented optional caller-supplied context tap. None creates a player,
transport or microphone request. Oscilloscope history is bounded by the
analyser's available sample window and cannot promise a sample-accurate
trigger. Transient events are sampling-cadence cues, not a stable clip-time
onset map. Whole-clip pitch, onset, tempo, key, loudness and beat-grid output
remain API/Headless data; applications can still compose a beat grid with
`audio-view.regions`. DEC-033's one-player, one-component demo rule applies to
all five tools.

**Owner:** [Audio Analyze design](design/AUDIO-ANALYZE-COMPONENTS.md),
[Audio View design](design/AUDIO-VIEW-COMPONENTS.md), the
[Audio Analyze Element inventory](../doc/src/content/docs/audio/element/index.mdx#analyze)
and each owning tag reference.

**Verification implications:** assert an exact five-tag Analyze inventory and
the absence of tuner, with idempotent legacy View meter registration. Cover
player/explicit-analyser binding, owned meter-tap cleanup, source replacement,
pause/seek/end and missing graphs; threshold, hold and freeze; spectrum and
time-domain probes, trigger/timebase bounds, transient sensitivity/refractory
behavior and false-cue limits; Copy/Reset, keyboard/focus, responsive browser
layouts and real audio/device checks. Static tests cannot certify acoustic
precision or sample-accurate onset timing.

## DEC-038 — Score Analyze exposes five inspection tools

**Date / status:** 2026-09-26; accepted for this `dev` checkout by the
maintainer's Score Analyze redesign request. This supersedes DEC-014's Element
inventory, not its one-surface composition rule or DEC-013's API/Headless report
ownership. Score remains main-owned under the current branch synchronization
policy; promote this explicit product change to main before treating it as a
shared baseline.

**Problem:** four Score Analyze Elements primarily display precomputed labels
alongside a playback cursor. Seeking a label is useful, but music-software
users also need to choose a passage, inspect the notes and rhythmic evidence,
and compare plausible interpretations. A separate Roman lane duplicates the
chord progression while applying one estimated key to the entire score. The
limited voice-leading rules are valuable in specialist work but do not justify
one of the default five tools.

**Decision:** publish exactly five independent Score Analyze Elements:
`live-chord-analysis` for sounding-note chord interpretation,
`chord-analysis` for passage-level chord and key-relative harmony inspection,
`key-analysis` for passage-level tonal and scale evidence,
`interval-analysis` for selected melodic and vertical note relationships, and
`rhythm-analysis` for meter-aligned onset and subdivision inspection. Each
Element owns one core surface and may reveal contextual evidence for its own
selection. Its inspection controls and results do not edit the Score. The
caller-owned player remains the only playback and timeline authority; standalone
Score input remains supported.

`roman-analysis` and `voice-leading-analysis` leave the public Element
inventory, registration, catalogs and current pages. `romanNumerals`,
`voiceLeading`, their Headless projections and session results remain available
for application-owned or specialist UI. The chord inspector may show a coarse
Roman degree relative to an explicit or estimated key, but must not call it
contextual harmonic-function, modulation, inversion or cadence inference. The
new interval and rhythm algorithms are API/Headless data, not calculations
hidden in the DOM presenter. Whole-score reports and motif search keep their
existing API/Headless ownership.

**Alternatives considered:** retaining seven public tags, renaming the four
seekable lanes without changing their interactions, or combining all theory
questions into a single configurable workbench. These increase selection cost
or leave the user unable to test an analysis hypothesis. Voice-leading can still
be composed from its algorithm when that specialist task is needed.

**Consequences:** selection and its evidence are local to each tool unless the
application supplies an explicit source selection. Analysis parameters use
musical quarters or declared note identities; the existing `window` attribute
continues to mean visible duration in seconds. Current computed results must
be distinguishable from the user's chosen reading. Missing score, no notes,
ambiguous results and unsupported score context remain visible states, not
apparently confident labels. Chord, key and interval pitch basis must state
whether written or sounding notes are analyzed, especially for transposing
parts. Retiring a default Element does not remove its code-only analysis.

**Owner:** [Score Analyze design](design/ANALYZE-COMPONENTS.md), the
[Score Analyze Element inventory](../doc/src/content/docs/score/element/index.mdx#analyze),
and each owning Element/API reference.

**Verification implications:** assert the exact five public tags and retired
redirects; exercise selected evidence, keyboard/pointer inspection, local
interpretation changes, score/part/range replacement, player seek and reset,
and API/Headless reuse. Check note and part provenance, meter changes, empty
and ambiguous cases, late player attachment, multiple companions, cleanup and
responsive browser behavior. Static tests cannot establish music-theory
correctness for every style or audible/device timing.

## DEC-039 — Score Analyze lanes omit the visible evidence block

**Date / status:** 2026-09-26; accepted at the maintainer's correction to the
four rendered Score Analyze lanes. This changes DEC-038's visual treatment,
not its five-tool inventory, analysis data or local selection contract.

**Problem:** the chord, key, interval and rhythm lanes append an always-visible
text evidence section beneath the musical timeline. The repeated headline,
provenance and explanation read as an introduction below the component's main
interaction, crowding the performance surface.

**Decision:** remove that visible under-lane evidence section from all four
lanes. The selected band and current readout remain visual; chord and key
candidate buttons move into a compact control row above their lane. The
read-only `.analysis` result and selection events retain the detailed evidence
for application-owned inspectors. Selection details remain available to screen
readers through a nonvisual status, without adding a visible prose block or
announcing every passive playback tick. Candidate choice, local pinning and
player seeking retain their existing behavior.

**Alternatives considered:** shortening the evidence paragraphs, hiding the
section with CSS while leaving its focusable buttons beneath the lane, or
removing the selected evidence data altogether. These either keep the extra
panel, create inaccessible controls, or discard useful analysis contracts.

**Consequences:** the visual component no longer provides a persistent
provenance report; applications that need one compose it from `.analysis` and
`webscore:analysisselect`. The stable `inspection` part is retired with the
visible section; styling references must identify the candidate row and
remaining surface parts accurately. DEC-038 continues to govern the tools,
selection, API/Headless ownership and failure states. DEC-034's single outer
component surface remains unchanged.

**Owner:** [Score Analyze design](design/ANALYZE-COMPONENTS.md) and the four
owning Score Analyze Element pages.

**Verification implications:** inspect every lane at desktop and narrow widths
for no visible under-lane text, preserved current readout and candidate access,
keyboard/focus and screen-reader selection feedback, correct `.analysis` data
and events, and no regression to seeking or source replacement.

## DEC-040 — Score Analyze favors recurring musical patterns

**Date / status:** 2026-09-27; accepted for this `dev` checkout by the
maintainer's request to replace the three less useful Score Analyze Elements.
This supersedes DEC-038's five-tag inventory and DEC-014's retired-motif rule,
while retaining their one-surface composition and API/Headless boundaries.

**Problem:** the `key-analysis`, `interval-analysis` and `rhythm-analysis`
lanes expose valid algorithms, but their default visual tasks are less useful
for making and testing musical decisions. A tonal label can be unstable over a
short passage; an interval label or beat grid alone does not reveal recurring
material. The user needs to locate a musical idea elsewhere in a piece and
compare rhythmic phrases in time.

**Decision:** publish four independent Score Analyze Elements:
`live-chord-analysis` and `chord-analysis` remain, while `motif-analysis`
shows repeated melodic interval-and-duration phrases and
`rhythm-pattern-analysis` shows repeated voice-local onset-and-duration
phrases. Their interactive surfaces follow the selected player's score and
position, support standalone score inspection, and let the user select and
navigate occurrences without editing notes or creating another transport.
Motif matching is transposition-invariant but duration-sensitive; rhythm
pattern matching ignores pitch and must preserve note/part/voice provenance.
Neither tool claims to detect performed groove, syncopation, harmonic function
or a composer's intended theme.

Retire the three former Element tags from registration, catalogs and current
pages without compatibility aliases. Keep `detectKey`, `analyzeIntervals` and
`inspectScoreRhythm` as code-only analysis, along with applicable Headless
projections. Preserve `findMotifs` and `rhythmPatterns` as API results:
the new Elements are live, selectable projections, not relabelings of static
whole-score motif or rhythmic-vocabulary reports. The old `rhythm-patterns`
report bookmark continues to lead to the report workflow; the newly revived
`motif-analysis` URL leads directly to its Element page.

**Alternatives considered:** keep five tags by inventing a third replacement,
retain all three old lanes alongside the new tools, or turn the static
`rhythm-patterns` report tag into the new tool. Those choices add redundant
navigation or conflate a report with interactive phrase inspection.

**Consequences:** the two pattern tools must make recurrence and occurrence
identity visible while keeping detailed evidence available through their
nonvisual analysis contracts. Phrase length, overlap, rests, polyphony and
meter changes require explicit semantics and truthful empty/ambiguous states.
Their selections are local; seeking a match uses the existing player's nominal
score-time mapping. DEC-039's prohibition on an always-visible prose block
beneath a lane still applies. Existing callers of retired tags migrate to the
new tools or compose the retained code-only algorithms themselves.

**Owner:** [Score Analyze design](design/ANALYZE-COMPONENTS.md), the
[Score Analyze Element inventory](../doc/src/content/docs/score/element/index.mdx#analyze),
and the owning Element/API references.

**Verification implications:** assert exactly four registered Analyze tags
and three retired redirects; verify repeated transposed motifs and voice-local
rhythms against authored rests, overlaps and meter changes, plus selected
occurrence seeking, keyboard/pointer access, source replacement, stale-load
cleanup and responsive layout. Browser and musical judgment remain separate
from algorithm unit tests.

## DEC-041 — Score Analyze readings avoid false controls and layout shifts

**Date / status:** 2026-09-27; accepted for this `dev` checkout by the
maintainer's review of the four DEC-040 Analyze tools. This refines their
presentation and does not change the four-tag inventory or the underlying
analysis algorithms.

**Problem:** chord candidate and alternate readings look like commands even
when choosing one has no useful effect on the score or playback. The live
nameplate also repeats an uninformative temporal caption. Motif and rhythm
lanes show both a recurrence ID and a multiplication count, while an empty
current readout can collapse and shift the surface during playback.

**Decision:** the chord-progression Element keeps its selectable, seekable
bands but omits its candidate-button row. Detailed chord candidates remain
available through `.analysis` for application-owned inspectors. The live-chord
Element displays alternate interpretations as noninteractive secondary text
below the primary chord symbol and omits the temporal caption. Neither Element
offers a user-triggered `webscore:chordpick` interaction. Motif and
rhythm-pattern lanes retain recurrence IDs on their occurrences, omit the
separate `×` repetition count, and reserve the top readout's space when its
text is temporarily empty.

**Alternatives considered:** preserve buttons and make their effect more
prominent, hide all alternate readings, or display a placeholder word in an
empty top readout. The selected presentation keeps useful interpretation data
without implying a command, and reserves geometry without invented text.

**Consequences:** documentation and parameter catalogs no longer advertise
chord-pick events or candidate controls. The live nameplate remains readable
at narrow widths, and the pattern lanes remain stable across empty/active
transitions. Applications needing to choose or compare an alternate reading
use the available nonvisual analysis data and own that interaction.

**Owner:** [Score Analyze design](design/ANALYZE-COMPONENTS.md), the four
owning [Score Analyze Element pages](../doc/src/content/docs/score/element/index.mdx#analyze),
and the corresponding Score/UI presenters.

**Verification implications:** inspect normal and narrow live demos for no
inert candidate controls, noninteractive alternate text below the primary
symbol, no redundant caption, recurrence IDs without a count, and a steady
lane position while the top readout appears or clears. Check source-facing
`.analysis` candidate data, event catalogs and keyboard/focus behavior.

## DEC-042 — Dense Score Analyze passages use stable, readable projections

**Date / status:** 2026-09-27; accepted for this `dev` checkout by the
maintainer's review of all four Score Analyze demos with the full Arabesque No.1
score. This refines DEC-038, DEC-040 and DEC-041 without changing their four-tag
inventory or the underlying analysis algorithms.

**Problem:** a complete score can generate many short chord changes and dozens
of recurring phrase groups. Drawing every result in one small lane makes the
bands too narrow to read, while an aggregated overflow row piles unrelated
occurrences on top of each other. The live-chord nameplate also changes shape
as playback moves among silence, unnamed pitch sets and named chords.

**Decision:** Score Analyze Elements use display projections sized for musical
inspection. The chord-progression Element groups the score into two
measure-aligned harmonic cells per bar; each cell summarizes its notes and is
selectable and seekable as one interval. The underlying Headless/API chord
segments remain available unchanged. Motif and rhythm-pattern Elements show a
bounded number of distinct recurrence tracks relevant to the current view,
without combining remaining groups into a crowded visual row; their full
results and selected evidence remain nonvisual data. Pattern lanes reserve a
fixed row/readout footprint across playback and use a four-bar automatic view
to keep short phrases legible. The live-chord Element reserves
its symbol, voicing and alternate-reading rows even when they are empty;
unnamed held sets show their literal pitch names as the main readout without
inventing a chord identity or event.
An empty passage is named in the reserved pattern readout; its live status
remains available to assistive technology without adding a visible row.

**Alternatives considered:** shrinking typography, drawing every event or
group at once, or hiding overflow behind a visually merged band. Those choices
either leave text unreadable or imply a relationship the analysis did not find.

**Consequences:** the chord surface reports an interval-level harmonic summary,
not every instantaneous note-set change. Its selection evidence must describe
the same interval; applications requiring event-level timing use Headless/API.
Pattern tracks may change identity with the visible passage, but their geometry
must stay steady and every displayed occurrence keeps its own selection/seek
identity. Detailed analysis must not be discarded merely because it is not
drawn. Silence, ambiguous material and unnamed pitch sets remain distinct from
a named chord.

**Owner:** [Score Analyze design](design/ANALYZE-COMPONENTS.md), the four
owning Score Analyze Element pages, and the Score/UI presenters.

**Verification implications:** test cell and pattern projections against dense
and sparse scores, meter changes, interval evidence, selection and seek;
inspect all four demos during playback at desktop and narrow widths for
unoverlapped labels and unchanging component height. Confirm `.analysis` and
Headless/API outputs keep their documented provenance.

## DEC-043 — Park recurrence Elements while retaining their algorithms

**Date / status:** 2026-09-27; accepted for this `dev` checkout by the
maintainer's request to move the two recurrence components to a research
branch. This supersedes DEC-040's four-tag inventory and the pattern-Element
portions of DEC-041 and DEC-042; their dated rationale remains historical.

**Problem:** the `motif-analysis` and `rhythm-pattern-analysis` lanes require
more study before their occurrence IDs and visual projections are useful to
musicians. Keeping them in the current Element inventory would present
unfinished interaction choices as settled product surfaces.

**Decision:** publish only `chord-analysis` and `live-chord-analysis` as Score
Analyze Web Components in `dev`. Remove the two recurrence tags, their
registration, demos, parameter catalogs and Element pages from the current
checkout. Retain their implementation snapshot on the local
`score-pattern-analysis-research` branch for later exploration. Keep
`findMotifs`, `findRhythmPatternOccurrences`, `rhythmPatterns` and applicable
Headless projections in the API/Headless layers; callers may analyze those
results without a bundled recurrence UI. Old Element URLs redirect to the
corresponding API analysis sections.

**Alternatives considered:** leave the current lanes in `dev` while hiding
their documentation, or remove the recurrence algorithms as well. The first
leaves accidental public tags; the second discards useful nonvisual analysis
outside the requested component scope.

**Consequences:** the Score Analyze Element contract and composition policy
have exactly two tags. Chord progression selection and live-chord display
retain the applicable DEC-041/042 layout refinements. Recurrence UI is no
longer a supported Element workflow on `dev`, while algorithm contracts and
tests remain independently verifiable. The research branch is local until
explicitly published; it is not a second active checkout.

**Owner:** [Score Analyze design](design/ANALYZE-COMPONENTS.md), the
[Score Analyze Element inventory](../doc/src/content/docs/score/element/index.mdx#analyze),
and the owning API/Headless references.

**Verification implications:** assert the exact two-tag registration and no
pattern Element entry; verify old-page redirects and retained API/Headless
exports. Check chord and live-chord visual behavior independently. Future
recurrence UI work requires a new decision and browser/music usability review.

## DEC-044 — Retire three narrow Audio View Web Components

**Date / status:** 2026-09-27; accepted for this `dev` checkout by the
maintainer's request to remove the three components.

**Problem:** `<audio-clip-thumbnail>`, `<audio-minimap>` and
`<audio-region-list>` add separate public tags, parameters, demos and lifecycle
contracts without enough value in the current Audio View workflow.

**Decision:** remove these three tags and their Element classes, registration,
catalog entries and standalone demos. Audio View exposes `<audio-view>` for
waveform, spectrogram, meter and region display, plus `<audio-live-view>` for
rolling observations. Retain the existing clip/region models, viewport APIs,
Headless/Render operations and independent UI Kit presenters for applications
that compose their own overview or region controls. Redirect the retired Element
documentation URLs to the current `<audio-view>` reference.

**Alternatives considered:** keep the three tags while removing only their
demos, or remove the lower-layer data and presenter capabilities as well. The
first would leave unsupported public components available; the second would
remove reusable capabilities outside the requested Web Component scope.

**Consequences:** Audio View auto/global registration and the Element export
surface contain only the two retained View tags, plus the existing legacy
`audio-meter` registration alias. Existing users of the retired tags must move
to `<audio-view>` or compose the lower-layer APIs and UI presenters directly.
The late-binding gap formerly tracked as AUDIO-VIEW-01 for Minimap and
RegionList no longer applies to the supported Element inventory.

**Owner:** [Audio View design](design/AUDIO-VIEW-COMPONENTS.md), the
[Audio Web Component inventory](../doc/src/content/docs/audio/element/index.mdx#view),
and the Audio View source and export policy.

**Verification implications:** assert the exact current View tag set and the
absence of retired exports/registration; verify the old documentation redirects
and retained AudioView/LiveView, clip/region, and UI Kit capabilities. Build the
site and check its demos and prefixed routes.

## DEC-045 — Prefix every Score Web Component tag with its domain

**Date / status:** 2026-09-27; accepted for this `dev` checkout by the
maintainer's request to unify Score and Audio Web Component names. This
supersedes the tag-stability and `simple-score-player` compatibility portions of
DEC-016; its behavior, ownership and resource decisions remain in force.

**Problem:** all current Audio Element tags begin with `audio-`, while eight of
the eleven Score Element tags and five publicly exported Score demo tags lack a
`score-` prefix. The mixed HTML names make registration and composition less
predictable across the two domain packages.

**Decision:** keep `score-player`, `score-recorder` and `score-view`. Rename the
other canonical tags to `score-rack-control`, `score-rack-part`,
`score-note-input`, `score-synth-panel`, `score-chord-analysis`,
`score-live-chord-analysis`, `score-pitch-view` and `score-sheet-view`. Apply the
same prefix rule to the five formerly unprefixed tags in the public
`@webmusic/score/play/demos` entry. Retire the deprecated
`simple-score-player` tag, constructor, registration and export; use
`score-player`. Element, auto and global registration expose only current tags.
Keep Audio's existing `audio-` names. Move Score Element reference pages to
their tag-named routes and redirect old page URLs to the matching current pages.

**Scope:** the HTML custom-element tag names, demo tags, their registration,
composition selectors, catalogs, examples and documentation routes change.
Existing Score Element class and `define*Element` symbol names, Headless names,
event operation values, CSS parts and UI presenter identifiers are separate
contracts and remain stable, apart from the retired simple-player alias.

**Alternatives considered:** remove Audio's prefix or retain all old Score tags
as aliases. Removing the Audio prefix would change an already consistent family;
retaining old registrations would preserve two competing naming conventions.

**Consequences:** callers using the eight old Score tags or the retired
simple-player alias must update markup or registration calls. Old reference
bookmarks still navigate to the new pages, but redirects do not register old
custom elements. Demo-only tag users must adopt their prefixed names. The change
is a user-approved Score exception in this `dev` checkout, not an automatic
change to `main`.

**Owner:** [Score Play](design/PLAY-COMPONENTS.md),
[Score Analyze](design/ANALYZE-COMPONENTS.md),
[Score View](design/VIEW-COMPONENTS.md), and the
[Score Element inventory](../doc/src/content/docs/score/element/index.mdx).

**Verification implications:** assert exact default registrations for Play,
Analyze, View, auto/global and the public demo entry; assert old tags do not
register. Check Rack declaration lookup, package exports, catalogs, live demos,
new documentation pages and redirects at the normal and prefixed site base.

## DEC-046 — Integrate the five-package development surface into main

**Date / status:** 2026-09-28; accepted by the maintainer's request to merge
the current `dev` source into `main`. This supersedes DEC-021's ongoing branch
split while preserving the historical scope of the first release.

**Problem:** a separate Audio/Bridge checkout and main-only fixes now require
repeated synchronization, and the maintainer wants one maintained source tree.

**Decision:** `main` will contain Kernel, UI Kit, Score, Audio and Bridge,
including their source, tests, public references and demos. The five-package
policy and dependency order describe the integrated source and the packages
eligible for a future reviewed release. Keep Score and Audio independent, with
cross-domain behavior in Bridge and neutral foundations in Kernel and UI.
Retain the accepted Score changes from DEC-032 through DEC-045 in this merge.

**Alternatives considered:** continue the permanent branch split, or move only
selected Audio/Bridge source files while leaving their tests, policies and
documentation behind. Both would preserve duplicate synchronization work or
an inconsistent package surface.

**Consequences:** current guidance, package policy, manifests, build order,
site navigation and checks must describe the same five-package source tree.
The original three-package `0.1.0` npm release and its verified Agent Toolkit
baseline remain historical facts; integrating changed source does not update
that release, publish Audio/Bridge, create a tag or prove registry availability.
Until a separate release is verified, generated Agent Toolkit material must
identify this tree as a source snapshot. A push to the official `main` branch
also triggers the current CI Pages deployment, so its site content and demo
asset provenance require review before that push.

**Owner:** [Architecture](ARCHITECTURE.md), [Status](STATUS.md),
[Release policy](release/RELEASING.md) and the owning package/public references.

**Verification implications:** resolve the main worktree changes without
discarding uncommitted work; run the full local gate, documentation build,
external consumer check and dependency audit on the merged tree. Check the
five-package manifests, public exports and Agent Toolkit source-snapshot
claims. Verify CI and deployment on the exact target commit separately; none
of these checks establishes npm publication or live device/audio behavior.

## DEC-047 — Four elementary Score analysis tools with explicit musical context

**Date / status:** 2026-10-03; accepted by the maintainer's request to develop
basic music-theory analysis before resuming recurrence research. This supersedes
DEC-043's two-tag inventory and DEC-042's fixed half-bar aggregate chord
projection; the research branch and dated evidence remain untouched.

**Problem:** separate score/live chord tags duplicate one musical task, while
basic interval, scale-degree and metrical questions have no direct component.
Recurrence lanes and inferred-key reports do not provide those elementary facts.

**Decision:** register exactly four Score Analyze tags: `score-chord-analysis`,
`score-interval-analysis`, `score-scale-analysis` and `score-rhythm-analysis`.
Chord `mode="score"` is the default; `mode="live"` selects the held-note nameplate
on that same tag. Remove the separate live-chord class/registration and redirect
its documentation bookmark to the merged reference. Every score surface reuses
API/Headless inspection and neutral UI presenters, can borrow one player's Score
and timeline, and also accepts standalone explicit input.

Chord score inspection uses simultaneous, spelled complete triads/sevenths,
including bass and inversion. Key-relative degrees require an explicit major or
minor reference and do not assert harmonic function. Interval inspection keeps
spelling, diatonic size, quality, direction, semitones and source identities;
ambiguous chord attacks do not invent a melodic line. Scale inspection requires
a chosen tonic and one of major, natural minor, harmonic minor, ascending melodic
minor or descending melodic minor; alterations are descriptive, not errors.
Rhythm inspection uses simple/compound pulses and requires explicit grouping
for irregular meters. Written durations and exact beat placement remain separate
from performance judgments. Written/sounding pitch basis is explicit where
applicable; no component estimates a key to fill missing context.

**Alternatives considered:** restore recurrence research first; add an inferred
key component; retain separate chord tags; or put every report in one component.
These alternatives do not establish four independent elementary musical tasks
with clear, reusable inputs.

**Consequences:** migrate `score-live-chord-analysis` to
`score-chord-analysis mode="live"`. Historical tags remain unregistered. The
four tag-owned demos use the existing `public/mxl/Arabesque No.1.mxl` asset
and pair one real player with one tool. They inspect the piece’s actual notes
and preserve its written spelling; generated substitute scores are not used.
Scale starts with an explicit E-major reference. Synthetic elementary examples
belong in regression tests. Controls, Copy and Reset remain outside the
component. API/Headless retain detailed data and specialist algorithms; the
research branch is not merged as part of this work.

**Owner:** [Score Analyze design](design/ANALYZE-COMPONENTS.md), owning
[Element pages](../doc/src/content/docs/score/element/index.mdx#analyze)
and [Analyze API](../doc/src/content/docs/score/api/analyze.mdx).

**Verification implications:** assert the exact tag/export/catalog inventory;
cover C–F♯ versus C–G♭, transposing parts, explicit-key chord inversions, all
minor forms, tie continuations, simple/compound/additive meters, invalid context,
source replacement, mode changes, cancellation and repeated cleanup. Verify
public examples and responsive keyboard/pointer demos on the same tree. Unit
and static checks do not establish audible timing or accessibility acceptance.

## DEC-048 — Metrical chord collections and readable elementary inspection lanes

**Date / status:** 2026-10-07; accepted after reviewing the four elementary
Analyze tools against the existing Arabesque No. 1 demos. This supersedes
DEC-047's simultaneous-only default for the chord Element and refines the lane
presentation. DEC-047's four tasks, explicit context and strict chord dictionary
remain in force; its dated record is retained above.

**Problem:** exact simultaneous slices fragment arpeggiated material into
unhelpful short sets. Dense lanes can leave the primary reading too small to
read, repeat generic failure text, and reserve blank rows for overlapping notes
far outside the visible passage. These presentations obscure valid evidence.

**Decision:** score-mode `score-chord-analysis` defaults to `grouping="beat"`.
Each actual metrical pulse collects all selected source notes that overlap its
half-open span, retaining sustained and sequential notes and their identities.
Simple 2/3/4 meters use one denominator unit per pulse; compound 6/9/12 meters
use groups of three. Other numerators require explicit `beat-groups`, whose
positive integer values must sum to each inspected numerator. Grouping is
independent of the visible seconds window. `grouping="simultaneous"` retains
exact note-boundary inspection. Live mode continues to inspect held MIDI notes.

`inspectScoreChords()` keeps its simultaneous default and adds explicit
`grouping: 'beat'` and `beatGroups`; `projectBasicInspection()` also keeps its
simultaneous default and accepts `chordGrouping: 'beat'`. Chord results and spans
identify their grouping. Only complete, correctly spelled triads and supported
sevenths receive names. No passing tone is removed, missing tone inferred, key
estimated or harmonic function asserted. The lowest collected source pitch
determines the displayed bass/inversion; a grouped reading does not prove the
passage's structural harmonic bass. Unmatched collections display their pitches.

The musical rationale is bounded by the distinction between texture and
analysis: arpeggios can express a chord, harmonic duration can vary, and
non-chord-tone classification depends on surrounding motion. Beat grouping is
an explicit collection method, not an automatic harmonic reduction. See the
University of Puget Sound's *Music Theory for the 21st-Century Classroom*:
[Arpeggiated Accompaniments §14.3.1](https://musictheory.pugetsound.edu/mt21c/ArpeggiatedAccompaniments.html),
[Harmonic Rhythm §9.2](https://musictheory.pugetsound.edu/mt21c/HarmonicRhythm.html)
and [Introduction to Non-Chord Tones §10.1](https://musictheory.pugetsound.edu/mt21c/NonChordTonesIntroduction.html).

All four score lanes retain a prominent full current readout and quieter
configuration context. Visible material determines occupied rows; offscreen
overlap must not create blank space. Melodic interval pairs use an arrow and
harmonic pairs use `+`. Rhythm uses compact duration/beat labels while preserving
exact units and source notation in evidence. Semantic lists, keyboard commands,
source identities and `.analysis` remain available. No additional report panel,
player, clock or sibling musical view is created inside a tool.

**Alternatives considered:** retain simultaneous slicing as the only component
view; restore a fixed half-bar window; or infer an underlying harmony by removing
non-chord tones. The first under-serves arpeggiated input, the second ignores
metrical pulse, and the third requires analysis beyond the elementary contract.

**Consequences:** expose grouping in the chord reference and external Parameters;
Copy/Reset preserve it. Keep API/Headless defaults compatible. The chord Arabesque
demo starts with a four-second viewport; the other three start with one second.
Those are demo display settings, not musical grouping rules. Detailed inspection
evidence remains available independently of presentation.

**Owner:** [Score Analyze design](design/ANALYZE-COMPONENTS.md),
[Analyze API](../doc/src/content/docs/score/api/analyze.mdx), the
[four Element references](../doc/src/content/docs/score/element/index.mdx#analyze)
and the [Harmony presenter reference](../doc/src/content/docs/uikit/views-analysis/harmony.mdx).

**Verification implications:** preserve simultaneous-default regressions and
test metrical collection of arpeggios, sustained overlaps, passing tones,
compound/irregular meter, clipped selections, transposition and bass provenance.
Verify readouts, harmonic separators, visible row compaction, narrow layouts,
keyboard/pointer seeking and Copy/Reset on the real Arabesque demos. Tests and
static checks do not replace browser, audible or accessibility evidence.

**DEC-048 display refinement, 2026-10-07:** at the maintainer's request, chord
labels no longer repeat the grouping caption. Named chords appear above their
source note names with octaves; unmatched sets show only note names. Grouping
remains explicit in configuration and inspection evidence. Chord timeline
labels wrap with content-sized row height instead of ellipses, preserving their
time coordinates. The chord demo now starts at one second, like the other three,
to give its labels more room. This refines DEC-048's initial presentation, not
its musical collection or matching rules.

**DEC-048 note-row clarification, 2026-10-07:** unmatched pitches remain in
the secondary note/voicing row, with the primary chord-name row empty. This
applies to the current score readout, timeline and stable live nameplate,
superseding DEC-042's unnamed-held-set promotion to the main readout. Empty
name slots retain their row so notes align with those beneath named chords.

**DEC-048 live display refinement, 2026-10-07:** the performance surface omits
the MIDI-spelling caption and starts directly with the chord name. Its quieter
note row follows the same hierarchy as score mode; unmatched notes remain below
an empty chord row. Fixed reading rows and scrollable, unabridged long lines
retain the live layout's stability. MIDI spelling limitations remain in the
public reference rather than recurring above every reading.

**DEC-048 structured readout refinement, 2026-10-07:** interval, scale and rhythm
replace a changing secondary sentence with fixed fields under the primary
reading. Their three equal-width slots are Notes/Motion/Semitones,
Note/Reference/Relation and Bar/Beat/Duration (qn), respectively. Rhythm keeps
the same slots for attacks, rests and tie continuations; unavailable values
stay empty. Field labels, order and horizontal positions remain stable while
values change. Gaps clear values but retain labels and reserved space. The
chord symbol/note presentation is unchanged.

UIKit adds domain-neutral `FlowReadoutField {id, label, value}` and
`FlowReadout {primary?, secondary?, fields?}` for `FlowBand.readout` and
`FlowLaneState.pinned`. Score uses the same structural field shape without a
new named field export. Existing secondary text remains available for consumers
that do not use the structured fields. The presenter derives stable slots from
the full band collection and measures the maximum wrapped heading/field space
on content or geometry changes. Its fixed three-column grid keeps playback to
value updates without per-frame measurement or readout resizing. More generic
UI fields continue in additional rows; these Score tools supply exactly three.
Verify slot identity, long values, gaps, narrow widths and semantic field text;
do not infer that fixed readout geometry fixes the separate scrolling lane's
visible row count.

## DEC-049 — Per-numerator beat groups, a wrapped-label minimum width and the interval overlap contract

**Date / status:** 2026-10-07; accepted after the independent review of the
`dev` consolidation (`92e841a` and `4471a22`). This supersedes DEC-048's rule
that one `beat-groups` list must sum to every inspected numerator and refines
DEC-048's wrapped chord labels. It records, rather than changes, the harmonic
interval contract that DEC-047's implementation introduced.

**Problem:** the chord Element's default beat grouping failed for any score
with an irregular meter until `beat-groups` was set, and one list could never
satisfy a score whose irregular numerators differ. Wrapped chord labels had no
lower width bound: a 30-second `window` on the Arabesque demo produced 10px
bands with one glyph per line and rows nearly 500px tall. `analyzeIntervals`
began reporting same-voice overlaps with different onsets without a recorded
decision. A full-range float selection rounded a triplet-ending last chord
span, the stable live nameplate exposed an unnamed note set to screen readers
twice, unobserved attributes could put a tool into an error state, and the
independent-loops demo decoded the complete recording for every session.

**Decision:**

- `BeatGroups` is one list or an array of lists. Each list applies to the
  meter numerator equal to its sum; lists with equal sums are rejected.
  Numerators 2/3/4 and 6/9/12 keep their conventional pulses unless a list
  sums to them; any other numerator without a matching list throws. The
  `beat-groups` attribute accepts several groupings separated by spaces or
  commas, for example `2+3 2+2+3` for 5/8 and 7/8. Chord and rhythm inspection
  share the rule; API/Headless defaults are unchanged.
- A wrapped band narrower than 48 measured pixels hides its label stack, is
  marked `data-label-fit="hidden"`, keeps its title and semantic entry, and
  does not raise the shared row height. Bands at or above 48px keep complete
  stacks. The threshold is a presenter constant, not a public token, and the
  fit is recomputed only with measurements: data changes, resize and zoom.
- Harmonic intervals include a note sustained in one voice beneath a later
  attack in that same voice; continuation and stop fragments remain excluded
  as attacks. The 0.2.0 release excluded such same-voice pairs.
- A chord selection whose float bounds reach the Score's start or end uses the
  authored Rational ends; bounds strictly inside the Score remain decimal
  approximations.
- The stable nameplate marks its visible note row `aria-hidden` while the live
  region speaks the same unnamed notes.
- An Element validates only the attributes it observes.
- The independent-loops demo decodes the Arabesque recording once per excerpt
  length through a shared site helper and keeps only the opening excerpt; a
  failed load is forgotten so the next start can retry.

**Alternatives considered:** keep the strict single-list rule and improve only
its error message; cap the wrapped row height while still wrapping single
glyphs; revert the harmonic overlap change. The first leaves the default chord
tool unusable on mixed meters, the second keeps unreadable labels, and the
third removes tested, musically defensible evidence.

**Consequences:** the chord and rhythm Element references, the Analyze API
page, the Parameters catalog and the Harmony presenter reference describe the
new rules. Single-list callers are unaffected unless they relied on a mismatch
throwing for a conventional meter. Browser evidence for long chord windows is
recorded in STATUS when the correction is verified on the site.

**Owner:** [Score Analyze design](design/ANALYZE-COMPONENTS.md),
[Analyze API](../doc/src/content/docs/score/api/analyze.mdx),
the [chord](../doc/src/content/docs/score/element/analyze/score-chord-analysis.mdx)
and [rhythm](../doc/src/content/docs/score/element/analyze/score-rhythm-analysis.mdx)
Element references and the
[Harmony presenter reference](../doc/src/content/docs/uikit/views-analysis/harmony.mdx).

**Verification implications:** cover mixed 4/4, 5/8 and 7/8 scores with one
and several lists, equal-sum rejection, a conventional meter replaced by a
matching list, hidden and restored wrapped stacks across zoom and resize,
exact triplet ends, nameplate `aria-hidden`, unobserved attributes, and the
cached excerpt's disposal and retry paths. Unit checks do not establish the
rendered result; verify the chord demo at long windows in a browser.

## DEC-050 — PitchView keyboard fits two octaves unless scrolling is enabled

**Date / status:** 2026-10-07; accepted by the maintainer's request for an
optional scroll mode and a responsive MIDI 48–71 keyboard.

**Problem:** the keyboard defaulted to MIDI 36–84 with a minimum key width.
Ordinary demo containers therefore showed only part of the range and could
move when new notes arrived. Disabling `follow` alone still allowed manual
overflow and did not fit the full range.

**Decision:** keyboard mode defaults to `low="48"`, `high="71"` and disabled
scrolling. The Element reuses UIKit's full-range `fitToWidth` option, so the
board scales with its container, ignores fixed/minimum widths while fitted,
and has no scrolling focus stop. `scroll="true"` restores minimum or explicitly
configured widths; `follow` independently controls new-note following in that
mode. Turning scrolling off resets the horizontal offset while retaining held
notes and the borrowed player subscription. Staff, fretboard and Headless
behavior, key heights and the neutral UIKit defaults are unchanged.

An explicit `scroll` attribute is authoritative. Without it, an explicit
`fit-to-width` retains its inverse compatibility meaning; without either
attribute the keyboard fits. The read-only `.scrollable` and `.fitToWidth`
getters report this effective choice. The inherited `HTMLElement.scroll()`
method is not replaced. Parameters primarily expose `scroll`; the legacy
fitting row appears only for existing explicit `fit-to-width` settings.

**Alternatives considered:** change only the demo; disable only automatic
following; hide overflow without fitting. These leave ordinary consumers
unchanged or hide part of the requested keyboard range.

**Consequences:** exact-width waterfall/keyboard compositions explicitly opt
into scrolling to preserve pitch-column alignment. Out-of-range sounding notes
remain available in `.active`; fitting does not infer or expand the range.

**Owner:** [View families](design/VIEW-COMPONENTS.md) and the
[PitchView reference](../doc/src/content/docs/score/element/view/score-pitch-view.mdx).

**Verification implications:** test default endpoints, scroll and legacy
precedence, preserved notes/subscriptions, cleanup, focus and offset resets,
and exact waterfall alignment. Verify fitted and scrolling keyboards in wide
and narrow containers, including Parameters, Copy and Reset, with Arabesque No. 1.

## DEC-051 — One type-selected live meter with mono and colour themes

**Date / status:** 2026-10-08; accepted by the maintainer's request to give
`audio-meter` the seven MiniMeters-style displays. This supersedes DEC-037's
description of the meter as a two-mode normalized RMS/FFT-bar monitor; the
five-tag Analyze inventory, the API/Headless ownership of static reports and
the player-borrowing rule remain in force. Browser and device acceptance
remain in STATUS.

**Problem:** the compact monitor offered one level bar and one bank of bars
through the neutral meter presenter, while a music workstation expects the
familiar at-a-glance instruments: VU, loudness, waveform, oscilloscope,
spectrum, spectrogram and stereometer. Adding seven tags would multiply the
same binding, tap and lifecycle code; the inspection tools already own
gestures, so the meter needs displays, not interaction.

**Decision:** `audio-meter` keeps one tag and selects its drawing with
`type`: `vu` (default), `loudness`, `waveform`, `oscilloscope`, `spectrum`,
`spectrogram` and `stereometer`. `theme` selects `mono` (default), which
encodes sound only as a ramp between the page's surface and ink tokens, or
`color`, which adds hue for frequency position and a perceptual colormap for
intensity. Every display is a square-cornered canvas with square cells, dots
and lamps. The reductions (VU ballistics, K-weighted windows, histories,
trigger alignment, correlation) live in a DOM-free `AudioMeterDisplay` in
View Headless; the painters live in View render; the Element composes them
with the UI kit's canvas stage and resolves its colours from public tokens
through computed style. The retired two-mode DOM presenter is replaced: `mode`
remains a compatibility alias (`spectrum` maps to the spectrum, anything else
to the VU dial) that applies only while `type` is absent, `bars` now defaults
to a continuous spectrum curve, and the presenter's inner `track`, `fill`,
`peak`, `spectrum` and `bar` parts are retired while `part="wrap"`, the outer
surface tokens and the legacy `--wameter-*` aliases remain effective.

The box adapts: width fills the container; without an explicit height each
type keeps its aspect ratio until the `size` preset's cap, which maps `sm`,
`md` (default) and `lg` onto the UI kit's `--wm-surface-sm/md/lg` tiers so
the meter follows the same scale as the kit's other drawing surfaces. `width`
and `height` attributes, or the existing height tokens, fix a custom box.

The stereometer and loudness displays need separate channels, which an
`AnalyserNode` does not provide. The controller may attach an owned stereo
branch (`analyser -> two-channel fan-out -> ChannelSplitterNode -> two
analysers`) to the analyser it reads, including a borrowed one. This is the
single permitted change to a borrowed node: one added output edge, removed
with a selective `disconnect(branch)`, never a disconnect of the owner's
connections or a retune. A mono input is up-mixed to both channels.

**Alternatives considered:** seven new Analyze tags; keeping the DOM
presenter beside the canvas types; reading stereo from the player's internal
graph; or shipping colour-only displays. Separate tags duplicate the binding
and tap contracts; two presenters make one tag two designs; the player's
graph is private; and a colour-only meter has no page-neutral default.

**Consequences:** the K-weighting biquads move to the Audio core so the
offline loudness analysis and the live meter share one derivation. Readings
are meter-grade: windows polled on animation frames overlap or skip, the
loudness bar is a windowed K-weighted estimate rather than a gapless, gated or
certified EBU R128 measurement, peaks are sample peaks, spectrum magnitudes
remain the analyser's own decibel window, and the trigger is not
sample-accurate. The Element declares the `stage` presenter instead of
`meter`; `audio-view type="meter"` still composes the neutral meter presenter.
Documentation demos keep one player and one meter with external Parameters
for type, theme and the display attributes.

**Owner:** [Audio Analyze design](design/AUDIO-ANALYZE-COMPONENTS.md),
[Audio View design](design/AUDIO-VIEW-COMPONENTS.md), the
[meter reference](../doc/src/content/docs/audio/element/analyze/audio-meter.mdx)
and the [metering Headless page](../doc/src/content/docs/audio/headless/view/audio-meter.mdx).

**Verification implications:** assert the seven types and two themes, the
legacy `mode` mapping, type changes that keep the graph and stage, the stereo
branch attached only for the two displays and removed with a selective
disconnect on type change, source replacement and removal, the owned-tap and
borrowed-analyser cleanup, palette resolution fallbacks, every painter in both
themes, the VU calibration, K-weighting coefficients and window estimates,
trigger alignment, correlation and spectrum projection; verify the demo's
type/theme controls, Copy/Reset and narrow layouts in a browser. Static tests
do not establish calibrated loudness, true peak or acoustic accuracy.

## DEC-052 — Loading and source waiting use shared square animations

**Date / status:** 2026-10-08; accepted at the maintainer's request.

**Problem:** source placeholders such as “No live source” and “Waiting for a score”
interrupt the otherwise minimal component presentation, and some asynchronous views
remain blank until their source or renderer finishes loading.

**Decision:** UI Status owns two neutral, square animations: sequential four-cell loading
for pending work, and a slower outlined-square pulse for source/input waiting. Score
and Audio Play, View and Analyze compose these states without another player or clock.
Status adds `waiting`; Workbench adds `loading` and `waiting` phases. Keep descriptions
in a polite live region, mark only loading busy, and retain visible error and meaningful
empty-result text. Reduced-motion and stepped/no-motion surfaces use static indicators.

**Alternatives considered:** independent per-component animations or treating every empty
surface as loading. Both would obscure the distinction between pending work and missing input.

**Consequences:** animations use existing foreground/surface tokens, sharp square geometry
and CSS only. Pending feedback preserves mounted content and state, and stops being visible
when data arrives. Existing `empty`, `error` and `ready` meanings remain intact.
Queue rows, mixer desks, recorder operations, synth configuration sections and pitch
followers use the same presenter. A valid silent or paused source is not pending work;
an immediately usable note input has no artificial loading phase. The nonvisual rack-part
declaration reports readiness to its visible desk. Native Audio Player exposes current
`loading` and `loadError` plus `webaudio:loadstatechange` so companions can share its
readiness without initiating another load. Score Player, Audio Player, AudioView
and AudioMixer accept an explicit `loading` flag for application-owned asynchronous
preparation. It initiates no work and preserves assigned payloads and player
position; clearing it resumes automatic readiness and never cancels or hides an
internal pending request. Player getters and notifications combine this flag
with their native readiness. Audio Player also forwards its selected backend's
loading and failure; unrelated queue prefetch leaves a ready session usable.
Applications own cancellation and late-result guards for external preparations,
and mark every component whose required input is being prepared. Readiness follows
the selected drawing's actual input, rather than unrelated retained data from
another mode. Source discovery and replacement must refresh feedback even before
playback, without retaining subscriptions to superseded owners.

**2026-11-18 refinement:** a component waiting for its data draws its empty
surface under the waiting indicator, not the indicator alone
([DEC-082](#dec-082--a-component-without-its-data-still-shows-itself)).

**Owner:** [Design principles](DESIGN-PRINCIPLES.md),
[Status presenter](../doc/src/content/docs/uikit/layout-feedback/status.mdx),
[Workbench](../doc/src/content/docs/uikit/layout-feedback/workbench.mdx),
and the affected Element references.

**Verification implications:** loading/waiting/ready/error transitions, source replacement,
cancellation, teardown, unchanged-update stability, light/dark themes, narrow layouts and
reduced motion. Browser and screen-reader acceptance remain distinct from DOM regressions.
<a id="dec-047--document-owned-editing-and-borrowed-playback-proposed"></a>
<a id="dec-047--document-owned-editing-and-borrowed-playback"></a>

## DEC-053 — Document-owned editing and borrowed playback

**Identifier note:** drafted as DEC-047 on the editing branch while DEC-047–052
were assigned in parallel; registered as DEC-053 when the branches merged. Dated
editing records before 2026-10-21 that say DEC-047 mean this decision.

**Date / status:** 2026-10-13; accepted design in P0 following the maintainer's
request to start the first planned step. Runtime implementation was pending
at acceptance. P1–P4 are now implemented; their verification is tracked by
[STATUS EDIT-01](STATUS.md) and the [editing contracts](design/EDIT-COMPONENTS.md).

**Problem:** existing immutable Score/Audio edits and View interactions do not
provide persistent document ownership, undo, editable surfaces or a protocol
for applying new content to playback. Audio history based on complete PCM
snapshots would multiply memory use even for single-file editing.

**Chosen contract:** introduce domain Headless editors that own document
identity, monotonic content revision, transactions and optional bounded local
history. Play borrows a Core read-only document source and separately reports
the revision it has actually applied. View borrows document state and commands;
initial editing extends the existing piano-roll and waveform surfaces. A
nonvisual `score-document` / `audio-document` declaration supplies an HTML path
with explicit ownership. `.editor` and `editor` select content; `editable` only
enables View mutation. Conflicting independent sources fail explicitly. The first
playback integration pauses, prepares and applies content, remains paused, and
reports applied, superseded or failed. Stale/failed playback stays gated until
reconciliation; it does not promise seamless live replacement.

Audio documents use shared assets and immutable segment references from the
first editor. Segment-aware playback avoids full-output rendering per commit.
Local DSP may produce bounded new assets; export explicitly renders output.
Project-wide history, persistence and collaboration remain application-owned.
Core ports keep Play/View independent of concrete Edit implementations. Audio
loading has one browser-declaration adapter to the existing Play loader, with an
exact importer/target/symbol exception and no code-only Edit reachability.

Musical note timing edits remove the edited note's absolute performed overlay,
use written quarters and preserve effective velocity in `velocityOverride`.
Pitch/velocity-only edits retain performed timing. The model extension ships with
Score JSON v0.2 migration in P1. History defaults to 100 transactions; audio uses
asset retention budgets. Position maps compose from the last applied revision;
missing/repeat mappings explicitly reset position and clear loops. These rules
and their failure/lifecycle details belong to the editing design.

**Alternatives considered:** private View-owned editors; duplicate visual
editor tags for every existing surface; application-only playback glue; full
PCM undo snapshots; and immediate live replacement or complete DAW scope.
Each leaves unclear ownership, duplicates behavior or couples the first useful
editing workflow to substantially broader work.

**Consequences:** refine DEC-001's application-only undo boundary: optional
single-document history is domain-owned; global/project history remains in the
application. Extend DEC-015's passive View contract with opt-in editing and local
keyboard interaction, without making a toolbar mandatory. Extend DEC-011/017
with document ownership and applied-revision compatibility while preserving
existing passive source precedence. Staff input and multi-track editing retain
separate scope decisions. Product, Architecture and family/binding owners adopt
this target in P0. Actual exports, executable policies, references and demos
change together when each implementation layer exists, not as empty scaffolds.

**2026-11-04 refinement:** [DEC-055](#dec-055--editing-is-a-view-feature-not-a-capability)
moves the editor, declaration and operations into View and Audio sequence
export into Play. The ownership and playback contract above is unchanged; the
separate Edit capability, its `/edit*` entries and the Edit-to-Play loader
exception no longer exist.

**2026-11-04 refinement:** [DEC-057](#dec-057--editable-documents-are-an-api-not-a-web-component)
replaces the nonvisual `score-document` / `audio-document` declarations and the
`editor="#id"` selector with application-owned editors created through
`loadScoreEditor` / `loadAudioClipEditor` and lent through `.editor`.

**2026-11-04 refinement:** [DEC-058](#dec-058--score-editing-moves-to-a-dedicated-grid-view)
moves Score note editing from `<score-view>` to `<score-grid-view>`; `<score-view>`
is read-only and Score staff editing is removed.

**Owner:** [Editing contracts](design/EDIT-COMPONENTS.md). The
[dated proposal and implementation sequence](plans/2026-10-13-editing-capabilities.md)
retains the planning baseline.
[STATUS](STATUS.md), EDIT-01, owns current delivery tracking.

**Verification implications:** demonstrate MIDI edit/undo/playback/export
consistency, document/playback revision acknowledgement and failed/canceled
replacement behavior; demonstrate Audio structural history and playback without
full-PCM copies per edit. Verify source conflicts, late binding, resource release,
keyboard/pointer behavior and application-owned history through all supported
integration forms. Accepted target syntax must not enter current public
references as though it were shipped.

<a id="dec-048--staff-input-inside-the-existing-score-view"></a>

## DEC-054 — Staff input inside the existing Score View

**Identifier note:** drafted as DEC-048 on the editing branch; registered as
DEC-054 when the branches merged. Dated editing records before 2026-10-21 that
say DEC-048 mean this decision.

**Date / status:** 2026-10-15; accepted for P4 implementation. Current
verification and remaining interaction checks belong to [STATUS](STATUS.md), EDIT-01.
**Superseded 2026-11-04** by [DEC-058](#dec-058--score-editing-moves-to-a-dedicated-grid-view):
staff input, its Headless controller and its browser adapter are removed. The
entry below is the record of the bounded P4 contract that shipped on the branch.

**Problem:** notation entry needs an explicit input mode, written spelling,
duration, staff and voice, plus measure completion. Piano-roll gestures do not
provide those semantics. A separate tag would duplicate the same document,
player binding and scrolling notation renderer without establishing a different
resource lifecycle.

**Chosen contract:** retain `<score-view type="staff" editor="#document" editable>`.
A separate nonvisual staff-input controller owns only local cursor and entry
settings. A browser adapter reuses the existing scrolling staff renderer and
handles keyboard input only on its focused input surface. Enabling `editable`
permits editing; an explicit note-input mode arms A–G entry. Escape disarms it.
The shared `ScoreEditor` remains the sole content and history owner, so undo from
either staff or piano roll can reverse the other surface's latest command.

An atomic notation-entry command uses rational written quarters and preserves
pitch spelling and duration notation. It fills the chosen voice/staff's gaps
inside an existing measure with actual rest notes. Other voices and staves are
unchanged. Entry cannot cross a measure boundary or silently truncate sounding
notes. Unsupported tied, tuplet, grace, chord and other grouped structures fail
explicitly. MIDI-derived synthetic display bars are not authored measures;
this first input contract requires a real measure grid supplied by MusicXML or
the application. It does not infer a notation score from arbitrary MIDI.

**Alternatives considered:** a new `score-staff-editor` tag; reusing piano-roll
shortcuts; storing auto-rests only in renderer state; and automatically rewriting
complex or unmeasured music. The chosen boundary shares existing resources while
keeping notation operations explicit and atomic.

**Consequences:** extends DEC-053's editable View subset to staff without adding
an Element or an Edit-to-View dependency. The optional OSMD sheet renderer stays
separate and passive. Complete engraving, chord/tie/tuplet authoring, measure-grid
editing and page layout remain outside this bounded P4 delivery.

**Owner:** [Editing contracts](design/EDIT-COMPONENTS.md),
[Score View family](design/VIEW-COMPONENTS.md) and
[scrolling notation](design/STAFF-NOTATION.md).

**Verification implications:** test local focus and armed entry, pitch/duration
shortcuts, exact rests and independent voices, structural rejection, shared undo,
playback revision application and MIDI silence for rests. Verify passive staff
and separate input instances retain their behavior. Browser keyboard evidence,
pointer behavior and visual/accessibility acceptance are recorded separately.

## DEC-055 — Editing is a View feature, not a capability

**Date / status:** 2026-11-04; accepted at the maintainer's request before the
editing work is published. Supersedes the entry and capability layout of
[DEC-053](#dec-053--document-owned-editing-and-borrowed-playback); its
document-ownership, history and playback-binding contract is retained.

**Problem:** DEC-053 delivered editing as a fourth capability family beside
Play, Analyze and View, with `/edit`, `/edit/headless`, `/edit/element` and
`/edit/auto` entries, separate documentation groups and its own policy rows.
Every editing surface is an existing View, so the extra family added navigation,
entries and checks without a different user-facing role.

**Chosen contract:** document editing extends View in both domains. The View
API root exports semantic operations, position maps, document contracts and
Audio range-processor recipes. `/view/headless` exports `ScoreEditor` and
`AudioClipEditor`. `/view/element` exports `<score-document>` and
`<audio-document>`; `defineAllViewElements()` and Audio's
`defineAllAudioElements()` register them, and `@webmusic/audio/view/auto`
registers `<audio-document>`. Score View keeps explicit registration and gains
no `/auto` entry. Rendering and WAV export of an edited Audio sequence join the
existing Play export API. The Score–Audio and Core boundaries are unchanged.

**Alternatives considered:** keeping the package entries and only hiding Edit
in the documentation, which leaves a public family the site does not present;
and letting each View create a private editor without a declaration, which
loses one shared document and history across several Views and the player.

**Consequences:** no `/edit*` entry is published; the unpublished editing
release needs no compatibility aliases. Audio View already depends on Play, so
the `<audio-document>` URL loader uses the ordinary View-to-Play edge and the
importer-specific exception is removed. Element composition, catalogs, build
entries, side-effect lists, reachability rules and documentation routes list
the editing pieces under View. The View API root still cannot reach its
Headless, render or Element layers, so editors are imported from
`/view/headless`.

**Owner:** [Editing contracts](design/EDIT-COMPONENTS.md) and
[Architecture](ARCHITECTURE.md).

**Verification implications:** package policy, architecture and documentation
checks must find no Edit capability; built-entry tests must load the editing
values from the View and Play entries with shared Core identity; demos and
snippets must import only published View/Play subpaths.

## DEC-056 — Score View draws three types; annotations only on staff

**Date / status:** 2026-11-04; accepted at the maintainer's request. Refines
[DEC-015](#dec-015--type-selected-score-view-families).

**Problem:** `<score-view>` mixed three full renderers with a navigation strip
(`map`) and a static preview (`thumbnail`), each with its own attributes, event
and styling token. Score expression annotations were also drawn three different
ways: in a strip above the piano roll, in a rail beside the waterfall and on the
staff. Only staff notation places expressions where musicians read them.

**Chosen contract:** `<score-view type>` accepts exactly `piano-roll` (default),
`staff` and `waterfall`; any other value falls back to `piano-roll`.
`ScoreViewElementType` equals `ScoreViewType`. The element no longer has
`for-part`, `cells`, `webscore:seek`, `ScoreViewSeekDetail` or
`--wm-score-view-map`, and no longer composes the UI timeline. Only the staff
draws annotations: `showAnnotations` belongs to `StaffRenderOptions` and the
React `StaffView`, `show-annotations` affects only `type="staff"`, and
`validateScoreViewConfiguration` rejects it for the other types. Piano roll and
waterfall reserve no annotation space.

The underlying pieces stay public: Headless `createScoreMapView`, the
`createScoreMap` layout, the `@webmusic/ui/timeline` presenter (now a
standalone presenter) and the `/view/render` thumbnail renderer with its own
overview annotations. Applications that need a map or preview compose them
directly.

**Alternatives considered:** separate `score-map` / `score-thumbnail` tags,
which DEC-015 already rejected for duplicating input and binding; and keeping
annotations off by default on piano roll and waterfall, which would not make
them staff-only.

**Consequences:** this changes behavior published in `0.2.0`; the
[editing migration guide](release/EDITING-MIGRATION.md) records the upgrade.
Element composition lists `score-view` with `stage` and `status` only. The
internal horizontal and vertical annotation drawers and the map annotation
layer are removed with their tests.

**Owner:** [View component families](design/VIEW-COMPONENTS.md).

**Verification implications:** type parsing and fallback; type switches
without reload across the three types; staff-only forwarding of
`show-annotations`; configuration rejection for other types; piano roll and
waterfall render no annotation marks; the retained map, timeline and thumbnail
APIs keep their own tests.

## DEC-057 — Editable documents are an API, not a Web Component

**Date / status:** 2026-11-04; accepted at the maintainer's request before the
editing work is published. Refines [DEC-053](#dec-053--document-owned-editing-and-borrowed-playback)
and [DEC-055](#dec-055--editing-is-a-view-feature-not-a-capability).

**Problem:** `<score-document>` and `<audio-document>` were nonvisual Elements
that loaded a file, owned an editor for their connected lifetime and were found
by players and views through `editor="#id"`. A document is application data, not
something rendered. Tying its lifetime to DOM connection and selector discovery
added loading state, reload races, selector-resolution states and source-change
events that an application owning the editor does not need.

**Chosen contract:** remove both Elements and the `editor` selector attribute
from `score-player`, `score-view`, `audio-player` and `audio-view`. Add
`loadScoreEditor(url, options)` and `loadAudioClipEditor(url, options)` to the
domain's `/view/headless`, next to `createScoreEditor` / `createAudioClipEditor`.
They combine the existing loader options (format, AbortSignal, limits and, for
Audio, an injectable decode loader with the default fixed to non-streaming and no
implicit AudioContext) with the editor options, and reject without creating an
editor when loading fails. The application owns the editor, assigns it through
each Element's `.editor` property and disposes it; Elements borrow it and never
dispose it. Source-conflict, playback-application and editable rules are
unchanged.

**Alternatives considered:** keeping the Elements beside the API, which leaves two
ownership models to document and test; and keeping `editor="#id"` pointing at
any element exposing `.editor`, which has no built-in owner to point at.

**Consequences:** the Elements, their exports, catalogs, pages and playground
demos are removed; demos create editors in script. No migration is needed for
published packages because neither Element was released. Kernel's
`observeElementSource` remains as the Elements' explicit-object adapter.

**Owner:** [Editing contracts](design/EDIT-COMPONENTS.md).

**Verification implications:** loader success and failure, format validation,
abort, option forwarding and no editor on failure; Element binding through
`.editor` only, with `editor` no longer an observed attribute; existing conflict,
lifecycle and playback-application tests rewritten to assign editors directly.

## DEC-058 — Score editing moves to a dedicated grid View

**Date / status:** 2026-11-04; accepted at the maintainer's request before the
editing work is published. Supersedes [DEC-054](#dec-054--staff-input-inside-the-existing-score-view)
and refines [DEC-053](#dec-053--document-owned-editing-and-borrowed-playback)
and [DEC-055](#dec-055--editing-is-a-view-feature-not-a-capability).

**Problem:** `<score-view>` mixed three read-only renderers with two editing
surfaces: a piano-roll editor that replaced the canvas piano roll whenever an
editor was bound, and bounded staff input. Its `editable` attribute meant
something different per `type`, the piano-roll editing surface had no grid,
ruler, keys, snap choice, velocity editing or zoom, and features could not be
withheld by the application. The maintainer asked for `<score-view>` to stay a
display and for note editing to look and behave like a DAW piano roll.

**Chosen contract:** `<score-view>` is read-only. It keeps `.editor` and
`.interactionSession` as a read-only follow: it draws the editor's visible
content, including a shared draft, with its normal renderers and follows a bound
player only through document-compatible snapshots. It no longer has `editable`,
`data-editable-state` or edit events, and its piano-roll options no longer
include `pixelsPerQuarter` / `editingGrid`.

A new `<score-grid-view>` draws a piano-roll grid: written-pitch rows with piano
keys, bar/beat/snap lines from the score's time signatures, a bar ruler and an
optional velocity lane. It reads `.score`, `src`, a player's score or a borrowed
`.editor`, and follows `player` like the other score Views. Editing requires a
ready `.editor` and `editable`; a one-row icon toolbar then appears along the
top of the grid window, with names in accessible labels and tooltips. The piano
keys, ruler and velocity lane are sticky layers that stay in place while the
notes scroll. `tools` lists the
offered features — `move`, `resize`, `draw`, `delete`, `velocity`, `snap`,
`zoom`, `history` (absent means all). Selection is always available while
editing. The toolbar picks the pointer tool (`select` / `draw`), snap, velocity
lane and zoom; those are also `tool`, `snap`, `velocity-lane`,
`pixels-per-quarter` and `note-height` attributes, which toolbar, wheel and
keyboard changes reflect and announce with `gridsettingschange`. Each gesture is
one atomic editor command, so history, playback revision application and shared
sessions are unchanged. A collapsible numeric form keeps a non-pointer path to
every edit. The renderer is `mountScoreGrid` in `/view/render`; the two Elements
share one data/player/editor binding base. Score staff editing — Headless
`createStaffViewEditing`, render `mountStaffEditor`, and staff input — is
removed; the notation-entry Core operation remains.

**Alternatives considered:** a `type="grid"` on `<score-view>`, which keeps an
editing-only attribute set on a multi-type Element; per-feature boolean
attributes, which multiply attributes without a natural default; keeping staff
editing as a Headless API with no Element; and a separate editing toolbar
Element, which would need its own binding to the grid's interaction state.

**Consequences:** applications that edited through `<score-view editable>` use
`<score-grid-view editable>`. Neither was published, so no package migration is
needed. Audio editing on `<audio-view>` is unchanged. Staff/notation editing is
out of scope until a new decision; the passive staff and sheet Views are
unaffected.

**Owner:** [Editing contracts](design/EDIT-COMPONENTS.md) and the
[Score View family](design/VIEW-COMPONENTS.md).

**Verification implications:** read-only `<score-view>` with a bound editor and
shared draft; grid display without an editor; every feature gated by `tools` in
both toolbar and gestures/keys; draw, marquee, move with and without snap,
resize, velocity-lane commit, zoom bounds and settings reflection; editor
attachment cleanup and playback application retargeted from the old piano-roll
surface. Browser pointer, keyboard, focus and visual acceptance are recorded
separately.

## DEC-059 — One required visual language for all UI

**Date / status:** 2026-11-04; accepted at the maintainer's request. Makes
Design principles §7 concrete; does not change any public API.

**Problem:** the neutral-palette and square-geometry principle lived only as
prose in Design principles, and the frontend skill and workflow were framed as
review steps. New UI could therefore be built without consulting them: the
first `<score-grid-view>` toolbar used rounded text buttons, a blue note
default, native menus, visible scrollbars and instructions inside the canvas,
and had to be redone.

**Chosen contract:** [Visual design](design/VISUAL-DESIGN.md) is the required
visual language for every visible UI — presenters, Element surfaces, renderer
controls and the component area of demos. It fixes the neutral token palette,
square one-height controls, mono captions, square line icons, single-row icon
toolbars, in-component adjustment cards over a scrim with modal focus, hidden
scrollbars with sticky labels, no explanatory text inside components, and demo
configuration in Parameters, with an acceptance checklist. AGENTS, the
frontend skill and workflow, and the rule map route every UI change to it
before coding.

**Alternatives considered:** leaving the principle as prose and fixing drift
in review, which repeats the rework; and a UIKit theme package, which would
not cover renderer-owned surfaces such as the grid.

**Consequences:** existing components that predate it remain until touched;
a component change brings the touched surface into line. Adjustment cards are
currently implemented by the grid renderer; a shared UIKit card presenter is
the reuse target when a second component needs one.

**Owner:** [Visual design](design/VISUAL-DESIGN.md).

**Verification implications:** the visual checklist and browser comparison
beside an existing component are part of UI acceptance; automated checks do
not establish visual conformance.

## DEC-060 — Sheet View engraves its own pages and edits notation

**Date / status:** 2026-11-04; accepted at the maintainer's request. Replaces
the OpenSheetMusicDisplay sheet renderer and refines
[DEC-058](#dec-058--score-editing-moves-to-a-dedicated-grid-view), which left
notation editing out of scope.

**Problem:** `<score-sheet-view>` depended on the optional
OpenSheetMusicDisplay peer. It could not be edited, it followed only note
events, and its asynchronous engine, injected constructors and separate ink
model differed from every other View. The maintainer asked for a sheet that is
drawn by WebMusic itself and edited like a notation program such as MuseScore,
with selectable, movable and enterable notes, as the grid does for piano roll.

**Chosen contract:** the staff engraver gains an internal system mode: it
engraves a measure range, restates clef and key at the system start, and
justifies to an exact width by spreading spare width over columns by duration
weight. `mountScoreSheet` in `/view/render` measures natural measure widths,
breaks them into systems and stacks systems on A4 pages (`layout="page"`) or
in a column (`layout="flow"`); `zoom` scales the staff. `<score-sheet-view>`
shares the data, player and editor binding of the other score Views. With a
ready `.editor` and `editable` it shows a one-row icon toolbar and edits through
four new Core operations — `set-pitches`, `notes-to-rests`, `tie-notes` and
`write-notation` — that act locally on the named events, so they work in real
scores with beams, slurs, chords, voices and tuplets. `tools` gates `pitch`,
`input`, `duration`, `tie`, `accidental`, `delete`, `history` and `zoom`.
OpenSheetMusicDisplay is removed from the package: `renderOSMDStaffVisualizer`,
`OSMDStaffOptions`, the React `StaffView` `osmd` prop, the element's
`OpenSheetMusicDisplay`/`osmd` properties, the optional peer and its site
license supplements. MuseScore is a reference for interaction and layout
behavior only; no GPL code is used.

**Alternatives considered:** keeping OSMD for display and adding an editing
overlay, which leaves two engraving models and an optional peer; a new
SMuFL engine written from scratch, which would trail the existing VexFlow
engraver for a long time; and extending `enter-notation`, whose whole-measure
rewrite rejects most measures of real scores.

**Consequences:** the sheet needs no peer and follows players like the grid.
Applications that used OSMD through the package must render it themselves.
Rewriting tuplet or grace rhythms, chord and voice entry, tuplet entry and
ties or slurs drawn across system breaks are not offered yet and are tracked
in STATUS.

**Owner:** [Editing contracts](design/EDIT-COMPONENTS.md#score-sheet-editing),
[Score View family](design/VIEW-COMPONENTS.md) and
[scrolling notation](design/STAFF-NOTATION.md).

**Verification implications:** system justification and clef/key restatement,
page and flow layout, each operation's local behavior and refusals, keyboard
pitch/input/duration/delete paths and feature gating are covered by unit tests;
engraving quality, pointer drags and playback following need browser and
visual acceptance on a real score.

## DEC-061 — Audio editing moves to a dedicated clip View

**Date / status:** 2026-11-04; accepted at the maintainer's request. Applies
[DEC-058](#dec-058--score-editing-moves-to-a-dedicated-grid-view) and
[DEC-060](#dec-060--sheet-view-engraves-its-own-pages-and-edits-notation) to
Audio.

**Problem:** Audio editing was a mode of `<audio-view>`: `editable` applied only
to `type="waveform"`, was switched off by `annotate`, and overlapped
`interactive`, `drag-mode` and `scrollable`. Its controls were text buttons and
native selects in a collapsible form, with instructions drawn inside the
component, contrary to DEC-059. Segment gain and fades could be set only by
typing numbers; segments, fades, gain and markers were not drawn.

**Chosen contract:** `<audio-view>` is read-only. With `.editor` it draws the
document's waveform and follows its playback, but it has no `editable` and no
edit events. A new `<audio-clip-view>` (renderer `mountAudioClip` in
`/view/render`) is a waveform editor modeled on Adobe Audition's waveform view
and DAW clip editors; it shares no code with them. It draws a time ruler with
markers, one lane per channel with segment boundaries, fade handles, a segment
gain line and an optional envelope lane, and edits a borrowed `AudioClipEditor`
when `editable`. `tools` offers `split`, `delete`, `clipboard`,
`trim`, `silence`, `gain`, `fade`, `envelope`, `markers`, `process`, `snap`,
`zoom` and `history`; range selection is always available. Range amplify, range fades with linear, logarithmic or
cosine curves, and silence are non-destructive splits plus `set-gain`,
`set-envelope` or `splice`; normalize, reverse, invert and DC-offset removal are
range processors. A new Core `set-annotations` operation edits markers. Snap
offers zero crossings and time grids. Every edit is one atomic editor command.

**Alternatives considered:** keeping `editable` on `<audio-view>` and only
restyling it, which keeps a type-dependent attribute set on a multi-type
Element; and destructive sample editing, which would copy PCM for every gain or
fade change.

**Consequences:** applications that edited through `<audio-view editable>` use
`<audio-clip-view editable>`; editing was never published, so no package
migration is needed. `mountWaveformEditor` is replaced by `mountAudioClip`.
Spectral editing, multitrack arrangement and real-time effects remain outside
this View.

**Owner:** [Editing contracts](design/EDIT-COMPONENTS.md#audio-clip-editing) and
[Audio View components](design/AUDIO-VIEW-COMPONENTS.md).

**Verification implications:** the operations and range helpers, snapping,
tool gating, gestures and keys are unit tested; waveform drawing, handle
dragging, playback following and long-recording performance need browser
acceptance.

## DEC-062 — A document beat grid read through a Kernel tempo clock

**Date / status:** 2026-11-04; accepted at the maintainer's request. Extends
[DEC-061](#dec-061--audio-editing-moves-to-a-dedicated-clip-view) and the
shared-clock direction in [platform/shared-clock-injection.md](../platform/shared-clock-injection.md).

**Problem:** Audio had a `BeatGrid` on decoded clips and a Kernel
`TimelineMapping`, but no editable grid on a document and no way to read beats
from a running transport. DJ-style control — a grid laid over the waveform,
fine adjustment while listening, beat snap, quantized seeking and beat jump —
needs one grid that both the editor and the player see, and a beat reading
taken from the same clock that plays.

**Chosen contract:** Kernel's transport entry gains a domain-neutral
constant-tempo `TempoGrid` (`bpm`, `anchor` downbeat position, `beatsPerBar`),
pure helpers (`tempoGridPosition`, `snapToTempoGrid`, `tempoGridJump`,
`tempoGridLines`, `tempoGridMapping`, `tapTempo`) and a read-only `TempoClock`
that pairs a `TransportClockReader` with a grid (`beatAt`, `positionAt`,
`nextGridTime`, `timeAtBeat`). An `AudioSequence` may carry an optional
`beatGrid` (`bpm`, fractional `anchorFrame`, `beatsPerBar`) changed only by
the new `set-beat-grid` operation, so grid edits are undoable document
commits. The anchor follows content edited before it and keeps its bar phase
through deletions; edits after it leave the grid in place. A revision whose
timeline is unchanged (same format, length and segments, identity position
map) — a grid or marker edit — is applied by a player in place without
pausing. `AudioPlayer` exposes `tempoGrid` and `tempoClock` for the applied
document (or a clip's `BeatGrid`). `<audio-clip-view>` gains the `grid`
feature, the `grid`, `quantize` and `grid-edit` settings, `beat`/`bar` snap,
a Grid Edit toolbar mode modeled on DJ software (set downbeat, BPM field, tap,
1 ms nudges, 0.01 BPM stretch, ×2/×½, beats per bar, remove, drag to move),
quantized ruler seeks that keep the playing beat phase, and PageUp/PageDown
beat jump.

**Alternatives considered:** a grid held only by the View or the player, which
would give the editor and the player different grids and no undo; a variable
(beat-list) grid, which DJ workflows rarely need first and which needs a
warp-marker contract; and making every revision pause playback, which makes
adjusting the grid while listening impossible.

**Consequences:** DEC-053's pause-on-revision rule now applies to revisions
that change what plays; metadata-only revisions keep playing. A constant grid
cannot follow rubato or edits after its anchor; dynamic grids remain open. The
`TransportGroup` still coordinates positions, not beats; beat-synchronous
group commands are a later step.

**Owner:** [Kernel API](../doc/src/content/docs/kernel/api.mdx),
[Audio clip editing](design/EDIT-COMPONENTS.md#audio-clip-editing) and the
[clip View reference](../doc/src/content/docs/audio/element/view/audio-clip-view.mdx).

**Verification implications:** grid math, the operation and anchor mapping,
in-place revision application, the Grid Edit tools, tap tempo, snap, quantize
and beat jump are unit tested; audible alignment, drag feel and long-recording
drawing need browser and listening acceptance.
## DEC-063 — Modular composition separates resources, routing and Session authority

**Date / status:** 2026-10-14; accepted contract baseline for the maintainer's
modular redesign. The 2026-10-15 first-delivery implementation adds opt-in
runtime APIs; existing default composition remains unchanged. Current
verification is recorded in [STATUS](STATUS.md).

**Problem:** nested players, Rack controls, synth panels and analysis need to
reuse existing engines, effects and parameters. DOM containment and shared
configuration alone cannot determine resource ownership, audio routing or
transport authority, and can create duplicate processing or scheduling.

**Decision:** use capability-based Headless modules with stable identity,
typed ports, parameter handles and precise connection/registration leases.
Keep DOM layout, resource ownership, signal connections and Session membership
independent. Borrowed source data, player resources and scheduling authority
are separate capabilities. Source role and Session ownership are separate
configuration dimensions.

Headless callers pass a ModuleContext; Elements discover borrowed capabilities
through one scoped request protocol without hard-coded provider tags. A Rack
provides channels, a real summing/master bus and default route slots. Explicit
patches replace only named defaults; taps and sends are independent. Failed
replacement preserves the working graph, and a lost explicit target never
silently restores speaker output or borrows another target.

In the new opt-in mode, the outermost player supplies Session authority and
nested players participate unless explicitly independent. A source-free root
uses a Headless SessionTransport; it fabricates neither a Score nor an audio
output and does not select its first child as master. Each engine registers once.
Rack mixes and passes through Session authority. A Session provider is not an
implicit audio master; common processing uses an explicit Rack/bus.

Effect definitions and live EffectInstances remain distinct. A shared InsertChain
contract preserves same-context boundary ports, candidate rollback and the
existing `.effect` stage through a compatibility slot. Attached panels edit the
same parameter/effect instances and own no target DSP; standalone insert hosts
retain ownership of their Headless runtime and existing port/section semantics.
ParamSurface enumerates parameter handles; ParamMapping defines controller
scaling and modulation, rather than conflating those ranges with parameter limits.

**Alternatives considered:** infer all relationships from DOM tags; rebuild
players when effects change; copy effect recipes into each panel; make every
Rack a transport; or introduce a generic framework and move all DSP into Kernel
before reconciling domain lifecycle contracts. These choices couple independent
resources or hide duplicate state and unsupported behavior.

**Consequences:** the contract adds an opt-in composition path. Existing Score
Play roles (DEC-016), legacy Rack seek axes, and AudioPlayer's single-backend
facade without an additional clock (DEC-029) remain intact outside that path.
Session commands extend DEC-018's axis, revision and cancellation guarantees;
same-instance clock consumption remains governed by the existing clock design.
One member leaving cancels only its own scheduled work.

Score and Audio remain independent packages. Neutral audio/control capabilities
can interoperate structurally; Bridge owns composition requiring both domain
models or time mappings. UI keeps structural bindings without importing Kernel
or domain types. Shared effect mechanisms are extracted only after lifecycle
behavior is reconciled. The first delivery adds Kernel `/module` and `/session`,
with shared InsertChain in `/effect`, and domain Play adapters. It introduces
no mandatory DSP package, retired tags or wholesale effect-catalog migration.

**2026-11-06 refinement:** under [DEC-068](#dec-068--modular-composition-is-the-only-composition-model), the opt-in consequence is superseded. There is no `composition` attribute and no legacy discovery path; the rest of this decision applies to every instance.

**Owner:** [Modular composition](design/MODULAR-COMPOSITION.md),
[Architecture](ARCHITECTURE.md), the two Play contracts and [Status](STATUS.md).
The modular contract owns invariants and target examples; concrete signatures
and public entries are reviewed with their implementing steps.

**Verification implications:** the contract's MC-01 through MC-19 scenarios
cover capability discovery, resource leases, exact routes, effect sharing,
Session registration, compatibility and later sound/precision work. Add focused
tests with each implementation and perform combined browser/audio acceptance for
the first delivery. Step one established the documented baseline; the runtime
steps require independent focused and combined evidence. Neither a static
check nor an implementation decision establishes audible timing precision.

## DEC-064 — Session scheduling is a borrowed anchor; projects store declarative identity

**Date / status:** 2026-10-15; accepted for the maintainer's third modular
delivery (steps 11–12). Current verification belongs in [STATUS](STATUS.md).

**Problem:** a shared start command alone cannot invalidate notes, source starts
or automation already submitted to the audio system. Saving live objects cannot
restore their ownership, and a visual connection editor must not introduce a
second graph or transport authority.

**Decision:** keep one Session command writer and lend schedulers an immutable
`SessionSchedulingBinding`. Its authority identity, local named axis, epoch and
reference-time anchor are distinct from presentation revisions. Invalidate old
scheduled work before publishing the new anchor. Map Session seconds to local
seconds explicitly, with finite offset and positive scale. The continuous clock
and loop-folded scheduling segments are separate reads. Native schedulers can
submit work on both sides of a loop before its boundary; legacy followers retain
their explicit coordinated fallback.

Session-bound automation and cyclic modulation derive time from this binding,
with declared pause, seek and loop semantics. This does not upgrade a media
element, external instrument or callback-only parameter to native audio-rate
precision. Release tails and graph switching retain explicit backend limits;
successful scheduling does not establish acoustic synchronization at a device.

Effect switching is explicit: ordinary InsertChain keeps instance reuse and
immediate retirement, while `TransitionInsertChain` creates fresh owned
generations with native linear crossfade and an optional finite tail budget.
External ports remain stable; parameter/CV/automation identity stays with its
generation. Retiring graphs are bounded and clean up on the audio clock. This
policy does not silently change every existing component effect setter.

Kernel owns a versioned, bounded JSON `ModuleProject` contract and its realized
`ModuleProjectRuntime`. The document records stable module/context/port IDs,
exact plugin versions, asset references, base parameters, connections, modulation,
macros, automation and Session state. Layout is separate from routing. A
factory registry resolves code already supplied by the application; project data
never loads executable code. The application resolves assets and owns storage,
file import/export, history and undo.

Restore validates data and stages a fresh graph behind its own output boundary.
The staged graph owns its Session, modules and leases while borrowing the audio
environment. Failed or superseded work releases only its candidates. Missing
plugins and unsupported endpoints remain inspectable unresolved records; their
specifications survive export and explicit retry. A restored Session is paused
unless the caller explicitly requests playback. Commit and retirement are
logical graph operations, not a hardware-atomic or crossfaded audio transaction.

UI Kit exposes a structural patch-editor binding. The presenter displays
authoritative state and submits connect, disconnect and layout commands; it owns
only DOM and subscriptions. Native select controls and named port buttons offer
keyboard equivalents, layout movement keeps stable IDs, and unresolved routes
remain visible with text diagnostics.

**Alternatives considered:** lend every engine a writable clock; let watcher
ticks define native loop boundaries; serialize AudioNodes or component trees;
execute plugin URLs from a saved document; or let the editor own a parallel
graph. Each obscures cancellation, resource ownership or recoverable identity.

**Consequences:** DEC-063's separation of context, audio and transport remains.
Kernel is domain-neutral; Bridge supplies factories that know Score and Audio,
and UI imports neither. Existing standalone clocks, absolute audio-clock
automation and legacy group APIs retain their contracts. Projects do not include
sample payloads, device state, current voices or undo stacks. Renaming and layout
changes need not recreate DSP; topology restoration may replace owned engines
and cut their tails. Unsupported schema/plugin versions require explicit
migration or registration rather than guessed compatibility.

**Owner:** [Shared-clock design](../platform/shared-clock-injection.md),
[Modular composition](design/MODULAR-COMPOSITION.md), the Kernel/Bridge/UI public
references and [Status](STATUS.md).

**Verification implications:** exercise cancellation before re-arming,
non-unit rate/offset mapping, loop-crossing work and independent authorities.
Verify rendered/submitted timing separately from UI notifications. Round-trip
projects with renamed/reordered modules, missing plugins, failed asset loads,
late restores and borrowed contexts. Test keyboard wiring, focus, diagnostics,
narrow layouts and restoration through the public runnable example. Static
checks alone establish neither sound precision nor device behavior.

## DEC-065 — Provider scope changes separate in-place re-routing from rebinding

**Date / status:** 2026-10-21; accepted with the modular release-candidate review
fixes. Audio Elements adopt it; Score adoption is MOD-13 in [STATUS](STATUS.md).

**Problem:** a provider republishes its context when its target, destination,
admission, Session or audio environment changes. Treating every republication
alike either ignored a new destination, leaving Audio routes on the old node, or
rebuilt engines, Session membership and desk mixes for a change that moves one
default route. Each domain also kept its own scope comparison and route lease,
and those copies had already drifted.

**Decision:** Kernel classifies a republished context with
`moduleScopeChange(previous, next)`: `none` when the audio environment, Session,
registry, admission and destination resolver are identical (a new target alone
keeps the scope), `destination` when only the destination resolver changed, and
`scope` for any other change or a missing side. `sameModuleScope()` is the `none`
shorthand. On `destination`, a consumer keeps its engine, Session participant,
registrations and desk state; it re-derives its child context and replaces only a
default route. An admitted route belongs to the provider's desk and is unchanged.
On `scope`, it releases its route, registration and membership, then rebinds.
`routeModuleOutput(context, module, port)` is the single normal-route helper:
admission when present, otherwise the scope's default destination or speakers.
Its lease retracts only the default it installed.

Only a Session owner maps declarative transport state, such as `rate` and a
whole-Session `loop`, to Session commands; an inherited leaf never rewrites its
provider's transport. A participant's `ready` describes its latest preparation
attempt: a retried preparation replaces a rejected promise, and Elements report
each failed preparation, activation or attachment where it occurs.

**Alternatives considered:** compare scopes without the destination (stale
routes); rebuild on every change (lost mixes, cut notes and re-registration);
keep per-domain comparison and route code (silent drift between domains).

**Consequences:** Kernel `/module` gains three domain-neutral functions and no
domain types. Re-routing replaces one default edge within a task; it is not a
crossfade. Score Elements still use `sameModuleScope()` and rebind on a
destination-only change until MOD-13, so a mixed composition currently keeps
Audio state but recreates Score engines and Rack channel state.

**2026-11-06 refinement:** under [DEC-068](#dec-068--modular-composition-is-the-only-composition-model), the classification applies to every module, including Score (MOD-13). Sound, source-data and parameter changes also edit a module in place; only a scope change rebinds.

**Owner:** [Modular composition](design/MODULAR-COMPOSITION.md), the
[Kernel API](../doc/src/content/docs/kernel/api.mdx) and the Audio
player/mixer Element references; [Status](STATUS.md) owns MOD-13.

**Verification implications:** unit tests cover classification, routing leases,
nested-leaf rate and loop, in-place re-routing that retains the engine, Session
membership and desk levels, and per-attempt failure reporting. Audible and
browser behavior of a destination change during playback remains a manual
check under VERIFY-01.

## DEC-066 — Demos use only the owner-maintained Arabesque No. 1 files

**Date / status:** 2026-11-04; accepted by the repository owner. Supersedes the
generated *WebMusic Study No. 1* demo media.

**Problem:** the modular source tree had replaced the Arabesque No. 1 demo files
with a generated study and its generator, inventory and hash gate. Demos and
examples then drifted between pieces and generated fixtures, and the owner's
choice of demo music was not stable across branches.

**Decision:** `apps/doc/webmusic/public/` is maintained by the repository owner
and is read-only for agents. Every musical demo, playground, Headless or
programmatic demo, copyable snippet, Parameters placeholder and documentation
example uses Arabesque No. 1 from it: MXL for notation, MIDI for Score playback
and editing, WAV for decoded audio and MP3 for native decode or streaming. A
shorter demo uses a passage of the piece. Generated studies, hand-built note
lists and synthesized PCM stay in automated tests. `scripts/demo-assets.mjs`,
`apps/doc/webmusic/assets.json` and `check:demo-assets` are removed;
`check:demo-music` checks every documentation media reference against the four
files and only reads the folder. AGENTS.md states the rule as owner-fixed.

**Consequences:** demos share one piece and one set of loaders. The restored
files have no established redistribution rights, so DEV-05 stays open and
deployment or a release that ships them waits for the owner's rights review. The
owner removed the former study's `public/licenses/` files. `public.sha256` pins
the approved folder contents, `check:demo-music` compares the folder with it, and
a local agent hook refuses tool edits to the folder or the pin.

## DEC-067 — Four-direction score and keyboard composition

**Date / status:** 2026-10-08; accepted by the maintainer's request and confirmed
scope: keyboard, piano roll and waterfall support four directions; staff,
fretboard, map and thumbnail keep their normal reading direction.

**2026-11-05 refinement:** [DEC-056](#dec-056--score-view-draws-three-types-annotations-only-on-staff)
removes the `map` and `thumbnail` types and limits score annotations to
`staff`. The four-direction contract below is unchanged for piano roll and
waterfall, which draw no annotations in any direction. The Element
`show-annotations` default of false now applies to the staff, the only type
that draws annotations; the imperative staff renderer keeps its default of true.

**Problem:** fixed horizontal keyboards and downward waterfalls prevent
applications from composing equivalent views at different sides of a musical
installation. ScoreView also displays advanced annotations before an application
has asked for them.

**Decision:** keyboard `direction` names the key fronts (`up`, `down`, `left`,
`right`; default `down`). Piano-roll direction names increasing score time
(default `right`); waterfall direction names note travel toward its landing
edge (default `down`). Low pitches remain left or bottom, and labels remain
upright. Width options retain pitch breadth and keyboard height options retain
key depth regardless of direction. Vertical pitch compositions supply a height.
The Element direction attribute is inert for other views; strict staff render
configuration rejects it. `.options.direction` overrides the ScoreView attribute.

Waterfall retains true natural/accidental pitch geometry in every direction;
piano roll retains equal semitone lanes. Several independent PitchViews can
borrow one player and align with a waterfall through common range, pitch
breadths and scroll container. No keyboard becomes part of the score renderer,
and no companion creates another transport or clock.

ScoreView Elements default `show-annotations` to false across all five types.
Explicit opt-in and `.options.showAnnotations` retain the existing precedence;
notes, rests and ordinary staff notation remain visible. Imperative renderers
retain their annotation defaults.

**Alternatives considered:** rotate the complete component with CSS; turn
staff/engraving alongside piano views; embed keyboards into the renderer; or
change imperative annotation defaults. These would rotate labels, disrupt
reading order, couple independent components or change unrelated API callers.

**Consequences:** coordinate mapping, cursor, time following, virtualization,
annotations and overflow use the selected axes. Changing direction retains
source and nominal playback position. UI remains domain-neutral and exposes
keyboard geometry through its existing presenter. The Arabesque composition
demo uses one player and independently mounted keyboards at opposite edges.

**Owner:** [View families](design/VIEW-COMPONENTS.md),
[ScoreView](../doc/src/content/docs/score/element/view/score-view.mdx),
[PitchView](../doc/src/content/docs/score/element/view/score-pitch-view.mdx)
and [UIKit pitch](../doc/src/content/docs/uikit/views-analysis/pitch.mdx).

**Verification implications:** all four directions, default and invalid values,
property/attribute precedence, unchanged bindings and source identity, exact
natural/accidental alignment, resize/follow/virtualization, native keyboard
scrolling, upright labels, annotations opt-in, and unchanged imperative defaults.
Browser acceptance remains distinct from DOM and geometry tests.

## DEC-068 — Modular composition is the only composition model

**Date / status:** 2026-11-06; accepted by the repository owner. Scope and
sequence: [Unified modular composition](plans/2026-11-06-unified-modular-composition.md);
delivery: STATUS MOD-15. Phase U0 fixes the detailed contract in
[Modular composition](design/MODULAR-COMPOSITION.md) and records which earlier
decisions it amends or supersedes.

**Problem:** the [2026-11-06 coverage audit](audits/2026-11-06-modular-coverage-audit.md)
found that only the Play audio graph uses DEC-063's modules. Views, Score
analysis, recorders, the playlist, MIDI input, documents, offline render and
outputs stay outside it, Kernel implements two of the five port families, and
every player keeps a second legacy composition path behind the
`composition="modules"` opt-in.

**Decision:** every source, instrument, processor, modulator, Rack, analyser,
view and sink is a module in one composition model with Kernel port families
`audio`, `note`, `control`, `transport` and `source`. The opt-in attribute and
the legacy discovery paths (descendant-Rack selection, `closest('audio-player')`
connections, `player=` companion binding) are removed rather than kept beside
it. A standalone player is a Session of one. The change ships in the
unpublished 0.3.0 and may break its public APIs; the release notes list each
break and its replacement.

**Alternatives considered:** make modular the default and keep a deprecated
legacy mode for one release; keep the opt-in and only extend coverage. Both keep
two composition semantics in every player and double the test and reference
surface.

**Consequences:** DEC-063's "opt-in" consequence and the compatibility promises
of DEC-011, DEC-016, DEC-017, DEC-018, DEC-029 and DEC-065 are reviewed in U0.
Pure data APIs (parsing, loading, offline analysis, conversions) remain
functions. Score and Audio stay independent; neutral contracts move to Kernel
and cross-domain mappings stay in Bridge.

**Verification implications:** a Kernel conformance kit runs against every
module factory; the architecture check rejects Elements outside the module
helpers and remaining legacy attributes; MC-01–MC-19 extend to the new port
families, sinks and companions before RELEASE-01.

**U0 contract (2026-11-06):** the [single composition model](design/MODULAR-COMPOSITION.md#single-composition-model)
fixes the module roles, port fields and schema IDs, the Element grammar
(`input`/`port`, `target`, `slot`, `session="local"`), outermost-provider Session
election and the Session of one, and the retired-surface table. That table
retires `LoopPlayer` (Session loop with repeat count), `AbPlayer` (named source
variants), `TonePlayer` (external participants), `PlayerController`,
`MidiPlayerController`, `bindClock` and the `Player` alias (transport port),
Kernel's public `/sync` entry, and Bridge's `ScoreAudioSync` family (Session
composition with Bridge axis mappings). DEC-011, DEC-016, DEC-017, DEC-018,
DEC-029, DEC-063 and DEC-065 carry dated refinements.

**Round 5 choice (2026-11-07):** measured against the test suites, forcing every
instance onto the module path failed 162 tests whose behavior exists only on the
legacy path (preset player UI, editor document binding, standalone synth panels
with LFO and envelopes, `.rack` and `.controller`). The owner chose to port all of
it into the module path and then delete the legacy path, adding rounds as
needed. `.rack` and `.controller` therefore move into the module path instead of
being retired; the retired-surface table is corrected accordingly.

**Round 10 choices (2026-11-07):** the companion selector is `input` everywhere,
including `<audio-mixer>`, whose `input="#id"` makes it that player's mix
backend instead of a Rack; no Element reads `player=` or `source=` any longer.
Audio analysers and the meter tap the linked module's audio port and follow its
Session transport (the player module now enumerates `audio`, `source` and
`transport` ports); the linked player element still supplies loading and error
status, and a bare element that only exposes `.analyser` is no longer an audio
source. An outermost `score-rack-control` owns a Session like an outermost
`audio-mixer` (MC-23). Kernel's `composition` boundary, `isModularComposition`
and the unused `MirrorClockMaster` are removed. The architecture check rejects
the retired attributes, markup and exports (MC-27).

**Rounds 11–16 choices (2026-11-07):** Score views and analysis share one
companion follower in Score core; Kernel `/element` owns companion discovery
(`observeCompanionInput`: explicit `.inputModule`, then `input`, then
containment, with a `port` attribute moving it onto a module's `webmusic.score`
source port), which Audio's companion helper also uses with its `port`
attribute reserved for audio taps. `score-note-input` is a note Source with a
`notes` output port and `score-recorder` a note Sink that records a selected
note output; inside a provider the recorder auditions a take as a Session-free
scope member, so the audition is routed like the scope without moving its
transport. A playlist plays into one queue bus with a stable `output` port, a
mixer lists `channel:<id>` taps, and a player over either lists that group's
output as its own (observed, never rerouted). A borrowed queue is one Session
participant on `queue-entry-seconds`, commanded through the Session by its
player and playing in the scope's AudioContext: Session time is the selected entry's time,
an entry change re-anchors the Session at 0 in one committed seek, and the
Session ends with the queue — we chose this over a cumulative queue axis because
unloaded entries have no known length. `.score` and `.sound` replace a mounted
Score engine in place (a score restarts the Session at 0; a sound that changes
the Session timing class still rebuilds), and `SessionParticipantLease.refresh()`
republishes a member whose duration changed in place. `renderModuleGraph()`
renders a whole graph offline with its own Session; the offline environment
presents its context as live until rendering and ticks lookahead schedulers in
rendered time.

**Round 17 choices (2026-11-07):** inside a provider, a `score-recorder`'s live
monitoring and take audition share one `output` bus routed once under the
recorder's module ID, so in a desk both are the recorder's own Rack channel —
we chose one recorder channel over admitting each audition as a new member
because a take is the recorder's sound, not a separate player. Bridge
`registerAudioParticipant` activates and attaches Session scheduling only for an
engine reporting `sharedSessionClock`, matching `<audio-player>`; other engines
are commanded. An `AudioPlayer` document-sequence scheduler takes its lookahead
ticks from the module environment's `createTickSource`, so offline renders
include edited Audio documents.

**Round 18 choices (2026-11-08):** manual device acceptance runs in a separate
`apps/test` workspace rather than on documentation pages, so checks can mount
compositions the reference pages do not show and keep a per-environment record
without adding test chrome to the site; its catalog is the single list of
manual checks and it reads Arabesque from the site's public folder without
copying it. A `ScorePlayer` that follows a Session never takes a direct
transport command, including while it replaces its score; the module stops the
Session first.

**Round 19 choices (2026-11-09):** a Session start instant reaches every member
that can honour it — `AudioPlaylist.play(when)` forwards it to the entry, and the
streaming engine, which cannot schedule a media element on the audio clock,
waits it out on a timer — rather than widening the drift tolerance, because a
constant 60 ms offset is audible against other members. An `<audio-player>`'s
editor document is its own Session source like a clip, never a borrowed group.
`ScorePlayer.replaceSynth` decides the timing class from the connected
candidate, since a `Sound` declares its capabilities only once its backend
exists. A Session transport control redraws every frame while the Session runs.

**Round 20 choices (2026-11-09):** every version an agent delivers carries its
own unit tests, runs them in CI through `npm run check`, and adds or updates the
manual checks for what only a person can judge; a release passes three gates
in order — CI on the exact commit, the local automated gate, then a person's
manual acceptance of that commit — and nothing is published before all three.
Manual results are never committed: we chose a Markdown report held by the
person who accepted the build, verified by `npm run release:acceptance` against
the release commit, over an audit table in Git, because a stored table goes
stale against the next commit and mixes evidence of different builds. The
runner keys its stored results to version, commit and working tree for the
same reason, is light and English only, and builds every check from the
packages' own components.

**Round 22 choices (2026-11-09):** manual acceptance is a conversation, not an
artifact. The owner tests a handed-off commit in the runner and reports what
fails; the agent fixes it as a new round and hands off the new commit; when the
owner says acceptance is complete, that statement is gate 3, and a merge into
`dev` or a release follows CI and the local gate on that exact commit and the
owner's instruction. This supersedes round 20's exported report and
`npm run release:acceptance`, which are removed: a stored report added a step
without adding evidence the owner had not already given in the conversation.
The runner keeps its per-build record and an optional Markdown export for
pasting findings.

## DEC-069 — Elements preload on mount; readouts keep one length

**Date / status:** 2026-11-09; accepted at the maintainer's request.

**Problem:** before the first play a composed desk showed a waiting mixer, an
effect panel reported "Module target unavailable" and a meter waited for its
player, because every module was prepared only by the first play. A parameter
readout changed length with its value (`1` → `0.15`) and printed descriptor
units such as `linear-gain`, so dials shifted sideways while they were turned.

**Decision:** a Session's owner preloads it on mount — `<score-player>` and an
outermost `<score-rack-control>` call `Session.preload()` as members join, and
`<audio-player>` preloads its first-play path by default. Preparation creates
the AudioContext in its suspended state, builds engines, loads samples, admits
desk channels and realizes their inserts, and never plays or resumes; the first
play resumes the context from its gesture. `preload="none"` restores the lazy
path, and a page without Web Audio skips the default. The default
`<audio-player>` preload waits for the connecting script, so an `.audioContext`,
`.clip` or `.player` assigned there is the one it prepares, and a late
`.audioContext` rebuilds a Session root's own environment around it. The
parameter rack gives every item one fixed width, shows one fixed count of
decimals per parameter (from its step, capped by its range's magnitude), and
shows physical units only; descriptors keep their machine units.

**Alternatives considered:** exposing channel and parameter structure without
audio resources, which would duplicate the Kernel Rack's admission and insert
model as a second, pre-audio state; preloading only in the acceptance runner,
which would leave every application with the same empty first frame.

**Consequences:** MODULAR-COMPOSITION's rule that discovery allocates nothing
still holds — preparation is an owner's mount action, not discovery. Pages
mounting several independent Session roots create one suspended context each
at mount instead of at first play. Score's lazy-inspection tests opt out with
`preload="none"`; new tests cover the default and the opt-out. Status feedback
(DEC-052) remains for genuinely missing input, such as a take player before
its first recording.

**Owner:** [Modular composition](design/MODULAR-COMPOSITION.md), the
`<score-player>`, `<score-rack-control>`, `<audio-player>` and parameter rack
references.

**Verification:** `packages/score/test/play/element-preload.test.ts`,
`packages/audio/test/play/clip-player-element.test.ts` and
`packages/ui/test/parameter.test.ts`; every acceptance-runner canvas shows its
desk channels, effect knobs and meters before play.

## DEC-070 — The documentation site owns its page shell

**Date / status:** 2026-11-11; accepted by the repository owner.

**Problem:** the documentation site wore the Starlight theme: its header,
sidebar, table of contents, search slot, asides and Expressive Code frames,
re-skinned through about seventy `--sl-*` overrides and a second dark palette.
The acceptance runner and the component library already follow
[Visual design](design/VISUAL-DESIGN.md) directly, so the documentation was the
one surface that looked like a theme rather than like the components.

**Decision:** the site drops Starlight and keeps Astro only as the compiler from
MDX and `.astro` demos to static HTML. `apps/doc/webmusic/src/site/` owns the
page: a one-height top bar with a tab per section, search and the repository
link; the section's pages in a left column (opened from a menu button on narrow
screens); the article with breadcrumbs; the page contents beside it on wide
screens; previous and next pages. The navigation tree is
`src/site/navigation.ts`, with directory groups listed by `sidebar.order`, and
the UI Kit groups read from `UI_PRESENTER_CLASSES`. The site is light only, in
the same tokens and geometry as the runner. Code blocks use a monochrome Shiki
theme in a hairline frame with a copy icon; `:::note` and `:::caution` stay,
through the Sätteri processor's directives. Content, URLs, redirects, frontmatter
keys, live demos, local search, llms files and site notices are unchanged.

**Alternatives considered:** a self-written Vite and MDX generator without
Astro, which would rewrite about seventy `.astro` demos and every Astro-based
gate for no reader-visible gain; keeping Starlight and overriding more of it,
which keeps the theme's structure and a second palette.

**Consequences:** the black site mode is gone; demos already rendered on light
canvases. Expressive Code and its `postcss-nested` override leave the tree.
Heading ids still come from Astro, so inbound fragments are unchanged. The
navigation, search dialog and page chrome are site code, covered by
`test/navigation.test.ts` and the existing search and breadcrumb tests.

**Owner:** [Documentation site plan](docs/DOCS-SITE-PLAN.md) §"Site shell".

**Verification:** `npm run check:docs`, the documentation workspace tests and
`npm run docs:build`; every built anchor link resolves; the shell is checked in
a browser at wide and phone widths with keyboard focus.

## DEC-071 — Web Component and Headless demos show the default interaction only

**Date / status:** 2026-11-11; accepted by the repository owner.

**Problem:** every Web Component page carried a playground: a Parameters strip
with one control per observed attribute, structured editors for effects, Rack
parts and synth-panel properties, a live markup readout, Copy and Reset. It
duplicated the reference tables, cost a large client runtime with its own tests,
and is the job of a component library with an editor rather than of reference
documentation.

**Decision:** a Web Component demo shows the component in its default
composition with the real controls it needs, such as its transport, keys or
toolbar. `ElementDemo` frames it with the entry and tag; there is no Parameters
strip, markup readout, Copy or Reset, and no structured editors. The one
exception is a type switch: an element with several drawings, surfaces or
recipes marks that attribute `switch: true` in the catalog (`type`, or an
equivalent such as `layout`), and `ElementDemo` shows one toggle per value, so
a reader can see every variant without the reference tables. Every Web
Component page has one shape: main demo, a short prose introduction, Import,
Ports and composition, topics, API, Styling and Related, checked by
`scripts/element-docs-policy.mjs`. The attribute,
property and event tables document configuration, and code examples show it.
Interactive adjustment and code generation belong to the separately maintained
component library. The parameter catalog (`src/lib/params`) stays as data for
the site checks and other tools. Headless demos follow the same rule
(extended by the owner on 2026-11-12): the shared `HeadlessDemoFrame` shows the
object working in its default configuration with only the controls that
operate it, and no Parameters, code readout, Copy or Reset; the Headless page
explains how it works and documents its API. UI Kit presenter demos keep their
Parameters. This supersedes the demo-configuration rule of DEC-059 for Web
Component demos, and the Parameters, copied-markup and Copy/Reset consequences
recorded for Element demos in earlier decisions (DEC-012, DEC-013, DEC-015,
DEC-031, DEC-033, DEC-048, DEC-050 and DEC-051).

**Alternatives considered:** keeping the strip collapsed by default, which keeps
its runtime and tests; keeping Copy without Parameters, which only copies the
markup already shown in the page's code examples.

**Consequences:** demos that a property editor used to configure set what they
need from their own script; the synth panel demo nests the panel and a note
input in a player, so it edits the player's instrument. Page prose no longer
refers to Parameters, Copy or Reset on Element pages. The two effect pages use
their own demo, an effect inside a player with an attached panel, instead of
the shared modular-composition example, so their recipe switch is audible.
Headless demos build their objects with fixed defaults; operation controls (a
playlist's next entry, a Rack part's mute, an editor's edit and undo) sit in the
canvas, and debugging consoles such as raw edit-operation fields are gone. The
Headless parameter catalog (`src/lib/headless-params`) stays as data.

**Owner:** [Visual design](design/VISUAL-DESIGN.md) §"Documentation demos",
[Component page template](docs/COMPONENT-PAGE-TEMPLATE.md) and the
[site plan](docs/DOCS-SITE-PLAN.md).

**Verification:** the documentation tests and build, including the page-shape
policy and its unit tests; every Element page renders its demo without a
Parameters strip, and every Headless frame has none (`headless-docs-policy`);
the changed demos and type switches are checked in a browser.

## DEC-072 — Keep Doc public and all other applications private

**Date / status:** 2026-11-12; accepted by the repository owner.

**Problem:** the public toolkit still carried an application hierarchy and the
manual acceptance runner after the component Library had moved to the private
repository. Website and Studio now belong to that private application suite;
their ownership should be clear in the source layout and verification commands.

**Decision:** `doc/` is the public repository's only application. The Astro
documentation workspace moves from `apps/doc/webmusic/` to `doc/`, and its
shared catalogs and UI assets move from `apps/doc/shared/` to `doc/shared/`.
Website, Library, Studio and Test (the manual acceptance runner) belong to the
separate closed-source `WebMusic-studio` repository under `apps/`. The public
repository retains package source, package tests, documentation source and
documentation tests. The public workspace, build, typecheck, lockfile, scripts
and CI must not depend on private application source.

Private applications consume built public package entries and may read the
documentation catalogs, references and approved media through their configured
public-checkout link. Moving the documentation directory preserves every
owner-maintained media file and `public.sha256` byte for byte; the Arabesque-only
and read-only policy in AGENTS remains unchanged at its new `doc/public/` path.
Public documentation URLs and npm package contracts do not change.

**Alternatives considered:** retaining an otherwise empty public `apps/`
hierarchy, which obscures the single public application's location; leaving
Test public, which splits application ownership across repositories.

**Consequences:** Doc has its own local documentation navigation; the private
Website owns the project hub. The runner's source and application checks move
to the private repository, while the owner's manual acceptance remains a gate
for the exact public version and commit. Public CI continues to verify the
public packages and documentation; private application checks run separately.
Maintained links and generated inventories follow the new paths. Dated records
retain their original prose, commands and evidence, with navigation links
repaired where needed.

**Owner:** [Architecture](ARCHITECTURE.md#packages-and-deployment-boundaries),
[Doc application](../doc/README.md) and
[private runner workflow](DEVELOPMENT.md#private-manual-acceptance-runner).

**Verification:** regenerate documentation inventories; run public source and
package checks and the Doc build; verify the moved asset inventory against its
unchanged pin. Run the private application checks and runner build, then inspect
Doc, Website, Library, Studio and Test through their actual development entries.
Application build success does not establish audible or device acceptance.

## DEC-073 — Authored DSP is a Kernel processor-module contract

**Date / status:** 2026-11-13; direction accepted by the repository owner, who
asked for the framework to be built on the `dsp-modules` branch. Delivery:
STATUS DSP-01.

**Problem:** no package registers its own `AudioWorkletProcessor`, so a
developer cannot add per-sample DSP — a custom voice, a waveshaper, a research
algorithm — as a module. Sound can only be assembled from native Web Audio
nodes, and `Effect.createAudioNodes` is synchronous, so an effect cannot wait
for a worklet to load. The [proposal](plans/2026-11-12-authored-dsp-modules.md)
records the baseline.

**Decision:** authored DSP is a Kernel contract over `AudioWorklet`, in the
entries `/processor` and `/processor-worklet`. One serializable
`ProcessorDefinition` is shared by both threads. Preparation in a context is
asynchronous and separate from synchronous graph edits. A processor exposes
only the existing port families, and every parameter is an `AudioParam` behind
the existing `ParamHandle` path. A changed contract needs a new version.
Shared memory is optional and reported as a capability. Processor code is
trusted, like project plugin factories. Open choices follow the proposal's
recommendations until the owner changes them.

**Alternatives considered:** a separate platform package, which would
duplicate port and parameter types Kernel already owns; an asynchronous
`Effect` contract, which would make every insert edit asynchronous; a
`ScriptProcessorNode` fallback, which imitates a capability on the main thread.

**Consequences:** Kernel gains two public entries and their policy, build and
reference surfaces. The existing synths and effects do not migrate. Subgraph
modules, latency compensation, a beat axis and isolated third-party loading
remain separate proposals.

**Owner:** [Processor modules](design/PROCESSOR-MODULES.md), which also owns
the development sequence.

**Verification:** each step adds unit tests and, from the first audible step,
browser evidence; unit tests against structural fakes do not establish sound
or timing.

## DEC-074 — Objects make components; components make apps

**Date / status:** 2026-11-15; accepted by the repository owner, who fixed the
three names.

**Problem:** Studio patches graphs in the manner of Max, but WebMusic had no
names for what a patch is made of, what a finished patch becomes, or what a
user assembles from finished patches. Max's own words (object, patch) and the
repository's existing words (module, Element, Web Component, component
library) overlapped, so the same thing could be called four names and one name
could mean three things.

**Decision:** WebMusic has three product layers, and maintained writing uses
these names for them:

1. **Object** — one node in a Studio graph, the counterpart of a Max object: a
   typed box with inlets and outlets whose behavior is one Kernel module
   created by a project plugin. Some objects show a package Component inside
   their box; that does not make them components.
2. **Component** — a graph of objects, the counterpart of a Max patch. A
   component is portable code: a developer copies it into a web project,
   installs the WebMusic packages, and it runs with no other dependency on
   Studio, private source or a hosted service. The packages' own Components
   are the official components; components built in Studio or
   shared by the community meet the same contract.
3. **App** — music software a user assembles from several components chosen
   in the Library, official or from the community.

Earlier names are retired in current writing, at the owner's request the
same day: *Web Component* becomes *Component*, Studio's *patch* becomes
*component*, and *Headless object* or *Headless component* becomes *Headless
class* (the code) or *Headless instance* (one running). *Custom element* names
the browser technology. Words that keep their technical meaning: *module* (the
Kernel runtime unit behind an object), *project* (the serialized Kernel
document a component's graph is saved as), *Element* (the class behind a
Component's tag) and *presenter* (a UI Kit renderer).

**Alternatives considered:** keeping Max's names, which would make "object"
and "patch" mean Studio-only things a developer never installs; calling a
graph a "module", which already names the Kernel runtime unit; leaving the
layers unnamed, which lets Studio, Library and documentation drift apart.

**Consequences:** documentation, Studio and Library describe the same three
layers. A component's portability is a delivery requirement, not a label:
until a component built from objects can be exported as runnable code that
uses only public package entries, only the packages' own Components are
components in the full sense (STATUS LAYER-01). Current documentation,
comments, Studio and the private applications use the new names; dated
records, earlier decisions and public API identifiers and URLs (`/element`,
`define…Element`, `@webmusic/ui/patch-editor`) are not renamed.

**2026-11-18 refinement:**
[DEC-081](#dec-081--a-layer-is-a-contract-a-component-in-a-graph-is-an-object)
defines each layer by the contract it meets. It replaces "some objects show a
package Component inside their box; that does not make them components" with
the rule that a component placed in a graph is a box with ports, and states
what each layer is made of for components authored in code and as graphs. The
three names are unchanged.

**Owner:** [Product definition](PRODUCT.md#objects-components-and-apps).

**Verification:** documentation and agent instructions use the three names
consistently; the export contract gets its own design and tests when it is
built, including a fresh web project that installs only the packages.

## DEC-075 — Messages are a Kernel port family; objects and controls build on them

**Date / status:** 2026-11-15; accepted by the repository owner, who asked for
the P0 gaps of the Max comparison to be built under the DEC-074 layers.
Delivery: STATUS MSG-01.

**Problem:** a Max patch is mostly messages — bangs, numbers, symbols and
lists between logic objects. WebMusic's five port families carry audio, notes,
modulation, transport and sources, but no general value, so a component
cannot express "every 250 ms, count to eight, flash on zero". Studio had no
objects for it and the UI Kit no single-value controls to show it.

**Decision:** `message` becomes the sixth port family, in Kernel because it is
domain-neutral. A message is a selector and typed atoms (int, float, symbol,
dict, array) with an optional logical time in AudioContext seconds. Delivery
is synchronous and depth first, inputs in connection order; nesting past 512
stops with an error. Timed events come from a `MessageClock` with lookahead and
carry their time; pointer and keyboard events are untimed and immediate. A
`message` connection may target a parameter. Kernel `/objects` ships the
object library as project plugins whose live state is exported in their
config and which act only after their graph commits, which adds an optional
`activate` hook to project module instances. UI Kit `/controls` ships ten
single-value presenters over structural bindings.
[Messages, objects and controls](design/MESSAGE-OBJECTS.md) owns the contract.

**Alternatives considered:** passing messages as control signals, which are
audio-rate numbers and cannot carry symbols, lists or discrete events; a
separate message package, which would duplicate Kernel's port, lease and
project types; delivering on microtasks, which loses Max's depth-first order
and makes `trigger` meaningless; timers on Session position, which would stop
a `metro` whenever the transport is paused and needs tempo the Session does
not have yet.

**Consequences:** Kernel gains a port family, a project connection kind, an
`activate` hook and the `/objects` entry; UI Kit gains `/controls`. Existing
families, plugins and projects are unchanged. Transport-locked timers,
musical time values, subpatches and presets remain later work.

**Owner:** [Messages, objects and controls](design/MESSAGE-OBJECTS.md).

**Verification:** unit tests for message parsing, ordering, overflow, clocks,
every object and every control; browser evidence for timing and controls; the
owner's manual checks.

## DEC-076 — Components nest; layout, presets and mappings are project data

**Date / status:** 2026-11-16; accepted by the repository owner, who asked for
the P1 gaps of the Max comparison (reuse, organization and parameter state).
Delivery: STATUS ORG-01.

**Problem:** a component could not contain a component, so a graph could not
be organized or reused in parts. Its layout had one set of positions and no
comments or groups, values could not be stored and recalled, and there was no
way to drive a parameter from a MIDI controller or a key without patching.

**Decision:** nesting uses the project's existing contexts. A `component`
object owns a child context whose modules are its contents and lends that
context a boundary: one channel per inlet and outlet. The `inlet`, `outlet`,
`inlet~` and `outlet~` objects inside connect to it; nothing is flattened or
copied. The shell's config lists its channels; editors keep it in step with
the edge objects. Project modules may observe their context's capabilities
through a new object-context `scope`. The project layout gains optional
`presentation` positions, `comments` and `groups`, and the project an optional
`mappings` list from MIDI controllers, pitch bend, program change or keys to
parameter endpoints; the runtime updates both without rebuilding. Kernel adds
`PresetBank` with capture, recall and interpolation over parameter surfaces,
`ControlMappings` with learning, and the `preset` and `nodes` objects. Score adds
`MidiControlSource`. UI Kit `/controls` adds a preset grid, an interpolation pad
and a mapping overlay. [Organization](design/ORGANIZATION.md) owns the contract.

**Alternatives considered:** flattening nested components into prefixed IDs
before restoring, which makes the runtime's document differ from the edited
one and loses the nested record on export; a separate nested runtime per
component, which would give each its own Session and output gate; storing
presets outside the project, which loses them with the file; mapping through
patched objects only, which needs a cord for every controller.

**Consequences:** the project schema gains optional fields that version-1
readers without them reject, so documents using them need this Kernel. A
component's inner modules are ordinary records of the same project. Presets
cover their own component (the modules of the preset's context). Transport-
locked time, subpatch abstractions loaded from files, and preset morphing over
time remain later work.

**Owner:** [Organization](design/ORGANIZATION.md).

**Verification:** unit tests for nesting through the runtime, boundaries,
presets, interpolation, mappings and the schema; tests for the new controls;
Studio tests for encapsulation, clipboard, arrangement and views; browser
evidence and the owner's manual checks.

## DEC-077 — Musical time, devices, voices, buffers and channels in components

**Date / status:** 2026-11-16; accepted by the repository owner, who asked for
the P2 gaps of the Max comparison (music and audio capabilities).
Delivery: STATUS MUS-01.

**Problem:** components had seconds but no bars or beats, so a timer could not
follow a tempo; MIDI covered notes and controllers only; there was no voice
allocation, no named sample memory, no frame-based spectral processing, no
multichannel cord and no microphone, game controller, HID or OSC input.

**Decision:** a project's Session carries an optional `tempo` (BPM and meter)
and the runtime lends its root context a `MusicalTimeSource` under the
`MUSICAL_TIME` capability, so objects read bars, beats and ticks (480 per
quarter) and schedule on the beat grid; tempo changes rebuild nothing. Message
objects accept note values (`4n`, `8nt`, `4nd`, `1.2.0`, ms, Hz). A lone word in
message text is its own selector (`stop`, as in Max); a quoted word stays a
`symbol`. Kernel adds `VoiceAllocator`, a `poly` shell that owns one child
context per voice with a `voice` object, `multichannelPlugin` and `mc.pack` /
`mc.unpack` over ordinary multichannel Web Audio connections, an OSC 1.0 codec
with `oscin` / `oscout` over a WebSocket bridge, `transport`, `makenote`,
`gamepad` and `hid`, and a worklet-side spectral frame (FFT, Hann window,
overlap-add). Score adds MPE pitch, pressure and sysex input, MIDI clock in and
out, a message-to-MIDI sink and MIDI device objects over one shared access
whose device inputs fan out to every object. Audio adds named `SharedBuffers`
per AudioContext with `buffer`, `groove`, `record` and `adc` objects, and
renders an edited clip back to samples. [Music and audio objects](design/MUSIC-AUDIO-OBJECTS.md)
owns the contract.

**Alternatives considered:** a tempo map in the Session clock itself, which
would change every scheduler and is not needed for one tempo and meter; a
flattened `poly` that copies voices into prefixed IDs inside the runtime,
which makes the exported document differ from the restored one; one buffer
store per runtime, which would hide a recording from another runtime on the
same AudioContext; a WebSocket OSC server in the packages, which a browser
cannot open; each MIDI object owning the device's handler, which lets the
last one silence the others.

**Consequences:** documents using `session.tempo` need this Kernel. `poly`
voices are ordinary contexts of the same project; editors that show one voice
must write the others (Studio copies the first). A buffer outlives a rebuild
when it is declared the same way, and goes with its last `buffer` object.
Message text `stop` now arrives as selector `stop` rather than `symbol stop`.
Tempo maps, time signature changes, an `mc.` form of processors and an OSC
bridge program remain later work.

**Owner:** [Music and audio objects](design/MUSIC-AUDIO-OBJECTS.md).

**Verification:** unit tests for musical time, voices, OSC, the FFT and
overlap-add, transport-locked metro, makenote, poly, multichannel, MIDI device
objects and fan-out, MPE, clock and sysex, shared buffers, recording and
rendering an edit; Studio tests for the new objects and voice copies; browser
evidence in Studio and the private runner's checks L1–L6, and the owner's
manual checks.

## DEC-078 — Observing, scripting, plugins and exporting components

**Date / status:** 2026-11-16; accepted by the repository owner, who asked for
the P3 gaps of the Max comparison (developer experience).
Delivery: STATUS DEVX-01; it also delivers the first export path of LAYER-01.

**Problem:** a running component could not be watched without patching
`print` objects into it; there was no way to run user code, to script the
editor, or to host the web's plugin format; and a component made in Studio
could not leave Studio, because its view objects were Studio's own plugins.

**Decision:** `ModuleProjectRuntime` gains `observe(listener)`, which reports
each message and note just before it crosses a cord, in delivery order and
depth, without changing delivery, and `probeSignal(endpoint)`, an analyser on
an audio or control output that follows it across rebuilds. Message clocks
can `hold`, `resume` (shifting held events by the time held) and `step`, and
`MessageDebugger` sets trace and break watchpoints with conditions. Editor
cords carry their project `recordId`. Kernel `/objects` adds `ScriptSandbox`,
user code in a Worker that reaches its host only through messages and offered
functions, and the `js` object over it. Kernel `/module` adds `wamPlugin`, a
structural adapter for Web Audio Modules 2.0 whose host group and URL policy
the application supplies. A new Bridge entry, `@webmusic/bridge/component`,
holds what a component needs outside Studio: the standard plugin set, the view
objects (`webmusic.surface.*`, moved from Studio), the controls of interface
objects, an asset resolver, `mountComponent`, `defineComponentElement`, and
generators of an exported module and a standalone page. Studio uses the same
entry. [Developer tools](design/DEVELOPER-TOOLS.md) owns the contract.

**Alternatives considered:** a global message tracer in the Kernel, which
would mix every runtime's traffic; slowing delivery for illustration, which
would change the timing the user is debugging; running scripts on the main
thread with `new Function`, which lets a loop freeze the page and gives code
the whole page; bundling a WAM SDK in the packages, which ties a release to it;
exporting components as a flattened script, which loses the project the user
can open again; keeping view objects in Studio, which makes exported
components lose their keyboards and scopes.

**Consequences:** the Bridge gains `@webmusic/ui` as an optional peer, used
only by `/component`. Documents with Studio's `studio.keys`, `studio.scope`,
`studio.meter`, `studio.spectrum` or `studio.roll` are migrated by Studio to
`webmusic.surface.*`. A break holds the message clock of its AudioContext for
every runtime on it; audio keeps playing. The Worker isolation keeps scripts
off the page but is not a security boundary: a dynamic `import()` still
reaches the network. A standalone page loads the published packages from a
CDN and so works only once the release it names is published; DSP processors
outside the packages are declared as resources the page must supply.

**Owner:** [Developer tools](design/DEVELOPER-TOOLS.md).

**Verification:** unit tests for observation order and depth, observers
across rebuilds, signal probes, watchpoints with hold, step and resume,
the script sandbox and `js` object in a VM-run Worker prelude, the WAM adapter
against a structural fake, and the component entry in jsdom; Studio tests for
the library, templates and debugging helpers; browser evidence in Studio and
the private runner's checks M1–M3, and the owner's manual checks.

## DEC-079 — A layout records a resized box's size

**Date / status:** 2026-11-17; accepted by the repository owner, who asked
that Studio's objects can be resized, sit on a grid without overlapping, and
be arranged by their connections.
Delivery: STATUS ORG-01.

**Problem:** a layout position held only `x`, `y` and `collapsed`, and the
schema rejects any other field. A box resized in an editor therefore had
nowhere to keep its size, and a component exported from that editor would
show its views and controls at their default sizes.

**Decision:** `ProjectModuleLayout` gains optional `width` and `height`, in
canvas pixels from 1 to 100 000, in both `layout.modules` and
`layout.presentation`. Absent means the box's natural size. The editor
binding reports them as `ProjectEditorModule.size` when both are present and
keeps them when a module moves. `mountComponent` gives a presentation item
with a size that size and lets its element fill it. Grid snapping, the
no-overlap rule and arrangement by connections are editor behavior and stay
out of the project.

**Alternatives considered:** keeping sizes in Studio's own storage, which
loses them with the file and in export; a size object nested in the
position, which would break the flat shape `collapsed` already uses; storing
grid and arrangement settings in the project, which ties the document to one
editor's interaction.

**Consequences:** documents that use the fields need this Kernel; version-1
readers without them reject such documents, as DEC-076 already notes for its
fields. A view element inside a sized box must follow its box's size.

**Owner:** [Organization](design/ORGANIZATION.md#layout).

**Verification:** Kernel editor tests for the size, its validation and its
survival across a move; a Bridge test that a sized presentation item keeps
its size; Studio canvas tests for resizing, grid snapping, the no-overlap
rule and arrangement; browser evidence and the owner's manual checks.

## DEC-080 — A box sizes what it holds

**Date / status:** 2026-11-18; accepted by the repository owner, who asked
that every object adapt to the size of its box and reported that dials and
buttons on the canvas could not change the values cabled to them.
Delivery: STATUS ORG-01.

**Problem:** DEC-079 recorded a box's size, but only the box followed it. A
control kept its one-row size in a corner of a larger box, so most of the box
did nothing when pressed; a keyboard, a scope, a meter, a spectrum, a roll and
a buffer kept their own heights and left the rest of a taller box empty. The
dial was read by the angle of the pointer from its centre, which on a control
24 px across turns a vertical drag — the usual way to turn a small dial —
into one jump to the middle and nothing after it. Studio and the exported
component also disagreed about the natural size of a control.

**Decision:**

- UI Kit controls accept `fill`: the control takes its host's whole width and
  height, and its glyph, track, knob or cells scale with it. A slider accepts
  `orientation: 'auto'` and stands upright while it is taller than it is wide.
- `createKnob` accepts `gesture: 'drag'`: the value changes by the distance
  dragged from the press (up or right raises it; `dragDistance` pixels for the
  whole range, 160 by default) and a press without a drag changes nothing.
  `'angle'` stays the default for `createKnob`. `mountDial` uses `'drag'`.
- The Bridge's `mountObjectControl` always fills its host. `controlSize(name,
  text)` gives each control's natural size in CSS pixels, in cells of 32 px,
  and `viewWidth(kind)` each view's natural width; a box without a recorded
  size takes these, in Studio and in `mountComponent` alike.
- `fitViewElement(element, kind, box)` makes a view as tall as its box: the
  drawing takes the height its readouts and tools leave, through the element's
  public height token or `height` attribute, and follows the box when it is
  resized. `mountComponent` uses it for every item with a recorded size.

**Alternatives considered:** scaling a box's content with a CSS transform,
which blurs canvases and scales text and hit targets with the box; container
query units inside the controls, which need size containment and so give a
control no natural size at all; keeping the angle-read dial and enlarging it,
which leaves a small dial unusable; a relative drag on `createKnob` by
default, which would change the transport's shipped volume knob.

**Consequences:** a control's host must have a size: `fill` gives a control
no size of its own. An exported component's unsized controls change from a
160 × 60 cell to their natural size, matching what Studio's interface shows.
A view in a box too short for its tools is clipped by the box. Elements other
than the six view kinds need a fitting of their own before they can follow a
box.

**Owner:** [Organization](design/ORGANIZATION.md#layout); the control
contract is in the [controls reference](../doc/src/content/docs/uikit/parameters-gestures/controls.mdx).

**Verification:** UI Kit tests for the drag gesture, `fill` and the automatic
slider; Bridge tests for natural sizes, an unsized cell and view fitting;
Studio tests for the box frames; browser evidence and the owner's manual
checks for every object at its natural, an enlarged and a reduced size.

## DEC-081 — A layer is a contract; a component in a graph is an object

**Date / status:** 2026-11-18; accepted by the repository owner, who reported
that `keys`, `scope` and `roll` are the packages' Components and yet are
listed in Studio as objects. It refines DEC-074. The same day the owner
directed that the Library follow rule 5 and that `buffer` be split (rules 5–7
as recorded here). The layer definitions apply now. The manifest of rule 4
and the split of rule 7 are implemented in Bridge `/component`, with sixteen
official components placed by manifest on 2026-11-19, players, desks, a
recorder and a panel by DEC-084 on 2026-11-20, and the declarations by
DEC-089; the Library's apps of rule 5 are not. Delivery:
STATUS LAYER-01.

**Problem:** DEC-074 names three layers, and Product states under it that
each is made only from the one below. Two of these statements do not hold
together:

- The packages' Components are the official components, but five of them are
  placed in a graph as the objects `keys`, `scope`, `meter`, `spectrum` and
  `roll`. DEC-074 says such a box "does not make them components", so one
  thing is a component on a web page and an object in Studio.
- An official Component is written in code from a Headless class and
  presenters. It is not made of objects, so "made only from the one below"
  describes components built in Studio and not the official ones.

The implementation follows the same split. A component built in Studio enters
a graph through the `component` object and its edge objects (DEC-076). An
official Component enters through a `webmusic.surface.*` plugin and a
per-kind branch in `@webmusic/bridge/component` that creates, configures,
binds and fits its element (DEC-078, DEC-080). Each further Component —
a staff, a waveform, a transport — needs new code in that entry before a
graph can hold it, and an app builder would need a third way to place both.

**Decision:**

1. **A layer is the contract a thing meets**, not where it came from or how
   large it is.

   | Layer | Contract | Package counterpart |
   |---|---|---|
   | Object | A typed box with ports that runs only inside a graph | API functions, Headless classes and UI Kit presenters |
   | Component | Self-contained and portable, with its own interface; it runs alone on a web page | Components |
   | App | Several components, laid out on a page, cabled together and sharing one Session | — |

   The test between the first two is whether the thing is useful alone on a
   page. A slider, a dial or a button is not, so interface objects stay
   objects. `score` and `sample` are Headless players with no interface and
   stay objects.

2. **A component is authored in code or as a graph, under one contract.** The
   packages' Components are authored in code and are sealed: they cannot be
   opened in Studio. A component built in Studio is a graph of objects and
   can be opened. Both follow the same formula — nonvisual behavior plus an
   interface — and both meet DEC-074's portability requirement.

3. **Any component can be placed in a graph, where it is a box with ports.**
   This is the one rule that crosses the layers, and it is Max's rule for an
   abstraction, a bpatcher or a hosted plugin. The `component` object already
   applies it to graph-authored components; code-authored components follow
   it too. `keys`, `scope`, `meter`, `spectrum` and `roll` are therefore
   official components placed in a graph, and are described so.

4. **Every component carries a manifest.** It declares the component's ports
   (name, family and direction, over the six port families), its parameters
   and the resources DEC-074 already requires. A graph-authored component's
   manifest is derived from its edge objects. A code-authored component's
   manifest is declared beside its Element and names the public property or
   event that carries each port. A host — Studio, `mountComponent` or an app —
   places, cables and sizes a component from its manifest alone, with no
   branch for the component's kind.

5. **An app is a project whose boxes are all components.** It adds a page
   layout to the presentation layout of DEC-076 and uses the same cords,
   ports and Session as any graph. It has no runtime of its own, and it runs
   and exports through `mountComponent` like a component. The Library builds
   apps this way. A companion that borrows a player's data, state and time
   (DEC-011) is cabled to it: the player's `module` to the companion's
   `inputModule` (DEC-063). The markup a Library card copies stays the way to
   use one official Component on a page; a composition of several is an app,
   and the Library no longer nests their markup to make one.

6. **Libraries list the two layers apart.** Objects are grouped by family.
   Components are grouped by who made them: official, the user's own, and the
   community. The Library and the components group of Studio's Object Library
   draw from the same listing, so a component exported from Studio can be
   placed in an app. The five view objects move to the official components;
   the text typed into their boxes does not change.

7. **`buffer` is split into its data and its view.** The `buffer` object keeps
   the named buffer of DEC-077 and shows nothing in its box. A buffer's
   waveform is the official component `<audio-clip-view>` placed in a graph
   and bound to a buffer by its name, as `groove` and `record` are — Max's
   `buffer~` beside its `waveform~`. Editing a buffer through that view writes
   back to the store, as `editableBuffers` does today.

This replaces two statements made under DEC-074. Product's "each layer is
made only from the one below it" becomes: an app is made only of components; a
graph-authored component is made of objects and of other components; a
code-authored component is made of the packages' public entries. DEC-074's "some
objects show a package Component inside their box; that does not make them
components" becomes rule 3.

**Alternatives considered:** keeping the Library's nested markup as a second
way to make an app, which gives apps no cords, no message family, no presets
or mappings and no export through `mountComponent`; keeping a buffer's
waveform inside the `buffer` box, which leaves one object showing a component
and so outside both layers; keeping DEC-074's wording, which leaves one thing
in two layers and a code change in the Bridge for every Component a graph
should hold; following Max fully, so that a keyboard and a scope are only
objects, which leaves the packages' tags without a layer although they are
what a developer installs; rebuilding the official Components as graphs of
objects so that every component is made from the layer below, which would
make each package Component depend on the project runtime and discard its
hand-written code; drawing the line by size ("as large as a plugin"), which
gives no test a reviewer can apply; a separate runtime for apps, which would
add a second routing and clock model beside the Session.

**Consequences:** the manifest is a new public contract. Its open choices
were settled in delivery the same day:

- **Where it is declared:** in Bridge `/component`, beside the Elements it
  names, because UI Kit imports no Kernel or domain types and Score and Audio
  stay independent. A graph-authored component's manifest is derived by
  `projectManifest`.
- **How a port is carried:** by the public member the Element already has.
  An audio input is connected to an `AnalyserNode` handed to `analyser`; a
  source input hands the upstream module to `inputModule` (DEC-063); a note
  output forwards the note port of `module`. `inputModule` names a player or
  source module, not an audio signal, so the Bridge was right to hand an
  audio cord to `analyser`; this entry's first draft said otherwise. A value
  that is not a port — the clip view's buffer name — is a parameter.
- **How a sealed component is sized:** the manifest carries its natural
  `width` and a `fit` (a height token measured against a public part, or the
  `height` attribute), which replace DEC-080's per-kind tables. A component
  without a fit keeps its own height.
- **Which come first:** the five, then `<audio-level-analyzer>` as `level`,
  added with its manifest alone, and `<audio-clip-view>` as `clip`.

The `webmusic.surface.*` plugin IDs and their configs stay readable, so saved
projects and exported components keep working; the per-kind functions of
DEC-078 and DEC-080 are replaced by manifest-based ones in the unpublished
entry. A project that placed a `buffer` in its presentation is migrated by
`migrateBufferViews`, which places a `clip` bound to that name beside it and
in its place in the presentation. Studio's Object Library and boxes follow
the manifests in the private repository. Rule 5 is not yet met: the players,
racks and companions the Library composes own their Headless instances and
Session inside their Elements, and how such a component's module joins a
graph's Session needs its own design before the Library can build apps as
projects. DEC-084 settles that design; the Library's apps remain.

**Owners:** [Product](PRODUCT.md#objects-components-and-apps) for the layers
and [Developer tools](design/DEVELOPER-TOOLS.md#component-manifest) for the
manifest.

**Verification:** tests that a manifest is derived from edge
objects and matches the `component` object's ports; that the five view
objects are placed, bound and fitted through their manifests with no branch
on their kind; that one official Component outside the five is placed in a
graph by adding only its manifest; that projects saved with
`webmusic.surface.*` records load unchanged; and that a project of
components alone runs through `mountComponent`; that a `buffer` box shows
nothing, a clip view bound to its name shows and edits it, and a project with
a presented `buffer` migrates to that pair; and that a Library app of a
player and its companions, cabled through `module` and `inputModule`, behaves
as their nested markup did. Browser evidence and the owner's manual checks
cover the two listings, a sealed component in a resized box, and an app built
and exported in the Library.

## DEC-082 — A component without its data still shows itself

**Date / status:** 2026-11-18; accepted at the maintainer's request.

**Problem:** placed in a graph before a cord reaches it, `roll`, `meter` and
`clip` showed only the outlined waiting square on a blank box, while `keys`,
`scope`, `spectrum` and `level` drew their whole interface. A component whose
data has not arrived looked like one that had failed to load. DEC-052 already
says pending feedback preserves mounted content; these three replaced it.

**Decision:** missing data is a state of the data, not of the interface. A
component waiting for its input draws its empty surface — what it shows with
nothing in it — and the DEC-052 waiting indicator over that surface, never the
indicator alone. The surface stays operable where it can be: its toolbar,
zoom and scrolling work, and nothing borrowed or edited is pretended.

- `<score-grid-view>` draws its keys, ruler and grid lines with no notes. This
  covers no source, `.inputModule = null`, a player without a score and an
  editor that is not ready; the empty grid borrows no editor.
- `<audio-clip-view>` draws an empty clip, its ruler and lane, with no audio
  or editor yet, or an editor that is not ready.
- `<audio-meter>` draws its type at rest, as it would for silence, without a
  source.
- `<score-sheet-view>` and `<score-view>` draw a blank score — one empty 4/4
  bar on one staff — as a staff, a roll or a waterfall. `<score-view>` draws
  a score whose data has no notes the same way, under its `empty` state; a
  piano roll or waterfall draws notes only, so its blank surface is its frame.
- `<score-pitch-view>` draws its keyboard, staff or fretboard with nothing
  sounding.
- The Score analyses (`chord`, `interval`, `rhythm`, `scale`) draw an empty,
  disabled lane — axis and beat lines, no bands.
- `<audio-live-view>` draws a waveform's centre line; a spectrogram stays
  clear.

The indicator sits in a `waiting` layer over the surface that takes no
pointer input, in the stage status of a canvas surface, or, for UI Kit's
Workbench, over a stage that already holds the caller's surface. Loading, failure
and a blocked editor keep their DEC-052 presentation. Data accessors report
the truth: `.score`, `.clip` and `.snapshot` stay `undefined` while waiting.

**Alternatives considered:** hiding the waiting indicator on an empty surface,
which would lose the distinction DEC-052 draws between missing input and an
empty result; and placeholder data, which would show notes or audio nobody
supplied.

**Consequences:** a score view's host is now a positioning context, through
the zero-specificity rule each view already installs. The blank score is
internal to Score core, shared by View and Analyze. A renderer measuring an
empty sequence shows the octave from middle C instead of an inverted range.
Tests that asserted a removed surface while waiting now assert the empty
surface and its indicator. An analysis bound through `inputModule` now reads
that module's score, which DEC-068 promised and placing analyses in a graph
exposed. Players, recorders, racks and mixers are reviewed against this rule
when their manifests are designed (STATUS LAYER-01); DEC-084 places the
players and desks, which wait in their existing waiting state without an
asset.

**Owners:** [Design principles](DESIGN-PRINCIPLES.md) for the rule, and the
[`<score-grid-view>`](../doc/src/content/docs/score/element/view/score-grid-view.mdx),
[`<audio-clip-view>`](../doc/src/content/docs/audio/element/view/audio-clip-view.mdx),
[`<audio-meter>`](../doc/src/content/docs/audio/element/analyze/audio-meter.mdx)
and other affected Element references.

**Verification:** tests that a grid with `.inputModule = null` draws an empty
grid under a `waiting` layer and replaces it when a score arrives and returns
to it when the score goes; that a disposed editor leaves the empty grid, not a
blank box; that a clip view without audio draws an empty clip under the layer
and that a ready editor replaces it; and that a meter without a source paints
a silent `vu` frame while `.snapshot` stays `undefined`; that a score view
whose source goes keeps its blank staff under the indicator; that an analysis
bound to a module analyses its score; and that every official component placed
with no cords mounts its Element. Browser evidence: the sixteen placed with no
cords each draw their surface, and the score components cabled to Arabesque
No. 1 draw and analyse it.

## DEC-083 — Icon buttons name themselves at once; Help explains objects, not components

**Date / status:** 2026-11-18; accepted by the repository owner, who asked
that every icon button on the site show its name in a black box the moment
the pointer rests on it, and that the Library and Studio menus end in a Help
toggle that, while pressed, shows what the hovered thing does, as an
instrument's info view does. The owner then narrowed both the same day:
only buttons without text are named, and Help explains small controls and
the basic layers, not everything.

**Problem:** icon buttons named themselves only through the platform's
`title` tooltip: a system-styled box that appears after about a second, in
the platform's font and colours, and not at all for keyboard focus. A
toolbar of icons read as a row of guesses. Studio crammed a sentence of
purpose into each menu tab's title, where it could only be read slowly.

**Decision:**

- The UI Kit's `controls` entry exports `mountTooltips(document, options)`.
  It is one delegated tooltip per document: the name of the element under the
  pointer, in an ink box (`--wm-foreground` fill, `--wm-accent-foreground`
  mono text, square, no shadow) just below and right of the pointer, shown at
  once and following it, in the top layer above modal cards. Keyboard focus
  shows the same box under the focused control. It reaches open shadow roots,
  so it serves every component on the page without each drawing its own.
- Only an element that shows no words (no letter or digit) is named: its
  `title`, or the `aria-label` of a control (button, link, tab, slider and the
  like) — every icon button. A card, a tab, a chip, a readout or a component
  shows its own text and gets no box. While a box is shown, the element's
  `title` waits beside it, so the platform's tooltip never follows; an icon
  control whose title was its only name keeps that name meanwhile.
- Help mode is one per document (`setHelp`, `help: true`). In it, an element's
  `aria-description` joins its name in the box, including on elements that
  show text. The description is the same text assistive technology reads.
- Help explains only small things and the basic layers (DEC-074).
  Icon tools, chips, filters and parameters say what they do in one plain
  sentence. An object says what an object is and then what this one does. A
  component — a Library card, a component box or cell in Studio — says only
  what a component is: no line can tell what a whole component does. Pages,
  page names and other text navigation carry no description.
- Components keep naming icon buttons in `aria-label` and `title`, so a
  component on a page without tooltips still names itself through the
  platform. A page opts in once: the documentation site and every closed-source
  application mount the tooltips; the Library and Studio menus end in a Help
  toggle (`?` key), remembered per viewer.

**Alternatives considered:** a tooltip inside each component, which an
overflowing frame clips and which repeats across every presenter; removing
`title` from the components, which leaves a component pasted into another
project with no visible names; and a docked info panel, which takes a corner
of Studio's canvas permanently for text that matters only while help is on.

**Consequences:** a page that mounts tooltips changes an element's `title`
attribute while that element's box is shown. A text element that keeps a
`title` still gets the platform's own delayed tooltip, so the applications
drop titles that repeat or expand shown text. Descriptions are authored only
where help should explain something; an element without one shows only its
name in help mode. Touch input shows no box.

**Owner:** [Visual design](design/VISUAL-DESIGN.md#icons); the API is in the
[controls reference](../doc/src/content/docs/uikit/parameters-gestures/controls.mdx).

**Verification:** UI Kit tests for naming only what shows no text, the lifted
title, shadow roots, press, touch, help mode and release; application tests
for the object and component help; browser evidence and the owner's manual
checks on the documentation site, the Library and Studio.

## DEC-084 — A player or desk in a graph borrows the graph's Session

**Date / status:** 2026-11-20; accepted by the repository owner, who asked
that players and racks be designed as components too. It meets the part of
DEC-081 rule 5 that DEC-081 left open: how a component that owns a player
and Session inside its Element joins a graph's Session.

**Problem:** `<score-player>`, `<audio-player>`, `<score-rack-control>` and
`<audio-mixer>` are the packages' Components, but none had a manifest, so no
graph could hold them. Each owns its Session when it is outermost on a page.
Placed in a graph that way, a player would start a second Session beside the
graph's, with its own clock and transport, and the graph's transport, its
other players and its companions would not follow it. A desk takes its
channels from the players nested inside it in markup, and a graph has no
markup nesting: its members arrive by cords.

**Decision:** a placed player or desk is a nested member of the graph, by
the DEC-063 rules a nested Element already follows on a page.

1. **The box lends a module context.** A component with an audio output
   bound through `context` gets, on its box, the context the graph gives that
   box's module: the graph's audio environment, Session and registry, with
   the box's own output bus as its default destination. The Element finds it
   through the DEC-063 context request, as a player nested in another finds
   its. A player in it is a nested player with its own source: its engine
   joins the graph's Session, and its transport, shown with
   `controls="show"`, commands that Session, as the graph's transport does. A
   desk in it is a nested Rack: its master plays into the box's output.
2. **A desk's inputs are channels.** Each audio input bound through `admit`
   is one channel strip, numbered from 1. The box offers the cord's audio as
   an output port, and the host admits it through the Element's `module`,
   whose `admit(module, port)` gives an output its own channel. A Rack's
   module already has it; `<audio-mixer>`'s module gains it. The first
   delivery gives `rack` and `mixer` four inputs.
3. **A source output carries the Element's module.** A cord from a player's
   `source` port hands the player's own `module` to the companion's
   `inputModule`, so a roll, a sheet or an analysis follows that player as it
   would nested inside it.
4. **The music is a project asset.** A manifest's `asset` names the role the
   box's module loads — a Score or an AudioClip — and the Element property it
   is given to. The asset is a declared resource (DEC-074), and the
   placement uses Arabesque No. 1. Without it, the player waits (DEC-082).
5. **Bind before connecting; remove before releasing.** A host binds the
   Element on its box before the box joins the page, so the player never
   starts a Session of its own, and takes it off the page before releasing
   the binding, so losing the lent context does not start one either.
6. **The host preloads the Session it owns.** DEC-069 has a Session's owner
   preload it as members join. In a graph that owner is the host, so
   `mountComponent` and Studio call `keepComponentSessionPreloaded`: a placed
   player's sound, parameters and inserts are real before the first play.
7. **A recorder takes notes; a panel takes a target.** A note input bound
   through `inputModule` gives the Element a module whose `notes` output
   repeats the notes cabled to the box, which is the member
   `<score-recorder>` already records from. A source input bound through
   `moduleTarget` hands the upstream module to a panel, which then edits that
   module's parameters and inserts; with no cord it is explicitly unbound and
   borrows nothing by containment.
8. **A companion of an audio player is cabled from it.** `<audio-playlist>`
   and `<audio-recorder>` play through an `<audio-player>`: nested in one on
   a page, linked through `.player` in a graph. A source input bound through
   `player` hands the companion the Element of the box its cord comes from —
   `track`, which gains a `source` output — so a queue is that track's
   transport and one participant of the graph's Session, and a take is
   auditioned through it. With no cord the companion is linked to no player:
   it shows itself and waits, and never plays by itself on a context of its
   own outside the graph.
9. **A queue plays into its own box.** A playlist's entries are every asset
   role with its manifest's prefix (`entry1`, `entry2`, …), loaded as clips
   and named by their files. `<audio-playlist>` in a lent scope that is not
   a player's and names a default destination builds its queue on that
   scope's AudioContext and plays into that destination, so the queue's audio
   leaves by the playlist's `output`. Nested in a player or alone on a page
   it keeps its own context, as before.
10. **A named buffer has three uses.** A parameter that names a shared buffer
    says how its Element uses it: `clip` edits it (`<audio-clip-view>`),
    `wave` shows it read-only as the Element's `clip` (`<audio-view>`), and
    `take` writes each recorded take to it (`<audio-recorder>`), so a `clip`,
    a `wave` or a `groove` of that name has the recording. A manifest with
    `scope` is lent the graph's module context although it has no audio
    output, so the microphone is captured in the graph's AudioContext.
11. **An Audio view follows a track by containment.** A source input bound
    through `owner` lends the view, on its box, a module context whose
    `AUDIO_PLAYER_OWNER` is the Element of the box its cord comes from — the
    capability an `<audio-player>` lends its nested companions (DEC-068). The
    view then follows that track as if nested in it: its playhead, and its
    clip when it has none of its own. A manifest's `spectrogram` has the host
    compute the Element's `.spectrogram` from the clip it shows, at most 2048
    columns, because `<audio-view>` draws a spectrogram only from data given
    to it.
12. **An insert takes the audio through the Element.** Audio ports bound
    through `insert` give the box an input and an output and the Element the
    graph's `context`; the host connects the box's input to the Element's
    `input` and its `output` to the box's output. `<score-synth-panel>` in
    `mode="insert"` with its `eq` section is placed this way.

The first four components placed this way are `player` (`<score-player>`),
`track` (`<audio-player>`), `rack` (`<score-rack-control>`) and `mixer`
(`<audio-mixer>`). `recorder` (`<score-recorder>`) and `panel`
(`<score-synth-panel>`, attached to the player its cord comes from) followed
the same day, and `wave` (`<audio-view>`), `take` (`<audio-recorder>`) and
`playlist` (`<audio-playlist>`) the day after: every Component of the
packages with an interface of its own is now placed. `wave` then gained a
source input from a `track` and a `spectrogram` type, and `eq`
(`<score-synth-panel mode="insert" sections="eq">`) placed the panel's insert
mode.

**Alternatives considered:** a player in a graph that keeps its own Session,
which makes two clocks and two transports; a separate Session object that
players are cabled to, which adds a port family for what the context already
lends; a desk whose members are boxes nested inside its box, which would make
a second way to group modules beside components (DEC-076); a desk with one
input that sums every cord, which loses the per-cord strip that makes it a
desk; and a desk input count set by an argument, deferred because a
manifest's ports are fixed today.

**Consequences:** the manifest gains three bindings (`context`, `admit`, a
`source` output through `module`) and an optional `asset`. A component plugin
loads its asset before it makes its ports, and stays synchronous when it has
none. `mountComponent` binds each component before it is shown and removes
its interface before it releases the bindings, and each Element in its stage
is a block, as in Studio's boxes. The graph's transport and a player's own
are two views of one Session. The Library's apps as projects (DEC-081 rule 5)
are not delivered by this decision. A host that owns a graph's Session now
prepares its members when they join, not at the first play. In
`mountComponent` the box, not the Element, carries a component's natural
width and the Element fills it, because `<audio-view>` owns its inline width.
`<audio-view>` draws an empty waveform under the waiting indicator until its
audio arrives (DEC-082). `wave` draws the waveform only: the Element's
spectrogram is computed by the host (rule 11) and its meter type is not
offered, since a buffer has no analyser. The insert panel is placed with its
`eq` section only; its `effects` section needs an effect list handed to it,
which no box argument describes yet (STATUS LAYER-01).
`<score-effect>`, `<audio-effect>` and `<score-rack-part>` show nothing and
were left out; DEC-089 placed them as they are.

**Owner:** [Developer tools](design/DEVELOPER-TOOLS.md#component-manifest);
[Modular composition](design/MODULAR-COMPOSITION.md#session-time-and-commands)
for the nested-member rules it reuses.

**Verification:** Bridge tests that a placed player's Session is the
graph's and its score is the asset; that a source cord from a player hands
the companion that player's module; that a rack and a mixer admit their four
inputs as numbered channels; and that destroying the component releases the
channels and leaves the player with no Session of its own; that the notes
cabled to a recorder reach the module its Element listens to; and that a
panel is attached to the player its cord comes from, whose parameters exist
before any play, and to nothing without a cord. Browser evidence:
a player, a roll, a recording, a rack and a mixer placed with Arabesque No. 1,
started from the player's own transport and paused from the graph's, at one
position; a panel showing its player's sound and envelope before play; and a
recorder capturing a take played on `keys`. Bridge tests also cover a `wave`
following its buffer, a take written to its buffer, and a `take` and a
`playlist` linked to the track cabled to them, with the queue as that track's
transport playing into the playlist's box; Audio tests cover the empty
waveform. Browser evidence: a playlist of two entries started from its
track's transport on the graph's Session and paused from the graph's, and a
take shown by a `wave` of its buffer. Recording from a real microphone is the
owner's check. Bridge tests cover a `wave` following its track, a bounded
spectrogram, and an `eq` joined between its box's ends in the graph's
context; browser evidence covers both views' playheads following a playing
track and the recording reaching a meter through the `eq`. The owner's manual checks cover placing them in Studio and hearing
a player through a rack.

## DEC-085 — A component in a graph is set by its Element's own attributes and tokens

**Date / status:** 2026-11-21; accepted by the repository owner, who asked
that a component placed in a graph be set in as much detail as a component
in an app: a meter's type, a view's editing switch, a keyboard's key sizes.
It extends the manifest of DEC-081.

**Problem:** a component in a graph could be given only what its manifest
turned into box arguments — a keyboard's range, a scope's timebase — and the
attributes the manifest fixed. Everything else its Element documents (a
meter's `type`, a clip view's `tools`, a view's `theme`) and every styling
token it reads could not be set per box, so a component behaved one way on a
page, where the author writes those attributes and tokens, and a poorer way
in a graph. A second vocabulary of per-component options in the manifest
would repeat each Element's reference and fall behind it.

**Decision:** a component's settings in a graph are its Element's public
settings, kept in its module's config and applied by the Bridge wherever the
component is placed.

1. **Two records in the config.** `attributes` maps an attribute of the
   Element to its value, and `style` maps a custom property to its value. A
   component without settings has neither key, so existing projects and
   exported components are unchanged.
2. **The Element decides what a setting may write.** An attribute is written
   only when the Element observes it, so an event handler or an unknown name
   is never written. It is never written when the graph owns it (`src`,
   `input`, `port`, `target`, `session`, `id` and the like: sources,
   connections and identity come from cords, assets and the host), when a
   box argument writes it, or when the manifest lists it in `locked`. A
   custom property is written only under the public `--wm-` prefix, with a
   value that loads nothing (`url()`, images and declaration separators are
   refused). What does not pass is left out without an error.
3. **The manifest's attributes become defaults.** A setting replaces an
   attribute the manifest gives the Element in a graph, and taking the
   setting out gives it back. `locked` names the attributes the host needs
   as they are (`keys`: `layout`, `routing`). `roll` and `sheet` locked
   `editable` and their editing tools until DEC-086 lent them an editor.
4. **A resized box still sizes the Element.** While a fit holds the height
   attribute or token, a setting for it waits; the natural size gives it
   back.
5. **A setting never lends what the host does not.** A clip view's
   `editable="false"` turns off the editing a host allowed; no setting turns
   on editing the host did not allow.

**Alternatives considered:** options declared one by one in each manifest,
which duplicates the Element references and needs a manifest change for every
new attribute; more box arguments, which are positional and cannot carry a
dozen optional settings; a pass-through of any attribute and any CSS, which
lets a shared project file write event handlers and load remote resources; a
project-level stylesheet, which would style every box of a kind at once and
could not be exported with one component; and settings kept by Studio alone,
which an exported component would not have.

**Consequences:** `@webmusic/bridge/component` gains `componentSettings`,
`settableAttributes`, `withComponentSetting`, `isStyleSetting`,
`GRAPH_ATTRIBUTES` and the `ComponentSettings` types, and `ComponentManifest`
gains `locked`. `configureComponentElement` applies settings before the box
arguments, and removes those that are gone. A host that edits settings offers
the attributes in `settableAttributes` and describes them from the Element's
own reference; Studio's Inspector does, with the parameter catalog the
documentation uses. Interface objects (`slider`, `dial`) have no settings of
this kind yet: their look is still their box's size and the page's tokens.
Score views in a graph were read-only until DEC-086 lent them an editor.

**Owner:** [Developer tools](design/DEVELOPER-TOOLS.md#component-settings).

**Verification:** Bridge tests that only observed, unowned, unlocked
attributes and safe `--wm-` properties are read from a config; that a setting
is written over the manifest's attribute and gives it back when removed; that
a box argument's attribute cannot be set; that a height setting waits while a
resized box sizes the Element; and that `mountComponent` gives an exported
component the settings in its project. Browser evidence in Studio: a meter
switched to a spectrum, a keyboard's key width set by its token, and a clip
view's editing turned off, each kept when the component is reopened. The
owner's manual checks cover the same in Studio and in an exported component.

## DEC-086 — A view in a graph edits the score its source plays; an edit pauses the Session

**Date / status:** 2026-11-21; accepted by the repository owner, who asked for
the `editable` switch of score views in a graph after DEC-085 left it locked.
It extends DEC-053's revision protocol to a player that follows a Session,
and DEC-085's settings.

**Problem:** a `roll` or `sheet` in a graph follows the box its `source` cord
comes from through `inputModule`, but edits only through a borrowed `.editor`
that owns the score, and nothing in a graph made or lent one. Every score
source in a graph also follows the graph's Session (DEC-084), and a player
that follows a Session could not apply a document at all: the DEC-053
protocol pauses the player's own transport for each revision, which a
Session follower does not own, so attaching a document threw, and the
Session's scheduler kept the timeline it was made with.

**Decision:**

1. **The source's score becomes a document.** The first editing view cabled
   to a box that plays a score turns that score into one document, a
   `ScoreEditor` owned by the host's `ComponentSurfaces`. The box plays the
   document from then on: the `score` object through `setDocumentSource`, a
   `player` component through its Element's `.editor` in place of `.score`.
   The document is kept for as long as the surfaces exist, so it outlives a
   rebuild of the graph and the cord that asked for it. It is not written
   back to the project's asset.
2. **A `source` cord lends it.** A component whose manifest says
   `edits: 'score'` borrows the document of the box its cord comes from while
   its `editable` attribute is on, and lets go when it is turned off; other
   views on the same source keep following it and show the same document.
   `editable` is an ordinary setting (DEC-085), off unless its author turns
   it on, so `roll` and `sheet` no longer lock it or their editing tools.
3. **A revision pauses the Session.** For a player that follows a Session,
   DEC-053's "pause playback" is the Session's pause: the player asks the
   member that joined the Session, which pauses it when it is playing. The
   player writes no transport. The Session keeps its position, its scheduler
   adopts the new timeline there, cancelling what the old one scheduled, and
   the member is read again for its length. Playing again is an explicit
   command, as before. A revision arriving while the Session is paused is
   adopted without a command.
4. **A fixed-height view keeps its toolbar.** Under a `height` attribute the
   grid and the sheet are as tall as their host and scroll in their viewport,
   so the editing toolbar a box now shows does not scroll away.

**Alternatives considered:** adopting the timeline while the Session keeps
playing, which is what a workstation does but contradicts DEC-053's rule
that a revision which changes what plays pauses playback, and leaves "play
while preparing" undefined for a Session; an editor made by each view, which
would give two views of one source two documents; an editor kept by Studio
alone, which an exported component would not have; a host option like
`editableBuffers`, unnecessary because the setting is off until an author
turns it on; and writing each edit into the project as a new asset, which
needs a score serialization the project format does not have.

**Consequences:** `ScorePlayer` gains `setSessionRequests` and the
`ScoreSessionRequests` type; `ScorePlayerModule` supplies them for the Session
it joins and takes them back on disposal. A followed player with no member
requests adopts a revision without pausing. The Session's position is not
mapped through an edit: one that moves time leaves the Session where it was.
`ComponentSurfaces` gains `document(id, peek?)`, and `SurfaceSlot` gains
`score`, `document` and `lender`; `ComponentManifest` gains `edits`.
Turning `editable` on while the graph plays pauses it once, because attaching
a document is a revision. Edits are undone with the view's own history, not
the host's, and are lost when the component is closed: saving them needs the
score in the project (STATUS LAYER-01). `<score-grid-view>` and
`<score-sheet-view>` with a `height` attribute now scroll in their viewport
instead of in their host.

**Owner:** [Developer tools](design/DEVELOPER-TOOLS.md#editing-a-score-from-a-view)
for the graph; [editing contracts](design/EDIT-COMPONENTS.md) and the
[ScorePlayer reference](../doc/src/content/docs/score/headless/play/score-player.mdx#apply-document-revisions)
for the revision protocol.

**Verification:** a Score test that a Session follower applies a document
without writing its transport: attaching and editing pause the Session, its
position stays, the next play schedules the document's notes from there, the
Session reads the new length, and a revision while paused commits nothing.
Bridge tests that the first request makes one document per source and keeps
it; that an editing roll borrows the document its `score` object then plays
while a second roll borrows none; that a `player` Element is given the
document in place of its score; and that turning `editable` on and off lends
and returns it. Browser evidence in Studio: a roll set to editable shows its
toolbar, a note moved with the arrow keys reaches the player as document
revision 1, and the transport pauses at its position. The owner's manual
check O3 covers hearing the edit.

## DEC-087 — An edited score is saved in the config of the box that plays it

**Date / status:** 2026-11-21; accepted by the repository owner, who asked for
edited scores to be saved with the component after DEC-086 left them in
memory. It changes the lifetime DEC-086 rule 1 gave a document.

**Problem:** under DEC-086 a score edited in a graph lived in the host's
`ComponentSurfaces` and was gone when the component was closed. A component
is one project JSON document: Studio stores it as text, copies it, exports
it as a module or a page, and reads it back, and nothing else travels with
it. A Score does not fit in that document as it is. Arabesque No. 1 is about
400 kB of Score JSON in some 40 000 values, against the project schema's
50 000 values and 65 536 characters a string; an asset is a URI of at most
8 192 characters that the host resolves, so a `data:` URI does not fit
either; and a loader gives every note a new ID on each load, so a list of
edits or a difference against the asset cannot be applied to it again.
Documents also had no end: a box deleted and a new one given its ID, or
another project shown in the same surfaces, met the old box's document.

**Decision:**

1. **The score is saved in its box.** A box that plays a score exports its
   config with the edited score under `document`:
   `{format: 'webmusic.score+json', encoding: 'gzip+base64', data: string[]}`,
   the Score's own JSON (`Score.toJSON`, read by `scoreFromJSON`), gzipped,
   as base64 text in strings of at most 32 768 characters. It is written
   through `exportConfig`, the path an object's state already takes, so it is
   in every export of the project and nowhere else. Arabesque No. 1 takes
   about 37 000 characters.
2. **A box starts from the score saved in it.** The `score` object's plugin
   and a `player` component's plugin read `document` when they make the box
   and start it with that document, before any view edits: the box plays the
   saved score, alone on a page or in a graph. The asset still loads and is
   never written, so it remains the original.
3. **Only an edited score is saved.** A document whose content is what it
   began as exports what it began from: nothing for the asset, the same text
   for a restored score. Undoing every edit in the view removes `document`
   again.
4. **A document lives as long as its box.** Each module of a box counts
   itself in and out of the surfaces. A rebuild makes the new module before
   it disposes the old one, so the document stays through it, undo history
   included; when the last module of a box is disposed the document goes, and
   a new box with that ID starts from its own score or its own config. A
   document already edited is newer than any config and stays when a config
   is read; one never edited gives way to a saved score.
5. **Reverting gives the asset back.** `ComponentSurfaces.revert(id)` replaces
   the box's document with a new one made from the score the box loaded: the
   box plays the asset at once, the views that edit borrow it, and the box
   saves no score.
6. **A saved score is untrusted input.** The text is bounded before it is
   decoded (1 000 000 characters), the inflated size while it inflates
   (24 MB), and the result is validated by `scoreFromJSON` and the editor. A
   box whose saved score cannot be read stays unresolved with its config, so
   the project loads, the problem is shown, and nothing is overwritten.
7. **Encoding is off the edit.** An edit is encoded after the call that made
   it, one at a time, the newest last. `ComponentSurfaces.subscribe` tells a
   host when what a box saves changed, `settled()` resolves when every edit
   so far is encoded, and `ComponentHandle.save()` waits for it. A score too
   large to save, or a platform without compression streams, leaves the box
   `unsaved`: it keeps what it last saved and says so.

**Alternatives considered:** the Score's JSON as structure in the config,
which exceeds the schema's limits for a piano piece; raising those limits,
which changes a Kernel contract for every project to carry one kind of data;
a new asset holding the edited score, which needs storage beside the project
in every host and a second file in every export, and makes a copied project
point at another project's file; the edits as a list of commands replayed on
the asset, or a difference against it, which fail because note IDs are new
on every load and history is bounded; MIDI as the saved form, which is small
but loses spelling, voices and notation a `sheet` edits; and a host that
writes the score into the project itself, which every host would repeat and
an exported component would not have.

**Consequences:** `@webmusic/bridge/component` gains `encodeScore`,
`decodeScore`, `canSaveScores`, `SAVED_SCORE_FORMAT` and
`SAVED_SCORE_ENCODING`; `ComponentSurfaces` gains `withDocument`, `revive`,
`revert`, `forget`, `enter`, `documentState`, `subscribe` and `settled`, and
the `ComponentDocumentState` type; `ComponentHandle` gains `save()`. The
`config.document` key of `webmusic.score-player` and of the `player`
component's plugin is reserved for it. A host that shows another project in
the same surfaces first disposes the boxes it shows (restoring an empty
project does) or calls `forget()`. A project with an edited score needs
`CompressionStream` and `DecompressionStream` where it is loaded. Reverting
is not part of the host's undo: the edits are the document's, and they go
with it. The saved form depends on the Score JSON schema, whose reader
migrates earlier versions. An edit made within the encoding of the one
before it is saved a moment later; a page closed in that moment keeps the
earlier one.

**Owner:** [Developer tools](design/DEVELOPER-TOOLS.md#saving-an-edited-score)
and the [Bridge API](../doc/src/content/docs/bridge/api.mdx).

**Verification:** Bridge tests that a score encodes to text a project holds
and decodes to the same notes and IDs; that input which is not a saved score
is refused; that an edit appears in the box's config and leaves it when
undone; that a `score` object and a `player` component play the saved score
from a project mounted again, with and without a view that edits; that an
unreadable saved score leaves its box unresolved with its config; that
`revert` gives the asset back in place and a deleted box takes its document
with it; and that an untouched document gives way to a saved score while an
edited one stays. Browser evidence in Studio: an edited note is in the file
after the edit, plays after a reload, does not appear in another file whose
boxes have the same IDs, returns with its box when a deletion is undone, and
is gone after a revert. The owner's manual check O4 covers hearing it.

## DEC-088 — Every display part answers to shared roles; a component and an app each have a theme

**Date / status:** 2026-11-22; accepted by the repository owner, who asked that
every display part of an object and a component have a style interface, so a
component can be styled in depth in its interface and an app styled as a
whole. It extends DEC-085's settings from official components to interface
objects, to a component and to an app.

**Problem:** the visual design already resolves every value through
`--wm-<part>-<role>` to a shared `--wm-<role>`, and DEC-085 lets an official
component in a graph be given its own tokens. Three things were missing.
Some twenty colour tokens of the packages ended in a literal without passing
a shared role — error text, scrims, range thumbs and tracks, grid lines, a
clip's playhead, sounding notes in the grid and the sheet — so a page that
set the shared roles restyled most of a component and left those behind. An
interface object (`slider`, `dial`, `toggle` and the rest) showed its tokens
and could not be given any. And there was no place to style a component as a
whole, or an app as a whole: every box had to be set one by one.

**Decision:**

1. **Every colour reaches a shared role.** A part's own token falls back to a
   shared role before its literal: errors to `--wm-danger`, scrims to the new
   `--wm-scrim`, a clip's playhead to `--wm-playhead`, sounding notes to
   `--wm-accent` as `<score-view>` already had it, range thumbs to
   `--wm-foreground`, tracks and subtle surfaces to `--wm-surface-muted`,
   grid lines to `--wm-border`, secondary marks to `--wm-foreground-muted`.
   The literal stays last, so nothing looks different until a role is set.
   A piano's black keys, a loop region and a spectral map keep their own
   colours: they are meaning, not theme.
2. **The shared roles are named in one list.** `THEME_TOKENS` in
   `@webmusic/bridge/component` lists them with the kind of value each takes
   and its fallback: foreground, muted foreground, surface, muted surface,
   border, control border, accent, content over accent, danger, recording,
   playhead, scrim, focus ring, control radius, control size, component
   radius and border, and the two font families. Editors offer this list; a
   theme may hold any `--wm-` token.
3. **A component has a theme.** `layout.style` in the project holds custom
   properties of the presentation as a whole. Kernel keeps them as names and
   text; a host applies those a setting may write (DEC-085: a `--wm-` name
   and a value that loads nothing). `mountComponent` writes them on the root
   it makes, and a component defined as a custom element writes them at
   `:host` from inside its shadow root.
4. **An interface object is styled like a component.** `style` in the config
   of an interface object is written on its box by `mountComponent` and by
   Studio, with the same check.
5. **The nearest setting wins, as CSS has it.** A box's own style is written
   on the box, the component's theme on the component's root, and an app's
   on whatever holds its components, so a box's own colour stands in a themed
   component. A theme at `:host` is the lowest declaration there is: a rule
   the page writes for the element wins over it, while a value the page sets
   only on an ancestor does not. An app that means to restyle a themed
   component sets its tokens on that component's element.
6. **An app's theme is set once.** The Library gives a composed app a theme
   of the same shared roles, written on the app's root and in its code as one
   `:root` rule, above each element's own tokens.

**Alternatives considered:** a second set of names (`--wm-theme-*`) that a
component's theme would read first, which lets an ancestor override a themed
component but doubles the vocabulary every page has to learn; a theme kept
in a module's config, which has no module to belong to; a new `--wm-` role
for every orphan token, which grows the vocabulary without need where a
shared role already says the same thing; following the foreground for a
piano's black keys, which turns them light on any dark page; and a theme
object in JavaScript, which nothing in CSS could override.

**Consequences:** Kernel's `ProjectLayout` gains `style` (at most 256 custom
properties, each a nonempty string of at most 256 characters); a runtime
older than this refuses a project that has one. `@webmusic/bridge/component`
gains `THEME_TOKENS`, `componentTheme`, `withComponentTheme`,
`styleSettings`, `styleDeclarations` and `applyComponentStyle`, and the
`ThemeToken` and `ThemeTokenKind` types. `--wm-scrim` is a new shared role.
A page that already sets `--wm-danger`, `--wm-accent`, `--wm-border`,
`--wm-foreground`, `--wm-foreground-muted`, `--wm-surface-muted` or
`--wm-playhead` now restyles the parts listed in rule 1 as well. Studio's
boxes set `--wm-component-border: 0` round what they show, and a theme that
sets the frame is written nearer, so it shows on the canvas too. A nested
component's interface objects carry their own style as top-level ones do.

**Owner:** [Visual design](design/VISUAL-DESIGN.md#palette) for the roles,
[Developer tools](design/DEVELOPER-TOOLS.md#component-theme) for the theme,
and the [Bridge API](../doc/src/content/docs/bridge/api.mdx).

**Verification:** a Kernel test that `layout.style` round-trips and refuses
what is not a custom property; Bridge tests that every listed role takes its
fallback as a setting, that a theme is read, written and removed, that a
mounted component carries its theme on its root and an interface object its
style on its box, both without what loads, and that a defined element
carries it at `:host`; UI, Score and Audio suites unchanged by the new
fallbacks. Browser evidence in Studio: a theme of four roles restyles a
roll, a keyboard, a scope, a dial and a toggle at once and is in the file; a
dial's own colour stands over it; a value that loads is refused. In the
Library: an app's theme restyles a player and its roll together and appears
in the code as one `:root` rule. The owner's manual check O5 covers looking
at it.

## DEC-089 — A component made of objects meets the same contract as an official one

**Date / status:** 2026-11-22; accepted by the repository owner, who asked
that every official Component be placed, the declarations `<score-effect>`,
`<audio-effect>` and `<score-rack-part>` included, that `eq` open as much as
it can, and that a component made of objects in Studio be brought into
another graph and an app on the same terms as an official one, with objects
as the logic between them. It extends DEC-076, DEC-081 and DEC-084.

**Problem:** an audit after DEC-084 found four gaps between the two ways of
authoring a component that DEC-081 rule 2 says meet one contract.

1. A component's edge objects carried messages and audio only, so a
   component made of objects had no note or source ports: it could not play
   an outside synth, record outside notes, or hand its player's score to an
   outside view.
2. A nested component shown in its box showed only its interface objects;
   the official components inside it were missing, and an exported page
   showed every level's components at once, at the wrong place.
3. Placing a user's component file copied it, and the copy's ports did not
   follow the file's edge objects; editing the file never reached the copy.
4. Library listed the packages' Elements and Studio its own listing, so a
   component made in Studio was not offered where the official ones are.

Three Elements had no manifest because they draw nothing of their own.

**Decision:**

1. **Notes and sources cross a component's edge.** Kernel `/objects` adds
   `inlet.note n`, `outlet.note n`, `inlet.source n` and `outlet.source n`.
   A shell's channel kinds are `message`, `audio`, `note` or `source`, and
   its ports `in<n>` and `out<n>` take that family. A note channel repeats
   notes; a source channel is a `SourceRelay` (Kernel `/module`), a module
   that stands for whichever module is cabled into it and passes on its
   ports, parameters, inserts and changes. `sourceOrigin(module)` reads
   through relays to the module a source comes from.
2. **The runtime carries sources.** A project module instance may name the
   module a source cord from one of its ports carries (`sourceOutput`) and
   may accept a source cord itself (`connectSource`). The runtime uses them
   before the host's connector, which then receives the carried module. An
   official box that forwards its Element's module carries it as a relay, so
   a view inside a component follows a player outside it, and the reverse.
3. **One rule for what a level shows.** Bridge `componentContents(project,
   shell?)` lists what one level of a component shows — interface objects,
   official components and nested components set to show theirs
   (`config.embed`) — where its presentation puts them. `mountComponent`
   shows the top level and draws a nested component as a framed cell of its
   own level; Studio's boxes use the same function.
4. **A placed file is followed by reference.** Studio records the file a
   nested component was placed from and when it was read (`config.link`).
   Opening a component brings every linked component up to date with its
   file — objects, cords, presentation, assets — and the file's edge objects
   become the shell's ports; cords to a port that still exists stay, and a
   file that is gone leaves the last copy. Opening a linked component opens
   its file. The project still holds the contents, so an exported component
   needs no file.
5. **One listing.** The studio site's listing reads the official components
   from their manifests and the user's component files from the store Studio
   keeps. Studio's Component Library and Library draw from it: Library lists
   the user's own under Mine, each opening in Studio, and names on each
   official card the box a graph places it as. Community components are
   listed when there is a place that holds them.
6. **Declarations are wrapped as they are.** `effect` (`<score-effect>`) and
   `audio-effect` (`<audio-effect>`) take the player or track their cord comes
   from as `moduleTarget` and add one insert to its chain; a `panel` cabled to
   the same player shows its controls. `part` (`<score-rack-part>`) is placed
   inside a `<score-rack-control>` of its own, as the declaration needs, which
   gives it a channel strip and plays its score in the graph's Session through
   the box's output. A manifest may name such a `container`.
7. **`eq` opens.** Its `effects` argument lists Score effect types, separated
   by commas, which play before its EQ; its `sections` are a setting
   (DEC-085). A manifest's word parameter may be such a `list`, and a
   manifest may `configure` Element properties a config describes.

**Alternatives considered:** one edge object with a family argument
(`inlet 0 note`), which changes the meaning of existing `inlet` boxes;
handling source cords only in the Bridge's connector, which cannot see
through a component's edge; flattening nested components when they are
shown, which DEC-076 rejected; keeping placed files as copies, which leaves
a component made once and used in many graphs out of date; a second listing
in Library, which is the gap itself; leaving the declarations as objects,
which leaves three Elements of the documentation without a component.

**Consequences:** Kernel's project instance type gains `sourceOutput` and
`connectSource`, and Kernel `/module` gains `SourceRelay` and
`sourceOrigin`. A nested component not set to show its contents shows nothing
in an exported page; one set to show them is a framed cell there as in
Studio. Studio's `config.link` is its own record; other hosts read and keep
it but do not follow it. The demo music rule applies to the documentation's
static showcases; what users load into Studio and apps is theirs (the
owner's clarification of 2026-11-22).

**Owner:** [Organization](design/ORGANIZATION.md#nested-components) for the
edges, [Developer tools](design/DEVELOPER-TOOLS.md#component-manifest) for
the manifest and listing.

**Verification:** Kernel tests that notes cross `inlet.note` and
`outlet.note` and a source crosses `inlet.source` and `outlet.source` to a
companion outside, following a replacement; Bridge tests that official
components inside a component of objects follow a player, a track and keys
outside and hand the score out again, that a nested component set to show
its contents is a cell holding them, that the declarations are placed and an
`eq` takes its effects; Studio tests that encapsulation gives note and source
cords edge objects, that a file fills a nested component with its ports and
presentation and is followed when newer, and that a nested box shows its
official and nested components; Library tests of the listing. Browser
evidence: an effect, a panel, a part, an `eq` with a delay and a nested
component holding a roll that follows the player outside, with Arabesque
No. 1. The owner's manual checks cover linking a file in Studio and Library's
Mine section.

## DEC-090 — Whose style is shown is the author's choice, box by box and component by component

**Date / status:** 2026-11-22; accepted by the repository owner, who asked that
the user choose the priority, for example selecting every component and
having them follow the app's style. It refines DEC-088 rule 5.

**Problem:** under DEC-088 the nearest setting always won: a box's own style
over its component's theme, a component's theme over the app's. That is
right while a part is being designed and wrong when the whole is: an app
assembled from components that each bring a theme cannot be made one thing,
and a component cannot fall back to its theme without deleting every style a
box was given.

**Decision:**

1. **Each part chooses its style source.** A box, and a component, shows its
   `own` style or `inherit`s that of what holds it. `own` is the default and
   is the absence of a key, so every existing project and page is unchanged.
2. **A box.** `styling: 'inherit'` in a box's config sets its own `style`
   aside: an official component's Element and an interface object's box are
   written nothing of their own, and take the component's theme. A
   component's attributes stay; they are what it does.
3. **A component.** `styling="inherit"` on a defined component element, or
   `styling: 'inherit'` in `mountComponent`'s options, sets aside both the
   component's theme and every box's own style, so only what the page or app
   sets reaches it. `ComponentHandle.setStyling` and the attribute change it
   in place: nothing is rebuilt.
4. **Nothing is lost by choosing.** The style set aside stays in the project
   and in the editor's fields, shown and not in effect; choosing `own` again
   brings it back. Saving a component that inherits saves its own theme and
   styles as they were.
5. **A selection chooses at once.** Studio gives the choice to one box or to
   every styled box of a selection in one undo step; the Library gives it to
   one element or to every element of an app.

**Alternatives considered:** a number per level, which says more than there
is to say when there are two sources at each step; `!important` on the app's
rule, which a page cannot then undo; deleting a box's style to follow the
theme, which loses the work; a property of the project that makes it always
inherit, which is the app's choice and not the component's; and a `theme`
attribute, which `<audio-meter>` already uses for something else.

**Consequences:** `@webmusic/bridge/component` gains `styleSource`,
`withStyleSource`, `ownStyle` and the `StyleSource` type; `componentSettings`
returns no style for a box that inherits; `MountComponentOptions` gains
`styling`, `ComponentHandle` gains `setStyling`, and a defined element
observes `styling`. The config key `styling` is reserved in the records of
official components and interface objects. The Library writes no custom
properties on an element that follows the app; a graph-authored component in
an app will carry `styling="inherit"` when apps are made of them (STATUS
LAYER-01). An appearance attribute an Element has, such as a note colour, is
an attribute and stays while the box inherits.

**Owner:** [Developer tools](design/DEVELOPER-TOOLS.md#component-theme) and
the [Bridge API](../doc/src/content/docs/bridge/api.mdx).

**Verification:** Bridge tests that the choice is read and written and keeps
the style it sets aside; that one box follows the theme while the others
keep their own; that a mounted component inherits and takes its own style
back in place with the same elements, and saves its own theme either way;
and that a defined element follows its `styling` attribute. Browser evidence
in Studio: a dial switched to follow the theme takes its colour, keeps its
own in the record and gets it back; a whole selection follows at once and
one undo returns it. In the Library: an element set to the app's style loses
its own property on the canvas and in the code and gets it back, and every
element is set at once from the app.

## DEC-091 — An app is assembled in the same editor a component is, from the Library

**Date / status:** 2026-11-22; accepted by the repository owner, who asked for
the App page to work as the component editor does, its purpose being to bring
components together into a whole music app, with components added from a
menu that opens the Library. It carries out DEC-081's definition of an app.

**Problem:** DEC-074 and DEC-081 define an app as a project whose boxes are
all components, cabled together on one Session, and the packages can mount
and export one (DEC-084). The App page did not build one. It was the
Library: a catalogue of components, each with a page that composed one
element with the players it needs as nested markup. Nothing there could
place two components side by side, cable a view to a player, lay a page out,
keep the result or run it as one thing.

**Decision:**

1. **One editor, two documents.** An app is edited by the component editor's
   own code, told by its page that the document is an app. The canvas, the
   cords, the Inspector, undo, files, templates, export and the run as the
   exported element are the same. What differs is stated in one place:
   nothing but components is placed, and the files are the app's own.
2. **Only components.** A box an app holds is an official component, with
   its arguments, or one of the user's own components placed by reference.
   Typing an object's name places nothing and opens the Library; an object
   copied in the component editor is not pasted. The speakers remain, as in
   every project.
3. **The Library is where components come from.** The editor's Library
   button lists the official components and the user's own, and opens the
   Library — the catalogue, with each component's live demo, parameters,
   style and code — in place over the workbench. A component's page there
   has `Add to app`: it places that component with the type, attributes and
   tokens it was shown with, as the box's own settings (DEC-085). Opened on
   its own, the Library sends the choice to the editor with the visitor.
4. **A placed component is cabled when there is no choice to make.** A
   companion follows the app's one player through its `source` cord; a
   component that only listens hears the app's one sound source, as a send.
   With more than one candidate nothing is cabled, and the author does it.
5. **The layout is the app.** An app has no interface apart from its
   components: where a box is placed on the canvas is where the running app
   shows it. Its two pages are Design and Run; it has no Interface or Debug
   page and no Console.
6. **An app's files are its own.** They live in the same browser storage
   under their own names, with their own templates and window layout. The
   user's components are read where the component editor wrote them, and a
   component of the user's placed in an app is opened for editing there.

**Alternatives considered:** a second editor written for apps, which would
drift from the first in every detail of selection, cords and undo; a layout
tool with no cords, which cannot express a view following a player and so
is not the app DEC-081 defines; the catalogue rebuilt inside the editor,
which duplicates a page that already draws, searches and demonstrates every
component; adding a component with its defaults only, which discards what
was set while it was looked at; and letting an app hold objects, which makes
it a component by another name.

**Consequences:** the App tab's address is the editor, and the Library is a
page of that section, shown in place by the editor and still reachable on
its own. `keepComponentSessionPreloaded` asks again, up to twenty times a
tenth of a second apart, while a member's document is still being applied
(DEC-086), instead of reporting that moment as a failure: an editable view
added beside a player made it visible. A player typed by name has its music,
as one taken from the library has. A component whose Element no box places
(a rack part, an effect) cannot be added and says so. A parameter a box
takes as an argument (a keyboard's range) is not carried over from the
Library's page; it is set in the Inspector. Community components are still
not listed: there is no place that holds them. The application is in the
private repository (DEC-072); this entry records the product contract.

**Owner:** [Developer tools](design/DEVELOPER-TOOLS.md#components-outside-studio)
for what an app is; the private repository's README for the editor.

**Verification:** a Bridge test that a preload is asked again while a
document is not ready and that any other failure is reported. In the private
repository, tests of the rules (what text is a component, what project is an
app, the starter and templates, separate storage, a Library choice turned
into a box with only the settings a box may hold), of the Library panel
(shown on demand, a choice taken only from its own frame and origin) and of
placing a configured component in one undo step. Browser evidence: the
editor opens on a player, its roll and a meter, cabled and with music; a
spectrum meter and a sheet set in the Library are added with their settings
and cabled; a choice made in the Library opened on its own arrives in the
editor; an object's name typed on the canvas places nothing; Run shows the
app as the exported element; no error is logged.

## DEC-092 — An app is designed as a web page: boxes, text, images and components

**Date / status:** 2026-11-22; accepted by the repository owner, who rejected
DEC-091's editor on the day it was made: an app is not built by the logic of
Max, as a component is, but by that of a website builder — boxes laid out as
a web page is, holding text and images as well as components — so that a
whole music web app can be made. It supersedes DEC-091 rules 1, 2 and 5 and
refines DEC-081's definition of an app.

**Problem:** DEC-091 gave an app the component editor: boxes on a canvas and
cords between them. That is how a graph is built, and the person assembling
an app is laying out a page. A page needs containers that arrange what they
hold, headings, paragraphs and pictures; a canvas of absolutely placed boxes
has none of them, and DEC-081's rule that an app is made only of components
left no room for a title.

**Decision:**

1. **An app is a page.** It is a tree of boxes. A box lays out what it holds
   in a row or a column, with a gap, padding and alignment, as a flex
   container does; what it holds is other boxes, text (a heading or a
   paragraph), images and components. Nothing is positioned by coordinates.
2. **Only components make music.** The components of an app are a module
   project, as before: one graph on one Session, mounted by the packages.
   Text, images and boxes play nothing and are not modules. DEC-081's "an
   app is made only of components" now reads: only components run in it.
3. **Connections are chosen, not cabled.** What a component follows or hears
   is a choice in its inspector — `follows`, `hears`, `notes from`, one for
   each inlet — which writes the project's connection. A component added
   from the Library is connected when there is no choice to make (DEC-091
   rule 4, kept).
4. **The page is kept in the project.** `layout.page` holds the tree. Kernel
   keeps it as plain data under the project's limits and reads none of it;
   the host reads it as untrusted input. So an app is still one project
   document: one file, one history, one export.
5. **A node carries only what is safe to show.** Its style is drawn from a
   short list of CSS properties for layout, size, face and type, and `--wm-`
   tokens (so a box can theme what it holds, DEC-088); a value may not end
   its declaration or load anything. An image's address is a web address, a
   path of the site or a small image in the document. A component node
   names a module and nothing else.
6. **The exported app is a web page.** Its boxes, text and images are
   written as plain HTML with their styles inline, with an empty place for
   each component, and one script runs the project and puts each component
   in its place. For that, `mountComponent` takes `place`: given, it draws
   no frame, transport or stage of its own, puts each shown box's Element in
   the element the host returns for it, and writes the theme on the host.
7. **The editor has the page builder's three panes.** Layers (the tree), the
   page itself, and an inspector for the selection: a box's layout, a text's
   words and type, an image's address, a component's connections and its
   own settings. Design selects and arranges; Preview is the page, live.
   Components are added from the Library, as under DEC-091 rule 3.

**Alternatives considered:** free placement by coordinates, which is how a
canvas works and does not reflow to a phone; a grid of fixed cells, which is
simpler to draw and cannot nest; the page in a file of its own beside the
project, which doubles every path that saves, copies, undoes or exports an
app; text and images as modules of the project, which gives the graph boxes
that play nothing; cords drawn over the page, which brings the graph back;
and arbitrary CSS or HTML in a node, which makes a shared app a way to run
someone else's markup.

**Consequences:** Kernel's `ProjectLayout` gains `page`, an object kept
whole; a runtime older than this refuses a project that has one.
`MountComponentOptions` gains `place`. A project's module positions
(`layout.modules`) mean nothing to an app, which places by the page; a
project with no page, or one that does not read, is given a first page of
its name and its components. An image kept in the document is limited by the
project's 65 536-character strings, so photographs are linked, not embedded.
The exported page needs a published release that has `place`. The component
editor's app profile from DEC-091 is no longer reached by any page. The
application is in the private repository (DEC-072); this entry records the
product contract and the two public additions.

**Owner:** [Product](PRODUCT.md#objects-components-and-apps) for what an app
is, [Developer tools](design/DEVELOPER-TOOLS.md#components-outside-studio)
for `place`, and the private repository's README for the editor.

**Verification:** a Kernel test that `layout.page` round-trips, must be an
object and stays under the project's limits; a Bridge test that `place`
puts each box where the host says, draws no frame, leaves out a box given
no place, themes the host and takes its cells back on destroy. In the
private repository, tests of the page model (what a node may carry, reading
untrusted data, inserting, styling, moving and removing, agreeing with the
project) and of the export. Browser evidence: a box set to a row with a gap
and a background, text and an image inside it, a value that loads refused;
a roll set to follow nothing and then the player; a component moved into a
box and its Element kept; a component deleted and brought back by undo; a
spectrum meter added from the Library into the selected box and connected;
Preview live; the exported page holding the boxes, a place for each
component and the project without its page.

## Recording the next decision

Add an identifier, date, status, problem, chosen contract, considered alternatives, consequences, owning document, and verification implications. A proposed choice does not change a public API. If a choice supersedes this register, retain its old identifier and point to the replacement; do not rewrite historical evidence as though the new choice always existed.

File each new identifier under one topic in `DECISION_TOPICS` in
[scripts/docs-catalog.mjs](../scripts/docs-catalog.mjs), then run
`npm run docs:sync`; `npm run check:dev-docs` fails while a decision is unfiled.
Keep verification totals and browser observations in a dated
[audit](audits/README.md) and link it from the entry, so the register states
the choice and its reason.
