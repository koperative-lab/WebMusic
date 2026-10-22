# Changelog

User-facing changes are recorded here. An Unreleased entry describes repository
work and does not establish npm publication, a release tag or a deployment.

## Unreleased

- Prepare the shared `0.3.0` modular release for Kernel, UI Kit, Score, Audio
  and Bridge. Internal package ranges now require `^0.3.0`; published `0.2.0`
  foundations do not contain the new module, Session and patch-editor entries.
- Add opt-in nested player/Rack composition, stable effect chains, shared
  parameter surfaces, occurrence-owned note input, full amplitude envelopes,
  native modulation and Session-relative automation.
- Add versioned project save/restore, missing-plugin recovery and an accessible
  audio/CV patch editor, while applications retain storage and undo ownership.
- Repair advancing-clock automation, borrowed-group mixer gain, pending LFO
  target replacement, post-edit parameter notifications, project serialization
  limits, meter selector lifetimes and editor/demo recovery. See the
  [0.3.0 migration guide](dev/release/0.3.0.md) for adoption and release gates.
- Preserve manual automation takeover in saved project notifications, bound
  completed envelope history, and handle clock advancement and reentrant
  player/Rack/mixer preparation. Explicit attached LFO starts prepare lazy
  instruments. CommonJS entries share Audio model and UI presenter identity;
  older editor completions preserve newer command selections.

- Guard initial automation attachment against reentrant pause/stop/seek and
  mixer preparation against a nested owner replacing its channel.
- Replace unresolved public resources with original MIT-licensed study media,
  with reproducibility and license checks in source and site builds. A scoped
  Expressive Code PostCSS override removes the vulnerable selector-parser chain.
- Keep inherited Audio module leaves from rewriting their provider's Session
  rate and loop. A provider's new destination re-routes Audio leaves and desk
  masters in place, preserving engines, Session membership and channel mixes.
  `<audio-player>.effect` no longer throws while its owned player drives a
  borrowed mix. Module-mode command failures and every failed preparation or
  activation attempt reach `webaudio:error`.
- Expose recovered Session participant readiness after a failed preparation is
  retried, recreate a disposed shared parameter macro on demand, and share one
  module-discovery observer per document or shadow root. Kernel adds
  `moduleScopeChange()`, `sameModuleScope()` and `routeModuleOutput()` for
  domain adapters.
- Demo asset checks pin the WAV the reviewed MP3 was encoded from. `--write`
  refreshes inventories without re-encoding while that WAV is unchanged and
  never installs unreviewed encoder output.

### Earlier source preparation

The following entries retain earlier source-integration work. They are not a
registry inventory or a claim that those changes remain unpublished.

- Integrate Audio and the Score–Audio Bridge into the main source tree, with
  documentation and package checks for all five library packages. This source
  merge does not publish the two additional npm packages.
- Add Audio and Bridge documentation demos. Their initially imported Arabesque
  and SoundFont resources were later replaced or removed; the current public
  asset inventory records the original study and its license.
- Preserve untimed Element note activity and post-render OSMD cancellation;
  avoid replaying the engraving cursor for every forward playback frame.
- Coalesce reentrant Timeline, Status and Minimap text refreshes, and release
  subscriptions returned after a presenter is replaced.

- Add typed text and formatting hooks for application-owned presentation tools,
  with explicit refresh methods and stable controls. Translation, language state
  and change subscriptions remain outside WebMusic.
- Keep borrowed React views responsive to active-note updates when an external
  playback source has no nominal time, including renderers with time support.
- Allow a minimal play/pause Transport binding and mode-specific Meter readers
  without placeholder progress, seek, subscription or spectrum methods.
- Allow React StaffView, PianoRollView and WaterfallView to render an explicit
  Score or borrow a playback source without creating a Player. ScoreViewElement
  accepts a direct playback property alongside its existing selector binding.
- Expose generation-aware presentation readiness and failures through React
  onStateChange and ScoreViewElement renderState / webscore:renderstatechange.
- Complete Mixer, Macro, MacroRack and Recorder cleanup when a subscription,
  child disposer or error callback fails, including reentrant replacement.
- Mark local documentation context as an unreleased development snapshot while
  retaining verified-release checks for publication and release Skill lookups.
- Prepare the first public source and npm release for `@webmusic/kernel`,
  `@webmusic/ui` and `@webmusic/score`.
- Include contributor, security, development and release guidance in the public
  source tree without requiring ignored local agent settings.
- Harden package-consumer, dependency, asset-license and documentation checks
  used during release preparation.
- Preserve Score model identity across CommonJS subpaths and repair strict
  TypeScript consumption of the Element and browser-global entries.
- Include complete bundled dependency notices and font licensing. The original
  Study music and oscillator synthesis remain available for verified demos.
- Upgrade the documentation and test toolchain, add Node 22.22.3/24 CI and
  reject missing or stale package output before packing.
- Adopt Astro's ESLint 3 plugin with ESLint 10 and its supported development
  Node versions, retaining project diagnostics through `astro check`.
- Adopt ESLint 10's JavaScript rules with scoped compatibility exceptions for
  retained release sources; preserve original errors in Agent Toolkit helpers.
- Keep Agent Toolkit release verification stable across development dependency
  updates while retaining runtime source and package contract checks.
- Resolve optional SoundFont and OSMD dependencies in browser production
  builds; require the supported Spessa 4.x API and remove obsolete SoundFont
  inspection documentation.
- Export playback tempos as valid MusicXML sound elements, preserving measure
  timing and preventing OSMD sheet engraving from failing on spanning slurs.
- Track ancestor and alternate tsup configurations when checking package
  freshness before packing.
- Generate production-site notices from bundled modules, styles and embedded
  dependencies, with per-file notice references and integrity checks.
- Retain local documentation search with a built article index and keyboard
  navigation, replacing the Pagefind browser runtime.
- Remove the unused local font and static license copies; keep asset provenance
  in source configuration and embed original-resource licenses in downloads.
- Run quality checks and a documentation build on every branch push and pull
  request; deploy GitHub Pages only from a successful explicit manual dispatch
  on official `main` with `deploy_pages` selected. Deployment permissions remain
  limited to the deploy job.

No published release is asserted by this changelog. Follow the
[publishing procedure](CONTRIBUTING.md#releasing) to verify release identity and
record a versioned release after publication has been confirmed.
