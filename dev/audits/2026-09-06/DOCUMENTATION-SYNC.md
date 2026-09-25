# Development documentation synchronization

> Verification record dated 2026-09-06. This records a documentation change,
> not a merge of the branches' music implementations. Current work belongs in
> [STATUS](../../STATUS.md); shared guidance starts at [dev/README](../../README.md).

## Scope and preservation

The four maintained branch names are `main`, `dev`,
`claude/analysis-view-chord-design-693b7b` and
`claude/mvmnt-features-review-41f87a`. Local dev and published dev had distinct
runtime histories; each received a documentation-only descendant of its own
existing tip. Neither history was reset or replaced to synchronize guidance.

Every branch receives the same AGENTS.md and shared product, design, decision,
player-binding and authoring guides. CLAUDE.md is a Git symlink with the relative
target `AGENTS.md`. STATUS and generated inventories describe each checkout's
actual implementation, catalogs, exports and available checks.

The synchronization adds documentation indexing commands where absent, adapts
the two dev inventory generators to their existing inputs, and updates archive
navigation and shared-clock guidance. Missing catalogs are reported explicitly.
No runtime, site implementation, package export, dependency or CI changes are
included. Original package-note bodies, Chordio workbench plans and its prototype
are preserved. Historical audit implementation links identify the inspected main
commit instead of implying the same source exists on every branch.

## Verification

| Implementation baseline | Full `npm run check` result | Documentation verification |
|---|---|---|
| Main `6506225` | Passed: 201 test files, 2,275 tests | Inventory generation, local links, site documentation and format passed |
| Chordio `6418789` | Passed: 205 test files, 2,547 tests | Inventory generation, local links, site documentation and format passed |
| MVMNT `086905c` | Passed: 188 test files, 2,020 tests | Inventory generation, local links, site documentation and format passed |
| Local dev `7fae2c5` | Stops at 49 existing architecture diagnostics | Inventory generation, local links, format and lint passed; this lineage has no site documentation checker |
| Published dev `ccf8d2e` | Stops at 18 existing architecture diagnostics | Inventory generation, local links, format and lint passed; separate site documentation check reports 78 existing diagnostics |

The two dev architecture outputs and published-dev site documentation output
were compared with clean archives of their original commits: the diagnostics
match byte-for-byte. The synchronization does not resolve or conceal those
failures. Their STATUS documents retain the corresponding acceptance work.

Final documentation-only record and link changes were followed by another
inventory, local-link and format pass. Full check results do not establish
audible timing, visual fidelity, device behavior or complete API semantics.
