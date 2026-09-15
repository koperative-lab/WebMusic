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
  ['background', 'bg', 'var(--wm-surface,#fff)'],
  ['border', 'border', 'var(--wm-border,#d8d8d8)'],
  ['text', 'text', 'var(--wm-foreground,#444)'],
  ['accent', 'rec', 'var(--wm-accent,#c0392b)'],
  ['accent-text', 'rec-color', 'var(--wm-accent-foreground,#fff)'],
  ['button', 'btn', 'var(--wm-surface,#fff)'],
  ['button-border', 'btn-border', 'var(--wm-control-border,var(--wm-border,#d8d8d8))'],
  ['muted', 'label', 'var(--wm-foreground-muted,var(--wm-foreground,#666))'],
  ['radius', 'radius', 'var(--wm-control-radius,0)'],
];
// Preserve inherited public tokens before mapping the legacy --rec-* names.
const RECORDER_COMPATIBILITY_STYLE = `
:host{min-width:0;max-width:100%;box-sizing:border-box;${RECORDER_THEME.map(([name, , fallback]) => `--wui-recorder-host-${name}:var(--wm-recorder-${name},${fallback});`).join('')}}
:host(:not([hidden])){display:block}
:host([hidden]){display:none}
[part~="root"]{background:var(--wm-score-recorder-surface-background,var(--wm-recorder-surface-background,var(--wm-component-background,var(--wm-recorder-background,var(--wm-surface,#fff)))));border:var(--wm-score-recorder-surface-border,var(--wm-recorder-surface-border,var(--wm-component-border,1px solid var(--wm-recorder-border,var(--wm-border,#d8d8d8)))));${RECORDER_THEME.map(([name, legacy]) => `--wm-recorder-${name}:var(--rec-${legacy},var(--wui-recorder-host-${name}));`).join('')}}
`;

/**
 * `<score-recorder>` attributes: `bpm` (default 120) and `quantize` (grid in
 * quarters; 0 preserves performed timing). Both values are NaN-safe.
 */
export class ScoreRecorderElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return ['bpm', 'quantize'];
  }

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
    upgradeProperties(this, ['sound', 'source', 'audioContext', 'bpm', 'quantize']);
    if (!this.root) this.root = this.attachShadow({mode: 'open'});
    this.render();
    if (!this.selfListening) {
      this.addEventListener('webscore:noteon', this.onNoteEvent);
      this.addEventListener('webscore:noteoff', this.onNoteEvent);
      this.selfListening = true;
    }
    this.attachSource();
  }

  disconnectedCallback(): void {
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

  attributeChangedCallback(): void {
    // bpm / quantize are read lazily when the current take stops.
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
      this.live = new InteractivePlayer({audioContext: this.explicitContext});
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
    const playback = new ScorePlayer(this.takeScore, {
      synth: this.soundRef,
      audioContext: this.explicitContext,
    });
    this.playback = playback;
    this.playbackOff = playback.on('end', () => {
      if (this.playback === playback && generation === this.playbackGeneration) {
        this.stopPlayback();
      }
    });
    this.playing = true;
    this.refresh();
    void playback.play().catch((error: unknown) => {
      if (this.playback !== playback || generation !== this.playbackGeneration) return;
      this.stopPlayback();
      this.dispatchEvent(new CustomEvent<ScoreRecorderErrorDetail>('webscore:error', {
        detail: {operation: 'play', error},
        bubbles: true,
        composed: true,
      }));
    });
  }

  private stopPlayback(): void {
    this.playbackGeneration += 1;
    this.playbackOff?.();
    this.playbackOff = undefined;
    this.playback?.dispose();
    this.playback = undefined;
    this.playing = false;
    this.refresh();
  }

  private render(): void {
    if (!this.root) return;
    this.ui?.destroy();
    this.ui = mountRecorder(this.root, {
      snapshot: () => ({
        recording: this.session.active,
        playing: this.playing,
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
