# Unified modular composition — roadmap

Source baseline: `modular-redesign` at `fbb0925` (2026-11-06) and the
[coverage audit](../audits/2026-11-06-modular-coverage-audit.md).
Decision: [DEC-068](../DECISIONS.md#dec-068--modular-composition-is-the-only-composition-model).
Progress: STATUS MOD-15 is the only ledger; this file is the plan and the
per-session briefs. Phase U0 promotes the target model below into
[Modular composition](../design/MODULAR-COMPOSITION.md); after that the design
document, not this plan, owns the contract.

## Goal

Every source, processor, view, analyser and output in Kernel, Score, Audio,
Bridge, UI and React is a module in one composition model. Modules nest by
containment, mount on each other by explicit ports, share one Session clock and
expose the same capabilities through Elements, Headless runtimes and APIs.
The opt-in `composition="modules"` and every legacy discovery path are removed.
The work ships in the unpublished 0.3.0; breaking API changes are allowed and
must be listed in the release notes.

## Target model

### Module roles

| Role | Consumes | Produces | Examples |
|---|---|---|---|
| Session provider | — | `transport` | Outermost player, or outermost Rack/Mixer with no player above |
| Source | `transport` | `source`, plus `audio` or `note` | Score file/document player, Audio clip/document player, playlist queue, microphone, Web MIDI input, note-input UI, metronome |
| Instrument | `note`, `control` | `audio` | Oscillator, soundfont, SpessaSynth, sampler |
| Processor | `audio` or `note`, `control` | `audio` or `note` | Effects, InsertChain slots, transition chains, Bridge render/transcription adapters |
| Modulator | `transport` (optional) | `control` | LFO, envelope, follower, macro, automation |
| Rack (bus) | N × `audio` | `audio` master, channel taps | `score-rack-control`, `audio-mixer`; one neutral Kernel Rack under both |
| Analyzer | `audio`, `note` or `source`; `transport` | observations | Level/spectrum/oscilloscope/transient analysers, Score chord/key/rhythm/interval/scale analysis |
| View | `source`, `transport`; optional document editor | presentation, transport commands | Every Score and Audio view, editors, patch editor |
| Sink | `audio` or `note` | external effect | Speakers/device output, offline render, capture/recording, MIDI out, WAV/MIDI export |

One component may hold several roles: a player is a Session provider (when it is
outermost), a Source and the host of its own InsertChain.

### Port families

All five families are Kernel types with stable ID, direction, multiplicity,
schema version and readiness, as the existing design table requires:

- `audio`: input and output ports with context identity, channel layout and
  latency. Replaces the output-only `AudioOutputPort` and raw input nodes.
- `note`: occurrence-owned note on/off with source identity, pitch unit, named
  time axis and scheduling epoch. Absorbs Score's `SCORE_NOTE_INPUT`.
- `control`: `ParamHandle`/`ParamSurface` and modulation mappings as today.
- `transport`: an interface over the Session (read snapshot, axis, commands
  with committed/superseded/failed outcomes). `ModuleContext.session` becomes
  this interface instead of the concrete class.
- `source`: domain schema ID, coherent snapshot revision and subscription
  (Score, AudioClip, documents). Views and analysis read sources only here.

`ModuleHandle` enumerates ports by family and name. A conformance test kit in
Kernel runs the same lifecycle, identity, readiness and cleanup checks against
every module factory in every package.

### Composition rules

- The outermost Session provider owns the Session; nested providers borrow it
  unless `session="local"`. A standalone player is a Session of one, so there is
  no separate standalone clock path.
- Containment patches defaults: a source routes to the nearest Rack channel or
  sink; a view, analyser, effect or panel binds to the nearest compatible
  provider. Explicit attributes override and never fall back.
- Module IDs come from the DOM `id` when present and are immutable for the
  module's life; generated IDs are only for undeclared members.
- Changing parameters, sound, source data or destination edits a module in
  place; only a scope change rebinds (DEC-065 for every module).
- Offline render and export realize the same module graph in an offline audio
  environment instead of separate render functions.
- Pure data APIs (parsing, loading, offline analysis, conversions) remain plain
  functions; they are inputs to modules, not modules.

### Element grammar (to be fixed in U0)

| Attribute / property | Meaning |
|---|---|
| `id` | Module ID |
| containment | Default patch to the nearest provider |
| `input="#id"` + `port="name"`, `.inputModule` | Explicit signal/source/transport input; replaces `player=` and `source=` |
| `target="#id"`, `.moduleTarget` | Parameter or insert target for effects and panels |
| `slot="channel|master|pre|post"` | Insert placement inside a Rack or player |
| `session="local"` | Independent Session boundary |
| `controls="auto|show|hide"` | Transport visibility only |

Removed: `composition`, `player=` on companions, descendant-Rack selection,
`AudioPlayerConnection`, `.rack`/`.controller` on `score-player`.

## Phases

Order runs coarse to fine: contract, Kernel platform, domain runtimes and their
Elements, companions, Bridge, adapters, references, enforcement. Each phase
names its sessions; a session is one conversation ending in a commit on
`modular-redesign` with `npm run check` passing.

```text
U0 contract ─ U1 Kernel ports ─ U2 Kernel Rack/Session/sinks ─┬─ U3 Score Play ─┬─ U5 Score View+Analyze ─┐
                                                              └─ U4 Audio Play ─┴─ U6 Audio View+Analyze ─┼─ U8 UI+React ─ U9 docs ─ U10 acceptance
                                                                                 U7 Bridge (after U3+U4) ─┘
```

U3 and U4 touch separate packages and can run as parallel sessions in separate
worktrees, as can U5, U6 and U7.

### Ten-round schedule

The owner asked for about ten rounds with a progress report after each. Rounds
run in this order on `modular-redesign`; each ends with its exit evidence,
`npm run check` and an updated MOD-15 row.

| Round | Phases | Result |
|---|---|---|
| 1 | U0 | Single-model contract, decision amendments, template sections |
| 2 | U1 | Five Kernel port families, input/provider helpers, conformance kit |
| 3 | U2 | Neutral Kernel Rack, Session root election and Session-of-one, sinks |
| 4 | U3.1–U3.2 | Score Headless modules, inputs, outputs and legacy runtime removal |
| 5 | U3.3 | Score Play Elements on one path |
| 6 | U4 | Audio Play Headless and Elements |
| 7 | U5–U6 | Score and Audio views and analysis as companions |
| 8 | U7–U8 | Bridge modules, UI Kit and React adapters |
| 9 | U9 | References, demos and site |
| 10 | U10 | Enforcement, acceptance and release preparation |

### U0 — Contract (1 session, documentation only)

- Rewrite [Modular composition](../design/MODULAR-COMPOSITION.md) as the only
  model: roles, five port families with fields, Element grammar, Session-of-one,
  root election (outermost player, else outermost Rack/Mixer), axis-name
  registry (`score-nominal-seconds`, `clip-seconds`, `session-seconds`, …),
  removal list and migration table.
- Review and amend or supersede DEC-011, DEC-016, DEC-017, DEC-018, DEC-029,
  DEC-063 and DEC-065 in [DECISIONS](../DECISIONS.md); expand DEC-068.
- Update [Architecture](../ARCHITECTURE.md),
  [Player binding](../design/PLAYER-BINDING.md), the Score/Audio Play, View and
  Analyze designs, and add a "Ports and composition" section to the component,
  Headless, UIKit and API page templates in `dev/docs/`.
- Decide: whether `LoopPlayer`, `AbPlayer`, `TonePlayer`, `PlayerController`
  and `MidiPlayerController` become Session range/loop features, modules or are
  removed; whether Kernel `/sync` stays public; whether Bridge's legacy sync API
  is removed or wrapped over Session.
- Exit: documentation checks pass; every row of the coverage matrix below has a
  target role and ports.

### U1 — Kernel ports and module contract (2 sessions)

1. Port types for all five families, `ModuleHandle` port enumeration, transport
   interface on `ModuleContext`, standard lifecycle states; move
   `SCORE_NOTE_INPUT`'s contract into the Kernel note family.
2. Element helpers: generic `observeModuleInput(host, family)` under the
   Audio-only `bindModuleAudioInput`; the module conformance kit
   (`checkModuleConformance`, public in `/module` so third-party modules can run
   it). The provider-scope helper moved to U2, where Session election changes
   provider logic.

Exit: Kernel tests for each family, port admission validation (context, axis,
schema), and the conformance kit used by Kernel's own modules.

### U2 — Kernel Rack, Session and sinks (2 sessions)

1. One provider-scope helper for audio environment fallback, Session election,
   `moduleScopeChange` and rebind, shared by every provider Element. Neutral `RackModule`: channels keyed by module ID, master InsertChain,
   `channelInserts`, sends, channel and master taps, mute/solo, nested-Rack
   admission. Session root election and Session-of-one; per-participant
   precision reporting that never claims `shared-anchor` for callback timing.
2. Sink modules: device destination (including output device selection where
   supported), offline render environment (graph realized on an
   `OfflineAudioContext`), audio capture sink, note sink contract for MIDI out.
   `TransportGroup`/`MirrorClockMaster` become Session internals; the public
   `/sync` entry is removed in round 8 together with Bridge's sync family,
   which still imports it.

Exit: MC-05–MC-10 re-run against the neutral Rack; offline render of a two-source
graph with master insert matches the live graph's topology.

### U3 — Score Play (3 sessions)

1. Headless: `ScorePlayerModule` with `note`/`source`/`transport` ports and
   in-place `sound`, `score` and destination changes (closes MOD-13); document
   and editor sources (Score half of MOD-14); stable IDs; `ScoreRackModule` on
   Kernel `RackModule`; instruments as modules; MIDI out as a note sink.
2. Inputs and outputs: Web MIDI input, `NoteInputController`, metronome and
   `ScoreRecorderSession` as note source/sink modules; `renderScoreToBuffer`/
   `renderScoreToWav` over the offline sink; remove legacy `Rack`, `createRack`,
   `RackTransportController` and the U0-retired players.
3. Elements: `score-player` (single path, no `composition`, `.rack`,
   `.controller`), `score-rack-control`, `score-rack-part` as a provider for its
   own inserts and companions, `score-effect` slots, `score-synth-panel` status
   presenter (MOD-14), `score-note-input`, `score-recorder`.

Exit: conformance kit on every Score module; nested Rack, rack-part insert,
reverse nesting under `audio-mixer`, and destination change while playing keep
engines and channel state.

### U4 — Audio Play (3 sessions)

1. Headless: `AudioPlayer` document playback through module output, InsertChain
   and Session with ports independent of clip selection (Audio half of MOD-14);
   `AudioClipPlayer` module handle; `AudioMixer` on Kernel `RackModule` with
   module-ID channels, channel taps and Session root role.
2. Inputs and outputs: `AudioRecorder` as a microphone source in the borrowed
   context plus a capture sink; `AudioPlaylist` as a queue source;
   `renderClipWithEffect`, `renderAudioSequence` and `exportAudioSequenceWav`
   over the offline sink.
3. Elements: `audio-player`, `audio-mixer`, `audio-effect` (slots; no silent
   no-op), `audio-recorder`, `audio-playlist`; remove `AudioPlayerConnection`.

Exit: conformance kit on every Audio module; microphone → effect → analyser;
document playback in a Rack; standalone mixer as Session root.

### U5 — Score View and Analyze (2 sessions)

1. One companion binding over `source` + `transport` replacing both Score
   player-binding implementations; nested discovery; Rack parts expose sources;
   editor documents through the source port; `createTransportClock` rebuilt on
   the transport port.
2. Elements `score-view`, `score-grid-view`, `score-sheet-view`,
   `score-pitch-view` and the four analysis Elements; live chord/key trackers on
   note ports; `react` hooks that read players move to the same binding.

Exit: every view and analysis Element works nested in a player, a Rack part and
by `input`, with the same results as the former `player=` binding.

### U6 — Audio View and Analyze (2 sessions)

1. `audio-view`, `audio-clip-view` and `audio-live-view` on the companion
   binding; live view on the microphone source port.
2. `audio-meter` and the four analysers on audio ports plus transport (reset on
   seek, pause and end); channel taps; headless view models unchanged unless the
   binding requires it.

Exit: analysers on a Score Rack, an Audio mixer channel and a microphone, with
seek resets.

### U7 — Bridge (1–2 sessions)

- Score→Audio render and Audio→Score transcription as processor modules;
  time-axis mappings registered with the Session; one axis vocabulary;
  project plugins on Kernel `RackModule`; legacy `ScoreAudioSync` family removed
  or wrapped per U0; duplicate `SyncLoopRegion` removed.

Exit: a mixed Score/Audio project round-trips through `ModuleProject` with
`note`, `source` and `transport` connections resolved.

### U8 — UI Kit and React (1–2 sessions)

- Patch editor covers all five families with keyboard equivalents; transport and
  status presenters bind structural projections of the transport port; follow
  [Visual design](../design/VISUAL-DESIGN.md).
- React: a module-scope provider mapping to `ModuleContext`, `useModule`/
  `useSession` hooks, `Simple*` components rebuilt as compositions.

### U9 — References and site (2 sessions)

- Every Element, Headless and API page gets "Ports and composition"; remove
  `composition` and `player=` from demos and snippets; parameter catalogs;
  package READMEs; the Bridge modular guide becomes the core composition guide.
  All examples use Arabesque No. 1 per AGENTS.md.

### U10 — Enforcement and acceptance (1–2 sessions)

- `scripts/check-architecture.mjs`: every Element is a module provider or
  consumer and registers through the Kernel helpers; no package redefines a
  port, binding or provider helper. Conformance kit over every exported module.
- MC-01–MC-19 plus new scenarios for the three new port families, sinks and
  companions; browser acceptance under VERIFY-01; dual-Node full gates;
  continue with RELEASE-01.

## Coverage matrix

Every Element, Headless runtime and public API group has a target role, ports
and a phase. U0 corrects this table when it fixes the contract.

### Elements

| Element | Target role | Ports | Phase |
|---|---|---|---|
| `score-player` | Session provider, Source | out audio, note, source, transport | U3 |
| `score-rack-control` | Rack | in audio ×N; out audio master, channel taps | U3 |
| `score-rack-part` | Source (provider for its own inserts/companions) | out audio, note, source | U3 |
| `score-effect` | Processor slot | audio in/out, control | U3 |
| `score-synth-panel` | View of control (attached) or Processor (insert) | control | U3 |
| `score-note-input` | Note source | out note | U3 |
| `score-recorder` | Note sink producing a source | in note; out source | U3 |
| `score-view`, `score-grid-view`, `score-sheet-view`, `score-pitch-view` | View (grid/sheet edit documents) | in source, transport | U5 |
| `score-chord-analysis`, `score-interval-analysis`, `score-rhythm-analysis`, `score-scale-analysis` | Analyzer | in source or note, transport | U5 |
| `audio-player` | Session provider, Source | out audio, source, transport | U4 |
| `audio-mixer` | Rack | in audio ×N; out audio master, channel taps | U4 |
| `audio-effect` | Processor slot | audio in/out, control | U4 |
| `audio-playlist` | Queue source | out source, audio | U4 |
| `audio-recorder` | Microphone source and capture sink | out audio; in audio; out source | U4 |
| `audio-view`, `audio-clip-view` | View (clip view edits documents) | in source, transport | U6 |
| `audio-live-view` | View | in audio | U6 |
| `audio-meter`, `audio-level-analyzer`, `audio-spectrum-analyzer`, `audio-oscilloscope`, `audio-transient-analyzer` | Analyzer | in audio, transport | U6 |

### Headless runtimes

| Runtime | Phase |
|---|---|
| Kernel `ModuleContext`, `ModuleRegistry`, ports, leases, `ModuleCapabilities`, `ParamHandle`/`ParamSurface`/`ParamMacro`/`ParamAudioBus`, `ControlLFO`/`ControlEnvelope`/`EnvelopeFollower` | U1 |
| Kernel `SessionTransport`, `SessionLFO`, session automation, `InsertChain`, `TransitionInsertChain`, `TransportClock`, `TempoClock`, `TransportGroup`, `MirrorClockMaster`, `AnalyserMeter`, `ModuleProjectRuntime`, project editor binding | U2 |
| Score `ScorePlayer`, `ScorePlayerModule`, `ScoreRackModule`, `Rack`, `RackTransportController`, synths (`OscillatorSynth`, `SoundfontSynth`, `SpessaSynthSynth`, `RangeSampler`, backends), `Effect`, `SynthPanelAudioGraph`, EQ/LFO/macro/level-meter/tempo controllers | U3.1 |
| Score `InteractivePlayer`, `NoteInputController`, `Metronome`, `bindMidiInput`, `bindClock`, `ScoreRecorderSession`, `LoopPlayer`, `AbPlayer`, `TonePlayer`, `PlayerController`, `MidiPlayerController`, `playScore*`, `renderScoreTo*` | U3.2 |
| Score `ScoreEditor`, `loadScoreEditor`, document binding | U3.1 (source), U5 (views) |
| Score analysis `createAnalysisSession`, `createAnalysisFollower`, `createTransportClock`, live chord/key trackers, projections | U5 |
| Audio `AudioPlayer`, `AudioClipPlayer`, `BufferEngine`, `MediaEngine`, `ScratchEngine`, `AudioSequenceEngine`, `AudioMixer`, effects (`chainEffects`, `delay`, `filter`, …) | U4.1 |
| Audio `AudioRecorder`, `AudioPlaylist`, `renderClipWithEffect`, `renderAudioSequence`, `exportAudioSequenceWav` | U4.2 |
| Audio `AudioClipEditor`, `AudioTimeline`, waveform/spectrogram/live/meter view models | U6 |
| Bridge sync, render, transcription, mapping, project plugins | U7 |

### Pure data APIs (stay functions)

Score `io` (parsers, loaders, worker client), Score `analyze` reports and
algorithms, Audio `play` decode/load/WAV utilities, Audio `analyze`
(`computeSpectrogram`, `detectTempo`, `trackPitch`, …), Kernel tempo-grid math
and attribute helpers. Each keeps its contract; U9 documents where it feeds a
module (for example a loaded `Score` as a source module's data).

### Adapters

UI Kit presenters (all `@webmusic/ui/*` entries) stay domain-neutral and own no
graph; patch editor, transport and status change in U8. Score and Audio React
entries change in U5 and U8.

## Session brief template

Start each session with this brief, filled in for its phase:

> Continue STATUS MOD-15 phase U*n*.*m* of
> `dev/plans/2026-11-06-unified-modular-composition.md` on `modular-redesign`.
> Read AGENTS.md, DEC-068, the current
> [Modular composition](../design/MODULAR-COMPOSITION.md) contract and the
> phase's row in STATUS. Scope: *(phase bullets)*. Out of scope: other phases.
> Read VISUAL-DESIGN.md before any UI change; use only Arabesque No. 1 for
> examples. Finish with focused tests, the conformance kit where it applies,
> `npm run check`, `npm run docs:build` for site changes, an updated MOD-15 row,
> and a commit.

## Risks

- Breaking every `player=` page at once: U5/U6 migrate Elements and U9 the site
  in the same release; the check in U10 rejects remaining legacy attributes.
- Precision claims: a shared Session does not upgrade media elements, external
  MIDI devices or callback synths; U2 reports each participant's real mode.
- Scope growth: U0 fixes the role and port tables; new roles need a decision.
