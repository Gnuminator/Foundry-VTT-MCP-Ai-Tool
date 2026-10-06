/**
 * Earlier Campaign Home templates, frozen. A Home.md that still holds one of these exactly (the
 * GM never edited it) is upgraded to the current template on export; an edited Home stays as it
 * is. Never change these texts: add the next one when the template changes again.
 */
import { frontmatter } from './render.js';

/** The Campaign Home from 2026-09-29 (O4) to 2026-10-06, before the Adventures section. */
function campaignHomeV1(worldId: string): string {
  const base = (folder: string, name: string, columns: string[], sortBy: string): string =>
    [
      '```base',
      'filters:',
      '  and:',
      `    - file.inFolder("Campaigns/${worldId}/AI Tool/${folder}")`,
      'views:',
      '  - type: table',
      `    name: ${name}`,
      '    order:',
      ...columns.map(c => `      - ${c}`),
      '    sort:',
      `      - property: ${sortBy}`,
      '        direction: DESC',
      '```',
    ].join('\n');
  return [
    frontmatter({ type: 'campaign-home', world: worldId }),
    `# ${worldId}`,
    '',
    'Home of this campaign in Obsidian. This note is yours: the AI Tool created it once and never rewrites it.',
    '',
    '- `AI Tool/` is written by the bridge (session logs, change log, Tarokka). Read-only view; rebuilt on export.',
    '- `Prep/` is yours: session plans, NPCs, locations, ideas. The tool never writes there.',
    '',
    '## Sessions',
    '',
    base('Sessions', 'Session logs', ['file.name', 'date', 'events', 'changes', 'actors'], 'date'),
    '',
    '## Change log',
    '',
    base('Changes', 'Changes by month', ['file.name', 'changes', 'applied', 'undone'], 'month'),
    '',
    '## Tarokka',
    '',
    '- [Current reading](AI%20Tool/Tarokka/Current%20reading.md)',
    '',
    '## Foundry',
    '',
    'When the Foundry mirror is on, `AI Tool/Foundry/` holds one note per PC, NPC, scene, journal and story item, rebuilt from Foundry. The bases below and the status note appear once the mirror has run.',
    '',
    '- [PCs](AI%20Tool/Bases/PCs.base)',
    '- [NPCs](AI%20Tool/Bases/NPCs.base)',
    '- [Scenes](AI%20Tool/Bases/Scenes.base)',
    '- [Journals](AI%20Tool/Bases/Journals.base)',
    '- [Story items](AI%20Tool/Bases/Story%20items.base)',
    '- [Player visible](AI%20Tool/Bases/Player%20visible.base)',
    '- [Mirror status](AI%20Tool/Foundry/_status.md)',
    '',
    '## Bases',
    '',
    '- [Sessions](AI%20Tool/Bases/Sessions.base)',
    '- [Changes](AI%20Tool/Bases/Changes.base)',
    '- [Tarokka readings](AI%20Tool/Bases/Tarokka%20readings.base)',
    '',
  ].join('\n');
}

/** The earlier templates, oldest first. */
export const LEGACY_CAMPAIGN_HOMES: ReadonlyArray<(worldId: string) => string> = [campaignHomeV1];

/** Whether a Home note's text is an earlier template for this world, untouched (line endings aside). */
export function isUntouchedLegacyHome(worldId: string, text: string): boolean {
  const normalized = text.replace(/\r\n/g, '\n');
  return LEGACY_CAMPAIGN_HOMES.some(render => render(worldId) === normalized);
}
