// @vitest-environment jsdom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {AudioOutputPort, ModuleAudioEnvironment, ModuleContext, ParamHandle, ParamSurface, type ModuleHandle} from '@webmusic/kernel/module';
import {ScoreBuilder} from '../../src/core';
import {ScorePlayerModule} from '../../src/play/headless/score-module';
import {SynthPanelElement} from '../../src/play/element/score-synth-panel';
import {getParamLfoController, getParameterMacroController} from '../../src/play/headless/param-controls';

customElements.define('shared-modulation-panel-test', SynthPanelElement);

function fixture() {
  const nodes: Array<AudioNode & {stop: ReturnType<typeof vi.fn>}> = [];
  const parameter = (value = 0) => ({value, defaultValue: value, minValue: -1e6, maxValue: 1e6,
    automationRate: 'a-rate', cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => {
    const result = {context, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
      gain: parameter(1), offset: parameter(), frequency: parameter(1), type: 'sine',
    } as unknown as AudioNode & {stop: ReturnType<typeof vi.fn>};
    nodes.push(result);
    return result;
  };
  const context = {currentTime: 0, sampleRate: 48000, createGain: vi.fn(node), createConstantSource: vi.fn(node), createOscillator: vi.fn(node)} as unknown as AudioContext;
  const detune = new ParamHandle({id: 'detune', label: 'Detune', range: {min: -1200, max: 1200}, defaultValue: 100, unit: 'cents', modulation: 'audio-rate'});
  const gain = new ParamHandle({id: 'gain', label: 'Gain', range: {min: 0, max: 1}, defaultValue: 0.4, unit: 'linear', modulation: 'audio-rate'});
  const params = new ParamSurface([detune, gain]);
  const port = new AudioOutputPort(node());
  const target: ModuleHandle = {id: 'instrument', params, getPort: () => port};
  return {context, nodes, detune, gain, params, target};
}

function panel(target: ModuleHandle, sections = ['lfo', 'macros']): SynthPanelElement {
  const element = document.createElement('shared-modulation-panel-test') as SynthPanelElement;
  element.sections = sections.join(',');
  element.moduleTarget = target;
  document.body.append(element);
  return element;
}

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('attached parameter modulation controls', () => {
  it('shares one audio-rate LFO across views and keeps it running after views leave', () => {
    const {context, detune, target} = fixture();
    const first = panel(target);
    const second = panel(target);
    expect(context.createOscillator).not.toHaveBeenCalled();
    expect(context.createConstantSource).not.toHaveBeenCalled();
    first.lfoAmount = 80;
    first.lfo = {running: true, rate: 3, depth: 0.5};
    expect(context.createOscillator).toHaveBeenCalledOnce();
    expect(detune.snapshot.baseValue).toBe(100);
    expect(detune.snapshot.modulationRange).toEqual({min: 60, max: 140});
    expect(second.lfo).toMatchObject({running: true, rate: 3, depth: 0.5});
    expect(second.shadowRoot?.querySelector<HTMLInputElement>('.rate')?.value).toBe('3');
    second.lfoAmount = 120;
    first.sections = ['sound', 'lfo'];
    expect(first.lfoAmount).toBe(120);
    first.sections = ['sound'];
    first.remove();
    second.remove();
    const controller = getParamLfoController(detune, context);
    expect(controller.snapshot().running).toBe(true);
    const oscillator = vi.mocked(context.createOscillator).mock.results[0].value;
    expect(oscillator.stop).not.toHaveBeenCalled();
    controller.configure({depth: 0.25});
    expect(detune.snapshot.modulationRange).toEqual({min: 70, max: 130});
    detune.dispose();
    expect(oscillator.stop).toHaveBeenCalledOnce();
    expect(controller.snapshot().running).toBe(false);
  });

  it('stops orphaned modulation when a backend releases its audio graph and can restart explicitly', () => {
    const {context, detune} = fixture();
    const controller = getParamLfoController(detune, context);
    controller.configure({running: true, amount: 30});
    const first = vi.mocked(context.createOscillator).mock.results[0].value;
    detune.releaseAudio(context);
    expect(first.stop).toHaveBeenCalledOnce();
    expect(controller.snapshot().running).toBe(false);
    expect(detune.snapshot.disposed).toBe(false);
    controller.setRunning(true);
    expect(context.createOscillator).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().running).toBe(true);
    detune.dispose();
    expect(vi.mocked(context.createOscillator).mock.results[1].value.stop).toHaveBeenCalledOnce();
  });

  it('uses an explicit native-unit amount and stops audio when a mapping is released reentrantly', () => {
    const {context, detune, target} = fixture();
    const first = panel(target);
    const second = panel(target);
    expect(first.lfoAmount).toBe(1);
    const amount = first.shadowRoot!.querySelector<HTMLInputElement>('input[data-parameter-id="amount"]')!;
    amount.value = '25';
    amount.dispatchEvent(new Event('input', {bubbles: true}));
    expect(second.lfoAmount).toBe(25);
    first.lfo = {running: true};
    const oscillator = vi.mocked(context.createOscillator).mock.results[0].value;
    let released = false;
    const release = detune.subscribe(() => {
      if (!released) { released = true; detune.releaseAudio(context); }
    });
    const controller = getParamLfoController(detune, context);
    expect(() => controller.configure({depth: 0.2})).toThrow('released');
    expect(controller.snapshot().running).toBe(false);
    expect(oscillator.stop).toHaveBeenCalledOnce();
    release(); detune.dispose();
  });

  it('prepares an unready module only after an explicit run and retains one shared controller', async () => {
    const fixtureValue = fixture();
    let ready = false;
    const listeners = new Set<() => void>();
    const prepare = vi.fn(async () => {
      await Promise.resolve();
      ready = true;
      for (const listener of listeners) listener();
    });
    const target: ModuleHandle = {id: 'pending', params: fixtureValue.params,
      getPort: () => ready ? fixtureValue.target.getPort!('output') : undefined,
      prepare,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const element = panel(target);
    const mirror = panel(target, ['sound']);
    mirror.lfo = {rate: 2, depth: 0.2, running: false};
    expect(prepare).not.toHaveBeenCalled();
    element.lfoAmount = 50;
    element.lfo = {rate: 2, depth: 0.2};
    expect(prepare).not.toHaveBeenCalled();
    element.lfo = {running: true};
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(prepare).toHaveBeenCalledOnce();
    expect(element.lfo).toMatchObject({running: true, rate: 2, depth: 0.2});
    expect(fixtureValue.context.createOscillator).toHaveBeenCalledOnce();
    mirror.sections = ['lfo'];
    expect(mirror.lfo.running).toBe(true);
    expect(element.lfo.running).toBe(true);
    expect(fixtureValue.context.createOscillator).toHaveBeenCalledOnce();
    expect(fixtureValue.detune.snapshot.modulationRange).toEqual({min: 90, max: 110});
    fixtureValue.detune.dispose(); fixtureValue.gain.dispose();
  });

  it('retains preconfigured LFO state while a module parameter surface is still unresolved', () => {
    const fixtureValue = fixture();
    let ready = false;
    const listeners = new Set<() => void>();
    const target: ModuleHandle = {id: 'loading',
      get params() { return ready ? fixtureValue.params : undefined; },
      getPort: () => ready ? fixtureValue.target.getPort!('output') : undefined,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const element = document.createElement('shared-modulation-panel-test') as SynthPanelElement;
    element.moduleTarget = target;
    element.sections = ['lfo'];
    element.lfo = {rate: 2, depth: 0.5, running: false};
    const error = vi.fn();
    element.addEventListener('webscore:error', error);
    document.body.append(element);
    expect(error).not.toHaveBeenCalled();
    expect(fixtureValue.context.createOscillator).not.toHaveBeenCalled();
    ready = true;
    for (const listener of listeners) listener();
    expect(element.lfo).toMatchObject({rate: 2, depth: 0.5, running: false});
    expect(error).not.toHaveBeenCalled();
    expect(fixtureValue.context.createOscillator).not.toHaveBeenCalled();
    fixtureValue.detune.dispose(); fixtureValue.gain.dispose();
  });

  it.each(['connected replacement', 'disconnected replacement', 'same module reconnect'] as const)(
    'revokes parameter-less pending commands on %s', (transition) => {
      const f = fixture();
      let ready = false;
      const listeners = new Set<() => void>();
      const target: ModuleHandle = {id: 'loading-original',
        get params() { return ready ? f.params : undefined; },
        getPort: () => ready ? f.target.getPort!('output') : undefined,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      };
      const element = panel(target);
      element.lfoAmount = 80;
      element.lfo = {running: true, rate: 7, depth: 0.2};
      expect(f.context.createOscillator).not.toHaveBeenCalled();
      if (transition !== 'connected replacement') element.remove();
      if (transition !== 'same module reconnect') element.moduleTarget = f.target;
      if (transition !== 'connected replacement') document.body.append(element);
      ready = true;
      for (const listener of listeners) listener();
      const controller = getParamLfoController(f.detune, f.context);
      expect(controller.snapshot()).toMatchObject({running: false, rate: 1, amount: 1});
      expect(f.context.createOscillator).not.toHaveBeenCalled();
      // The new connected lifetime still accepts a fresh explicit command.
      element.lfo = {running: true};
      expect(controller.snapshot().running).toBe(true);
      expect(f.context.createOscillator).toHaveBeenCalledOnce();
      f.detune.dispose(); f.gain.dispose();
    },
  );

  it.each(['before first mount', 'connected', 'detached after unmount'] as const)(
    'retains explicit parameter-less configuration assigned %s for the same module', (assignment) => {
      const f = fixture();
      let ready = false;
      const listeners = new Set<() => void>();
      const target: ModuleHandle = {id: 'loading-original',
        get params() { return ready ? f.params : undefined; },
        getPort: () => ready ? f.target.getPort!('output') : undefined,
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      };
      const element = document.createElement('shared-modulation-panel-test') as SynthPanelElement;
      element.moduleTarget = target;
      element.sections = ['lfo'];
      if (assignment !== 'before first mount') document.body.append(element);
      if (assignment === 'detached after unmount') element.remove();
      element.lfoAmount = 80;
      element.lfo = {running: true, rate: 7, depth: 0.2};
      if (!element.isConnected) document.body.append(element);
      expect(f.context.createOscillator).not.toHaveBeenCalled();
      ready = true;
      for (const listener of listeners) listener();
      expect(getParamLfoController(f.detune, f.context).snapshot())
        .toMatchObject({running: true, rate: 7, depth: 0.2, amount: 80});
      expect(f.context.createOscillator).toHaveBeenCalledOnce();
      f.detune.dispose(); f.gain.dispose();
    },
  );

  it('revokes pending commands when a selector resolves to a replacement module', async () => {
    const f = fixture();
    const host = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    host.id = 'pending-lfo-selector-target';
    host.module = {id: 'loading-original'};
    document.body.append(host);
    const element = document.createElement('shared-modulation-panel-test') as SynthPanelElement;
    element.setAttribute('target', '#pending-lfo-selector-target');
    element.sections = ['lfo'];
    document.body.append(element);
    element.lfo = {running: true, rate: 7};
    host.module = f.target;
    host.dispatchEvent(new CustomEvent('webmusic:sourcechange', {bubbles: true}));
    await Promise.resolve();
    expect(element.module).toBe(f.target);
    expect(getParamLfoController(f.detune, f.context).snapshot()).toMatchObject({running: false, rate: 1});
    expect(f.context.createOscillator).not.toHaveBeenCalled();
    f.detune.dispose(); f.gain.dispose();
  });

  it.each([false, true])('binds unresolved configuration only to its original selector (replace selector: %s)', async (replace) => {
    const f = fixture();
    const element = document.createElement('shared-modulation-panel-test') as SynthPanelElement;
    element.setAttribute('target', '#late-lfo-original');
    element.sections = ['lfo'];
    element.lfo = {running: true, rate: 7};
    document.body.append(element);
    if (replace) element.setAttribute('target', '#late-lfo-replacement');
    const host = document.createElement('div') as HTMLDivElement & {module?: ModuleHandle};
    host.id = replace ? 'late-lfo-replacement' : 'late-lfo-original';
    host.module = f.target;
    document.body.append(host);
    await Promise.resolve(); await Promise.resolve();
    expect(element.module).toBe(f.target);
    expect(getParamLfoController(f.detune, f.context).snapshot())
      .toMatchObject({running: !replace, rate: replace ? 1 : 7});
    expect(f.context.createOscillator).toHaveBeenCalledTimes(replace ? 0 : 1);
    f.detune.dispose(); f.gain.dispose();
  });

  it.each([false, true])('invalidates a pending LFO start when its parameter selection changes (return to original: %s)', async (returnToOriginal) => {
    const fixtureValue = fixture();
    let ready = false;
    let complete!: () => void;
    const listeners = new Set<() => void>();
    const target: ModuleHandle = {id: 'pending-selection', params: fixtureValue.params,
      getPort: () => ready ? fixtureValue.target.getPort!('output') : undefined,
      prepare: () => new Promise<void>((resolve) => {
        complete = () => { ready = true; for (const listener of listeners) listener(); resolve(); };
      }),
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    };
    const element = panel(target);
    element.lfoParameter = 'detune';
    element.lfoAmount = 80;
    element.lfo = {running: true, rate: 3, depth: 0.5};
    element.lfoParameter = 'gain';
    if (returnToOriginal) element.lfoParameter = 'detune';
    complete();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(fixtureValue.context.createOscillator).not.toHaveBeenCalled();
    for (const parameter of [fixtureValue.detune, fixtureValue.gain]) {
      expect(getParamLfoController(parameter, fixtureValue.context).snapshot()).toMatchObject({running: false, amount: 1, rate: 1});
    }
    // A new explicit command can still start the currently selected controller.
    element.lfo = {running: true};
    expect(fixtureValue.context.createOscillator).toHaveBeenCalledOnce();
    const selected = returnToOriginal ? fixtureValue.detune : fixtureValue.gain;
    expect(getParamLfoController(selected, fixtureValue.context).snapshot().running).toBe(true);
    fixtureValue.detune.dispose(); fixtureValue.gain.dispose();
  });

  it('does not apply a pending LFO start to a replacement parameter with the same id', async () => {
    const fixtureValue = fixture();
    const replacement = new ParamHandle(fixtureValue.detune.descriptor);
    let params = fixtureValue.params;
    let ready = false;
    let complete!: () => void;
    const target: ModuleHandle = {id: 'pending-parameter-replacement',
      get params() { return params; },
      getPort: () => ready ? fixtureValue.target.getPort!('output') : undefined,
      prepare: () => new Promise<void>((resolve) => { complete = () => { ready = true; resolve(); }; }),
    };
    const element = panel(target);
    element.lfo = {running: true};
    params = new ParamSurface([replacement, fixtureValue.gain]);
    complete();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(fixtureValue.context.createOscillator).not.toHaveBeenCalled();
    expect(getParamLfoController(replacement, fixtureValue.context).snapshot().running).toBe(false);
    replacement.dispose(); fixtureValue.detune.dispose(); fixtureValue.gain.dispose();
  });

  it('resumes a borrowed live audio context only for an explicit run command', () => {
    const fixtureValue = fixture();
    const resume = vi.fn(() => Promise.resolve());
    Object.assign(fixtureValue.context, {state: 'suspended', resume, close: vi.fn()});
    const element = panel(fixtureValue.target);
    element.lfo = {rate: 2};
    expect(resume).not.toHaveBeenCalled();
    element.lfo = {running: true};
    expect(resume).toHaveBeenCalledOnce();
    element.lfo = {depth: 0.1};
    expect(resume).toHaveBeenCalledOnce();
    element.remove();
    expect(fixtureValue.context.close).not.toHaveBeenCalled();
    fixtureValue.detune.dispose(); fixtureValue.gain.dispose();
  });

  it('maps macros onto the same base handles and synchronizes independent panels', () => {
    const {gain, detune, params, target} = fixture();
    const config = {id: 'tone', label: 'Tone', value: 0.25, targets: [
      {parameter: 'gain', min: 0.2, max: 0.8},
      {parameter: 'detune', min: -100, max: 100},
    ]};
    const first = panel(target);
    const second = panel(target);
    first.parameterMacros = second.parameterMacros = [config];
    expect(gain.snapshot.baseValue).toBeCloseTo(0.35);
    expect(detune.snapshot.baseValue).toBe(-50);
    const input = first.shadowRoot!.querySelector<HTMLInputElement>('.sec-macros input[type=range]')!;
    input.value = '0.75';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    expect(gain.snapshot.baseValue).toBeCloseTo(0.65);
    expect(detune.snapshot.baseValue).toBe(50);
    expect(second.shadowRoot!.querySelector<HTMLInputElement>('.sec-macros input[type=range]')!.value).toBe('0.75');
    const macro = getParameterMacroController(params, config);
    first.remove(); second.remove();
    expect(macro.snapshot().disabled).toBe(false);
    macro.setValue(0.5);
    expect(gain.snapshot.baseValue).toBeCloseTo(0.5);
    detune.dispose();
    expect(macro.snapshot().disabled).toBe(true);
    expect(gain.snapshot.disposed).toBe(false);
    gain.dispose();
  });

  it('lets a later definition reclaim a macro id after its shared controller is disposed', () => {
    const gain = new ParamHandle({id: 'gain', unit: 'ratio', range: {min: 0, max: 1}, defaultValue: 0.5});
    const params = new ParamSurface([gain]);
    const config = {id: 'level', targets: [{parameter: 'gain', min: 0, max: 1}]};
    const first = getParameterMacroController(params, config);
    expect(getParameterMacroController(params, config)).toBe(first);
    first.dispose();
    const second = getParameterMacroController(params, config);
    expect(second).not.toBe(first);
    second.setValue(0.25);
    expect(gain.snapshot.baseValue).toBeCloseTo(0.25);
    gain.dispose();
    expect(second.snapshot().disabled).toBe(true);
    expect(() => getParameterMacroController(params, config)).toThrow('Macro parameter unavailable: gain');
  });

  it('reports unsupported rate and phase without silently invoking callback targets', () => {
    const control = new ParamHandle({id: 'attackSeconds', unit: 's', range: {min: 0, max: 2}, defaultValue: 0.1});
    const element = panel({id: 'callback', params: new ParamSurface([control])});
    const callback = vi.fn();
    element.target = {min: 0, max: 1, apply: callback};
    element.lfoParameter = 'attackSeconds';
    const errors: unknown[] = [];
    element.addEventListener('webscore:error', (event) => errors.push((event as CustomEvent).detail.error));
    element.lfo = {running: true};
    element.lfo = {phase: 0.5};
    expect(errors).toHaveLength(2);
    expect(element.lfo.running).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    control.dispose();
  });
});

const lazyModuleCleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of lazyModuleCleanups.splice(0).reverse()) cleanup(); });
function lazyDefaultModule() {
  const f = fixture();
  Object.assign(f.context, {state: 'running', destination: f.nodes[0],
    createStereoPanner: vi.fn(() => Object.assign(f.context.createGain(), {pan: {value: 0}}))});
  const audio = new ModuleAudioEnvironment({context: f.context});
  const module = new ScorePlayerModule(new ScoreBuilder().build(), {context: new ModuleContext({id: 'lazy-default', audio})});
  lazyModuleCleanups.push(() => audio.dispose(), () => module.dispose(), () => { f.detune.dispose(); f.gain.dispose(); });
  return {...f, module};
}
const settleLazyLfo = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('attached LFO preparation before parameter discovery', () => {
  it('prepares a real default Score instrument only after an explicit run', async () => {
    const {module, context} = lazyDefaultModule();
    const prepare = vi.spyOn(module, 'prepare');
    const element = panel(module, ['lfo']);
    expect(module.params).toBeUndefined();
    expect(prepare).not.toHaveBeenCalled();
    expect(context.createGain).not.toHaveBeenCalled();
    element.lfo = {running: true, rate: 2, depth: 0.5};
    await settleLazyLfo();
    expect(prepare).toHaveBeenCalledOnce();
    expect(element.lfo).toMatchObject({running: true, rate: 2, depth: 0.5});
    expect(context.createOscillator).toHaveBeenCalledOnce();
    expect(module.player.isPlaying()).toBe(false);
  });

  it.each(['stop', 'unmount', 'target replacement', 'parameter selection'] as const)(
    'does not start a parameter-less pending run after %s', async (change) => {
      const {module, context, target: replacement} = lazyDefaultModule();
      const actualPrepare = module.prepare.bind(module);
      let complete!: () => void;
      const pending = new Promise<void>(resolve => { complete = resolve; });
      const prepare = vi.spyOn(module, 'prepare').mockImplementation(async () => { await pending; await actualPrepare(); });
      const element = panel(module, ['lfo']);
      element.lfo = {running: true, rate: 3, depth: 0.25};
      expect(prepare).toHaveBeenCalledOnce();
      if (change === 'stop') element.lfo = {running: false};
      else if (change === 'unmount') element.remove();
      else if (change === 'target replacement') element.moduleTarget = replacement;
      else { element.lfoParameter = 'gain'; element.lfoParameter = 'detune'; }
      complete();
      await settleLazyLfo();
      expect(context.createOscillator).not.toHaveBeenCalled();
      expect(element.lfo.running).toBe(false);
      if (change === 'unmount') document.body.append(element);
      element.lfo = {running: true};
      await settleLazyLfo();
      expect(context.createOscillator).toHaveBeenCalledOnce();
    },
  );

  it('keeps parameter edits made while the first run is preparing', async () => {
    const {module, context} = lazyDefaultModule();
    const actualPrepare = module.prepare.bind(module);
    let complete!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    vi.spyOn(module, 'prepare').mockImplementation(async () => { await pending; await actualPrepare(); });
    const element = panel(module, ['lfo']);
    element.lfo = {running: true, rate: 2, depth: 0.5};
    element.lfo = {rate: 5, depth: 0.2};
    complete();
    await settleLazyLfo();
    expect(element.lfo).toMatchObject({running: true, rate: 5, depth: 0.2});
    expect(context.createOscillator).toHaveBeenCalledOnce();
  });

  it.each(['synchronous', 'asynchronous'] as const)('reports %s preparation failure once and accepts an explicit retry', async (mode) => {
    const {module, context} = lazyDefaultModule();
    const failure = new Error('target preparation failed');
    const prepare = vi.spyOn(module, 'prepare').mockImplementation(() => {
      if (mode === 'synchronous') throw failure;
      return Promise.reject(failure);
    });
    const element = panel(module, ['lfo']);
    const errors = vi.fn();
    element.addEventListener('webscore:error', errors);
    element.lfo = {running: true};
    await settleLazyLfo();
    expect(errors).toHaveBeenCalledOnce();
    expect(context.createOscillator).not.toHaveBeenCalled();
    element.sections = ['sound', 'lfo'];
    expect(prepare).toHaveBeenCalledOnce();
    prepare.mockRestore();
    element.lfo = {running: true};
    await settleLazyLfo();
    expect(element.lfo.running).toBe(true);
    expect(context.createOscillator).toHaveBeenCalledOnce();
  });
});
