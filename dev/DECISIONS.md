# Accepted design decisions

> Current decision register. The product direction was confirmed by the maintainer on 2026-09-05. “Accepted” describes a design choice, not implementation completion. [STATUS](STATUS.md) tracks the remaining work; source and technical contracts are linked by [Architecture](ARCHITECTURE.md).

Decision entries retain their dated wording. DEC-046 supersedes DEC-021's
three-package branch split for source integration; it does not change what was
published in the first npm release. Read [STATUS](STATUS.md) and the target
branch's tracked files before making a delivery claim.

## DEC-001 — A toolkit that grows from demos to music applications

**Decision:** optimize for composable musical capabilities that can support interactive demos, music software, online workstations, and artistic installations.

**Reason:** the same musical material and behavior should survive changes in scale and presentation.

**Consequence:** application concerns such as project persistence, undo, collaboration, and arrangement/session editing need explicit application-layer designs. They are not implied by the existence of a player or mixer.

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
their own directories. AGENTS and its CLAUDE symlink route through maintained
directory indexes. Package/platform contracts remain beside source; archived
release machinery remains beside its historical scripts. Generated inventories
provide discovery without substituting for these reading routes.

**Organization update (2026-09-25):** `AGENTS.md` is the sole maintained agent
instruction entry point. The earlier `CLAUDE.md` symlink is retired; current
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
[Score report reference](../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx#reports).

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
[Analyze Element reference](../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze).

**Verification implications:** assert exactly five registrations and public
classes, preserve underlying Headless/API capabilities, migrate shared lifecycle
and seek regressions to retained tags, and verify the five isolated player-bound
demos, external Parameters, reset behavior and redirects.

## DEC-015 — Type-selected Score View families

**Date / status:** 2026-09-08; accepted.

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
[View reference](../apps/doc/webmusic/src/content/docs/score/element/index.mdx#view).

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

**Owner:** [Play component design](design/PLAY-COMPONENTS.md) and the
[Play Element reference](../apps/doc/webmusic/src/content/docs/score/element/index.mdx#play).

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
reference and the [Stage presenter](../apps/doc/webmusic/src/content/docs/uikit/layout-feedback/stage.mdx).

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
public [Audio Analyze API](../apps/doc/webmusic/src/content/docs/audio/api/analyze.mdx)
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
[Audio Analyze Element inventory](../apps/doc/webmusic/src/content/docs/audio/element/index.mdx#analyze)
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
[Audio Analyze Element inventory](../apps/doc/webmusic/src/content/docs/audio/element/index.mdx#analyze)
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
[Score Analyze Element inventory](../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze),
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
[Score Analyze Element inventory](../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze),
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
owning [Score Analyze Element pages](../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze),
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
`codex/score-pattern-analysis-research` branch for later exploration. Keep
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
[Score Analyze Element inventory](../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze),
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
[Audio Web Component inventory](../apps/doc/webmusic/src/content/docs/audio/element/index.mdx#view),
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
[Score Element inventory](../apps/doc/webmusic/src/content/docs/score/element/index.mdx).

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
[Element pages](../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze)
and [Analyze API](../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx).

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
[Analyze API](../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx), the
[four Element references](../apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze)
and the [Harmony presenter reference](../apps/doc/webmusic/src/content/docs/uikit/views-analysis/harmony.mdx).

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
[Analyze API](../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx),
the [chord](../apps/doc/webmusic/src/content/docs/score/element/analyze/score-chord-analysis.mdx)
and [rhythm](../apps/doc/webmusic/src/content/docs/score/element/analyze/score-rhythm-analysis.mdx)
Element references and the
[Harmony presenter reference](../apps/doc/webmusic/src/content/docs/uikit/views-analysis/harmony.mdx).

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
[PitchView reference](../apps/doc/webmusic/src/content/docs/score/element/view/score-pitch-view.mdx).

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
[meter reference](../apps/doc/webmusic/src/content/docs/audio/element/analyze/audio-meter.mdx)
and the [metering Headless page](../apps/doc/webmusic/src/content/docs/audio/headless/view/audio-meter.mdx).

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
readiness without initiating another load.

**Owner:** [Design principles](DESIGN-PRINCIPLES.md),
[Status presenter](../apps/doc/webmusic/src/content/docs/uikit/layout-feedback/status.mdx),
[Workbench](../apps/doc/webmusic/src/content/docs/uikit/layout-feedback/workbench.mdx),
and the affected Element references.

**Verification implications:** loading/waiting/ready/error transitions, source replacement,
cancellation, teardown, unchanged-update stability, light/dark themes, narrow layouts and
reduced motion. Browser and screen-reader acceptance remain distinct from DOM regressions.

## Recording the next decision

Add an identifier, date, status, problem, chosen contract, considered alternatives, consequences, owning document, and verification implications. A proposed choice does not change a public API. If a choice supersedes this register, retain its old identifier and point to the replacement; do not rewrite historical evidence as though the new choice always existed.
