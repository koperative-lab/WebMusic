# Development branch CI reconciliation — 2026-09-11

> Historical baseline: the experimental Score files and UI extension policy named
> below were retired on 2026-09-25 when Score and Toolkit were aligned to main.
> The dated results remain evidence for the earlier tree; [STATUS](../STATUS.md)
> owns the current scope.

## Baseline and scope

The repair starts from local dev `cfa90b2`, preserving its integrated local/remote
history and Audio, Bridge and extended UI capabilities. Remote runs
[34429353430](https://github.com/mrsteamedbun/WebMusic/actions/runs/34429353430) and
[34045756301](https://github.com/mrsteamedbun/WebMusic/actions/runs/34045756301)
failed both Node checks on orphan Score source files; npm installation succeeded.
Recent main runs were already green. No workflow jobs or assertions were disabled.

## Reconciliation

- Relocated 23 intentionally parked Score Element/helper sources from published
  `src/` to `packages/score/experimental/`. Existing
  source references and tests follow the move. The test TypeScript project now
  explicitly includes every experiment; lint still covers them. They remain
  outside build entries, public exports and the package tarball. The shipped
  source reachability gate keeps its strict behavior.
- Classified retained application UI and foundation entries explicitly in
  `scripts/ui-extension-policy.mjs`, with real
  source, regression suite and API ownership. The Element composition/catalog
  checks still validate exact published Element consumers. No fictitious Element
  or independent live demo is required for a token/style foundation. The existing
  `/ui` gallery references remain available; reconciling them with the `/uikit`
  templates and live controls remains a development gap.
- Restored recorder, synth audio/macro and ScoreView factory customization while
  preserving current source/playback, view modes, theme and lifecycle behavior.
  Injected ScoreView composition is opt-in; the default rendering pipeline remains
  intact. Native playback sources and paused seeks have explicit regression tests.
- Recorder supports queued repeated pitches for its Element while the reusable
  controller keeps its legacy replace default. Source replacement discards pending
  note capture. Effect/EQ composition supports optional stable boundary ports;
  the Element opts in without changing direct-controller defaults.
- Macro rack keeps its presenter-owned shell and owns child factory handles.
  Failed mounting rolls back all previous children; teardown attempts every child
  before reporting a failure. The compatibility stylesheet regression now checks
  both object reuse across reconnect and empty DOM after disconnect, reconciling
  two previously contradictory assertions without dropping their intended coverage.
- Replaced the blanket single-macro call ban with an AST ownership check: only a
  protected per-item factory called from `mountMacroRack.mountItem` can mount the
  child into the supplied host/binding. Seven regressions retain the rejection of
  direct composition, substituted hosts/bindings and alias/namespace bypasses;
  the existing DOM creation/query/class mutation bans remain intact.
- The retained UI gallery checker now reads both `/ui` and `/uikit` for public
  export references, following their actual owning pages. Its gallery component
  completeness, reverse page registration and domain-free demo checks remain.
  Dev's `/ui` gallery root renders its retained content instead of inheriting the
  main-only redirect to `/uikit`; its application examples remain reachable.
- Documented retained Headless controllers and helper exports, the UI extensions
  and new composition options. Corrected the token example to iterate object
  values rather than treating `uiTokens` as an iterable collection.

## Verification

An isolated committed-lockfile `npm ci` completed. A Node 24.21.0 five-package
build and all test typechecking passed. Full workspace tests passed: Kernel 111,
Audio 599, Score 1,941, UI 955, Bridge 144, and documentation 71. Production
`npm audit --omit=dev --audit-level=high` reported zero vulnerabilities.

The final Node 24.21.0 `npm run check` passed: source format/lockfile/lint,
architecture and its seven ownership regressions, documentation/snippets,
source/test typechecks, all workspace tests, license policy, 112 built public
exports, and release manifests. `npm run docs:build` built 182 pages. Sitemap
generation was skipped because no deployment site URL was configured. After the
final evidence/reference wording, documentation inventories, reference/link and
format checks were rerun; the docs workspace was rebuilt against stable packages.

This record establishes local verification only. Remote CI must be observed on
the pushed commit. It does not establish browser/device or audible timing
acceptance, npm publication, or release readiness of the extended dev surface.
