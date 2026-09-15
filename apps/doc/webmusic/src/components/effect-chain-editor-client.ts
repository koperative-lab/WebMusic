import {
  buildPlaygroundEffect,
  buildPlaygroundEffects,
  createEffectItem,
  effectDefinition,
  effectSetupCode,
  effectSummary,
  normalizeEffectValue,
  type PlaygroundEffectItem,
} from '../lib/effect-playground';
import {PLAYGROUND_RESET_EVENT} from './playground-client';

type EffectControl = HTMLInputElement | HTMLSelectElement;
type EffectTarget = HTMLElement & {
  effect?: ReturnType<typeof buildPlaygroundEffect>;
  effects?: ReturnType<typeof buildPlaygroundEffects>;
  stop?: () => void;
};

type EffectAssignment = 'effect' | 'effects';

/**
 * Mount one target-agnostic effect-chain editor.
 *
 * The editor requires either the usual singular `.effect` chain property or
 * the flat `.effects` array exposed by `<synth-panel>`. The owning demo declares
 * which stage element that is, so the controller stays component-agnostic.
 */
function mountEffectChainEditor(editor: HTMLElement): void {
  if (editor.dataset.fxWired === '1') return;

  const panel = editor.closest<HTMLElement>('[data-wm-pg]');
  const stage = panel?.querySelector<HTMLElement>('[data-pg-stage]');
  const queryStage = <T extends Element>(selector: string | undefined): T | undefined => {
    if (!selector) return undefined;
    try {
      return stage?.querySelector<T>(selector) ?? undefined;
    } catch {
      // A malformed demo selector disables this editor, not every editor that
      // follows it on the page.
      return undefined;
    }
  };
  const targetSelector = editor.dataset.fxTarget || panel?.dataset.target;
  const target = queryStage<EffectTarget>(targetSelector);
  const stopSelector = editor.dataset.fxStopTarget;
  const stopTarget = stopSelector
    ? queryStage<EffectTarget>(stopSelector)
    : target;
  const setupSelector = editor.dataset.fxSetupSelector || targetSelector || 'score-player';
  const setupIdentifier = editor.dataset.fxSetupIdentifier || 'target';
  const assignment: EffectAssignment = editor.dataset.fxAssignment === 'effects'
    ? 'effects'
    : 'effect';
  const initialKinds = (editor.dataset.fxInitial ?? '')
    .split(',')
    .map((kind) => kind.trim())
    .filter((kind) => effectDefinition(kind) !== undefined);
  const list = editor.querySelector<HTMLElement>('[data-fx-list]');
  const kindControl = editor.querySelector<HTMLSelectElement>('[data-fx-kind]');
  const addButton = editor.querySelector<HTMLButtonElement>('[data-fx-add]');
  const count = editor.querySelector<HTMLElement>('[data-fx-count]');
  const empty = editor.querySelector<HTMLElement>('[data-fx-empty]');
  const status = editor.querySelector<HTMLElement>('[data-fx-status]');
  const codeBlock = panel?.querySelector<HTMLElement>('[data-fx-code-block]');
  const code = panel?.querySelector<HTMLElement>('[data-fx-code]');
  if (!panel || !target || !list || !kindControl || !addButton) return;

  editor.dataset.fxWired = '1';
  const initialKind = kindControl.options[0]?.value ?? '';
  kindControl.value = initialKind;

  let items: PlaygroundEffectItem[] = [];
  let keySerial = 0;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let statusRevision = 0;

  const say = (message: string): void => {
    if (!status) return;
    const revision = ++statusRevision;
    if (statusTimer !== undefined) clearTimeout(statusTimer);
    status.textContent = '';
    queueMicrotask(() => {
      if (revision !== statusRevision) return;
      status.textContent = message;
      statusTimer = setTimeout(() => {
        if (revision !== statusRevision) return;
        status.textContent = '';
        statusTimer = undefined;
      }, 3200);
    });
  };

  const cards = (): HTMLElement[] =>
    Array.from(list.querySelectorAll<HTMLElement>('[data-fx-card]'));

  const cardFor = (key: string): HTMLElement | undefined =>
    cards().find((card) => card.dataset.fxKey === key);

  const itemFor = (key: string): PlaygroundEffectItem | undefined =>
    items.find((item) => item.key === key);

  const updateCode = (): void => {
    const setup = effectSetupCode(items, {
      selector: setupSelector,
      identifier: setupIdentifier,
      assignment,
    });
    if (code) code.textContent = setup;
    if (codeBlock) codeBlock.hidden = setup === '';
  };

  const updateCard = (card: HTMLElement, item: PlaygroundEffectItem, index: number): void => {
    const definition = effectDefinition(item.kind);
    if (!definition) return;
    card.dataset.fxKey = item.key;
    const summary = card.querySelector<HTMLElement>('[data-fx-summary-meta]');
    if (summary) summary.textContent = effectSummary(item);

    const up = card.querySelector<HTMLButtonElement>('[data-fx-up]');
    const down = card.querySelector<HTMLButtonElement>('[data-fx-down]');
    const remove = card.querySelector<HTMLButtonElement>('[data-fx-remove]');
    if (up) {
      up.disabled = index === 0;
      up.setAttribute('aria-label', `Move ${definition.label} up`);
    }
    if (down) {
      down.disabled = index === items.length - 1;
      down.setAttribute('aria-label', `Move ${definition.label} down`);
    }
    remove?.setAttribute('aria-label', `Remove ${definition.label}`);
  };

  const updateCollection = (): void => {
    if (count) count.textContent = `${items.length} ${items.length === 1 ? 'effect' : 'effects'}`;
    if (empty) empty.hidden = items.length !== 0;
    items.forEach((item, index) => {
      const card = cardFor(item.key);
      if (card) updateCard(card, item, index);
    });
    updateCode();
  };

  const makeCard = (item: PlaygroundEffectItem): HTMLElement | null => {
    const template = editor.querySelector<HTMLTemplateElement>(
      `template[data-fx-template="${item.kind}"]`,
    );
    if (!template) return null;
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const card = fragment.querySelector<HTMLElement>('[data-fx-card]');
    if (!card) return null;
    card.dataset.fxKey = item.key;
    for (const control of card.querySelectorAll<EffectControl>('[data-fx-field]')) {
      const field = control.dataset.fxField;
      const value = field ? item.values[field] : undefined;
      if (value !== undefined) control.value = String(value);
    }
    return card;
  };

  const applyChain = (
    nextItems: PlaygroundEffectItem[],
    message?: string,
    commitDom?: () => void,
  ): boolean => {
    try {
      stopTarget?.stop?.();
      if (assignment === 'effects') target.effects = buildPlaygroundEffects(nextItems);
      else target.effect = buildPlaygroundEffect(nextItems);
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
      say(`Effects were not applied.${detail}`);
      return false;
    }
    items = nextItems;
    commitDom?.();
    updateCollection();
    if (message) say(message);
    return true;
  };

  const restoreInitial = (message?: string): boolean => {
    keySerial = 0;
    const nextItems = initialKinds.map((kind) =>
      createEffectItem(effectDefinition(kind)!.kind, `effect-${++keySerial}`));
    const nextCards = nextItems
      .map((item) => makeCard(item))
      .filter((card): card is HTMLElement => card !== null);
    return applyChain(nextItems, message, () => {
      kindControl.value = initialKind;
      list.replaceChildren(...nextCards);
    });
  };

  const reorderDom = (): void => {
    for (const item of items) {
      const card = cardFor(item.key);
      if (card) list.append(card);
    }
  };

  addButton.addEventListener('click', () => {
    const definition = effectDefinition(kindControl.value);
    if (!definition) return;
    const item = createEffectItem(definition.kind, `effect-${++keySerial}`);
    const card = makeCard(item);
    if (!card) {
      say(`${definition.label} could not be added.`);
      return;
    }
    const nextItems = [...items, item];
    if (!applyChain(nextItems, `Added ${definition.label}.`, () => list.append(card))) return;
    card.setAttribute('open', '');
    queueMicrotask(() => card.querySelector<HTMLElement>('[data-fx-summary]')?.focus());
  });

  editor.addEventListener('input', (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement)) return;
    if (!control.matches('[data-fx-field]')) return;
    if (control.checkValidity()) control.removeAttribute('aria-invalid');
    else control.setAttribute('aria-invalid', 'true');
    // Number fields can emit one event per keystroke. Only the committed
    // change below replaces the recipe, regardless of the target component.
  });

  editor.addEventListener('change', (event) => {
    const control = event.target;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) return;
    const field = control.dataset.fxField;
    const card = control.closest<HTMLElement>('[data-fx-card]');
    const key = card?.dataset.fxKey;
    const item = key ? itemFor(key) : undefined;
    const definition = item ? effectDefinition(item.kind) : undefined;
    if (!field || !card || !item || !definition) return;
    if (!control.checkValidity()) {
      control.setAttribute('aria-invalid', 'true');
      say(`Enter a valid ${field} value.`);
      return;
    }
    const value = normalizeEffectValue(definition, field, control.value);
    if (value === undefined) {
      control.setAttribute('aria-invalid', 'true');
      say(`Enter a valid ${field} value.`);
      return;
    }
    const previousValue = item.values[field];
    const nextItem = {...item, values: {...item.values, [field]: value}};
    const nextItems = items.map((candidate) => candidate.key === item.key ? nextItem : candidate);
    if (!applyChain(nextItems, `Updated ${definition.label}.`)) {
      if (previousValue !== undefined) control.value = String(previousValue);
      return;
    }
    control.removeAttribute('aria-invalid');
    control.value = String(value);
  });

  editor.addEventListener('click', (event) => {
    const clicked = event.target;
    if (!(clicked instanceof Element)) return;
    const button = clicked.closest<HTMLButtonElement>(
      '[data-fx-up], [data-fx-down], [data-fx-remove]',
    );
    if (!button || !editor.contains(button)) return;
    const card = button.closest<HTMLElement>('[data-fx-card]');
    const key = card?.dataset.fxKey;
    const index = key ? items.findIndex((item) => item.key === key) : -1;
    if (!card || index < 0) return;
    const item = items[index];
    const definition = effectDefinition(item.kind);
    if (!definition) return;

    if (button.matches('[data-fx-remove]')) {
      const before = cards();
      const cardIndex = before.indexOf(card);
      const focusTarget = before[cardIndex + 1] ?? before[cardIndex - 1];
      const nextItems = items.filter((candidate) => candidate.key !== item.key);
      if (!applyChain(nextItems, `Removed ${definition.label}.`, () => card.remove())) return;
      queueMicrotask(() => {
        const summary = focusTarget?.querySelector<HTMLElement>('[data-fx-summary]');
        (summary ?? addButton).focus();
      });
      return;
    }

    const offset = button.matches('[data-fx-up]') ? -1 : 1;
    const destination = index + offset;
    if (destination < 0 || destination >= items.length) return;
    const nextItems = [...items];
    [nextItems[index], nextItems[destination]] = [nextItems[destination], nextItems[index]];
    applyChain(
      nextItems,
      `Moved ${definition.label} ${offset < 0 ? 'up' : 'down'}.`,
      reorderDom,
    );
  });

  panel.addEventListener(PLAYGROUND_RESET_EVENT, () => {
    const assigned = assignment === 'effects' ? target.effects : target.effect;
    const hadEffects = items.length > 0 || (
      Array.isArray(assigned) ? assigned.length > 0 : assigned !== undefined
    );
    if (hadEffects || initialKinds.length > 0) {
      const message = initialKinds.length > 0
        ? 'Effects reset to the authored chain.'
        : 'Effects reset to dry output.';
      const reset = restoreInitial(message);
      if (!reset) return;
    } else {
      items = [];
      keySerial = 0;
      kindControl.value = initialKind;
      list.replaceChildren();
      updateCollection();
      say('Effects reset to dry output.');
    }
  });

  if (initialKinds.length > 0) restoreInitial();
  else updateCollection();
}

export function mountEffectChainEditors(): void {
  const editors = Array.from(
    document.querySelectorAll<HTMLElement>('[data-effect-chain-editor]'),
  );
  editors.forEach((editor) => mountEffectChainEditor(editor));
}
