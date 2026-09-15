import {describe, expect, it} from 'vitest';
import {
  Duration,
  MeasureId,
  PartId,
  Pitch,
  Rational,
  ScoreBuilder,
  VoiceId,
  type Score,
} from '../../src/core';
import {renderOSMDStaffVisualizer} from '../../src/view/render/osmd-staff';

/**
 * Minimal score at 120 bpm: 1 second == 2 quarters == 0.5 whole notes, so a
 * note starting at `t` seconds maps the OSMD cursor to `t / 2` whole notes.
 * The TimeMap extrapolates linearly past the last measure, so synthetic
 * cursor timelines can be much longer than the single notated measure.
 */
function buildScore(): Score {
  const builder = new ScoreBuilder();
  const partId = PartId('piano');
  const voice = VoiceId('piano-v1');
  const timeSignature = {numerator: 4, denominator: 4};

  builder
    .addTempo({atQuarters: Rational.ZERO, bpm: 120})
    .addMeter({atQuarters: Rational.ZERO, measureNumber: 1, timeSignature});
  builder.addPart({id: partId, name: 'Piano', staves: 1});
  builder.addMeasure({
    id: MeasureId('m1'),
    number: 1,
    onsetQuarters: Rational.ZERO,
    durationQuarters: new Rational(4),
    timeSignature,
  });
  builder.addNote(partId, {
    id: builder.newNoteId(),
    pitch: Pitch.parse('C4'),
    onsetQuarters: Rational.ZERO,
    duration: Duration.quarter(),
    voice,
  });
  return builder.build();
}

interface StubState {
  nextCalls: number;
  resetCalls: number;
  updateCalls: number;
  /** Reads of iterator.currentTimeStamp.RealValue (Fraction math in real OSMD). */
  timestampReads: number;
  scrollCalls: number;
  index: number;
}

/**
 * Stub OSMD whose cursor walks a synthetic whole-note timestamp list,
 * counting every next()/reset()/update()/timestamp read/scrollIntoView —
 * same duck-typed-stub style as stub-dom.ts.
 */
function makeStubOSMD(timestamps: number[]) {
  const state: StubState = {
    nextCalls: 0,
    resetCalls: 0,
    updateCalls: 0,
    timestampReads: 0,
    scrollCalls: 0,
    index: 0,
  };
  const cursor = {
    show(): void {},
    hide(): void {},
    reset(): void {
      state.resetCalls += 1;
      state.index = 0;
    },
    next(): void {
      state.nextCalls += 1;
      if (state.index < timestamps.length - 1) state.index += 1;
    },
    update(): void {
      state.updateCalls += 1;
    },
    cursorElement: {
      scrollIntoView(): void {
        state.scrollCalls += 1;
      },
    },
    iterator: {
      get EndReached(): boolean {
        return state.index >= timestamps.length - 1;
      },
      currentTimeStamp: {
        get RealValue(): number {
          state.timestampReads += 1;
          return timestamps[state.index];
        },
      },
    },
  };
  const osmd = {
    load: () => Promise.resolve(),
    render(): void {},
    cursor,
    clear(): void {},
  };
  return {osmd, state};
}

/** Eighth-note grid: timestamps[i] = i / 8 whole notes. */
function eighthGrid(count: number): number[] {
  return Array.from({length: count}, (_, i) => i / 8);
}

/** Active note whose startTime maps to `wholeNotes` (120 bpm: t = 2w). */
function noteAt(wholeNotes: number) {
  return {pitch: 60, velocity: 80, startTime: wholeNotes * 2, endTime: wholeNotes * 2 + 0.25};
}

const container = {} as unknown as HTMLElement;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

async function renderWith(timestamps: number[]) {
  const {osmd, state} = makeStubOSMD(timestamps);
  const rendered = await renderOSMDStaffVisualizer(buildScore(), container, {
    musicXML: '<score-partwise/>',
    osmd,
  });
  return {rendered, state};
}

