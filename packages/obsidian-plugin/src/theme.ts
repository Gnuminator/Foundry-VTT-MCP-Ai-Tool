/**
 * The Obsidian theme (I-099): the dashboard's two themes, Neutral (the README brand) and The Veil
 * (the Curse of Strahd theme), for the whole vault. One theme per world, shared with the
 * dashboard (`GET /api/theme`, `POST /api/control` `set-theme`); "Off" is local to this Obsidian.
 *
 * The CSS (`theme/obsidian-theme.css`) hangs on classes this file computes: the theme on
 * `<body>`, and the note's front-matter `type` on each Markdown view, so stat blocks, secrets and
 * session details can get their own look whatever folder the note sits in. No `obsidian` import,
 * so this runs in node tests.
 */

export const THEMES = ['neutral', 'veil'] as const;
export type ThemeId = (typeof THEMES)[number];

export const THEME_LABELS: Record<ThemeId, string> = { neutral: 'Neutral', veil: 'The Veil' };

export function isTheme(value: unknown): value is ThemeId {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Every class the plugin may put on `<body>`; removed before the current ones are added. */
export const BODY_CLASSES = ['aitool-themed', ...THEMES.map(t => `aitool-theme-${t}`)];

/** The `<body>` classes for a theme, or none when the styling is off. */
export function bodyClasses(theme: ThemeId, enabled: boolean): string[] {
  return enabled ? ['aitool-themed', `aitool-theme-${theme}`] : [];
}

/** Prefix of the per-note classes (on the Markdown view's container). */
export const NOTE_CLASS_PREFIX = 'aitool-';

/**
 * The view classes for a note's front matter: `aitool-type-<type>` for any note with a `type`
 * (the tool's own and hand-written ones), plus `aitool-generated` for notes the tool wrote.
 */
export function noteClasses(frontmatter: unknown): string[] {
  if (frontmatter === null || typeof frontmatter !== 'object') return [];
  const fm = frontmatter as Record<string, unknown>;
  const classes: string[] = [];
  if (typeof fm.type === 'string') {
    const slug = fm.type
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (slug) classes.push(`aitool-type-${slug}`);
  }
  if (fm.generated_by === 'foundry-ai-tool') classes.push('aitool-generated');
  return classes;
}

/** The theme in a `GET /api/theme` answer, or null when it is not one we know. */
export function themeFromPayload(json: unknown): ThemeId | null {
  if (json === null || typeof json !== 'object') return null;
  const theme = (json as Record<string, unknown>).theme;
  return isTheme(theme) ? theme : null;
}

/** True for a table header that reads 1 to 20 (the stats notes' d20 spread). */
export function isD20Header(cells: readonly string[]): boolean {
  return cells.length === 20 && cells.every((c, i) => c.trim() === String(i + 1));
}

/** Bar heights (0 to 1) for the d20 spread's counts; all zero when nothing was rolled. */
export function barHeights(counts: readonly number[]): number[] {
  const max = Math.max(0, ...counts.map(n => (Number.isFinite(n) && n > 0 ? n : 0)));
  return counts.map(n => (max > 0 && Number.isFinite(n) && n > 0 ? n / max : 0));
}

export interface StatCard {
  label: string;
  value: string;
}

const STAT_PARTS: Array<[RegExp, string]> = [
  [/^(\d+) roll\(s\)$/, 'Rolls'],
  [/^(\d+) crit\(s\)$/, 'Crits'],
  [/^(\d+) fumble\(s\)$/, 'Fumbles'],
  [/^Party: (\d+) damage dealt$/, 'Damage dealt'],
  [/^(\d+) damage taken$/, 'Damage taken'],
  [/^(\d+) healing$/, 'Healing'],
  [/^(\d+) PC down\(s\)$/, 'Went down'],
  [/^(\d+) NPC kill\(s\)$/, 'Kills'],
];

/**
 * The session note's stats line ("12 roll(s), 1 crit(s), 0 fumble(s). Party: 40 damage dealt,
 * ...") as small cards, or null when the line reads differently (it then stays plain text).
 */
export function statCards(text: string): StatCard[] | null {
  const parts = text
    .trim()
    .replace(/\.$/, '')
    .split(/[.,]\s+/)
    .map(p => p.trim());
  if (parts.length !== STAT_PARTS.length) return null;
  const cards: StatCard[] = [];
  for (const [i, part] of parts.entries()) {
    const [pattern, label] = STAT_PARTS[i];
    const match = pattern.exec(part);
    if (!match) return null;
    cards.push({ label, value: match[1] });
  }
  return cards;
}
