// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
vi.mock('@webmusic/ui/pitch', () => import('../../../ui/src/pitch'));
import {createModuleHandle, SOURCE_SCHEMAS, SourcePublisher, type ModuleHandle, type ModulePort} from '@webmusic/kernel/module';
import type {ScorePlaybackNote, ScorePlaybackSnapshot, ScorePlaybackSource} from '../../src/core';
import {definePitchViewElement, type PitchViewElement} from '../../src/view/element/score-pitch-view';
import {defineChordAnalysisElement} from '../../src/analyze/element/score-chord-analysis';

definePitchViewElement();
defineChordAnalysisElement();
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function note(occurrenceId: string, midi: number): ScorePlaybackNote {
  return {occurrenceId, noteId: occurrenceId, partId: 'piano', midi, nominalStartSeconds: 0, nominalEndSeconds: 2};
}

function snapshot(overrides: Partial<ScorePlaybackSnapshot> = {}): ScorePlaybackSnapshot {
  return {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'playing',
    nominalSeconds: 0, nominalDurationSeconds: 2, transportSeconds: 0, transportDurationSeconds: 2,
    rate: 1, activeNotes: [], ...overrides};
}

function playbackSource(initial: ScorePlaybackSnapshot) {
  let state = initial;
  const listeners = new Set<(value: ScorePlaybackSnapshot) => void>();
  const playback: ScorePlaybackSource = {
    snapshot: () => state,
    subscribe: vi.fn((listener) => { listeners.add(listener); listener(state); return () => listeners.delete(listener); }),
  };
  return {playback, get listeners() { return listeners.size; }, emit(next: ScorePlaybackSnapshot) {
    state = next;
    for (const listener of [...listeners]) listener(state);
  }};
}

function sourceModule(id: string) {
  const port = new SourcePublisher<ScorePlaybackSource>(SOURCE_SCHEMAS.score, {id: 'source'});
  const ports: ModulePort[] = [port];
  const module: ModuleHandle = createModuleHandle({id, ports: () => ports});
  return {module, port};
}

function pitchView(): PitchViewElement {
  const view = document.createElement('score-pitch-view') as PitchViewElement;
  view.setAttribute('type', 'keyboard');
  view.setAttribute('data-motion', 'none');
  return view;
}

describe('Score companions bound to a module source port (DEC-068)', () => {
  it('follow an explicit .inputModule, its republished source and an explicit null', () => {
    const first = playbackSource(snapshot({activeNotes: [note('a', 60)]}));
    const {module, port} = sourceModule('lead');
    port.ready(first.playback);
    const view = pitchView();
    view.inputModule = module;
    document.body.append(view);
    expect(view.active).toEqual([60]);
    expect(view.getAttribute('data-player-state')).toBe('ready');

    const second = playbackSource(snapshot({activeNotes: [note('b', 64)]}));
    port.ready(second.playback);
    expect(view.active).toEqual([64]);
    expect(first.listeners).toBe(0);

    port.loading();
    expect(view.active).toEqual([]);
    expect(view.getAttribute('data-player-state')).toBe('pending');
    expect(second.listeners).toBe(0);

    port.ready(second.playback);
    view.inputModule = null;
    expect(view.getAttribute('data-player-state')).toBe('missing');
    expect(second.listeners).toBe(0);
  });

  it('follows the selected module port when a port attribute is present', () => {
    const elementSource = playbackSource(snapshot({activeNotes: [note('element', 48)]}));
    const portSource = playbackSource(snapshot({activeNotes: [note('port', 72)]}));
    const {module, port} = sourceModule('owner');
    port.ready(portSource.playback);
    const owner = Object.assign(document.createElement('div'), {playback: elementSource.playback, module});
    owner.id = 'owner';
    const view = pitchView();
    view.setAttribute('input', '#owner');
    document.body.append(owner, view);
    expect(view.active).toEqual([48]);

    view.setAttribute('port', 'source');
    expect(view.active).toEqual([72]);
    expect(elementSource.listeners).toBe(0);

    view.setAttribute('port', 'missing');
    expect(view.active).toEqual([]);
    expect(portSource.listeners).toBe(0);
    view.remove();
  });

  it('lets an analysis element follow a module source by object binding', () => {
    const source = playbackSource(snapshot());
    const {module, port} = sourceModule('lead');
    port.ready(source.playback);
    const analysis = document.createElement('score-chord-analysis') as HTMLElement & {inputModule?: ModuleHandle | null};
    analysis.inputModule = module;
    document.body.append(analysis);
    expect(source.playback.subscribe).toHaveBeenCalled();
    expect(analysis.getAttribute('data-player-state')).toBe('ready');
    analysis.remove();
    expect(source.listeners).toBe(0);
  });
});
