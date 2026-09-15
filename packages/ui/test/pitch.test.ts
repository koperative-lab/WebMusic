// @vitest-environment jsdom

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  fretPositionsFor,
  mountFretboard,
  mountKeyboard,
  mountStaff,
  pitchStyle,
  staffPlacement,
  type FretboardState,
  type KeyboardState,
  type StaffState,
} from '../src/pitch';

/**
 * What jsdom does NOT give these surfaces, measured rather than assumed:
 *
 * - `getBoundingClientRect()` / `clientWidth` are present and all `0`. The
 *   keyboard uses percentages; staff/fretboard use viewBox units. The staff
 *   extends its lines with ResizeObserver when available, stubbed below to
 *   verify measured layout rather than asserting zero-size jsdom rectangles.
 * - `matchMedia` is absent. `motion: 'auto'` asks an ancestor's `data-motion`
 *   first and the media query only after that, every call optional-chained: the
 *   cases below mount hundreds of times in a document that has no `matchMedia`
 *   at all, and one unguarded call would throw on the first of them.
 * - `requestAnimationFrame` exists but is a real ~16 ms wall-clock timer, so
 *   every attack/release case drives it with fake timers.
 * - custom properties do not inherit, so no numeric geometry is ever read back
 *   out of a `--wui-*` token. The shapes are constants in `internal/pitch-geometry`.
 */

const STANDARD_TUNING = [40, 45, 50, 55, 59, 64] as const;

function host(): HTMLElement {
  const node = document.createElement('div');
  document.body.append(node);
  return node;
}

/** Every element under a root, as tag plus its sorted `data-*`. */
function shape(root: Element): string[] {
  return [root, ...root.querySelectorAll('*')].map((node) => {
    const data = [...node.attributes]
      .filter((attribute) => attribute.name.startsWith('data-'))
      .map((attribute) => `${attribute.name}=${attribute.value}`)
      .sort();
    return `${node.tagName}[${data.join(' ')}]`;
  });
}

