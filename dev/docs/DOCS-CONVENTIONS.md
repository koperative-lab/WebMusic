# Documentation conventions and verification boundaries

This document tells authors how to verify documentation and what the existing
checks actually cover. It does not define the product, replace page templates,
or keep a work queue. Passing a check does not establish that every documented
fact, example, or interaction is correct.

- Product and supported ways of using the packages: [PRODUCT.md](../PRODUCT.md).
- Component design: [DESIGN-PRINCIPLES.md](../DESIGN-PRINCIPLES.md),
  [COMPONENT-DESIGN.md](../design/COMPONENT-DESIGN.md), and [DECISIONS.md](../DECISIONS.md).
- Site structure and page ownership: [DOCS-SITE-PLAN.md](DOCS-SITE-PLAN.md).
  The four `*-PAGE-TEMPLATE.md` files define each leaf page's content contract.
- Documentation and component indexes: [DOCUMENTATION-MAP.md](../DOCUMENTATION-MAP.md)
  and [COMPONENTS.md](../COMPONENTS.md).
- Current implementation status and gaps: [STATUS.md](../STATUS.md). This file
  records check capabilities, not a second migration ledger.

Public entries, types, and behavior are verified against source, package
manifests, and matching build output. When changing a convention, assess its
checks too. A check that has not been implemented must remain explicitly a
manual review requirement; do not describe it as enforced by CI.

## Running the checks

The detailed gate coverage and demo implementations below describe the main
development baseline. A maintained branch can share these authoring requirements
while carrying earlier checks or demos. Its [STATUS.md](../STATUS.md) identifies
that difference; the local scripts and package manifests establish which
commands and checks actually exist. Missing automation remains manual acceptance
work until implemented, and copying this document does not backport demo fixes.

From the repository root:

```bash
npm run check:docs
npm run check:architecture
npm run check:dev-docs
npm run build:packages
npm run check:doc-snippets
```

`check:docs` and `check:architecture` read source and do not need a package
build. Snippet checking resolves built `dist` declarations, so rebuild when
source has changed. `check:source` already runs these commands in dependency
order alongside other checks; [package.json](../../package.json) owns the command
chain.

The checks below inspect site structure, catalogs, generated inventories,
links, or product source. They do not establish the semantic correctness of
factual prose throughout `dev/`. Schematic examples in these authoring templates
are also outside the site's snippet scan.

## `check:docs`: static page and catalog checks

Implementation: [scripts/check-docs.mjs](../../scripts/check-docs.mjs). Page scanning
covers `.md` and `.mdx` under `apps/doc/webmusic/src/content/docs/`.

| Check | What it verifies | What it does not establish |
|---|---|---|
| `params` | Element source files and parameter catalogs correspond across the three Score capabilities; names and order match parsable `static observedAttributes`, with supported spread tables resolved | Defaults, behavior, property/method/event tables, or arbitrary JavaScript declaration forms |
| `catalog` | Element hrefs resolve to pages or collected anchors; tags have params; presenters have classified pages; `consumerTags` are catalog tags | Whether each consumer actually composes that presenter, or whether descriptions are accurate |
| `page` | Element leaf filenames name real tags, titles equal `'<tag>'`, at least one recognizable top-level Demo/Playground self-closing tag appears, and API/Styling summaries exist | Exactly one demo, complete member tables, or section order |
| `title` | Every page has a title; the Score API, UI presenter and UI Kit root titles equal their entry specifier | Title form for any other page kind, including family pages, each family's Web Components and Headless inventories, Headless objects, and the Kernel API page; element leaf titles belong to the `page` check |
| `plan`: groups | No `index.mdx` remains in an element capability directory; every element leaf has an integer `sidebar.order` and the group's orders are dense from 1; both of a family's `element/index.mdx` and `headless/index.mdx` exist and carry no recognizable demo; UI Kit category labels match the catalog | A stray capability `index.mdx` under `headless/`, or Headless object order. Also what an inventory actually lists, whether it has a section per capability, a demo mounted in an unrecognized form, or whether a removed route gained a redirect |
| `plan`: entries | The three release-package root API pages name every published sub-entry and no nonexistent sub-entry; Kernel also has a path-bearing section per sub-entry | Complete API Reference members, or a requirement that matched paths occur in a table |
| `plan`: Headless | Recognizable value exports from the three Score `/headless` barrels occur as backticked names in the family `headless/index.mdx` read together with that capability's object pages; relative `export *` is followed, and a failure names the capability and its barrel | Types, unique ownership, whether the inventory rather than one leaf names an export, whether a name appears in its own capability's section, whether a name is linked to an explanation, or Bridge's root exports |
| `live-demo` | Rendered Astro imports named with a Demo/Playground/Showcase/Sandbox suffix have a recursive import path to `LiveDemoCanvas.astro` | Browser rendering or successful mounting; this is static import reachability |
| `docs-css` | `wui-*` classes in shared `apps/doc/shared/ui.css` do not collide with recognized UI package classes | Complete CSS isolation; pages may deliberately use a public class contract |
| `css-variable` | Backticked non-`--wm-*` variables in site pages have a recognizable read, write, or declaration somewhere in Score/UI source | Whether the variable affects this particular component or demo |
| `link` | Markdown `](/...)` links resolve to a page or a public file directly; `](#...)` resolves against the current page, with fragments checked against collected anchors. A link that resolves only through a parsed redirect FAILS, naming the destination, because the redirect is for a bookmark and drops the fragment | Relative links, HTML hrefs, dynamic links, external URLs, redirects declared outside the parsed `redirects:` block, or whether a redirect target is itself sensible |

