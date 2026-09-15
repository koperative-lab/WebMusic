let counter = 0;

// Per-process random salt so IDs generated in different sessions (or in
// processes started within the same millisecond window) do not collide.
const sessionSalt = Math.floor(Math.random() * 36 ** 4)
  .toString(36)
  .padStart(4, '0');

/**
 * Generate a process-local unique ID with a short readable prefix.
 * Combines a timestamp slice, a per-process random salt and a counter.
 * Importers may override with hash-based stable IDs derived from source data.
 */
export function makeId(prefix: string): string {
  return `${prefix}_${(Date.now() % 1e7).toString(36)}${sessionSalt}_${(counter++).toString(36)}`;
}
