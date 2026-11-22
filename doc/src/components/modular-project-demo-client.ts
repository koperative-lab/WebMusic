import {createAudioClip} from '@webmusic/audio';
import {createWebMusicProjectPlugins} from '@webmusic/bridge';
import {
  ModuleAudioEnvironment, ModuleProjectRuntime, ProjectPluginRegistry,
  createProjectEditorBinding, parseModuleProject, serializeModuleProject,
  type ConnectionLease, type ModuleProject,
} from '@webmusic/kernel/module';
import {Duration, MeasureId, PartId, Pitch, Rational, ScoreBuilder, VoiceId} from '@webmusic/score';
import {mountPatchEditor} from '@webmusic/ui/patch-editor';
import {mountDemos} from './demo-lifecycle';

const storageKey = 'webmusic-modular-project-demo-v1';
const missingPlugin = {id: 'demo.optional-filter', version: '1.0.0'};

function makeProject(): ModuleProject {
  return parseModuleProject({
    schema: 'webmusic.module-project', version: 1, id: 'modular-studio-demo',
    contexts: [{id: 'root'}, {id: 'voices', parentId: 'root', ownerModuleId: 'master'}],
    assets: [{id: 'melody', uri: 'demo:melody-v1'}, {id: 'pulse', uri: 'demo:pulse-v1'}],
    modules: [
      {id: 'master', plugin: {id: 'webmusic.audio-bus', version: '1.0.0'}, contextId: 'root', label: 'Master bus', config: {gain: 0.7}},
      {id: 'lead', plugin: {id: 'webmusic.score-player', version: '1.0.0'}, contextId: 'voices', label: 'Score melody', config: {waveform: 'sawtooth'},
        assets: {source: 'melody'}, params: {gain: 0.12, attackSeconds: 0.02, decaySeconds: 0.15, sustainLevel: 0.45, releaseSeconds: 0.08}},
      {id: 'pulse', plugin: {id: 'webmusic.audio-player', version: '1.0.0'}, contextId: 'voices', label: 'Audio pulse', config: {}, assets: {source: 'pulse'}, params: {volume: 0.35}},
      {id: 'filter', plugin: {id: 'webmusic.effect', version: '1.0.0'}, contextId: 'voices', label: 'Moving filter',
        config: {type: 'filter', options: {type: 'lowpass', frequency: 600, Q: 0.7}}},
      {id: 'vibrato', plugin: {id: 'webmusic.lfo', version: '1.0.0'}, contextId: 'voices', label: 'Session vibrato', config: {frequency: 3, phase: 0, waveform: 'sine', loop: 'repeat'}},
    ],
    connections: [{id: 'melody-filter', kind: 'audio', from: {moduleId: 'lead', port: 'output'}, to: {moduleId: 'filter', port: 'input'}, mode: 'replace'}],
    modulations: [{id: 'vibrato-pitch', source: {moduleId: 'vibrato', port: 'output'}, target: {moduleId: 'lead', param: 'detune'}, depth: 20}],
    macros: [{id: 'mix', label: 'Mix level', value: 0.5, targets: [
      {moduleId: 'master', param: 'gain', min: 0.4, max: 1}, {moduleId: 'pulse', param: 'volume', min: 0.2, max: 0.5},
    ]}],
    automation: [{id: 'filter-motion', target: {moduleId: 'filter', param: 'frequency'}, loop: 'repeat', points: [
      {type: 'set', timeSeconds: 0, value: 600}, {type: 'linear', timeSeconds: 2, value: 3200}, {type: 'linear', timeSeconds: 4, value: 600},
    ]}],
    session: {positionSeconds: 0, rate: 1, loop: {startSeconds: 0, endSeconds: 4}},
    layout: {modules: [
      {moduleId: 'lead', x: 24, y: 24}, {moduleId: 'pulse', x: 24, y: 360},
      {moduleId: 'filter', x: 304, y: 24}, {moduleId: 'master', x: 584, y: 24},
      {moduleId: 'vibrato', x: 304, y: 360},
    ]},
  });
}

function makeAssets() {
  const builder = new ScoreBuilder();
  const part = builder.addPart({id: PartId('project-melody'), name: 'Melody'});
  builder.addTempo({atQuarters: Rational.ZERO, bpm: 120});
  for (let bar = 0; bar < 2; bar++) builder.addMeasure({
    id: MeasureId(`project-bar-${bar}`), number: bar + 1,
    onsetQuarters: new Rational(bar * 4), durationQuarters: new Rational(4),
    timeSignature: {numerator: 4, denominator: 4},
  });
  ['C4', 'E4', 'G4', 'B4', 'A4', 'G4', 'E4', 'D4'].forEach((pitch, index) => builder.addNote(part, {
    id: builder.newNoteId(), voice: VoiceId('voice'), pitch: Pitch.parse(pitch),
    onsetQuarters: new Rational(index), duration: Duration.quarter(),
  }));
  const sampleRate = 24000;
  const samples = new Float32Array(sampleRate * 4);
  for (let index = 0; index < samples.length; index++) {
    const time = index / sampleRate;
    const beatTime = time % 0.5;
    samples[index] = Math.sin(2 * Math.PI * 220 * time) * Math.min(1, beatTime / 0.004) * Math.exp(-18 * beatTime) * 0.3;
  }
  return new Map<string, unknown>([
    ['demo:melody-v1', builder.build()],
    ['demo:pulse-v1', createAudioClip({sampleRate, channelData: [samples]})],
  ]);
}

