# MOD-15 device acceptance (2026-11-07)

This record is the owner's procedure for the device half of VERIFY-01 for the
DEC-068 single composition model (MOD-15, rounds 1–17 on `modular-redesign`).
Its first section records what automated and scripted browser checks already
established. The checklist then covers what only a person with ears, real
devices and assistive technology can accept. Fill in the result columns; leave
a failed row's notes concrete enough to reproduce. [STATUS](../STATUS.md) owns
the remaining gap; this file keeps the dated evidence.

## Already verified without a person

Baseline: `modular-redesign` after round 17. `npm run check` and
`npm run docs:build` pass. Scripted checks ran in the desktop app's built-in
Chromium against the built site (`astro preview`), with Arabesque No. 1 from the
site's own `public/` folder:

| Scenario | Observed |
| --- | --- |
| `renderModuleGraph()` of 12 s of the MIDI through a Rack channel | Real `OfflineAudioContext`, about 60 ms, sound in every window; without ticks only the first window sounds |
| Score + Audio in one offline Session and Rack | Both channels admitted and sounding |
| Edited WAV document rendered offline (1–2 s cut, two segments) | After the Session's 60 ms start lead, output equals the source sample for sample before the cut (correlation 1.000, level 1.00) and equals the source 1 s later after it; the unshifted control does not match (−0.001). Before round 17 this render was silent after 0.2 s and the Bridge adapter rejected the document player |
| `score-recorder` inside `score-rack-control` | The desk had no channels before; live monitoring opened exactly one channel `rec` (peak 0.11 on its tap); the take audition sounded on the same channel (peak 0.088); the recorder lists `notes` input and `output` |
| Playlist demo | Session position follows the entry (20.94 s against 21.0 s after a seek), re-anchors at 0 on the next entry, one participant |
| Mixer demo | `channel:track A` and `channel:track B` taps listed; a tap carries signal |
| Quick Start | `.score` assignment keeps the output port and Session membership |

None of these establish audible timing, latency, device output, background-tab
behavior, touch or screen-reader use. That is what the checklist below is for.

## Before you start

1. Start the site from a clean build:

   ```bash
   npm run dev:restart
   ```

   Open the printed localhost URL in a desktop browser. For a phone or tablet,
   start it on the network instead (`npm run docs:dev -- --host`) and open the
   printed network URL. Plain-HTTP network origins are not secure contexts:
   microphone checks need the desktop `localhost` URL (or an HTTPS
   deployment).
2. Use wired headphones or a known speaker, system volume at a comfortable
   level, and no other audio app playing.
3. Fill in one environment row per device/browser you test.

| # | Device and OS | Browser and version | Output (speaker, headphones, interface) | Microphone | Date |
| --- | --- | --- | --- | --- | --- |
| E1 | | | | | |
| E2 | | | | | |
| E3 | | | | | |

Suggested minimum: E1 desktop Chrome, E2 desktop Safari or Firefox, E3 an iPhone
or Android phone.

## Checklist

Routes are site paths; prefix them with the site's base when it has one.
"Pass" means every expected point holds.

### A. One transport for a composed desk — `/bridge/modular-composition/`

1. Press the outer **Play**. Expected: the piano score, the recorded Arabesque
   and the triangle pad start together, with no flam or audible offset between
   the Score and Audio members, and the spectrum moves.
2. Move each member fader and the master fader. Expected: only that member (or
   the whole mix) changes level; nothing restarts or clicks.
3. Change a room parameter in one panel. Expected: the other panel follows and
   the reverb changes audibly once.
4. Seek to the middle, pause, resume. Expected: every member jumps together and
   resumes from the same place.

### B. Rack parts and channels — `/score/element/play/score-rack-control/`

1. Play, then mute and solo parts. Expected: muting silences only that part;
   solo leaves only that part; levels persist when you pause and resume.
2. Move each part's fader while playing, then pause and seek. Expected: the
   three parts (lead, bass, pad) stay together and keep their levels.

### C. Recorder and note input — `/score/element/play/score-recorder/` and `/score/element/play/score-note-input/`

1. Press record, play eight notes on the on-screen keys (mouse, then the
   computer keyboard, then touch on the phone), press stop.
   Expected: each key sounds immediately while recording, with no stuck note;
   the take count is eight.
2. Play the take. Expected: the take's rhythm matches what you played; nothing
   else in the page starts.
3. Export MIDI and MusicXML. Expected: both download and open in another
   notation program with the same notes.

### D. Score player and companions — `/quick-start/`

1. Play the Arabesque. Expected: the staff cursor and the highlighted keyboard
   keys stay on the sounding notes for the whole passage; no drift by the end.
2. Seek several times while playing and while paused. Expected: the cursor and
   keyboard follow immediately and the sound resumes from the new place.
3. Switch the tab to the background for 30 s while playing, then come back.
   Expected: playback continued without long gaps; record any gap you heard.

### E. Audio player, playlist and mixer — `/audio/element/play/audio-player/`, `/audio/element/play/audio-playlist/`, `/audio/element/play/audio-mixer/`

1. Audio player: play, seek, change rate if offered. Expected: no clicks on
   seek; the time readout matches what you hear.
2. Playlist: play, seek inside an entry, press next and previous, let the last
   entry finish with loop on. Expected: the readout restarts at 0 for each
   entry, the right entry sounds, the queue wraps once, and the player's
   controls never disagree with what is playing.
3. Mixer: play, then move each channel's controls. Expected: each changes only
   its own track, and both tracks stay in time with each other.

### F. Microphone and analysis — `/audio/element/play/audio-recorder/`, `/audio/element/analyze/audio-meter/`

1. Recorder: allow the microphone, record 5 s, stop, play back. Expected: the
   take sounds like your input with no added echo; denying permission shows
   the error state instead of hanging.
2. Meter: play the linked source. Expected: the meter moves with the music,
   falls to rest on pause, and resets after a seek.

### G. Accessibility and input on the same pages

1. Keyboard only (Tab, Shift+Tab, Space, Enter, arrow keys): operate Play,
   seek, faders and the recorder. Expected: visible focus on every control and
   every action reachable.
2. Screen reader (VoiceOver on macOS or iOS, TalkBack on Android): Expected:
   each control announces its name and state (playing, muted, recording).
3. Phone at 320–480 px width: Expected: no clipped controls, no horizontal
   scrollbar, touch targets usable.

## Results

| Check | E1 | E2 | E3 | Notes (what you heard or saw when it failed) |
| --- | --- | --- | --- | --- |
| A1–A4 composed desk | | | | |
| B1–B2 Rack parts | | | | |
| C1–C3 recorder and note input | | | | |
| D1–D3 Score player and companions | | | | |
| E1–E3 Audio player, playlist, mixer | | | | |
| F1–F2 microphone and analysis | | | | |
| G1–G3 accessibility and input | | | | |

When every row passes on the minimum environments, VERIFY-01 for MOD-15 can be
closed in STATUS and the release work moves to RELEASE-01 (remote CI for the
final commit, registry checks and publication in dependency order).
