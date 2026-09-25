# First-release branch split — 2026-09-10

## Scope and preserved baselines

The maintainer requested that Audio and Bridge continue on `dev` while `main`
prepares the first release around Score and Kernel. UI Kit remains a separate
release package because Score Elements and visual renderers consume its public
presenters. [DEC-021](../DECISIONS.md#dec-021--first-release-contains-kernel-ui-kit-and-score)
and [release policy](../release/RELEASING.md) own the maintained boundary.

Main started at `f074cd8b5f7cdf8f288c77d988384a359c873cfb`. The local safety ref
`codex/before-audio-bridge-split-20260910` preserves that complete tree. Initial
local dev `9d69d02` and fetched origin/dev `40a445f` had distinct histories;
they were merged before importing the pre-split main baseline. Dev retains its
additional Audio viewport/timeline capabilities and extended UI work as well
as main's Audio/Bridge changes. The independent dev worktree prevents that
integration from touching the main working tree.

Existing uncommitted Score review work was saved before editing. The split
changes no Score runtime or test source in main. The release commit excludes those
original edits and their untracked audit/test files; they remain available as
uncommitted work in main. Generated inventories for the release commit are
computed from its own clean tree, separately from the working-tree inventories.

## Resulting release boundary

Main's workspace list, package policy, build and publish order, TypeScript
solution, license/export checks and documentation contain Kernel, UI and Score.
Audio and Bridge source, tests and their public site pages, demos, catalogs and
exclusive fixtures are removed from main. Score's Web Audio playback and all
existing UI public entries remain available. Presenters without a Score Element
consumer remain usable through independent bindings and demos.

Dependency and source-import checks reject unavailable `@webmusic/*` packages.
External consumer validation additionally rejects an unexpected installed Audio
or Bridge package. The refreshed lockfile removes obsolete workspace/dependency
records without changing retained dependency versions.

Current guidance directs deferred development to `dev`. Historical reports keep
their recorded outcomes; links to moved source/reference files point to the
immutable pre-split commit so those citations remain inspectable.

## Verification

The following working-tree checks used Node 22.16.0 and include the preserved
Score review changes:

- `npm run check`: passed; 207 workspace test files and 2,616 tests, 148 compiled
  documentation examples, source/test typechecks and 61 public export checks.
- `npm run docs:build`: passed; 67 indexed content pages. Existing redirect-only
  Pagefind warnings and the missing local sitemap site URL are build notices.
- `npm run audit:production`: passed, zero reported vulnerabilities.
- `npm run check:external-install`: passed for the three packed packages;
  114 ESM/CJS imports and 57 declarations under both node16 and bundler resolution.
- Original Score source/test preservation: all 90 initially changed or untracked
  source/test files have the same bytes as the pre-split snapshot.

The independent release candidate passed a fresh `npm ci`, `npm run check`
(188 workspace test files / 2,396 tests), `npm run docs:build`, and
`npm run check:external-install` (114 ESM/CJS imports and 57 declarations under
both module resolutions). Its retained Score, UI and Kernel runtime/test source
is byte-identical to pre-split main. Both generated inventories and repository
links were checked again after recording this result.

Dev's five package builds and focused Audio (599 tests) and Bridge (144 tests)
suites pass. Its complete check remains blocked by the extended development
surface's architecture/catalog inconsistencies. Four retained Score suites
contain 30 controller-injection assertions from competing local/remote dev
lineages: local dev already lacked the injection hooks that remote dev had.
Replacing the active Elements with the remote variants failed newer playback,
view-mode and SynthPanel contracts, so that trial was reverted. Both original
histories and all tests remain retained. Dev STATUS records the exact integration
gap; its broader readiness must not be inferred from main's successful checks.

No npm package was published, no release tag was created, and no documentation
was deployed by this branch preparation. Browser/device/audio acceptance remains
separate from build, unit, declaration and package-import checks.
