# Kernel release preparation

Date: 2026-09-11. Scope: `@webmusic/kernel`, its public reference, built exports
and the manual npm preparation checks. Baseline: `main` at
`fdfd46f3754cb10c9ad7839b6c811a4e3f493ac5` plus the existing, uncommitted
Score/UIKit/documentation work. Those prior changes were preserved. This report
does not identify a clean release commit or establish npm publication.

## Findings and corrections

| Surface | Reproduced problem | Correction and evidence |
|---|---|---|
| CommonJS package | Root/subpath constructors were duplicated; a mirror clock failed `instanceof TransportClock` and imported private-field methods. The new package check rejected 27 mismatched exports on the old build. | Enable tsup splitting in both formats. The isolated trial preserves every tested identity. Package and external-install checks now verify root/subpath identity; the package check also exercises the mirror clock. |
| Events | An earlier subscriber could recursively emit and consume a `once` listener, then the outer snapshot invoked it again. | Guard single delivery independently of subscription removal; test nested dispatch. |
| Element lifecycle | A thrown `null`/`undefined` reporting failure was lost; a stale returned cleanup could be reported twice. | Drain cleanup/reports, preserve the first thrown value and report the stale cleanup once. |
| Element targets | Any source-change event in a root, or definition of an obsolete target, could reset an unrelated current binding. | Force refresh only for the selected source/current target definition; continue resolving actual replacements. |
| Tick source | Queued messages from a failed worker still delivered ticks; synchronous worker messaging errors could starve a running source or prevent pause. | Ignore inactive workers and use the interval fallback after start/stop messaging failures. Disposal retains cleanup error reporting. |
| Transport group | Observable follower refusal could commit as success; callback re-entry could skip members or let stale commands seek/play detached participants. A throwing background reconciliation hook escaped the watcher. | Validate observable startup, snapshot membership and recheck generations after callbacks. Settle/report current monitor failures without overriding newer commands. |
| Meter | Non-finite bar counts produced empty output/native allocation errors; disposal lost nullish failures. | Normalize non-finite counts to documented defaults and preserve the first cleanup failure after attempting all owned nodes. |
| Public contracts | The Worker reference invented timeout/abort/dispose methods; Kernel overview claimed UI depended on it and counted the wrong subpaths; several methods/defaults were undocumented. | Reconcile all ten capability subpaths and 60 exported values/types. Document ownership, failures, units, finite fallbacks, exact timer guarantees and first-release scope. |

No domain model, third-party runtime dependency, new public entry or release
version was introduced. Transport math, structural player/effect contracts,
AudioContext construction and RequestTracker bookkeeping were reviewed against
their callers. Added tests cover their numeric, SSR, error and ownership boundaries.

## Verification

The isolated workspace was populated from the current manifests/lockfile and
final Kernel source; it had no inherited `node_modules`. Node 22.14.0 and
Node 24.21.0 were exercised separately. The primary checkout uses Node 26.8.1.

| Check | Result |
|---|---|
| Node 22 clean `npm ci`, Kernel build and tests | Passed; 147 tests. Explicit CJS splitting was also built and checked on Node 22. |
| Node 24 clean install, final build and tests | Passed; 147 tests with final CJS splitting. |
| Full `npm run check` | Passed: 147 Kernel, 572 UI, 2,022 Score and 63 documentation-app tests; source/types, architecture, snippets, licenses, exports and release manifests passed. |
| `npm run docs:build` | Passed; 69 pages. |
| `npm run audit:production` | Passed; zero reported production vulnerabilities at review time. Kernel itself declares no runtime/peer dependencies. |
| `npm run check:external-install` | Passed: 114 ESM/CJS runtime imports, 57 ESM entries under Node16/Bundler, plus strict Kernel `.d.ts`/`.d.cts` resolution under Node16/NodeNext and pure event/clock imports without DOM types. |
| Native Chrome runtime smoke | Passed: real Blob-worker ticks, stop/restart/dispose, root/subpath ESM identity, selected-target refresh isolation and native custom-element cleanup. |

The actual external-consumer tarball matches the final `npm pack --dry-run`
integrity. It contains 113 files, 150,097 compressed bytes and 638,490 unpacked
bytes, under only `dist/`, `README.md`, `LICENSE` and `package.json`. Package
identity and compact verification data are retained in
[the evidence record](evidence/kernel-release.json). This is a locally validated
candidate at the current manifest version, not a registry release.

Unit tests use controlled clocks, worker doubles and fake audio graphs. They do
not establish audible timing, browser suspension behavior, device support or
sample-accurate loop wrapping. A mutable shared-clock injection API and nonlinear
timeline alignment remain outside the implemented Kernel contract.

## External release state

Read-only checks against the npm registry and configured Git remote found:

- `npm whoami` returned `ENEEDAUTH`; this environment is not authenticated.
- The public `@webmusic/kernel` query returned `E404`. This does not establish
  scope ownership, version availability or publish rights.
- `git ls-remote --tags origin` succeeded with no listed tags at the time checked.
- Local `v0.1.0` already resolves to
  `0d01ee29ae6039e74330842ed45be8b7fe1216c5`, not the current working tree.
  The existing tag was not moved or published.

Before publication, establish an authenticated account with `@webmusic` rights,
re-query each intended package/version, choose the shared release version and
review a clean release commit containing the prepared changes. Recheck CI and
registry/tag state for that exact commit using the
[publishing procedure](../../release/PUBLISHING.md). No publish, commit, tag
creation, remote mutation or documentation deployment occurred in this review.
