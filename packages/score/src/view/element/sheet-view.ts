import type {Score} from '../../core';
import {bindPlayerToVisualizer} from '../render/binding';
import {renderOSMDStaffVisualizer} from '../render/osmd-staff';
import type {RenderedScoreVisualizer} from '../core/types';
import {HTMLElementBase, boolAttr, cssSizeAttr, defineOnce, upgradeProperty} from './base';
import {mountStage, type StageHandle} from '@webmusic/ui/stage';
import {mountStatus, type StatusHandle} from '@webmusic/ui/status';

// OSMD stores its default ink as hex while loading. Map that reserved paint to
// CSS at the SVG boundary so later ancestor/theme changes need no score reload.
const SHEET_INK = '#010203';
let nextSheetPalette = 0;

/** Note-event detail a bound player dispatches. */
interface NoteEventDetail {
  midi: number;
  startTime: number;
}

/**
 * `<sheet-view>` — real engraved sheet music, via the optional
 * OpenSheetMusicDisplay peer. `<score-view type="staff">` draws a compact
 * playback staff with beams, tuplets and source notation; this separate
 * renderer adds OSMD's page and system layout.
 *
 * Any input format works: the element lazily serializes the score to MusicXML
 * and hands that to OSMD. **MusicXML in gives the best result** — a MIDI
 * source has no staff assignment, no key signatures and a guessed clef, since
 * MIDI never carried them.
 *
 * Without the `opensheetmusicdisplay` peer installed the element renders the
 * engine's own install hint rather than failing silently.
 *
 * ```html
 * <sheet-view src="song.musicxml" player="#p" follow-cursor></sheet-view>
 * ```
 */
