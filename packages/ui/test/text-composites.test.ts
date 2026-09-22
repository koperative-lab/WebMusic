// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {UIValueFormatters} from '../src/text';
import {mountMixer, type MixerState, type MixerText} from '../src/mixer';
import {mountMacroRack, type MacroState, type MacroText} from '../src/macro';
import {mountRecorder, type RecorderState, type RecorderText} from '../src/recorder';
import {mountParameterRack, type ParameterRackState, type ParameterRackText} from '../src/parameter';
import {mountPlaylist, type PlaylistState, type PlaylistText} from '../src/playlist';
import {mountTrackList, type TrackListState, type TrackListText} from '../src/track-list';

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

describe('application-rendered composite text', () => {
  it('updates every mixer label and fader value without moving focus or issuing commands', () => {
    let texts: MixerText = {};
    const getText = vi.fn(() => texts);
    const formatters: UIValueFormatters = {};
    const state = store<MixerState>({master: 0.8, channels: [{id: 'p', label: 'Piano', value: 0.5}]});
    const commands = {setMaster: vi.fn(), setChannel: vi.fn(), setMuted: vi.fn(), setSolo: vi.fn(), play: vi.fn(), pause: vi.fn(), stop: vi.fn()};
    const target = host();
    const handle = mountMixer(target, {...state, ...commands}, {getText, formatters});
    cleanups.push(handle.destroy);
    const slider = target.querySelector<HTMLElement>('[data-channel-id="p"] [role="slider"]')!;
    slider.focus();
    texts = {
      master: '总音量', channels: '声部', volume: ({label}) => `${label}音量`,
      mute: ({label}) => `静音：${label}`, solo: ({label}) => `独奏：${label}`, muteText: '静', soloText: '独',
      play: '播放', pause: '暂停', stop: '停止',
    };
    formatters.percent = (value) => `百分之${value * 100}`;
    expect(slider.getAttribute('aria-label')).toBe('Piano volume');
    getText.mockClear();
    handle.update();
    expect(getText).toHaveBeenCalledOnce();
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
    let texts: ParameterRackText = {};
    const getText = vi.fn(() => texts);
    const formatters: UIValueFormatters = {};
    const state = store<ParameterRackState>({parameters: [
      {id: 'gain', label: 'Gain', value: 1.25, min: 0, max: 2, group: 'Output', unit: 'x'},
      {id: 'mode', label: 'Mode', value: 1, min: 0, max: 1, group: 'Output', options: ['Dry', 'Wet']},
    ]});
    const handle = mountParameterRack(host(), {...state, setValue: vi.fn()}, {layout: 'grouped', getText, formatters});
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
    texts = {value: ({unit, value}) => `${unit}：${value}`};
    formatters.number = (value) => value.toFixed(2).replace('.', ',');
    handle.update();
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

  it('preserves explicit parameter formatters and empty labels over application text', () => {
    let texts: ParameterRackText = {empty: '无参数'};
    const getText = () => texts;
    const formatters = {number: () => 'external'};
    const state = store<ParameterRackState>({parameters: [{id: 'x', label: 'X', value: 1, min: 0, max: 2}]});
    const handle = mountParameterRack(host(), {...state, setValue: vi.fn()}, {getText, formatters, formatValue: () => 'custom', emptyLabel: 'Custom empty'});
    cleanups.push(handle.destroy);
    expect(handle.inputElement('x')?.getAttribute('aria-valuetext')).toBe('custom');
    state.state = {parameters: []};
    handle.update();
    texts = {empty: 'nothing'};
    handle.update();
    expect(handle.emptyElement()?.textContent).toBe('Custom empty');
  });

  it('passes macro rack text callbacks to children while preserving their ranges', () => {
    let texts: MacroText = {};
    const getText = vi.fn(() => texts);
    const formatters: UIValueFormatters = {};
    const state = store<MacroState>({label: 'Energy', value: 0.5, targets: [{label: 'Cutoff', value: 1200, unit: 'Hz'}]});
    const target = host();
    const handle = mountMacroRack(target, [{...state, setValue: vi.fn()}], {getText, formatters});
    cleanups.push(handle.destroy);
    const input = target.querySelector('input')!;
    input.focus();
    state.state.label = '力度';
    texts = {targetValue: ({unit, value}) => `${unit} ${value}`, empty: '无目标'};
    formatters.number = (value) => value.toLocaleString('en-US');
    formatters.percent = (value) => `${value * 100}％`;
    handle.update();
    expect(target.querySelector('input')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('aria-label')).toBe('力度');
    expect(input.getAttribute('aria-valuetext')).toBe('50％');
    expect(target.textContent).toContain('Hz 1,200');
    state.state.targets = [];
    state.notify();
    expect(target.textContent).toContain('无目标');
  });

  it('renders application recorder counts and actions and keeps caller status and export format labels intact', () => {
    let texts: RecorderText = {};
    const getText = vi.fn(() => texts);
    const formatters: UIValueFormatters = {};
    const state = store<RecorderState>({recording: false, takeCount: 1200});
    const target = host();
    const handle = mountRecorder(target, {...state, toggleRecording: vi.fn(), togglePlayback: vi.fn(), export: vi.fn()},
      {getText, formatters, exportFormats: [{id: 'mid', label: 'MIDI'}]});
    cleanups.push(handle.destroy);
    const record = target.querySelector<HTMLButtonElement>('[part="record"]')!;
    record.focus();
    texts = {
      record: '录制', stopRecording: '结束录制', stop: '停止', play: '播放', playTake: '播放录音',
      stopPlayback: '停止录音播放', exports: '导出录音', download: ({label}) => `保存${label}`,
      downloadText: ({label}) => `${label} 下载`, capturedStatus: ({formattedCount}) => `已录制 ${formattedCount}`,
      recordingStatus: ({formattedCount}) => `正在录制 ${formattedCount}`, playingStatus: '正在播放', readyStatus: '准备好',
    };
    formatters.number = (value) => value.toLocaleString('en-US');
    handle.update();
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
    texts = {};
    handle.update();
    expect(target.querySelector('[part="status"]')?.textContent).toBe('Application-owned status');
  });

  it('renders application playlist controls and ordinal numbers while preserving translated row focus and numeric commands', () => {
    let texts: PlaylistText = {};
    const getText = vi.fn(() => texts);
    const formatters: UIValueFormatters = {};
    const state = store<PlaylistState>({playing: false, progress: 0.25, items: [{id: 'a', label: 'Intro', duration: '0:30'}]});
    const seek = vi.fn();
    const handle = mountPlaylist(host(), {...state, toggle() {}, previous() {}, next() {}, seek, select() {}}, {getText, formatters});
    cleanups.push(handle.destroy);
    const row = handle.controls.item('a')!;
    row.focus();
    state.state.items[0]!.label = '前奏';
    texts = {label: '曲目', previous: '上一首', next: '下一首', play: '播放', pause: '暂停', seek: '位置'};
    formatters.number = (value) => `第${value}`;
    formatters.percent = (value) => `${value * 100}％`;
    handle.update();
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
    let texts: TrackListText = {};
    const getText = vi.fn(() => texts);
    const state = store<TrackListState>({items: [{id: 'a', label: 'Intro'}, {id: 'b', label: 'Verse', detail: '0:12'}]});
    const binding = {...state, select() {}};
    const handle = mountTrackList(host(), binding, {getText});
    cleanups.push(handle.destroy);
    handle.controls.focus('b');
    const row = handle.controls.row('b')!;
    state.state.items[1]!.label = '主歌';
    texts = {label: '声部', empty: '没有项目'};
    handle.update();
    expect(handle.controls.row('b')).toBe(row);
    expect(document.activeElement).toBe(row);
    expect(row.textContent).toBe('主歌0:12');
    expect(row.tabIndex).toBe(0);
    state.state = {items: []};
    handle.update();
    const empty = handle.controls.list.firstElementChild;
    expect(empty?.textContent).toBe('没有项目');
    texts = {empty: '空列表'};
    handle.update();
    expect(handle.controls.list.firstElementChild).toBe(empty);
    expect(empty?.textContent).toBe('空列表');
  });

  it('contains external text failures and uses final strings literally', () => {
    const failure = new Error('application text failed');
    const onError = vi.fn();
    let fail = false;
    const handle = mountRecorder(host(), {snapshot: () => ({recording: false, takeCount: 2}),
      toggleRecording() {}, export() {}}, {
      getText: () => { if (fail) throw failure; return {download: '{label}'}; },
      exportFormats: [{id: 'mid', label: 'MIDI'}], onError,
    });
    cleanups.push(handle.destroy);
    const button = handle.element.querySelector<HTMLButtonElement>('[part="exports"] button')!;
    button.focus();
    expect(button.getAttribute('aria-label')).toBe('{label}');
    fail = true;
    handle.update();
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(button.getAttribute('aria-label')).toBe('Download MIDI');
    expect(document.activeElement).toBe(button);
  });

  it('coalesces a text-triggered update and stops when text reading destroys the mount', () => {
    let onRead = () => {};
    const getText = vi.fn(() => { onRead(); return {}; });
    const handle = mountMixer(host(), {snapshot: () => ({master: 1, channels: []}),
      setMaster() {}, setChannel() {}}, {getText});
    cleanups.push(handle.destroy);
    getText.mockClear();
    onRead = () => { onRead = () => {}; handle.update(); };
    handle.update();
    expect(getText).toHaveBeenCalledTimes(2);
    onRead = handle.destroy;
    handle.update();
    expect(handle.element.isConnected).toBe(false);
    const calls = getText.mock.calls.length;
    handle.update();
    expect(getText).toHaveBeenCalledTimes(calls);
  });

  it('does not create channel controls after a text callback destroys a mixer', () => {
    const state = store<MixerState>({master: 1, channels: []});
    let texts: MixerText = {};
    const handle = mountMixer(host(), {...state, setMaster() {}, setChannel() {}}, {getText: () => texts});
    cleanups.push(handle.destroy);
    state.state.channels = [{id: 'new', label: 'New', value: 0.5}];
    texts = {volume: ({label}) => { handle.destroy(); return label; }};
    handle.update();
    expect(handle.element.isConnected).toBe(false);
    expect(handle.element.querySelector('[data-channel-id="new"]')).toBeNull();
  });

  it('reads text once per update, releases binding subscriptions and ignores late updates after destroy', () => {
    const getters: Array<ReturnType<typeof vi.fn>> = [];
    const callbacks: Array<() => void> = [];
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    const options = () => {
      const getText = vi.fn(() => ({}));
      getters.push(getText);
      return {getText};
    };
    const subscribe = (notify: () => void) => {
      callbacks.push(notify);
      const stop = vi.fn();
      stops.push(stop);
      return stop;
    };
    const handles = [
      mountMixer(host(), {snapshot: () => ({master: 1, channels: []}), setMaster() {}, setChannel() {}, subscribe}, options()),
      mountMacroRack(host(), [{snapshot: () => ({label: 'X', value: 0, targets: []}), setValue() {}, subscribe}], options()),
      mountRecorder(host(), {snapshot: () => ({recording: false}), toggleRecording() {}, subscribe}, options()),
      mountParameterRack(host(), {snapshot: () => ({parameters: []}), setValue() {}, subscribe}, options()),
      mountPlaylist(host(), {snapshot: () => ({playing: false, progress: 0, items: []}), toggle() {}, previous() {}, next() {}, seek() {}, select() {}, subscribe}, options()),
      mountTrackList(host(), {snapshot: () => ({items: []}), select() {}, subscribe}, options()),
    ];
    getters.forEach(getText => getText.mockClear());
    handles.forEach(handle => handle.update());
    getters.forEach(getText => expect(getText).toHaveBeenCalledOnce());
    for (const handle of handles) { handle.destroy(); handle.destroy(); }
    expect(stops).toHaveLength(6);
    for (const stop of stops) expect(stop).toHaveBeenCalledOnce();
    for (const notify of callbacks) expect(notify).not.toThrow();
    for (const handle of handles) { handle.update(); expect(handle.element.isConnected).toBe(false); }
    getters.forEach(getText => expect(getText).toHaveBeenCalledOnce());
  });
});
