# Dependabot integration review — 2026-10-27

## Scope and baseline

Review the five October 14 pull requests against `main` at
`ef8664dbb68ece9dc8c1d328141989a0ae86f888`, following the batch-review precedent
in [PR #33](https://github.com/koperative-lab/WebMusic/pull/33). This integration
contains only the accepted dependency updates, bounded lockfile security
repairs and review records. It contains no `modular-redesign` commits, package
publication, Pages deployment or DEV-05 asset-authorization changes.

The [original CI snapshot](2026-10-27-dependabot-ci.json) records every check
and its exact PR head. All five PRs were still open and targeted `main` when
reviewed on October 27 (America/New_York). Deployment checks were skipped as
configured for ordinary pushes and pull requests.

| PR | Update | Reviewed head | Original Node 22 / Node 24 / website | Decision |
|---|---|---|---|---|
| [#34](https://github.com/koperative-lab/WebMusic/pull/34) | `@tonaljs/chord` 6.1.2 → 6.2.0 | `f900e2bf1175bf6ea191b1a78ab9413b390ffd9b` | Fail / fail / fail | Defer: invalid published entrypoints |
| [#35](https://github.com/koperative-lab/WebMusic/pull/35) | `@astrojs/starlight` 0.42.5 → 0.42.6 | `4722cb7bfd2a4aaab1a48f6c86c61ed7d6b14cef` | Pass / pass / pass | Integrate |
| [#36](https://github.com/koperative-lab/WebMusic/pull/36) | `vitest` 5.0.2 → 5.0.3 | `45ac5d77e8217a10e9c9c6bf2d6ccacf160b8e3f` | Pass / pass / pass | Integrate |
| [#37](https://github.com/koperative-lab/WebMusic/pull/37) | `jsdom` 30.1.1 → 30.1.2 | `99befa981feab8eebdf4928de307a5385a874f0d` | Pass / pass / pass | Integrate |
| [#38](https://github.com/koperative-lab/WebMusic/pull/38) | `@tonaljs/chord-detect` 4.9.1 → 4.9.2 | `c2c77c927e86e0c26af29ecb48c11f0c5a23a099` | Pass / pass / pass | Defer: invalid published entrypoints despite green CI |

Accepted PR histories are preserved with merge commits. The rejected Tonal
heads are not ancestors of the integration branch and remain open for a
corrected upstream release and subsequent review.

## Compatibility and shared dependencies

- Starlight changes only the documentation manifest range and its own locked
  package. Its patch includes Icelandic translations, Firefox icon fixes,
  component-style isolation and Cloudflare development-server resolution fixes.
  Its Astro/MDX peer ranges do not change; no site configuration change is needed.
- Vitest updates the root and all six workspace ranges together, plus its exact
  `@vitest/mocker` and `@vitest/spy` versions. It includes repeat/retry isolation,
  project cache isolation and jsdom 30.1 Blob support. The upstream exact pin
  moves `why-is-node-running` from 3.2.2 to 3.2.1; retain that intentional change.
  Vite is an existing shared peer, not a request to upgrade Vitest's major version.
- jsdom updates the four declaring workspaces. Its CSS selector/color and URL
  dependencies change with the patch, including required transitive major
  changes `data-urls` 7 → 8 and `tr46` 6 → 7. These are upstream requirements,
  not discretionary direct major upgrades. The new packages remain within this
  repository's Node range (`^22.22.3 || ^24.16.0 || >=26.3.0`). Tests exercise
  DOM-backed Score/Audio/UI and documentation behavior; jsdom's release also
  repairs large DOM performance and computed-style invalidation.
- Chord 6.2.0 requires chord-detect 4.9.2 and refreshes the shared chord-type,
  pcset, pitch and scale packages. With chord held at 6.1.2, PR #38 instead adds
  a separate Score-local 4.9.2 subtree while chord retains its exact 4.9.1
  dependency. Neither rejected subtree is imported into the final lockfile.

### Reproduced Tonal publication defects

Downloaded the exact four npm tarballs with `npm pack --ignore-scripts`,
compared manifests, file lists and ESM code, and checked the declared paths:

| Package | Declared `main` | Declared `types` | Actual new files | CommonJS resolution |
|---|---|---|---|---|
| chord 6.1.2 / chord-detect 4.9.1 | `dist/index.js` | `dist/index.d.ts` | Both declared files present | Pass |
| chord 6.2.0 / chord-detect 4.9.2 | `dist/index.js` | `dist/index.d.ts` | `dist/index.cjs`, `dist/index.d.cts`, `dist/index.mjs`, `dist/index.d.mts` | `MODULE_NOT_FOUND` |

Both new versions omit their declared CommonJS and declaration files and have
no `exports` map to repair those paths. `require.resolve(<unpacked-package>)`
reproduces the CommonJS failure. The
[#34 Node 22 log](https://github.com/koperative-lab/WebMusic/actions/runs/38618161651/job/116038495516)
and its Node 24/website counterparts fail Score declarations at
`src/analyze/headless/workbench.ts:44` with TS2307. A working ESM/bundler path
does not establish valid CommonJS package metadata; #38's green CI does not
override the tarball defect. Do not add type shims, import private dist paths,
patch node_modules or weaken declaration checks to admit these releases.

## Current-main audit and minimal repairs

Audited both untouched `main` and the three-update combination against the
same current advisory database. Main reports 10 affected package records
(3 high, 4 moderate, 3 low); the un-repaired combination reports 8
(3 high, 2 moderate, 3 low). These counts are affected package records, not
distinct CVEs or proof that every path is reachable in production.

The three high records are already present on `main`: Vite 8.3.1, Undici
6.29.0/8.11.2 and Zod 4.6.5. Keep the existing high-severity gate and make these
exact compatible lockfile repairs, without changing manifests or overrides:

| Package | Locked before | Locked after | Reason |
|---|---|---|---|
| `vite` | 8.3.1 | 8.3.3 | Current-main launch-editor and dev-server advisories |
| `undici` | 6.29.0 | 6.29.1 | Supported 6.x security patch |
| `undici` under jsdom and unifont | 8.11.2 | 8.12.2 | Supported 8.x security patch |
| `zod` | 4.6.5 | 4.6.6 | Constrained-collection memory exhaustion |
| `fast-uri` | 3.1.8 | 3.1.9 | URI normalization/host/scheme advisories |
| nested `postcss-selector-parser` | 6.1.4 | 6.1.5 | Selector parsing CPU exhaustion; resolves the old DEP-02 chain |

These are the lowest fixed versions identified by this audit. Registry
metadata supplies exact tarball URLs, integrity, dependency and engine fields;
the 12 resolved parent ranges accept them. Vite 8.3.3 accepts the already
locked Rolldown 1.2.11, so no Rolldown/native binding refresh is needed.
All optional platform records remain present. This is an independent repair
of this main baseline's shared dependency graph; it does not integrate or
certify the separate `modular-redesign` Vite security work.

The final full-tree audit passes `--audit-level=high`: **0 high, 0 moderate,
3 low**. The remaining low chain is `meyda` → `@rollup/plugin-node-resolve` →
`deepmerge`, covered by
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
The audit suggests a forced Meyda downgrade rather than a supported repair.
Do not apply it as part of this patch batch; DEP-02 tracks the parent review.

## Verification

Use Node 22.22.3 (the exact CI matrix minimum) and Node 24.21.0 with npm
11.19.0. Full checks use the CI heap limit `NODE_OPTIONS=--max-old-space-size=6144`
and `VITEST_MAX_WORKERS=2`; no tests, assertions, license policies or audit
thresholds are disabled. npm installation verifies registry integrity.

The first three-update check passed all 4,190 workspace tests before the
security repairs. The final-lockfile matrix and build results are recorded
below; remote CI must independently validate the submitted commit. Original PR checks above are historical evidence for their listed SHAs.

| Verification | Final result |
|---|---|
| Node 24 clean install and full check | Pass; 4,190 workspace tests across 341 files, plus script gates |
| Node 22 clean install and full check | Pass; the same 4,190 workspace tests and script gates |
| External consumer imports/declarations on Node 22 and 24 | Pass on both: 168 runtime entries; 88 ESM/browser and 84 CommonJS declarations, with `skipLibCheck: false` |
| Ordinary docs build and Pages base-path build on Node 24 | Pass: 110 pages each; 74 notice records and 346 emitted files; `/WebMusic/` prefix validation passes |
| Production and full dependency audits on Node 22 and 24 | Pass on both at the unchanged high threshold; 0 high, 0 moderate, 3 low |

`npm run check` includes source/test typechecks, all workspace tests, license
gate, site/bundle notice regression tests, built package exports, package
receipts and release-manifest checks. The [machine-readable review record](2026-10-27-dependabot-ci.json) includes
audit snapshots, tarball hashes, local command results and log checksums.
Full local command logs are retained alongside the working checkout; the submitted PR's Actions links retain the
remote matrix logs. Automated builds do not claim manual browser/audio/device
acceptance, empirical musical accuracy or asset redistribution authorization.
