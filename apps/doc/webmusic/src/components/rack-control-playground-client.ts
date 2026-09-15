import {
  PLAYGROUND_RESET_EVENT,
  PLAYGROUND_SYNC_EVENT,
} from './playground-client';

const PART_TAG = 'rack-part';
const PART_ATTRIBUTES = ['id', 'src', 'format', 'sound'] as const;
const DEFAULT_SOURCE = `${import.meta.env.BASE_URL}midi/demo.mid`;
const DEFAULT_SOUND = 'triangle';

type PartAttribute = (typeof PART_ATTRIBUTES)[number];
type ParamControl = HTMLInputElement | HTMLSelectElement;

interface PartSnapshot {
  key: string;
  attributes: Partial<Record<PartAttribute, string>>;
}

const directParts = (desk: HTMLElement): HTMLElement[] =>
  Array.from(desk.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.localName === PART_TAG,
  );

const partControls = (root: ParentNode): ParamControl[] =>
  Array.from(root.querySelectorAll<ParamControl>('[data-pg-attr]'));

const partForKey = (desk: HTMLElement, key: string): HTMLElement | undefined =>
  directParts(desk).find((part) => part.dataset.pgChildKey === key);

const scopeFor = (key: string): string => `[data-pg-child-key="${key}"]`;

function sourceLabel(src: string | null): string {
  return src || 'No source';
}

function snapshotPart(part: HTMLElement): PartSnapshot {
  const attributes: PartSnapshot['attributes'] = {};
  for (const name of PART_ATTRIBUTES) {
    const value = part.getAttribute(name);
    if (value !== null) attributes[name] = value;
  }
  return {key: part.dataset.pgChildKey ?? '', attributes};
}

function restorePart(document: Document, snapshot: PartSnapshot): HTMLElement {
  const part = document.createElement(PART_TAG);
  part.dataset.pgChildKey = snapshot.key;
  for (const name of PART_ATTRIBUTES) {
    const value = snapshot.attributes[name];
    if (value !== undefined) part.setAttribute(name, value);
  }
  return part;
}

