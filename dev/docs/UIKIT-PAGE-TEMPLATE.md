# UI Kit page template

This is the authoring contract for
`apps/doc/webmusic/src/content/docs/uikit/<class>/<presenter>.mdx`: each published
`@webmusic/ui/<presenter>` entry has a reference page. Source, catalogs, and
policies determine the classified release surface; see
[COMPONENTS.md](../COMPONENTS.md), not counts or migration notes in this template.

[PRODUCT.md](../PRODUCT.md) defines the music interaction packages and their use
paths; [DESIGN-PRINCIPLES.md](../DESIGN-PRINCIPLES.md) and
[COMPONENT-DESIGN.md](../design/COMPONENT-DESIGN.md) guide component design. This file
explains how to document an existing presenter's public contract. Navigation
belongs to [DOCS-SITE-PLAN.md](DOCS-SITE-PLAN.md), verification to
[DOCS-CONVENTIONS.md](DOCS-CONVENTIONS.md), and outstanding work to
[STATUS.md](../STATUS.md).

## Ownership and the shared contract

- `/uikit/` explains the layer, use paths, and theming; `/uikit/catalog/` offers
  classified browsing.
- `/uikit/api/` owns the root entry inventory and shared presenter shape:
  host, mount, handle, replacement on one host, destruction, errors, and
  import safety.
- A presenter page owns its specific State, Binding, Options, Handle,
  accessibility, and styling. Link the shared shape and explain deviations;
  do not copy the shared lifecycle specification into every page.

The caller implements the binding and owns state. Presenters read snapshots,
subscribe to notifications, and send operations back through commands. Some
entries use pull/redraw, one-shot drawing, or interaction surfaces instead;
document their real exports rather than inventing a uniform State/Binding.

## Page and supporting files

Here, `src/` paths are relative to `apps/doc/webmusic/`.

| File | Responsibility |
|---|---|
| `src/content/docs/uikit/<class>/<presenter>.mdx` | Prose, Import, API, Styling, and composition navigation |
| `apps/doc/shared/ui-presenter-catalog.ts` | Presenter/class/label/summary, canonical import, consumerTags, and demo state/options specifications |
| Relevant module under `src/lib/ui-presenter-demos/` | Caller state, binding, actual mount, feedback, and cleanup; use the existing module routing |
| `src/components/UiPresenterLiveDemo.astro` | Shared panel, controls, readout, and Copy/Reset |
| `src/components/UiPresenterRelated.astro` | Used by / More in class navigation |
| `src/components/LiveDemoCanvas.astro` | Shared stage background, spacing, and Live status frame |

Verify members against `packages/ui/src/<presenter>.ts` and its referenced
stylesheets: `XState`, `XBinding`, `XOptions`, `XControls` / `XParts` /
`XClassNames`, and `XHandle`. The root API page or another presenter is not an
authoritative member list.

## Page skeleton

````mdx
---
title: '@webmusic/ui/transport'
description: 'One sentence about the rendered controls and the binding they require.'
sidebar:
  label: 'transport'
  order: N
---

import UiPresenterLiveDemo from '../../../../components/UiPresenterLiveDemo.astro';
import UiPresenterRelated from '../../../../components/UiPresenterRelated.astro';

Opening prose.

<UiPresenterLiveDemo presenter="transport" />

## Import

```ts
import {mountTransport} from '@webmusic/ui/transport';

const handle = mountTransport(host, {
  snapshot: () => state,
  play: () => start(),
  pause: () => pause(),
  seekFraction: (fraction) => seekTo(fraction),
  subscribe: (notify) => store.subscribe(notify),
});
// Keep the handle while mounted; call handle.destroy() when removing it.
```

## The binding

Presenter-specific behavior; link to the shared shape for the rest.

<details class="component-section">
<summary>API</summary>

State, Binding, Options, Handle and accessibility.

</details>

<details class="component-section">
<summary>Styling</summary>

Tokens, classes and parts.

</details>

<UiPresenterRelated presenter="transport" />
````

The application or example supplies `host`, `state`, `store`, and commands.
Explain those inputs in the published page; do not call a fragment a standalone
program.

Order: introduction → main demo → Import → optional topics → API → Styling →
Related. The architecture gate requires this presenter's LiveDemo and Related
once each, with Related last. Topic examples do not duplicate the same main
LiveDemo block.

## Section responsibilities

### Frontmatter and introduction

`title` is the full entry path, `sidebar.label` the bare presenter name, and
order is dense from 1 within its class. The description states what is rendered
and what the binding requires in one sentence.

Use 1–3 short paragraphs to explain what it renders, what state it reads, when
to choose it, and which related presenters or composed Elements to consider.
Keep positioning here; options, binding tables, and styling belong below.

### Main demo: a real caller binding

The presenter stage reaches `LiveDemoCanvas`. Individual pages do not recreate
the grid, frame, or Live indicator.

