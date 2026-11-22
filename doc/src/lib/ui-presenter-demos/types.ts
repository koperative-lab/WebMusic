export interface UiPresenterDemoHandle {
  destroy(): void;
  /** Update one caller-owned State field and publish through the binding subscription. */
  setState?(name: string, value: unknown): void;
  /** Update one mount Option; the demo remounts the real presenter when needed. */
  setOption?(name: string, value: unknown): void;
  /** Restore the catalog demo State and unset every explicit Option. */
  reset?(): void;
  /** Current caller-owned State, used to keep the control strip in sync with commands. */
  snapshot?(): Readonly<Record<string, unknown>>;
  /** Observe command- and timer-driven State changes. */
  subscribe?(notify: () => void): () => void;
}

export type UiPresenterDemoMountResult = UiPresenterDemoHandle | (() => void) | undefined;

export function normalizeDemoHandle(
  result: Exclude<UiPresenterDemoMountResult, undefined>,
): UiPresenterDemoHandle {
  return typeof result === 'function' ? {destroy: result} : result;
}
