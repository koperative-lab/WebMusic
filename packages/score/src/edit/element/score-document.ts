import {WebMusicElement, boolAttr, defineOnce, upgradeProperties} from '@webmusic/kernel/element';
import {Score} from '../../core';
import {loadScoreFromUrl, type ScoreFormat} from '../../io/load';
import {createScoreEditor, type ScoreEditor, type ScoreEditorOptions} from '../headless';

export type ScoreDocumentStatus = 'empty' | 'loading' | 'ready' | 'error' | 'disposed';

export type ScoreDocumentLoadResult =
  | {readonly status: 'ready'; readonly editor: ScoreEditor}
  | {readonly status: 'empty' | 'superseded'}
  | {readonly status: 'failed'; readonly error: unknown};

export interface ScoreDocumentStateDetail {
  readonly status: ScoreDocumentStatus;
  readonly editor: ScoreEditor | undefined;
  /** URL of the successfully loaded document, never a failed replacement URL. */
  readonly loadedSrc: string | undefined;
  readonly error: unknown;
}

/** Nonvisual declaration owning one editor for its connected lifetime. */
export class ScoreDocumentElement extends WebMusicElement {
  static get observedAttributes(): string[] { return ['src', 'format', 'history', 'history-limit']; }

  private explicitScore?: Score;
  private currentEditor?: ScoreEditor;
  private currentStatus: ScoreDocumentStatus = 'empty';
  private currentError: unknown;
  private currentLoadedSrc?: string;
  private generation = 0;
  private abort?: AbortController;
  private mounting = false;

  get src(): string { return this.getAttribute('src') ?? ''; }
  set src(value: string) { this.setAttribute('src', value); }

  /** Explicit input wins over src; clearing it restores URL loading. */
  get score(): Score | undefined { return this.explicitScore; }
  set score(value: Score | undefined) {
    if (value !== undefined && !(value instanceof Score)) throw new TypeError('score must be a Score or undefined');
    if (value === this.explicitScore) return;
    // Validate the candidate before changing configuration or the valid source.
    const candidate = value && this.isConnected && !this.mounting ? createScoreEditor(value, this.options()) : undefined;
    this.explicitScore = value;
    if (!this.isConnected || this.mounting) return;
    if (candidate) {
      const generation = this.cancelLoad();
      if (generation !== this.generation || !this.isConnected || this.explicitScore !== value) {
        candidate.dispose(); return;
      }
      this.adopt(candidate);
    } else void this.reload();
  }

  get editor(): ScoreEditor | undefined { return this.currentEditor; }
  get status(): ScoreDocumentStatus { return this.currentStatus; }
  get error(): unknown { return this.currentError; }
  get loadedSrc(): string | undefined { return this.currentLoadedSrc; }

  protected override onMount(): void {
    this.style.setProperty('display', 'none');
    this.mounting = true;
    try { upgradeProperties(this, ['score', 'src']); }
    finally { this.mounting = false; }
    void this.reload();
  }

  protected override onUnmount(): void {
    const controller = this.abort;
    this.abort = undefined;
    this.generation += 1;
    // Detach the old owner before source/abort callbacks can reconnect. Only
    // abort this lifetime's captured load, never a newer connection's request.
    try { this.clear('disposed'); }
    finally { controller?.abort(); }
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (this.explicitScore && (name === 'src' || name === 'format')) return;
    // The limit is ignored while history is disabled, so it must not discard edits by recreating the editor.
    if (name === 'history-limit' && !boolAttr(this, 'history', true)) return;
    if (name === 'history' && historyEnabled(oldValue) === historyEnabled(newValue)) return;
    if (oldValue !== newValue && this.isConnected && !this.mounting) void this.reload();
  }

  /** Retry the configured input. Stale async loads settle without publication. */
  async reload(): Promise<ScoreDocumentLoadResult> {
    const generation = this.cancelLoad();
    const current = () => generation === this.generation && this.isConnected;
    if (!current()) return {status: 'superseded'};
    try {
      const options = this.options();
      const direct = this.explicitScore;
      const src = this.src.trim();
      if (!direct && !src) {
        this.clear('empty');
        return current() ? {status: 'empty'} : {status: 'superseded'};
      }
      let score: Score;
      if (direct) score = direct;
      else {
        const format = this.getAttribute('format')?.trim() || undefined;
        if (format && !['midi', 'musicxml', 'mxl', 'abc'].includes(format)) throw new TypeError(`Unsupported Score format: ${format}`);
        const controller = new AbortController();
        this.abort = controller;
        this.publishState('loading');
        if (!current()) return {status: 'superseded'};
        score = await loadScoreFromUrl(src, {signal: controller.signal, format: format as ScoreFormat | undefined});
        if (!current()) return {status: 'superseded'};
      }
      const editor = createScoreEditor(score, options);
      if (!current()) { editor.dispose(); return {status: 'superseded'}; }
      this.abort = undefined;
      this.adopt(editor, direct ? undefined : src);
      return current() && this.currentEditor === editor ? {status: 'ready', editor} : {status: 'superseded'};
    } catch (error) {
      if (!current()) return {status: 'superseded'};
      this.abort = undefined;
      this.publishState('error', error);
      if (!current()) return {status: 'superseded'};
      this.dispatchEvent(new CustomEvent('webscore:error', {bubbles: true, detail: {operation: 'document-load', error}}));
      return current() ? {status: 'failed', error} : {status: 'superseded'};
    }
  }

  private options(): ScoreEditorOptions {
    if (!boolAttr(this, 'history', true)) return {history: false};
    const raw = this.getAttribute('history-limit');
    const limit = raw === null ? 100 : Number(raw);
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError('history-limit must be a positive safe integer');
    return {history: {limit}};
  }

  private cancelLoad(): number {
    const generation = ++this.generation;
    const controller = this.abort;
    this.abort = undefined;
    controller?.abort();
    // Return this attempt's token, even when an abort listener starts a newer one.
    return generation;
  }

  private adopt(editor: ScoreEditor, loadedSrc?: string): void {
    const previous = this.currentEditor;
    const generation = this.generation;
    this.currentEditor = editor;
    this.currentLoadedSrc = loadedSrc;
    this.currentStatus = 'ready';
    this.currentError = undefined;
    this.setAttribute('data-state', 'ready');
    try {
      // Borrowers see the new getter before the superseded editor is disposed.
      this.dispatchEvent(new CustomEvent('webmusic:sourcechange', {bubbles: true}));
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
      this.dispatchEvent(new CustomEvent('webmusic:sourcechange', {bubbles: true}));
      if (generation === this.generation && !this.currentEditor) this.publishState(status);
    } finally { previous?.dispose(); }
  }

  private publishState(status: ScoreDocumentStatus, error?: unknown): void {
    this.currentStatus = status;
    this.currentError = error;
    this.setAttribute('data-state', status);
    this.dispatchEvent(new CustomEvent<ScoreDocumentStateDetail>('webscore:documentstatechange', {
      bubbles: true,
      detail: {status, editor: this.currentEditor, loadedSrc: this.currentLoadedSrc, error},
    }));
  }
}

export function defineScoreDocumentElement(tag = 'score-document'): void { defineOnce(tag, ScoreDocumentElement); }

function historyEnabled(value: string | null): boolean { return value === null || !/^(false|0|no|off)$/i.test(value.trim()); }
