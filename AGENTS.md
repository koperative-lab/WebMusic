# Agent guide for WebMusic

This guide applies throughout the repository. It maps the documents to read
and the workflow to follow; the linked owners retain their design, reference,
and verification authority. Read task-relevant material, not every historical
file. All paths below are relative to this repository root.

`AGENTS.md` is the repository's canonical agent instruction file. Edit it
directly; keep one maintained instruction entry point.

Repository-wide guidance lives under `dev/`. Keep the project introduction and
agent entry points at the root; keep package/platform references beside their
owning source. Use the directory map below when adding documentation.

Project-specific [skills, workflows and tool recommendations](.agent/README.md)
live in `.agent/`. Read a matching resource when the task benefits from it;
these route to `dev/` owners and do not replace their contracts. This directory
does not automatically configure client skill discovery or command permissions.

The first-release `main` checkout contains Kernel, UI Kit and Score. Audio and
Bridge remain accepted product and architecture directions, but their source,
tests and public references have not been migrated into this checkout. UI remains
a separate package for Score visual composition. Do not restore deferred packages
or their site navigation to `main` without an explicit scope change.

Guidance can be synchronized across maintained branches only after the target
branch contains its own tracked files. Implementation status, generated inventories
and available checks belong to each checkout: read its STATUS, manifests and source
before treating a documented capability or verification result as delivered there.
A documentation sync must preserve branch-specific code, plans and historical
evidence.

## Start every task

1. Read the user's current request. Inspect `git status --short`, the current
   branch, and changes in the affected files. Preserve unrelated work and
   existing uncommitted changes; do not reset or replace them to simplify a task.
2. Read [dev/README.md](dev/README.md) for documentation ownership, then
   [PRODUCT.md](dev/PRODUCT.md) for the product direction. WebMusic is a music
   interaction toolkit supporting Web Components, Headless, and API + UI
   composition, with music software and installations as application goals.
3. Consult [STATUS.md](dev/STATUS.md) for the relevant implementation gaps and
   [DECISIONS.md](dev/DECISIONS.md) before changing an accepted contract. The
   user's requested scope determines the task; STATUS is context, not an
   instruction to start unrelated backlog items.
4. Read [ARCHITECTURE.md](dev/ARCHITECTURE.md) and
   [DEVELOPMENT.md](dev/DEVELOPMENT.md) before implementation. Follow the
   task-specific references below to the owning source, public types, and tests.
5. Use [COMPONENTS.md](dev/COMPONENTS.md) to locate existing capabilities and
   [DOCUMENTATION-MAP.md](dev/DOCUMENTATION-MAP.md) to find **every indexed
   Markdown/MDX document**, including public references and historical records.
   These generated indexes avoid a second manually maintained inventory here.

## Development directory map

| Location | Contents and reading role |
|---|---|
| [dev/README.md](dev/README.md) and `dev/*.md` | Current product, principles, decisions, architecture, workflow and status; generated discovery indexes |
| [dev/design/](dev/design/README.md) | Component design, playback binding and Analyze/View/Play family contracts |
| [dev/docs/](dev/docs/README.md) | Documentation site structure, authoring conventions and public-page templates |
| [dev/release/](dev/release/README.md) | Current version policy and manual publishing procedure |
| [dev/plans/](dev/plans/README.md) | Historical proposals and implementation briefs; consult STATUS before reusing them |
| [dev/audits/](dev/audits/README.md) | Dated findings, verification records and retained evidence |
| [dev/log/](dev/log/README.md) | Completed work sequences and reusable review briefs |
| [dev/prototypes/](dev/prototypes/README.md) | Exploratory mockups; not shipped components or acceptance evidence |

## Documentation ownership map

