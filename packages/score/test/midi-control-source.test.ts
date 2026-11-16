import {describe, expect, it} from 'vitest';
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
