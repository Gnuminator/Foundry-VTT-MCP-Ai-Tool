/**
 * The pure renderer of the O7 player vault: input data in, a map of vault-relative paths to file
 * content out. No file system, no clock, no randomness: the same input gives the same map in the
 * same order. Names go through `NameAllocator`, text through `neutralizeMarkdownText` and
 * `htmlToMarkdown`, so nothing from Foundry can become a link or code Obsidian would follow or run.
 *
 * Links between notes are Markdown links with URL-encoded relative paths, never wikilinks.
 */
import type { CharacterSheet, PlayerHandout, SheetItem, SheetSpell } from '@gnuminator/shared';

import { htmlToMarkdown, neutralizeMarkdownText } from './html-md.js';
import { NameAllocator } from './names.js';
import type { PlayerVaultFiles, PlayerVaultInput, VaultSession } from './types.js';

/**
 * Routing rule (v1): a recap is a revealed handout whose title says "recap"; it goes to
 * `Recaps/`. Every other handout goes to `Handouts/`. The session-notes journal itself is never an
 * input here (only handouts the GM revealed to this player), so a recap reaches the vault only by
 * being revealed on purpose.
 */
export const RECAP_TITLE = /\brecap\b/i;

const t = neutralizeMarkdownText;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` of an ISO timestamp, or null when it does not parse. */
function revealedDate(iso: string | null): string | null {
  if (!iso) return null;
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  if (direct) return direct[1] ?? null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

function revealedMs(iso: string | null): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** A vault-relative path as a link target: each segment URL-encoded, brackets and parens too. */
function linkPath(path: string): string {
  return path
    .split('/')
    .map(seg =>
      encodeURIComponent(seg).replace(
        /[()!'*]/g,
        c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join('/');
}

function link(label: string, path: string): string {
  return `[${t(label)}](${linkPath(path)})`;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map(line => (line === '' ? '' : pad + line))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Handouts and recaps
// ---------------------------------------------------------------------------

interface NoteRef {
  title: string;
  path: string;
}

function renderHandout(handout: PlayerHandout): string {
  const title = handout.title.trim() === '' ? 'Handout' : handout.title;
  const parts = [`# ${t(title)}`];
  const date = revealedDate(handout.revealedAt);
  if (date) parts.push(`Revealed: ${date}`);
  const body = htmlToMarkdown(handout.html);
  if (body !== '') parts.push(body);
  return `${parts.join('\n\n')}\n`;
}