Most checks use constrained text parsing. A matching string is not evidence of
complete AST validation, browser output, or runtime behavior.

### Root entry coverage

First-release coverage includes `@webmusic/kernel`, `@webmusic/score` and
`@webmusic/ui`. Audio and Bridge references and checks are outside this checkout;
verify a target branch's tracked files before claiming their coverage.
Sub-entry enumeration excludes the root `.` and `./package.json`.

The package root API page owns the complete subpath inventory. Capability/API
entry pages may link to it or show local navigation derived from the same manifest,
explaining root / Headless / Element / render forms. They do not maintain a
second independent release inventory. [Site Plan](DOCS-SITE-PLAN.md) owns this
page responsibility; the checker does not define it.

### Titles, links, and anchors

Follow the Site Plan's naming: `'<score-player>'` for a tag,
`'@webmusic/score/play'` for an API entry, `'@webmusic/ui/transport'` for a
presenter, the family or platform name for a family page (`'Score'`), and that
name qualified by its form for the two inventories (`'Score Web Components'`,
`'Score Headless'`). Titles need not be unique across the site;
navigation provides context.

Prefer site-absolute links in published page prose, such as
`/score/headless/play/score-player/`. Same-page fragments may use `#...` and are
checked against collected anchors. Verify generated IDs when the text parser
cannot model them. Repository documents use relative file links, not absolute
paths tied to an author's machine.

The checker approximates heading slugs and does not reproduce duplicate-heading
numbering. Astro-generated anchors may be invisible in MDX; `COMPONENT_ANCHORS`
allows selected patterns through and should remain narrow. Verify those anchors
manually. After renaming a heading, inspect its generated ID and inbound links
instead of guessing from the visible heading text.

A static Astro redirect sends the reader to the target route and drops the URL
fragment, so an anchored link into a retired route would land at the top of the
replacement page rather than at the section that absorbed the content. The `link`
check therefore treats a redirect as a bookmark courtesy rather than a link
target: a repository link that resolves only through one fails, and the message
names the destination to repoint it at. Redirect entries still keep old
bookmarks working, and the checker parses them for exactly that reason.

## `check:architecture`: documentation-related architecture rules

Implementation: [scripts/check-architecture.mjs](../../scripts/check-architecture.mjs).
It also checks product dependencies and release structure; the architecture and
its explicit policies are described in [ARCHITECTURE.md](../ARCHITECTURE.md).
Documentation-related assertions include:

- Element composition catalog tags and behavior/composed markers agree with
  the explicit composition policy.
- Published presenter subpaths, classification policy, presenter catalog, demo
  branches, and classified page sets agree.
- UI Kit navigation contains Overview, Catalog, and the root API page and does
  not use the retired `/ui/` navigation prefix.
- Every presenter in the classification policy has the exact LiveDemo and
  Related skeleton, each once, ordered as
  `LiveDemo → Import → API → Styling → Related`; Related ends the page.

“Aligned UI Kit page” in an error message does not identify a permitted exempt
set: a missing skeleton fails an earlier assertion. These checks still do not
verify member completeness, state controls, accessibility, styles, or cleanup.
Do not infer equivalent section-order coverage for Element, Headless, or API
pages.

## `check:dev-docs`: inventories, reading routes and repository links

Implementation: [scripts/docs-catalog.mjs](../../scripts/docs-catalog.mjs).
`npm run docs:sync` regenerates COMPONENTS and DOCUMENTATION-MAP;
`npm run check:dev-docs` checks that their bytes match the derived result.
Regenerate after changing catalog inputs or adding/removing indexed documents,
rather than editing generated lists by hand.

