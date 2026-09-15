import type {
  Envelope,
  EnvelopeRanges,
  EqBand,
  LfoShape,
  SoundParam,
  SynthMacro,
  SynthPanelLfoConfig,
  SynthPanelLfoState,
} from '@webmusic/score/play/element';
import {OscillatorSynth} from '@webmusic/score/play/headless';
import {PLAYGROUND_RESET_EVENT} from './playground-client';
import {mountDemos, refreshDemos, type DemoScope} from './demo-lifecycle';

const WAVES: OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle'];

interface VoiceValues {
  wave: OscillatorType;
  tune: number;
  level: number;
  cutoff: number;
  resonance: number;
}

interface DemoValues {
  voice: VoiceValues;
  envelope: Envelope;
  ranges: EnvelopeRanges;
  bands: EqBand[];
  lfoShape: LfoShape;
  lfoRate: number;
  lfoDepth: number;
  lfoPhase: number;
  lfoRunning: boolean;
  lfoMin: number;
  lfoMax: number;
  bright: number;
  body: number;
}

const defaultDemoValues = (): DemoValues => ({
  voice: {
    wave: 'triangle',
    tune: 0,
    level: 0.18,
    cutoff: 8000,
    resonance: 0.7,
  },
  envelope: {attack: 0.05, decay: 0.2, sustain: 0.6, release: 0.4},
  ranges: {attackMax: 2, decayMax: 2, releaseMax: 2},
  bands: [
    {frequency: 120, gain: 0, q: 0.8},
    {frequency: 1000, gain: 0, q: 0.9},
    {frequency: 6000, gain: 0, q: 0.9},
  ],
  lfoShape: 'sine',
  lfoRate: 1,
  lfoDepth: 0.6,
  lfoPhase: 0,
  lfoRunning: false,
  lfoMin: 400,
  lfoMax: 9000,
  bright: 0.5,
  body: 0.5,
});

const cloneDemoValues = (values: DemoValues): DemoValues => ({
  ...values,
  voice: {...values.voice},
  envelope: {...values.envelope},
  ranges: {...values.ranges},
  bands: values.bands.map((band) => ({...band})),
});

type DemoSynth = Pick<OscillatorSynth, 'setParam' | 'noteOn' | 'noteOff' | 'connect' | 'dispose'>;

type SynthPanel = HTMLElement & {
  sound: SoundParam[];
  context?: AudioContext;
  input?: AudioNode;
  output?: AudioNode;
  envelope: Envelope;
  ranges: EnvelopeRanges;
  apply?: (envelope: Envelope) => void;
  bands: EqBand[];
  target?: {min: number; max: number; value?: number; unit?: string; apply(value: number): void};
  macros: SynthMacro[];
  lfo: SynthPanelLfoConfig;
};

type NoteInput = HTMLElement & {
  onNote?: (midi: number, velocity: number, on: boolean) => void;
};

type PropertyControl = HTMLInputElement | HTMLSelectElement;

const numberText = (value: number): string =>
  Object.is(value, -0) ? '0' : String(value);