function handoutOrder(a: PlayerHandout, b: PlayerHandout): number {
  const byTime = revealedMs(a.revealedAt) - revealedMs(b.revealedAt);
  if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
  if (a.title !== b.title) return a.title < b.title ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Character sheet
// ---------------------------------------------------------------------------

function section(title: string, lines: string[]): string {
  const body = lines.filter(l => l !== '');
  return body.length === 0 ? '' : `## ${title}\n\n${body.join('\n')}`;
}

function kv(label: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return `- ${label}: ${typeof value === 'number' ? String(value) : t(value)}`;
}

function list(label: string, values: string[]): string {
  const clean = values.map(v => v.trim()).filter(v => v !== '');
  return clean.length === 0 ? '' : `- ${label}: ${clean.map(t).join(', ')}`;
}

function usesText(uses: { value: number; max: number; recovery: string | null } | null): string {
  if (!uses || uses.max <= 0) return '';
  const recovery = uses.recovery ? `, ${t(uses.recovery)}` : '';
  return `${uses.value}/${uses.max} uses${recovery}`;
}

function proficiencyLabel(level: number): string {
  if (level >= 2) return 'Expertise';
  if (level >= 1) return 'Proficient';
  if (level > 0) return 'Half';
  return '';
}

function overview(sheet: CharacterSheet): string {
  const classes = sheet.classes.map(c => {
    const sub = c.subclass ? ` (${c.subclass})` : '';
    return `${c.name} ${c.levels}${sub}`;
  });
  const speeds = Object.entries(sheet.speed)
    .filter(([, v]) => Number.isFinite(v) && v > 0)
    .map(([k, v]) => `${k} ${v} ${sheet.speedUnits ?? 'ft'}`);
  const dice = Array.from(
    new Set(sheet.classes.map(c => c.hitDie).filter((d): d is string => !!d))
  );
  const hp = sheet.hp;
  const temp = hp.temp > 0 ? ` (+${hp.temp} temporary)` : '';
  const saves = sheet.deathSaves;
  return section('Overview', [
    kv('Level', sheet.level > 0 ? sheet.level : null),
    list('Class', classes),
    kv('Species', sheet.species),
    kv('Background', sheet.background),
    kv('Alignment', sheet.alignment),
    kv('Size', sheet.size),
    kv('Experience', sheet.xp),
    kv('Armor class', sheet.ac),
    `- Hit points: ${hp.value}/${hp.max}${temp}`,
    `- Hit dice: ${sheet.hitDice.value}/${sheet.hitDice.max}${dice.length > 0 ? ` (${dice.map(t).join(', ')})` : ''}`,
    list('Speed', speeds),
    list('Senses', sheet.senses),
    kv(
      'Proficiency bonus',
      sheet.proficiencyBonus === null ? null : signed(sheet.proficiencyBonus)
    ),
    kv('Initiative', sheet.initiative === null ? null : signed(sheet.initiative)),
    kv('Passive Perception', sheet.passivePerception),
    sheet.inspiration ? '- Inspiration: yes' : '',
    sheet.exhaustion > 0 ? `- Exhaustion: ${sheet.exhaustion}` : '',
    saves.success > 0 || saves.failure > 0
      ? `- Death saves: ${saves.success} successes, ${saves.failure} failures`
      : '',
    list('Conditions', sheet.conditions),
    kv('Concentrating on', sheet.concentration),
  ]);
}

function abilityTable(sheet: CharacterSheet): string {
  if (sheet.abilities.length === 0) return '';
  const rows = sheet.abilities.map(
    a =>
      `| ${t(a.label)} | ${a.score} | ${signed(a.mod)} | ${signed(a.save)} | ${a.saveProficient ? 'Yes' : ''} |`
  );
  return `## Abilities\n\n${['| Ability | Score | Modifier | Save | Proficient |', '| --- | --- | --- | --- | --- |', ...rows].join('\n')}`;
}

function skillTable(sheet: CharacterSheet): string {
  if (sheet.skills.length === 0) return '';
  const rows = sheet.skills.map(
    s =>
      `| ${t(s.label)} | ${t(s.ability)} | ${signed(s.total)} | ${s.passive} | ${proficiencyLabel(s.proficiency)} |`
  );
  return `## Skills\n\n${['| Skill | Ability | Bonus | Passive | Proficiency |', '| --- | --- | --- | --- | --- |', ...rows].join('\n')}`;
}

function spellcasting(sheet: CharacterSheet): string {
  const sc = sheet.spellcasting;
  const lines = [
    kv('Ability', sc.ability),
    kv('Spell save DC', sc.dc),
    kv('Spell attack', sc.attack === null ? null : signed(sc.attack)),
    ...sheet.slots
      .filter(s => s.max > 0)
      .sort((a, b) => a.level - b.level)
      .map(s =>
        s.pact || s.level === 0
          ? `- Pact magic slots: ${s.value}/${s.max}${s.level > 0 ? ` (level ${s.level})` : ''}`
          : `- Level ${s.level} slots: ${s.value}/${s.max}`
      ),
  ];
  return section('Spellcasting', lines);
}

function spellLine(spell: SheetSpell): string {
  const tags = [
    spell.school,
    spell.prepared ? 'prepared' : null,
    spell.ritual ? 'ritual' : null,
    spell.concentration ? 'concentration' : null,
  ].filter((v): v is string => !!v);
  const details = [
    spell.castingTime ? `casting time ${spell.castingTime}` : null,
    spell.range ? `range ${spell.range}` : null,
    spell.duration ? `duration ${spell.duration}` : null,
    spell.components ? `components ${spell.components}` : null,
    spell.material ? `material ${spell.material}` : null,
  ].filter((v): v is string => !!v);
  const tagText = tags.length > 0 ? ` (${tags.map(t).join(', ')})` : '';
  const detailText = details.length > 0 ? `: ${details.map(t).join('; ')}` : '';
  return `- **${t(spell.name)}**${tagText}${detailText}`;
}

function spellList(sheet: CharacterSheet): string {
  if (sheet.spells.length === 0) return '';
  const levels = Array.from(new Set(sheet.spells.map(s => s.level))).sort((a, b) => a - b);
  const blocks = levels.map(level => {
    const heading = level === 0 ? 'Cantrips' : `Level ${level}`;
    const spells = sheet.spells
      .filter(s => s.level === level)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return `### ${heading}\n\n${spells.map(spellLine).join('\n')}`;
  });
  return `## Spells\n\n${blocks.join('\n\n')}`;
}

function featureList(sheet: CharacterSheet): string {
  if (sheet.features.length === 0) return '';
  const blocks = sheet.features.map(f => {
    const meta = [t(f.kind), usesText(f.uses)].filter(v => v !== '');
    const head = `### ${t(f.name)}`;
    const body = htmlToMarkdown(f.description);
    return [head, meta.length > 0 ? `*${meta.join('; ')}*` : '', body]
      .filter(v => v !== '')
      .join('\n\n');
  });
  return `## Features\n\n${blocks.join('\n\n')}`;
}

function itemLine(item: SheetItem): string {
  const flags = [
    item.equipped ? 'equipped' : null,
    item.attuned ? 'attuned' : null,
    !item.attuned && item.attunement ? `attunement ${item.attunement}` : null,
  ].filter((v): v is string => !!v);
  const extra = [
    item.attack ? `attack ${item.attack}` : null,
    item.damage ? `damage ${item.damage}` : null,
    usesText(item.uses) || null,
  ].filter((v): v is string => !!v);
  const qty = item.quantity !== 1 ? ` x${item.quantity}` : '';
  const type = item.type ? ` (${t(item.type)})` : '';
  const flagText = flags.length > 0 ? `, ${flags.map(t).join(', ')}` : '';
  const extraText = extra.length > 0 ? `: ${extra.map(t).join('; ')}` : '';
  const head = `- **${t(item.name)}**${type}${qty}${flagText}${extraText}`;
  const body = htmlToMarkdown(item.description);
  return body === '' ? head : `${head}\n\n${indent(body, 2)}`;
}

const CURRENCY_ORDER = ['pp', 'gp', 'ep', 'sp', 'cp'];

function equipment(sheet: CharacterSheet): string {
  const keys = Object.keys(sheet.currency)
    .filter(k => (sheet.currency[k] ?? 0) !== 0)
    .sort((a, b) => {
      const ia = CURRENCY_ORDER.indexOf(a);
      const ib = CURRENCY_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const money =
    keys.length > 0
      ? `**Currency:** ${keys.map(k => `${sheet.currency[k]} ${t(k)}`).join(', ')}`
      : '';
  const items = sheet.inventory.length > 0 ? sheet.inventory.map(itemLine).join('\n') : '';
  const body = [items, money].filter(v => v !== '').join('\n\n');
  return body === '' ? '' : `## Equipment\n\n${body}`;
}

function sheetFacts(sheet: CharacterSheet): string[] {
  const p = sheet.personality;
  return [
    section('Proficiencies and languages', [
      list('Languages', sheet.languages),
      list('Armor', sheet.armorProficiencies),
      list('Weapons', sheet.weaponProficiencies),
      list('Tools', sheet.toolProficiencies),
    ]),
    section('Defenses', [
      list('Resistances', sheet.resistances),
      list('Immunities', sheet.immunities),
      list('Vulnerabilities', sheet.vulnerabilities),
    ]),
    section('Personality', [
      kv('Traits', p.traits),
      kv('Ideals', p.ideals),
      kv('Bonds', p.bonds),
      kv('Flaws', p.flaws),
      kv('Appearance', p.appearance),
    ]),
  ];
}

function renderSheet(sheet: CharacterSheet): string {
  const name = sheet.name.trim() === '' ? 'Character' : sheet.name;
  const parts = [
    `# ${t(name)}`,
    overview(sheet),
    abilityTable(sheet),
    skillTable(sheet),
    spellcasting(sheet),
    spellList(sheet),
    featureList(sheet),
    equipment(sheet),
    ...sheetFacts(sheet),
  ].filter(v => v !== '');
  return `${parts.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// Session log
// ---------------------------------------------------------------------------

function renderSession(session: VaultSession): string {
  const lines = session.events.map(e => {
    const d = new Date(e.timestampMs);
    return `- ${pad2(d.getHours())}:${pad2(d.getMinutes())} ${t(e.text)}`;
  });
  return `${[`# Session ${t(session.label)}`, ...(lines.length > 0 ? [lines.join('\n')] : [])].join('\n\n')}\n`;
}

/** Newest first: by the first event's time, then by label. Pure, so the order is stable. */
function sessionOrder(a: VaultSession, b: VaultSession): number {
  const ta = a.events[0]?.timestampMs ?? Number.NEGATIVE_INFINITY;
  const tb = b.events[0]?.timestampMs ?? Number.NEGATIVE_INFINITY;
  if (ta !== tb) return ta < tb ? 1 : -1;
  return a.label < b.label ? 1 : a.label > b.label ? -1 : 0;
}

// ---------------------------------------------------------------------------
// The vault
// ---------------------------------------------------------------------------

function homeSection(title: string, refs: NoteRef[]): string {
  return refs.length === 0
    ? ''
    : `## ${title}\n\n${refs.map(r => `- ${link(r.title, r.path)}`).join('\n')}`;
}

/**
 * Render one player's vault: `Home.md`, the character note(s), recaps, handouts, the session log
 * and, when the theme has Obsidian CSS, the snippet plus `.obsidian/appearance.json`.
 */
export function renderPlayerVault(input: PlayerVaultInput): PlayerVaultFiles {
  const files: PlayerVaultFiles = new Map();
  const userId = input.player.userId;

  // Defence in depth: the service filters too, the renderer never trusts it.
  const visible = input.handouts
    .filter(h => !h.players || h.players.includes(userId))
    .sort(handoutOrder);

  const recapNames = new NameAllocator();
  const handoutNames = new NameAllocator();
  const recaps: NoteRef[] = [];
  const handouts: NoteRef[] = [];
  const notes = new Map<string, string>();
  for (const handout of visible) {
    if (RECAP_TITLE.test(handout.title)) {
      const path = `Recaps/${recapNames.take(handout.title, 'Handout')}.md`;
      recaps.push({ title: handout.title.trim() === '' ? 'Handout' : handout.title, path });
      notes.set(path, renderHandout(handout));
    } else {
      const path = `Handouts/${handoutNames.take(handout.title, 'Handout')}.md`;
      handouts.push({ title: handout.title.trim() === '' ? 'Handout' : handout.title, path });
      notes.set(path, renderHandout(handout));
    }
  }

  const characters: NoteRef[] = [];
  const characterNames = new NameAllocator();
  for (const sheet of input.sheets) {
    const path =
      input.sheets.length === 1
        ? 'My character.md'
        : `My characters/${characterNames.take(sheet.name, 'Character')}.md`;
    characters.push({ title: sheet.name.trim() === '' ? 'Character' : sheet.name, path });
    notes.set(path, renderSheet(sheet));
  }

  const sessionNames = new NameAllocator();
  const sessions: NoteRef[] = [];
  const sessionNotes = new Map<string, string>();
  for (const session of [...input.sessions].sort(sessionOrder)) {
    const path = `Session log/${sessionNames.take(session.label, 'Session')}.md`;
    sessions.push({ title: session.label, path });
    sessionNotes.set(path, renderSession(session));
  }

  const home = [
    `# ${t(input.worldTitle.trim() === '' ? 'Campaign' : input.worldTitle)}`,
    `Player: ${t(input.player.name)}`,
    '> [!info] Written by the AI Tool\n> The AI Tool writes this vault from Foundry. Edits you make here are overwritten at the next update.',
    homeSection(input.sheets.length === 1 ? 'My character' : 'My characters', characters),
    homeSection('Recaps', recaps),
    homeSection('Handouts', handouts),
    homeSection('Session log', sessions),
  ].filter(v => v !== '');
  files.set('Home.md', `${home.join('\n\n')}\n`);

  for (const [path, content] of notes) files.set(path, content);
  for (const [path, content] of sessionNotes) files.set(path, content);

  const css = input.theme.css;
  if (typeof css === 'string' && css !== '') {
    const snippet = `aitool-theme-${input.theme.id}`;
    files.set(`.obsidian/snippets/${snippet}.css`, css);
    files.set(
      '.obsidian/appearance.json',
      `${JSON.stringify({ enabledCssSnippets: [snippet] }, null, 2)}\n`
    );
  }
  return files;
}
