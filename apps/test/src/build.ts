/**
 * The build a manual acceptance pass runs against: the release version, the
 * exact commit and whether the working tree differed from it. A report is
 * evidence only for this identity, so the runner shows it, keys its stored
 * results to it and writes it into every exported report.
 */
export interface BuildIdentity {
  /** Shared release version of the publishable packages; `mixed` if they disagree. */
  readonly version: string;
  /** Full commit SHA, or `unknown` outside a Git checkout. */
  readonly commit: string;
  readonly branch: string;
  /** Uncommitted tracked or untracked changes, excluding ignored files. */
  readonly changes: number;
  readonly committedAt: string;
  /** Each publishable package's manifest version, in release order. */
  readonly packages: Readonly<Record<string, string>>;
  readonly generatedAt: string;
}

export const BUILD_IDENTITY_FILE = 'build-info.json';

export const shortCommit = (identity: Pick<BuildIdentity, 'commit'>): string => identity.commit.slice(0, 7);

/** One stable key per build; results of another build never mix into it. */
export const buildKey = (identity: Pick<BuildIdentity, 'version' | 'commit' | 'changes'>): string =>
  `${identity.version}@${identity.commit}${identity.changes > 0 ? '+changes' : ''}`;

export function describeBuild(identity: BuildIdentity): string {
  const tree = identity.changes > 0 ? ` + ${identity.changes} uncommitted change${identity.changes === 1 ? '' : 's'}` : '';
  return `v${identity.version} · ${shortCommit(identity)}${tree}`;
}

export const UNKNOWN_BUILD: BuildIdentity = Object.freeze({
  version: 'unknown', commit: 'unknown', branch: 'unknown', changes: 0, committedAt: '',
  packages: Object.freeze({}), generatedAt: '',
});

function isIdentity(value: unknown): value is BuildIdentity {
  const candidate = value as Partial<BuildIdentity> | null;
  return !!candidate && typeof candidate.version === 'string' && typeof candidate.commit === 'string'
    && typeof candidate.branch === 'string' && typeof candidate.changes === 'number'
    && typeof candidate.packages === 'object' && candidate.packages !== null;
}

/** Read fresh on every page load: the development server answers from Git at request time. */
export async function fetchBuildIdentity(base: string): Promise<BuildIdentity> {
  try {
    const response = await fetch(`${base}${BUILD_IDENTITY_FILE}`, {cache: 'no-store'});
    if (!response.ok) return UNKNOWN_BUILD;
    const value: unknown = await response.json();
    return isIdentity(value) ? value : UNKNOWN_BUILD;
  } catch {
    return UNKNOWN_BUILD;
  }
}
