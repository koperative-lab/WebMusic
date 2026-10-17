# Modular release repair evidence

This directory retains the commands, fingerprints and finite reproduction
inputs for the [repair record](../MODULAR-RELEASE-FIXES.md). Paths and UTC
timestamps in raw outputs identify the cloud execution, not repository setup
configuration. The report date uses America/New_York.

The preceding review reproduced eight implementation defects and a mixed-version
installation failure. This follow-up keeps those results separate from repaired
behavior. Maintained regression tests belong to the owning package test suites;
isolated browser/native probe snapshots use a `.txt` suffix so they do not become
product or test entry points accidentally.

## Final evidence

- `full-check`, `docs-build`, and `external-install` logs and JSON command
  receipts record exit 0. `validated-inputs.json` fingerprints 1,150 source,
  test, public-documentation, manifest and build-script files; the final input
  verification is recorded separately. Generated outputs are covered by the
  consumer-specific fingerprints, rather than that source inventory.
- `packed-artifacts.json` records the five actual tarball hashes, versions,
  dependencies and complete file lists. `rejected-peers` records the expected
  nonzero npm result for published Kernel/UI `0.2.0` plus candidate Audio
  `0.3.0`. The external consumer used no workspace links or peer bypasses.
- `clock-live-results.json` records 20 trials against public built entries.
  `clock-rendered-results.json` verifies the live report's bundle and inputs
  before and after six native rendering cases; its 36 sampled values pass the
  declared tolerance. It does not measure already-rendered audio before a late
  submission or prove every output frame.
- `audio-public-results.json` includes public input hashes and ten native/DOM
  cases. Its six amplitude cases compare twelve PCM samples. The offline
  harness temporarily reports running readiness during mixer preparation,
  restores native state before rendering and uses actual native nodes/PCM.
- `editor-public-results.json` records eleven error/focus/initialization checks,
  public editor input hashes and 47 actual served HTML/JS/CSS hashes checked
  byte-for-byte against final documentation output. The demo script and styles
  are not replaced. Screenshots show the recovered controls and narrow page.
- `final-native-results.json` and `final-docs-results.json` repeat the broader
  third-delivery acceptance on this build. Their fixture sources and limits
  remain in [third-evidence](../third-evidence/README.md); the new results do not
  overwrite earlier baseline evidence.
- Dependency audit logs retain the zero-production and ten-moderate-development
  findings. `candidate-version-query.json` and `lockfile-comparison.json` retain
  registry identity and the six-workspace-only lockfile change.

Files named `before`, focused task summaries and peer-review snapshots describe
earlier failures or isolated source checks. They are historical inputs to the
repair, not a second final status. In particular, `audio-initial-parallel-timeout.log`
retains the focused timeout; the unchanged suite and final full check passed.
The project automation before/after probe demonstrates a second notification
even though immediate automation leaves the manual base revision unchanged.

## Reproduce the final public probes

Run `npm run check`, `npm run docs:build`, and
`npm run check:external-install -- --keep` from the repository first. Keep built
outputs stable while consumers run. Install or expose Playwright for the runner
process and provide Chromium; the recorded browser is `151.0.7922.173`. No
browser dependency is added to the product packages by these fixtures.

Copy the inert snapshots to a writable directory outside the checkout and
remove their final `.txt` suffix. Set `WEBMUSIC_REPOSITORY` to the checkout and
`WEBMUSIC_ACCEPTANCE_OUTPUT` to that directory. Use a separate output directory
for each group below. The recorded environment exposes Playwright through
`NODE_PATH`; other environments may install it in their runner directory.

1. Copy `clock-live.cjs.txt` and `clock-rendered.cjs.txt`. Run the live script
   first, then the rendered script in the same output directory. The latter
   rejects stale/mismatched bundles or public input files. Both default to
   `/usr/bin/chromium`; live accepts `WEBMUSIC_CHROMIUM`, rendered accepts
   `CHROMIUM_PATH` for a different executable.
2. Copy `audio-entry.ts.txt` as `entry-public.ts` and `audio-run.cjs.txt` as
   `run-public.cjs` into the Audio output directory, then run the latter. It
   resolves public package entries, rejects repository source inputs, and
   accepts `WEBMUSIC_CHROMIUM`.
3. Serve `apps/doc/webmusic/dist` with a static HTTP server. Copy and run
   `editor-run.cjs.txt`, setting `WEBMUSIC_DOCS_URL` to that server's origin.
   This focused runner expects the ordinary root-path `docs:build` output,
   uses the real modular guide for demo acceptance and accepts `CHROMIUM_PATH`.
4. Repeat the shared timing and complete guide/UI Kit flows with the instructions
   in [third-evidence](../third-evidence/README.md), writing new results into
   separate directories. The recorded servers were ports 8766 for artifacts
   and 8767 for the built documentation site.

For the negative peer check, pack the published `@webmusic/kernel@0.2.0` and
`@webmusic/ui@0.2.0`, then install those exact tarballs together with the freshly
packed Audio `0.3.0` tarball in a new private temporary project. Expect
`ERESOLVE` naming Kernel `^0.3.0`; do not use `--force` or `--legacy-peer-deps`.
`verify-packed.py.txt` retains the exact cloud inspection procedure and its
historical artifact paths; adapt those paths to fresh tarballs when reproducing.

These local checks do not publish packages, establish final-commit CI results,
verify a registry consumer of `0.3.0`, or clear the site's public media rights.
