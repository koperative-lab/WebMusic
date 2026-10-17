import {AudioEditError, audioSegmentLength, makeId, type AudioDocumentPlaybackBinding, type AudioDraftResult,
  type AudioEditOperation, type AudioEditResult, type AudioFrameRange} from '../../core';
import {audioDocumentPlaybackCompatible, type AudioViewEditing} from '../headless/audio-editing';
import {createAudioSequenceWaveform} from '../headless/sequence-waveform';
import type {AudioViewport, ViewportAudioVisualizer, WaveformRenderOptions} from '../core/types';
import {renderWaveformVisualizer} from './waveform';

export interface WaveformEditingOptions extends WaveformRenderOptions {
  /** Keyboard movement and pointer snapping in output frames. Default 1. */
  editingStepFrames?: number;
  onPreview?(result: Extract<AudioDraftResult, {status: 'preview'}>): void;
  onCommit?(result: Extract<AudioEditResult, {status: 'committed'}>): void;
  onError?(error: unknown): void;
}
export interface WaveformEditingHandle extends ViewportAudioVisualizer {
  readonly element: HTMLElement;
  readonly surface: HTMLElement;
  updatePlayback(binding?: AudioDocumentPlaybackBinding, seconds?: number): void;
  cancel(): void;
}

/** Existing waveform painting plus frame-addressed selection and semantic commands. */
export function mountWaveformEditor(host: HTMLElement, editing: AudioViewEditing,
  options: WaveformEditingOptions = {}): WaveformEditingHandle {
  const owner = host.ownerDocument;
  const step = options.editingStepFrames ?? 1;
  if (!Number.isSafeInteger(step) || step < 1) throw new RangeError('editingStepFrames must be positive');
  const source = createAudioSequenceWaveform(editing.state.document.content, editing.state.document.assets);
  const element = owner.createElement('section');
  element.setAttribute('part', 'editor');
  element.style.cssText = 'display:grid;gap:.5rem;min-width:0;color:var(--wm-foreground,inherit)';
  const help = owner.createElement('p'); help.id = makeId('audio-edit-help');
  help.setAttribute('part', 'editing-instructions');
  help.textContent = 'Drag a range or its edges. Choose Trim to preview and keep a range on release. Arrows move the cursor; Shift extends. Delete removes, Ctrl/Cmd+C/X/V copies/cuts/pastes, Ctrl/Cmd+Z undoes. Escape cancels.';
  help.style.cssText = 'margin:0;font:inherit;font-size:.8em';
  const surface = owner.createElement('div');
  surface.setAttribute('part', 'editing-surface');
  surface.setAttribute('tabindex', '0');
  surface.setAttribute('role', 'application');
  surface.setAttribute('aria-label', 'Audio waveform, output frames');
  surface.setAttribute('aria-describedby', help.id);
  surface.style.cssText = 'position:relative;min-width:0;touch-action:pan-y;outline-offset:2px';
  const drawing = owner.createElement('div'); drawing.style.minWidth = '0';
  const selection = owner.createElement('div'); selection.setAttribute('part', 'selection');
  selection.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
  const range = owner.createElement('div');
  range.style.cssText = 'position:absolute;top:0;bottom:0;border-inline:2px solid currentColor;background:color-mix(in srgb,var(--wm-accent,#4869d8) 20%,transparent);box-sizing:border-box';
  selection.append(range); surface.append(drawing, selection);
  const status = owner.createElement('div'); status.setAttribute('part', 'editing-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const details = owner.createElement('details'); details.setAttribute('part', 'editing-controls');
  const summary = owner.createElement('summary'); summary.textContent = 'Frame values and editing commands'; details.append(summary);
  const form = owner.createElement('form'); form.style.cssText = 'display:flex;flex-wrap:wrap;gap:.5rem;align-items:end;padding:.5rem 0;min-width:0';
  const field = (label: string, value: string): HTMLInputElement => {
    const wrapper = owner.createElement('label'); wrapper.textContent = `${label} `; wrapper.style.cssText = 'display:grid;max-width:100%';
    const input = owner.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '1'; input.value = value;
    input.setAttribute('aria-label', label); input.style.cssText = 'width:8em;max-width:100%;min-width:0;box-sizing:border-box';
    wrapper.append(input); form.append(wrapper); return input;
  };
  const start = field('Start frame', '0'), end = field('End frame', '0');
  const silence = field('Silence frames', String(Math.round(source.sampleRate)));
  const gain = field('Segment gain', '1'); gain.step = '0.1';
  const toolLabel = owner.createElement('label'); toolLabel.textContent = 'Pointer tool ';
  const tool = owner.createElement('select'); tool.setAttribute('aria-label', 'Pointer tool');
  for (const value of ['select', 'trim']) { const option = owner.createElement('option'); option.value = value; option.textContent = value === 'select' ? 'Select range' : 'Trim to range'; tool.append(option); }
  toolLabel.append(tool); form.append(toolLabel);
  const segmentLabel = owner.createElement('label'); segmentLabel.textContent = 'Segment ';
  segmentLabel.style.cssText = 'display:grid;max-width:100%;min-width:0';
  const segment = owner.createElement('select'); segment.setAttribute('aria-label', 'Segment'); segment.style.maxWidth = '100%';
  segmentLabel.append(segment); form.append(segmentLabel);
  const buttons: HTMLButtonElement[] = [];
  const button = (label: string, action: () => void): HTMLButtonElement => {
    const node = owner.createElement('button'); node.type = 'button'; node.textContent = label;
    node.addEventListener('click', () => { if (!active()) return; try { action(); } catch (error) { report(error); } });
    buttons.push(node); form.append(node); return node;
  };
  button('Select frames', () => editing.select(numericRange()));
  const split = button('Split at start', splitAtStart);
  const trim = button('Trim to selection', () => execute('Trim audio', [{type: 'trim', ...selected()}], 'range'));
  const remove = button('Delete selection', deleteSelection);
  button('Insert silence', () => execute('Insert silence', [{type: 'insert-silence', frame: selected().startFrame,
    length: frameValue(silence), id: makeId('segment'), rightId: makeId('segment')}], 'start'));
  const applyGain = button('Apply segment gain', () => execute('Change segment gain', [{type: 'set-gain', segmentIds: [segment.value], gain: Number(gain.value)}], 'segment'));
  const fadeIn = button('Fade in segment', () => fade(true));
  const fadeOut = button('Fade out segment', () => fade(false));
  const copy = button('Copy', copySelection);
  const cut = button('Cut', () => completed(editing.cut()));
  const paste = button('Paste at start', () => completed(editing.paste()));
  const undo = button('Undo', () => completed(editing.undo()));
  const redo = button('Redo', () => completed(editing.redo()));
  form.addEventListener('submit', (event) => { event.preventDefault(); try { editing.select(numericRange()); } catch (error) { report(error); } });
  tool.addEventListener('change', () => cancelGesture());
  segment.addEventListener('change', () => update());
  details.append(form); element.append(help, surface, status, details); host.append(element);
  let disposed = false;
  let message = '';
  let messageRevision = editing.state.document.documentRevision;
  let playback: AudioDocumentPlaybackBinding | undefined;
  let playbackSeconds = 0;
  let zoom = options.pixelsPerSecond ?? 100;
  let waveform: ViewportAudioVisualizer;
  let offViewport: (() => void) | undefined;
  const viewportListeners = new Set<(range: AudioViewport) => void>();
  let root = editing.state.document.content;
  let formRevision: number | undefined;
  let formSelection: AudioFrameRange | undefined;
  let formSegment: string | undefined;
  let segmentOptionsKey: string | undefined;
  let gesture: {id: number; revision: number; anchor: number; initial: AudioFrameRange; trim: boolean; moved: boolean; valid: boolean} | undefined;
  let keyboardSelection: {anchor: number; focus: number; revision: number; selection: AudioFrameRange} | undefined;
  function selected(): AudioFrameRange { return editing.state.interaction.selection; }
  function active(): boolean { return !disposed && editing.state.available && editing.state.editable; }
  function frameValue(input: HTMLInputElement): number {
    const number = Number(input.value);
    if (!input.value.trim() || !Number.isSafeInteger(number) || number < 0) throw new RangeError('Frames must be nonnegative safe integers');
    return number;
  }
  function numericRange(): AudioFrameRange { return {startFrame: frameValue(start), endFrame: frameValue(end)}; }
  function report(error: unknown): void { message = error instanceof Error ? error.message : String(error); update(); options.onError?.(error); }
  function completed(result: AudioEditResult): void {
    if (result.status === 'failed') report(result.error);
    else { message = result.status === 'committed' ? result.change.label : 'No change'; update(); if (result.status === 'committed') options.onCommit?.(result); }
  }
  function commandTarget(target: 'range' | 'start' | 'segment'): string | number {
    if (target === 'segment') return segment.value;
    const range = selected();
    return target === 'start' ? range.startFrame : `${range.startFrame}:${range.endFrame}`;
  }
  function execute(label: string, operations: readonly AudioEditOperation[], target: 'range' | 'start' | 'segment'): void {
    if (!active()) return;
    const document = editing.state.document, targetValue = commandTarget(target);
    cancel();
    if (!active()) return;
    if (editing.state.document.documentRevision !== document.documentRevision) {
      report(new AudioEditError('revision-conflict', 'The audio document changed before the command could be applied'));
      return;
    }
    // Cancellation publishes synchronously. Only the coordinates used by this
    // command must remain current; an unrelated range/segment change is safe.
    if (commandTarget(target) !== targetValue) return;
    completed(editing.execute(label, operations));
  }
  function copySelection(): void { const result = editing.copy(); if (result.status === 'failed') report(result.error); else { message = `Copied ${result.length} frames`; update(); } }
  function deleteSelection(): void {
    const {startFrame, endFrame} = selected();
    execute('Delete audio', [{type: 'splice', startFrame, deleteCount: endFrame - startFrame, segments: [], rightId: makeId('segment')}], 'range');
  }
  function splitAtStart(): void {
    let offset = 0;
    for (const item of root.segments) {
      const length = audioSegmentLength(item), frame = selected().startFrame - offset;
      if (frame > 0 && frame < length) { execute('Split audio', [{type: 'split', segmentId: item.id, frame, leftId: makeId('segment'), rightId: makeId('segment')}], 'start'); return; }
      offset += length;
    }
    message = 'Choose a frame inside a segment to split'; update();
  }
  function fade(inward: boolean): void {
    const item = root.segments.find((item) => item.id === segment.value);
    if (!item || item.kind !== 'asset') return;
    execute(inward ? 'Fade in' : 'Fade out', [{type: 'set-envelope', segmentId: item.id,
      points: [{frame: 0, gain: inward ? 0 : 1}, {frame: audioSegmentLength(item), gain: inward ? 1 : 0}]}], 'segment');
  }
  function drawWaveform(): void {
    const offset = waveform?.viewport().startSeconds ?? 0;
    offViewport?.(); waveform?.dispose();
    waveform = renderWaveformVisualizer(drawing, source, {...options, pixelsPerSecond: zoom, durationSeconds: source.frameCount / source.sampleRate});
    waveform.setPlayheadVisible?.(audioDocumentPlaybackCompatible(editing.state.document, playback));
    waveform.setOffset(offset);
    offViewport = waveform.onViewportChange((view) => { paintSelection(); for (const listener of [...viewportListeners]) listener(view); });
    if (audioDocumentPlaybackCompatible(editing.state.document, playback)) waveform.redraw(playbackSeconds, false);
  }
  function paintSelection(): void {
    if (!waveform || disposed) return;
    const view = waveform.viewport();
    const current = selected();
    const left = (current.startFrame / source.sampleRate - view.startSeconds) * zoom;
    const width = (current.endFrame - current.startFrame) / source.sampleRate * zoom;
    range.style.left = `${left}px`; range.style.width = `${Math.max(2, width)}px`;
    range.style.borderStyle = editing.state.interaction.draft ? 'dashed' : 'solid';
    range.hidden = !editing.state.editable;
    range.dataset.startFrame = String(current.startFrame); range.dataset.endFrame = String(current.endFrame);
  }
  function update(): void {
    if (disposed) return;
    const state = editing.state;
    if (messageRevision !== state.document.documentRevision) {
      messageRevision = state.document.documentRevision;
      message = state.document.change?.label ?? '';
    }
    if (gesture && (!active() || gesture.revision !== state.document.documentRevision)) cancel(false);
    if (root !== state.document.content) {
      root = state.document.content; source.setSequence(root); drawWaveform();
    }
    const optionsKey = JSON.stringify(root.segments.map((item) => [item.id, item.kind, audioSegmentLength(item)]));
    if (segmentOptionsKey !== optionsKey) {
      const previous = segment.value; segment.replaceChildren();
      root.segments.forEach((item, index) => {
        const option = owner.createElement('option'); option.value = item.id;
        option.textContent = `${index + 1}: ${item.kind}, ${audioSegmentLength(item)} frames`; option.disabled = item.kind === 'silence'; segment.append(option);
      });
      segmentOptionsKey = optionsKey;
      if (root.segments.some((item) => item.id === previous)) segment.value = previous;
      else segment.value = root.segments.find((item) => item.kind === 'asset')?.id ?? '';
    }
    // Playback updates do not own pending form values. Rebind the complete
    // range or segment input only when its authoritative target changes.
    const revisionChanged = formRevision !== state.document.documentRevision;
    const currentSelection = selected();
    if (revisionChanged || formSelection !== currentSelection) {
      start.value = String(currentSelection.startFrame); end.value = String(currentSelection.endFrame);
      formSelection = currentSelection;
    }
    const item = root.segments.find((item) => item.id === segment.value);
    if (revisionChanged || formSegment !== segment.value) gain.value = String(item?.kind === 'asset' ? item.gain : 1);
    formRevision = state.document.documentRevision; formSegment = segment.value;
    for (const button of buttons) button.disabled = !active();
    const hasRange = selected().endFrame > selected().startFrame;
    for (const button of [trim, remove, cut, copy]) button.disabled = !active() || !hasRange;
    for (const button of [applyGain, fadeIn, fadeOut]) button.disabled = !active() || item?.kind !== 'asset';
    split.disabled = !active() || selected().startFrame <= 0 || selected().startFrame >= root.length;
    paste.disabled = !active() || !editing.editor.getState().clipboard.hasContent;
    undo.disabled = !active() || !state.history.canUndo; redo.disabled = !active() || !state.history.canRedo;
    details.hidden = !state.editable; help.hidden = !state.editable;
    surface.setAttribute('aria-disabled', String(!active()));
    element.dataset.editState = !state.available ? 'unavailable' : state.interaction.draft ? 'draft' : state.editable ? 'ready' : 'readonly';
    const compatible = audioDocumentPlaybackCompatible(state.document, playback);
    element.dataset.playbackState = !playback ? 'unbound' : compatible ? 'ready' : 'pending';
    waveform?.setPlayheadVisible?.(compatible);
    status.textContent = `${!state.available ? 'Audio editor unavailable. ' : ''}${message ? `${message}. ` : ''}Frames ${selected().startFrame}–${selected().endFrame} of ${root.length}; revision ${state.document.documentRevision}${playback && !compatible ? '. Playback pending or unavailable' : ''}${state.interaction.draft ? '. Trim preview' : ''}`;
    paintSelection();
  }
  function at(event: PointerEvent): number {
    const bounds = surface.getBoundingClientRect();
    const seconds = waveform.hitTest(event.clientX - bounds.left, event.clientY - bounds.top).seconds;
    return Math.max(0, Math.min(root.length, Math.round(seconds * source.sampleRate / step) * step));
  }
  function cancel(restore = true): void {
    keyboardSelection = undefined;
    const current = gesture; gesture = undefined;
    if (current) { try { if (surface.hasPointerCapture?.(current.id)) surface.releasePointerCapture(current.id); } catch { /* capture already lost */ } }
    // Teardown marks this handle inactive before notifying subscribers, but
    // still releases its captured gesture. A disposed idle handle is inert.
    if ((!disposed || current) && editing.state.available) {
      editing.cancel();
      if (current && restore && editing.state.available && current.revision === editing.state.document.documentRevision) editing.select(current.initial);
    }
  }
  function cancelGesture(): void {
    keyboardSelection = undefined;
    // This view borrows the session: passive lifecycle changes must not cancel
    // a draft initiated by another consumer of that shared session.
    if (gesture) cancel();
  }
  const pointerdown = (event: PointerEvent): void => {
    if (!active() || event.button !== 0 || gesture) return;
    keyboardSelection = undefined;
    event.preventDefault(); surface.focus();
    const frame = at(event), current = selected();
    const tolerance = 6 * source.sampleRate / zoom;
    let anchor = frame;
    if (Math.abs(frame - current.startFrame) <= tolerance && current.endFrame > current.startFrame) anchor = current.endFrame;
    else if (Math.abs(frame - current.endFrame) <= tolerance && current.endFrame > current.startFrame) anchor = current.startFrame;
    gesture = {id: event.pointerId, revision: editing.state.document.documentRevision, anchor, initial: current, trim: tool.value === 'trim', moved: false, valid: false};
    surface.setPointerCapture?.(event.pointerId);
    editing.select({startFrame: Math.min(anchor, frame), endFrame: Math.max(anchor, frame)});
  };
  const pointermove = (event: PointerEvent): void => {
    const current = gesture;
    if (!current || current.id !== event.pointerId) return;
    if (!active() || current.revision !== editing.state.document.documentRevision) { cancel(false); return; }
    const frame = at(event), next = {startFrame: Math.min(current.anchor, frame), endFrame: Math.max(current.anchor, frame)};
    current.moved = true; editing.select(next);
    if (gesture !== current || !current.trim) return;
    const result = editing.preview([{type: 'trim', ...next}]); current.valid = result.status === 'preview';
    if (result.status === 'preview') options.onPreview?.(result); else report(result.error);
  };
  const pointerup = (event: PointerEvent): void => {
    const current = gesture;
    if (!current || current.id !== event.pointerId) return;
    if (current.moved) pointermove(event);
    if (gesture !== current) return;
    gesture = undefined;
    try { if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId); } catch { /* capture already lost */ }
    if (current.trim && current.moved && current.valid) completed(editing.commit('Trim audio'));
    else editing.cancel();
  };
  const cancelled = (): void => cancelGesture();
  const keydown = (event: KeyboardEvent): void => {
    if (!active()) return;
    const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase();
    let handled = true;
    if (event.key === 'Escape') cancel();
    else if (mod && key === 'z') completed(event.shiftKey ? editing.redo() : editing.undo());
    else if (mod && key === 'y') completed(editing.redo());
    else if (mod && key === 'a') editing.select({startFrame: 0, endFrame: root.length});
    else if (mod && key === 'c') copySelection();
    else if (mod && key === 'x') completed(editing.cut());
    else if (mod && key === 'v') completed(editing.paste());
    else if (event.key === 'Delete' || event.key === 'Backspace') deleteSelection();
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') {
      const value = selected();
      const revision = editing.state.document.documentRevision;
      // Session selection identity changes even when an external consumer sets
      // the same sorted range. Such a selection starts a new keyboard anchor.
      const previous = keyboardSelection?.selection === value && keyboardSelection.revision === revision ? keyboardSelection : undefined;
      const anchor = event.shiftKey ? previous?.anchor ?? value.startFrame : value.startFrame;
      const focus = event.shiftKey ? previous?.focus ?? value.endFrame : value.startFrame;
      const position = event.key === 'Home' ? 0 : event.key === 'End' ? root.length : Math.max(0, Math.min(root.length,
        focus + (event.key === 'ArrowLeft' ? -step : step)));
      const next = event.shiftKey ? {startFrame: Math.min(anchor, position), endFrame: Math.max(anchor, position)} : {startFrame: position, endFrame: position};
      keyboardSelection = undefined;
      editing.select(next);
      const accepted = selected();
      if (event.shiftKey && active() && editing.state.document.documentRevision === revision &&
          accepted.startFrame === next.startFrame && accepted.endFrame === next.endFrame) {
        keyboardSelection = {anchor, focus: position, revision, selection: accepted};
      }
    } else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  };
  surface.addEventListener('pointerdown', pointerdown); surface.addEventListener('pointermove', pointermove);
  surface.addEventListener('pointerup', pointerup); surface.addEventListener('pointercancel', cancelled);
  surface.addEventListener('lostpointercapture', cancelled); surface.addEventListener('blur', cancelled);
  surface.addEventListener('keydown', keydown); owner.defaultView?.addEventListener('blur', cancelled);
  drawWaveform();
  const unsubscribe = editing.subscribe(update);
  return {
    element, surface,
    updatePlayback(binding, seconds) { playback = binding; if (seconds !== undefined) playbackSeconds = seconds; update(); if (audioDocumentPlaybackCompatible(editing.state.document, playback)) waveform.redraw(playbackSeconds, false); },
    redraw(seconds, follow) { if (seconds !== undefined) playbackSeconds = seconds; waveform.redraw(seconds, follow); paintSelection(); },
    redrawFrame(seconds, follow) { playbackSeconds = seconds; waveform.redrawFrame?.(seconds, follow); paintSelection(); },
    setPlayheadMode(mode) { waveform.setPlayheadMode(mode); },
    setPlayheadVisible(visible) { waveform.setPlayheadVisible?.(visible); },
    setZoom(value) { cancelGesture(); zoom = value; waveform.setZoom(value); paintSelection(); },
    setOffset(seconds) { waveform.setOffset(seconds); paintSelection(); },
    setRegions(regions) { waveform.setRegions(regions); },
    viewport() { return waveform.viewport(); },
    onViewportChange(listener) { viewportListeners.add(listener); return () => { viewportListeners.delete(listener); }; },
    hitTest(x, y) { return waveform.hitTest(x, y); },
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      try { cancelGesture(); }
      finally {
        unsubscribe(); offViewport?.(); waveform.dispose(); source.dispose(); viewportListeners.clear();
        surface.removeEventListener('pointerdown', pointerdown); surface.removeEventListener('pointermove', pointermove);
        surface.removeEventListener('pointerup', pointerup); surface.removeEventListener('pointercancel', cancelled);
        surface.removeEventListener('lostpointercapture', cancelled); surface.removeEventListener('blur', cancelled);
        surface.removeEventListener('keydown', keydown); owner.defaultView?.removeEventListener('blur', cancelled); element.remove();
      }
    },
  };
}
