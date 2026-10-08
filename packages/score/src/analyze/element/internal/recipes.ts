/** Fixed analysis capabilities. Each element mounts one musical presenter. */
export type AnalysisViewType = 'chords' | 'live-chord' | 'intervals' | 'scale' | 'rhythm';

export type SlotKind = 'flow' | 'nameplate';
export type SlotSource = 'progression' | 'sounding' | 'intervals' | 'scale' | 'rhythm';

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
  chords: {
    id: 'chords',
    label: 'Score chords',
    slot: {id: 'flow', kind: 'flow', source: 'progression', label: 'Score chord inspection'},
    needsScore: true,
    emptyLabel: 'No pitched notes to inspect in this passage.',
  },
  'live-chord': {
    id: 'live-chord',
    label: 'Live chord',
    slot: {id: 'hero', kind: 'nameplate', source: 'sounding', label: 'Sounding now'},
    needsScore: false,
    emptyLabel: 'waiting for playback…',
  },
  intervals: {
    id: 'intervals', label: 'Intervals',
    slot: {id: 'flow', kind: 'flow', source: 'intervals', label: 'Spelled interval inspection'},
    needsScore: true,
    emptyLabel: 'No unambiguous note pairs — select notes or a voice.',
  },
  scale: {
    id: 'scale', label: 'Scale degrees',
    slot: {id: 'flow', kind: 'flow', source: 'scale', label: 'Notes in a chosen scale'},
    needsScore: true,
    emptyLabel: 'Choose a tonic and scale to inspect note degrees.',
  },
  rhythm: {
    id: 'rhythm', label: 'Rhythm and meter',
    slot: {id: 'flow', kind: 'flow', source: 'rhythm', label: 'Rhythm and grouped meter inspection'},
    needsScore: true,
    emptyLabel: 'No written rhythm events in this passage.',
  },
});

export function recipeFor(type: AnalysisViewType): ViewRecipe {
  return RECIPES[type];
}
