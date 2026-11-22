import {describe, expect, it, vi} from 'vitest';
import {MessageInputPort, formatMessage, type ControlEvent} from '@webmusic/kernel/module';
import {MidiControlSource} from '../src/play/headless';

describe('MidiControlSource', () => {
  it('turns control change, pitch bend and program change into events and messages', () => {
    const previous = () => {};
    const input = {onmidimessage: previous as ((event: {data: Uint8Array | number[]}) => void) | null};
    const source = new MidiControlSource(input);
    const events: ControlEvent[] = [];
    const messages: string[] = [];
    source.onControl(event => events.push(event));
    new MessageInputPort(value => messages.push(formatMessage(value))).connect(source.controls);
    input.onmidimessage!({data: [0xb1, 74, 100]});
    input.onmidimessage!({data: [0xe0, 0, 64]});
    input.onmidimessage!({data: [0xc2, 5]});
    input.onmidimessage!({data: [0x90, 60, 100]});
    expect(events).toEqual([
      {kind: 'cc', controller: 74, value: 100, channel: 1},
      {kind: 'pitchbend', value: 0, channel: 0},
      {kind: 'program', value: 5, channel: 2},
    ]);
    expect(messages).toEqual(['cc 74 100 1', 'bend 0 0', 'program 5 2']);
    expect(source.ports().map(port => port.family)).toEqual(['message']);
    source.dispose();
    expect(input.onmidimessage).toBe(previous);
  });

  it('filters by channel', () => {
    const input = {onmidimessage: null as ((event: {data: Uint8Array | number[]}) => void) | null};
    const source = new MidiControlSource(input, {channel: 3});
    const events: ControlEvent[] = [];
    source.onControl(event => events.push(event));
    input.onmidimessage!({data: [0xb0, 1, 1]});
    input.onmidimessage!({data: [0xb3, 1, 2]});
    expect(events).toEqual([{kind: 'cc', controller: 1, value: 2, channel: 3}]);
    expect(() => new MidiControlSource(input, {channel: 16})).toThrow();
  });
});

import {MidiClockSink, MidiClockSource, MidiMessageSink, MidiNoteSource, midiBytes, sendSysex} from '../src/play/headless';
import {parseMessage} from '@webmusic/kernel/module';

describe('MIDI completion', () => {
  const input = () => ({onmidimessage: null as ((event: {data: Uint8Array | number[]; timeStamp?: number}) => void) | null});

  it('reports pressure, polyphonic pressure and system exclusive', () => {
    const port = input();
    const source = new MidiControlSource(port);
    const events: ControlEvent[] = [];
    const messages: string[] = [];
    source.onControl(event => events.push(event));
    new MessageInputPort(value => messages.push(formatMessage(value))).connect(source.controls);
    port.onmidimessage!({data: [0xd2, 90]});
    port.onmidimessage!({data: [0xa0, 60, 30]});
    port.onmidimessage!({data: [0xf0, 0x7e, 0x01, 0xf7]});
    expect(events).toEqual([{kind: 'pressure', value: 90, channel: 2}]);
    expect(messages).toEqual(['pressure 90 2', 'polypressure 60 30 0', 'sysex 240 126 1 247']);
  });

  it('detunes MPE notes by their channel bend', () => {
    const port = input();
    const source = new MidiNoteSource(port, {mpe: {bendRange: 48}});
    const heard: unknown[] = [];
    source.notes.subscribe(event => heard.push(event.pitch));
    port.onmidimessage!({data: [0xe3, 0, 80]}); // +2048 of 8192
    port.onmidimessage!({data: [0x93, 60, 100]});
    port.onmidimessage!({data: [0x94, 64, 100]});
    expect(heard).toEqual([{midi: 60, cents: 1200}, {midi: 64}]);
  });

  it('reads clock pulses as a tempo and transport messages', () => {
    const port = input();
    const clock = new MidiClockSource(port, {smoothing: 4});
    const messages: string[] = [];
    new MessageInputPort(value => messages.push(formatMessage(value))).connect(clock.clock);
    port.onmidimessage!({data: [0xfa]});
    // 120 bpm: 24 pulses per 500 ms.
    for (let pulse = 0; pulse < 6; pulse++) port.onmidimessage!({data: [0xf8], timeStamp: pulse * 500 / 24});
    port.onmidimessage!({data: [0xf2, 16, 0]});
    port.onmidimessage!({data: [0xfc]});
    expect(clock.bpm).toBeCloseTo(120, 3);
    expect(messages).toEqual(['start', 'beat 1', 'tempo 120.', 'position 16', 'stop']);
  });

  it('drives a clock output from a transport', () => {
    vi.useFakeTimers();
    try {
      const sent: number[][] = [];
      let position = 0, playing = false;
      const listeners = new Set<() => void>();
      const sink = new MidiClockSink({send: data => sent.push([...data])}, {tempo: () => ({bpm: 120}), playing: () => playing, position: () => position,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }}, {interval: 5});
      playing = true; listeners.forEach(listener => listener());
      position = 0.5; vi.advanceTimersByTime(10);
      expect(sent.slice(0, 2)).toEqual([[0xf2, 0, 0], [0xfa]]);
      expect(sent.filter(bytes => bytes[0] === 0xf8)).toHaveLength(24);
      playing = false; listeners.forEach(listener => listener());
      expect(sent.at(-1)).toEqual([0xfc]);
      sink.dispose();
    } finally { vi.useRealTimers(); }
  });

  it('sends messages as MIDI bytes and checks system exclusive', () => {
    expect(midiBytes(parseMessage('cc 7 100 1'))).toEqual([0xb1, 7, 100]);
    expect(midiBytes(parseMessage('bend 0'))).toEqual([0xe0, 0, 64]);
    expect(midiBytes(parseMessage('program 5 2'))).toEqual([0xc2, 5]);
    expect(midiBytes(parseMessage('note 60'))).toBeUndefined();
    const sent: number[][] = [];
    const sink = new MidiMessageSink({send: data => sent.push([...data])});
    sink.midi.receive(parseMessage('sysex 240 1 2 247'));
    sink.midi.receive(parseMessage('144 60 100'));
    expect(sent).toEqual([[240, 1, 2, 247], [144, 60, 100]]);
    expect(() => sendSysex({send: () => {}}, [240, 200, 247])).toThrow();
  });
});
