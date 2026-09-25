# Component design contract and template

> Use this document to design and review capabilities, not to format API pages. It applies to Elements, Headless objects, UI presenters, APIs, drivers, and workers. [COMPONENTS](../COMPONENTS.md) derives the current instance index.

## Choose the design unit

| Unit | Owns | Delegates |
|---|---|---|
| Model and API | Inputs/outputs, formats, units, limits, data transformations | Page layout and long-lived playback state |
| Headless object | State, commands, events, scheduling/analysis sessions, lifecycle | Brand-specific UI and tag registration |
| UI presenter | DOM/drawing, accessible interaction, public styling seams, disposable presentation resources | Music models and audio-device ownership |
| Web Component | Attribute/property/event mapping, resource connections, composition of Headless and UI | Duplicate algorithms or a second musical clock |
| Bridge, driver, adapter | Explicit conversion and coordination across domains or external capabilities | Hidden conversion assumptions and global side effects |

A capability need not manufacture every layer. A nonvisual declaration needs no presenter. A pure function needs no simulated lifecycle. A compound component must explain its public value rather than exist only for directory symmetry.

A complete reference experience such as Chordio or MVMNT is a composition and
may be offered as a convenient preset. Its full layout must not become a
requirement for reusing the musical behavior or an individual presenter. A fixed
musical task may justify an independent component; a visual variation alone does
not. Existing complete components can remain compatibility entry points.

For a component with modes, describe which options, inputs and commands belong
to each mode. Prefer a discriminated programmatic configuration that changes the
mode and options atomically. Reject unsupported combinations before changing a
working instance. Preserve existing permissive surfaces when compatibility
requires them, and document the stricter migration path.

## Questions every design answers

1. **Task and independence:** the user's input, context, observable outcome, neighboring capabilities, and why existing configuration/composition is insufficient.
2. **Data and interface:** producer, mutability, units, ranges, defaults, empty states, format limits, serializable attributes, and object properties.
3. **State and commands:** authoritative owner, subscriptions, async completion, reentrancy, coalescing/cancellation, and the distinction between pause, stop, and retry.
4. **Time:** static projection, follower, interaction driver, or scheduling participant; session clock, offsets, seek, rate, loop, and lead-in.
5. **Interaction and visuals:** operations, feedback, keyboard/pointer/touch, focus, readouts, layout, replaceable tokens, parts, and surfaces.
6. **Resources and extension:** ownership of contexts, nodes, timbres, streams, workers, and subscriptions; partial-failure rollback; replaceable external resources.
7. **Composition and compatibility:** collaborating objects, tags, and presenters; instance isolation; migration needs for public changes.
8. **Acceptance and documentation:** automated contracts, browser/device evidence, owning reference page, and a demo proving the primary operation.

For an optional playback connection, apply [PLAYER-BINDING.md](PLAYER-BINDING.md)
and answer these component-specific questions without redefining its protocol:

- What remains useful with standalone input, and what data, current snapshot,
  and time does the component borrow when connected?
- Which source wins when explicit input and player data coexist? What is
  observable before resolution, while loading, and when required data is absent?
- How does initial synchronization work for an already running or paused
  player? Which changes refresh the derived state, and which time domain does
  each value use?
- Which commands may the component send? Who owns their effects and failures,
  and what does disconnecting release without stopping or disposing the player?
- How are late targets, target replacement, stale async results, and reconnect
  handled? Identify unsupported cases instead of assuming a selector is enough.

## Copyable design template

Use this Markdown structure for a new capability or a substantial change. Placeholders are questions, not existing API names.

~~~md
# <Capability or component>

Status: proposed / accepted, pending implementation / implemented, pending acceptance / verified / superseded
Layer and public entry:
Related decisions: DEC-xxx
Source and public types:
Owning reference page and demo:

## User task and boundary
Input situation, observable outcome, neighboring capabilities, and reuse assessment.

## Composition
Data producer -> API/Headless -> binding/presenter -> Element/application.
Identify ownership, borrowing, state authority, and clock authority.
For an optional playback connection, answer the binding questions above and
link the shared protocol; distinguish the accepted target from implemented APIs.

## Inputs, outputs, and units
| Item | Type/unit | Default/empty state | Limits | Owner |
|---|---|---|---|---|

## State and commands
States, transitions, events and payloads, Promise completion, and error channels.
Explain pause/stop, repeated calls, source replacement during loading, retry, and disposal.

## Session time
Static data / follower / driver / scheduling role; clock source and mappings.
Seek/rate/loop/offset behavior, invalidation of scheduled work, and rejoining.

## Interaction and visuals
Controls, commands, readouts, and feedback; keyboard/pointer/touch and cancellation.
State visuals, responsive layout, public tokens/parts/handles, custom surfaces.

## Resources and failure
Created/borrowed/released resource table; rollback; subscription/worker/stream lifetime.
Optional dependencies, unavailable capabilities, invalid formats, and denied permissions.

## Composition, extension, and compatibility
Replaceable engines/renderers/bindings/drivers; instance isolation.
Changes to existing callers, migration, and reference ownership.

## Acceptance
Normal flow, boundaries, and operation orderings.
Separate automated, browser, and device evidence.
Verified / unverified / intentionally unsupported behavior.

## Documentation delivery
Page template, catalogs/params, examples and actual code readout, related pages.
~~~

## Lifecycle acceptance matrix

Select rows relevant to the declared capability. This does not require every component to have the same methods.

| Scenario | Observable acceptance |
|---|---|
| Normal start and completion | UI matches the musical outcome; completion/end semantics are explicit |
| Stop, dispose, or replace while loading | Late results cannot restore canceled intent; acquired resources are released |
| Repeated start or callback reentrancy | No duplicate active resources; old objects cannot reclaim a replacement's host |
| Partial construction failure | Acquired resources roll back; an existing working chain remains usable where possible |
| Resume, seek, rate, loop | Units map correctly; future work is neither duplicated nor scheduled past cancellation |
| Two instances on one page | Input targeting, state, styles, and cleanup remain instance-local |
| Optional playback connection | Standalone behavior, source precedence, initial snapshot, and readiness are observable under the declared contract |
| Late, replaced, or disconnected player | Binding follows the declared resolution policy; stale callbacks cannot update the new connection, and borrowed playback remains owned by its caller |
| Custom UI or disabled stylesheet | Behavioral contracts remain; accessibility styling responsibilities are explicit |
| Missing data/dependency or denied permission | Understandable empty/error state; no fake success or unbounded retries |

## From design to implementation and reference

Before adding a public element or presenter, inspect every applicable policy, export, and directory rule linked by [Architecture](../ARCHITECTURE.md). A design record owns intent, choices, and acceptance. Source and reference pages own members; docs:sync generates the index.

Use the [Element](../docs/COMPONENT-PAGE-TEMPLATE.md), [Headless](../docs/HEADLESS-PAGE-TEMPLATE.md), [UI Kit](../docs/UIKIT-PAGE-TEMPLATE.md), or [API](../docs/API-PAGE-TEMPLATE.md) page template. A demo cannot replace a complete contract. An application's product layout does not automatically become every primitive's default appearance.
