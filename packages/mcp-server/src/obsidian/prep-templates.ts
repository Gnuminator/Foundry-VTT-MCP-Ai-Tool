/**
 * The GM's prep templates (R2, D-094; vault note `Design/I-118 Obsidian slice review
 * 2026-10-06.md`): four notes in `Prep/Templates/` with the properties the prep digest (R3,
 * `prep-notes.ts`) reads. Plain Markdown with no placeholders, so they work with Obsidian's core
 * Templates plugin, with Templater, or copied by hand; the companion plugin's "New prep note for
 * this" fills `fvtt_uuid` and a link back from the template of the same name.
 *
 * The export writes them only while the folder is missing: a template the GM deletes or edits
 * stays that way. The prep digest skips this folder, so a template is never read as a prep note.
 */
import type { NoteWriter } from './note-writer.js';

/** The templates folder, relative to the campaign folder. */
export const PREP_TEMPLATES_DIR = 'Prep/Templates';

function template(type: string, extra: string[], hint: string, headings: string[]): string {
  return [
    '---',
    `type: ${type}`,
    'fvtt_uuid:',
    'ai_context: true',
    'secret:',
    ...extra.map(key => `${key}:`),
    '---',
    `%% ${hint} Claude reads the properties and the first lines below when you prep; set ai_context to false to keep this note out. Players never see your Prep notes. %%`,
    '',
    ...headings.flatMap(heading => [`## ${heading}`, '', '']),
  ]
    .join('\n')
    .replace(/\n+$/, '\n');
}

/** File name (in PREP_TEMPLATES_DIR) to template text. The names match the plugin's kinds. */
export const PREP_TEMPLATES: Readonly<Record<string, string>> = {
  'NPC.md': template(
    'npc-prep',
    ['voice', 'wants'],
    'NPC prep: fvtt_uuid is the NPC in Foundry (the plugin fills it).',
    ['What they do next', 'What they know']
  ),
  'Location.md': template(
    'location-prep',
    ['mood'],
    'Location prep: fvtt_uuid is the scene in Foundry (the plugin fills it).',
    ['What the players find', 'What can go wrong']
  ),
  'Quest.md': template(
    'quest-prep',
    ['stakes'],
    'Quest prep: fvtt_uuid is the quest journal in Foundry (the plugin fills it).',
    ['Where it stands', 'Next steps']
  ),
  'Session plan.md': template(
    'session-plan',
    ['date'],
    'Session plan: date is the game night (YYYY-MM-DD); the newest plan is the one Claude reads.',
    ['Opening scene', 'Likely scenes', 'Loose ends']
  ),
};

/** Write the templates when PREP_TEMPLATES_DIR is missing (created ones land in the writer's list). */
export async function createPrepTemplates(writer: NoteWriter): Promise<void> {
  if (await writer.existsIgnoringCase(PREP_TEMPLATES_DIR)) return;
  for (const [name, text] of Object.entries(PREP_TEMPLATES)) {
    await writer.createOnce(`${PREP_TEMPLATES_DIR}/${name}`, text);
  }
}
