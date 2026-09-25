# Headless page template

This is the content contract for code-object pages under
`apps/doc/webmusic/src/content/docs/{score,audio}/headless/{play,analyze,view}/`,
for the family inventory at `{score,audio}/headless/index.mdx` that routes to
them, and for the Bridge's `bridge/headless/` documentation. Product layers and
component design belong in [PRODUCT.md](../PRODUCT.md),
[DESIGN-PRINCIPLES.md](../DESIGN-PRINCIPLES.md), and
[COMPONENT-DESIGN.md](../design/COMPONENT-DESIGN.md), not in a second model here.

[DOCS-SITE-PLAN.md](DOCS-SITE-PLAN.md) owns page destinations,
[DOCS-CONVENTIONS.md](DOCS-CONVENTIONS.md) describes verification boundaries,
and [STATUS.md](../STATUS.md) records implementation progress. This template is an
authoring requirement, not a claim that every page is already complete.

## Objects and page ownership

A Headless page explains domain objects callers construct, drive, and release:
engines, controllers, sessions, view models, bindings, or value namespaces. It
has no DOM/canvas/SVG or styling responsibility. Browser render adapters and
input drivers belong to the API page for their actual published entry; names
such as `view` or `binding` do not alone make something Headless.

Normally, each object a reader looks up by name has one semantic owning page:

- A class, its factories, and convenience calls share a page, for example
  `ScorePlayer`, `createScorePlayer`, and `playScore`.
- Namespaces such as `Sound` and `Effect` can have their own pages.
- Small helpers follow the objects they serve, in an API Helpers group.
- Every export has an explanation owner. Inventory rows and cross-references may
  repeat its name, but not maintain duplicate complete definitions.
- Bridge has no published `/headless` subpath. Import `ScoreAudioSync` and its
  factories from the root; explain their lifecycle here and list links in the
  Bridge root API Reference. Its group keeps a capability Overview of its own
  shape at `/bridge/headless/`, ordered 0 with the sidebar label `Overview`; the
  domain families have no such leaf.

Use stable object slugs, such as `score-player.mdx` or `analysis-session.mdx`.
The public barrel, options/events types, implementation, and JSDoc are evidence;
neighboring pages are not the source of truth. Types need an owner even though
the existing completeness gate checks values only.

## Files and available facilities

Here, `src/` paths are relative to `apps/doc/webmusic/`.

| File/facility | Author responsibility |
|---|---|
| `src/content/docs/<family>/headless/index.mdx` | Family inventory: each entry's purpose, the layer boundary, and the export ownership table with its associated types, one section per capability |
| `src/content/docs/<family>/headless/<capability>/<object>.mdx` | Explanation, Import, topics, complete API, and composition navigation |
| `src/components/headless/<Name>Playground.astro` | Actual object, demo input, minimal UI, and cleanup |
| `src/lib/headless-params/<family>-<capability>.ts` | Catalog entries for objects wired to the shared panel: options, commands, state, events, composedBy |
| `src/components/HeadlessPlayground.astro` | Implemented shared panel using a catalog key and demo factory; it does not construct objects from export names automatically |
| `src/components/LiveDemoCanvas.astro` | Shared stage, background, spacing, and Live status frame |

`HeadlessPlayground` and its catalog types are available, but the catalog does
not cover every object. Supply a real catalog entry and demo factory, or improve
an existing working demo; do not assume the corresponding entry exists. Specific
coverage and migration work belong in STATUS.

**Composed by content does not depend on a generator.** A `composedBy` field
exists, but there is no available `HeadlessComposedBy` component to import.
Use verified ordinary links. A future generator can replace that navigation;
a schematic template must not cause authors to import nonexistent facilities.

## Page skeleton

The author implements the demo below. `score` is an input prepared by the
surrounding example.

````mdx
---
title: 'ScorePlayer'
description: 'One sentence about the object and the resources it owns or borrows.'
sidebar:
  order: N
---

import ScorePlayerPlayground from '../../../../../components/headless/ScorePlayerPlayground.astro';

