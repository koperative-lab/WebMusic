// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createUILocalization, type UILocalization} from '../src/localization';
import {mountMixer, type MixerState} from '../src/mixer';
import {mountMacroRack, type MacroState} from '../src/macro';
import {mountRecorder, type RecorderState} from '../src/recorder';
import {mountParameterRack, type ParameterRackState} from '../src/parameter';
import {mountPlaylist, type PlaylistState} from '../src/playlist';
import {mountTrackList, type TrackListState} from '../src/track-list';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); document.body.replaceChildren(); });
function host(): HTMLDivElement { const node = document.createElement('div'); document.body.append(node); return node; }
function store<T>(state: T) {
  const listeners = new Set<() => void>();
  const result = {state, snapshot: () => result.state, subscribe(notify: () => void) {
    listeners.add(notify); return () => { listeners.delete(notify); };
  }, notify() { for (const listener of listeners) listener(); }};
  return result;
}

describe('localized composite presenters', () => {
  it('updates every mixer label and fader value without moving focus or issuing commands', () => {
    const localization = createUILocalization();
    const state = store<MixerState>({master: 0.8, channels: [{id: 'p', label: 'Piano', value: 0.5}]});
    const commands = {setMaster: vi.fn(), setChannel: vi.fn(), setMuted: vi.fn(), setSolo: vi.fn(), play: vi.fn(), pause: vi.fn(), stop: vi.fn()};
    const target = host();
    const handle = mountMixer(target, {...state, ...commands}, {localization});
    cleanups.push(handle.destroy);
    const slider = target.querySelector<HTMLElement>('[data-channel-id="p"] [role="slider"]')!;
    slider.focus();
    localization.update({messages: {
      'mixer.master': '总音量', 'mixer.channels': '声部', 'mixer.volume': '{label}音量',
      'mixer.mute': '静音：{label}', 'mixer.solo': '独奏：{label}', 'mixer.muteText': '静', 'mixer.soloText': '独',
      'mixer.play': '播放', 'mixer.pause': '暂停', 'mixer.stop': '停止',
    }, formatters: {percent: (value) => `百分之${value * 100}`}});
    expect(document.activeElement).toBe(slider);
    expect(slider.getAttribute('aria-label')).toBe('Piano音量');
    expect(slider.getAttribute('aria-valuetext')).toBe('百分之50');
    expect(target.querySelector('[part~="master"] [part~="label"]')?.textContent).toBe('总音量');
    expect(target.querySelector('[part~="mute"]')?.getAttribute('aria-label')).toBe('静音：Piano');
    expect(target.querySelector('[part~="mute"]')?.textContent).toBe('静');
    expect(target.querySelector('[part~="solo"]')?.getAttribute('aria-label')).toBe('独奏：Piano');
    expect(target.querySelector('[part~="channels"]')?.getAttribute('aria-label')).toBe('声部');
    for (const [part, text] of [['play', '播放'], ['pause', '暂停'], ['stop', '停止']]) {
      expect(target.querySelector(`[part~="${part}"]`)?.getAttribute('aria-label')).toBe(text);
    }
    for (const command of Object.values(commands)) expect(command).not.toHaveBeenCalled();
  });

  it('patches parameter labels, units, group names and option strings without replacing focused inputs', () => {
    const localization = createUILocalization();
    const state = store<ParameterRackState>({parameters: [
      {id: 'gain', label: 'Gain', value: 1.25, min: 0, max: 2, group: 'Output', unit: 'x'},
      {id: 'mode', label: 'Mode', value: 1, min: 0, max: 1, group: 'Output', options: ['Dry', 'Wet']},
    ]});
    const handle = mountParameterRack(host(), {...state, setValue: vi.fn()}, {layout: 'grouped', localization});
    cleanups.push(handle.destroy);
    const input = handle.inputElement('gain')!;
    const option = handle.inputElement('mode')!;
    const group = handle.element.querySelector('[part="group-label"]')!;
    const groupId = group.id;
    input.focus();
    state.state.parameters[0]!.label = '增益';
    state.state.parameters[0]!.unit = '倍';
    for (const item of state.state.parameters) item.group = '输出';
    state.state.parameters[1]!.options = ['干声', '湿声'];
    state.notify();
    localization.update({messages: {'parameter.value': '{unit}：{value}'}, formatters: {number: (value) => value.toFixed(2).replace('.', ',')}});
    expect(handle.inputElement('gain')).toBe(input);
    expect(handle.inputElement('mode')).toBe(option);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-label')).toBe('增益');
    expect(input.getAttribute('aria-valuetext')).toBe('倍：1,25');
    expect(input.value).toBe('1.25');
    expect(option.getAttribute('aria-valuetext')).toBe('湿声');
    expect(group.textContent).toBe('输出');
    expect(group.id).toBe(groupId);
  });

  it('preserves explicit parameter formatters and empty labels over locale defaults', () => {
    const localization = createUILocalization({messages: {'parameter.empty': '无参数'}, formatters: {number: () => 'localized'}});
    const state = store<ParameterRackState>({parameters: [{id: 'x', label: 'X', value: 1, min: 0, max: 2}]});
    const handle = mountParameterRack(host(), {...state, setValue: vi.fn()}, {localization, formatValue: () => 'custom', emptyLabel: 'Custom empty'});
    cleanups.push(handle.destroy);
    expect(handle.inputElement('x')?.getAttribute('aria-valuetext')).toBe('custom');
    state.state = {parameters: []};
    handle.update();
    localization.update({messages: {'parameter.empty': 'nothing'}});
    expect(handle.emptyElement()?.textContent).toBe('Custom empty');
  });

  it('propagates macro rack localization to child ranges and target values', () => {
    const localization = createUILocalization();
    const state = store<MacroState>({label: 'Energy', value: 0.5, targets: [{label: 'Cutoff', value: 1200, unit: 'Hz'}]});
    const target = host();
    const handle = mountMacroRack(target, [{...state, setValue: vi.fn()}], {localization});
    cleanups.push(handle.destroy);
    const input = target.querySelector('input')!;
    input.focus();
    state.state.label = '力度';
    localization.update({messages: {'macro.targetValue': '{unit} {value}', 'macro.empty': '无目标'},
      formatters: {number: (value) => value.toLocaleString('en-US'), percent: (value) => `${value * 100}％`}});
    expect(target.querySelector('input')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-label')).toBe('力度');
    expect(input.getAttribute('aria-valuetext')).toBe('50％');
    expect(target.textContent).toContain('Hz 1,200');
    state.state.targets = [];
    state.notify();
    expect(target.textContent).toContain('无目标');
  });

  it('localizes recorder counts and actions and keeps caller status and export format labels intact', () => {
    const localization = createUILocalization();
    const state = store<RecorderState>({recording: false, takeCount: 1200});
    const target = host();
    const handle = mountRecorder(target, {...state, toggleRecording: vi.fn(), togglePlayback: vi.fn(), export: vi.fn()},
      {localization, exportFormats: [{id: 'mid', label: 'MIDI'}]});
    cleanups.push(handle.destroy);
    const record = target.querySelector<HTMLButtonElement>('[part="record"]')!;
    record.focus();
    localization.update({messages: {
      'recorder.record': '录制', 'recorder.stopRecording': '结束录制', 'recorder.stop': '停止',
      'recorder.play': '播放', 'recorder.playTake': '播放录音', 'recorder.stopPlayback': '停止录音播放',
      'recorder.exports': '导出录音', 'recorder.download': '保存{label}', 'recorder.downloadText': '{label} 下载',
      'recorder.capturedStatus': '已录制 {formattedCount}', 'recorder.recordingStatus': '正在录制 {formattedCount}',
      'recorder.playingStatus': '正在播放', 'recorder.readyStatus': '准备好',
    }, formatters: {number: (value) => value.toLocaleString('en-US')}});
    expect(document.activeElement).toBe(record);
    expect(record.textContent).toBe('● 录制');
    expect(target.querySelector('[part="status"]')?.textContent).toBe('已录制 1,200');
    expect(target.querySelector('[part="exports"] button')?.getAttribute('aria-label')).toBe('保存MIDI');
    expect(target.querySelector('[part="exports"] button')?.textContent).toBe('MIDI 下载');
    state.state.playing = true;
    state.notify();
    expect(target.querySelector('[part="play"]')?.getAttribute('aria-label')).toBe('停止录音播放');
    state.state.recording = true;
    state.state.recordedCount = 42;
    state.notify();
    expect(record.getAttribute('aria-label')).toBe('结束录制');
    expect(target.querySelector('[part="status"]')?.textContent).toBe('正在录制 42');
    state.state.status = 'Application-owned status';
    localization.update({messages: {}});
    expect(target.querySelector('[part="status"]')?.textContent).toBe('Application-owned status');
  });

  it('localizes playlist controls and ordinal numbers while preserving translated row focus and numeric commands', () => {
    const localization = createUILocalization();
    const state = store<PlaylistState>({playing: false, progress: 0.25, items: [{id: 'a', label: 'Intro', duration: '0:30'}]});
    const seek = vi.fn();
    const handle = mountPlaylist(host(), {...state, toggle() {}, previous() {}, next() {}, seek, select() {}}, {localization});
    cleanups.push(handle.destroy);
    const row = handle.controls.item('a')!;
    row.focus();
    state.state.items[0]!.label = '前奏';
    localization.update({messages: {'playlist.label': '曲目', 'playlist.previous': '上一首', 'playlist.next': '下一首',
      'playlist.play': '播放', 'playlist.pause': '暂停', 'playlist.seek': '位置'},
      formatters: {number: (value) => `第${value}`, percent: (value) => `${value * 100}％`}});
    expect(handle.controls.item('a')).toBe(row);
    expect(document.activeElement).toBe(row);
    expect(row.textContent).toBe('第1前奏0:30');
    expect(handle.controls.seek.getAttribute('aria-valuetext')).toBe('25％');
    expect(handle.controls.seek.value).toBe('250');
    expect(handle.controls.toggle.getAttribute('aria-label')).toBe('播放');
    expect(handle.controls.list.getAttribute('aria-label')).toBe('曲目');
    handle.controls.seek.value = '500';
    handle.controls.seek.dispatchEvent(new Event('input'));
    expect(seek).toHaveBeenCalledWith(0.5);
  });

  it('keeps track-list focus and updates an existing empty state in place', () => {
    const localization = createUILocalization();
    const state = store<TrackListState>({items: [{id: 'a', label: 'Intro'}, {id: 'b', label: 'Verse', detail: '0:12'}]});
    const binding = {...state, select() {}};
    const handle = mountTrackList(host(), binding, {localization});
    cleanups.push(handle.destroy);
    handle.controls.focus('b');
    const row = handle.controls.row('b')!;
    state.state.items[1]!.label = '主歌';
    localization.update({messages: {'trackList.label': '声部', 'trackList.empty': '没有项目'}});
    expect(handle.controls.row('b')).toBe(row);
    expect(document.activeElement).toBe(row);
    expect(row.textContent).toBe('主歌0:12');
    expect(row.tabIndex).toBe(0);
    state.state = {items: []};
    handle.update();
    const empty = handle.controls.list.firstElementChild;
    expect(empty?.textContent).toBe('没有项目');
    localization.update({messages: {'trackList.empty': '空列表'}});
    expect(handle.controls.list.firstElementChild).toBe(empty);
    expect(empty?.textContent).toBe('空列表');
  });

  it('releases localization subscriptions and ignores notifications after every presenter is destroyed', () => {
    const delegate = createUILocalization();
    const callbacks: Array<() => void> = [];
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const localization: UILocalization = {...delegate, subscribe(notify) {
      callbacks.push(notify); const stop = vi.fn(); stops.push(stop); return stop;
    }};
    const handles = [
      mountMixer(host(), {snapshot: () => ({master: 1, channels: []}), setMaster() {}, setChannel() {}}, {localization}),
      mountMacroRack(host(), [{snapshot: () => ({label: 'X', value: 0, targets: []}), setValue() {}}], {localization}),
      mountRecorder(host(), {snapshot: () => ({recording: false}), toggleRecording() {}}, {localization}),
      mountParameterRack(host(), {snapshot: () => ({parameters: []}), setValue() {}}, {localization}),
      mountPlaylist(host(), {snapshot: () => ({playing: false, progress: 0, items: []}), toggle() {}, previous() {}, next() {}, seek() {}, select() {}}, {localization}),
      mountTrackList(host(), {snapshot: () => ({items: []}), select() {}}, {localization}),
    ];
    for (const handle of handles) { handle.destroy(); handle.destroy(); }
    expect(stops).toHaveLength(7); // Macro owns one source and one nested parameter observation.
    for (const stop of stops) expect(stop).toHaveBeenCalledOnce();
    for (const notify of callbacks) expect(notify).not.toThrow();
    for (const handle of handles) expect(handle.element.isConnected).toBe(false);
  });
});
