import {NoteId, PartId, Rational, VoiceId, makeId, type Alter, type Score, type ScoreEditResult,
  type ScorePlaybackSnapshot, type Step} from '../../core';
import type {StaffRenderOptions} from '../core/types';
import {scoreDocumentPlaybackCompatible} from '../headless/score-editing';
import type {StaffViewEditing} from '../headless/staff-editing';
import {renderStaffVisualizer} from './renderers/factory';
import type {StaffSVGVisualizer} from './renderers/staff';

export interface StaffEditingOptions extends StaffRenderOptions {
  /** Initial armed note-input mode; default false. Applies only while input is editable. */
  inputEnabled?: boolean;
  onCommit?(result: Extract<ScoreEditResult, {status: 'committed'}>): void;
  onError?(error: unknown): void;
}
export interface StaffEditingHandle {
  readonly element: HTMLElement;
  readonly surface: HTMLElement;
  updatePlayback(playback?: ScorePlaybackSnapshot): void;
  cancel(): void;
  dispose(): void;
}

/** Staff input borrows the view controller; the editor remains the sole history owner. */
export function mountStaffEditor(host: HTMLElement, editing: StaffViewEditing, options: StaffEditingOptions = {}): StaffEditingHandle {
  const owner = host.ownerDocument;
  const element = owner.createElement('section');
  element.setAttribute('part', 'editor');
  element.style.cssText = 'display:grid;gap:.5rem;min-width:0;color:var(--wm-foreground,inherit)';
  const instructions = owner.createElement('p');
  instructions.id = makeId('staff-input-help');
  instructions.setAttribute('part', 'editing-instructions');
  instructions.style.cssText = 'margin:0;font:inherit;font-size:.8em';
  instructions.textContent = 'Focus the staff and press N to enable note input. A–G enters a pitch; 1–7 selects whole through 64th notes; 0 inserts a rest. Left/Right moves the cursor by the duration; Up/Down changes octave. Click a note or rest to select it. Delete replaces the selection with a rest. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes. Escape exits input.';
  const toggle = owner.createElement('button');
  toggle.type = 'button';
  toggle.style.justifySelf = 'start';
  const surface = owner.createElement('div');
  surface.setAttribute('part', 'staff-input-surface');
  surface.setAttribute('tabindex', '0');
  surface.setAttribute('role', 'application');
  surface.setAttribute('aria-label', 'Staff note input');
  surface.setAttribute('aria-describedby', instructions.id);
  surface.style.cssText = 'min-width:0;outline-offset:2px';
  const feedback = owner.createElement('div');
  feedback.setAttribute('part', 'editing-status');
  feedback.setAttribute('role', 'status');
  feedback.setAttribute('aria-live', 'polite');
  const details = owner.createElement('details');
  details.setAttribute('part', 'staff-input-controls');
  const summary = owner.createElement('summary'); summary.textContent = 'Staff input controls'; details.append(summary);
  const form = owner.createElement('form');
  form.style.cssText = 'display:flex;flex-wrap:wrap;align-items:end;gap:.5rem;padding:.5rem 0';
  const controls: Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> = [];
  const wrap = (label: string, field: HTMLInputElement | HTMLSelectElement): void => {
    const wrapper = owner.createElement('label'); wrapper.textContent = `${label} `;
    wrapper.style.cssText = 'display:grid;gap:.2rem;max-width:100%';
    field.setAttribute('aria-label', label); field.style.cssText = 'width:8em;max-width:100%;box-sizing:border-box';
    wrapper.append(field); form.append(wrapper); controls.push(field);
  };
  const input = (label: string, type = 'text'): HTMLInputElement => {
    const field = owner.createElement('input'); field.type = type; wrap(label, field); return field;
  };
  const select = (label: string, entries: readonly (readonly [string, string])[]): HTMLSelectElement => {
    const field = owner.createElement('select');
    for (const [value, text] of entries) { const option = owner.createElement('option'); option.value = value; option.textContent = text; field.append(option); }
    wrap(label, field); return field;
  };
  const part = select('Insert into part', []);
  const voice = input('Voice');
  const staff = input('Staff', 'number'); staff.min = '1'; staff.step = '1';
  const onset = input('Cursor (quarters)');
  const duration = select('Duration (quarters)', [['4', '4 (whole)'], ['2', '2 (half)'], ['1', '1 (quarter)'], ['1/2', '1/2 (eighth)'], ['1/4', '1/4 (16th)'], ['1/8', '1/8 (32nd)'], ['1/16', '1/16 (64th)']]);
  const dots = select('Dots', [['0', 'None'], ['1', 'One'], ['2', 'Two']]);
  const pitch = select('Pitch letter', ['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((step) => [step, step] as const));
  const octave = input('Octave', 'number'); octave.min = '-1'; octave.max = '9'; octave.step = '1';
  const accidental = select('Accidental', [['-2', 'Double flat'], ['-1', 'Flat'], ['0', 'Natural'], ['1', 'Sharp'], ['2', 'Double sharp']]);
  const button = (label: string, action?: () => void): HTMLButtonElement => {
    const result = owner.createElement('button'); result.type = 'button'; result.textContent = label;
    if (action) result.addEventListener('click', action);
    form.append(result); controls.push(result); return result;
  };
  const insert = button('Insert note'); insert.type = 'submit';
  button('Insert rest', () => withFields(() => editing.insertRest()));
  const remove = button('Delete selected', () => completed(editing.deleteSelected()));
  const undo = button('Undo', () => completed(editing.undo()));
  const redo = button('Redo', () => completed(editing.redo()));
  form.addEventListener('submit', (event) => { event.preventDefault(); withFields(() => editing.insertPitch(pitch.value as Step)); });
  details.append(form); element.append(instructions, toggle, surface, feedback, details);
  host.append(element);
  let disposed = false;
  let inputEnabled = options.inputEnabled === true;
  let message = '';
  let content: Score | undefined;
  let partKey = '';
  let playback: ScorePlaybackSnapshot | undefined;
  let visualizer: StaffSVGVisualizer | undefined;
  let rendered: ReturnType<typeof renderStaffVisualizer> | undefined;
  let cursorKey = '';
  const invalidFields = new Map<HTMLElement, unknown>();
  const fieldActions = new Map<HTMLElement, () => void>();
  const pendingFields = new Set<HTMLElement>();
  const syncedValues = new Map<HTMLElement, string>();
  const drawing = owner.createElement('div');
  drawing.setAttribute('part', 'drawing');
  drawing.style.cssText = 'min-width:0;max-width:100%;overflow:hidden;background:var(--wm-score-view-background,var(--wm-surface,Canvas))';
  surface.append(drawing);
  function visibleContent(): Score {
    return editing.editing.state.interaction.draft?.content ?? editing.state.document.content;
  }
  function renderNotation(): void {
    rendered?.dispose?.(); visualizer = undefined; rendered = undefined;
    drawing.replaceChildren();
    content = visibleContent();
    const container = owner.createElement('div'); container.style.width = '100%'; drawing.append(container);
    rendered = renderStaffVisualizer(content, container, options);
    visualizer = rendered.visualizer as StaffSVGVisualizer;
  }
  try { renderNotation(); } catch (error) { element.remove(); throw error; }
  function available(): boolean { return !disposed && editing.state.available && editing.state.editable; }
  function report(error: unknown): void {
    message = error instanceof Error ? error.message : String(error);
    feedback.textContent = message; options.onError?.(error);
  }
  function completed(result: ScoreEditResult): void {
    if (disposed) return;
    if (result.status === 'failed') report(result.error);
    else {
      message = result.status === 'committed' ? result.change.label : 'No change';
      draw();
      if (result.status === 'committed') options.onCommit?.(result);
    }
  }
  function quarter(value: string): Rational {
    const match = /^(\d+)(?:\/(\d+))?$/.exec(value.trim());
    if (!match) throw new RangeError('Enter quarter values as nonnegative integers or fractions such as 1/2');
    return new Rational(Number(match[1]), Number(match[2] ?? 1));
  }
  // An empty number field is not zero; the controller rejects NaN with its range message.
  function integer(field: HTMLInputElement): number { return field.value.trim() === '' ? Number.NaN : Number(field.value); }
  function withFields(action: () => ScoreEditResult): void {
    if (!available()) return;
    const active = owner.activeElement as HTMLElement | null;
    for (const [field, apply] of fieldActions) {
      // A focused field may hold an edit without input/change events; an unchanged one must not re-apply.
      const edited = field === active && (field as HTMLInputElement).value !== syncedValues.get(field);
      if (!pendingFields.has(field) && !edited) continue;
      try { apply(); pendingFields.delete(field); invalidFields.delete(field); }
      catch (error) { pendingFields.add(field); invalidFields.set(field, error); report(error); return; }
    }
    if (invalidFields.size) { report(invalidFields.values().next().value); return; }
    try {
      completed(action());
    } catch (error) { report(error); }
    finally { draw(); }
  }
  function draw(): void {
    if (disposed) return;
    const state = editing.state;
    const draft = editing.editing.state.interaction.draft;
    if (content !== visibleContent()) {
      const viewport = surface.querySelector<HTMLElement>('[data-webscore-staff-timeline]');
      const scroll = viewport?.scrollLeft ?? 0;
      try { renderNotation(); } catch (error) { report(error); }
      const next = surface.querySelector<HTMLElement>('[data-webscore-staff-timeline]');
      if (next) { next.scrollLeft = scroll; next.dispatchEvent(new Event('scroll')); }
    }
    const enabled = available();
    if (!enabled) inputEnabled = false;
    toggle.textContent = inputEnabled ? 'Disable note input' : 'Enable note input';
    toggle.setAttribute('aria-pressed', String(inputEnabled)); toggle.disabled = !enabled;
    surface.setAttribute('aria-disabled', String(!enabled));
    surface.dataset.inputEnabled = String(inputEnabled);
    element.dataset.editState = !state.available ? 'unavailable' : draft ? 'draft' : state.editable ? 'ready' : 'readonly';
    visualizer?.setSelectedNotes(editing.editing.state.interaction.selectedNoteIds);
    const nextCursorKey = `${state.partId}:${state.staff}:${state.onsetQuarters}`;
    visualizer?.setEditingCursor(state.partId && state.editable ? {quarters: state.onsetQuarters.toFloat(), partId: state.partId, staff: state.staff} : undefined, nextCursorKey !== cursorKey);
    cursorKey = nextCursorKey;
    paintPlayback();
    const key = state.document.content.parts.map((value) => `${value.id}:${value.name}`).join('|');
    if (key !== partKey) {
      partKey = key; part.replaceChildren();
      for (const value of state.document.content.parts) { const option = owner.createElement('option'); option.value = value.id; option.textContent = value.name; part.append(option); }
    }
    const sync = (field: HTMLInputElement | HTMLSelectElement, value: string): void => {
      if (!pendingFields.has(field)) { field.value = value; syncedValues.set(field, field.value); invalidFields.delete(field); }
    };
    sync(part, state.partId ?? ''); sync(voice, state.voice); sync(staff, String(state.staff));
    sync(onset, state.onsetQuarters.toString()); sync(duration, state.duration.base.toString()); sync(dots, String(state.duration.dots));
    sync(octave, String(state.octave)); sync(accidental, String(state.alter));
    for (const field of controls) field.disabled = !enabled;
    remove.disabled = !enabled || editing.editing.state.interaction.selectedNoteIds.length !== 1;
    undo.disabled = !enabled || !editing.editing.state.history.canUndo;
    redo.disabled = !enabled || !editing.editing.state.history.canRedo;
    toggle.hidden = !state.editable; details.hidden = !state.editable; instructions.hidden = !state.editable;
    const selected = editing.editing.state.interaction.selectedNoteIds.map((id) => visibleContent().getNote(id)).filter((note) => !!note);
    const text = [message, !state.available ? 'Editor unavailable.' :
      `${inputEnabled ? 'Note input enabled' : 'Note input off'}. Cursor ${state.onsetQuarters} quarters; voice ${state.voice}; staff ${state.staff}; duration ${state.duration.quarters} quarters; octave ${state.octave}.`,
    selected.length ? `Selected ${selected.length}: ${selected.map((note) => note.rest ? 'rest' : note.pitch.toString()).join(', ')}.` : 'No note selected.',
    draft ? 'Shared edit preview; playback overlay is suspended.' : ''].filter(Boolean).join(' ');
    // Identical text would otherwise churn the live region on unrelated redraws.
    if (feedback.textContent !== text) feedback.textContent = text;
  }
  /** Playback state and sounding-note overlay only; frames do not repaint controls or selection. */
  function paintPlayback(): void {
    const compatible = !editing.editing.state.interaction.draft && scoreDocumentPlaybackCompatible(editing.state.document, playback);
    const playbackState = !playback ? 'unbound' : compatible ? 'ready' : 'pending';
    if (element.dataset.playbackState !== playbackState) element.dataset.playbackState = playbackState;
    if (compatible && playback?.nominalSeconds !== null && playback?.nominalSeconds !== undefined) visualizer?.redrawAtTime(playback.nominalSeconds, false);
    else visualizer?.clearActiveNotes();
  }
  function keydown(event: KeyboardEvent): void {
    if (event.target !== surface || !available() || event.isComposing || event.altKey) return;
    const key = event.key.toLowerCase();
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && (key === 'z' || key === 'y')) {
      event.preventDefault(); completed(key === 'y' || event.shiftKey ? editing.redo() : editing.undo()); return;
    }
    if (modifier) return;
    // Escape belongs to an enclosing dialog unless it actually leaves note input.
    if (key === 'escape' && !inputEnabled) return;
    if (key === 'n' || key === 'escape') {
      event.preventDefault(); if (event.repeat) return;
      inputEnabled = key === 'n' ? !inputEnabled : false; message = ''; draw(); return;
    }
    if (key === 'delete' || key === 'backspace') {
      event.preventDefault(); if (!event.repeat) completed(editing.deleteSelected()); return;
    }
    if (!inputEnabled) return;
    const durations: Record<string, readonly [number, number]> = {'1': [4, 1], '2': [2, 1], '3': [1, 1], '4': [1, 2], '5': [1, 4], '6': [1, 8], '7': [1, 16]};
    if (!/^[a-g]$/.test(key) && !(key in durations) && !['0', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) return;
    event.preventDefault();
    if (event.repeat) return;
    try {
      message = '';
      if (/^[a-g]$/.test(key)) completed(editing.insertPitch(key.toUpperCase() as Step));
      else if (key === '0') completed(editing.insertRest());
      else if (key in durations) editing.setDuration(durations[key]);
      else if (key === 'arrowup' || key === 'arrowdown') editing.setOctave(editing.state.octave + (key === 'arrowup' ? 1 : -1));
      else editing.setCursor(editing.state.onsetQuarters.add(editing.state.duration.quarters.mul(key === 'arrowright' ? Rational.ONE : new Rational(-1))).toJSON());
      draw();
    } catch (error) { report(error); }
  }
  const click = (event: MouseEvent): void => {
    if (!available()) return;
    const target = event.target as Element | null;
    const note = target?.closest<SVGElement>('[data-note-id]');
    if (!note || !surface.contains(note)) return;
    try { editing.select(NoteId(note.dataset.noteId!)); message = ''; surface.focus(); draw(); }
    catch (error) { report(error); }
  };
  const toggleInput = (): void => { if (available()) { inputEnabled = !inputEnabled; message = ''; draw(); surface.focus(); } };
  const updateField = (field: HTMLInputElement | HTMLSelectElement, action: () => void): void => {
    fieldActions.set(field, action);
    field.addEventListener('input', () => { if (available()) pendingFields.add(field); });
    field.addEventListener('change', () => {
      if (!available()) return;
      pendingFields.add(field);
      try { action(); pendingFields.delete(field); invalidFields.delete(field); message = ''; draw(); }
      catch (error) { invalidFields.set(field, error); report(error); }
    });
  };
  updateField(part, () => editing.setPart(PartId(part.value)));
  updateField(voice, () => editing.setVoice(VoiceId(voice.value)));
  updateField(staff, () => editing.setStaff(integer(staff)));
  updateField(onset, () => editing.setCursor(quarter(onset.value).toJSON()));
  updateField(duration, () => editing.setDuration(quarter(duration.value).toJSON(), Number(dots.value)));
  updateField(dots, () => editing.setDuration(quarter(duration.value).toJSON(), Number(dots.value)));
  updateField(octave, () => editing.setOctave(integer(octave)));
  updateField(accidental, () => editing.setAlter(Number(accidental.value) as Alter));
  toggle.addEventListener('click', toggleInput);
  surface.addEventListener('keydown', keydown); surface.addEventListener('click', click);
  let off: () => void;
  try { off = editing.subscribe(draw); } catch (error) { disposed = true; rendered?.dispose?.(); element.remove(); throw error; }
  return {
    element, surface,
    updatePlayback(value) {
      if (disposed) return;
      playback = value;
      // A playback frame over unchanged content repaints only its overlay.
      if (content === visibleContent()) paintPlayback(); else draw();
    },
    cancel() { if (!disposed) { inputEnabled = false; message = ''; draw(); } },
    dispose() {
      if (disposed) return;
      disposed = true; off();
      toggle.removeEventListener('click', toggleInput);
      surface.removeEventListener('keydown', keydown); surface.removeEventListener('click', click);
      rendered?.dispose?.(); element.remove();
    },
  };
}
