# Repository review against the dev/ standards — 2026-08-22

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

This file preserves the 2026-08-22 review and its 2026-08-23 follow-up,
including the command results, remote observations, line references and
remediation plan recorded then. "Still open" is not today's backlog; see
[STATUS.md](../STATUS.md) and its linked later audits for follow-up. The
original check results are not rewritten here, and the recorded branch, tag,
npm or CI observations are not extrapolated to the present.

<!-- docs:historical-body -->

---

A dated compliance snapshot: every document under `dev/` (the handbook, the
site plan, the conventions, the four page templates, the six plans) read in
full, then the whole repository checked against them. Reviewed at `main`
`9b2112b` (== `claude/dev-standards-project-review-3lv09e`) and `origin/dev`
`019f46d`. Method: the complete local gate (`npm run check`) was run; the CI
history was pulled from GitHub Actions; three independent audit passes covered
the docs site, the package/architecture claims, and the six plans, each
verified against source with file-and-line evidence.

This file is a **report**, per DOCS-SITE-PLAN.md §"Ownership": where two
governing documents disagree, or a document disagrees with the repo, the
finding is recorded here for the maintainer to dispose. Closing a finding
edits the owning document or check — never this file. Docs-site defects that
the existing backlog already owns are referenced by item number, not
restated.

> **Status, 2026-08-23.** The findings below are the snapshot as taken and
> are deliberately not edited as they close. Acted on since:
>
> - **Phase 0 in full** (§2) — the lockfile, the `check:lockfile` guard, CI on
>   `dev`, and a build race the lockfile fix exposed.
> - **Phase 1 in full** (§4, §5) — every stale statement listed, plus
>   corrections sections on all five family plans, and the `main`/`dev`
>   two-surface model recorded with `dev` as the archive.
> - **Phase 2, seven of nine backlog items** (§6): Quick Start, the UI Kit URL
>   move, the headless playground, the Bridge split, Install consolidation,
>   the snippet check, and the root API export coverage. Items 4 and 6′ are
>   each half closed and both wait on the same remaining work — splitting the
>   six aggregated headless pages into one page per object.
> - **Several §6 findings closed alongside their item** rather than waiting to
>   be accepted into DOCS-SITE-PLAN: the family overviews (§6.5), the `/ui/`
>   overview's off-contract sections (§6.2), the stray `# APIs` H1s (§6.4),
>   the orphaned demo components and retired vocabulary (§6.8, §6.9).
>
> Still open: the per-object headless split, the §6 findings not listed above
> (demo-layout drift, the exactly-one-demo and page-shape checks), and
> Phase 3's branch reconciliation.

---

## 1. What conforms

Credit where the machine agrees with the prose:

- **The full local gate is green.** `npm run check` passes end to end on this
  tree: format, lint, architecture, all five builds, typecheck, `typecheck:tests`,
  every test suite, license gate, 86 public entries, release manifests at
  `0.1.0`.
- **The 30-element baseline is exact.** The element sources and
  `apps/doc/shared/ui-catalog.ts` are a bijection — 5 per capability × 6, no
  orphan on either side; 29 `composed` plus the reviewed `behavior`-only
  `<audio-analysis>`, exactly as ARCHITECTURE.md's roadmap counts them.
- **The UI presenter surface agrees four ways**: `packages/ui/src` (18
  presenters + `index` + private `styles`), the manifest exports, the
  ARCHITECTURE.md entry table, and `ui-presenter-catalog.ts` are identical
  sets. Kernel and bridge exports match their tables exactly; no `/elements`
  alias survives.
- **`check:docs` does what its six check names promise** (`params`, `catalog`,
  `page`, `title`, `plan`, `link`), and the two enforcement claims in
  DOCS-SITE-PLAN's "Done" list are real code (`checkCapabilityGroups`
  fails an overview that carries a demo; `checkUiKitLabels` diffs the sidebar
  against `UI_PRESENTER_CLASSES`).
- **The gap bookkeeping is honest.** All seven "Done since the first pass"
  claims in DOCS-SITE-PLAN §"falls short" verified true on disk; all open
  items verified genuinely open. No redirect chains exist today.

## 2. The one mechanical failure: CI has never been green

