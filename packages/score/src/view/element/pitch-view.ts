import {
  mountKeyboard,
  mountStaff,
  mountFretboard,
  type KeyboardHandle,
  type StaffHandle,
  type FretboardHandle,
} from '@webmusic/ui/pitch';
import {
  currentStaffMarks,
  currentFretMarks,
  parseViewTuning,
  readoutPitch,
  type PitchReadoutSpelling,
} from '../core/pitch-readout';
import {createPitchView} from '../headless/pitch-view';
import {bindViewPlayer} from './internal/player-binding';
import {HTMLElementBase, defineOnce, numAttr, boolAttr, upgradeProperty} from './base';

export type PitchViewType = 'keyboard' | 'staff' | 'fretboard';

const KEYBOARD_GEOMETRY_ATTRIBUTES = ['white-key-width', 'black-key-width', 'white-key-height', 'black-key-height'] as const;
const FRETBOARD_GEOMETRY_ATTRIBUTES = ['fret-width', 'string-spacing', 'string-width'] as const;

/**
 * A passive view of currently sounding pitches. Changing type replaces only
 * the presenter; one tracker and one borrowed player binding keep note identity.
 */
export class PitchViewElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return ['type', 'player', 'source', 'low', 'high', 'system', 'spelling', 'density', 'scheme', 'tuning', 'first-fret', 'frets', 'follow', 'fit-to-width', ...KEYBOARD_GEOMETRY_ATTRIBUTES, ...FRETBOARD_GEOMETRY_ATTRIBUTES];
  }

  #notes = createPitchView();
  #handle?: KeyboardHandle | StaffHandle | FretboardHandle;
  #unbind?: () => void;
  #hostStyle?: HTMLStyleElement;

  /** Currently held MIDI notes, ascending, including notes outside the view. */
  get active(): number[] { return [...this.#notes.state.activeMidis]; }

  get type(): PitchViewType {
    const value = this.getAttribute('type');
    return value === 'staff' || value === 'fretboard' ? value : 'keyboard';
  }

  set type(type: PitchViewType) { this.setAttribute('type', type); }

  /** Requested keyboard endpoints. UIKit normalizes the supported MIDI range. */
  get low(): number { return Math.round(numAttr(this, 'low', 36)); }
  get high(): number { return Math.round(numAttr(this, 'high', 84)); }
  /** Requested exact geometry in CSS px; undefined uses the presenter's default. */
  get whiteKeyWidth(): number | undefined { return this.#pixels('white-key-width'); }
  get blackKeyWidth(): number | undefined { return this.#pixels('black-key-width'); }
  get whiteKeyHeight(): number | undefined { return this.#pixels('white-key-height'); }
  get blackKeyHeight(): number | undefined { return this.#pixels('black-key-height'); }
  get fretWidth(): number | undefined { return this.#pixels('fret-width'); }
  get stringSpacing(): number | undefined { return this.#pixels('string-spacing'); }
  get stringWidth(): number | undefined { return this.#pixels('string-width'); }
  /** Newly sounding notes reveal themselves unless a composed surface owns scrolling. */
  get follow(): 'active' | 'none' { return this.getAttribute('follow') === 'none' ? 'none' : 'active'; }
  /** Fit every keyboard key to the host width, overriding fixed/minimum key widths. */
  get fitToWidth(): boolean { return boolAttr(this, 'fit-to-width'); }

  #pixels(name: string): number | undefined {
    const value = numAttr(this, name, Number.NaN);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  get system(): 'grand' | 'treble' | 'bass' {
    const value = this.getAttribute('system');
    return value === 'treble' || value === 'bass' ? value : 'grand';
  }

  /** MIDI spelling without an inferred harmonic key or key signature. */
  get spelling(): PitchReadoutSpelling {
    return this.getAttribute('spelling') === 'flat' ? 'flat' : 'sharp';
  }

  get density(): 'comfortable' | 'compact' {
    return this.getAttribute('density') === 'compact' ? 'compact' : 'comfortable';
  }

  get scheme(): 'inherit' | 'system' | 'light' | 'dark' {
    const value = this.getAttribute('scheme');
    return value === 'system' || value === 'light' || value === 'dark' ? value : 'inherit';
  }

  /** Open strings in physical order. Invalid values fall back to standard guitar. */
  get tuning(): readonly number[] { return [...parseViewTuning(this.getAttribute('tuning'))]; }

  /** Lowest fret in view. Defaults to 0, clamped to 0–24. */
  get firstFret(): number { return Math.max(0, Math.min(24, Math.round(numAttr(this, 'first-fret', 0)))); }

  /** Number of fret spaces visible. Defaults to 12, clamped to 1–24. */
  get frets(): number { return Math.max(1, Math.min(24, Math.round(numAttr(this, 'frets', 12)))); }

  connectedCallback(): void {
    upgradeProperty(this, 'type');
    this.#mountHostStyle();
    this.#render();
    this.#bindPlayer();
  }

  disconnectedCallback(): void {
    const unbind = this.#unbind;
    this.#unbind = undefined;
    try { unbind?.(); } finally {
      try { this.#handle?.destroy(); } finally {
        this.#handle = undefined;
        this.#notes.dispose();
        this.#notes = createPitchView();
        this.#hostStyle?.remove();
        this.#hostStyle = undefined;
      }
    }
  }

  attributeChangedCallback(name?: string): void {
    if (!this.isConnected || !this.#hostStyle) return;
    if (name === 'player' || name === 'source') this.#bindPlayer();
    else if (name === 'type' || name === 'density' || name === 'scheme'
      || (this.type === 'keyboard' && (name === 'follow' || name === 'fit-to-width' || KEYBOARD_GEOMETRY_ATTRIBUTES.includes(name as typeof KEYBOARD_GEOMETRY_ATTRIBUTES[number])))
      || (this.type === 'fretboard' && FRETBOARD_GEOMETRY_ATTRIBUTES.includes(name as typeof FRETBOARD_GEOMETRY_ATTRIBUTES[number]))) this.#render();
    else if (name === 'spelling'
      || (this.type === 'keyboard' && (name === 'low' || name === 'high'))
      || (this.type === 'staff' && name === 'system')
      || (this.type === 'fretboard' && (name === 'tuning' || name === 'first-fret' || name === 'frets'))) {
      this.#handle?.update();
    }
  }

  #mountHostStyle(): void {
    if (this.#hostStyle || !(this as {ownerDocument?: Document}).ownerDocument) return;
    const selector = this.localName.replace(/[^a-z0-9-]/gi, (char) => `\\${char.codePointAt(0)!.toString(16)} `);
    const style = this.ownerDocument.createElement('style');
    // Layout belongs to the host; the shared presenters own all visual styles.
    // No inline sizing or display means application CSS and [hidden] still win.
    style.textContent = `:where(${selector}) { box-sizing: border-box; inline-size: 100%; min-inline-size: 0; }
:where(${selector}:not([hidden])) { display: block; }`;
    this.append(style);
    this.#hostStyle = style;
  }

  #render(): void {
    const scrollLeft = this.#handle?.element.scrollLeft;
    this.#handle?.destroy();
    this.#handle = undefined;
    if (!(this as {ownerDocument?: Document}).ownerDocument) return;
    const options = {density: this.density, scheme: this.scheme};
    if (this.type === 'keyboard') {
      this.#handle = mountKeyboard(this, {
        snapshot: () => ({
          low: this.low,
          high: this.high,
          marks: this.active.map((midi) => ({midi, label: readoutPitch(midi, this.spelling).toString(), active: true})),
        }),
        subscribe: (notify) => this.#notes.subscribe(notify),
      }, {...options, release: 0, trail: false, follow: this.follow, fitToWidth: this.fitToWidth,
        whiteKeyWidth: this.whiteKeyWidth, blackKeyWidth: this.blackKeyWidth,
        whiteKeyHeight: this.whiteKeyHeight, blackKeyHeight: this.blackKeyHeight});
    } else if (this.type === 'staff') {
      this.#handle = mountStaff(this, {
        snapshot: () => ({
          system: this.system,
          clefs: this.system === 'bass' ? {lower: '\u{1D122}'}
            : this.system === 'treble' ? {upper: '\u{1D11E}'}
              : {upper: '\u{1D11E}', lower: '\u{1D122}'},
          marks: currentStaffMarks(this.active, this.spelling),
          emptyLabel: 'No sounding notes',
        }),
        subscribe: (notify) => this.#notes.subscribe(notify),
      }, options);
    } else {
      this.#handle = mountFretboard(this, {
        snapshot: () => {
          const tuning = this.tuning;
          const active = this.active;
          return {
            strings: tuning.length,
            stringLabels: tuning.map((midi) => readoutPitch(midi, this.spelling).toString()),
            firstFret: this.firstFret,
            fretCount: this.frets,
            marks: currentFretMarks(active, tuning, this.firstFret, this.frets, this.spelling),
            inlays: [3, 5, 7, 9, 12, 15, 17, 19, 21, 24],
            emptyLabel: active.length ? 'No sounding pitches in this fret range' : 'No sounding notes',
          };
        },
        subscribe: (notify) => this.#notes.subscribe(notify),
      }, {...options, release: 0, fretWidth: this.fretWidth, stringSpacing: this.stringSpacing, stringWidth: this.stringWidth});
    }
    if (this.#handle && scrollLeft !== undefined) {
      this.#handle.element.scrollLeft = this.type === 'keyboard' && this.fitToWidth ? 0 : scrollLeft;
    }
  }

  #bindPlayer(): void {
    const unbind = this.#unbind;
    this.#unbind = undefined;
    const clear = (): void => { this.#notes.clear(); };
    try { unbind?.(); } finally { this.#notes.setPlayback(undefined); }
    this.#unbind = bindViewPlayer(this, {
      reset: clear,
      end: clear,
      targetChanged: () => { this.#notes.setPlayback(undefined); },
      playbackSnapshot: (snapshot) => { this.#notes.updatePlayback(snapshot); },
      noteOn: ({midi}) => { this.#notes.noteOn(midi); },
      noteOff: ({midi}) => { this.#notes.noteOff(midi); },
    }, this.getAttribute('player') ? 'player' : 'source');
  }
}

/** Register <pitch-view> (or a custom tag). Idempotent and SSR-safe. */
export function definePitchViewElement(tag = 'pitch-view'): void {
  defineOnce(tag, PitchViewElement);
}
