import {mountMixer, type MixerBinding, type MixerHandle} from "@webmusic/ui/mixer";
import {createRack, type Rack} from "../headless/rack";
import type {Effect} from "../headless/effects";
import {
  RACK_PART_EVENT,
  RACK_SHARE_EVENT,
  isRackPart,
  type RackPartDeclaration,
  type RackPartElementLike,
  type RackShareDetail,
} from "./internal/rack-part";
import {boolAttr, WebMusicElement, upgradeProperties} from "./internal/base";

const STYLE = `
:host { display:block; box-sizing:border-box; inline-size:100%; min-inline-size:0; max-inline-size:100%; }
:host([hidden]) { display:none; }
[part~="rack-control-root"] {
  box-sizing:border-box;
  background:var(--wm-rack-control-surface-background,var(--wm-mixer-surface-background,var(--wm-component-background,var(--wm-mixer-background,var(--wm-surface,#fff)))));
  border:var(--wm-rack-control-surface-border,var(--wm-mixer-surface-border,var(--wm-component-border,1px solid var(--rc-border,var(--wm-mixer-border,var(--wm-border,#d8d8d8))))));
  padding:var(--wm-rack-control-surface-padding,var(--wm-mixer-surface-padding,var(--wm-component-padding,var(--wm-mixer-padding,.6rem))));
  border-radius:var(--wm-rack-control-surface-radius,var(--wm-mixer-surface-radius,var(--wm-component-radius,var(--wm-mixer-radius,var(--wm-control-radius,0)))));
}
/* Feed the strip's own tokens rather than setting properties on it: the shared
   fader paints its track with inline geometry so it is correct in a light-DOM
   host, and an inline style beats any rule here. */
[part~="rack-control-fader"] { --wm-fader-width:var(--rc-fader-width,var(--wm-mixer-fader-width,2rem)); --wm-fader-height:var(--rc-fader-height,var(--wm-mixer-fader-height,96px)); --wm-fader-track-border:var(--rc-track-border,var(--wm-mixer-track-border,var(--wm-control-border,var(--wm-border,#d8d8d8)))); --wm-fader-track:var(--rc-track,var(--wm-mixer-track,var(--wm-surface-muted,#f3f3f3))); --wm-fader-radius:var(--rc-radius,var(--wm-mixer-radius,var(--wm-control-radius,0))); }
[part~="rack-control-input"] { --wm-fader-fill:var(--rc-fill,var(--wm-mixer-fill,var(--wm-accent,#999))); --wm-fader-thumb:var(--rc-thumb,var(--wm-mixer-thumb,var(--wm-foreground,#111))); --wm-fader-handle:var(--rc-handle,var(--wm-mixer-handle,.7rem)); }
[part~="rack-control-label"] { color:var(--rc-text,var(--wm-mixer-text,var(--wm-foreground,#444))); }
`;

export interface RackControlErrorDetail { operation: "rack-control"; error: unknown; }

/**
 * The mixing desk for a {@link Rack}, and the place that rack is written.
 *
 * ```html
 * <score-player>                     <!-- the transport -->
 *   <rack-control></rack-control>    <!-- the desk over the same rack -->
 * </score-player>
 * ```
 *
 * A rack member is HEADLESS — a score and a sound, and the rack builds the
 * `ScorePlayer` that plays it — but it can be written down. `<rack-part>`
 * declares one, and this element turns the parts inside it into members. A rack
 * assigned to `.rack` works the same way and needs no markup at all.
 *
 * Nesting the desk inside a player is the other DOM relationship: it announces
 * its rack upward, and that player becomes the group's only transport with no
 * wiring step.
 *
 * The rack is the single source of truth. Levels are read back from it rather
 * than mirrored here, and `.rack` takes one from script — an assigned rack is
 * adopted and never disposed, while one this element created is disposed with
 * it.
 *
 * Its own attributes are about what the desk SHOWS: `master`, `mute` and
 * `solo` each add or take away a control, which is the only thing a mixing
 * surface has to configure that is not a property of the rack behind it.
 */
export class RackControlElement extends WebMusicElement {
  static get observedAttributes(): string[] {
    return ["master", "mute", "solo"];
  }

