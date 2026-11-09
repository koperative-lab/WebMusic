/** What a check's live canvas gets: the canvas, its Parameters area and a cancellation signal. */
export interface MountContext {
  readonly canvas: HTMLElement;
  readonly parameters: HTMLElement;
  readonly signal: AbortSignal;
  /** Report a composition failure once, in the canvas's single error line. */
  fail(error: unknown): void;
}

export type Cleanup = void | (() => void);
export type Mount = (context: MountContext) => Cleanup | Promise<Cleanup>;

export interface Group {
  readonly id: string;
  readonly title: string;
}

/**
 * One manual check. Every check mounts a live canvas built from the packages'
 * own Elements and Headless objects, so the person accepts the shipped code,
 * never a stand-in.
 */
export interface Check {
  readonly id: string;
  readonly group: string;
  readonly title: string;
  readonly steps: readonly string[];
  readonly expected: readonly string[];
  /** Loaded on demand so the catalog stays light and importable without a DOM. */
  readonly mount: () => Promise<Mount>;
}
