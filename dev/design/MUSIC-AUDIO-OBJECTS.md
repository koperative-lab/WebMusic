# Music and audio objects: time, devices, voices, buffers and channels

Status: accepted direction, in delivery
([DEC-077](../DECISIONS.md#dec-077--musical-time-devices-voices-buffers-and-channels-in-components)).
Layers and public entries: Kernel `/transport` (tempo and position values),
`/module` (`MUSICAL_TIME`, `VoiceAllocator`, OSC, multichannel), `/objects`
(`transport`, `makenote`, `poly`, `voice`, `mc.pack`, `mc.unpack`, `gamepad`,
`hid`, `oscin`, `oscout`) and `/processor-worklet` (spectral frame); Score
`/play/headless` (MIDI device objects, clock, sysex, MPE); Audio
`/play/headless` (shared buffers and sampler objects) and `/view/headless`
(`renderAudioClipEditor`).
Source: [musical-time.ts](../../platform/kernel/src/module/musical-time.ts),
[voices.ts](../../platform/kernel/src/module/voices.ts),
[osc.ts](../../platform/kernel/src/module/osc.ts),
[multichannel.ts](../../platform/kernel/src/module/multichannel.ts),
[music.ts](../../platform/kernel/src/objects/music.ts),
[spectral.ts](../../platform/kernel/src/processor/spectral.ts),
[midi-objects.ts](../../packages/score/src/play/headless/midi-objects.ts),
[midi-clock.ts](../../packages/score/src/play/headless/midi-clock.ts) and
[buffers.ts](../../packages/audio/src/play/headless/buffers.ts).
Owning references: [Kernel API](../../doc/src/content/docs/kernel/api.mdx),
[Score Play API](../../doc/src/content/docs/score/api/play.mdx) and
[Audio Play API](../../doc/src/content/docs/audio/api/play.mdx).
Delivery owner: [STATUS](../STATUS.md), MUS-01.

This is the third group of Max features, built on the message family of
[DEC-075](MESSAGE-OBJECTS.md) and the nesting of [DEC-076](ORGANIZATION.md).
Every object stays an ordinary project plugin: a component that uses them is
still portable code over public entries (DEC-074).

## Musical time

A project's Session may carry `session.tempo = {bpm, beatsPerBar, beatUnit}`
(`beatUnit` is 1, 2, 4, 8, 16 or 32). The runtime creates a
`MusicalTimeSource` from the Session and that tempo and lends it on the root
context under `MUSICAL_TIME`:

| Member | Meaning |
|---|---|
| `tempo()` | The current `MusicalTempo` |
| `playing()`, `position()` | The Session's state and position in seconds |
| `barsBeatsTicks()` | The position as bar, beat (both from 1) and tick, 480 ticks per quarter note |
| `timeAt(position)` | The AudioContext time at which the Session reaches `position` |
| `subscribe(listener)` | Called when the tempo changes, the Session plays, pauses or seeks |

`ModuleProjectRuntime.updateTempo(partial)` changes tempo or meter without a
rebuild and notifies the source; the export keeps it. Bar 1 beat 1 is Session
position 0; there is one tempo and one meter per project.

Time values, from `timeValueTicks` and `timeValueSeconds` in `/transport`:
`4n` (a quarter), `8nt` (an eighth triplet), `4nd` (a dotted quarter), `1.2.0`
(bars.beats.ticks as a duration), `480 ticks`, `250ms` or a plain number (ms),
`2s`, and `4hz`. A whole note is `1n`; `nd` multiplies by 1.5 and `nt` by 2/3.

`metro` with a note value schedules on the beat grid: each tick lands on the
next multiple of the interval from Session position 0, at
`timeAt(nextGridTime(...))`, only while the Session plays, and re-arms when the
tempo or the transport changes. A millisecond interval keeps its free-running
behaviour. `transport` reports on bang: `bar beat tick`, seconds, BPM and
playing.

`makenote [velocity] [duration]` turns a pitch (or `pitch velocity duration`)
into a note-on at the message's time and a note-off after the duration (ms or
a time value at the current tempo), on a `notes` port.

## Messages

One unquoted word of message text is a message with that selector and no
atoms: `stop` is `{selector: 'stop', atoms: []}`, as in Max. A quoted word
(`"stop"`) or `symbol stop` is a `symbol` message. `atomsOf` gives `[stop]` for
both, so routing by value is unchanged.

## MIDI

Score's MIDI classes now cover:

- `MidiNoteSource` with `mpe: {bendRange}` (48 semitones by default): a member
  channel's bend before a note-on detunes that note, as `pitch.cents`.
- `MidiControlSource` adds channel pressure (a `pressure` control event and
  message), polyphonic pressure and sysex (messages only).
- `MidiClockSource`: 24-pulse clock in as `start`, `stop`, `continue`,
  `position sixteenths`, `beat n` and `tempo bpm` messages on `clock`.
- `MidiClockSink(output, transport)`: Start or Continue, Stop, Song Position
  and 24 pulses per quarter from any `MidiClockTransport`, which a
  `MusicalTimeSource` satisfies. Pulses go out on a main-thread timer and
  jitter by about its period.
- `MidiMessageSink`: `cc`, `bend`, `program`, `note`, `pressure`, `sysex` and
  byte lists on its `midi` port, sent with `midiBytes` and `sendSysex`.

Channels are 0–15 everywhere, in messages and object arguments.

`createMidiPlugins(access?)` makes these MIDI device objects, all taking
`config.device` (a device name or ID; the first device when absent):
`notein [channel] [mpe]`, `ctlin [channel]`, `midiclock`, `noteout [channel]`,
`midiout` and `midiclockout`. A `MidiAccessSource` requests Web MIDI once
(with sysex when allowed), lists devices for a picker, and fans each device
input out: every object gets its own input, so removing one never silences
another, and the device's previous handler returns with the last user. A
refused permission or a missing device leaves the object unresolved with the
reason; the rest of the graph builds.

## Voices

`VoiceAllocator(voices, steal = 'oldest' | 'none')` maps note keys to voice
indices: `noteOn` returns the voice and the stolen key, if any.

`poly` (`webmusic.object.poly`, `config.voices` 1–64) is a component shell
whose child contexts are its voices, in project order. Its `notes` input
allocates a voice per occurrence and sends the voice's notes to it; a stolen
voice first receives a cancel. Message inlets reach every voice. Inside, a
`voice` object outputs that voice's notes on `notes`, and the boundary objects
of DEC-076 carry audio and messages out. Each voice context is an ordinary
project context; an editor that shows one voice keeps the others in step
(Studio copies the first voice to IDs ending in `~v<n>` before each load).

## Multichannel

A Web Audio connection already carries several channels. `multichannelPlugin(inner)`
registers `mc.<id>` (for `webmusic.effect`, `webmusic.mc.effect`):
`config.channels` instances of `inner`, each given `config.config`, between a
channel splitter and merger. The first instance's parameters are the module's;
setting one sets it on every channel. `mc.pack` (N single-channel inlets → one
N-channel outlet) and `mc.unpack` (the reverse) never follow the default route.
At most 32 channels.

## Spectral frames

`/processor-worklet` exports `createFFT(size)` (in place; `inverse` scales by
1/N), `hannWindow(size)` and `createSpectralFrame({size, hop})`: feed blocks of
any length; every `hop` samples (size/4 by default, or size/2) a windowed frame
is transformed, handed to `onFrame(real, imag)` to change in place, inverted,
windowed again and overlap-added with the gain that makes an unchanged frame
pass unchanged. The output lags by `size` samples (`latency`). Nothing
allocates after creation. The documentation's spectral gate reference
processor uses it.

## Shared buffers and sampling

`sharedBuffersFor(context)` returns the `SharedBuffers` of an AudioContext:
named `AudioBuffer`s with a revision and change subscription.
`createSamplerPlugins()` makes:

| Object | Messages | Ports |
|---|---|---|
| `buffer name [seconds \| source asset]` | `size seconds`, `clear`, bang → `name seconds channels` | message in/out |
| `groove name` | number (start seconds), `play`, `stop`, `loop start end`, `looping 0/1`, `rate r`; bangs at the end | message in, `output` audio, message out |
| `record name` | `start`/1, `stop`/0; bangs when the buffer is replaced | `input` audio, message in/out |
| `adc` | — | `output` audio (microphone) |

A buffer's owners are the `buffer` objects that declare it; it goes with the
last one. A new `buffer` declared the same way (same arguments and asset)
keeps the samples, so a rebuilt graph keeps a recording; writes from `record`
or an editor keep the owners. `groove` starts and stops at the message's time.
`record` captures with a ScriptProcessor, as the Audio recorder does. `adc`
shares one microphone stream per AudioContext, stops it with its last user,
and never follows the default route, which would feed back.

`clipOfBuffer(buffer)` copies a buffer into an `AudioClip` for
`<audio-clip-view>` and `AudioClipEditor`; `renderAudioClipEditor(editor)`
renders the editor's current sound back to a clip, which the caller writes to
the store.

DEC-081 splits the buffer's data from its view: the `buffer` object shows
nothing, and its waveform is the `clip name` component, an `<audio-clip-view>`
bound to the buffer by name; editing it writes back to the store
([component manifest](DEVELOPER-TOOLS.md#component-manifest)).

## Device and network input

`gamepad [index]` polls a game controller every 16 ms and sends `button i
value` and `axis i value` for changes. `hid` asks for a device on `open` (a
user gesture) and sends `report id bytes…` and the device name. `oscin url` and
`oscout url` speak OSC 1.0 binary over a WebSocket to a bridge the user runs
(browsers cannot open UDP); `/address args…` messages map to and from packets,
and both report `open`, `closed` and `error` and reconnect every 2 s.

## Ownership

| Resource | Created by | Released by |
|---|---|---|
| Musical time source | Runtime, per graph | Graph disposal |
| Poly voice contexts | Project document | Runtime with the graph |
| MIDI access, device fan-out | `MidiAccessSource` | Last object using a device |
| Shared buffer entry | `buffer` objects | Last owning `buffer` object |
| Groove source nodes, record capture nodes | The object | The object's `stop` or disposal |
| Microphone stream | First `adc` of a context | Last `adc` of that context |
| Gamepad poll, HID listener, OSC socket | The object | The object's disposal |

## Acceptance

| ID | Scenario |
|---|---|
| MUS-A1 | A note-value metro ticks on the beat grid only while playing and follows a tempo change at once |
| MUS-A2 | `makenote` releases each note after its duration, as a note value at the current tempo |
| MUS-A3 | `poly` gives held notes separate voices and steals the oldest with a cancel |
| MUS-A4 | An `mc.` effect runs one instance per channel and mirrors its parameters |
| MUS-A5 | A spectral frame that changes nothing passes the input delayed by its size |
| MUS-A6 | Two MIDI objects on one device both receive; removing one restores nothing until the last goes |
| MUS-A7 | A refused MIDI permission leaves the object unresolved and the graph built |
| MUS-A8 | A recording survives a rebuild of the same `buffer`, and a cancelled rebuild removes nothing |
| MUS-A9 | An edit in `<audio-clip-view>` rendered back changes what `groove` plays |

Automated tests cover MUS-A1–A8; the private runner's L1–L6 and the owner's
manual checks cover audible timing, real devices and A9 by ear.
