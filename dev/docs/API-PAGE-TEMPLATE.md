# API reference page template

This is the content contract for code-entry references at `/score/api/*`,
`/audio/api/*`, `/kernel/api/`, `/bridge/api/`, and `/uikit/api/`. Component design
belongs in [PRODUCT.md](../PRODUCT.md),
[DESIGN-PRINCIPLES.md](../DESIGN-PRINCIPLES.md), and
[COMPONENT-DESIGN.md](../design/COMPONENT-DESIGN.md); this is a page template.

[DOCS-SITE-PLAN.md](DOCS-SITE-PLAN.md) owns page destinations,
[STATUS.md](../STATUS.md) records current alignment, and
[DOCS-CONVENTIONS.md](DOCS-CONVENTIONS.md) describes check boundaries. Do not
maintain migration plans or publication status in this template.

## Scope and sources of truth

An API page explains an entry's actual exports: functions, loaders,
serialization, adapters, drivers, worker clients, protocols, and types, plus
navigation among entries. Verify package exports, public barrels, matching
built `.d.ts`, and implementation defaults.

| Reader needs | Content owner |
|---|---|
| Tag attributes, methods, DOM events, CSS | Element/workflow page under the [Component template](COMPONENT-PAGE-TEMPLATE.md) |
| Domain construction, state, commands, events, ownership | Object page under the [Headless template](HEADLESS-PAGE-TEMPLATE.md) |
| Presenter State, Binding, Options, Handle, styling | Entry page under the [UI Kit template](UIKIT-PAGE-TEMPLATE.md) |
| Every tag or exported value of a family, registration, shared theming | Family inventory page under the [Component template](COMPONENT-PAGE-TEMPLATE.md) and [Headless template](HEADLESS-PAGE-TEMPLATE.md) |
| Functions, data conversion, render/driver/worker, cross-form models, entry navigation | This API template |

Package roots and capability entries have reference pages. Sub-entries without
separate pages, such as `/render`, `/drivers`, `/worker-*`, and `/transcribe`,
can be sections on their capability's API page. Each table identifies its entry;
do not mix different barrels into a purported root export list.

**Apply cross-layer exceptions according to actual exports:**

- Bridge's `ScoreAudioSync` and factories are root exports. List and link them
  in the root API table; their full construction/state/lifecycle explanation
  belongs on the Headless page and is not copied back.
- Kernel classes are platform contracts without domain Headless pages. Explain
  them and functions completely in their sub-entry sections.
- The UI root page owns entry inventory and the shared presenter shape. Link
  individual presenters' complete definitions rather than rewriting each one.
- Related types re-exported from the root also need rows linking to their
  semantic owner. Another Headless page is not a reason to hide a root export.

## Page and example carriers

Here, `src/` paths are relative to `apps/doc/webmusic/`.

| File | Responsibility |
|---|---|
| `src/content/docs/<family>/api/<cap>.mdx` | Capability reference; family roots use `api/index.mdx`; other roots use `kernel/api.mdx`, `bridge/api.mdx`, `uikit/api.mdx` |
| `src/components/ApiSandbox.astro` | Shared editable code surface; the page supplies code, optionally in an MDX `export const` string |

`ApiSandbox` preview is disabled by default. An editable view and static fallback
do not establish that code ran. Before enabling preview, verify actual npm
package dependencies, versions, and browser support. A sub-entry is an import
path, not a separate npm package name.

The snippet gate compiles supported TypeScript/JavaScript/JSX fences, inline
HTML scripts and literal MDX `export const` code strings that import the
packages. Keep sandbox examples in self-contained literal exports; they receive
no synthetic inputs. See Conventions for selection and compiler limits, and
verify runtime behavior separately from a successful build.

## Page skeleton

This is schematic; replace placeholder content before publishing.

````mdx
---
title: '@webmusic/score/play'
description: 'One sentence about this entry and where related forms are documented.'
---

Opening prose, an install pointer, and this entry's optional peers.

## Entry map

Link to the package root inventory. Give local navigation for this capability.

## The model

The one conceptual model needed before the function groups.

## Export group — @webmusic/score/play

Signature, input/output contract, and a complete example.

```ts
import {renderScoreToWav} from '@webmusic/score/play';
// The published example prepares its score and required options here.
```

## API Reference

| Export | Kind | Use it for |
| --- | --- | --- |
| `renderScoreToWav` | function | Link to its complete description. |
````

Order: introduction → Entry map → optional model → export groups → API
Reference. The page is reference, so its complete tables are not hidden in
`<details>`. Examples may be ordinary code or shared sandboxes; do not add a
main interaction panel duplicating an object page.

## Section responsibilities

### Frontmatter and introduction

`title` is the exact entry path, such as `'@webmusic/audio/view'`, not a friendly
alias such as `'React'`. The description identifies the entry's purpose and
where related responsibilities are documented in one sentence.

