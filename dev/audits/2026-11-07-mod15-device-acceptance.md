# MOD-15 device acceptance (2026-11-07)

This record holds the device half of VERIFY-01 for the DEC-068 single
composition model (MOD-15, rounds 1–20 on `modular-redesign`). Its first section
records what automated and scripted browser checks already established. The
manual checks cover what only a person with ears, real devices and assistive
technology can accept. They run in the
[manual acceptance runner](../../apps/test/README.md), outside the documentation
site; its catalog (`apps/test/src/checks.ts`) is the single list of checks.
[STATUS](../STATUS.md) owns the remaining gap; this file keeps the dated evidence.

## Already verified without a person

Baseline: `modular-redesign` after round 17; round 18 adds the runner and the
in-place score fix found with it. `npm run check` and
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
| Runner D4 (round 18) | Assigning `.score` during Session playback failed with “ScorePlayer transport is owned by its Session”; fixed, it now stops at 0 with the new duration (8.0 s for the 16-beat opening) and plays again, while `.sound` keeps the position (2.3 s → 3.3 s) |
| Runner H1–H3 (round 18) | Offline graph 12 s in 71 ms, every window sounding; edited document matches 1.000 before and after the cut, control −0.001; code-built Score + Audio Session plays and pauses with 2 participants |

None of these establish audible timing, latency, device output, background-tab
behavior, touch or screen-reader use. That is what the manual checks are for.

## Running the manual checks

```bash
npm run test:manual
```

Open <http://localhost:4331>, confirm the build shown on **0 · Before you start**,
fill in the environment, then work through the 25 checks in eight groups. Each
one mounts a live canvas of the packages' own components:

| Group | Checks | Covers |
| --- | --- | --- |
| A Composed desk | A1–A4 | One Session over Score, Audio and a Rack part; faders, mute, solo; one shared reverb in two panels; seek, pause and resume |
| B Rack parts and channels | B1–B2 | Three parts under one desk; a recorder's own channel inside a desk |
| C Note input and recording | C1–C2 | Monitoring without stuck notes; take playback and MIDI/MusicXML export |
| D Score playback and companions | D1–D4 | Staff and keyboard following; seek; background tab; in-place `.sound` and `.score` |
| E Audio player, playlist and mixer | E1–E4 | Play, seek and rate; queue entries and loop; mixer channels; an edited document |
| F Microphone and analysis | F1–F3 | Microphone capture; a meter following its player; analysers behind a playlist |
| H Offline rendering and Score + Audio | H1–H3 | Listen to offline renders of a graph and an edited document; a code-built Session |
| G Accessibility and input | G1–G3 | Keyboard only, screen reader, narrow width and touch, on the earlier compositions |

Suggested minimum environments: desktop Chrome, desktop Safari or Firefox, and
an iPhone or Android phone. Run F1 on the desktop `localhost` URL, because phones
block the microphone on plain-HTTP network addresses.

## Where results go

Manual results are never committed. The runner keys them to the build under
test (version, commit, working tree) and exports one Markdown report, which the
person who accepted the build keeps outside Git (for example in the ignored
`acceptance-reports/` folder). A release reads that report with
`npm run release:acceptance -- <report>`, the third gate in
[PUBLISHING](../release/PUBLISHING.md#gate-3-manual-acceptance-of-the-exact-commit).

## Findings from the first manual sitting, fixed in round 19

The owner's first sitting (2026-11-09, round 18 build) reported six problems.
Round 19 traced and fixed each one; every fix has a regression test that fails
without it and was checked in the built-in Chromium against the runner:

| Finding | Cause | Fix and check |
| --- | --- | --- |
| A1: the outer progress bar did not move | A source-free Session root's transport redrew only on Session events; the Session publishes state changes, not position | The control redraws every frame while the Session runs; the readout advanced 0:03 → 0:05 with the desk playing |
| A1: two effect panels | The desk composition showed A3's second panel in every A check | A1, A2 and A4 show one reverb panel; A3 keeps two |
| D1: player display wrong | Showing a Session-bound player's transport cleared the inline `display: flex` its presenter paints, so the bar and time wrapped onto separate rows | Visibility restores the node's own inline display; the D1 transport is one row again |
| D4: long stutter while playing | A `Sound` reports its capabilities only once connected, so a fresh sound looked like a timing-class change; the player was rebuilt and the staff view re-engraved the whole piece (about 450 ms on the main thread per change) | `ScorePlayer.replaceSynth` compares the connected candidate; a sound change now takes 1–6 ms with no long task and the new sound is live on the same engine |
| E2/F3: “4 consecutive drift corrections failed to converge (drift 0.06 s)” | The Session starts members at a shared instant 60 ms ahead; the playlist ignored that start time and its entry ran 60 ms early, so every drift re-join landed early again | `AudioPlaylist.play(when)` passes the instant to the entry; the streaming engine waits it out before starting its media element. Over WAV, WAV and the streamed MP3: no re-join, offset 0, 0 and −0.023 s, no error |
| E4: no sound from the edited document | An `<audio-player>` treated its editor document's sequence engine as a borrowed group, so Play bypassed the Session and its output was never routed | A document is the player's own Session source; Play starts the Session and the output route is active (analyser peak 0.10 from the on-screen button) |

VERIFY-01 for MOD-15 closes when an accepted report verifies against the
release commit on the minimum environments above; the release then moves to
RELEASE-01.
