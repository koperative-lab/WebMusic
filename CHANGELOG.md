# Changelog

User-facing changes are recorded here. An Unreleased entry describes repository
work and does not establish npm publication, a release tag or a deployment.

## Unreleased

- Relicense the source tree and its five packages from MIT to the Apache
  License 2.0, with the copyright notice in `NOTICE`. Versions already
  published under MIT keep that license. Contributions now require a
  `Signed-off-by` trailer under the Developer Certificate of Origin 1.1 (`DCO`).

- Place the packages' Components in a graph by their manifests (DEC-081).
  Bridge `/component` adds `ComponentManifest`, `OFFICIAL_COMPONENTS`,
  `projectManifest`, `migrateBufferViews` and manifest-based
  `createComponentElement`, `bindComponentElement` and `fitComponentElement`,
  which replace `createViewElement`, `configureViewElement`,
  `bindViewElement`, `fitViewElement`, `viewWidth`, `SurfaceKind`,
  `SURFACE_PLUGINS` and `surfaceKindOf`. Two components join the five view
  objects: `level` (`<audio-level-analyzer>`) and `clip`
  (`<audio-clip-view>` bound to a named buffer). A `buffer` no longer shows
  its samples; `mountComponent` moves a presented buffer into a `clip`.

- A component without its data still shows itself (DEC-082). Until data
  arrives, `<score-grid-view>`, `<score-sheet-view>` and `<score-view>` draw a
  blank score, `<audio-clip-view>` an empty clip, `<score-pitch-view>` its
  instrument with nothing sounding, the Score analyses an empty lane, and
  `<audio-meter>` and `<audio-live-view>` their display at rest, with the
  waiting indicator over them (a `waiting` part, the stage status, or UI Kit
  Workbench's feedback over its stage) instead of in their place. `.score`,
  `.clip` and `.snapshot` stay `undefined` meanwhile. A Score analysis bound
  through `.inputModule` now analyses that module's score.
- Nine more official components are placed in a graph by manifest: `sheet`,
  `view`, `pitch`, `chords`, `intervals`, `rhythm`, `degrees`, `transients`
  and `live`. `ComponentParameter` gains `choices` for word arguments.
- Players and desks are components in a graph (DEC-084): `player`
  (`<score-player>`), `track` (`<audio-player>`), `rack`
  (`<score-rack-control>`) and `mixer` (`<audio-mixer>`). A placed player
  borrows the graph's Session through the module context its box lends, so its
  transport and the graph's are one; a desk admits each of its four inputs as a
  numbered channel; a player's `source` cord carries its own module to a
  companion. Manifests gain `asset` and the `context` and `admit` port
  bindings; `<audio-mixer>`'s `module` gains `admit(module, port)`.
  `mountComponent` shows each Element as a block and binds it before showing it.
- A component in a graph takes its own settings (DEC-085): `attributes` and
  `style` in its module's config are written to its Element, in Studio and in
  an exported component. An attribute is written only when the Element
  observes it and neither the graph, a box argument nor the manifest's new
  `locked` list owns it; a custom property only under `--wm-` with a value
  that loads nothing. `@webmusic/bridge/component` gains `componentSettings`,
  `settableAttributes`, `withComponentSetting`, `isStyleSetting` and
  `GRAPH_ATTRIBUTES`.
- A `roll` or `sheet` in a graph edits the score its source plays (DEC-086):
  with its `editable` setting on, its box is lent one document made from the
  score of the box its `source` cord comes from, which that box then plays.
  A `ScorePlayer` that follows a Session now applies a document revision
  instead of throwing: its member pauses the Session, which keeps its
  position and schedules the edited timeline from there. `ScorePlayer` gains
  `setSessionRequests`; `ComponentManifest` gains `edits`; `ComponentSurfaces`
  gains `document`. `<score-grid-view>` and `<score-sheet-view>` with a
  `height` attribute keep their toolbar in place and scroll in their viewport.
- A score edited in a graph is saved with the box that plays it (DEC-087):
  the box's exported config holds the Score's JSON, gzipped as base64 text,
  under `document`, and a `score` object or `player` made from such a config
  plays it. The asset is never written. A document now lasts as long as its
  box, not as long as the surfaces. `@webmusic/bridge/component` gains
  `encodeScore`, `decodeScore`, `canSaveScores`, `SAVED_SCORE_FORMAT` and
  `SAVED_SCORE_ENCODING`; `ComponentSurfaces` gains `withDocument`, `revive`,
  `revert`, `forget`, `enter`, `documentState`, `subscribe` and `settled`;
  `ComponentHandle` gains `save()`. Loading a project with a saved score
  needs `DecompressionStream`.
- Every display part answers to shared roles, and a component has a theme
  (DEC-088). A project's `layout.style` holds custom properties for the whole
  presentation; `mountComponent` writes those under `--wm-` whose values load
  nothing on its root, or at `:host` of a defined element, and an interface
  object's `style` on its box. `@webmusic/bridge/component` gains
  `THEME_TOKENS`, `componentTheme`, `withComponentTheme`, `styleSettings`,
  `styleDeclarations` and `applyComponentStyle`. Tokens that ended in a
  literal now pass a shared role first: errors `--wm-danger`, scrims the new
  `--wm-scrim`, a clip's playhead `--wm-playhead`, sounding notes in the grid
  and the sheet `--wm-accent`, range thumbs `--wm-foreground`, tracks and
  subtle surfaces `--wm-surface-muted`, grid lines `--wm-border`, secondary
  marks `--wm-foreground-muted`. Defaults are unchanged; a page that sets
  those roles now restyles these parts too.
- Whose style is shown is chosen (DEC-090): a box with `styling: 'inherit'`
  in its config sets its own style aside for its component's theme, and a
  component mounted with `styling: 'inherit'`, or defined and given
  `styling="inherit"`, sets its theme and its boxes' styles aside for those
  of what holds it. `@webmusic/bridge/component` gains `styleSource`,
  `withStyleSource`, `ownStyle` and `StyleSource`; `ComponentHandle` gains
  `setStyling`. The default, `own`, is unchanged.
- `keepComponentSessionPreloaded` asks again while a member's document is
  still being applied, instead of reporting it: a player whose score a view
  edits no longer logs a failed preload when the graph is built (DEC-091).
- An app is designed as a web page (DEC-092). A project's `layout.page`
  holds a host's own tree of where its modules sit, kept by Kernel as plain
  data. `mountComponent` gains `place`: given, it draws no frame, transport
  or stage, puts each shown box's Element in the element the host returns
  for its record, and writes the theme on the host.
- Two more: `recorder` (`<score-recorder>`, recording the notes cabled to it)
  and `panel` (`<score-synth-panel>`, editing the player its cord comes from).
  `mountComponent` now preloads the Session it owns as members join (DEC-069),
  so a placed player's parameters exist before the first play;
  `keepComponentSessionPreloaded` does the same for a host with its own runtime.
- The last three: `wave` (`<audio-view>`, a named buffer's waveform), `take`
  (`<audio-recorder>`, each take written to a named buffer) and `playlist`
  (`<audio-playlist>`, its asset entries queued through the `track` cabled to
  it). `track` gains a `source` output. Manifests gain the `player` binding,
  `scope`, the `entries` asset kind and buffer uses `'clip'` and `'take'`.
  `<audio-playlist>` in a lent scope that is not a player's plays into that
  scope's destination on its AudioContext. `<audio-view>` draws an empty
  waveform under the waiting indicator until its audio arrives (DEC-082).
  `mountComponent` gives a component's natural width to its box, which the
  Element fills.
- An app holds the user's own components as it holds official ones (DEC-093).
  Bridge `/component` adds `componentPorts`, which reads the ports of an
  official component and of one made of objects alike.
- A component made of objects meets the same contract as an official one
  (DEC-089). Kernel adds the edge objects `inlet.note`, `outlet.note`,
  `inlet.source` and `outlet.source`, `SourceRelay` and `sourceOrigin`, and the
  project instance members `sourceOutput` and `connectSource`; the runtime
  carries a source cord through them. Bridge adds `componentContents`, and
  `mountComponent` shows a nested component set to show its contents as a
  framed cell, its official components included. The declarations are placed:
  `effect`, `audio-effect` and `part` (in a desk of its own, through a
  manifest's `container`). `eq` takes an `effects` list and plays it before
  its EQ; manifests gain list parameters and `configure`.
- `wave` follows the `track` cabled to it (its playhead, and its audio when it
  names no buffer) and draws a spectrogram the host computes. `eq` places
  `<score-synth-panel>` in insert mode with its EQ section. Manifests gain the
  `owner` and `insert` port bindings and `spectrogram`.

- A box sizes what it holds (DEC-080). UI Kit controls accept `fill` and take
  their host's whole size; `mountSlider` accepts `orientation: 'auto'`;
  `createKnob` accepts `gesture: 'drag'` and `dragDistance`, and `mountDial`
  now turns by dragging up or down instead of by the pointer's angle. The
  Bridge adds `controlSize`, `viewWidth` and `fitViewElement`;
  `mountObjectControl` fills its host, and `mountComponent` gives an unsized
  control its natural size (it was a 160 × 60 cell) and makes a view in a
  resized box as tall as the box.

- Watch, script, extend and export components (DEC-078). `ModuleProjectRuntime`
  adds `observe` (each message and note before it crosses a cord) and
  `probeSignal`; message clocks can `hold`, `resume` and `step`, and
  `MessageDebugger` sets trace and break watchpoints. Editor cords carry
  `recordId`. Kernel `/objects` adds `ScriptSandbox` and the `js` object, and
  `/module` adds `wamPlugin` for Web Audio Modules 2.0. The Bridge gains
  `@webmusic/bridge/component` (optional peer `@webmusic/ui`):
  `createComponentPlugins`, the view objects `webmusic.surface.*`,
  `mountObjectControl`, `resolveComponentAsset`, `mountComponent`,
  `defineComponentElement` and the export generators `componentModuleSource`,
  `componentPageSource` and `componentResources`.

- Add musical time, devices, voices, buffers and channels to components
  (DEC-077). Projects may carry a Session `tempo`; objects read bars, beats and
  ticks through `MUSICAL_TIME`, and `metro` and `makenote` accept note values
  such as `4n` and `8nt`; a note-value `metro` locks to the beat. Kernel adds `VoiceAllocator`,
  `poly` and `voice`, `multichannelPlugin` with `mc.pack` and `mc.unpack`, an
  OSC codec with `oscin` and `oscout`, `transport`, `makenote`, `gamepad`, `hid`
  and, in `/processor-worklet`, `createSpectralFrame`, `createFFT` and
  `hannWindow`. Score adds MPE pitch, pressure and sysex input, `MidiClockSource`,
  `MidiClockSink`, `MidiMessageSink` and MIDI device objects (`createMidiPlugins`,
  `MidiAccessSource`). Audio adds `SharedBuffers` with the `buffer`, `groove`,
  `record` and `adc` objects (`createSamplerPlugins`) and
  `renderAudioClipEditor`. Message text made of one unquoted word is now that
  selector (`stop`), not `symbol stop`.

- Nest components and organize them (DEC-076): a `component` object owns a
  child context reached through `inlet`, `outlet`, `inlet~` and `outlet~`;
  project layouts gain presentation positions, comments and groups, and
  projects control mappings. Kernel adds `PresetBank`, `ControlMappings` and
  the `preset` and `nodes` objects, Score `MidiControlSource`, and UI Kit
  `mountPresetGrid`, `mountNodes` and `mountMappingOverlay`.
- Add messages, objects and controls (DEC-075). Kernel gains a sixth port
  family, `message`: typed atoms with an optional logical time, delivered
  synchronously and depth first, with message clocks for timed events and
  message cords to parameters. The new `/objects` entry ships Max-style objects
  as project plugins — `metro`, `delay`, `pipe`, `line`, `loadbang`, `counter`,
  `select`, `route`, `gate`, `switch`, `trigger`, `pack`, `unpack`, `expr`,
  `scale`, `random`, `print`, `sig`, `ramp` and ten interface objects — and
  project module instances may now implement `activate()`, called once their
  graph commits. UI Kit gains `/controls`: `mountButton`, `mountToggle`,
  `mountNumber`, `mountSlider`, `mountDial`, `mountMessage`, `mountMenu`,
  `mountTabs`, `mountMultislider` and `mountMatrix`. The kit's fader and knob
  take an optional `formatValue`.
- Add the Kernel `/processor` and `/processor-worklet` entries for authored
  DSP: shared processor definitions, per-context `AudioWorklet` preparation and
  an audio-thread authoring kit. `createProcessorModule` exposes a prepared
  processor as typed audio ports and a parameter surface, and
  `processorEffect` uses it as an insert in any effect chain, live or offline.
  Processors with note input play notes on their exact sample, follow their
  Session through seek, pause and loop, and can read its position.
  `createProcessorInstrument` plays one directly on the audio clock, and
  Score's `Sound.processor` makes it an instrument for any player or Rack
  channel. A reference polyphonic processor in the documentation source shows
  how to write one. `processorPlugin` saves and restores processors in module
  projects; a processor that cannot be loaded stays an unresolved record
  instead of failing the restore, and a plugin factory can now report any
  module unavailable with `ProjectModuleUnavailableError`. A new "Write a
  processor" guide walks through authoring one, and Score's `Effect.from`
  lets a Kernel effect recipe such as `processorEffect` go wherever Score takes
  an `Effect`. Processors can run WebAssembly compiled during preparation and,
  on cross-origin isolated pages, stream to the main thread through a shared
  ring; `processorCapabilities()` reports what the page allows.
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
  with reproducibility and license checks in source and site builds.
- Render the documentation site in its own page shell instead of Starlight:
  section tabs, a section navigation, a contents column, a search dialog and
  monochrome code frames, light only (DEC-070). Content and URLs are unchanged;
  Starlight, Expressive Code and their PostCSS override leave the tree.
- Give `Effect.distortion` live `drive`, `wet` and `dry` parameters and
  `Effect.bitcrusher` live `wet` and `dry` (`<score-effect drive>` included);
  defaults keep the previous sound. A single `<score-effect>` or `<audio-effect>`
  titles its panel by its type. `SectionPanelHandle.describe()` gives a section
  a description for assistive technology only, which `<score-synth-panel>` now
  uses instead of visible notes. The transport's surface seek draws the square
  thumb, and `<score-player>`'s time readout uses the mono face of
  `<audio-player>`.
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
