# Archived release pipeline design

This is the earlier candidate, staging and promotion design, preserved as
historical implementation context. Its workflow names, package identities,
commands and assumptions describe that design, not the active release process.
Do not execute it as a current publishing runbook.

Use the [manual release instructions](../../CONTRIBUTING.md#releasing)
for the current version policy and publishing procedure. The
[archive index](README.md) explains the retained scripts and the work required
before any reuse.

<!-- docs:historical-body -->

## Archived workflow reference

The remainder records the earlier workflow-driven pipeline. Its scripts and
tests are preserved under [scripts/release-pipeline/](README.md),
but its release, promotion and deployment workflows are not active in this
checkout. Reuse requires a reviewed port to the current monorepo, package
policy and release order; the archive still lists thirteen pre-migration
packages under `@webscore/*`, `@webaudio/*` and the former bridge name.

Commands, workflow names, package counts, artifact names and script paths in
this historical section describe that earlier design. Paths such as
`scripts/publish-workspaces.mjs` refer to scripts now inside the archive.
Root aliases `release:artifacts`, `release:publish` and
`release:verify-registry` are absent. The active `check:external-install`
command is a separate implementation: it does **not** implement this section's
historical `--manifest` candidate interface. These examples are reference,
not instructions to publish with the archive as-is.

Publication and promotion in that design serialized through one concurrency
group; credentialed jobs used the `npm-release` GitHub environment.

### Candidate artifacts

`npm run release:artifacts -- --output <dir>`
(`scripts/create-release-artifacts.mjs`) builds one immutable candidate:

- refuses to reuse an existing output directory;
- rejects any package declaring npm packaging lifecycle scripts (`prepare`,
  `prepack`, ...) — artifact identity depends on `--ignore-scripts`;
- builds once (`npm run build:packages`), then runs
  `npm pack --json --ignore-scripts` per package in release order into
  `<dir>/tarballs/`;
- recomputes each tarball's SHA-512 integrity and size and fails on any
  mismatch with what `npm pack` reported;
- records source identity (git SHA, clean/dirty worktree) before and after,
  failing if the build changed either;
- writes `<dir>/artifact-manifest.json` (schema version 1, format
  `webmusic-1`) recording the version, per-artifact integrity and size, the
  toolchain (node, npm, lockfile version), the build and pack commands, and
  the workflow identity — `local`, or the GitHub Actions repository,
  workflowRef, runId, and runAttempt.

Every downstream consumer re-validates the manifest and re-hashes the
tarballs, and the publish/install paths first copy the candidate into a
read-only snapshot so validated bytes cannot be swapped before use.

### release.yml — candidate, gates, staging publish

Triggers: a `v*` tag push (real publication) or `workflow_dispatch`
(rehearsal only — manual runs must keep `dry_run: true` or the run fails).

1. `build_candidate` — for tag pushes, requires the tag to be protected by a
   tag rule, annotated, pointing at the checked-out commit, and an ancestor of
   `origin/main`. Runs `npm ci`, the production audit, `npm run check`,
   `npm run docs:build`, `check:release-manifests`, and verifies every score
   package version equals the tag (`v<x.y.z>`). Then builds the candidate via
   `release:artifacts` and uploads it as immutable artifact
   `webscore-release-<run id>-<attempt>` (90-day retention) *before* any
   packed code is executed.
2. `external_test` — downloads the archived candidate and runs
   `npm run check:external-install -- --manifest <...>` against those exact
   tarballs: installs them in a fresh non-workspace consumer, imports every
   public entry as ESM and every dual entry as CommonJS, checks the
   `@webscore/play/global` browser-IIFE contract (runtime and types), and
   exercises the worker-client fallbacks.
3. `rehearse_publish` (dispatch only) — dry-runs the publish script against
   the exact tarballs without credentials.
4. `publish` (tag push only) — `npm-release` environment, `id-token: write`
   for provenance, requires `NPM_TOKEN`. Deliberately performs no install or
   build; it only downloads the archived candidate and runs
   `scripts/publish-workspaces.mjs`.

`scripts/publish-workspaces.mjs` (`npm run release:publish -- --manifest
<path> [--dry-run]`) re-validates the candidate, requires HEAD to equal the
candidate's SHA (and a clean tree for real runs), and identity-gates real
publication to the protected-tag workflow run that built the candidate. Per
package: an already-published version with matching integrity is skipped;
differing integrity aborts the release line; otherwise it publishes the exact
tarball with `--provenance --access public --ignore-scripts` under the
version-specific upload tag `webscore-staging-v<x.y.z>` and waits for the
registry integrity to become visible. Only after all six packages verify does
it advance the shared `staging` dist-tag, with preflight snapshots, refusal to
move any tag backward, concurrent-change detection, and bounded rollback.
`latest` is never touched by this workflow; consumers can test a staged
release with `npm install @webscore/core@staging`.

### promote-release.yml — promoting latest

Manual dispatch from protected `main`, inputs `release_run_id` and
`artifact_name` (from the release run) and `operation`:
`verify` | `promote` | `recover`. The job downloads the archived candidate by
run id, then:

- `scripts/verify-promotion-authority.mjs` cross-checks the candidate against
  GitHub's authoritative run/workflow/artifact records and independently
  verifies the release tag and mainline ancestry;
- `scripts/verify-registry-release.mjs` (skipped for `recover`) installs the
  complete graph fresh from `registry.npmjs.org` with `--ignore-scripts
  --strict-peer-deps`, requires every package to resolve from the registry
  with the candidate integrity, requires the npm SLSA provenance attestation,
  and runs `npm audit signatures`;
- `scripts/promote-workspaces.mjs` performs the operation. `verify` is a
  credential-free dry run. `promote` snapshots `staging`/`latest` per package,
  refuses backward motion and concurrent changes, persists per-version
  rollback markers (`webscore-latest-before-v<x.y.z>` /
  `webscore-latest-unset-before-v<x.y.z>`) before the first `latest` write,
  moves `latest` with bounded rollback, then records durable completion
  markers (`webscore-latest-complete-v<x.y.z>`). `recover` restores `latest`
  from the retained markers, and only when they prove a provably incomplete
  promotion; anything ambiguous fails closed.

`promote-release.yml` invokes registry verification through the root
`npm run release:verify-registry` alias, which delegates to
`scripts/verify-registry-release.mjs`.

### Docs deploy (archived)

`deploy-docs.yml` is manual (`workflow_dispatch`; the push trigger is
committed but commented out) and requires GitHub Pages to be enabled with the
"GitHub Actions" source. It builds the packages, the React demo with
`DEMO_BASE=/WebMusic/`, and both documentation sites with
`DOCS_SITE=https://mrsteamedbun.github.io`; WebScore uses
`DOCS_BASE=/WebMusic/score` and WebAudio uses
`DOCS_BASE=/WebMusic/audio`. Each output is validated with
`scripts/prefix-docs-base.mjs`, then `npm run docs:assemble` mounts the docs
beside the React demo in `apps/doc/pages-dist` for one
`actions/deploy-pages` artifact.

### Pre-release checklist (monorepo-era)

Historical sequence only; the executable manual checklist is in
[PUBLISHING.md](../../dev/release/PUBLISHING.md).

1. Move the version: `npm run release:prepare -- <x.y.z>`, then
   `npm install --package-lock-only`; commit and confirm
   `npm run check:release-manifests`.
2. `npm run check` passes locally; CI is green on both Node lanes.
3. Rehearse the artifacts: `npm run check:external-install` (it packs its own
   candidate when run without `--manifest`), or build one explicitly with
   `npm run release:artifacts -- --output <dir>` and run both
   `npm run check:external-install -- --manifest <dir>/artifact-manifest.json`
   and
   `npm run release:publish -- --manifest <dir>/artifact-manifest.json --dry-run`.
4. Optionally dispatch `release.yml` (dry run) for a full workflow rehearsal.
5. Publish: push an annotated `v<x.y.z>` tag on a `main` commit covered by a
   protected tag rule; approve the `npm-release` environment when the
   `publish` job asks.
6. Verify the staged release from the registry: dispatch
   `promote-release.yml` with `operation: verify`, using the release run's id
   and artifact name.
7. Promote: re-dispatch with `operation: promote`. Use `recover` only for a
   provably incomplete `latest` promotion.
