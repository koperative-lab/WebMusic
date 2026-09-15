// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {ScoreBuilder} from '../../src/core';
import {renderOSMDStaffVisualizer} from '../../src/view/render/osmd-staff';

function resizeHarness() {
  let notify: ResizeObserverCallback = () => {};
  let measuredWidth = 640;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notify = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const container = document.createElement('div');
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({width: measuredWidth}) as DOMRect);
  return {
    container,
    disconnect,
    measure(width: number) { measuredWidth = width; },
    resize(width: number, height = 300) {
      measuredWidth = width;
      notify([{contentRect: {width, height}}] as ResizeObserverEntry[], {} as ResizeObserver);
    },
  };
}

function fakeCursor(position = 0) {
  const iterator = {EndReached: false, currentTimeStamp: {RealValue: position}};
  return {
    iterator,
    show: vi.fn(), hide: vi.fn(), update: vi.fn(),
    reset: vi.fn(() => { iterator.currentTimeStamp.RealValue = 0; }),
    next: vi.fn(() => { iterator.currentTimeStamp.RealValue += 0.25; }),
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('engraving container resize', () => {
  it('keeps explicit scroll overrides while allowing a non-scrolling redraw to cancel queued work', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    const cursor = {...fakeCursor(), cursorElement: {scrollIntoView: vi.fn()}};
    const handle = await renderOSMDStaffVisualizer(new ScoreBuilder().build(), document.createElement('div'), {
      musicXML: '<score-partwise/>', followCursor: false,
      osmd: {load: async () => {}, render: () => {}, cursor},
    });
    handle.redraw({pitch: 60, startTime: 1, endTime: 2}, true);
    handle.redraw(undefined, false);
    for (const frame of frames.splice(0)) frame(0);
    expect(cursor.cursorElement.scrollIntoView).not.toHaveBeenCalled();
    expect(cursor.iterator.currentTimeStamp.RealValue).toBe(0.5);
    expect(cursor.hide).not.toHaveBeenCalled();
    handle.redraw({pitch: 62, startTime: 2, endTime: 3}, true);
    for (const frame of frames.splice(0)) frame(0);
    expect(cursor.cursorElement.scrollIntoView).toHaveBeenCalledOnce();
    handle.dispose?.();
  });

  it('reflows width changes without reloading and cancels pending work on disposal', async () => {
    vi.useFakeTimers();
    const {container, resize, disconnect} = resizeHarness();
    const render = vi.fn();
    const load = vi.fn(async () => {});
    const handle = await renderOSMDStaffVisualizer(new ScoreBuilder().build(), container, {
      musicXML: '<score-partwise/>',
      OpenSheetMusicDisplay: class {
        load = load;
        render = render;
      } as never,
    });
    const initial = render.mock.calls.length;
    resize(420, 300);
    await vi.advanceTimersByTimeAsync(110);
    expect(render).toHaveBeenCalledTimes(initial + 1);
    expect(load).toHaveBeenCalledOnce();
    resize(420, 700);
    await vi.advanceTimersByTimeAsync(110);
    expect(render).toHaveBeenCalledTimes(initial + 1);
    resize(280, 700);
    handle.dispose?.();
    await vi.advanceTimersByTimeAsync(110);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(render).toHaveBeenCalledTimes(initial + 1);
  });

  it('restores the current target on OSMD replacement cursors and keeps cleared cursors hidden', async () => {
    vi.useFakeTimers();
    const {container, resize} = resizeHarness();
    const cursors: ReturnType<typeof fakeCursor>[] = [];
    const load = vi.fn(async () => {});
    const handle = await renderOSMDStaffVisualizer(new ScoreBuilder().build(), container, {
      musicXML: '<score-partwise/>', followCursor: false,
      OpenSheetMusicDisplay: class {
        cursor?: ReturnType<typeof fakeCursor>;
        load = load;
        render() {
          // Real OSMD replaces its cursor and can adopt the old iterator's
          // position when RestoreCursorAfterRerender is enabled.
          this.cursor = fakeCursor(this.cursor?.iterator.currentTimeStamp.RealValue);
          cursors.push(this.cursor);
        }
      },
    });
    handle.redraw({pitch: 60, startTime: 4, endTime: 5});
    const first = cursors[0]!;
    expect(first.iterator.currentTimeStamp.RealValue).toBe(2);
    resize(420);
    await vi.advanceTimersByTimeAsync(110);
    const second = cursors[1]!;
    expect(second).not.toBe(first);
    expect(second.reset).toHaveBeenCalledOnce();
    expect(second.iterator.currentTimeStamp.RealValue).toBe(2);
    expect(second.show).toHaveBeenCalledOnce();
    const oldCalls = first.next.mock.calls.length;
    handle.redraw({pitch: 62, startTime: 6, endTime: 7});
    expect(second.iterator.currentTimeStamp.RealValue).toBe(3);
    expect(first.next).toHaveBeenCalledTimes(oldCalls);
    // Backward seeks must use checkpoints counted from the replacement
    // cursor's beginning, even if OSMD had preserved a nonzero iterator.
    handle.redraw({pitch: 64, startTime: 1, endTime: 2});
    expect(second.iterator.currentTimeStamp.RealValue).toBe(0.5);
    handle.clearActiveNotes();
    resize(280);
    await vi.advanceTimersByTimeAsync(110);
    const third = cursors[2]!;
    expect(third.hide).toHaveBeenCalledOnce();
    expect(third.show).not.toHaveBeenCalled();
    handle.redraw({pitch: 65, startTime: 2, endTime: 3});
    expect(third.show).toHaveBeenCalledOnce();
    expect(third.iterator.currentTimeStamp.RealValue).toBe(1);
    handle.dispose?.();
    expect(third.hide).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledOnce();
  });

  it('cancels hidden pending reflows and renders again when the same positive width returns', async () => {
    vi.useFakeTimers();
    const {container, resize, measure} = resizeHarness();
    const render = vi.fn();
    const handle = await renderOSMDStaffVisualizer(new ScoreBuilder().build(), container, {
      musicXML: '<score-partwise/>',
      OpenSheetMusicDisplay: class {
        load = async () => {};
        render = render;
      },
    });
    resize(280);
    resize(0);
    await vi.advanceTimersByTimeAsync(110);
    expect(render).toHaveBeenCalledOnce();
    resize(280);
    await vi.advanceTimersByTimeAsync(110);
    expect(render).toHaveBeenCalledTimes(2);
    // The pending timer also checks actual layout when notification of the
    // hidden state has not been delivered yet.
    resize(420);
    measure(0);
    await vi.advanceTimersByTimeAsync(110);
    expect(render).toHaveBeenCalledTimes(2);
    resize(420);
    await vi.advanceTimersByTimeAsync(110);
    expect(render).toHaveBeenCalledTimes(3);
    handle.dispose?.();
  });
});
