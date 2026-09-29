/** Fixed analysis capabilities. Each element mounts one musical presenter. */
export type AnalysisViewType = 'chords' | 'live-chord';

export type SlotKind = 'flow' | 'nameplate';
export type SlotSource = 'progression' | 'sounding';

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
    label: 'Chords',
    slot: {id: 'flow', kind: 'flow', source: 'progression', label: 'Chords'},
    needsScore: true,
    emptyLabel: 'No chord segments — nothing here sounds two notes together.',
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
