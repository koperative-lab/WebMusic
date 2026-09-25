# Releasing

This document owns the version policy and explains the boundary between the
available manual release procedure and archived automation. Use
[PUBLISHING.md](PUBLISHING.md) to perform a release. Current work and accepted
design decisions belong to [dev/STATUS.md](../STATUS.md) and
[dev/DECISIONS.md](../DECISIONS.md); this runbook does not track npm availability,
remote tags, repository archival or deployment status.

## First-release lane

The `main` release lane contains `@webmusic/kernel`, `@webmusic/ui` and
`@webmusic/score`. UI supports Score visual integrations. Audio and Bridge are
accepted expansion directions, but their packages are absent from this checkout
and excluded from its release package policy, version preparation, tarballs and
documentation build.

## One release lane

The publishable package set is maintained in
[scripts/package-policy.mjs](../../scripts/package-policy.mjs), and the
dependency-safe order in
[scripts/release-packages.mjs](../../scripts/release-packages.mjs). The packages
share a stable version. Read that version from their manifests and verify
registry and tag state before choosing a release number; a local manifest
alone does not establish that the number is available.

## Version policy

[scripts/release-manifests.mjs](../../scripts/release-manifests.mjs), exposed as
`npm run check:release-manifests` and included in `npm run check`, enforces:

- one shared stable `x.y.z` version for publishable packages; prereleases
  and ranges are rejected as package versions;
- dependency, devDependency and peerDependency references to those packages
  use `^x.y.z`, including references from the documentation workspace;
- each publishable manifest declares `publishConfig.access: "public"` and a
  Git `repository` object with a non-empty URL and matching package directory;
- in GitHub Actions, repository URLs match `GITHUB_REPOSITORY`; locally,
  the publishable packages agree on one URL.

Prepare a chosen version with `npm run release:prepare -- <x.y.z>`, then run
`npm install --package-lock-only`, review the manifest and lockfile changes,
and include both in the release commit. This prepares metadata; it does not
publish, reserve a version, or create a Git tag. The checks require repository
metadata suitable for provenance but do not themselves create or verify a
registry provenance attestation.

## Quality gate

Run `npm run check` for the complete local gate. The exact command chain is
owned by the root [package.json](../../package.json); command selection and test
coverage are explained in [dev/DEVELOPMENT.md](../DEVELOPMENT.md).

The manual release procedure additionally requires `npm run docs:build`,
`npm run audit:production` and `npm run check:external-install` against the
release checkout. The external-install check uses built tarballs in a fresh
non-workspace project and checks runtime imports and declaration resolution.
It does not test packages already published to the registry or verify
provenance. CI also runs the external-install check; the production audit remains
a manual release check outside the active workflow.

## Active CI and toolchain

[.github/workflows/ci.yml](../../.github/workflows/ci.yml) runs the check gate on
Node 22.22.3 and 24, followed by external-install and dependency-audit checks.
A separate Node 24 job runs `pages:build`. The workflow pins v7 revisions of
`actions/checkout` and `actions/setup-node` and sets a larger heap for declaration
builds. Read the workflow for triggers and job details, and the root/package
manifests for the supported Node range and toolchain.
A workflow definition is not a record of its latest result.

No package publication or promotion job is wired into that workflow.
`npm run pages:build` produces a configured documentation build; it does not
deploy by itself. After successful quality and documentation jobs, the workflow
deploys GitHub Pages only for a push or manual dispatch on the official
repository's `main` branch. Registry/tag verification and manual release
commands are in [PUBLISHING.md](PUBLISHING.md).

## Archived workflow reference

The earlier candidate/staging/promotion pipeline is preserved in the
[archived design](../../scripts/release-pipeline/DESIGN.md#archived-workflow-reference)
and [script archive](../../scripts/release-pipeline/README.md). Its automation is
not active in this checkout, and its historical commands are not the manual
release procedure. Reuse requires a reviewed port to the current package policy,
release order and workflows. Follow [PUBLISHING.md](PUBLISHING.md) for a release.
