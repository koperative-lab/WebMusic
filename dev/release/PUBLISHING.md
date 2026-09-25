# Publishing

The manual publish procedure for the packages listed by
[scripts/release-packages.mjs](../../scripts/release-packages.mjs).
[RELEASING.md](RELEASING.md) owns the version policy and the boundary with
[archived automation](../../scripts/release-pipeline/DESIGN.md). Nothing below depends on that automation.

This document does not assert a current registry, tag or deployment state.
Perform the checks below for each release. Track unresolved release work in
[dev/STATUS.md](../STATUS.md), not in a second status section here.

## Establish release identity

Start from the reviewed checkout that will be published. Inspect its changes
and local tags, and query remote tags separately:

```sh
git status --short
git rev-parse HEAD
git tag --list 'v*'
git ls-remote --tags origin
npm whoami
```

Confirm publish rights to the `@webmusic` scope and satisfy the registry's
current account/authentication requirements. A successful `npm whoami`
identifies the account; it does not prove scope ownership or publish rights.

For each package in the release order, inspect its existing versions and
dist-tags, for example:

```sh
npm view @webmusic/kernel versions --json
npm view @webmusic/kernel dist-tags --json
```

A registry error, authentication failure or unavailable remote is not proof
that a package/version/tag is absent. Establish the intended stable `x.y.z`
version using those results and the manifests. If a version or tag already
exists, inspect what it identifies before proceeding. Do not assume `v0.1.0`
is available, move a tag to a new commit, or attempt to overwrite a published
package version. Reconcile a partially published release against its original
source and package artifacts; use a new shared version for changed artifacts.

If a version change is needed, follow the preparation steps in
[RELEASING.md](RELEASING.md#version-policy). Use a clean reviewed release
commit, including its lockfile, and record its SHA before validation.

## Validate the release checkout

Run from the repository root:

```sh
npm ci
npm run check
npm run docs:build
npm run audit:production
npm run check:external-install
```

`check` builds the packages and checks their source, tests, export maps,
licenses and release metadata. `docs:build` validates the documentation
build. The production audit is a manual release check outside CI. The
external-install check runs in CI and remains required when validating the
reviewed release checkout.

The external-install check packs the built packages and installs all tarballs
in a temporary project outside every workspace. It enumerates the installed
manifests, imports public ESM and dual CJS entries, and typechecks ESM imports
under `node16` and `bundler` resolution. Optional React peers are installed
for those entries. Kernel additionally checks ESM and CommonJS declarations
under `node16` and `nodenext` with `skipLibCheck: false`, and its pure event/clock
subpaths without DOM types. Both runtime formats check that Kernel's root and
subpaths re-export identical values within that format. This catches packaging faults hidden by workspace links;
it is not a registry-publication or provenance check. It requires network
access. Add `-- --keep` to retain its temporary project for diagnosis.

Review the result of the active CI run for the same commit separately. Do not
modify source, manifests or build outputs between validation and publication;
if they change, repeat the affected validation before publishing.

## Publish order

Use the order owned by
[scripts/release-packages.mjs](../../scripts/release-packages.mjs):

| Step | Package | Directory |
| --- | --- | --- |
| 1 | `@webmusic/kernel` | `platform/kernel` |
| 2 | `@webmusic/ui` | `packages/ui` |
| 3 | `@webmusic/score` | `packages/score` |

Audio and Bridge are outside this first release and this checkout.
Publish Score after Kernel and UI. Check registry
visibility of each prerequisite version before publishing its consumers.

## Per package

From each package directory, review the actual package contents:

```sh
npm pack --dry-run
```

Check the result against the manifest's `files` and `exports`, including all
worker/facade and declaration targets. The intended content is `dist/`,
`README.md`, `LICENSE` and the npm-provided `package.json`. Cross-package
references must be the reviewed registry semver ranges, not local `file:`
links. The UI package has no dependency on the domain packages or kernel;
Score declares Kernel as a required peer and UI as an optional visual peer. The package and
release-manifest checks verify the corresponding policy and metadata.

Publish the validated package:

```sh
npm publish --access public
```

The manifests also declare `publishConfig.access: "public"`; retaining the
explicit flag makes the intended access visible in the manual command.
Review the registry response before continuing. After a timeout or ambiguous
response, inspect the exact package version in the registry before retrying;
do not assume the first operation failed.

## Verify and tag the published commit

For each package, query the exact version that was published. Replace the
example values with the package and release version being verified:

```sh
release_package='@webmusic/kernel'
release_version='x.y.z'
npm view "$release_package@$release_version" version dist.integrity dist.tarball --json
npm view "$release_package" dist-tags --json
```

Confirm all release packages are present at the chosen version and intended
dist-tag. Retain the release SHA, validation output and registry responses
with the release record. A registry metadata query alone does not prove the
installed package functions; perform a fresh registry consumer install when
verifying delivery to users, without workspace links.

Before creating a tag, recheck both local and remote tags. If the exact tag
already exists, verify that it identifies the intended release commit and
matches the release record; do not recreate or force-push it. If it does not
exist and the whole release has been verified, create an annotated tag at
the commit that produced the published packages:

```sh
release_version='x.y.z'
release_commit='replace-with-reviewed-release-sha'
git tag -a "v$release_version" "$release_commit" -m "v$release_version"
git push origin "v$release_version"
```

Publishing a package, creating a tag and deploying documentation are separate
operations. The manual procedure does not restore archived release workflows
or deploy the documentation site.

## The unscoped name

The scoped packages do not require ownership of the unscoped `webmusic` name.
Any naming or meta-package decision belongs in [dev/DECISIONS.md](../DECISIONS.md)
and any active follow-up in [dev/STATUS.md](../STATUS.md). This runbook makes
no claim about the name's registry availability or an external support ticket.
