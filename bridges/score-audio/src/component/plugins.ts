// The plugins and assets a component made in Studio needs (DEC-078), from
// public entries only, so the same project runs in Studio and in any page
// that installs the packages.

import {loadClipFromUrl} from '@webmusic/audio/play';
import {createSamplerPlugins} from '@webmusic/audio/play/headless';
import {multichannelPlugin, wamPlugin, type ProjectAssetReference, type ProjectPluginFactory, type WamPluginOptions} from '@webmusic/kernel/module';
import {createObjectPlugins, type ObjectEnvironment} from '@webmusic/kernel/objects';
import {loadScoreFromUrl} from '@webmusic/score/io';
import {MidiAccessSource, createMidiPlugins} from '@webmusic/score/play/headless';
import {createWebMusicProjectPlugins} from '../project';
import type {ComponentSurfaces} from './surfaces';

export interface ComponentPluginOptions {
  /** Where `print`, `js` output and object failures go; see `ObjectEnvironment`. */
  readonly objects?: ObjectEnvironment;
  /** The view objects' slots; omit for a component without views. */
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
 * the view objects; Web Audio Modules when configured; and `extra`.
 */
export function createComponentPlugins(options: ComponentPluginOptions = {}): readonly ProjectPluginFactory[] {
  // A score player also offers its playback source, for a roll that follows it.
  const bridge = createWebMusicProjectPlugins().map(factory => factory.id === 'webmusic.score-player' ? withSourceOutlet(factory) : factory);
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

function withSourceOutlet(factory: ProjectPluginFactory): ProjectPluginFactory {
  return Object.freeze({...factory, create: async (request: Parameters<ProjectPluginFactory['create']>[0]) => {
    const instance = await factory.create(request);
    return {...instance, ports: [...(instance.ports ?? []), {id: 'source', kind: 'source' as const, direction: 'output' as const}]};
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