export class SheetViewElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return ['src', 'format', 'player', 'follow-cursor', 'width', 'height'];
  }

  /** Inject an OSMD constructor instead of loading the peer. */
  OpenSheetMusicDisplay?: new (container: string | HTMLElement, options?: unknown) => never;
  /** Reuse an already-constructed OSMD instance. */
  osmd?: unknown;

  private explicitScore?: Score;
  private rendered?: RenderedScoreVisualizer;
  private stage?: StageHandle;
  private status?: StatusHandle;
  private surface?: HTMLElement;
  private unbindPlayer?: () => void;
  private loadToken = 0;
  private loadController?: AbortController;
  private readonly ownedSizes = new Map<string, string>();
  private hostStyle?: HTMLStyleElement;

  connectedCallback(): void {
    upgradeProperty(this, 'score');
    this.applyHostLayout();
    void this.refresh();
  }

  disconnectedCallback(): void {
    this.cancelLoad();
    this.unbindPlayer?.();
    this.unbindPlayer = undefined;
    this.rendered?.dispose?.();
    this.rendered = undefined;
    this.stage?.destroy();
    this.stage = undefined;
    this.status?.destroy();
    this.status = undefined;
    this.surface = undefined;
  }

  attributeChangedCallback(name?: string): void {
    if (!this.isConnected) return;
    if (name === 'player') this.bindPlayer();
    else if (name === 'width' || name === 'height') this.applyHostLayout();
    else if (name === 'follow-cursor') this.applyFollowCursor();
    else void this.refresh();
  }

  /** Assign a pre-loaded score programmatically (overrides `src`). */
  set score(score: Score | undefined) {
    this.explicitScore = score;
    if (this.isConnected) void this.refresh();
  }

  get score(): Score | undefined {
    return this.explicitScore;
  }

  private cancelLoad(): void {
    this.loadToken += 1;
    const controller = this.loadController;
    this.loadController = undefined;
    controller?.abort();
  }

  private async refresh(): Promise<void> {
    this.cancelLoad();
    const token = this.loadToken;
    const controller = new AbortController();
    this.loadController = controller;

    const score = await this.resolveScore(controller.signal);
    if (token !== this.loadToken || !this.isConnected) return;

    this.unbindPlayer?.();
    this.unbindPlayer = undefined;
    this.rendered?.dispose?.();
    this.rendered = undefined;
    this.stage?.destroy();
    this.stage = undefined;
    this.status?.destroy();
    this.status = undefined;
    this.surface = undefined;
    this.replaceChildren();
    this.applyHostLayout();
    if (!score) return;

    const document = (this as {ownerDocument?: Document}).ownerDocument;
    if (!document) return;
    this.stage = mountStage(this, {render: () => undefined}, {
      label: 'Sheet music',
      fill: true,
      overflow: 'auto',
      surfaceMinWidth: 'var(--wm-sheet-min-width, 32rem)',
      background: 'var(--wm-sheet-background, var(--wm-surface, #fff))',
    });
    const surface = this.stage.surface;
    this.surface = surface;
    if (!this.osmd) {
      const palette = String(++nextSheetPalette);
      surface.dataset.webscoreSheetPalette = palette;
      const style = document.createElement('style');
      style.textContent = ['fill', 'stroke'].map((property) =>
        `:where([data-webscore-sheet-palette="${palette}"]) svg [${property}="${SHEET_INK}"] { ${property}: var(--wm-sheet-foreground, var(--wm-foreground, #000)); }`,
      ).join('\n');
      // Keep the mapping outside OSMD's mutable drawing surface. It survives
      // backend replacement during resize, and replaceChildren releases it.
      this.append(style);
    }

    try {
      // OSMD's render is async while the score may be swapped underneath it;
      // the token check after the await is what keeps a superseded render
      // from painting over a newer one.
      const io = await import('../../io/formats/musicxml/serializer');
      if (token !== this.loadToken || !this.isConnected) return;
      const rendered = await renderOSMDStaffVisualizer(score, surface, {
        toMusicXML: (value) => io.serializeMusicXML(value),
        followCursor: boolAttr(this, 'follow-cursor', true),
        signal: controller.signal,
        // Paper belongs to the stage; the engraving itself remains transparent.
        // An adopted OSMD instance retains its caller's rendering options.
        ...(!this.osmd ? {osmdOptions: {defaultColorMusic: SHEET_INK, pageBackgroundColor: 'transparent'}} : {}),
        ...(this.OpenSheetMusicDisplay
          ? {OpenSheetMusicDisplay: this.OpenSheetMusicDisplay as never}
          : {}),
        ...(this.osmd ? {osmd: this.osmd as never} : {}),
      });
      if (token !== this.loadToken || !this.isConnected) {
        rendered.dispose?.();
        return;
      }
      this.rendered = rendered;
      this.applyFollowCursor();
      this.bindPlayer();
    } catch (error) {
      if (controller.signal.aborted || token !== this.loadToken) return;
      this.renderError(error);
    }
  }

  /** Show the engine's own message — it names the missing peer precisely. */
  private renderError(error: unknown): void {
    if (!(this as {ownerDocument?: Document}).ownerDocument) return;
    this.stage?.destroy();
    this.stage = undefined;
    this.status?.destroy();
    this.status = undefined;
    this.surface = undefined;
    this.replaceChildren();
    this.applyHostLayout();
    const message = error instanceof Error ? error.message : String(error);
    this.status = mountStatus(this, {snapshot: () => ({kind: 'error', message})});
  }

  private applyHostLayout(): void {
    const owner = (this as {ownerDocument?: Document}).ownerDocument;
    if (!owner) return;
    if (this.hostStyle?.parentNode !== this) {
      const selector = this.localName.replace(/[^a-z0-9-]/gi, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
      this.hostStyle = owner.createElement('style');
      this.hostStyle.textContent = `:where(${selector}) { box-sizing: border-box; width: 100%; min-width: 0; max-width: 100%; }
:where(${selector}:not([hidden])) { display: block; }`;
      this.append(this.hostStyle);
    }
    for (const property of ['width', 'height']) {
      const value = cssSizeAttr(this, property);
      if (value) {
        this.style.setProperty(property, value);
        this.ownedSizes.set(property, value);
      } else if (this.ownedSizes.has(property)) {
        if (this.style.getPropertyValue(property) === this.ownedSizes.get(property)) {
          this.style.removeProperty(property);
        }
        this.ownedSizes.delete(property);
      }
    }
  }

  private applyFollowCursor(): void {
    // OSMD may scroll inside cursor.next()/update() before the adapter's own
    // scroll request. Keep its public switch aligned without reloading it.
    const osmd = this.rendered?.visualizer as {FollowCursor?: boolean} | undefined;
    const following = boolAttr(this, 'follow-cursor', true);
    if (osmd && 'FollowCursor' in osmd) {
      osmd.FollowCursor = following;
    }
    if (!following) this.rendered?.redraw(undefined, false);
  }

  private bindPlayer(): void {
    this.unbindPlayer?.();
    this.unbindPlayer = undefined;
    const selector = this.getAttribute('player');
    const rendered = this.rendered;
    if (!selector || !rendered) return;
    const target = (this.getRootNode() as ParentNode).querySelector(selector);
    if (!target) return;

    // The published adapter resolves each event to a sequence note and moves
    // the OSMD cursor; it also owns the sounding set, so a note released
    // mid-chord no longer blanks its siblings.
    const following: RenderedScoreVisualizer = {
      ...rendered,
      redraw: (note, scroll) => rendered.redraw(note, scroll === true && boolAttr(this, 'follow-cursor', true)),
    };
    this.unbindPlayer = bindPlayerToVisualizer(following, ({noteOn, noteOff, end}) => {
      const onNoteOn = (event: Event): void => {
        const detail = (event as CustomEvent<NoteEventDetail>).detail;
        if (detail) noteOn(detail.midi, detail.startTime);
      };
      const onNoteOff = (event: Event): void => {
        const detail = (event as CustomEvent<NoteEventDetail>).detail;
        if (detail) noteOff(detail.midi, detail.startTime);
      };
      target.addEventListener('webscore:noteon', onNoteOn);
      target.addEventListener('webscore:noteoff', onNoteOff);
      target.addEventListener('webscore:end', end);
      return () => {
        target.removeEventListener('webscore:noteon', onNoteOn);
        target.removeEventListener('webscore:noteoff', onNoteOff);
        target.removeEventListener('webscore:end', end);
      };
    });
  }

  private async resolveScore(signal: AbortSignal): Promise<Score | undefined> {
    if (this.explicitScore) return this.explicitScore;
    const src = this.getAttribute('src');
    if (!src) return undefined;
    const format = this.getAttribute('format') ?? undefined;
    try {
      const io = await import('../../io/load');
      return await io.loadScoreFromUrl(src, {
        ...(format ? {format: format as never} : {}),
        signal,
      });
    } catch (error) {
      if (signal.aborted) return undefined;
      console.error('[WebScore] <sheet-view> failed to load', src, error);
      return undefined;
    }
  }
}

/** Register `<sheet-view>` (or a custom tag). Idempotent, SSR-safe. */
export function defineSheetViewElement(tag = 'sheet-view'): void {
  defineOnce(tag, SheetViewElement);
}
