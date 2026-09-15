import {mountDemos} from '../components/demo-lifecycle';

/** Manual demo adapters own their controls and reset; the frame owns only chrome. */
mountDemos('[data-headless-demo]:not([data-wm-hl])', (root, scope) => {
  let interactionRevision = 0;
  let copyGeneration = 0;
  // Parameter and stage adapters own their feedback. A clipboard request
  // started before a later interaction must not overwrite their new result.
  scope.listen(root, 'click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-hl-copy]')) return;
    interactionRevision += 1;
  });
  for (const event of ['input', 'change', 'wm:headless-reset']) {
    scope.listen(root, event, () => { interactionRevision += 1; });
  }
  scope.listen(root, 'keydown', (event) => {
    if (event instanceof KeyboardEvent && event.key === 'Enter') interactionRevision += 1;
  });
  const feedback = (message: string): void => {
    if (!scope.active) return;
    const node = root.querySelector<HTMLElement>('[data-hl-feedback]');
    if (node) { node.hidden = !message; node.textContent = message; }
  };
  const copy = root.querySelector('[data-hl-copy]');
  if (copy) scope.listen(copy, 'click', async () => {
    const generation = ++copyGeneration;
    const revision = interactionRevision;
    const current = (): boolean => scope.active && generation === copyGeneration && revision === interactionRevision;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard is unavailable in this browser.');
      await navigator.clipboard.writeText(root.querySelector('[data-hl-readout]')?.textContent ?? '');
      if (current()) feedback('Code copied.');
    } catch (error) {
      if (current()) feedback(error instanceof Error ? error.message : String(error));
    }
  });
  const reset = root.querySelector('[data-hl-reset]');
  if (reset) scope.listen(reset, 'click', () => {
    feedback('');
    root.dispatchEvent(new CustomEvent('wm:headless-reset', {bubbles: true}));
  });
});
