# Development documentation

This is the entry point for repository-wide guidance. Start with
[AGENTS.md](../AGENTS.md) for task execution. Read the documents relevant to
the task, then follow their links to source, public types and tests.

WebMusic is a toolkit for music software and installations, usable through
Web Components, Headless objects, and API + UI composition. Accepted design
describes the intended contracts; [STATUS.md](STATUS.md) describes this
checkout's delivery and verification gaps. Sharing guidance between branches
does not merge implementations or transfer old verification results. The first
release on `main` contains Kernel, UI Kit and Score. Audio and Bridge remain
accepted directions; their source and public references are not present in this
checkout. Verify a target branch's tracked files before claiming delivery there.

## Directory map

| Location | Responsibility |
|---|---|
| `dev/*.md` | Core product/architecture guidance, current status, development workflow and generated indexes |
| [design/](design/README.md) | Component contracts and Analyze/View/Play composition decisions |
| [docs/](docs/README.md) | Site information architecture, authoring rules and page templates |
| [release/](release/README.md) | Current release policy and manual publishing instructions |
| [plans/](plans/README.md) | Historical proposals, alternatives and implementation briefs |
| [audits/](audits/README.md) | Dated findings and verification evidence, grouped by review date |
| [log/](log/README.md) | Work sequences, integration records and reusable review briefs |
| [prototypes/](prototypes/README.md) | Exploratory mockups and their limitations |

The root keeps the project README and agent entry points. Package and platform
technical references remain beside their owning source; public usage references
remain in the documentation site. [DOCUMENTATION-MAP.md](DOCUMENTATION-MAP.md)
indexes all repository Markdown/MDX files, including historical material.

## Product, architecture and current work

| Question | Owner |
|---|---|
| Who uses the toolkit and what should it enable? | [PRODUCT.md](PRODUCT.md) |
| How should logic, interaction, visuals and resource use behave? | [DESIGN-PRINCIPLES.md](DESIGN-PRINCIPLES.md) |
| Which choices are accepted and why? | [DECISIONS.md](DECISIONS.md) |
| What are the package, layer, time and ownership boundaries? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| What is implemented, incomplete or unverified in this checkout? | [STATUS.md](STATUS.md) |
| How do I prepare, develop and verify a change? | [DEVELOPMENT.md](DEVELOPMENT.md) |

## Choose a task route

| Task | Read next |
|---|---|
| Choose agent skills or repeatable review procedures | [Project agent toolkit](../.agent/README.md); its rule map links back to the owners here |
| Add, combine or change a component | [Component design](design/COMPONENT-DESIGN.md), then the applicable [family contract](design/README.md) |
| Attach analysis or a view to playback | [Player binding](design/PLAYER-BINDING.md), Architecture and the owning source/reference |
| Audit algorithms, architecture and frontend behavior | [Score review workflow and Audio starting brief](log/2026-09-09-score-review-workflow.md), then current design and STATUS; record each phase's actual evidence |
| Write a public reference or demo | [Documentation authoring](docs/README.md), site plan, conventions and the template for that public surface |
| Locate an existing capability or public entry | [COMPONENTS.md](COMPONENTS.md), generated from catalogs, manifests and reference pages |
| Find a document and distinguish current guidance from history | [DOCUMENTATION-MAP.md](DOCUMENTATION-MAP.md), generated from repository files |
| Prepare a version or publish packages | [Release guides](release/README.md); version preparation, registry publication and deployment are distinct operations |
| Understand an earlier proposal or verification result | The relevant [plan](plans/README.md), [audit](audits/README.md) or [workflow log](log/README.md), using its recorded baseline |

## Documentation ownership and maintenance

- Current design documents own intent and tradeoffs. Source, exported types and
  configuration establish implemented behavior. Resolve a discrepancy through
  an implementation fix, a decision change or a gap in STATUS.
- Manifests, barrels and reviewed policies own entries, dependencies and
  versions. Script calls own check coverage. Public leaf pages explain actual
  members, defaults, units, errors and cleanup using the relevant page template.
- STATUS is the current work queue. Plans, audits and logs retain dated
  evidence; their counts and acceptance results describe their stated baseline.
  Their directory READMEs remain current navigation. Prototypes demonstrate an
  idea and do not establish implemented behavior.
- Put new guidance in the group above and link it from that group's README.
  Update AGENTS when a new task route is needed.
  Avoid another manually maintained API or complete file inventory.
- When moving a document, update inbound links, its relative outbound links,
  tooling messages and navigation. Preserve old paths and source-line citations
  inside explicitly historical bodies and raw evidence.
- Run `npm run docs:sync`, `npm run check:dev-docs`, `npm run check:docs` and
  `npm run check:format` after documentation changes. Follow DEVELOPMENT for
  final acceptance. Generated inventories are not hand-edited.

## References beside the implementation

| Area | Entry point |
|---|---|
| Symbolic music | [Score README](../packages/score/README.md) and [Score architecture](../packages/score/ARCHITECTURE.md) |
| Digital audio (deferred) | [Product direction](PRODUCT.md), [Architecture](ARCHITECTURE.md) and [current status](STATUS.md); no current package reference in this checkout |
| Presentation | [UI README](../packages/ui/README.md) |
| Neutral infrastructure | [Platform ledger](../platform/README.md), [Kernel README](../platform/kernel/README.md) and [shared-clock design](../platform/shared-clock-injection.md) |
| Cross-domain coordination (deferred) | [Shared-clock design](../platform/shared-clock-injection.md), [Architecture](ARCHITECTURE.md) and [current status](STATUS.md) |
| Public documentation and demos | [Apps README](../apps/README.md) and [site sources](../apps/doc/webmusic/src/content/docs/index.mdx) |
| Historical release implementation | [Release pipeline archive](../scripts/release-pipeline/README.md) |
