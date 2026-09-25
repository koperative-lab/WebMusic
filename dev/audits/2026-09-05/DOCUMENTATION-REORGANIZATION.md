# Documentation reorganization — 2026-09-05

This is a dated change and verification record for the English documentation
reorganization. The maintainer's brief defines WebMusic as a toolkit for music
software, interactive demos, and musical installations, with Web Components,
Headless objects, and API/UI composition. A browser workstation is a product
goal. [STATUS](../../STATUS.md) owns current work after this snapshot.

## Scope and ownership

The starting inventory contained 162 Markdown/MDX documents and 25,722 lines.
[The baseline inventory](evidence/documentation-before.json) records their paths,
line counts, and SHA-256 hashes before this reorganization. The repository
already contained uncommitted implementation and documentation changes; this
record does not attribute all differences from Git HEAD to this task.

The [resulting inventory](evidence/documentation-after.json) records final
document hashes. The [evidence manifest](evidence/documentation-evidence.json)
records hashes and byte sizes for this reorganization's saved check output and
inventory files.

Every repository Markdown/MDX document within the generator's stated scope is
classified in [DOCUMENTATION-MAP](../../DOCUMENTATION-MAP.md). Classification
does not mean every historical statement was rewritten or every public member
received a fresh runtime test.

The resulting inventory has **173 documents**: 103 existing documents changed,
11 were added, and none of the baseline documents were removed. The
[structure review](evidence/documentation-structure-review.json) records that
comparison. Unchanged references remain indexed under their explicit owner.

| Question | Current owner |
|---|---|
| Product, users, integration choices, application ambition | [PRODUCT](../../PRODUCT.md) |
| Logic, interaction, visual expression, resources, accessibility | [DESIGN-PRINCIPLES](../../DESIGN-PRINCIPLES.md) |
| Accepted choices and consequences | [DECISIONS](../../DECISIONS.md) |
| Packages, layers, data, timing, ownership, technical policy | [ARCHITECTURE](../../ARCHITECTURE.md) |
| Individual component design and acceptance template | [COMPONENT-DESIGN](../../design/COMPONENT-DESIGN.md) |
| Current component/export navigation | [COMPONENTS](../../COMPONENTS.md), generated |
| Public reference page structure | [Site plan](../../docs/DOCS-SITE-PLAN.md) and its four page templates |
| Contributor workflow and actual check coverage | [DEVELOPMENT](../../DEVELOPMENT.md), [DOCS-CONVENTIONS](../../docs/DOCS-CONVENTIONS.md) |
| Remaining implementation or verification work | [STATUS](../../STATUS.md) |

## Changes

- Added the design entry point, product definition, cross-component design
  principles, decision register, component design template, and current status
  owner. These distinguish accepted direction from implemented behavior.
- Aligned root, package, platform, Bridge, and public-site orientation. Current
  clock readers and Bridge coordination are distinguished from the unfinished
  protocol for sharing one clock instance with scheduling invalidation and
  re-arming. Conversion assumptions and information loss are explicit.
- Reworked the four reference-page templates and site/contributor guidance.
  Component design and public-page formatting have separate owners. Demos,
  shared documentation chrome, and application visual design have distinct
  responsibilities.
- Reviewed the Headless references against barrels and implementation for
  construction, state, commands, events, timing, resource ownership, and
  cleanup. Corrected factual descriptions and added explicit reference
  sections and composition links without inventing APIs for pure helpers.
- Added generated component/export and repository-document indexes, plus
  `docs:sync` and `check:dev-docs` in the source check chain. Generated
  inventories derive from existing policies, catalogs, manifests, and page
  metadata; they are navigation rather than a second signature table.
- Extended the site's link check to same-page fragments and corrected the
  Kernel API page's eight stale fragment links. Added missing Kernel entry
  navigation for meter and sync.
- Labeled expansion plans, old package notes, and release-pipeline material as
  historical, with current navigation and specific errata. Preserved the old
  bodies instead of rewriting rejected designs as current requirements.
- Translated maintained prose into English. Earlier audit measurements and raw
  evidence remain historical. Audit links are repository-relative; ignored log
  files now have byte-identical `.log.txt` copies with a
  [SHA-256 manifest](evidence/portable-evidence.json). Raw evidence is retained
  verbatim and is not a current implementation claim.
- Removed unverified publication assertions from installation guidance. The
  local workspace path is explicit; external publication state requires its
  own check when a release action is undertaken.

## Verification

Environment: local macOS arm64, Node v22.14.0, installed workspace dependencies
and the uncommitted working tree described above.

| Verification | Result and evidence |
|---|---|
| `NODE_OPTIONS=--max-old-space-size=6144 npm run check` | Passed: format, lockfile, lint, architecture, documentation, package builds, source/test types, 197 test files / 2,205 tests, licenses, 86 built public entries, and release manifests. [Full log](evidence/webmusic-documentation-check.txt). |
| Final `npm run check:doc-snippets` | Passed: 167 selected TypeScript examples against built declarations. [Log](evidence/webmusic-documentation-final-snippets.txt). The full-check log captured 154 examples before the final reference additions; this final pass covers the completed pages. |
| Final `check:docs`, `check:dev-docs`, `check:format`, `git diff --check` | Passed after reference completion: 119 pages/routes, 31 Element tags, 62 existing live-demo pages / 77 instances, 173 indexed documents and consistent local links. [Log](evidence/webmusic-documentation-final-static.txt). |
| `npm run build -w webmusic-doc`, using packages built by the full check | Passed: 120 output pages, with 119 pages in the English search index. [Build log](evidence/webmusic-documentation-docs-build.txt). |
| File-link checker regression probes | All 20 passed, covering inline/reference links, machine-local paths, current archive navigation, and preserved historical bodies. [Log](evidence/webmusic-documentation-link-probes.txt). |
| Negative gate checks | A deliberately stale generated inventory and a deliberately missing same-page fragment both failed as expected; original file bytes were restored. [Evidence](evidence/webmusic-documentation-negative-checks.txt). |
| Headless reference structure and language review | All 31 leaves have exactly one ordered Import, API, and Related section. All indexed Markdown/MDX prose is English; the Han-character scan found none. [Structured result](evidence/documentation-structure-review.json). This scan complements editorial review and does not prove language quality or member semantics. |

The package/runtime checks ran successfully before the final reference prose
was completed; the final documentation checks and site build then verified the
completed content. Source-based reviews checked real construction, options,
commands, state, events, types, ownership, and source relationships. They found
and corrected issues that section-presence and value-name checks cannot detect,
including snapshot versus live state, borrowed-object cleanup behavior, retired
tags, and overstated conversion or synchronization guarantees.

The build log retains bundler size/directive and redirect-index warnings. The
local build had no configured site origin, so sitemap generation was skipped.
These results establish local compilation and indexing, not a deployed site,
browser interaction, audible synchronization, or device/accessibility acceptance.

## Interpretation and remaining boundaries

The documentation is organized as an ownership system with generated
inventories, not a single monolithic file. Intent belongs to accepted design;
implemented behavior is established by source/types and explained in public
references. When they differ, the gap is recorded rather than treating one as
proof of the other.

This reorganization does not implement the shared-clock protocol, a full
workstation application layer, or additional external resource integrations.
Static gates do not prove complete semantic API coverage, device behavior,
audible timing, or accessibility. The reference templates remain acceptance
requirements where automated enforcement or demo migration is incomplete.
Consult STATUS for the current queue instead of extending this historical
record with new work items.
