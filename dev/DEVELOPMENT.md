# Development workflow

Use this handbook to prepare a checkout, implement a change and verify it.
[The contributor index](README.md) routes to the documents that own product,
design, architecture, documentation and release policy. This file does not
maintain a release-status ledger or a second backlog.

The command and CI descriptions below document the first-release `main` baseline
(Kernel, UI Kit and Score). Audio and Bridge are deferred from this checkout;
their migration status belongs in [STATUS.md](STATUS.md). Other branches may
carry a different toolchain or implementation. Inspect `npm run`, the
local manifest and workflow before running an optional command or claiming its
coverage. Synchronizing this handbook does not install missing checkers or
merge the runtime changes discussed in audit records.

## Choose the work and its owner

1. Read [PRODUCT.md](PRODUCT.md) for the product direction and the three ways
   to use the components: Web Component, Headless, and API + UI.
2. Use [STATUS.md](STATUS.md) to understand gaps relevant to the user's task. Check
   [DECISIONS.md](DECISIONS.md) before reopening a design question.
3. For a component change, use [COMPONENT-DESIGN.md](design/COMPONENT-DESIGN.md)
   and [DESIGN-PRINCIPLES.md](DESIGN-PRINCIPLES.md). Find existing components
   and their source through [COMPONENTS.md](COMPONENTS.md).
4. Follow [ARCHITECTURE.md](ARCHITECTURE.md) for package boundaries and
   public surfaces. Use [DOCUMENTATION-MAP.md](DOCUMENTATION-MAP.md) to find
   the documentation owner, then follow
   [DOCS-CONVENTIONS.md](docs/DOCS-CONVENTIONS.md) and the relevant page template.

Files under [plans/](plans/) are dated proposals and review evidence. Their
counts, branch descriptions, verification results and open-item labels refer
to their stated snapshots. They do not establish today's work queue or the
contents of a remote branch. When reviewing an older implementation, resolve
its recorded commit and compare it with the checkout being changed.

## Prepare and inspect the checkout

Use the Node version range declared by the root [package.json](../package.json).
Run `npm ci` to install from the committed lockfile, then `npm run build`
to prepare package outputs used by workspace consumers. Use `npm install`
when intentionally changing dependencies, and review the lockfile diff.

Before editing, inspect `git status --short` and the current branch. Preserve
unrelated work. Do not infer publication from a manifest version, a branch
name or a local tag. The registry and remote-tag verification procedure
belongs to [PUBLISHING.md](release/PUBLISHING.md).

## Implement and verify

Keep behavior, meaningful regression coverage and the owning document in the
same change. Tests should exercise the user-visible contract, including
resource ownership and asynchronous cancellation where relevant. A
source-only test cannot establish that a built entry or packaged worker
resolves correctly.

Start with the affected workspace's tests and typecheck. Build dependencies
before testing consumers that resolve their public entries from `dist/`.
Coordinate builds when sharing a checkout: a build cleans its package output,
so another process must not rely on that directory while it is rebuilt.

Before handing off a complete change, run `npm run check` and review its
result. Run `npm run docs:build` for documentation-site changes. For packaging
or release work, also complete the external-install and manual audit steps
in [PUBLISHING.md](release/PUBLISHING.md). Report the checks actually run, including
failures and unverified surfaces; do not treat a past green result as a
current status claim.

When behavior or an accepted design changes, update its owning document and
[DECISIONS.md](DECISIONS.md) as appropriate. Update [STATUS.md](STATUS.md)
for remaining work. Preserve dated audit findings and historical plans as
evidence rather than turning them into competing live checklists.

## Commands

The root [package.json](../package.json) owns command definitions. This table
helps select commands; it does not define another execution chain.

