// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {Duration, NoteId, PartId, Pitch, Rational, ScoreBuilder, VoiceId, type NoteData} from '../../src/core';
import {renderStaffVisualizer} from '../../src/view/render';
import type {StaffRenderOptions} from '../../src/view/api';

const q = (value: number) => Rational.from(value);
function fixture(notes: Array<Partial<NoteData> & {pitch: Pitch; onsetQuarters: Rational}>, config: StaffRenderOptions = {}) {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('piano'), name: 'Piano'});
  builder.addTempo({atQuarters: q(0), bpm: 60});
  notes.forEach((note, index) => builder.addNote(part, {
    id: NoteId(`note-${index}`), duration: Duration.quarter(), voice: VoiceId('melody'), ...note,
  }));
  const host = document.createElement('div');
  document.body.append(host);
  const rendered = renderStaffVisualizer(builder.build(), host, config);
  const head = (index: number) => host.querySelector<SVGElement>(`[data-note-id="note-${index}"]`)!;
  const event = (index: number) => head(index).closest<SVGElement>('[data-webscore-onset]')!;
  const active = () => [...host.querySelectorAll<SVGElement>('[data-webscore-note][data-active]')].map((element) => element.dataset.noteId);
  return {host, rendered, head, event, active};
}
afterEach(() => document.body.replaceChildren());

describe('notation-aware staff highlighting', () => {
  it.each([
    {pitches: ['C4', 'E4', 'G4'], noteHeight: 6},
    {pitches: ['C5', 'E5', 'G5'], noteHeight: 11},
  ])('highlights actual chord heads and their shared stem/flags: $pitches', ({pitches, noteHeight}) => {
    const {host, rendered, event, head} = fixture(pitches.map((pitch) => ({
      pitch: Pitch.parse(pitch), onsetQuarters: q(0), duration: Duration.sixteenth(),
    })), {noteHeight});
    expect(host.querySelectorAll('.vf-stem')).toHaveLength(1);
    expect(event(0)).toBe(event(1));
    expect(event(1)).toBe(event(2));
    rendered.redrawAtTime!(.1, false);
    for (let index = 0; index < pitches.length; index += 1) expect(head(index).hasAttribute('data-active')).toBe(true);
    expect(event(0).hasAttribute('data-active')).toBe(true);
    expect(event(0).contains(host.querySelector('.vf-stem'))).toBe(true);
    rendered.clearActiveNotes();
    expect(host.querySelector('[data-active]')).toBeNull();
    rendered.dispose!();
  });

  it('retains a chord stem until the last performed member ends while releasing only its head', () => {
    const {rendered, event, head} = fixture([
      {pitch: Pitch.parse('C4'), onsetQuarters: q(0), performed: {onsetSec: 0, durationSec: .25, velocity: 90}},
      {pitch: Pitch.parse('E4'), onsetQuarters: q(0), performed: {onsetSec: 0, durationSec: .5, velocity: 90}},
    ], {activeNoteRGB: '240, 84, 119'});
    rendered.redrawAtTime!(.1, false);
    expect(event(0).hasAttribute('data-active')).toBe(true);
    rendered.redrawAtTime!(.3, false);
    expect(head(0).hasAttribute('data-active')).toBe(false);
    expect(head(1).hasAttribute('data-active')).toBe(true);
    expect(event(0).hasAttribute('data-active')).toBe(true);
    expect(event(0).style.getPropertyValue('--webscore-staff-current')).toBe('var(--webscore-staff-active)');
    rendered.redrawAtTime!(.5, false);
    expect(event(0).hasAttribute('data-active')).toBe(false);
    rendered.dispose!();
  });

  it('keeps simultaneous independent voices and stems independent as they finish', () => {
    const {host, rendered, event, active} = fixture([
      {pitch: Pitch.parse('C4'), onsetQuarters: q(0), duration: Duration.quarter(), voice: VoiceId('lower')},
      {pitch: Pitch.parse('C5'), onsetQuarters: q(0), duration: Duration.half(), voice: VoiceId('upper')},
      {pitch: Pitch.parse('E5'), onsetQuarters: q(2), voice: VoiceId('upper')},
    ]);
    expect(host.querySelectorAll('.vf-stem')).toHaveLength(3);
    expect(event(0)).not.toBe(event(1));
    rendered.redrawAtTime!(.5, false);
    expect(active()).toEqual(['note-0', 'note-1']);
    rendered.redrawAtTime!(1, false);
    expect(active()).toEqual(['note-1']);
    expect(event(0).hasAttribute('data-active')).toBe(false);
    expect(event(1).hasAttribute('data-active')).toBe(true);
    rendered.redrawAtTime!(2, false);
    expect(active()).toEqual(['note-2']);
    rendered.dispose!();
  });

  it.each(['C4', 'G5'])('highlights both cross-bar tied fragments and releases them at the exact end: %s', (pitch) => {
    const {host, rendered} = fixture([{pitch: Pitch.parse(pitch), onsetQuarters: q(0), duration: new Duration({base: 5})}]);
    const heads = [...host.querySelectorAll('[data-note-id="note-0"]')];
    expect(heads).toHaveLength(2);
    expect(host.querySelectorAll('.vf-stem')).toHaveLength(1);
    rendered.redrawAtTime!(4.5, false);
    expect(heads.every((head) => head.hasAttribute('data-active'))).toBe(true);
    rendered.redrawAtTime!(5, false);
    expect(host.querySelector('[data-active]')).toBeNull();
    rendered.dispose!();
  });

  it('highlights a beam while any member sounds and keeps the following group independent', () => {
    const {host, rendered} = fixture(Array.from({length: 8}, (_, index) => ({
      pitch: Pitch.parse(['C4', 'D4', 'E4', 'F4'][index % 4]), onsetQuarters: q(index / 2), duration: Duration.eighth(),
    })));
    const beams = [...host.querySelectorAll<SVGElement>('[data-webscore-beam]')];
    expect(beams.length).toBe(2);
    rendered.redrawAtTime!(.75, false);
    expect(beams.map((beam) => beam.hasAttribute('data-active'))).toEqual([true, false]);
    rendered.redrawAtTime!(2.25, false);
    expect(beams.map((beam) => beam.hasAttribute('data-active'))).toEqual([false, true]);
    rendered.clearActiveNotes();
    expect(host.querySelector('[data-active]')).toBeNull();
    rendered.dispose!();
  });

  it('includes accidentals and dots without activating following whole notes or staff decorations', () => {
    const {host, rendered, event} = fixture([
      {pitch: Pitch.parse('C#4'), onsetQuarters: q(0), duration: Duration.dotted(Duration.quarter())},
      {pitch: Pitch.parse('F4'), onsetQuarters: q(4), duration: Duration.whole()},
    ]);
    expect(event(0).querySelectorAll('path').length).toBeGreaterThan(2);
    rendered.redrawAtTime!(1, false);
    expect(event(0).hasAttribute('data-active')).toBe(true);
    expect(event(1).hasAttribute('data-active')).toBe(false);
    expect(host.querySelector('.vf-clef[data-active], .vf-timesignature[data-active], .vf-stave[data-active]')).toBeNull();
    rendered.redrawAtTime!(4, false);
    expect(event(0).hasAttribute('data-active')).toBe(false);
    expect(event(1).hasAttribute('data-active')).toBe(true);
    rendered.dispose!();
  });
});
