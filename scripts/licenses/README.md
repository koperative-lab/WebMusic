# Reviewed upstream license snapshots

`bundle-notices.mjs` normally reads the exact installed package's license and
NOTICE files. A missing license fails the build unless a package/version has an
explicitly reviewed snapshot below. New versions require a fresh review; an SPDX
identifier alone never generates a guessed copyright statement.

| Package | Why a snapshot is needed | Authoritative source |
| --- | --- | --- |
| `@nodable/entities@3.0.0` | Its npm manifest declares MIT but its tarball omits the license file. | [Upstream MIT license at d2070d7](https://github.com/nodable/val-parsers/blob/d2070d76a8ba07e6c7fa142caeb51ffd756e47eb/LICENSE), retrieved 2026-09-14; copied verbatim into [the snapshot](nodable-entities-3.0.0-MIT.txt). |
| `fft.js@4.0.4` | Its npm tarball includes the MIT text in `README.md` but no separate license file. | [Upstream v4.0.4 README license section](https://github.com/indutny/fft.js/blob/v4.0.4/README.md#license), checked against the installed 4.0.4 README on 2026-09-29; reuses [the site's existing snapshot](site/fft.js-4.0.4-MIT.txt). |

The repository URL comes from that installed package's manifest. The snapshot
retains the upstream copyright holder and complete permission/disclaimer text.
It is an attribution repair for the reviewed version, not permission to apply
the same license text to arbitrary future packages or releases.

Score and Audio builds collect the dependencies actually included in their
JavaScript source maps. They emit `dist/THIRD_PARTY_NOTICES.txt` and append each
bundle's notices before its source-map URL without changing code offsets.
The collector defaults to Score; `--package-dir packages/audio` selects Audio
from the repository root. `--check` rejects missing or stale notices, and
`npm run check:packages` checks both packages.

The documentation site's additional font and prebundled-code boundaries are
recorded in [site/README.md](site/README.md). Those additional boundaries belong
to the website distribution. The FFT license snapshot is shared with the Audio
npm browser bundles.