function mountRackControlPlayground(collection: HTMLElement, ordinal: number): void {
  if (collection.dataset.rcWired === '1') return;

  const panel = collection.closest<HTMLElement>('[data-wm-pg]');
  const desk = panel?.querySelector<HTMLElement>('[data-rc-desk]');
  const list = collection.querySelector<HTMLElement>('[data-rc-list]');
  const template = collection.querySelector<HTMLTemplateElement>('[data-rc-part-template]');
  const draft = collection.querySelector<HTMLFormElement>('[data-rc-draft]');
  const addButton = collection.querySelector<HTMLButtonElement>('[data-rc-add]');
  const cancelButton = collection.querySelector<HTMLButtonElement>('[data-rc-cancel]');
  const count = collection.querySelector<HTMLElement>('[data-rc-count]');
  const empty = collection.querySelector<HTMLElement>('[data-rc-empty]');
  const status = collection.querySelector<HTMLElement>('[data-rc-status]');
  if (!panel || !desk || !list || !template || !draft || !addButton) return;

  collection.dataset.rcWired = '1';

  // Keep labelled relationships unique if a page ever embeds more than one
  // rack playground. The shipped page has one, but the editor is reusable.
  const suffix = String(ordinal + 1);
  const heading = collection.querySelector<HTMLElement>('[id="rack-parts-title"]');
  if (heading) {
    heading.id = `rack-parts-title-${suffix}`;
    collection.setAttribute('aria-labelledby', heading.id);
  }
  draft.id = `rack-part-draft-${suffix}`;
  addButton.setAttribute('aria-controls', draft.id);

  const initial = directParts(desk).map(snapshotPart);
  let keySerial = initial.length;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let statusRevision = 0;

  const say = (message: string): void => {
    if (!status) return;
    const revision = ++statusRevision;
    if (statusTimer !== undefined) clearTimeout(statusTimer);
    // Replacing with an empty string first makes repeated operations with the
    // same wording observable to assistive technology too.
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
    Array.from(list.querySelectorAll<HTMLElement>('[data-rc-part-card]'));

  const updateCollectionState = (): void => {
    const length = directParts(desk).length;
    if (count) count.textContent = `${length} ${length === 1 ? 'part' : 'parts'}`;
    if (empty) empty.hidden = length !== 0;
  };

  const errorFor = (input: ParamControl): HTMLElement | null =>
    input
      .closest<HTMLElement>('[data-rc-part-card], [data-rc-draft]')
      ?.querySelector<HTMLElement>('[data-rc-name-error]') ?? null;

  const validateName = (input: ParamControl, currentKey?: string): boolean => {
    const value = input.value.trim();
    const duplicate = directParts(desk).some(
      (part) => part.dataset.pgChildKey !== currentKey && part.id === value,
    );
    const message = value === ''
      ? 'Enter a part name. It becomes the channel id.'
      : duplicate
        ? `A part named “${value}” already exists.`
        : '';
    input.setCustomValidity(message);
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    const error = errorFor(input);
    if (error) error.textContent = message;
    return message === '';
  };

  const updateCard = (card: HTMLElement, part: HTMLElement): void => {
    const name = part.id.trim() || 'Unnamed part';
    const source = sourceLabel(part.getAttribute('src'));
    const sound = part.getAttribute('sound') || 'default sound';
    const nameSlot = card.querySelector<HTMLElement>('[data-rc-summary-name]');
    const metaSlot = card.querySelector<HTMLElement>('[data-rc-summary-meta]');
    const remove = card.querySelector<HTMLButtonElement>('[data-rc-remove]');
    if (nameSlot) nameSlot.textContent = name;
    if (metaSlot) metaSlot.textContent = `${source} · ${sound}`;
    if (remove) remove.setAttribute('aria-label', `Remove ${name} rack part`);
  };

  const prepareNameControl = (container: HTMLElement, key?: string): void => {
    const input = container.querySelector<ParamControl>('[data-pg-attr="id"]');
    if (!input) return;
    input.required = true;
    input.autocomplete = 'off';
    // Validate while typing, but commit only on change/blur so an unfinished
    // name never becomes a transient rack id or collides with another part.
    input.dataset.pgCommit = 'change';
    const error = errorFor(input);
    if (error) {
      error.id = `rack-part-name-error-${suffix}-${key ?? 'draft'}`;
      input.setAttribute('aria-describedby', error.id);
    }
  };

  const prepareCard = (card: HTMLElement, key: string): void => {
    card.dataset.rcKey = key;
    for (const row of card.querySelectorAll<HTMLElement>('[data-pg-scope]')) {
      row.dataset.pgScope = scopeFor(key);
    }
    prepareNameControl(card, key);
    const part = partForKey(desk, key);
    if (part) updateCard(card, part);
  };

  const makeCard = (key: string): HTMLElement | null => {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const card = fragment.querySelector<HTMLElement>('[data-rc-part-card]');
    if (!card) return null;
    prepareCard(card, key);
    return card;
  };

  const resetDraft = (): void => {
    draft.reset();
    for (const control of partControls(draft)) {
      control.setCustomValidity('');
      control.removeAttribute('aria-invalid');
      if (control.dataset.pgAttr === 'src') control.value = DEFAULT_SOURCE;
      if (control.dataset.pgAttr === 'sound') control.value = DEFAULT_SOUND;
    }
    const error = draft.querySelector<HTMLElement>('[data-rc-name-error]');
    if (error) error.textContent = '';
  };

  const closeDraft = (restoreFocus: boolean): void => {
    draft.hidden = true;
    addButton.setAttribute('aria-expanded', 'false');
    resetDraft();
    if (restoreFocus) addButton.focus();
  };

  const openDraft = (): void => {
    if (draft.hidden) resetDraft();
    draft.hidden = false;
    addButton.setAttribute('aria-expanded', 'true');
    queueMicrotask(() => draft.querySelector<ParamControl>('[data-pg-attr="id"]')?.focus());
  };

  prepareNameControl(draft);
  for (const card of cards()) {
    const key = card.dataset.rcKey;
    if (key) prepareCard(card, key);
  }
  resetDraft();
  updateCollectionState();

  // Validate before the event reaches the shared playground delegate. Its one
  // attribute writer then handles both these rows and a simple player's rows.
  collection.addEventListener('input', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    if (input.dataset.pgAttr !== 'id') return;
    const card = input.closest<HTMLElement>('[data-rc-part-card]');
    validateName(input, card?.dataset.rcKey);
  }, true);
  collection.addEventListener('change', (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) return;
    if (input.dataset.pgAttr !== 'id' || input.closest('[data-pg-draft]')) return;
    const card = input.closest<HTMLElement>('[data-rc-part-card]');
    if (!validateName(input, card?.dataset.rcKey)) return;
    queueMicrotask(() => say(`Renamed part to ${input.value.trim()}.`));
  }, true);

  addButton.addEventListener('click', openDraft);
  cancelButton?.addEventListener('click', () => closeDraft(true));
  draft.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeDraft(true);
  });

  draft.addEventListener('submit', (event) => {
    event.preventDefault();
    const nameControl = draft.querySelector<ParamControl>('[data-pg-attr="id"]');
    if (!nameControl || !validateName(nameControl)) {
      nameControl?.focus();
      return;
    }

    const key = `rack-part-${++keySerial}`;
    const card = makeCard(key);
    if (!card) {
      say('The part editor could not be created.');
      return;
    }

    const part = desk.ownerDocument.createElement(PART_TAG);
    part.dataset.pgChildKey = key;
    for (const control of partControls(draft)) {
      const name = control.dataset.pgAttr as PartAttribute | undefined;
      const value = control.value.trim();
      if (name && value !== '') part.setAttribute(name, value);
    }

    desk.append(part);
    list.append(card);
    updateCard(card, part);
    closeDraft(false);
    updateCollectionState();
    panel.dispatchEvent(new Event(PLAYGROUND_SYNC_EVENT));
    say(`Added ${part.id} rack part.`);

    card.setAttribute('open', '');
    queueMicrotask(() => card.querySelector<HTMLElement>('[data-rc-summary]')?.focus());
  });

  collection.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const remove = target.closest<HTMLButtonElement>('[data-rc-remove]');
    if (!remove || !collection.contains(remove)) return;
    const card = remove.closest<HTMLElement>('[data-rc-part-card]');
    const key = card?.dataset.rcKey;
    if (!card || !key) return;

    const before = cards();
    const index = before.indexOf(card);
    const focusTarget = before[index + 1] ?? before[index - 1];
    const part = partForKey(desk, key);
    const name = part?.id || 'part';
    part?.remove();
    card.remove();
    updateCollectionState();
    panel.dispatchEvent(new Event(PLAYGROUND_SYNC_EVENT));
    say(`Removed ${name} rack part.`);
    queueMicrotask(() => {
      const summary = focusTarget?.querySelector<HTMLElement>('[data-rc-summary]');
      (summary ?? addButton).focus();
    });
  });

  // Summaries are read-only projections of the live child attributes. The
  // shared parameter core remains the sole writer for edits after creation.
  const observer = new MutationObserver((records) => {
    let structureChanged = false;
    for (const record of records) {
      if (record.type === 'childList') {
        structureChanged = true;
        continue;
      }
      if (!(record.target instanceof HTMLElement)) continue;
      const key = record.target.dataset.pgChildKey;
      const card = key ? cards().find((candidate) => candidate.dataset.rcKey === key) : undefined;
      if (card) updateCard(card, record.target);
    }
    if (structureChanged) updateCollectionState();
  });
  observer.observe(desk, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [...PART_ATTRIBUTES],
  });

  // The shared reset dispatches this before it restores attribute baselines,
  // so rebuilding the original stable scopes here lets the same core hydrate
  // the replacement controls and attributes immediately afterwards.
  panel.addEventListener(PLAYGROUND_RESET_EVENT, () => {
    const player = panel.querySelector<HTMLElement & {stop?: () => void}>('[data-rc-master]');
    player?.stop?.();
    closeDraft(false);

    const restored = initial.map((part) => restorePart(desk.ownerDocument, part));
    desk.replaceChildren(...restored);
    const restoredCards = initial
      .map(({key}) => makeCard(key))
      .filter((card): card is HTMLElement => card !== null);
    list.replaceChildren(...restoredCards);
    for (const card of restoredCards) {
      const key = card.dataset.rcKey;
      if (key) prepareCard(card, key);
    }
    updateCollectionState();
    say(`Reset to ${initial.length} original rack parts.`);
  });
}

export function mountRackControlPlaygrounds(): void {
  const collections = Array.from(document.querySelectorAll<HTMLElement>('[data-rc-collection]'));
  collections.forEach(mountRackControlPlayground);
}
