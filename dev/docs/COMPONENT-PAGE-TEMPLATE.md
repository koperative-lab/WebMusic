# Web Component page template

This is the authoring contract for pages under
`apps/doc/webmusic/src/content/docs/{score,audio}/element/<capability>/`,
including behavior-only declarations such as `score-rack-part`.
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
to an explicit section on its host workflow page: `<score-rack-part>` belongs to
`<score-rack-control>`. Independently usable recorders, including `<score-recorder>`
and `<audio-recorder>`, own tag-named pages with their input/player compositions
in the demo. The element catalog must point to the actual explanation; preserve
an appropriate redirect when replacing a standalone page.

Sharing a page does not hide a companion's API. Each tag's inputs, methods,
events, lifecycle, and styling have one identifiable reference location. Catalogs
and other pages link there instead of maintaining another reference table.

An element whose `type` switches drawings remains one page with a type switch
in its main demo. Do not split pages or stack near-identical demos by mode.

## Page and supporting files

Here, `src/` paths are relative to `apps/doc/webmusic/`.

| File | Responsibility |
|---|---|
| `src/content/docs/<family>/element/<capability>/<tag>.mdx` | Page prose; a shared workflow uses its primary tag's filename |
| `src/components/elements/<PascalTag>Demo.astro` | Real elements/workflow in their default composition, demo wiring, and local styles; use a descriptive workflow name for a composition |
| `src/lib/params/<family>-<capability>.ts` | Attribute catalog: entry, names, kinds, options and fallbacks; reconcile names and order with source `static observedAttributes`, resolving spreads. `switch: true` marks the one enum that selects the element's drawing, surface or recipe. `paramGroup` files each attribute as param, style or data by name; an entry the rule would misfile sets `group` |
| `src/components/ElementDemo.astro` | Shared panel: the entry and tag title, the type switch when the catalog marks one, then the live canvas |
| `src/components/LiveDemoCanvas.astro` | Shared stage background, padding, and Live status frame |
| `src/components/ElementComposition.astro` | Full-width sibling composition with a `0.5rem` gap |

Catalog `fallback` describes actual behavior when the attribute is absent, and a
`note` is one short sentence. The catalog is data, not page UI: the site's
checks and other tools read it, while the API table owns full defaults, parsing,
and behavior. Its `properties` and `events` lists do not mean the API table has
been automatically checked.

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

import MyElementDemo from '../../../../../components/elements/MyElementDemo.astro';

<MyElementDemo />

Opening prose.

## Import

```html
<script type="module">
  import { defineMyElement } from '@webmusic/<family>/<capability>/element';
  defineMyElement();
</script>

<my-element src="…"></my-element>
```

## Ports and composition

Module role, ports, containment default and explicit inputs.

## Topic sections as needed

<details class="component-section">
<summary>API</summary>

Complete member tables.

</details>

<details class="component-section">
<summary>Styling</summary>

CSS properties, public parts and host styling.

</details>

## Related

- [`<score-grid-view>`](/score/element/view/score-grid-view/) — what a sibling adds.
- [Headless ScoreView](/score/headless/view/score-view/) — the model behind this element.
````

Order: main demo → introduction → Import → Ports and composition → optional
topics → API → Styling → Related. Every Web Component page has all of them
except the optional topics, in this order, and nothing else at the top level:
`npm run check:docs` fails a page that departs from it
(`scripts/element-docs-policy.mjs`).
The main demo is the first visible page-body content, immediately after the
page title. Only frontmatter, imports and non-rendered comments precede it in
the MDX source. Do not put introductory paragraphs, notices, code examples or
section headings above it. Keep the title and site navigation in their normal
positions; move the existing demo rather than copying it.
A working demo or generated control strip does not replace Import or the
complete API table.

## Section responsibilities

### Frontmatter and introduction

- `title` is the primary tag in angle brackets, such as `'<audio-view>'`.
  `description` is one plain sentence. A capability group expands straight to
  its element pages, so leaf `sidebar.order` is dense from 1.
- After the main demo, use 1–3 short prose paragraphs to explain what the
  element does, required input or binding, and when to choose it against
  related elements, with links. When the demo has a type switch, name the
  values and say that the switch shows each one. Code, tables, lists and notes
  belong in Import or a topic section.
- Identify attached components in a shared workflow; keep their complete member
  descriptions in their reference sections.
- Do not enumerate attributes, registration steps, or styling in the intro.
  Name a member only when necessary to explain the contract.

### Main demo: real components in their default composition

