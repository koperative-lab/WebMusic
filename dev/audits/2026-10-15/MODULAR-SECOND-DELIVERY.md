# Modular second delivery: sound and modulation

This record covers steps 9–10 (MOD-09/10, MC-16/17) in the local
`modular-redesign` working tree based on `ef8664d`. It extends the uncommitted
[first delivery](MODULAR-FIRST-DELIVERY.md); that earlier record retains its
original scope and measurements. No registry publication or remote push is
implied. The environment is Node 24.19.0, npm 11.9.0 and headless Chromium
151.0.7922.173 on Linux.

## Delivered behavior

- Native instruments implement linear attack, decay, sustain and release.
  Each voice captures its envelope at onset; an early release starts at the
  analytically evaluated current level. Held notes, zero-length stages,
  zero sustain and release exactly at the attack boundary have explicit cases.
- Note input discovers an occurrence-capable target through the module context
  or explicit binding. Occurrence IDs and exact voice handles keep simultaneous
  same-pitch notes independent. Disconnect, rebinding and asynchronous preparation
  cancellation release only notes owned by that input. Manual event routing
  remains available for existing hosts, without duplicate automatic routing.
- Kernel parameter handles own base values, absolute audio-clock automation
  and lazy native CV buses. Current and future voices share a parameter bus;
  intrinsic AudioParam values are compensated so the base is not added twice,
  including native parameters whose minimum is positive. Unsupported rates and
  contexts fail explicitly. Ordinary base-value writes need no CV generator.
- Native LFO, global envelope and envelope follower modules expose control
  signals. Mapping depth uses the target's native units. Macros map normalized
  gestures into explicit parameter ranges. Linear/exponential automation and
  cancel-and-hold operate on the same authoritative base handles.
- Attached Synth Panels borrow shared ADSR, LFO and macro controllers. A panel
  can hide or unmount without stopping target-owned DSP. The first explicit LFO
  Run gesture resumes a suspended context; passive discovery does not prepare
  audio. Pending target readiness waits quietly before capability validation.
- Parameter presenters show the predicted modulation range and an accessible
  description. Effective audio-rate readback remains explicitly unavailable;
  neither a native AudioParam intrinsic value nor an animation-frame estimate
  is presented as a sampled signal value.

The [public composition guide](../../../apps/doc/webmusic/src/content/docs/bridge/modular-composition.mdx)
contains a real instrument, note keyboard, two attached panels, four ADSR
controls, a cutoff LFO, a shared brightness macro and sweep/hold controls.
The neutral parameter machinery also drives native Audio and Score effects.
Callback-only legacy targets retain their declared capabilities.

## Verification

[`npm run check`](second-evidence/full-check.json) passed as one complete command
(exit 0). It includes formatting, lint, architecture and documentation policies,
all five package builds, 254 compiled documentation examples, source/test type
checks, licenses, package verification and release manifests. The workspace
suites passed 358 files and 4,414 tests:

| Workspace | Files | Tests |
| --- | ---: | ---: |
| Kernel | 20 | 275 |
| UI | 36 | 654 |
| Score | 193 | 2,187 |
| Audio | 74 | 885 |
| Bridge | 7 | 182 |
| Documentation | 28 | 231 |

[`npm run docs:build`](second-evidence/docs-build.json) also passed as one
complete command (exit 0), including the five-package rebuild, 113 generated
pages, 111 public search/Markdown references and the site license verification
(74 records, 353 files). The retained
[reproduction instructions](second-evidence/README.md) describe the native
fixtures and public-entry resolution.

The final rebuild changed generated Score chunk names and declaration ordering.
All four native/browser suites were rerun against that final output and passed.
The [entry verification](second-evidence/fingerprint-verification.json) matches
all 11 recorded public entries; the
[site verification](second-evidence/public-build-verification.json) matches
the tested public page and all 134 client JavaScript assets. The
[rebuild comparison](second-evidence/rebuild-comparison.json) preserves the
earlier mismatch and rerun history. Final status/evidence edits were followed
by documentation inventory, public documentation, formatting and diff checks.

