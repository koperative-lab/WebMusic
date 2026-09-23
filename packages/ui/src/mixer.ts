import {claimHost, createErrorSink, createUpdateLoop, runCleanups} from './internal/lifecycle';
import {createFader, faderStyle} from './fader';
import {installStyle} from './internal/style';
import {addClassNames, clamp01, setParts} from './internal/dom';
import {componentSurfaceCss, controlBorderFallback} from './internal/surface';
import {controlHeight, controlRadius} from './internal/control';
import {formatPercent, readText, textValue, type UITextValue, type UIValueFormatters} from './text';

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
}

export type MixerParts = MixerClassNames;

export interface MixerText {
  master?: string;
  channels?: string;
  volume?: UITextValue<{label: string}>;
  mute?: UITextValue<{label: string}>;
  solo?: UITextValue<{label: string}>;
  muteText?: string;
  soloText?: string;
  play?: string;
  pause?: string;
  stop?: string;
}

export interface MixerOptions {
  /** Read application-provided text on each update. */
  getText?: () => MixerText;
  formatters?: UIValueFormatters;
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

export const mixerStyle = faderStyle + `
:where(.wui-mixer) {
${componentSurfaceCss('mixer', {
  padding: 'var(--wm-mixer-padding, .6rem)',
  border: '1px solid var(--wm-mixer-border, var(--wm-border, #d8d8d8))',
  radius: 'var(--wm-mixer-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-mixer-background, var(--wm-surface, #fff))',
})}
inline-size:100%; min-inline-size:0; max-inline-size:100%; color:var(--wm-mixer-text,var(--wm-foreground,#444)); font:.8rem/1.35 var(--wm-font-family,var(--wm-font,system-ui,sans-serif)); }
:where(.wui-mixer__board,.wui-mixer__channels) { display:flex; gap:.75rem; align-items:flex-start; min-inline-size:0; }
:where(.wui-mixer__transport) { display:flex; flex-wrap:wrap; gap:.35rem; margin-bottom:.65rem; }
/* Leave room inside the scroller for the shared fader's focus outline. */
:where(.wui-mixer__channels) { box-sizing:border-box; overflow-x:auto; flex:1 1 auto; padding:.3rem .3rem .5rem; }
:where(.wui-mixer__strip) { display:flex; flex-direction:column; align-items:center; gap:.45rem; flex:0 0 auto; min-inline-size:4.5rem; }
:where(.wui-mixer__master) { padding-block-start:.3rem; }
:where(.wui-mixer__master .wui-mixer__label) { font-weight:700; }
:where(.wui-mixer__label) { font-size:.8rem; color:inherit; max-inline-size:7rem; min-block-size:2.7em; overflow-wrap:anywhere; text-align:center; }
:where(.wui-mixer__actions) { display:flex; gap:.25rem; }
:where(.wui-mixer__button) { appearance:none; box-sizing:border-box; display:inline-flex; align-items:center; justify-content:center; border:1px solid var(--wm-mixer-button-border,var(--wm-mixer-border,${controlBorderFallback})); background:var(--wm-mixer-button,var(--wm-surface,#fff)); color:var(--wm-mixer-text,var(--wm-foreground,#444)); font:inherit; min-inline-size:2rem; min-block-size:${controlHeight('mixer')}; padding:.25rem; border-radius:${controlRadius('mixer')}; cursor:pointer; }
:where(.wui-mixer__button[aria-pressed="true"]) { background:var(--wm-mixer-fill,var(--wm-accent,#111)); color:var(--wm-mixer-active-text,var(--wm-accent-foreground,#fff)); }
:where(.wui-mixer__button:focus-visible,.wui-mixer__channels:focus-visible) { outline:2px solid var(--wm-focus,var(--wm-foreground,#111)); outline-offset:2px; }
:where(.wui-mixer__button:disabled) { opacity:.45; cursor:default; }
:where(.wui-mixer__fader) { display:block; }
/* The strip's own tokens, handed to the shared fader that paints the track. */
:where(.wui-mixer__input) { --wm-fader-width:var(--wm-mixer-fader-width,2rem); --wm-fader-height:var(--wm-mixer-fader-height,96px); --wm-fader-track:var(--wm-mixer-track,var(--wm-surface-muted,#f3f3f3)); --wm-fader-track-border:var(--wm-mixer-track-border,${controlBorderFallback}); --wm-fader-fill:var(--wm-mixer-fill,var(--wm-accent,#999)); --wm-fader-thumb:var(--wm-mixer-thumb,var(--wm-foreground,#111)); --wm-fader-handle:var(--wm-mixer-handle,.7rem); --wm-fader-radius:var(--wm-mixer-radius,var(--wm-control-radius,0)); }
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
  let ownsHost = false;
  let unsubscribe: (() => void) | undefined;
  let texts: MixerText | undefined;
  const report = createErrorSink(options.onError);
  const command = (work: () => Promise<void> | void): void => {
    if (destroyed) return;
    try {
      void Promise.resolve(work()).then(update, (error) => {
        if (!destroyed) report(error);
      });
    } catch (error) {
      if (!destroyed) report(error);
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
      label: textValue(texts?.volume, `${initial.label} volume`, {label: initial.label}, options.onError),
      formatValue: (value) => formatPercent(ownsHost ? options.formatters : undefined, value, undefined, options.onError),
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
      onError: report,
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
      }
      control.updateLabel(textValue(texts?.volume, `${channel.label} volume`, {label: channel.label}, options.onError));
      if (destroyed) return;
      control.paint(clamp01(channel.value), disabled);
      if (destroyed) return;
      if (mute) {
        mute.disabled = disabled;
        mute.textContent = textValue(texts?.muteText, 'M', {}, options.onError);
        mute.setAttribute("aria-label", textValue(texts?.mute, `Mute ${channel.label}`, {label: channel.label}, options.onError));
        mute.setAttribute("aria-pressed", String(channel.muted === true));
      }
      if (solo) {
        solo.disabled = disabled;
        solo.textContent = textValue(texts?.soloText, 'S', {}, options.onError);
        solo.setAttribute("aria-label", textValue(texts?.solo, `Solo ${channel.label}`, {label: channel.label}, options.onError));
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
  const actionButtons: Array<{button: HTMLButtonElement; kind: MixerAction; label: string}> = [];
  const action = (
    kind: MixerAction,
    label: string,
    text: string,
    work: (() => Promise<void> | void) | undefined,
  ): void => {
    if (!work) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `wui-mixer__button t-${kind}`;
    addClassNames(button, options.classNames?.button);
    addClassNames(button, options.classNames?.[kind]);
    setParts(button, ["button", kind], options.parts?.button, options.parts?.[kind]);
    button.setAttribute("aria-label", textValue(texts?.[kind], label, {}, options.onError));
    button.textContent = text;
    button.addEventListener("click", () => command(work));
    actionButtons.push({button, kind, label});
    transport.append(button);
  };
  action("play", "Play", "▶", binding.play);
  action("pause", "Pause", "⏸", binding.pause);
  action("stop", "Stop", "⏹", binding.stop);

  const board = document.createElement("div");
  board.className = "wui-mixer__board board";
  addClassNames(board, options.classNames?.board);
  setParts(board, ["board"], options.parts?.board);
  const channelsBox = document.createElement("div");
  channelsBox.className = "wui-mixer__channels strips";
  channelsBox.tabIndex = 0;
  channelsBox.setAttribute("role", "group");
  channelsBox.setAttribute("aria-label", textValue(texts?.channels, 'Mixer channels', {}, options.onError));
  addClassNames(channelsBox, options.classNames?.channels);
  setParts(channelsBox, ["channels"], options.parts?.channels);
  const showMaster = options.master !== false;
  const masterStrip = showMaster ? createStrip({id: "master", label: textValue(texts?.master, 'master', {}, options.onError), value: 0}, true) : undefined;
  board.append(...(masterStrip ? [masterStrip.element] : []), channelsBox);
  root.replaceChildren(...(transport.childNodes.length ? [transport, board] : [board]));

  const strips = new Map<string, Strip>();
  const paintSnapshot = (): void => {
    if (destroyed) return;
    try {
      const state = binding.snapshot();
      if (destroyed || !claim.isCurrent()) return;
      texts = readText(options.getText, options.onError);
      if (destroyed || !claim.isCurrent()) return;
      const disabled = state.disabled === true;
      channelsBox.tabIndex = state.channels.length ? 0 : -1;
      channelsBox.setAttribute('aria-label', textValue(texts?.channels, 'Mixer channels', {}, options.onError));
      for (const {button, kind, label} of actionButtons) {
        button.disabled = disabled;
        button.setAttribute('aria-label', textValue(texts?.[kind], label, {}, options.onError));
      }
      masterStrip?.paint({id: "master", label: textValue(texts?.master, 'master', {}, options.onError), value: state.master}, disabled);
      if (destroyed || !claim.isCurrent()) return;

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
          if (destroyed || !claim.isCurrent()) {
            runCleanups([strip.destroy], report);
            return;
          }
          strips.set(key, strip);
        }
        strip.paint(merged, merged.disabled);
        if (destroyed || !claim.isCurrent()) return;
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
      report(error);
    }
  };

  const updateLoop = createUpdateLoop({
    name: 'Mixer', pass: paintSnapshot,
    isCurrent: () => !destroyed && claim.isCurrent(), report,
  });
  const update = (): void => updateLoop.run();

  const handle: MixerHandle = {
    element: root,
    update,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ownsHost = false;
      updateLoop.cancel();
      const stop = unsubscribe;
      unsubscribe = undefined;

      const ownedStrips = [...strips.values()];
      strips.clear();
      runCleanups([
        stop,
        ...ownedStrips.map((strip) => () => strip.destroy()),
        () => masterStrip?.destroy(),
        () => claim.release(),
        () => root.remove(),
        () => style?.remove(),
      ], report);
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
  ownsHost = true;
  update();
  if (destroyed || !claim.isCurrent()) return handle;
  if (binding.subscribe) {
    try {
      const stop = binding.subscribe(update);
      // A synchronous notification may destroy or replace this mount before
      // registration returns its disposer. Do not retain that late resource.
      if (destroyed || !claim.isCurrent()) runCleanups([stop], report);
      else unsubscribe = stop;
    } catch (error) {
      report(error);
    }
  }

  return handle;
}
