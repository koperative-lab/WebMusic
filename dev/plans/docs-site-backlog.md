# Docs site backlog — execution order

> **Historical snapshot, not the current work queue. Organized 2026-09-05.**
> This file preserves the original plan, source judgments, review evidence and
> subsequent implementation notes. Counts, branch descriptions, phases and
> statements about what is "current" belong to the dates recorded in the text;
> they do not define today's rules or unfinished work.
> Current work lives in [STATUS.md](../STATUS.md), accepted design in
> [DECISIONS.md](../DECISIONS.md), and document ownership in
> [DOCUMENTATION-MAP.md](../DOCUMENTATION-MAP.md).
> Use [COMPONENT-DESIGN.md](../design/COMPONENT-DESIGN.md) for new component designs;
> do not execute the old phase list directly.

This file preserves the 2026-08-23 closure list, dependency order and
acceptance evidence. Its original instruction to record new gaps first in
DOCS-SITE-PLAN.md is superseded by [STATUS.md](../STATUS.md). Do not reopen
this file as today's backlog. Page counts, paths, npm status and completion
labels in the body are historical observations, not current registry or
deployment evidence.

<!-- docs:historical-body -->

---

> **What is wrong** is not here. It lives once, in
> [DOCS-SITE-PLAN.md](../DOCS-SITE-PLAN.md) §"Where today's site falls short of
> this". This file owns only the **order, the dependencies, and the acceptance
> check** for each open item — the things a list of defects cannot carry.
>
> Snapshot: 2026-08-23. **All nine items closed.** What replaces this list is
> whatever the next review finds; DOCS-SITE-PLAN.md §"Where today's site falls
> short of this" is where new gaps are recorded first.
> Every item's acceptance ends with `npm run check` green, so add the
> mechanical part of a rule to `scripts/check-docs.mjs` in the same commit
> that lands the rule.

## Dependency shape

```text
1. Quick Start            (independent) ─────────┐
2. UI Kit URL move        (independent) ─────────┤
6. Install consolidation  (independent) ─────────┼──▶ 7. snippet compile check
                                                 │
3. Headless infrastructure ──▶ 4. Headless split ┤
                           └──▶ 5. Bridge split ─┤
                                                 │
                        4 ──▶ 6′. API page slimming
```

Items 1, 2 and 6 touch disjoint files and can run in parallel or in any order.
Items 4, 5 and 6′ all wait on 3, because they need the same panel.

---

## 0. Unblock the gate — **closed 2026-08-22**

The obsolete `UiPresenterPage.astro` read and generated-page alternative are
gone. Architecture validation now treats the authored `LiveDemo + Related`
skeleton as the only accepted UI Kit page shape, and all eighteen presenter
pages pass it.

## 1. Quick Start — **closed 2026-08-23**

`/quick-start/` exists, sits second in the Site group, and follows the
DOCS-SITE-PLAN contract: one-line install, one Score tag and one Audio tag
through `/auto` (with the `/global` alternative), then one code-only call per
family from the entry it really lives on — `playScore` from
`@webmusic/score/play/headless`, `loadClipFromUrl` from `@webmusic/audio/play`
— ending by routing to the two Getting Started pages.

Introduction lost the three routing tables it was using to do Quick Start's
job and the family overviews': it is now the package table, the docs
vocabulary, and a pointer onward, per its own contract.

That delegation only works if the family overviews route, so both were
rewritten to their contract in the same change: `/score/` and `/audio/` are
capability tables — one row per capability, each linking its Web Components,
Headless and API pages — plus what the family excludes and its optional
peers. Before this, both were bullet lists that linked **only** to `play`;
`analyze` and `view` were unreachable from a family overview.

## 2. UI Kit URL move — **closed 2026-08-23**

`/ui/` → `/uikit/` (overview), `/uikit/` → `/uikit/catalog/` (catalog),
`/ui/presenters/` → `/uikit/api/` (the `@webmusic/ui` root, API template).
The `/ui/` prefix is gone from the content tree.

What the move cost, and what it bought:

- **29 inbound links** were retargeted — 22 files linking
  `/ui/presenters/#the-shared-presenter-shape` (all eighteen presenter pages
  plus four element pages and the overview) and the rest linking `/ui/`. The
  `link` check found every one of them, which is exactly the risk this item
  named.
- **`/uikit/api/` is 109 lines, down from 462.** The eighteen per-presenter
  `###` sections were **deleted, not moved**: the presenter pages have owned
  that reference since `7a1e5fe`. What survives is the shared presenter shape
  (with its `#the-shared-presenter-shape` anchor intact) and the release
  boundary, plus the entry table the API template requires.
