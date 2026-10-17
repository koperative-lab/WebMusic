# Release candidate review evidence

These records support the [candidate review](../MODULAR-RELEASE-CANDIDATE-REVIEW.md).
They preserve failing probes and passing controls; there are no repairs in this
pass. `manifest.json` records original artifact paths, byte lengths and SHA-256
hashes. Scripts and per-reviewer prose are inert `.txt` copies. Restore scripts
only in a separate scratch directory and adapt their absolute repository,
consumer and output paths before reproduction. Do not overwrite recorded runs.
Raw JSON without a final newline is retained as `.json.txt`, preserving its
original bytes while keeping it outside maintained-file formatting policy.
The initial archive format failure and corrected archival procedure are retained.

## Evidence groups

- `audio/`: native common-start, effect-factory disposal and lazy-ID collision
  probes, with prepared/facade controls and exact public build inputs.
- `root-cross/`: independently written 440 Hz disposal reproduction and facade
  control; native PCM peak/RMS and release counts.
- `kernel/`: minimal natural-end stop/seek cases and broader exploratory cases;
  independent Mixer versus Session native alignment; prior attachment regression
  recheck and the separately classified async-observer observation.
- `score/`: native ADSR/occurrence/LFO controls, actual modular template sampler
  capability failures and independent Kernel cross-review; focused suite log.
- `elements/`: four-analyzer lifetime/error probes, original exploratory runs,
  ten positive DOM/keyboard cases and inspected desktop/narrow screenshots.
- `project/`: focused suites, five public runtime/factory probes and native PCM
  save/restore, with reviewed source and public bundle hashes.
- `delivery/`: final tarball/evidence/input revalidation, optional-peer isolation,
  combined globals playback and both meter-constructor load-order failures.
- Root records: original starting status, input comparison, isolated Node 22
  installation/full-check receipts, registry/audit attempts and final stability.

## Reproduction and limits

Use the maintained setup commands with a supported Node version and the
committed lockfile. The fresh Node 22 gate used an exact copy of existing tracked
and non-ignored untracked working-tree files in a temporary directory, a fresh
Git metadata directory and `npm ci`; it did not reuse the shared installation
or overwrite shared `dist`. Its receipt records the actual command outcome.

The browser runners use Playwright with `/usr/bin/chromium` and import built
public package entries, or the retained independently installed tarballs. They
reject source aliases where recorded and fingerprint actual inputs. Build before
running them, and coordinate readers because package builds clean `dist`.
Some runners store failed case assertions in JSON while exiting zero; inspect
`passed` and expected/observed fields, not just shell status. The analyzer
negative runner exits one for its sixteen reproduced lifecycle failures.

Compiled scratch bundles/maps, copied demo media and the large pre-existing
working-tree diff are not duplicated here. Input/bundle hashes and original artifact paths are
retained. The original baseline and exact packed artifacts remain linked through
the preceding [hardening evidence](../release-hardening-evidence/README.md).

Native PCM is a digital-rendering measurement. Controlled clocks/workers and
native-shaped fixtures are explicitly identified in their reports. Browser
screenshots and keyboard probes cover named cases, not a full accessibility,
cross-browser, hardware or physical-listening certification. Registry metadata
and authentication reads do not publish anything or validate a release commit.
