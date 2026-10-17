# Release hardening evidence

These records support [the hardening report](../MODULAR-RELEASE-HARDENING.md).
Original failures and final verification remain separate files. `manifest.json`
records retained source paths, byte counts and SHA-256 hashes. Executable probes
and historical prose are copied as inert `.txt` files; remove that final suffix
only in a separate scratch directory when reproducing them.
Raw npm diagnostics that append stderr text to JSON are retained as `.json.txt`
to preserve their original bytes without claiming valid JSON. The first archive
format failure is retained alongside the corrected final documentation check.

## Evidence groups

- `kernel/`: initial attachment pause/stop/seek failures, repaired source and
  final public-entry results, worker/CV lifetime assertions and mixer peer review.
- `routing/`: mixer reentry reproductions, focused tests, native offline PCM
  before/after, final public-entry fingerprints and Kernel peer review.
- `dependencies/`: original audit, upstream/version investigation, exact lock
  changes, clean installs, twenty CSS/code-block comparisons, final audits and
  the npm workspace override diagnostic reproduction.
- `assets/`: original resource metadata and hashes, historical original-study
  lineage, generation checks and native audio decode. Removed binary backups
  and the former score XML are intentionally excluded.
- `assets-peer/`: independent MIDI/XML parsing, FFmpeg audio comparison, the
  forged-MP3 regression, and normal/Pages browser results and screenshots.
- `asset-consumers/`: current reference migration, complex and large-score
  coverage, iteration failures and final focused test receipts.
- `rebuild-peer/`: independent AST/module/source-map comparisons of reordered
  output and renamed chunks, with unchanged native-probe input hashes.
- Root records: integrated command logs/receipts, validated-input fingerprints,
  final stability and evidence archiving scripts.

## Reproduction

Use the report's Node/npm versions and a fresh installation. Run the documented
`npm run check`, `npm run docs:build`, `npm run pages:build`, both audits and
`npm run check:external-install -- --keep`. Shared builds replace `dist/`; do not
run probes against it until the build has finished. `check:demo-assets` requires
the built Score public entry for its format tests. The standalone generator's
`--check` needs neither built packages, FFmpeg nor network access.

The browser probes use Playwright with `/usr/bin/chromium`. Serve the generated
site at the configured base. `browser-assets.cjs.txt` accepts
`WEBMUSIC_DOCS_URL` and `WEBMUSIC_ACCEPTANCE_OUTPUT`; the latter keeps normal and
Pages evidence separate. Runtime probes document their scratch server and
repository paths in their source. Resolve those paths for a new environment.
Do not overwrite the retained original failure files when re-running them.

`validated-inputs.json` includes tracked and non-ignored untracked source,
tests, public docs, scripts, all public assets, the asset manifest, CI and build
configuration. `source-stability.json` compares them after validation. It excludes
generated output and these audit records. This is working-tree evidence, not
a release-commit CI or registry receipt.

`validated-inputs-full-check.json` preserves the complete check's baseline.
`post-check-prose-corrections.json` identifies the only later source differences:
two comment corrections, followed by documentation/snippet checks and site
builds. The first and final external-install receipts are separate because
rebuilding changed some generated chunk names. `final-artifact-stability.json`
compares all final packed files and public-probe inputs with the last build.

Native PCM and decoded-file measurements establish digital signal behavior in
the tested Chromium/FFmpeg versions. Controlled worker/audio fixtures establish
the stated ownership cases; they do not establish device latency, listening
quality, arbitrary callback safety, or cross-browser support.
