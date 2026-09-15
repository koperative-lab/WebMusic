export function renderNoteChips(root: HTMLElement, labels: readonly string[], empty = 'No notes'): void {
  root.replaceChildren();
  if (!labels.length) { root.textContent = empty; return; }
  for (const label of labels) {
    const chip = document.createElement('span');
    chip.className = 'wm-hl-music__chip';
    chip.textContent = label;
    root.append(chip);
  }
}

