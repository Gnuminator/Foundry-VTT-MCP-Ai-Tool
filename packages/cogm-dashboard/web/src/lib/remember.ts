// The GM's last choice of a picker or tab, kept in this browser for the next visit (item
// remember-choices). Each choice is one `cogm_` key holding a short string; a read that finds
// nothing, something the picker no longer offers, or a blocked store gives the default. Only the
// GM pages use it: the player view has no pickers and stores nothing.

/** The keys of the remembered choices, one place so two pickers never share one by mistake. */
export const REMEMBER = {
  changesTab: 'cogm_changes_tab',
  changesPerson: 'cogm_changes_person',
  liveAiOnly: 'cogm_live_ai_only',
  foldChoices: 'cogm_fold_choices',
  momentPin: 'cogm_moment_pin',
  partyGroup: 'cogm_party_group',
  partyNoticeDc: 'cogm_party_notice_dc',
  partyNoticeSkill: 'cogm_party_notice_skill',
} as const;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The saved choice when it is one of `allowed`, else `fallback`. */
export function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const saved = read(key);
  return allowed.find(a => a === saved) ?? fallback;
}

/** The saved text of a choice the picker validates itself (a person's name); `fallback` if none. */
export function readText(key: string, fallback: string): string {
  return read(key) ?? fallback;
}

/** Keeps a choice. A blocked store is not an error: the choice then lasts for this page load. */
export function writeChoice(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private window or blocked site data.
  }
}

const MOMENTS = ['before', 'during', 'after'] as const;

/** A saved Before/During/After pick: the moment, whether a session was open and when (ms) it was picked. */
export function readMomentPin(
  raw: unknown
): { moment: (typeof MOMENTS)[number]; open: boolean; at: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const moment = MOMENTS.find(m => m === r['moment']);
  const at = r['at'];
  return moment && typeof r['open'] === 'boolean' && typeof at === 'number'
    ? { moment, open: r['open'], at }
    : null;
}

/** A saved JSON value, parsed; undefined when nothing is saved, it is not JSON, or the store is blocked. */
export function readJson(key: string): unknown {
  const saved = read(key);
  if (saved === null) return undefined;
  try {
    return JSON.parse(saved);
  } catch {
    return undefined;
  }
}

export function writeJson(key: string, value: unknown): void {
  writeChoice(key, JSON.stringify(value));
}
