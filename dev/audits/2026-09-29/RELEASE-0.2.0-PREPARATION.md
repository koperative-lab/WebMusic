# Five-package 0.2.0 release preparation

## Baseline and scope

Prepared on 2026-09-29 from `main` commit
`eaa88af43a40661b3a7ded6ae9853e1b000be9d1` on `release/0.2.0`.
The changes prepare Kernel, UI Kit, Score, Audio and Bridge for one manual npm
release. They do not publish packages or create a release tag. The prior
three-package `0.1.0` Agent Toolkit receipt remains historical evidence.

The checked package source/configuration fingerprint is
`4b97ad9c9f851f547206db4fadede814da47c8904798781ab564680b50d85c54`.
The [candidate artifact record](release-artifacts.json) retains the five local
pack previews and build receipts. These hashes identify local candidate
artifacts, not registry publication or provenance attestations.

## Repairs and review

- All publishable manifests and internal dependency ranges use `0.2.0` and
  `^0.2.0`, including the documentation workspace and lockfile.
- The Agent Toolkit source-snapshot test reads current manifest versions and
  verifies that a version change updates the snapshot fingerprint. It continues
  to reject unverified source as a verified release.
- Audio now includes notices for the code actually bundled into its three
  browser IIFEs. The collector covers `fft.js`, `pitchy`, Kernel and UI; the
  existing reviewed FFT MIT snapshot is shared with the site collector.
  Checks reject missing/stale notices and unreviewed snapshot identities.
- Audio and Bridge build receipts and `prepack` hooks now apply the same
  stale-output protection as Kernel, UI and Score.
- Package README links and version guidance are corrected. The
  [migration guide](../../release/0.2.0.md) compares actual npm `0.1.0`
  tarballs whose SHA-512 integrity was independently checked, including Score
  tag/export removals and the new Kernel/UI compatibility required by Audio.
- Pages builds remain in CI. Deployment requires manual dispatch on official
  `main` with `deploy_pages` enabled. The eight site media files in DEV-05 are
  excluded from npm tarballs; their redistribution evidence remains unresolved.
  Existing deployed files are not removed by this workflow change.

## Verification

Environment: macOS, Node `24.21.0`, npm `11.19.0`.

| Check | Observed result |
| --- | --- |
| `npm ci` | Clean lockfile installation passed. |
| `npm run check` | Passed source, type, workspace test, license, package artifact/export, bundled-notice and release-manifest gates. |
| `npm run docs:build` | Passed; 110 pages, 108 Agent Toolkit Markdown references and site notices verified. |
| Pages build steps using the same stable package output | The documentation workspace build with `DOCS_SITE`/`DOCS_BASE`, `prefix-docs-base.mjs` and `site-notices.mjs --check` passed; 346 emitted HTML/JS/CSS files validated. |
| `npm run audit:production` and `npm run audit:dependencies` | Both passed with zero vulnerabilities after retrying the registry query outside the network-restricted sandbox. |
| `npm run check:external-install -- --keep` | Passed in a non-workspace consumer: 168 runtime imports, installed Score IO/chord behavior in ESM and CommonJS, 88 ESM/browser and 84 CommonJS declarations without `skipLibCheck`. |
| Five `npm pack --dry-run --json` previews | All prepack hooks passed. Only `LICENSE`, `README.md`, `package.json` and `dist/` were included. Audio contains the notice aggregate and notices in all three IIFEs. |
| Workflow configuration | YAML parsed successfully; 48 upload/deploy event combinations allowed deployment only for the official repository's `main`, manual dispatch and explicit true input. |
| Independent review | Notice generation, snapshot guards, prepack integration, migration claims and manual publishing commands reviewed with no remaining actionable finding. |

Read the release PR's checks for its exact commit; these local results do not
stand in for remote CI. Rebuild and repeat affected checks if package inputs
change. Device input, acoustic timing and broader browser/accessibility claims
retain the bounds recorded in [STATUS](../../STATUS.md).

## External state and publisher handoff

The live registry check found only `0.1.0`/`latest` for Kernel, UI and Score;
Audio and Bridge returned public E404. No remote `v0.2.0` tag was found.
These are time-specific observations, so repeat them immediately before
publication. E404 does not establish first-publication permission.

`npm whoami` returned E401 in the preparation environment. The human publisher
must authenticate and confirm `@webmusic` publish rights, including creation of
Audio and Bridge. Follow the [0.2.0 manual instructions](../../release/0.2.0.md)
to publish and verify one package at a time, test a fresh registry installation,
then tag the exact producing commit and record verified release metadata.
