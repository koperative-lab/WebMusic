# audio/play Web Component Expansion Plan

> **Historical snapshot, not the current work queue. Organized 2026-09-05.**
> This file preserves the original plan, source judgments, review evidence and
> subsequent implementation notes. Counts, branch descriptions, phases and
> statements about what is "current" belong to the dates recorded in the text;
> they do not define today's rules or unfinished work.
> Current work lives in [STATUS.md](../STATUS.md), accepted design in
> [DECISIONS.md](../DECISIONS.md), and document ownership in
> [DOCUMENTATION-MAP.md](../DOCUMENTATION-MAP.md).
> Use [COMPONENT-DESIGN.md](../design/COMPONENT-DESIGN.md) for new component designs;
> do not execute the old phase list directly.

## Implementation boundary addendum — 2026-09-05

The original claims that the player has no public `setLoop` and that
`preserves-pitch` cannot change at runtime describe an earlier implementation.
[AudioClipPlayer](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/packages/audio/src/play/headless/player.ts) now exposes
`setLoop()` and `setPreservesPitch()`;
[audio-clip-player](https://github.com/mrsteamedbun/WebMusic/blob/f074cd8b5f7cdf8f288c77d988384a359c873cfb/packages/audio/src/play/element/audio-clip-player.ts)
forwards the corresponding attributes to its existing player. These
prerequisites are complete and should not be implemented again from the old
phase list. Buffer-engine rate changes transpose pitch; the existing
pitch-preservation setter does not promise time stretching on that engine.

The original four-item presenter checklist and "package-policy does not
change" statement are historical, not the current expansion procedure.
Follow [ARCHITECTURE.md](../ARCHITECTURE.md) and
[DEVELOPMENT.md](../DEVELOPMENT.md) for current policy and verification.

**Reliable scope:** the corrections record the outcomes for the player,
recorder, mixer, meter and playlist. Other standalone controls remain
historical proposals; a completed underlying prerequisite does not establish
that its proposed standalone component was also published.

<!-- docs:historical-body -->

---

> Goal: align with score/play (3 groups, 19 elements), score/analyze (4 groups,
> 16 elements), and score/view (3 groups, 14 elements). The compliance standard
> is the same as before (ARCHITECTURE.md:196):
>
> ```
> domain Headless object + @webmusic/ui presenter
>                   composed by the concrete Element class
>                               = domain Web Component
> ```
>
> This plan expands **4 existing elements -> 15 elements in 4 categories**
> (1 retained, 3 repaired, and 11 added). All 14 additions or repairs were
> independently verified against the source. No proposal was rejected in this
> round because the anti-padding standard established by the previous two plans
> was applied during design.

---

## 0. Two Rules Specific to the audio Family

1. **Optional peer documentation**: whenever a capability depends on a guarded
   dynamic import (the four WASM decoders mpg123/flac/ogg-vorbis/opus, or
   music-metadata), the element specification must describe the fallback when
   that peer is absent. A verified counterexample to avoid: signalsmith-stretch
   and @soundtouchjs/audio-worklet are declared peers but have **no references**
   (around package.json:278 and zero imports under src). No element may promise
   time stretching.
2. **Cross-family boundary**: symbolic-domain work (note input and synth panels)
   is not mirrored. Genuine audio-domain work (transport, playlists, mixing,
   devices, and recording) should be mirrored. The justification for a mirror is
   the **package boundary plus declarative audio target binding**, not a claim
   that the score version cannot do it (score's xy-control is already a
   domain-neutral callback shell).

## 1. Current State and Foundation Problems

There are four elements today: `<audio-clip-player>`,
`<audio-clip-recorder>` (its source file is currently audio-recorder.ts, so
the tag and filename disagree and must be aligned during the repair),
`<audio-meter>`, and `<audio-mixer>`. audio-meter is the family reference
implementation (WebMusicElement plus protected hooks); the other three still
extend HTMLElementBase and need to migrate.

**Important unused capabilities**: much of the engine surface has no element
surface. Examples include `setPan` (present in headless, absent from the UI),
sample-accurate scheduled starts through `play(when)` plus the transport clock
(recently merged, and required for the bridge's declarative-follow roadmap),
dual-engine A-B looping (`setLoop` exists on the engines, but the player does
not expose it; changing the element's loop attribute rebuilds the entire player
and loses position), `AudioClip.regions`/`BeatGrid` (regionenter and
regionleave are emitted, but nothing displays them), `ClipEditSession` (complete
cut/fade/normalize engine with no UI), and `createDecoderWorker` (offline
decoding with no element consumer).

On the UI side, score/play wraps transport, playlist, device, parameter, and EQ
presenters. **audio/play wraps none of those except transport, meter, mixer, and
recorder.**

---

## 2. Target Categories and Element Inventory (15 Elements)

### Category A - Clip Playback & Transport - 4 Elements

> Responsibility: play an audio clip and control how it plays: transport,
> seeking, queuing, rate, and a draggable waveform surface.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-clip-player>` | Repair | `AudioClipPlayer` available | `mountTransport` available | M |
| `<audio-playlist>` | Add | **New** `createAudioPlaylistController` | `mountPlaylist` available (first audio consumer) | M |
| `<audio-rate-control>` | Add | `setRate` available + **new** approximately 10-line `setPreservesPitch` | `mountParameterRack` available (first audio consumer) | S |
| `<audio-waveform-player>` | Add | `AudioClipPlayer` available + injected or locally computed peaks | **New** `mountWaveformTrack` | L |

**`<audio-clip-player>` repair** (contract foundation):

1. Migrate to WebMusicElement and protected hooks, using audio-meter as the
   template.
2. Add `pan` (the engine supports setPan but no surface exposes it) and
   `preload` attributes; expose an element-level `clock` getter and forward
   `play(when?)`. These are prerequisites for the bridge roadmap in which a
   declarative `<score-view>` follows the audio player.
3. **Verified correction:** the `webaudio:seek` contract already exists.
   `<audio-view>` already emits `{seconds, region?}`
   (audio-view.ts:545-551, with tests). User-seek events must adopt and extend
   that shape to `{seconds, region?, progress?}`, rather than introduce a
   competing `{seconds, progress}` payload.
4. **Decoding fallback defect found during verification:** the element never
   passes an AudioContext to `loadClipFromUrl`, leaving the native
   decodeAudioData tier in decode.ts dormant. Without a WASM peer, even an MP3
   that the browser could decode natively currently produces an install-package
   error. Fix this by passing the context from the element.
5. `webaudio:error` is already dispatched but missing from the header's event
   documentation. Document it, remove the obsolete promise of an "inline
   mini-waveform," and point to `<audio-waveform-player>`.

**`<audio-playlist>`** (the third cardinality: one clip = clip-player, N at
once = mixer, N in sequence = this element):

- **Correction found during implementation:** score has no
  `<playlist-player>`. score/play/element holds exactly note-input,
  rack-control, score-recorder, simple-score-player and synth-panel, and
  score/play/headless has no queue either, so this element is not a mirror of
  anything. Its justification is the missing cardinality itself.
- **Implementation correction:** `AudioClipPlayer.clip` is `readonly` and bound
  at construction, so a queue cannot reuse "one internal AudioClipPlayer"
  across entries. The controller owns one AudioContext and builds a new player
  per entry, disposing it on the way out — dispose closes only a context the
  player created itself, so the shared one survives. This also repairs the
  resource defect that N stacked player tags mint N AudioContexts against a
  browser cap of roughly six.
- Add a controller with ordered entries `{id, label, clip|src, streaming?}`,
  end-event advancement, and prefetching for the next item (prefetch covers
  fetch and decode, not the per-entry audio graph).
- **Layering correction:** headless may not import play/api, so loading is
  injected — the same shape the media engine uses for its adapter factory.
  The element supplies `loadClipFromUrl`.
- `loop-list` must be implemented at the controller level. A looping track
  player never emits end, so the list-loop setting must not be forwarded to the
  individual player.
- Disambiguate events: `webaudio:end` already means "single track ended." Use
  `webaudio:trackchange {id}` and `webaudio:playlistend` instead of reusing
  end.
- `PlaylistBinding` requires `snapshot()`; state this in the specification.
- Peer behavior is inherited from `loadClipFromUrl` and its four decoders.
  Streaming entries use the media engine and require no decoding.

**`<audio-rate-control>`** (turn a property-only capability into visible
controls):

- Provide a 0.25-4 rate knob and a preserves-pitch selector. Borrow the target
  through `.player`, following audio-meter's `.analyser` borrowing idiom.
- `preserves-pitch` **cannot currently change at runtime** because MediaEngine
  fixes it in a private construction-time field. Add an approximately 10-line
  `setPreservesPitch`. It takes effect immediately in the media engine and is a
  documented no-op in the buffer engine, whose playbackRate inherently changes
  pitch.
- Document honestly that the buffer engine changes pitch whenever it changes
  speed. This element **does not promise time stretching** because the declared
  peer is not wired (see Section 0).

**`<audio-waveform-player>`** (the waveform is the transport surface):

- The seek track is a real waveform, and clicking or dragging scrubs it. This
  fills the custom-track hook intentionally left open by
  `mountTransport({seek:false})`.
- **Boundary correction from verification:** audio-view is not passive; it
  already supports click-to-seek, keyboard input, and `role=slider`. The actual
  boundary is: audio-view is a bindable visualization surface with zoom,
  scrolling, regions, spectrum, and an external player; this element is a
  self-contained transport with its own player, play/pause controls, time
  readout, and drag-to-scrub behavior.
- **Peak-source correction:** play cannot import analyze or view under the
  `play:["core"]` policy matrix. However, view has the same constraint and
  contains an 88-line local `computeClipPeaks` explicitly documented as
  "intentionally local." The same precedent applies here: prefer injected
  `.peaks` or `peaks-src` (BBC JSON, supported by core), then compute peaks
  locally from `AudioClip.channels()` (a core API). With no peaks, degrade to a
  normal seek bar, equivalent to clip-player.
- Add the domain-neutral `mountWaveformTrack` presenter to UI through all
  standard integration points. It consumes normalized `{min,max}[]` columns
  plus progress and contains no audio types.

### Category B - Timeline, Regions & Clip Intelligence - 3 Elements

> Responsibility: show where playback is and what the clip contains through a
> proportionally seekable timeline, A-B loop editing, and clip inspection.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-clip-timeline>` | Add | Pure mapping of regions/BeatGrid/timeupdate, all available | `mountTimeline` available (first audio consumer) | S |
| `<audio-loop-editor>` | Add | Engine `setLoop` available + **new** player forwarding | Extend timeline with `setLoop` and drag handles | M |
| `<audio-clip-inspector>` | Add | Clip metadata and format probing available | `mountInspector` available (first audio consumer) | S |

**`<audio-clip-timeline>`** (a clip map, approximately 50 lines of pure
mapping, analogous to analyze's `<analysis-timeline>`):

- Display regions and markers as clickable overlays, BeatGrid boundaries as
  domain ticks, an active playhead, a read-only loop range, and click-to-seek.
- Seek details use the established `{seconds, region?}` shape, including
  region when the target lies inside one.
- The player has **no public loop getter**. Read the loop overlay from the bound
  `<audio-clip-player>` element's loop attribute through `parseLoopAttr`.

**`<audio-loop-editor>`** (draggable A-B loop handles; its contract differs
from clip-timeline through **editing versus display**):

- Both engines fully support looping: BufferEngine has native seamless
  loopStart/End and can re-anchor while running, while MediaEngine polls and
  guards the range. No presenter can currently edit a loop.
- Add the necessary small headless increment:
  `AudioClipPlayer.setLoop` forwarding. Loop is currently only a construction
  option, and changing the element attribute rebuilds the player and loses its
  position. That limitation strengthens the case for this element because live
  loop editing is currently impossible.
- Add optional `TimelineBinding.setLoop(start,end)` and two pointer-capture
  drag handles to ui/timeline. Accessibility must follow local conventions:
  regions are real buttons and seeking uses a hidden range, so the handles need
  keyboard adjustment.

**`<audio-clip-inspector>`** (a developer-facing clip fact table, using the
129-line `<sound-font>` as its template):

- Tabs: Summary (duration, channels, sample rate, frame count, and engine
  suitability), Format, and Metadata.
- The Format tab is asymmetric. A decoded clip does not retain the original
  bytes, so an element using `src` probes magic bytes from its fetched
  ArrayBuffer. A `.clip` path falls back from `metadata.format` to extension
  to unknown; document this explicitly.
- Metadata currently maps only title, artist, and album through `readMetadata`.
  Its music-metadata import is guarded and absence silently yields undefined.
  Either accept those three rows or define a separate small expansion item.

### Category C - Recording & Input - 3 Elements

> Responsibility: bring audio into the system through microphone capture and
> export, input-device selection, and file ingestion. This mirrors the score
> family's "MIDI and note input" group in the audio domain.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-clip-recorder>` | Repair | `AudioRecorder` available | `mountRecorder` available | M |
| `<audio-input-picker>` | Add | **New** device-enumeration controller | `mountDevice` available (minor configurable-copy change) | M |
| `<audio-clip-dropzone>` | Add | `loadClip`/decoder worker available | **New** `mountDropZone` | M |

**`<audio-clip-recorder>` repair**:

- Rename the file, class, and define function to match the tag
  (audio-recorder.ts -> audio-clip-recorder.ts), retaining a deprecated alias.
  Migrate to WebMusicElement. Add `device-id`, `quality`, and `caps`
  attributes; headless has accepted deviceId from the beginning, while the
  element currently has no observedAttributes. Fully connect take playback and
  WAV export through `clipToWav` in play/api/export.ts:20.
- Converting `max-seconds` to maxRecordedFrames requires the construction-time
  sample rate, but the real context's sample rate is not known until `start()`.
  Use a `sample-rate` attribute for the conversion or document the 48000
  default.

**`<audio-input-picker>`** (a microphone selector; headless has accepted
deviceId for years, but the repository has no selection UI):

- Add a controller for enumeration, `devicechange` hot-plugging, optional
  permission warm-up, and fallback when mediaDevices is unavailable. Reuse
  `mountDevice`, as the score MIDI selector does, with a small change that
  makes its copy configurable.
- Emit `webaudio:deviceselect {deviceId}`. Explicitly include forwarding a new
  `device-id` attribute on `<audio-clip-recorder>` (described above);
  otherwise the pairing story is incomplete.

**`<audio-clip-dropzone>`** (declarative file ingestion that produces a clip
like the recorder):

- Decode a dropped or selected file to AudioClip. The `worker` attribute uses
  `createDecoderWorker`, making this the decoder worker's first element
  consumer. Add `accept` and `metadata` attributes.
- Do **not** emit `webaudio:loaded {clip}`. clip-player already owns that event
  name with a `{duration}` detail. The recorder's output idiom is
  `webaudio:recorded {clip}`. Use and document a new name, preferably
  `webaudio:clip {clip}`.
- Worker mode and the native decodeAudioData fallback are mutually exclusive
  because a Worker has no AudioContext. Compressed formats still require a WASM
  peer in worker mode; state this in the specification.

### Category D - Mixing, Effects & Metering - 5 Elements

> Responsibility: shape and observe signals through clock-aligned multitrack
> mixing, effect parameters, EQ, a two-axis performance surface, and level
> monitoring.

| Element | Status | Engine | Presenter | Effort |
| --- | --- | --- | --- | --- |
| `<audio-mixer>` | Repair | `AudioMixer` available | `mountMixer` available | S |
| `<audio-meter>` | Retain | Kernel meter available | `mountMeter` available | - |
| `<audio-effect-rack>` | Add | **New** effect-parameter capture controller | `mountParameterRack` available | M |
| `<audio-eq>` | Add | **Hoist kernel/eq** for both families | `mountEq` available | M |
| `<audio-xy-pad>` | Add | **New** target-resolution binding shared with effect-rack | `mountXy` available | M |

**`<audio-mixer>` repair** (S): update the header event table, migrate to
WebMusicElement, and extend the browser global pin by two lines. Verification
also found that the element subscribes only to end/memberEnd and **omits the
headless mixer's own error event** (seek-restart failure, mixer.ts:147-149).
Forward `mixer.on('error')` so the newly documented `webaudio:error` really
covers transport failure.

**`<audio-meter>` boundary decision** (document in both families):
audio-meter is the canonical signal-domain monitoring implementation. score's
level-meter is a convenience surface in the score family over the same kernel
meter core; hoisting the drifting duplicate has already solved that problem.
**Neither family will add more meter or spectrum tags**. Spectrum remains a mode
of audio-meter.

**`<audio-effect-rack>`** (the audio-domain counterpart of the score
synth-panel effects area):

- **Critical implementation correction:** `chainEffects` deliberately does
  **not** return params after composing the graph (effects.ts:122-128 exposes
  only input/output/dispose). The controller must wrap each
  `createAudioNodes` invocation to capture nodes, then recapture them after a
  graph rebuild. It must not attribute params to chainEffects.
- `player.effect` is a construction-time option. Clearly specify how an effect
  attaches to an already playing player: either rebuild it or declare the
  attachment construction-only.
- Provide a parameter metadata table (ranges for frequency, Q, wet, and so on)
  and smooth changes with `setTargetAtTime`.

**`<audio-eq>`** (a draggable multiband EQ curve):

- **Architecture-level correction from verification:** do **not** write a new
  controller. score's `play/headless/eq.ts` (approximately 335 lines) is a
  complete, general-purpose biquad EQ. The repository previously learned from a
  second drifting meter copy and hoisted it to `@webmusic/kernel/meter`.
  Apply the same solution: hoist the core to `@webmusic/kernel/eq`, add a
  thin audio wrapper analogous to AudioMeterController, and redirect score's
  EqController to kernel. This also repays cross-family technical debt.
- Reuse `mountEq` (521 lines), whose binding shape is already validated by
  synth-panel.

**`<audio-xy-pad>`** (a two-axis performance surface):

- State the justification precisely: score's xy-control is already a
  domain-neutral callback shell and can imperatively drive setPan. The reason
  for this counterpart is the **package boundary plus a declarative audio
  target** (`x="pan"` and `y="rate"`, or
  `y="effect:0:frequency"`), not a capability gap.
- Effect parameters are not currently reachable through the player because
  insertEffect returns only `{output, dispose}`. Share the same node-capture
  and target-resolution helper with effect-rack instead of implementing it
  twice.

---

## 3. Exclusions (All Grounded in Source Evidence)

| Candidate | Reason |
| --- | --- |
| Channel-strip composite (fader + pan + meter + dB) | Both sides are missing: the mixer engine has no per-member panner/analyser tap, and no composite presenter exists. This violates the "create only one side" discipline. Build the engine first; park this item. |
| Output-device picker | `setSinkId` has zero matches across the packages, so no headless support exists. |
| Clip editor/trimmer | `ClipEditSession` has a complete engine for cut/fade/normalize/reverse, but editing is a separate capability. This is the same decision used to reject the piano-roll editor in the view plan. It is the **strongest parked candidate** because its engine is ready. |
| Jog/scrub wheel | `player.scrub()` exists in headless, but a niche surface would require a new wheel presenter. |
| More meter/spectrum tags | Prohibited by the meter boundary in Section 2D. |
| Spectrogram element | SpectrogramVisualizer belongs to the view family and play cannot import view. A scrolling-spectrogram presenter does not exist. Defer to a future audio/view plan. |
| Tap-tempo/beat element | BeatGrid is data; play has no tap or estimation engine because tempo estimation belongs to analyze. Beat display is already included as domain ticks in clip-timeline. |
| Sample pad/step sampler | No one-shot pad scheduling engine exists, and the mountSequencer contract does not fit. This matches the view plan's decision. |
| Score synchronization/bridge element | Declarative following belongs to the `@webmusic/bridge` roadmap. play cannot import bridge. Phase 1 instead exposes clock plus `play(when)` at the element level for bridge binding. |
| A/B comparison element | The mixer's exclusive solo/mute already provides immediate A/B behavior, so another shell would add no difference. |
| Time-stretch/pitch-shift control | The peer is declared but not wired, and no DSP exists. audio-rate-control honestly documents the pitch-changing speed behavior instead of making a false promise. |

## 4. Implementation Order

**Phase 1 - Compliance and contract foundation (no new tags)**

1. Repair clip-player: adopt the existing
   `webaudio:seek {seconds, region?}` contract and add progress; add pan and
   preload attributes; expose clock and `play(when)` on the element; migrate to
   WebMusicElement; and pass the decoding context.
2. Repair clip-recorder: align names, add device-id and the other attributes,
   and expose take playback/export completely.
3. Repair mixer, including error forwarding.
4. Record the meter-boundary decision in both families.

Also correct README-play naming and document `webaudio:error` in each header.

**Phase 2 - S-level quick wins (both sides already exist)**

`<audio-clip-timeline>` (first audio use of mountTimeline),
`<audio-clip-inspector>` (first audio use of mountInspector), and
`<audio-rate-control>` (first audio use of the parameter rack, including the
small setPreservesPitch increment).

**Phase 3 - M-level work (create one side, ordered by reuse)**

`<audio-playlist>` -> `<audio-input-picker>` (unlocks recorder pairing) ->
`<audio-clip-dropzone>` (first decoder-worker consumer plus mountDropZone) ->
`<audio-effect-rack>` (node-capture helper) -> `<audio-xy-pad>` (reuses that
helper) -> `<audio-loop-editor>` (ui/timeline setLoop extension plus
player.setLoop forwarding).

Hoist kernel/eq and add `<audio-eq>` in this phase as well. Because that work
redirects the score side, land it in a separate commit.

**Phase 4 - L-level completion**

`<audio-waveform-player>` (mountWaveformTrack presenter plus injected peaks
with a local fallback).

Documentation milestone between Phases 2 and 3: replace the Play sidebar's
autogeneration with four explicit groups mirroring scorePlayGroup, rewrite the
overview by responsibility, and add ui-catalog rows.

Every new UI presenter uses the standard integration points: module, barrel,
`--wm-*` token, and SSR test. All elements remain within the existing
`./play/element` seam, so package-policy does not change.

## 5. Cross-Cutting Conventions

- **Event prefix `webaudio:`**; every event uses
  `{bubbles:true, composed:true}`.
- **`webaudio:seek {seconds, region?, progress?}`**: adopt and extend
  audio-view's existing contract. The element also calls
  `player.seek(seconds)` directly, following the same rule as the score family.
- **Clip-production event idiom**: recorder emits
  `webaudio:recorded {clip}`; dropzone uses the new
  `webaudio:clip {clip}` name. `webaudio:loaded` remains
  `{duration}` and must not be overloaded.
- **`webaudio:trackchange {id}` / `webaudio:playlistend`**: new playlist
  contracts that do not reuse the single-track `webaudio:end`.
- **Kernel hoist**: `@webmusic/kernel/eq` within this plan, continuing the
  meter precedent. Redirect the score-family EqController and record the
  cross-family correction in the score changelog.
- **Borrowing idiom**: borrow through `.player`/`.analyser` properties, as
  audio-meter does. A borrower never disposes the borrowed object.

## 6. Counts and Verification Record

**15 = 1 retained + 3 repaired + 11 added**; S x 4, M x 9, L x 1. Category
sizes are 4/3/3/5.

Presenter adoption scorecard: mountTimeline, mountPlaylist, mountDevice,
mountParameterRack, mountEq, mountXy, and mountInspector each gain their first
audio-family consumer, eliminating the unused presenter inventory.

Verification followed the previous two plans: all 14 additions or repairs were
checked individually against source for engine availability, presenter
contracts, guarded imports and fallback behavior for optional peers, effort,
and cross-family overlap. No proposal was rejected in this round. Every
correction is incorporated above: adopt the existing seek contract,
preserves-pitch cannot currently change live, chainEffects does not forward
params, the player has no public setLoop or loop getter, event-name conflicts,
the kernel/eq hoist, and the missing decoding context. After all four plans, the
complete inventory is play 19 / analyze 16 / view 14 / audio-play 15.

---

## 7. Corrections found during implementation

Written 2026-08-17, when score/play still had thirteen elements and
`@webmusic/ui` still published twenty-five. Both numbers moved before this
plan's later phases could start — score/play was cut to five on 2026-08-19
(`c75de86`) and the UI kit to eighteen on 2026-08-21 (`ad2bbff`) — so
several of the plan's justifications now cite surfaces that are not on
`main`. Recorded here rather than edited away.

### What shipped: five elements, not fifteen

Phase 1's three repairs plus one addition, and one element retained:
`<audio-clip-player>`, `<audio-clip-recorder>`, `<audio-mixer>`,
`<audio-meter>` and the new `<audio-playlist>` (`e1738ea`, `b3be763`).

Phase 1 landed close to the plan:

- `<audio-clip-player>` migrated to `WebMusicElement`, gained `pan` and
  `preload`, adopted the existing `webaudio:seek {seconds, region?}` shape,
  and now takes a settable `.audioContext` so several tags on one page share
  one context instead of minting one each against a browser cap of about
  six. The decoding-context defect Section 2A item 4 found is fixed.
- `<audio-clip-recorder>` was renamed from `audio-recorder.ts` with a
  deprecated alias kept at the same tag, and migrated.
- `<audio-mixer>` migrated and forwards the headless mixer's own `error`.
- `<audio-playlist>` shipped with the controller-owned single-context design
  Section 2A prescribed.

Never built: `<audio-rate-control>`, `<audio-waveform-player>`,
`<audio-clip-timeline>`, `<audio-loop-editor>`, `<audio-clip-inspector>`,
`<audio-input-picker>`, `<audio-clip-dropzone>`, `<audio-effect-rack>`,
`<audio-eq>`, `<audio-xy-pad>`.

### Four presenters this plan depends on are no longer published

`ad2bbff` reduced `@webmusic/ui` to the eighteen entries the release surface
composes. Gone: `inspector`, `device`, `xy`, `sequencer`, `profile`,
`tempo`, `tokens`. For this plan that means:

| Plan item | Presenter | State |
| --- | --- | --- |
| `<audio-clip-inspector>` | `mountInspector` | deleted — and `<sound-font>`, the "129-line template" Section 2B cites, was deleted earlier in `c75de86` |
| `<audio-input-picker>` | `mountDevice` | deleted — and `<midi-input>`, "as the score MIDI selector does", went in `c75de86` |
| `<audio-xy-pad>` | `mountXy` | deleted — and so was `<xy-control>`, the element Section 0 rule 2 and Section 2D both argue from ("score's xy-control is already a domain-neutral callback shell") |

Any of these is buildable again only by bringing its module back from `dev`.

### Section 6's adoption scorecard did not happen

It claims seven presenters "each gain their first audio-family consumer,
eliminating the unused presenter inventory". What actually happened:
`mountTimeline`, `mountPlaylist` and `mountRecorder` gained audio consumers;
`mountInspector`, `mountDevice` and `mountXy` were deleted instead; and
**`mountEq` and `mountParameterRack` still have zero audio consumers** —
`<audio-eq>`, `<audio-rate-control>` and `<audio-effect-rack>` were the
elements that would have given them one.

### Section 1's presenter comparison was wrong when written

"score/play wraps transport, playlist, device, parameter, and EQ
presenters." score/play imports `transport`, `eq`, `parameter`, `envelope`,
`lfo`, `macro`, `mixer`, `note`, `panel` and `recorder` — it has never
imported `playlist`, and `device` is gone. The gap the section was pointing
at is real; two of its five examples are not.

### The kernel/eq hoist did not happen

Section 2D and Section 5 schedule `@webmusic/kernel/eq`, hoisting score's
335-line `play/headless/eq.ts` and redirecting score's `EqController` to it.
None of it landed: `platform/kernel/src/eq.ts` does not exist, the policy
table's `expectedPublicEntries` has no `./eq`, and score's EQ controller is
untouched. The meter precedent it reasons from is still sound, so the item
survives as proposed work — it is simply not done.

### Smaller corrections

- **`webaudio:trackchange` ships `{id, index}`, not `{id}`**, and it has an
  unplanned sibling `webaudio:trackend {id, index}`. `webaudio:playlistend`
  is as specified.
- **`<audio-playlist>`'s justification improved by accident.** Section 2A
  notes "score has no `<playlist-player>`" as a correction found during
  implementation — that was false when written (the element existed until
  `c75de86` two days later) and is true now. The cardinality argument the
  section rests on never depended on it.
- **The Phase 2/3 documentation milestone is spent**: it plans four explicit
  sidebar groups for fifteen elements; the capability has five under the
  autogenerated `elementCapability('audio', 'play')` group.
