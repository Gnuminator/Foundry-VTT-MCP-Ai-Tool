/**
 * `AI Tool/Usage/Dashboard usage.md` (I-084, `docs/design/USAGE-LOG.md`): which
 * controls of the dashboard, the `/player` page and the Foundry module get
 * used, and which never do. Pure: a `UsageModel` in, Markdown out. GM vault
 * only; the note is rebuilt on every export like the other generated notes.
 *
 * Names in the model are fixed control names (never typed text), but people's
 * names come from Foundry, so every table cell goes through `cell`.
 */
import type { UsageSurface } from '@gnuminator/shared';

import type { UsageModel } from '../stats/usage.js';

import { withGeneratedHash } from './ownership.js';
import { GENERATED_BANNER, cell, frontmatter, generatedProps } from './render.js';

/** Where the note lives, relative to the campaign folder. */
export const USAGE_NOTE_PATH = 'AI Tool/Usage/Dashboard usage.md';

const SURFACE_TITLE: Record<UsageSurface, string> = {
  dashboard: 'Dashboard',
  player: 'Player page',
  module: 'Foundry module',
};

/** "1h 05m", "12m", "45s", "0s". */
export function formatUsageDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function code(name: string): string {
  return `\`${cell(name)}\``;
}

function table(headers: string[], rows: string[][], emptyText = '(none)'): string[] {
  if (rows.length === 0) return [emptyText, ''];
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(r => `| ${r.join(' | ')} |`),
    '',
  ];
}

export function renderUsageNote(worldId: string, model: UsageModel): string {
  const t = model.totals;
  const props = generatedProps(
    'usage',
    worldId,
    {
      events: t.events,
      people: t.people,
      first_day: model.period.firstDay,
      last_day: model.period.lastDay,
      days: model.period.days,
    },
    model.lastEventAt === null ? null : new Date(model.lastEventAt).toISOString()
  );

  const lines: string[] = [
    frontmatter(props),
    '# Dashboard usage',
    '',
    GENERATED_BANNER,
    '',
    'Which controls of the dashboard, the player page and the Foundry module get used. ' +
      'Only fixed control names are logged, never typed text, tool arguments or setting values. ' +
      'Rebuilt from the usage log on every export.',
    '',
    '## Period and totals',
    '',
    model.period.firstDay
      ? `${model.period.firstDay} to ${model.period.lastDay} (${model.period.days} days with activity).`
      : 'No usage recorded yet.',
    '',
    ...table(
      ['Events', 'Views', 'Time on views', 'Actions', 'Shortcuts', 'Tool runs', 'Errors', 'People'],
      [
        [
          `${t.events}`,
          `${t.views}`,
          formatUsageDuration(t.timeOnViewMs),
          `${t.actions}`,
          `${t.shortcuts}`,
          `${t.tools}`,
          `${t.errors}`,
          `${t.people}`,
        ],
      ]
    ),
    '## Most used',
    '',
    ...table(
      ['Control', 'Kind', 'Uses', 'People'],
      model.mostUsed.map(m => [code(m.name), m.kind, `${m.uses}`, cell(m.people.join(', '))])
    ),
    '## Never used',
    '',
  ];

  for (const surface of Object.keys(SURFACE_TITLE) as UsageSurface[]) {
    const entries = model.neverUsed.bySurface[surface];
    lines.push(`### ${SURFACE_TITLE[surface]}`, '');
    lines.push(
      ...(entries.length === 0
        ? ['Everything in the catalogue was used at least once.', '']
        : [...entries.map(e => `- ${code(e.name)} (${e.kind})`), ''])
    );
  }
  lines.push('### Tools never run from the tool runner', '');
  if (model.neverUsed.tools === null) {
    lines.push('(tool list not available in this export)', '');
  } else if (model.neverUsed.tools.length === 0) {
    lines.push('Every tool was run at least once.', '');
  } else {
    lines.push(...model.neverUsed.tools.map(n => `- ${code(n)}`), '');
  }

  lines.push(
    '## Per person',
    '',
    ...table(
      ['Person', 'Role', 'Views', 'Time on views', 'Actions', 'Tool runs', 'Top 3'],
      model.people.map(p => [
        cell(p.name),
        p.role,
        `${p.views}`,
        formatUsageDuration(p.timeOnViewMs),
        `${p.actions}`,
        `${p.tools}`,
        cell(p.top.map(x => `${x.name} (${x.uses})`).join(', ')),
      ])
    ),
    '## Per session',
    '',
    ...table(
      ['Session', 'Events', 'People', 'Views', 'Actions', 'Tool runs', 'Errors'],
      model.sessions.map(s => [
        s.label === null ? '(outside a session)' : `[[${cell(s.label)}]]`,
        `${s.events}`,
        `${s.people}`,
        `${s.views}`,
        `${s.actions}`,
        `${s.tools}`,
        `${s.errors}`,
      ])
    ),
    '## Errors',
    '',
    ...table(
      ['Name', 'Code', 'Count'],
      model.errors.map(e => [code(e.name), cell(e.code), `${e.count}`])
    ),
    '## Unknown names',
    '',
    'Names seen in the log that are not in the control catalogue (renamed or removed controls).',
    '',
    ...table(
      ['Name', 'Uses'],
      model.unknown.map(u => [code(u.name), `${u.uses}`])
    )
  );

  return withGeneratedHash(lines.join('\n'));
}
