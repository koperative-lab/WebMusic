# Shared agent guidance synchronization — 2026-09-09

This record covers the maintainer-authorized commit and distribution of the
development-document organization and project agent toolkit across maintained
branches. The shared source is main commit
[`c7cb075`](https://github.com/mrsteamedbun/WebMusic/commit/c7cb075b3e4c8cc722a604271abf32d4936cd379).
It records this synchronization's scope and local verification, not another
implementation queue or a claim that every branch has main's components.

## Shared resources

The [agent toolkit](../../.agent/README.md) contains project skills and workflows
for component/algorithm/architecture review, frontend review, and documentation
maintenance, plus rule ownership and tool recommendations. These are reusable
source files referenced by [AGENTS.md](../../AGENTS.md); client-specific automatic
skill discovery still requires its documented setup. `CLAUDE.md` remains a
relative symlink to `AGENTS.md`.

The [development entry point](../README.md) routes current guidance through
`dev/design/`, `dev/docs/` and `dev/release/`, and keeps plans, audits, logs,
prototypes and archived release machinery distinct. The documentation scanner
includes `.agent/`, groups the generated map by role and verifies maintained
reading routes from AGENTS without relying on generated inventories to conceal
missing navigation.

## Branch preservation and delivery

The remote inventory contained five branches. The local `dev` and remote `dev`
already had different histories (four local-only and twenty-two remote-only
commits). Each receives a separate documentation descendant; this task does not
reconcile their runtime histories.

| Destination | Implementation baseline before this synchronization | Full local gate |
|---|---|---|
| `main` | `763abed74c951941cc8f411976f27c718fab6f23` | `npm run check` passed for the shared source |
| `claude/analysis-view-chord-design-693b7b` | `7b8b0ee8057d4d77051a8b3fcd0dea616ac45519` | `npm run check` passed |
| `claude/mvmnt-features-review-41f87a` | `9693b4ed31569e0ab25dfc0d11d2cce000ae708f` | `npm run check` passed |
| `codex/main-drafts-20260909` | `734040824b1ebed88fa0520f13a5429843b6c228` | `npm run check` passed |
| Remote `dev` | `d4f7047672e552e93b8d5a265e301e8c090c595d` | Stopped at the same 18 existing architecture diagnostics |
| Local `dev` | `cc31c7b4ed98871a3d62bcf738328b05a5fbe0db` | Stopped at the same 49 existing architecture diagnostics |

The ports preserve branch-specific source, manifests, lockfiles, catalogs,
current work queues and decision identifiers. Existing guides move with their
branch prose. Imported main-specific design/workflow records identify their
source baseline and pin implementation and decision-register references where
the destination differs. Generated indexes are rebuilt from each checkout;
they are not copied from main.

Old release prose remains in the release archive or in an explicitly marked
checkout snapshot. Registry and remote-tag assertions require fresh verification
before a release. This documentation task does not publish packages.

Delivery uses ordinary fast-forward pushes to the five remote heads, after
checking that their inspected baselines have not moved. Local `dev` retains its
separate descendant. Remote Git state after delivery establishes the resulting
tips; this pre-delivery record is not a remote CI result.

## Verification boundaries

All six checkouts passed `docs:sync`, `check:dev-docs`, `check:format` and lint.
The scanner passed 20 file-link and 14 navigation probes. The public docs gate
passed on main and the three feature branches. Remote `dev` still has 78 existing
public-documentation diagnostics; local `dev` does not define `check:docs`.

The two `dev` architecture outputs and remote `dev` public-doc diagnostics were
compared against clean archives of their original commits and matched exactly.
Their full gates stop before package builds and tests, so no fresh runtime-test
result is claimed for those histories. Those unrelated failures were not changed
to make a documentation synchronization appear green.

The shared AGENTS and nine `.agent` files match the source byte-for-byte on every
destination. Scope checks confirm that runtime, tests, manifests, lockfiles and
public documentation content are unchanged. Non-Markdown edits are limited to
documentation navigation/scanning and relocated documentation references in
existing checks or comments. Final record/index additions receive the focused
documentation checks again.

No documentation-site content changed, so no additional site build or frontend
review was needed. These checks do not certify browser/device behavior, audible
timing, accessibility, package publication or remote CI.
