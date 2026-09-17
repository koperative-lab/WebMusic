# Contributing to WebMusic

WebMusic welcomes reproducible bug reports, documentation improvements and
focused code changes. The public repository is
[koperative-lab/WebMusic](https://github.com/koperative-lab/WebMusic).
Use [SECURITY.md](SECURITY.md) for suspected vulnerabilities.

## Report a bug or propose a change

Search the [issues](https://github.com/koperative-lab/WebMusic/issues) before
opening a new report. Include the affected package and version or commit,
Node/browser/operating-system versions, a minimal reproduction, the expected
behavior and the observed result. For audio, MIDI, microphone or rendering
issues, include the device, permission state and relevant timing or layout
conditions. Remove credentials and personal data from logs and examples.

For a substantial new capability or public API change, explain the use case
and proposed contract in an issue before implementation. The first release
contains Kernel, UI Kit and Score; Audio and Bridge remain on the `dev` branch.
Read the owning package's [Score architecture](packages/score/ARCHITECTURE.md),
[UI Kit contract](packages/ui/README.md) or [platform ledger](platform/README.md).

## Set up the repository

Use Node.js 22.19.0 or later and npm with the committed lockfile. CI checks
Node 22.19.0 and 24; the root [package.json](package.json) owns the command
and engine definitions. Published packages declare their runtime requirements
in their own manifests.

```sh
git clone https://github.com/koperative-lab/WebMusic.git
cd WebMusic
npm ci
npm run dev
```

`npm run dev` builds the packages, then starts the documentation app at
<http://localhost:4321>. Use `npm run build:packages` when only package outputs
are needed, or `npm run docs:dev` when those outputs already exist. Package
builds clean their output directories, so do not run a consuming test or
documentation build concurrently with a package rebuild.

This guide and the public package references contain the required contributor
instructions. Ignored `.dev/` notes, agent instructions and editor settings
are optional local material. Source checks, builds and published documentation
must work without them; do not recreate a `dev/` directory as a prerequisite.

## Prepare a pull request

Keep changes scoped to their purpose and preserve unrelated work. Read the
implementation, public exports, tests and owning reference together. State who
owns new resources and how replacement, cancellation and cleanup work. Add
regression coverage for changed behavior and update the corresponding public
reference when an API, default, error or lifecycle contract changes.

Preserve the package boundaries: Kernel is domain-neutral, UI uses structural
bindings without domain or Kernel imports, and Score's model, API and Headless
layers stay free of UI DOM, canvas and SVG implementation. Elements, renderers
and browser drivers own their visual and platform integration. Review
[scripts/package-policy.mjs](scripts/package-policy.mjs),
[scripts/element-composition-policy.mjs](scripts/element-composition-policy.mjs),
[scripts/check-architecture.mjs](scripts/check-architecture.mjs), manifests and
build mappings together when changing a public entry or dependency boundary.

Run the affected workspace's tests and typecheck during development, for example
`npm test -w @webmusic/score` and `npm run typecheck -w @webmusic/score`.
Build dependencies first when consumers resolve their public entries from
`dist/`. Before requesting review, run:

```sh
npm run check
```

This covers source formatting, lockfile coverage, lint, architecture and
reference checks, package builds, asset validation, documentation snippets,
types, tests, licenses, built exports and release manifests. The command chain
in [package.json](package.json) is authoritative. Add an Unreleased entry to
[CHANGELOG.md](CHANGELOG.md) for changes users need to know about.

Describe what changed, why, the commands and results, and any material behavior
that remains unverified. Tests and static checks do not establish audible
timing, browser/device interaction or accessibility. Exercise changed browser
flows, keyboard and focus behavior in the target environment.

## Documentation

Maintain documentation in English, preserving API identifiers. Public site
pages live in [apps/doc/webmusic/src/content/docs/](apps/doc/webmusic/src/content/docs/);
[apps/README.md](apps/README.md) explains routes and local development. Update the
owning component, Headless, presenter or API page instead of copying a complete
contract into another guide. Use repository-relative links in repository guides
and site routes in published pages. Every public reading path must resolve
without ignored local files.

Document real members, defaults, units, errors, events and cleanup; keep examples,
live demos and catalogs aligned with the exported types. Preserve dated audit
bodies and historical examples as evidence, with current navigation in their
archive indexes. After documentation, catalog or site changes, run:

```sh
npm run docs:sync
npm run check:dev-docs
npm run check:docs
npm run check:format
npm run check:doc-snippets
npm run docs:build
npm run pages:build
```

Snippet checks compile supported examples against built declarations; rebuild
packages first when their source changed. They do not execute examples or prove
complete API coverage. `docs:build` builds the normal production site;
`pages:build` validates the `/WebMusic/` deployment base. Inspect the changed
pages in a browser as well. Both commands produce local output without deploying.

`docs:sync` updates local indexes only when `.dev/` already exists. It does not
create a development directory in a public checkout. `check:dev-docs` always
checks public references and catalogs; it additionally checks the local indexes
and internal links when `.dev/` is present.

### Agent Toolkit

The [consumer skill](skills/README.md) is maintained separately from this
repository's local agent instructions. Keep its bundled references portable.
The public AGENTS.md / CLAUDE.md page owns the instructions users copy into
their applications; the skill links to that page.
Documentation builds generate `llms.txt`, `llms-full.txt`,
`llms-components.txt`, `llms-patterns.txt` and Markdown references using the
[context generator](apps/doc/webmusic/scripts/agent-context.mjs). Its tests
run with the documentation workspace tests; output verification runs during
each site build. When a released API changes, review and update the generator's
release baseline deliberately, along with the skill's compatibility metadata.
Package version numbers alone do not establish a matching release contract.
The skill's six read-only Node scripts use the generated manifest and catalog
to retrieve documentation, selected source files and styling references.
Keep catalog paths, content hashes and task selections synchronized in the
generator; do not maintain a separate component inventory in the skill.

## CI and GitHub Pages

The [CI and Pages workflow](.github/workflows/ci.yml) runs on every branch push,
pull request and manual dispatch. The quality matrix installs from the lockfile
with `npm ci`, then runs `npm run check`, `npm run check:external-install` and
`npm run audit:dependencies` on Node 22.19.0 and 24. A separate Node 24 job runs
`npm ci` and `npm run pages:build` to validate the production site, its
`/WebMusic/` base and generated license notices.

Only a `main` push or a manual run selected from `main` in
`koperative-lab/WebMusic` uploads `apps/doc/webmusic/dist/` as the Pages artifact
and deploys it. Deployment waits for every quality matrix entry and the
documentation job to succeed. Pull requests, other branches and forks run the
checks without publishing a site. In-progress runs on `main` are not cancelled
by newer runs; newer runs cancel outdated work for the same other ref.

The workflow has read-only repository permissions by default. Only the deploy
job receives `pages: write` and `id-token: write`, and it uses the
`github-pages` environment. It does not require a personal access token or npm
secret, and it does not publish npm packages or create release tags.

For the initial setup, a repository administrator must:

1. Open **Settings → Pages → Build and deployment**, and select **GitHub
   Actions** as the source. Confirm that the repository's visibility and GitHub
   plan support Pages before expecting deployment to be available.
2. Open **Settings → Environments → github-pages**, set **Deployment branches
   and tags** to **Selected branches and tags**, and allow only the `main`
   branch. Optional required reviewers add a manual approval before deployment.
3. Commit and push the complete public source tree, including the workflow, to
   `main`. For a retry without a new commit, open **Actions → CI and Pages →
   Run workflow**, choose `main`, then select **Run workflow**.
4. Confirm that the quality, documentation and deployment jobs all pass for
   the intended commit. Open the deployment URL from the `github-pages`
   environment and check the introduction, a Score demo and search under
   `/WebMusic/`.

The configured site address is
[koperative-lab.github.io/WebMusic](https://koperative-lab.github.io/WebMusic/).
A committed workflow or a local build alone does not establish that this URL
is live. If deployment fails, inspect the failing job and repository Pages and
environment settings, fix the cause, then rerun the workflow from `main`.

## Releasing

Release only a reviewed commit containing all required source, tests, scripts,
workflows and public instructions. Check `git status --short`, record
`git rev-parse HEAD`, inspect local and remote tags, and verify package identity:

```sh
git tag --list 'v*'
git ls-remote --tags origin
npm run check:release-manifests -- --verify-origin
npm whoami
```

Confirm the `@webmusic` scope's publish rights separately from the authenticated
account. Query existing versions and dist-tags for every release package with
`npm view <package> versions --json` and `npm view <package> dist-tags --json`.
A failed remote request does not prove that a version or tag is absent.
Do not overwrite a published version or move an existing release tag.

The package set in [scripts/package-policy.mjs](scripts/package-policy.mjs)
shares one stable `x.y.z` version, with cross-package references using `^x.y.z`.
If a version change is needed, run `npm run release:prepare -- <x.y.z>` and
`npm install --package-lock-only`, review the manifests and lockfile, and include
them in the release commit. These commands prepare metadata without publishing
or reserving a version. Validate that exact checkout:

```sh
npm ci
npm run check
npm run pages:build
npm run audit:dependencies
npm run audit:production
npm run check:external-install
```

The external check packs built packages into a fresh project outside all
workspaces and checks runtime imports and strict declarations for ESM, CommonJS
and browser consumers. It requires network access; add `-- --keep` to retain its
temporary consumer for diagnosis. It does not check already published registry
artifacts or attest provenance. Review the CI result for the same commit
separately. [The active workflow](.github/workflows/ci.yml) runs quality, external
consumer and full dependency checks on Node 22.19.0 and 24, plus a Node 24 Pages
build. Successful eligible `main` runs deploy documentation as described in
[CI and GitHub Pages](#ci-and-github-pages); npm publication remains manual.

Do not change package inputs or output between validation and publishing.
Each package's `prepack` checks export targets and `dist/build-receipt.json`
against source, build configuration, manifests, lockfile, README, license and
emitted files. After a relevant change, rebuild all packages and repeat affected
validation. Do not bypass this hook with `--ignore-scripts` or edit the receipt.
If declaration builds need more heap, use the CI setting
`NODE_OPTIONS=--max-old-space-size=6144`.

Publish in the dependency order owned by
[scripts/release-packages.mjs](scripts/release-packages.mjs):

| Order | Package | Directory |
| --- | --- | --- |
| 1 | `@webmusic/kernel` | `platform/kernel` |
| 2 | `@webmusic/ui` | `packages/ui` |
| 3 | `@webmusic/score` | `packages/score` |

From each package directory, inspect `npm pack --dry-run`. Review `dist/`,
`README.md`, `LICENSE`, `package.json`, all export and worker targets, generated
third-party notices and the build receipt. Only after validation, run
`npm publish --access public`. Confirm prerequisite versions are visible in the
registry before publishing consumers. If a publish response is ambiguous, query
the exact version before retrying.

After publication, query each exact package version with
`npm view <package>@<x.y.z> version dist.integrity dist.tarball --json`, check its
dist-tags and perform a fresh registry consumer install. Retain those results
with the reviewed release SHA. Recheck local and remote tags; once the entire
release is verified, create an annotated `v<x.y.z>` tag at that exact commit
and push that tag. Existing tags must already identify the same release; never
force-move them to reconcile changed artifacts. A partial release needs explicit
reconciliation; changed artifacts require a new shared version.

Production documentation builds generate `licenses/THIRD_PARTY_NOTICES.txt`
and `licenses/BUNDLED_ASSETS.json` from emitted browser modules and styles.
Keep that generated directory with the deployed site. Source-side `.dev/`
notes and unused static asset directories are not deployment prerequisites.
Publishing packages, tagging source and deploying documentation are separate
operations. The [archived release pipeline](scripts/release-pipeline/README.md)
is historical context, not the active release procedure.

## Contribution rights and resources

Submit only work you have the right to contribute under the project's
[MIT License](LICENSE). Retain applicable third-party notices. For demo music,
fonts, images, recordings or sound banks, record the source and redistribution
terms in the [asset inventory](apps/doc/webmusic/ASSETS.md) and include required
notices. Being downloadable or publicly playable does not establish permission
to redistribute a resource. Optional engines retain their own license terms.

Discuss changes respectfully and make feedback specific to the code, behavior
or documentation. Maintainers may ask for a smaller reproduction, clearer
ownership or additional verification before accepting a change.