describe('renderOSMDStaffVisualizer cursor sync', () => {
  it('chord-duplicate redraws at the same timestamp cause zero extra cursor calls', async () => {
    const {rendered, state} = await renderWith(eighthGrid(64));

    rendered.redraw(noteAt(2)); // step to 2 whole notes
    const after = {...state};
    expect(after.nextCalls).toBe(16); // 2 whole notes on an eighth grid

    // Remaining notes of the same chord: identical timestamp.
    rendered.redraw(noteAt(2));
    rendered.redraw(noteAt(2));
    rendered.redraw(noteAt(2));
    expect(state.nextCalls).toBe(after.nextCalls);
    expect(state.updateCalls).toBe(after.updateCalls);
    expect(state.resetCalls).toBe(after.resetCalls);
    expect(state.timestampReads).toBe(after.timestampReads);
    expect(state.scrollCalls).toBe(after.scrollCalls);
  });

  it('forward seek steps incrementally without reset', async () => {
    const {rendered, state} = await renderWith(eighthGrid(64));

    rendered.redraw(noteAt(1));
    expect(state.nextCalls).toBe(8);
    rendered.redraw(noteAt(3));
    expect(state.nextCalls).toBe(24); // only the 16 additional steps
    expect(state.resetCalls).toBe(0);
    expect(state.index).toBe(24);
  });

  it('backward seek uses checkpoints: bounded next() calls, few timestamp reads', async () => {
    // 1025 events -> indices 0..1024, eighth grid up to 128 whole notes.
    const {rendered, state} = await renderWith(eighthGrid(1025));

    rendered.redraw(noteAt(124)); // forward to index 992, recording checkpoints
    expect(state.index).toBe(992);

    const before = {...state};
    rendered.redraw(noteAt(123)); // backward seek to index 984

    const nextDelta = state.nextCalls - before.nextCalls;
    const readsDelta = state.timestampReads - before.timestampReads;
    expect(state.resetCalls - before.resetCalls).toBe(1);
    expect(state.index).toBe(984);

    // Replay lands on the last checkpoint <= target (step 960 with K=64),
    // then fine-steps the remaining 24: at most target steps + one
    // checkpoint interval of next() calls.
    expect(nextDelta).toBe(984);
    expect(nextDelta).toBeLessThanOrEqual(984 + 64);

    // The expensive part of a naive re-walk is the per-step timestamp read
    // (Fraction computation in real OSMD): a full comparing re-walk would
    // read ~984 timestamps; the checkpoint replay reads none, so only the
    // fine walk after the checkpoint reads (< one interval + bookkeeping).
    expect(readsDelta).toBeLessThanOrEqual(2 * 64);
    expect(readsDelta).toBeLessThan(984 / 4);
  });

  it('reacquires the iterator after reset replaces it, including checkpoint replay', async () => {
    const timestamps = eighthGrid(1025);
    const makeIterator = () => {
      const iterator = {
        index: 0,
        get EndReached() { return this.index >= timestamps.length - 1; },
        get currentTimeStamp() { return {RealValue: timestamps[this.index]}; },
      };
      return iterator;
    };
    const cursor = {
      iterator: makeIterator(),
      show() {}, hide() {}, update() {},
      reset() { this.iterator = makeIterator(); },
      next() { this.iterator.index = Math.min(this.iterator.index + 1, timestamps.length - 1); },
    };
    const rendered = await renderOSMDStaffVisualizer(buildScore(), container, {
      musicXML: '<score-partwise/>', followCursor: false,
      osmd: {load: async () => {}, render() {}, cursor},
    });
    rendered.redraw(noteAt(124));
    const oldIterator = cursor.iterator;
    expect(oldIterator.index).toBe(992);
    rendered.redraw(noteAt(123));
    expect(cursor.iterator).not.toBe(oldIterator);
    expect(cursor.iterator.index).toBe(984);
    expect(oldIterator.index).toBe(992);
    // A target before the first checkpoint must fine-walk the new iterator.
    rendered.redraw(noteAt(1));
    expect(cursor.iterator.index).toBe(8);
    rendered.redraw(noteAt(3));
    expect(cursor.iterator.index).toBe(24);
    // Resetting from EndReached must not leave the new iterator stuck at zero.
    rendered.redraw(noteAt(128));
    expect(cursor.iterator.EndReached).toBe(true);
    rendered.redraw(noteAt(2));
    expect(cursor.iterator.index).toBe(16);
    rendered.dispose?.();
  });

  it('clearActiveNotes invalidates checkpoints and the cached target', async () => {
    const {rendered, state} = await renderWith(eighthGrid(1025));

    rendered.redraw(noteAt(124));
    rendered.clearActiveNotes();
    expect(state.index).toBe(0); // cursor reset

    const before = {...state};
    // Same target as before clearing: the cached target must not suppress
    // the move, and checkpoints from the previous walk must not be trusted
    // beyond what a fresh walk re-records.
    rendered.redraw(noteAt(124));
    expect(state.index).toBe(992);
    expect(state.nextCalls - before.nextCalls).toBe(992); // full fresh walk
    expect(state.updateCalls - before.updateCalls).toBe(1);

    // Backward seek after the fresh walk still works (checkpoints rebuilt).
    rendered.redraw(noteAt(123));
    expect(state.index).toBe(984);
  });

  it('dispose clears seek state and keeps the public contract', async () => {
    const {rendered, state} = await renderWith(eighthGrid(64));
    rendered.redraw(noteAt(2));
    expect(() => rendered.dispose?.()).not.toThrow();
    expect(state.index).toBe(16); // dispose hides/clears, does not reseek
  });

  it('coalesces multiple scrolls per animation frame into one', async () => {
    const globals = globalThis as Record<string, unknown>;
    const previousRAF = globals.requestAnimationFrame;
    const frames: Array<() => void> = [];
    globals.requestAnimationFrame = (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    };
    try {
      const {rendered, state} = await renderWith(eighthGrid(64));
      rendered.redraw(noteAt(1));
      rendered.redraw(noteAt(2));
      rendered.redraw(noteAt(3));
      expect(state.scrollCalls).toBe(0); // nothing until the frame fires
      expect(frames.length).toBe(1); // three moves -> one scheduled scroll
      frames.forEach((cb) => cb());
      expect(state.scrollCalls).toBe(1);
    } finally {
      if (previousRAF === undefined) delete globals.requestAnimationFrame;
      else globals.requestAnimationFrame = previousRAF;
    }
  });

  it('respects scrollIntoView=false and followCursor=false', async () => {
    const {osmd, state} = makeStubOSMD(eighthGrid(64));
    const rendered = await renderOSMDStaffVisualizer(buildScore(), container, {
      musicXML: '<score-partwise/>',
      osmd,
      followCursor: false,
    });
    rendered.redraw(noteAt(1));
    expect(state.scrollCalls).toBe(0);
    rendered.redraw(noteAt(2), true);
    expect(state.scrollCalls).toBe(1); // explicit override still scrolls
  });
});

