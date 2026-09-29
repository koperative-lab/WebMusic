# Audio View release inertia and spectral stability — 2026-09-25

## Scope and baseline

Follow-up in the local `dev` working tree based on `ae0742a`, preserving the
staged migration and earlier uncommitted repairs. The maintainer reported
spectrogram flicker and requested inertia in both track movement and sound,
with a more continuous DJ-style response. [DEC-028](../../DECISIONS.md) and the
[current Audio View design](../../design/AUDIO-VIEW-COMPONENTS.md) own the accepted
contract.

The previous [scratch audit](AUDIO-VIEW-SCRATCH.md) retains its original
short-grain implementation and recorded results. Its test totals, native PCM
measurements and browser observations do not verify this new audio backend or
release behavior.

## Implementation scope

- Audio Play keeps native sample phase through bounded PCM windows, smooth rate
  changes and crossfades, rather than starting one grain per pointer event.
- Release inertia uses AudioContext time for both accepted position and signed
  audio speed. The session remains active through completion; cancellation,
  re-grabbing, external commands and context suspension invalidate old work.
- View retains the borrowed released session, follows its accepted position and
  can cancel it during later mode/zoom/source/lifecycle changes. Async `src` and
  `peaks-src` replacement cancel immediately; obsolete end failures cannot replace
  a newer owner's state or error.
- Restoring normal playback applies complementary 5 ms fades on its private
  output and the scratch output, without automating shared user volume/pan/effects.
  Buffer scheduling uses AudioContext time; media start remains asynchronous.
- Spectrogram image, region and cursor layers move together. Cached ticks retain
  backing pixels, and stripe replacement preserves overlapping spectral colors
  at fractional DPR and canvas size caps.
- Owning references, parameter notes and demo help describe coast completion,
  stationary behavior and the unchanged positional fallback.

## Verification record

### Automated gates

The final coordinated `npm run check` passed on 2026-09-25: **311 test files and
4,137 tests**. Format, lockfile, lint, architecture, documentation, package builds,
258 declaration-backed snippets, source/test types, package exports, licenses and
release manifests passed. The local log is
`/private/tmp/webmusic-inertia-check.log`.

| Workspace | Files | Tests |
|---|---:|---:|
| Kernel | 13 | 155 |
| Audio | 64 | 807 |
| Score | 161 | 1,969 |
| UI | 55 | 972 |
| Bridge | 7 | 154 |
| Documentation | 11 | 80 |

Relevant regression counts within that total are AudioView dragging 54, scratch
sessions 39, Player lifecycle 21, spectrogram viewport/rendering 24 (13 + 11), and
PCM entry interoperability 2. They cover stationary/released ownership,
re-grabbing, immediate async-source cancellation, superseded failures, private
handoff-envelope ownership and cached spectral painting as well as the earlier
contracts. These are automated checks, not device listening evidence.

### Built CommonJS entry interoperability

After the final package build/check, the root reviewer reran
`/private/tmp/webmusic-scratch-cjs.cjs` successfully. The retained
[reproducer](evidence/audio-inertia-cjs-probe.cjs.txt) creates a clip from the built
root CommonJS entry and passes it to the separately imported Headless player.
It verifies an active session, one scratch source with nonzero increasing PCM,
a bounded window of at most 16,002 samples at 8,000 Hz, and an inactive session
after `end(false)`. This checks actual built-entry PCM interoperability using a
stub AudioContext; it does not establish native playback quality. The retained
script's checkout-specific `root` constant must point to the local built
`packages/audio/dist/` when reproducing it.

### Native output and live-clock probe

The root reviewer ran the retained
[probe](evidence/audio-inertia-native-probe.astro.txt) against the updated source
in Chrome 154 on macOS at 48,000 Hz. The
[output summary](evidence/audio-inertia-native-output.json) records the results.
The fixture is a stereo linear ramp with opposite channel polarity.

For continuous forward and reverse playback, each case retained **one native
source across 13 updates spanning 192 ms**. Between 12 and 200 ms, both directions
had maximum error `1.4899571743054452e-08` against the expected ramp and maximum
adjacent-sample step `1.6689300537109375e-06`. Stereo polarity error was `0`;
absolute tail peak after 310 ms was `0`. Both cases passed, including playback
across the earlier 100 ms observation boundary.

For 280 ms signed speed transitions from `+2`/`-2` toward zero, the measured ramp
slopes decreased in magnitude as follows. Slopes compare 24–40 ms with 216–232 ms;
all values are sample-amplitude change per second.

| Direction | Early slope | Late slope | Tail peak after 320 ms | Result |
|---|---:|---:|---:|---|
| Forward | 0.14784932136535645 | 0.03284588456153867 | 0 | Passed |
| Reverse | -0.14785118401050568 | -0.03284588456153867 | 0 | Passed |

A separate real `AudioContext` probe used an explicitly muted destination and
the public Player session. Both cases were active at release, inactive after
completion and paused afterward. The forward case moved an additional
`0.3937500000000007` clip seconds after release and completed after `0.288` audio
seconds; reverse moved `-0.39375000000000027` seconds and completed after
`0.2933333333333333` audio seconds. The 280 ms model completes on AudioContext
time and is published on the next observation tick.

These probes establish sample continuity, signed speed reduction and live-clock
position/state progression for this fixture. The live output was muted: no
physical-device listening or latency result is claimed.

### Documentation-site build

The final `npm run docs:build` exited with code `0`: **182 pages built and
181 pages indexed**. The local log is
`/private/tmp/webmusic-inertia-docs-build.log`. This result follows the final
package build and automated checks recorded above.

### Browser interaction after the final build

The root reviewer reloaded the documentation page in in-app-browser tab 6 on
macOS after the final build. These are observations of the updated implementation,
separate from the earlier scratch audit.

- Starting paused at `3.199811` seconds, a 90 px leftward waveform drag contributed
  a one-second pointer displacement. The first post-release reading was
  `5.209183`; it settled at `5.319811`, including an additional `1.12` seconds of
  release coast. The player remained paused.
- A 90 px rightward drag then gave a first post-release reading of `3.356002`
  and settled at `3.250367`, still paused. Position continued moving backward
  after release before settling.
- Starting while playing, the first reading after a drag showed **Play**, value
  `0`, at `5.837567` during the coast. A later reading showed **Pause**, value `1`,
  at `17.574367`, confirming that ordinary playback resumed.

After switching to the spectrogram, the reviewer inspected both canvas layers
at two playback positions, including a later cached-stripe replacement:

| Clip position | Both canvas backing sizes | Both canvas left offsets | Parent scroll | Playhead transform |
|---|---|---|---:|---|
| `3.754478` seconds | `1656 × 512` | `-61.903px` | `0` | `translateX(276px)` |
| `178.207811` seconds | `3313 × 512` | `-1092.7px` | `0` | `translateX(276px)` |

Both screenshots showed a complete spectral image without blank sections. The
layers retained matching coordinates after crossing the cached area, and the
playhead remained centered. These two captures do not prove that every rendered
frame is free of flicker; automated tests separately cover cached-backing clears
and sampling-grid stability.

The final player state was paused at `192.207811` seconds. Captured console errors
were an empty array.

### Acceptance limits

The native live-clock probe used a muted destination. No physical-device listening
or latency result is claimed by that probe, the screenshots or the automated
tests. Audible quality on target devices, touch interaction and screen-reader
acceptance remain unverified.
