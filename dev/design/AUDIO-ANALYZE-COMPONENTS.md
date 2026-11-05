# Audio Analyze live tools

Status: accepted dev contract under DEC-037 and DEC-051; implementation and
browser/audio acceptance belong to [STATUS](../STATUS.md). DEC-037 supersedes
DEC-036's Audio Element inventory without changing its static API/Headless
ownership rule; DEC-051 replaces the meter's two-mode presenter with seven
type-selected displays and two themes.
Source and public entries: [Audio Analyze](../../packages/audio/src/analyze/),
[Element inventory](../../apps/doc/webmusic/src/content/docs/audio/element/index.mdx#analyze),
[API](../../apps/doc/webmusic/src/content/docs/audio/api/analyze.mdx) and
[Headless](../../apps/doc/webmusic/src/content/docs/audio/headless/index.mdx#analyze).

## Task and boundary

An Audio Analyze Element is a live listening or monitoring tool. It exposes
actionable evidence from the *current* signal. The compact meter is an
always-visible operational readout; the other tools add an inspection gesture.
The application chooses the tool and places it beside Play and View; Analyze
does not create a transport, load a duplicate clip or hide a report runner.
One fixed tag names one musical task.

| Element | One surface | User operation |
|---|---|---|
| `audio-meter` | Compact type-selected monitor: VU dial, loudness bars, waveform, oscilloscope, spectrum, spectrogram or stereometer | Choose the display type, a mono or colour theme and per-display tuning from the host; monitor current activity at a glance |
| `audio-level-analyzer` | Recent level history and peak/threshold readout | Inspect sampled RMS, sample peak and crest, set a peak threshold, freeze and clear peak hold |
| `audio-spectrum-analyzer` | Live frequency-spectrum inspection | Inspect log-spaced FFT frequency evidence, freeze it and compare peak hold |
| `audio-oscilloscope` | Trigger-aligned time-domain window | Adjust trigger and timebase, freeze a frame and probe time/amplitude |
| `audio-transient-analyzer` | Recent onset-cue activity | Adjust sensitivity and refractory interval, inspect/freeze detected transients |

The View family's `audio-live-view` and `audio-view type="meter"` remain signal
projections. The independent `audio-meter` tag is now an Analyze monitor; it
does not replace the more detailed inspection tools. Its displays are
at-a-glance readings without gestures: the level analyzer reports sampled
dBFS dynamics, history and a threshold; the spectrum analyzer probes
frequencies and holds peaks; the oscilloscope offers trigger, timebase and a
time probe. `audio-view type="spectrogram"` projects a time-frequency data
set; the meter's spectrogram and waveform types scroll the live signal, and
the spectrum analyzer inspects *now* across frequency. The transient tool
provides live onset cues rather than an offline beat grid.

The former offline `audio-analysis`, result card, clip summary, histogram and
generic timeline tags were retired by DEC-035. DEC-036 additionally retired the
onset/beat navigation lanes and current-pitch nameplate as Audio Analyze
Elements. DEC-037 removes the interim tuner without removing pitch analysis.
Their nonvisual algorithms, Worker client, sessions and realtime analyzer
remain available. Whole-clip key, tempo, loudness, summaries, chroma, pitch
tracks and event distributions belong in the
[Analyze API](../../apps/doc/webmusic/src/content/docs/audio/api/analyze.mdx),
the [Headless objects](../../apps/doc/webmusic/src/content/docs/audio/headless/index.mdx#analyze)
and application-owned UI.

## Composition and evidence

`player="#deck"` selects one playback owner within the current Document or
ShadowRoot. Each tool borrows the player's active analyser and observes play,
pause, seek, source and owner changes. An explicit caller-owned `.analyser`
may support a live source outside a player. The existing meter additionally
supports a caller-supplied `.context` for an owned transparent tap, with stable
input/output ports. No tool starts playback, requests microphone permission,
creates its own player or clock, or closes or disconnects a borrowed graph.
Missing graph, denied/unavailable input and silence must remain distinguishable
from a valid measured zero.

The meter retains its existing controller and adds a DOM-free display
reduction (`AudioMeterDisplay`) and canvas painters: `type` selects a VU dial
with 300 ms ballistics and PK/CL lamps, windowed loudness bars, a scrolling
waveform, a trigger-aligned oscilloscope, a projected spectrum with a named
peak, a scrolling spectrogram or a goniometer with a correlation bar; `theme`
selects the page-grey ramp or colour encoding; `size` presets cap an
adaptive, aspect-kept height at the kit's surface tiers, and `width`/`height`
fix a custom box. Holds decay per frame, not by elapsed time. Readings are meter-grade: windows are polled on animation
frames, loudness is a windowed K-weighted estimate rather than gated EBU R128
programme loudness, peaks are sample peaks, and the trigger is not
sample-accurate. It is not a substitute for the level, spectrum or
oscilloscope inspection tools. `audio-meter` is canonically registered/exported
from Analyze; the former View Element import and auto-registration remain a
compatibility alias for the same tag and implementation, not a second meter.
The Analyze Element facade may reach the existing View meter implementation
through a single reviewed compatibility adapter. This does not permit arbitrary
Analyze-to-View imports or move offline analysis into View.

The level tool reports **sampled** RMS and sample peak, in dBFS where
applicable, plus a crest difference. Its rolling history and held peak are
inspection state, not integrated loudness (LUFS), true peak, or a certified
limiter. The threshold compares the measured sample peak with a caller-set
dBFS value; it does not control gain.

The spectrum tool reads bounded FFT evidence from the borrowed analyser and
offers frequency inspection on a logarithmic axis. Its amplitudes are
analyser-derived relative levels, **not calibrated SPL**. Freeze and peak hold
retain a visible comparison; they do not alter the underlying signal.

The oscilloscope reads a recent time-domain frame from the borrowed analyser.
Its trigger aligns a visible crossing within available samples; timebase and
probe inspect only that captured window. It must not retune a borrowed
analyser's FFT size or imply an unbounded history, sample-accurate trigger, or
transport synchronization. Freeze holds a copied display frame, not the graph.

The transient analyzer compares successive signal windows for spectral-flux
and energy changes, then applies sensitivity and a refractory interval to
surface onset cues. Its short event history is an observation of sampling
cadence, not a stable clip-time onset map. Seek, pause, source changes and graph
loss clear or invalidate that history so old cues do not masquerade as live
events. It does not estimate BPM, infer a beat grid or claim sample-accurate
onset timing; those remain API/Headless tasks over decoded audio.

Every tool owns its sampler or analyzer, short-lived UI state, subscriptions
and presenter. It releases those on rebind/disconnect and invalidates callbacks
from older sources. The meter alone may own its documented transparent tap and,
for its stereometer and loudness displays, a stereo branch fanned out from the
analyser it reads: one added output edge, removed selectively, never a change
to the owner's connections or tuning. All other borrowed graph resources
remain caller-owned. A frozen display never
becomes a second signal authority; the current player retains data, sound and
transport ownership. Each visible Element owns one neutral outer component
surface and public tokens/parts; application Parameters configure attributes
outside the component. Inspection gestures remain inside the applicable tool.

## Presentation and controls

The five Elements use achromatic default palettes and compact component
surfaces. Detailed tools keep their primary measurements or probe values in
fixed positions, without a repeated visible title. Accessible group names
remain. Freeze buttons keep a stable label and use their pressed state;
Reset/Clear and peak-hold controls keep their distinct operations. Routine
Live, Paused and Frozen prose is suppressed. Waiting, unavailable, no-signal
and unmatched-trigger feedback remains visible when applicable, so an empty
or failed source is not presented as valid measured silence.

Threshold, sensitivity, timebase and trigger controls reuse UIKit's rectangular
horizontal fader. The adapter supplies the control's real units, bounds and
keyboard steps through slider ARIA, while the domain continues to own values
and commands. `--wm-analysis-control-size` defaults to `1.5rem` for compact
buttons/selects and fader thickness; public `--wm-fader-*` tokens remain the
fader styling surface. Existing named control parts remain alongside the
shared fader parts. The meter retains its Shadow DOM and legacy color aliases.
No presentation change alters measurement algorithms or borrowed graph
ownership.

## Offline timing and View composition

Onset times and beat grids are useful code-only results, not separate
performance Element tags. Compute them through `detectOnsets`, `detectTempo`
or an Audio analysis session. When an application wants visible beat markers,
convert the resulting `BeatGrid.beats` seconds to point `Region` values and
assign them to a sibling `audio-view.regions`. That View can already borrow the
player's clip position and perform its documented region interactions. This
does not make the Analyze API own a player or a UI. A zero-confidence synthetic
tempo fallback must not be presented as detected pulse evidence.

## Acceptance

Assert exactly the five Analyze tool registrations and the absence of tuner and
other retired Audio Analyze tags in canonical exports, policy, catalogs and
navigation. Test the meter's legacy View import/auto-registration as one
idempotent compatibility path, not a second tag. Cover one-player binding,
explicit-analyser precedence, meter tap and stereo-branch ownership, the seven
display types in both themes and the legacy mode alias, late/replaced sources,
pause/seek/end, graph loss, frozen/held-state reset, threshold, spectrum probe,
oscilloscope trigger/timebase/probe, transient sensitivity/refractory interval,
silence, callback cancellation and repeated cleanup. Each tag demo pairs one
real player with that tool, with external Parameters and truthful Copy/Reset.
Browser checks inspect normal/narrow widths, keyboard/focus, live data and
device behavior. Static tests alone do not establish acoustic accuracy,
calibrated sound pressure, true-peak capture or sample-accurate onset timing.
