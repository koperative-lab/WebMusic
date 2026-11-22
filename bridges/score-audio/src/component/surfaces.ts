// Components placed in a graph (DEC-081): the runtime side of each official
// component's box, with no DOM. One project plugin per manifest makes the
// ports the manifest declares and hands the slot what the Element borrows.
// Studio and exported components use the same plugins.
//
// A slot outlives the runtime modules behind it. A rebuild creates the new
// module before it disposes the old one, and a failed rebuild disposes the new
// one and keeps the old, so a slot keeps every provided value in creation
// order and shows the newest one still provided.
//
// A player or desk (DEC-084) plays inside the graph: its box makes an output
// bus and lends the Element a module context with the graph's audio
// environment and Session whose default destination is that bus, so the
// player's engine joins the graph's Session. A desk's inputs are gain nodes,
// each offered to the Element as one channel to admit.
//
// A score a box plays can be edited from a view cabled to it (DEC-086): the
// first view that asks turns the box's score into a document, which the box
// then plays and lends to every editing view its `source` cords reach. The
// surfaces own each document for as long as its box is in the graph, so an
// edit outlives a rebuild of the graph.
//
// An edited score is saved with its box (DEC-087): the box's exported config
// holds it under `document`, compressed, and a box made from a config that
// holds one starts with that document. The asset is never written.
//
// Ownership: each plugin instance owns its analyser, note port, buses and
// channel ports, and releases what it provided on dispose. Elements borrow;
// they never dispose a value. A loaded asset is data, not a resource.

import {AudioClip} from '@webmusic/audio';
import {
  AudioOutputPort, NoteInputPort, NoteOutputPort, SourceRelay, createConnectionLease, routeModuleOutput, sourceOrigin,
  type ConnectionLease, type ModuleContext, type ModuleHandle, type NoteEvent, type ProjectConnector,
  ProjectModuleUnavailableError,
  type ProjectFactoryRequest, type ProjectJson, type ProjectJsonObject, type ProjectModuleInstance, type ProjectPluginFactory, type ProjectPortDescriptor,
} from '@webmusic/kernel/module';
import {Score} from '@webmusic/score';
import {createScoreEditor, type ScoreEditor} from '@webmusic/score/view/headless';
import {decodeScore, encodeScore} from './document';
import {OFFICIAL_COMPONENTS, type ComponentManifest} from './manifest';

const PLUGIN_VERSION = '1.0.0';

/** One provided value, newest wins while it is provided. */
class Provided<T> {
  readonly #values: {value: T}[] = [];
  readonly #listeners = new Set<() => void>();
  get current(): T | undefined { return this.#values[this.#values.length - 1]?.value; }
  provide(value: T): () => void {
    const entry = {value};
    this.#values.push(entry);
    this.#notify();
    return () => {
      const index = this.#values.indexOf(entry);
      if (index < 0) return;
      this.#values.splice(index, 1);
      this.#notify();
    };
  }
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }
  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
  }
}

/** One desk input offered to the Element: admit `port` as the channel of `module`. */
export interface SurfaceChannel {
  readonly module: ModuleHandle;
  readonly port: AudioOutputPort;
}

/** One playlist entry the box loaded: an asset role, the file's name and its clip. */
export interface SurfaceEntry {
  readonly id: string;
  readonly label: string;
  readonly clip: AudioClip;
}