- **`/uikit/` is 207 lines, down from 428.** Per its contract it kept
  positioning, the three ways to use WebMusic, theming, customization depth
  and the layer contract; it lost `## Published UI surface`,
  `## Accessibility contract` and `## Lifecycle and ownership` (the shared
  shape, now on `/uikit/api/`), the rendered gallery and the composition
  ledger (the Catalog owns the browse surface), and `## Migration sequence`
  (no contract owns it, and it described `dev`).
- **Redirects**: `/ui` → `/uikit`, `/ui/presenters` → `/uikit/api`, and
  `/score/ui-kit` retargeted from `/ui` to `/uikit` in the same batch so it
  does not chain.
- **Sidebar**: Overview and Catalog are now separate items, and the API entry
  is labelled `@webmusic/ui` rather than "API reference" — DOCS-SITE-PLAN
  §"Titles and labels" forbids the word. Kernel's `API` item was renamed
  `@webmusic/kernel` for the same reason.

Two checks moved with it, in the same commit as the rule:

- `check:docs` now runs `checkRootEntryCoverage` for `@webmusic/ui`, so
  `/uikit/api/` must name all eighteen entries and no non-entry, and
  `checkTitles` requires its title to be `@webmusic/ui`.
- `check:architecture` asserted the **old** shape — "UI Kit navigation must
  lead with the catalog and presenter pages, without an Overview item", from
  when `/uikit/` was the catalog. It now asserts the shape DOCS-SITE-PLAN
  actually specifies (Overview, Catalog and `@webmusic/ui` items at their
  URLs) and fails if the sidebar still points anywhere under `/ui/`.

## 3. Headless infrastructure — **closed 2026-08-23**

`src/components/HeadlessPlayground.astro` + `src/lib/headless-params/` exist,
on the model of `ElementPlayground` + `src/lib/params`, and `ScorePlayer` is
the first object driving them (`components/headless/ScorePlayerPlayground.astro`,
rendered on `score/headless/play.mdx` in place of the old
`ProgrammaticScorePlayerDemo`, which is deleted).

The two things the element panel has no equivalent of are both there: a
**State** readout refreshed by the object's own events rather than a timer,
and an **Event trace** — without which a reader never sees `on()` at all.

The panel is chrome only; it imports no package. The page's demo module
publishes a factory on `window` under a key the panel names, and the shared
client (`src/lib/headless-playground-client.ts`) owns the four behaviours:
re-create on an option change (disposing the previous object first, so the
panel models the ownership it documents), call through on a command,
refresh state from the object's events, and fill the trace. A generation
counter drops a slow factory's result if a newer option change won the race.

**Accepted against a real browser**, not just a build. Driving the page in
headless Chromium:

| Behaviour | Evidence |
| --- | --- |
| Options re-create the object | `tempo: 160` rewrote the readout **and** recomputed `durationSeconds` 4.80 s → 3.00 s — a new object, not a relabelled one |
| Commands call the live object | `seekFraction(0.5)` moved `progress` to `0.500` |
| State refreshes on its own events | `seconds` reached 1.55 s during playback, driven by `timeupdate` |
| The trace fills | 8 entries, newest first, with payloads |
| No console errors | none |

## 4. Headless per-object split — **closed 2026-08-23**

All six aggregated capability pages are split: 34 sections became 31 object
pages plus six capability overviews, and every Headless sidebar group is
`autogenerate`d.

| Capability | Was | Now |
| --- | --- | --- |
| `score/play` | 13 sections, 1 page | overview + 13 pages |
| `score/analyze` | 2 sections | overview + 3 pages |
| `score/view` | 6 sections | overview + 2 pages |
| `audio/play` | 5 sections | overview + 6 pages |
| `audio/analyze` | 2 sections | overview + 2 pages |
| `audio/view` | 6 sections | overview + 4 pages |

The site went from 90 pages to 120.

**Prose was moved, not rewritten**, wherever it existed: `score/play`'s
thirteen sections were split mechanically with their ten live demos intact,
so no wording and no working demo was lost to the restructuring. The pages
that had no aggregated prose to inherit — `score/view`, `score/analyze`,
`audio/analyze`, `audio/play`, `audio/view` — were written against source,
reading each object's options, commands, state and events out of
`packages/*/src/*/headless/` rather than from the API pages.

Two corrections the split surfaced:

- **`score/view`'s headless page was documenting the renderers.**
  `renderPianoRollVisualizer` and friends are `/render` exports, not headless
  components, and four of the five were already documented on
  `score/api/view.mdx` — the page carried a duplicate. They are gone from
  headless, and `bindPlayerToVisualizer`, which only the headless page had,
  moved to the API page where the rest of `/render` lives.
- **The export tables' anchors became page links.** `check:docs` caught the
  two inbound links to `#playercontroller--an-event-wrapper` that the split
  invalidated; three anchor redirects carry the most likely bookmarks.

