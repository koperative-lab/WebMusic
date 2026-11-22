import {Pitch, type Score} from '@webmusic/score';
import {createAnalysisSession, createLiveChordTracker, createLiveKeyTracker, type AnalysisSession, type LiveChordState} from '@webmusic/score/analyze/headless';
import {createScoreView, type ScoreView} from '@webmusic/score/view/headless';
import {currentStaffMarks} from '@webmusic/score/view';
import type {DemoScope} from '../demo-lifecycle';
import {followerDemoScore} from './demo-score';
import {renderNoteChips} from './musical-stage';

function controls(root: HTMLElement, scope: DemoScope) {
  const query = <T extends HTMLElement = HTMLElement>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`Missing demo control: ${selector}`);
    return node;
  };
  const feedback = (message: string): void => {
    if (!scope.active) return;
    const node = query('[data-hl-feedback]');
    node.hidden = !message;
    node.textContent = message;
  };
  const listen = (selector: string, event: string, action: () => void): void => {
    scope.listen(query(selector), event, () => {
      try { action(); } catch (error) { feedback(error instanceof Error ? error.message : String(error)); }
    });
  };
  return {query, feedback, listen};
}


/** One session re-analyzes each edited immutable score and keeps its reusable caches. */
export function mountAnalysisSessionDemo(root: HTMLElement, scope: DemoScope, sourceScore: Score): {readonly model: AnalysisSession} {
  const ui = controls(root, scope);
  const PITCHES = ['C#5', 'D5', 'E5', 'F#5'];
  let score = followerDemoScore(sourceScore);
  const session = createAnalysisSession(score);
  let edits = 0;
  const paint = (): void => {
    if (!scope.active) return;
    const result = session.result;
    ui.query('[data-session-summary]').textContent = `${score.metadata.title} · ${result.key.tonic} ${result.key.mode} · ${edits} score update${edits === 1 ? '' : 's'}`;
    renderNoteChips(ui.query('[data-session-notes]'), score.parts.flatMap((part) => part.notes.map((note) => note.pitch?.toString() ?? 'Rest')));
    renderNoteChips(ui.query('[data-session-chords]'), result.roman.map((entry) => `${entry.chord || '—'} (${entry.roman || '—'}) · q${entry.startQuarters}–${entry.endQuarters}`), 'No chord segments');
    ui.query('[data-session-detail]').textContent = `${result.motifs.length} repeated motif${result.motifs.length === 1 ? '' : 's'} · ${result.issues.length} voice-leading issue${result.issues.length === 1 ? '' : 's'}`;
  };
  // Each edit makes a new immutable score; the same session re-analyzes it.
  ui.listen('[data-session-edit]', 'click', () => {
    const note = score.parts[0].notes[0];
    const pitch = PITCHES[(edits + 1) % PITCHES.length];
    score = score.edit((edit) => { edit.updateNote(note.id, {pitch: Pitch.parse(pitch)}); });
    session.update(score);
    edits += 1;
    paint();
  });
  paint();
  return {get model() { return session; }};
}

const CHORDS: Record<string, readonly number[]> = {C: [60, 64, 67], Am: [57, 60, 64], F: [53, 57, 60], G7: [55, 59, 62, 65]};