mountDemos('[data-project-demo]', (root, scope) => {
  const find = <T extends Element>(name: string) => root.querySelector<T>(`[data-project-${name}]`)!;
  const feedback = find<HTMLElement>('feedback');
  const initialize = find<HTMLButtonElement>('initialize');
  const recover = find<HTMLButtonElement>('recover');
  const seek = find<HTMLInputElement>('seek');
  const rate = find<HTMLSelectElement>('rate');
  const loop = find<HTMLInputElement>('loop');
  const macro = find<HTMLInputElement>('macro');
  const name = find<HTMLInputElement>('name');
  const report = (error: unknown) => { if (scope.active) feedback.textContent = error instanceof Error ? error.message : String(error); };
  const audio = new ModuleAudioEnvironment();
  scope.add(() => audio.dispose());
  const assets = makeAssets();
  const plugins = new ProjectPluginRegistry();
  const factories = createWebMusicProjectPlugins();
  const registrations = factories.map(factory => plugins.register(factory));
  scope.add(() => { for (const registration of registrations) registration.release(); });
  let optional: ConnectionLease | undefined;
  scope.add(() => optional?.release());
  const runtime = new ModuleProjectRuntime({audio, plugins,
    resolveAsset(asset, signal) {
      signal.throwIfAborted();
      if (!assets.has(asset.uri)) throw new Error(`This demo cannot resolve asset ${asset.uri}. Its generated melody and pulse are the supported assets.`);
      return assets.get(asset.uri);
    },
    onCleanupError: report,
  });
  scope.add(() => runtime.dispose());
  const editor = mountPatchEditor(find<HTMLElement>('editor'), createProjectEditorBinding(runtime), {label: 'Demo project connections', onError: report});
  scope.add(() => editor.destroy());
  let busy = false;
  let commandFocus: {original: HTMLElement | null; moved: boolean} | undefined;
  scope.listen(document, 'focusin', () => { if (commandFocus) commandFocus.moved = true; });
  let movingSeek = false;
  const paint = () => {
    if (!scope.active) return;
    const session = runtime.session;
    const state = session?.snapshot;
    const ready = Boolean(state);
    root.dataset.projectState = busy ? 'loading' : ready ? 'ready' : 'empty';
    for (const fieldset of root.querySelectorAll<HTMLFieldSetElement>('[data-project-controls]')) fieldset.disabled = !ready || busy;
    initialize.hidden = ready;
    initialize.disabled = ready || busy;
    recover.disabled = !ready || busy || !runtime.snapshot().modules.some(module => module.record.plugin.id === missingPlugin.id && module.status === 'unresolved');
    if (!state) return;
    if (!movingSeek) seek.value = String(Math.min(4, state.position));
    find<HTMLOutputElement>('position').value = `${state.position.toFixed(2)} s`;
    rate.value = String(state.rate);
    loop.checked = Boolean(state.loop);
    const mix = runtime.getMacro('mix');
    macro.disabled = !mix;
    if (mix) { macro.value = String(mix.value); find<HTMLOutputElement>('macro-value').value = `${Math.round(mix.value * 100)}%`; }
    if (document.activeElement !== name) name.value = runtime.exportProject().modules.find(module => module.id === 'lead')?.label ?? 'lead';
    const cutoff = runtime.getModule('filter')?.params?.get('frequency')?.snapshot.baseValue;
    find<HTMLElement>('clock').textContent = `${state.paused ? 'Paused' : 'Playing'} · ${state.participantCount} sources on one Session${cutoff === undefined ? ' · filter unavailable' : ` · filter ${cutoff.toFixed(0)} Hz`} · vibrato follows Session position`;
  };
  const run = async (operation: () => void | Promise<unknown>, success: string) => {
    if (busy) return;
    const active = document.activeElement;
    const focus = {original: active && root.contains(active) ? active as HTMLElement : null, moved: false};
    commandFocus = focus;
    busy = true; paint();
    try { await operation(); if (scope.active) feedback.textContent = success; }
    catch (error) { report(error); }
    finally {
      busy = false; paint();
      if (commandFocus === focus) commandFocus = undefined;
      // Busy fieldsets blur their active control. Keep keyboard editing in place
      // unless the user has focused another control during the pending command.
      if (scope.active && !focus.moved && focus.original && root.contains(focus.original)) focus.original.focus();
    }
  };
  scope.add(runtime.subscribe(paint));
  const timer = window.setInterval(paint, 100);
  scope.add(() => window.clearInterval(timer));
  scope.listen(initialize, 'click', () => {
    if (runtime.session) return;
    return run(async () => {
      const context = audio.prepare() as AudioContext;
      await context.resume();
      if (!scope.active || runtime.session) return;
      await runtime.restore(makeProject(), {signal: scope.signal});
    }, 'Ready. Play the melody and pulse; the filter sweep and vibrato follow the same Session.');
  });
  scope.listen(find('play'), 'click', () => run(async () => {
    await (audio.prepare() as AudioContext).resume();
    if (scope.active) await runtime.session?.play();
  }, 'Playing. The sweep repeats every four Session seconds; changing speed changes both sources and modulation.'));
  scope.listen(find('pause'), 'click', () => run(() => runtime.session?.pause(), 'Paused. The filter holds its current base; Play resumes the Session trajectory.'));
  scope.listen(find('stop'), 'click', () => run(() => runtime.session?.stop(), 'Stopped at the beginning. Play starts the phrase and modulation from that position.'));
  scope.listen(rate, 'change', () => {
    const value = Number(rate.value);
    return run(() => runtime.session?.setRate(value), 'Session speed changed for the sources, sweep and vibrato.');
  });
  scope.listen(loop, 'change', () => {
    const enabled = loop.checked;
    return run(() => runtime.session?.setLoop(enabled ? {startSeconds: 0, endSeconds: 4} : null), enabled ? 'The four-second Session loop is enabled.' : 'Loop disabled. The finite sources can finish naturally.');
  });
  scope.listen(seek, 'input', () => { movingSeek = true; find<HTMLOutputElement>('position').value = `${Number(seek.value).toFixed(2)} s`; });
  scope.listen(seek, 'change', () => {
    const position = Number(seek.value);
    movingSeek = false;
    return run(() => runtime.session?.seek(position), 'Position changed. Playback and modulation re-enter from the same Session position.');
  });
  scope.listen(macro, 'input', () => {
    try { runtime.getMacro('mix')?.setValue(Number(macro.value)); paint(); }
    catch (error) { report(error); }
  });
  scope.listen(name, 'change', () => {
    const label = name.value.trim();
    return run(() => runtime.updatePresentation({modules: runtime.exportProject().modules.map(module => ({
      id: module.id, label: module.id === 'lead' ? label || 'Score melody' : module.label,
    }))}), 'Melody label changed. Its stable identity, connections and playback remain the same.');
  });
  scope.listen(find('save'), 'click', () => run(() => {
    localStorage.setItem(storageKey, serializeModuleProject(runtime.exportProject(), 2));
  }, 'Saved in this browser. Move a module or change a route, then load this snapshot to restore it.'));
  scope.listen(find('load'), 'click', () => run(async () => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) throw new Error('No project has been saved in this browser yet.');
    await runtime.restore(saved, {signal: scope.signal});
  }, 'Saved project restored, paused. Stable IDs restore connections and layout together.'));
  scope.listen(find('export'), 'click', () => run(() => {
    const blob = new Blob([serializeModuleProject(runtime.exportProject(), 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'webmusic-modular-project.json'; link.click();
    const revoke = window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    scope.add(() => { window.clearTimeout(revoke); URL.revokeObjectURL(url); });
  }, 'Exported the project document. It references the generated assets, without embedding audio samples.'));
  const file = find<HTMLInputElement>('import');
  scope.listen(file, 'change', () => run(async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    if (selected.size > 2 * 1024 * 1024) throw new Error('Choose a project JSON file smaller than 2 MiB.');
    const text = await selected.text();
    if (scope.active) await runtime.restore(text, {signal: scope.signal});
    file.value = '';
  }, 'Imported project restored, paused. Missing modules remain visible and can be recovered.'));
  scope.listen(find('missing'), 'click', () => run(async () => {
    optional?.release(); optional = undefined;
    const project = runtime.exportProject();
    await runtime.restore({...project, modules: project.modules.map(module => module.id === 'filter' ? {...module, plugin: missingPlugin} : module)}, {signal: scope.signal});
  }, 'The filter plugin is unavailable. Its module, connection and automation records remain in the project. Make the module available to recover it.'));
  scope.listen(recover, 'click', () => run(async () => {
    const factory = factories.find(factory => factory.id === 'webmusic.effect')!;
    optional ??= plugins.register({...missingPlugin, create: request => factory.create(request)});
    await runtime.retryMissing({signal: scope.signal});
  }, 'The filter and its saved connection are restored. Playback remains paused until Play.'));
  scope.listen(find('reset'), 'click', () => run(() => runtime.restore(makeProject(), {signal: scope.signal}), 'Original demo restored, paused. Your browser-saved snapshot remains available.'));
  paint();
});
