// @vitest-environment jsdom

import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  mountWorkbench,
  workbenchStyle,
  type FrameTick,
  type WorkbenchBinding,
  type WorkbenchDock,
  type WorkbenchState,
  type WorkbenchView,
} from '../src/workbench';

/**
 * What jsdom does NOT give this shell, measured rather than assumed:
 *
 * - `getBoundingClientRect()`, `clientWidth`, `offsetWidth` and `scrollWidth`
 *   are all `0`, and container queries never evaluate at all. Nothing in the
 *   shell may divide by one of those, and the one place that reads them has a
 *   guard with a case of its own below.
 * - `matchMedia` is absent, so `motion: 'auto'` must never reach it unguarded;
 *   the reduced-motion cases stub it.
 * - `requestAnimationFrame` exists but is a real ~16 ms wall-clock timer, so
 *   every loop case drives a spy instead and a frame is a function call.
 *
 * The vocabulary here is deliberately meaningless — `one`, `left`, `foot`. The
 * shell is not allowed to know what a view shows, and a fixture that named the
 * real views would let an assumption about one of them leak in unnoticed.
 */

const VIEWS: readonly WorkbenchView[] = [
  {id: 'one', label: 'One'},
  {id: 'two', label: 'Two', description: 'The second one'},
  // A view that asks for a subset: the other two docks are not merely folded,
  // they are not offered.
  {id: 'three', label: 'Three', docks: ['left']},
];

const DOCKS: readonly WorkbenchDock[] = [
  {id: 'left', label: 'Left', placement: 'rail'},
  {id: 'right', label: 'Right', placement: 'rail'},
  {id: 'foot', label: 'Foot', placement: 'strip'},
];

function host(): HTMLElement {
  const node = document.createElement('div');
  document.body.append(node);
  return node;
}

function base(state: Partial<WorkbenchState> = {}): WorkbenchState {
  return {views: VIEWS, activeViewId: 'one', docks: DOCKS, ...state};
}

function shell(
  state: Partial<WorkbenchState> = {},
  binding: Partial<WorkbenchBinding> = {},
  options: Parameters<typeof mountWorkbench>[2] = {},
) {
  const snapshot = base(state);
  return mountWorkbench(host(), {snapshot: () => snapshot, ...binding}, options);
}

function tabsOf(handle: {element: HTMLElement}): HTMLButtonElement[] {
  return [...handle.element.querySelectorAll<HTMLButtonElement>('.wui-workbench__tab')];
}

function press(node: HTMLElement, key: string): void {
  node.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
}

/** A deterministic rAF: a frame is a call, not sixteen milliseconds of waiting. */
function driver() {
  const pending = new Map<number, FrameRequestCallback>();
  let handle = 0;
  const raf = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback: FrameRequestCallback): number => {
      handle += 1;
      pending.set(handle, callback);
      return handle;
    });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number): void => {
    pending.delete(id);
  });
  return {
    raf,
    armed: (): number => pending.size,
    frame(at: number): void {
      const due = [...pending.values()];
      pending.clear();
      for (const callback of due) callback(at);
    },
  };
}

