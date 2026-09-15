import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '../../src/core';
import {InteractivePlayer, Metronome, bindClock, bindMidiInput, Sound, type MidiInputLike} from '../../src/play/headless';

function buildScore(pitches: string[]) {
  const b = new ScoreBuilder();
  const part = PartId('p');
  const voice = VoiceId('v');
  const ts = {numerator: 4, denominator: 4};
  b.setMetadata({title: 'In'})
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature: ts});
  b.addPart({id: part, name: 'Part', staves: 1});
  b.addMeasure({id: MeasureId('m1'), number: 1, onsetQuarters: Rational.ZERO, durationQuarters: new Rational(4), timeSignature: ts});
  pitches.forEach((p, i) =>
    b.addNote(part, {id: b.newNoteId(), pitch: Pitch.parse(p), onsetQuarters: new Rational(i), duration: Duration.quarter(), voice}),
  );
  return b.build();
}

describe('Metronome / bindClock', () => {
  afterEach(() => vi.useRealTimers());

  it('fires once per beat at the configured BPM', () => {
    vi.useFakeTimers();
    const ticks: number[] = [];
    const m = new Metronome((spb) => ticks.push(spb), {bpm: 120}).start(); // 0.5s per beat
    vi.advanceTimersByTime(1600);
    m.stop();
    expect(ticks.length).toBe(3); // beats at 500/1000/1500ms
    expect(ticks[0]).toBeCloseTo(0.5, 6);
  });

  it('drives beats off the kernel tick source at the beat period', () => {
    const built: number[] = [];
    let disposed = 0;
    let running = false;
    const fakeSource = (intervalMs: number) => {
      built.push(intervalMs);
      return {
        start() {
          running = true;
        },
        stop() {
          running = false;
        },
        dispose() {
          running = false;
          disposed += 1;
        },
        get running() {
          return running;
        },
        workerBacked: true,
      };
    };

    // Background tabs throttle main-thread timers to >=1s, so the beat has to
    // ride the throttling-resistant kernel source rather than setInterval.
    const m = new Metronome(() => {}, {bpm: 120, createTickSource: fakeSource}).start();
    expect(built).toEqual([500]);
    expect(m.running).toBe(true);

    m.setBpm(240); // rebuilds at the new period
    expect(built).toEqual([500, 250]);
    expect(disposed).toBe(1);

    m.stop();
    expect(m.running).toBe(false);
    expect(disposed).toBe(2);
  });

  it('bindClock advances the player each beat and unbinds', () => {
    vi.useFakeTimers();
    const player = new InteractivePlayer();
    player.addSource('s', buildScore(['C4', 'D4', 'E4', 'F4']));
    const beats: number[] = [];
    player.on('beat', (b) => beats.push(b.beat));

    const unbind = bindClock(player, {bpm: 240}); // 0.25s per beat
    vi.advanceTimersByTime(800); // ~3 beats
    unbind();
    vi.advanceTimersByTime(800); // no more after unbind
    expect(beats).toEqual([0, 1, 2]);
  });
});

