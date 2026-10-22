import {WebMusicElement, boolAttr, defineOnce, upgradeProperties} from '@webmusic/kernel/element';
import type {AudioClip, AudioFormat, AudioRangeProcessor} from '../../core';
import {loadAudioDocument, type AudioDocumentLoader, type AudioDocumentLoadOptions} from './internal/audio-document-loader';
import {createAudioClipEditor, type AudioClipEditor, type AudioClipEditorOptions} from '../headless';

export type AudioDocumentStatus = 'empty' | 'loading' | 'ready' | 'error' | 'disposed';

export type AudioDocumentLoadResult =
  | {readonly status: 'ready'; readonly editor: AudioClipEditor}
  | {readonly status: 'empty' | 'superseded'}
  | {readonly status: 'failed'; readonly error: unknown};

export interface AudioDocumentStateDetail {
  readonly status: AudioDocumentStatus;
  readonly editor: AudioClipEditor | undefined;
  /** URL of the successfully loaded document, never a failed replacement URL. */
  readonly loadedSrc: string | undefined;
  readonly error: unknown;
}

/** Nonvisual declaration owning one editor for its connected lifetime. */
export class AudioDocumentElement extends WebMusicElement {
  static get observedAttributes(): string[] { return ['src', 'format', 'history', 'history-limit']; }

  private explicitClip?: AudioClip;
  private explicitLoader?: AudioDocumentLoader;
  private currentLoadOptions: AudioDocumentLoadOptions = {};
  private currentProcessors: readonly AudioRangeProcessor[] = [];
  private currentEditor?: AudioClipEditor;
  private currentStatus: AudioDocumentStatus = 'empty';
  private currentError: unknown;
  private currentLoadedSrc?: string;
  private generation = 0;
  private abort?: AbortController;
  private mounting = false;
  /** An upgrade reports existing attributes before onMount; only a mounted lifetime reloads. */
  private mounted = false;

  get src(): string { return this.getAttribute('src') ?? ''; }
  set src(value: string) { this.setAttribute('src', value); }

  /** Explicit input wins over src; clearing it restores URL loading. */
  get clip(): AudioClip | undefined { return this.explicitClip; }
  set clip(value: AudioClip | undefined) {
    if (value !== undefined && (!value || typeof value.hasSamples !== 'boolean' || typeof value.sampleRate !== 'number' || typeof value.channelData !== 'function')) throw new TypeError('clip must be an AudioClip or undefined');
    if (value === this.explicitClip) return;
    // Validate the candidate before changing configuration or the valid source.
    const candidate = value && this.mounted && !this.mounting ? createAudioClipEditor(value, this.options()) : undefined;
    this.explicitClip = value;
    if (!this.mounted || this.mounting) return;
    if (candidate) {
      const generation = this.cancelLoad();
      if (generation !== this.generation || !this.isConnected || this.explicitClip !== value) {
        candidate.dispose(); return;
      }
      this.adopt(candidate);
    } else void this.reload();
  }

  /** A caller-owned decoder closure; no context is created by the declaration. */
  get loader(): AudioDocumentLoader | undefined { return this.explicitLoader; }
  set loader(value: AudioDocumentLoader | undefined) {
    if (value !== undefined && typeof value !== 'function') throw new TypeError('loader must be a function or undefined');
    if (value === this.explicitLoader) return;
    this.explicitLoader = value;
    if (this.mounted && !this.mounting && !this.explicitClip) void this.reload();
  }

  get loadOptions(): AudioDocumentLoadOptions { return {...this.currentLoadOptions}; }
  set loadOptions(value: AudioDocumentLoadOptions) {
    this.currentLoadOptions = {...value};
    if (this.mounted && !this.mounting && !this.explicitClip) void this.reload();
  }

  get editor(): AudioClipEditor | undefined { return this.currentEditor; }
  /** Injected recipes are borrowed; a pending URL load adopts them, otherwise replacing them reloads. */
  get processors(): readonly AudioRangeProcessor[] { return this.currentProcessors; }
  set processors(value: readonly AudioRangeProcessor[]) {
    if (!Array.isArray(value)) throw new TypeError('processors must be an array');
    this.currentProcessors = Object.freeze([...value]);
    if (this.mounted && !this.mounting && !this.abort) void this.reload();
  }
  get status(): AudioDocumentStatus { return this.currentStatus; }
  get error(): unknown { return this.currentError; }
  get loadedSrc(): string | undefined { return this.currentLoadedSrc; }

  protected override onMount(): void {
    this.style.setProperty('display', 'none');
    this.mounted = true;
    this.mounting = true;
    try { upgradeProperties(this, ['clip', 'src', 'loader', 'loadOptions', 'processors']); }
    finally { this.mounting = false; }
    void this.reload();
  }