/** Actual trackers receive each note; chord history is the API's bounded history. */
export function mountLiveTrackersDemo(root: HTMLElement, scope: DemoScope) {
  const ui = controls(root, scope);
  const held = new Set<number>();
  let chordState: LiveChordState = {chord: '', midis: [], history: []};
  const chord = createLiveChordTracker({onUpdate(next) { chordState = next; paintChord(); }});
  const key = createLiveKeyTracker(() => { paintKey(); });
  function paintChord(): void {
    if (!scope.active) return;
    ui.query('[data-live-chord]').textContent = chordState.chord || 'No held chord';
    renderNoteChips(ui.query('[data-live-notes]'), currentStaffMarks(chordState.midis).map((mark) => mark.label), 'No held notes');
    renderNoteChips(ui.query('[data-live-history]'), chordState.history, 'Chord history appears as you add notes');
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-live-midi]')) {
      button.setAttribute('aria-pressed', String(held.has(Number(button.dataset.liveMidi))));
    }
  }
  function paintKey(): void {
    if (!scope.active) return;
    const result = key.result();
    ui.query('[data-live-key]').textContent = result ? `${result.tonic} ${result.mode} · ${key.heard} notes heard` : 'Key estimate: no notes heard';
  }
  const release = (): void => {
    const notes = [...held];
    held.clear();
    for (const midi of notes) chord.noteOff(midi);
  };
  const press = (midi: number): void => { held.add(midi); chord.noteOn(midi); key.noteOn(midi); };
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-live-midi]')) {
    scope.listen(button, 'click', () => {
      const midi = Number(button.dataset.liveMidi);
      if (held.delete(midi)) chord.noteOff(midi);
      else press(midi);
    });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-live-preset]')) {
    scope.listen(button, 'click', () => {
      release();
      for (const midi of CHORDS[button.dataset.livePreset!]) press(midi);
    });
  }
  ui.listen('[data-live-release]', 'click', release);
  scope.add(() => { held.clear(); chord.reset(); key.reset(); });
  paintChord(); paintKey();
  return {chord, key, get state() { return chordState; }};
}

/** A tiny caller-owned renderer draws only the real model's visible notes. */
export function mountScoreWindowDemo(root: HTMLElement, scope: DemoScope, sourceScore: Score): {readonly model: ScoreView} {
  const ui = controls(root, scope);
  const score = followerDemoScore(sourceScore);
  const position = ui.query<HTMLInputElement>('[data-window-position]');
  const view = createScoreView(score, {viewport: {startTime: 0, endTime: 2}});
  let off: () => void = () => undefined;
  const paint = (): void => {
    if (!scope.active) return;
    const state = view.state;
    const start = state.viewport?.startTime ?? 0;
    const end = state.viewport?.endTime ?? state.sequence.totalTime;
    const span = Math.max(end - start, .001);
    const lane = ui.query('[data-window-lane]');
    lane.replaceChildren();
    for (const note of state.visibleNotes) {
      // A boundary candidate with zero on-screen duration needs no rectangle.
      const left = Math.max(start, note.startTime);
      const right = Math.min(end, note.endTime);
      if (right <= left) continue;
      const bar = document.createElement('span');
      const label = currentStaffMarks([note.pitch])[0].label;
      bar.className = 'wm-hl-music__bar';
      bar.dataset.windowNote = note.noteId;
      bar.dataset.active = String(state.activeNotes.includes(note));
      bar.style.left = `${(left - start) / span * 100}%`;
      bar.style.width = `${(right - left) / span * 100}%`;
      bar.style.top = `${8 + (72 - note.pitch) / 12 * 95}px`;
      bar.title = `${label} · ${note.startTime.toFixed(2)}–${note.endTime.toFixed(2)}s`;
      lane.append(bar);
    }
    if (state.currentTime >= start && state.currentTime <= end) {
      const cursor = document.createElement('span');
      cursor.className = 'wm-hl-music__cursor';
      cursor.style.left = `${(state.currentTime - start) / span * 100}%`;
      lane.append(cursor);
    }
    ui.query('[data-window-summary]').textContent = `${start.toFixed(1)}–${end.toFixed(1)}s window · ${state.visibleNotes.length} visible candidates of ${state.sequence.notes.length} notes`;
    renderNoteChips(ui.query('[data-window-active]'), currentStaffMarks(state.activeNotes.map((note) => note.pitch)).map((mark) => mark.label), 'No active notes');
    ui.query('[data-window-time]').textContent = `${state.currentTime.toFixed(2)}s · local position`;
  };
  const bind = (): void => { off = view.subscribe(paint); view.seek(0); };
  ui.listen('[data-window-position]', 'input', () => { view.seek(Number(position.value)); });
  scope.add(() => { off(); view.dispose(); });
  bind();
  return {get model() { return view; }};
}
