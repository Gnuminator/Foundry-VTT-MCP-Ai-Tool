// The During view's Conditions action: add or remove one condition on picked tokens, in a fight or
// out of one. The list of conditions comes from the game (get-available-conditions), and each one
// that dnd5e keeps a rules page for carries that page's uuid, so the dashboard links to Foundry's
// own page. No rules text is stored here (licensed content).

/** One condition the picker offers. */
export interface ConditionChoice {
  id: string;
  name: string;
  /** dnd5e's rules page for it, as a uuid; null when the system has none. */
  reference: string | null;
}

/** A rules page of dnd5e's compendium: the only uuids the dashboard sends to open-in-foundry. */
const RULES_PAGE =
  /^Compendium\.[\w-]+\.[\w-]+\.JournalEntry\.[A-Za-z0-9]{16}\.JournalEntryPage\.[A-Za-z0-9]{16}$/;

/** The conditions of a get-available-conditions answer, by name; anything odd is left out. */
export function conditionChoices(answer: unknown): ConditionChoice[] {
  const list = (answer as { conditions?: unknown } | null)?.conditions;
  if (!Array.isArray(list)) return [];
  const out: ConditionChoice[] = [];
  for (const raw of list as { id?: unknown; name?: unknown; reference?: unknown }[]) {
    if (typeof raw?.id !== 'string' || raw.id === '') continue;
    const name = typeof raw.name === 'string' && raw.name !== '' ? raw.name : raw.id;
    const reference =
      typeof raw.reference === 'string' && RULES_PAGE.test(raw.reference) ? raw.reference : null;
    out.push({ id: raw.id, name, reference });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The plan-actor-change request: the condition on or off the picked tokens. */
export function conditionPlanArgs(
  tokenIds: readonly string[],
  condition: string,
  active: boolean
): { action: 'condition'; targets: string[]; condition: string; active: boolean } {
  return { action: 'condition', targets: [...tokenIds], condition, active };
}

/** The button text: what it does and to how many. */
export function conditionButtonLabel(
  choice: ConditionChoice | undefined,
  count: number,
  active: boolean
): string {
  const who = count === 1 ? '1 token' : `${count} tokens`;
  const what = choice ? choice.name : 'a condition';
  return active ? `Add ${what} to ${who}` : `Remove ${what} from ${who}`;
}