describe('bindMidiInput', () => {
  it('does not clear a successor input handler and ignores callbacks retained after unbind', () => {
    const player = new InteractivePlayer();
    const notes = vi.fn();
    const input: MidiInputLike = {onmidimessage: null};
    const unbind = bindMidiInput(player, {input, onNote: notes});
    const retained = input.onmidimessage!;
    const successor = vi.fn();
    input.onmidimessage = successor;
    unbind();
    unbind();
    expect(input.onmidimessage).toBe(successor);
    retained({data: [0x90, 60, 100]});
    expect(notes).not.toHaveBeenCalled();
    player.dispose();
  });

  it('restores the input handler it borrowed when it remains the active owner', () => {
    const player = new InteractivePlayer();
    const previous = vi.fn();
    const input: MidiInputLike = {onmidimessage: previous};
    const unbind = bindMidiInput(player, {input});
    unbind();
    expect(input.onmidimessage).toBe(previous);
    player.dispose();
  });

  it('advances on note-on from a provided MIDI input, and unbinds', () => {
    const player = new InteractivePlayer();
    player.addSource('s', buildScore(['C4', 'D4']));
    const beats: number[] = [];
    player.on('beat', (b) => beats.push(b.beat));

    const input: MidiInputLike = {onmidimessage: null};
    const unbind = bindMidiInput(player, {input});

    input.onmidimessage!({data: [0x90, 60, 100]}); // note-on → advance
    input.onmidimessage!({data: [0x80, 60, 0]}); // note-off → ignored
    input.onmidimessage!({data: [0x90, 62, 0]}); // zero-velocity note-on → ignored
    expect(beats).toEqual([0]);

    unbind();
    expect(input.onmidimessage).toBeNull();
  });

  it('routes note-on to a custom handler when provided', () => {
    const player = new InteractivePlayer();
    const notes: Array<[number, number]> = [];
    const input: MidiInputLike = {onmidimessage: null};
    bindMidiInput(player, {input, onNote: (m, v) => notes.push([m, v])});
    input.onmidimessage!({data: [0x90, 64, 80]});
    expect(notes).toEqual([[64, 80]]);
  });

  it('clock mode advances every pulsesPerBeat clock pulses', () => {
    const player = new InteractivePlayer();
    player.addSource('s', buildScore(['C4', 'D4']));
    let advances = 0;
    player.on('beat', () => (advances += 1));
    const input: MidiInputLike = {onmidimessage: null};
    bindMidiInput(player, {input, mode: 'clock', pulsesPerBeat: 4});
    for (let i = 0; i < 9; i += 1) input.onmidimessage!({data: [0xf8]});
    expect(advances).toBe(2); // 9 pulses / 4 → two beats
  });
});

describe('Sound.midiOut', () => {
  afterEach(() => vi.useRealTimers());

  it('sends note-on then note-off to the MIDI output', async () => {
    vi.useFakeTimers();
    const sent: number[][] = [];
    const output = {send: (msg: number[] | Uint8Array) => sent.push([...(msg as number[])])};

    // Minimal context: the backend is built on connect(), then preload resolves the output.
    const origin = Date.now();
    const ctx: any = {get currentTime() { return (Date.now() - origin) / 1000; }};
    const node = () => ({gain: {value: 1}, context: ctx, connect() {}, disconnect() {}});
    ctx.createGain = () => node();

    const sound = Sound.midiOut({output, channel: 1});
    sound.connect(node() as unknown as AudioNode);
    await sound.ready;

    sound.noteOn(60, 100, 0, 0.5);
    vi.advanceTimersByTime(600);

    expect(sent).toContainEqual([0x91, 60, 100]); // note-on, channel 1
    expect(sent).toContainEqual([0x81, 60, 0]); // note-off, channel 1
  });

  it('quiets an already-sent MIDI note when its borrowed Sound route is released', async () => {
    vi.useFakeTimers();
    const sent: number[][] = [];
    const output = {send: (msg: number[] | Uint8Array) => sent.push([...(msg as number[])])};
    const origin = Date.now();
    const ctx: any = {get currentTime() { return (Date.now() - origin) / 1000; }};
    const node = () => ({gain: {value: 1}, context: ctx, connect() {}, disconnect() {}});
    ctx.createGain = () => node();
    const sound = Sound.midiOut({output, channel: 2});
    const release = sound.connect(node() as unknown as AudioNode);
    await sound.ready;

    sound.noteOn(60, 100, 0, 10);
    vi.advanceTimersByTime(0); // attack has already reached the hardware
    release();
    vi.advanceTimersByTime(11_000);

    expect(sent).toEqual([
      [0x92, 60, 100],
      [0x82, 60, 0],
    ]);
  });
});
