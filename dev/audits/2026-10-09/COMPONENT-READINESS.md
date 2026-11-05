# Component readiness and external preparation

## Baseline and scope

Reviewed on `score-view-directions`, based on `705d48e05249260b699377f3d5f9379785d3e504`
plus the existing four-direction Score and AudioView working-tree changes.
Environment: macOS, Node 26.8.1, npm 11.19.0 and the Codex in-app browser.
The browser tooling does not expose its exact engine version.

This follow-up checks all 24 tags in
[the Element policy](../../../scripts/element-composition-policy.mjs), plus their
documentation compositions. It corrects gaps left by the
[earlier feedback pass](../2026-10-08/COMPONENT-FEEDBACK.md) and the subsequent
AudioView-only external-loading repair. The reported page reproduced with
`audio-view` showing `loading` while its `audio-player` still showed `waiting`
during the same external decode. An isolated view test did not cover that
composition.

The scope is required-input readiness, source acquisition, external preparation,
error feedback, attachment/replacement and cleanup. Musical algorithms, ordinary
pause, valid silence and every asynchronous playback command are not collapsed
into one loading flag. A valid view must have the input its particular mode
requires; a data clip alone is not an analyser or a precomputed spectrogram.

## Repairs

- ScorePlayer and AudioPlayer accept caller-owned `loading` flags. Player getters
  and follower notifications combine external preparation with actual native
  loading; clearing a flag cannot hide another pending source request. Existing
  data, playback position and borrowed ownership are preserved.
- AudioPlaylist publishes its selected entry's loading/error, resolved source and
  active-player identity. Headless AudioPlayer forwards readiness synchronously.
  Prefetch of another entry does not mark the selected session busy. Player changes
  do not masquerade as graph-ready `loaded` events.
- All external preparation paths in Element demos now mark the affected owners:
  AudioView, MultibandWaveform, AudioWorkbench, AudioMixer and the Score waterfall
  composition. They clear current flags on settlement and cleanup and reject late
  results. AudioMixer also accepts an external flag without rebuilding its mixer.
- AudioView observes late, upgraded, removed, ambiguous and replaced targets with
  the shared target observer. Old subscriptions cannot restore obsolete input.
  AudioLiveView's demo no longer reinstates its original selector from an old
  player's late `loaded` callback.
- Current owner preparation takes precedence over retained analyser errors.
  Meter tap access and live frame failures show an error instead of a blank or
  waiting surface; a subsequent valid frame restores the drawing. Disconnecting
  AudioLiveView releases its previous analyser reference.
- A valid silent/paused live Score chord source stays settled. Recording or take
  preparation failures remain visible rather than returning to an apparently
  successful idle status; retry clears the previous failure.

## Per-tag review

All rows are source and automated-regression evidence. Browser evidence below
names the specific compositions exercised; this table is not a claim of device
or assistive-technology acceptance.

| Tag | Pending work | Missing input, ready state and failure boundary |
|---|---|---|
| `score-player` | Native source plus external preparation | No score waits; native snapshot publishes current readiness; existing score/time retained |
| `score-rack-control` | Child source requests | Missing members wait; ready strips and failures remain visible |
| `score-rack-part` | Source readiness forwarded to desk | Nonvisual declaration; no independent animation |
| `score-recorder` | Preparing take playback | Idle capture is usable; failed take preparation remains an error until retry |
| `score-note-input` | No asynchronous prerequisite | Local input is immediately ready, including no held notes |
| `score-synth-panel` | No asynchronous configuration prerequisite | Missing required configuration waits; usable envelope/LFO sections stay ready |
| `score-chord-analysis` | Owned source/native owner readiness | Score and live modes distinguish missing input from valid empty/paused/silent analysis |
| `score-interval-analysis` | Owned source/native owner readiness | Meaningful empty result is settled; source failures remain errors |
| `score-scale-analysis` | Owned source/native owner readiness | Valid silence does not become loading; missing input and failures remain distinct |
| `score-rhythm-analysis` | Owned source/native owner readiness | Ready rhythmic content/empty analysis is distinct from a pending source |
| `score-view` | Owned source/native owner readiness | Explicit data retains priority; owner preparation propagates when borrowing |
| `score-pitch-view` | Native owner readiness | Valid no-held-note input remains visible; lost/unresolved owner waits |
| `score-sheet-view` | Own source and asynchronous engraving | Player binding supplies timing only; independent notation is retained during player loading |
| `audio-player` | Native/external/selected-backend readiness | Empty source waits; ready pause is usable; selected backend failure propagates |
| `audio-playlist` | Pending entries; selected entry forwarded to owner | Empty queue/owner waits; prefetch does not hide ready playback; retry clears current error |
| `audio-mixer` | Caller-owned member preparation | Missing members/owner waits; retained mixer/playback survives loading; caller owns external errors |
| `audio-recorder` | Microphone acquisition and context readiness | Idle Record stays usable; startup/capture/audition errors remain visible; late grants cannot restore canceled capture |
| `audio-meter` | Borrowed owner readiness | Missing tap waits; silent valid tap draws zero; source/render failures remain distinct |
| `audio-level-analyzer` | Borrowed owner readiness | Known-empty source waits; valid pause/freeze/silence remains settled |
| `audio-spectrum-analyzer` | Borrowed owner readiness | Pending source takes precedence over a retained old error; current failures remain visible |
| `audio-oscilloscope` | Borrowed owner readiness | Pending source takes precedence over a retained old error; valid silent traces remain settled |
| `audio-transient-analyzer` | Borrowed owner readiness | No transients is a settled observation, not missing data |
| `audio-view` | Owned requests, external preparation, borrowed owner readiness | Readiness is mode-specific; target replacement/late arrival observed; standalone data remains independent |
| `audio-live-view` | Borrowed owner readiness | Missing tap/first frame waits; valid samples and render failure are distinguished; stale demo callbacks removed |