| Need | Read | Use it for |
|---|---|---|
| Project introduction | [README.md](README.md) | Package orientation and getting started |
| Documentation entry point | [dev/README.md](dev/README.md) | Reading routes and SSOT boundaries |
| Agent tools and repeatable procedures | [.agent/README.md](.agent/README.md) | Project skills, workflow entry points and prioritized tool recommendations |
| Product scope | [PRODUCT.md](dev/PRODUCT.md) | Users, scenarios, integration choices, resource reuse, long-term goals |
| Logic, interaction, and visual philosophy | [DESIGN-PRINCIPLES.md](dev/DESIGN-PRINCIPLES.md) | State/time authority, feedback, accessibility, styling and resource principles |
| Accepted choices | [DECISIONS.md](dev/DECISIONS.md) | Decisions, reasons, consequences and the next-decision format |
| Technical architecture | [ARCHITECTURE.md](dev/ARCHITECTURE.md) | Package/capability boundaries, layers, timing, ownership and executable policy |
| Component design | [COMPONENT-DESIGN.md](dev/design/COMPONENT-DESIGN.md) | Design questions, copyable design template and acceptance scenarios |
| Analyze/View attachment to Play | [PLAYER-BINDING.md](dev/design/PLAYER-BINDING.md) | Accepted data/state/time binding direction, target companion syntax, open contract choices and acceptance scenarios; STATUS owns delivery gaps |
| Analyze component boundaries | [ANALYZE-COMPONENTS.md](dev/design/ANALYZE-COMPONENTS.md) | Live analysis surfaces, retained roles and API/Headless report ownership |
| View component families | [VIEW-COMPONENTS.md](dev/design/VIEW-COMPONENTS.md) | Type-selected representations, independent views and notation boundaries |
| Play component boundaries | [PLAY-COMPONENTS.md](dev/design/PLAY-COMPONENTS.md) | Playback/input/control roles, shared transport and lifecycle ownership |
| Component and export discovery | [COMPONENTS.md](dev/COMPONENTS.md) | Generated links to contracts, composition, catalogs and source |
| All repository documentation | [DOCUMENTATION-MAP.md](dev/DOCUMENTATION-MAP.md) | Generated file inventory and current/historical reading roles |
| Current delivery and verification gaps | [STATUS.md](dev/STATUS.md) | The single current work queue |
| Contributor workflow | [DEVELOPMENT.md](dev/DEVELOPMENT.md) | Setup, commands, final acceptance, CI and build troubleshooting |
| Documentation information architecture | [DOCS-SITE-PLAN.md](dev/docs/DOCS-SITE-PLAN.md) | Routes, page ownership, navigation and demo responsibilities |
| Documentation checks | [DOCS-CONVENTIONS.md](dev/docs/DOCS-CONVENTIONS.md) | Authoring rules, actual gate coverage and manual acceptance boundaries |
| Web Component reference | [COMPONENT-PAGE-TEMPLATE.md](dev/docs/COMPONENT-PAGE-TEMPLATE.md) | Tag/workflow page, live demo, attributes/properties/events and styling |
| Headless reference | [HEADLESS-PAGE-TEMPLATE.md](dev/docs/HEADLESS-PAGE-TEMPLATE.md) | Import, options, commands, state, events, lifecycle and Related links |
| UI presenter reference | [UIKIT-PAGE-TEMPLATE.md](dev/docs/UIKIT-PAGE-TEMPLATE.md) | Binding, handle, interaction, styling and composition contracts |
| Package/API reference | [API-PAGE-TEMPLATE.md](dev/docs/API-PAGE-TEMPLATE.md) | Entry maps, examples, complete API ownership and dependencies |
| Publishing procedure | [PUBLISHING.md](dev/release/PUBLISHING.md) | Manual release preparation, external verification and publication |
| Version and release policy | [RELEASING.md](dev/release/RELEASING.md) | Shared version preparation, active CI and the link to archived release machinery |

## Find the implementation and its reference

Public documentation source lives under
[apps/doc/webmusic/src/content/docs/](apps/doc/webmusic/src/content/docs/).
Use each family page and its `element/` and `headless/` inventories to find the
owning leaf page; do not copy a complete member table into another document.

