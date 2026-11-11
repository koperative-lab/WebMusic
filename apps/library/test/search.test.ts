import {describe, expect, it} from 'vitest';
import {LIBRARY} from '../src/catalog.ts';
import {search} from '../src/search.ts';

const tags = (query: string, family?: 'all' | 'Score' | 'Audio') => search(LIBRARY, query, family).map((entry) => entry.tag);

describe('library search', () => {
  it('returns everything for an empty query, in catalog order', () => {
    expect(tags('')).toEqual(LIBRARY.map((entry) => entry.tag));
  });

  it('ranks tag matches first and accepts a tag in angle brackets', () => {
    expect(tags('player')[0]).toMatch(/-player$/);
    expect(tags('<score-sheet-view>')).toEqual(['score-sheet-view']);
  });

  it('matches synonyms, categories, summaries and members', () => {
    expect(tags('microphone')).toContain('audio-recorder');
    expect(tags('fft')).toContain('audio-spectrum-analyzer');
    expect(tags('theory')).toEqual(expect.arrayContaining(['score-chord-analysis', 'score-rhythm-analysis']));
    expect(tags('webscore:chordchange')).toEqual(['score-chord-analysis']);
  });

  it('requires every term and filters by family', () => {
    expect(tags('waveform editor')).toContain('audio-clip-view');
    expect(tags('waveform editor')).not.toContain('audio-oscilloscope');
    expect(tags('keyboard', 'Audio')).toEqual([]);
    expect(tags('', 'Score').every((tag) => tag.startsWith('score-'))).toBe(true);
    expect(tags('zzzz-nothing')).toEqual([]);
  });
});

describe('type search', () => {
  it('finds an element by one of its types', () => {
    expect(tags('bitcrusher')).toEqual(['score-effect']);
    expect(tags('stereometer')).toEqual(['audio-meter']);
    expect(tags('fretboard')).toContain('score-pitch-view');
  });
});