const quoted = (value: string): string =>
  `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Copyable property setup matching the current demo controls. */
export function synthPanelSetupCode(values: DemoValues): string {
  const [low, mid, high] = values.bands;
  return [
    "import {defineNoteInputElement, defineSynthPanelElement} from '@webmusic/score/play/element';",
    "import {OscillatorSynth} from '@webmusic/score/play/headless';",
    '',
    'defineNoteInputElement();',
    'defineSynthPanelElement();',
    '',
    "const input = document.querySelector('note-input');",
    "const panel = document.querySelector('synth-panel');",
    'const context = new AudioContext();',
    'const synth = new OscillatorSynth(context, {',
    `  type: ${quoted(values.voice.wave)},`,
    `  gain: ${numberText(values.voice.level)},`,
    `  attackSeconds: ${numberText(values.envelope.attack)},`,
    `  releaseSeconds: ${numberText(values.envelope.release)},`,
    `  detune: ${numberText(values.voice.tune)},`,
    `  cutoff: ${numberText(values.voice.cutoff)},`,
    `  resonance: ${numberText(values.voice.resonance)},`,
    '});',
    '',
    'panel.context = context;',
    'panel.sound = [',
    `  {group: 'osc', name: 'wave', value: ${WAVES.indexOf(values.voice.wave)}, min: 0, max: 3, options: ['sine', 'square', 'sawtooth', 'triangle'], apply: (i) => synth.setParam('type', ['sine', 'square', 'sawtooth', 'triangle'][Math.round(i)])},`,
    `  {group: 'osc', name: 'tune', value: ${numberText(values.voice.tune)}, min: -50, max: 50, step: 1, unit: '¢', apply: (value) => synth.setParam('detune', value)},`,
    `  {group: 'osc', name: 'level', value: ${numberText(values.voice.level)}, min: 0.01, max: 0.5, step: 0.01, apply: (value) => synth.setParam('gain', value)},`,
    `  {group: 'filter', name: 'cutoff', value: ${numberText(values.voice.cutoff)}, min: 200, max: 12000, step: 10, unit: 'Hz', apply: (value) => synth.setParam('cutoff', value)},`,
    `  {group: 'filter', name: 'resonance', value: ${numberText(values.voice.resonance)}, min: 0.1, max: 18, step: 0.1, apply: (value) => synth.setParam('resonance', value)},`,
    '];',
    `panel.envelope = {attack: ${numberText(values.envelope.attack)}, decay: ${numberText(values.envelope.decay)}, sustain: ${numberText(values.envelope.sustain)}, release: ${numberText(values.envelope.release)}};`,
    `panel.ranges = {attackMax: ${numberText(values.ranges.attackMax)}, decayMax: ${numberText(values.ranges.decayMax)}, releaseMax: ${numberText(values.ranges.releaseMax)}};`,
    'panel.apply = ({attack, release}) => {',
    "  synth.setParam('attackSeconds', attack);",
    "  synth.setParam('releaseSeconds', Math.max(0.02, release));",
    '};',
    'panel.bands = [',
    `  {frequency: ${numberText(low?.frequency ?? 120)}, gain: ${numberText(low?.gain ?? 0)}, q: ${numberText(low?.q ?? 0.8)}},`,
    `  {frequency: ${numberText(mid?.frequency ?? 1000)}, gain: ${numberText(mid?.gain ?? 0)}, q: ${numberText(mid?.q ?? 0.9)}},`,
    `  {frequency: ${numberText(high?.frequency ?? 6000)}, gain: ${numberText(high?.gain ?? 0)}, q: ${numberText(high?.q ?? 0.9)}},`,
    '];',
    `panel.lfo = {shape: ${quoted(values.lfoShape)}, rate: ${numberText(values.lfoRate)}, depth: ${numberText(values.lfoDepth)}, phase: ${numberText(values.lfoPhase)}, running: ${values.lfoRunning}};`,
    `panel.target = {min: ${numberText(values.lfoMin)}, max: ${numberText(values.lfoMax)}, value: ${numberText(values.voice.cutoff)}, unit: 'Hz', apply: (value) => synth.setParam('cutoff', value)};`,
    'panel.macros = [',
    `  {label: 'BRIGHT', value: ${numberText(values.bright)}, targets: [`,
    "    {name: 'cutoff', min: 5000, max: 11000, unit: 'Hz', apply: (value) => synth.setParam('cutoff', value)},",
    "    {name: 'resonance', min: 0.3, max: 1.1, apply: (value) => synth.setParam('resonance', value)},",
    '  ]},',
    `  {label: 'BODY', value: ${numberText(values.body)}, targets: [`,
    "    {name: 'level', min: 0.12, max: 0.24, apply: (value) => synth.setParam('gain', value)},",
    "    {name: 'tune', min: -12, max: 12, unit: '¢', apply: (value) => synth.setParam('detune', value)},",
    '  ]},',
    '];',
    '',
    'const releaseRoute = synth.connect(panel.input ?? context.destination);',
    'panel.output?.connect(context.destination);',
    'const held = new Map();',
    'let disposed = false;',
    'input.onNote = (midi, velocity, on) => {',
    '  if (!on) {',
    '    held.delete(midi);',
    '    synth.noteOff(midi, context.currentTime);',
    '    return;',
    '  }',
    '  const press = Symbol();',
    '  held.set(midi, press);',
    '  void context.resume().then(() => {',
    '    if (!disposed && held.get(midi) === press) {',
    '      synth.noteOn(midi, velocity, context.currentTime, 3600);',
    '    }',
    '  }).catch(console.error);',
    '};',
    '',
    '// Call when this composition is removed or replaced.',
    'function dispose() {',
    '  if (disposed) return;',
    '  disposed = true;',
    '  held.clear();',
    '  input.onNote = undefined;',
    '  panel.apply = undefined;',
    '  panel.target = undefined;',
    '  panel.context = undefined;',
    '  releaseRoute();',
    '  synth.dispose();',
    '  void context.close().catch(console.error);',
    '}',
  ].join('\n');
}

function mountSynthPanelPlayground(editor: HTMLElement, scope: DemoScope): void {
  if (editor.dataset.sypWired === '1') return;
  const playground = editor.closest<HTMLElement>('[data-wm-pg]');
  const stage = playground?.querySelector<HTMLElement>('[data-pg-stage]');
  const panel = stage?.querySelector<SynthPanel>('synth-panel[data-syp]');
  const input = stage?.querySelector<NoteInput>('note-input[data-syp-input]');
  const code = playground?.querySelector<HTMLElement>('[data-syp-code]');
  const status = editor.querySelector<HTMLElement>('[data-syp-status]');
  if (!playground || !panel || !input) return;

  editor.dataset.sypWired = '1';
  const controls = (): PropertyControl[] =>
    Array.from(editor.querySelectorAll<PropertyControl>('[data-syp-param]'));
  const control = (key: string): PropertyControl | undefined =>
    editor.querySelector<PropertyControl>(`[data-syp-param="${key}"]`) ?? undefined;

  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let statusRevision = 0;
  const say = (message: string): void => {
    if (!status) return;
    const revision = ++statusRevision;
    if (statusTimer !== undefined) clearTimeout(statusTimer);
    status.textContent = '';
    queueMicrotask(() => {
      if (revision !== statusRevision) return;
      status.textContent = message;
      statusTimer = setTimeout(() => {
        if (revision !== statusRevision) return;
        status.textContent = '';
        statusTimer = undefined;
      }, 3200);
    });
  };

  let synth: DemoSynth | undefined;
  let context: AudioContext | undefined;
  let releaseSynthRoute: (() => void) | undefined;
  const held = new Map<number, symbol>();
  scope.add(() => {
    held.clear();
    statusRevision += 1;
    if (statusTimer !== undefined) clearTimeout(statusTimer);
    delete editor.dataset.sypWired;
    input.onNote = undefined;
    panel.apply = undefined;
    panel.target = undefined;
    panel.context = undefined;
    releaseSynthRoute?.();
    synth?.dispose();
    if (context) void context.close().catch(() => undefined);
  });
  try {
    if (typeof AudioContext !== 'undefined') {
      context = new AudioContext();
      panel.context = context;
      synth = new OscillatorSynth(context, {
        type: 'triangle',
        gain: 0.18,
        attackSeconds: 0.05,
        releaseSeconds: 0.4,
        detune: 0,
        cutoff: 8000,
        resonance: 0.7,
      });
      releaseSynthRoute = synth.connect(panel.input ?? context.destination);
      panel.output?.connect(context.destination);
    }
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    say(`Audio preview is unavailable.${detail}`);
    panel.context = undefined;
    releaseSynthRoute?.();
    synth?.dispose();
    if (context) void context.close().catch(() => undefined);
    synth = undefined;
    context = undefined;
  }

  let committed = defaultDemoValues();
  const numeric = (key: string, fallback: number): number => {
    const item = control(key);
    if (!(item instanceof HTMLInputElement)) return fallback;
    if (item.value.trim() === '' || !item.checkValidity()) return fallback;
    const value = Number(item.value);
    return Number.isFinite(value) ? value : fallback;
  };
  const selected = <T extends string>(key: string, fallback: T): T => {
    const item = control(key);
    return item instanceof HTMLSelectElement && item.checkValidity()
      ? item.value as T
      : fallback;
  };
  const values = (fallback = committed): DemoValues => ({
    voice: {
      wave: selected('wave', fallback.voice.wave),
      tune: numeric('tune', fallback.voice.tune),
      level: numeric('level', fallback.voice.level),
      cutoff: numeric('cutoff', fallback.voice.cutoff),
      resonance: numeric('resonance', fallback.voice.resonance),
    },
    envelope: {
      attack: numeric('attack', fallback.envelope.attack),
      decay: numeric('decay', fallback.envelope.decay),
      sustain: numeric('sustain', fallback.envelope.sustain),
      release: numeric('release', fallback.envelope.release),
    },
    ranges: {
      attackMax: numeric('attack-max', fallback.ranges.attackMax),
      decayMax: numeric('decay-max', fallback.ranges.decayMax),
      releaseMax: numeric('release-max', fallback.ranges.releaseMax),
    },
    bands: [
      {frequency: numeric('low-frequency', fallback.bands[0]?.frequency ?? 120), gain: numeric('low-gain', fallback.bands[0]?.gain ?? 0), q: numeric('low-q', fallback.bands[0]?.q ?? 0.8)},
      {frequency: numeric('mid-frequency', fallback.bands[1]?.frequency ?? 1000), gain: numeric('mid-gain', fallback.bands[1]?.gain ?? 0), q: numeric('mid-q', fallback.bands[1]?.q ?? 0.9)},
      {frequency: numeric('high-frequency', fallback.bands[2]?.frequency ?? 6000), gain: numeric('high-gain', fallback.bands[2]?.gain ?? 0), q: numeric('high-q', fallback.bands[2]?.q ?? 0.9)},
    ],
    lfoShape: selected('lfo-shape', fallback.lfoShape),
    lfoRate: numeric('lfo-rate', fallback.lfoRate),
    lfoDepth: numeric('lfo-depth', fallback.lfoDepth),
    lfoPhase: numeric('lfo-phase', fallback.lfoPhase),
    lfoRunning: selected('lfo-running', fallback.lfoRunning ? 'on' : 'off') === 'on',
    lfoMin: numeric('lfo-min', fallback.lfoMin),
    lfoMax: numeric('lfo-max', fallback.lfoMax),
    bright: numeric('bright', fallback.bright),
    body: numeric('body', fallback.body),
  });

  const setSynth = <K extends Parameters<DemoSynth['setParam']>[0]>(
    key: K,
    value: Parameters<DemoSynth['setParam']>[1],
  ): void => {
    synth?.setParam(key, value as never);
  };

  const applyVoice = (current: DemoValues): void => {
    const voice = current.voice;
    setSynth('type', voice.wave);
    setSynth('detune', voice.tune);
    setSynth('gain', voice.level);
    setSynth('cutoff', voice.cutoff);
    setSynth('resonance', voice.resonance);
    panel.sound = [
      {group: 'osc', name: 'wave', value: WAVES.indexOf(voice.wave), min: 0, max: WAVES.length - 1, options: WAVES, apply: (index) => setSynth('type', WAVES[Math.round(index)] ?? 'triangle')},
      {group: 'osc', name: 'tune', value: voice.tune, min: -50, max: 50, step: 1, unit: '¢', apply: (value) => setSynth('detune', value)},
      {group: 'osc', name: 'level', value: voice.level, min: 0.01, max: 0.5, step: 0.01, apply: (value) => setSynth('gain', value)},
      {group: 'filter', name: 'cutoff', value: voice.cutoff, min: 200, max: 12000, step: 10, unit: 'Hz', apply: (value) => setSynth('cutoff', value)},
      {group: 'filter', name: 'resonance', value: voice.resonance, min: 0.1, max: 18, step: 0.1, apply: (value) => setSynth('resonance', value)},
    ];
  };

  const applyEnvelope = (current: DemoValues): void => {
    panel.ranges = {...current.ranges};
    panel.envelope = {...current.envelope};
    setSynth('attackSeconds', current.envelope.attack);
    setSynth('releaseSeconds', Math.max(0.02, current.envelope.release));
  };

  const applyBands = (current: DemoValues): void => {
    panel.bands = current.bands.map((band) => ({...band}));
  };

  const applyLfo = (current: DemoValues): void => {
    panel.lfo = {
      shape: current.lfoShape,
      rate: current.lfoRate,
      depth: current.lfoDepth,
      phase: current.lfoPhase,
      running: current.lfoRunning,
    };
  };

  const applyLfoField = (current: DemoValues, key: string | undefined): void => {
    const config: SynthPanelLfoConfig | undefined = key === 'lfo-shape'
      ? {shape: current.lfoShape}
      : key === 'lfo-rate'
        ? {rate: current.lfoRate}
        : key === 'lfo-depth'
          ? {depth: current.lfoDepth}
          : key === 'lfo-phase'
            ? {phase: current.lfoPhase}
            : key === 'lfo-running'
              ? {running: current.lfoRunning}
              : undefined;
    if (config) panel.lfo = config;
    else applyLfo(current);
  };

  const applyTarget = (current: DemoValues): void => {
    const {voice} = current;
    panel.target = {
      min: current.lfoMin,
      max: current.lfoMax,
      value: voice.cutoff,
      unit: 'Hz',
      apply: (value) => setSynth('cutoff', value),
    };
  };

  const applyMacros = (current: DemoValues): void => {
    panel.macros = [
      {
        label: 'BRIGHT',
        value: current.bright,
        targets: [
          {name: 'cutoff', min: 5000, max: 11000, unit: 'Hz', apply: (value) => setSynth('cutoff', value)},
          {name: 'resonance', min: 0.3, max: 1.1, apply: (value) => setSynth('resonance', value)},
        ],
      },
      {
        label: 'BODY',
        value: current.body,
        targets: [
          {name: 'level', min: 0.12, max: 0.24, apply: (value) => setSynth('gain', value)},
          {name: 'tune', min: -12, max: 12, unit: '¢', apply: (value) => setSynth('detune', value)},
        ],
      },
    ];
  };

  const applyModulation = (current: DemoValues): void => {
    applyLfo(current);
    applyTarget(current);
    applyMacros(current);
  };

  const updateCode = (current = committed): void => {
    if (code) code.textContent = synthPanelSetupCode(current);
  };

  const applyAll = (current = values()): void => {
    committed = cloneDemoValues(current);
    applyVoice(current);
    applyEnvelope(current);
    applyBands(current);
    applyModulation(current);
    updateCode(current);
  };

  panel.apply = (envelope) => {
    setSynth('attackSeconds', envelope.attack);
    setSynth('releaseSeconds', Math.max(0.02, envelope.release));
  };

  input.onNote = (midi, velocity, on) => {
    if (!scope.active || !synth || !context) return;
    if (!on) {
      held.delete(midi);
      synth.noteOff(midi, context.currentTime);
      return;
    }
    const press = Symbol();
    held.set(midi, press);
    scope.run(context.resume().then(() => {
      if (scope.active && held.get(midi) === press && synth && context) {
        synth.noteOn(midi, velocity, context.currentTime, 3600);
      }
    }), () => { if (held.get(midi) === press) held.delete(midi); });
  };

  const resetControls = (): void => {
    for (const item of controls()) {
      item.value = item.dataset.sypDefault ?? '';
      item.removeAttribute('aria-invalid');
    }
  };

  scope.listen(editor, 'input', (event) => {
    const item = event.target;
    if (!(item instanceof HTMLInputElement) || !item.matches('[data-syp-param]')) return;
    item.toggleAttribute('aria-invalid', !item.checkValidity());
  });

  scope.listen(editor, 'change', (event) => {
    const item = event.target;
    if (!(item instanceof HTMLInputElement || item instanceof HTMLSelectElement)) return;
    if (!item.matches('[data-syp-param]')) return;
    if (!item.checkValidity()) {
      item.setAttribute('aria-invalid', 'true');
      say(`Enter a valid ${item.dataset.sypParam ?? 'parameter'} value.`);
      return;
    }
    item.removeAttribute('aria-invalid');
    const current = values();
    const group = item.closest<HTMLElement>('[data-syp-group]')?.dataset.sypGroup;
    if (group === 'modulation' && current.lfoMin > current.lfoMax) {
      control('lfo-min')?.setAttribute('aria-invalid', 'true');
      control('lfo-max')?.setAttribute('aria-invalid', 'true');
      say('target.min must be less than or equal to target.max.');
      return;
    }
    if (group === 'modulation') {
      control('lfo-min')?.removeAttribute('aria-invalid');
      control('lfo-max')?.removeAttribute('aria-invalid');
    }
    if (group === 'voice') applyVoice(current);
    else if (group === 'envelope') applyEnvelope(current);
    else if (group === 'eq') applyBands(current);
    else if (group === 'modulation') {
      const key = item.dataset.sypParam;
      if (key === 'lfo-min' || key === 'lfo-max') applyTarget(current);
      else if (key === 'bright' || key === 'body') applyMacros(current);
      else {
        applyLfoField(current, key);
        const state = panel.lfo as SynthPanelLfoState;
        current.lfoShape = state.shape;
        current.lfoRate = state.rate;
        current.lfoDepth = state.depth;
        current.lfoPhase = state.phase;
        current.lfoRunning = state.running;
      }
    }
    committed = cloneDemoValues(current);
    updateCode();
    say(`Updated ${item.dataset.sypParam ?? 'panel parameter'}.`);
  });

  scope.listen(panel, 'webscore:envelope', ((event: CustomEvent<Envelope>) => {
    for (const key of ['attack', 'decay', 'sustain', 'release'] as const) {
      const item = control(key);
      if (item) {
        item.value = numberText(event.detail[key]);
        item.removeAttribute('aria-invalid');
      }
    }
    committed = {
      ...committed,
      envelope: {...event.detail},
    };
    updateCode();
  }) as EventListener);

  scope.listen(panel, 'webscore:macro', ((event: CustomEvent<{index: number; value: number}>) => {
    const key = event.detail.index === 0 ? 'bright' : event.detail.index === 1 ? 'body' : undefined;
    const item = key ? control(key) : undefined;
    if (item) {
      item.value = numberText(event.detail.value);
      item.removeAttribute('aria-invalid');
    }
    if (key) committed = {...committed, [key]: event.detail.value};
    updateCode();
  }) as EventListener);

  scope.listen(panel, 'webscore:lfo', ((event: CustomEvent<{
    shape: LfoShape;
    rate: number;
    depth: number;
    phase: number;
    running: boolean;
  }>) => {
    const next = event.detail;
    const fields: Array<[string, string]> = [
      ['lfo-shape', next.shape],
      ['lfo-rate', numberText(next.rate)],
      ['lfo-depth', numberText(next.depth)],
      ['lfo-phase', numberText(next.phase)],
      ['lfo-running', next.running ? 'on' : 'off'],
    ];
    for (const [key, value] of fields) {
      const item = control(key);
      if (item) {
        item.value = value;
        item.removeAttribute('aria-invalid');
      }
    }
    committed = {
      ...committed,
      lfoShape: next.shape,
      lfoRate: next.rate,
      lfoDepth: next.depth,
      lfoPhase: next.phase,
      lfoRunning: next.running,
    };
    updateCode();
  }) as EventListener);

  scope.listen(playground, PLAYGROUND_RESET_EVENT, () => {
    resetControls();
    applyAll();
    say('Panel properties reset to the authored demo.');
  });

  // Browser form restoration can otherwise make the controls disagree with
  // the freshly-created property graph on first load.
  resetControls();
  applyAll();

}

let registered = false;
export function mountSynthPanelPlaygrounds(): void {
  if (!registered) {
    registered = true;
    mountDemos('[data-syp-properties]', mountSynthPanelPlayground);
  } else refreshDemos();
}