describe('renderOSMDStaffVisualizer adopted-instance ownership', () => {
  it('invalidates a pending shared instance when its render generation is aborted', async () => {
    const loadGate = deferred();
    const loadStarted = deferred();
    let renderCalls = 0;
    let clearCalls = 0;
    const osmd = {
      async load(): Promise<void> {
        loadStarted.resolve();
        await loadGate.promise;
      },
      render(): void {
        renderCalls += 1;
      },
      clear(): void {
        clearCalls += 1;
      },
    };
    const controller = new AbortController();
    const request = renderOSMDStaffVisualizer(buildScore(), container, {
      musicXML: '<old/>',
      osmd,
      signal: controller.signal,
    });
    const outcome = request.catch((error: unknown) => error);
    await loadStarted.promise;

    controller.abort();
    // Model a synchronous replacement by the lightweight staff renderer.
    const currentRenderer = 'lightweight';
    loadGate.resolve();

    await expect(outcome).resolves.toMatchObject({name: 'AbortError'});
    expect(currentRenderer).toBe('lightweight');
    expect(renderCalls).toBe(0);
    expect(clearCalls).toBe(0);
  });

  it('cannot overwrite a different OSMD instance installed after cancellation', async () => {
    const oldGate = deferred();
    const oldStarted = deferred();
    const renders: string[] = [];
    let oldClears = 0;
    let currentSheet = '';
    const oldOSMD = {
      async load(): Promise<void> {
        oldStarted.resolve();
        await oldGate.promise;
      },
      render(): void {
        renders.push('old');
        currentSheet = 'old';
      },
      clear(): void {
        oldClears += 1;
        currentSheet = '';
      },
    };
    const newOSMD = {
      async load(): Promise<void> {},
      render(): void {
        renders.push('new');
        currentSheet = 'new';
      },
      clear(): void {
        currentSheet = '';
      },
    };
    const controller = new AbortController();
    const oldRequest = renderOSMDStaffVisualizer(buildScore(), container, {
      musicXML: '<old/>',
      osmd: oldOSMD,
      signal: controller.signal,
    });
    const oldOutcome = oldRequest.catch((error: unknown) => error);
    await oldStarted.promise;

    controller.abort();
    const current = await renderOSMDStaffVisualizer(buildScore(), container, {
      musicXML: '<new/>',
      osmd: newOSMD,
    });
    oldGate.resolve();

    await expect(oldOutcome).resolves.toMatchObject({name: 'AbortError'});
    expect(renders).toEqual(['new']);
    expect(currentSheet).toBe('new');
    expect(oldClears).toBe(0);
    current.dispose?.();
  });

  it('serializes a reused OSMD instance and lets the newest overlapping load win', async () => {
    const firstGate = deferred();
    const secondGate = deferred();
    const firstStarted = deferred();
    const secondStarted = deferred();
    const loads: string[] = [];
    const renders: string[] = [];
    let loaded = '';
    const osmd = {
      async load(content: string): Promise<void> {
        loads.push(content);
        if (content === '<first/>') {
          firstStarted.resolve();
          await firstGate.promise;
        } else {
          secondStarted.resolve();
          await secondGate.promise;
        }
        loaded = content;
      },
      render(): void {
        renders.push(loaded);
      },
      clear(): void {},
    };

    const first = renderOSMDStaffVisualizer(buildScore(), container, {
      musicXML: '<first/>',
      osmd,
    });
    const firstOutcome = first.catch((error: unknown) => error);
    await firstStarted.promise;

    const second = renderOSMDStaffVisualizer(buildScore(), container, {
      musicXML: '<second/>',
      osmd,
    });
    expect(loads).toEqual(['<first/>']);

    firstGate.resolve();
    await secondStarted.promise;
    await expect(firstOutcome).resolves.toMatchObject({name: 'AbortError'});
    expect(renders).toEqual([]);

    secondGate.resolve();
    const rendered = await second;
    expect(loads).toEqual(['<first/>', '<second/>']);
    expect(renders).toEqual(['<second/>']);
    rendered.dispose?.();
  });

  it('prevents an older handle from redrawing or clearing a newer owner', async () => {
    const secondGate = deferred();
    const secondStarted = deferred();
    const {osmd: cursorOSMD, state} = makeStubOSMD(eighthGrid(64));
    let loaded = '';
    let clearCalls = 0;
    const osmd = {
      ...cursorOSMD,
      async load(content: string): Promise<void> {
        if (content === '<second/>') {
          secondStarted.resolve();
          await secondGate.promise;
        }
        loaded = content;
      },
      render(): void {
        void loaded;
      },
      clear(): void {
        clearCalls += 1;
      },
    };

    const first = await renderOSMDStaffVisualizer(buildScore(), container, {
      musicXML: '<first/>',
      osmd,
    });
    const secondPromise = renderOSMDStaffVisualizer(buildScore(), container, {
      musicXML: '<second/>',
      osmd,
    });
    await secondStarted.promise;

    first.redraw(noteAt(2));
    first.clearActiveNotes();
    first.dispose?.();
    expect(state.nextCalls).toBe(0);
    expect(state.resetCalls).toBe(0);
    expect(clearCalls).toBe(0);

    secondGate.resolve();
    const second = await secondPromise;
    second.redraw(noteAt(2));
    expect(state.nextCalls).toBe(16);
    second.dispose?.();
    expect(clearCalls).toBe(1);
  });
});
