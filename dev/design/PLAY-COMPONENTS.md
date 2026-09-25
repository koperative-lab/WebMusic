# Score Play component responsibilities

Status: implemented, including responsive presenter changes; browser and real-device acceptance pending.
Layer and public entry: Score Play Headless, Elements and UI bindings.
Related decision: DEC-016.
Source and public types: [Play source](../../packages/score/src/play/).
Owning reference and demos: [Play Elements](../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#play).

## User task and boundary

Play provides transport, mixing, performance input, capture and sound editing.
A mode belongs inside a component when its input and user task remain the same.
These five roles have different state and resource owners; combining them into
one player would duplicate those owners or make unrelated controls mandatory.

| Element | User task | Composition and configuration |
|---|---|---|
| `score-player` | Start, pause and navigate existing music | One transport over a native Score, Rack or borrowed PlayerController |
| `rack-control` | Mix voices already owned by one Rack | Master/member levels, mute and solo; no second transport |
| `note-input` | Produce live pitch on/off gestures | `layout` selects `piano`, `grid` or `chords`; `keyboard` separately enables QWERTY input |
| `score-recorder` | Capture matched note gestures into a Score | Borrow an event source or accept imperative capture; built-in live monitoring and take audition |
| `synth-panel` | Edit caller-supplied sound and DSP parameters | `sections` chooses the applicable editor sections |
| `rack-part` | Declare a desk's score and sound in markup | Nonvisual data declaration; no player, input or presenter |

No new alias tags or a generic `type` spanning unrelated roles are introduced.
The existing `simple-score-player` compatibility constructor/tag delegates to
the canonical `score-player` implementation; both registration functions remain available.

## Composition

Score I/O and models feed Headless ScorePlayer/Rack. The Element adapts them to
UIKit transport/mixer bindings. Input gestures feed the recording session, and
sound descriptors feed the Synth Panel model and audio graph. Musical algorithms
remain outside presenter DOM. A component can be replaced by custom UI over the
same Headless behavior.

A player can wrap one mixing desk with `rack-part` declarations, or a sibling
mixer can receive the same Rack by property. The player's precedence is borrowed
controller, explicit Rack, composed Rack, explicit Score, then `src`. All built-in
transport modes mount into an owned child host, preserving authored children.
Only the selected first desk supplies the composed Rack; removal and replacement
release that connection. A nested desk change does not interrupt an explicitly
assigned Rack or controller.

Analyze/View borrow the native player's resolved Score and state through the
[existing binding contract](PLAYER-BINDING.md). A Rack or arbitrary controller
has no complete single-score snapshot in this checkout. Transport support is
not a claim of uniform companion data support.

## Inputs, outputs and units

| Input or command | Units and default | Contract |
|---|---|---|
| Native `seek` / currentTime / duration | Rate-scaled transport seconds | Clamped to the mounted score duration |
| Rack `seek` / currentTime / duration | Member transport seconds | Readback follows the longest built timeline member; seek clamps shorter members to their ends |
| `seekFraction` | Fraction in 0–1 | Uses the same mounted transport path as navigation controls |
| `seekNominal` | Unscaled score seconds | Native engine or controller rate conversion; rejects for Rack because it has no single nominal score axis |
| Native rate, pan, volume and loop | Existing owning reference defaults | Apply to the native score engine; controller supports explicit rate writes; Rack mix belongs to the Rack/mixer |
| Recorded gestures | MIDI pitch and monotonic timestamps | FIFO pairs repeated equal pitches; only completed pairs enter the take |
| DSP ports | Borrowed AudioContext and caller routing | Stable node identities during same-context audio-section edits |

Rack duration is zero until timeline players have been built by preload/play.
Its group seek retains the existing fire-and-report API, not an atomic outcome
transaction. No group rate/loop or sample-accurate common-start contract is added.
Public leaf pages own exhaustive members, defaults, formats and ranges.

## State and commands

The native engine owns playback intent and cursor. Commands invoked from note
or cursor listeners supersede the interrupted operation; an outer pause, stop,
seek, loop or rate edit must not overwrite a newer command or lose its handles.
Stale paired time updates must not follow a listener-triggered seek.

The recording session owns completed notes and unmatched presses. Stopping
keeps completed notes and drops unmatched presses. `discardPending()` drops only
unmatched presses, preserving the take and recording start. Source replacement
uses it so a new source cannot release an old source's note. Disconnection
cancels the active capture session and disposes owned monitoring/playback;
already finished take data remains available. The recorder retains the borrowed
`.source` property and rebinds once on reconnect; bubbling does not duplicate a
captured event.

Sound parameter rollback belongs to the current request and descriptor lifetime.
An old rejected request cannot undo a newer value, replacement sound or remount.
Rack part id/sound edits reuse the resolved Score without refetching, but a changed
declaration can replace a member's engine; it is not an in-place revoicing promise.

## Session time

Score timing uses the existing tempo map, performed timing, tie handling and
indexed timeline. AudioContext time gates both onset and release. A frozen audio
clock cannot cause early noteOn merely because wall-clock timers continue.
Backends with timestamp and cancellation support can schedule ahead; JIT
backends remain subject to thread wakeup latency.

The Rack transport observes its members; it does not create another music clock.
Sharing an AudioContext alone does not establish a common transport epoch.
[Shared-clock injection](../../platform/shared-clock-injection.md) remains separate
work. Exact audible synchronization requires device evidence, beyond mocked
clock and DOM contract tests.

## Interaction and visuals

Transport actions, mixer actions, live note gestures and recorder actions are
each the primary interaction of their own component. Layout/section/display
configuration belongs in external Parameters or application code. There is no
new all-in-one control panel or duplicate settings toolbar in this pass.
UIKit owns presenter layout, focus and disabled feedback. Note keys and grid
cells retain a minimum operating size inside a local scroll viewport; chord
buttons wrap. Mixer banks scroll internally while member names wrap. Recorder
actions and export groups wrap, and parameter groups and macro targets shrink
inside narrow flex/grid containers. Envelope and EQ readouts occupy a separate
row below the plot, so text does not share the gesture surface. EQ keyboard
inputs remain focusable and identify the selected band and axis.

Elements preserve native `hidden` behavior and inherited public styling tokens.
The player reuses UIKit's exported `transportStateStyle` for focus/disabled
feedback alongside its existing transport geometry. Synth Panel delegates its
section structure to UIKit rather than duplicating panel layout. No new tag is
needed for these shared presentation improvements.

The docs use a neutral composition wrapper for separately reusable elements.
Parameters track note layout applicability, Rack member edits retain a stable
target after renaming, and Reset removes added members. The Synth Panel demo
supplies real descriptors and routes for all selectable sections, with app-owned
audio cleanup. Its oscillator backend applies attack/release; the envelope's
decay/sustain controls remain editor state in this demo.

The [frontend source audit](../audits/2026-09-09/SCORE-PLAY-FRONTEND.md) distinguishes
DOM and source checks from rendered evidence. Browser screenshots, touch hit
testing and final visual acceptance remain pending.

## Resources and failure

| Resource | Owner and release |
|---|---|
| Native score engine and default audio resources | Player facade; destroy on replacement/disconnect, close only owned resources |
| Rack | Borrowed by transport; facade destruction stops its transport but does not dispose the Rack; desk disposes only a Rack it created |
| PlayerController | Borrowed; unmount subscriptions/UI without stopping or disposing it |
| Recorder source / MIDI port | Borrowed; remove only the current binding's listeners/handler; restore its predecessor when still owned |
| Part URL request | Declaration-owned AbortController; abort on replacement or disconnect, ignore stale completion |
| DSP graph and route ports | Panel-owned within a borrowed context; candidate failure keeps the active graph and cleans partial nodes |

Same-context DSP edits keep input/output ports stable. With a context and no
applicable DSP, the ports remain available as a dry bypass, preserving main
callers' existing routing. This integration retains main's published contract;
the earlier feature audit recorded a different dormant-port behavior.
Context replacement and disconnect release ports, so the caller must reconnect.
No non-audio section toggle recreates DSP.

Playback failures reach the existing facade callback and Element error event;
void compatibility commands must not leak unhandled rejections. Promise-based
native nominal seeking preserves its engine error semantics. Invalid part data
reports an error while an existing resolved declaration can remain usable.

## Acceptance and documentation delivery

Automated coverage exercises suspended audio time, reentrant commands, live Rack
seeks/readback, mode changes with authored children, failed seek restarts, source
replacement, overlapping unisons, MIDI handler ownership, stable DSP ports and
partial graph failure. The [dated audit](../audits/2026-09-09/SCORE-PLAY.md) records
actual command results. The frontend source audit records presenter and demo
verification. STATUS owns remaining browser/device work.

Element and Headless leaf pages document actual mode support and lifecycle.
The catalog retains the same six tags; `rack-part` shares its desk's reference.
Generated inventories are refreshed through `docs:sync`.