/** What one component's Element borrows, by module ID: one value per binding. */
export class SurfaceSlot {
  /** The analyser an audio input hands the Element's `analyser`. */
  readonly analyser = new Provided<AnalyserNode>();
  /** The module a source input hands the Element's `inputModule`, through its `source` cord. */
  readonly source = new Provided<ModuleHandle>();
  /** The note output of the newest module; the Element's `module` plays into it. */
  readonly notes = new Provided<(event: NoteEvent) => void>();
  /** The module context lent to a player or desk: the graph's Session, with this box's output as its destination. */
  readonly context = new Provided<ModuleContext>();
  /** A desk's inputs, which the Element admits as channels. */
  readonly channels = new Provided<readonly SurfaceChannel[]>();
  /** A module whose `notes` output repeats the notes cabled to this box; the Element's `inputModule` listens to it. */
  readonly noteSource = new Provided<ModuleHandle>();
  /** The asset the box loaded for the Element: a Score, an AudioClip, or a playlist's entries. */
  readonly asset = new Provided<Score | AudioClip | readonly SurfaceEntry[]>();
  /** The Element's own module, provided by the host; a source cord from this box carries it. */
  readonly element = new Provided<ModuleHandle>();
  /** An insert's ends: the graph's AudioContext, the node the box's input feeds and the node its output plays from. */
  readonly insert = new Provided<{readonly context: BaseAudioContext; readonly input: AudioNode; readonly output: AudioNode}>();
  /** The Element itself, provided by the host, for a companion that links to its player. */
  readonly elementOwner = new Provided<object>();
  /** The Element of the box a `source` cord comes from, for a `player` binding. */
  readonly sourceOwner = new Provided<object>();
  /** True when a source cord from this box carries the Element's module rather than the box's. */
  forwardsElement = false;
  /** The Score this box plays, when it plays one: what its document starts from. */
  readonly score = new Provided<Score>();
  /** The document this box's score became once a view asked to edit it (DEC-086): the box plays it. */
  readonly document = new Provided<ScoreEditor>();
  /**
   * For a box with a source input: lends the document of the box its cord
   * comes from, making it on the first call. A view calls it when it edits;
   * it returns nothing while that box has no score.
   */
  readonly lender = new Provided<() => ScoreEditor | undefined>();
}

/** A box's document and what the box saves of it. */
interface Kept {
  readonly editor: ScoreEditor;
  /** The content the document began with. */
  readonly initial: string;
  /** The saved score the document began as; none when it began as the box's asset. */
  readonly restored?: ProjectJson;
  /** The content last heard of. */
  seen: string;
  /** The content last encoded and its saved form, which is none when it cannot be saved. */
  saved?: {readonly contentId: string; readonly value: ProjectJsonObject | undefined};
  encoding: boolean;
  release: () => void;
}

/**
 * What a box that plays a score holds: `original` its asset as loaded,
 * `edited` a score that is saved with the box, `unsaved` an edited score
 * that cannot be saved (too large for a project, or no compression here).
 */
export type ComponentDocumentState = 'original' | 'edited' | 'unsaved';

export class ComponentSurfaces {
  readonly #slots = new Map<string, SurfaceSlot>();
  readonly #byModule = new WeakMap<ModuleHandle, SurfaceSlot>();
  readonly #documents = new Map<string, Kept>();
  readonly #alive = new Map<string, number>();
  readonly #pending = new Set<Promise<void>>();
  readonly #listeners = new Set<() => void>();

  /**
   * The document of the box `id`: the editor that owns the score it plays
   * (DEC-086). Made from the box's score the first time it is asked for and
   * kept while the box is in the graph, whatever is rebuilt; undefined while
   * the box has no score. `peek` only looks.
   */
  document(id: string, peek = false): ScoreEditor | undefined {
    const known = this.#documents.get(id);
    if (known || peek) return known?.editor;
    const score = this.slot(id).score.current;
    if (!score) return undefined;
    return this.#keep(id, createScoreEditor(score)).editor;
  }

  /**
   * What the box `id` holds of the score it plays (DEC-087); undefined when
   * it plays none.
   */
  documentState(id: string): ComponentDocumentState | undefined {
    const kept = this.#documents.get(id);
    if (!kept) return this.#slots.get(id)?.score.current ? 'original' : undefined;
    const contentId = kept.editor.getSnapshot().contentId;
    if (contentId === kept.initial) return kept.restored === undefined ? 'original' : 'edited';
    // An encoding still under way is taken as one that will be saved.
    return kept.saved?.contentId === contentId && kept.saved?.value === undefined ? 'unsaved' : 'edited';
  }

  /**
   * `config` as the box `id` is saved (DEC-087): with its edited score under
   * `document`, and without one once the document is the asset again. A box
   * nobody edited keeps the config it has. The newest edit is encoded off
   * the call, so it is in the config once `settled` resolves; subscribers
   * are told when it is.
   */
  withDocument(id: string, config: ProjectJsonObject): ProjectJsonObject {
    const kept = this.#documents.get(id);
    if (!kept) return config;
    const {document: _previous, ...rest} = config;
    const value = kept.editor.getSnapshot().contentId === kept.initial ? kept.restored : kept.saved?.value ?? kept.restored;
    return value === undefined ? rest : {...rest, document: value};
  }

