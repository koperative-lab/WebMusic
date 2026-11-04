# Tonal published-entrypoint follow-up — 2026-10-28

## Baseline and upstream releases

This follow-up starts from `main` at
`a3a30596798a2233920d1017215e28b27f65c7c3`, after the reviewed October
maintenance integration in [PR #39](https://github.com/koperative-lab/WebMusic/pull/39).
It revisits DEP-03 and the two packages deferred in the
[October 27 review](2026-10-27-dependabot-integration.md).

The npm registry now reports the following published versions as `latest`.
Both exact tarballs restore the declared `dist/index.js` CommonJS and
`dist/index.d.ts` declaration files; their `dist/index.mjs` and
`dist/index.d.mts` files are also present. No export-map workaround or source
shim is needed. The registry timestamps identify October 14 releases; this
is a new verification of their availability, not a claim they were released
on October 28.

| Original PR | Revised update from current main | Reviewed head |
|---|---|---|
| [#34](https://github.com/koperative-lab/WebMusic/pull/34) | `@tonaljs/chord` 6.1.2 → 6.2.1 | `e0fc139b8da41d89b154e2fb4f7fa9e99f95755c` |
| [#38](https://github.com/koperative-lab/WebMusic/pull/38) | `@tonaljs/chord-detect` 4.9.1 → 4.9.3 | `8f256dcc2810736143b423339a6f606bdd1525e0` |

Primary publication evidence:
[chord 6.2.1 metadata](https://registry.npmjs.org/@tonaljs/chord/6.2.1) and
[chord-detect 4.9.3 metadata](https://registry.npmjs.org/@tonaljs/chord-detect/4.9.3).
The [machine-readable evidence](2026-10-28-tonal-entrypoint-follow-up.json)
retains the exact tarball integrity/file lists, package graph changes,
direct-consumer probe and verification results.

## Dependency reconciliation and compatibility

Both updated PR histories are preserved with merge commits. Chord 6.2.1
requires chord-detect 4.9.3 exactly, so the Score manifest's direct detector
range is updated to `^4.9.3` and uses that same root instance. Resolve the
overlapping manifest/lockfile edits without importing #38's redundant
Score-local detector subtree. Keep the required nested pitch packages:
older ABC-notation dependencies still pin their existing versions, while
the new chord graph requires corrected pitch-package releases.

The changed Tonal versions are chord 6.2.1, chord-detect 4.9.3, chord-type
5.2.1, collection 4.9.1, interval 5.1.1, pcset 4.10.3, pitch 5.0.3,
pitch-distance 5.0.7, pitch-interval 6.1.2, pitch-note 6.1.2 and scale-type
4.9.4. These stay within the existing major versions. Only Score's two
dependency ranges and their Tonal lockfile graph change. Preserve every
non-Tonal lock record and all platform-native optional dependencies from
the reviewed main baseline, including the prior security patches. All 44
resolved Tonal dependency edges satisfy their declared ranges. Comparing the
old and corrected direct-package declarations finds no removed callable
signatures; existing source imports need no adaptation.

### Direct publication checks

A fresh non-workspace project installs the exact two versions independently
of WebMusic's bundled outputs. On both Node 22.22.3 and Node 24.21.0:

- Bare ESM and CommonJS imports work. Walk all 11 reachable Tonal package
  instances and verify declared `main`, `module` and `types` paths, then load
  CommonJS and the raw ESM module of each instance.
- Each package declares MIT and includes its actual LICENSE text.
- TypeScript 5.9.3 compiles direct public imports under Node16 and NodeNext
  for both `.mts` and `.cts`, and under Bundler for `.ts`, with strict mode
  and `skipLibCheck: false`.
- Runtime assertions cover C-major-seventh notes, D-minor notes, C/E inversion,
  triad detection and octave-preserving chord degrees. The existing WebMusic
  chord-spelling/analysis tests and external packaged consumer checks provide
  the broader repository regression coverage.

These checks address the previous false confidence from #38's green CI:
successful bundled output alone does not prove valid upstream package entrypoints.

## Final verification

Use the same Node 22.22.3 and 24.21.0 / npm 11.19.0 matrix as the preceding
review, with separate clean installations. Full checks use the CI heap limit
`NODE_OPTIONS=--max-old-space-size=6144` and `VITEST_MAX_WORKERS=2`.
No assertions, declaration checks, license rules or audit thresholds are relaxed.

| Verification | Result |
|---|---|
| Direct Tonal entrypoints, MIT text, runtime assertions and declarations, Node 22/24 | Pass |
| Clean install and full `npm run check`, Node 22/24 | Pass on both: 4,190 workspace tests in 341 files, plus source/type/license/package/release gates |
| External WebMusic consumer imports/declarations, Node 22/24 | Pass on both: 168 runtime entries; 88 ESM/browser and 84 CommonJS declarations, with `skipLibCheck: false` |
| Ordinary docs and Pages builds, Node 24 | Pass: 110 pages each; 74 license records across 346 emitted files; `/WebMusic/` base-path validation passes |
| Full and production audits, Node 22/24 | Pass at the unchanged high threshold: 0 high, 0 moderate, 3 low on both |

The current audit retains the preceding review's three low reports in the
Meyda → Rollup node-resolve → deepmerge chain (DEP-02); the high gate remains
unchanged. Record final audit results for this actual lockfile. Full local
logs and probe sources are retained in the evidence archive; the integration
PR records the exact remote CI run and commit once complete.

DEP-03 is resolved for these exact corrected releases by the passing matrix. Historical records of the broken 6.2.0/4.9.2 tarballs stay unchanged.
This PR contains no `modular-redesign` work, DEV-05 asset changes, package
publication or Pages deployment. Automated checks do not establish broader
musical accuracy or manual browser/audio/device acceptance.
