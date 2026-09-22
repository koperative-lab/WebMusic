// @vitest-environment jsdom

import React from 'react';
import {act, cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId,
  type ScorePlaybackSnapshot, type ScorePlaybackSource} from '../../src/core';

vi.mock('../../src/play/headless', () => ({Player: class {
  constructor() { throw new Error('Borrowed views must not construct a Player'); }
}}));
import {StaffView} from '../../src/react/views';

afterEach(cleanup);

it('draws and clears actual staff notes when a source supplies activity without nominal time', () => {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('p'), name: 'Piano'});
  builder.addNote(part, {id: NoteId('n'), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
    duration: Duration.whole(), voice: VoiceId('v')});
  const score = builder.build();
  let snapshot: ScorePlaybackSnapshot = {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'playing', score,
    nominalSeconds: null, nominalDurationSeconds: score.durationSeconds, transportSeconds: null,
    transportDurationSeconds: null, rate: null, activeNotes: [{occurrenceId: 'sound-1', partId: 'p', noteId: 'n',
      midi: 72, nominalStartSeconds: 0, nominalEndSeconds: score.durationSeconds}]};
  let notify: (state: ScorePlaybackSnapshot) => void = () => {};
  const source: ScorePlaybackSource = {snapshot: () => snapshot,
    subscribe(listener) { notify = listener; listener(snapshot); return () => { notify = () => {}; }; }};
  render(<StaffView playback={source} />);
  const root = screen.getByRole('img', {name: 'Musical staff'});
  expect(root.querySelector('[data-note-id="n"][data-active]')).not.toBeNull();
  act(() => {
    snapshot = {...snapshot, revision: 1, activeNotes: []};
    notify(snapshot);
  });
  expect(root.querySelector('[data-note-id="n"][data-active]')).toBeNull();
});

it('retains the real staff playhead through paused snapshots with no sounding notes', () => {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('p'), name: 'Piano'});
  builder.addNote(part, {id: NoteId('n'), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
    duration: Duration.whole(), voice: VoiceId('v')});
  const score = builder.build();
  let snapshot: ScorePlaybackSnapshot = {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'paused', score,
    nominalSeconds: 0.5, nominalDurationSeconds: score.durationSeconds, transportSeconds: 0.25,
    transportDurationSeconds: score.durationSeconds / 2, rate: 2, activeNotes: []};
  let notify: (state: ScorePlaybackSnapshot) => void = () => {};
  const source: ScorePlaybackSource = {snapshot: () => snapshot,
    subscribe(listener) { notify = listener; listener(snapshot); return () => { notify = () => {}; }; }};
  render(<StaffView playback={source} />);
  const root = screen.getByRole('img', {name: 'Musical staff'});
  const cursor = root.querySelector<HTMLDivElement>('[data-webscore-staff-playhead]')!;
  expect(cursor).not.toBeNull();
  expect(cursor.dataset.time).toBe('0.5');
  expect(cursor.hidden).toBe(false);
  expect(root.querySelector('[data-note-id="n"][data-active]')).not.toBeNull();
  act(() => {
    snapshot = {...snapshot, revision: 1, nominalSeconds: 1, transportSeconds: 0.5};
    notify(snapshot);
  });
  expect(cursor.dataset.time).toBe('1');
  expect(cursor.hidden).toBe(false);
});

it('positions the actual OSMD adapter from a paused source without a note event', async () => {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('p'), name: 'Piano'});
  builder.addNote(part, {id: NoteId('n'), pitch: Pitch.parse('C4'), onsetQuarters: Rational.ZERO,
    duration: Duration.whole(), voice: VoiceId('v')});
  const score = builder.build();
  let snapshot: ScorePlaybackSnapshot = {revision: 0, sourceRevision: 0, readiness: 'ready', state: 'paused', score,
    nominalSeconds: 1, nominalDurationSeconds: 2, transportSeconds: 0.5,
    transportDurationSeconds: 1, rate: 2, activeNotes: []};
  let notify: (state: ScorePlaybackSnapshot) => void = () => {};
  const source: ScorePlaybackSource = {snapshot: () => snapshot,
    subscribe(listener) { notify = listener; listener(snapshot); return () => {}; }};
  let index = 0;
  const positions = [0, 0.25, 0.5, 0.75, 1];
  const show = vi.fn();
  const osmd = {load: async () => {}, render() {}, clear() {}, cursor: {
    show, hide() {}, reset() { index = 0; }, next() { index += 1; }, update() {},
    iterator: {get EndReached() { return index >= positions.length - 1; },
      currentTimeStamp: {get RealValue() { return positions[index]; }}},
  }};
  render(<StaffView playback={source} osmd={{musicXML: '<score-partwise/>', osmd}} />);
  await act(async () => {});
  expect(index).toBe(2);
  expect(show).toHaveBeenCalled();
  act(() => {
    snapshot = {...snapshot, revision: 1, nominalSeconds: 0.5, transportSeconds: 0.25};
    notify(snapshot);
  });
  expect(index).toBe(1);
});
