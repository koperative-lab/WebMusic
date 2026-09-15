# @webmusic/score

**Symbolic music for the web.** One package: an immutable `Score` model,
MIDI / MusicXML / MXL / ABC import and export, two playback engines, staff /
piano-roll / waterfall views, musical analysis, Web Components, and React
bindings.

```bash
npm install @webmusic/score
```

> Changing this package rather than using it? [ARCHITECTURE.md](https://github.com/koperative-lab/WebMusic/blob/main/packages/score/ARCHITECTURE.md)
> explains the layering, the capability rules, the transport design and the
> reasoning behind them.

The command above is enough for the model, IO, API and Headless entries. Add
the optional presenter peer when using Web Components:

```bash
npm install @webmusic/score @webmusic/ui
```

Start playback:

```ts
import {loadScoreFromUrl} from '@webmusic/score/io';
import {playScore} from '@webmusic/score/play/headless';

const score = await loadScoreFromUrl('song.musicxml'); // MIDI/MusicXML/MXL/ABC
const player = await playScore(score);                 // create and start playback
// Later, when playback is no longer needed: player.dispose();
```

Keep the returned player for the interaction lifetime: `playScore()` resolves
once playback starts, not when the piece ends. Call `player.dispose()` during
teardown to release its owned resources.

…or to pixels, with the same `Score`:

```ts
import {renderPianoRollVisualizer} from '@webmusic/score/view/render';
renderPianoRollVisualizer(score, svgElement, {pixelsPerSecond: 30, noteHeight: 6});
```

The parsed `Score` is the shared currency: parse once, then play, render, and
analyze the same immutable object — or ship it to a Worker.

## Documentation and contribution

Current usage and reference pages are maintained in the documentation site:

- [Getting started](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/score/index.mdx)
- [Web Components](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/score/element/index.mdx)
- [Headless](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/score/headless/index.mdx)
- [API entries](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/score/api/index.mdx)

[Historical package notes](https://github.com/koperative-lab/WebMusic/blob/main/packages/score/docs/README.md) retain earlier technical material;
they are not the current runnable reference. For development, start at the
[contribution guide](https://github.com/koperative-lab/WebMusic/blob/main/CONTRIBUTING.md)
and the [Score architecture](https://github.com/koperative-lab/WebMusic/blob/main/packages/score/ARCHITECTURE.md).
Use the owning public reference and exported types to establish implemented behavior.

## Which entry do I import?

Subpaths follow a two-level grammar. The **first level is a capability** —
`io`, `view`, `play`, `analyze`, `react`; the package root is the core model.
The **second level is a form** of that capability: **`headless`** is stateful
code with no UI DOM (operations still have entry-specific environment and
resource requirements); **`element`** is Web
Components; **`render`** is imperative browser renderers; **`drivers`** binds
browser input to a player; **`auto`** registers all elements as an import
side effect; **`global`** is the CDN IIFE bundle; and **`worker`** /
**`worker-client`** / **`worker-protocol`** are the Worker trio — the
self-registering Worker runtime, the main-thread client, and the pure wire
types. Each capability's *root* (`@webmusic/score/io`, `…/view`, `…/play`,
`…/analyze`) is its stateless API: data in, data out, no DOM, no engine
state.

| Entry | What it is |
|---|---|
| `@webmusic/score` | The core model: immutable `Score`, `ScoreBuilder`, `Rational`, `Pitch`, `Duration`, `TimeMap`, queries, events, JSON. Zero DOM. |
| `@webmusic/score/io` | Stateless parse / serialize / load for MIDI, MusicXML, MXL, ABC. |
| `@webmusic/score/io/load` | Just the loaders: `loadScore`, `loadScoreFromUrl`, `detectFormat`, limits. |
| `@webmusic/score/io/formats` | Per-format parsers and serializers only. |
| `@webmusic/score/io/worker-client` | Main-thread parser Worker client (`createParserWorker`). |
| `@webmusic/score/io/worker-protocol` | Pure parser wire types and constants for custom hosts. |
| `@webmusic/score/io/worker` | Self-registering parser Worker runtime. |
| `@webmusic/score/view` | Stateless view API: layout geometry, note sequences, types. |
| `@webmusic/score/view/headless` | Score windows, map navigation and held-pitch state with optional borrowed playback; no DOM. |
| `@webmusic/score/view/render` | Imperative browser visualizers (SVG / canvas / OSMD). |
| `@webmusic/score/view/element` | `<score-view>`, `<pitch-view>` and `<sheet-view>` Web Components. |
| `@webmusic/score/play` | Stateless playback API: SFZ data helpers, offline render types. |
| `@webmusic/score/play/headless` | Players, synths, `Sound`, `Effect`, `Rack`, `LfoController`, offline rendering. |
| `@webmusic/score/play/drivers` | Pointer / scroll / orientation / value transport adapters. |
| `@webmusic/score/play/element` | All playback Web Components (`<score-player>`, …). |
| `@webmusic/score/play/auto` | Import for side effect: registers every play element. |
| `@webmusic/score/play/global` | Browser IIFE bundle (`window.WebMusicScorePlay`). |
| `@webmusic/score/play/demos` | Demo elements and sample scores. |
| `@webmusic/score/analyze` | Stateless analysis: key, chords, Roman numerals, motifs, voice leading. |
| `@webmusic/score/analyze/headless` | Sessions, playback followers, live trackers, worker clients and presentation prediction; no DOM. |
| `@webmusic/score/analyze/element` | Interactive analysis components (`<key-analysis>`, `<chord-analysis>`, …). |
| `@webmusic/score/analyze/worker-client` | Main-thread analysis Worker client (`createAnalysisWorker`). |
| `@webmusic/score/analyze/worker-protocol` | Pure analysis wire types and constants. |
| `@webmusic/score/analyze/worker` | Self-registering analysis Worker runtime. |
| `@webmusic/score/react` | React provider, hooks, views, and one-line presets. |

Module entries ship ESM + CJS with TypeScript declarations; `/global` is the
browser IIFE form. Public subpaths let applications select capabilities.
Bundle contents still depend on the selected entry, its imports, side effects,
and the consumer's bundler configuration.

## Core model (`@webmusic/score`)

The thin foundation: the immutable `Score`, musical primitives, `TimeMap`,
note queries, a typed `EventEmitter`, and JSON serialization. It touches no
browser APIs, so it is safe in Node, Workers, and SSR.

`ScoreBuilder` collects metadata, parts, measures, tempo, meter, and notes,
then returns an immutable `Score`:

```ts
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '@webmusic/score';

const builder = new ScoreBuilder();
const partId = PartId('piano');
const timeSignature = {numerator: 4, denominator: 4};

builder
  .setMetadata({title: 'Etude', composer: 'WebMusic'})
  .addTempo({atQuarters: Rational.ZERO, bpm: 96})
  .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});

builder.addPart({id: partId, name: 'Piano', midiProgram: 0, staves: 2});
builder.addMeasure({
  id: MeasureId('m1'),
  number: 1,
  onsetQuarters: Rational.ZERO,
  durationQuarters: new Rational(4),
  timeSignature,
  keySignature: {fifths: 0, mode: 'major'},
});

builder.addNote(partId, {
  id: builder.newNoteId(),
  pitch: Pitch.parse('C4'),
  onsetQuarters: Rational.ZERO,
  duration: Duration.quarter(),
  performed: {onsetSec: 0, durationSec: 0.5, velocity: 90},
  voice: VoiceId('piano-v1'),
  staff: 1,
});

const score = builder.build();
```

Share the result between a player, a renderer, and an analyzer without one
consumer mutating another's data. `score.withMetadata(...)` returns a
modified copy; `scoreFromJSON(score.toJSON())` round-trips it, with a schema
marker (`v0.1`), runtime validation, and coded `ScoreJSONError` rejections.

Time, queries, events:

```ts
import {Rational, TimeMap, notesAt, notesIn, notesOverlapping, EventEmitter} from '@webmusic/score';

const map = new TimeMap(score);
map.quartersToSeconds(new Rational(2)); // musical time → wall clock
map.quartersToMBS(new Rational(5));     // → {measure, beat, subbeat}

notesAt(score, new Rational(2));        // notes sounding at a position
notesIn(score, Rational.ZERO, new Rational(4));
notesOverlapping(score, new Rational(1), new Rational(3));

const events = new EventEmitter<{ready: {id: string}}>();
events.once('ready', ({id}) => console.log(id));
```

Compatibility helpers (`pitchToMidi`, `quartersToTicks`, `noteMidi`,
`tickToMeasureBeat`, `locateSeconds`, …) expose MIDI-style 480 PPQ ticks and
second-based readings for legacy integrations.

## I/O (`@webmusic/score/io`)

| Format | Extensions | Notes |
|---|---|---|
| MIDI | `.mid` `.midi` | Standard MIDI File |
| MusicXML | `.xml` `.musicxml` | |
| MXL | `.mxl` | zip-compressed MusicXML |
| ABC | `.abc` | compact single-voice subset |

```ts
import {
  detectFormat,
  loadScore,
  loadScoreFromUrl,
  parseMIDI,
  parseMusicXML,
  parseMusicXMLDetailed,
  serializeMIDI,
  serializeMusicXML,
} from '@webmusic/score/io';

const score = await loadScoreFromUrl('song.mid');                  // infers format
const score2 = await loadScore(bytesOrText, {format: 'musicxml'}); // from data
```

`parseMusicXML()` returns just a `Score`. Use the `*Detailed()` variants at an
import boundary when normalisation must be inspectable:

```ts
const {score, diagnostics} = parseMusicXMLDetailed(xml);
for (const d of diagnostics) {
  reportImportWarning(d.code, d.message, d.location); // stable code + severity + location
}
```

The same result shape comes from `parseMXLDetailed()`, `loadScoreDetailed()`,
and `loadScoreFromUrlDetailed()`. ABC detailed parsing reports unsupported
key / tempo / voice features; MIDI detailed parsing reports measure-grid and
meta normalisations.

URL and Worker calls accept `{signal, timeoutMs}`; one cancellation scope
covers fetch, bounded body reading, parsing, and Worker requests:

```ts
const controller = new AbortController();
const pending = loadScoreFromUrlDetailed(url, {signal: controller.signal, timeoutMs: 15_000});
controller.abort();
await pending; // rejects with AbortError; ScoreLoadTimeoutError marks a deadline instead
```

Parsing moves off the main thread with the explicit Worker client:

```ts
import {createParserWorker} from '@webmusic/score/io/worker-client';

const parser = createParserWorker();
const {score, diagnostics} = await parser.parseDetailed(xml, 'musicxml');
parser.dispose();
```

In an ESM browser bundle the default client resolves the published module
Worker automatically and falls back in-process if a Worker cannot be
constructed; the CJS entry uses the in-process Promise API by default. Pass a
Worker instance or factory for a custom bundler setup — its lifecycle then
belongs to the client. Supplied buffers are never detached or mutated. Known
failures keep their class and stable `code` across the Worker boundary;
other structured remote failures reject with `ParserWorkerRemoteError`. Wire
types live at `@webmusic/score/io/worker-protocol`; the self-registering
runtime at `@webmusic/score/io/worker`.

## Views (`@webmusic/score/view`)

Three views — **staff**, **piano roll**, **waterfall** — at four altitudes:

```ts
// 1. Pure layout data (no DOM) — feed your own renderer
import {createPianoRollLayout, scoreToNoteSequence} from '@webmusic/score/view';
const layout = createPianoRollLayout(score, {pixelsPerSecond: 30, laneHeight: 6});
const sequence = scoreToNoteSequence(score);

// 2. Stateful behavior with no UI or DOM
import {createScoreView} from '@webmusic/score/view/headless';
const view = createScoreView(score, {type: 'piano-roll'});
view.setViewport(0, 8);
view.noteOn(60, 0);
console.log(view.state.activeNotes, view.state.visibleNotes);

// 3. WebMusic's imperative browser renderer
import {renderPianoRollVisualizer} from '@webmusic/score/view/render';
const viz = renderPianoRollVisualizer(score, svg, {pixelsPerSecond: 30, noteHeight: 6});
viz.redraw(sequence.notes[0]); // highlight one currently-sounding note
```

For application-owned navigation, [createScoreMapView](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/score/headless/view/score-map-view.mdx)
borrows a playback source and delegates quarter-note seeks with explicit command
outcomes. [createPitchView](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/score/headless/view/pitch-view.mdx)
maintains held pitches for any representation; `currentStaffMarks` and
`currentFretMarks` from `@webmusic/score/view` provide pure readout data.
[createAnalysisFollower](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/score/headless/analyze/analysis-follower.mdx)
combines that source's score, position and activity with an analysis session.
These objects release only their own subscriptions and never own playback.

`@webmusic/score/view/render` also exports `renderStaffVisualizer`,
`renderWaterfallVisualizer`, `bindPlayerToVisualizer`, and
`renderOSMDStaffVisualizer` (engraving through the optional
`opensheetmusicdisplay` peer).

The Web Component entry provides three composable tags:

```ts
import {defineAllViewElements} from '@webmusic/score/view/element';
defineAllViewElements();
```

```html
<score-player id="p" src="song.mid"></score-player>
<score-view type="piano-roll" player="#p"></score-view>
<pitch-view type="keyboard" player="#p" low="48" high="84"></pitch-view>
```

- **`<score-view>`** selects `piano-roll` (default), `staff`, `waterfall`,
  `map` or `thumbnail`. It resolves explicit `.score`, then `src`, then the
  selected player's score. Type changes reuse that data. Map provides density
  cells and rate-aware seeking; thumbnail is a static preview without active
  highlighting or interaction, even when borrowing a player's loaded score.
- **`<pitch-view>`** selects `keyboard` (default), current-pitch `staff` or
  `fretboard`. It borrows held notes through `player` (or legacy `source`), owns
  no Score, and sends no note or transport commands. Type changes retain activity.
- **`<sheet-view>`** engraves an explicit `.score` or `src` through the optional
  `opensheetmusicdisplay` peer. Its optional `player` connection follows note
  events; it does not borrow the player's score or native snapshot.

Each instance renders one surface. Configuration belongs to attributes or
application-owned controls; documentation demos put it in external Parameters.


## Playback (`@webmusic/score/play`)

Two engines at opposite ends of one question: *who owns time?*

**`ScorePlayer` — the push engine.** Owns its own clock; a lookahead
scheduler advances on the AudioContext clock. For concerts, fixed playback,
audio-synced views:

```ts
import {ScorePlayer, playScore, createScorePlayerFromUrl} from '@webmusic/score/play/headless';

const player = new ScorePlayer(score, {reverb: {wet: 0.25}});
player.on('cursor', (pos) => updatePlayhead(pos));
player.on('end', () => console.log('done'));
await player.play();
// player.pause(); player.seek(12); player.setTempo(140);

const playing = await playScore(score);              // one-call: create + start
const p = await createScorePlayerFromUrl('song.mxl'); // load + build (parsers load lazily)
// Dispose each player you own when its interaction ends:
// player.dispose(); playing.dispose(); p.dispose();
```

**`InteractivePlayer` — the pull engine.** Owns no clock; it sounds only
when *you* feed it a signal — a gesture, a metronome, an OSC message, a game
loop. Built for installations, conducting, and creative coding:

```ts
import {InteractivePlayer, Sound} from '@webmusic/score/play/headless';

const player = new InteractivePlayer();
player.addVoice('piano', Sound.samples({60: 'c4.m4a', 72: 'c5.m4a'}));
player.addVoice('strings', Sound.oscillator({type: 'sawtooth'}));
await player.addSourceFromUrl('major', 'major.mid', {route: {Piano: 'piano'}});
await player.addSourceFromUrl('minor', 'minor.mid');
await player.preload();

// Every external beat advances one beat and returns its notes
onConductorBeat((dtSeconds) => player.advance({secondsPerBeat: dtSeconds}));

player.setMix({piano: 1.0, strings: 0.3});  // real-time per-voice mixing
player.select('minor');                      // O(1) score swap
player.play([{midi: 67, velocity: 90, voice: 'piano'}]); // free triggering
```

It runs fully headless too: with no AudioContext, `advance()` still returns
the beat's notes, so the same pull signal can drive lights or robotics.

| You want | Use |
|---|---|
| Autonomous timeline playback (pure Web Audio) | `ScorePlayer` |
| External-signal, beat-at-a-time interaction, live score swap | `InteractivePlayer` |
| Multiple instruments, each its own score / sound / effect | `Rack` |
| Progress bar / scrub / rate control | `ScorePlayer` + `@webmusic/score/play/drivers` |
| Drop a player widget on the page | `<score-player>` |
| A project that already owns a Tone.js clock | `TonePlayer` (optional `tone` peer) |

### Sounds

A player is conceptually `<player · score · sound · effect>`. `Sound` wraps
any timbre backend behind one contract, adds a private gain bus (per-voice
volume / mute / solo), and loads lazily:

```ts
import {ScorePlayer, Sound} from '@webmusic/score/play/headless';

Sound.oscillator({type: 'triangle'})         // built-in subtractive synth
Sound.samples({60: 'c4.m4a', 72: 'c5.m4a'})  // one file per exact MIDI note
Sound.sfz('piano.sfz')                       // key ranges, velocity layers, round-robin
Sound.soundfont2('strings.sf2')              // .sf2/.sf3 via optional spessasynth_lib
Sound.from(toneInstrument)                   // adopt a Tone.js instrument
Sound.custom((ctx) => myHeadlessSynth)       // your own WebAudio graph

const player = new ScorePlayer(score, {synth: Sound.sfz('piano.sfz')});
await player.preload(); // optional warm-up; play() waits for loading anyway
await player.play();
```

Also exported: `Sound.fm`, `Sound.wavetable`, `Sound.noise`, `Sound.layer`,
`Sound.midiOut`, plus the lower-level `OscillatorSynth`, `SoundfontSynth`,
`RangeSampler`, and `SpessaSynthSynth`.

### SoundFont playback and the `workletUrl` recipe

`Sound.soundfont2()` plays `.sf2` / `.sf3` files through the optional
`spessasynth_lib` peer, which runs as an AudioWorklet. The package does
**not** guess the worklet module URL (a literal `?url` magic import resolves
only under Vite and breaks webpack / esbuild consumers), so you supply it
once via `Soundfont2Options.workletUrl`:

```ts
// Vite
import workletUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import {Sound} from '@webmusic/score/play/headless';

const sf2 = Sound.soundfont2('strings.sf2', {workletUrl});
```

With any other bundler, pass a URL your build emits or your app hosts:

```ts
const sf2 = Sound.soundfont2('strings.sf2', {
  workletUrl: '/assets/spessasynth_processor.min.js',
});
```

Or, when your application owns AudioWorklet registration itself, use the
escape hatch — called once per AudioContext instead of loading `workletUrl`:

```ts
const sf2 = Sound.soundfont2('strings.sf2', {
  registerWorklet: (ctx) => ctx.audioWorklet.addModule(myWorkletUrl),
});
```

Without either option, `Sound.soundfont2` fails with an error repeating this
recipe.

### Effects and racks

`Effect` mirrors `Sound`: a lazy, composable recipe inserted between the
output bus and the destination:

```ts
import {Effect, ScorePlayer, Sound} from '@webmusic/score/play/headless';

const room = Effect.chain(
  Effect.filter({type: 'lowpass', frequency: 6000}),
  Effect.delay({delaySeconds: 0.3, feedback: 0.35, wet: 0.25}),
  Effect.reverb({wet: 0.3}),
);
new ScorePlayer(score, {synth: Sound.sfz('piano.sfz'), effect: room});
```

Built-ins: `reverb`, `delay`, `filter`, `distortion`, `compressor`,
`limiter`, `gain`, `panner`, `bitcrusher`, `tremolo`, `chorus`, `analyser`,
`chain`, and `custom`.

For an ensemble, give each instrument its own player and group them in a
`Rack` — one shared AudioContext, one master bus, per-member mix strips:

```ts
import {Rack, Effect, Sound} from '@webmusic/score/play/headless';

const rack = new Rack({effect: Effect.reverb({wet: 0.25})}); // shared room
rack.add({score: violinScore, sound: Sound.sfz('violin.sfz')});
rack.add({score: celloScore, sound: Sound.sfz('cello.sfz'), effect: Effect.filter({frequency: 4000})});

await rack.play();           // every member starts together on one clock
rack.setVolume('player-0', 0.6);
rack.mute('player-1');
rack.setEffect(room);         // hot-swap the summed master bus; members keep playing
rack.effect = undefined;      // the property form restores a dry master output
rack.on('end', () => {});    // fires once all members finish
```

Built-in effects and `Effect.custom(factory)` are lazy recipes rather than
realised AudioNodes, so the same recipe can be reused by a `ScorePlayer`, an
`InteractivePlayer`, and one or more racks; every owner builds its own nodes in
its own AudioContext. `Effect.custom(existingNodePair)` is the deliberate
escape hatch: it returns those exact nodes, so do not mount that form in
multiple owners or across contexts. Rack has two deliberately separate effect
tiers:

- `new Rack({effect})`, `rack.effect`, and `rack.setEffect()` address the one
  post-processing chain after the summed master bus. Replacing it on a live
  rack swaps only that route; member players, mix state, and transport position
  are not rebuilt.
- `rack.add({effect})` (`RackAddOptions.effect`) belongs to that member alone,
  before its channel reaches the rack's master bus.

### LFO modulation

`LfoController` is the reusable DOM-free owner for shape, rate, depth, phase,
the run scheduler and a borrowed `LfoTarget`. Assigning or replacing the target
does not apply a value eagerly:

```ts
import {LfoController} from '@webmusic/score/play/headless';

const lfo = new LfoController({
  shape: 'sine',
  rate: 1,
  depth: 0.6,
  target: {
    min: 300,
    max: 9000,
    unit: 'Hz',
    apply: (value) => synth.setParam('cutoff', value),
  },
});

lfo.start();                 // scheduled modulation begins
lfo.configure({rate: 2});    // hot configuration; phase is retained
lfo.stop();                  // reusable stop; target/configuration remain
lfo.dispose();               // final cleanup; the borrowed target is untouched
```

`createLfoController()` is the equivalent factory. The controller also exposes
`snapshot()`, `subscribe()`, `setRunning()`, `setTarget()` and the pure
`lfoWave()` helper. Defaults are sine, 1 Hz, depth `0.6`, phase `0` and stopped;
rate is normalized to `0.05…12` Hz and depth to `0…1`.

### Drivers

Drivers bind external input to any `PlaybackTransport` (`ScorePlayer`
satisfies it directly, with `scrub`, `seekFraction`, `setRate`, `progress`,
and a `timeupdate` event):

```ts
import {ScorePlayer} from '@webmusic/score/play/headless';
import {bindPointer, bindScroll, bindOrientation, bindValue} from '@webmusic/score/play/drivers';

const player = new ScorePlayer(score);
player.on('timeupdate', ({progress}) => renderBar(progress));
bindPointer(player, element);                  // drag to scrub
bindScroll(player, {mode: 'position'});        // scroll position → playhead
bindOrientation(player, {mode: 'rate'});       // device tilt → tempo
bindValue(player, {getValue: () => sensor()}); // any number → seek/rate
```

Offline rendering is code-only too: `renderScoreToBuffer` /
`renderScoreToWav` / `bufferToWav` from `@webmusic/score/play/headless`.

### Playback Web Components

Registration is explicit, so the headless entries stay DOM-free:

```ts
import {defineScorePlayerElement, defineAllElements} from '@webmusic/score/play/element';
defineScorePlayerElement(); // just <score-player>
defineAllElements();              // …or the whole set (what './play/auto' calls)
```

```html
<score-player src="song.mid"></score-player>
<score-player src="song.musicxml" sound-font="/samples/{midi}.m4a"></score-player>
<rack-control></rack-control>
<note-input layout="piano" keyboard start="48" end="71"></note-input>
```

| Element | Purpose |
|---|---|
| `<score-player>` | One player: load a `src` or assign `.score`; transport plus live rate / volume / pan / loop. Assign `.controller` to present a headless `PlayerController` you already own. |
| `<rack-control>` | Mixer for a shared `Rack`. |
| `<score-recorder>` | Capture a live performance into a `Score`; replay + MIDI / MusicXML export. |
| `<note-input>` | Discrete note surface — `layout="piano\|grid\|chords"`, `keyboard` for QWERTY. |
| `<synth-panel>` | Control panel — `sections="sound,effects,envelope,eq,lfo,macros"`. |

Assign `.score`, `.sound`, `.effect`, or `.rack` as properties to override
attribute-driven defaults.

Legacy compatibility: `<score-player>`, `SimpleScorePlayerElement`, and
`defineSimpleScorePlayerElement()` remain deprecated aliases. The auto/global
bundles and `defineAllElements()` register both tags, while new code should use
the canonical `score-player` names.

`<synth-panel>` directly composes reusable Score Headless
controllers with structural presenters from `@webmusic/ui`, with no standalone
Element Adapter module between them. `<score-player>` reaches the same
transport presenter through its existing public imperative mounter, whose
signature remains a compatibility surface. Every `<synth-panel>` section uses a
published presenter, and its LFO section binds the same `LfoController`. Hiding
the LFO section
removes only its presenter, so an already-running modulation continues;
disconnecting the panel disposes the controller and stops it. The panel's
Headless boundary remains Partial, and callback-owned boundaries remain
Partial rather than inventing a Headless controller solely to satisfy the
diagram. Score depends on UI for presenters across its complete visible element
catalog, while UI does not depend back on Score, Audio or kernel.

## Analysis (`@webmusic/score/analyze`)

Headless analysis that reads a `Score` and returns plain serializable data —
no DOM, so it runs in Node, Workers, tests, and batch jobs:

```ts
import {
  summarizeScore,
  chordTimeline,
  detectKey,
  segmentChords,
  romanNumerals,
  findMotifs,
  rhythmPatterns,
  voiceLeading,
} from '@webmusic/score/analyze';

const summary = summarizeScore(score);           // metadata, counts, duration, tempo, key, range
const chords = chordTimeline(score, {windowQuarters: 1});
const key = detectKey(score);                    // {tonic, mode, confidence, scores}
const segments = segmentChords(score, {windowQuarters: 4});
const roman = romanNumerals(score, key);         // I, IV, V7 … relative to the key
const motifs = findMotifs(score, {length: 4, minOccurrences: 2});
const rhythms = rhythmPatterns(score, 4);
const issues = voiceLeading(score);              // large leaps, parallel fifths/octaves
```

`@webmusic/score/analyze/headless` adds stateful code-only components:
`createAnalysisSession`, `createLiveChordTracker`, `createLiveKeyTracker`.
The pure `createScoreReport` helper returns formatted summary rows. Whole-score
summary, distribution and rhythm reports use these code-only inputs rather than
Element wrappers; see the [report workflow](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/score/api/analyze.mdx#reports).

Heavy analysis moves off the main thread with the Worker trio:

```ts
import {createAnalysisWorker} from '@webmusic/score/analyze/worker-client';

const client = createAnalysisWorker();
const initial = await client.analyze(score, {windowQuarters: 2});
const updated = await client.update(editedScore); // latest-wins coalescing
client.dispose();
```

ESM browser consumers get the adjacent module Worker automatically; CJS (or
a blocked Worker) takes the same in-process Promise API. A ready-made Worker
instance is borrowed; one created by the default path or a factory is owned
and terminated on `dispose()`. Structured remote failures reject with
`AnalysisWorkerRemoteError` (`code`, `operation`, `retryable`). Wire types
live at `@webmusic/score/analyze/worker-protocol`; the runtime at
`@webmusic/score/analyze/worker`.

Analysis Web Components expose focused workflows and a switchable analysis view:

```ts
import {defineAllAnalysisElements} from '@webmusic/score/analyze/element';
defineAllAnalysisElements();
```

```html
<score-player id="p" src="song.mid"></score-player>
<voice-leading-analysis player="#p"></voice-leading-analysis>
<pitch-view type="keyboard" player="#p" low="48" high="84"></pitch-view>
<pitch-view type="staff" player="#p"></pitch-view>
```

The analysis lane and pitch views are explicit siblings. Register the View tags
with their `define*Element()` helpers from `@webmusic/score/view/element`.
Each Analyze tag renders one core surface; display configuration belongs to its
attributes, and supporting keyboards, staffs or fretboards remain reusable View
components. They borrow the player's existing data or held-note state and own no
playback graph.

Five Analyze tags cover chord progression, the current chord, key changes,
Roman harmony and voice leading. The
[Analyze overview](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/score/element/index.mdx#analyze)
selects and documents them. Each live demo contains its player and the current
tag, with external Parameters.

Candidate rankings, tonal comparisons, pitch weights and retained chord updates
remain application-owned diagnostics using the
[Headless trackers and projections](https://github.com/koperative-lab/WebMusic/blob/main/apps/doc/webmusic/src/content/docs/score/headless/analyze/live-trackers.mdx).
Motif search remains an API/Headless result. Choose a fixed musical surface for
live display; disconnecting it releases its resources and leaves playback with
its owner.

## React (`@webmusic/score/react`)

Two levels of API behind the optional `react >= 18` peer.

Ready-made presets for direct JSX use:

```tsx
import {SimpleScoreWorkspace} from '@webmusic/score/react';

export function Page({score}) {
  return (
    <SimpleScoreWorkspace
      score={score}
      analysis
      pianoRoll={{width: 720, height: 240}}
      staff={{width: 720, height: 220}}
      waterfall={{width: 720, height: 320}}
    />
  );
}
```

Pass `analysis={false}` / `staff={false}` / `waterfall={false}` to disable
parts, or use a single preset (`<SimpleScorePlayer score={score} />`,
`<SimpleStaff />`, `<SimplePianoRoll />`, `<SimpleWaterfall />`).

Provider + hooks + views for custom application design:

```tsx
import {ScoreProvider, useCursor, usePlayer, useScore, PlayerControls, PianoRollView} from '@webmusic/score/react';

function App({score}) {
  return (
    <ScoreProvider score={score} playerOptions={{tempo: 96}}>
      <PlayerControls />
      <PianoRollView width={720} height={240} />
      <CursorReadout />
    </ScoreProvider>
  );
}

function CursorReadout() {
  const cursor = useCursor();
  return <span>m.{cursor?.measure} b.{cursor?.beat}</span>;
}
```

`useScoreAnalysis({windowQuarters: 4})` exposes analysis results as React
state; `<AnalysisSummary />` renders them. For large scores,
`useScoreAnalysisAsync()` returns `{result, pending, error}` and works
through the analysis Worker client. Your app provides the `Score` (parse
one with `@webmusic/score/io`); the bindings do not own an app shell.

## CDN / `<script>` usage

A browser IIFE with built-in playback and UI ships at `dist/play/auto.global.js`. It
registers every playback element and exposes the `WebMusicScorePlay` global:

```html
<script src="https://unpkg.com/@webmusic/score/dist/play/auto.global.js"></script>

<score-player src="song.mid"></score-player>
<note-input layout="piano" keyboard></note-input>

<script>
  // Element classes and define* helpers are on the global:
  console.log(WebMusicScorePlay);
</script>
```

The same file resolves from the `@webmusic/score/play/global` subpath for
tooling that wants it by name. Bundler users should prefer
`import '@webmusic/score/play/auto'` (side-effect registration) or explicit
`define*` calls from `@webmusic/score/play/element` instead.

The optional SoundFont backend stays outside the IIFE and loads only when an
SF2/SF3 route connects. Direct browser applications using this backend must
provide an import map before loading scripts. For example, these pinned mappings
resolve Spessa and its transitive module imports:

```html
<script type="importmap">
{
  "imports": {
    "spessasynth_lib": "https://unpkg.com/spessasynth_lib@4.3.14/dist/index.js",
    "spessasynth_core": "https://unpkg.com/spessasynth_core@4.3.20/dist/index.js",
    "stb-vorbis": "https://unpkg.com/stb-vorbis@0.0.6/dist/index.js"
  }
}
</script>
```

Applications may host these modules themselves, or map `spessasynth_lib` to a
browser-ready bundle. The AudioWorklet remains a separate resource: supply
`workletUrl` or `registerWorklet` as shown in the SoundFont recipe above. Normal
module bundlers resolve an installed Spessa peer through the lazy ESM/CJS import;
the IIFE-only external setting does not change that integration.

## Optional peer dependencies

The core install stays lean; each optional peer unlocks one capability:

| Peer | Version | Unlocks |
|---|---|---|
| `opensheetmusicdisplay` | `>=1.8.0` | OSMD staff engraving in `./view/render` (`renderOSMDStaffVisualizer`). |
| `spessasynth_lib` | `^4.0.0` | `Sound.soundfont2()` — `.sf2` / `.sf3` SoundFont playback (see the `workletUrl` recipe above). |
| `tone` | `>=14.0.0` | `TonePlayer` — playback on an injected `Tone.Transport`, and `Sound.from(toneInstrument)`. |
| `react` | `>=18` | `@webmusic/score/react` hooks and components. |
| `@webmusic/ui` | `^0.1.0` | `/element`, `/auto`, visible analysis elements and default Web Component presenters. |

Everything else — parsing, the built-in oscillator / FM / wavetable / sampler
sounds, Headless views and analysis — works without optional peers.

## Ecosystem

`@webmusic/score` is the symbolic-music layer of the WebMusic family:

- [`@webmusic/kernel`](https://www.npmjs.com/package/@webmusic/kernel) — the
  shared primitives this package builds on (a required peer).
- `@webmusic/ui` — domain-neutral styles and presenters used by all visible
  Score Web Components (an optional peer for browser UI entries).
- `@webmusic/audio` — audio-signal capabilities, maintained on `dev` for a later release.
- `@webmusic/bridge` — score ↔ audio interop, maintained on `dev` for a later release.

## License

MIT

For source contributions and release verification, see the
[contribution guide](https://github.com/koperative-lab/WebMusic/blob/main/CONTRIBUTING.md).
