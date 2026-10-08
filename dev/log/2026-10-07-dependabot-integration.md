# Dependabot integration review — 2026-10-07

## Scope and baseline

This review integrates the five pending Dependabot pull requests targeting
`main`, starting at `de1c65ca36974906431cbd3a3c141317862d8705`. Work is isolated
from the existing `dev` checkout at `4471a22`; its Score analysis changes,
research archive and stashes are retained separately.

| Pull request | Update | Original reviewed head |
|---|---|---|
| [#28](https://github.com/koperative-lab/WebMusic/pull/28) | `globals` 17.12.0 → 17.13.0 | `c76a696` |
| [#29](https://github.com/koperative-lab/WebMusic/pull/29) | `typescript-eslint` 8.70.1 → 8.71.0 | `05351f3` |
| [#30](https://github.com/koperative-lab/WebMusic/pull/30) | `@astrojs/starlight` 0.42.4 → 0.42.5 | `c684c5d` |
| [#31](https://github.com/koperative-lab/WebMusic/pull/31) | `sharp` 0.35.4 → 0.35.5 | `bcf539f` |
| [#32](https://github.com/koperative-lab/WebMusic/pull/32) | `fast-xml-parser` 5.11.1 → 5.11.2 | `e8c8169` |

Original branch histories are retained through merge commits. Main's rules
require a pull request and successful Node 22/24 quality and website checks;
the combined result is submitted through an integration pull request. This
allows the actual dependency combination to be checked without bypassing
required checks or merging the separate Score analysis work into main.

## Findings and bounded repairs

- Globals adds three browser speech-recognition names unused by this tree.
  The TypeScript ESLint update keeps the configured recommended rules; its new
  typed rule is not automatically enabled here. No lint exceptions are added.
- Starlight adds a locale and also refreshes Sharp in its lockfile. Sharp's
  duplicate native-package changes are reconciled once, retaining both updated
  manifest ranges. The required platform records remain in the final lockfile.
- The XML parser update also resolves `@nodable/entities` 3.1.0. Its npm tarball
  omits license text, while both notice collectors only knew the reviewed 3.0.0
  snapshot. Both collectors now support a separately reviewed, exact 3.1.0
  snapshot from upstream commit `ac48e7ea591da372be023a481875c747535812b3`.
  Version, MIT identifier and repository identity remain required. The
  [license source ledger](../../scripts/licenses/README.md) owns the source.
- The earlier PR checks failed the dependency audit against their old shared
  lockfile. The integration retains the already-reviewed compatible updates
  from dev: `devalue` 5.9.4, `http-cache-semantics` 4.3.0 and `source-map-js`
  1.2.2, alongside Sharp 0.35.5. No forced downgrade or major upgrade is used.
- Ten moderate audit reports remain in the documentation site's nested PostCSS
  selector-parser chain. Starlight 0.42.5 does not update that chain; DEP-02
  retains the separate parent-dependency migration. The high-severity gate
  does not imply an advisory-free dependency tree.

## Verification boundaries

Validation covers the final merged lockfile, precise license fallback guards,
the full repository check, packaged external consumers, audit threshold and
the site build with its configured Pages base path. Existing parsing tests
exercise MusicXML/ABC and structure limits; no musical demo content is changed.
Local results and remote CI outcomes must be reported for their actual commits.
This integration does not publish npm packages or deploy the website.

Local verification on Node 26.8.1 / npm 11.19.0 passed:

- `node --test scripts/bundle-notices.test.mjs scripts/site-notices.test.mjs`:
  12 tests, including exact-version and metadata rejection cases. The new
  bundle regression failed before the reviewed 3.1.0 fallback was added.
- `VITEST_MAX_WORKERS=2 npm run check`: 4,190 workspace tests and all source,
  package, documentation, type, license and release-manifest gates.
- `npm run pages:build`: 110 pages; the `/WebMusic/` base-path and site notice
  checks validated 346 emitted HTML/JS/CSS files.
- `npm run docs:build`: 110 pages with the ordinary local-site configuration.
- `npm run check:external-install`: 168 runtime imports, Score model composition
  in ESM/CommonJS, and 88 ESM/browser plus 84 CommonJS declarations.
- `npm run audit:dependencies`: passed the configured high threshold, retaining
  the ten moderate findings described above.
