# Reproducing third-delivery acceptance

Run from the repository root after a successful `npm run docs:build`.
Fixtures resolve public built package exports and reject repository source
imports. Do not rebuild packages while a fixture is bundling or running.

Browser runners require Playwright resolvable by Node and Chromium. The recorded
environment uses `/usr/bin/chromium`; the timing runner also accepts
`WEBMUSIC_CHROMIUM`. Use writable output directories outside the checkout for
generated bundles and screenshots.

- `timing-build.cjs` bundles `timing-entry.ts`, `timing-control.ts` and
  `timing-effects.ts`; `timing-run.cjs` runs the real Web Audio comparisons.
  Set `WEBMUSIC_REPOSITORY` to the checkout and `WEBMUSIC_ACCEPTANCE_OUTPUT`
  to the output directory for both commands. Serve that directory and set
  `MODULAR_THIRD_TIMING_URL` to its `modular-third-timing.html` page.
- `modular-third-editor-build.cjs` bundles the structural project/editor
  fixture; `modular-third-editor-run.cjs` verifies keyboard editing, project
  restoration, missing plugins, responsive layout and UI/DSP ownership.
  Copy `modular-third-editor-entry.ts` and `modular-third-editor.html` to the
  output directory first. Set `WEBMUSIC_REPO` to the checkout and
  `WEBMUSIC_ARTIFACTS` to that directory, serve it, and set `WEBMUSIC_EDITOR_URL`
  to its `modular-third-editor.html` page.
- `modular-third-editor-docs-run.cjs` uses the built public modular composition
  guide and UI Kit reference, separately from the fixture's minimal host page.
  Serve `apps/doc/webmusic/dist`, set `WEBMUSIC_PROJECT_DOCS_URL` to
  `/bridge/modular-composition/` on that server, and set `WEBMUSIC_REPO` and
  `WEBMUSIC_ARTIFACTS` as above.

Keep generated build fingerprints with each result. A later package or site
build may change chunk names; rebundle and rerun against the final output.
The [delivery record](../MODULAR-THIRD-DELIVERY.md) owns outcomes and limits.