Opening prose.

<ScorePlayerPlayground />

## Import

```ts
import {ScorePlayer, Sound} from '@webmusic/score/play/headless';

const player = new ScorePlayer(score, {
  synth: Sound.oscillator(),
  synthOwnership: 'owned',
});
await player.play();
// Keep this callback for the owning view/session's teardown.
// play() starts playback; it does not wait for the piece to finish.
const dispose = () => player.dispose();
```

## Ownership

Object-specific ownership and lifecycle behavior.

<details class="component-section">
<summary>API</summary>

Construction, Commands, State, Events, Lifecycle, Helpers.

</details>

## Related

[`<score-player>`](/score/element/play/score-player/)
````

Order: introduction → main demo → Import → optional topics → API → Related.
There is no Styling. Even a complete working demo does not replace Import and
API reference content.

## Section responsibilities

### Frontmatter and introduction

`title` is the exported object name, such as `'ScorePlayer'`,
`'createAnalysisSession'`, or `'AudioTimeline'`, without a package prefix or
promotional subtitle. The capability directory supplies context. Object order is
dense from 1, and a capability group has no Overview leaf: the sidebar expands
straight to the objects, and the family inventory holds the whole list.

In 1–3 short paragraphs, explain what the object does, construction inputs, what
it owns or borrows, and how to choose its neighbors. For example, `ScorePlayer`
advances its clock, `InteractivePlayer` accepts caller-driven progress, and
`PlayerController` wraps a state interface. Identify and link related Elements
without retabling their attributes.

### Main demo: drive the real object

The complete authoring target for a `HeadlessPlayground` is:

```text
@webmusic/<family>/<capability>/headless                     Object
Optional hint: operation and gesture requirements
┌───────────────────────────────────────────────────────────────┐
│ Minimal UI driven by the object: buttons, time, meter, or list │
└───────────────────────────────────────────────────────────────┘
▾ OPTIONS    Construction; release and recreate on a change
▾ COMMANDS   Call methods on the live object
▾ STATE      Read-only values refreshed through its public notifications
▾ EVENTS     Event and payload trace
┌───────────────────────────────────────────────────────────────┐
│ Construction readout reflecting the current options            │
└───────────────────────────────────────────────────────────────┘
Copy / Reset
```

- Render the stage through `LiveDemoCanvas`, using documentation UI primitives
  for necessary controls. The main demo exposes the object's own contract;
  Element/presenter composition can be a topic example.
- Every construction option, command, state getter, and event should be
  controllable or observable. Explain limitations; do not remove a member from
  the complete API table because demonstrating it is difficult.
- Options recreate the object under its actual ownership rules. Commands use
  the live instance. State follows public notifications rather than pretending
  the object supplies a faster update contract. If it has no relevant event,
  state the demo's refresh timing.
- Objects with events provide a real trace; objects without events say so
  rather than inventing an emitter. Show waiting/failure feedback for promises.
- Use one row per member, name → control → short note. Mark an ineffective
  control `inert` with a reason. Gesture-dependent operations need an operable
  resting state and a short hint.
- The readout shows the construction call, wrapping long options, followed by
  Copy/Reset. Do not imply that required input, contexts, or synths materialize
  automatically.
- Release subscriptions, DOM listeners, and objects at reconstruction and
  navigation, disposing only resources owned by the demo.

Use one main demo. Add a topic example only for composition the main controls
cannot express, such as binding a presenter or driving the object from a
browser adapter. Another option value does not justify another panel.

### Import

Provide the correct published path and the smallest useful lifetime:
construction, an operation, and when to release the result. For retained
playback objects, do not imply that `await play()` waits for the whole piece to
finish. Show eventual cleanup with an explanation that callers keep the object
while it is in use.

Mention factory or convenience forms and their returned handle, ownership, and
behavior differences when present. Resources created and passed into an object
must either retain a caller cleanup path or use a real ownership option that
transfers release responsibility.

### Topic sections

Explain relationships a table row cannot carry, usually:

- **Ownership**: contexts, synths, clips, and players; what disposal releases,
  including construction failure and reentrant boundaries where relevant.
- Time and state: nominal/transport seconds, rate, pause/resume, push/pull,
  and commands before readiness.
- Errors: operation failures, listener failures, promise rejection, and recovery.
- Composition: Elements, UI presenters, workers, or drivers using the object.

Link shared layer rules instead of repeating them on each page. Keep this
object's specific contract.

For objects that provide or consume an optional playback connection, consult
[PLAYER-BINDING.md](../design/PLAYER-BINDING.md). Document the actual object interfaces,
without importing Element selector resolution into Headless:

- Standalone inputs, borrowed player data, explicit-input precedence, readiness,
  and how callers obtain the current snapshot before following later changes.
- Observable state and update timing, nominal/transport or other time domains,
  permitted commands, and their completion and failure channels.
- Rebinding, late readiness, data replacement, stale callbacks, and disposal of
  owned subscriptions or derived work while retaining the borrowed player.

Apply only the roles the object implements. Pure functions and static results
need no invented subscription or lifecycle API; proposed connection interfaces
belong in the design specification, not the published member tables.

### Complete API reference

Use one API reference block, grouped by actual members:

| Group | Contents |
|---|---|
| Construction | Constructors/factories, every option/type/default, convenience-call return and ownership |
| Commands | State-changing methods, arguments, return values, promises, clamping/rejection, and pre-ready behavior |
| State | Every getter/readonly property, units, and values before readiness |
| Events | Names, payloads, timing, and the actual error channels |
| Lifecycle | dispose/destroy, idempotence, released resources, post-disposal behavior |
| Helpers | Small exported functions, constants, and related public types owned by this page |

Use `Member | Kind | Default | Description`. Omit inapplicable groups or the
Default column when appropriate, never real members. Put uniform parsing rules
above the table. Verify against source rather than copying a capability API page.

### Related

Identify Elements, presenters, or Headless collaborators that actually use the
object, and link neighboring capabilities needed to compose the workflow.
Distinguish consumers from alternatives; a pure helper need not invent an
Element consumer. Ordinary links and a future generated section have the same
navigation-only role. Reconcile relationships with source and composition
catalogs: an existing tag does not prove the stated relationship.

## The family `index.mdx`

`<family>/headless/index.mdx` is the family's Headless inventory, one section per
capability. The [Site Plan](DOCS-SITE-PLAN.md) owns its responsibilities: each
entry's purpose, the shared layer boundary, and export navigation. It is hidden
from the sidebar and reached by link from the family page and the API pages, so it
carries navigation rather than a demo or a second complete member reference.

Its export table gives every value the capability's `/headless` barrel publishes
a destination: values link to their semantic owner, and options/events/state
types are associated with their object, in a table or in prose beside the
section's exports. A class and its factories may share a row, but helpers and
types must not lose their destination.

Listing every value here is the manual completeness requirement for the whole
capability; the gate behind it is weaker. `checkHeadlessExports` reads the
inventory together with the capability's object pages, so a value named beside
the object that produces it also passes, and only a value named on neither
fails. The gate matches recognized value names only — it does not verify types,
unique ownership, signatures, or table contents, so authors still reconcile the
barrel by hand.

Bridge has no family inventory, and no export gate reads its root barrel;
`/bridge/headless/` carries the same content shape for the root exports
documented under this template.

## Acceptance

- Every public object, helper, and type has an owner, and the family inventory
  routes its name to the actual explanation.
- Import, the complete API table, and object-specific lifecycle content exist;
  a demo or mentioned export name does not replace them.
- The demo constructs the actual object; controls, state, events, and readout
  agree, with feedback for asynchronous and gesture-dependent operations.
- Use real APIs and available facilities. Record missing infrastructure in
  STATUS rather than importing a proposed generator.
- Exercise browser operation, errors, reconstruction, and navigation cleanup;
  follow the applicable checks in [Conventions](DOCS-CONVENTIONS.md).
