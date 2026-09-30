# Development workflow

Use this handbook to prepare a checkout, implement a change and verify it.
[The contributor index](README.md) routes to the documents that own product,
design, architecture, documentation and release policy. This file does not
maintain a release-status ledger or a second backlog.

The command and CI descriptions below document the integrated five-package
source tree. The first npm release contained three packages; it does not set
the current source or site scope. Retained branches may carry an earlier
toolchain or implementation. Inspect `npm run`, the
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
Select a supported Node release with your version manager and verify `node --version`
and `npm --version` in the terminal that will run the commands. Node 24.21.0 is
one supported version; the manifest remains authoritative for the supported range.
Run `npm ci` at this checkout's root to install from the committed lockfile,
including development dependencies, then `npm run build` to prepare package
outputs used by workspace consumers. Each worktree needs its own installation;
installing dependencies in another checkout does not prepare this worktree.
Use `npm install` when intentionally changing dependencies, and review the
lockfile diff.

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
| `npm run build` | Build publishable packages in dependency order and record source/output receipts. |
| `npm run build -w @webmusic/audio` | Build one package; choose the workspace affected by the change. |
| `npm run check` | Complete local source, license, built-export and release-manifest gate. |
| `npm run check:source` | Format, lockfile, dev-server startup tests, lint, architecture, docs, dev-docs, site notices, package builds, doc snippets, source/test typechecks and workspace tests. |
| `npm run check:format` | Check supported text files for LF, final newline, trailing whitespace and JSON validity. Includes tracked and non-ignored untracked files via `git ls-files -co --exclude-standard`; deleted files are skipped. |
| `npm run check:lockfile` | Verify that declared optional dependencies have lockfile records, including other platforms' native packages. |
| `npm run lint` | Run repository ESLint. |
| `npm run check:architecture` | Check package boundaries and public-surface policy. |
| `npm run check:docs` | Check the documentation contracts described in [DOCS-CONVENTIONS.md](docs/DOCS-CONVENTIONS.md). |
| `npm run docs:sync` | Regenerate the component index and repository documentation map from current catalogs, manifests and files. Run after adding/moving documentation or changing catalog descriptions. |
| `npm run check:dev-docs` | Verify generated inventories, current Markdown local-file links and maintained routes from AGENTS to dev guidance and the .agent toolkit. This is part of `check:source`; semantic prose and historical examples still require review. |
| `npm run check:doc-snippets` | Run scanner regression tests and compile supported TS/JS/JSX fences, inline scripts and literal MDX code exports against built declarations. Fragment inputs may use synthetic `any`; literal exports must be self-contained. See [DOCS-CONVENTIONS.md](docs/DOCS-CONVENTIONS.md) for selection and limits; no examples execute. |
| `npm run typecheck` | Run workspace source typechecks where defined. |
| `npm run typecheck:tests` | Typecheck the kernel, UI, Audio, Score, bridge and documentation tests listed in [tsconfig.test.json](../tsconfig.test.json). |
| `npm test` | Run workspace test scripts, including kernel and documentation tests. |
| `npm run check:licenses` | Check the dependency license/optional-peer policy. |
| `npm run check:site-notices` | Test the main site notice collector; the site build separately verifies the actual bundled module inventory. |
| `npm run check:packages` | Validate built exports, source/output receipts and bundled third-party notices using the main checks, extended to this checkout's five packages. |
| `npm run check:release-manifests` | Validate the shared version, cross-package ranges and publication metadata. |
| `npm run dev` | Reuse the running site, or build packages and start it. |
| `npm run dev:restart` | Explicitly stop this checkout's server, rebuild packages and start it again. |
| `npm run docs:dev` | Reuse or start this checkout's documentation server without rebuilding packages. |
| `npm run check:dev-server` | Test startup reuse, explicit restart, build failure, and concurrent starts. |
| `npm run docs:dev -- status` | Inspect the documentation server without restarting it or rebuilding packages. |
| `npm run docs:dev -- stop` | Stop this checkout's documentation server without rebuilding packages. |
| `npm run docs:build` | Build packages and the documentation site. |
| `npm run pages:build` | Build the docs with the configured GitHub Pages site/base and validate the prefixed output; this command does not deploy it. |
| `npm run audit:production` | Run the production dependency audit manually; it is outside `npm run check`. |
| `npm run audit:dependencies` | Audit all dependencies, including development tools; CI runs this outside `npm run check`. |
| `npm run check:external-install` | Pack and install packages into a fresh non-workspace consumer, then check imports and declarations; requires built outputs and network access. |
| `npm run release:prepare -- <x.y.z>` | Prepare a shared release version; follow [RELEASING.md](release/RELEASING.md) and refresh the lockfile. |

