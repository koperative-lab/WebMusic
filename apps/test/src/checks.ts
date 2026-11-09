// The manual acceptance catalog. Every check names what to do and what must
// hold; its composition mounts only while the check is open, so one check's
// audio never overlaps another's. All musical material is Arabesque No. 1.
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

export const GROUPS: readonly Group[] = [
  {id: 'A', title: {zh: '组合调音台', en: 'Composed desk'}},
  {id: 'B', title: {zh: 'Rack 分轨与通道', en: 'Rack parts and channels'}},
  {id: 'C', title: {zh: '音符输入与录音', en: 'Note input and recording'}},
  {id: 'D', title: {zh: '乐谱播放与伴随视图', en: 'Score playback and companions'}},
  {id: 'E', title: {zh: '音频播放、播放列表与混音', en: 'Audio player, playlist and mixer'}},
  {id: 'F', title: {zh: '麦克风与分析', en: 'Microphone and analysis'}},
  {id: 'H', title: {zh: '离线渲染与 Score + Audio', en: 'Offline rendering and Score + Audio'}},
  {id: 'G', title: {zh: '无障碍与输入', en: 'Accessibility and input'}},
];

export const CHECKS: readonly Check[] = [
  {
    id: 'A1', group: 'A', mount: desk,
    title: {zh: '一个走带控制同时启动所有声部', en: 'One transport starts every member together'},
    steps: [
      {zh: '按最外层播放器的播放键。', en: 'Press Play on the outer player.'},
      {zh: '听开头 10 秒。', en: 'Listen to the first 10 seconds.'},
    ],
    expected: [
      {zh: '钢琴乐谱、Arabesque 录音和三角波 pad 同时开始，听不出先后或拍子错开。', en: 'The piano score, the Arabesque recording and the triangle pad start together, with no flam or offset.'},
      {zh: '频谱跟着混合后的声音动。', en: 'The spectrum moves with the mixed sound.'},
    ],
  },
  {
    id: 'A2', group: 'A', mount: desk,
    title: {zh: '推子、静音、独奏只影响对应通道', en: 'Faders, mute and solo affect only their channel'},
    steps: [
      {zh: '播放中依次拉动每个通道推子和总推子。', en: 'While playing, move each channel fader and then the master fader.'},
      {zh: '依次静音、独奏每个通道，再取消。', en: 'Mute and solo each channel in turn, then clear them.'},
    ],
    expected: [
      {zh: '只有对应的声部（或整个混音）音量变化，没有重新开始、断音或爆音。', en: 'Only that member (or the whole mix) changes level; nothing restarts, drops out or clicks.'},
      {zh: '独奏时只剩该通道；取消后恢复原样。', en: 'Solo leaves only that channel; clearing restores the mix.'},
    ],
  },
  {
    id: 'A3', group: 'A', mount: sharedEffectDesk,
    title: {zh: '两个面板编辑同一个混响', en: 'Two panels edit one shared reverb'},
    steps: [
      {zh: '播放中在左边面板改混响的 wet。', en: 'While playing, change the reverb wet in the left panel.'},
      {zh: '再在右边面板改回去。', en: 'Change it back in the right panel.'},
    ],
    expected: [
      {zh: '另一个面板的数值立刻跟着变。', en: 'The other panel follows immediately.'},
      {zh: '混响听起来只变了一次，没有叠成两层。', en: 'The reverb changes audibly once, never doubled.'},
    ],
  },
  {
    id: 'A4', group: 'A', mount: desk,
    title: {zh: 'seek、暂停、继续时所有声部一起动', en: 'Seek, pause and resume move every member together'},
    steps: [
      {zh: '播放中把进度拖到中间。', en: 'While playing, seek to the middle.'},
      {zh: '暂停 3 秒后继续。', en: 'Pause for 3 seconds, then resume.'},
    ],
    expected: [
      {zh: '所有声部一起跳到新位置，并从同一位置继续。', en: 'Every member jumps together and resumes from the same place.'},
      {zh: '暂停时完全安静，没有残留的长音。', en: 'Pause is silent, with no hanging notes.'},
    ],
  },
  {
    id: 'B1', group: 'B', mount: rackParts,
    title: {zh: '三个 Rack 分轨保持同步', en: 'Three Rack parts stay together'},
    steps: [
      {zh: '播放后静音 lead，再独奏 bass，再全部取消。', en: 'Play, mute lead, solo bass, then clear both.'},
      {zh: '拉动 pad 的推子，然后暂停、seek、继续。', en: 'Move the pad fader, then pause, seek and resume.'},
    ],
    expected: [
      {zh: '静音只关掉 lead；独奏只留下 bass。', en: 'Mute silences only lead; solo leaves only bass.'},
      {zh: '三个分轨始终同步，暂停继续后音量保持。', en: 'The three parts stay together and keep their levels across pause and resume.'},
    ],
  },
  {
    id: 'B2', group: 'B', mount: recorderDesk,
    title: {zh: '调音台里的录音器有自己的通道', en: 'A recorder in a desk has its own channel'},
    steps: [
      {zh: '在调音台下方的键盘上按几个键。', en: 'Play a few keys on the keyboard inside the desk.'},
      {zh: '把名为 rec 的通道推子拉低，再按键；然后静音它。', en: 'Pull the channel named rec down and play again; then mute it.'},
      {zh: '录一段，按录音器的播放键试听，同时拉这个推子。', en: 'Record a take, audition it with the recorder’s play button and move the same fader.'},
    ],
    expected: [
      {zh: '按键后调音台出现且只出现一个 rec 通道。', en: 'After the first key, the desk shows exactly one rec channel.'},
      {zh: '实时监听和试听都跟着 rec 推子和静音变化。', en: 'Live monitoring and the audition both follow the rec fader and mute.'},
      {zh: '试听不会让上方的乐谱播放器开始播放。', en: 'The audition does not start the score player above.'},
    ],
  },
  {
    id: 'C1', group: 'C', mount: notes,
    title: {zh: '音符输入立刻发声，没有卡音', en: 'Note input sounds immediately with no stuck notes'},
    steps: [
      {zh: '按录音键，用鼠标弹 4 个音、电脑键盘弹 4 个音（手机上用触屏）。', en: 'Press record; play 4 notes with the mouse and 4 with the computer keyboard (touch on a phone).'},
      {zh: '快速连按同一个键，再同时按住几个键后松开。', en: 'Repeat one key quickly, then hold several keys and release them.'},
      {zh: '按停止。', en: 'Press stop.'},
    ],
    expected: [
      {zh: '每个音按下就响，松开就停，没有卡住的音。', en: 'Each note sounds on press and stops on release; no note sticks.'},
      {zh: '录音器显示的音符数与你弹的数量一致。', en: 'The recorder’s note count matches what you played.'},
    ],
  },
  {
    id: 'C2', group: 'C', mount: notes,
    title: {zh: '回放和导出录下的片段', en: 'Play back and export the take'},
    steps: [
      {zh: '录一段带节奏的旋律后停止，按录音器的播放键。', en: 'Record a short rhythmic phrase, stop, press the recorder’s play button.'},
      {zh: '分别导出 MIDI 和 MusicXML，用别的软件打开。', en: 'Export MIDI and MusicXML and open both in another program.'},
    ],
    expected: [
      {zh: '回放的音高和节奏与你弹的一致。', en: 'Playback matches the pitches and rhythm you played.'},
      {zh: '两个文件都能下载并打开，音符相同。', en: 'Both files download and open with the same notes.'},
    ],
  },
  {
    id: 'D1', group: 'D', mount: scorePlayer,
    title: {zh: '五线谱光标和键盘高亮跟着声音', en: 'Staff cursor and keyboard follow the sound'},
    steps: [
      {zh: '播放 Arabesque，看完前 30 秒。', en: 'Play the Arabesque and watch the first 30 seconds.'},
    ],
    expected: [
      {zh: '五线谱光标和键盘高亮一直落在正在发声的音上，到最后也没有漂移。', en: 'The staff cursor and the lit keys stay on the sounding notes, with no drift by the end.'},
    ],
  },
  {
    id: 'D2', group: 'D', mount: scorePlayer,
    title: {zh: 'seek 后视图立刻跟上', en: 'Views follow a seek immediately'},
    steps: [
      {zh: '播放中和暂停时各 seek 几次。', en: 'Seek several times while playing and while paused.'},
    ],
    expected: [
      {zh: '光标和键盘立刻到新位置，声音从新位置继续。', en: 'The cursor and keys move at once and the sound resumes from the new place.'},
      {zh: '暂停时 seek 不会发声，也不会留下亮着的键。', en: 'Seeking while paused stays silent and leaves no lit keys.'},
    ],
  },
  {
    id: 'D3', group: 'D', mount: scorePlayer,
    title: {zh: '后台标签页里继续播放', en: 'Playback continues in a background tab'},
    steps: [
      {zh: '播放中切到别的标签页 30 秒，再回来。', en: 'While playing, switch to another tab for 30 seconds, then return.'},
    ],
    expected: [
      {zh: '声音一直在继续，没有长时间断音；回来后视图对上当前位置。', en: 'Sound continued without long gaps; on return the views match the position.'},
    ],
  },
  {
    id: 'D4', group: 'D', mount: replacement,
    title: {zh: '原地替换音色和乐谱', en: 'Replace sound and score in place'},
    steps: [
      {zh: '播放中在“参数”里切换音色：三角波、正弦波、方波。', en: 'While playing, switch the sound in Parameters: triangle, sine, square.'},
      {zh: '播放中把乐谱切到“开头 16 拍”，再切回“全曲”。', en: 'While playing, switch the score to “Opening 16 beats”, then back to “Whole piece”.'},
    ],
    expected: [
      {zh: '换音色时位置不变，音色立刻改变，不会重新开始。', en: 'A sound change keeps the position and changes the timbre at once, without restarting.'},
      {zh: '换乐谱后停止并回到 0，没有报错；时长读数跟着变，下方视图显示新的乐谱；再按播放会播新乐谱。', en: 'A score change stops at 0 with no error; the duration readout changes, the views show the new score, and Play plays it.'},
    ],
  },
  {
    id: 'E1', group: 'E', mount: audioPlayer,
    title: {zh: '音频播放器：播放、seek、变速', en: 'Audio player: play, seek, rate'},
    steps: [
      {zh: '播放 Arabesque 录音，seek 几次。', en: 'Play the Arabesque recording and seek several times.'},
      {zh: '改变播放速度后再恢复。', en: 'Change the playback rate, then restore it.'},
    ],
    expected: [
      {zh: 'seek 没有爆音；时间读数与听到的位置一致。', en: 'Seeks do not click; the time readout matches what you hear.'},
      {zh: '变速后读数和声音仍然一致。', en: 'After a rate change, readout and sound still agree.'},
    ],
  },
  {
    id: 'E2', group: 'E', mount: playlist,
    title: {zh: '播放列表切换曲目与循环', en: 'Playlist entries, next, previous and loop'},
    steps: [
      {zh: '播放，在曲目内 seek。', en: 'Play and seek inside the entry.'},
      {zh: '按下一首、上一首。', en: 'Press next, then previous.'},
      {zh: '跳到最后一首末尾附近，让它播完。', en: 'Seek near the end of the last entry and let it finish.'},
    ],
    expected: [
      {zh: '每首的时间从 0 开始，播放的是选中的曲目。', en: 'Each entry’s time starts at 0 and the selected entry plays.'},
      {zh: '开着循环时播完最后一首会回到第一首继续。', en: 'With loop on, the queue wraps to the first entry and continues.'},
      {zh: '播放器的按钮状态始终与实际播放一致。', en: 'The player controls always agree with what is playing.'},
    ],
  },
  {
    id: 'E3', group: 'E', mount: mixer,
    title: {zh: '混音器两个通道互不影响', en: 'Mixer channels are independent'},
    steps: [
      {zh: '播放，依次调整 track A 和 track B 的控件。', en: 'Play, then adjust track A and track B in turn.'},
    ],
    expected: [
      {zh: '每个控件只改变自己的通道；两个通道始终同步。', en: 'Each control changes only its own track, and both stay in time.'},
    ],
  },
  {
    id: 'E4', group: 'E', mount: documentEdit,
    title: {zh: '编辑后的音频文档按剪辑结果播放', en: 'An edited audio document plays as edited'},
    steps: [
      {zh: '在波形上选中第 1 到第 3 秒并删除。', en: 'Select seconds 1 to 3 on the waveform and delete them.'},
      {zh: '从头播放；再撤销，从头播放一次。', en: 'Play from the start; then undo and play from the start again.'},
    ],
    expected: [
      {zh: '删除后第 1 秒处直接接上原来的第 3 秒，接缝处没有爆音。', en: 'After the cut, second 1 continues straight into the original second 3, with no click at the join.'},
      {zh: '撤销后恢复原样。', en: 'Undo restores the original.'},
    ],
  },
  {
    id: 'F1', group: 'F', mount: microphone,
    title: {zh: '麦克风录音', en: 'Microphone recording'},
    steps: [
      {zh: '按录音，允许麦克风，说话或弹奏 5 秒，停止并回放。', en: 'Press record, allow the microphone, speak or play for 5 seconds, stop and play back.'},
      {zh: '刷新后再按录音，这次拒绝麦克风权限。', en: 'Reload, record again and deny the permission.'},
    ],
    expected: [
      {zh: '回放听起来就是你的输入，没有额外回声。', en: 'The take sounds like your input, with no added echo.'},
      {zh: '拒绝权限时显示错误状态，不会卡在等待中。', en: 'Denying shows the error state instead of waiting forever.'},
    ],
  },
  {
    id: 'F2', group: 'F', mount: meter,
    title: {zh: '电平表跟随播放器', en: 'Meter follows its player'},
    steps: [
      {zh: '播放，暂停，再 seek 后继续。', en: 'Play, pause, then seek and resume.'},
    ],
    expected: [
      {zh: '电平随音乐动，暂停后回落，seek 后历史重置。', en: 'The meter moves with the music, falls to rest on pause and resets after a seek.'},
    ],
  },
  {
    id: 'F3', group: 'F', mount: playlist,
    title: {zh: '播放列表背后的分析器能看到声音', en: 'An analyser behind a playlist sees its output'},
    steps: [
      {zh: '播放列表播放时看下方的频谱和电平；按下一首。', en: 'While the playlist plays, watch the spectrum and meter below; press next.'},
    ],
    expected: [
      {zh: '频谱和电平都在动，换曲后继续动。', en: 'Spectrum and meter move, and keep moving after the entry changes.'},
    ],
  },
  {
    id: 'H1', group: 'H', mount: offlineScore,
    title: {zh: '整个模块图离线渲染', en: 'Offline render of a whole module graph'},
    steps: [
      {zh: '在“参数”里按“渲染 12 秒”，再按“播放结果”。', en: 'In Parameters press “Render 12 s”, then “Play result”.'},
    ],
    expected: [
      {zh: '渲染耗时远少于 12 秒。', en: 'Rendering takes far less than 12 seconds.'},
      {zh: '结果的 12 秒全程都是 Arabesque 钢琴，没有中途静音或停顿。', en: 'All 12 seconds of the result are the Arabesque piano, with no silence or stalls.'},
    ],
  },
  {
    id: 'H2', group: 'H', mount: offlineDocument,
    title: {zh: '编辑过的音频文档离线渲染', en: 'Offline render of an edited audio document'},
    steps: [
      {zh: '按“渲染剪辑后的文档”，再按“播放结果”。', en: 'Press “Render edited document”, then “Play result”.'},
    ],
    expected: [
      {zh: '第 1 秒处直接跳到原录音的第 2 秒（中间 1 秒被剪掉），之后一直有声音。', en: 'At second 1 it jumps to the recording’s second 2 (one second cut), and keeps sounding.'},
      {zh: '读数里“剪辑前/后匹配”都接近 1.000。', en: 'The “before/after cut” match readouts are close to 1.000.'},
    ],
  },
  {
    id: 'H3', group: 'H', mount: scoreAudioSession,
    title: {zh: '代码组装的 Score + Audio Session', en: 'Score + Audio Session assembled in code'},
    steps: [
      {zh: '按“播放”，听 10 秒，按“暂停”，再“从 30 秒播放”。', en: 'Press “Play”, listen for 10 s, “Pause”, then “Play from 30 s”.'},
    ],
    expected: [
      {zh: '钢琴和录音同时开始、同时暂停，从 30 秒处一起继续。', en: 'Piano and recording start and pause together and resume together at 30 s.'},
      {zh: '读数显示两个参与者、位置在走。', en: 'The readout shows two participants and an advancing position.'},
    ],
  },
  {
    id: 'G1', group: 'G',
    title: {zh: '只用键盘操作', en: 'Keyboard only'},
    steps: [
      {zh: '回到 A1、B1、C1、D2、E2，只用 Tab、Shift+Tab、空格、回车和方向键操作播放、seek、推子和录音。', en: 'Revisit A1, B1, C1, D2 and E2 and operate play, seek, faders and recording with Tab, Shift+Tab, Space, Enter and arrow keys only.'},
    ],
    expected: [
      {zh: '每个控件都有清楚可见的焦点框，每个操作都能完成。', en: 'Every control shows a visible focus ring and every action is reachable.'},
    ],
  },
  {
    id: 'G2', group: 'G',
    title: {zh: '读屏软件', en: 'Screen reader'},
    steps: [
      {zh: '打开 VoiceOver（macOS/iOS）或 TalkBack（Android），走一遍 A1、C1、E2。', en: 'With VoiceOver (macOS/iOS) or TalkBack (Android), walk through A1, C1 and E2.'},
    ],
    expected: [
      {zh: '每个控件读出名字和状态（播放中、已静音、录音中等）。', en: 'Each control announces its name and state (playing, muted, recording).'},
    ],
  },
  {
    id: 'G3', group: 'G',
    title: {zh: '窄屏与触屏', en: 'Narrow width and touch'},
    steps: [
      {zh: '在手机上，或把窗口缩到 320–480 px 宽，走一遍 A1、B1、C1、E2。', en: 'On a phone, or with the window at 320–480 px, walk through A1, B1, C1 and E2.'},
    ],
    expected: [
      {zh: '控件不被截断，页面不横向滚动，触控目标能准确点到。', en: 'No clipped controls, no horizontal page scroll, touch targets are usable.'},
    ],
  },
];