| Command | Use |
| --- | --- |
| `npm run build` | Build publishable packages in dependency order. |
| `npm run build -w @webmusic/score` | Build one package; choose the workspace affected by the change. |
| `npm run check` | Complete local source, license, built-export and release-manifest gate. |
| `npm run check:source` | Format, lockfile, lint, architecture, docs, site notices, package builds, demo assets, doc snippets, source/test typechecks and workspace tests. |
| `npm run check:format` | Check supported text files for LF, final newline, trailing whitespace and JSON validity. Includes tracked and non-ignored untracked files via `git ls-files -co --exclude-standard`; deleted files are skipped. |
| `npm run check:lockfile` | Verify that declared optional dependencies have lockfile records, including other platforms' native packages. |
| `npm run lint` | Run repository ESLint. |
| `npm run check:architecture` | Check package boundaries and public-surface policy. |
| `npm run check:docs` | Check the documentation contracts described in [DOCS-CONVENTIONS.md](docs/DOCS-CONVENTIONS.md). |
| `npm run check:site-notices` | Test the generated browser-asset notice policy. |
| `npm run docs:sync` | Regenerate the component index and repository documentation map from current catalogs, manifests and files. Run after adding/moving documentation or changing catalog descriptions. |
| `npm run check:dev-docs` | Verify generated inventories, current Markdown local-file links and maintained routes from AGENTS to dev guidance and the .agent toolkit. This is part of `check:source`; semantic prose and historical examples still require review. |
| `npm run check:doc-snippets` | Run scanner regression tests and compile supported TS/JS/JSX fences, inline scripts and literal MDX code exports against built declarations. Fragment inputs may use synthetic `any`; literal exports must be self-contained. See [DOCS-CONVENTIONS.md](docs/DOCS-CONVENTIONS.md) for selection and limits; no examples execute. |
| `npm run check:assets` | Check demo asset inventory and its regression tests. |
| `npm run typecheck` | Run workspace source typechecks where defined. |
| `npm run typecheck:tests` | Typecheck the Kernel, UI, Score and documentation tests listed in [tsconfig.test.json](../tsconfig.test.json). |
| `npm test` | Run workspace test scripts, including kernel and documentation tests. |
| `npm run check:licenses` | Check the dependency license/optional-peer policy. |
| `npm run check:packages` | Validate built public exports, package artifacts and bundled notices against package policy. |
| `npm run check:release-manifests` | Validate the shared version, cross-package ranges and publication metadata. |
| `npm run dev` | Build packages, then start the documentation site. |
| `npm run docs:dev` | Start the documentation site without rebuilding packages. |
| `npm run docs:build` | Build packages and the documentation site. |
| `npm run pages:build` | Build the docs with the configured GitHub Pages site/base and validate the prefixed output; this command does not deploy it. |
| `npm run audit:production` | Run the production dependency audit manually; it is outside `npm run check`. |
| `npm run audit:dependencies` | Audit all dependencies, including development tools; CI runs this outside `npm run check`. |
| `npm run check:external-install` | Pack and install packages into a fresh non-workspace consumer, then check imports and declarations; requires built outputs and network access. |
| `npm run release:prepare -- <x.y.z>` | Prepare a shared release version; follow [RELEASING.md](release/RELEASING.md) and refresh the lockfile. |

## Continuous integration

[.github/workflows/ci.yml](../.github/workflows/ci.yml) owns the active
workflow. Its quality jobs run `npm ci`, `npm run check`,
`npm run check:external-install` and `npm run audit:dependencies` on Node 22
and 24. A separate Node 24 job runs `npm run pages:build`. It triggers on
pushes to all branches, on pull requests and on manual dispatch. It sets
`NODE_OPTIONS: --max-old-space-size=6144` for declaration builds.

That workflow does not run the separate `audit:production` command or publish
packages. It deploys the built Pages site only from the official repository's
`main` on a push or manual dispatch, after quality and documentation jobs
succeed. Its configuration is evidence of what is scheduled, not of the outcome
of a remote run. Archived release automation is documented separately in
[RELEASING.md](release/RELEASING.md).

## Build and packaging troubleshooting

- **Local homepage reports too many redirects:** older checkouts cached a
  permanent `/` to `/introduction` redirect. Both routes now render the same
  Introduction content. If the browser cached both historical directions, open
  `/introduction?reset-cache=1` on the same development origin, then return to
  `/`. With `DOCS_BASE=/WebMusic/`, use
  `/WebMusic/introduction?reset-cache=1` and return to `/WebMusic/`.
  In development only, this explicit recovery request sends
  `Clear-Site-Data: "cache"`; supporting browsers discard HTTP caches without
  clearing cookies or application storage. This header is not a script-level
  acknowledgement that the browser cleared its cache, and is not emitted by
  the static production build. If unsupported, bypass the HTTP cache on reload
  or clear the localhost HTTP cache in the browser. Reinstalling packages does
  not clear browser redirects.
- **Missing platform-native optional dependency:** inspect the lockfile and
  run `npm run check:lockfile`. If it must be regenerated, use an isolated
  clean checkout without an existing `node_modules`, review the complete
  lockfile diff, and retest installation. Adding only the current machine's
  native binary does not repair cross-platform resolution.
- **Declaration worker out of memory:** use the heap setting from the active
  CI workflow. A successful JavaScript build does not imply the declaration
  worker also succeeded.
- **Missing output after concurrent tsup configs:** Score and Audio clean
  their shared `dist/` once before tsup. Preserve that sequencing when
  adjusting their build; a per-config clean can delete a sibling's output.
- **Worker works from source but fails after packaging:** inspect the emitted
  URL and worker facade, then test the built package. The family postbuild
  scripts preserve worker entry locations after bundler splitting.
- **Dependency/toolchain change:** review the root TypeScript pin and npm
  overrides with the lockfile. Rebuild declarations and affected docs; do not
  assume an existing install exercised the new resolution.
- **Workspace install passes but consumer install fails:** use
  `npm run check:external-install -- --keep` to retain its temporary consumer
  for inspection. It installs all package tarballs together, avoiding local
  directory links that can conceal export-map faults.

Architecture decisions are broader than one policy file. Coordinate the
accepted design, applicable policy tables, manifests, build configuration,
implementation and documentation when the contract requires it;
[ARCHITECTURE.md](ARCHITECTURE.md) identifies the mechanical checks.