/** Every attribute value and inline style in the tree, for the NaN sweep. */
function values(root: Element): string[] {
  return [root, ...root.querySelectorAll('*')].flatMap((node) =>
    [...node.attributes].map((attribute) => attribute.value),
  );
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  // The media-query case installs a `matchMedia` this environment does not
  // have; leaving it behind would quietly answer for every case after it.
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('staffPlacement', () => {
  it('puts middle C between the staves on one ledger', () => {
    // The grand staff is one continuous ladder: the treble's top line is 38 and
    // the bass's is 26, so 28 is the only line position in the gap.
    expect(staffPlacement(28)).toEqual({y: 10, ledgers: [28]});
  });

  it('gives C6 exactly two upper ledgers, because a ledger sits only on a line', () => {
    // Above the treble's top line (F5 = 38) the line positions are A5 = 40 and
    // C6 = 42. Counting half-spaces here instead would answer four.
    expect(staffPlacement(42).ledgers).toEqual([40, 42]);
    expect(staffPlacement(41).ledgers).toEqual([40]);
    // The space directly above the top line borrows nothing.
    expect(staffPlacement(39).ledgers).toEqual([]);
  });

  it('leaves every step inside a staff bare', () => {
    for (const step of [38, 36, 34, 32, 30, 26, 24, 22, 20, 18, 31, 25]) {
      expect(staffPlacement(step).ledgers, `diatonic ${step}`).toEqual([]);
    }
  });

  it('runs ledgers downward below the bass staff, nearest first', () => {
    expect(staffPlacement(17).ledgers).toEqual([]);
    expect(staffPlacement(16).ledgers).toEqual([16]);
    expect(staffPlacement(14).ledgers).toEqual([16, 14]);
  });

  it('answers for a single staff without inventing the other one', () => {
    expect(staffPlacement(28, 'treble').ledgers).toEqual([28]);
    expect(staffPlacement(26, 'treble').ledgers).toEqual([28, 26]);
    expect(staffPlacement(28, 'bass').ledgers).toEqual([28]);
    expect(staffPlacement(30, 'bass').ledgers).toEqual([28, 30]);
  });

  it('answers for a non-finite step instead of returning NaN', () => {
    // Middle C, and not the C0 five ledgers under the bass staff that a bare
    // `0` would give: `@webmusic/score`'s `staffPlacement` falls back to the
    // same step, and two modules of one name answering differently about one
    // ladder is the drift both their headers warn about.
    expect(staffPlacement(Number.NaN).y).toBe(10);
    expect(staffPlacement(Number.NaN)).toEqual(staffPlacement(28));
  });
});

describe('fretPositionsFor', () => {
  it('finds every place inside the window that sounds one pitch', () => {
    // C4 on a guitar in standard tuning, first five frets: G string fret 5 and
    // B string fret 1. Which one a hand should take is not this function's
    // question.
    expect(fretPositionsFor(60, STANDARD_TUNING, {firstFret: 0, fretCount: 5})).toEqual([
      {stringIndex: 3, fret: 5},
      {stringIndex: 4, fret: 1},
    ]);
  });

  it('returns nothing rather than throwing when the window cannot reach', () => {
    expect(fretPositionsFor(24, STANDARD_TUNING, {firstFret: 0, fretCount: 5})).toEqual([]);
    expect(fretPositionsFor(Number.NaN, STANDARD_TUNING)).toEqual([]);
    expect(fretPositionsFor(60, [])).toEqual([]);
  });

  it('drops the open string once the window has left the nut', () => {
    // E4 is the open sixth string; a window starting at fret 3 cannot play it
    // open, and says so instead of drawing a dot outside itself.
    expect(fretPositionsFor(64, STANDARD_TUNING, {firstFret: 0, fretCount: 5})).toContainEqual({
      stringIndex: 5,
      fret: 0,
    });
    expect(fretPositionsFor(64, STANDARD_TUNING, {firstFret: 3, fretCount: 5})).not.toContainEqual({
      stringIndex: 5,
      fret: 0,
    });
  });
});

// ---------------------------------------------------------------------------

describe('mountKeyboard', () => {
  it('answers key() only for pitches it actually drew', () => {
    const handle = mountKeyboard(host(), {snapshot: () => ({low: 60, high: 72, marks: []})});
    expect(handle.key(60)).toBeInstanceOf(HTMLElement);
    expect(handle.key(72)).toBeInstanceOf(HTMLElement);
    expect(handle.key(59)).toBeUndefined();
    expect(handle.key(73)).toBeUndefined();
    expect(handle.key(Number.NaN)).toBeUndefined();
    handle.destroy();
  });

  it('reuses the key nodes across repeated updates', () => {
    let state: KeyboardState = {low: 60, high: 72, marks: [{midi: 60, role: 'root'}]};
    const handle = mountKeyboard(host(), {snapshot: () => state});
    const before = [...handle.board.children];
    const root = handle.key(60);

    state = {...state, marks: [{midi: 64, role: 'third'}]};
    handle.update();
    state = {...state, marks: [{midi: 67, role: 'fifth'}]};
    handle.update();

    // Node identity, not rendered equality: a rebuilt board restarts every
    // transition, which pins the surface on the first frame of its own attack.
    expect([...handle.board.children]).toEqual(before);
    expect(handle.key(60)).toBe(root);
    expect(handle.key(67)?.dataset.role).toBe('fifth');
    expect(handle.key(60)?.dataset.active).toBe('false');
    handle.destroy();
  });

  it('writes data-phase once per set change, not once per update', () => {
    vi.useFakeTimers();
    const state: KeyboardState = {low: 60, high: 72, marks: [{midi: 60, role: 'root'}]};
    const handle = mountKeyboard(host(), {snapshot: () => state});
    vi.advanceTimersByTime(50);
    expect(handle.key(60)?.dataset.phase).toBe('sustain');

    const observer = new MutationObserver(() => {});
    observer.observe(handle.board, {subtree: true, attributes: true, attributeFilter: ['data-phase']});
    for (let index = 0; index < 60; index += 1) handle.update();
    // The snapshot never changed, so nothing about the phase did either.
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
    handle.destroy();
  });

  it('presses on attack and releases with a tail', () => {
    vi.useFakeTimers();
    let state: KeyboardState = {low: 60, high: 72, marks: [{midi: 60, role: 'root', since: 0}], now: 0};
    const handle = mountKeyboard(host(), {snapshot: () => state}, {release: 140});
    expect(handle.key(60)?.dataset.phase).toBe('attack');
    expect(handle.key(60)?.dataset.active).toBe('true');
    // The role fill lands as a value on the node, so it survives a host with no
    // tokens at all.
    expect(handle.key(60)?.style.getPropertyValue('--wui-pitch-key-face')).toContain('--wm-degree-root');

    vi.advanceTimersByTime(50);
    expect(handle.key(60)?.dataset.phase).toBe('sustain');

    state = {...state, marks: [], now: 2};
    handle.update();
    expect(handle.key(60)?.dataset.phase).toBe('release');
    expect(handle.key(60)?.dataset.active).toBe('false');

    vi.advanceTimersByTime(300);
    expect(handle.key(60)?.dataset.phase).toBeUndefined();
    handle.destroy();
  });

  it('prints the role mark and the age, and lets a caller override the mark', () => {
    const handle = mountKeyboard(host(), {
      snapshot: (): KeyboardState => ({
        low: 60,
        high: 72,
        now: 2,
        marks: [
          {midi: 60, role: 'root', label: 'C4', since: 0},
          {midi: 66, role: 'extension', mark: '#11', label: 'F#4'},
        ],
      }),
    });
    expect(handle.key(60)?.textContent).toContain('R');
    // The role alone cannot tell a 9 from a sharp 11; the caller can.
    expect(handle.key(66)?.textContent).toContain('#11');
    expect(handle.key(60)?.style.getPropertyValue('--wui-harmony-age')).toBe('0.5');
    // No `since` means no age at all, rather than a made-up zero.
    expect(handle.key(66)?.style.getPropertyValue('--wui-harmony-age')).toBe('');
    handle.destroy();
  });

  it('keeps ghosts on their own channel, readable without seeing a colour', () => {
    const handle = mountKeyboard(host(), {
      snapshot: (): KeyboardState => ({
        low: 60,
        high: 72,
        marks: [{midi: 60, role: 'root'}],
        ghostPitchClasses: [2, 4],
      }),
    });
    expect(handle.key(62)?.dataset.ghost).toBe('true');
    expect(handle.key(62)?.dataset.active).toBe('false');
    expect(handle.key(64)?.dataset.ghost).toBe('true');
    // A sounding key is never also a ghost, whatever its pitch class.
    expect(handle.key(60)?.dataset.ghost).toBeUndefined();
    expect(handle.key(61)?.dataset.ghost).toBeUndefined();
    handle.destroy();
  });

  it('ignores a mark outside the drawn range instead of throwing', () => {
    const onError = vi.fn();
    const handle = mountKeyboard(
      host(),
      {snapshot: (): KeyboardState => ({low: 60, high: 72, marks: [{midi: 21}, {midi: 108}, {midi: Number.NaN}]})},
      {onError},
    );
    expect(onError).not.toHaveBeenCalled();
    expect(handle.element.querySelectorAll('[data-active="true"]')).toHaveLength(0);
    handle.destroy();
  });

  it('lays a reduced surface out identically and only spends the durations down', () => {
    const snapshot = (): KeyboardState => ({low: 60, high: 72, marks: [{midi: 64, role: 'third'}]});
    const flowing = mountKeyboard(host(), {snapshot});
    const stepped = mountKeyboard(host(), {snapshot}, {motion: 'stepped'});

    expect(shape(stepped.element).length).toBe(shape(flowing.element).length);
    expect(stepped.key(64)?.className).toBe(flowing.key(64)?.className);
    expect(stepped.key(64)?.style.left).toBe(flowing.key(64)?.style.left);
    expect(stepped.key(64)?.style.width).toBe(flowing.key(64)?.style.width);
    expect(stepped.element.dataset.motion).toBe('stepped');
    expect(flowing.element.dataset.motion).toBe('continuous');
    expect(stepped.element.style.getPropertyValue('--wui-harmony-motion-tone')).toBe('0s');
    expect(flowing.element.style.getPropertyValue('--wui-harmony-motion-tone')).toBe('');
    flowing.destroy();
    stepped.destroy();
  });

  it('takes the shell answer for motion rather than asking a media query', () => {
    // `matchMedia` does not exist here; a mount that reached for it unguarded
    // would throw, and the shell's answer has to win over it in any case.
    expect(globalThis.matchMedia).toBeUndefined();
    const shell = host();
    shell.dataset.motion = 'none';
    const inner = document.createElement('div');
    shell.append(inner);
    const handle = mountKeyboard(inner, {snapshot: (): KeyboardState => ({marks: []})});
    expect(handle.element.dataset.motion).toBe('none');
    handle.destroy();
  });

  it('asks the viewer when no shell above it has answered', () => {
    const matchMedia = vi.fn(
      (query: string) => ({matches: query.includes('reduced-motion'), media: query}) as MediaQueryList,
    );
    vi.stubGlobal('matchMedia', matchMedia);
    const handle = mountKeyboard(host(), {snapshot: (): KeyboardState => ({marks: []})});
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(handle.element.dataset.motion).toBe('stepped');
    handle.destroy();

    // A shell that DID answer outranks the viewer's own setting, because six
    // surfaces on one workbench may not disagree about how much they move.
    const shell = host();
    shell.dataset.motion = 'continuous';
    const inner = document.createElement('div');
    shell.append(inner);
    const shelled = mountKeyboard(inner, {snapshot: (): KeyboardState => ({marks: []})});
    expect(shelled.element.dataset.motion).toBe('continuous');
    shelled.destroy();
  });
});

// ---------------------------------------------------------------------------

describe('mountStaff', () => {
  it('keeps an implicit signature pitch distinct from an explicit natural on the same step', () => {
    let state: StaffState = {
      keySignature: [{diatonic: 28, accidental: 'sharp'}],
      marks: [
        {midi: 60, diatonic: 28, accidental: 'natural', label: 'C4'},
        {midi: 61, diatonic: 28, label: 'C#4', id: 'voice-a'},
        {midi: 61, diatonic: 28, label: 'C#4', id: 'voice-b'},
        {midi: 62, diatonic: 29, label: 'D4'},
      ],
    };
    const handle = mountStaff(host(), {snapshot: () => state});
    const heads = () => [...handle.svg.querySelectorAll<SVGGElement>('.wui-pitch-staff__note')];
    expect(heads().map((node) => Number(node.dataset.midi))).toEqual([60, 61, 62]);
    expect(
      heads().map((node) => node.querySelectorAll('.wui-pitch-staff__accidental').length),
    ).toEqual([1, 0, 0]);
    expect(handle.note(0, 28)?.dataset.midi).toBe('60');

    state = {...state, marks: state.marks.slice(1)};
    handle.update();
    expect(heads().map((node) => Number(node.dataset.midi))).toEqual([61, 62]);
    expect(handle.note(0, 28)?.dataset.midi).toBe('61');
    handle.destroy();
  });

  it('draws different spellings on one step without duplicating a unison', () => {
    let state: StaffState = {
      columns: 1,
      activeColumn: 2,
      marks: [
        {midi: 60, diatonic: 28, column: 2, accidental: 'natural', label: 'C4'},
        {midi: 60, diatonic: 28, column: 2, accidental: 'natural', label: 'C4'},
        {midi: 61, diatonic: 28, column: 2, accidental: 'sharp', label: 'C#4'},
        {midi: 61, diatonic: 28, column: 2, accidental: 'sharp', label: 'C#4'},
      ],
    };
    const onError = vi.fn();
    const handle = mountStaff(host(), {snapshot: () => state}, {onError});
    const heads = () => [...handle.svg.querySelectorAll('.wui-pitch-staff__note')];
    const first = handle.note(2, 28);
    expect(heads().length).toBe(2);
    expect(first).toBe(heads()[0]);
    expect(heads().map((node) => node.getAttribute('data-when'))).toEqual(['now', 'now']);
    expect(
      new Set(heads().map((node) => node.querySelector('ellipse')?.getAttribute('cx'))).size,
    ).toBe(2);
    expect(handle.svg.querySelectorAll('.wui-pitch-staff__accidental')).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();

    handle.update();
    expect(handle.note(2, 28)).toBe(first);
    expect(heads()).toHaveLength(2);
    state = {...state, marks: [state.marks[0]!]};
    handle.update();
    expect(heads()).toEqual([first]);
    handle.destroy();
  });

  it('draws no text node at all when the caller supplies no clefs', () => {
    const handle = mountStaff(host(), {
      snapshot: (): StaffState => ({marks: [{midi: 60, diatonic: 28, role: 'root'}]}),
    });
    // The kit positions a clef; it does not know one. Nothing in this package
    // may carry a notation glyph, and this is the assertion that keeps it so.
    expect(handle.element.querySelectorAll('text')).toHaveLength(0);
    expect(handle.svg.querySelectorAll('text')).toHaveLength(0);
    handle.destroy();
  });

  it('positions the caller-supplied clef strings and nothing else', () => {
    const handle = mountStaff(host(), {
      snapshot: (): StaffState => ({
        marks: [{midi: 60, diatonic: 28}],
        clefs: {upper: 'TREBLE', lower: 'BASS'},
      }),
    });
    const clefs = [...handle.svg.querySelectorAll('text')];
    expect(clefs.map((node) => node.textContent)).toEqual(['TREBLE', 'BASS']);
    expect(clefs.map((node) => node.getAttribute('data-clef'))).toEqual(['upper', 'lower']);
    handle.destroy();
  });

  it('places ledgers and accidentals as geometry, with no glyph font', () => {
    const handle = mountStaff(host(), {
      snapshot: (): StaffState => ({
        marks: [{midi: 60, diatonic: 28, role: 'root', accidental: 'sharp'}],
      }),
    });
    const note = handle.note(0, 28);
    expect(note?.querySelectorAll('.wui-pitch-staff__ledger')).toHaveLength(1);
    const accidental = note?.querySelector('.wui-pitch-staff__accidental');
    expect(accidental?.tagName).toBe('path');
    expect(accidental?.getAttribute('d')).toMatch(/^M/);
    // A presentation attribute, not a CSS rule: a host that opted out of the
    // stylesheet would otherwise get a black notehead on a black ground.
    expect(note?.querySelector('.wui-pitch-staff__head')?.getAttribute('fill')).toContain(
      '--wm-degree-root',
    );
    handle.destroy();
  });

  it('derives past / now / next / far from the columns, with no extra field', () => {
    const handle = mountStaff(host(), {
      snapshot: (): StaffState => ({
        columns: 4,
        activeColumn: 1,
        marks: [
          {midi: 60, diatonic: 28, column: 0},
          {midi: 62, diatonic: 29, column: 1},
          {midi: 64, diatonic: 30, column: 2},
          {midi: 65, diatonic: 31, column: 3},
        ],
      }),
    });
    expect(handle.note(0, 28)?.getAttribute('data-when')).toBe('past');
    expect(handle.note(1, 29)?.getAttribute('data-when')).toBe('now');
    expect(handle.note(2, 30)?.getAttribute('data-when')).toBe('next');
    expect(handle.note(3, 31)?.getAttribute('data-when')).toBe('far');
    handle.destroy();
  });

  it('gives follow:anchor and follow:none the same noteheads and only a different reel', () => {
    const snapshot = (follow: 'anchor' | 'none') => (): StaffState => ({
      follow,
      columns: 3,
      activeColumn: 1,
      clefs: {upper: 'TREBLE'},
      marks: [
        {midi: 60, diatonic: 28, column: 0, role: 'root'},
        {midi: 64, diatonic: 30, column: 1, role: 'third'},
      ],
    });
    const anchored = mountStaff(host(), {snapshot: snapshot('anchor')});
    const still = mountStaff(host(), {snapshot: snapshot('none')});

    expect(shape(anchored.element)).toEqual(shape(still.element));
    expect(anchored.svg.getAttribute('viewBox')).toBe(still.svg.getAttribute('viewBox'));

    const reel = (handle: typeof anchored): string | null =>
      handle.svg.querySelector('.wui-pitch-staff__reel')!.getAttribute('transform');
    expect(reel(still)).toBe('translate(0 0)');
    expect(reel(anchored)).not.toBe(reel(still));
    anchored.destroy();
    still.destroy();
  });

  it('skips a mark with no diatonic step, reports it, and does not throw', () => {
    const onError = vi.fn();
    const handle = mountStaff(
      host(),
      {
        snapshot: (): StaffState => ({
          marks: [
            {midi: 60, diatonic: 28},
            {midi: 62} as unknown as StaffState['marks'][number],
          ],
        }),
      },
      {onError},
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(handle.svg.querySelectorAll('.wui-pitch-staff__note')).toHaveLength(1);
    handle.destroy();
  });

  it('reuses a notehead across updates and fades a new one in', () => {
    vi.useFakeTimers();
    let state: StaffState = {columns: 2, activeColumn: 0, marks: [{midi: 60, diatonic: 28}]};
    const handle = mountStaff(host(), {snapshot: () => state});
    const first = handle.note(0, 28);
    expect(first?.getAttribute('data-phase')).toBe('attack');
    vi.advanceTimersByTime(50);
    expect(first?.getAttribute('data-phase')).toBe('sustain');

    state = {...state, activeColumn: 1, marks: [{midi: 60, diatonic: 28}, {midi: 64, diatonic: 30, column: 1}]};
    handle.update();
    expect(handle.note(0, 28)).toBe(first);
    expect(first?.getAttribute('data-phase')).toBe('sustain');
    expect(handle.note(1, 30)?.getAttribute('data-phase')).toBe('attack');
    handle.destroy();
  });

  it('reuses the ELLIPSE, not just the group, when only the role changes', () => {
    // The group surviving is not enough. A replaced element has no previous
    // computed style, so it cannot transition: rebuilding the children every
    // repaint pins the notehead's colour on a hard cut while the keyboard's
    // fades, and allocates the whole drawing again for a picture that did not
    // change.
    let state: StaffState = {marks: [{midi: 60, diatonic: 28, role: 'root', accidental: 'sharp'}]};
    const handle = mountStaff(host(), {snapshot: () => state});
    const group = handle.note(0, 28)!;
    const head = group.querySelector('.wui-pitch-staff__head');
    const accidental = group.querySelector('.wui-pitch-staff__accidental');
    const ledger = group.querySelector('.wui-pitch-staff__ledger');

    state = {marks: [{midi: 60, diatonic: 28, role: 'third', accidental: 'sharp'}]};
    handle.update();
    expect(handle.note(0, 28)).toBe(group);
    expect(group.querySelector('.wui-pitch-staff__head')).toBe(head);
    expect(group.querySelector('.wui-pitch-staff__accidental')).toBe(accidental);
    expect(group.querySelector('.wui-pitch-staff__ledger')).toBe(ledger);
    // And the paint did land on the node that survived.
    expect(head?.getAttribute('fill')).toContain('--wm-degree-third');
    expect(accidental?.getAttribute('stroke')).toContain('--wm-degree-third');

    // Ten more repaints of an unchanged snapshot create nothing at all.
    const before = [...group.children];
    for (let index = 0; index < 10; index += 1) handle.update();
    expect([...group.children]).toEqual(before);
    handle.destroy();
  });

  it('frames what it drew, so a note far off the staff is not clipped away', () => {
    const framed = (marks: StaffState['marks']): number[] => {
      const handle = mountStaff(host(), {snapshot: (): StaffState => ({marks})});
      const box = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
      handle.destroy();
      return box;
    };
    // Middle C sits inside the grand staff, so the frame is the staff's own.
    const plain = framed([{midi: 60, diatonic: 28}]);
    // C8 is ten ledgers above it. A frame derived from the five lines alone
    // emits the head in full and lets the viewport eat it.
    const high = framed([{midi: 108, diatonic: 56}]);
    const low = framed([{midi: 12, diatonic: 0}]);
    expect(high[1]!).toBeLessThan(plain[1]!);
    expect(high[1]! + high[3]!).toBe(plain[1]! + plain[3]!);
    expect(low[1]!).toBe(plain[1]!);
    expect(low[1]! + low[3]!).toBeGreaterThan(plain[1]! + plain[3]!);
    // C8's own head, ledgers and all, is inside the box it was framed with.
    expect(high[1]!).toBeLessThanOrEqual(38 - 56 - 0.95);
  });

  it('stacks a column of accidentals leftwards without one covering another', () => {
    const handle = mountStaff(host(), {
      snapshot: (): StaffState => ({
        marks: [28, 29, 30, 31, 32].map((diatonic) => ({
          midi: 60 + diatonic - 28,
          diatonic,
          accidental: 'sharp' as const,
        })),
      }),
    });
    const at = (diatonic: number): number =>
      Number(
        /translate\((-?[\d.]+)/.exec(
          handle.note(0, diatonic)!.querySelector('.wui-pitch-staff__accidental')!.getAttribute('transform')!,
        )![1],
      );
    const xs = [32, 31, 30, 29, 28].map(at);
    // Highest step first, each one further left than the last, and every pair
    // at least one glyph apart. Measuring from a head that the second-interval
    // rule has already displaced cancels the stagger, which put two sharps a
    // step apart on top of each other.
    for (let index = 1; index < xs.length; index += 1) {
      expect(xs[index]!, `slot ${index}`).toBeLessThan(xs[index - 1]!);
      expect(xs[index - 1]! - xs[index]!, `gap ${index}`).toBeGreaterThanOrEqual(2);
    }
    handle.destroy();
  });

  it('widens the gutter for the key signature instead of drawing through the notes', () => {
    const lead = (keySignature: StaffState['keySignature']): number => {
      const handle = mountStaff(host(), {
        snapshot: (): StaffState => ({keySignature, marks: [{midi: 60, diatonic: 28}]}),
      });
      const head = Number(handle.note(0, 28)!.querySelector('.wui-pitch-staff__head')!.getAttribute('cx'));
      const signature = [...handle.svg.querySelectorAll('.wui-pitch-staff__signature')];
      const rightmost = signature.reduce(
        (widest, node) => Math.max(widest, Number(/translate\((-?[\d.]+)/.exec(node.getAttribute('transform')!)![1])),
        Number.NEGATIVE_INFINITY,
      );
      const box = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
      handle.destroy();
      // Every accidental of the signature is drawn, clear of the first
      // notehead, and inside the frame.
      expect(signature).toHaveLength(keySignature?.length ?? 0);
      if (signature.length > 0) {
        expect(rightmost).toBeLessThan(head - 1.25);
        expect(rightmost).toBeLessThan(box[0]! + box[2]!);
      }
      return head;
    };
    const bare = lead(undefined);
    const seven = lead(
      [26, 29, 25, 28, 24, 27, 23].map((diatonic) => ({diatonic, accidental: 'flat' as const})),
    );
    expect(seven).toBeGreaterThan(bare);
  });

  it('shows the caller empty copy only while there is nothing to draw', () => {
    let state: StaffState = {marks: [], emptyLabel: 'Nothing sounding'};
    const handle = mountStaff(host(), {snapshot: () => state});
    const empty = handle.element.querySelector<HTMLElement>('.wui-pitch-staff__empty')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe('Nothing sounding');
    expect(empty.getAttribute('aria-live')).toBe('polite');

    state = {...state, marks: [{midi: 60, diatonic: 28}]};
    handle.update();
    expect(empty.hidden).toBe(true);
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------

describe('mountFretboard', () => {
  const CHORD = (): FretboardState => ({
    strings: 6,
    firstFret: 0,
    fretCount: 5,
    inlays: [3, 5],
    muted: [0],
    barre: [{fret: 1, fromString: 1, toString: 5}],
    marks: [
      {stringIndex: 1, fret: 3, role: 'root', label: 'C3'},
      {stringIndex: 2, fret: 2, role: 'third'},
      {stringIndex: 4, fret: 1, role: 'seventh'},
      {stringIndex: 5, fret: 0, role: 'fifth'},
    ],
  });

  it('turns orientation into coordinates and nothing else', () => {
    const horizontal = mountFretboard(host(), {snapshot: () => ({...CHORD(), orientation: 'horizontal'})});
    const vertical = mountFretboard(host(), {snapshot: () => ({...CHORD(), orientation: 'vertical'})});

    // The same assertion body, run twice: identical node set, identical data-*.
    expect(shape(vertical.element)).toEqual(shape(horizontal.element));
    // And a genuinely different drawing, or the comparison above proves nothing.
    expect(vertical.svg.getAttribute('viewBox')).not.toBe(horizontal.svg.getAttribute('viewBox'));
    expect(vertical.dot(1, 3)?.firstElementChild?.getAttribute('cx')).not.toBe(
      horizontal.dot(1, 3)?.firstElementChild?.getAttribute('cx'),
    );
    horizontal.destroy();
    vertical.destroy();
  });

  it('paints the role fill and its ink as presentation attributes', () => {
    const handle = mountFretboard(host(), {snapshot: CHORD});
    const dot = handle.dot(1, 3)!;
    expect(dot.getAttribute('data-role')).toBe('root');
    expect(dot.firstElementChild?.getAttribute('fill')).toContain('--wm-degree-root');
    expect(dot.lastElementChild?.getAttribute('fill')).toContain('--wm-degree-ink');
    expect(dot.textContent).toBe('R');
    handle.destroy();
  });

  it('lets a mark win over a mute on the same string', () => {
    const handle = mountFretboard(host(), {
      snapshot: (): FretboardState => ({
        strings: 6,
        muted: [0, 1],
        marks: [{stringIndex: 1, fret: 2, role: 'root'}],
      }),
    });
    const muted = [...handle.svg.querySelectorAll('.wui-pitch-fretboard__muted')].map((node) =>
      node.getAttribute('data-string'),
    );
    expect(muted).toEqual(['0']);
    handle.destroy();
  });

  it('numbers the window once it has left the nut', () => {
    let state: FretboardState = {strings: 6, firstFret: 0, fretCount: 5, marks: []};
    const handle = mountFretboard(host(), {snapshot: () => state});
    const number = (): string | null =>
      handle.svg.querySelector('.wui-pitch-fretboard__fret-number')!.textContent;
    expect(number()).toBe('');

    state = {...state, firstFret: 5};
    handle.update();
    // `5fr`, the way a chord book writes it. A bare `5` sits beside fingering
    // numbers and string numbers and reads as one of them.
    expect(number()).toBe('5fr');
    handle.destroy();
  });

  it('keeps an auto window that still holds the shape', () => {
    let state: FretboardState = {
      strings: 6,
      firstFret: 'auto',
      fretCount: 5,
      marks: [{stringIndex: 0, fret: 4}],
    };
    const handle = mountFretboard(host(), {snapshot: () => state});
    const reel = handle.svg.querySelector('.wui-pitch-fretboard__reel')!;
    const number = (): string | null =>
      handle.svg.querySelector('.wui-pitch-fretboard__fret-number')!.textContent;
    // A shape the nut window already holds does not move the neck at all.
    expect(number()).toBe('');

    state = {...state, marks: [{stringIndex: 0, fret: 8}]};
    handle.update();
    expect(number()).toBe('3fr');
    const settled = reel.getAttribute('transform');

    // The two ends of THAT window, alternating. A neck that re-centred on each
    // of them would swing back and forth once per chord, which reads as a fault
    // rather than as a hand.
    for (const fret of [4, 8, 4, 8]) {
      state = {...state, marks: [{stringIndex: 0, fret}]};
      handle.update();
      expect(reel.getAttribute('transform'), `fret ${fret}`).toBe(settled);
      expect(number()).toBe('3fr');
    }

    // And it does move, by as little as it can, once the shape genuinely leaves.
    state = {...state, marks: [{stringIndex: 0, fret: 11}]};
    handle.update();
    expect(number()).toBe('6fr');
    expect(reel.getAttribute('transform')).not.toBe(settled);
    handle.destroy();
  });

  it('grows a dot on attack and drops it after the release', () => {
    vi.useFakeTimers();
    let state: FretboardState = {strings: 6, marks: [{stringIndex: 1, fret: 3, role: 'root'}]};
    const handle = mountFretboard(host(), {snapshot: () => state}, {release: 140});
    expect(handle.dot(1, 3)?.getAttribute('data-phase')).toBe('attack');
    vi.advanceTimersByTime(50);
    expect(handle.dot(1, 3)?.getAttribute('data-phase')).toBe('sustain');

    state = {...state, marks: []};
    handle.update();
    expect(handle.dot(1, 3)?.getAttribute('data-phase')).toBe('release');
    vi.advanceTimersByTime(300);
    expect(handle.dot(1, 3)).toBeUndefined();
    handle.destroy();
  });

  it('reuses a dot node across updates', () => {
    let state: FretboardState = {strings: 6, marks: [{stringIndex: 1, fret: 3, role: 'root'}]};
    const handle = mountFretboard(host(), {snapshot: () => state});
    const dot = handle.dot(1, 3);
    const disc = dot?.firstElementChild;
    state = {...state, marks: [{stringIndex: 1, fret: 3, role: 'third'}]};
    handle.update();
    expect(handle.dot(1, 3)).toBe(dot);
    expect(dot?.firstElementChild).toBe(disc);
    expect(dot?.getAttribute('data-role')).toBe('third');
    handle.destroy();
  });

  it('draws no nut and keeps the open marker in place once the window moves up', () => {
    let state: FretboardState = {strings: 6, firstFret: 0, fretCount: 5, marks: []};
    const handle = mountFretboard(host(), {snapshot: () => state});
    const wires = (): string[] =>
      [...handle.svg.querySelectorAll('.wui-pitch-fretboard__nut, .wui-pitch-fretboard__wire')].map(
        (node) => node.getAttribute('data-fret')!,
      );
    expect(handle.svg.querySelectorAll('.wui-pitch-fretboard__nut')).toHaveLength(1);
    expect(wires()).toEqual(['0', '1', '2', '3', '4', '5']);

    // A sixth-fret shape frames at the third position. A neck built from the
    // nut and slid left leaves the nut alive outside the frame, where a
    // letterboxed viewport paints it — a third-position box with a nut in it.
    state = {
      ...state,
      firstFret: 'auto',
      marks: [
        {stringIndex: 5, fret: 0, role: 'root'},
        {stringIndex: 1, fret: 6, role: 'third'},
        {stringIndex: 2, fret: 8, role: 'fifth'},
      ],
    };
    handle.update();
    expect(handle.svg.querySelectorAll('.wui-pitch-fretboard__nut')).toHaveLength(0);
    expect(wires()).toEqual(['2', '3', '4', '5', '6', '7', '8']);

    // The open string is a fact about a STRING, so its dot sits outside the
    // reel at the same place it sat at the nut — never behind a fret wire and
    // never off the edge.
    const openDot = handle.dot(5, 0)!;
    expect(openDot.parentElement?.getAttribute('class')).toBe('wui-pitch-fretboard__open');
    expect(handle.dot(1, 6)!.parentElement?.getAttribute('class')).toBe(
      'wui-pitch-fretboard__dots',
    );
    const box = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
    const cx = Number(openDot.firstElementChild!.getAttribute('cx'));
    expect(cx).toBeGreaterThan(box[0]!);
    expect(cx).toBeLessThan(box[0]! + box[2]!);
    handle.destroy();
  });

  it('gives the neck the same room to breathe at every window', () => {
    const air = (firstFret: number): number => {
      const handle = mountFretboard(host(), {
        snapshot: (): FretboardState => ({strings: 6, firstFret, fretCount: 5, marks: []}),
      });
      const box = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
      const wood = handle.svg.querySelector('.wui-pitch-fretboard__wood')!;
      const slide = Number(
        /translate\((-?[\d.]+)/.exec(
          handle.svg.querySelector('.wui-pitch-fretboard__reel')!.getAttribute('transform')!,
        )![1],
      );
      const right = Number(wood.getAttribute('x')) + Number(wood.getAttribute('width')) + slide;
      handle.destroy();
      return box[0]! + box[2]! - right;
    };
    // A frame sized for the widest case left a fret and a half of bare ground
    // beside a nut-position board and none beside any other, which reads as the
    // neck growing the moment the window leaves the nut.
    expect(air(0)).toBe(air(3));
    expect(air(3)).toBe(air(7));
  });

  it('turns a vertical board into a chord box rather than letterboxing it', () => {
    const sized = (orientation: 'horizontal' | 'vertical') => {
      const handle = mountFretboard(host(), {
        snapshot: (): FretboardState => ({...CHORD(), orientation}),
      });
      const box = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
      const style = {width: handle.svg.style.width, height: handle.svg.style.height};
      handle.destroy();
      return {box, style};
    };
    const flat = sized('horizontal');
    const tall = sized('vertical');
    // The turned viewBox is taller than it is wide, and the element it is drawn
    // into is too. Keeping the horizontal element and turning only the viewBox
    // letterboxed the drawing into a tenth of the width and left the rest bare.
    expect(tall.box[2]! / tall.box[3]!).toBeCloseTo(flat.box[3]! / flat.box[2]!, 6);
    // Both are sized by their HEIGHT and take their own width from the viewBox,
    // so neither carries letterbox slack for out-of-frame content to leak into.
    expect(pitchStyle).toContain('.wui-pitch-fretboard__svg {\n  display: block;\n  width: 100%;');
    expect(tall.style.height).toContain('calc(');
    expect(tall.style.height).not.toBe(flat.style.height);
    expect(flat.style.height).toContain('max(');
  });

  it('frames the gutter text it draws, at either orientation', () => {
    for (const orientation of ['horizontal', 'vertical'] as const) {
      const handle = mountFretboard(host(), {
        snapshot: (): FretboardState => ({
          strings: 6,
          firstFret: 5,
          fretCount: 5,
          muted: [0],
          orientation,
          stringLabels: ['E', 'A', 'D', 'G', 'B', 'E'],
          marks: [{stringIndex: 3, fret: 7}],
        }),
      });
      const box = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
      // jsdom has no `getBBox`, so this is the anchor plus the font's own half
      // height — the same arithmetic that showed the number crossing the frame.
      for (const selector of [
        '.wui-pitch-fretboard__fret-number',
        '.wui-pitch-fretboard__muted',
        '.wui-pitch-fretboard__label',
      ]) {
        const node = handle.svg.querySelector(selector)!;
        const axis = orientation === 'vertical' ? 0 : 1;
        const at = Number(node.getAttribute(axis === 0 ? 'x' : 'y'));
        const half = Number(node.getAttribute('font-size')) * 0.6;
        expect(at - half, `${orientation} ${selector}`).toBeGreaterThan(box[axis]!);
        expect(at + half, `${orientation} ${selector}`).toBeLessThan(box[axis]! + box[axis + 2]!);
      }
      handle.destroy();
    }
  });

  it('stamps the pitch a stop sounds, when the caller knows it', () => {
    const handle = mountFretboard(host(), {
      snapshot: (): FretboardState => ({
        strings: 6,
        marks: [
          {stringIndex: 1, fret: 3, midi: 60, role: 'root'},
          {stringIndex: 2, fret: 2, role: 'third'},
        ],
      }),
    });
    expect(handle.dot(1, 3)?.getAttribute('data-midi')).toBe('60');
    // Not knowing is a supported answer; inventing one is not.
    expect(handle.dot(2, 2)?.getAttribute('data-midi')).toBeNull();
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------

describe('every pitch surface', () => {
  const MOUNTS = [
    ['keyboard', (target: HTMLElement, stylesheet?: boolean) =>
      mountKeyboard(target, {snapshot: (): KeyboardState => ({marks: [{midi: 64, role: 'third'}]})}, {stylesheet})],
    ['staff', (target: HTMLElement, stylesheet?: boolean) =>
      mountStaff(target, {snapshot: (): StaffState => ({marks: [{midi: 64, diatonic: 30, role: 'third'}]})}, {stylesheet})],
    ['fretboard', (target: HTMLElement, stylesheet?: boolean) =>
      mountFretboard(target, {snapshot: (): FretboardState => ({marks: [{stringIndex: 2, fret: 2, role: 'third'}]})}, {stylesheet})],
  ] as const;

  it.each(MOUNTS)('%s resolves its document from the host', (_name, mount) => {
    // A foreign document has no `defaultView`, so this also proves nothing here
    // reaches for a window it was not handed.
    const other = document.implementation.createHTMLDocument('elsewhere');
    const target = other.createElement('div');
    other.body.append(target);
    const handle = mount(target);
    expect(handle.element.ownerDocument).toBe(other);
    expect(handle.element.parentElement).toBe(target);
    for (const node of handle.element.querySelectorAll('*')) {
      expect(node.ownerDocument).toBe(other);
    }
    handle.destroy();
  });

  it.each(MOUNTS)('%s still paints its colours with stylesheet:false', (_name, mount) => {
    const target = host();
    const handle = mount(target, false);
    expect(target.querySelector('style')).toBeNull();
    // The box came inline, from the same records the sheet is generated from.
    expect(handle.element.getAttribute('style')).toContain('color');
    // And the tone colour reached a node, as a value rather than a bare token:
    // these surfaces are allowed to be mounted where no token is declared.
    const painted = [handle.element, ...handle.element.querySelectorAll('*')].some((node) => {
      const inline = node.getAttribute('style') ?? '';
      const fill = node.getAttribute('fill') ?? '';
      return `${inline} ${fill}`.includes('--wm-degree-third');
    });
    expect(painted).toBe(true);
    handle.destroy();
    expect(target.children.length).toBe(0);
  });

  it.each(MOUNTS)('%s writes no NaN, at jsdom width zero and with hostile numbers', (_name, mount) => {
    const target = host();
    // Everything here measures zero in jsdom; nothing below may divide by it.
    expect(target.getBoundingClientRect().width).toBe(0);
    const handle = mount(target);
    expect(values(handle.element).filter((value) => value.includes('NaN'))).toEqual([]);
    handle.destroy();
  });

  it('survives a snapshot made entirely of holes', () => {
    const target = host();
    const bad = Number.NaN;
    const keyboard = mountKeyboard(target, {
      snapshot: (): KeyboardState => ({low: bad, high: bad, marks: [{midi: bad}], ghostPitchClasses: [bad]}),
    });
    expect(values(keyboard.element).filter((value) => value.includes('NaN'))).toEqual([]);
    keyboard.destroy();

    const staff = mountStaff(target, {
      snapshot: (): StaffState => ({
        columns: bad,
        activeColumn: bad,
        marks: [{midi: bad, diatonic: 28, column: bad}],
      }),
    });
    expect(values(staff.element).filter((value) => value.includes('NaN'))).toEqual([]);
    staff.destroy();

    const fretboard = mountFretboard(target, {
      snapshot: (): FretboardState => ({
        strings: bad,
        fretCount: bad,
        firstFret: bad,
        muted: [bad],
        inlays: [bad],
        barre: [{fret: bad, fromString: bad, toString: bad}],
        marks: [{stringIndex: 0, fret: bad}, {stringIndex: bad, fret: 2}],
      }),
    });
    expect(values(fretboard.element).filter((value) => value.includes('NaN'))).toEqual([]);
    fretboard.destroy();
  });

  it.each(MOUNTS)('%s hands the host to the mount that claimed it last', (_name, mount) => {
    const target = host();
    const first = mount(target);
    const second = mount(target);
    // The second mount claims the host, then destroys the first — which takes
    // the first's root and its stylesheet with it.
    expect(first.element.parentElement).toBeNull();
    expect(second.element.parentElement).toBe(target);
    expect(target.querySelectorAll('style')).toHaveLength(1);
    first.destroy();
    second.destroy();
    expect(target.children.length).toBe(0);
  });

  it('exports one sheet naming all three roots', () => {
    expect(pitchStyle).toContain('.wui-pitch-keyboard');
    expect(pitchStyle).toContain('.wui-pitch-staff');
    expect(pitchStyle).toContain('.wui-pitch-fretboard');
    // A.2.5: the black key's offset IS its position, not a decoration.
    expect(pitchStyle).toContain('translateX(-50%)');
    expect(pitchStyle).toContain('z-index: 2');
  });

  it('carries the reduced-motion escape a caller with no JavaScript still gets', () => {
    // `resolveMotion` covers a host that opted out of the sheet; this covers a
    // page whose shell never declared `data-motion` and whose surfaces were
    // told nothing. An explicit `motion: "continuous"` does not out-rank the
    // viewer's own setting, so the rule is unconditional.
    expect(pitchStyle).toContain('@media (prefers-reduced-motion: reduce)');
    for (const root of ['.wui-pitch-keyboard', '.wui-pitch-staff', '.wui-pitch-fretboard']) {
      expect(pitchStyle.slice(pitchStyle.indexOf('@media'))).toContain(`${root} *`);
    }
    expect(pitchStyle.slice(pitchStyle.indexOf('@media'))).toContain(
      '--wui-harmony-motion-tone: 0s',
    );
  });

  it('spends the age it publishes instead of leaving it as a promise', () => {
    // `since` was computed on all three surfaces and read by nothing shipped.
    // A hook nobody spends is not a feature.
    for (const rule of [
      '.wui-pitch-keyboard__key[data-active="true"]',
      '.wui-pitch-staff__head',
      '.wui-pitch-fretboard__disc',
    ]) {
      const body = pitchStyle.slice(pitchStyle.indexOf(`${rule} {`));
      expect(body.slice(0, body.indexOf('}')), rule).toContain('var(--wui-harmony-age, 0)');
    }
  });

  it('keeps the staff time channel when the host takes no stylesheet', () => {
    // `data-when` is INFORMATION — it is what "the next chord is coming" looks
    // like — so unlike a transition it may not go missing with the sheet.
    const handle = mountStaff(
      host(),
      {
        snapshot: (): StaffState => ({
          columns: 4,
          activeColumn: 1,
          marks: [0, 1, 2, 3].map((column) => ({midi: 60, diatonic: 28 + column, column})),
        }),
      },
      {stylesheet: false},
    );
    const opacity = [0, 1, 2, 3].map((column) => handle.note(column, 28 + column)!.style.opacity);
    expect(new Set(opacity).size).toBe(4);
    expect(opacity[1]).toBe('1');
    handle.destroy();
  });

  it('never lets the three docks disagree about a sounding pitch', () => {
    vi.useFakeTimers();
    // One chord, three surfaces, and every mark carrying the pitch it sounds.
    // Without `FretMark.midi` this could not be asserted at all without a test
    // that re-derives a guitar's tuning — which is the kit's job to not know.
    const CHORDS = [
      [
        {midi: 50, diatonic: 22, string: 1, fret: 5},
        {midi: 53, diatonic: 24, string: 1, fret: 8},
        {midi: 57, diatonic: 26, string: 2, fret: 7},
        {midi: 60, diatonic: 28, string: 2, fret: 10},
      ],
      [
        {midi: 55, diatonic: 25, string: 2, fret: 5},
        {midi: 59, diatonic: 27, string: 3, fret: 4},
        {midi: 62, diatonic: 29, string: 3, fret: 7},
        {midi: 65, diatonic: 31, string: 4, fret: 6},
      ],
    ] as const;
    let index = 0;
    const chord = (): (typeof CHORDS)[number] => CHORDS[index]!;

    const keyboard = mountKeyboard(
      host(),
      {
        snapshot: (): KeyboardState => ({
          low: 48,
          high: 72,
          marks: chord().map((tone) => ({midi: tone.midi})),
        }),
      },
      {release: 140},
    );
    const staff = mountStaff(host(), {
      snapshot: (): StaffState => ({marks: chord().map((tone) => ({...tone}))}),
    });
    const fretboard = mountFretboard(
      host(),
      {
        snapshot: (): FretboardState => ({
          strings: 6,
          firstFret: 'auto',
          marks: chord().map((tone) => ({
            midi: tone.midi,
            stringIndex: tone.string,
            fret: tone.fret,
          })),
        }),
      },
      {release: 140},
    );

    const sounding = (root: Element): string[] =>
      [...root.querySelectorAll('[data-midi][data-active="true"]')]
        .map((node) => node.getAttribute('data-midi')!)
        .sort();
    const agree = (): string[] => {
      const answers = [keyboard.element, staff.element, fretboard.element].map(sounding);
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
      return answers[0]!;
    };
    expect(agree()).toEqual(['50', '53', '57', '60']);

    index = 1;
    keyboard.update();
    staff.update();
    fretboard.update();
    // Mid-tail: the two surfaces with a release still hold the old chord's
    // nodes, and both say so with an attribute rather than only with a colour.
    expect(agree()).toEqual(['55', '59', '62', '65']);
    expect(
      [...keyboard.element.querySelectorAll('[data-phase="release"]')].map((node) =>
        node.getAttribute('data-midi'),
      ),
    ).toEqual(['50', '53', '57', '60']);
    expect(fretboard.element.querySelectorAll('[data-phase="release"]')).toHaveLength(4);

    vi.advanceTimersByTime(400);
    expect(agree()).toEqual(['55', '59', '62', '65']);
    keyboard.destroy();
    staff.destroy();
    fretboard.destroy();
  });
});

describe('the mount registry', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('keeps one keyboard per host and destroys the one it replaces', () => {
    const target = host();
    const first = mountKeyboard(target, {snapshot: (): KeyboardState => ({marks: []})});
    const second = mountKeyboard(target, {snapshot: (): KeyboardState => ({marks: []})});
    expect(first.element.parentElement).toBeNull();
    expect(second.element.parentElement).toBe(target);
    second.destroy();
  });

  it('unsubscribes exactly once on destroy', () => {
    const unsubscribe = vi.fn();
    const handle = mountKeyboard(host(), {
      snapshot: (): KeyboardState => ({marks: []}),
      subscribe: () => unsubscribe,
    });
    handle.destroy();
    handle.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The properties the OTHER implementation of this module verified, kept.
// ---------------------------------------------------------------------------

describe('properties carried across the merge', () => {
  it('clamps a ladder no instrument can reach instead of allocating for it', () => {
    // `Number.isFinite` catches NaN and Infinity but not a large FINITE number,
    // and a malformed MusicXML <octave> makes one. Every step outside a staff
    // needs a ledger LINE per line between the staff and the note, and
    // `mountStaff` turns each into an SVG <line>: at diatonic 10,000 that is
    // 4,981 nodes, and at 1e7 the worker dies on a 4 GB heap.
    for (const step of [1e4, 1e6, 1e9, -1e9]) {
      const placed = staffPlacement(step);
      expect(placed.ledgers.length, `${step}`).toBeLessThan(64);
      expect(Number.isFinite(placed.y), `${step}`).toBe(true);
    }
    const handle = mountStaff(host(), {
      snapshot: (): StaffState => ({marks: [{midi: 60, diatonic: 1e6, role: 'root'}]}),
    });
    expect(handle.svg.querySelectorAll('line').length).toBeLessThan(64);
    handle.destroy();

    // Everything a real instrument can play is inside the clamp and keeps every
    // ledger it needs: MIDI 0 is C-1 (step -7) and MIDI 127 is G9 (step 67).
    expect(staffPlacement(-7).ledgers.length).toBeGreaterThan(4);
    expect(staffPlacement(67).ledgers.length).toBeGreaterThan(4);
  });

  it('reads `columns` as a floor and never drops the now-column', () => {
    // Read as an override it silently truncates. Six marks in columns 0…5 under
    // `columns: 3` drew three noteheads and threw the rest away — and on a
    // conveyor the column that goes is the one the now-line is standing on.
    const handle = mountStaff(host(), {
      snapshot: (): StaffState => ({
        columns: 3,
        activeColumn: 5,
        marks: [0, 1, 2, 3, 4, 5].map((column) => ({
          midi: 60 + column,
          diatonic: 28 + column,
          column,
          role: 'root' as const,
        })),
      }),
    });
    const heads = handle.svg.querySelectorAll('.wui-pitch-staff__head');
    expect(heads).toHaveLength(6);
    const drawn = [...handle.svg.querySelectorAll('.wui-pitch-staff__note')].map(
      (node) => (node as HTMLElement).dataset.column,
    );
    expect(drawn).toContain('5');
    handle.destroy();
  });

  it('releases a subscription taken out after a re-entrant destroy', () => {
    // `update()` runs the caller's `snapshot()`, which may mount a replacement
    // into this very host and so destroy this handle mid-mount. Subscribing
    // afterwards hands the teardown to a handle whose `destroy()` has already
    // run and now short-circuits — a subscription nobody can release.
    for (const mount of [mountKeyboard, mountStaff, mountFretboard]) {
      const node = host();
      let live = 0;
      let replaced = false;
      const outer = (mount as typeof mountKeyboard)(node, {
        snapshot: () => {
          if (!replaced) {
            replaced = true;
            // The replacement wins the host, which destroys the outer mount.
            (mount as typeof mountKeyboard)(node, {snapshot: () => ({marks: []})});
          }
          return {marks: []};
        },
        subscribe: () => {
          live += 1;
          return () => {
            live -= 1;
          };
        },
      });
      outer.destroy();
      expect(live, mount.name).toBe(0);
      node.remove();
    }
  });

  it('names a role="img" even when the first snapshot throws', () => {
    // An image with no accessible name is the one thing a screen reader can
    // neither read nor skip, and a binding that throws on its very first call
    // used to leave exactly that.
    for (const [mount, fallback] of [
      [mountKeyboard, 'Sounding pitches'],
      [mountStaff, 'Staff'],
      [mountFretboard, 'Fretboard'],
    ] as const) {
      const node = host();
      const handle = (mount as typeof mountKeyboard)(
        node,
        {
          snapshot: () => {
            throw new Error('no reading yet');
          },
        },
        {onError: () => {}},
      );
      expect(handle.element.getAttribute('role'), mount.name).toBe('img');
      expect(handle.element.getAttribute('aria-label'), mount.name).toBe(fallback);
      handle.destroy();
      node.remove();
    }
  });

  it('keeps a raised key at either end of the range on the board', () => {
    // A black key's `left` is the BOUNDARY between the two whites it straddles
    // and a translate of half its width is what centres it there. At the end of
    // the range one of those two whites does not exist, so without a reserved
    // half key the boundary is 0% or 100% and half the key paints outside the
    // widget — which declares no `overflow`, so it really does spill. The
    // reserve is in `pianoKeyLayout` and not in this mount's padding, which is
    // what carries it to `<keyboard-view>` and `<note-input>` as well.
    for (const [low, high] of [
      [60, 82],
      [61, 84],
      [61, 82],
      [61, 61],
    ]) {
      const node = host();
      const handle = mountKeyboard(node, {
        snapshot: (): KeyboardState => ({low, high, marks: []}),
      });
      const keys = [...handle.board.children] as HTMLElement[];
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        const left = Number.parseFloat(key.style.left);
        const width = Number.parseFloat(key.style.width);
        const from = key.className.includes('--black') ? left - width / 2 : left;
        expect(from, `${low}..${high} paints ${key.dataset.midi} at ${from}`).toBeGreaterThanOrEqual(
          -0.01,
        );
        expect(from + width, `${low}..${high}`).toBeLessThanOrEqual(100.01);
      }
      // And the compensation is applied ONCE: a padding on the root on top of
      // the layout's own reserve insets a black-ended board twice.
      expect(handle.element.style.paddingLeft).toBe('');
      expect(handle.element.style.paddingRight).toBe('');
      handle.destroy();
      node.remove();
    }
  });

  it('draws the whole board when the two ends arrive the wrong way round', () => {
    // `pianoKeyLayout` orders a reversed range low to high; a mount that clamped
    // `high` against `low` first collapsed it onto a single key.
    const handle = mountKeyboard(host(), {
      snapshot: (): KeyboardState => ({low: 84, high: 48, marks: []}),
    });
    expect(handle.board.childElementCount).toBe(37);
    expect(handle.key(60)).toBeDefined();
    expect(handle.key(84)).toBeDefined();
    handle.destroy();
  });

  it('draws an OPEN string as a ring and a stopped one as a disc', () => {
    // The distinction every chord chart in print makes, and the first thing a
    // player reads off one: which strings the left hand is not on.
    const handle = mountFretboard(host(), {
      snapshot: (): FretboardState => ({
        strings: 6,
        marks: [
          {stringIndex: 0, fret: 0, role: 'root'},
          {stringIndex: 1, fret: 3, role: 'third'},
        ],
      }),
    });
    const open = handle.dot(0, 0)!.querySelector('circle')!;
    const stopped = handle.dot(1, 3)!.querySelector('circle')!;
    expect(open.getAttribute('fill')).toBe('none');
    expect(open.getAttribute('stroke')).not.toBeNull();
    expect(stopped.getAttribute('fill')).not.toBe('none');
    expect(stopped.getAttribute('stroke')).toBeNull();
    handle.destroy();
  });

  it('prints the tuning beside the strings, not only into the sentence', () => {
    // `stringLabels` used to reach the accessible name and nowhere else, so a
    // sighted reader had no way to tell a drop-D diagram from a standard one.
    const handle = mountFretboard(host(), {
      snapshot: (): FretboardState => ({
        strings: 6,
        stringLabels: ['E', 'A', 'D', 'G', 'B', 'E'],
        marks: [{stringIndex: 1, fret: 3, role: 'root'}],
      }),
    });
    const printed = [...handle.svg.querySelectorAll('.wui-pitch-fretboard__label')].map(
      (node) => node.textContent,
    );
    expect(printed).toEqual(['E', 'A', 'D', 'G', 'B', 'E']);
    // They ride in the FIXED gutter and not in the sliding reel, so they stay
    // put as the window walks up the neck.
    for (const node of handle.svg.querySelectorAll('.wui-pitch-fretboard__label')) {
      expect(node.closest('.wui-pitch-fretboard__reel')).toBeNull();
    }
    handle.destroy();
  });

  it('refuses to draw a mark the window cannot hold', () => {
    // Not drawn small — drawn OFF the neck: a mark at fret 99 in a five-fret
    // window emitted `cx="1576"` into a 122-unit viewBox. The clip hid it, and
    // it still counted itself into the chord the sentence named.
    const handle = mountFretboard(host(), {
      snapshot: (): FretboardState => ({
        strings: 6,
        firstFret: 5,
        fretCount: 5,
        marks: [
          {stringIndex: 0, fret: 99, role: 'root', label: 'C4'},
          {stringIndex: 1, fret: 6, role: 'third', label: 'E4'},
        ],
      }),
    });
    expect(handle.dot(0, 99)).toBeUndefined();
    expect(handle.dot(1, 6)).toBeDefined();
    expect(handle.element.getAttribute('aria-label')).not.toContain('C4');
    expect(handle.element.getAttribute('aria-label')).toContain('E4');
    handle.destroy();
  });

  it('spends the weight it declares, on all three surfaces', () => {
    // A field the type declares and nothing reads is a promise the surface does
    // not keep — the same objection the module header raises about `since`.
    const keyboard = mountKeyboard(host(), {
      snapshot: (): KeyboardState => ({marks: [{midi: 60, role: 'root', weight: 0.4}]}),
    });
    expect(keyboard.key(60)!.style.getPropertyValue('--wui-pitch-weight')).toBe('0.4');
    keyboard.destroy();

    const staff = mountStaff(host(), {
      snapshot: (): StaffState => ({marks: [{midi: 60, diatonic: 28, role: 'root', weight: 0.4}]}),
    });
    const note = staff.svg.querySelector('.wui-pitch-staff__note') as SVGGElement;
    expect(note.style.getPropertyValue('--wui-pitch-weight')).toBe('0.4');
    staff.destroy();

    const fretboard = mountFretboard(host(), {
      snapshot: (): FretboardState => ({
        strings: 6,
        marks: [{stringIndex: 1, fret: 3, role: 'root', weight: 0.4}],
      }),
    });
    expect(fretboard.dot(1, 3)!.style.getPropertyValue('--wui-pitch-weight')).toBe('0.4');
    fretboard.destroy();

    // Full weight writes nothing at all, so the default stays the age fade the
    // expression used to be on its own.
    const plain = mountKeyboard(host(), {
      snapshot: (): KeyboardState => ({marks: [{midi: 60, role: 'root'}]}),
    });
    expect(plain.key(60)!.style.getPropertyValue('--wui-pitch-weight')).toBe('');
    expect(pitchStyle).toContain('--wui-pitch-weight');
    plain.destroy();
  });

  it('declares its own token layer, and the two dials a caller can move', () => {
    // These mount into a workbench dock that carries the tokens, and equally
    // into a bare <div> that does not. A surface whose colours depend on who its
    // parent happens to be is not a surface a caller can drop anywhere.
    expect(pitchStyle).toContain('--wui-harmony-ink');
    expect(pitchStyle).toContain('[data-density="compact"]');
    expect(pitchStyle).toContain('[data-scheme="dark"]');

    const handle = mountKeyboard(
      host(),
      {snapshot: (): KeyboardState => ({marks: []})},
      {density: 'compact', scheme: 'dark', stylesheet: false},
    );
    expect(handle.element.dataset.density).toBe('compact');
    expect(handle.element.dataset.scheme).toBe('dark');
    // With no sheet installed the same declarations are on the node itself.
    expect(handle.element.style.getPropertyValue('--wui-harmony-ink')).not.toBe('');
    handle.destroy();
  });
});


describe('mountStaff container width', () => {
  it.each([true, false])('extends staff lines while preserving note spacing and cleans up observation (stylesheet=%s)', (stylesheet) => {
    let resize = (_width: number, _height: number): void => {};
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resize = (width, height) => callback([{contentRect: {width, height}} as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      observe = observe;
      disconnect = disconnect;
    });
    const handle = mountStaff(host(), {
      snapshot: () => ({marks: [{midi: 60, diatonic: 28, column: 0, label: 'C4'}]}),
    }, {stylesheet});
    expect(observe.mock.calls.some(([node]) => node === handle.svg)).toBe(true);
    expect(observe.mock.calls.some(([node]) => node === handle.element)).toBe(true);
    expect(getComputedStyle(handle.svg).width).toBe('100%');
    const note = handle.note(0, 28)!;
    const shape = note.innerHTML;
    const initialBox = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
    const height = initialBox[3]! * 4.5;
    resize(360, height);
    const wide = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(wide[2]).toBeCloseTo(80);
    expect(Number(handle.svg.querySelector('.wui-pitch-staff__line')!.getAttribute('x2'))).toBeCloseTo(wide[0]! + wide[2]!);
    expect(handle.note(0, 28)).toBe(note);
    expect(note.innerHTML).toBe(shape);
    resize(180, height);
    const narrow = handle.svg.getAttribute('viewBox')!.split(' ').map(Number);
    expect(narrow[2]).toBeCloseTo(40);
    expect(handle.note(0, 28)).toBe(note);
    expect(note.innerHTML).toBe(shape);
    handle.destroy();
    expect(disconnect).toHaveBeenCalledTimes(2);
    resize(720, height);
    expect(handle.svg.getAttribute('viewBox')!.split(' ').map(Number)).toEqual(narrow);
  });
});


describe('readable pitch viewports', () => {
  it.each([true, false])('keeps a wide keyboard intact and follows arrivals without taking back manual scroll (stylesheet=%s)', (stylesheet) => {
    let state: KeyboardState = {low: 36, high: 84, marks: []};
    const handle = mountKeyboard(host(), {snapshot: () => state}, {stylesheet, follow: 'active', density: 'compact', scheme: 'dark'});
    const root = handle.element;
    Object.defineProperties(root, {clientWidth: {value: 240, configurable: true}, scrollWidth: {value: 1160, configurable: true}});
    Object.defineProperties(handle.key(60)!, {offsetLeft: {value: 560}, offsetWidth: {value: 40}});
    expect(handle.board.children).toHaveLength(49);
    expect(root.style.getPropertyValue('--wui-pitch-keyboard-width')).toContain('29');
    expect(getComputedStyle(root).overflowX).toBe('auto');
    expect((root.querySelector('.wui-pitch-keyboard__ruler') as HTMLElement).hidden).toBe(true);
    state = {...state, marks: [{midi: 60, label: 'A caller supplied long pitch name'}]};
    handle.update();
    expect(root.scrollLeft).toBe(460);
    expect(root.tabIndex).toBe(0);
    const label = handle.key(60)!.querySelector('.wui-pitch-keyboard__label') as HTMLElement;
    expect(getComputedStyle(label).overflow).toBe('hidden');
    expect(label.title).toBe('A caller supplied long pitch name');
    expect(root.getAttribute('aria-label')).toContain(label.title);
    root.scrollLeft = 0;
    handle.update();
    expect(root.scrollLeft).toBe(0);
    state = {...state, marks: []};
    handle.update();
    expect(root.scrollLeft).toBe(0);
    Object.defineProperty(root, 'clientWidth', {value: 1200});
    handle.update();
    expect(root.hasAttribute('tabindex')).toBe(false);
    handle.destroy();
  });

  it('reveals a held arrival after hidden content becomes measurable and releases its observer', () => {
    let resized = (): void => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {resized = () => callback([], this as unknown as ResizeObserver);}
      observe = vi.fn();
      disconnect = disconnect;
    });
    const handle = mountKeyboard(host(), {snapshot: () => ({marks: [{midi: 60, label: 'C4'}]})}, {follow: 'active'});
    Object.defineProperties(handle.element, {clientWidth: {value: 240}, scrollWidth: {value: 1000}});
    Object.defineProperties(handle.key(60)!, {offsetLeft: {value: 560}, offsetWidth: {value: 40}});
    resized();
    expect(handle.element.scrollLeft).toBe(460);
    handle.element.scrollLeft = 0;
    resized();
    expect(handle.element.scrollLeft).toBe(0);
    handle.destroy();
    expect(disconnect).toHaveBeenCalledOnce();
    resized();
    expect(handle.element.scrollLeft).toBe(0);
  });

  it('does not follow an arrival without the explicit follow option', () => {
    let state: KeyboardState = {marks: []};
    const handle = mountKeyboard(host(), {snapshot: () => state});
    Object.defineProperties(handle.element, {clientWidth: {value: 240}, scrollWidth: {value: 1000}});
    Object.defineProperties(handle.key(60)!, {offsetLeft: {value: 560}, offsetWidth: {value: 40}});
    state = {marks: [{midi: 60, label: 'C4'}]};
    handle.update();
    expect(handle.element.scrollLeft).toBe(0);
    handle.destroy();
  });

  it.each([true, false])('expands fret spacing while preserving dots, open markers, and string labels (stylesheet=%s)', (stylesheet) => {
    let resize = (_width: number, _height: number): void => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resize = (width, height) => callback([{contentRect: {width, height}} as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      observe = vi.fn();
      disconnect = disconnect;
    });
    const state: FretboardState = {strings: 6, firstFret: 0, fretCount: 12, stringLabels: ['C#-1', 'A2', 'D3', 'G3', 'B3', 'E4'], marks: [
      {stringIndex: 0, fret: 0, mark: 'C#', label: 'C#-1'},
      {stringIndex: 1, fret: 3, mark: 'C', label: 'C3'},
    ]};
    const handle = mountFretboard(host(), {snapshot: () => state}, {stylesheet, density: 'compact', scheme: 'dark'});
    const dot = handle.dot(1, 3)!;
    const disc = dot.firstElementChild!;
    const open = handle.dot(0, 0)!.firstElementChild!;
    const cx = Number(disc.getAttribute('cx'));
    const radius = disc.getAttribute('r');
    const markSize = dot.lastElementChild!.getAttribute('font-size');
    const openX = open.getAttribute('cx');
    const label = handle.svg.querySelector('.wui-pitch-fretboard__label')!;
    const labelX = label.getAttribute('x');
    expect(label.getAttribute('text-anchor')).toBe('end');
    expect(handle.svg.style.minWidth).toContain('--wui-pitch-fretboard-unit');
    expect(handle.svg.style.height).toContain('--wui-pitch-fretboard-unit');
    const height = 86.4 * 2.2;
    resize(720, height);
    expect(handle.dot(1, 3) === dot).toBe(true);
    expect(Number(disc.getAttribute('cx'))).toBeGreaterThan(cx);
    expect(disc.getAttribute('r')).toBe(radius);
    expect(dot.lastElementChild!.getAttribute('font-size')).toBe(markSize);
    expect(open.getAttribute('cx')).toBe(openX);
    expect(handle.svg.querySelector('.wui-pitch-fretboard__label')!.getAttribute('x')).toBe(labelX);
    expect(Number(handle.svg.getAttribute('viewBox')!.split(' ')[2]) * 2.2).toBeCloseTo(720, 1);
    resize(240, height);
    expect(Number(disc.getAttribute('cx'))).toBe(cx);
    const finalBox = handle.svg.getAttribute('viewBox');
    handle.destroy();
    expect(disconnect).toHaveBeenCalledTimes(2);
    resize(720, height);
    expect(handle.svg.getAttribute('viewBox')).toBe(finalBox);
  });

  it('reserves a first-column accidental gutter for a dense held chord', () => {
    const handle = mountStaff(host(), {snapshot: () => ({
      marks: Array.from({length: 12}, (_, index) => ({midi: 48 + index * 2, diatonic: 21 + index, accidental: 'sharp' as const})),
      clefs: {upper: 'treble'},
    })});
    const positions = [...handle.svg.querySelectorAll('.wui-pitch-staff__accidental')].map((node) => Number(/translate\(([-\d.]+)/.exec(node.getAttribute('transform')!)![1]));
    expect(Math.min(...positions)).toBeGreaterThan(6);
    expect(handle.svg.style.minWidth).toContain('--wui-harmony-staff-space');
    handle.destroy();
  });
});
