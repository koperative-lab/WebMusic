import {mountStatus, statusStyle, type StatusState} from './status';
import {claimHost} from './internal/lifecycle';
import {createFader, faderStyle} from './fader';
import {installStyle} from './internal/style';
import {addClassNames, clamp01, setParts} from './internal/dom';
import {componentSurfaceCss} from './internal/surface';
import {controlHeight} from './internal/control';
import {ICON_PATHS, hiddenScrollbarCss, iconButtonCss, setIconButton} from './internal/icons';
import {neutralColor} from './internal/palette';

export interface MixerChannel {
  id: string;
  label: string;
  value: number;
  disabled?: boolean;
  muted?: boolean;
  solo?: boolean;
}

export interface MixerState {
  master: number;
  channels: readonly MixerChannel[];
  /** Optional owner/source readiness, without replacing usable channel strips. */
  status?: StatusState;
  disabled?: boolean;
}

export interface MixerBinding {
  snapshot(): MixerState;
  setMaster(value: number): Promise<void> | void;
  setChannel(id: string, value: number): Promise<void> | void;
  setMuted?(id: string, muted: boolean): Promise<void> | void;
  setSolo?(id: string | null): Promise<void> | void;
  play?(): Promise<void> | void;
  pause?(): Promise<void> | void;
  stop?(): Promise<void> | void;
  subscribe?(notify: () => void): () => void;
}

export interface MixerClassNames {
  root?: string;
  transport?: string;
  board?: string;
  channels?: string;
  strip?: string;
  master?: string;
  fader?: string;
  input?: string;
  label?: string;
  actions?: string;
  button?: string;
  mute?: string;
  solo?: string;
  play?: string;
  pause?: string;
  stop?: string;
  status?: string;
}

export type MixerParts = MixerClassNames;

export interface MixerOptions {
  classNames?: MixerClassNames;
  parts?: MixerParts;
  onError?: (error: unknown) => void;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
  /**
   * Render the master strip. Defaults to true.
   *
   * A desk of channel strips with no master is a real shape — a submix, a
   * per-part trim — and it was the one thing about this presenter a caller
   * could not turn off, because mute and solo already appear only when the
   * binding can act on them.
   */
  master?: boolean;
}