The inventory walks regular repository Markdown/MDX files outside hidden
directories, dependencies, build output, and coverage. The root `.agent/`
directory is an explicit exception: its toolkit, skills, workflows and rule map
are indexed and checked. Other hidden directories remain excluded, including
client settings and worktrees. The root `AGENTS.md` is the canonical instruction
entry. Other symlinks are not traversed.

The generated map groups current guidance, public references and historical
material. Directory README files are maintained navigation even beside archived
records. The prototype README links non-Markdown artifacts; those artifacts are
not themselves entries in the Markdown/MDX inventory.

The check also requires every current `dev/` guide, every `dev/` directory
README and all `.agent/` Markdown resources to be reachable from AGENTS through
maintained Markdown links. Generated
inventories can be destinations but are not traversed to satisfy this rule;
neither are historical plan/audit/log/prototype bodies. This prevents an orphaned
guide from passing merely because it appears in the generated file list. The
rule follows recognizable inline links and used full/collapsed/shortcut
references, excluding fences, inline code and HTML comments. It checks
reachability, not the relevance or completeness of a task map; it is not a
complete Markdown/HTML parser.

File-link validation recognizes
inline destinations and reference-style definitions, including angle-wrapped
destinations and optional titles. It checks relative file targets and rejects
recognized machine-local absolute paths and `file:` URLs. Code fences are
excluded. External URLs, same-page fragments, and HTML links are not validated;
site-absolute routes belong to `check:docs`.

Historical notes under `dev/plans/`, package-local `docs/`, and
`scripts/release-pipeline/` may place a standalone
`<!-- docs:historical-body -->` marker after their current navigation and
errata. Only the preserved body after that marker is excluded. Unmarked notes
are checked in full. Archive indexes and `README.md` runbooks, including the
release-pipeline README, are always checked in full even if they contain a
marker. Audit reports remain fully checked.

The checker runs focused positive and negative file-link and navigation probes
before its normal work. To run only those probes without reading or writing generated
inventories, use
`node --experimental-strip-types --no-warnings scripts/docs-catalog.mjs --self-test`.

The generated entry map routes every published subpath to one owning page. For
the Score family: the `/element`, `/auto`, and `/global` forms to the
family's `element/index.mdx`, the `/headless` form to its `headless/index.mdx`,
and the remaining capability entries to their API pages, each with the capability
anchor. UI presenter subpaths route to their presenter pages, Kernel
entries to its root API page, and a `./package.json` entry to the manifest
rather than to a page. Generation throws when an owning page is missing, so
removing a family inventory fails `docs:sync` and `check:dev-docs` rather than
emitting a broken reference. Resolving to a page is not evidence that the page
routes that entry onward to each member's owner.

Generated descriptions and relationships are assembled from existing source
catalogs and page metadata. Fresh generated files prove synchronization with
those inputs, not that their prose or every member description is correct.

## `check:doc-snippets`: example compilation

Implementation: [checker](../../scripts/check-doc-snippets.mjs) and
[regression tests](../../scripts/check-doc-snippets.test.mjs). The command runs both.

The scanner reads Markdown/MDX under the site's content directory and selects
examples with literal `@webmusic/*` imports, re-exports, side-effect imports,
dynamic imports, or TypeScript import-type references. Both quote styles work.
Supported carriers are:

- Backtick or tilde fences labelled `ts`, `typescript`, `tsx`, `js`,
  `javascript`, or `jsx`, preserving the language when compiling.
- Inline executable `<script>` bodies, either in `html` fences or directly in
  the page. Remote `src` scripts and data scripts are excluded.
- Top-level MDX `export const` code strings, including parenthesized literals.
  These are TypeScript examples. Escapes are parsed without evaluating code;
  interpolation and other computed initializers containing `@webmusic/` fail
  with an authoring diagnostic. Keep sandbox code in a literal export.

Each selected example compiles independently against built declarations using
TypeScript's compiler API. Rebuild packages after changing their public types.
The scanner rejects unclosed supported fences and type-check suppression
comments (`@ts-nocheck`, `@ts-ignore`, `@ts-expect-error`). Compiler-level errors
and exceptions fail the command; they are not silently discarded. Each run
owns a unique temporary cache directory and removes it when finished.

Fences and HTML scripts may be fragments: missing value inputs are supplied
as `any` on a second compilation pass. Missing constructors and misspellings
that TypeScript associates with an imported binding remain errors. Missing
type imports must be fixed. Literal MDX code exports receive no placeholders
and must prepare their own inputs. JavaScript uses `checkJs`; JSX/TSX checks
component props and imports. Unresolved side-effect imports are errors too.

