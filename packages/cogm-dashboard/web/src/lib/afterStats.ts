// Tonight's stats (the After view): rolls, most damage, the highest roll and who went down, for the
// latest play session (get-play-stats). Port of the old page's summarizeSession, statsForDiscord
// and helpers (public/app.js). Pure, so it is tested without a page.

/** One fight in get-play-stats' latest session (stats/types.ts on the bridge; fields used here). */
interface StatsCombat {
  damageDealt?: Record<string, number>;
  downs?: string[];
}

/** What get-play-stats answers for `{ session: 'latest' }`; the fields used here. */
export interface PlayStats {
  pcs?: { name: string }[];
  session?: {
    label?: string;
    durationMin?: number;
    endedAt?: string | null;
    rolls?: number;
    crits?: number;
    fumbles?: number;
    highestRoll?: { total: number; name: string; label?: string } | null;
    combats?: StatsCombat[];
    pcDownsByName?: Record<string, number>;
  } | null;
}

/** The cards' numbers for the latest session. */
export interface SessionSummary {
  label: string | undefined;
  durationMin: number;
  endedAt: string | null | undefined;
  rolls: number;
  nat20: number;
  nat1: number;
  mostDamage: { name: string; amount: number; fights: number } | null;
  highestRoll: { total: number; name: string; label?: string } | null;
  /** Hero name and how many times they went down. */
  downs: [string, number][];
  fights: number;
}

export function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function hoursMinutes(min: number): string {
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

/** Most damage, who went down and the rest, from get-play-stats' latest session. */
export function summarizeSession(result: PlayStats | null | undefined): SessionSummary | null {
  const s = result?.session;
  if (!s) return null;
  const pcNames = new Set((result.pcs ?? []).map(p => p.name));
  const combats = Array.isArray(s.combats) ? s.combats : [];
  // Damage dealt per PC, summed over tonight's fights (only PCs: the cards name players' heroes).
  const dealt = new Map<string, { amount: number; fights: number }>();
  for (const c of combats) {
    for (const [name, amount] of Object.entries(c.damageDealt ?? {})) {
      if (!pcNames.has(name) || !(amount > 0)) continue;
      const d = dealt.get(name) ?? { amount: 0, fights: 0 };
      d.amount += amount;
      d.fights += 1;
      dealt.set(name, d);
    }
  }
  const top = [...dealt.entries()].sort((a, b) => b[1].amount - a[1].amount)[0] ?? null;
  // Every hero who dropped to 0 HP this session, in a fight or not (a trap, a fall). An older
  // bridge only lists the downs per fight.
  const downs = new Map<string, number>();
  if (s.pcDownsByName && typeof s.pcDownsByName === 'object') {
    for (const [name, k] of Object.entries(s.pcDownsByName)) if (k > 0) downs.set(name, k);
  } else {
    for (const c of combats) {
      for (const name of c.downs ?? []) downs.set(name, (downs.get(name) ?? 0) + 1);
    }
  }
  return {
    label: s.label,
    durationMin: s.durationMin ?? 0,
    endedAt: s.endedAt,
    rolls: s.rolls ?? 0,
    nat20: s.crits ?? 0,
    nat1: s.fumbles ?? 0,
    mostDamage: top ? { name: top[0], amount: top[1].amount, fights: top[1].fights } : null,
    highestRoll: s.highestRoll ?? null,
    downs: [...downs.entries()],
    fights: combats.length,
  };
}

/** The line under the session title: how long, when it ended, how many fights. */
export function sessionMeta(a: SessionSummary): string {
  const ended = a.endedAt
    ? new Date(a.endedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null;
  return `${hoursMinutes(a.durationMin)}${ended ? ` · ended ${ended}` : ''} · ${plural(a.fights, 'fight', 'fights')}`;
}

/**
 * The text for the players' Discord channel. It leaves out the highest roll: the play log does
 * not keep a roll's visibility, so it may be a private or blind roll (stats/types.ts).
 */
export function statsForDiscord(a: SessionSummary): string {
  const lines = [`**${a.label || 'Last session'}** (${hoursMinutes(a.durationMin)})`];
  lines.push(
    `Rolls: ${a.rolls} (${plural(a.nat20, 'natural 20', 'natural 20s')}, ${plural(a.nat1, 'natural 1', 'natural 1s')})`
  );
  if (a.mostDamage) {
    lines.push(
      `Most damage: ${a.mostDamage.name}, ${a.mostDamage.amount} hp over ${plural(a.mostDamage.fights, 'fight', 'fights')}`
    );
  }
  lines.push(
    a.downs.length
      ? `Went down: ${a.downs.map(([n, k]) => `${n} ${times(k)}`).join(', ')}`
      : 'Went down: nobody'
  );
  return lines.join('\n');
}
