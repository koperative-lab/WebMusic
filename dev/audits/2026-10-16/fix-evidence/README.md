# Modular repair evidence

These files retain the 2026-10-16 cloud run for the accompanying
[repair record](../MODULAR-REVIEW-FIXES.md). Absolute paths in raw logs, receipts
and probe snapshots identify the machine that executed them; they are historical
evidence, not repository configuration. Product regressions live in the owning
workspace tests linked from the record.

- [Complete check receipt](full-check.json) and [output](full-check.txt): one
  successful `npm run check`, 370 workspace test files / 4,620 tests, with all
  five package builds and the repository source/package/release gates.
- [Native mixer samples](audio-native.json): stereo 48 kHz native graph gain and
  mute recovery. Preparation temporarily shadows only the offline context state;
  native rendering follows after removing that shadow.
- [Interrupted effect fade](effect-interrupted.json): constant unity input stays
  within `2e-6` of unity over the rendered buffer after repeated replacement.
- [Global control envelope](sound-control-envelope-probe.json) and
  [per-voice matrix](sound-envelope-probe.json): zero-stage boundary checks and
  the independent 504-case amplitude envelope matrix.
- [Browser focus checks](editor-focus-browser.json): 19 assertions against
  isolated current-source editor/demo bundles. The result names input hashes;
  the demo's dependency outputs were from the pre-integration build.
- [Documentation build receipt](docs-build.json) and [output](docs-build.txt):
  successful build of 114 pages, including fresh package outputs.
- [Final native acceptance](final-native-results.json): all 11 timing/effect
  cases passed against the rebuilt public entries recorded in
  [build metadata](final-native-build.json), with no browser errors.
- [Final public effect render](public-effect-results.json): the interrupted-fade
  regression also passes using the rebuilt public entry; maximum unity error
  is `9.5367431640625e-7` against a `2e-6` tolerance.
- [Final public-page acceptance](final-project-docs-results.json): playback,
  keyboard editing, project persistence/recovery and narrow layout passed with
  no browser errors. [Consecutive keyboard seeks](public-demo-keyboard-results.json)
  retain focus and playback reaches its natural end.
- [Final hash verification](final-verification.json): the 15 recorded source
  fingerprints, six public entries, native bundle and 43 served client assets
  still match the validated files.

The `.cjs.txt` and `.ts.txt` files retain the exact isolated probe inputs without
adding executable product/test entry points. To repeat a probe in this cloud
checkout, copy its snapshot to a fresh directory outside the repository, remove
the final `.txt` suffix, and adjust its output paths there. Use the repository's
supported Node environment and installed Playwright/Chromium. They deliberately
do not reinstall dependencies or rebuild shared packages. The mixer runner needs
its accompanying `entry.ts`; the effect runner needs its built module served by
a local static server. Native probes do not establish hardware latency.

For rebuilt public-entry scheduling and full public-page behavior, reuse the
[third-delivery fixtures](../../2026-10-15/third-evidence/README.md) with
`WEBMUSIC_REPOSITORY` / `WEBMUSIC_ACCEPTANCE_OUTPUT` and the documented page URL
overrides, writing into a fresh output directory. The final runs recorded above
used the completed documentation build. The public-effect and public-demo-keyboard
snapshots retain the additional targeted probes; their command receipts and
outputs are stored alongside the results.
