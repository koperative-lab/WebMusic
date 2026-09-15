// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Duration, Pitch, Rational, ScoreBuilder, VoiceId, type Score} from '../../src/core';
import {SheetViewElement} from '../../src/view/element/sheet-view';

const source = vi.hoisted(() => ({load: vi.fn()}));
vi.mock('../../src/io/load', () => ({loadScoreFromUrl: source.load}));

const tag = 'test-sheet-layout';
customElements.define(tag, SheetViewElement);

function score(): Score {
  const builder = new ScoreBuilder();
  const part = builder.newPartId();
  builder.addPart({id: part, name: 'Piano'});
  for (const [index, name] of ['C4', 'E4', 'G4', 'C5'].entries()) {
    builder.addNote(part, {
      id: builder.newNoteId(), pitch: Pitch.parse(name), onsetQuarters: new Rational(index * 2),
      duration: Duration.half(), voice: VoiceId(`${part}-voice`),
    });
  }
  return builder.build();
}

function mount(attributes: Record<string, string> = {}) {
  const load = vi.fn(async () => {});
  const render = vi.fn();
  const construct = vi.fn();
  const automaticScroll = vi.fn();
  const scroll = vi.fn();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  const instances: FakeOSMD[] = [];
  class FakeOSMD {
    FollowCursor: boolean;
    load = load;
    render = render;
    clear = vi.fn();
    cursor = {
      iterator: {EndReached: false, currentTimeStamp: {RealValue: 0}},
      show: vi.fn(), hide: vi.fn(), update: vi.fn(),
      reset: vi.fn(() => { this.cursor.iterator.currentTimeStamp.RealValue = 0; }),
      next: vi.fn(() => {
        this.cursor.iterator.currentTimeStamp.RealValue += 0.25;
        if (this.FollowCursor) automaticScroll();
      }),
      cursorElement: {scrollIntoView: scroll},
    };
    constructor(_container: string | HTMLElement, options: unknown) {
      construct();
      this.FollowCursor = (options as {followCursor: boolean}).followCursor;
      instances.push(this);
    }
  }
  const player = document.createElement('div');
  player.id = 'sheet-layout-player';
  const element = document.createElement(tag) as SheetViewElement;
  element.OpenSheetMusicDisplay = FakeOSMD as never;
  element.setAttribute('player', `#${player.id}`);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
  document.body.append(player, element);
  return {
    element, load, render, construct, instances, automaticScroll, scroll,
    frame() { for (const callback of frames.splice(0)) callback(0); },
    end() { player.dispatchEvent(new Event('webscore:end')); },
    note(kind: 'noteon' | 'noteoff', midi: number, startTime: number) {
      player.dispatchEvent(new CustomEvent(`webscore:${kind}`, {detail: {midi, startTime}}));
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
  source.load.mockReset();
  vi.unstubAllGlobals();
});

describe('SheetView presentation-only settings', () => {
  it('withdraws queued scrolling immediately when following is disabled, preserving held notes', async () => {
    source.load.mockResolvedValue(score());
    const h = mount({src: 'score.mxl'});
    await vi.waitFor(() => expect(h.render).toHaveBeenCalledOnce());
    h.note('noteon', 64, 1);
    h.element.setAttribute('follow-cursor', 'false');
    h.element.removeAttribute('follow-cursor');
    h.frame();
    expect(h.scroll).not.toHaveBeenCalled();
    const cursor = h.instances[0]!.cursor;
    expect(cursor.iterator.currentTimeStamp.RealValue).toBe(0.5);
    expect(cursor.hide).not.toHaveBeenCalled();

    // An obsolete callback must not suppress the new owner's queued scroll.
    h.note('noteon', 67, 2);
    h.element.setAttribute('follow-cursor', 'false');
    h.element.removeAttribute('follow-cursor');
    h.note('noteon', 72, 3);
    h.frame();
    expect(h.scroll).toHaveBeenCalledOnce();
    h.note('noteoff', 72, 3);
    expect(cursor.iterator.currentTimeStamp.RealValue).toBe(1);
    expect(cursor.hide).not.toHaveBeenCalled();
    expect(h.construct).toHaveBeenCalledOnce();
    expect(h.load).toHaveBeenCalledOnce();
  });

  it.each(['noteoff', 'end'] as const)('cancels queued scrolling after %s clears the cursor', async (action) => {
    source.load.mockResolvedValue(score());
    const h = mount({src: 'score.mxl'});
    await vi.waitFor(() => expect(h.render).toHaveBeenCalledOnce());
    h.note('noteon', 64, 1);
    if (action === 'end') h.end();
    else h.note('noteoff', 64, 1);
    h.frame();
    expect(h.scroll).not.toHaveBeenCalled();
    expect(h.instances[0]!.cursor.hide).toHaveBeenCalledOnce();
    h.note('noteon', 67, 2);
    h.frame();
    expect(h.scroll).toHaveBeenCalledOnce();
  });

  it('applies size immediately during a pending source load without restarting it', async () => {
    let resolve!: (value: Score) => void;
    source.load.mockImplementation(() => new Promise<Score>((done) => { resolve = done; }));
    const h = mount({src: 'score.mxl'});
    await vi.waitFor(() => expect(source.load).toHaveBeenCalledOnce());
    const signal = source.load.mock.calls[0]![1].signal as AbortSignal;
    h.element.setAttribute('width', '280');
    h.element.setAttribute('height', '240');
    h.element.setAttribute('follow-cursor', 'false');
    expect(h.element.style.width).toBe('280px');
    expect(h.element.style.height).toBe('240px');
    expect(source.load).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(false);
    resolve(score());
    await vi.waitFor(() => expect(h.render).toHaveBeenCalledOnce());
    expect(h.instances[0]!.FollowCursor).toBe(false);
    expect(h.construct).toHaveBeenCalledOnce();
  });

  it('preserves the engraving and cursor while resizing, and removes only owned sizes', async () => {
    source.load.mockResolvedValue(score());
    const h = mount({src: 'score.mxl'});
    await vi.waitFor(() => expect(h.render).toHaveBeenCalledOnce());
    h.note('noteon', 64, 1);
    const instance = h.instances[0]!;
    const position = instance.cursor.iterator.currentTimeStamp.RealValue;
    const stage = h.element.querySelector('[part="surface"]');
    expect((stage!.parentElement as HTMLElement).style.getPropertyValue('--wm-stage-background')).toBe('var(--wm-sheet-background, var(--wm-surface, #fff))');
    const styles = h.element.querySelectorAll('style').length;
    h.element.setAttribute('width', '280');
    h.element.setAttribute('height', '240');
    h.element.setAttribute('height', '320');
    expect(h.element.querySelector('[part="surface"]')).toBe(stage);
    expect(h.element.querySelectorAll('style')).toHaveLength(styles);
    expect(instance.cursor.iterator.currentTimeStamp.RealValue).toBe(position);
    expect(source.load).toHaveBeenCalledOnce();
    expect(h.load).toHaveBeenCalledOnce();
    expect(h.construct).toHaveBeenCalledOnce();
    h.element.style.width = '80%';
    h.element.removeAttribute('width');
    h.element.removeAttribute('height');
    expect(h.element.style.width).toBe('80%');
    expect(h.element.style.height).toBe('');
  });

  it('changes cursor following live without reloading, clearing held notes or rebuilding OSMD', async () => {
    source.load.mockResolvedValue(score());
    const h = mount({src: 'score.mxl', 'follow-cursor': 'false'});
    await vi.waitFor(() => expect(h.render).toHaveBeenCalledOnce());
    const instance = h.instances[0]!;
    h.note('noteon', 64, 1);
    h.frame();
    expect(instance.cursor.iterator.currentTimeStamp.RealValue).toBe(0.5);
    expect(h.automaticScroll).not.toHaveBeenCalled();
    expect(h.scroll).not.toHaveBeenCalled();
    const resets = instance.cursor.reset.mock.calls.length;
    h.element.removeAttribute('follow-cursor');
    expect(instance.FollowCursor).toBe(true);
    expect(instance.cursor.reset).toHaveBeenCalledTimes(resets);
    h.note('noteon', 67, 2);
    h.frame();
    expect(h.automaticScroll).toHaveBeenCalled();
    expect(h.scroll).toHaveBeenCalledOnce();
    h.automaticScroll.mockClear(); h.scroll.mockClear();
    h.element.setAttribute('follow-cursor', 'false');
    h.note('noteon', 72, 3);
    h.frame();
    expect(instance.cursor.iterator.currentTimeStamp.RealValue).toBe(1.5);
    expect(h.automaticScroll).not.toHaveBeenCalled();
    expect(h.scroll).not.toHaveBeenCalled();
    h.note('noteoff', 72, 3);
    expect(instance.cursor.iterator.currentTimeStamp.RealValue).toBe(1);
    expect(instance.cursor.hide).not.toHaveBeenCalled();
    expect(source.load).toHaveBeenCalledOnce();
    expect(h.load).toHaveBeenCalledOnce();
    expect(h.construct).toHaveBeenCalledOnce();
    expect(h.render).toHaveBeenCalledOnce();
  });
});
