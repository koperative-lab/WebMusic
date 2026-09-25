# Web Component page template

This is the authoring contract for pages under
`apps/doc/webmusic/src/content/docs/{score,audio}/element/{play,analyze,view}/`.
It does not replace product component design: establish a new component's
purpose, layer boundaries, and composition through
[COMPONENT-DESIGN.md](../design/COMPONENT-DESIGN.md) and
[DESIGN-PRINCIPLES.md](../DESIGN-PRINCIPLES.md).

[DOCS-SITE-PLAN.md](DOCS-SITE-PLAN.md) owns page destinations and navigation;
[DOCS-CONVENTIONS.md](DOCS-CONVENTIONS.md) describes verification boundaries;
[STATUS.md](../STATUS.md) records current alignment. The generated repository component
inventory lives in [COMPONENTS.md](../COMPONENTS.md), not in template counts or
migration notes; the site's per-family inventory is a different artifact,
described below.

## Page ownership

An independently usable element normally has a tag-named page: `score-view.mdx`
documents `<score-view>`. A declarative child or an attached companion may belong
to an explicit section on its host workflow page: `<rack-part>` belongs to
`<rack-control>`, and `<score-recorder>` belongs to the `<note-input>` workflow
that mounts it. The element catalog must point to its actual explanation;
preserve an appropriate redirect when replacing a standalone page.

Sharing a page does not hide a companion's API. Each tag's inputs, methods,
events, lifecycle, and styling have one identifiable reference location. Catalogs
and other pages link there instead of maintaining another reference table.

An element whose `type` switches drawings remains one page with a mode control
in its main demo. Do not split pages or stack near-identical demos by mode.

## Page and supporting files

Here, `src/` paths are relative to `apps/doc/webmusic/`.

| File | Responsibility |
|---|---|
| `src/content/docs/<family>/element/<capability>/<tag>.mdx` | Page prose; a shared workflow uses its primary tag's filename |
| `src/components/elements/<PascalTag>Playground.astro` | Real elements/workflow, demo wiring, and local styles; use a descriptive workflow name for a composition |
| `src/lib/params/<family>-<capability>.ts` | Attribute controls; reconcile names and order with source `static observedAttributes`, resolving spreads |
| `src/components/ElementPlayground.astro` | Shared title, controls, markup readout, and Copy/Reset panel |
| `src/components/LiveDemoCanvas.astro` | Shared stage background, spacing, and Live status frame |

Catalog `fallback` describes actual behavior when the attribute is absent;
`defaultOptionLabel` uses it for a short unset-option label. A `note` is one
short control-row sentence. The API table owns full defaults, parsing, and
behavior. Catalog `properties` and `events` are not repeated under the attribute
strip; their presence does not mean the API table has been automatically checked.

## Page skeleton

Replace the schematic tag, registration function, paths, and content before
publishing.

````mdx
---
title: '<my-element>'
description: 'One sentence describing the element and its input contract.'
sidebar:
  order: N
---

import MyElementPlayground from '../../../../../components/elements/MyElementPlayground.astro';

Opening prose.

<MyElementPlayground />

## Import

```html
<script type="module">
  import { defineMyElement } from '@webmusic/<family>/<capability>/element';
  defineMyElement();
</script>

<my-element src="…"></my-element>
```

## Topic sections as needed

<details class="component-section">
<summary>API</summary>

Complete member tables.

</details>

<details class="component-section">
<summary>Styling</summary>

CSS properties, public parts and host styling.

</details>
````

Order: introduction → main demo → Import → optional topics → API → Styling.
A working demo or generated control strip does not replace Import or the
complete API table.

## Section responsibilities

### Frontmatter and introduction

- `title` is the primary tag in angle brackets, such as `'<audio-minimap>'`.
  `description` is one plain sentence. A capability group expands straight to
  its element pages, so leaf `sidebar.order` is dense from 1.
- Use 1–3 short paragraphs to explain what the element does, required input or
  binding, and when to choose it against related elements, with links.
- Identify attached components in a shared workflow; keep their complete member
  descriptions in their reference sections.
- Do not enumerate attributes, registration steps, or styling in the intro.
  Name a member only when necessary to explain the contract.

### Main demo: real components and controllable contracts

Use `ElementPlayground`, whose stage reaches `LiveDemoCanvas`. The shared
facilities own background, spacing, and Live status; the demo supplies the real
components, wiring, and necessary local layout.

```text
@webmusic/<family>/<capability>/element                  <the-tag>
┌───────────────────────────────────────────────────────────────┐
│ The running element or workflow                               │
└───────────────────────────────────────────────────────────────┘
▾ PARAMETERS
  Attribute                Control                One short note
  Attribute                Control                One short note
┌───────────────────────────────────────────────────────────────┐
│ Actual element markup reflecting the controls                 │
└───────────────────────────────────────────────────────────────┘
Copy / Reset
```

- The title is the primary tag. Attribute values already appear in controls
  and markup; composition belongs in the introduction, not a title override.
- Every observed attribute should have a control, one row per attribute:
  name → control → note, with aligned columns. Catalog coverage follows source;
  demo wiring should make changes as observable as possible.
- If properties such as `.rack` or collections drive the element, supply useful
  controls through the panel's `controls` slot. An attribute-free element can
  still have meaningful property inputs.
- For a workflow, `target` selects the controlled element. Set `markup` to the
  composition root when copying the full nested structure is necessary.
  Companion controls must mount, update, and remove the real companion.
