# @webscore/play

> **Historical package notes. Classification recorded 2026-09-05.**
> The original body is retained as technical and migration evidence, including
> old package names, API shapes, installation commands and links. It is not a
> current installation guide, runnable reference or work queue. The notes do
> not share a single verified implementation date; do not treat this archive
> classification date as the date every original claim was true.
> Current references: [Current play API reference](../../../apps/doc/webmusic/src/content/docs/score/api/play.mdx); [Current play Web Components](../../../apps/doc/webmusic/src/content/docs/score/element/index.mdx#play); [Current play Headless reference](../../../apps/doc/webmusic/src/content/docs/score/headless/index.mdx#play).
> See the [archive index](README.md) for scope, the
> [contribution guide](../../../CONTRIBUTING.md) for setup and validation, and
> [Score architecture](../ARCHITECTURE.md) for current package boundaries.

<!-- docs:historical-body -->

---

The playback stack for WebScore scores — two complementary playback engines,
input drivers, a uniform timbre wrapper, and a flat set of drop-in custom
elements. Score-format parsing and serialization live in [`@webscore/io`](../io).

Everything operates on the shared, immutable `Score` model from
[`@webscore/core`](../core) (installed automatically). Parse a file through
`@webscore/io` once into a
`Score`, then feed that same `Score` to a player, a visualizer (`@webscore/view`)
or an analyzer (`@webscore/analyze`).

```bash
npm install @webscore/play   # @webscore/io and @webscore/core come along
```

> **Note:** not yet published to npm — clone the monorepo and use the workspace packages locally until then.

---

## File input → `Score`

Players operate on `Score` objects. Conversion lives in `@webscore/io`:

```ts
import {loadScore, loadScoreFromUrl} from '@webscore/io';

const score = await loadScoreFromUrl('song.mid');          // by URL (infers format)
const score2 = await loadScore(bytesOrText, {format: 'musicxml'}); // from data
```

| Format | Extensions | Notes |
|---|---|---|
| **MIDI** | `.mid` `.midi` | Standard MIDI File |
| **MusicXML** | `.xml` `.musicxml` | |
| **MXL** | `.mxl` | zip-compressed MusicXML |
| **ABC** | `.abc` | |

Format is taken from `opts.format`, else the file extension, else sniffed from
the bytes (`detectFormat`). Low-level parsers (`parseMIDI`, `parseMusicXML`,
`parseMXL`, `parseABC`) and serializers (`serializeMIDI`, …) are exported too.

> **Why Score-first?** The parsed `Score` is the shared currency across `play`,
> `view` and `analyze` — parse once, render + play + analyze the same object. It
> also keeps format parsing outside the playback engines, preserves SSR-safe
> construction, and lets the parsers (and their deps) tree-shake away for
> consumers that build Scores programmatically.

---

## Two engines, opposite directions

There is one shared synth/Score foundation and **two playback engines** sitting
at opposite ends of the spectrum. Pick by *who owns time*.

### `ScorePlayer` — the **push** engine (autonomous timeline)

Owns its own clock. Call `play()` and a lookahead scheduler advances on the
AudioContext clock. A backend that explicitly supports cancellable future voice
handles receives sample-accurate audio-clock timestamps; timer/MIDI-style
backends use a safe just-in-time fallback. For concerts, fixed playback,
audio-synced views.

```ts
import {ScorePlayer} from '@webscore/play/headless';

const player = new ScorePlayer(score, {reverb: {wet: 0.25}});
player.on('cursor', (pos) => updatePlayhead(pos));
player.on('end', () => console.log('done'));
await player.play();
// player.pause(); player.seek(12); player.setTempo(140);

// One-call code action: create, start, and retain the controllable player.
import {playScore} from '@webscore/play/headless';
const playing = await playScore(score);
// playing.pause(); playing.dispose();

// Sugar: load + build in one call (parsers load lazily)
import {createScorePlayerFromUrl} from '@webscore/play/headless';
const p = await createScorePlayerFromUrl('song.mxl');
```

The scheduler looks `lookaheadSeconds` (default 0.1) ahead every
`schedulerIntervalMs` (default 25), committing only notes in that window. A
cancellable-handle backend retracts future attacks on pause, seek, loop, and
rate changes. Active-source retiming is a separate optional capability exposed
by `retimeScheduledNote()`; cancellation support alone does not imply it. A
backend without cancellable scheduling remains timer-dispatched so it cannot
leak a stale future attack.

### `InteractivePlayer` — the **pull** engine (signal-driven)

Owns no clock. It only sounds when *you* feed it a signal — a gesture, a
metronome, an OSC message, `requestAnimationFrame`, a game loop. Built for
installations, conducting, and creative coding, with many instruments, many
scores, free routing, real-time mixing, and zero-latency score switching.

```ts
import {InteractivePlayer, Sound} from '@webscore/play/headless';

const player = new InteractivePlayer();
player.addVoice('piano', Sound.samples({60: 'c4.m4a', 72: 'c5.m4a'}));
player.addVoice('strings', Sound.oscillator({type: 'sawtooth'}));

await player.addSourceFromUrl('major', 'major.mid', {route: {Piano: 'piano'}});
await player.addSourceFromUrl('minor', 'minor.mid');
await player.preload(); // prepares the current voice set and resumes a live non-running context

// Every external beat advances one beat and returns its notes (drive visuals too)
onConductorBeat((dtSeconds) => player.advance({secondsPerBeat: dtSeconds}));

player.setMix({piano: 1.0, strings: 0.3});  // real-time per-voice mixing
player.select('minor');                      // O(1) score swap, proportional carry
player.play([{midi: 67, velocity: 90, voice: 'piano'}]); // free, score-less triggering
```

Key methods: `addVoice` / `setVoiceVolume` / `muteVoice` / `soloVoice` /
`setMix`; `addSource` / `addSourceFromUrl` / `select` / `seekBeat`; `advance` /
`playBeat` / `play` / `noteOn` / `allNotesOff`. Static
`InteractivePlayer.fromUrls({major: 'a.mid', minor: 'b.xml'})` builds and loads
in one step. Runs headless too: with no AudioContext, `advance()` still returns
the beat's notes and emits `beat`, so the same pull signal can drive lights or
robotics. `dispose()` is terminal: it aborts owned URL source loads, prevents
late results from re-registering a source, and requires a new player for later
playback.

For `ScorePlayer`, `InteractivePlayer`, and `Rack`, passing only `destination`
borrows `destination.context`; passing both `audioContext` and `destination`
requires the exact same context identity. A lazily self-created context becomes
owned only after the complete graph commits and is closed if construction
fails.
`preload()` follows voice/member replacement while it is pending, so resolving
an obsolete backend cannot publish readiness for an unprepared current graph.

Attacks remain on the caller-driven written beat grid. Its source index
nevertheless retains trailing empty beats through a performed tail, projected
with the source's default initial tempo *and tempo unit* at the source-grid
beat width, so a pull clock cannot wrap and retrigger the arrangement before a
recorded final voice has ended. A
caller-supplied `secondsPerBeat` remains authoritative for live pulse timing.

### Which one?

| You want | Use |
|---|---|
| Autonomous timeline playback (pure Web Audio) | **`ScorePlayer`** |
| External-signal / beat-at-a-time interaction, live score swap | **`InteractivePlayer`** |
| Multiple instruments, each its own score/sound/effect, played together | **`Rack`** |
| Progress-bar / scrub / rate-control semantics | **`ScorePlayer`**'s transport surface + drivers |
| Drop a player widget on the page | `<score-player>` |

### Tone.js integration

`TonePlayer` is the optional injected `Tone.Transport` adapter, for projects
that already own a Tone.js clock and audio graph. It shares `ScorePlayer`'s
performed `ScoreTimeline`, including ties, grace-note skipping, part
transposition, and performed tails. Its intentionally smaller event contract
is `cursor`, `noteOn`, `noteOff`, and `end`, plus the shared `operationError`
and `listenerError` diagnostics: it has no `timeupdate` event or loop controls,
so use `ScorePlayer` when a widget needs that full lifecycle.
Each fired Tone callback retains the exact synth and voice handle that created
it. Pausing, stopping, seeking, changing rate/tempo, swapping synths, or
disposing releases (or cancels) that original voice before this player's own
transport entries are rebuilt; it never sends an old handle to a replacement
synth or clears another Tone user's schedule.
An injected synth is borrowed by default, whether supplied in the constructor
or through `setSynth(synth, ownership)`; pass `'owned'` explicitly when this
player should dispose that backend.

`Tone.Transport` itself is global. To preserve the historic self-contained
behaviour, `TonePlayer` defaults to `transportOwnership: 'owned'`, so its
transport methods start, pause, stop, and rewind the injected Transport. For a
project that already owns a Tone clock, pass `transportOwnership: 'shared'`:
`play()` then arms this score against the caller's current transport position
but never changes that transport. In shared mode, seeking and rate changes
rebuild only this player's future entries, including a clipped attack when
seeking into a sustained note.

When the injected transport exposes Tone's `start` / `pause` / `stop` events,
`TonePlayer` observes them: a host pause or stop releases only this player's
voices, clears only its schedule ids, and stops its cursor — it never calls a
host transport method. A global `cancel()` or direct `transport.seconds` seek
has no portable observation hook. After either, call
`await player.rearmSharedTransport(localSeconds?)` to rebuild only this
player's future segment at the host's current position. Supply `localSeconds`
when the host seek maps to a chosen point in this score; otherwise the current
local score position is preserved. A custom injected transport without
`on`/`off` remains usable, but the host must use that explicit rearm step after
its lifecycle changes as well.

---

## Transport surface + input drivers

`ScorePlayer` carries the whole widget-facing transport itself — `scrub`,
`seekFraction`, `setRate` / `rate`, `seconds` / `duration` / `progress`, and a
`timeupdate` event (`{nominalSeconds, transportSeconds,
transportDurationSeconds, progress}`) emitted on the cursor cadence. The old
`seconds` / `duration` event fields remain deprecated transport aliases.
**Drivers** bind external input to any `PlaybackTransport` (which `ScorePlayer`
satisfies directly):

For comparison, the `<score-player>` DOM event exposes the same explicit
fields but retains historical `seconds` as a nominal-score alias and `duration`
as a transport alias. Never bridge those aliases into a WebAudio adapter; use
the explicit names.

```ts
import {ScorePlayer} from '@webscore/play/headless';
import {bindPointer, bindScroll, bindOrientation, bindValue} from '@webscore/play/drivers';

const player = new ScorePlayer(score);
player.on('timeupdate', ({progress}) => renderBar(progress));
bindPointer(player, element);                 // drag to scrub
bindScroll(player, {mode: 'position'});       // scroll position → playhead
bindOrientation(player, {mode: 'rate'});      // device tilt → tempo
bindValue(player, {getValue: () => sensor()});// any number → seek/rate
```

Timing/lifecycle events use snapshot delivery: one synchronous listener throw
or async rejection does not block later listeners, note release, loop/end, or
cleanup. Subscribe to `listenerError` for the structured
`{kind, source, event, mode, error}` diagnostic. ScorePlayer, InteractivePlayer,
Rack, and TonePlayer also expose contained backend/cleanup failures as
`operationError` with `{kind, source, operation, error}`; when nobody observes
that event, the same deferred, rate-limited console fallback remains active.
`PlayerController.error` stays separate and means its caller-visible `play()`
failure. Rack and InteractivePlayer control-plane notifications use the same
isolated delivery boundary as timing events.

---

## Timbres: the `Sound` class

The engines speak one synth contract — `HeadlessSynth` (`noteOn` / `noteOff` /
`connect` …). `Sound` is a uniform wrapper around any timbre backend that drops
straight into either player. It adds a private gain bus (so per-voice
volume/mute/solo work even for normally self-routing engines) and lazy,
context-aware loading.

```ts
import {InteractivePlayer, ScorePlayer, Sound} from '@webscore/play/headless';

Sound.oscillator({type: 'triangle'})            // built-in subtractive synth
Sound.samples({60: 'c4.m4a', 72: 'c5.m4a'})     // one file per exact MIDI note
const sfz = Sound.sfz('piano.sfz')               // key ranges, pitch-shift, velocity layers + round-robin
const sf2 = Sound.soundfont2('strings.sf2')      // .sf2/.sf3 via optional `spessasynth_lib`
Sound.from(toneInstrument)                       // adopt a Tone.js instrument / any HeadlessSynth
Sound.custom((ctx) => myHeadlessSynth)           // your own WebAudio graph

// ScorePlayer.play() waits for required Sound loading; preload is an optional warm-up.
const player = new ScorePlayer(score, {synth: sfz});
await player.preload();
await player.play();

// Pull playback stays synchronous: prepare it before externally driven notes.
interactivePlayer.addVoice('violin', sf2);
await interactivePlayer.preload();
sfz.setGain(0.5);         // live bus level
```

Lower-level building blocks are exported too: `OscillatorSynth`,
`SoundfontSynth`, `RangeSampler` (the pitch-shifting sampler behind `Sound.sfz`),
`SpessaSynthSynth`, plus `createReverbNode`.

**Notes.** `Sound.soundfont2` needs the optional `spessasynth_lib` peer
dependency installed. Vite resolves the AudioWorklet module automatically; in
other bundlers pass `{workletUrl}` (a URL emitted or hosted by your app), or
`{registerWorklet}` when your app owns AudioWorklet registration. `Sound.sfz`
supports the common
key/velocity-range, `sample`, `tune` and `volume` opcodes with velocity layering
and round-robin; it does not implement loops or filter envelopes.

`Sound.ready` is available only after the Sound has been connected to an audio
graph; prefer the owning player's `preload()` as the readiness boundary.
`ScorePlayer.play()` and `Rack.play()` await that preparation automatically.
Rack commits every member route before exposing a self-created context, and
Rack/InteractivePlayer restart readiness against the current member/voice set
when it changes during preparation. A stale waiter is detached, although a
backend without cancellation may continue its underlying fetch/decode work.
For a caller-supplied synth, `ScorePlayer` borrows it by default: disposal calls
only the route cleanup returned from `connect()`, never its global
`disconnect()` or `dispose()`. If it returns no route cleanup, its caller owns
that cleanup too. Pass `synthOwnership: 'owned'` (or Rack's
`soundOwnership: 'owned'`) only when the player/Rack should own full teardown.
`InteractivePlayer` voices follow the same default through
`addVoice(..., {synthOwnership})`.

One `Sound` instance has one active player/voice route. It intentionally
rejects concurrent `connect()` calls rather than silently moving its mutable
backend to another player; create separate Sounds (or one `Sound.layer`) for
simultaneous voices. After its route disposer runs, factory-backed Sounds can
be connected again only when their backend returned destination-specific
cleanup. A raw `Sound.from()` / `Sound.custom()` backend without that cleanup
requires a fresh wrapper or an explicit caller-owned global teardown first.

---

## Effects: the `Effect` chain

A player is conceptually `<player · score · sound · effect>` — the **score**
(what), the **sound** (timbre per note), and the **effect** chain (the room /
colour wrapping the mixed output). `Effect` mirrors `Sound`: a lazy, composable
recipe that the player builds into its audio graph, inserted between the output
bus and the destination.

```ts
import {Effect, ScorePlayer, InteractivePlayer, Rack} from '@webscore/play/headless';

const room = Effect.chain(
  Effect.filter({type: 'lowpass', frequency: 6000}),
  Effect.delay({delaySeconds: 0.3, feedback: 0.35, wet: 0.25}),
  Effect.reverb({wet: 0.3}),
);

new ScorePlayer(score, {synth: Sound.sfz('piano.sfz'), effect: room});
new InteractivePlayer({effect: room});   // applies to the whole mix
new Rack({effect: room});                // the same recipe, built on its master bus
```

Built-in effects and `Effect.custom(factory)` are lazy recipes, not shared live
AudioNodes. Reusing `room` across these owners is safe: each player or rack
builds a separate node graph in its own AudioContext. The
`Effect.custom(existingNodePair)` overload is an escape hatch that returns
those exact nodes; do not reuse that form concurrently or across contexts.

Built-in factories: `Effect.reverb`, `Effect.delay`, `Effect.filter`,
`Effect.distortion`, `Effect.compressor`, `Effect.gain`, `Effect.chain(...)`,
and `Effect.custom((ctx) => ({input, output}))` for your own sub-graph. The
legacy `reverb` option still works and is just sugar for
`effect: Effect.reverb(...)`.

## Racks: many instruments, one ensemble

A player is one instrument: `<player · score · sound · effect>`. For an ensemble,
**don't stuff many instruments into one player** — give each its own player and
group them in a `Rack`:

```ts
import {Rack, Effect, Sound} from '@webscore/play/headless';

const rack = new Rack({effect: Effect.reverb({wet: 0.25})}); // shared room

rack.add({score: violinScore, sound: Sound.sfz('violin.sfz')});
rack.add({score: celloScore,  sound: Sound.sfz('cello.sfz'), effect: Effect.filter({frequency: 4000})});

await rack.play();          // every member starts together on one shared clock
rack.setVolume('player-0', 0.6);
rack.mute('player-1');       // per-instrument mixing
rack.setEffect(Effect.chain(
  Effect.compressor(),
  Effect.reverb({wet: 0.15}),
));                          // hot-swap the summed master-bus chain
rack.effect = undefined;     // equivalent property API; restore a dry master
rack.on('end', () => {});    // fires once all members finish
```

The rack owns one AudioContext and a master bus (with an optional rack-level
effect), wires each member through its own gain (independent volume / mute /
solo), and fans transport out to all of them. Members are `timeline` by default
(synchronised `ScorePlayer`s); set `mode: 'interactive'` for pull members driven
by `rack.advance()`. Construction is SSR-safe — members are specs until the first
`play()` / `advance()`. The first graph build commits every current member route
as one Rack construction transaction; `preload()` then covers the complete
current member set and follows replacements made while it is pending.

`Rack.effect` and `Rack.setEffect()` always address the single chain after the
summed master bus. On a live graph, replacement builds and commits only that
output route: it does not recreate members, discard their mix state, or reset
their transport position. A failed replacement leaves the previous chain in
place. Per-instrument processing is a different tier and remains the
`RackAddOptions.effect` passed to `rack.add({effect})`; it runs on that member
before the channel enters the master bus.

> **One unit, two ways to scale.** `InteractivePlayer` packs many voices into a
> single pull engine (best when one conductor signal drives everything);
> `Rack` composes many independent `<score · sound · effect>` players (best when
> each instrument wants its own engine, effect and mix strip). Pick per project.

## Web Components

Custom elements ship from the `/element` subpath so the main entry stays
DOM-free. Register explicitly, then use declaratively:

The consolidated `<synth-panel>` remains one public element, but its internals
are separated by responsibility: `synth-panel-model` owns public parameter
contracts and pure maths, `synth-panel-audio` owns the disposable effects/EQ
graph, `synth-panel-template` owns HTML/CSS generation, and the element class
coordinates properties and user interaction.

```ts
import {defineScorePlayerElement, defineAllElements} from '@webscore/play/element';
defineScorePlayerElement();       // registers <score-player>
defineAllElements();              // …or the whole set at once (what '@webscore/play/auto' calls)
```

```html
<score-player src="song.mid"></score-player>
<score-player src="song.musicxml" sound-font="/samples/{midi}.m4a"></score-player>
<score-player src="song.mid" volume="0.5" rate="0.8" loop></score-player>
<rack-control></rack-control>
<note-input layout="piano" keyboard start="48" end="71"></note-input>
```

The elements are one flat set under `/element` — a few **consolidated,
multi-mode** elements (each folding several modes behind one tag) plus a handful
of **single-purpose** elements:

| Element | Purpose |
|---|---|
| `<score-player>` | One player: load a `src` or assign `.score`; built-in transport plus live `rate` / `volume` / `pan` / `loop`, settable as attributes or properties. |
| `<rack-control>` | Mixer for a shared `Rack`; pair it with a `<score-player>` whose `.rack` is the same instance. |
| `<score-recorder>` | Capture a live performance into a `Score`; replay + MIDI/MusicXML export. |
| `<note-input>` | Discrete note surface — `layout="piano\|grid\|chords"`, `keyboard` for QWERTY typing. |
| `<synth-panel>` | Control panel — `sections="sound,effects,envelope,eq,lfo,macros"`. |

`<score-player>` is the only element that loads a file directly (via
its `src` attribute); everything else takes a `Score` or a focused runtime
object. Assign `.score`, `.sound` (any Sound / HeadlessSynth), and `.effect`
(an `Effect` chain) as properties to override the attribute-driven defaults.
Assigning `.rack` instead drives a shared ensemble and pairs naturally with a
`<rack-control>` assigned that same `Rack`.

In Rack mode, `.currentTime` and `.duration` follow the longest timeline member;
`.seek(seconds)` and `.seekFraction(fraction)` seek every timeline member to
the same position, clamping shorter members at their end. A nested
`<rack-control>` supplies the Rack automatically. Removing that desk releases
the composition binding and selects the element's assigned score or `src` again.

Assigning `.controller` borrows an existing `PlayerController`. Connecting or
reconnecting the element preserves its playback rate; only an explicit
`element.rate = value` forwards a rate change to that controller.

The imperative `mountPresetPlayer`, `mountRackPlayer` and `mountControllerPlayer`
handles expose `currentTime`, `duration`, `seek(seconds)` and
`seekFraction(fraction)`. These fields are optional in `PresetPlayerHandle` to
preserve compatibility with existing custom mount implementations.

`SynthPanelAudioGraph.rebuild()` retains the active chain when a replacement
fails and releases all nodes allocated by the failed attempt. Its input/output
nodes stay stable while the AudioContext stays the same; `<synth-panel>` also
retains its last successful effects, context and EQ-band property values.

Legacy compatibility: `<simple-score-player>`, `SimpleScorePlayerElement`, and
`defineSimpleScorePlayerElement()` remain deprecated aliases. The auto/global
bundles and `defineAllElements()` register both tags; use the canonical names
for new code.

---

## API surface

`@webscore/play` is split across explicit capability subpaths — pick the layer you need
and the rest tree-shakes away:

- **`@webscore/play/api`** — public configuration types plus stateless render,
  recording and SFZ-data helpers. No DOM and no live playback state.
- **`@webscore/play/headless`** — **code-only playback components and
  actions**: players, synths, racks, effects, clocks, Web MIDI adapters, direct
  `playScore()` startup and offline rendering. It never creates or mutates DOM,
  defines a Custom Element, or installs visual defaults.
- **`@webscore/play/drivers`** — browser transport adapters for scroll,
  pointer, device orientation and arbitrary values.
- **`@webscore/play/element`** — **Web Components**: all custom elements, one
  flat set, registered with `define*` / `defineAllElements()`.

The root still forwards `/api`, and `/elements` aliases `/element` for
existing consumers. Specialized `/drivers`, `/auto`, `/global`, and `/demos`
entries remain supported.

Inside the headless layer, the historical audio module remains a small stable
facade. Its implementation is separated by responsibility into the public
score-player coordinator, a lazy immutable score timeline, the rolling clock
scheduler, shared audio contracts and utilities, and a stable `Sound` lifecycle
facade over isolated oscillator, FM, wavetable, noise, Web MIDI, SFZ sampler,
exact-MIDI sampler, and optional SF2 backends. This keeps public imports
unchanged while letting each layer evolve and be tested independently. The pull
engine follows the same pattern: `InteractivePlayer` coordinates an immutable
beat-source index, a lazy per-voice mixer, and an independent performance
recorder. In the elements layer, `<note-input>` keeps DOM lifecycle and held-note
state in its custom element while pure keyboard/grid mappings and layout
templates live in independent internal modules. `<score-recorder>` similarly
coordinates independent take-capture, notation, file-export, and view modules.
`Effect` is a stable recipe facade over isolated Web Audio node builders, while
`Rack` coordinates focused member construction, mix calculation, and context
adaptation modules.

Orthogonal convenience entries layer on top: `@webscore/play/auto`
(an auto-registering module), `@webscore/play/global` (a browser-only IIFE
that registers every element and creates `window.WebScorePlay`), and `/demos`.

### root `@webscore/play` — configuration and stateless data API

- **Instrument formats** — `parseSfz`, `resolveSfzZones`
- **Render & record** — `renderScoreToBuffer` / `renderScoreToWav` /
  `bufferToWav` (offline render → AudioBuffer / WAV), `notesToScore`
  (captured performance → `Score`)

### `@webscore/play/headless` — code-only components and actions

- **Engines** — `ScorePlayer` (`Player`, `createScorePlayer`,
  `createScorePlayerFromUrl`), `InteractivePlayer` (`createInteractivePlayer`)
- **Direct actions** — `playScore` / `playScoreFromUrl` start and return a
  controllable `ScorePlayer`; `renderScoreToBuffer` / `renderScoreToWav` /
  `bufferToWav` perform code-only offline rendering and encoding
- **Rack** — `Rack` (`createRack`): compose single-instrument players into a
  synchronised, individually-mixed ensemble; `effect` / `setEffect()` read and
  hot-swap its summed master-bus chain, while `RackAddOptions.effect` remains
  per member
- **Live inputs** — `Metronome`, `bindClock` (steady pull-engine clock),
  `bindMidiInput` (Web MIDI → `InteractivePlayer`)
- **Timbres** — `Sound` (`oscillator` / `samples` / `sfz` / `soundfont2` / `fm` /
  `wavetable` / `noise` / `layer` / `midiOut` / `from` / `custom`),
  `OscillatorSynth`, `SoundfontSynth`, `RangeSampler`,
  `SpessaSynthSynth`, `createReverbNode`, `chooseZone`, `playbackRateFor`
- **Effects** — `Effect` (`reverb` / `delay` / `filter` / `distortion` /
  `compressor` / `limiter` / `gain` / `panner` / `bitcrusher` / `tremolo` /
  `chorus` / `analyser` / `chain` / `custom`), `insertEffect`, `resolveEffect`

### `@webscore/play/drivers` — browser transport adapters

- `bindPointer` / `bindScroll` / `bindOrientation` / `bindValue`, binding an
  explicit browser or numeric input to a `PlaybackTransport` such as
  `ScorePlayer`. This separation keeps `/headless` free of runtime DOM globals.

### `@webscore/play/element` — Web Components

Five elements, one per job, all from `/element` (`<score-player>`,
`<rack-control>`, `<note-input>`, `<score-recorder>`, `<synth-panel>`).
Register one at a time with `define*` or the whole set with `defineAllElements()`
— see the
[Web Component docs](https://github.com/mrsteamedbun/WebMusic/tree/main/apps/doc/webmusic-score/src/content/docs/web-component/play.mdx)
for attribute / event tables.

MIT
