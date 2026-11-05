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

- Bring every Web Component in line with the visual design (DEC-059). Recorder,
  playlist, mixer and analyzer controls are one row of SVG icon buttons (names
  in `aria-label`/`title`, pressed inverts ink) instead of glyph or text
  buttons; the oscilloscope trigger edge is a segmented group instead of a
  native select; scrolling regions hide their scrollbars; hint, empty and
  progress prose is visually hidden (errors stay visible); envelope, EQ and LFO
  plots draw on the component surface instead of an inverse box; colour
  fallbacks have dark-scheme pairs. New tokens `--wm-recording` and
  `--wm-playlist-active-foreground`; the note surface's start overlay is
  replaced by a keyboard icon button. Interaction: envelope/EQ drags and
  analyzer probes apply once per frame, `<audio-view>` scrub paints in the same
  frame, zoom keeps its anchor and seek drags seek once per frame, and the
  Score analysis lanes zoom proportionally with Safari pinch support.
- Add `<audio-clip-view>`, a waveform clip editor modeled on audio editors
  such as Adobe Audition: an icon toolbar, a time ruler with markers, channel
  lanes with segment boundaries, draggable fade handles and gain lines, gain
  envelopes, a gain HUD, zero-crossing and time-grid snap, zoom and keyboard
  editing over a borrowed `.editor`. Range amplify, fades (linear, logarithmic,
  cosine) and silence are non-destructive; normalize, reverse, invert and DC
  removal are range processors (`createAudioRangeProcessor` now accepts
  `invert` and `remove-dc`, listed by `AUDIO_RANGE_PROCESSOR_KINDS`). Adds the
  `set-annotations` operation, stateless edit builders in `/view` and
  `AudioClipEditor.processorDescriptors`. **Breaking:** `<audio-view>` is
  read-only — `editable` and its `webaudio:edit*` events are removed, and
  `mountWaveformEditor` is replaced by `mountAudioClip` in `/view/render`.
- Add a document beat grid and a Kernel tempo clock. `@webmusic/kernel/transport`
  gains `TempoGrid` (`createTempoGrid`, `tempoGridPosition`, `snapToTempoGrid`,
  `tempoGridJump`, `tempoGridLines`, `tempoGridMapping`, `tapTempo`) and the
  read-only `TempoClock` (`beatAt`, `nextGridTime`, `timeAtBeat`). Audio
  sequences may carry `beatGrid`, changed by the new `set-beat-grid` operation;
  `AudioPlayer` exposes `tempoGrid` and `tempoClock`, and applies grid- or
  marker-only revisions without pausing. `<audio-clip-view>` adds the `grid`
  feature, the `grid`, `quantize` and `grid-edit` attributes, `beat`/`bar` snap,
  a Grid Edit toolbar (downbeat, BPM, tap, nudge, stretch, ×2/×½, meter, drag),
  quantized ruler seeks and PageUp/PageDown beat jump. The grid subdivides beats
  down to 1/32 as you zoom in; the snap button toggles `snap="grid"` (the finest
  drawn line); the view opens at eight bars or ten seconds instead of the whole
  clip; and zooming repaints once per frame from cached peak bins, with a
  trackpad pinch following the fingers one to one (Safari gestures included).
- Smooth zoom in `<score-grid-view>` and `<score-sheet-view>`. The grid zooms
  in proportion to wheel and pinch deltas, once per frame at the anchored
  scroll position, and reports the zoom when the gesture settles (it used to
  multiply by 1.25 per event). The sheet gains Ctrl/Cmd+wheel and pinch zoom;
  page layout no longer re-engraves to zoom (CSS `zoom` over the engraved
  pages, previewed as a transform while pinching), and flow layout re-breaks
  once a zoom settles.
- Rebuild `<score-sheet-view>` on WebMusic's own engraver: justified systems
  on A4 pages (`layout="page"`) or in a column (`layout="flow"`), `zoom`, and
  player following like the other Views. With a borrowed `.editor` and
  `editable` it edits like a notation program — select notes and rests, move
  pitches (semitone, octave, diatonic, drag), note input mode, durations, dots,
  ties, accidentals and delete-to-rest — through the new `set-pitches`,
  `notes-to-rests`, `tie-notes` and `write-notation` operations. Its renderer
  is `mountScoreSheet` in `/view/render`. **Breaking:** OpenSheetMusicDisplay
  is removed — `renderOSMDStaffVisualizer`, `OSMDStaffOptions`, the React
  `StaffView` `osmd` prop, the element's `OpenSheetMusicDisplay`/`osmd`
  properties and the optional peer.
- Add document-owned editing for Score and Audio as part of View: operations
  and contracts in `/view`, `ScoreEditor`/`AudioClipEditor` in
  `/view/headless` with `loadScoreEditor`/`loadAudioClipEditor`, editors lent
  to players and views through `.editor`, and Audio sequence rendering/WAV
  export in `/play`; revisioned editors with atomic
  commands and bounded undo/redo; playback that pauses and reports the applied document revision;
  note editing on the new `<score-grid-view>` piano-roll grid and waveform
  editing on `<audio-clip-view>`; local Audio processing and WAV export. The
  [editing migration guide](dev/release/EDITING-MIGRATION.md) covers upgrades
  from 0.2.0; no editing release is published.
- Write Score JSON schema v0.2 with `NoteData.velocityOverride`; v0.1 and
  unmarked input remain readable. Audio source-change details are now a
  `kind`-discriminated union that can describe an edited sequence.
- Add browser-only Kernel `observeElementSource`, which resolves a borrowed
  source from an explicit object or a selected element's public property with a
  consumer-supplied type guard; `<score-player>`, `<score-view>`,
  `<score-grid-view>`, `<audio-player>` and `<audio-view>` use it to find their editor.
- Add `<score-grid-view>`, a DAW-style piano-roll grid with piano keys, a bar
  ruler, snap lines and an optional velocity lane. With a borrowed `.editor`
  and `editable`, a toolbar offers select/draw tools, snap, the velocity lane,
  zoom, delete and undo/redo; `tools` chooses which features exist. Its
  renderer is `mountScoreGrid` in `/view/render`. `<score-view>` is read-only:
  it draws a borrowed editor's content but has no `editable`. Score staff
  editing (`createStaffViewEditing`, `mountStaffEditor`) is removed.
- Limit `<score-view>` to `piano-roll`, `staff` and `waterfall`, removing the
  `map` and `thumbnail` types with `for-part`, `cells`, `webscore:seek` and
  `ScoreViewSeekDetail`; draw score annotations only on the staff, so
  `showAnnotations` is now a staff-only option. Headless `createScoreMapView`,
  the UI timeline and the thumbnail renderer remain available.
- Reject non-finite `ScorePlayer` and `AudioPlayer` seeks with `RangeError`;
  resolve `<audio-view player>` to exactly one observed target like the other
  player companions; pad odd-sized WAV `data` chunks; share one Core per format
  across Audio CommonJS entries.
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
