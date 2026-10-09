# Audio View component responsibilities

Status: current dev review contract. [STATUS](../STATUS.md) owns remaining
acceptance and binding gaps. Shared authority remains
[Design principles](../DESIGN-PRINCIPLES.md),
[Player binding](PLAYER-BINDING.md) and
[Audio Play](AUDIO-PLAY-COMPONENTS.md).
Source: [Audio View](../../packages/audio/src/view/).

## Retained roles

| Surface | Role and input | Ownership |
|---|---|---|
| `audio-view` | A selected waveform, precomputed spectrogram or live meter | Own its renderer and viewport; borrow playback, clip data and analyser |
| `audio-live-view` | Rolling samples or spectral observations from an analyser | Own the finite display buffer and browser drawing driver; borrow audio input |

These two Elements retain different data and lifecycle contracts. A type selects
one drawing in AudioView; it does not create a player. AudioView can display
regions and a whole-clip waveform through its existing data and viewport APIs.
Applications can compose the independent UIKit minimap and track-list presenters
when those interactions are useful. Core/Headless project numeric data without
DOM; Render owns canvas/browser work; Elements compose these capabilities with
neutral UIKit presenters. DEC-044 retires the three narrower Audio View tags.

## Meter boundary and player binding

`AudioMeterController`, its pure level/spectrum helpers and the DOM-free
`AudioMeterDisplay` reductions behind the seven meter displays (DEC-051) belong
to `@webmusic/audio/view/headless`; their canvas painters belong to
`@webmusic/audio/view/render`. The independent `audio-meter` Element is now a
compact [Analyze monitor](AUDIO-ANALYZE-COMPONENTS.md), canonically exported and
registered through Analyze. Existing `view/element` and `view/auto` imports
remain as a compatibility alias for the same class and tag, not a second View
component. This is a narrow Analyze Element adapter to the existing View meter
implementation; it does not create a general sibling dependency. Play does not
re-export View or Analyze. `audio-view type="meter"` remains a View projection
mode using the same nonvisual metering capability.

`<audio-meter player="#deck">` follows one central `<audio-player>` in the same
root; its `.player` property can borrow the nonvisual owner directly. Selector
insertion, upgrade, replacement, source clearing and graph readiness update the
borrowed analyser. An ambiguous or missing selector remains empty; invalid
selector syntax reports the existing error event. Direct `.analyser` or
`.context` input takes precedence until cleared. Assigning a nonempty `.player`
selects it and clears those direct inputs.

The controller owns no player, clock or read scheduler. The UI canvas stage
owns frame observation; disconnect/rebind releases subscriptions, owned tap
nodes and the owned stereo branch, never the borrowed player/analyser/context.
The stereo branch is the one permitted touch on a borrowed analyser: a single
added output edge into owned nodes, removed with a selective disconnect. Owned input/output ports remain
stable during valid tuning; invalid tuning retains the prior graph. Source
replacement is a separate resource lifetime.

Live `peakHold` retains scaled RMS with per-read absolute decay; the pure PCM
helper retains sample peak with multiplicative decay; the display's VU and
loudness holds decay per frame. None is a calibrated LUFS, true-peak or
elapsed-time decay claim: the display's loudness reading is a windowed
K-weighted estimate from polled analyser windows. Public leaf pages own the
exact options, defaults and cleanup behavior.

## Data and computation

- AudioClip identity denotes immutable PCM. Cache a derived peaks pyramid per
  consuming Element; graph readiness, repainting, or reapplying the same clip
  does not require copying and scanning its samples again.
- Keep the computed-clip cache separate from the currently selected data. An
  explicit or fetched peaks override must not become a cached result for an
  unrelated clip. Public precomputed arrays remain caller-owned; do not globally
  share or freeze their contents as a performance shortcut.
- Empty decoded input has zero samples, zero duration and no projected columns.
  Streaming data with no decoded PCM retains its distinct unavailable result.
- Spectrogram data is supplied explicitly. A View does not automatically run an
  STFT merely because it can display one. Frame timestamps and frequency centers
  determine the painted axes, including nonuniform data; the Headless timestamp
  selector and the renderer's nearest-center projection retain their own roles.

Documentation demos share one fixture/decode across related examples and prepare
only selected representations. Expensive decoding/analysis uses the existing
worker APIs where available. Lower-page examples activate on visibility or focus;
loading/failure remains observable and pending work is released with its owner.
This is demo composition, not a new implicit View computation contract.

## Drawing and interaction

The virtualized drawing budget follows the visible width plus configured buffer,
not the entire song length. A zero-width hidden host must not allocate and paint
an entire clip as a fallback. Resize/appearance supplies the first real viewport.
Keep a full-width scroll extent independently of bounded drawing storage.
Explicit `virtualization=false` still requests the full surface and its cost.

