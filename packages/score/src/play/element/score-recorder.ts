// ============================================================================
// <score-recorder> — capture live note events as a Score, replay the take, and
// export it as MIDI or MusicXML. The element coordinates DOM/audio lifecycles;
// note pairing, notation, export, and view rendering live in internal modules.
// ============================================================================

import type {Score} from '../../core';
import type {HeadlessSynth} from '../headless/audio-contracts';
import {ScorePlayer} from '../headless/score-player';
import {InteractivePlayer} from '../headless/interactive-player';
import {Sound} from '../headless/sound';
import {numAttr} from './internal/base';
import {HTMLElementBase, upgradeProperties} from './internal/base';
import {downloadScoreRecorderTake} from './internal/score-recorder-export';
import {
  recordedNotesToScore,
  SCORE_RECORDER_VOICE,
  ScoreRecorderSession,
  type ScoreRecorderRecordedDetail,
} from '../headless/recorder';
import {mountRecorder, type RecorderHandle} from '@webmusic/ui/recorder';
import {observeModuleContext, observeModuleInput} from '@webmusic/kernel/element';
import {
  NoteInputPort,
  type ModuleContext,
  type ModuleHandle,
  type ModulePort,
  type NoteEvent,
  type NoteOutputPort,
} from '@webmusic/kernel/module';
import {ScorePlayerModule} from '../headless/score-module';

export type {ScoreRecorderRecordedDetail} from '../headless/recorder';

export interface ScoreRecorderErrorDetail {
  operation: 'play';
  error: unknown;
}

/** Structural shape of a `webscore:noteon` / `webscore:noteoff` detail. */
interface NoteEventDetail {
  midi: number;
  velocity?: number;
}

const RECORDER_THEME = [
  ['background', 'bg', 'var(--wm-surface,light-dark(#fff,#111))'],
  ['border', 'border', 'var(--wm-border,light-dark(#d8d8d8,#333))'],
  ['text', 'text', 'var(--wm-foreground,light-dark(#111,#eee))'],
  // Recording is a listed colour meaning, so it has its own token rather than
  // borrowing an accent (Visual design → Palette).
  ['accent', 'rec', 'var(--wm-recording,light-dark(#c62828,#ef5350))'],
  ['accent-text', 'rec-color', 'var(--wm-accent-foreground,light-dark(#fff,#111))'],
  ['button', 'btn', 'var(--wm-surface,light-dark(#fff,#111))'],
  ['button-border', 'btn-border', 'var(--wm-control-border,var(--wm-border,light-dark(#d8d8d8,#333)))'],
  ['muted', 'label', 'var(--wm-foreground-muted,light-dark(#777,#aaa))'],
  ['radius', 'radius', 'var(--wm-control-radius,0)'],
];
// Preserve inherited public tokens before mapping the legacy --rec-* names.
const RECORDER_COMPATIBILITY_STYLE = `
:host{min-width:0;max-width:100%;box-sizing:border-box;${RECORDER_THEME.map(([name, , fallback]) => `--wui-recorder-host-${name}:var(--wm-recorder-${name},${fallback});`).join('')}}
:host(:not([hidden])){display:block}
:host([hidden]){display:none}
[part~="root"]{background:var(--wm-score-recorder-surface-background,var(--wm-recorder-surface-background,var(--wm-component-background,var(--wm-recorder-background,var(--wm-surface,light-dark(#fff,#111))))));border:var(--wm-score-recorder-surface-border,var(--wm-recorder-surface-border,var(--wm-component-border,1px solid var(--wm-recorder-border,var(--wm-border,light-dark(#d8d8d8,#333))))));${RECORDER_THEME.map(([name, legacy]) => `--wm-recorder-${name}:var(--rec-${legacy},var(--wui-recorder-host-${name}));`).join('')}}
`;

/**
 * `<score-recorder>` attributes: `bpm` (default 120) and `quantize` (grid in
 * quarters; 0 preserves performed timing). Both values are NaN-safe. `input`
 * and `port` select a note output port to record (DEC-068).
 */
