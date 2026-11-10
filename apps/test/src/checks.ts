// The manual acceptance catalog. Every check names what to do and what must
// hold, and mounts a live canvas of the packages' own components only while it
// is open, so one check's audio never overlaps another's. All musical material
// is Arabesque No. 1. This module is pure data; the mounts load lazily.
import type {Check, Group} from './model';

const desk = () => import('./checks/desk').then((module) => module.mountComposedDesk);
const sharedEffectDesk = () => import('./checks/desk').then((module) => module.mountSharedEffectDesk);
const rackParts = () => import('./checks/rack').then((module) => module.mountRackParts);
const recorderDesk = () => import('./checks/rack').then((module) => module.mountRecorderInDesk);
const notes = () => import('./checks/notes').then((module) => module.mountNoteRecorder);
const scorePlayer = () => import('./checks/score').then((module) => module.mountScoreCompanions);
const replacement = () => import('./checks/score').then((module) => module.mountInPlaceReplacement);
const audioPlayer = () => import('./checks/audio').then((module) => module.mountAudioPlayer);
const playlist = () => import('./checks/audio').then((module) => module.mountPlaylist);
const mixer = () => import('./checks/audio').then((module) => module.mountMixer);
const documentEdit = () => import('./checks/audio').then((module) => module.mountDocumentEditing);
const microphone = () => import('./checks/audio').then((module) => module.mountMicrophone);
const meter = () => import('./checks/audio').then((module) => module.mountMeter);
const offlineScore = () => import('./checks/offline').then((module) => module.mountOfflineScore);
const offlineDocument = () => import('./checks/offline').then((module) => module.mountOfflineDocument);
const scoreAudioSession = () => import('./checks/offline').then((module) => module.mountScoreAudioSession);
const tour = () => import('./checks/tour').then((module) => module.mountAccessibilityTour);
const narrowTour = () => import('./checks/tour').then((module) => module.mountNarrowTour);

export const GROUPS: readonly Group[] = [
  {id: 'A', title: 'Composed desk'},
  {id: 'B', title: 'Rack parts and channels'},
  {id: 'C', title: 'Note input and recording'},
  {id: 'D', title: 'Score playback and companions'},
  {id: 'E', title: 'Audio player, playlist and mixer'},
  {id: 'F', title: 'Microphone and analysis'},
  {id: 'H', title: 'Offline rendering and Score + Audio'},
  {id: 'G', title: 'Accessibility and input'},
];

