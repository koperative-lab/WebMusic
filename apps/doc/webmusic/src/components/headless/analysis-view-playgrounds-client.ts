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
  const code = (source: string): void => { if (scope.active) query('[data-hl-readout]').textContent = source; };
  return {query, feedback, listen, code};
}


/** The session keeps its cache while immutable score inputs are replaced. */
export function mountAnalysisSessionDemo(root: HTMLElement, scope: DemoScope): {readonly model: AnalysisSession} {
  const ui = controls(root, scope);
  const source = ui.query<HTMLSelectElement>('[data-session-score]');
  const pitch = ui.query<HTMLSelectElement>('[data-session-pitch]');
  const window = ui.query<HTMLSelectElement>('[data-session-window]');
  let score = followerDemoScore();
  let session = createAnalysisSession(score);
  let edits = 0;
  const paint = (): void => {
    if (!scope.active) return;
    const result = session.result;
    ui.query('[data-session-summary]').textContent = `${score.metadata.title} · ${result.key.tonic} ${result.key.mode} · ${edits} score update${edits === 1 ? '' : 's'}`;
    renderNoteChips(ui.query('[data-session-notes]'), score.parts.flatMap((part) => part.notes.map((note) => note.pitch?.toString() ?? 'Rest')));
    renderNoteChips(ui.query('[data-session-chords]'), result.roman.map((entry) => `${entry.chord || '—'} (${entry.roman || '—'}) · q${entry.startQuarters}–${entry.endQuarters}`), 'No chord segments');
    ui.query('[data-session-detail]').textContent = `${result.motifs.length} repeated motif${result.motifs.length === 1 ? '' : 's'} · ${result.issues.length} voice-leading issue${result.issues.length === 1 ? '' : 's'} · window ${window.value} quarters`;
    ui.code(`import {Pitch} from '@webmusic/score';\nimport {createAnalysisSession} from '@webmusic/score/analyze/headless';\n\n// score is your immutable ${source.value === 'minor' ? 'A minor' : 'C major'} Score.\nconst session = createAnalysisSession(score, {windowQuarters: ${window.value}});\nconst firstNote = score.parts[0].notes[0];\nconst next = score.edit((edit) => {\n  edit.updateNote(firstNote.id, {pitch: Pitch.parse('${pitch.value}')});\n});\nconst result = session.update(next);\n// Render result.key, result.roman, result.motifs and result.issues.\n// Session owns no external resources; release your references on teardown.`);
  };
  const replaceScore = (): void => {
    score = followerDemoScore(source.value === 'minor');
    pitch.value = source.value === 'minor' ? 'A3' : 'C4';
    session.update(score);
    edits += 1;
    paint();
  };
  ui.listen('[data-session-score]', 'change', replaceScore);
  ui.listen('[data-session-window]', 'change', () => {
    session = createAnalysisSession(score, {windowQuarters: Number(window.value)});
    paint();
    ui.feedback('Created a session with the selected chord window.');
  });
  ui.listen('[data-session-pitch]', 'change', () => {
    const note = score.parts[0].notes[0];
    score = score.edit((edit) => { edit.updateNote(note.id, {pitch: Pitch.parse(pitch.value)}); });
    session.update(score);
    edits += 1;
    paint();
    ui.feedback('Updated the immutable score and re-analyzed it with the same session.');
  });
  scope.listen(root, 'wm:headless-reset', () => {
    source.value = 'major'; pitch.value = 'C4'; window.value = '2'; edits = 0;
    score = followerDemoScore(); session = createAnalysisSession(score);
    ui.feedback(''); paint();
  });
  paint();
  return {get model() { return session; }};
}

const CHORDS: Record<string, readonly number[]> = {C: [60, 64, 67], Am: [57, 60, 64], F: [53, 57, 60], G7: [55, 59, 62, 65]};

/** Actual trackers receive each note; chord history is the API's bounded history. */
export function mountLiveTrackersDemo(root: HTMLElement, scope: DemoScope) {
  const ui = controls(root, scope);
  const held = new Set<number>();
  let lastInput: readonly number[] = [];
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
  const updateCode = (): void => ui.code(`import {createLiveChordTracker, createLiveKeyTracker} from '@webmusic/score/analyze/headless';\n\nconst chord = createLiveChordTracker({\n  onUpdate: ({chord, midis, history}) => {\n    // Render the held chord, pitches and up to eight recent chord names.\n  },\n});\nconst key = createLiveKeyTracker((result, heard) => {\n  // Render result.tonic, result.mode and heard.\n});\nconst midis = ${JSON.stringify(lastInput)};\nfor (const midi of midis) { chord.noteOn(midi); key.noteOn(midi); }\n// Release each note when your input ends:\nfor (const midi of midis) chord.noteOff(midi);\n// Reset musical state and release input listeners on teardown:\nchord.reset();\nkey.reset();`);
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
      lastInput = [...held]; updateCode();
    });
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-live-preset]')) {
    scope.listen(button, 'click', () => {
      release();
      lastInput = CHORDS[button.dataset.livePreset!];
      for (const midi of lastInput) press(midi);
      updateCode();
    });
  }
  ui.listen('[data-live-release]', 'click', () => { release(); lastInput = []; updateCode(); });
  scope.listen(root, 'wm:headless-reset', () => {
    held.clear(); chord.reset(); key.reset(); lastInput = [];
    paintKey(); updateCode(); ui.feedback('');
  });
  scope.add(() => { held.clear(); chord.reset(); key.reset(); });
  paintChord(); paintKey(); updateCode();
  return {chord, key, get state() { return chordState; }};
}

/** A tiny caller-owned renderer draws only the real model's visible notes. */
export function mountScoreWindowDemo(root: HTMLElement, scope: DemoScope): {readonly model: ScoreView} {
  const ui = controls(root, scope);
  const score: Score = followerDemoScore();
  const viewport = ui.query<HTMLSelectElement>('[data-window-viewport]');
  const position = ui.query<HTMLInputElement>('[data-window-position]');
  let view = createScoreView(score, {viewport: {startTime: 0, endTime: 2}});
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
    ui.code(`import {createScoreView} from '@webmusic/score/view/headless';\n\n// score is your immutable Score. Times are nominal seconds.\nconst view = createScoreView(score${state.viewport ? `, {viewport: {startTime: ${start}, endTime: ${end}}}` : ''});\nconst off = view.subscribe((state) => {\n  // Draw state.visibleNotes; highlight state.activeNotes.\n  // The application chooses the DOM, SVG or canvas renderer.\n});\nview.seek(${state.currentTime});\n// To show the full sequence: view.clearViewport();\n// On teardown:\noff();\nview.dispose();`);
  };
  const bind = (): void => { off = view.subscribe(paint); view.seek(0); };
  ui.listen('[data-window-viewport]', 'change', () => {
    if (viewport.value === 'all') view.clearViewport();
    else { const start = Number(viewport.value); view.setViewport(start, start + 2); }
  });
  ui.listen('[data-window-position]', 'input', () => { view.seek(Number(position.value)); });
  scope.listen(root, 'wm:headless-reset', () => {
    off(); view.dispose(); viewport.value = '0'; position.value = '0';
    view = createScoreView(score, {viewport: {startTime: 0, endTime: 2}});
    bind(); ui.feedback('');
  });
  scope.add(() => { off(); view.dispose(); });
  bind();
  return {get model() { return view; }};
}
