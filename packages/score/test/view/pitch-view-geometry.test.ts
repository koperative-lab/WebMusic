// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
vi.mock('@webmusic/ui/pitch', () => import('../../../ui/src/pitch'));
import {PitchViewElement} from '../../src/view/element/pitch-view';

customElements.define('sized-pitch-view', PitchViewElement);
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
function setup(type = 'keyboard') {
  const player = Object.assign(document.createElement('div'), {
    state: {nominalSeconds: 0, playing: true, activeNotes: [{midi: 64}]},
    getPlaybackSnapshot() { return this.state; },
    stop: vi.fn(), dispose: vi.fn(),
  });
  player.id = 'sizing-player'; document.body.append(player);
  const element = document.createElement('sized-pitch-view') as PitchViewElement;
  element.setAttribute('player', '#sizing-player'); element.setAttribute('type', type);
  element.setAttribute('low', '60'); element.setAttribute('high', '71');
  element.setAttribute('data-motion', 'none'); document.body.append(element);
  return {element, player};
}

describe('pitch-view geometry attributes', () => {
  it('changes exact key dimensions without replacing the borrowed player or losing held notes', () => {
    const {element, player} = setup();
    element.setAttribute('white-key-width', '30'); element.setAttribute('black-key-width', '18');
    element.setAttribute('white-key-height', '80'); element.setAttribute('black-key-height', '50');
    element.setAttribute('follow', 'none');
    expect([element.whiteKeyWidth, element.blackKeyWidth, element.whiteKeyHeight, element.blackKeyHeight]).toEqual([30, 18, 80, 50]);
    expect(element.follow).toBe('none');
    const board = element.querySelector<HTMLElement>('[part~="board"]')!;
    expect(board.style.width).toBe('210px'); expect(board.style.height).toBe('80px');
    expect(element.querySelector<HTMLElement>('[data-midi="61"]')!.style.height).toBe('50px');
    expect(element.active).toEqual([64]);
    expect(element.querySelector('[data-midi="64"]')!.getAttribute('data-active')).toBe('true');
    player.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 64}}));
    expect(element.active).toEqual([]);
    expect(player.stop).not.toHaveBeenCalled(); expect(player.dispose).not.toHaveBeenCalled();
    element.remove();
    player.dispatchEvent(new CustomEvent('webscore:noteon', {detail: {midi: 67}}));
    expect(element.active).toEqual([]);
  });

  it('exposes undefined for invalid dimensions and restores default responsive sizing after removal', () => {
    const {element} = setup();
    element.setAttribute('white-key-width', '22');
    expect(element.querySelector<HTMLElement>('[part~="board"]')!.style.width).toBe('154px');
    element.setAttribute('white-key-width', '-1'); element.setAttribute('black-key-height', 'Infinity');
    expect(element.whiteKeyWidth).toBeUndefined(); expect(element.blackKeyHeight).toBeUndefined();
    expect(element.querySelector<HTMLElement>('[part~="board"]')!.style.width).toBe('');
    element.setAttribute('follow', 'unknown'); expect(element.follow).toBe('active');
  });

  it('fits the complete keyboard and restores requested widths without losing held notes', () => {
    const {element, player} = setup();
    element.setAttribute('white-key-width', '40'); element.setAttribute('black-key-width', '28');
    element.setAttribute('white-key-height', '128'); element.setAttribute('black-key-height', '80');
    expect(element.fitToWidth).toBe(false);
    element.querySelector<HTMLElement>('[role="img"]')!.scrollLeft = 100;
    element.setAttribute('fit-to-width', 'true');
    const board = () => element.querySelector<HTMLElement>('[part~="board"]')!;
    expect(element.fitToWidth).toBe(true);
    expect(board().style.width).toBe('100%');
    expect(Number.parseFloat(board().style.minWidth)).toBe(0);
    expect(board().style.height).toBe('128px');
    expect(element.querySelector<HTMLElement>('[data-midi="61"]')!.style.height).toBe('80px');
    expect(element.querySelector<HTMLElement>('[role="img"]')!.scrollLeft).toBe(0);
    expect(element.whiteKeyWidth).toBe(40); expect(element.blackKeyWidth).toBe(28);
    expect(element.querySelector('[data-midi="64"]')!.getAttribute('data-active')).toBe('true');
    element.type = 'fretboard'; element.type = 'keyboard';
    expect(board().style.width).toBe('100%'); expect(element.active).toEqual([64]);
    element.setAttribute('white-key-width', '30');
    expect(board().style.width).toBe('100%');
    element.setAttribute('fit-to-width', 'false');
    expect(element.fitToWidth).toBe(false); expect(board().style.width).toBe('210px');
    expect(Number.parseFloat(element.querySelector<HTMLElement>('[data-midi="61"]')!.style.width) * 2.1).toBeCloseTo(28);
    element.setAttribute('fit-to-width', ''); expect(element.fitToWidth).toBe(true);
    element.removeAttribute('fit-to-width'); expect(element.fitToWidth).toBe(false);
    expect(board().style.width).toBe('210px');
    player.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 64}}));
    expect(element.active).toEqual([]);
    expect(player.stop).not.toHaveBeenCalled(); expect(player.dispose).not.toHaveBeenCalled();
  });

  it('changes fret dimensions and type while preserving the held-note stream', () => {
    const {element, player} = setup('fretboard');
    element.setAttribute('fret-width', '42'); element.setAttribute('string-spacing', '18'); element.setAttribute('string-width', '2');
    expect([element.fretWidth, element.stringSpacing, element.stringWidth]).toEqual([42, 18, 2]);
    expect(element.querySelector('line[data-string]')!.getAttribute('stroke-width')).toBe('2');
    expect(element.active).toEqual([64]);
    element.type = 'keyboard'; element.type = 'fretboard';
    expect(element.active).toEqual([64]);
    expect(element.querySelector('[data-midi="64"]')).not.toBeNull();
    player.dispatchEvent(new CustomEvent('webscore:noteoff', {detail: {midi: 64}}));
    expect(element.active).toEqual([]);
  });
});