### Documentation server lifecycle

[The startup script](../scripts/docs-dev.mjs) checks Astro's tracked server before
building packages. Repeated `npm run dev` and `npm run docs:dev` calls reuse that
server and print its URL; they do not stop it, clear its content cache or rebuild
package output beneath a running consumer. An ordinary start does not apply new
host/port flags when reusing an existing server.

Use `npm run dev:restart` after changing package source: it explicitly stops the
tracked server before package builds clean `dist/`, then starts the rebuilt site.
`npm run docs:dev -- restart` restarts without rebuilding packages. A failed build
leaves the server stopped and reports the failure. A per-checkout startup lock
serializes starts, stops and restarts; do not bypass it with raw Astro commands
or run package builds concurrently with the running site. Interrupted startup releases its lock after child cleanup; on macOS/Linux the
package build runs in an owned process group so descendants are stopped before
a retry can rebuild. The next start also recovers a lock whose owner process
has exited.

Normal terminals retain Astro's foreground watch output and Ctrl+C behavior.
Astro may automatically background a server launched by an agent, and
`npm run docs:dev -- --background` requests that behavior explicitly. A background
start exits successfully once ready; use `npm run docs:dev -- logs --follow` to
watch its output. `npm run docs:dev -- status` inspects either mode, and
`npm run docs:dev -- stop` explicitly stops it. Stopping background log following
does not stop the server.

The old default `--force` takeover and `predev` stop hook could send SIGTERM to
another terminal's running Astro process, producing npm exit code 143. Neither
action occurs on an ordinary start now. Explicit stop/restart can still terminate
an older foreground command; genuine child failures and signals are reported,
not converted to success.

Arguments reach Astro through the startup script; for example,
`npm run dev -- --host localhost --port 4321` starts the site at that address when
no server is already running. Use `npm run dev:restart -- --host localhost --port
4321` to deliberately change a running server's address. `--force`, `--root` and
`--ignore-lock` are rejected so the wrapper's ownership stays with this checkout.

## Continuous integration

[.github/workflows/ci.yml](../.github/workflows/ci.yml) owns the active
workflow. Its quality jobs run `npm ci`, `npm run check`,
`npm run check:external-install` and `npm run audit:dependencies` on Node
22.22.3 and 24. The official repository also verifies its publication metadata.
A separate Node 24 job runs `npm run pages:build`. The workflow triggers on
pushes to all branches, on pull requests and on manual dispatch. It sets
`NODE_OPTIONS: --max-old-space-size=6144` for declaration builds.

That workflow does not run the separate `audit:production` command or publish
packages. It deploys the built Pages site only from the official repository's
`main` on a manual dispatch with `deploy_pages` selected, after quality and
documentation jobs succeed. Pushes and pull requests receive validation without
deployment. Review the public asset inventory before requesting deployment.
Its configuration is evidence of what is scheduled, not of the outcome
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
- **`tsup: command not found`:** run `npm ci` from this worktree's root with a
  supported Node version, then retry `npm run dev`. The package manifests and
  lockfile already declare tsup as a development dependency. If the install
  omitted development dependencies (for example through `NODE_ENV=production`
  or npm's `omit` setting), run `npm ci --include=dev`. Use the workspace's
  installed tools; a global tsup installation can hide an incomplete checkout.
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
