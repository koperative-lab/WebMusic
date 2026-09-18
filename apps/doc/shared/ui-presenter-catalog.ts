export type UiPresenterClassSlug =
  | 'transport-time'
  | 'parameters-gestures'
  | 'mixing-capture'
  | 'notes'
  | 'views-analysis'
  | 'layout-feedback';

export type UiPresenterName =
  | 'transport'
  | 'timeline'
  | 'minimap'
  | 'playlist'
  | 'parameter'
  | 'macro'
  | 'panel'
  | 'envelope'
  | 'lfo'
  | 'eq'
  | 'mixer'
  | 'meter'
  | 'recorder'
  | 'note'
  | 'stage'
  | 'status'
  | 'track-list'
  | 'analysis'
  | 'pitch'
  | 'harmony'
  | 'workbench';

export interface UiPresenterClass {
  slug: UiPresenterClassSlug;
  label: string;
  summary: string;
}

export type UiPresenterControlKind = 'boolean' | 'number' | 'text' | 'enum';

export interface UiPresenterControlChoice {
  /** Serializable value passed to the live demo controller. */
  value: string | number | boolean;
  label: string;
  /** TypeScript expression printed in the live mount-call readout. */
  literal?: string;
}

export interface UiPresenterControlSpec {
  name: string;
  kind: UiPresenterControlKind;
  /** Required state fields do not offer an unset sentinel. */
  required?: boolean;
  initial?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  fallback?: string;
  placeholder?: string;
  choices?: readonly UiPresenterControlChoice[];
  note: string;
  /** Honest explanation when the real effect is not visual in this demo. */
  inert?: string;
}

export interface UiPresenterEntry {
  presenter: UiPresenterName;
  classSlug: UiPresenterClassSlug;
  label: string;
  summary: string;
  /** Canonical direct-import example for the public presenter entry. */
  api: string;
  /** Readout call when the entry deviates from mountX(host, binding, options?). */
  invocation?: {
    name: string;
    arguments: string;
    initial?: string;
    variant?: 'stage-compound';
  };
  /** Concrete Element tags in the first-release ledger that use this presenter directly or through a compound presenter. */
  consumerTags: readonly string[];
  /** One-line operating instruction shown above the real presenter. */
  hint?: string;
  /** Complete State surface for the generated live control strip. */
  state?: readonly UiPresenterControlSpec[];
  /** Complete mount Options surface for the generated live control strip. */
  options?: readonly UiPresenterControlSpec[];
}

/** The six functional groups from `packages/ui/README.md` §10. */
export const UI_PRESENTER_CLASSES: readonly UiPresenterClass[] = [
  {
    slug: 'transport-time',
    label: 'Transport and navigation',
    summary: 'Playback, seeking, visible ranges and selection through playlists or indexed rows.',
  },
  {
    slug: 'parameters-gestures',
    label: 'Parameters and modulation',
    summary: 'Parameter editing, macro controls, envelopes, modulation and equalizer curves.',
  },
  {
    slug: 'mixing-capture',
    label: 'Mixing and capture',
    summary: 'Channel mixing, realtime metering and record/play/export workflows.',
  },
  {
    slug: 'notes',
    label: 'Note input',
    summary: 'Piano, grid and chord surfaces with reusable musical input interaction.',
  },
  {
    slug: 'views-analysis',
    label: 'Views and analysis',
    summary: 'Passive pitch and harmony readouts, analytical cards, timelines and reports.',
  },
  {
    slug: 'layout-feedback',
    label: 'Layout and feedback',
    summary: 'Shared panels, rendering hosts, workbench shells and loading or failure feedback.',
  },
] as const;

/** The complete set of 21 public `@webmusic/ui` presenter subpaths on main. */
const localizationOption: UiPresenterControlSpec = {
  name: 'localization',
  kind: 'text',
  note: 'Borrow a shared createUILocalization source for messages and human-readable formatting.',
  inert: 'This is an object with a subscription, not a scalar. See the UI API localization example for changing language in place.',
};

