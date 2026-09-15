// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from 'vitest';
import {PitchViewElement, definePitchViewElement, type PitchViewType} from '../../src/view/element/pitch-view';
import {currentFretMarks, currentStaffMarks, parseViewTuning} from '../../src/view/core/pitch-readout';

definePitchViewElement();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function player(midis: readonly number[] = []) {
  const element = Object.assign(document.createElement('div'), {
    state: {nominalSeconds: 1, playing: true, activeNotes: midis.map((midi) => ({midi}))},
    getPlaybackSnapshot() { return this.state; },
    seek: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  });
  element.id = 'player';
  document.body.append(element);
  return element;
}

function mount(type: PitchViewType) {
  const element = document.createElement('pitch-view') as PitchViewElement;
  element.setAttribute('type', type);
  element.setAttribute('player', '#player');
  element.setAttribute('data-motion', 'none');
  document.body.append(element);
  return element;
}

function emit(source: Element, type: string, midi?: number): void {
  source.dispatchEvent(new CustomEvent(type, {detail: midi === undefined ? undefined : {midi}}));
}

function drawn(element: Element): number[] {
  return [...new Set([...element.querySelectorAll('[data-midi][data-active="true"]')]
    .map((node) => Number(node.getAttribute('data-midi'))))].sort((a, b) => a - b);
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('passive pitch-view types', () => {
  it('draws the same initial notes in three sibling surfaces without nesting controls', () => {
    const source = player([60, 64, 67]);
    const keyboard = mount('keyboard');
    const staff = mount('staff');
    const fretboard = mount('fretboard');
    for (const surface of [keyboard, staff, fretboard]) {
      expect(surface.active).toEqual([60, 64, 67]);
      expect(drawn(surface)).toEqual([60, 64, 67]);
      expect(surface.querySelector('button, input, pitch-view, [role="tablist"]')).toBeNull();
      expect(surface.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('C4');
    }
    expect(staff.querySelectorAll('svg')).toHaveLength(1);
    expect(fretboard.querySelectorAll('svg')).toHaveLength(1);
    keyboard.remove();
    staff.remove();
    fretboard.remove();
    expect(source.stop).not.toHaveBeenCalled();
    expect(source.dispose).not.toHaveBeenCalled();
  });

  it.each(['keyboard', 'staff', 'fretboard'] as const)('%s preserves overlapping unisons and clears on seek snapshots', (tag) => {
    const source = player();
    const surface = mount(tag);
    emit(source, 'webscore:noteon', 64);
    emit(source, 'webscore:noteon', 64);
    emit(source, 'webscore:noteoff', 64);
    expect(surface.active).toEqual([64]);
    source.state.activeNotes = [{midi: 67}];
    emit(source, 'webscore:seek');
    expect(surface.active).toEqual([67]);
    expect(drawn(surface)).toEqual([67]);
    emit(source, 'webscore:noteoff', 67);
    expect(surface.active).toEqual([]);
    expect(drawn(surface)).toEqual([]);
    if (tag !== 'keyboard') expect(surface.textContent).toContain('No sounding notes');
    else expect(surface.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Sounding');
  });

  it('reconciles pause and resumed held-note snapshots without independent playback', () => {
    const source = player([60, 64]);
    const staff = mount('staff');
    const fretboard = mount('fretboard');
    source.state.playing = false;
    source.state.activeNotes = [];
    emit(source, 'webscore:statechange');
    expect(staff.active).toEqual([]);
    expect(fretboard.active).toEqual([]);
    source.state.playing = true;
    source.state.activeNotes = [{midi: 67}];
    emit(source, 'webscore:statechange');
    emit(source, 'webscore:statechange');
    expect(staff.active).toEqual([67]);
    expect(fretboard.active).toEqual([67]);
    emit(source, 'webscore:noteoff', 67);
    expect(staff.active).toEqual([]);
    expect(fretboard.active).toEqual([]);
    expect(source.seek).not.toHaveBeenCalled();
    expect(source.stop).not.toHaveBeenCalled();
  });

  it.each(['keyboard', 'staff', 'fretboard'] as const)('%s discovers late owners and releases replaced ones', async (tag) => {
    const surface = mount(tag);
    expect(surface.active).toEqual([]);
    const first = player([60]);
    await flush();
    expect(surface.active).toEqual([60]);
    first.remove();
    const second = player([67]);
    await flush();
    expect(surface.active).toEqual([67]);
    emit(first, 'webscore:noteon', 64);
    expect(surface.active).toEqual([67]);
    surface.removeAttribute('player');
    expect(surface.active).toEqual([]);
    emit(second, 'webscore:noteon', 64);
    expect(surface.active).toEqual([]);
    surface.setAttribute('player', '#player');
    expect(surface.active).toEqual([67]);
    surface.remove();
    expect(surface.active).toEqual([]);
    emit(second, 'webscore:noteon', 64);
    expect(surface.active).toEqual([]);
    document.body.append(surface);
    expect(surface.active).toEqual([67]);
    emit(second, 'webscore:noteoff', 67);
    expect(surface.active).toEqual([]);
  });

  it('changes spelling and staff system while retaining the note stream', () => {
    const source = player([61]);
    const staff = mount('staff');
    expect(staff.querySelector('[data-midi="61"]')?.getAttribute('data-diatonic')).toBe('28');
    staff.setAttribute('spelling', 'flat');
    expect(staff.querySelector('[data-midi="61"]')?.getAttribute('data-diatonic')).toBe('29');
    expect(staff.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('Db4');
    staff.setAttribute('system', 'bass');
    expect(staff.querySelectorAll('.wui-pitch-staff__line')).toHaveLength(5);
    expect(staff.querySelectorAll('.wui-pitch-staff__clef')).toHaveLength(1);
    staff.setAttribute('density', 'compact');
    expect(staff.active).toEqual([61]);
    expect(staff.querySelector('[data-density="compact"]')).not.toBeNull();
    emit(source, 'webscore:noteoff', 61);
    expect(staff.active).toEqual([]);
  });

  it('maps exact pitches in a custom reentrant tuning and reports a window with no positions', () => {
    player([67]);
    const fretboard = mount('fretboard');
    fretboard.setAttribute('tuning', '67,60,64,69');
    fretboard.setAttribute('frets', '5');
    expect(fretboard.tuning).toEqual([67, 60, 64, 69]);
    const open = fretboard.querySelector('[data-midi="67"][data-fret="0"]');
    expect(open).not.toBeNull();
    expect(fretboard.querySelector('[data-midi="67"][data-fret="3"]')).not.toBeNull();
    expect(fretboard.querySelector('[data-midi="67"][data-fret="7"]')).toBeNull();
    fretboard.setAttribute('first-fret', '20');
    expect(fretboard.active).toEqual([67]);
    expect(drawn(fretboard)).toEqual([]);
    expect(fretboard.textContent).toContain('No sounding pitches in this fret range');
    fretboard.setAttribute('tuning', 'bad');
    expect(fretboard.tuning).toEqual([40, 45, 50, 55, 59, 64]);
    fretboard.setAttribute('first-fret', '-4');
    fretboard.setAttribute('frets', '200');
    expect(fretboard.firstFret).toBe(0);
    expect(fretboard.frets).toBe(24);
  });
});

describe('pitch readout projection', () => {
  it('spells chromatic pairs as distinct exact pitches without harmonic inference', () => {
    expect(currentStaffMarks([60, 61, 127], 'sharp')).toMatchObject([
      {midi: 60, diatonic: 28, label: 'C4'},
      {midi: 61, diatonic: 28, accidental: 'sharp', label: 'C#4'},
      {midi: 127, label: 'G9'},
    ]);
    expect(currentStaffMarks([61], 'flat')).toMatchObject([{midi: 61, diatonic: 29, accidental: 'flat', label: 'Db4'}]);
  });

  it('keeps physical string order and exact octaves, never substituting a pitch class', () => {
    const tuning = parseViewTuning('67 60 64 69');
    expect(currentFretMarks([67], tuning, 0, 5, 'sharp')).toMatchObject([
      {midi: 67, stringIndex: 0, fret: 0},
      {midi: 67, stringIndex: 2, fret: 3},
    ]);
    expect(currentFretMarks([79], tuning, 0, 5, 'sharp')).toEqual([]);
    expect(parseViewTuning(' ')).toEqual([40, 45, 50, 55, 59, 64]);
    expect(parseViewTuning('40,128')).toEqual([40, 45, 50, 55, 59, 64]);
  });
});

describe('pitch-view composition and lifetime', () => {
  it('keeps one note subscription and duplicate-note counts while switching types', () => {
    const source = player();
    const subscribe = vi.spyOn(source, 'addEventListener');
    const snapshot = vi.spyOn(source, 'getPlaybackSnapshot');
    const surface = mount('keyboard');
    emit(source, 'webscore:noteon', 64);
    emit(source, 'webscore:noteon', 64);
    const subscriptions = subscribe.mock.calls.length;
    const snapshots = snapshot.mock.calls.length;
    const firstRoot = surface.querySelector('[role="img"]');
    for (const type of ['staff', 'fretboard', 'keyboard'] as const) {
      surface.setAttribute('type', type);
      expect(surface.type).toBe(type);
      expect(surface.active).toEqual([64]);
      expect(drawn(surface)).toEqual([64]);
      expect(surface.querySelectorAll('[role="img"]')).toHaveLength(1);
    }
    expect(firstRoot?.isConnected).toBe(false);
    expect(subscribe).toHaveBeenCalledTimes(subscriptions);
    expect(snapshot).toHaveBeenCalledTimes(snapshots);
    emit(source, 'webscore:noteoff', 64);
    expect(surface.active).toEqual([64]);
    emit(source, 'webscore:noteoff', 64);
    expect(surface.active).toEqual([]);
    expect(drawn(surface)).toEqual([]);
    expect(surface.querySelector('[data-phase="release"]')).toBeNull();
    expect(source.seek).not.toHaveBeenCalled();
    expect(source.stop).not.toHaveBeenCalled();
  });

  it('retains irrelevant type options without repainting and applies them when selected', () => {
    player([61]);
    const surface = mount('keyboard');
    const keyboard = surface.querySelector('[role="img"]');
    surface.setAttribute('system', 'bass');
    surface.setAttribute('tuning', '60');
    surface.setAttribute('first-fret', '1');
    surface.setAttribute('frets', '3');
    expect(surface.querySelector('[role="img"]')).toBe(keyboard);
    surface.setAttribute('type', 'staff');
    expect(surface.querySelectorAll('.wui-pitch-staff__line')).toHaveLength(5);
    surface.setAttribute('type', 'fretboard');
    expect(surface.querySelector('[data-midi="61"][data-fret="1"]')).not.toBeNull();
    expect(surface.tuning).toEqual([60]);
    expect(surface.firstFret).toBe(1);
    expect(surface.frets).toBe(3);
    surface.setAttribute('type', 'unsupported');
    expect(surface.type).toBe('keyboard');
    expect(surface.querySelector('.wui-pitch-keyboard')).not.toBeNull();
    expect(surface.active).toEqual([61]);
  });

  it.each(['keyboard', 'staff', 'fretboard'] as const)('applies spelling and theme to %s while keeping note identity', (type) => {
    const source = player([61, 61]);
    const surface = mount(type);
    const snapshot = vi.spyOn(source, 'getPlaybackSnapshot');
    surface.setAttribute('spelling', 'flat');
    surface.setAttribute('density', 'compact');
    surface.setAttribute('scheme', 'dark');
    expect(surface.spelling).toBe('flat');
    expect(surface.density).toBe('compact');
    expect(surface.scheme).toBe('dark');
    expect(surface.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('Db4');
    expect(surface.querySelector('[data-density="compact"][data-scheme="dark"]')).not.toBeNull();
    expect(snapshot).not.toHaveBeenCalled();
    emit(source, 'webscore:noteoff', 61);
    expect(surface.active).toEqual([61]);
    emit(source, 'webscore:noteoff', 61);
    expect(surface.active).toEqual([]);
  });

  it('uses overrideable host styles and preserves explicit application sizing across switches', () => {
    player([60]);
    const surface = mount('keyboard');
    expect(surface.style.display).toBe('');
    expect(surface.style.inlineSize).toBe('');
    const layout = [...surface.querySelectorAll('style')].find((style) => style.textContent?.includes(':where(pitch-view)'))!;
    expect(layout.textContent).toContain('inline-size: 100%; min-inline-size: 0;');
    expect(layout.textContent).toContain(':where(pitch-view:not([hidden]))');
    surface.style.inlineSize = '240px';
    surface.style.display = 'inline-block';
    surface.setAttribute('type', 'staff');
    expect(surface.style.inlineSize).toBe('240px');
    expect(surface.style.display).toBe('inline-block');
    surface.style.removeProperty('display');
    surface.hidden = true;
    expect(getComputedStyle(surface).display).toBe('none');
    surface.remove();
    expect(layout.isConnected).toBe(false);
    expect(surface.querySelector('[role="img"]')).toBeNull();
    expect(surface.active).toEqual([]);
    document.body.append(surface);
    expect(surface.active).toEqual([60]);
    expect(surface.querySelectorAll('[role="img"]')).toHaveLength(1);
    expect(getComputedStyle(surface).display).toBe('none');
    const active = surface.active;
    active.push(127);
    expect(surface.active).toEqual([60]);
  });
});


it('upgrades a type property assigned before custom-element registration', async () => {
  player([60]);
  const element = document.createElement('late-pitch-view') as PitchViewElement;
  element.type = 'staff';
  element.setAttribute('player', '#player');
  document.body.append(element);
  customElements.define('late-pitch-view', class extends PitchViewElement {});
  await flush();
  expect(Object.hasOwn(element, 'type')).toBe(false);
  expect(element.type).toBe('staff');
  expect(element.getAttribute('type')).toBe('staff');
  expect(element.querySelector('.wui-pitch-staff')).not.toBeNull();
  element.type = 'fretboard';
  expect(element.getAttribute('type')).toBe('fretboard');
  expect(drawn(element)).toEqual([60]);
});
