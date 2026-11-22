import {describe, expect, it, vi} from 'vitest';
import {
  AudioMessageClock, ManualMessageClock, MAX_MESSAGE_DEPTH, MessageInputPort, MessageOutputPort, MessageStackOverflowError,
  ParamHandle, atomsOf, bang, connectMessageToParameter, floatAtom, floatMessage, formatMessage, intAtom, intMessage,
  message, messageFromAtoms, numberOf, parseMessage, symbolAtom, type Message,
} from '../src/module';

describe('message values', () => {
  it('parses message-box text into typed atoms and back', () => {
    expect(parseMessage('3')).toEqual({selector: 'int', atoms: [intAtom(3)]});
    expect(parseMessage('3.')).toEqual({selector: 'float', atoms: [floatAtom(3)]});
    expect(parseMessage('1 2.5 foo')).toEqual({selector: 'list', atoms: [intAtom(1), floatAtom(2.5), symbolAtom('foo')]});
    expect(parseMessage('set 3 4.5')).toEqual({selector: 'set', atoms: [intAtom(3), floatAtom(4.5)]});
    expect(parseMessage('bang')).toEqual({selector: 'bang', atoms: []});
    expect(parseMessage('"two words"')).toEqual({selector: 'symbol', atoms: [symbolAtom('two words')]});
    expect(parseMessage('')).toEqual(bang());
    for (const text of ['3', '3.', '1 2.5 foo', 'set 3 4.5', 'bang', '"two words"', '-0.25 "3"']) expect(formatMessage(parseMessage(text))).toBe(text);
  });

  it('turns messages into atoms and atoms into messages as Max does', () => {
    expect(atomsOf(bang())).toEqual([]);
    expect(atomsOf(parseMessage('set 3'))).toEqual([symbolAtom('set'), intAtom(3)]);
    expect(messageFromAtoms([intAtom(1)]).selector).toBe('int');
    expect(messageFromAtoms([symbolAtom('stop')])).toEqual({selector: 'stop', atoms: []});
    expect(parseMessage('stop')).toEqual({selector: 'stop', atoms: []});
    expect(atomsOf(parseMessage('stop'))).toEqual([symbolAtom('stop')]);
    expect(messageFromAtoms([symbolAtom('stop'), intAtom(1)]).selector).toBe('stop');
    expect(messageFromAtoms([floatAtom(1), symbolAtom('x')]).selector).toBe('list');
    expect(numberOf(parseMessage('foo 7 8'))).toBe(7);
    expect(numberOf(bang())).toBeUndefined();
    expect(Object.isFrozen(message('x', [intAtom(1)]))).toBe(true);
  });
});

describe('message ports', () => {
  it('delivers depth first, inputs in connection order', () => {
    const order: string[] = [];
    const source = new MessageOutputPort();
    const relay = new MessageOutputPort();
    const first = new MessageInputPort(value => { order.push(`a:${formatMessage(value)}`); relay.send(intMessage(9)); });
    const second = new MessageInputPort(value => order.push(`b:${formatMessage(value)}`));
    const deep = new MessageInputPort(value => order.push(`deep:${formatMessage(value)}`));
    first.connect(source);
    second.connect(source);
    deep.connect(relay);
    source.send(intMessage(1));
    expect(order).toEqual(['a:1', 'deep:9', 'b:1']);
  });

  it('stops a feedback loop with a stack overflow instead of hanging', () => {
    const errors: unknown[] = [];
    const output = new MessageOutputPort({onListenerError: error => errors.push(error)});
    let calls = 0;
    const input = new MessageInputPort(value => { calls++; output.send(value); });
    input.connect(output);
    output.send(bang());
    expect(calls).toBe(MAX_MESSAGE_DEPTH);
    expect(errors[0]).toBeInstanceOf(MessageStackOverflowError);
  });

  it('releases connections and refuses duplicates', () => {
    const output = new MessageOutputPort();
    const seen = vi.fn();
    const input = new MessageInputPort(seen, {multiplicity: 'single'});
    const lease = input.connect(output);
    expect(() => input.connect(output)).toThrow(/already connected/);
    expect(() => input.connect(new MessageOutputPort())).toThrow(/accepts one/);
    lease.release();
    output.send(bang());
    expect(seen).not.toHaveBeenCalled();
    input.receive(bang());
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe('message clocks', () => {
  it('runs events in time order, including events they schedule', () => {
    const clock = new ManualMessageClock(0);
    const seen: number[] = [];
    clock.schedule(0.2, time => seen.push(time));
    const cancel = clock.schedule(0.15, time => seen.push(time));
    clock.schedule(0.1, time => { seen.push(time); clock.schedule(0.12, next => seen.push(next)); });
    cancel();
    clock.advance(0.3);
    expect(seen).toEqual([0.1, 0.12, 0.2]);
    expect(clock.pendingEvents).toBe(0);
    expect(() => clock.advance(0.1)).toThrow();
  });

  it('delivers an audio clock event ahead of its time, within the lookahead', async () => {
    vi.useFakeTimers();
    try {
      const context = {currentTime: 1} as BaseAudioContext;
      const clock = new AudioMessageClock(context, {lookahead: 0.05, interval: 10});
      const seen: number[] = [];
      clock.schedule(1.2, time => seen.push(time));
      await vi.advanceTimersByTimeAsync(20);
      expect(seen).toEqual([]);
      (context as {currentTime: number}).currentTime = 1.16;
      await vi.advanceTimersByTimeAsync(20);
      expect(seen).toEqual([1.2]);
      clock.dispose();
    } finally { vi.useRealTimers(); }
  });
});

describe('message to parameter', () => {
  it('sets the base value from the first number, clamped, at the message time', () => {
    vi.useFakeTimers();
    try {
      const context = {currentTime: 2} as BaseAudioContext;
      const handle = new ParamHandle({id: 'frequency', unit: 'Hz', range: {min: 20, max: 2000}, defaultValue: 440});
      const output = new MessageOutputPort();
      const lease = connectMessageToParameter(output, handle, context);
      output.send(intMessage(880));
      expect(handle.snapshot.baseValue).toBe(880);
      output.send(floatMessage(9000));
      expect(handle.snapshot.baseValue).toBe(2000);
      output.send(message('symbol', [symbolAtom('x')]));
      output.send(intMessage(100, 2.1));
      expect(handle.snapshot.baseValue).toBe(2000);
      vi.advanceTimersByTime(100);
      expect(handle.snapshot.baseValue).toBe(100);
      output.send(intMessage(300, 2.5));
      lease.release();
      vi.advanceTimersByTime(1000);
      expect(handle.snapshot.baseValue).toBe(100);
    } finally { vi.useRealTimers(); }
  });

  it('keeps every timed message in its own order', () => {
    const output = new MessageOutputPort();
    const seen: Message[] = [];
    new MessageInputPort(value => seen.push(value)).connect(output);
    output.send(intMessage(1, 0.5));
    expect(seen[0]!.time).toBe(0.5);
  });
});
