# Modular release follow-up evidence

This directory retains finite reproduction inputs and verification receipts for
the [twelve follow-up repairs](../MODULAR-RELEASE-FOLLOWUP-FIXES.md). Original
review failures remain separate from the repaired results. Raw paths and UTC
timestamps identify the cloud execution; the report uses America/New_York.

Maintained regression tests live in their owning package suites. Isolated probe
sources use a `.txt` suffix so they do not become product/test entry points.
Raw JSON snapshots lacking a final newline also receive that suffix, preserving
their original bytes instead of silently reformatting historical evidence.

## Reading the evidence

`before/` preserves the preceding release review's failures. `after/` preserves
this repair turn's reproductions, focused tests, peer reviews and final gates.
Files named `source`, `before`, or `first-focus-fix` are intermediate evidence;
read the final report before interpreting an individual result. A retained
failure is not a claim that the final implementation still fails.

`manifest.json` fingerprints each copied raw artifact. `after/validated-inputs.json`
and `after/source-stability.json` check implementation, tests, public references,
manifests and build scripts across integrated validation. Generated package
outputs have separate consumer/probe fingerprints. Audit prose is excluded from
the source inventory so it can record completed results afterward.

## Reproduction

1. From the checkout run `npm run check`, `npm run docs:build`, then
   `npm run check:external-install -- --keep`. Keep package and site outputs
   stable until their consumers finish. The external check executes the
   maintained Audio loader/Bridge fixture and Kernel/UI identity checks from
   actual installed tarballs, alongside imports and strict declarations.
2. Copy inert probe snapshots from `after/` to a writable directory and remove
   the final `.txt` suffix. Adapt their recorded `/workspace/WebMusic` and
   output-directory constants for another machine. Expose Playwright to the
   runner and provide Chromium; these are acceptance tools, not new package
   runtime dependencies. Preserve before/after output directories separately.
3. Run `audio/run-public.cjs`, `score/browser/run.cjs public`, and
   `envelope/verify-envelope-public.cjs`. These use rebuilt public entries and
   native browser contexts. The envelope history check uses a deterministic
   native-shaped clock separately from its live-clock and PCM checks.
4. Run `project-clock/run-probe.cjs` with
   `project-clock/manual-automation-notification-public.ts`, then
   `project-clock/public-manual-override.cjs`. These use public entries with
   controlled clock/parameter fixtures; they establish configuration ownership
   and restoration, not hardware timing.
5. Serve `apps/doc/webmusic/dist` for browser editor and documentation probes.
   The recorded site origin is `http://127.0.0.1:8767`; artifact fixtures use
   port 8766. `editor/lifecycle-probe.cjs` checks built presenter recovery.
   The peer editor focus matrix distinguishes exact-source and final public
   output runs; its command and input hashes are retained with each result.
6. Pass the fresh external consumer directory to
   `packaging/verify-ui-behavior.cjs`, followed by an output JSON path and
   `root` or `subpath`. Run each order in a fresh process. This adds actual
   same-host remount, ID and cleanup assertions using a DOM emulator; the
   browser matrix supplies native focus evidence separately.
7. The `prior-clock`, `prior-audio`, `prior-editor`, `final-native` and
   `final-docs` results repeat the previous accepted scenarios. Their original
   reproduction instructions remain in the
   [previous repair evidence](../../2026-10-15/release-fix-evidence/README.md)
   and [third-delivery evidence](../../2026-10-15/third-evidence/README.md).

The release directory records inspected tarball contents and the negative
installation of published Kernel/UI `0.2.0` with candidate Audio `0.3.0`.
It must reject the incompatible peer floor without peer-bypass flags.

Local checks do not establish registry publication, final-commit CI or media
redistribution rights. Native PCM and browser interaction checks have their
recorded context and sampling limits; they are not physical-device listening
or output-latency measurements.