`checkHeadlessExports` now accepts either shape — one aggregated page or a
directory of object pages — and checks a split capability across all of its
pages, so the completeness proof survived the restructuring it was written
for.

## 5. Bridge split — **closed 2026-08-23**

`bridge/index.mdx` was one 118-line page carrying an overview, a demo, the
sync object and the stateless API. It is now three, per DOCS-SITE-PLAN
§"Bridge and Kernel":

- **`/bridge/`** — the platform overview: the rule that defines the package
  (the only one allowed to import both families), when a reader needs it, its
  place in the dependency graph, one minimal example, and pointers onward.
- **`/bridge/headless/score-audio-sync/`** — `ScoreAudioSync` under the
  headless template, with `createSyncedPlayback` and
  `createAudioMasteredPlayback` on the same page, since a class and its
  factories share one. The demo moved here, and the two role narratives
  (score as master, audio as master) were **moved rather than rewritten**.
  `/bridge/headless/` is the capability overview with the export table.
- **`/bridge/api/`** — the API template over a single-entry package. Its API
  Reference lists **every** root export, `ScoreAudioSync` and its factories
  included, as rows linking to the headless page — the thing this item warned
  about, since the bridge has no `/headless` subpath to hide them behind.

The sidebar entry was a bare top-level link; it is a section now (Overview ·
Headless · `@webmusic/bridge`), with the headless group autogenerated. Both
new pages are wired into `check:docs`: the bridge is in
`checkRootEntryCoverage` (vacuous for a single-entry package, but it pins the
page to the manifest) and `checkTitles` now holds `/bridge/api/` and
`/uikit/api/` to their entry names.

## 6. Install consolidation — **closed 2026-08-23**

Both halves are done. The package subpath table lives on each root API page
and nowhere else (2026-08-22, with `checkRootEntryCoverage` enforcing that
the root names every entry). The eleven `## Install` sections are now one
line each — the install command, the fact that npm publication has not
happened, and a link to the Getting Started page that owns install in full —
plus whatever optional peers *that* entry needs. The identical
"not yet published to npm" admonition that stood on nine of them is gone.

## 6′. API page slimming — **closed 2026-08-23**

API pages carried full sections on headless objects and, on the analyze and
view pages, Web Components sections with attribute tables and element demos.
Both halves are done.

- **Web Components (2026-08-23, earlier).** `score/api/analyze.mdx` and
  `score/api/view.mdx` lost their element sections — 179 lines — and four
  embedded element demos, each replaced by a paragraph naming the
  capability's five tags and linking the section that documents them. This
  half never depended on item 4: the thirty element pages already owned that
  content, verified before deleting it.
- **Headless (2026-08-23, after item 4).** 535 more lines came off four
  pages — `score/api/play.mdx` (LfoController, ScorePlayer,
  InteractivePlayer, Sound, Effect, Rack, LoopPlayer/AbPlayer, transport
  drivers), `audio/api/play.mdx` (the three transports, the recorder,
  effects), `audio/api/analyze.mdx` (realtime analyzer, incremental
  analysis), `audio/api/view.mdx` (the live scrolling controller). Each page
  now carries one short section pointing at the Headless group where those
  objects are documented per object.

  Deleting rather than moving was only safe **because** item 4 landed first:
  the prose those sections duplicated now has a home. Doing it in the other
  order would have destroyed it, which is what this item's dependency note
  warned about.

`check:docs` caught the three inbound links to
`#rack--many-instruments-one-ensemble` that the removal invalidated; they
point at `/score/headless/play/rack/` now.

- **Accept:** no API page has a section for an engine, a tag or a presenter —
  only a row and a link. **Met.**

## 7. Snippet compile check — **closed 2026-08-23**

`check:docs` verified structure, links and catalogs; nothing verified that a
code block still matched the code, which is the one thing an API page is for.

`npm run check:doc-snippets` (`scripts/check-doc-snippets.mjs`, in
`check:source` after `build:packages`) reads every ` ```ts ` fence importing
`@webmusic/*` and requires the entry to be in that package's exports map and
every named import to be exported from it, read off the **built** `.d.ts`.
Today: 168 imports across 147 snippets.

It stops at imports rather than compiling bodies, and that is a deliberate
narrowing of the sketch. Most snippets are fragments continuing their prose
("assume a `score` built with…"), so type-checking them standalone would
report hundreds of undeclared identifiers that are not defects. Imports are
what rots silently.

- **Accept:** a deliberately broken snippet fails `npm run check` — verified
  both ways, a renamed export (`playScoreNow`) and a moved entry
  (`@webmusic/audio/playback`), each reported by name.