export const CHECKS: readonly Check[] = [
  {
    id: 'A1', group: 'A', mount: desk,
    title: 'One transport starts every member together',
    steps: [
      'Press Play on the outer player.',
      'Listen to the first 10 seconds.',
    ],
    expected: [
      'The piano score, the Arabesque recording and the triangle pad start together, with no flam or offset.',
      'The spectrum moves with the mixed sound.',
    ],
  },
  {
    id: 'A2', group: 'A', mount: desk,
    title: 'Faders, mute and solo affect only their channel',
    steps: [
      'While playing, move each channel fader and then the master fader.',
      'Mute and solo each channel in turn, then clear them.',
    ],
    expected: [
      'Only that member (or the whole mix) changes level; nothing restarts, drops out or clicks.',
      'Solo leaves only that channel; clearing restores the mix.',
    ],
  },
  {
    id: 'A3', group: 'A', mount: sharedEffectDesk,
    title: 'Two panels edit one shared reverb',
    steps: [
      'While playing, change the reverb wet in the left panel.',
      'Change it back in the right panel.',
    ],
    expected: [
      'The other panel follows immediately.',
      'The reverb changes audibly once, never doubled.',
    ],
  },
  {
    id: 'A4', group: 'A', mount: desk,
    title: 'Seek, pause and resume move every member together',
    steps: [
      'While playing, seek to the middle.',
      'Pause for 3 seconds, then resume.',
    ],
    expected: [
      'Every member jumps together and resumes from the same place.',
      'Pause is silent, with no hanging notes.',
    ],
  },
  {
    id: 'B1', group: 'B', mount: rackParts,
    title: 'Three Rack parts stay together',
    steps: [
      'Play, mute lead, solo bass, then clear both.',
      'Move the pad fader, then pause, seek and resume.',
    ],
    expected: [
      'Mute silences only lead; solo leaves only bass.',
      'The three parts stay together and keep their levels across pause and resume.',
    ],
  },
  {
    id: 'B2', group: 'B', mount: recorderDesk,
    title: 'A recorder in a desk has its own channel',
    steps: [
      'Play a few keys on the keyboard inside the desk.',
      'Pull the channel named rec down and play again; then mute it.',
      'Record a take, audition it with the recorder’s play button and move the same fader.',
    ],
    expected: [
      'After the first key, the desk shows exactly one rec channel.',
      'Live monitoring and the audition both follow the rec fader and mute.',
      'The audition does not start the score player above.',
    ],
  },
  {
    id: 'C1', group: 'C', mount: notes,
    title: 'Note input sounds immediately with no stuck notes',
    steps: [
      'Press record; play 4 notes with the mouse and 4 with the computer keyboard (touch on a phone).',
      'Repeat one key quickly, then hold several keys and release them.',
      'Press stop.',
    ],
    expected: [
      'Each note sounds on press and stops on release; no note sticks.',
      'The recorder’s note count matches what you played.',
    ],
  },
  {
    id: 'C2', group: 'C', mount: notes,
    title: 'Play back and export the take',
    steps: [
      'Record a short rhythmic phrase, stop, press the recorder’s play button.',
      'Export MIDI and MusicXML and open both in another program.',
    ],
    expected: [
      'Playback matches the pitches and rhythm you played.',
      'Both files download and open with the same notes.',
    ],
  },
  {
    id: 'D1', group: 'D', mount: scorePlayer,
    title: 'Staff cursor and keyboard follow the sound',
    steps: [
      'Play the Arabesque and watch the first 30 seconds.',
    ],
    expected: [
      'The staff cursor and the lit keys stay on the sounding notes, with no drift by the end.',
    ],
  },
  {
    id: 'D2', group: 'D', mount: scorePlayer,
    title: 'Views follow a seek immediately',
    steps: [
      'Seek several times while playing and while paused.',
    ],
    expected: [
      'The cursor and keys move at once and the sound resumes from the new place.',
      'Seeking while paused stays silent and leaves no lit keys.',
    ],
  },
  {
    id: 'D3', group: 'D', mount: scorePlayer,
    title: 'Playback continues in a background tab',
    steps: [
      'While playing, switch to another tab for 30 seconds, then return.',
    ],
    expected: [
      'Sound continued without long gaps; on return the views match the position.',
    ],
  },
  {
    id: 'D4', group: 'D', mount: replacement,
    title: 'Replace sound and score in place',
    steps: [
      'While playing, switch the sound in Parameters: triangle, sine, square.',
      'While playing, switch the score to “Opening 16 beats”, then back to “Whole piece”.',
    ],
    expected: [
      'A sound change keeps the position and changes the timbre at once, without restarting.',
      'A score change stops at 0 with no error; the duration readout changes, the views show the new score, and Play plays it.',
    ],
  },
  {
    id: 'E1', group: 'E', mount: audioPlayer,
    title: 'Audio player: play, seek, rate',
    steps: [
      'Play the Arabesque recording and seek several times.',
      'Change the playback rate, then restore it.',
    ],
    expected: [
      'Seeks do not click; the time readout matches what you hear.',
      'After a rate change, readout and sound still agree.',
    ],
  },
  {
    id: 'E2', group: 'E', mount: playlist,
    title: 'Playlist entries, next, previous and loop',
    steps: [
      'Play and seek inside the entry.',
      'Press next, then previous.',
      'Seek near the end of the last entry and let it finish.',
    ],
    expected: [
      'Each entry’s time starts at 0 and the selected entry plays.',
      'With loop on, the queue wraps to the first entry and continues.',
      'The player controls always agree with what is playing.',
    ],
  },
  {
    id: 'E3', group: 'E', mount: mixer,
    title: 'Mixer channels are independent',
    steps: [
      'Play, then adjust track A and track B in turn.',
    ],
    expected: [
      'Each control changes only its own track, and both stay in time.',
    ],
  },
  {
    id: 'E4', group: 'E', mount: documentEdit,
    title: 'An edited audio document plays as edited',
    steps: [
      'Select seconds 1 to 3 on the waveform and delete them.',
      'Play from the start; then undo and play from the start again.',
    ],
    expected: [
      'After the cut, second 1 continues straight into the original second 3, with no click at the join.',
      'Undo restores the original.',
    ],
  },
  {
    id: 'F1', group: 'F', mount: microphone,
    title: 'Microphone recording',
    steps: [
      'Press record, allow the microphone, speak or play for 5 seconds, stop and play back.',
      'Reload, record again and deny the permission.',
    ],
    expected: [
      'The take sounds like your input, with no added echo.',
      'Denying shows the error state instead of waiting forever.',
    ],
  },
  {
    id: 'F2', group: 'F', mount: meter,
    title: 'Meter follows its player',
    steps: [
      'Play, pause, then seek and resume.',
    ],
    expected: [
      'The meter moves with the music, falls to rest on pause and resets after a seek.',
    ],
  },
  {
    id: 'F3', group: 'F', mount: playlist,
    title: 'An analyser behind a playlist sees its output',
    steps: [
      'While the playlist plays, watch the spectrum and meter below; press next.',
    ],
    expected: [
      'Spectrum and meter move, and keep moving after the entry changes.',
    ],
  },
  {
    id: 'H1', group: 'H', mount: offlineScore,
    title: 'Offline render of a whole module graph',
    steps: [
      'The graph renders when the check opens. Play the result with the player in the live canvas; “Render 12 s” in Parameters renders it again.',
    ],
    expected: [
      'Rendering takes far less than 12 seconds.',
      'All 12 seconds of the result are the Arabesque piano, with no silence or stalls.',
    ],
  },
  {
    id: 'H2', group: 'H', mount: offlineDocument,
    title: 'Offline render of an edited audio document',
    steps: [
      'The edited document renders when the check opens. Play the result with the player in the live canvas; “Render edited document” in Parameters renders it again.',
    ],
    expected: [
      'At second 1 it jumps to the recording’s second 2 (one second cut), and keeps sounding.',
      'The “before/after cut” match readouts are close to 1.000.',
    ],
  },
  {
    id: 'H3', group: 'H', mount: scoreAudioSession,
    title: 'Score + Audio Session assembled in code',
    steps: [
      'Press play on the Session transport in the live canvas, listen for 10 s and pause; then press “Play from 30 s” in Parameters.',
    ],
    expected: [
      'Piano and recording start and pause together and resume together at 30 s.',
      'The readout shows two participants and an advancing position.',
    ],
  },
  {
    id: 'G1', group: 'G', mount: tour,
    title: 'Keyboard only',
    steps: [
      'Put the mouse aside. In the live canvas, use Tab, Shift+Tab, Space, Enter and the arrow keys only.',
      'Play and seek the desk, move a fader, mute and solo a channel, turn the reverb wet knob.',
      'Play notes on the piano keys from the keyboard, record a take and play it back.',
      'Play the recording, move to the next queue entry and back.',
    ],
    expected: [
      'Every control shows a visible focus ring and every action is reachable.',
      'Focus never gets trapped and never jumps to the top of the page.',
    ],
  },
  {
    id: 'G2', group: 'G', mount: tour,
    title: 'Screen reader',
    steps: [
      'Turn on VoiceOver (macOS/iOS), NVDA (Windows) or TalkBack (Android).',
      'Move through every control in the live canvas and operate play, a fader, mute, record and the queue.',
    ],
    expected: [
      'Each control announces its name, its value and its state (playing, muted, recording, selected entry).',
      'Changes you make are announced; nothing is announced as an unlabelled button.',
    ],
  },
  {
    id: 'G3', group: 'G', mount: narrowTour,
    title: 'Narrow width and touch',
    steps: [
      'On a desktop, choose each canvas width in Parameters (480, 375, 320 px) and operate the live canvas.',
      'On a phone or tablet, leave the width at Full and operate every control by touch.',
    ],
    expected: [
      'No control is clipped or overlaps another, and the page never scrolls sideways.',
      'Touch targets are hit reliably; dragging a fader or the seek bar does not scroll the page.',
    ],
  },
];