- Supply required data for every supported `type` mode. Keep mode-specific
  attributes in the same strip, with scope in the note rather than separate
  per-mode control groups.
- Mark a control `inert` when this demo cannot show its effect, with a reason.
  Demo-specific limitations belong in `.astro`; fixed attribute limitations
  belong in the catalog. Being useful only in one mode is not permanent inertia.
- Gesture or microphone prerequisites need an understandable resting state and
  an operable trigger. A disabled Play button cannot obtain a user gesture;
  an unexplained blank surface is not adequate feedback.
- The markup readout mirrors actual settings, wrapping long tags one attribute
  per line, followed by Copy/Reset. Reset restores parameters and workflow
  attachments. Markup cannot show registration, so it never replaces Import.

There is one main demo per page. Add a topic example only when its behavior
cannot be expressed by the main controls, such as a different property-data
composition or binding relationship. Another attribute value is not a reason
for another main panel.

### Import

Owns the smallest useful registration path: `define*` import, call, and one tag
with meaningful input. Name the `/auto` and `/global` forms in one line where
they apply and leave their setup to the family page, which owns CDN, bundler,
and custom registration for the whole family.

Do not add several tags differing only in attribute values; controls and API
rows explain those differences. Example resources, dependencies, and inputs
must be available rather than copied from imaginary paths.

### Topic sections

Use `##` for behavior a table row cannot carry: binding precedence, loading,
playback synchronization, annotation, composition, or host/child lifecycles.
Code or a topic demo may illustrate it.

Group by behavior, not by `type`. A topic may name members and explain their
relationships; their types, defaults, and parsing remain in API rows.

For a playback-connected Analyze/View element, use
[PLAYER-BINDING.md](../design/PLAYER-BINDING.md) as the design reference and explain the
element's actual connection contract:

- What works standalone, which player inputs are borrowed, and how explicit
  properties, `src`, and player data are prioritized where those inputs exist.
- The supported selector or object property, resolution scope, readiness and
  missing-target feedback, initial snapshot, and update notifications. Do not
  infer score inheritance or synchronization from an attribute name alone.
- Commands sent to the player, their time domains and failure feedback; which
  displayed state belongs to the player and which is local presentation state.
- Behavior when the target arrives late, changes identity or data, is already
  playing or paused, or disconnects. State what cleanup releases and retains.

Keep member signatures in API. Show only implemented bindings in runnable
markup; name limitations explicitly and keep proposed tags, attributes, and
protocol additions in the design specification rather than the public table.

### API

Each public member has one clear reference location. Use
`Member | Kind | Description`, adding `Default` when useful. For surfaces above
roughly 15 members, use bold group headings rather than duplicate tables.

Cover:

- Every observed attribute, public property, and method, including input
  precedence and meaningful invocation timing.
- Every event's `detail`, `bubbles`, and `composed`; distinguish DOM events from
  the underlying object's emitter.
- Observable failure, cancellation, disconnect, and reconnect behavior, and
  which resources the element owns or borrows.
- **Accessibility**: roles, names, keyboard operation, focus, and live regions.
- **Subclassing**: public hooks only when the contract supports them.

A shared workflow identifies each companion tag's table or group; do not merge
same-named attributes from different tags into one ambiguous row. Put uniform
parsing rules above the table and mode-specific scope/defaults in the relevant
row. Verify against source rather than inheriting unverified rows from siblings.

### Styling

Describe CSS properties, public parts, host styling, defaults, and compatibility
fallbacks actually used by the element or its presenter. Check the element and
presenter contracts separately: a variable appearing elsewhere in the repository
does not make it effective here.

When canvas paint is input-driven, say so. The corresponding attributes' types
and defaults still belong in API; Styling links to them or gives a short
example. Do not document variables without an effective reader.

## Web Components inventory and acceptance

One Web Components inventory per family, at `/<family>/element/`, covers all
three capabilities, with one `## Play`, `## Analyze` and `## View` section.
The [Site Plan](DOCS-SITE-PLAN.md) owns its responsibilities: selection,
composition, registration, and shared theming, with no live demo.

An element page contributes three things to its capability's section, and owns
none of them alone:

- A tag row under that section: the primary tag, its one-line job, and a link to
  this page, or to the exact section of the host workflow page when a companion
  shares one.
- The purpose that row states, phrased to distinguish this element from its
  siblings rather than to summarize its API.
- Its `define*` entry in the same section's registration reference, matching the
  exported function name and its optional tag argument.

Complete member tables stay here, on the owning page. The inventory links to
them; it does not repeat them.

Before shipping:

- Reconcile attribute names/order with source; every public member and attached
  tag has a discoverable explanation.
- Add or update this page's tag row, purpose, and `define*` entry in the family
  Web Components inventory when a tag, job, or registration function changes.
- Exercise controls, modes, and composition changes or state their limitations;
  Copy/Reset reflects the real structure.
- Keep introduction, Import, topics, API, and Styling distinct. Do not omit
  reference content because a demo exists.
- Verify browser upgrade, interaction, unexpected console errors, and cleanup
  across disconnect/reconnect.
- Check links and actual heading IDs; follow the automated and manual
  [verification boundaries](DOCS-CONVENTIONS.md).
- Record unfinished alignment in [STATUS.md](../STATUS.md), not a second backlog
  inside this template.