Use 1–3 short paragraphs to position the entry and link excluded responsibilities.
Keep install to one line plus a link to the family page's Install section
(`/score/#install`, `/audio/#install`), which owns the full setup. Explain
which optional peers unlock which paths, checking manifest and implementation.
Publication is an external fact to verify, not something inferred from a local
version or tag.

### Entry map

The root page owns the complete package subpath inventory, derived from the
manifest. A capability page links to it and may show local navigation derived
from the same source, explaining the actual root / Headless / Element / auto /
global / render / driver / worker forms.

The `/headless` form belongs to the family's Headless inventory
(`/score/headless/`, `/audio/headless/`), and the `/element`, `/auto` and
`/global` forms to the family's Web Components inventory (`/score/element/`,
`/audio/element/`). Each inventory has one section per capability, so link the
capability anchor — `/score/headless/#play`, `/audio/element/#view`. A single
object or tag still links to its own leaf page and a function to its export group
below, and an inventory's selection or export tables are linked rather than
copied onto this page.

A local map helps readers choose an entry; it is not an independently maintained
release list. Link existing semantic owners or this page's sub-entry sections.
Do not list unpublished paths or assume a package has `/demos` merely because
the template gives it as an example.

Each row contains form, short purpose, and link, not an object's complete
reference.

### The model

Include a cross-form model only when needed to understand the function groups:
Score Play's time ownership and push/pull, Audio's `AudioClip`, or a View renderer
contract. A diagram or choice table can explain how forms relate.

Object options and lifecycle belong on object pages. Product direction and
future DAW/installation composition belong in PRODUCT; do not turn direction
into a claim of shipped capability. Kernel admission rules belong in the
architecture/Overview, not every API group.

### Export groups

For APIs that supply or consume playback connections, consult
[PLAYER-BINDING.md](../design/PLAYER-BINDING.md). Explain the implemented structural inputs,
snapshot and update semantics, time units, command authority, and resource
ownership; link the owning Headless reference where it carries the lifecycle.
Pure analysis functions remain usable with explicit data. Proposed connection
types belong in the design specification until they are publicly exported.

Group by reader task, such as loading/detection, offline rendering, drivers, or
colormaps. Each group supplies:

- A short purpose, actual import path, and signatures.
- Parameters, options, results, units, defaults, failure, and boundary behavior.
- One understandable complete example, with imports, key input preparation,
  and necessary cleanup; no `…` in the operation it claims to demonstrate.

A signature sketch may accompany a complete example, but label the distinction.
If code depends on surrounding inputs, identify them rather than calling it a
standalone program. Explain whether awaiting an operation means preparation,
operation completion, or the end of playback.

Sub-entry headings carry the path, for example
`## Transport drivers — @webmusic/score/play/drivers`. Use option prose instead
of multiple equivalent examples varying only an option value.

### API Reference

Reconcile each table's declared entry with its barrel. Use
`Export | Kind | Use it for`, one row per export, linking to a detailed group or
semantic owning page. Types can have an end group; do not hide them behind
“etc.”.

Choose accurate kinds: function, loader, adapter, driver, worker client,
protocol, constant, type, and class/factory when actually exported. Bridge,
Kernel, and aggregate roots follow the exceptions above; a fixed vocabulary
must not misrepresent their surface.

Values and types have identifiable owners. Keep navigation rows for root
exports whose full object/element/presenter references live elsewhere, without
copying their complete definitions. Another entry's exclusive export must not
appear as a member of this entry. Identify same-page sub-entries in their own
table/group.

Completeness is an author requirement. Root entry coverage checks that subpath
names occur, not that every export has a row. Snippet compilation cannot prove
that unshown members have been documented.

### Limited Styling exceptions

A React entry that renders its own DOM and has no other owning page may explain
its own public tokens/parts in an open section, following the Component
template's source verification requirements. Link wrapped Element/presenter
styling instead of copying it.

The UI root may explain shared style installation and link Overview theming;
individual token/class/part tables remain on presenter pages. Pure data or
Headless APIs do not acquire unrelated Styling sections.

## Acceptance

- Title, paths, dependencies, signatures, options, and defaults agree with the
  release surface; publication-dependent setup is appropriately verified.
- The root inventory is complete; local capability navigation uses that source
  and every export has a semantic owner.
- Reconcile reference tables manually: types, classes, factories, and same-page
  sub-entries are neither omitted nor mixed with foreign exports.
- Examples prepare key inputs and model the failure/cleanup they demonstrate;
  run `npm run check:doc-snippets` for supported fences and literal sandbox code.
- Exercise browser-dependent examples. An editor mounting or types passing is
  not proof that execution succeeds.
- Links reach actual explanations. Check the blind spots in
  [Conventions](DOCS-CONVENTIONS.md), recording remaining work only in
  [STATUS.md](../STATUS.md).
