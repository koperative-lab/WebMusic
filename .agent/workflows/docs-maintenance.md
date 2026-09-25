# Documentation maintenance

Use for reference updates, navigation changes or document moves. Keep a requested
review read-only; edit only within the authorized task. This procedure adds no
automatic commit, push, publication or per-phase approval requirement.

## 1. Find the owner and baseline

1. Inspect `git status --short`, the current branch and affected diffs. Preserve
   unrelated edits and the checkout's implementation and historical evidence.
2. Read [documentation owners](../../dev/README.md), [site plan](../../dev/docs/DOCS-SITE-PLAN.md)
   and [conventions](../../dev/docs/DOCS-CONVENTIONS.md).
3. Use [DOCUMENTATION-MAP](../../dev/DOCUMENTATION-MAP.md) and
   [COMPONENTS](../../dev/COMPONENTS.md) to locate every affected reference.
4. For a public reference, choose the [Element](../../dev/docs/COMPONENT-PAGE-TEMPLATE.md),
   [Headless](../../dev/docs/HEADLESS-PAGE-TEMPLATE.md),
   [UIKit](../../dev/docs/UIKIT-PAGE-TEMPLATE.md) or
   [API](../../dev/docs/API-PAGE-TEMPLATE.md) template for the owning page.

For a developer-guide or navigation-only change, proceed to section 3 after
identifying its owner. Public-page templates and section 2 are needed only if
the task also changes a public contract, reference, catalog or demo.

## 2. Reconcile the contract

Apply this section to public contract/reference/demo work, not a path-only move.

1. Read implementation, public types, barrel/export map, tests and owning page
   together. Check members, defaults, units, modes, errors and resource lifetime.
2. Resolve discrepancies through an authorized fix, an accepted decision change
   or an explicit gap in [STATUS](../../dev/STATUS.md); do not invent behavior.
3. Update the owning reference once, then link it from inventories and Related
   sections. Reconcile catalogs, Parameters, registration and policy inputs.
4. Use real fixtures and public entries in examples. Verify that every exposed
   setting has an effect or explains its actual limitation; retain cleanup.
5. Follow the site plan for family inventories and workflow pages. Do not revive
   retired tags or create duplicate capability overviews to repair a broken link.

## 3. Move documents without losing their context

1. Record old path, new owner/path and any heading/anchor migration before moving.
2. Search inbound links, navigation, tooling messages and generated inputs with
   `rg`; explicitly include hidden `.agent` guidance when searching that scope.
3. Repair relative outbound links at the new location. Update maintained inbound
   links directly; redirects preserve old bookmarks, not current navigation.
4. Inspect references in AGENTS and `.agent` rules, workflows and skills. Keep
   `AGENTS.md` as the canonical instruction entry.
5. Preserve dated quotations, commands and raw evidence under their historical
   boundary. Add current navigation outside it rather than rewriting the record.
6. Update directory READMEs and catalog inputs. Never hand-edit generated indexes
   or replace current STATUS with an old audit's findings or test totals.

## 4. Regenerate and verify

1. Inspect current package scripts and [Development](../../dev/DEVELOPMENT.md).
   Coordinate writers before builds that replace `dist/` used by consumers.
2. Run `npm run docs:sync` after file moves/additions or catalog changes, then
   `npm run check:dev-docs`, `npm run check:docs` and `npm run check:format`.
3. For public examples, use stable built declarations and the applicable snippet,
   docs-test and typecheck commands; inspect the scanner's documented limits.
4. Complete `npm run check` and, for site changes, `npm run docs:build` as required
   by Development. Report a constrained review's unrun gates explicitly.
5. Review the diff for broken anchors, duplicate reference ownership, unintended
   historical edits and unrelated generated or lockfile changes.

## 5. Hand off

Report the owning files, contract/navigation changes, migration destinations,
commands and results. Distinguish passing link/snippet/build checks from complete
API semantics or browser/device acceptance. Leave unrelated backlog with STATUS;
continue only the remaining work already included in the user's task.
