// The plugins and assets a component made in Studio needs (DEC-078), from
// public entries only, so the same project runs in Studio and in any page
// that installs the packages.

import {loadClipFromUrl} from '@webmusic/audio/play';
import {createSamplerPlugins} from '@webmusic/audio/play/headless';
import {
  multichannelPlugin, wamPlugin,
  type ProjectAssetReference, type ProjectFactoryRequest, type ProjectModuleInstance, type ProjectPluginFactory, type WamPluginOptions,
} from '@webmusic/kernel/module';
import {createObjectPlugins, type ObjectEnvironment} from '@webmusic/kernel/objects';
import {loadScoreFromUrl} from '@webmusic/score/io';
import {MidiAccessSource, createMidiPlugins, type ScorePlayerModule} from '@webmusic/score/play/headless';
import type {ScoreEditor} from '@webmusic/score/view/headless';
import {createWebMusicProjectPlugins} from '../project';
import type {ComponentSurfaces} from './surfaces';

export interface ComponentPluginOptions {
  /** Where `print`, `js` output and object failures go; see `ObjectEnvironment`. */
  readonly objects?: ObjectEnvironment;
  /** The slots of the official components placed in a graph; omit for a component without them. */
  readonly surfaces?: ComponentSurfaces;
  /** Web MIDI for the MIDI objects; one is made when omitted. */
  readonly midi?: MidiAccessSource;
  /** Web Audio Modules: the host group and which URLs to load. Without it, `webmusic.wam` modules stay unresolved. */
  readonly wam?: WamPluginOptions;
  /** More factories, such as prepared DSP processors (`processorPlugin`). */
  readonly extra?: readonly ProjectPluginFactory[];
}

/**
 * Every plugin a component may use: the Bridge's players, racks, effects and
 * LFO; `mc.` effects; the Kernel's objects; the sampler and MIDI objects;
 * the official components (DEC-081); Web Audio Modules when configured; and `extra`.
 */
export function createComponentPlugins(options: ComponentPluginOptions = {}): readonly ProjectPluginFactory[] {
  // A score player also offers its playback source, for a roll that follows it.
  const bridge = createWebMusicProjectPlugins().map(factory => factory.id === 'webmusic.score-player' ? withSourceOutlet(factory, options.surfaces) : factory);
  const effect = bridge.find(factory => factory.id === 'webmusic.effect')!;
  return Object.freeze([
    ...bridge,
    multichannelPlugin(effect),
    ...createObjectPlugins(options.objects),
    ...createSamplerPlugins(),
    ...createMidiPlugins(options.midi ?? new MidiAccessSource()),
    ...(options.surfaces ? options.surfaces.plugins() : []),
    ...(options.wam ? [wamPlugin(options.wam)] : []),
    ...(options.extra ?? []),
  ]);
}

/**
 * The score player with its `source` outlet. With `surfaces`, its box also
 * says which score it plays and plays the document that score becomes once a
 * view edits it (DEC-086): the engine, clock and route stay. The edited
 * score is saved in the box's config and read from it (DEC-087).
 */
function withSourceOutlet(factory: ProjectPluginFactory, surfaces?: ComponentSurfaces): ProjectPluginFactory {
  const source = {id: 'source', kind: 'source' as const, direction: 'output' as const};
  if (!surfaces) return Object.freeze({...factory, create: async (request: ProjectFactoryRequest) => {
    const instance = await factory.create(request);
    return {...instance, ports: [...(instance.ports ?? []), source]};
  }});
  return Object.freeze({...factory, create: async (request: ProjectFactoryRequest) => {
    const {id, config} = request.record;
    const leave = surfaces.enter(id);
    let instance: ProjectModuleInstance | undefined;
    try {
      await surfaces.revive(id, config, request.signal);
      instance = await factory.create(request);
      const created = instance;
      const ports = [...(created.ports ?? []), source];
      const module = created.module as Partial<ScorePlayerModule>;
      const score = module.player?.playback.snapshot().score;
      if (!score || typeof module.setDocumentSource !== 'function') return {...created, ports, dispose: () => { leave(); return created.dispose(); }};
      const slot = surfaces.slot(id);
      let playing: ScoreEditor | undefined;
      // The document when there is one; the constructed score again once it is let go.
      const play = () => {
        const document = slot.document.current;
        if (document === playing) return;
        playing = document;
        module.setDocumentSource!(document);
      };
      const releaseScore = slot.score.provide(score);
      // A box rebuilt after its score was edited, or made from a saved one, plays the document at once.
      play();
      const unsubscribe = slot.document.subscribe(play);
      return {...created, ports,
        exportConfig: () => surfaces.withDocument(id, created.exportConfig?.() ?? config),
        dispose: () => { unsubscribe(); releaseScore(); leave(); return created.dispose(); }};
    } catch (error) {
      leave();
      try { instance?.dispose(); } catch { /* The creation failure is the one to report. */ }
      throw error;
    }
  }});
}

const SCORE = /\.(mid|midi|mxl|musicxml|xml)$/i;
const AUDIO = /\.(wav|mp3|ogg|oga|flac|m4a|aac|webm)$/i;

/**
 * Load a project asset by its URI, relative to `base` (the page by default):
 * MIDI and MusicXML as a Score, audio files as an AudioClip. The media type
 * decides when the file name does not.
 */
export async function resolveComponentAsset(asset: ProjectAssetReference, signal: AbortSignal, base?: string | URL): Promise<unknown> {
  signal.throwIfAborted();
  const url = new URL(asset.uri, base ?? globalThis.location?.href ?? 'http://localhost/').href;
  const path = new URL(url).pathname;
  const type = asset.mediaType ?? '';
  if (SCORE.test(path) || /midi|musicxml/.test(type)) return loadScoreFromUrl(url);
  if (AUDIO.test(path) || type.startsWith('audio/')) return loadClipFromUrl(url, {signal});
  throw new Error(`No loader for the asset ${asset.uri}.`);
}