| Work area | Source | Technical and public references |
|---|---|---|
| Symbolic music: models, I/O, play, analysis, views, React | [packages/score/src/](packages/score/src/) | [Score README](packages/score/README.md), [Score architecture](packages/score/ARCHITECTURE.md), [Score docs](apps/doc/webmusic/src/content/docs/score/index.mdx) |
| Digital audio design (deferred) | No source workspace in this checkout | [Product direction](dev/PRODUCT.md), [Architecture](dev/ARCHITECTURE.md), [current status](dev/STATUS.md); verify a target branch before using its implementation |
| Domain-neutral presenters and styles | [packages/ui/src/](packages/ui/src/) | [UI README](packages/ui/README.md), [generated presenter references](dev/COMPONENTS.md) |
| Domain-neutral primitives and transport contracts | [platform/kernel/src/](platform/kernel/src/) | [Platform ledger](platform/README.md), [Kernel README](platform/kernel/README.md), [Kernel API](apps/doc/webmusic/src/content/docs/kernel/api.mdx) |
| Score/Audio coordination and conversion (deferred) | No Bridge workspace in this checkout | [Shared-clock design](platform/shared-clock-injection.md), [Architecture](dev/ARCHITECTURE.md), [current status](dev/STATUS.md) |
| Session-clock design or scheduling changes | Kernel and Score; deferred Audio/Bridge coordination | [Shared-clock design](platform/shared-clock-injection.md), [Architecture](dev/ARCHITECTURE.md) and current STATUS |
| Player bindings, readouts, analysis followers and views | Domain Play/Analyze/View and neutral UI presenters | [Player binding design](dev/design/PLAYER-BINDING.md), DEC-011, current STATUS and the owning public leaf pages |
| Documentation site and demos | [apps/doc/webmusic/src/](apps/doc/webmusic/src/), [shared catalogs](apps/doc/shared/) | [apps README](apps/README.md), Site Plan, Conventions and the applicable page template |
| A systematic Score review, or Audio review after migration | Owning domain, UI presenters and demos | [Score review workflow and Audio starting brief](dev/log/2026-09-09-score-review-workflow.md); use current design and STATUS to scope algorithm/architecture work before frontend acceptance |

Tests normally live in each owning workspace's `test/` directory. Read the
workspace's manifest for its commands. `apps/doc/shared/` is shared site code,
not a package workspace. Package outputs and documentation demos resolve through
public workspace entries; inspect the actual export map before using a path.

## Architecture rules to preserve

These are reminders of the owning Architecture and design documents, not an
alternative specification:

- Keep Score and Audio independent. Reusable library logic requiring both
  belongs in Bridge. Kernel remains domain-neutral; UI uses structural bindings
  without importing domain or Kernel types.
- Keep Core/API/Headless free of UI DOM, canvas, SVG and visual implementation.
  Headless may own nonvisual resources such as Web Audio. Renderers, browser
  drivers, Elements and framework adapters have their own entry contracts.
- Follow the capability dependency rules. An Element composes domain behavior
  with presenters; custom UI can reuse the same behavior without creating a
  second musical state model.
- For playback-connected Analyze/View work, read the player binding design.
  Companions borrow data, state and time; preserve standalone data use and avoid
  another player or clock. Use the shared nonvisual source contract in Score
  core when this checkout exports it; DOM selectors are browser adapters. New
  seek commands name their stable position axis, and group commands report their
  committed, superseded or failed outcome. Target examples are not current API
  references; verify implemented members and STATUS before using them in demos.
- Treat one authoritative timeline per coordinated session as the accepted
  direction. Read the clock design and STATUS for the implementation boundary.
  Sharing an AudioContext does not establish shared transport state. Specify
  units, offsets, scheduling invalidation and re-arming when changing time.
- Declare who creates, borrows and releases every context, player, synth, route,
  worker, stream and subscription. Review cancellation, late async results,
  replacement failure, callback reentrancy and repeated cleanup.