  private root?: ShadowRoot;
  private handle?: MixerHandle;
  private compatibilityStyle?: HTMLStyleElement;
  private observer?: MutationObserver;
  private assignedRack?: Rack;
  private ownedRack?: Rack;
  private assignedEffect?: Effect;
  /** Distinguish "never assigned" from an explicit `.effect = undefined`. */
  private effectAssigned = false;
  private notifyMembers?: () => void;
  private unsubscribeMembers?: () => void;
  /**
   * What each child element last declared. Child identity matters: its `id`
   * can change while the score/sound declaration — and live Rack member — stay
   * the same.
   */
  private readonly declared = new Map<RackPartElementLike, RackPartDeclaration>();

  protected override onMount(): void {
    this.own(() => { this.handle?.destroy(); this.handle = undefined; });
    this.own(() => { this.unsubscribeMembers?.(); this.unsubscribeMembers = undefined; });
    this.own(() => { this.observer?.disconnect(); this.observer = undefined; });
    this.own(() => this.releaseRack());
    upgradeProperties(this, ["rack", "effect"]);
    if (!this.root) this.root = this.attachShadow({mode: "open"});

    // Parts arrive and leave as markup, and each nudges upward when its own
    // score resolves — which happens long after it was appended.
    if (!this.observer && typeof MutationObserver !== "undefined") {
      this.observer = new MutationObserver(() => this.reconcile());
      this.observer.observe(this, {childList: true});
    }
    this.addEventListener(RACK_PART_EVENT, this.onPartChanged);
    this.own(() => this.removeEventListener(RACK_PART_EVENT, this.onPartChanged));

    // A rack assigned BEFORE connection took the early return in the setter, so
    // the subscription is (re)made here rather than only where it changes.
    this.subscribeMembers();
    this.mountUI();
    this.reconcile();
    this.announce();
  }

  /**
   * A rack handed over from script. It replaces one this element created, and
   * is never disposed here — the caller who built it keeps that right.
   */
  private readonly onPartChanged = (): void => { this.reconcile(); };

  set rack(rack: Rack | undefined) {
    if (rack === this.assignedRack) return;
    this.assignedRack = rack;
    this.declared.clear();
    if (rack && this.ownedRack) { this.ownedRack.dispose(); this.ownedRack = undefined; }
    if (rack && this.effectAssigned) {
      try { rack.setEffect(this.assignedEffect); }
      catch (error) { this.reportError(error); }
    }
    if (this.isConnected) {
      this.subscribeMembers();
      this.reconcile();
      this.announce();
      this.notifyMembers?.();
    }
  }

  get rack(): Rack | undefined {
    return this.assignedRack ?? this.ownedRack;
  }

  /**
   * Rack-level post-processing on the summed master output.
   *
   * This is the same reusable {@link Effect} recipe accepted by
   * `<score-player>`. An assigned rack is borrowed, but assigning this
   * property deliberately updates that rack's master effect in place.
   */
  set effect(effect: Effect | undefined) {
    const rack = this.rack;
    if (rack) {
      try { rack.setEffect(effect); }
      catch (error) {
        // Keep the last successfully applied recipe authoritative. The throw
        // lets a controller roll its pending UI back; the event keeps the
        // component's existing observable error channel intact.
        this.reportError(error);
        throw error;
      }
    }
    this.effectAssigned = true;
    this.assignedEffect = effect;
  }

  get effect(): Effect | undefined {
    const rack = this.rack;
    return rack ? rack.effect : this.assignedEffect;
  }

  /** The rack to build into: whatever was assigned, else one of our own. */
  private ensureRack(): Rack | undefined {
    if (this.assignedRack) return this.assignedRack;
    if (!this.ownedRack) {
      try {
        this.ownedRack = createRack(
          this.effectAssigned ? {effect: this.assignedEffect} : {},
        );
      }
      catch (error) { this.reportError(error); return undefined; }
      this.subscribeMembers();
      this.announce();
    }
    return this.ownedRack;
  }

  private releaseRack(): void {
    this.declared.clear();
    const owned = this.ownedRack;
    this.ownedRack = undefined;
    try { owned?.dispose(); } catch (error) { this.reportError(error); }
  }

