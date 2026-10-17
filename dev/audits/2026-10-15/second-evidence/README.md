# Second-delivery native acceptance evidence

This directory retains the reviewed MOD-09/10 signal fixtures, browser runners
and their dated results. The enclosing audit owns the completion claim. These
fixtures use built public exports; they never alias package source modules.

## Reproduce

Prepare the repository with its supported Node version, `npm ci` and
`npm run build`. Provide Playwright to the Node process and a Chromium executable;
these acceptance tools do not add dependencies to the published packages.
The recorded run used Chromium 151.0.7922.173 and an environment-provided
Playwright installation. Set `NODE_PATH` if that installation is outside normal
Node resolution, and `WEBMUSIC_CHROMIUM` if Chromium is not `/usr/bin/chromium`.

From the repository root, build both fixtures:

```sh
export WEBMUSIC_ACCEPTANCE_OUTPUT=/tmp/webmusic-modular-second
node dev/audits/2026-10-15/second-evidence/build.cjs
```

The builder infers the repository from this directory; `WEBMUSIC_REPOSITORY`
can override that location. Generated bundles, HTML and results go to
`WEBMUSIC_ACCEPTANCE_OUTPUT`, which defaults to the temporary directory above.
It rejects any package-source input and records public-entry/bundle hashes.

Serve the output in a separate terminal, then run each acceptance sequentially:

```sh
python -m http.server 8766 --bind 127.0.0.1 --directory /tmp/webmusic-modular-second
```

```sh
node dev/audits/2026-10-15/second-evidence/offline-run.cjs
node dev/audits/2026-10-15/second-evidence/browser-run.cjs
```

For the public guide, first run `npm run docs:build`, serve
`apps/doc/webmusic/dist` on port 8767 and run `docs-run.cjs` followed by
`panel-docs-run.cjs` from this directory. The independent panel runner verifies
shared ADSR/macro values, the LFO Amount control, automation cancellation and
continued modulation after panel removal. Its results, receipt and screenshots
are retained as `panel-public-demo*` files.
`MODULAR_SECOND_OFFLINE_URL`, `MODULAR_SECOND_BROWSER_URL` and
`MODULAR_SECOND_DOCS_URL` override the runners' local fixture/page URLs.
The public-guide runner uses Chromium's normal autoplay policy and starts the
LFO with a real button click before testing keyboard input.

## What the fixtures establish

The offline suite compares 48 kHz native renders with independent linear ADSR,
constant/CV and automation formulas. Oscillator fixtures use a separate native
reference oscillator/filter to isolate envelope gain. Compressor-ratio fixtures
compare with an independently configured native compressor, detecting intrinsic
minimum/base duplication. The maximum permitted absolute sample error is
`3e-5` for every comparison; it was not relaxed after the follower defect was
found. The default follower fixture allows its declared low-pass settling time.
The separate capability case verifies explicit rejection of unsupported a-rate.

The browser fixtures test native note audio, occurrence ownership and release,
shared parameter/macro/LFO controls, panel removal, automation, first-gesture
context resume and narrow layouts. Results do not establish physical audio-device
latency, background scheduling precision, transport phase locking or third-party
plugin behavior. Those are separate contracts and acceptance tasks.

Result JSON, screenshots and receipts describe the executed build. A rerun
against a different checkout generates new evidence and does not retroactively
change the dated audit.