  /**
   * Start the box `id` from the score its `config` saved (DEC-087). A
   * document already edited here stays: it is newer than any config. Rejects
   * with `ProjectModuleUnavailableError` when the saved score cannot be read,
   * so the box stays unresolved with its config, and nothing is lost.
   */
  async revive(id: string, config: ProjectJsonObject, signal?: AbortSignal): Promise<void> {
    const saved = config.document;
    if (saved === undefined || this.#edited(id)) return;
    let editor: ScoreEditor;
    try { editor = createScoreEditor(await decodeScore(saved)); } catch (error) {
      throw new ProjectModuleUnavailableError(`The saved score of ${id} cannot be read: ${error instanceof Error ? error.message : String(error)}`, {cause: error});
    }
    signal?.throwIfAborted();
    if (this.#edited(id)) return;
    // An untouched document made from the asset gives way; its views borrow the restored one.
    const untouched = this.#documents.get(id);
    this.#keep(id, editor, saved);
    untouched?.release();
    this.#notify();
  }

  /**
   * Give the box `id` its asset back (DEC-087): its edited document is let
   * go and a new one, made from the score the box loaded, takes its place, so
   * the box plays the asset at once and the views that edit borrow it. The
   * box then saves no score. Nothing happens while the box has no document.
   */
  revert(id: string): void {
    const kept = this.#documents.get(id);
    if (!kept) return;
    const score = this.#slots.get(id)?.score.current;
    if (!score) { this.forget(id); return; }
    // The new document is provided before the old one is released: the box is never without one in between.
    this.#keep(id, createScoreEditor(score));
    kept.release();
    this.#notify();
  }

  /**
   * Let go of the document of the box `id`, or of every box, and make none.
   * A host calls it before it shows another project, whose boxes may have
   * the same IDs; `revert` is the one for a box that stays.
   */
  forget(id?: string): void {
    const ids = id === undefined ? [...this.#documents.keys()] : this.#documents.has(id) ? [id] : [];
    for (const key of ids) {
      const kept = this.#documents.get(key)!;
      this.#documents.delete(key);
      kept.release();
    }
    if (ids.length) this.#notify();
  }

  /**
   * Count a module of the box `id` as in a graph; call the result when it is
   * disposed. A rebuild makes the new module before it disposes the old one,
   * so the document goes only when the box itself does, and a new box that
   * is given the same ID does not inherit it.
   */
  enter(id: string): () => void {
    this.#alive.set(id, (this.#alive.get(id) ?? 0) + 1);
    let left = false;
    return () => {
      if (left) return;
      left = true;
      const count = (this.#alive.get(id) ?? 1) - 1;
      if (count > 0) { this.#alive.set(id, count); return; }
      this.#alive.delete(id);
      this.forget(id);
    };
  }

  /** Told when what a box saves of its score changed: an edit, its encoding, a revert. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Resolves once every edit made so far is encoded, so `withDocument` holds it. */
  async settled(): Promise<void> {
    while (this.#pending.size) await Promise.all([...this.#pending]);
  }

  #edited(id: string): boolean {
    const kept = this.#documents.get(id);
    return !!kept && (kept.restored !== undefined || kept.editor.getSnapshot().contentId !== kept.initial);
  }

  #keep(id: string, editor: ScoreEditor, restored?: ProjectJson): Kept {
    const initial = editor.getSnapshot().contentId;
    const kept: Kept = {editor, initial, ...(restored !== undefined ? {restored} : {}), seen: initial, encoding: false, release: () => {}};
    this.#documents.set(id, kept);
    const unsubscribe = editor.subscribe(() => this.#encode(id, kept));
    // Provided for as long as the document is kept: the box plays it.
    const unprovide = this.slot(id).document.provide(editor);
    kept.release = () => { unsubscribe(); unprovide(); };
    return kept;
  }

  /** Encode the document's content when it changed; one at a time, the newest last. */
  #encode(id: string, kept: Kept): void {
    if (this.#documents.get(id) !== kept) return;
    const {contentId, content, status} = kept.editor.getSnapshot();
    if (status === 'disposed') return;
    if (contentId !== kept.seen) { kept.seen = contentId; this.#notify(); }
    if (contentId === kept.initial || kept.encoding || kept.saved?.contentId === contentId) return;
    kept.encoding = true;
    const work: Promise<void> = encodeScore(content).catch(() => undefined).then(value => {
      kept.encoding = false;
      this.#pending.delete(work);
      kept.saved = {contentId, value};
      if (this.#documents.get(id) !== kept) return;
      this.#notify();
      this.#encode(id, kept);
    });
    this.#pending.add(work);
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) {
      try { listener(); } catch (error) { queueMicrotask(() => { throw error; }); }
    }
  }

  slot(id: string): SurfaceSlot {
    let slot = this.#slots.get(id);
    if (!slot) {
      const made = slot = new SurfaceSlot();
      this.#slots.set(id, made);
      // Which box an Element's module belongs to, so a cord that crossed component edges still finds that box (DEC-089).
      made.element.subscribe(() => { const module = made.element.current; if (module) this.#byModule.set(module, made); });
    }
    return slot;
  }

  /** The box whose Element's module is `module`'s origin, through any relays. */
  #boxOf(module: ModuleHandle | undefined): SurfaceSlot | undefined {
    const origin = sourceOrigin(module);
    return origin ? this.#byModule.get(origin) : undefined;
  }

  /** One plugin per official component's manifest. */
  plugins(): readonly ProjectPluginFactory[] {
    return Object.freeze(OFFICIAL_COMPONENTS.map(manifest => ({
      id: manifest.plugin, version: PLUGIN_VERSION, create: (request: ProjectFactoryRequest) => this.#create(manifest, request),
    })));
  }

  /**
   * The runtime connector for `source` cords: a source input follows the
   * upstream module. From a player's box it follows the player's own module,
   * which the host provides once the Element has one.
   */
  readonly connect: ProjectConnector = ({connection, from}) => {
    if (connection.kind !== 'source') return undefined;
    const reached = this.slot(connection.to.moduleId);
    const target = reached.source;
    const sourceId = connection.from.moduleId;
    const upstream = this.#slots.get(sourceId);
    // The cord also offers the source's document to a view that edits; offered again when the source's score
    // arrives and when its document is replaced or let go, so the view asks again. The new offer is made
    // before the old one is withdrawn: a view is never without one in between.
    const origin = this.slot(sourceId);
    let offered: (() => void) | undefined;
    const offer = () => { const previous = offered; offered = reached.lender.provide(() => this.document(sourceId)); previous?.(); };
    offer();
    const unoffers = [origin.score.subscribe(offer), origin.document.subscribe(offer)];
    const withdraw = () => { for (const unoffer of unoffers) unoffer(); offered?.(); offered = undefined; };
    if (!upstream?.forwardsElement) {
      const release = target.provide(from.module);
      const relay = from.module instanceof SourceRelay ? from.module : undefined;
      if (!relay) return createConnectionLease(() => { withdraw(); release(); });
      // Across component edges the cord carries a relay: its origin's box lends the Element a companion links to.
      let owned: (() => void) | undefined;
      const own = () => {
        owned?.();
        const element = this.#boxOf(relay)?.elementOwner.current;
        owned = element ? reached.sourceOwner.provide(element) : undefined;
      };
      own();
      const stop = relay.subscribe(own);
      return createConnectionLease(() => { withdraw(); stop(); owned?.(); owned = undefined; release(); });
    }
    // One provision of the Element's module and one of the Element, each replaced when it changes.
    const follow = <T>(source: Provided<T>, into: Provided<T>): (() => void) => {
      let provided: (() => void) | undefined;
      const apply = () => {
        provided?.();
        const value = source.current;
        provided = value !== undefined ? into.provide(value) : undefined;
      };
      apply();
      const unsubscribe = source.subscribe(apply);
      return () => { unsubscribe(); provided?.(); provided = undefined; };
    };
    const stops = [follow(upstream.element, target), follow(upstream.elementOwner, reached.sourceOwner)];
    return createConnectionLease(() => { withdraw(); for (const stop of stops) stop(); });
  };

  /** Synchronous unless the box has an asset to load; the asset loads first, so a failed load leaves nothing behind. */
  #create(manifest: ComponentManifest, request: ProjectFactoryRequest): ProjectModuleInstance | Promise<ProjectModuleInstance> {
    const wanted = manifest.asset;
    if (wanted?.kind === 'entries') {
      // Every role with the prefix, in number order: `entry2` before `entry10`.
      const roles = Object.keys(request.record.assets ?? {}).filter(role => role.startsWith(wanted.role))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
      if (!roles.length) return this.#build(manifest, request, undefined);
      return Promise.all(roles.map(role => request.resolveAsset(role))).then(clips => {
        request.signal.throwIfAborted();
        const entries = clips.map((clip, index) => {
          const role = roles[index]!;
          if (!(clip instanceof AudioClip)) throw new TypeError(`The ${manifest.name} asset ${role} must resolve to an AudioClip.`);
          let label = (request.asset(role)?.uri ?? role).split(/[?#]/)[0]!.split('/').pop() || role;
          try { label = decodeURIComponent(label); } catch { /* Keep the raw name. */ }
          return Object.freeze({id: role, label, clip});
        });
        return this.#build(manifest, request, Object.freeze(entries));
      });
    }
    if (!wanted || !request.asset(wanted.role)) return this.#build(manifest, request, undefined);
    return request.resolveAsset(wanted.role).then(async asset => {
      request.signal.throwIfAborted();
      const loaded = wanted.kind === 'score' ? asset instanceof Score && asset : asset instanceof AudioClip && asset;
      if (!loaded) throw new TypeError(`The ${manifest.name} asset must resolve to ${wanted.kind === 'score' ? 'a Score' : 'an AudioClip'}.`);
      if (!(loaded instanceof Score)) return this.#build(manifest, request, loaded);
      // A box that plays a score starts from the one saved with it (DEC-087).
      const leave = this.enter(request.record.id);
      try {
        await this.revive(request.record.id, request.record.config, request.signal);
        return this.#build(manifest, request, loaded, leave);
      } catch (error) { leave(); throw error; }
    });
  }

  #build(manifest: ComponentManifest, {record, context}: ProjectFactoryRequest, asset: Score | AudioClip | readonly SurfaceEntry[] | undefined, leave?: () => void): ProjectModuleInstance {
    const slot = this.slot(record.id);
    const ports: ProjectPortDescriptor[] = [];
    const inputs = new Map<string, AudioNode>();
    const outputs = new Map<string, AudioOutputPort>();
    const notePorts: NoteOutputPort[] = [];
    const noteInputs: NoteInputPort[] = [];
    const channels: SurfaceChannel[] = [];
    const releases: (() => void)[] = [];
    const routes: (() => ConnectionLease)[] = [];
    let insertEnds: {context: BaseAudioContext; input: GainNode; output: GainNode} | undefined;
    let carried: SourceRelay | undefined;
    for (const port of manifest.ports) {
      if (port.bind === 'context') {
        const bus = context.audio.prepare().createGain();
        const output = new AudioOutputPort(bus, {id: port.id});
        outputs.set(port.id, output);
        const lent = context.derive({id: `${record.id}:component`, destination: () => bus, admit: null, target: null});
        routes.push(() => routeModuleOutput(context, module, output));
        // Released in reverse: the Element leaves the context before its bus closes.
        releases.push(() => { output.dispose(); bus.disconnect(); }, slot.context.provide(lent));
        ports.push({id: port.id, kind: 'audio', direction: 'output'});
      } else if (port.bind === 'admit') {
        const input = context.audio.prepare().createGain();
        inputs.set(port.id, input);
        const output = new AudioOutputPort(input, {id: port.id});
        channels.push(Object.freeze({module: Object.freeze({id: port.channel}), port: output}));
        releases.push(() => { output.dispose(); input.disconnect(); });
        ports.push({id: port.id, kind: 'audio', direction: 'input'});
      } else if (port.family === 'source' && port.direction === 'output') {
        slot.forwardsElement = true;
        // A cord from this box carries the Element's module, through a relay that follows it (DEC-089).
        if (!carried) {
          const relay = new SourceRelay(record.id);
          let followed: ConnectionLease | undefined;
          const follow = () => {
            const module = slot.element.current;
            const previous = followed;
            followed = module ? relay.follow(module) : undefined;
            previous?.release();
          };
          follow();
          const stop = slot.element.subscribe(follow);
          releases.push(() => { stop(); followed?.release(); relay.dispose(); });
          carried = relay;
        }
        ports.push({id: port.id, kind: 'source', direction: 'output'});
      } else if (port.bind === 'analyser') {
        const analyser = context.audio.prepare().createAnalyser();
        analyser.fftSize = port.fftSize;
        inputs.set(port.id, analyser);
        const release = slot.analyser.provide(analyser);
        releases.push(() => { release(); analyser.disconnect(); });
        ports.push({id: port.id, kind: 'audio', direction: 'input'});
      } else if (port.family === 'note' && port.direction === 'input') {
        // The cords play into the box; the box repeats them on an output the Element listens to.
        const relay = new NoteOutputPort({id: 'notes'});
        const input = new NoteInputPort({accept: (event: NoteEvent) => {
          if (relay.disposed) return;
          if (event.gate !== 'on' && !relay.held.some(held => held.occurrenceId === event.occurrenceId)) return;
          relay.emit(event);
        }}, {id: port.id, multiplicity: 'sum'});
        noteInputs.push(input);
        const release = slot.noteSource.provide(Object.freeze({id: `${record.id}:notes`, ports: () => [relay]}));
        releases.push(() => { release(); input.dispose(); relay.dispose(); });
        ports.push({id: port.id, kind: 'note', direction: 'input'});
      } else if (port.bind === 'inputModule' || port.bind === 'moduleTarget' || port.bind === 'player' || port.bind === 'owner') {
        ports.push({id: port.id, kind: 'source', direction: 'input'});
      } else if (port.bind === 'insert') {
        // Both ends are made once, by the first insert port; the Element's chain goes between them.
        if (!insertEnds) {
          const audio = context.audio.prepare();
          const from = audio.createGain(), to = audio.createGain();
          insertEnds = {context: audio, input: from, output: to};
        }
        if (port.direction === 'input') inputs.set(port.id, insertEnds.input);
        else {
          const output = new AudioOutputPort(insertEnds.output, {id: port.id});
          outputs.set(port.id, output);
          routes.push(() => routeModuleOutput(context, module, output));
          releases.push(() => output.dispose());
        }
        ports.push({id: port.id, kind: 'audio', direction: port.direction});
      } else {
        const notes = new NoteOutputPort({id: port.id});
        // A rebuild can drop the port while a key is held: the old port cancels it,
        // and the new one must not see a release it never started.
        const forward = (event: NoteEvent) => {
          if (notes.disposed) return;
          if (event.gate !== 'on' && !notes.held.some(held => held.occurrenceId === event.occurrenceId)) return;
          notes.emit(event);
        };
        const release = slot.notes.provide(forward);
        notePorts.push(notes);
        releases.push(() => { release(); notes.dispose(); });
        ports.push({id: port.id, kind: 'note', direction: 'output'});
      }
    }
    const module: ModuleHandle = {id: record.id,
      ...(notePorts.length || noteInputs.length ? {ports: () => [...notePorts, ...noteInputs]} : {}),
      ...(outputs.size ? {getPort: (name: string) => outputs.get(name)} : {})};
    const registration = notePorts.length || noteInputs.length ? context.registry.register(module) : undefined;
    // The box's output plays to the graph like any module's until a cord replaces it.
    const leases = routes.map(route => route());
    if (insertEnds) {
      const ends = insertEnds;
      releases.push(() => { ends.input.disconnect(); ends.output.disconnect(); }, slot.insert.provide(Object.freeze(ends)));
    }
    // No output needs the context, but the Element works in the graph's AudioContext, or follows a player through it.
    if ((manifest.scope || manifest.ports.some(port => port.bind === 'owner')) && !manifest.ports.some(port => port.bind === 'context')) releases.push(slot.context.provide(context.derive({id: `${record.id}:component`, admit: null, target: null})));
    if (channels.length) releases.push(slot.channels.provide(Object.freeze(channels)));
    if (asset !== undefined) releases.push(slot.asset.provide(asset));
    // A player's score is what a view cabled to it may edit.
    if (asset instanceof Score) releases.push(slot.score.provide(asset));
    const carries = carried;
    return {
      module,
      ports,
      ...(inputs.size ? {getInput: (name: string) => inputs.get(name)} : {}),
      ...(carries ? {sourceOutput: () => carries} : {}),
      ...(leave ? {exportConfig: () => this.withDocument(record.id, record.config)} : {}),
      dispose: () => {
        for (const lease of leases) lease.release();
        // A desk's channels and the lent context go first, so the Element lets go of them before they close.
        for (const release of releases.reverse()) release();
        registration?.release();
        leave?.();
      },
    };
  }
}