  private subscribeMembers(): void {
    this.unsubscribeMembers?.();
    const rack = this.rack;
    if (!rack) { this.unsubscribeMembers = undefined; return; }
    // Both: membership decides which faders exist, the mix decides where they
    // sit. Anything else driving the rack — a strip beside this desk, a script
    // — repaints these faders instead of leaving them showing a stale position.
    const stops = [
      rack.on("memberschange", () => this.notifyMembers?.()),
      rack.on("mixchange", () => this.notifyMembers?.()),
    ];
    this.unsubscribeMembers = () => { for (const stop of stops) stop(); };
  }

  /** Tell an ancestor player which rack to drive. */
  private announce(): void {
    this.dispatchEvent(
      new CustomEvent<RackShareDetail>(RACK_SHARE_EVENT, {
        detail: {rack: this.rack},
        bubbles: true,
        composed: true,
      }),
    );
  }

  /**
   * Bring the rack in line with the parts declared inside this element.
   *
   * `Rack.add` on an existing id is a DESTRUCTIVE replace — it disposes the
   * live player and re-appends the member. A child whose declaration identity
   * is unchanged is renamed in place; it is only re-added when its score or
   * sound actually changed.
   */
  private reconcile(): void {
    const declarations: Array<{part: RackPartElementLike; declaration: RackPartDeclaration}> = [];
    for (const part of Array.from(this.children).filter(isRackPart)) {
      try {
        const declaration = part.rackPartDeclaration();
        if (declaration) declarations.push({part, declaration});
      } catch (error) { this.reportError(error); }
    }
    if (declarations.length === 0 && this.declared.size === 0) return;

    const rack = this.ensureRack();
    if (!rack) return;

    // A part that no longer resolves a declaration (or left the desk) no
    // longer owns a member. Remove these first so their ids are available to
    // parts added in the same DOM mutation.
    const present = new Set(declarations.map(({part}) => part));
    for (const [part, previous] of [...this.declared]) {
      if (present.has(part)) continue;
      this.declared.delete(part);
      try { rack.remove(previous.id); } catch (error) { this.reportError(error); }
    }

    // Never let two elements with the same desired id destructively replace
    // one another. Keep their last valid members intact until the markup is
    // made unambiguous, and surface the invalid declaration to the host.
    const counts = new Map<string, number>();
    for (const {declaration} of declarations) {
      counts.set(declaration.id, (counts.get(declaration.id) ?? 0) + 1);
    }
    const duplicateIds = new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
    for (const id of duplicateIds) {
      this.reportError(new Error(`More than one <rack-part> declares id "${id}".`));
    }

    const currentOwner = new Map<string, RackPartElementLike>();
    for (const [part, declaration] of this.declared) currentOwner.set(declaration.id, part);

    for (const {part, declaration} of declarations) {
      if (duplicateIds.has(declaration.id)) continue;
      const previous = this.declared.get(part);
      if (
        previous &&
        previous.id === declaration.id &&
        previous.score === declaration.score &&
        previous.sound === declaration.sound
      ) continue;

      // A unique desired declaration can still point at another child's last
      // valid id (for example, halfway through editing two names). Do not use
      // destructive Rack.add or let Rack.rename collide with that member.
      const owner = currentOwner.get(declaration.id);
      if (owner && owner !== part) {
        this.reportError(new Error(`Rack member id "${declaration.id}" is already declared.`));
        continue;
      }

      try {
        const sameIdentity = previous &&
          previous.score === declaration.score &&
          previous.sound === declaration.sound;
        if (previous && previous.id !== declaration.id && sameIdentity) {
          rack.rename(previous.id, declaration.id);
        } else {
          rack.add({
            id: declaration.id,
            score: declaration.score,
            ...(declaration.sound ? {sound: declaration.sound} : {}),
          });
          // A simultaneous id + score/sound change is a true replacement, but
          // it must also remove the obsolete old-id member after the new one
          // has been constructed successfully.
          if (previous && previous.id !== declaration.id) rack.remove(previous.id);
        }
        if (previous) currentOwner.delete(previous.id);
        currentOwner.set(declaration.id, part);
        this.declared.set(part, declaration);
      } catch (error) { this.reportError(error); }
    }
  }