export interface MixerHandle {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

type MixerHost = HTMLElement | ShadowRoot;
type MixerAction = "play" | "pause" | "stop";

const mounted = new WeakMap<MixerHost, MixerHandle>();

const line = `var(--wm-mixer-border, var(--wm-control-border, var(--wm-border, ${neutralColor('border')})))`;
const ink = `var(--wm-foreground, ${neutralColor('foreground')})`;
const muted = `var(--wm-foreground-muted, ${neutralColor('muted')})`;

/**
 * An edge-to-edge transport icon row with a hairline under it, over channel
 * strips separated by hairlines (Visual design → Toolbars, Geometry). Strip
 * names are mono captions; the channel scroller hides its scrollbar.
 */
export const mixerStyle = statusStyle + faderStyle + `
:where(.wui-mixer) {
${componentSurfaceCss('mixer', {
  padding: 'var(--wm-mixer-padding, 0)',
  border: `1px solid var(--wm-mixer-border, var(--wm-border, ${neutralColor('border')}))`,
  radius: 'var(--wm-mixer-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-mixer-background, var(--wm-surface, light-dark(#fff, #111)))',
})}
inline-size:100%; min-inline-size:0; max-inline-size:100%; color:var(--wui-mixer-text,var(--wm-mixer-text,${ink})); font:.8rem/1.35 var(--wm-font-family,var(--wm-font,system-ui,sans-serif)); }
:where(.wui-mixer__board) { display:flex; gap:0; align-items:stretch; min-inline-size:0; }
:where(.wui-mixer__channels) { box-sizing:border-box; display:flex; gap:0; align-items:stretch; flex:1 1 auto; min-inline-size:0; overflow-x:auto; }
:where(.wui-mixer__status .wui-status) { min-height:3rem; height:auto; }
:where(.wui-mixer__transport) { display:flex; flex-wrap:nowrap; align-items:stretch; gap:0; min-inline-size:0; block-size:${controlHeight('mixer')}; overflow-x:auto; border-block-end:1px solid ${line}; }
${hiddenScrollbarCss('.wui-mixer__transport')}${hiddenScrollbarCss('.wui-mixer__channels')}/* Strip padding leaves room inside the scroller for the shared fader's focus outline. */
:where(.wui-mixer__strip) { display:flex; flex-direction:column; align-items:center; gap:.45rem; flex:0 0 auto; min-inline-size:4.5rem; padding:.6rem .5rem .5rem; }
:where(.wui-mixer__channels > .wui-mixer__strip + .wui-mixer__strip) { border-inline-start:1px solid ${line}; }
:where(.wui-mixer__master) { border-inline-end:1px solid ${line}; }
:where(.wui-mixer__master .wui-mixer__label) { color:${ink}; }
:where(.wui-mixer__label) { max-inline-size:7rem; min-block-size:2.4em; overflow-wrap:anywhere; text-align:center; color:${muted}; font:500 .625rem/1.2 var(--wm-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace); text-transform:uppercase; letter-spacing:.08em; }
:where(.wui-mixer__actions) { display:flex; gap:0; }
${iconButtonCss('.wui-mixer__button', 'mixer')}
:where(.wui-mixer__button[aria-pressed="true"]) { background:var(--wui-mixer-active-background,${ink}); color:var(--wm-mixer-active-text,var(--wm-accent-foreground,light-dark(#fff, #111))); }
:where(.wui-mixer__channels:focus-visible) { outline:var(--wm-focus-ring,2px solid ${ink}); outline-offset:-2px; }
:where(.wui-mixer__fader) { display:block; }
/* The strip's own tokens, handed to the shared fader that paints the track. */
:where(.wui-mixer__input) { --wm-fader-width:var(--wm-mixer-fader-width,2rem); --wm-fader-height:var(--wm-mixer-fader-height,96px); --wm-fader-track:var(--wui-mixer-track,var(--wm-mixer-track,var(--wm-surface-muted,light-dark(#f3f3f3, #1c1c1c)))); --wm-fader-track-border:var(--wui-mixer-track-border,var(--wm-mixer-track-border,var(--wm-control-border,var(--wm-border,${neutralColor('border')})))); --wm-fader-fill:var(--wui-mixer-fill,var(--wm-mixer-fill,${muted})); --wm-fader-thumb:var(--wm-mixer-thumb,${ink}); --wm-fader-handle:var(--wm-mixer-handle,.7rem); --wm-fader-radius:var(--wm-mixer-radius,var(--wm-control-radius,0)); }
:where(.wui-mixer__status[hidden], .wui-mixer__board[hidden], .wui-mixer__transport[hidden]) { display:none; }
`;

export function mountMixer(
  host: MixerHost,
  binding: MixerBinding,
  options: MixerOptions = {},
): MixerHandle {
  const document = host.ownerDocument;
  const style = installStyle(document, 'mixer', mixerStyle, options.stylesheet);
  const root = document.createElement("div");
  root.className = "wui-mixer mixer";
  addClassNames(root, options.classNames?.root);
  setParts(root, ["root"], options.parts?.root);

  let destroyed = false;
  let unsubscribe: (() => void) | undefined;
  const command = (work: () => Promise<void> | void): void => {
    try {
      void Promise.resolve(work()).then(update, options.onError);
    } catch (error) {
      options.onError?.(error);
    }
  };

  /**
   * One channel's column, built once and repainted in place.
   *
   * This used to rebuild the whole board on every update, which quietly broke
   * the control it was rebuilding. A commit runs `update()` on the next
   * microtask, and a browser releases pointer capture the moment the captured
   * element leaves the document — so a scrub committed its `pointerdown` and
   * then went dead, with the finger over a detached, destroyed node, and an
   * arrow key lost focus after a single step. Repainting keeps the node that
   * the pointer and the focus ring are attached to.
   */
  interface Strip {
    element: HTMLElement;
    paint: (channel: MixerChannel, disabled: boolean) => void;
    destroy: () => void;
  }

  const createStrip = (initial: MixerChannel, master = false): Strip => {
    // Every handler below fires long after this call, so it reads the channel
    // the strip is currently SHOWING, not the one it was built from.
    let current = initial;

    const strip = document.createElement("div");
    strip.className = `wui-mixer__strip strip${master ? " wui-mixer__master master" : ""}`;
    addClassNames(strip, options.classNames?.strip);
    if (master) addClassNames(strip, options.classNames?.master);
    setParts(
      strip,
      ["strip", master ? "master" : "channel"],
      options.parts?.strip,
      master ? options.parts?.master : undefined,
    );

    // The kit's shared fader — this strip's design is where it came from. The
    // painted box and the range control collapse into that one node, so it
    // carries BOTH documented hooks: `fader` for the track, `input` for the
    // control that was inside it.
    const control = createFader(document, {
      label: `${initial.label} volume`,
      value: clamp01(initial.value),
      orientation: "vertical",
      disabled: initial.disabled === true,
      classNames: {
        root: ["wui-mixer__fader fader wui-mixer__input", options.classNames?.fader, options.classNames?.input]
          .filter(Boolean)
          .join(" "),
      },
      parts: {root: ["fader", "input", options.parts?.fader, options.parts?.input].filter(Boolean).join(" ")},
      onInput: (value) => command(() => master
        ? binding.setMaster(value)
        : binding.setChannel(current.id, value)),
      onError: (error) => options.onError?.(error),
    });

    const label = document.createElement("div");
    label.className = "wui-mixer__label name";
    addClassNames(label, options.classNames?.label);
    setParts(label, ["label"], options.parts?.label);
    strip.append(control.element, label);

    let mute: HTMLButtonElement | undefined;
    let solo: HTMLButtonElement | undefined;
    if (!master && (binding.setMuted || binding.setSolo)) {
      const actions = document.createElement("div");
      actions.className = "wui-mixer__actions btns";
      addClassNames(actions, options.classNames?.actions);
      setParts(actions, ["actions"], options.parts?.actions);
      if (binding.setMuted) {
        mute = document.createElement("button");
        mute.type = "button";
        mute.className = "wui-mixer__button mute";
        addClassNames(mute, options.classNames?.button);
        addClassNames(mute, options.classNames?.mute);
        setParts(mute, ["button", "mute"], options.parts?.button, options.parts?.mute);
        mute.textContent = "M";
        mute.addEventListener("click", () =>
          command(() => binding.setMuted!(current.id, current.muted !== true)));
        actions.append(mute);
      }
      if (binding.setSolo) {
        solo = document.createElement("button");
        solo.type = "button";
        solo.className = "wui-mixer__button solo";
        addClassNames(solo, options.classNames?.button);
        addClassNames(solo, options.classNames?.solo);
        setParts(solo, ["button", "solo"], options.parts?.button, options.parts?.solo);
        solo.textContent = "S";
        solo.addEventListener("click", () =>
          command(() => binding.setSolo!(current.solo ? null : current.id)));
        actions.append(solo);
      }
      strip.append(actions);
    }

    const paint = (channel: MixerChannel, disabled: boolean): void => {
      current = channel;
      strip.dataset.channelId = channel.id;
      if (label.textContent !== channel.label) {
        label.title = channel.label;
        label.textContent = channel.label;
        // `mountSurfaceSlider` only names a slider that has no name yet, so a
        // renamed channel needs its accessible name written here.
        control.element.setAttribute("aria-label", `${channel.label} volume`);
      }
      control.paint(clamp01(channel.value), disabled);
      if (mute) {
        mute.disabled = disabled;
        mute.setAttribute("aria-label", `Mute ${channel.label}`);
        mute.title = `Mute ${channel.label}`;
        mute.setAttribute("aria-pressed", String(channel.muted === true));
      }
      if (solo) {
        solo.disabled = disabled;
        solo.setAttribute("aria-label", `Solo ${channel.label}`);
        solo.title = `Solo ${channel.label}`;
        solo.setAttribute("aria-pressed", String(channel.solo === true));
      }
    };

    paint(initial, initial.disabled === true);
    return {element: strip, paint, destroy: () => control.destroy()};
  };

  // The frame is built once too: rebuilding the transport row took the focus
  // off the very button that had just been pressed.
  const transport = document.createElement("div");
  transport.className = "wui-mixer__transport transport";
  addClassNames(transport, options.classNames?.transport);
  setParts(transport, ["transport"], options.parts?.transport);
  const actionButtons: HTMLButtonElement[] = [];
  const action = (
    kind: MixerAction,
    label: string,
    icon: string,
    work: (() => Promise<void> | void) | undefined,
  ): void => {
    if (!work) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `wui-mixer__button t-${kind}`;
    addClassNames(button, options.classNames?.button);
    addClassNames(button, options.classNames?.[kind]);
    setParts(button, ["button", kind], options.parts?.button, options.parts?.[kind]);
    setIconButton(button, icon, label);
    button.addEventListener("click", () => command(work));
    actionButtons.push(button);
    transport.append(button);
  };
  action("play", "Play", ICON_PATHS.play, binding.play);
  action("pause", "Pause", ICON_PATHS.pause, binding.pause);
  action("stop", "Stop", ICON_PATHS.stop, binding.stop);

  const board = document.createElement("div");
  board.className = "wui-mixer__board board";
  addClassNames(board, options.classNames?.board);
  setParts(board, ["board"], options.parts?.board);
  const channelsBox = document.createElement("div");
  channelsBox.className = "wui-mixer__channels strips";
  channelsBox.tabIndex = 0;
  channelsBox.setAttribute("role", "group");
  channelsBox.setAttribute("aria-label", "Mixer channels");
  addClassNames(channelsBox, options.classNames?.channels);
  setParts(channelsBox, ["channels"], options.parts?.channels);
  const showMaster = options.master !== false;
  const masterStrip = showMaster ? createStrip({id: "master", label: "master", value: 0}, true) : undefined;
  board.append(...(masterStrip ? [masterStrip.element] : []), channelsBox);
  root.replaceChildren(...(transport.childNodes.length ? [transport, board] : [board]));

  const statusHost = document.createElement('div');
  statusHost.className = 'wui-mixer__status';
  addClassNames(statusHost, options.classNames?.status);
  setParts(statusHost, ['status'], options.parts?.status);
  root.append(statusHost);
  let statusState: StatusState = {kind: 'ready'};
  const status = mountStatus(statusHost, {snapshot: () => statusState}, {
    stylesheet: false, classNames: {root: 'wui-status--embedded'},
  });

  const strips = new Map<string, Strip>();
  const releaseStrips = (): void => {
    for (const strip of strips.values()) strip.destroy();
    strips.clear();
    masterStrip?.destroy();
  };

  const update = (): void => {
    if (destroyed) return;
    try {
      const state = binding.snapshot();
      statusState = state.status ?? {kind: 'ready'};
      status.update();
      statusHost.hidden = statusState.kind === 'ready';
      const unavailable = statusState.kind !== 'ready' && state.channels.length === 0;
      board.hidden = unavailable;
      transport.hidden = unavailable;
      root.setAttribute('aria-busy', String(statusState.kind === 'loading'));
      const disabled = state.disabled === true;
      channelsBox.tabIndex = state.channels.length ? 0 : -1;
      for (const button of actionButtons) button.disabled = disabled;
      masterStrip?.paint({id: "master", label: "master", value: state.master}, disabled);

      const seen = new Set<string>();
      const order: HTMLElement[] = [];
      for (const channel of state.channels) {
        // Two channels may share an id; keying the second one apart keeps both
        // strips, which is what rebuilding the list used to do.
        let key = channel.id;
        for (let n = 1; seen.has(key); n += 1) key = `${channel.id}#${n}`;
        seen.add(key);
        const merged = {...channel, disabled: disabled || channel.disabled === true};
        let strip = strips.get(key);
        if (!strip) {
          strip = createStrip(merged);
          strips.set(key, strip);
        }
        strip.paint(merged, merged.disabled);
        order.push(strip.element);
      }
      for (const [key, strip] of [...strips]) {
        if (seen.has(key)) continue;
        strip.destroy();
        strip.element.remove();
        strips.delete(key);
      }
      // Move only what is actually out of place. A node left alone keeps the
      // pointer capture and the focus it is holding; re-inserting it, even at
      // the same index, would drop both.
      order.forEach((node, index) => {
        const occupant = channelsBox.children[index];
        if (occupant !== node) channelsBox.insertBefore(node, occupant ?? null);
      });
      while (channelsBox.children.length > order.length) channelsBox.lastElementChild?.remove();
    } catch (error) {
      options.onError?.(error);
    }
  };

  const handle: MixerHandle = {
    element: root,
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe?.();
      releaseStrips();
      status.destroy();
      claim.release();
      root.remove();
      style?.remove();
    },
  };
  // Claim the host before destroying the previous mount: its cleanup may mount
  // a replacement, and that replacement must win.
  const claim = claimHost(mounted, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  if (!claim.isCurrent()) {
    // A re-entrant mount took the host while this one was appending; leave it
    // exactly as that mount left it.
    root.remove();
    style?.remove();
    return handle;
  }
  update();
  if (binding.subscribe) unsubscribe = binding.subscribe(update);
  return handle;
}
