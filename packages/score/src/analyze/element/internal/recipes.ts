/** Fixed analysis capabilities. Each element mounts one musical presenter. */
export type AnalysisViewType = 'key' | 'chords' | 'roman' | 'voice-leading' | 'live-chord';

export type SlotKind = 'flow' | 'nameplate';
export type SlotSource = 'progression' | 'roman' | 'key-flow' | 'voice-flow' | 'sounding';

export interface SlotSpec {
  readonly id: 'flow' | 'hero';
  readonly kind: SlotKind;
  readonly source: SlotSource;
  readonly label: string;
}

export interface ViewRecipe {
  readonly id: AnalysisViewType;
  readonly label: string;
  readonly slot: SlotSpec;
  readonly needsScore: boolean;
  readonly emptyLabel: string;
}

const RECIPES: Readonly<Record<AnalysisViewType, ViewRecipe>> = Object.freeze({
  key: {
    id: 'key',
    label: 'Key',
    slot: {id: 'flow', kind: 'flow', source: 'key-flow', label: 'Key decisions'},
    needsScore: true,
    emptyLabel: 'No pitched notes — nothing to detect a key from.',
  },
  chords: {
    id: 'chords',
    label: 'Chords',
    slot: {id: 'flow', kind: 'flow', source: 'progression', label: 'Chords'},
    needsScore: true,
    emptyLabel: 'No chord segments — nothing here sounds two notes together.',
  },
  roman: {
    id: 'roman',
    label: 'Roman',
    slot: {id: 'flow', kind: 'flow', source: 'roman', label: 'Numerals'},
    needsScore: true,
    emptyLabel: 'No chord segments to number.',
  },
  'voice-leading': {
    id: 'voice-leading',
    label: 'Voice leading',
    slot: {id: 'flow', kind: 'flow', source: 'voice-flow', label: 'Voices'},
    needsScore: true,
    emptyLabel: 'No parallel motion, crossings or leaps over an octave — clean.',
  },
  'live-chord': {
    id: 'live-chord',
    label: 'Live chord',
    slot: {id: 'hero', kind: 'nameplate', source: 'sounding', label: 'Sounding now'},
    needsScore: false,
    emptyLabel: 'waiting for playback…',
  },
});

export function recipeFor(type: AnalysisViewType): ViewRecipe {
  return RECIPES[type];
}
