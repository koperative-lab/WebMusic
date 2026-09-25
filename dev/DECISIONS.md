# Accepted design decisions

> Current decision register. The product direction was confirmed by the maintainer on 2026-09-05. “Accepted” describes a design choice, not implementation completion. [STATUS](STATUS.md) tracks the remaining work; source and technical contracts are linked by [Architecture](ARCHITECTURE.md).

Decision entries retain their dated wording. In the current checkout, Audio and
Bridge are accepted design directions without local source or public references.
Read [STATUS](STATUS.md) and the target branch's tracked files before making a
delivery claim.

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

**Owner:** [Architecture](ARCHITECTURE.md#bridge-conversion-boundaries-deferred)
until a migrated Bridge package has its own public contract; delivery is tracked
in [STATUS](STATUS.md).

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
[score report reference](../apps/doc/webmusic/src/content/docs/score/api/analyze.mdx#reports).

**Verification implications:** retired tags are absent from exports,
registration, catalogs and navigation; retained live evidence updates from note
events and clears appropriately; report APIs, demos and redirects remain usable.

## DEC-014 — Five task-specific Analyze Elements

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

## Recording the next decision

Add an identifier, date, status, problem, chosen contract, considered alternatives, consequences, owning document, and verification implications. A proposed choice does not change a public API. If a choice supersedes this register, retain its old identifier and point to the replacement; do not rewrite historical evidence as though the new choice always existed.
