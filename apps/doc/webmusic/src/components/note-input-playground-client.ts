import {
  PLAYGROUND_RESET_EVENT,
  PLAYGROUND_SYNC_EVENT,
} from './playground-client';

const RECORDER_SELECTOR = '[data-ni-recorder]';
const DEFAULT_BPM = '120';
const DEFAULT_QUANTIZE = '0.25';

type RecorderElement = HTMLElement & {
  source?: EventTarget;
};

function recorderSetupCode(): string {
  return [
    "const noteInput = document.querySelector('note-input');",
    "const recorder = document.querySelector('score-recorder');",
    '',
    'recorder.source = noteInput;',
  ].join('\n');
}

/** Mount the optional recorder editor for one consolidated note-input demo. */
function mountNoteInputPlayground(editor: HTMLElement): void {
  if (editor.dataset.niRecorderWired === '1') return;

  const panel = editor.closest<HTMLElement>('[data-wm-pg]');
  const composition = panel?.querySelector<HTMLElement>('[data-ni-composition]');
  const input = composition?.querySelector<HTMLElement>('[data-ni-input]');
  const addButton = editor.querySelector<HTMLButtonElement>('[data-ni-recorder-add]');
  const list = editor.querySelector<HTMLElement>('[data-ni-recorder-list]');
  const template = editor.querySelector<HTMLTemplateElement>('[data-ni-recorder-template]');
  const count = editor.querySelector<HTMLElement>('[data-ni-recorder-count]');
  const empty = editor.querySelector<HTMLElement>('[data-ni-recorder-empty]');
  const status = editor.querySelector<HTMLElement>('[data-ni-recorder-status]');
  const codeBlock = panel?.querySelector<HTMLElement>('[data-ni-recorder-code-block]');
  const code = panel?.querySelector<HTMLElement>('[data-ni-recorder-code]');
  if (!panel || !composition || !input || !addButton || !list || !template) return;

  editor.dataset.niRecorderWired = '1';
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let statusRevision = 0;

  const recorder = (): RecorderElement | undefined =>
    composition.querySelector<RecorderElement>(RECORDER_SELECTOR) ?? undefined;

  const card = (): HTMLElement | undefined =>
    list.querySelector<HTMLElement>('[data-ni-recorder-card]') ?? undefined;

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

  const updateSummary = (): void => {
    const current = recorder();
    const meta = card()?.querySelector<HTMLElement>('[data-ni-recorder-summary-meta]');
    if (!current || !meta) return;
    const bpm = current.getAttribute('bpm') || DEFAULT_BPM;
    const quantize = current.getAttribute('quantize') || '0';
    meta.textContent = bpm + ' BPM · quantize ' + quantize;
  };

  const updateState = (): void => {
    const mounted = recorder() !== undefined;
    if (count) count.textContent = mounted ? '1 mounted' : '0 mounted';
    if (empty) empty.hidden = mounted;
    addButton.disabled = mounted;
    addButton.textContent = mounted ? 'Recorder mounted' : '+ Mount recorder';
    if (code) code.textContent = mounted ? recorderSetupCode() : '';
    if (codeBlock) codeBlock.hidden = !mounted;
    updateSummary();
  };

  const sync = (): void => {
    panel.dispatchEvent(new Event(PLAYGROUND_SYNC_EVENT));
    updateState();
  };

  const mountRecorder = (): void => {
    const existing = recorder();
    if (existing) {
      existing.source = input;
      updateState();
      return;
    }

    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const nextCard = fragment.querySelector<HTMLElement>('[data-ni-recorder-card]');
    if (!nextCard) {
      say('The recorder controls could not be created.');
      return;
    }

    const nextRecorder = composition.ownerDocument.createElement(
      'score-recorder',
    ) as RecorderElement;
    nextRecorder.dataset.niRecorder = '';
    nextRecorder.setAttribute('bpm', DEFAULT_BPM);
    nextRecorder.setAttribute('quantize', DEFAULT_QUANTIZE);
    nextRecorder.source = input;

    composition.append(nextRecorder);
    list.append(nextCard);
    sync();
    say('Mounted score-recorder.');
    queueMicrotask(() => {
      nextCard.querySelector<HTMLElement>('[data-ni-recorder-summary]')?.focus();
    });
  };

  const unmountRecorder = (announce = true, requestSync = true): void => {
    const current = recorder();
    if (current) {
      current.source = undefined;
      current.remove();
    }
    card()?.remove();
    if (requestSync) sync();
    else updateState();
    if (announce) say('Unmounted score-recorder.');
  };

  addButton.addEventListener('click', mountRecorder);
  editor.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const remove = target.closest<HTMLButtonElement>('[data-ni-recorder-remove]');
    if (!remove || !editor.contains(remove)) return;
    unmountRecorder();
    queueMicrotask(() => addButton.focus());
  });

  // The shared parameter delegate owns the actual bpm/quantize writes. This
  // listener only keeps the collapsed card's summary in step with them.
  const requestSummaryUpdate = (): void => {
    queueMicrotask(updateSummary);
  };
  editor.addEventListener('input', requestSummaryUpdate);
  editor.addEventListener('change', requestSummaryUpdate);

  panel.addEventListener(PLAYGROUND_RESET_EVENT, () => {
    const hadRecorder = recorder() !== undefined;
    unmountRecorder(false, false);
    if (hadRecorder) say('Recorder mount reset.');
  });

  // Hydration and BFCache can present authored/dynamic DOM to the same module.
  // Adopt an existing recorder instead of ever creating a duplicate.
  const existing = recorder();
  if (existing) {
    existing.source = input;
    if (!card()) {
      const fragment = template.content.cloneNode(true) as DocumentFragment;
      const existingCard = fragment.querySelector<HTMLElement>('[data-ni-recorder-card]');
      if (existingCard) list.append(existingCard);
    }
  }
  sync();
}

export function mountNoteInputPlaygrounds(): void {
  document
    .querySelectorAll<HTMLElement>('[data-ni-recorder-editor]')
    .forEach((editor) => mountNoteInputPlayground(editor));
}