Use `ElementDemo`, whose stage reaches `LiveDemoCanvas`. The shared facilities
own background, spacing, and Live status; the demo supplies the real
components and wiring. Use `ElementComposition` for stacked sibling components:
stretch to the available width with a `0.5rem` gap. Components nested in a
player get the same `0.5rem` below its transport from the shared stage rule.
`ElementDemo` takes no class: Astro scopes a demo's `<style>` to its own
template, so a rule aimed at the panel would silently not apply. Every
component draws its own one outer frame from `--wm-component-border`, falling
back to `--wm-border`; the demo adds no frame, gap or colour of its own.
Preserve package control geometry; do not override a companion player's height
just for its demo.

```text
@webmusic/<family>/<capability>/element                  <the-tag>
TYPE  [Piano roll][Staff][Waterfall]          (only with a switch)
┌───────────────────────────────────────────────────────────────┐
│ The running element or workflow, in its default composition   │
└───────────────────────────────────────────────────────────────┘
```

- The title is the primary tag; composition belongs in the introduction, not a
  title override.
- The demo shows the default interaction (DEC-071): the authored markup and the
  real controls the component needs, such as its transport. There is no
  Parameters strip, markup readout, Copy or Reset; the attribute, property and
  event tables document configuration, and code examples show it.
- An element with several drawings, surfaces or recipes shows all of them
  through one type switch. Mark that attribute `switch: true` in the catalog
  (`type`, or the element's equivalent such as `layout`); `ElementDemo` renders
  one toggle per option and writes the attribute on every instance of the tag
  in the stage. The switch is the only adjustment control in an Element demo.
  It starts on the attribute the markup authors, else the catalog fallback,
  whose first word must name the default option. A topic demo of the same tag
  passes `typeSwitch={false}`; only the main demo switches.
- Supply the data the default composition needs, and anything a property must
  carry for the component to be useful (a `.members` list, a lent editor). Set
  properties from the demo's script, as an application would.
- Gesture or microphone prerequisites need an understandable resting state and
  an operable trigger. A disabled Play button cannot obtain a user gesture;
  an unexplained blank surface is not adequate feedback.

There is one main demo per page. Add a topic example only when its behavior
shows something the main composition cannot, such as a different property-data
composition or binding relationship, and place it in that topic section, before
API. Another attribute value is not a reason for another main panel; show it in
a code example.

### Import

Owns the smallest useful registration path: `define*` import, call, and one tag
with meaningful input. Name the `/auto` and `/global` forms in one line where
they apply and leave their setup to the family page, which owns CDN, bundler,
and custom registration for the whole family.

Do not add several tags differing only in attribute values; controls and API
rows explain those differences. Example resources, dependencies, and inputs
must be available rather than copied from imaginary paths.

### Ports and composition

Required for every Element under
[DEC-068](../DECISIONS.md#dec-068--modular-composition-is-the-only-composition-model);
pages gain it as their roadmap round lands. Follow the
[single composition model](../design/MODULAR-COMPOSITION.md#single-composition-model):

- The module role (Session provider, Source, Instrument, Processor, Modulator,
  Rack, Analyzer, View or Sink) and whether it provides a context to children.
- A table of ports: name, family, direction, multiplicity and readiness.
- What containment connects by default, and the explicit `input`/`port`,
  `target` or `slot` forms with their resolution order and failure feedback.
- Session role: owns, borrows or stops at `session="local"`; the timing mode it
  reports; which changes edit in place and which rebind.

A short nesting example uses real tags and Arabesque No. 1. Member signatures
stay in API.

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

### Related

The last section: a bullet list, one link per item followed by an em dash and
what that page adds (see the skeleton). List sibling elements a reader might
choose instead, the companions this element composes with, and the Headless or API
page behind it. Label an element by its tag in code and backticks.

## Web Components inventory and acceptance

One Web Components inventory per family, at `/<family>/element/`, covers each
implemented capability in its own section: Play, Analyze and View.
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
- Exercise the default interaction and composition in a browser, or state its
  limitations.
- Place the main demo first and keep introduction, Import, topics, API,
  Styling and Related distinct and in that order. Do not omit reference
  content because a demo exists.
- Verify browser upgrade, interaction, unexpected console errors, and cleanup
  across disconnect/reconnect.
- Check links and actual heading IDs; follow the automated and manual
  [verification boundaries](DOCS-CONVENTIONS.md).
- Record unfinished alignment in [STATUS.md](../STATUS.md), not a second backlog
  inside this template.