This is a constrained scanner, not a complete Markdown/MDX interpreter.
Import-free fragments, CommonJS `require`, nonliteral dynamic imports,
blockquote/list-indented fences, arbitrary MDX expressions, imported code
strings and remote scripts are outside its coverage. Do not move an example
into one of these forms to evade a failure; use the supported authoring forms
for package examples, and review external scripts separately.

Compilation uses `strict:false` and `skipLibCheck`. Placeholder input types,
explicit `any` and assertions limit what a passing result proves. It checks
imports and inferable API use; it does not execute code, prove that an asset
exists, verify browser support or exercise resource cleanup. Runnable examples
still need real inputs and runtime acceptance. A docs build alone does not
establish those properties.

## Manual authoring and acceptance requirements

These are author contracts, not claims of automation beyond the checks listed
above.

### Completeness and ownership

- Reconcile complete API tables with public types, barrels, and implementation
  defaults. A demo, a mentioned export name, or successful compilation does not
  replace the table.
- Follow the appropriate template for section structure and the distinction
  between a main demo and a justified topic example.
- Explain inputs, state, operations, events, errors, ownership, disposal,
  accessibility, and styling according to the actual public contract. Do not
  copy defaults from a neighboring component.
- Exercise demo controls, mode changes, event feedback, gesture entry points,
  and teardown. Mark an ineffective control with a reason; do not describe a
  static placeholder as a running demonstration.
- Distinguish intended facilities from implemented ones. If a generator or
  catalog entry is missing, provide working prose/navigation and record the
  gap rather than importing a nonexistent component.

### Demo resource lifetime

On the main baseline, standalone programmatic/Headless demos and the API sandbox
bootstrap use `mountDemos` in the [demo components](../../apps/doc/webmusic/src/components/).
Register
cleanup as resources are acquired, bind controls through the scope, and check
`scope.active` after asynchronous preparation before starting sound or changing
UI. The scope releases on removal, Astro navigation and page hide; a late
resource registered after cancellation is released immediately. A demo owns
what it creates, unless its API explicitly transfers that ownership.

The [Headless controller](../../apps/doc/webmusic/src/lib/headless-playground-client.ts)
invalidates pending factories on replacement/removal and releases subscriptions
and the owned instance even when another cleanup fails. Its state display uses
the object's events. The [API editor client](../../apps/doc/webmusic/src/components/api-sandbox-client.ts)
retains and unmounts its React root; preview stays opt-in and dependency keys
must name npm packages, not import subpaths. Lifecycle regressions run in the
documentation workspace tests; they do not establish real device behavior.

### Reference blocks, notices, and voice

Use `<details class="component-section">` for API and Styling reference blocks;
Headless has no Styling block. API reference pages keep their full tables open.
On shared workflow pages, identify each companion's table clearly instead of
copying its reference to another page.

Use `:::note` / `:::caution` for facts that change a reader's actions, such as
permissions, required input, or an unavailable path, not for emphasis. Maintained
documentation is written in English; preserve API identifiers and exact page
title forms. Use plain, concrete prose about what works, what is required, and
what happens on failure.

### Demo assets

Assets live in `apps/doc/webmusic/public/`. These are selection guidelines, not
cross-browser support guarantees.

| Asset | Use | What the author checks |
|---|---|---|
| `midi/demo.mid` | Score playback and analysis | Dense input can be expensive for SVG rendering |
| `mxl/demo.mxl` | Staff/sheet demos requiring notation semantics | MIDI does not preserve equivalent original layout, clef, and staff metadata; follow the renderer's actual input requirements |
| `soundfont/*.sf2` | Timbre demos | Large files; avoid redundant soundfont loads on one page |

Audio decoding, streaming, waveform assets and related demo guidance remain
on `dev`. Main demos retain the Score MIDI, notation and timbre assets.

### Demo file ownership

```text
apps/doc/shared/                  catalogs and shared documentation styles
apps/doc/webmusic/src/
  content/docs/                   page prose
  lib/params/                     element attribute catalogs
  lib/headless-params/            implemented Headless panel catalogs
  lib/ui-presenter-demos/         presenter demo bindings
  components/                    shared canvas, panels, and catalog renderers
  components/elements/           element or workflow demos
  components/headless/           Headless object demos
```

Use these destinations when creating or aligning a demo; migration status lives
only in STATUS. Catalog notes are short control descriptions, while API tables
own full semantics. Reconcile them with source. `LiveDemoCanvas` owns the stage
background, spacing, and Live status frame; demos supply the actual components
and wiring.