  protected override onUnmount(): void {
    this.mounted = false;
    const controller = this.abort;
    this.abort = undefined;
    this.generation += 1;
    // Detach the old owner before source/abort callbacks can reconnect. Only
    // abort this lifetime's captured load, never a newer connection's request.
    try { this.clear('disposed'); }
    finally { controller?.abort(); }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (this.explicitClip && (name === 'src' || name === 'format')) return;
    // The limit is ignored while history is disabled, so it must not discard edits by recreating the editor.
    if (name === 'history-limit' && !boolAttr(this, 'history', true)) return;
    if (name === 'history' && historyEnabled(oldValue) === historyEnabled(newValue)) return;
    if (oldValue !== newValue && this.mounted && !this.mounting) void this.reload();
  }

  /** Retry the configured input. Stale async loads settle without publication. */
  async reload(): Promise<AudioDocumentLoadResult> {
    const generation = this.cancelLoad();
    const current = () => generation === this.generation && this.isConnected;
    if (!current()) return {status: 'superseded'};
    try {
      const options = this.options();
      const direct = this.explicitClip;
      const src = this.src.trim();
      if (!direct && !src) {
        this.clear('empty');
        return current() ? {status: 'empty'} : {status: 'superseded'};
      }
      let clip: AudioClip;
      if (direct) clip = direct;
      else {
        const format = this.getAttribute('format')?.trim() || undefined;
        if (format && !['wav', 'aiff', 'mp3', 'flac', 'ogg', 'opus', 'm4a', 'aac', 'webm'].includes(format)) throw new TypeError(`Unsupported Audio format: ${format}`);
        const controller = new AbortController();
        this.abort = controller;
        this.publishState('loading');
        if (!current()) return {status: 'superseded'};
        clip = await (this.explicitLoader ?? loadAudioDocument)(src, {...this.currentLoadOptions, signal: controller.signal, format: format as AudioFormat | undefined});
        if (!current()) return {status: 'superseded'};
      }
      // Processors replaced while the URL was loading apply to this editor without restarting the load.
      const editor = createAudioClipEditor(clip, {...options, processors: this.currentProcessors});
      if (!current()) { editor.dispose(); return {status: 'superseded'}; }
      this.abort = undefined;
      this.adopt(editor, direct ? undefined : src);
      return current() && this.currentEditor === editor ? {status: 'ready', editor} : {status: 'superseded'};
    } catch (error) {
      if (!current()) return {status: 'superseded'};
      this.abort = undefined;
      this.publishState('error', error);
      if (!current()) return {status: 'superseded'};
      this.dispatchEvent(new CustomEvent('webaudio:error', {bubbles: true, composed: true, detail: {operation: 'document-load', error}}));
      return current() ? {status: 'failed', error} : {status: 'superseded'};
    }
  }

  private options(): AudioClipEditorOptions {
    if (!boolAttr(this, 'history', true)) return {history: false, processors: this.currentProcessors};
    const raw = this.getAttribute('history-limit');
    const limit = raw === null ? 100 : Number(raw);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('history-limit must be a positive safe integer');
    return {history: {limit}, processors: this.currentProcessors};
  }

  private cancelLoad(): number {
    const generation = ++this.generation;
    const controller = this.abort;
    this.abort = undefined;
    controller?.abort();
    // Return this attempt's token, even when an abort listener starts a newer one.
    return generation;
  }

  private adopt(editor: AudioClipEditor, loadedSrc?: string): void {
    const previous = this.currentEditor;
    const generation = this.generation;
    this.currentEditor = editor;
    this.currentLoadedSrc = loadedSrc;
    this.currentStatus = 'ready';
    this.currentError = undefined;
    this.setAttribute('data-state', 'ready');
    try {
      // Borrowers see the new getter before the superseded editor is disposed.
      this.dispatchEvent(new CustomEvent('webmusic:sourcechange', {bubbles: true, composed: true}));
      if (generation === this.generation && this.currentEditor === editor) this.publishState('ready');
    } finally { previous?.dispose(); }
  }

  private clear(status: 'empty' | 'disposed'): void {
    const previous = this.currentEditor;
    const generation = this.generation;
    this.currentEditor = undefined;
    this.currentLoadedSrc = undefined;
    this.currentStatus = status;
    this.currentError = undefined;
    this.setAttribute('data-state', status);
    try {
      this.dispatchEvent(new CustomEvent('webmusic:sourcechange', {bubbles: true, composed: true}));
      if (generation === this.generation && !this.currentEditor) this.publishState(status);
    } finally { previous?.dispose(); }
  }

  private publishState(status: AudioDocumentStatus, error?: unknown): void {
    this.currentStatus = status;
    this.currentError = error;
    this.setAttribute('data-state', status);
    this.dispatchEvent(new CustomEvent<AudioDocumentStateDetail>('webaudio:documentstatechange', {
      bubbles: true, composed: true,
      detail: {status, editor: this.currentEditor, loadedSrc: this.currentLoadedSrc, error},
    }));
  }
}

export function defineAudioDocumentElement(tag = 'audio-document'): void { defineOnce(tag, AudioDocumentElement); }

function historyEnabled(value: string | null): boolean { return value === null || !/^(false|0|no|off)$/i.test(value.trim()); }