export const UI_PRESENTER_CATALOG: readonly UiPresenterEntry[] = [
  {
    presenter: 'transport',
    classSlug: 'transport-time',
    label: 'Transport',
    summary: 'Accessible play/pause, seek and elapsed-time controls backed by caller-owned state.',
    api: `import {mountTransport} from '@webmusic/ui/transport';

const handle = mountTransport(host, {
  snapshot: () => state,
  play: () => start(),
  pause: () => stop(),
  seekFraction: (fraction) => seekTo(fraction),
  subscribe: (notify) => store.subscribe(notify),
});`,
    consumerTags: ['score-player'],
    hint: 'Press Play, drag the seek control, then change State or Options; surface seek also supports the arrow keys.',
    state: [
      {
        name: 'playing',
        kind: 'boolean',
        required: true,
        initial: false,
        note: 'Paints the toggle as Play or Pause and drives its pressed state.',
      },
      {
        name: 'progress',
        kind: 'number',
        initial: 0.18,
        min: 0,
        max: 1,
        step: 0.01,
        note: 'A 0–1 fraction used by the seek value and progress fill.',
      },
      {
        name: 'seconds',
        kind: 'number',
        initial: 13,
        min: 0,
        step: 1,
        fallback: 'progress × duration',
        note: 'Elapsed seconds used by the time readout and accessible seek value.',
      },
      {
        name: 'duration',
        kind: 'number',
        initial: 72,
        min: 0,
        step: 1,
        fallback: '0',
        note: 'Total seconds used to format time and derive a missing seconds value.',
      },
      {
        name: 'disabled',
        kind: 'boolean',
        initial: false,
        fallback: 'off',
        note: 'Disables play and removes seeking from pointer and keyboard interaction.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'label',
        kind: 'text',
        fallback: 'Transport',
        placeholder: 'Transport',
        note: 'Prefixes the seek control accessible name.',
        inert: 'Changes the real accessible name; the presenter has no visual label.',
      },
      {
        name: 'showTime',
        kind: 'boolean',
        fallback: 'on',
        note: 'Shows or removes the elapsed / total time readout.',
      },
      {
        name: 'seekControl',
        kind: 'enum',
        fallback: 'native',
        choices: [
          {value: 'native', label: 'native', literal: "'native'"},
          {value: 'surface', label: 'surface', literal: "'surface'"},
          {value: false, label: 'false', literal: 'false'},
        ],
        note: 'Chooses a native range, an ARIA surface slider, or no seek control.',
      },
      {
        name: 'seek',
        kind: 'boolean',
        fallback: 'on',
        note: 'Compatibility switch used only while seekControl is unset.',
      },
      {
        name: 'stylesheet',
        kind: 'boolean',
        fallback: 'on',
        note: 'Installs or omits the exported transport stylesheet.',
      },
      {
        name: 'playLabel',
        kind: 'text',
        fallback: 'Play',
        placeholder: 'Play',
        note: 'Accessible name and title while stopped.',
        inert: 'Changes the real accessible name and title, not visible button text.',
      },
      {
        name: 'pauseLabel',
        kind: 'text',
        fallback: 'Pause',
        placeholder: 'Pause',
        note: 'Accessible name and title while playing.',
        inert: 'Changes the real accessible name and title, not visible button text.',
      },
      {
        name: 'icon',
        kind: 'enum',
        fallback: 'built-in glyphs',
        choices: [
          {
            value: 'custom',
            label: 'custom text glyph',
            literal: "(playing) => host.ownerDocument.createTextNode(playing ? 'Ⅱ' : '▶')",
          },
        ],
        note: 'Replaces the built-in play and pause SVG nodes.',
      },
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {
            value: 'demo',
            label: 'demo compatibility hooks',
            literal:
              "{root: 'demo-transport', play: 'demo-play', track: 'demo-track', seek: 'demo-seek', fill: 'demo-fill', time: 'demo-time'}",
          },
        ],
        note: 'Adds compatibility classes alongside the canonical classes.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {
            value: 'demo',
            label: 'demo part hooks',
            literal:
              "{root: 'demo-root', play: 'demo-play', track: 'demo-track', seek: 'demo-seek', fill: 'demo-fill', time: 'demo-time'}",
          },
        ],
        note: 'Adds part tokens alongside the canonical part names.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal:
              '(error) => { host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error); }',
          },
        ],
        note: 'Receives snapshot, command, subscription, icon and cleanup failures.',
        inert: 'The healthy demo does not manufacture an error just to call this hook.',
      },
    ],
  },
  {
    presenter: 'timeline',
    classSlug: 'transport-time',
    label: 'Timeline',
    summary: 'A domain-neutral ruler with regions, loop, selection, playhead and optional seeking.',
    api: `import {mountTimeline} from '@webmusic/ui/timeline';

const handle = mountTimeline(host, {
  snapshot: () => state,
  seek: (position) => seekTo(position),
  selectRegion: (id, {additive}) => select(id, additive),
  subscribe: (notify) => store.subscribe(notify),
});`,
    consumerTags: ['score-view'],
    hint: 'Click the lane to seek, select a region, then change State or Options; the hidden range also supports the keyboard.',
    state: [
      {
        name: 'duration',
        kind: 'number',
        required: true,
        initial: 32,
        min: 0,
        step: 1,
        note: 'Defines the complete domain used to clamp regions, ranges and the playhead.',
      },
      {
        name: 'viewport',
        kind: 'enum',
        fallback: 'full duration',
        choices: [{value: 'middle', label: '8–24 window'}],
        note: 'Limits the visible ruler and lane to a start/end range.',
      },
      {
        name: 'playhead',
        kind: 'number',
        initial: 3,
        min: 0,
        step: 0.5,
        fallback: '0',
        note: 'Positions the playhead when it falls inside the visible viewport.',
      },
      {
        name: 'ticks',
        kind: 'enum',
        initial: 'bars',
        fallback: 'automatic ruler',
        choices: [{value: 'bars', label: 'labelled bars'}],
        note: 'Supplies labelled, non-uniform ruler ticks instead of generated major ticks.',
      },
      {
        name: 'selection',
        kind: 'enum',
        initial: '10-14',
        fallback: 'no selection',
        choices: [{value: '10-14', label: '10–14'}],
        note: 'Paints a non-interactive selected range over the lane.',
      },
      {
        name: 'loop',
        kind: 'enum',
        initial: '8-24',
        fallback: 'no loop',
        choices: [{value: '8-24', label: '8–24'}],
        note: 'Paints a non-interactive loop range behind selection and playhead.',
      },
      {
        name: 'regions',
        kind: 'enum',
        required: true,
        initial: 'arrangement',
        choices: [
          {value: 'arrangement', label: 'arrangement regions'},
          {value: 'markers', label: 'regions + markers'},
        ],
        note: 'Rebuilds the labelled region and point-marker buttons in the lane.',
      },
      {
        name: 'disabled',
        kind: 'boolean',
        initial: false,
        fallback: 'off',
        note: 'Disables region selection and seeking while preserving the painted state.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'label',
        kind: 'text',
        fallback: 'Timeline',
        placeholder: 'Timeline',
        note: 'Names the timeline group and prefixes the playhead range name.',
        inert: 'Changes real accessible names; the presenter has no visual heading.',
      },
      {
        name: 'majorStep',
        kind: 'number',
        min: 0.01,
        step: 0.25,
        fallback: 'derived readable interval',
        note: 'Sets the generated major-tick interval when ticks is unset.',
      },
      {
        name: 'keyboardStep',
        kind: 'number',
        min: 0.01,
        step: 0.25,
        fallback: 'majorStep ÷ 4',
        note: 'Sets the hidden range input step used for keyboard seeking.',
      },
      {
        name: 'formatPosition',
        kind: 'enum',
        fallback: 'adaptive numeric labels',
        choices: [
          {
            value: 'beats',
            label: 'Beat n labels',
            literal: "(position) => `Beat ${position.toFixed(1).replace(/\\.0$/, '')}`",
          },
        ],
        note: 'Formats generated tick labels and the playhead accessible value.',
      },
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {
            value: 'demo',
            label: 'demo compatibility hooks',
            literal: "{root: 'demo-timeline', ruler: 'demo-ruler', tick: 'demo-tick', tickLabel: 'demo-tick-label', lane: 'demo-lane', region: 'demo-region', marker: 'demo-marker', label: 'demo-label', selection: 'demo-selection', loop: 'demo-loop', playhead: 'demo-playhead', seek: 'demo-seek'}",
          },
        ],
        note: 'Adds compatibility classes alongside every canonical timeline class.',
        inert: 'Adds real DOM hooks, but this neutral demo does not attach compatibility CSS.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {
            value: 'demo',
            label: 'demo part hooks',
            literal: "{root: 'demo-root', ruler: 'demo-ruler', tick: 'demo-tick', tickLabel: 'demo-tick-label', lane: 'demo-lane', region: 'demo-region', marker: 'demo-marker', label: 'demo-label', selection: 'demo-selection', loop: 'demo-loop', playhead: 'demo-playhead', seek: 'demo-seek'}",
          },
        ],
        note: 'Adds part tokens alongside every canonical timeline part.',
        inert: 'Adds real part hooks, but the demo host does not style those extra tokens.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal:
              '(error) => { host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error); }',
          },
        ],
        note: 'Receives snapshot, command, subscription and cleanup failures.',
        inert: 'The healthy demo does not manufacture an error to exercise this callback.',
      },
    ],
  },
  {
    presenter: 'minimap',
    classSlug: 'transport-time',
    label: 'Minimap',
    summary: 'A DPR-aware overview canvas with a draggable and keyboard-accessible range brush.',
    api: `import {mountMinimap} from '@webmusic/ui/minimap';

const handle = mountMinimap(host, {
  snapshot: () => state,
  draw: (frame) => drawOverview(frame),
  setRange: (start, end) => setViewport(start, end),
  seek: (value) => seekTo(value),
  subscribe: (notify) => store.subscribe(notify),
});`,
    consumerTags: [],
    hint: 'Drag the brush or either edge, click the canvas to seek, then try Arrow, Shift+Arrow, Home and End on the brush.',
    state: [
      {
        name: 'minimum',
        kind: 'number',
        required: true,
        initial: 0,
        step: 1,
        note: 'Defines the lower bound of the overview domain.',
      },
      {
        name: 'maximum',
        kind: 'number',
        required: true,
        initial: 120,
        step: 1,
        note: 'Defines the upper bound of the overview domain.',
      },
      {
        name: 'start',
        kind: 'number',
        initial: 24,
        step: 1,
        fallback: 'no brush',
        note: 'Sets one edge of the visible-range brush after normalization.',
      },
      {
        name: 'end',
        kind: 'number',
        initial: 64,
        step: 1,
        fallback: 'no brush',
        note: 'Sets the other edge; both start and end are required to show the brush.',
      },
      {
        name: 'disabled',
        kind: 'boolean',
        initial: false,
        fallback: 'off',
        note: 'Disables pointer and keyboard range changes and dims the brush.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'label',
        kind: 'text',
        fallback: 'Visible range',
        placeholder: 'Visible range',
        note: 'Sets the range brush accessible name.',
        inert: 'Changes the real accessible name; the presenter has no visual label.',
      },
      {
        name: 'fallbackWidth',
        kind: 'number',
        min: 1,
        step: 1,
        fallback: '320',
        note: 'Supplies CSS width when the mounted root cannot report one.',
        inert: 'The live host has a measured width, so this fallback is not used here.',
      },
      {
        name: 'fallbackHeight',
        kind: 'number',
        min: 1,
        step: 1,
        fallback: '40',
        note: 'Supplies CSS height when the mounted root cannot report one.',
        inert: 'The live host has a measured height, so this fallback is not used here.',
      },
      {
        name: 'edgeSize',
        kind: 'number',
        min: 1,
        step: 1,
        fallback: '8',
        note: 'Sets the pointer hit distance that chooses edge resize over range move.',
      },
      {
        name: 'keyboardStep',
        kind: 'number',
        min: 0.001,
        max: 1,
        step: 0.05,
        fallback: '0.25',
        note: 'Moves the brush by this fraction of its width for each Arrow key.',
      },
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {
            value: 'demo',
            label: 'demo compatibility hooks',
            literal: "{root: 'demo-minimap', canvas: 'demo-canvas', brush: 'demo-brush'}",
          },
        ],
        note: 'Adds compatibility classes to the root, canvas and brush.',
        inert: 'Adds real DOM hooks, but this neutral demo does not attach compatibility CSS.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {
            value: 'demo',
            label: 'demo part hooks',
            literal: "{root: 'demo-root', canvas: 'demo-canvas', brush: 'demo-brush'}",
          },
        ],
        note: 'Adds part tokens to the root, canvas and brush.',
        inert: 'Adds real part hooks, but the demo host does not style those extra tokens.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal:
              '(error) => { host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error); }',
          },
        ],
        note: 'Receives draw, snapshot, command, subscription, resize and cleanup failures.',
        inert: 'The healthy demo does not manufacture an error to exercise this callback.',
      },
    ],
  },
  {
    presenter: 'playlist',
    classSlug: 'transport-time',
    label: 'Playlist',
    summary: 'Playlist transport, track selection and per-entry loading or error state.',
    api: `import {mountPlaylist} from '@webmusic/ui/playlist';

const handle = mountPlaylist(host, {
  snapshot: () => state,
  toggle: () => player.toggle(),
  previous: () => player.previous(),
  next: () => player.next(),
  seek: (fraction) => player.seek(fraction),
  select: (id) => player.select(id),
  subscribe: (notify) => store.subscribe(notify),
});`,
    consumerTags: [],
    hint: 'Use Previous, Play and Next, drag Seek, or choose a row; then expose loading/error items or change Options.',
    state: [
      {
        name: 'playing',
        kind: 'boolean',
        required: true,
        initial: false,
        note: 'Paints the transport toggle as Play or Pause.',
      },
      {
        name: 'progress',
        kind: 'number',
        required: true,
        initial: 0.12,
        min: 0,
        max: 1,
        step: 0.01,
        note: 'Sets the current entry seek value after clamping to 0–1.',
      },
      {
        name: 'disabled',
        kind: 'boolean',
        initial: false,
        fallback: 'off',
        note: 'Disables the transport buttons and seek range.',
      },
      {
        name: 'items',
        kind: 'enum',
        required: true,
        initial: 'ready',
        choices: [
          {value: 'ready', label: 'four ready entries'},
          {value: 'mixed', label: 'loading + error states'},
          {value: 'single', label: 'single entry'},
        ],
        note: 'Rebuilds the ordered rows when identity/order changes and patches active status.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'label',
        kind: 'text',
        fallback: 'Playlist',
        placeholder: 'Playlist',
        note: 'Sets the ordered list accessible name.',
        inert: 'Changes the real accessible name; the presenter has no visual heading.',
      },
      {
        name: 'stylesheet',
        kind: 'boolean',
        fallback: 'on',
        note: 'Installs or omits the exported playlist stylesheet.',
      },
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {
            value: 'demo',
            label: 'demo compatibility hooks',
            literal: "{root: 'demo-playlist', bar: 'demo-bar', button: 'demo-button', seek: 'demo-seek', list: 'demo-list', item: 'demo-item'}",
          },
        ],
        note: 'Adds compatibility classes alongside canonical playlist classes.',
        inert: 'Adds real DOM hooks, but this neutral demo does not attach compatibility CSS.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {
            value: 'demo',
            label: 'demo part hooks',
            literal: "{root: 'demo-root', bar: 'demo-bar', button: 'demo-button', seek: 'demo-seek', list: 'demo-list', item: 'demo-item'}",
          },
        ],
        note: 'Adds part tokens alongside canonical playlist parts.',
        inert: 'Adds real part hooks, but the demo host does not style those extra tokens.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal:
              '(error) => { host.dataset.presenterDemoError = error instanceof Error ? error.message : String(error); }',
          },
        ],
        note: 'Receives snapshot, command, subscription and cleanup failures.',
        inert: 'The healthy demo does not manufacture an error to exercise this callback.',
      },
    ],
  },
  {
    presenter: 'parameter',
    classSlug: 'parameters-gestures',
    label: 'Parameter rack',
    summary: 'An accessible rotary-control rack with stable per-item input and node accessors.',
    api: `import {mountParameterRack} from '@webmusic/ui/parameter';

const handle = mountParameterRack(host, binding, options);`,
    consumerTags: ['synth-panel'],
    hint: 'Drag a knob vertically or focus it and use the range keys; State notifies the binding and Options remount the rack.',
    state: [
      {
        name: 'parameters',
        kind: 'enum',
        required: true,
        initial: 'standard',
        choices: [
          {value: 'standard', label: 'four grouped controls'},
          {value: 'single', label: 'one control'},
          {value: 'empty', label: 'empty rack'},
        ],
        note: 'Selects the caller-owned ParameterRackItem list painted by the demo.',
      },
      {
        name: 'disabled',
        kind: 'boolean',
        initial: false,
        fallback: 'off',
        note: 'Disables every range input in the rack.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'layout',
        kind: 'enum',
        fallback: 'flat',
        choices: [
          {value: 'flat', label: 'flat', literal: "'flat'"},
          {value: 'grouped', label: 'grouped', literal: "'grouped'"},
        ],
        note: 'Borders individual items or arranges them inside named groups.',
      },
      {
        name: 'emptyLabel',
        kind: 'text',
        fallback: 'No parameters',
        placeholder: 'No parameters',
        note: 'Labels the placeholder when the parameters list is empty.',
      },
      {
        name: 'formatValue',
        kind: 'enum',
        fallback: 'built-in formatter',
        choices: [
          {value: 'compact', label: 'compact engineering', literal: '(parameter, value) => formatCompact(parameter, value)'},
        ],
        note: 'Formats each current value and its aria-valuetext.',
      },
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {value: 'demo', label: 'demo compatibility hooks', literal: "{root: 'demo-transport', group: 'demo-parameter-group', groupLabel: 'demo-parameter-group-label', items: 'demo-parameter-items', item: 'demo-parameter-item', label: 'demo-parameter-label', control: 'demo-parameter-control', track: 'demo-parameter-track', fill: 'demo-parameter-fill', pointer: 'demo-parameter-pointer', input: 'demo-parameter-input', value: 'demo-parameter-value', empty: 'demo-parameter-empty'}"},
        ],
        note: 'Adds compatibility classes alongside all canonical rack classes.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {value: 'demo', label: 'demo part hooks', literal: "{root: 'demo-root', group: 'demo-group', groupLabel: 'demo-group-label', items: 'demo-items', item: 'demo-item', label: 'demo-label', control: 'demo-control', track: 'demo-track', fill: 'demo-fill', pointer: 'demo-pointer', input: 'demo-input', value: 'demo-value', empty: 'demo-empty'}"},
        ],
        note: 'Adds part tokens alongside all canonical part names.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {value: 'report', label: 'report demo errors', literal: '(error) => report(error)'},
        ],
        note: 'Receives snapshot, formatter, command, subscription and cleanup failures.',
        inert: 'The healthy demo does not manufacture an error just to call this hook.',
      },
    ],
  },
  {
    presenter: 'macro',
    classSlug: 'parameters-gestures',
    label: 'Macro controls',
    summary: 'A macro control or compound macro rack with read-only destination values.',
    api: `import {mountMacro, mountMacroRack} from '@webmusic/ui/macro';

const handle = mountMacro(host, binding, options);`,
    invocation: {
      name: 'mountMacroRack',
      arguments: 'host, bindings',
    },
    consumerTags: ['synth-panel'],
    hint: 'Drag either rack knob; State edits the first binding, while rack Options remount both real macro children.',
    state: [
      {name: 'label', kind: 'text', required: true, initial: 'MORPH', note: 'Labels the rotary control.'},
      {name: 'value', kind: 'number', required: true, initial: 0.38, min: 0, max: 1, step: 0.01, note: 'Normalized macro value painted as a percentage.'},
      {
        name: 'targets',
        kind: 'enum',
        required: true,
        initial: 'assigned',
        choices: [
          {value: 'assigned', label: 'three destinations'},
          {value: 'alternate', label: 'two destinations'},
          {value: 'empty', label: 'no destinations'},
        ],
        note: 'Selects the read-only destination list supplied by the caller.',
      },
      {name: 'disabled', kind: 'boolean', initial: false, fallback: 'off', note: 'Disables the nested macro range input.'},
    ],
    options: [
      localizationOption,
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {
            value: 'demo',
            label: 'demo compatibility hooks',
            literal: "{root: 'demo-macro-rack', item: 'demo-macro-item'}",
          },
        ],
        note: 'Adds compatibility classes to the rack root and every item host.',
        inert: 'The added class hooks are inspectable but intentionally carry no demo skin.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {
            value: 'demo',
            label: 'demo part hooks',
            literal: "{root: 'demo-root', item: 'demo-item'}",
          },
        ],
        note: 'Adds part tokens beside the rack root and every item host.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [{value: 'report', label: 'report demo errors', literal: '(error) => report(error)'}],
        note: 'Receives nested parameter and macro update failures from every rack child.',
        inert: 'The healthy demo does not manufacture an error just to call this hook.',
      },
    ],
  },
  {
    presenter: 'panel',
    classSlug: 'layout-feedback',
    label: 'Section panel',
    summary: 'A compound section-and-slot skeleton for composing specialized presenters.',
    api: `import {mountSectionPanel} from '@webmusic/ui/panel';

const handle = mountSectionPanel(host, sections, options);`,
    invocation: {
      name: 'mountSectionPanel',
      arguments: 'host, sections',
    },
    consumerTags: ['synth-panel'],
    hint: 'Change Options to remount the same three presenter slots with accessibility and compatibility hooks applied.',
    options: [
      {
        name: 'label',
        kind: 'text',
        fallback: 'no group role',
        placeholder: 'Synth voice controls',
        note: 'Adds role=group and this accessible name to the panel root.',
        inert: 'Changes the real accessibility tree; the panel has no visual heading.',
      },
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [{value: 'demo', label: 'demo compatibility hooks', literal: "{root: 'demo-transport', section: 'demo-panel-section', slot: 'demo-panel-slot'}"}],
        note: 'Adds compatibility classes to root, sections and slots.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [{value: 'demo', label: 'demo part hooks', literal: "{root: 'demo-root', section: 'demo-section', slot: 'demo-slot'}"}],
        note: 'Adds part tokens to root, sections and slots.',
      },
      {
        name: 'styleText',
        kind: 'enum',
        fallback: 'no compatibility rules',
        choices: [{value: 'demo', label: 'section accent rule', literal: "'.wui-section-panel__section { border-left: 3px solid currentColor; }'"}],
        note: 'Appends caller compatibility CSS after the canonical panel rules.',
      },
    ],
  },
  {
    presenter: 'envelope',
    classSlug: 'parameters-gestures',
    label: 'Envelope',
    summary: 'An accessible ADSR editor with pointer handles and equivalent range inputs.',
    api: `import {mountEnvelope} from '@webmusic/ui/envelope';

const handle = mountEnvelope(host, binding, options);`,
    consumerTags: ['synth-panel'],
    hint: 'Drag the three curve handles, use the hidden native ranges from the keyboard, or edit every State value below.',
    state: [
      {name: 'attack', kind: 'number', required: true, initial: 0.08, min: 0, step: 0.01, note: 'Attack duration in seconds, bounded visually by attackMax.'},
      {name: 'decay', kind: 'number', required: true, initial: 0.32, min: 0, step: 0.01, note: 'Decay duration in seconds, bounded visually by decayMax.'},
      {name: 'sustain', kind: 'number', required: true, initial: 0.62, min: 0, max: 1, step: 0.01, note: 'Normalized sustain level painted on the decay/sustain handle.'},
      {name: 'release', kind: 'number', required: true, initial: 0.7, min: 0, step: 0.01, note: 'Release duration in seconds, bounded visually by releaseMax.'},
      {name: 'attackMax', kind: 'number', required: true, initial: 2, min: 0.01, step: 0.1, note: 'Positive attack range maximum used for horizontal scaling.'},
      {name: 'decayMax', kind: 'number', required: true, initial: 2, min: 0.01, step: 0.1, note: 'Positive decay range maximum used for horizontal scaling.'},
      {name: 'releaseMax', kind: 'number', required: true, initial: 4, min: 0.01, step: 0.1, note: 'Positive release range maximum used for horizontal scaling.'},
      {name: 'disabled', kind: 'boolean', initial: false, fallback: 'off', note: 'Disables pointer and keyboard envelope editing.'},
    ],
    options: [
      localizationOption,
      {name: 'label', kind: 'text', fallback: 'Envelope', placeholder: 'Envelope', note: 'Sets the root group accessible name.', inert: 'Changes the accessibility tree, not visible text.'},
      {name: 'classNames', kind: 'enum', fallback: 'canonical classes only', choices: [{value: 'demo', label: 'demo compatibility hooks', literal: "{root: 'demo-transport', svg: 'demo-envelope-svg', grid: 'demo-envelope-grid', area: 'demo-envelope-area', curve: 'demo-envelope-curve', handle: 'demo-envelope-handle', readout: 'demo-envelope-readout', inputs: 'demo-envelope-inputs', input: 'demo-envelope-input'}"}], note: 'Adds compatibility classes alongside every canonical envelope class.'},
      {name: 'parts', kind: 'enum', fallback: 'canonical parts only', choices: [{value: 'demo', label: 'demo part hooks', literal: "{root: 'demo-root', svg: 'demo-svg', grid: 'demo-grid', area: 'demo-area', curve: 'demo-curve', handle: 'demo-handle', readout: 'demo-readout', inputs: 'demo-inputs', input: 'demo-input'}"}], note: 'Adds part tokens alongside every canonical envelope part.'},
      {name: 'onError', kind: 'enum', fallback: 'no handler', choices: [{value: 'report', label: 'report demo errors', literal: '(error) => report(error)'}], note: 'Receives snapshot, command, subscription and cleanup failures.', inert: 'The healthy demo does not manufacture an error just to call this hook.'},
    ],
  },
  {
    presenter: 'lfo',
    classSlug: 'parameters-gestures',
    label: 'LFO',
    summary: 'Oscillator run, shape, rate and depth controls with a live phase waveform.',
    api: `import {mountLfo} from '@webmusic/ui/lfo';

const handle = mountLfo(host, binding, options);`,
    consumerTags: ['synth-panel'],
    hint: 'Run the phase clock, choose a waveform, drag Rate or Depth, then drive the same values from State below.',
    state: [
      {name: 'shape', kind: 'enum', required: true, initial: 'sine', choices: [{value: 'sine', label: 'sine'}, {value: 'triangle', label: 'triangle'}, {value: 'square', label: 'square'}, {value: 'saw', label: 'saw'}], note: 'Selects the waveform glyph and plotted curve.'},
      {name: 'rate', kind: 'number', required: true, initial: 0.8, min: 0.05, max: 12, step: 0.05, note: 'Oscillator frequency in hertz.'},
      {name: 'depth', kind: 'number', required: true, initial: 0.64, min: 0, max: 1, step: 0.01, note: 'Normalized modulation depth and waveform amplitude.'},
      {name: 'phase', kind: 'number', required: true, initial: 0.12, min: 0, max: 1, step: 0.01, note: 'Normalized cycle position painted by the vertical head.'},
      {name: 'running', kind: 'boolean', required: true, initial: false, note: 'Selects Run or Stop and advances phase in this demo.'},
      {name: 'disabled', kind: 'boolean', initial: false, fallback: 'off', note: 'Disables every LFO button and range input.'},
    ],
    options: [
      localizationOption,
      {name: 'label', kind: 'text', fallback: 'LFO', placeholder: 'LFO', note: 'Sets the root group accessible name.', inert: 'Changes the accessibility tree, not visible text.'},
      {name: 'runLabel', kind: 'text', fallback: 'Run', placeholder: 'Run', note: 'Accessible name of the stopped run button.', inert: 'Changes the button accessible name, not its glyph.'},
      {name: 'stopLabel', kind: 'text', fallback: 'Stop', placeholder: 'Stop', note: 'Accessible name of the running stop button.', inert: 'Changes the button accessible name, not its glyph.'},
      {name: 'classNames', kind: 'enum', fallback: 'canonical classes only', choices: [{value: 'demo', label: 'demo compatibility hooks', literal: "{root: 'demo-transport', row: 'demo-lfo-row', run: 'demo-lfo-run', shapes: 'demo-lfo-shapes', shape: 'demo-lfo-shape', control: 'demo-lfo-control', rateControl: 'demo-lfo-rate-control', depthControl: 'demo-lfo-depth-control', label: 'demo-lfo-label', input: 'demo-lfo-input', rateInput: 'demo-lfo-rate', depthInput: 'demo-lfo-depth', value: 'demo-lfo-value', rateValue: 'demo-lfo-rate-value', depthValue: 'demo-lfo-depth-value', wave: 'demo-lfo-wave', curve: 'demo-lfo-curve', head: 'demo-lfo-head'}"}], note: 'Adds compatibility classes alongside every canonical LFO class.'},
      {name: 'parts', kind: 'enum', fallback: 'canonical parts only', choices: [{value: 'demo', label: 'demo part hooks', literal: "{root: 'demo-root', row: 'demo-row', run: 'demo-run', shapes: 'demo-shapes', shape: 'demo-shape', control: 'demo-control', rateControl: 'demo-rate-control', depthControl: 'demo-depth-control', label: 'demo-label', input: 'demo-input', rateInput: 'demo-rate', depthInput: 'demo-depth', value: 'demo-value', rateValue: 'demo-rate-value', depthValue: 'demo-depth-value', wave: 'demo-wave', curve: 'demo-curve', head: 'demo-head'}"}], note: 'Adds part tokens alongside every canonical LFO part.'},
      {name: 'formatRate', kind: 'enum', fallback: '0.00Hz', choices: [{value: 'musical', label: 'cycles per second', literal: "(rate) => `${rate.toFixed(1)} cycles/s`"}], note: 'Formats the visible rate and aria-valuetext.'},
      {name: 'formatDepth', kind: 'enum', fallback: 'integer percent', choices: [{value: 'decimal', label: '0–1 decimal', literal: '(depth) => depth.toFixed(2)'}], note: 'Formats the visible depth and aria-valuetext.'},
      {name: 'onError', kind: 'enum', fallback: 'no handler', choices: [{value: 'report', label: 'report demo errors', literal: '(error) => report(error)'}], note: 'Receives snapshot, formatter, command, subscription and cleanup failures.', inert: 'The healthy demo does not manufacture an error just to call this hook.'},
    ],
  },
  {
    presenter: 'eq',
    classSlug: 'parameters-gestures',
    label: 'EQ',
    summary: 'An equalizer response curve whose draggable bands commit through a structural binding.',
    api: `import {mountEq} from '@webmusic/ui/eq';

const handle = mountEq(host, binding, options);`,
    consumerTags: ['synth-panel'],
    hint: 'Drag a band point in two dimensions, then try every State and Option; hidden inputs mirror geometry but are not interactive.',
    state: [
      {name: 'bands', kind: 'enum', required: true, initial: 'three-band', choices: [{value: 'three-band', label: 'three bands'}, {value: 'single-band', label: 'one band'}, {value: 'empty', label: 'no bands'}], note: 'Selects the caller-owned EqBandState list.'},
      {name: 'response', kind: 'enum', initial: 'computed', fallback: 'no curve', choices: [{value: 'computed', label: 'computed curve'}, {value: 'flat', label: 'flat response'}], note: 'Supplies normalized response points for the curve and fill.'},
      {name: 'ready', kind: 'boolean', initial: true, fallback: 'off', note: 'Shows the graph when true or the empty-state label otherwise.'},
      {name: 'disabled', kind: 'boolean', initial: false, fallback: 'off', note: 'Disables every band point and hidden range input.'},
    ],
    options: [
      localizationOption,
      {name: 'label', kind: 'text', fallback: 'Equalizer', placeholder: 'Equalizer', note: 'Sets the root group accessible name.', inert: 'Changes the accessibility tree, not visible text.'},
      {name: 'emptyLabel', kind: 'text', fallback: 'Connect an equalizer graph', placeholder: 'Connect an equalizer graph', note: 'Labels the graph while ready is not true.'},
      {name: 'classNames', kind: 'enum', fallback: 'canonical classes only', choices: [{value: 'demo', label: 'demo compatibility hooks', literal: "{root: 'demo-transport', svg: 'demo-eq-svg', grid: 'demo-eq-grid', zero: 'demo-eq-zero', area: 'demo-eq-area', curve: 'demo-eq-curve', points: 'demo-eq-points', point: 'demo-eq-point', readout: 'demo-eq-readout', empty: 'demo-eq-empty', input: 'demo-eq-input'}"}], note: 'Adds compatibility classes alongside every canonical EQ class.'},
      {name: 'parts', kind: 'enum', fallback: 'canonical parts only', choices: [{value: 'demo', label: 'demo part hooks', literal: "{root: 'demo-root', svg: 'demo-svg', grid: 'demo-grid', zero: 'demo-zero', area: 'demo-area', curve: 'demo-curve', points: 'demo-points', point: 'demo-point', readout: 'demo-readout', empty: 'demo-empty', input: 'demo-input'}"}], note: 'Adds part tokens alongside every canonical EQ part.'},
      {name: 'formatFrequency', kind: 'enum', fallback: 'compact Hz/kHz', choices: [{value: 'precise', label: 'precise hertz', literal: "(frequency) => `${Math.round(frequency)} Hz`"}], note: 'Formats each visible band frequency in the readout.'},
      {name: 'onError', kind: 'enum', fallback: 'no handler', choices: [{value: 'report', label: 'report demo errors', literal: '(error) => report(error)'}], note: 'Receives snapshot, formatter, command, subscription and cleanup failures.', inert: 'The healthy demo does not manufacture an error just to call this hook.'},
    ],
  },
  {
    presenter: 'mixer',
    classSlug: 'mixing-capture',
    label: 'Mixer',
    summary: 'Master and channel faders with optional mute, solo and transport commands.',
    api: `import {mountMixer} from '@webmusic/ui/mixer';

const handle = mountMixer(host, {
  snapshot: () => state,
  setMaster: (value) => mixer.setMaster(value),
  setChannel: (id, value) => mixer.setChannel(id, value),
});`,
    consumerTags: ['rack-control'],
    hint: 'Move a fader or press M / S; in this demo Play enables, Pause disables, and Stop clears the levels.',
    state: [
      {
        name: 'master',
        kind: 'number',
        required: true,
        initial: 0.82,
        min: 0,
        max: 1,
        step: 0.01,
        note: 'The normalized master-fader value.',
      },
      {
        name: 'channels',
        kind: 'enum',
        required: true,
        initial: 'studio',
        choices: [
          {value: 'studio', label: 'four studio channels'},
          {value: 'compact', label: 'two compact channels'},
          {value: 'disabled', label: 'disabled and muted channels'},
        ],
        note: 'Chooses the channel records rendered after the master strip.',
      },
      {
        name: 'disabled',
        kind: 'boolean',
        initial: false,
        fallback: 'off',
        note: 'Disables every fader, mute / solo action, and transport button.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {
            value: 'demo',
            label: 'demo compatibility hooks',
            literal: "{root: 'demo-mixer', transport: 'demo-transport', board: 'demo-board', channels: 'demo-channels', strip: 'demo-strip', master: 'demo-master', fader: 'demo-fader', input: 'demo-input', label: 'demo-label', actions: 'demo-actions', button: 'demo-button', mute: 'demo-mute', solo: 'demo-solo', play: 'demo-play', pause: 'demo-pause', stop: 'demo-stop'}",
          },
        ],
        note: 'Adds compatibility classes beside all canonical mixer classes.',
        inert: 'The hooks are present in the DOM; this demo does not attach a class-based theme.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {
            value: 'demo',
            label: 'demo part hooks',
            literal: "{root: 'demo-root', transport: 'demo-transport', board: 'demo-board', channels: 'demo-channels', strip: 'demo-strip', master: 'demo-master', fader: 'demo-fader', input: 'demo-input', label: 'demo-label', actions: 'demo-actions', button: 'demo-button', mute: 'demo-mute', solo: 'demo-solo', play: 'demo-play', pause: 'demo-pause', stop: 'demo-stop'}",
          },
        ],
        note: 'Adds part tokens beside the canonical mixer parts.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'errors are not reported',
        choices: [
          {value: 'report', label: 'report to demo host', literal: '(error) => report(error)'},
        ],
        note: 'Receives snapshot and command errors.',
        inert: 'The healthy demo does not throw; the callback is nevertheless passed to the real mount.',
      },
    ],
  },
  {
    presenter: 'meter',
    classSlug: 'mixing-capture',
    label: 'Meter',
    summary: 'A self-driven level or spectrum meter that pulls per-frame data from its binding.',
    api: `import {mountMeter} from '@webmusic/ui/meter';

const handle = mountMeter(host, {
  readLevel: () => meter.level,
  readSpectrum: (bars) => meter.spectrum(bars),
});`,
    consumerTags: [],
    hint: 'Change the pulled level and peak values, switch mode, or turn animation off and use State changes to call redraw().',
    state: [
      {
        name: 'level',
        kind: 'number',
        required: true,
        initial: 0.58,
        min: 0,
        max: 1,
        step: 0.01,
        note: 'Base normalized level used by the fill and spectrum amplitude.',
      },
      {
        name: 'peak',
        kind: 'number',
        initial: 0.76,
        min: 0,
        max: 1,
        step: 0.01,
        fallback: 'level',
        note: 'Instantaneous normalized peak used when peakHold is absent.',
      },
      {
        name: 'peakHold',
        kind: 'number',
        initial: 0.9,
        min: 0,
        max: 1,
        step: 0.01,
        fallback: 'peak, then level',
        note: 'Normalized held-peak marker painted in level mode.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'mode',
        kind: 'enum',
        fallback: 'level',
        choices: [
          {value: 'level', label: 'level', literal: "'level'"},
          {value: 'spectrum', label: 'spectrum', literal: "'spectrum'"},
        ],
        note: 'Builds either a fill-and-peak track or a spectrum bar bank.',
      },
      {
        name: 'bars',
        kind: 'number',
        min: 4,
        max: 96,
        step: 1,
        fallback: '28; minimum 4',
        note: 'Sets the integer spectrum-bar count at mount time.',
      },
      {
        name: 'label',
        kind: 'text',
        fallback: 'Audio level / Spectrum',
        placeholder: 'Custom accessible label',
        note: 'Overrides the mode-specific accessible name.',
        inert: 'The real aria-label changes; the meter has no visible label.',
      },
      {
        name: 'animate',
        kind: 'boolean',
        fallback: 'on',
        note: 'Starts the animation-frame pull loop unless explicitly false.',
      },
      {
        name: 'height',
        kind: 'text',
        fallback: '48px',
        placeholder: '64px',
        note: 'Sets an inline CSS length; numeric API values are converted to px.',
      },
      {
        name: 'color',
        kind: 'text',
        fallback: 'meter fill token',
        placeholder: '#4ea1ff',
        note: 'Overrides the fill or spectrum color inline.',
      },
      {
        name: 'peakColor',
        kind: 'text',
        fallback: 'meter peak token',
        placeholder: '#e0445b',
        note: 'Overrides the held-peak marker color inline.',
      },
      {
        name: 'backgroundColor',
        kind: 'text',
        fallback: 'meter background token',
        placeholder: '#111',
        note: 'Overrides the meter root background inline.',
      },
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {
            value: 'demo',
            label: 'demo compatibility hooks',
            literal: "{root: 'demo-meter', track: 'demo-track', fill: 'demo-fill', peak: 'demo-peak', spectrum: 'demo-spectrum', bar: 'demo-bar'}",
          },
        ],
        note: 'Adds compatibility classes beside every meter class.',
        inert: 'The hooks are present in the DOM; this demo does not attach a class-based theme.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {
            value: 'demo',
            label: 'demo part hooks',
            literal: "{root: 'demo-root', track: 'demo-track', fill: 'demo-fill', peak: 'demo-peak', spectrum: 'demo-spectrum', bar: 'demo-bar'}",
          },
        ],
        note: 'Adds part tokens beside every canonical meter part.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'errors are not reported',
        choices: [
          {value: 'report', label: 'report to demo host', literal: '(error) => report(error)'},
        ],
        note: 'Receives binding reads and cleanup failures.',
        inert: 'The healthy demo does not throw; the callback is nevertheless passed to the real mount.',
      },
    ],
  },
  {
    presenter: 'recorder',
    classSlug: 'mixing-capture',
    label: 'Recorder',
    summary: 'Record, playback and export controls with live input level and take status.',
    api: `import {mountRecorder} from '@webmusic/ui/recorder';

const handle = mountRecorder(host, {
  snapshot: () => state,
  toggleRecording: () => recorder.toggle(),
  subscribe: (notify) => store.subscribe(notify),
});`,
    consumerTags: ['score-recorder'],
    hint: 'Press Record to run an asynchronous demo capture; choose exportFormats to add working download callbacks.',
    state: [
      {name: 'recording', kind: 'boolean', required: true, initial: false, note: 'Paints and labels the record toggle as Record or Stop.'},
      {name: 'busy', kind: 'boolean', initial: false, fallback: 'off', note: 'Disables the record button and sets its aria-busy state.'},
      {name: 'playing', kind: 'boolean', initial: false, fallback: 'off', note: 'Paints the playback toggle as Play or Stop.'},
      {name: 'level', kind: 'number', initial: 0.2, min: 0, max: 1, step: 0.01, fallback: 'meter hidden', note: 'Normalized input level; omission hides the visual meter.'},
      {name: 'recordedCount', kind: 'number', initial: 0, min: 0, step: 1, fallback: '0', note: 'Fallback count printed in the generated recording status.'},
      {name: 'takeCount', kind: 'number', initial: 0, min: 0, step: 1, fallback: 'no captured status', note: 'Fallback capture count and availability signal when canPlay / canExport are absent.'},
      {name: 'status', kind: 'text', initial: 'Ready — record a demo take', fallback: 'generated status', note: 'Overrides the presenter-generated status line.'},
      {name: 'canPlay', kind: 'boolean', initial: false, fallback: 'off — until the snapshot carries takeCount', note: 'Explicitly enables or disables the playback button.'},
      {name: 'canExport', kind: 'boolean', initial: false, fallback: 'off — until the snapshot carries takeCount', note: 'Explicitly enables or disables every export button.'},
    ],
    options: [
      localizationOption,
      {
        name: 'exportFormats',
        kind: 'enum',
        fallback: 'no export buttons',
        choices: [
          {value: 'wav-json', label: 'WAV + JSON', literal: "[{id: 'wav', label: 'WAV'}, {id: 'json', label: 'JSON'}]"},
          {value: 'wav-mp3', label: 'WAV + MP3', literal: "[{id: 'wav', label: 'WAV'}, {id: 'mp3', label: 'MP3'}]"},
          {value: 'wav', label: 'WAV only', literal: "[{id: 'wav', label: 'WAV'}]"},
        ],
        note: 'Creates one labelled export button per id / label record.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'errors are not reported',
        choices: [
          {value: 'report', label: 'report to demo host', literal: '(error) => report(error)'},
        ],
        note: 'Receives snapshot and command errors.',
        inert: 'The healthy demo does not throw; the callback is nevertheless passed to the real mount.',
      },
    ],
  },
  {
    presenter: 'note',
    classSlug: 'notes',
    label: 'Note surface',
    summary: 'Piano, grid and chord layouts with reusable pointer, chord and QWERTY interaction.',
    api: `import {mountNoteSurface} from '@webmusic/ui/note';

const handle = mountNoteSurface(host, {
  snapshot: () => state,
  interaction: {
    setNote: (midi, on) => synth.setNote(midi, on),
  },
});`,
    consumerTags: ['note-input'],
    hint: 'Click or drag notes; focus the keyboard surface and use its printed keys, Z / X for octave, or Esc to release; chord buttons also hold with Space / Enter.',
    state: [
      {
        name: 'layout',
        kind: 'enum',
        required: true,
        initial: 'piano',
        choices: [
          {value: 'piano', label: 'piano', literal: "'piano'"},
          {value: 'grid', label: 'grid', literal: "'grid'"},
          {value: 'chords', label: 'chords', literal: "'chords'"},
        ],
        note: 'Chooses which board geometry the presenter builds.',
      },
      {
        name: 'activeMidis',
        kind: 'enum',
        fallback: 'no externally active notes',
        choices: [
          {value: 'c-major', label: 'C major triad'},
          {value: 'octave', label: 'root octave'},
        ],
        note: 'Paints matching data-midi nodes as pressed.',
      },
      {name: 'keyboard', kind: 'boolean', initial: true, fallback: 'off', note: 'Adds the focusable QWERTY bar, octave label, and click-to-start overlay.'},
      {name: 'mapOnly', kind: 'boolean', initial: false, fallback: 'off', note: 'In grid layout, suppresses Z / X octave shifting and changes the hint.'},
      {name: 'octaveLabel', kind: 'text', initial: 'C4–C5', fallback: 'empty', placeholder: 'C4–C5', note: 'Text shown at the right edge of the keyboard bar.'},
      {
        name: 'piano',
        kind: 'enum',
        initial: 'one-octave',
        fallback: 'empty piano',
        choices: [
          {value: 'one-octave', label: 'one labelled octave'},
          {value: 'two-octaves', label: 'two octaves'},
        ],
        note: 'Supplies percentage-positioned piano key records.',
      },
      {
        name: 'grid',
        kind: 'enum',
        initial: 'qwerty',
        fallback: 'empty grid',
        choices: [
          {value: 'qwerty', label: 'chromatic QWERTY cells'},
          {value: 'drums', label: 'eight drum pads'},
        ],
        note: 'Supplies pitch, KeyboardEvent.code, and reference-label cells.',
      },
      {name: 'gridColumns', kind: 'number', initial: 7, min: 1, max: 16, step: 1, fallback: '7', note: 'Sets the CSS grid column count.'},
      {
        name: 'chords',
        kind: 'enum',
        initial: 'triads',
        fallback: 'empty chord row',
        choices: [
          {value: 'triads', label: 'four triads'},
          {value: 'sevenths', label: 'four seventh chords'},
        ],
        note: 'Supplies chord labels, indices, and held MIDI pitches.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'errors are not reported',
        choices: [
          {value: 'report', label: 'report to demo host', literal: '(error) => report(error)'},
        ],
        note: 'Receives snapshot, interaction, subscription, and cleanup errors.',
        inert: 'The healthy demo does not throw; the callback is nevertheless passed to the real mount.',
      },
    ],
  },
  {
    presenter: 'stage',
    classSlug: 'layout-feedback',
    label: 'Stage',
    summary: 'Generic DOM and canvas stages with DPR, resize, animation and surface-slider lifecycles.',
    api: `import {mountCanvasStage, mountStage, mountSurfaceSlider} from '@webmusic/ui/stage';

const stage = mountStage(host, binding, options);
const canvas = mountCanvasStage(canvasHost, canvasBinding, canvasOptions);
const slider = mountSurfaceSlider(surface, sliderBinding, sliderOptions);`,
    invocation: {
      name: 'mountStage',
      arguments: 'domHost, stageBinding',
      initial: `mountStage(domHost, stageBinding);
mountCanvasStage(canvasHost, canvasBinding);
mountSurfaceSlider(surface, sliderBinding);`,
      variant: 'stage-compound',
    },
    consumerTags: [
      'score-view',
      'sheet-view',
    ],
    hint: 'Drag the surface slider or use its Arrow, Home, and End keys; all three real stage mounts share the same caller-owned State.',
    state: [
      {
        name: 'minimum',
        kind: 'number',
        required: true,
        initial: 0,
        step: 1,
        note: 'Sets the slider lower bound; non-finite input normalizes to 0.',
      },
      {
        name: 'maximum',
        kind: 'number',
        required: true,
        initial: 100,
        step: 1,
        note: 'Sets the upper bound, normalized to be at least minimum.',
      },
      {
        name: 'value',
        kind: 'number',
        required: true,
        initial: 36,
        step: 1,
        note: 'Sets the current value, clamped by the presenter to the normalized bounds.',
      },
      {
        name: 'disabled',
        kind: 'boolean',
        initial: false,
        fallback: 'off',
        note: 'Suppresses slider commits and exposes the CanvasStage status overlay.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'label',
        kind: 'text',
        fallback: 'stages unlabelled; slider “Value”',
        placeholder: 'Domain visualization',
        note: 'Applies one accessible name to the retained region, canvas image, and slider.',
        inert: 'The label is exposed to assistive technology rather than painted by any stage.',
      },
      {
        name: 'fill',
        kind: 'boolean',
        fallback: 'off',
        note: 'Makes the retained stage and surface fill their definite-height demo host.',
      },
      {
        name: 'surfaceMinWidth',
        kind: 'text',
        fallback: '0',
        placeholder: '32rem',
        note: 'Sets the retained drawing’s minimum readable CSS width without expanding its host; use overflow auto to scroll it.',
      },
      {
        name: 'background',
        kind: 'text',
        fallback: 'stage theme (transparent)',
        placeholder: '#fff',
        note: 'Sets the retained viewport’s CSS background color, including behind content scrolled beyond the first screen.',
      },
      {
        name: 'overflow',
        kind: 'enum',
        fallback: 'hidden',
        choices: ['hidden', 'auto', 'visible', 'clip', 'scroll'].map((value) => ({value, label: value, literal: `'${value}'`})),
        note: 'Chooses whether the retained stage clips, scrolls or exposes content wider than its host.',
      },
      {
        name: 'orientation',
        kind: 'enum',
        fallback: 'horizontal',
        choices: [
          {value: 'horizontal', label: 'horizontal', literal: "'horizontal'"},
          {value: 'vertical', label: 'vertical', literal: "'vertical'"},
        ],
        note: 'Changes SurfaceSlider geometry, ARIA orientation, and Arrow-key direction.',
      },
      {
        name: 'pointerTarget',
        kind: 'enum',
        fallback: 'mounted slider element',
        choices: [
          {value: 'track', label: 'inner track', literal: 'pointerSurface'},
        ],
        note: 'Moves pointer listeners and capture from the slider element to its inner track.',
        inert: 'The pointer hit rectangle changes while the caller-owned pixels deliberately stay the same.',
      },
      {
        name: 'keyboardStep',
        kind: 'number',
        min: 0,
        step: 1,
        fallback: 'span ÷ 100, or 1',
        placeholder: '1',
        note: 'Sets the amount committed by each Arrow key on the SurfaceSlider.',
      },
      {
        name: 'formatValue',
        kind: 'enum',
        fallback: 'no aria-valuetext',
        choices: [
          {
            value: 'percent',
            label: 'percentage',
            literal: '(value, state) => `${Math.round((value - state.minimum) / (state.maximum - state.minimum) * 100)}%`',
          },
          {
            value: 'units',
            label: 'units',
            literal: '(value) => `${value.toFixed(1)} units`',
          },
        ],
        note: 'Supplies SurfaceSlider aria-valuetext for the normalized value.',
        inert: 'The formatted value is exposed to assistive technology rather than painted by the presenter.',
      },
      {
        name: 'animate',
        kind: 'boolean',
        fallback: 'off',
        note: 'Runs a requestAnimationFrame redraw loop while enabled.',
      },
      {
        name: 'fallbackWidth',
        kind: 'number',
        min: 1,
        step: 1,
        fallback: '300',
        placeholder: '300',
        note: 'Supplies CSS-pixel width when the mounted stage has no measurable width.',
        inert: 'The compound documentation canvas already has a measured width.',
      },
      {
        name: 'fallbackHeight',
        kind: 'number',
        min: 1,
        step: 1,
        fallback: '150',
        placeholder: '150',
        note: 'Supplies CSS-pixel height when the mounted stage has no measurable height.',
        inert: 'The compound documentation canvas already has a measured height.',
      },
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {
            value: 'demo',
            label: 'demo compatibility hooks',
            literal: "{root: 'demo-stage', surface: 'demo-stage-surface', canvas: 'demo-stage-canvas', status: 'demo-stage-status'}",
          },
        ],
        note: 'Adds compatible root/surface hooks to retained and root/canvas/status hooks to canvas.',
        inert: 'The added class hooks are inspectable but intentionally carry no demo skin.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {
            value: 'demo',
            label: 'demo part hooks',
            literal: "{root: 'demo-root', surface: 'demo-surface', canvas: 'demo-canvas', status: 'demo-status'}",
          },
        ],
        note: 'Adds part tokens beside retained root/surface and canvas root/canvas/status.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal: '(error) => { host.dataset.presenterDemoError = String(error); }',
          },
        ],
        note: 'Receives retained render, slider interaction, canvas draw/status, subscription, resize, and cleanup failures.',
        inert: 'The healthy demo does not manufacture a failure.',
      },
    ],
  },
  {
    presenter: 'status',
    classSlug: 'layout-feedback',
    label: 'Status',
    summary: 'A shared ready, loading, empty or error surface with appropriate live-region behavior.',
    api: `import {mountStatus} from '@webmusic/ui/status';

const handle = mountStatus(host, binding, options);`,
    consumerTags: ['score-view', 'sheet-view'],
    hint: 'Choose Ready, Loading, Empty, or Error, then edit the caller-owned message.',
    state: [
      {
        name: 'kind',
        kind: 'enum',
        required: true,
        initial: 'loading',
        choices: [
          {value: 'ready', label: 'ready', literal: "'ready'"},
          {value: 'loading', label: 'loading', literal: "'loading'"},
          {value: 'empty', label: 'empty', literal: "'empty'"},
          {value: 'error', label: 'error', literal: "'error'"},
        ],
        note: 'Selects the hidden, polite loading / empty, or assertive error surface.',
      },
      {
        name: 'message',
        kind: 'text',
        initial: 'Loading analysis frames…',
        fallback: 'kind default',
        placeholder: 'Status message',
        note: 'Overrides the built-in message for the current kind.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {
            value: 'demo',
            label: 'demo compatibility hooks',
            literal: "{root: 'demo-status', message: 'demo-status-message'}",
          },
        ],
        note: 'Adds compatibility classes to the root and message.',
        inert: 'The added class hooks are inspectable but intentionally carry no demo skin.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {
            value: 'demo',
            label: 'demo part hooks',
            literal: "{root: 'demo-root', message: 'demo-message'}",
          },
        ],
        note: 'Adds part tokens beside root and message.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal: '(error) => { host.dataset.presenterDemoError = String(error); }',
          },
        ],
        note: 'Receives snapshot, subscription, and cleanup failures.',
        inert: 'The healthy demo does not manufacture a failure.',
      },
    ],
  },
  {
    presenter: 'track-list',
    classSlug: 'transport-time',
    label: 'Track list',
    summary: 'An accessible index of named, keyboard-operable rows with one current item.',
    api: `import {mountTrackList} from '@webmusic/ui/track-list';

const handle = mountTrackList(host, binding, options);`,
    consumerTags: [],
    hint: 'Select a row, use Arrow keys within the roving tab stop, then change State or Options.',
    state: [
      {
        name: 'items',
        kind: 'enum',
        required: true,
        initial: 'demo',
        choices: [
          {value: 'demo', label: 'four demo rows'},
          {value: 'compact', label: 'one row'},
          {value: 'empty', label: 'empty list'},
        ],
        note: 'Supplies the ordered row data, including active and per-row disabled state.',
      },
      {
        name: 'disabled',
        kind: 'boolean',
        initial: false,
        fallback: 'off',
        note: 'Disables every row while preserving the rendered list.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'label',
        kind: 'text',
        fallback: 'Tracks',
        placeholder: 'Tracks',
        note: 'Names the semantic list for assistive technology.',
        inert: 'The accessible list name is not painted as a visible heading.',
      },
      {
        name: 'ordered',
        kind: 'boolean',
        fallback: 'off',
        note: 'Uses an ordered list when row order carries meaning.',
        inert: 'The shared stylesheet removes native list markers; the change is semantic.',
      },
      {
        name: 'emptyLabel',
        kind: 'text',
        fallback: 'No items',
        placeholder: 'No items',
        note: 'Sets the message shown when State.items is empty.',
      },
      {
        name: 'stylesheet',
        kind: 'boolean',
        fallback: 'on',
        note: 'Installs or omits the exported track-list stylesheet.',
      },
      {
        name: 'classNames',
        kind: 'enum',
        fallback: 'canonical classes only',
        choices: [
          {
            value: 'demo',
            label: 'demo compatibility hooks',
            literal: "{root: 'demo-track-list', list: 'demo-track-items', item: 'demo-track-item', row: 'demo-track-row', swatch: 'demo-track-swatch', label: 'demo-track-label', detail: 'demo-track-detail', empty: 'demo-track-empty'}",
          },
        ],
        note: 'Adds compatibility classes beside every canonical track-list class.',
        inert: 'The added class hooks are inspectable but intentionally carry no demo skin.',
      },
      {
        name: 'parts',
        kind: 'enum',
        fallback: 'canonical parts only',
        choices: [
          {
            value: 'demo',
            label: 'demo part hooks',
            literal: "{root: 'demo-root', list: 'demo-list', item: 'demo-item', row: 'demo-row', swatch: 'demo-swatch', label: 'demo-label', detail: 'demo-detail', empty: 'demo-empty'}",
          },
        ],
        note: 'Adds part tokens beside every canonical track-list part.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal: '(error) => { host.dataset.presenterDemoError = String(error); }',
          },
        ],
        note: 'Receives command, snapshot, subscription, and cleanup failures.',
        inert: 'The healthy demo does not manufacture a failure.',
      },
    ],
  },
  {
    presenter: 'analysis',
    classSlug: 'views-analysis',
    label: 'Analysis',
    summary: 'One-shot cards, timelines, summaries and a reusable analysis playhead controller.',
    api: `import {createAnalysisPlayhead, createAnalysisRoot, renderSummaryCard} from '@webmusic/ui/analysis';

const root = createAnalysisRoot(document);
renderSummaryCard(card, root);
const playhead = createAnalysisPlayhead(root);`,
    invocation: {
      name: 'createAnalysisPlayhead',
      arguments: 'root',
    },
    consumerTags: [
      'key-analysis',
      'chord-analysis',
      'roman-analysis',
      'voice-leading-analysis',
      'live-chord-analysis',
    ],
    hint: 'Watch the real playhead move across helper-rendered spans; Options remount its controller.',
    options: [
      localizationOption,
      {
        name: 'scroll',
        kind: 'boolean',
        initial: false,
        fallback: 'on',
        note: 'Scrolls the first newly active analysis span into view.',
      },
      {
        name: 'activeClassName',
        kind: 'text',
        fallback: 'is-playing',
        placeholder: 'is-playing',
        note: 'Adds one or more compatibility classes to active spans.',
        inert: 'The active inline highlight remains the visible signal; this class is an integration hook.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal: '(error) => { host.dataset.presenterDemoError = String(error); }',
          },
        ],
        note: 'Receives span discovery, style restoration, and scrolling failures.',
        inert: 'The healthy demo does not manufacture a failure.',
      },
    ],
  },
  {
    presenter: 'pitch',
    classSlug: 'views-analysis',
    label: 'Pitch surfaces',
    summary: 'Keyboard, staff and fretboard read-outs that press, spell and slide with their input.',
    api: `import {mountFretboard, mountKeyboard, mountStaff} from '@webmusic/ui/pitch';

const keyboard = mountKeyboard(keyboardHost, keyboardBinding);
const staff = mountStaff(staffHost, staffBinding, {anchor: 0.35});
const fretboard = mountFretboard(fretboardHost, fretboardBinding);`,
    invocation: {
      name: 'mountKeyboard',
      arguments: 'host, keyboardBinding',
    },
    consumerTags: ['pitch-view'],
    hint: 'The progression advances on its own; picking a chord takes it over, and Reset hands it back.',
    state: [
      {
        name: 'chord',
        kind: 'enum',
        required: true,
        initial: 'Dm7',
        choices: [
          {value: 'Dm7', label: 'Dm7'},
          {value: 'G7', label: 'G7'},
          {value: 'Cmaj7', label: 'Cmaj7'},
          {value: 'Am7', label: 'Am7'},
        ],
        note: 'Which chord’s marks the three surfaces hold. The demo supplies every spelling, role and fret; the kit is told none of them.',
      },
      {
        name: 'labels',
        kind: 'enum',
        required: true,
        initial: 'marked',
        choices: [
          {value: 'none', label: 'none'},
          {value: 'marked', label: 'marked'},
          {value: 'white', label: 'white'},
          {value: 'all', label: 'all'},
        ],
        note: 'KeyboardState.labels — which keys may print a name. A key prints only a name the caller supplied.',
      },
      {
        name: 'follow',
        kind: 'enum',
        required: true,
        initial: 'anchor',
        choices: [
          {value: 'anchor', label: 'anchor'},
          {value: 'none', label: 'none'},
        ],
        note: 'StaffState.follow — pin the sounding column at the anchor and let the columns flow past it, or leave every column where it was drawn.',
      },
      {
        name: 'firstFret',
        kind: 'enum',
        required: true,
        initial: 'auto',
        choices: [
          {value: 'auto', label: 'auto'},
          {value: 0, label: '0'},
          {value: 3, label: '3'},
          {value: 5, label: '5'},
        ],
        note: 'FretboardState.firstFret — a fixed window, or auto, which keeps a window that still holds every mark.',
      },
      {
        name: 'orientation',
        kind: 'enum',
        required: true,
        initial: 'horizontal',
        choices: [
          {value: 'horizontal', label: 'horizontal'},
          {value: 'vertical', label: 'vertical'},
        ],
        note: 'FretboardState.orientation — the same nodes and the same data-* either way; only the coordinates turn.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'follow',
        kind: 'enum',
        fallback: 'none',
        choices: [
          {value: 'active', label: 'active'},
          {value: 'none', label: 'none'},
        ],
        note: 'KeyboardOptions.follow — reveal newly active marks in a wide keyboard. Repeated snapshots and releases preserve manual scrolling; this does not change StaffState.follow.',
      },
      {name: 'fitToWidth', kind: 'boolean', fallback: 'off', note: 'KeyboardOptions: fit the entire normalized range to the container, overriding explicit key widths and the CSS minimum width; heights remain unchanged.'},
      {name: 'whiteKeyWidth', kind: 'number', min: 1, step: 1, placeholder: '32', fallback: 'responsive', note: 'KeyboardOptions: natural-key width in px. Explicit width fixes the board scale; overflow scrolls. Ignored while fitToWidth is true.'},
      {name: 'blackKeyWidth', kind: 'number', min: 1, step: 1, placeholder: '20', fallback: '0.62 × white width', note: 'KeyboardOptions: accidental-key width in px, capped at white width. Alone, derives white width by dividing by 0.62. Ignored while fitToWidth is true.'},
      {name: 'whiteKeyHeight', kind: 'number', min: 1, step: 1, placeholder: '80', fallback: 'theme height', note: 'KeyboardOptions: natural-key height in px.'},
      {name: 'blackKeyHeight', kind: 'number', min: 1, step: 1, placeholder: '50', fallback: 'theme proportion', note: 'KeyboardOptions: accidental-key height in px, capped at white height.'},
      {name: 'fretWidth', kind: 'number', min: 1, step: 1, placeholder: '36', fallback: 'responsive', note: 'FretboardOptions: fixed distance between adjacent fret wires in px.'},
      {name: 'stringSpacing', kind: 'number', min: 1, step: 1, placeholder: '24', fallback: 'density geometry', note: 'FretboardOptions: distance between adjacent strings in px.'},
      {name: 'stringWidth', kind: 'number', min: 0.1, step: 0.1, placeholder: '1', fallback: 'density stroke', note: 'FretboardOptions: string stroke thickness in px, independent of viewport scale.'},
      {
        name: 'motion',
        kind: 'enum',
        fallback: 'auto',
        choices: [
          {value: 'auto', label: 'auto'},
          {value: 'continuous', label: 'continuous'},
          {value: 'stepped', label: 'stepped'},
          {value: 'none', label: 'none'},
        ],
        note: 'How much the surface may move. Reduced modes spend the transitions down to 0s and change no layout.',
      },
      {
        name: 'release',
        kind: 'number',
        min: 0,
        max: 600,
        step: 20,
        fallback: '140',
        placeholder: '140',
        note: 'How long a lifted key or a lifted finger keeps fading, in ms. Zero in any reduced motion mode.',
      },
      {
        name: 'trail',
        kind: 'boolean',
        fallback: 'off',
        note: 'Leaves the role colour on a released key for the length of its release.',
      },
      {
        name: 'ageSpan',
        kind: 'number',
        min: 1,
        max: 16,
        step: 1,
        fallback: '4',
        placeholder: '4',
        note: 'How many of the caller’s own units the published age spans, from a mark’s since to the surface’s now. All three surfaces take it, so one pitch cannot age at two rates.',
      },
      {
        name: 'stylesheet',
        kind: 'boolean',
        fallback: 'on',
        note: 'Install the exported sheet, or paint the identical declarations onto the nodes.',
      },
      {
        name: 'label',
        kind: 'text',
        fallback: 'derived from the marks',
        placeholder: 'Sounding: D3, F3, A3, C4',
        note: 'Overrides the accessible name each surface derives from the labels it was given.',
        inert: 'The name is announced, not drawn — a screen reader hears the change and the pixels do not.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal: '(error) => { host.dataset.presenterDemoError = String(error); }',
          },
        ],
        note: 'Receives a faulty snapshot, an unplaceable mark and any repaint failure.',
        inert: 'The healthy demo does not manufacture a failure.',
      },
    ],
  },
  {
    presenter: 'harmony',
    classSlug: 'views-analysis',
    label: 'Harmony read-outs',
    summary:
      'A conveyor, a nameplate, a ranked strip and a wheel that show an analysis happening rather than listing what it concluded.',
    api: `import {mountChipStrip, mountFlowLane, mountNameplate, mountWheel} from '@webmusic/ui/harmony';

const lane = mountFlowLane(laneHost, laneBinding, {anchor: 0.33});
const nameplate = mountNameplate(nameplateHost, nameplateBinding);
const strip = mountChipStrip(stripHost, stripBinding);
const wheel = mountWheel(wheelHost, wheelBinding);`,
    invocation: {
      name: 'mountFlowLane',
      arguments: 'host, laneBinding',
    },
    consumerTags: ['key-analysis', 'chord-analysis', 'roman-analysis', 'voice-leading-analysis', 'live-chord-analysis'],
    hint: 'The progression runs itself past the now line. Drag or arrow-key the lane to scrub, click a band to jump to it, and pick an alternate reading to take the nameplate over.',
    state: [
      {
        name: 'playing',
        kind: 'boolean',
        required: true,
        initial: true,
        note: 'FlowLaneState.playing, and the demo’s own transport with it. Held, every read-out keeps the frame it was on — nothing here is an accumulation of the frames that went past.',
      },
      {
        name: 'tracks',
        kind: 'enum',
        required: true,
        initial: 2,
        choices: [
          {value: 1, label: 'one row'},
          {value: 2, label: 'two rows'},
        ],
        note: 'FlowLaneState.tracks — chords alone, or chords and numerals. Rows are children of one reel, so there is no arrangement of the code in which two of them drift apart.',
      },
      {
        name: 'future',
        kind: 'boolean',
        required: true,
        initial: true,
        note: 'FlowLaneState.future — off draws the space right of the now line as an empty field, which is what a read-out following a live performance owes its reader.',
      },
      {
        name: 'focus',
        kind: 'enum',
        required: true,
        initial: 'none',
        choices: [
          {value: 'none', label: 'none'},
          {value: 'subdominant', label: 'subdominant'},
        ],
        note: 'FlowLaneState.focusGroup — every band carrying that group lights with the one under the line. The kit compares two strings; which bands share a group is the caller’s answer.',
      },
      {
        name: 'layout',
        kind: 'enum',
        required: true,
        initial: 'flow',
        choices: [
          {value: 'flow', label: 'flow'},
          {value: 'ribbon', label: 'ribbon'},
          {value: 'stack', label: 'stack'},
        ],
        note: 'ChipStripState.layout. All three are ORDER, not time — a strip has no axis and no now line, which is exactly why it is not a lane.',
      },
      {
        name: 'emphasis',
        kind: 'enum',
        required: true,
        initial: 'display',
        choices: [
          {value: 'display', label: 'display'},
          {value: 'hero', label: 'hero'},
        ],
        note: 'NameplateState.emphasis — the same plate inside a card that has other things to say, or standing alone on a stage.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'motion',
        kind: 'enum',
        fallback: 'auto',
        choices: [
          {value: 'auto', label: 'auto'},
          {value: 'continuous', label: 'continuous'},
          {value: 'stepped', label: 'stepped'},
          {value: 'none', label: 'none'},
        ],
        note: 'Reduced motion changes the DRIVER, never the layout: a stepped lane holds the identical bands at identical offsets and re-anchors when the sounding one changes, instead of sixty times a second. Same picture, six style writes.',
      },
      {
        name: 'anchor',
        kind: 'number',
        min: 0,
        max: 0.9,
        step: 0.05,
        fallback: '0.33',
        placeholder: '0.33',
        note: 'Where the now line is pinned, 0…1. A third behind and two thirds ahead by default, because seeing the next chord approach is the whole reason to prefer a conveyor over a map.',
      },
      {
        name: 'scale',
        kind: 'number',
        min: 12,
        max: 120,
        step: 4,
        fallback: '44',
        placeholder: '44',
        note: 'Pixels per axis unit — here, per second. It is an option rather than a token because reading a length back out of a custom property means getComputedStyle, and the lane needs the number in JavaScript.',
      },
      {
        name: 'visibleSpan',
        kind: 'number',
        min: 0.5,
        max: 600,
        step: 0.5,
        fallback: 'unset — use scale',
        placeholder: '8',
        note: 'Axis units across the available lane width; this demo uses seconds. A positive value overrides scale and preserves the visible duration when resized.',
      },
      {
        name: 'popDuration',
        kind: 'number',
        min: 0,
        max: 600,
        step: 20,
        fallback: '180',
        placeholder: '180',
        note: 'How long the nameplate’s pop lasts, in ms. Opacity only: the symbol is the one line the reader is actually reading, and a word that jumps while being read cannot be read.',
      },
      {
        name: 'spans',
        kind: 'boolean',
        fallback: 'on',
        note: 'Write the playhead’s span contract onto every band and chip. Off only where the lane’s stamping unit differs from the unit the playhead on this root is fed.',
        inert: 'Nothing on this page runs a playhead over these nodes; the attributes are visible in the inspector either way.',
      },
      {
        name: 'stylesheet',
        kind: 'boolean',
        fallback: 'on',
        note: 'Install the exported sheet, or paint the identical declarations onto the nodes. Both are generated from one record.',
      },
      {
        name: 'label',
        kind: 'text',
        fallback: 'derived from the bands',
        placeholder: 'The progression, as it goes past',
        note: 'FlowLaneOptions.label — the lane’s accessible name, and the name its slider announces. The other three read-outs keep the names they derive for themselves.',
        inert: 'The name is announced, not drawn — a screen reader hears the change and the pixels do not.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal: '(error) => { host.dataset.presenterDemoError = String(error); }',
          },
        ],
        note: 'Receives a faulty snapshot, a rejected seek and any repaint failure.',
        inert: 'The healthy demo does not manufacture a failure.',
      },
    ],
  },
  {
    presenter: 'workbench',
    classSlug: 'layout-feedback',
    label: 'Analysis workbench',
    summary:
      'The shell an analysis view sits in: a tablist, a stage, a rail of docks, a status bar, and one reading of the clock per frame handed to everything mounted inside it.',
    api: `import {mountWorkbench} from '@webmusic/ui/workbench';

const shell = mountWorkbench(host, shellBinding, {chrome: 'full'});

// The stage and every dock are HOSTS the caller fills.
mountFlowLane(shell.stage, laneBinding, {clock: shell.clock});
const rail = shell.dock('keyboard');
if (rail) mountKeyboard(rail, keyboardBinding);`,
    invocation: {
      name: 'mountWorkbench',
      arguments: 'host, shellBinding',
    },
    consumerTags: ['key-analysis', 'chord-analysis', 'roman-analysis', 'voice-leading-analysis', 'live-chord-analysis'],
    hint: 'Arrow-key the tabs and press Enter: an arrow moves focus and chooses nothing. Fold a dock away with its switch and the presenter inside it is unmounted, because a caller must not be able to mount into a box nobody can see. Park the shell and the frame loop stops with it.',
    state: [
      {
        name: 'view',
        kind: 'enum',
        required: true,
        initial: 'chords',
        choices: [
          {value: 'chords', label: 'Chords'},
          {value: 'key', label: 'Key'},
          {value: 'voicing', label: 'Voicing'},
        ],
        note: 'WorkbenchState.activeViewId. Each view declares the docks it wants, so switching one folds two rail sections away and takes a different tenant into the stage — and the shell never learns what any of the three words mean.',
      },
      {
        name: 'phase',
        kind: 'enum',
        required: true,
        initial: 'playing',
        choices: [
          {value: 'playing', label: 'playing'},
          {value: 'listening', label: 'listening'},
          {value: 'idle', label: 'idle'},
          {value: 'empty', label: 'empty'},
          {value: 'error', label: 'error'},
        ],
        note: 'WorkbenchState.phase, and the clock gate with it: only playing and listening open a frame loop. Park it and the material stops where it was — the shell still answers the pointer and the keyboard, which is what parked and blank differ by.',
      },
      {
        name: 'density',
        kind: 'enum',
        required: true,
        initial: 'comfortable',
        choices: [
          {value: 'comfortable', label: 'comfortable'},
          {value: 'compact', label: 'compact'},
        ],
        note: 'Sets WorkbenchState.density. The demo forwards this value to its keyboard and staff tenants and remounts them when it changes, because pitch presenters own a local density token layer.',
      },
      {
        name: 'scheme',
        kind: 'enum',
        required: true,
        initial: 'auto',
        choices: [
          {value: 'auto', label: 'inherit'},
          {value: 'light', label: 'light'},
          {value: 'dark', label: 'dark'},
        ],
        note: 'WorkbenchState.scheme. Declared here rather than sniffed, because a shell dropped into a dark card on a light page is a fact its host knows and it does not.',
      },
      {
        name: 'keyboard',
        kind: 'boolean',
        required: true,
        initial: true,
        note: 'WorkbenchState.dockVisibility for the keyboard dock — the same fold the switch performs, driven from outside so both paths meet in one place. A folded dock keeps its head and its switch; only the body goes, because hiding the switch with the thing it switches leaves no way back.',
      },
    ],
    options: [
      localizationOption,
      {
        name: 'chrome',
        kind: 'enum',
        fallback: 'full',
        choices: [
          {value: 'full', label: 'full'},
          {value: 'bare', label: 'bare'},
        ],
        note: 'bare is the stage alone — no tabs, no docks, no status bar — which is how a sibling element wraps the one card it already has and inherits this skin without pretending to have three views.',
      },
      {
        name: 'motion',
        kind: 'enum',
        fallback: 'auto',
        choices: [
          {value: 'auto', label: 'auto'},
          {value: 'continuous', label: 'continuous'},
          {value: 'stepped', label: 'stepped'},
          {value: 'none', label: 'none'},
        ],
        note: 'A reduced mode opens no frame loop at all and steps on the caller’s own notifications instead. That is honest in a way running the loop with the durations set to zero is not, and everything mounted in the shell inherits the answer rather than asking again.',
      },
      {
        name: 'label',
        kind: 'text',
        fallback: 'Views',
        placeholder: 'The analysis workbench',
        note: 'Names the shell as a group and names its tablist. Given none, the tablist still has a name and the root is not a landmark at all — an unnamed group is worse than none.',
        inert: 'The name is announced, not drawn: a screen reader hears the change and the pixels do not.',
      },
      {
        name: 'stylesheet',
        kind: 'boolean',
        fallback: 'on',
        note: 'Install the exported sheet, or paint the identical declarations onto the nodes. Both come from one record — but the container-query rewrites are literal CSS, so a narrow shell keeps two columns with the sheet off.',
      },
      {
        name: 'onError',
        kind: 'enum',
        fallback: 'no handler',
        choices: [
          {
            value: 'report',
            label: 'report demo errors',
            literal: '(error) => { host.dataset.presenterDemoError = String(error); }',
          },
        ],
        note: 'Receives a faulty snapshot, a throwing now() or epoch(), and anything a slot’s own draw callback throws while the shell is walking them.',
        inert: 'The healthy demo does not manufacture a failure.',
      },
    ],
  },
] as const;

export function uiPresenterClass(slug: UiPresenterClassSlug): UiPresenterClass {
  const presenterClass = UI_PRESENTER_CLASSES.find((candidate) => candidate.slug === slug);
  if (!presenterClass) throw new Error(`Unknown UI presenter class: ${slug}`);
  return presenterClass;
}

export function uiPresenterEntry(presenter: string): UiPresenterEntry {
  const entry = UI_PRESENTER_CATALOG.find((candidate) => candidate.presenter === presenter);
  if (!entry) throw new Error(`Unknown UI presenter: ${presenter}`);
  return entry;
}

export function uiPresenterHref(entry: Pick<UiPresenterEntry, 'presenter' | 'classSlug'>): string {
  return `/uikit/${entry.classSlug}/${entry.presenter}/`;
}