  /**
   * The rack's members, in the order the parts were WRITTEN.
   *
   * `Rack` appends, and parts resolve their scores over the network, so the
   * rack's own order is whichever file came back first — three parts written
   * lead, bass, pad can end up drawn lead, pad, bass. Order is a view concern
   * and the rack has no reordering API, so the desk sorts rather than the rack
   * being made to. A member with no part of its own (one that came in on an
   * assigned rack) keeps its rack position, after the declared ones.
   */
  private inWrittenOrder<T extends {id: string}>(members: readonly T[]): T[] {
    const written = new Map<string, number>();
    for (const child of Array.from(this.children)) {
      if (!isRackPart(child)) continue;
      const declaration = child.rackPartDeclaration();
      if (declaration) written.set(declaration.id, written.size);
    }
    if (written.size === 0) return [...members];
    const place = (member: T, index: number) => written.get(member.id) ?? written.size + index;
    return [...members]
      .map((member, index) => ({member, at: place(member, index)}))
      .sort((a, b) => a.at - b.at)
      .map(({member}) => member);
  }

  protected createMixerBinding(): MixerBinding {
    return {
      // Rendered FROM the rack, not from a copy: a member's level is readable
      // now, so nothing here can drift from the gain node it controls.
      snapshot: () => {
        const rack = this.rack;
        const members = this.inWrittenOrder(rack?.list() ?? []);
        return {
          master: rack?.masterVolume ?? 1,
          channels: members.map((member) => ({
            id: member.id,
            label: member.id,
            value: member.volume,
            muted: member.muted,
            solo: member.solo,
          })),
          disabled: !rack,
        };
      },
      setMaster: (value) => { this.rack?.setMasterVolume(value); },
      setChannel: (id, value) => { this.rack?.setVolume(id, value); },
      ...(boolAttr(this, "mute", true) ? {setMuted: (id: string, muted: boolean) => { this.rack?.mute(id, muted); }} : {}),
      // Mute and solo appear only when the binding can act on them, so the
      // attributes that show them are spelled as the commands being present.
      // The presenter's solo is EXCLUSIVE and clears with `null`, while the
      // rack's is per member — so the desk translates rather than forwarding a
      // null id the rack would silently ignore.
      ...(boolAttr(this, "solo", true)
        ? {
            setSolo: (id: string | null) => {
              const rack = this.rack;
              if (!rack) return;
              for (const member of rack.list()) rack.solo(member.id, member.id === id);
            },
          }
        : {}),
      subscribe: (notify) => {
        this.notifyMembers = notify;
        return () => { this.notifyMembers = undefined; };
      },
    };
  }

  protected mountMixerUI(root: ShadowRoot, binding: MixerBinding): MixerHandle {
    const handle = mountMixer(root, binding, {
      parts: {
        root: "rack-control-root",
        fader: "rack-control-fader",
        input: "rack-control-input",
        label: "rack-control-label",
      },
      master: boolAttr(this, "master", true),
      onError: (error) => this.reportError(error),
    });
    this.appendStyle(root);
    return handle;
  }

  protected reportError(error: unknown): void {
    this.dispatchEvent(new CustomEvent<RackControlErrorDetail>("webscore:error", {detail: {operation: "rack-control", error}, bubbles: true, composed: true}));
  }

  attributeChangedCallback(): void {
    // Each of these decides whether a control EXISTS, which the presenter
    // settles at mount — so the surface is rebuilt rather than repainted.
    if (this.isConnected) this.mountUI();
  }

  private mountUI(): void {
    this.handle?.destroy();
    if (!this.root) return;
    try {
      // The parts render first and the desk under them, so the faders sit
      // beneath the things they are mixing.
      this.root.replaceChildren(this.root.ownerDocument.createElement("slot"));
      this.handle = this.mountMixerUI(this.root, this.createMixerBinding());
    } catch (error) { this.reportError(error); }
  }

  private appendStyle(root: ShadowRoot): void {
    if (!this.compatibilityStyle) { this.compatibilityStyle = root.ownerDocument.createElement("style"); this.compatibilityStyle.textContent = STYLE; }
    root.append(this.compatibilityStyle);
  }
}

export function defineRackControlElement(tag = "rack-control"): void {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) customElements.define(tag, RackControlElement);
}
