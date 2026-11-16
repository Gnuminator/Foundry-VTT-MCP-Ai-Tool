/**
 * The pure parts of the wrapper version check: the wrapper entry and status shapes and the
 * version and build comparisons. Kept apart from wrapper-registry.ts because that file reads
 * BUILD_ID (which reads the tool modules), while tools/preflight.ts needs these helpers and is
 * itself one of the tool modules: importing the registry from there would be an import cycle.
 * No import of build-id.ts or tool-sets.ts here, ever.
 */

export interface WrapperEntry {
  /** The wrapper's tool version, or null for a wrapper too old to send one. */
  version: string | null;
  /** The wrapper's build id, or null for a wrapper from before build ids (never warned on). */
  build: string | null;
  /** The tool sets it lists ("all" when it lists every set). */
  sets: string;
}

export interface WrapperStatus {
  current: string;
  /** The backend's own build id. */
  build: string;
  wrappers: WrapperEntry[];
  /** True when any connected wrapper is behind (see {@link isWrapperBehind}). */
  behind: boolean;
}

function parts(version: string): number[] {
  return version.split('.').map(p => Number.parseInt(p, 10) || 0);
}

/** True when `version` is older than `current` (plain numeric x.y.z compare). */
export function isOlderVersion(version: string, current: string): boolean {
  const a = parts(version);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/**
 * True when the wrapper runs a different build of the same version: the versions are equal, it
 * sent a build id and that id is not the backend's. A wrapper that sent none is not counted.
 */
export function isOtherBuild(w: WrapperEntry, current: string, build: string): boolean {
  return w.version === current && w.build !== null && w.build !== build;
}
