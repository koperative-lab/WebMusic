# Dev guidance alignment and setup repair — 2026-09-25

## Scope and baseline

This pass reviewed the local `dev` checkout at `ae0742a` together with its
restored, staged five-package migration. Shared design was compared with main
`1e0fb7bd5250778bb78380f909112246b360cb49`. The migration was already present;
this pass preserved those staged changes and left its own edits for review.
It did not commit, push, deploy or publish the migration. The main checkout
was not changed.

The task was to align AGENTS, repository guidance and Agent resources, repair
the reported development startup failure, and open the local documentation
site. It was not a new implementation of every accepted main contract.
[STATUS](../STATUS.md) remains the current integration and verification queue.

## Changes and retained differences

- Kept `AGENTS.md` as the single repository instruction entry. The `.agent/`
  skills, workflows and rule ownership matched the shared main guidance; the
  tool map retains its valid link to dev's existing Audio signal fixtures.
- Clarified the local worktree versus committed-ref baseline, synchronization
  boundaries, and ownership of current contracts, generated indexes and dated
  evidence. The inventory now uses Git's tracked/non-ignored file set while
  retaining Audio/Bridge discovery and the consumer skill directory.
- Aligned Score orientation, Audio walkthrough and UI classification guidance
  with the accepted decisions. Preserved dev's implementation gaps for the
  Score overview, UI category routes and staff notation. Linked the complete
  staff-notation target at the reviewed main revision.
- Corrected current-checkout links and claims about CI, package receipts,
  asset/license inventories and generated Agent context. The consumer skill
  remains release-oriented and rejects development context; its documentation
  now states that restriction. These missing main facilities remain DEV-05.
- Aligned Node engine declarations and official repository/site metadata.
  Restored the `audit:dependencies` script already invoked by CI. Dependency
  versions were not upgraded; the lockfile edits only align workspace engines.
- Fixed Rack demo source URLs to use the configured site base, including the
  default source used when adding/resetting a part. The Pages asset check
  detected the prior root-absolute URL escaping `/WebMusic/`.

## Startup diagnosis

The worktree had no installed `node_modules`; all relevant package manifests
already declared `tsup`. `npm ci --include=dev --no-audit --no-fund` installed
the lockfile dependencies and made local tsup 8.5.1 available. The checks used
Node 24.21.0 from the existing version-manager installation. The shell's
previous default, Node 22.14.0, is below the aligned engine range.

The [development handbook](../DEVELOPMENT.md) now explains that each worktree
needs its own installation, how to include development dependencies, and how
to diagnose this error without masking it through a global tsup installation.

## Verification

These are local results for this restored working tree, not remote CI or
publication evidence.

| Check | Observed result |
|---|---|
| Lockfile install with development dependencies | Passed on Node 24.21.0; local tsup resolves |
| `npm run check` | Passed: source/docs/architecture checks, package builds, snippets, types, workspace tests, licenses, built exports and release manifests |
| `npm run docs:build` | Passed |
| `npm run pages:build` | Initially rejected the Rack default MIDI path; passed after the base-path fix, including the emitted-asset validation |
| `npm run check:external-install` | Passed for all five package tarballs: 206 ESM/CJS imports and 103 entry declarations under both node16 and bundler resolution |
| Focused Rack playground tests | Passed, 6 tests, after the asset-path correction |
| `npm run typecheck -w webmusic-doc` | Passed after the asset-path correction: no errors, warnings or hints |
| `npm run docs:sync`, `check:dev-docs`, `check:docs`, `check:format` | Passed after guidance and record updates |
| `npm run dev` | Package prebuild completed and Astro started at `http://localhost:4321/` |
| Local route smoke check | Home, Score, Audio and Bridge composition returned HTTP 200; the Introduction page rendered in the in-app browser with all five package routes |
| `npm run audit:dependencies` | Failed: 12 reported dependency findings (2 critical, 4 high, 6 moderate) |

The complete check ran before the follow-up Rack asset-path correction. That
correction was then verified by its focused tests, documentation workspace
typecheck and a fresh successful Pages build. The dev command subsequently
rebuilt all packages and started the site successfully.

The audit identifies the retained Astro/Starlight, Vite/Vitest, esbuild, sharp,
fast-uri and js-yaml dependency chains. Its proposed complete repair includes
major toolchain upgrades; no automatic force upgrade was applied in this
alignment pass. DEP-01 records the required upgrade and verification work.
This failed gate prevents describing the whole CI workflow as passing.

The site builds also report large client chunks, ignored Sandpack module
directives and Pagefind notices for redirect pages. The unconfigured local
build skips sitemap output; the Pages build generates it with its configured
site. These warnings did not fail the build. No browser, audible timing,
MIDI/microphone, accessibility or deployment acceptance is inferred from the
static checks.

## Local debugging handoff

The running process uses this dev worktree and Node 24.21.0. To restart from a
terminal with nvm loaded:

```sh
nvm use 24.21.0
npm run dev
```

Run those commands at the dev worktree root. The installation is already
present. The site listens locally on port 4321 and watches source changes.
The browser smoke check establishes startup and basic rendering only; it does
not complete the outstanding cross-browser, audible synchronization, device
or accessibility acceptance in STATUS.