```text
@webmusic/ui/<presenter>                              Class label
Optional hint: operations, drag behavior, or gesture requirements
┌───────────────────────────────────────────────────────────────┐
│ Actual presenter mounted against the demo binding              │
└───────────────────────────────────────────────────────────────┘
▾ STATE       Change caller-owned state and notify subscribers
▾ OPTIONS     Remount with new mount options
┌───────────────────────────────────────────────────────────────┐
│ Mount readout reflecting the current options                    │
└───────────────────────────────────────────────────────────────┘
Copy / Reset
```

- Every State field and Option has a control or a stated limitation. State
  controls update demo state and notify; the presenter repaints through its
  real subscribe/update path, not a separately drawn simulation.
- Implement the real binding interface, including optional commands. Commands
  produce observable state and view changes. Mark unavailable demonstrations
  `inert` with reasons rather than leaving silent dead controls.
- Destroy the old handle before remounting new options. Give asynchronous
  commands waiting/failure feedback and release subscriptions/listeners.
- Use one aligned row per member, name → control → short note. Reserve inert
  markers for actual limitations; a mode-specific member is not always inert.
- The readout owns current mount options, wrapping long objects, followed by
  Copy/Reset. Import owns binding code; do not repeat it in the readout.
- Another option value does not justify another main demo. A topic may use a
  real reskin, public parts/classNames, or icon example when the main controls
  cannot express that behavior.

### Import

Provide `mountX` and the smallest binding that mounts: snapshot, required
commands, and subscribe where the interface requires it. Distinguish required
and optional members and identify external state inputs.

Import owns minimal binding wiring; the readout owns current options. Do not
walk through every option or repeat the handle table here. Link shared cleanup
rules and explain unusual teardown in a topic.

### Topic sections

Explain relationships a row cannot carry: binding ownership, notification
timing, command promises, waiting/failure behavior, geometry, pull/redraw,
one-shot drawing, or composition with another presenter.

Link `/uikit/api/#the-shared-presenter-shape` for common behavior. A topic names
members and explains their relationship; API rows retain their types, defaults,
and input normalization.

When a presenter is composed with playback, use
[PLAYER-BINDING.md](../design/PLAYER-BINDING.md) to review the caller's connection. Keep
player selection and domain data conversion in the Element or application;
the presenter retains its domain-neutral structural binding. Explain:

- How caller-owned snapshots and notifications supply readiness, displayed
  values, and explicit time units, including the initial state at mount.
- Which optional commands the caller supplies and how unavailable commands or
  failures are reflected. Standalone caller state remains a valid input when
  it satisfies the same presenter interface.
- How the caller updates or replaces its connection, prevents obsolete updates,
  and releases subscriptions. Destroying the presenter does not dispose the
  borrowed player or acquire authority over playback.

Document only real State/Binding/Handle members. A playback composition example
does not establish a new presenter-level `player` property or selector API.

### API

Use complete `Member | Kind | Default | Description` tables grouped by actual
interfaces:

| Group | Required contents |
|---|---|
| State | Every field, type, meaning, rendered effect, and missing-value behavior |
| Binding | Snapshot, commands, subscribe; required/optional, arguments, void/promises, and error feedback |
| Options | Every option/default, including classNames, parts, stylesheet, and onError where actually supported |
| Handle | element, update/redraw, destroy, public controls, and when a node may be undefined |

Explain the actual shape when a group does not apply; do not invent uniform
members. Put uniform state normalization before the table. Add a bold
**Accessibility** block describing roles, names, keyboard operation, focus,
live regions, and caller attributes that are preserved.

Options retain their types/defaults in API; token and part names belong in
Styling. Link common lifecycle prose, while documenting any particular
reentrancy, release, or rendering behavior this presenter exposes.

### Styling

Organize three tables according to the actual stylesheet:

- **Tokens**: property, fallback, default, and effect. Check any compatibility
  prefix chain against source instead of inferring it from another presenter.
- **Classes**: canonical node `wui-*` classes and how `classNames` adds
  compatibility names or preserves canonical names, as implemented.
- **Parts**: public node tokens and `parts` extension behavior.

Explain default style installation and `stylesheet:false`. The latter prevents
that mount from installing styles; it does not remove previously installed or
caller-owned global styles. For compound presenters, describe its application
to child presenters. Reference option rows without repeating types/defaults.

Only document effective stylesheet inputs or publicly written semantic tokens.
A variable that cannot affect this presenter is not part of its contract. State
when canvas geometry or paint is driven by data/options instead.

### Related

`UiPresenterRelated` renders consumerTags and sibling presenter links from the
catalog at the end of the page. It routes; it does not carry API or product
positioning. Check that consumers actually compose the presenter, not merely
that their tags exist.

## Acceptance

- Catalog, demo binding, and source signatures agree. Every State/Option works
  or has a stated limitation.
- Import, complete API, Accessibility, and Styling are present; verify every
  member/default/token/class/part against source.
- Follow LiveDemo / Import / API / Styling / Related order and link shared
  behavior instead of maintaining another copy.
- Exercise mounting, notifications, options remounting, error feedback,
  keyboard interaction, and destruction. A Live chip alone is not validation.
- Follow [Conventions](DOCS-CONVENTIONS.md) for automated and manual checks;
  record remaining work in STATUS.