export class ScoreRecorderElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return ['bpm', 'quantize', 'input', 'port'];
  }

  private static nextModuleId = 0;
  private readonly moduleId = `score-recorder-${++ScoreRecorderElement.nextModuleId}`;
  /** Note sink: events delivered to this port are captured while armed. */
  private readonly noteInput = new NoteInputPort({accept: (event) => this.captureNote(event)}, {id: 'notes', multiplicity: 'sum'});
  private readonly recorderModule: ModuleHandle = createModuleFacade(() => this.id || this.moduleId, Object.freeze([this.noteInput]));
  private readonly portNotes = new Map<string, number>();
  private scope?: ModuleContext;
  private stopScope?: () => void;
  private stopInput?: () => void;
  private stopInputNotes?: () => void;
  private assignedInput?: ModuleHandle | null;
  private auditionModule?: ScorePlayerModule;
  private auditionSequence = 0;

  private root?: ShadowRoot;
  private ui?: RecorderHandle;
  private compatibilityStyle?: HTMLStyleElement;
  private readonly session = new ScoreRecorderSession();
  private live?: InteractivePlayer;
  private soundRef?: HeadlessSynth;
  private explicitContext?: AudioContext;
  private sourceRef?: EventTarget;
  private sourceListening?: EventTarget;
  private seenNoteEvents = new WeakMap<Event, {target: EventTarget | null; listener: EventTarget}>();
  private takeScore?: Score;
  private playback?: ScorePlayer;
  private playbackOff?: () => void;
  private playbackGeneration = 0;
  private playing = false;
  private playbackPending = false;
  private playbackFailure?: string;
  private selfListening = false;

  private readonly onNoteEvent = (event: Event): void => {
    if (!this.session.active) return;
    const detail = (event as CustomEvent<NoteEventDetail>).detail;
    if (!detail || typeof detail.midi !== 'number') return;
    // A nested/ancestor source can deliver one bubbling dispatch to both
    // subscriptions. Consume it once, while allowing the same Event object
    // to be dispatched again to its original target.
    if (event.currentTarget) {
      const previous = this.seenNoteEvents.get(event);
      if (previous?.target === event.target && previous.listener !== event.currentTarget) {
        this.seenNoteEvents.delete(event);
        return;
      }
      this.seenNoteEvents.set(event, {target: event.target, listener: event.currentTarget});
    }
    const completed = this.session.capture(
      detail.midi,
      detail.velocity ?? 100,
      event.type === 'webscore:noteon',
    );
    if (completed) this.refresh();
  };

  connectedCallback(): void {
    upgradeProperties(this, ['sound', 'source', 'audioContext', 'inputModule', 'bpm', 'quantize']);
    if (!this.root) this.root = this.attachShadow({mode: 'open'});
    this.render();
    if (!this.selfListening) {
      this.addEventListener('webscore:noteon', this.onNoteEvent);
      this.addEventListener('webscore:noteoff', this.onNoteEvent);
      this.selfListening = true;
    }
    this.attachSource();
    this.bindScope();
    this.bindInput();
  }

  disconnectedCallback(): void {
    this.releaseInput();
    this.stopScope?.();
    this.stopScope = undefined;
    this.scope = undefined;
    if (this.selfListening) {
      this.removeEventListener('webscore:noteon', this.onNoteEvent);
      this.removeEventListener('webscore:noteoff', this.onNoteEvent);
      this.selfListening = false;
    }
    this.detachSource();
    this.stopPlayback();
    this.live?.dispose();
    this.live = undefined;
    this.session.cancel();
    this.ui?.destroy();
    this.ui = undefined;
  }

  attributeChangedCallback(name: string): void {
    // bpm / quantize are read lazily when the current take stops.
    if ((name === 'input' || name === 'port') && this.isConnected) this.bindInput();
  }

  /**
   * This recorder as a note **Sink** module (DEC-068): its `notes` input port
   * captures delivered events while a take is armed.
   */
  get module(): ModuleHandle { return this.recorderModule; }

  /**
   * Explicit module input: record this module's note output port (`notes`,
   * or the one `port` names) instead of the `input` selector or the
   * enclosing scope's target. `null` disables module input.
   */
  get inputModule(): ModuleHandle | null | undefined { return this.assignedInput; }
  set inputModule(value: ModuleHandle | null | undefined) {
    if (value === this.assignedInput) return;
    this.assignedInput = value;
    if (this.isConnected) this.bindInput();
  }

  private bindScope(): void {
    this.stopScope?.();
    this.stopScope = observeModuleContext(this, (context) => {
      if (context === this.scope) return;
      this.scope = context;
      // The monitor and audition follow the new scope's AudioContext and route.
      if (this.explicitContext) return;
      this.stopPlayback();
      this.live?.dispose();
      this.live = undefined;
    });
  }

  private bindInput(): void {
    this.releaseInput();
    const assigned = this.assignedInput;
    // Without an explicit object or selector there is no note source to find
    // by containment: an enclosing player's notes port is an input.
    if (assigned === undefined && !this.hasAttribute('input') && !this.hasAttribute('port')) return;
    this.stopInput = observeModuleInput(this, {family: 'note', direction: 'output', port: 'notes', assigned}, (state) => {
      this.stopInputNotes?.();
      this.stopInputNotes = undefined;
      this.releasePortNotes();
      const port = state.port as NoteOutputPort | undefined;
      if (port) this.stopInputNotes = port.subscribe((event) => this.captureNote(event));
    });
  }

  private releaseInput(): void {
    const notes = this.stopInputNotes;
    const input = this.stopInput;
    this.stopInputNotes = this.stopInput = undefined;
    try { notes?.(); } finally { input?.(); }
    this.releasePortNotes();
  }

  private releasePortNotes(): void {
    // An input that goes away mid-take must not leave a press open.
    if (this.portNotes.size === 0) return;
    this.portNotes.clear();
    this.session.discardPending();
  }

  private captureNote(event: NoteEvent): void {
    const midi = Math.round(event.pitch.midi);
    if (event.gate === 'on') {
      this.portNotes.set(event.occurrenceId, midi);
      if (this.session.capture(midi, Math.max(1, Math.round(event.velocity * 127)), true)) this.refresh();
      return;
    }
    if (!this.portNotes.has(event.occurrenceId)) return;
    this.portNotes.delete(event.occurrenceId);
    if (event.gate === 'cancel') {
      this.session.discardPending();
      return;
    }
    if (this.session.capture(midi, 0, false)) this.refresh();
  }

  /** The AudioContext and route monitoring and auditions use: explicit, else the scope's. */
  private audioRoute(): {context?: AudioContext; destination?: AudioNode} {
    if (this.explicitContext || !this.scope) return {context: this.explicitContext};
    const context = this.scope.audio.prepare() as AudioContext;
    return {context, destination: this.scope.destination?.() ?? undefined};
  }

  get bpm(): number {
    return numAttr(this, 'bpm', 120, 1);
  }
  set bpm(value: number) {
    this.setAttribute('bpm', String(value));
  }

  get quantize(): number {
    return numAttr(this, 'quantize', 0, 0);
  }
  set quantize(value: number) {
    this.setAttribute('quantize', String(value));
  }

  /** Override the live-monitor and take-playback timbre. */
  set sound(sound: HeadlessSynth | undefined) {
    this.stopPlayback();
    this.soundRef = sound;
    this.live?.dispose();
    this.live = undefined;
  }
  get sound(): HeadlessSynth | undefined {
    return this.soundRef;
  }

  /** Share an AudioContext with live monitoring and take playback. */
  set audioContext(context: AudioContext | undefined) {
    this.stopPlayback();
    this.explicitContext = context;
    this.live?.dispose();
    this.live = undefined;
  }
  get audioContext(): AudioContext | undefined {
    return this.explicitContext;
  }

  /** Extra note-event source, useful when the input lives elsewhere in the DOM. */
  set source(target: EventTarget | undefined) {
    if (target === this.sourceRef) return;
    this.detachSource();
    this.session.discardPending();
    this.seenNoteEvents = new WeakMap();
    this.sourceRef = target;
    this.attachSource();
  }
  get source(): EventTarget | undefined {
    return this.sourceRef;
  }

  get player(): InteractivePlayer {
    return this.ensureLive();
  }

  get take(): Score | undefined {
    return this.takeScore;
  }

  get recordingActive(): boolean {
    return this.session.active;
  }

  /** Feed and monitor a note directly; recording is conditional on being armed. */
  input = (midi: number, velocity: number, on: boolean): void => {
    // A supplied Sound has one route. Live input takes precedence over take
    // playback, so release the playback route before reconnecting monitoring.
    if (this.playback) this.stopPlayback();
    const live = this.ensureLive();
    if (on) live.noteOn(SCORE_RECORDER_VOICE, midi, velocity, 3600);
    else live.noteOff(SCORE_RECORDER_VOICE, midi);
    if (this.session.capture(midi, velocity, on)) this.refresh();
  };

  /** Arm a fresh take and discard the previously completed take. */
  record(): void {
    this.stopPlayback();
    this.session.start();
    this.takeScore = undefined;
    this.refresh();
  }

  /** Stop and notate the active take, returning the last take when already idle. */
  stop(): Score | undefined {
    const notes = this.session.finish();
    if (notes == null) return this.takeScore;
    this.takeScore = recordedNotesToScore(notes, {
      bpm: this.bpm,
      quantize: this.quantize,
    });
    this.refresh();
    if (this.takeScore) {
      this.dispatchEvent(new CustomEvent('webscore:recorded', {
        detail: {score: this.takeScore} satisfies ScoreRecorderRecordedDetail,
        bubbles: true,
        composed: true,
      }));
    }
    return this.takeScore;
  }

  private ensureLive(): InteractivePlayer {
    if (this.playback) this.stopPlayback();
    if (!this.live) {
      const route = this.audioRoute();
      this.live = new InteractivePlayer({audioContext: route.context, ...(route.destination ? {destination: route.destination} : {})});
      const sound = this.soundRef ??
        Sound.oscillator({type: 'triangle', gain: 0.2, releaseSeconds: 0.05});
      this.live.addVoice(
        SCORE_RECORDER_VOICE,
        sound,
        {synthOwnership: this.soundRef ? 'borrowed' : 'owned'},
      );
    }
    return this.live;
  }

  private attachSource(): void {
    if (!this.selfListening || !this.sourceRef || this.sourceRef === this || this.sourceListening) return;
    this.sourceListening = this.sourceRef;
    this.sourceListening.addEventListener('webscore:noteon', this.onNoteEvent);
    this.sourceListening.addEventListener('webscore:noteoff', this.onNoteEvent);
  }

  private detachSource(): void {
    const source = this.sourceListening;
    this.sourceListening = undefined;
    source?.removeEventListener('webscore:noteon', this.onNoteEvent);
    source?.removeEventListener('webscore:noteoff', this.onNoteEvent);
  }

  private togglePlayback(): void {
    if (!this.takeScore) return;
    if (this.playback) {
      this.stopPlayback();
      return;
    }
    // Sound is deliberately single-route. Suspend live monitoring before the
    // take player adopts the same borrowed timbre; the next input lazily
    // rebuilds monitoring after playback releases it.
    this.live?.allNotesOff();
    this.live?.dispose();
    this.live = undefined;

    const generation = ++this.playbackGeneration;
    this.playbackFailure = undefined;
    let playback: ScorePlayer;
    if (this.scope && !this.explicitContext) {
      // In a module scope the take auditions as a Session-free member of that
      // scope, so it lands on the scope's route (a Rack channel, a desk or the
      // device) without moving the scope's transport.
      const id = `${this.recorderModule.id}:take-${++this.auditionSequence}`;
      const module = new ScorePlayerModule(this.takeScore, {
        synth: this.soundRef, id,
        context: this.scope.derive({id: `${id}:context`, session: null, transport: null, target: null}),
      });
      this.auditionModule = module;
      playback = module.player;
    } else {
      playback = new ScorePlayer(this.takeScore, {
        synth: this.soundRef,
        audioContext: this.explicitContext,
      });
    }
    this.playback = playback;
    this.playbackOff = playback.on('end', () => {
      if (this.playback === playback && generation === this.playbackGeneration) {
        this.stopPlayback();
      }
    });
    this.playing = true;
    this.playbackPending = true;
    this.refresh();
    const audition = this.auditionModule;
    void (audition ? audition.prepare().then(() => playback.play()) : playback.play()).then(() => {
      if (this.playback !== playback || generation !== this.playbackGeneration) return;
      this.playbackPending = false;
      this.refresh();
    }).catch((error: unknown) => {
      if (this.playback !== playback || generation !== this.playbackGeneration) return;
      this.stopPlayback();
      this.playbackFailure = error instanceof Error ? error.message : String(error);
      this.refresh();
      this.dispatchEvent(new CustomEvent<ScoreRecorderErrorDetail>('webscore:error', {
        detail: {operation: 'play', error},
        bubbles: true,
        composed: true,
      }));
    });
  }

  private stopPlayback(): void {
    this.playbackFailure = undefined;
    this.playbackGeneration += 1;
    this.playbackOff?.();
    this.playbackOff = undefined;
    const audition = this.auditionModule;
    this.auditionModule = undefined;
    if (audition) audition.dispose();
    else this.playback?.dispose();
    this.playback = undefined;
    this.playing = false;
    this.playbackPending = false;
    this.refresh();
  }

  private render(): void {
    if (!this.root) return;
    this.ui?.destroy();
    this.ui = mountRecorder(this.root, {
      snapshot: () => ({
        recording: this.session.active,
        playing: this.playing,
        busy: this.playbackPending,
        ...(this.playbackPending ? {status: 'Preparing take playback…'}
          : this.playbackFailure ? {status: this.playbackFailure, statusKind: 'error' as const} : {}),
        recordedCount: this.session.noteCount,
        takeCount: this.takeScore
          ? this.takeScore.parts.reduce((sum, part) => sum + part.notes.length, 0)
          : undefined,
      }),
      toggleRecording: () => {
        if (this.session.active) this.stop();
        else this.record();
      },
      togglePlayback: () => this.togglePlayback(),
      export: (format) => {
        if (this.takeScore) downloadScoreRecorderTake(this.takeScore, format === 'mid' ? 'midi' : 'musicxml');
      },
    }, {
      exportFormats: [{id: 'mid', label: 'MIDI'}, {id: 'xml', label: 'MusicXML'}],
      onError: (error) => this.dispatchEvent(new CustomEvent<ScoreRecorderErrorDetail>('webscore:error', {detail: {operation: 'play', error}, bubbles: true, composed: true})),
    });
    if (!this.compatibilityStyle) {
      this.compatibilityStyle = this.root.ownerDocument.createElement('style');
      this.compatibilityStyle.dataset.webmusicCompatibility = 'score-recorder';
      this.compatibilityStyle.textContent = RECORDER_COMPATIBILITY_STYLE;
    }
    this.root.append(this.compatibilityStyle);
    this.refresh();
  }

  private refresh(): void {
    if (!this.ui) return;
    this.ui.update();
  }
}

/** Register `<score-recorder>`. Call once in the browser. */
export function defineScoreRecorderElement(tag = 'score-recorder'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, ScoreRecorderElement);
  }
}

/** A frozen module handle whose ID follows the element's DOM id (DEC-068). */
function createModuleFacade(id: () => string, ports: readonly ModulePort[]): ModuleHandle {
  return Object.freeze({
    get id() { return id(); },
    ports: () => ports,
  });
}
