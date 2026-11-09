export type Lang = 'zh' | 'en';
export interface Text { readonly zh: string; readonly en: string }

export const t = (text: Text, lang: Lang): string => text[lang];

/** What a check's composition gets: its canvas, its Parameters area and a cancellation signal. */
export interface MountContext {
  readonly canvas: HTMLElement;
  readonly parameters: HTMLElement;
  readonly signal: AbortSignal;
  readonly lang: Lang;
  /** Report a composition failure once, in the canvas's single error line. */
  fail(error: unknown): void;
}

export type Cleanup = void | (() => void);
export type Mount = (context: MountContext) => Cleanup | Promise<Cleanup>;

export interface Group {
  readonly id: string;
  readonly title: Text;
}

export interface Check {
  readonly id: string;
  readonly group: string;
  readonly title: Text;
  readonly steps: readonly Text[];
  readonly expected: readonly Text[];
  /** Loaded on demand so the catalog stays light; absent for checks that reuse earlier compositions. */
  readonly mount?: () => Promise<Mount>;
}