Reuse a painted spectrogram stripe until the visible window leaves it or data,
geometry or paint options change. A cursor-only update does not rebuild the
spectrum or region layer, resize the backing or clear cached pixels. Image,
region and playhead layers share the same viewport transform; native scroll must
not independently displace them. Stripe replacement preserves overlapping
spectral colors at fractional DPR and under canvas size caps. Waveform progress
and history tinting may require a bounded repaint; they do not justify another
PCM analysis or full-clip canvas.

Rasterize waveform bars on integer CSS columns in a bounded offscreen surface,
retaining device resolution vertically, then composite that raster once at the
fractional viewport offset. Adjacent bars must not be independently alpha-blended
at fractional coordinates, which creates opacity seams as the track moves.
The shared Stage owns equal outer padding on all four sides; the waveform adds
no extra vertical inset. Preserve the supplied peak amplitudes and explicit
`amplitude` gain. Quiet material may leave vertical space; viewport changes must
not automatically normalize its height. A demo may author a fixed height and
visual gain to choose its density; the Parameters/copy/Reset flow must preserve
those attributes. Visual gain may crop peaks but does not change PCM or volume.

Presentation cadence is independent of transport notification cadence. A
`ViewPlayerBinding` may expose live read-only `playing` and `scratching` flags;
when either capability exists, a visible active binding reads borrowed
`player.seconds` on display frames. It never extrapolates position or advances
musical time. Legacy sources without these flags retain event-only updates.
Activity notifications wake the observer; pause, visibility and teardown retire
unneeded frames. Reappearance reads the current authority, except that an end
notification retains its zero-position projection until a new time update.
Unchanged seconds avoid repainting; an initial synchronous projection must not
leave an observer attached after a reentrant rebind.

A renderer may expose `redrawFrame(seconds, follow?)` to consume that same display
frame synchronously. Waveform uses this path to avoid scheduling a second RAF;
other renderers use their existing redraw path. The Element updates its timeline,
slider and viewport from the same sampled position. This changes presentation
observation, not the player's event interval or musical clock.

One presenter owns each primary-pointer gesture. Existing absolute seeking and
new track dragging may issue continuous bounded seeks; region creation commits
once on release. Cancellation never commits a region or flushes a pending seek. Pointer coordinates follow the actual
visible channel lanes; split mode's two rendered lanes cannot return an unseen
third or fourth lane. Keyboard and focus behavior remain with UIKit.

Zoom/offset/playhead use the existing AudioTimeline geometry. Nonfinite zoom
anchors fall back to the current playhead instead of contaminating the viewport.
Renderer scroll and follow observations are read back into that model. The
borrowed player owns musical time, rate and seek outcomes.

## Track dragging and audible scrubbing (DEC-026 / DEC-027 / DEC-028)

AudioView chooses a gesture without creating another player or musical clock.
UIKit owns pointer geometry, capture, focus and cancellation; Audio View converts
CSS movement into clip seconds; Audio Play owns audible scratch resources.
DEC-027 replaces the earlier position-only scrub behavior when the bound player
exposes the optional scratch-session capability. DEC-028 adds continuous audio
phase and release inertia owned by that same player.

| `drag-mode` / `.dragMode` | Commands and compatibility |
|---|---|
| `seek` (default; unknown values fall back here) | Existing absolute position slider: `interactive` enables press/move and keyboard seeking |
| `scrub` | With `interactive`, the track moves beneath a fixed center playhead; left advances, right reverses. A supported decoded player suspends normal playback and sounds the movement at gesture speed, then coasts before restoring its prior state |
| `pan` | With `scrollable`, move only the viewport, including without a player or `interactive`; clicking leaves the viewport unchanged |
| `none` | With `interactive`, stationary click and keyboard seek remain, but a drag does not issue seeks |

`annotate` takes priority over track modes, disables centered scrub geometry and
retains click-to-seek when `interactive` is enabled. Meter has no time axis and
ignores track modes. The 4 CSS pixel threshold distinguishes clicks from drags;
a stationary click in scrub mode remains a silent position change without
release inertia. Deltas use the scale captured at press, independent of playback
rate or later transport ticks. Commands clamp to real clip/viewport bounds.

### Centered rendering

The shared time-axis renderer accepts `playheadMode: 'position' | 'center'` and
supports changing it without replacing its canvas. Position is the direct-call
default. AudioView chooses center while scrub is selected and annotation is off,
independently of `follow` and `scrollable`. The line stays at the viewport center
at zero, at the end and for short clips; areas outside the clip remain blank.
Hit-testing blank padding clamps to zero/duration. `visibleRange()` reports the
intersection with real clip time, not negative or beyond-end musical positions.
Native scrolling and explicit setOffset/panTo do not move a centered surface;
select pan to browse freely. Zoom/resize retain the current time at the center.
Switching back to position mode removes padding and clamps the prior raw offset
while retaining the renderer DOM/canvas.