- Use public styling tokens, parts and named handles. Keep private presenter
  selectors private. Preserve keyboard, focus and state feedback when replacing
  visuals; documentation demo chrome is not required application UI.

## Implement a change

1. Locate an existing capability before adding a new one. For a new component
   or substantial contract change, use the component design template and record
   shared decisions in DECISIONS. Small fixes should stay scoped to their actual
   behavior and owning reference.
2. Read the implementation, exported types/barrel, relevant tests and public
   reference together. Source/types/configuration establish what is implemented;
   accepted design establishes intent. Resolve a discrepancy explicitly through
   a fix, a decision change, or a recorded gap in STATUS.
3. Review every affected policy and build surface. Architecture's executable
   policy table points to [package policy](scripts/package-policy.mjs),
   composition policies in [scripts/](scripts/),
   [architecture checks](scripts/check-architecture.mjs), manifests and build
   mappings. Do not change only one allowlist to make a new entry pass.
4. Update the owning reference with real members, defaults, units, failures and
   cleanup. Apply its page template. Keep demo behavior, parameter catalogs and
   actual composition consistent; do not invent an API or a proposed generator
   to fill a documentation section.
5. Write maintained documentation in English, preserving API identifiers and
   historical evidence. Use repository-relative file links here and site routes
   in published pages, following Conventions. Place new guidance in the mapped
   `dev/` group and link it from that group's README; update this task map when
   it introduces a new reading route. Preserve dated bodies and fix current
   navigation when moving files. Regenerate inventories with `npm run docs:sync`
   after adding/moving documents or changing catalog inputs.
6. Verify the change and report actual results. Update STATUS for remaining
   work; keep dated evidence separate from current instructions.

## Develop and verify

[package.json](package.json) owns command definitions;
[DEVELOPMENT.md](dev/DEVELOPMENT.md) owns the full workflow. Use its declared
Node range and the committed lockfile. On a fresh checkout, run `npm ci`, then
`npm run build:packages`. `npm run dev` builds packages and starts the docs site;
`npm run docs:dev` uses existing package output.

- During implementation, run the relevant workspace tests/typecheck and focused
  architecture/documentation checks. Add regression coverage that exercises the
  changed contract rather than merely mirroring its implementation.
- For documentation edits, use `npm run docs:sync`, `npm run check:dev-docs`,
  `npm run check:docs`, and `npm run check:format`. Site snippets are checked by
  `npm run check:doc-snippets` against built declarations; rebuild packages when
  their source changes. Conventions explains the scanner's limits.
- Before handing off a completed change, run `npm run check` as required by
  DEVELOPMENT. Run `npm run docs:build` for documentation-site changes. For
  packaging/release work, follow the additional checks in PUBLISHING.
- Coordinate processes in a shared checkout: package builds clean `dist/`;
  consumers must not read it during a rebuild. Snippet checks isolate their
  temporary caches, but still require stable built declarations.
- Report commands, outcomes and material unverified behavior. A green static
  check does not establish audible timing, complete API semantics, browser/device
  interaction or accessibility. Local versions and tags do not prove external
  publication or deployment.

## Keep current guidance separate from history

[Plans](dev/plans/README.md), [audits](dev/audits/README.md),
[workflow logs](dev/log/README.md) and [prototypes](dev/prototypes/README.md)
have separate reading roles. Their README files are maintained navigation;
dated bodies and raw evidence retain their original baseline. The
[Score notes index](packages/score/docs/README.md), the
[Audio proposal index](dev/plans/README.md), and the
[release-pipeline archive](scripts/release-pipeline/README.md) explain how to
read their older material. Use these for context and recorded outcomes, not as
another current implementation plan.

Do not copy release states, component counts, old test totals, or backlog lists
into this guide. Update the owning document and regenerate the indexes. Keep
AGENTS.md focused on onboarding, task routing and execution.
