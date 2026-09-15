// ---------------------------------------------------------------------------
// The contract between two sets of types that may never meet at runtime.
//
// `analyze/headless/**` is checked for DOM-freedom down to the level of a type
// annotation, and `@webmusic/ui` is an OPTIONAL peer — so score cannot import
// the kit's rendering types, and the projections declare structural twins of
// them instead. Twins drift. This file is the only thing that notices.
//
// It is a compile-time test with almost nothing to run: every assignment below
// is checked by `npm run typecheck:tests`, and if this file compiles, the two
// sides still agree. When it stops compiling the error names the field, which
// is the whole point — the alternative is a lane that silently renders nothing
// because a required property quietly changed its name.
// ---------------------------------------------------------------------------

import {describe, expect, it} from 'vitest';
import type {
  FretMark,
  FretboardState,
  PitchMark,
  StaffMark,
  StaffState,
} from '@webmusic/ui/pitch';
import type {
  ChipItem,
  ChipStripState,
  ChordNameCandidate,
  FlowBand,
  FlowBracket,
  FlowFlag,
  FlowLaneState,
  FlowTrack,
  HarmonyVoice,
  NameplateState,
  Severity,
  ToneRole as KitToneRole,
  WheelSegment,
  WheelState,
} from '@webmusic/ui/harmony';
import type {ToneRole} from '../../src/analyze/core/chord-spelling';
import type {
  ChipItemView,
  ChordNameView,
  FlowBandView,
  FlowBracketView,
  FlowFlagView,
  FlowLaneView,
  FlowTrackView,
  FretMarkView,
  FretboardView,
  HarmonyVoiceView,
  NameplateView,
  PitchMarkView,
  StaffMarkView,
  StaffView,
  TonalityView,
  WheelSegmentView,
} from '../../src/analyze/headless/workbench';

// The pitch surfaces: one projection, three docks that cannot disagree.
const _mark: PitchMark = {} as PitchMarkView;
const _staffMark: StaffMark = {} as StaffMarkView;
const _staff: StaffState = {} as StaffView;
const _fretMark: FretMark = {} as FretMarkView;
const _fretboard: FretboardState = {} as FretboardView;

// The harmony read-outs.
const _band: FlowBand = {} as FlowBandView;
const _track: FlowTrack = {} as FlowTrackView;
const _flag: FlowFlag = {} as FlowFlagView;
const _bracket: FlowBracket = {} as FlowBracketView;
const _lane: FlowLaneState = {} as FlowLaneView;
const _chip: ChipItem = {} as ChipItemView;
const _strip: ChipStripState = {items: [] as ChipItemView[]};
const _candidate: ChordNameCandidate = {} as ChordNameView;
const _voice: HarmonyVoice = {} as HarmonyVoiceView;
const _nameplate: NameplateState = {} as NameplateView;
const _segment: WheelSegment = {} as WheelSegmentView;
const _wheel: WheelState = {} as Omit<TonalityView, 'centre'>;
const _needle: WheelState['needle'] = ({} as TonalityView).needle;

// The two vocabularies that are declared twice on purpose (`harmony.ts` and
// `pitch.ts` may not import each other, and score may not import either), so
// they are pinned in BOTH directions — a widening on one side is as much a
// drift as a narrowing.
const _roleOut: KitToneRole = 'root' as ToneRole;
const _roleIn: ToneRole = 'ghost' as KitToneRole;
const _severityOut: Severity = 'error' as NonNullable<FlowBandView['severity']>;
const _severityIn: NonNullable<FlowBandView['severity']> = 'info' as Severity;

describe('score projections against the kit rendering types', () => {
  it('compiles, which is the assertion', () => {
    expect(_strip.items).toEqual([]);
    expect(_roleOut).toBe('root');
    expect(_roleIn).toBe('ghost');
  });
});
