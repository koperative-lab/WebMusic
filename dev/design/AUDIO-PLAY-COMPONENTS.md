# Audio Play component responsibilities

Status: accepted for the dev implementation; verification and remaining device
acceptance belong to [STATUS](../STATUS.md).
Layer and public entries: Audio Play Headless, Elements and neutral UI bindings.
Related decisions: DEC-004, DEC-007, DEC-009, DEC-011, DEC-025, DEC-029, DEC-030 and DEC-031.
Source: [Audio Play](../../packages/audio/src/play/).
Public owners: [Play Elements](../../apps/doc/webmusic/src/content/docs/audio/element/index.mdx#play)
and [Headless inventory](../../apps/doc/webmusic/src/content/docs/audio/headless/index.mdx).

## User tasks and composition

| Component | Task and owner | Composition boundary |
|---|---|---|
| AudioPlayer / `audio-player` | Select and control one active clip, queue or mix | Stable Headless command facade; one transport presenter; borrows group backends |
| AudioPlaylist / `audio-playlist` | Select entries and sequence them | Supplies its queue backend to the linked player; linked UI shows selection without another transport |
| AudioMixer / `audio-mixer` | Control simultaneous sources and gains | Supplies its mix backend to the linked player; Headless owns member/master gain, mute and solo |
| AudioRecorder / `audio-recorder` | Acquire microphone input and retain a take | Owns capture resources; linked take audition uses the central player |

`audio-meter` belongs to [Audio View](AUDIO-VIEW-COMPONENTS.md). Monitoring
borrows a signal and owns no transport. Play does not import View to preserve an
old meter entry; migrate its imports to `@webmusic/audio/view/headless` or
`@webmusic/audio/view/element`.

## Composition and public surface

The canonical composition is one `audio-player` plus companions with
`player="#session"`, or an explicit `.player` reference. The player selects one
active backend at a time: an owned clip engine or a borrowed queue/mixer.
This follows Score's transport-over-Rack composition without copying Score time
units. Queue and mixer remain distinct nonvisual backends; neither introduces a
second transport presenter when attached. AudioClipPlayer remains the immutable
low-level clip engine, including its scratch implementation.

The central AudioPlayer owns no additional clock. It delegates time and commands
to its current backend. A clip uses content seconds, a queue exposes seconds
within its current entry, and a mix exposes its group axis. A mix has no single
resolved clip or analyser; clip-only views must display that missing capability.
Selecting a new nonempty source pauses the previous backend, preserving its
position and preventing hidden overlap. Clearing a borrowed connection merely
detaches it. Replacing a source cancels stale owned work. Borrowing a backend never transfers
disposal ownership. A companion detaches only the backend it attached, and must
not clear a newer selection belonging to another companion.

`audio-player` is the only player Element registration. Retired player/recorder
Element aliases and old player/meter page redirects are removed (DEC-030).
Element `.player` injection uses AudioPlayer. AudioClipPlayer remains a supported
low-level engine, not an Element alias. Independent queue/mixer and recorder
audition remain supported uses; session examples connect them to `audio-player`.
A recorder
keeps microphone permission/capture separate from playback. Audition selects its
finished take in the linked player; recording does not silently create a second
playback session.

Selectors resolve a unique target in the same Document or ShadowRoot, handle
late insertion/upgrade and replacement, and release observers on disconnect.
An explicit object reference takes precedence. Missing/ambiguous targets do not
fall back to a different player. Headless composition uses objects without DOM
selectors. Both forms preserve source subscriptions and borrowed ownership.

## Data and state authority

AudioClipPlayer exposes its immutable constructor-bound `clip` as public readonly
data. The canonical AudioPlayer can replace its selected clip while preserving its
identity. An Element's `.clip` reads the active owned or borrowed player's data.
Explicit `.clip`, `.player` or successful URL/input loading selects the source;
explicit assignment cancels pending loads. Clearing `.player` clears its resolved
clip. Reassigning the same player does not transfer or destroy its ownership.

The Element emits `webaudio:sourcechange` with `{clip, revision}` after resolved
clip or player identity changes. Revision is local and monotonically increasing.
Source state is committed before callbacks; listeners reread current state under
reentrancy. Initial attachment reads the current clip. Graph readiness remains
`webaudio:loaded`; source discovery does not allocate an audio graph. This bounded
Audio contract follows [Player binding](PLAYER-BINDING.md) without copying Score
models or claiming a complete shared nonvisual playback protocol.

AudioView follows source replacement and clearing, updates derived peaks and
command bindings, and releases previous subscriptions. Explicit View data keeps
its documented precedence. Followers neither reload the player's URL nor dispose
its player. Arbitrary legacy event sources retain their narrower capabilities.

AudioMixer owns mix state. `snapshot()` returns immutable master/member values,
solo identity and effective gains; `change` invalidates that readback. Elements
retain presentation subscriptions, not duplicate volume/mute/solo maps. Multiple
presenters and custom UI observe the same Headless object. A source's direct
out-of-band gain changes are not a second mixer-state authority.

## Commands and time

- Clip positions, durations, loop boundaries and seeks use content seconds;
  `when` uses absolute AudioContext seconds. Rate does not rename the position
  axis. Buffer clock readback is unwrapped; public clip position folds into the
  active loop. Region events use the accepted, normalized position.
- Commands from synchronous callbacks supersede stale observation work. Region
  sets are committed before notifications, preventing same-region recursive entry.
  Graph-ready callbacks can cancel playback before a source starts. Invalid media
  loop configuration is rejected before replacing valid configuration.
- Seeking while a Buffer start is still scheduled preserves its future origin;
  changing position does not implicitly begin sound early. Disposal is terminal.
- Mixer starts prepare participants before assigning a future context anchor.
  A backward group seek can rejoin members that naturally ended; independently
  paused members remain paused. Group intent and natural completion are distinct.
  Engines still own separate clocks; this is not shared-instance injection.
- Playlist list looping remains outside its member player. `select()` rejects
  unknown IDs and invalid numeric indices before changing selection or playback.
  Previous/next keep their own boundary behavior. `setLoop`, `setPrefetch` and
  `setSkipFailed` update policy without replacing the current player, position or
  retained clips. Disabling prefetch prevents new speculative loads; current
  transport remains usable. Element autoplay changes use the existing queue.

Media scheduling/range looping remain best-effort. Buffer rate changes transpose
pitch. Queue prefetch does not promise gapless playback or crossfade. Existing
TIME-01/TIME-02 own further shared-clock and acoustic precision work.

## Recording and measurement

Capture becomes recording only after microphone acquisition and context readiness.
Resume is asynchronous and cancellable; late acquisition/resume results cannot
restore canceled intent. Failed startup releases resources before observers may
retry, and the old operation cannot dispose a replacement created by a callback.

The current backend uses ScriptProcessor with 4096-frame callbacks and fixed
stereo input. Native mono is upmixed by Web Audio; varying-channel fixture support
does not establish native channel preservation. The clip uses the actual context
sample rate. Input level is RMS over retained channels and frames, summing squared
samples before averaging so opposite-phase channels do not cancel.

Retained-frame/byte limits are failure ceilings, not timed successful stops.
Exceeding them discards the unfinished take and reports failure. Stop assembles
completed blocks; no final partial-block flush or sample-accurate endpoint is
promised. A future Worklet capture design must specify its flush and cancellation
protocol before changing that contract.

The View meter tuning uses `configure()` and keeps the same-context public input/output
ports stable. Validate a configuration before mutation; setter failures restore
prior settings. Borrowed analysers are not configured or disconnected. Display
scale and decay are controller-owned. The shared live meter's `peakHold` remains
a hold of scaled RMS with per-read decay; the pure PCM helper holds sample peak.
These existing conventions are explicit compatibility contracts, not LUFS,
true-peak, dBFS or elapsed-time-calibrated measurement claims.

## Ownership and failure

| Resource | Rule |
|---|---|
| Clip/player data | Borrow immutable source data; source replacement invalidates derived caches |
| Created player/context/stream | Creator releases it; disposal cancels pending work |
| Borrowed player/context/analyser | Detach subscriptions/routes owned by this component; do not destroy the borrowed resource |
| Mixer members | Remove membership before teardown callbacks; one cleanup error does not prevent other cleanup |
| Meter tap ports | Stable through same-context tuning; context/source replacement is a distinct lifetime transition |
| UI subscriptions and DOM | Presenter/Element releases its own handles without becoming another music-state owner |

Audio Play hosts are full-width blocks with border-box sizing, zero intrinsic
minimum width, a maximum of the parent width, and an effective `hidden` state.
AudioPlayer uses the same 0.75rem default control gap as Score, while its
composition demos use Score's 0.5rem gap between complete components. A linked
playlist has no reserved margin for an omitted transport bar. Demo wrappers
provide layout only; copied markup includes the player and its companions.

Preserve shared neutral styling and existing semantic colors. Changes to musical
state or tuning must not reconstruct unrelated presentation or reset selection.

## Acceptance

Regress central source replacement; clip/queue/mix command delegation; linked
companions without duplicate transport controls; late/replaced targets; recorder
audition through the shared player; View-only meter exports; callback cancellation/reentrancy; accepted loop positions and future
origins; disposed engines; borrowed source replacement and empty state; multiple
mixer observers; solo deletion; exceptional cleanup; invalid selection; queue
policy changes; short-member rejoin; suspended recording/resume cancellation;
stereo/phase-sensitive level fixtures; error-handler retry; and meter port identity
plus graph edges during valid and failed tuning.

Source tests, built-entry checks, rendered interaction and actual device/audio
measurements remain separate evidence. Public leaf pages own exhaustive members,
defaults and errors; dated audits own the observed commands and results.
