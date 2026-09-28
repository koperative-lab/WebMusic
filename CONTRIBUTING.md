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

Use Node.js 22.22.3+ on the 22.x line, 24.16.0+ on the 24.x line, or 26.3.0+,
and npm with the committed lockfile. CI checks Node 22.22.3 and 24; the root
[package.json](package.json) owns the command and engine definitions. Published
packages declare their runtime requirements in their own manifests.

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

The repository's [agent guide](AGENTS.md) and [development handbook](dev/DEVELOPMENT.md)
own the current contributor workflow. Product, architecture and accepted design
live under `dev/`; package references document the installed APIs.

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

Keep external tools responsible for their own features. WebMusic exposes music
behavior and composable presentation hooks; it does not implement translation
engines, application state stores or form/layout frameworks. Prefer a minimal
adapter or missing update/observation hook to a parallel subsystem. Supply final
text and formatting callbacks from the application's existing tools.

Run the affected workspace's tests and typecheck during development, for example
`npm test -w @webmusic/score` and `npm run typecheck -w @webmusic/score`.
Build dependencies first when consumers resolve their public entries from
`dist/`. Before requesting review, run:

```sh
npm run check
```

This covers source formatting, lockfile coverage, lint, architecture and
reference checks, package builds, documentation snippets,
types, tests, licenses, built exports and release manifests. The command chain
in [package.json](package.json) is authoritative. Add an Unreleased entry to
[CHANGELOG.md](CHANGELOG.md) for changes users need to know about.

ESLint's recommended rules remain enabled. `npm run lint` checks the current
source without a suppression baseline; resolve new findings in the owning file.

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
complete API coverage. `docs:build` builds this checkout's documentation site;
`pages:build` additionally validates the `/WebMusic/` deployment base. This
tree includes main's Agent context generator and strict release-context gate,
with a separate Audio/Bridge source adapter. Inspect changed pages in a browser
as well. These commands
produce local output without deploying.

`docs:sync` regenerates the component and documentation indexes under `dev/`.
`check:dev-docs` checks those indexes and maintained local links.

### Agent Toolkit

The [project agent toolkit](.agent/README.md) routes repository reviews to
the owning design and verification documents. The separate
[consumer skill](skills/README.md) must be checked against the package version
installed by its user; its bundled guidance does not establish current exports.
The skill's six read-only Node scripts read the published main documentation's
manifest and catalog. Their default source targets released Kernel/UI/Score.
Audio/Bridge source snapshots use the same scripts with an explicit `--base-url`
or `--context-dir`; their manifest identifies source fingerprints without claiming
published compatibility. See [the Audio/Bridge context reference](skills/webmusic/references/audio-bridge.md).

## CI and GitHub Pages

The [CI and Pages workflow](.github/workflows/ci.yml) runs on every branch push,
pull request and manual dispatch. The quality matrix installs from the lockfile
with `npm ci`, then runs `npm run check`, `npm run check:external-install` and
`npm run audit:dependencies` on Node 22.22.3 and 24. A separate Node 24 job runs
`npm ci` and `npm run pages:build` to validate the production site, its
`/WebMusic/` base. The site also generates third-party license notices using
main's collector for the actual bundled modules.

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

[Release policy](dev/release/RELEASING.md) owns package scope, version preparation
and the relationship to active CI. [Publishing](dev/release/PUBLISHING.md) owns
registry checks, validation, package order and manual publishing. Read those
owners before a release instead of inferring publication from a local version
or tag.

This development checkout retains five workspaces. Main's first release has
three; do not publish the restored Audio/Bridge tree merely because its local
manifests share the release version. Confirm the reviewed source commit, npm
scope rights, exact versions, artifacts and the release scope first.

Package receipts and generated site license notices follow main's checks,
extended to the five-package source tree. The complete Audio/Bridge static-asset
inventory still needs its own review; [STATUS](dev/STATUS.md) records that gap.
Preserve source, output and resource notices throughout validation and
publication. Publishing packages, tagging source and deploying documentation
remain separate operations.

## Contribution rights and resources

Submit only work you have the right to contribute under the project's
[MIT License](LICENSE). Retain applicable third-party notices. For demo music,
fonts, images, recordings or sound banks, record the source and redistribution
terms beside the owning demo asset or reference and include required
notices. Being downloadable or publicly playable does not establish permission
to redistribute a resource. Optional engines retain their own license terms.

Discuss changes respectfully and make feedback specific to the code, behavior
or documentation. Maintainers may ask for a smaller reproduction, clearer
ownership or additional verification before accepting a change.