### Native signal evidence

[The offline suite](second-evidence/offline-audio.json) passed 28 scenarios at
48 kHz: 667,680 compared frames in
28 windows, maximum absolute sample error `6.853789091109536e-6` against the
unchanged `3e-5` tolerance. Independent formulas/reference graphs cover ADSR,
interrupted and reordered envelope gates, oscillator and sampler voices,
same-pitch release, CV/base accounting, current/future polyphony, native LFO,
macros, automation and the explicit unsupported-rate case.
The [numeric summary](second-evidence/offline-summary.json) and
[public-entry fingerprints](second-evidence/build-fingerprints.json) accompany
the retained fixture and executable runner.

The follower's first implementation exposed native low-frequency DC drift in
the Biquad implementation. A unity-DC one-pole IIR and bounded output preserve
the declared follower behavior; the default 20 Hz, negative-signal and overrange
fixtures pass without relaxing their tolerances. Native signal checks also
caught zero-decay envelope and positive-minimum AudioParam edge cases.

### Browser evidence

[The actual generated guide](second-evidence/public-demo.json) passed with
Chromium's normal autoplay policy.
The first trusted Run click starts the context; keyboard notes produce measured
audio and settle to silence after release. Both panels share macro state,
automation cancel holds its modeled base, hidden panels leave the LFO running,
there is one transport, and the 320px layout has no horizontal page overflow.
Page errors and module errors are empty after the target-readiness repair.
An [independent panel pass](second-evidence/panel-public-demo.json) also checked
all four ADSR controls, shared sustain `0.35`, LFO Amount `300 Hz`, the macro's
`3150 Hz` cutoff base and `3000–3300 Hz` predicted range, followed by automation
hold and actual panel removal. The desktop and narrow screenshots were inspected.
The [raw browser fixture](second-evidence/browser.json) separately verifies that
releasing one of two same-pitch input occurrences leaves the other audible,
and that releasing both settles to silence.

### Documentation generation

The new interactive demo needed an explicit static Markdown renderer entry.
After that correction, full-suite development middleware tests exposed repeated
generation cost. The generator now batches fresh, checked file reads and reuses
only bounded, exact-source MDX syntax trees. It still reads and fingerprints
current files on every generation, rejects symlinks, and regenerates raw imports,
catalogs, origin-specific links and provenance. Regression assertions change
MDX, an imported raw helper and runtime source between generations; an unchanged
importer also rejects a subsequently symlinked helper. Test timeouts and
assertions were not weakened. Earlier failures and the CPU profile are retained
beside the final evidence.
The [complete documentation suite](second-evidence/docs-tests.json) subsequently
passed all 28 files and 231 tests in 23.23 seconds.

The complete Score suite also exposed an existing Analyze test's asynchronous
measurement error: it counted every global AbortController as a new URL load,
although the source adapter and I/O cancellation layer each legitimately create
one. The test now observes the actual URL-loader boundary, verifies one pending
request and its uncancelled signal through presentation changes, then resolves
the request and verifies rendered score duration, chord bands and retained
selection without another load. No
Analyze runtime behavior or test timeout changed.

## Boundaries

ADSR controls affect subsequent note onsets. Only descriptors declaring native
audio-rate support accept CV; compatibility callbacks do not silently acquire
that capability. Macro writes provide best-effort rollback rather than a claim
of atomic DSP transactions. Automation times use the AudioContext clock;
Session seek/loop-relative automation and modulation phase remain step 11.

This evidence establishes the stated Chromium/native signal and interaction
scenarios. Physical-device listening, device latency, cross-browser behavior,
screen-reader acceptance and background scheduling precision remain unmeasured.
Shared-anchor precision and advanced tails/switching remain step 11; versioned
project save/restore and accessible visual patch editing remain step 12.