## Verification

Focused regressions exercise real Player Elements and their followers together,
pre-upgrade flags, internal/external overlap, queue failure/retry/prefetch,
reentrant source replacement, late-target discovery, retained data/time,
recorder cancellation and demo navigation. Shared UI Status tests cover loading,
waiting, error and ready semantics, hidden prose, busy state and reduced motion.

The composed-owner regressions live in
[Audio follower readiness](../../../packages/audio/test/analyze/source-readiness-integration.test.ts),
[Score native followers](../../../packages/score/test/analyze/native-player-followers.test.ts),
[Audio player lifecycle](../../../packages/audio/test/play/clip-player-element.test.ts)
and [Score player lifecycle](../../../packages/score/test/play/score-player-lifecycle.test.ts).
Actual demo scripts are exercised by
[Audio view/workbench fixtures](../../../apps/doc/webmusic/test/audio-view-demo-fixture.test.ts),
[Audio mixer preparation](../../../apps/doc/webmusic/test/audio-mixer-demo.test.ts)
and [the waterfall composition](../../../apps/doc/webmusic/test/waterfall-keyboard-demo.test.ts).

With stable rebuilt package output, all 4,546 workspace tests passed (158 Kernel,
714 UI, 2,273 Score, 965 Audio, 182 Bridge and 254 documentation tests).
Format, lockfile, lint, architecture, documentation policy/inventory, site notices,
snippet, source/test typechecks, licenses, package artifacts and release-manifest
checks passed.

The final `npm run check` invocation stopped at the existing development-server
process-tree interruption test: it returned exit code 1 instead of the expected
143. The same test passed earlier in this session, and an isolated
`npm run check:dev-server` rerun passed all 12 tests without changing that test or
its implementation. Every remaining gate was then run separately and passed;
this is not a claim that the final aggregate invocation exited successfully.

`npm run docs:build` passed with 112 pages. The rebuilt preview was restored at
`http://localhost:4324`; browser observations after the rebuild were:

- AudioView's initial decode showed `loading` and `aria-busy="true"` on both its
  player and view. Both returned to ready output, with one waveform canvas.
  The [loading screenshot](evidence/audio-player-view-loading.jpg) shows the two
  four-cell indicators together, without visible placeholder prose.
- Requesting a spectrogram left the already prepared player ready while the view
  showed loading, then drew the spectrum. Parameter Reset restored a waveform and
  cleared the pending state.
- Activating the multiband example and selecting the Right channel showed loading
  only while its drawing was computed, then restored the canvas. The cached player
  remained ready throughout that analysis.
- The mixer and its player both showed loading during member preparation, then
  cleared it. The playlist played and paused a ready queue without re-entering
  waiting or loading; [the ready queue](evidence/audio-playlist-ready.jpg) was
  captured. Pending queue selection, failure, retry and unrelated prefetch are
  established by automated composition regressions, not this cached browser run.
- Navigating back to AudioView repeated the two-owner loading transition. No new
  browser errors or warnings were recorded after the rebuilt preview started.

These checks do not measure microphone/MIDI hardware, audible timing, every
browser engine or screen-reader speech.