**Every CI run since the workflow was restored is a failure — 24 of 24**
(runs #1–#24, 2026-08-15 → 2026-08-22, all on `main`). All three jobs die
~60 s in, at the first tsup invocation, with:

```
Error: Cannot find module @rollup/rollup-linux-x64-gnu
```

Root cause, reproduced locally on a fresh clone: `package-lock.json` records
the platform-specific optional dependencies for **darwin-arm64 only** — the
only `@rollup/rollup-*` entry is `rollup-darwin-arm64`, the only `@esbuild/*`
entry is `darwin-arm64` (the npm optional-deps bug,
npm/cli#4828, triggered when the lock was regenerated on macOS over an
existing `node_modules`). esbuild recovers at install time via its own
fallback; rollup hard-fails, so `npm ci` on the ubuntu runners produces a
tree that cannot build. The code itself is fine — with the binary present,
the full chain passes.

Two side facts:

- `ci.yml` triggers on `push: branches: [main]` and PRs only. The active
  `dev` branch gets no CI on push.
- DEVELOPMENT.md §"State of the world" reads "Everything is green" and "CI
  restored". True locally; the CI half has never been true.

## 3. Two branches, one undocumented model

The repository actually runs a two-surface model that no `dev/` document
records:

- **`main`** — the frozen first-release surface: 30 elements, 18 presenters
  (`ad2bbff` deleted `device`, `inspector`, `profile`, `sequencer`, `tempo`,
  `tokens`, `xy` from `@webmusic/ui`).
- **`origin/dev`** — the expansion surface: 45 elements (score/play 13,
  score/analyze 12, the rest 5 each; `6e3f305` "restore the fifteen parked
  elements at their original paths") and a 39-module UI kit that keeps the
  seven deleted presenters and adds a DAW-workspace layer (`arrangement`,
  `automation`, `channel-strip`, `clip-launcher`, `piano-roll`, …).

Consequences:

- **The two branches have diverged both ways in `packages/ui/src`**: `main`
  added `minimap` / `panel` / `status` after the fork; `dev` kept the deleted
  seven and added twelve more. The next `main` → `dev` merge is a real
  reconciliation, not a fast-forward.
- **`dev` has none of the documentation governance.** `main`'s two newest
  commits (`7a1e5fe` presenter pages, `9b2112b` — DOCS-SITE-PLAN, the four
  templates, DOCS-CONVENTIONS, the backlog, i.e. the very standards this
  review is against) are absent from `dev`, along with
  `ui-presenter-catalog.ts`.
- **Dangling parked-branch references.** Commit messages (`c75de86`,
  `1747022`, `fdaa04e`) say elements are "parked on `dev-score-play-parked`"
  / "`dev-score-analyze-parked`". Neither branch exists on the remote —
  `origin` has exactly `main` and `dev`. The states are still reachable
  through the deleting commits' parents, but the named recovery path is a
  dead pointer.

## 4. Stale statements in the normative documents

DEVELOPMENT.md's own rule: "When this file disagrees with observed repo
state, trust the repo and fix this file." The following claims disagree with
the repo today.

| # | Where | Claim | Reality |
|---|---|---|---|
| 4.1 | ARCHITECTURE.md:509 | "all five surviving Score play elements extend it [`WebMusicElement`], `<synth-panel>` included" | 3 of 5. `note-input.ts:71` and `score-recorder.ts:40` extend `HTMLElementBase` — and line 514 itself names them as unmigrated, contradicting line 509 (they *are* two of the five play elements per `play/element/index.ts`). |
| 4.2 | ARCHITECTURE.md:514–515 | "Still on the plain `HTMLElementBase`: … the five `view` elements, the five `analyze` elements" | True for Score only. All five Audio analyze elements, all five Audio play elements and `<audio-view>` extend `WebMusicElement` — the largest completed block of kernel-lifecycle adoption is undocumented. |
| 4.3 | ARCHITECTURE.md:503 | `<synth-panel>`'s "domain-state boundary remains Partial" | `ui-catalog.ts` marks `synth-panel` `composed`; no catalog entry uses `partial` (or `extract`) any more — dead status vocabulary in `UI_STATUS_LABELS`. |
| 4.4 | DEVELOPMENT.md:83, PUBLISHING.md:77–80 | "The repository already has a historical `v0.1.0` tag" (publish guidance builds on replacing it) | `git tag -l` is empty — the repo has **no tags at all**. The guidance is unactionable as written; conversely `v0.1.0` is freely available. |
| 4.5 | DEVELOPMENT.md:39–43, PUBLISHING.md:12–14 | UI migration "incremental"; Score/Audio consume "transport, **tempo**, meter, parameter-rack, envelope and **XY**" presenters | `tempo.ts` and `xy.ts` were deleted in `ad2bbff`; the entry is `parameter`, not `parameter-rack`; and `scripts/element-composition-policy.mjs` now pins all 30 elements — the migration is complete on `main`, not incremental. |
| 4.6 | DEVELOPMENT.md:77–79 | Plan step 1: "Land the first UI migration tranche. Review the profile/presenter … changes" | Moot: `profile.ts` no longer exists (`ad2bbff`) and the tranche landed (`de26fee` + `ad2bbff`). |
| 4.7 | DEVELOPMENT.md:15, 64 | `check:docs` enforces "unique titles" | It checks title presence and *form* only; DOCS-CONVENTIONS.md:46 states titles are deliberately **not** unique site-wide. |
| 4.8 | DEVELOPMENT.md:98 | Archived release scripts "still encode … the old repository slug" | `release-pipeline/{promote,publish,verify-promotion-authority}` hard-code `mrsteamedbun/WebMusic` — the current slug. (The thirteen-package-order half is correct.) |
| 4.9 | DEVELOPMENT.md:68, README.md:60 | "`/` redirects to `/introduction/`" | Backwards. Introduction lives at `/` (`index.mdx`, per DOCS-SITE-PLAN's site tree); `astro.config.mjs:83` redirects `/introduction` → `/`. |
| 4.10 | README.md:8 | `@webmusic/ui` ships "the optional `UIProfile` interface" | `profile.ts` deleted in `ad2bbff`; no `UIProfile` export exists on `main`. |
| 4.11 | DOCS-CONVENTIONS.md:29 (`plan` row) | "a root API page has a section for every entry in the package export map" | Implemented for the kernel only — `checkEntrySections` is invoked exactly once, on `kernel/api.mdx`. Score/audio/ui/bridge root API pages get no export-map diff. |
| 4.12 | dev/plans/docs-site-backlog.md:8 | "Snapshot: 2026-08-22. Six items open, seven closed." | The file's own list is **8 open + 1 closed** (items 1–7 and 6′ open; item 0 closed). |
| 4.13 | kernel/api.mdx frontmatter | "The nine kernel entries — events, element, worker, audio-context, player, effect, transport, and tick" | Says nine, lists eight, the page documents ten (`meter`, `sync` added; description never updated). |
| 4.14 | DEVELOPMENT.md commands table | — | Omits `docs:build` — the script CI's docs job actually runs — plus `lint`, `check:source`, `check:architecture`, `check:format`, `check:licenses`, `check:packages`, `check:release-manifests`, `typecheck`, `audit:production`, `build:kernel`. |
| 4.15 | DEVELOPMENT.md document table | — | Registers only one of the six files in `dev/plans/` (the backlog). The five element-expansion plans have no owner row and no status. |

## 5. The six element plans against the code they describe

The five family plans were written 2026-08-17/18 for a 92-element panorama.
`main` has since been deliberately frozen at 30 (5 per capability), the
overflow living on `dev`. Each capability ended at exactly 5 shipped
elements; every one of the 42 proposed-but-absent tags was verified to have
**never existed as a file on any branch** — the "removed" cases are all
pre-existing elements (six score/analyze elements deleted in `1747022`;
`analysis-inspector` added and reverted the same day in `fdaa04e`).

Per-plan validity, with the load-bearing false statements:

| Plan | Verdict | Key false statements in the current text |
|---|---|---|
| score-analyze-elements.md | ~30 % valid; **no corrections section** | §1's whole 8-element compliance table (six of the eight are deleted); "`mountInspector` … used only by `<sound-font>`" (both deleted); "`mountTimeline` … no consumers" (three now); "`rhythmPatterns` … no element presentation" (`<rhythm-patterns>` shipped); Phase 2 step 5 (`<analysis-inspector>`) is dead work — tried, reverted, presenter deleted. |
| score-view-elements.md | ~35 % valid; **no corrections section** | §1 false in every clause: "only one element" (five), "marks it partial" (`composed`), "bypasses `createScoreView`" (composed at `score-view.ts:228`), "drops `webscore:noteoff`" (hook exists in `render/binding.ts`); §0/§2B rest on deleted `mountInspector`/`uiTokens`/`mountSequencer`; `mountTrackList` "new" (already built by audio/view); Phase-1 repair is **half done** — items 1, 2, 6 landed; attributes (`viewport-*`, `virtualization`, `instruments`), `seek()`, `webscore:noteclick`, and the protected hooks (`renderScore` etc. are still `private`) did not. |
| audio-play-elements.md | ~35 % valid; **no corrections section**; most damaged by `ad2bbff` | Rests on deleted surfaces: `xy-control` (its §0 rule-2 justification), `<sound-font>` / `<midi-input>` as templates, `mountDevice`; §6's adoption scorecard names three deleted presenters and two (`mountEq`, `mountParameterRack`) that still have zero audio consumers; the `@webmusic/kernel/eq` hoist never happened; `webaudio:trackchange` shipped `{id, index}` not `{id}` (plus an unplanned `trackend`). |
| audio-analyze-elements.md | ~60 % valid; §7 corrections honest | One §7 sentence now false: "`<audio-analysis-inspector>` has its presenter (`mountInspector` …) — both remain buildable". `inspector.ts` was deleted the following day; only `<audio-realtime-analysis>` remains buildable. |
| audio-view-elements.md | ~55 % valid; §7 accurate but incomplete | §7 never retracted: `mountWaveformTrack` (never built — thumbnail shipped on `mountCanvasStage`), the "viewport-brush extension to waveform-track" (what landed is the standalone `./minimap` entry, created in `de26fee`), `mountLegend` (never built), and "touchpoint-list correction applied retroactively to all six plans" (only this file carries it). |
| docs-site-backlog.md | Accurate on content | Header count wrong (4.12); order/dependency structure verified sound. |

Cross-cutting: all four plans citing "score/play (3 groups, 19 elements)"
were **already false on their authoring day** — score/play had 13 elements on
2026-08-17 (21 → 13 on 08-15, → 5 on 08-19). The cross-plan
"consumes/contributes" ledgers now reference four deleted presenters
(`mountInspector`, `mountDevice`, `mountXy`, `mountSequencer`) and one
deleted registry (`uiTokens`); on `dev` those modules still exist, which is
one more reason the plans need re-baselining against the branch they now
describe.

## 6. Docs site vs the backlog and templates

Confirmed state of the backlog (evidence in the audit, none of it started):

- **Item 1 Quick Start** — no page, no sidebar entry; Introduction still
  carries the four routing tables.
- **Item 2 UI Kit URL move** — `/ui/` (428 lines) still the overview, off
  the sidebar; `/uikit/` still the catalog; `/ui/presenters/` still 462
  lines with 18 per-presenter sections the presenter pages now duplicate;
  `/score/ui-kit` still targets `/ui`; neither new redirect exists. All 18
  presenter pages link `/ui/presenters/#the-shared-presenter-shape`.
- **Item 3 Headless infrastructure** — no `HeadlessPlayground.astro`, no
  `src/lib/headless-params/`, no `<HeadlessComposedBy>`.
- **Item 4 Headless split** — six aggregated pages (34 `##` sections;
  `score/headless/play.mdx` still the 13-section page); router `index.mdx`
  pages are hidden three-row tables, not the template's capability
  overviews; sidebar Headless groups hand-listed, not autogenerated.
- **Item 5 Bridge split** — one 118-line `bridge/index.mdx` mixing overview
  + demo + sync object + stateless API; sidebar entry is a bare link.
- **Item 6 Install consolidation** — `## Install` on all 11 family API
  pages; six capability-scoped subpath tables; **neither root API page has
  one**.
- **Item 6′ API slimming** — headless/element sections across six API pages
  (8 on `score/api/play.mdx` alone) and four element demos embedded on API
  pages.
- **Item 7 snippet compile check** — absent.

New findings the gap list does not know (candidates for DOCS-SITE-PLAN
§"falls short" — reported here, not added there):

1. **Headless capability titles** are `Headless · Play` etc. — a title-form
   violation `checkTitles` cannot see (it only checks element overviews).
2. **`/ui/` overview is off-contract**: renders `<UiKitGallery/>` and
   `<UiCompositionCatalog/>` and carries `## Published UI surface`,
   `## Accessibility contract`, `## Lifecycle and ownership` — content the
   plan assigns to `/uikit/catalog/` and `/uikit/api/`. The no-demos check
   is scoped to element overviews only, so this passes.
3. **No page anywhere has the API template's mandatory `## Entry map`**;
   nothing checks section order.
4. **Stray `# APIs` H1s** on `audio/api/analyze.mdx:49` and
   `audio/api/view.mdx:37`.
5. **Family overviews are off-contract**: `score/index.mdx` and
   `audio/index.mdx` are bullet lists, not the required capability table;
   both link only Play — `analyze` and `view` are unroutable from their
   family overview.
6. **"Exactly one demo per page" is commented in `check-docs.mjs` but only
   zero is failed** — four element pages carry 2–3 playgrounds.
7. **UI Kit and headless pages get no shape check at all** (`checkElementPages`
   matches `/element/…` only).
8. **Demo layout drift** (DOCS-CONVENTIONS §"Where a demo component lives"):
   23 page-specific demos still sit at `components/` root (12 element pages
   unaligned); the legacy `components/programmatic/` folder (12 files) still
   exists beside `components/headless/` (10 files, third naming scheme);
   `ViewVisualizerDemo.astro` is shared by two pages; `AnalysisViewDemo.astro`
   and `ScoreStudioDemo.astro` are dead files imported by nobody.
9. **Retired vocabulary in prose**: "programmatic" on five pages,
   "Transport & Time" (the "&" form) in `ui/index.mdx` prose.

---

## 7. The plan

Ordered by the repo's own doctrine: unblock the gate → make the documents
true → execute the existing backlog → reconcile the branches → release.
Each step ends with `npm run check` green; every mechanical rule tightened
gets its check in the same commit (DOCS-CONVENTIONS rule).

### Phase 0 — CI red

Do first; everything else is invisible until CI can confirm it.

- **0.1 Regenerate the lockfile with full platform coverage.** On any
  machine: `rm -rf node_modules package-lock.json && npm install`, verify
  the lock now contains `@rollup/rollup-linux-x64-gnu` *and* the darwin /
  win32 variants (npm writes all platforms on a clean resolve), re-run
  `npm run check`, commit the lock alone. *Accept:* the next `main` push is
  the first green CI run.
- **0.2 (decision) Add `dev` to `ci.yml` push branches** so the expansion
  surface is checked too. One line; the maintainer may prefer PR-only.
- **0.3 (optional guard)** A small lockfile assertion (in `check:format` or
  a new `check:lockfile`) that the platform-optional families in the lock
  cover linux-x64 — this failure mode recurs any time the lock is
  regenerated on macOS over an existing `node_modules`.

### Phase 1 — Truth pass over the normative documents

Small, mechanical, high value; no behavior changes.

- **1.1** Fix ARCHITECTURE.md roadmap ¶ (findings 4.1–4.3): correct the
  base-class inventory (3/5 score play; all 10 audio play+analyze plus
  `audio-view` migrated), drop "remains Partial", and either use or delete
  the dead `partial`/`extract` status vocabulary in the catalog.
- **1.2** Refresh DEVELOPMENT.md (4.4–4.9, 4.14–4.15): re-date the state
  section; delete the v0.1.0-tag premise (also in PUBLISHING.md) and state
  "no tags exist — `v0.1.0` is free"; rewrite the UI bullet (migration
  complete on `main`; name the real 18-entry set); replace plan step 1 with
  the actual next step; fix "unique titles" wording; fix the
  `/introduction` redirect direction (also README); add `docs:build` to the
  commands table; **register all six `dev/plans/` files** in the document
  table with a status column (active: backlog · superseded-on-main /
  continuing-on-dev: the five family plans); **document the `main`/`dev`
  two-surface model** — it is currently folklore.
- **1.3** Fix README.md (`UIProfile`, redirect direction) and PUBLISHING.md
  (tag claim, presenter list).
- **1.4** Fix the backlog header count (4.12) and the `kernel/api.mdx`
  description (4.13).
- **1.5** Scope DOCS-CONVENTIONS's `plan` row to what is enforced (root
  export-map diff: kernel only, for now) — or bring the check to all five
  roots in Phase 2 item 6 and leave the row as-is; one or the other, in one
  commit.
- **1.6** Reconcile the five family plans with reality: add the missing
  "Corrections found during implementation" sections to score-analyze,
  score-view and audio-play (the false-statement lists in §5 are the raw
  material); fix the one false sentence in audio-analyze §7; extend
  audio-view §7 with the three unretracted items. Alternatively (cheaper,
  maintainer's call): one status banner per plan pointing at the
  release-surface decision and the `dev` branch.
- **1.7 (decision)** Repair the dangling parked-branch references: create
  `dev-score-play-parked` at `c75de86^` and `dev-score-analyze-parked` at
  `1747022^` and push them (cheap, makes the commit messages true), or
  declare `dev` the sole archive and say so in DEVELOPMENT.md.

### Phase 2 — Execute the docs backlog, in its own stated order

Unchanged from `dev/plans/docs-site-backlog.md` (its ordering survived this
review): **1, 2, 6 in parallel → 3 → 4, 5, 6′ → 7.** Fold the new §6
findings into the items they belong to, each with its check:

- With **item 2**: fix the `/ui/` overview contract violations (§6.2), the
  two "API" sidebar labels, the missing Overview entry.
- With **item 4**: headless title forms + a title check for them (§6.1);
  fold `components/programmatic/` into `components/headless/` (§6.8);
  autogenerate the Headless sidebar groups.
- With **item 6**: extend `checkEntrySections` to all five package roots
  (closes 1.5 the right way).
- With **item 6′**: add the `## Entry map` sections and a check for their
  presence (§6.3); delete the stray `# APIs` H1s (§6.4).
- **New backlog candidates to add** (maintainer accepts into
  DOCS-SITE-PLAN §"falls short" + backlog): family-overview capability
  tables (§6.5 — analyze/view are currently unroutable from the family
  overviews); align the 12 element pages whose demos sit at `components/`
  root and delete the two dead demos (§6.8); enforce exactly-one-demo (§6.6)
  and presenter/headless page shape (§6.7); a vocabulary sweep (§6.9).

### Phase 3 — Branch reconciliation

Decision-heavy; do before more `dev` work lands.

- **3.1** Merge `main` → `dev`: brings the docs governance (templates,
  conventions, backlog), the presenter pages, and the 30-element baseline
  into the expansion branch. `packages/ui/src` needs a deliberate
  resolution: keep `dev`'s extended kit (including the seven presenters
  `main` deleted) *plus* `main`'s new `minimap`/`panel`/`status`, and keep
  `main`'s policy tables where they bind `main`-only surface. Run the full
  gate on the merge.
- **3.2** Re-baseline the five family plans against `dev` (that is the
  surface they now describe): mark per element whether it is `main`-scope
  (release surface — currently frozen) or `dev`-scope; re-point presenter
  dependencies (`mountInspector` etc. exist on `dev`, not `main`).
- **3.3** With 0.2, `dev` gets CI on push.

### Phase 4 — The release track

Maintainer-gated; DEVELOPMENT.md steps 2–7 otherwise stand.

- Publish the five packages per PUBLISHING.md — with the corrected premise
  that **no `v0.1.0` tag exists**, so no replacement coordination is needed;
  the optional tarball trims (score sourcemaps, `docs/README-*.md` archives)
  still apply.
- Archive the sibling repositories; port the release workflows onto
  `scripts/release-packages.mjs` (correcting DEVELOPMENT.md:98's slug claim
  while there); wire `pages:build` to GitHub Pages; then the one open code
  item (shared-clock injection + the sample-accurate loop wrap noted in the
  bridge).

### Decisions needed from the maintainer

1. CI on `dev` pushes — yes/no (0.2).
2. Plan reconciliation style — full corrections sections vs status banners
   (1.6).
3. Parked-branch repair — push the two named branches vs declare `dev` the
   archive (1.7).
4. Root-API export-map check — scope the prose down now or extend the check
   in Phase 2 item 6 (1.5).
5. Accept the new backlog candidates into DOCS-SITE-PLAN §"falls short"
   (Phase 2) — per the ownership rule, only the maintainer's decision moves
   them from this report into the owning list.
