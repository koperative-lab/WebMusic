// The one type switch an Element demo may carry (DEC-071). It writes the
// catalog's `switch` attribute — `type`, or the element's equivalent such as
// `layout` — on every instance of the demo's tag, and mirrors the attribute
// back, so a change made by the element itself keeps the switch truthful.
import type {DemoScope} from './demo-lifecycle';

const LABELS: Readonly<Record<string, string>> = {vu: 'VU'};

/** Button caption for one attribute value: `piano-roll` → `Piano roll`. */
export function typeLabel(value: string): string {
  const known = LABELS[value];
  if (known) return known;
  const words = value.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The value an absent attribute resolves to, read from the catalog fallback,
 * whose first word names it (`vu — needle dial…`, `piano-roll`). Undefined when
 * the fallback names none of the options.
 */
export function defaultType(options: readonly string[], fallback: string | undefined): string | undefined {
  const first = fallback?.trim().split(/[\s—;,:(]/)[0];
  return options.find((option) => option === first);
}

/** Bind one `[data-pg-types]` group to the instances of its demo's tag. */
export function bindTypeSwitch(group: HTMLElement, scope: DemoScope): void {
  const panel = group.closest<HTMLElement>('[data-wm-pg]');
  const stage = panel?.querySelector<HTMLElement>('[data-pg-stage]');
  const attribute = group.dataset.pgTypes;
  const tag = panel?.dataset.pgTag;
  if (!panel || !stage || !attribute || !tag) return;
  const fallback = group.dataset.pgDefault;
  const buttons = [...group.querySelectorAll<HTMLButtonElement>('button[data-value]')];
  const targets = (): Element[] => [...stage.querySelectorAll(tag)];

  const sync = (): void => {
    const current = targets()[0]?.getAttribute(attribute) ?? fallback;
    for (const button of buttons) {
      const pressed = button.dataset.value === current;
      button.setAttribute('aria-pressed', String(pressed));
      button.dataset.on = String(pressed);
    }
  };

  for (const button of buttons) {
    scope.listen(button, 'click', () => {
      const value = button.dataset.value;
      if (value === undefined) return;
      for (const target of targets()) {
        if (target.getAttribute(attribute) !== value) target.setAttribute(attribute, value);
      }
      sync();
    });
  }

  const observer = new MutationObserver(sync);
  observer.observe(stage, {subtree: true, childList: true, attributes: true, attributeFilter: [attribute]});
  scope.add(() => observer.disconnect());
  sync();
}