/** A preference the viewer can change while the page is open. */
function preference(matches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );
  return {
    media,
    attached: (): number => listeners.size,
    set(next: boolean): void {
      media.matches = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------

describe('the workbench stylesheet', () => {
  it('namespaces every class away from the docs kit, comments included', () => {
    // The gate this mirrors — `check-docs.mjs` `checkDocsCssNamespace` — harvests
    // every `wui-` token out of `packages/ui/src/**.ts`, from string literals
    // AND from comments, and fails on any name `apps/doc/shared/ui.css` also
    // declares. Essentially every natural name for this shell — tab, tabs,
    // panel, surface, empty, grid, row, toolbar, seg — is already taken there.
    //
    // The stylesheet is READ, with the gate's own regex, rather than
    // transcribed: the drift that matters runs the other way round, a name
    // ADDED to `ui.css` that this module already renders, and a copied list
    // stays green through exactly that. This is the cheap early warning, one
    // second inside `npm test` instead of a minute inside the docs gate.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const declared = new Set(
      [
        ...readFileSync(path.join(here, '..', '..', '..', 'apps', 'doc', 'shared', 'ui.css'), 'utf8')
          .matchAll(/\.(wui-[a-z0-9_-]+)/g),
      ].map((match) => match[1]!),
    );
    // A guard on the guard, at both ends: an empty read would pass vacuously.
    expect(declared.size).toBeGreaterThan(30);
    expect(declared.has('wui-tab')).toBe(true);

    const source = readFileSync(path.join(here, '..', 'src', 'workbench.ts'), 'utf8');
    const harvested = new Set<string>();
    for (const match of source.matchAll(/["'`](wui-[a-z0-9-]+(?:__[a-z0-9-]+)?)/g)) {
      harvested.add(match[1]!);
    }
    for (const match of source.matchAll(/\.(wui-[a-z0-9-]+(?:__[a-z0-9-]+)?)/g)) {
      harvested.add(match[1]!);
    }
    // A guard on the guard: an empty harvest would make this vacuously green.
    expect(harvested.size).toBeGreaterThan(10);
    expect([...harvested].filter((name) => declared.has(name))).toEqual([]);
    expect([...harvested].every((name) => name.startsWith('wui-workbench'))).toBe(true);
  });

  it('measures its breakpoints on a box no spacing token can move', () => {
    // A container query resolves against the container's CONTENT box, so a
    // padded query container fires every breakpoint late — and by an amount
    // that MOVES whenever a host retunes `--wui-harmony-pad`. The card's border
    // and padding therefore sit on the frame one level down.
    const root = workbenchStyle.slice(
      workbenchStyle.indexOf('.wui-workbench {'),
      workbenchStyle.indexOf('.wui-workbench__frame {'),
    );
    expect(root).toContain('container-type: inline-size');
    expect(root).toContain('border: 0');
    expect(root).toContain('padding: 0');
    const frame = workbenchStyle.slice(
      workbenchStyle.indexOf('.wui-workbench__frame {'),
      workbenchStyle.indexOf('.wui-workbench__header {'),
    );
    expect(frame).toContain('--wui-harmony-pad');
    expect(frame).toContain('box-sizing: border-box');
  });

  it('draws the shape of what is coming rather than a hole', () => {
    // An idle workbench that renders literally nothing is the one state a
    // reader cannot tell from a mistake. The skeleton is pure CSS on `:empty`,
    // so it costs no node and no tick, and it is gone the instant the caller
    // mounts anything into the stage.
    expect(workbenchStyle).toContain('.wui-workbench[data-phase="idle"] .wui-workbench__stage:empty');
    expect(workbenchStyle).toContain('.wui-workbench[data-phase="listening"] .wui-workbench__stage:empty');
    expect(workbenchStyle).toContain('--wui-harmony-flow-now');
    // No phase with material to show gets a ruler drawn behind it.
    expect(workbenchStyle).not.toContain('[data-phase="playing"] .wui-workbench__stage:empty');
  });

  it('responds to its own width, not the viewport’s', () => {
    // A shell dropped into a 300px column on a documentation page is exactly the
    // case a media query gets wrong: the viewport is wide, the shell is not.
    expect(workbenchStyle).toContain('container-type: inline-size');
    expect(workbenchStyle).toContain('@container wui-workbench (max-width: 719px)');
    expect(workbenchStyle).toContain('@container wui-workbench (max-width: 439px)');
    // The only media query in the sheet is the reduced-motion floor, which has
    // nothing to do with layout.
    const queries = [...workbenchStyle.matchAll(/@media \(([a-z-]+)/g)].map((match) => match[1]);
    expect(queries).toEqual(['prefers-reduced-motion']);
    // And the collapse to one column is a rule keyed off what the shell says is
    // true, so no JavaScript ever writes a grid template.
    expect(workbenchStyle).toContain('.wui-workbench[data-rail="false"] .wui-workbench__frame');
  });
});

// ---------------------------------------------------------------------------

describe('the shape a caller mounts into', () => {
  it('hands out slots and never fills them', () => {
    const node = host();
    const handle = mountWorkbench(node, {snapshot: () => base()});

    // The semantic list is a direct child of the HOST and a sibling of the
    // shell's frame — not a descendant of a grid area a container query may
    // reflow around it.
    expect(handle.index.parentElement).toBe(node);
    expect(handle.index.previousElementSibling).toBe(handle.element);
    expect(handle.index.tagName).toBe('OL');

    // The stage and every dock body start empty and stay the caller's.
    expect(handle.stage.childElementCount).toBe(0);
    const left = handle.dock('left');
    expect(left).toBeInstanceOf(HTMLElement);
    const child = document.createElement('span');
    left!.append(child);
    handle.update();
    expect(left!.contains(child)).toBe(true);
    handle.destroy();
    expect(node.childElementCount).toBe(0);
  });

  it('refuses a mount point nobody can see', () => {
    const handle = shell({dockVisibility: {right: false}}, {toggleDock: vi.fn()});
    expect(handle.dock('left')).toBeInstanceOf(HTMLElement);
    // Unknown, and folded away. A caller that could mount into either would run
    // a presenter, take a clock subscription and paint into a hidden box for the
    // life of the page.
    expect(handle.dock('nowhere')).toBeUndefined();
    expect(handle.dock('right')).toBeUndefined();
    handle.destroy();
  });

  it('renders the stage alone under chrome: bare', () => {
    const handle = shell({}, {}, {chrome: 'bare'});
    expect(handle.element.querySelector('.wui-workbench__stage')).toBe(handle.stage);
    for (const part of ['header', 'tablist', 'rail', 'strip', 'status']) {
      expect(handle.element.querySelector(`.wui-workbench__${part}`)).toBeNull();
    }
    // No chrome means no docks: there is nowhere to put one. And no tabs, so
    // nothing labels the stage with an id no document contains.
    expect(handle.dock('left')).toBeUndefined();
    expect(handle.element.querySelectorAll('.wui-workbench__tab')).toHaveLength(0);
    expect(handle.element.querySelector('.wui-workbench__main')?.getAttribute('aria-labelledby')).toBeNull();
    expect(handle.element.querySelector('.wui-workbench__main')?.getAttribute('role')).toBeNull();
    expect(handle.element.dataset.chrome).toBe('bare');
    // The semantic twin survives, because it was never chrome.
    expect(handle.index.isConnected).toBe(true);
    // And there is no status node to hand out. A detached one would be worse
    // than none: text written to it disappears with no error at all.
    expect(handle.statusMessage).toBeUndefined();
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------

describe('update()', () => {
  it('is idempotent and never rebuilds a slot node', () => {
    // The shell's single most important test. Every dock holds a child
    // presenter that took that node with `claimHost`; rebuilding the node
    // unmounts it silently — no exception anywhere, just a dock that went dead.
    let state = base({
      title: 'Analysis',
      subtitle: 'a sample',
      status: {message: 'ready', detail: '1'},
    });
    let notify = (): void => {};
    const handle = mountWorkbench(host(), {
      snapshot: () => state,
      activateView: (id) => {
        state = {...state, activeViewId: id};
      },
      toggleDock: (id, next) => {
        state = {...state, dockVisibility: {...state.dockVisibility, [id]: next}};
      },
      subscribe: (listener) => {
        notify = listener;
        return () => {};
      },
    });

    const stage = handle.stage;
    const index = handle.index;
    const message = handle.statusMessage;
    const left = handle.dock('left')!;
    const right = handle.dock('right')!;
    const foot = handle.dock('foot')!;
    const tenant = document.createElement('div');
    left.append(tenant);
    const firstTab = tabsOf(handle)[0]!;

    const revisions: WorkbenchState[] = [
      base({activeViewId: 'two'}),
      base({activeViewId: 'two', density: 'compact'}),
      base({activeViewId: 'two', density: 'compact', phase: 'playing'}),
      base({activeViewId: 'two', phase: 'error', status: {message: 'broke', detail: '12'}}),
      base({activeViewId: 'two', dockVisibility: {right: false}}),
      base({activeViewId: 'two', dockVisibility: {right: false, foot: false}}),
      base({activeViewId: 'two', dockVisibility: {}, scheme: 'dark'}),
      base({activeViewId: 'one', phase: 'empty', status: {message: 'nothing here'}}),
      base({activeViewId: 'one', title: 'Renamed', subtitle: undefined}),
    ];

    for (const revision of revisions) {
      state = revision;
      // Twice each: the second pass must be a no-op, not a rebuild.
      notify();
      handle.update();
      expect(handle.stage).toBe(stage);
      expect(handle.index).toBe(index);
      expect(handle.statusMessage).toBe(message);
      expect(tabsOf(handle)[0]).toBe(firstTab);
      expect(handle.element.querySelector('.wui-workbench__dock[data-dock="left"] > div:last-child')).toBe(left);
      expect(left.contains(tenant)).toBe(true);
    }

    // Folded away and brought back: the SAME node, so the presenter inside it
    // never noticed.
    state = base({dockVisibility: {right: false}});
    handle.update();
    expect(handle.dock('right')).toBeUndefined();
    state = base({});
    handle.update();
    expect(handle.dock('right')).toBe(right);
    expect(handle.dock('foot')).toBe(foot);
    handle.destroy();
  });

  it('offers only the docks the active view asked for', () => {
    let state = base({activeViewId: 'one'});
    const handle = mountWorkbench(host(), {snapshot: () => state, toggleDock: vi.fn()});
    const left = handle.dock('left')!;
    expect(handle.dock('right')).toBeInstanceOf(HTMLElement);
    expect(handle.element.dataset.rail).toBe('true');

    state = base({activeViewId: 'three'});
    handle.update();
    // `three` names one dock, so the other two lose their frames AND their
    // switches: a control for something this view can never show is dead.
    expect(handle.dock('left')).toBe(left);
    expect(handle.dock('right')).toBeUndefined();
    expect(handle.dock('foot')).toBeUndefined();
    expect(handle.element.querySelector<HTMLElement>('.wui-workbench__strip')?.hidden).toBe(true);
    expect(handle.element.dataset.rail).toBe('true');
    handle.destroy();
  });

  it('says which grid is true on the path that has no sheet to read it', () => {
    // `data-rail="false"` collapsing the grid is not a responsive rewrite — it
    // is the shell saying what is true — so it cannot be the documented cost of
    // `stylesheet: false`. Skipping it leaves a permanent empty rail column.
    let state = base({activeViewId: 'one'});
    const handle = mountWorkbench(host(), {snapshot: () => state}, {stylesheet: false});
    const frame = handle.element.querySelector<HTMLElement>('.wui-workbench__frame')!;
    expect(frame.style.getPropertyValue('grid-template-areas')).toContain('main rail');

    state = base({views: [{id: 'one', label: 'One', docks: ['foot']}], activeViewId: 'one'});
    handle.update();
    expect(handle.element.dataset.rail).toBe('false');
    expect(frame.style.getPropertyValue('grid-template-areas')).toBe('"header" "main" "strip" "status"');
    handle.destroy();

    const bare = mountWorkbench(host(), {snapshot: () => base()}, {stylesheet: false, chrome: 'bare'});
    expect(
      bare.element.querySelector<HTMLElement>('.wui-workbench__frame')!.style.getPropertyValue(
        'grid-template-areas',
      ),
    ).toBe('"main"');
    bare.destroy();
  });

  it('carries the token layer on both paths, because it is what the docks read', () => {
    // The shell is the token carrier: one `data-density` on the root has to
    // resize the type ladder for every surface in every dock. With the sheet
    // off and no token block painted, the chrome would resize and nothing
    // mounted inside it would.
    const handle = mountWorkbench(host(), {snapshot: () => base()}, {stylesheet: false});
    expect(handle.element.style.getPropertyValue('--wui-harmony-accent')).not.toBe('');
    expect(handle.element.style.getPropertyValue('--wui-harmony-line')).not.toBe('');
    handle.destroy();
  });

  it('moves the sized switch thumb with dock state without an installed stylesheet', () => {
    let state = base({dockVisibility: {left: true}});
    const handle = mountWorkbench(host(), {snapshot: () => state, toggleDock: vi.fn()}, {stylesheet: false});
    const toggle = handle.element.querySelector<HTMLButtonElement>('[role="switch"][data-dock="left"]')!;
    const knob = toggle.firstElementChild as HTMLElement;
    expect(toggle.style.height).toContain('--wm-control-size');
    expect(knob.style.transform).toContain('--wm-control-size');
    expect(knob.style.background).toContain('--wm-accent-foreground');
    state = base({dockVisibility: {left: false}});
    handle.update();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(knob.style.transform).toBe('none');
    handle.destroy();
  });

  it('says data-rail="false" when there is no rail to draw', () => {
    let state = base({views: [{id: 'one', label: 'One', docks: ['foot']}], activeViewId: 'one'});
    const handle = mountWorkbench(host(), {snapshot: () => state});
    expect(handle.element.dataset.rail).toBe('false');
    expect(handle.element.querySelector<HTMLElement>('.wui-workbench__rail')?.hidden).toBe(true);

    state = base({});
    handle.update();
    expect(handle.element.dataset.rail).toBe('true');
    handle.destroy();
  });

  it('survives a binding that throws instead of answering', () => {
    const onError = vi.fn();
    const handle = mountWorkbench(
      host(),
      {
        snapshot: () => {
          throw new Error('no snapshot');
        },
      },
      {onError},
    );
    expect(onError).toHaveBeenCalledTimes(1);
    // Mounted, empty and inert — an unusable shell beats a thrown mount.
    expect(handle.element.isConnected).toBe(true);
    expect(() => handle.update()).not.toThrow();
    expect(() => handle.tick()).not.toThrow();
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------

describe('the tablist', () => {
  function wired() {
    let state = base();
    const activateView = vi.fn((id: string) => {
      state = {...state, activeViewId: id};
    });
    const handle = mountWorkbench(host(), {snapshot: () => state, activateView});
    return {handle, activateView, tabs: tabsOf(handle)};
  }

  it('moves focus on an arrow and chooses nothing', () => {
    const {handle, activateView, tabs} = wired();
    expect(tabs.map((tab) => tab.getAttribute('role'))).toEqual(['tab', 'tab', 'tab']);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);

    tabs[0]!.focus();
    press(tabs[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs[1]);
    // MANUAL activation. Automatic would run one analysis projection per tab as
    // a viewer sweeps the strip — three of them between two key repeats.
    expect(activateView).not.toHaveBeenCalled();
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    // Roving tabindex: exactly one stop in the strip, and it followed focus.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);

    press(tabs[1]!, 'ArrowLeft');
    expect(document.activeElement).toBe(tabs[0]);
    handle.destroy();
  });

  it('wraps, and jumps to the ends on Home and End', () => {
    const {handle, tabs} = wired();
    tabs[0]!.focus();
    press(tabs[0]!, 'ArrowLeft');
    expect(document.activeElement).toBe(tabs[2]);
    press(tabs[2]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs[0]);
    press(tabs[0]!, 'End');
    expect(document.activeElement).toBe(tabs[2]);
    press(tabs[2]!, 'Home');
    expect(document.activeElement).toBe(tabs[0]);
    handle.destroy();
  });

  it('switches on Enter and Space, and leaves focus where it was', () => {
    const {handle, activateView, tabs} = wired();
    tabs[1]!.focus();
    press(tabs[1]!, 'Enter');
    expect(activateView).toHaveBeenCalledWith('two');
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('false');
    // Focus does NOT follow the switch into the panel: a reader arrowing the
    // strip would be dropped out of it mid-sentence.
    expect(document.activeElement).toBe(tabs[1]);

    press(tabs[2]!, ' ');
    expect(activateView).toHaveBeenLastCalledWith('three');

    // A click says the same thing.
    tabs[0]!.click();
    expect(activateView).toHaveBeenLastCalledWith('one');
    handle.destroy();
  });

  it('snaps the stop back to the selected tab once focus leaves', () => {
    const {handle, tabs} = wired();
    tabs[0]!.focus();
    press(tabs[0]!, 'End');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);
    handle.update();
    // Still focused inside the strip: the stop stays where the viewer is.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0]);

    tabs[2]!.blur();
    handle.update();
    // Gone: tabbing back in must land on the view actually on screen.
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    handle.destroy();
  });

  it('keeps the tab stop under the focus inside a shadow tree', () => {
    // `document.activeElement` inside a shadow tree is the HOST element and
    // never a tab, so a shell mounted on a `ShadowRoot` would decide on every
    // pass that focus had left the strip — and move the tab stop out from under
    // a focus that had not moved at all.
    const box = document.createElement('div');
    document.body.append(box);
    const root = box.attachShadow({mode: 'open'});
    const handle = mountWorkbench(root, {snapshot: () => base()});
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('.wui-workbench__tab')];
    tabs[0]!.focus();
    press(tabs[0]!, 'ArrowRight');
    expect(root.activeElement).toBe(tabs[1]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    handle.update();
    expect(root.activeElement).toBe(tabs[1]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    handle.destroy();
  });

  it('does not throw a viewer back to the start when a view arrives', () => {
    // Reconciling ends in `replaceChildren`, which blurs whatever it moves. A
    // viewer arrowing along the strip loses their place to an update they did
    // not ask for unless the focus is picked up and put back.
    let state = base();
    const handle = mountWorkbench(host(), {snapshot: () => state});
    const tabs = tabsOf(handle);
    tabs[0]!.focus();
    press(tabs[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs[1]);

    state = {...state, views: [...VIEWS, {id: 'four', label: 'Four'}]};
    handle.update();
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabsOf(handle).map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1]);
    handle.destroy();
  });

  it('does not re-activate the view already on screen', () => {
    // Manual activation exists because an activation costs an analysis
    // projection. Spending one to arrive where we already are is the same waste
    // by a slower route.
    const activateView = vi.fn();
    const handle = shell({}, {activateView});
    const tabs = tabsOf(handle);
    tabs[0]!.click();
    press(tabs[0]!, 'Enter');
    expect(activateView).not.toHaveBeenCalled();
    tabs[1]!.click();
    expect(activateView).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it('wires the panel to the selected tab and to nothing else', () => {
    const {handle, tabs} = wired();
    const panel = handle.element.querySelector<HTMLElement>('.wui-workbench__main')!;
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0]!.id);
    expect(new Set(tabs.map((tab) => tab.getAttribute('aria-controls')))).toEqual(new Set([panel.id]));
    tabs[1]!.click();
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs[1]!.id);
    handle.destroy();
  });

  it('writes no scroll it measured as zero', () => {
    // jsdom lays nothing out, so every measurement below answers `0`. A
    // centring arithmetic on a zero-width strip resolves to zero for every tab
    // and would yank a real strip back to its start on each key press.
    const {handle, tabs} = wired();
    const tablist = handle.element.querySelector<HTMLElement>('.wui-workbench__tablist')!;
    const writes: number[] = [];
    Object.defineProperty(tablist, 'scrollLeft', {
      configurable: true,
      get: () => writes[writes.length - 1] ?? 0,
      set: (value: number) => writes.push(value),
    });

    tabs[0]!.focus();
    press(tabs[0]!, 'End');
    tabs[2]!.click();
    expect(writes).toEqual([]);
    expect(handle.element.outerHTML).not.toContain('NaN');

    // Given real numbers it centres, which is what the guard was protecting.
    Object.defineProperty(tablist, 'clientWidth', {configurable: true, value: 200});
    Object.defineProperty(tablist, 'scrollWidth', {configurable: true, value: 600});
    Object.defineProperty(tabs[2]!, 'offsetWidth', {configurable: true, value: 100});
    Object.defineProperty(tabs[2]!, 'offsetLeft', {configurable: true, value: 400});
    tabs[2]!.click();
    expect(writes).toEqual([350]);
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------

describe('the docks and the status bar', () => {
  it('folds a dock with a switch, not with a button that looks like one', () => {
    let state = base();
    const toggleDock = vi.fn((id: string, next: boolean) => {
      state = {...state, dockVisibility: {...state.dockVisibility, [id]: next}};
    });
    const handle = mountWorkbench(host(), {snapshot: () => state, toggleDock});
    const toggle = handle.element.querySelector<HTMLButtonElement>(
      '.wui-workbench__dock[data-dock="right"] .wui-workbench__dock-toggle',
    )!;
    expect(toggle.getAttribute('role')).toBe('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    // Named by the dock it switches, not by a symbol.
    expect(handle.element.querySelector(`#${toggle.getAttribute('aria-labelledby')}`)?.textContent).toBe('Right');

    const body = handle.dock('right')!;
    toggle.click();
    expect(toggleDock).toHaveBeenCalledWith('right', false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(handle.dock('right')).toBeUndefined();
    expect(body.hidden).toBe(true);
    // The switch itself never folds away with the thing it switches, or there
    // would be no way back.
    expect(toggle.hidden).toBe(false);
    expect(toggle.isConnected).toBe(true);

    toggle.click();
    expect(handle.dock('right')).toBe(body);
    handle.destroy();
  });

  it('hides the switch where nothing can receive the answer', () => {
    const handle = shell();
    const toggles = [...handle.element.querySelectorAll<HTMLButtonElement>('.wui-workbench__dock-toggle')];
    expect(toggles.length).toBe(3);
    expect(toggles.every((toggle) => toggle.hidden)).toBe(true);
    // Hidden AND out of the tab order. A switch a reader can still reach, is
    // told is on, and throws to no effect is worse than no switch at all.
    expect(toggles.every((toggle) => toggle.disabled)).toBe(true);
    handle.destroy();
  });

  it('hides what it hides, in computed style and not only in a property', () => {
    // `[hidden] { display: none }` lives at USER-AGENT origin and every
    // `display` this sheet writes is at author origin, so an unqualified flex
    // box stays on screen with `hidden` set — which is how a dead `role=switch`
    // ends up focusable. Asserting the PROPERTY cannot see that; only the
    // cascade can, so every node the shell hides is checked through it.
    const handle = shell();
    const seen = (selector: string): string =>
      getComputedStyle(handle.element.querySelector<HTMLElement>(selector)!).display;
    expect(seen('.wui-workbench__dock-toggle')).toBe('none');
    expect(seen('.wui-workbench__identity')).toBe('none');
    expect(seen('.wui-workbench__note')).toBe('none');
    expect(seen('.wui-workbench__detail')).toBe('none');
    // A dock that is on screen is untouched by the rule that hides its siblings.
    expect(seen('.wui-workbench__rail')).toBe('flex');
    handle.destroy();
  });

  it('folds the whole dock away when there is no switch to open it again', () => {
    // A body hidden under a label with no control is a header over nothing.
    const handle = shell({dockVisibility: {right: false}});
    const section = (id: string): HTMLElement =>
      handle.element.querySelector<HTMLElement>(`.wui-workbench__dock[data-dock="${id}"]`)!;
    expect(section('right').hidden).toBe(true);
    expect(getComputedStyle(section('right')).display).toBe('none');
    expect(section('left').hidden).toBe(false);
    handle.destroy();
  });

  it('tells the caller when a dock stops answering, because it cannot evict a tenant', () => {
    // `dock(id)` refusing covers what has NOT been mounted. A presenter already
    // in a dock that folds keeps its clock subscription and paints into a box
    // nobody can see — and the shell does not own it, so all it can do is say.
    const changes: [string, boolean][] = [];
    let state = base();
    const handle = mountWorkbench(
      host(),
      {
        snapshot: () => state,
        toggleDock: (id, next) => {
          state = {...state, dockVisibility: {...state.dockVisibility, [id]: next}};
        },
      },
      {onDockVisibility: (id, visible) => changes.push([id, visible])},
    );
    // The first pass is the baseline, and it is silent: a callback fired during
    // the mount reaches a caller that does not hold the handle yet.
    expect(changes).toEqual([]);

    handle.element
      .querySelector<HTMLButtonElement>('.wui-workbench__dock[data-dock="left"] .wui-workbench__dock-toggle')!
      .click();
    expect(changes).toEqual([['left', false]]);
    expect(handle.dock('left')).toBeUndefined();

    // A view that asks for fewer docks is the same event by another route.
    changes.length = 0;
    state = {...state, activeViewId: 'three', dockVisibility: {}};
    handle.update();
    expect(changes.sort()).toEqual([
      ['foot', false],
      ['left', true],
      ['right', false],
    ]);
    handle.destroy();
  });

  it('refuses to lose a slot with a presenter in it in silence', () => {
    // `docks` is stable for the life of the mount. Dropping an id from it takes
    // the slot node away, and with it whatever the caller mounted inside — the
    // one silent unmount the whole module is built to prevent, arriving through
    // the door the pruning loop leaves open.
    const errors: unknown[] = [];
    let state = base();
    const handle = mountWorkbench(host(), {snapshot: () => state}, {onError: (error) => errors.push(error)});
    const tenant = document.createElement('div');
    handle.dock('right')!.append(tenant);

    state = {...state, docks: DOCKS.filter((dock) => dock.id !== 'right')};
    handle.update();
    expect(errors.length).toBe(1);
    expect(String(errors[0])).toContain('"right"');
    expect(String(errors[0])).toContain('WorkbenchView.docks');
    expect(tenant.isConnected).toBe(false);

    // A dock that leaves with nothing inside it is an ordinary edit.
    errors.length = 0;
    state = {...state, docks: DOCKS.filter((dock) => dock.id === 'left')};
    handle.update();
    expect(errors).toEqual([]);
    handle.destroy();
  });

  it('keeps every generated id unique across a set that churns', () => {
    // A map's SIZE is not a sequence. Remove in one snapshot, add in the next,
    // and the newcomer takes an id the survivor still holds — two
    // `aria-labelledby` references at one label, and a switch that announces
    // the wrong dock. Silent: no gate, no console, nothing to notice.
    let state = base();
    const handle = mountWorkbench(host(), {snapshot: () => state});
    const ids = (): string[] => [
      ...[...handle.element.querySelectorAll('.wui-workbench__tab')].map((node) => node.id),
      ...[...handle.element.querySelectorAll('.wui-workbench__dock-label')].map((node) => node.id),
    ];
    state = {
      ...state,
      views: VIEWS.filter((view) => view.id !== 'two'),
      docks: DOCKS.filter((dock) => dock.id !== 'right'),
    };
    handle.update();
    state = {
      ...state,
      views: [...VIEWS.filter((view) => view.id !== 'two'), {id: 'four', label: 'Four'}],
      docks: [...DOCKS.filter((dock) => dock.id !== 'right'), {id: 'head', label: 'Head'}],
    };
    handle.update();

    const seen = ids();
    expect(seen.length).toBe(6);
    expect(new Set(seen).size).toBe(seen.length);
    // And every reference still resolves to exactly one node.
    for (const node of handle.element.querySelectorAll('[aria-labelledby]')) {
      const target = node.getAttribute('aria-labelledby')!;
      expect(handle.element.ownerDocument.querySelectorAll(`#${target}`).length).toBe(1);
    }
    handle.destroy();
  });

  it('announces the message and says the detail silently', () => {
    let state = base({phase: 'playing', status: {message: 'live', detail: 'bar 12'}});
    const handle = mountWorkbench(host(), {snapshot: () => state});
    // Present under `full` chrome, which is the only chrome that builds a
    // status bar to hold it.
    const message = handle.statusMessage!;
    const detail = handle.element.querySelector<HTMLElement>('.wui-workbench__detail')!;

    expect(message.getAttribute('role')).toBe('status');
    expect(message.getAttribute('aria-live')).toBe('polite');
    expect(message.textContent).toBe('live');
    // The detail changes many times a second during playback. A polite region
    // that did would talk over the page for as long as the piece lasts.
    expect(detail.getAttribute('aria-live')).toBeNull();
    expect(detail.getAttribute('role')).toBeNull();
    expect(detail.textContent).toBe('bar 12');

    // The node survives every change, which is what a live region needs: a
    // replaced node inside one is a change no reader hears.
    state = base({phase: 'playing', status: {message: 'still live'}});
    handle.update();
    expect(handle.statusMessage).toBe(message);
    expect(detail.hidden).toBe(true);
    handle.destroy();
  });

  it('writes the phase where a stylesheet can reach it', () => {
    let state = base({phase: 'idle'});
    const handle = mountWorkbench(host(), {snapshot: () => state});
    for (const phase of ['listening', 'playing', 'empty', 'error'] as const) {
      state = base({phase, status: {message: `in ${phase}`}});
      handle.update();
      expect(handle.element.dataset.phase).toBe(phase);
    }
    // The two phases with nothing to show say so on the stage as well as in the
    // bar; the three that do show something leave the stage alone.
    const note = handle.element.querySelector<HTMLElement>('.wui-workbench__note')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe('in error');
    state = base({phase: 'playing', status: {message: 'in playing'}});
    handle.update();
    expect(note.hidden).toBe(true);
    // An unknown phase is `idle`, never whatever string arrived.
    state = base({phase: 'nonsense' as never});
    handle.update();
    expect(handle.element.dataset.phase).toBe('idle');
    handle.destroy();
  });

  it('keeps exactly one live region, wherever the chrome went', () => {
    // In `full` the status bar says the empty sentence, so the stage's copy is
    // silent; in `bare` there is no bar, so the stage's copy is the only voice.
    const full = shell({phase: 'empty', status: {message: 'nothing here'}});
    const fullNote = full.element.querySelector<HTMLElement>('.wui-workbench__note')!;
    expect(fullNote.getAttribute('aria-live')).toBeNull();
    expect(full.element.querySelectorAll('[aria-live]')).toHaveLength(1);
    full.destroy();

    const bare = shell({phase: 'empty', status: {message: 'nothing here'}}, {}, {chrome: 'bare'});
    const bareNote = bare.element.querySelector<HTMLElement>('.wui-workbench__note')!;
    expect(bareNote.getAttribute('role')).toBe('status');
    expect(bareNote.getAttribute('aria-live')).toBe('polite');
    expect(bare.element.querySelectorAll('[aria-live]')).toHaveLength(1);
    bare.destroy();
  });

  it('switches density and scheme without touching a slot', () => {
    let state = base({density: 'comfortable'});
    const handle = mountWorkbench(host(), {snapshot: () => state});
    const stage = handle.stage;
    expect(handle.element.dataset.density).toBe('comfortable');
    expect(handle.element.dataset.scheme).toBeUndefined();
    // Omitted means "follow the host page": a card that painted a scheme it was
    // never asked for is the loudest thing on someone else's page.
    expect(handle.element.style.getPropertyValue('color-scheme')).toBe('');

    state = base({density: 'compact', scheme: 'dark'});
    handle.update();
    expect(handle.element.dataset.density).toBe('compact');
    expect(handle.element.dataset.scheme).toBe('dark');
    expect(handle.element.style.getPropertyValue('color-scheme')).toBe('dark');
    expect(handle.element.style.getPropertyValue('--wui-harmony-size-body')).toContain('.8125rem');

    state = base({});
    handle.update();
    expect(handle.element.style.getPropertyValue('color-scheme')).toBe('');
    expect(handle.stage).toBe(stage);
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------

describe('the clock', () => {
  it('takes ONE reading per frame and hands every slot the same instant', () => {
    const frames = driver();
    let position = 0;
    const now = vi.fn(() => position);
    const epoch = vi.fn(() => 7);
    const handle = shell({phase: 'playing'}, {now, epoch});
    const before = now.mock.calls.length;

    const first: FrameTick[] = [];
    const second: FrameTick[] = [];
    handle.clock.subscribe((tick) => first.push(tick));
    handle.clock.subscribe((tick) => second.push(tick));

    position = 4;
    frames.frame(16);
    expect(now).toHaveBeenCalledTimes(before + 1);
    expect(first).toHaveLength(1);
    // Not merely equal — the SAME object. Two docks that read the position
    // independently is exactly how four of them drift apart by a frame.
    expect(first[0]).toBe(second[0]);
    expect(first[0]!.now).toBe(4);
    expect(first[0]!.epoch).toBe(7);
    expect(first[0]!.continuous).toBe(true);
    expect(handle.clock.read()).toBe(first[0]);

    position = 9;
    frames.frame(32);
    expect(now).toHaveBeenCalledTimes(before + 2);
    // The frame carries its own delta, so a caller can interpolate without
    // being told what the axis means.
    expect(now).toHaveBeenLastCalledWith({time: 32, delta: 16});
    handle.destroy();
  });

  it('runs a loop only while something is subscribed to it', () => {
    const frames = driver();
    const handle = shell({phase: 'playing'}, {now: () => 1});
    // A parked workbench costs nothing at all.
    expect(frames.raf).not.toHaveBeenCalled();

    const leave = handle.clock.subscribe(vi.fn());
    expect(frames.raf).toHaveBeenCalledTimes(1);
    frames.frame(16);
    expect(frames.armed()).toBe(1);

    leave();
    expect(frames.armed()).toBe(0);
    // Leaving twice is harmless, and does not take somebody else's loop down.
    expect(() => leave()).not.toThrow();
    handle.destroy();
  });

  it('stops the clock in every phase that is not playing or listening', () => {
    const frames = driver();
    let state = base({phase: 'idle'});
    const handle = mountWorkbench(host(), {snapshot: () => state, now: () => 1});
    handle.clock.subscribe(vi.fn());
    // An idle shell burning a frame callback in a background tab is a real bug,
    // not a style preference.
    expect(frames.raf).not.toHaveBeenCalled();

    state = base({phase: 'playing'});
    handle.update();
    expect(frames.raf).toHaveBeenCalledTimes(1);

    state = base({phase: 'empty'});
    handle.update();
    expect(frames.armed()).toBe(0);

    state = base({phase: 'listening'});
    handle.update();
    expect(frames.armed()).toBe(1);
    handle.destroy();
  });

  it('never asks for a frame when the caller has no position to give', () => {
    const frames = driver();
    const handle = shell({phase: 'playing'});
    handle.clock.subscribe(vi.fn());
    expect(frames.raf).not.toHaveBeenCalled();
    // The seat is still there: a slot reads a still, correct frame.
    expect(handle.clock.read().continuous).toBe(false);
    handle.destroy();
  });

  it('drives a frame by hand, deterministically', () => {
    let position = 3;
    const handle = shell({phase: 'idle'}, {now: () => position});
    const seen: FrameTick[] = [];
    handle.clock.subscribe((tick) => seen.push(tick));
    handle.tick();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.now).toBe(3);
    // A hand-driven tick is not a frame, and says so: a presenter that snaps on
    // an event and interpolates on a frame has to be able to tell them apart.
    expect(seen[0]!.continuous).toBe(false);
    position = 5;
    handle.tick();
    expect(seen[1]!.now).toBe(5);
    handle.destroy();
  });

  it('stops saying the loop is struggling once there is no loop', () => {
    // `data-motion` does two jobs and only one of them ends with the loop:
    // every surface below this node resolves `motion: "auto"` by reading the
    // nearest ancestor's value, and `degraded` is not one of the three answers
    // that contract accepts. A shell that degraded and then parked would leave
    // each new dock to ask `matchMedia` on its own — the disagreement one
    // shared answer exists to prevent.
    driver();
    let state = base({phase: 'playing'});
    const handle = mountWorkbench(host(), {snapshot: () => state, now: () => 1});
    handle.clock.subscribe(() => {});
    // Stand in for the loop's own write on a frame it took too long over.
    handle.element.dataset.motion = 'degraded';

    state = base({phase: 'idle'});
    handle.update();
    expect(handle.element.dataset.motion).toBe('continuous');
    handle.destroy();
  });

  it('never re-reads the snapshot from the clock', () => {
    // Under live, "update() does not rebuild a slot" gains a second, sharper
    // meaning: an update() called once per frame would unmount every child
    // presenter sixty times a second. The two paths are completely separate.
    const frames = driver();
    let position = 0;
    const snapshot = vi.fn(() => base({phase: 'playing'}));
    const handle = mountWorkbench(host(), {snapshot, now: () => (position += 1)});
    const stage = handle.stage;
    const left = handle.dock('left')!;
    const tenant = document.createElement('div');
    left.append(tenant);
    handle.clock.subscribe(vi.fn());
    const reads = snapshot.mock.calls.length;

    for (let step = 0; step < 60; step += 1) frames.frame(step * 16);
    expect(snapshot).toHaveBeenCalledTimes(reads);
    expect(handle.stage).toBe(stage);
    expect(handle.dock('left')).toBe(left);
    expect(left.contains(tenant)).toBe(true);
    handle.destroy();
  });

  it('leaves nothing behind when it is destroyed', () => {
    const frames = driver();
    const watched = preference(false);
    let stopped = false;
    const draw = vi.fn();
    const node = host();
    const handle = mountWorkbench(node, {
      snapshot: () => base({phase: 'playing'}),
      now: () => 1,
      subscribe: () => () => {
        stopped = true;
      },
    });
    handle.clock.subscribe(draw);
    expect(frames.armed()).toBe(1);
    expect(watched.attached()).toBe(1);

    handle.destroy();
    expect(frames.armed()).toBe(0);
    expect(watched.attached()).toBe(0);
    expect(stopped).toBe(true);
    expect(node.childElementCount).toBe(0);

    // Nothing wakes it again.
    const before = draw.mock.calls.length;
    frames.frame(48);
    handle.tick();
    handle.update();
    expect(draw).toHaveBeenCalledTimes(before);
    // And it hands out no more slots. A caller that mounted into one would get
    // a presenter running for the life of the page inside a detached tree, and
    // the shell that let it in has no way left to stop it.
    expect(handle.dock('left')).toBeUndefined();
    expect(() => handle.destroy()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

describe('reduced motion', () => {
  it('opens no loop at all and steps on the caller’s own notifications', () => {
    const frames = driver();
    let position = 0;
    let notify = (): void => {};
    const handle = mountWorkbench(
      host(),
      {
        snapshot: () => base({phase: 'playing'}),
        now: () => position,
        subscribe: (listener) => {
          notify = listener;
          return () => {};
        },
      },
      {motion: 'stepped'},
    );
    const seen: FrameTick[] = [];
    handle.clock.subscribe((tick) => seen.push(tick));

    // Not "a loop with the durations set to zero" — no loop.
    expect(frames.raf).not.toHaveBeenCalled();
    expect(handle.element.dataset.motion).toBe('stepped');

    position = 6;
    notify();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.now).toBe(6);
    expect(seen[0]!.continuous).toBe(false);
    position = 12;
    notify();
    expect(seen[1]!.now).toBe(12);
    handle.destroy();
  });

  it('follows the viewer’s preference while the page is open', () => {
    const frames = driver();
    const watched = preference(false);
    const handle = shell({phase: 'playing'}, {now: () => 1});
    handle.clock.subscribe(vi.fn());
    expect(handle.element.dataset.motion).toBe('continuous');
    expect(frames.raf).toHaveBeenCalledTimes(1);

    // The whole reason this is JavaScript and not a media query: a media query
    // can kill a transition, and cannot stop a transform a loop is writing.
    watched.set(true);
    expect(handle.element.dataset.motion).toBe('stepped');
    expect(frames.armed()).toBe(0);

    watched.set(false);
    expect(handle.element.dataset.motion).toBe('continuous');
    expect(frames.armed()).toBe(1);
    handle.destroy();
  });

  it('mounts where there is no media query to ask', () => {
    // `matchMedia` is absent in jsdom and in more than one other environment
    // this mounts in. An absent answer is "no preference", not a failed mount.
    expect(window.matchMedia).toBeUndefined();
    const onError = vi.fn();
    const handle = shell({}, {}, {onError});
    expect(handle.element.dataset.motion).toBe('continuous');
    expect(onError).not.toHaveBeenCalled();
    handle.destroy();
  });

  it('takes the answer a shell above it already gave', () => {
    const outer = host();
    outer.dataset.motion = 'stepped';
    const inner = document.createElement('div');
    outer.append(inner);
    const handle = mountWorkbench(inner, {snapshot: () => base()});
    expect(handle.element.dataset.motion).toBe('stepped');
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------

describe('the mount contract', () => {
  it('hands the host to the newest mount and tears down the previous one', () => {
    const node = host();
    const first = mountWorkbench(node, {snapshot: () => base()});
    const second = mountWorkbench(node, {snapshot: () => base()});
    expect(first.element.isConnected).toBe(false);
    expect(second.element.isConnected).toBe(true);
    expect(node.querySelectorAll('.wui-workbench')).toHaveLength(1);
    expect(node.querySelectorAll('.wui-workbench__index')).toHaveLength(1);
    second.destroy();
  });

  it('installs its sheet by default and paints the same boxes without one', () => {
    const withSheet = host();
    const dressed = mountWorkbench(withSheet, {snapshot: () => base()});
    expect(withSheet.querySelector('style')?.dataset.webmusicUi).toBe('workbench');
    dressed.destroy();
    expect(withSheet.childElementCount).toBe(0);

    const without = host();
    const bare = mountWorkbench(without, {snapshot: () => base()}, {stylesheet: false});
    expect(without.querySelector('style')).toBeNull();
    expect(bare.element.style.display).toBe('block');
    expect(bare.element.querySelector<HTMLElement>('.wui-workbench__frame')?.style.display).toBe('grid');
    expect(bare.stage.style.position).toBe('relative');
    bare.destroy();
    expect(without.childElementCount).toBe(0);
  });
});

describe('single capability shell', () => {
  it('omits view navigation while retaining a named region and operable docks', () => {
    const toggle = vi.fn();
    const handle = shell({}, {toggleDock: toggle}, {navigation: false, label: 'One capability'});
    expect(handle.element.querySelector('[role="tablist"]')).toBeNull();
    const region = handle.element.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('One capability');
    expect(region?.hasAttribute('aria-labelledby')).toBe(false);
    expect(handle.dock('left')).toBeTruthy();
    handle.element.querySelector<HTMLButtonElement>('button[role="switch"]')!.click();
    expect(toggle).toHaveBeenCalledOnce();
    handle.destroy();
  });
});
