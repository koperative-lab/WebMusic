import {claimHost} from './internal/lifecycle';
import {installStyle} from "./internal/style";
import {addClassNames, setParts} from './internal/dom';
import {componentSurfaceCss} from './internal/surface';
// ============================================================================
// Domain-neutral compound panel presenter.
//
// The presenter owns the panel stylesheet and the section/slot skeleton. A
// caller mounts specialized presenters into the returned slots; it never has
// to manufacture wrapper DOM or depend on the panel's private markup.
// ============================================================================

export interface SectionPanelSection {
  /** Stable section identifier used by `handle.slot(id)`. */
  id: string;
  /** Optional accessible name for the semantic section. */
  label?: string;
  classNames?: {
    section?: string;
    slot?: string;
  };
  parts?: {
    section?: string;
    slot?: string;
  };
}

export interface SectionPanelClassNames {
  root?: string;
  section?: string;
  slot?: string;
}

export interface SectionPanelParts {
  root?: string;
  section?: string;
  slot?: string;
}

export interface SectionPanelOptions {
  label?: string;
  classNames?: SectionPanelClassNames;
  parts?: SectionPanelParts;
  /**
   * Optional caller compatibility rules installed in the presenter-owned
   * stylesheet after the canonical panel rules.
   */
  styleText?: string;
  /** Install the exported stylesheet into the host. Defaults to true. */
  stylesheet?: boolean;
}

export interface SectionPanelHandle {
  element: HTMLElement;
  /** Stable slot lookup; unknown identifiers return `undefined`. */
  slot(id: string): HTMLElement | undefined;
  /** All slots in the same order as the normalized section list. */
  readonly slots: ReadonlyMap<string, HTMLElement>;
  destroy(): void;
}

type SectionPanelHost = HTMLElement | ShadowRoot;

const mountedPanels = new WeakMap<SectionPanelHost, SectionPanelHandle>();

export const sectionPanelStyle = String.raw`
.wui-section-panel,
.wui-section-panel * { box-sizing: border-box; }
.wui-section-panel {
${componentSurfaceCss('panel', {
  padding: 'var(--wm-panel-padding, .6rem)',
  border: 'var(--wm-panel-border, 1px solid var(--wm-border, #d8d8d8))',
  radius: 'var(--wm-panel-radius, var(--wm-control-radius, 0))',
  background: 'var(--wm-panel-background, var(--wm-surface, #fff))',
})}
  display: flex;
  flex-direction: column;
  gap: var(--wm-panel-gap, .7rem);
  min-width: 0;
  max-width: 100%;
  color: var(--wm-panel-foreground, var(--wm-foreground, #444));
  font: var(--wm-panel-font, .8rem var(--wm-font-family, system-ui, sans-serif));
}
.wui-section-panel__section,
.wui-section-panel__slot { display: block; min-width: 0; max-width: 100%; overflow-wrap: anywhere; }
`;

function normalizeSections(
  sections: readonly (SectionPanelSection | string)[],
): SectionPanelSection[] {
  const seen = new Set<string>();
  const normalized: SectionPanelSection[] = [];
  for (const section of sections) {
    const descriptor = typeof section === "string" ? {id: section} : section;
    const id = String(descriptor.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push({...descriptor, id});
  }
  return normalized;
}

/** Mount a panel skeleton whose section slots are owned by this presenter. */
export function mountSectionPanel(
  host: SectionPanelHost,
  sections: readonly (SectionPanelSection | string)[],
  options: SectionPanelOptions = {},
): SectionPanelHandle {
  const document = host.ownerDocument;
  const style = installStyle(
    document,
    "panel",
    `${sectionPanelStyle}${options.styleText ? `\n${options.styleText}` : ""}`,
    options.stylesheet,
  );

  const root = document.createElement("div");
  root.className = "wui-section-panel";
  addClassNames(root, options.classNames?.root);
  setParts(root, "root", options.parts?.root);
  if (options.label) {
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", options.label);
  }

  const slots = new Map<string, HTMLElement>();
  for (const descriptor of normalizeSections(sections)) {
    const section = document.createElement("section");
    section.className = "wui-section-panel__section";
    section.dataset.section = descriptor.id;
    addClassNames(section, options.classNames?.section);
    addClassNames(section, descriptor.classNames?.section);
    setParts(
      section,
      "section",
      options.parts?.section,
      descriptor.parts?.section,
    );
    if (descriptor.label) section.setAttribute("aria-label", descriptor.label);

    const slot = document.createElement("div");
    slot.className = "wui-section-panel__slot";
    slot.dataset.slot = descriptor.id;
    addClassNames(slot, options.classNames?.slot);
    addClassNames(slot, descriptor.classNames?.slot);
    setParts(slot, "slot", options.parts?.slot, descriptor.parts?.slot);
    section.append(slot);
    root.append(section);
    slots.set(descriptor.id, slot);
  }

  let destroyed = false;
  const handle: SectionPanelHandle = {
    element: root,
    slots,
    slot: (id) => slots.get(id),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      claim.release();
      root.remove();
      style?.remove();
    },
  };
  // Claim the host before destroying the previous mount: its cleanup may mount
  // a replacement, and that replacement must win.
  const claim = claimHost(mountedPanels, host, handle);
  claim.destroyPrevious();
  if (!claim.isCurrent()) return handle;

  host.append(...(style ? [style] : []), root);
  return handle;
}
