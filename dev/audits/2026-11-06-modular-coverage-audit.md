# Modular composition coverage audit — 2026-11-06

## Scope and baseline

A read-only review of whether every source, component and output takes part in
the modular composition of [DEC-063](../DECISIONS.md#dec-063--modular-composition-separates-resources-routing-and-session-authority)
through [DEC-065](../DECISIONS.md#dec-065--provider-scope-changes-separate-in-place-re-routing-from-rebinding),
and whether they nest and mount on each other through one model.

Baseline: `modular-redesign` at `fbb0925`, which contains `dev`, `main`,
`editing-capabilities` and `score-view-directions`. Kernel, Score, Audio, UI
and Bridge sources and the modular demo were read; three parallel static reads
covered Score, Audio, and Kernel/Bridge, and the main findings were rechecked
against source. No build, test, browser or audio run belongs to this record;
"works" below means the code path exists, not that runtime behavior was observed.

The follow-up roadmap is
[Unified modular composition](../plans/2026-11-06-unified-modular-composition.md);
[DEC-068](../DECISIONS.md#dec-068--modular-composition-is-the-only-composition-model)
and STATUS MOD-15 own the resulting decision and work.

## Summary

The Kernel skeleton is sound and recursive: `ModuleContext.derive`, the
capability-based `webmusic-context-request` protocol (no tag names), one
Session writer with a read-only `SessionSchedulingBinding`, `InsertChain`,
route leases and the versioned `ModuleProject`. The documentation demo
composes a Score player, an Audio player, a Rack part and both domains'
effects under one Session and one Rack without importing Bridge.

Only the Play audio graph uses it. Players, Racks/Mixers, effects, synth panels
and Score note input are modular. Views, Score analysis, recorders, the
playlist, Web MIDI input, editor documents, offline render and every output
other than the default destination remain outside it, and the opt-in keeps a
second, legacy composition path alive in every player.

| Target layer | Modular now | Outside the module model |
|---|---|---|
| Sources/inputs | `score-player`, `score-rack-part`, `audio-player` (clip only) | Microphone/`audio-recorder`, `score-recorder`, Web MIDI input, `audio-playlist`, editor documents |
| Components | Effects, synth panels, note input, Rack/Mixer; Audio analysers and meter tap ports through `input`/`port` | All Score and Audio views; Score analysis (selector `player=` only) |
| Outputs | Default route slot and Rack/Mixer admission | No sink concept: MIDI out is a synth backend; offline render and export bypass the graph |
| Kernel clock | One writer per Session | Bridge `ScoreAudioSync` is a parallel master/follower authority |

## Structural findings

1. **Only two of five port families exist.** `ModuleHandle.getPort` returns
   `AudioOutputPort` only (`platform/kernel/src/module/registry.ts:13`); control
   is covered by `ParamHandle`. `note`, `source` and `transport` from the design
   table are absent: note input is the Score-private capability key
   `SCORE_NOTE_INPUT`, `ModuleContext.session` is the concrete `SessionTransport`
   class, and there is no source capability. Project documents accept all five
   kinds, but the runtime realizes only audio; the rest stay unresolved unless
   the caller supplies a connector. There is no audio input port type.
2. **Views and analysis are not companions.** Score views/analysis and Audio
   views bind only through the `player` selector; nested inside a modular player
   or Rack they stay unbound. Rack parts emit no `webscore:*` events, so a view
   cannot follow one part. Tapped Audio analysers report `seconds: 0` forever, so
   seek does not reset their history.
3. **Live input is isolated.** `AudioRecorder` creates its own `AudioContext`
   for each take (`packages/audio/src/play/headless/recorder.ts:134`), so the
   microphone cannot be routed into a mixer, effect or analyser. Web MIDI input
   binds an `InteractivePlayer`, not a note port.
4. **No output modules.** Outputs are the scope's destination resolver or
   speakers. `MidiOutBackend` is a synth. `renderScoreToBuffer`,
   `renderClipWithEffect` and `renderAudioSequence` build separate graphs that
   omit Racks and inserts.
5. **Two composition paths.** Without `composition="modules"`, players use
   descendant-Rack selection and `AudioPlayerConnection` uses
   `closest('audio-player')` (`packages/audio/src/play/element/internal/player-connection.ts:33`)
   — also inside a modular scope, which breaks the rule that both paths never
   run for one instance.

## Behavioral findings

1. **MOD-13 confirmed.** Score player and Rack Elements use `sameModuleScope`
   and rebuild engines and Rack channel state on a destination-only change; Audio
   uses `moduleScopeChange` and re-routes in place.
2. **MOD-14 confirmed.** Audio document playback connects to
   `options.destination ?? context.destination`
   (`packages/audio/src/play/headless/sequence-engine.ts:210`), its ports and
   inserts need a selected clip, and the Element registers a Session participant
   only for a clip. Modular `renderModular` in `score-player` never binds an
   editor document.
3. **Standalone Racks have no Session.** A modular `audio-mixer` or
   `score-rack-control` without a player above derives a context without a
   Session (`packages/audio/src/play/element/audio-mixer.ts:338`); children each
   create their own and are not synchronized.
4. **Identity is not stable.** A Rack part's declaration carries an `id` that is
   not passed to `ScorePlayerModule`
   (`packages/score/src/play/element/score-rack-control.ts:519`), and Mixer
   channels are `audio-player-N`, so `registry.get('bass')` and `solo="lead"`
   cannot address declared members.
5. **Channel inserts and taps are Headless-only.** `channelInserts(id)` has no
   Element target; the `slot="master"` of the design example is not interpreted;
   effects inside a Rack part land on the desk master. Mixers expose only
   `master`/`output` ports.
6. **Silent no-ops.** `.rack` and `.controller` on a modular `score-player` and
   `<audio-effect>` on a legacy page do nothing without an error.
7. **Rebuilds that should be in place.** Changing `.sound` or `.score`, or a
   Rack part's `sound`, disposes and recreates the module, its registration and
   its Session participant.

## Consistency findings

1. Score synths with callback-only attacks still attach Session scheduling, and
   the Session reports `shared-anchor` for callback precision.
2. Bridge registers Audio with axis `audio-clip-seconds`
   (`bridges/score-audio/src/project.ts:88`); the Element uses `clip-seconds`
   (`packages/audio/src/play/element/audio-player.ts:761`).
3. Bridge project rack/bus plugins use Score's `ScoreRackModule` and `Effect`;
   Kernel has no neutral Rack or bus.
4. Neutral logic is duplicated or misplaced: three player-binding
   implementations (Score view, Score analyze, Audio analyze) define their own
   time snapshots; the Kernel-only port-tap helper `bindModuleAudioInput` lives
   in Audio Play; each domain repeats provider fallback and rebind code; Bridge
   redeclares `SyncLoopRegion`.
5. Clock abstractions are layered rather than unified: `TransportClock`,
   `TransportGroup`/`MirrorClockMaster`, `SessionTransport`, `TempoClock`, and
   Score analysis's `createTransportClock` predictor.

## Not established

Reverse nesting (Score inside `audio-mixer`) and an Audio analyser on a real
`score-rack-control` have no automated test. Whether a parent Rack suppresses
grandchild outputs, possible duplicate edges from passing both `destination`
and `routeModuleOutput`, and audible anchor precision need runtime evidence.
