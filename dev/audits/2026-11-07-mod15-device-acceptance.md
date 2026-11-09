# MOD-15 device acceptance (2026-11-07)

This record holds the device half of VERIFY-01 for the DEC-068 single
composition model (MOD-15, rounds 1–18 on `modular-redesign`). Its first section
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

Open <http://localhost:4331>, fill in **0 · Before you start**, then work through
the 25 checks in eight groups. Each one mounts its own composition:

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

## Results

Paste the runner's **Copy Markdown** output here, one block per testing date.
No device results have been recorded yet.

When every check passes on the minimum environments, VERIFY-01 for MOD-15 can be
closed in STATUS and the release work moves to RELEASE-01 (remote CI for the
final commit, registry checks and publication in dependency order).
