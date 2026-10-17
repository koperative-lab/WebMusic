/** A precise, revocable resource relationship. It never implies ownership of its endpoints. */
export interface ConnectionLease {
  readonly active: boolean;
  release(): void;
}

/** Mark inactive before cleanup, including when cleanup re-enters or throws. */
export function createConnectionLease(cleanup: () => void): ConnectionLease {
  if (typeof cleanup !== 'function') throw new TypeError('Lease cleanup must be a function');
  let active = true;
  return Object.freeze({
    get active() { return active; },
    release() {
      if (!active) return;
      active = false;
      cleanup();
    },
  });
}