### Borrowed scratch session

The player may expose `beginScratch(): AudioScratchSession | undefined`. A
session has `active`, `moveToSeconds(seconds, audible = true)` and
`end(resume = true): Promise<void>`. Beginning a supported session captures the
prior playback state and suspends normal playback. Moving uses signed position
velocity to drive continuous forward/reverse audio through bounded local PCM
windows on the existing route. Rate ramps and phase-aligned crossfades preserve
continuity; pointer cadence does not retrigger independent grains. Stationary
input brakes and silences the scratch route.

Normal release flushes the final coordinate and calls `end(true)`. The session
remains active while a short AudioContext-clock coast transitions signed release
velocity toward the configured playback rate for a formerly playing source, or
zero for a paused source. Accepted position and sound use the same transition;
View follows player notifications without adding a momentum clock. Restoration
occurs at completion. Silent clicks and release after motion has stopped bypass
inertia. Gesture cancellation calls `end(false)`, stops any coast immediately,
settles its pending completion and leaves playback paused.

View retains the released handle until its promise settles, so mode/zoom/source
changes, disconnection or blur can still cancel it. Re-grabbing replaces the
session and inherits the original playing intent. Direct `moveToSeconds` during
a coast settles the pending end and retakes the same session. Repeated normal
end awaits the existing completion; it does not restart inertia. Rate/loop edits
finish an active coast at its accepted position and restore with the new
configuration; held gestures retain these edits. Context suspension cancels the
coast rather than leaving timers and completion pending.

The session belongs to Play; View only borrows and ends it. External transport
commands, source replacement and a newer session invalidate old work so a late
completion cannot resume the wrong operation or detach a newer released handle.
Unsupported/no-PCM players return no session without side effects. Legacy structural players without this method
retain the relative position-only fallback; the fallback does not claim audible
reverse processing, release inertia or pause/resume restoration. Failures use the
existing `webaudio:error` channel.

Keyboard, absolute seeking and ordinary clicks (including position-only scrub
fallback clicks) keep their request event before the player command. A stationary
click using a supported scratch session moves silently and publishes afterward,
as does relative scratch/position-scrub dragging; these use accepted clip seconds
where readable. Keyboard input cancels any held scratch gesture before ordinary
seeking. Event order and unsupported behavior are documented in the owning public
reference. The older
`AudioClipPlayer.scrub(deltaSeconds)` remains a relative seek helper, separate
from the scratch session.

Pan suspends follow while selected. Scrub uses its centered renderer instead of
follow while active; authored follow values remain available when another mode
is selected. Pan's accessible slider represents viewport start: arrows move a
quarter-window, Shift a whole window, and Home/End reach the first/last window.
Seeking modes keep ArrowRight/Up moving later and ArrowLeft/Down earlier.

Mode, zoom, source/type replacement, disconnection, pointer cancellation, lost
capture and blur terminate the gesture, discard queued movement and end the
scratch session, including any release coast, without resume. Same-source graph
readiness may complete during a gesture and does not count as source replacement. Another pointer cannot
steal capture. A View owns its presentation frame; Play owns sound and readiness.

Acceptance covers legacy defaults, fixed-center geometry and blank padding,
signed movement, continuous sample phase, stationary braking, release inertia,
cancel state restoration, re-grabbing, source readiness and supersession,
capability fallback, pan, annotation, keyboard, two instances and copied/reset
demos. Passing pointer and graph fixtures does
not establish sound quality, audio-device latency, touch or screen-reader
acceptance; retain those evidence categories separately.

## Lifetimes and verification

Changing source releases obsolete bindings and invalidates only incompatible
cached data. Graph-ready notifications for an unchanged source retain the
waveform surface and viewport while updating transport binding. Meter graph
readiness can rebuild its borrowed-analyser renderer. Explicit type changes
release the previous renderer; resize, zoom and ordinary paint remain bounded.

Workers, observers, listeners, pending requests, render handles and buffers have
one owner and deterministic teardown. Late results cannot overwrite newer
selection or recreate a disposed surface. Shared demo resources need explicit
consumer lifetimes; sharing a fixture does not share transport state.

The live projection core remains caller-paced and stores a fixed number of
observations. Its `windowSeconds × columnsPerSecond` capacity is not an exact
elapsed-time guarantee when capture cadence changes. The current browser painter
spaces retained columns evenly; precise timestamp spacing is a separate display
contract and is tracked in STATUS.

Acceptance covers initial waveform without unused STFT, lazy mode selection,
worker failure/cleanup, repeated configuration, canceled/late results, cache
restoration, hidden-to-visible sizing, very long scroll extents, stationary
follow, resize, nonuniform axes, keyboard/pointer and repeated disposal. Record
CPU probes, browser DOM/render evidence and actual device timing separately.
