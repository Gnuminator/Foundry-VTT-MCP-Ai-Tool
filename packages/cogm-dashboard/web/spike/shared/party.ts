// Svelte spike (never merged): what both Party versions share. Framework-free and not counted in
// either version's lines (BRIEF.md).

export interface PartyMember {
  actorId: string;
  name: string;
  level: number | null;
  ac: number | null;
  passivePerception: number | null;
  hp: { value: number; max: number; temp: number } | null;
  exhaustion: number;
  conditions: string[];
  inspiration: boolean;
}

export interface PartyGroup {
  actorId: string;
  name: string;
  level: number;
  pace: { value: string; label: string } | null;
  members: PartyMember[];
}

export interface PartyState {
  groups: PartyGroup[];
  paceOptions: { value: string; label: string }[];
}

export type LoadParty = () => Promise<PartyState>;
export type PlanPace = (groupId: string, pace: string) => Promise<void>;

export const PARTY_QUERY_KEY = ['spike-party'] as const;

async function tool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, args }),
  });
  const data = (await res.json()) as { ok?: boolean; result?: T; error?: string };
  if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.result as T;
}

/** The shells' real calls (the dashboard's /api/tool). */
export const httpLoad: LoadParty = () => tool<PartyState>('get-party', {});
export const httpPlanPace: PlanPace = async (groupId, pace) => {
  await tool('plan-party-change', { action: 'pace', pace, groupId });
};

/** The facts line of a member row. */
export function memberFacts(m: PartyMember): string {
  const facts: string[] = [];
  if (m.level != null) facts.push(`Level ${m.level}`);
  if (m.ac != null) facts.push(`AC ${m.ac}`);
  if (m.passivePerception != null) facts.push(`Passive Perception ${m.passivePerception}`);
  return facts.join(' · ');
}

/** Story data: generic names, nothing from a book or the campaign. */
const member = (i: number, name: string): PartyMember => ({
  actorId: `a${i}`,
  name,
  level: 3,
  ac: 13 + (i % 4),
  passivePerception: 10 + (i % 5),
  hp: { value: [24, 6, 18, 30][i % 4] ?? 20, max: 30, temp: i === 2 ? 5 : 0 },
  exhaustion: i === 1 ? 1 : 0,
  conditions: i === 0 ? ['Poisoned'] : i === 3 ? ['Frightened', 'Prone'] : [],
  inspiration: i === 0,
});

export const STORY_PARTY: PartyState = {
  groups: [
    {
      actorId: 'g1',
      name: 'The Lantern Crew',
      level: 3,
      pace: { value: 'normal', label: 'Normal' },
      members: ['Aldric', 'Brenna', 'Cormac', 'Delphine'].map((n, i) => member(i, n)),
    },
    {
      actorId: 'g2',
      name: 'Second group',
      level: 2,
      pace: null,
      members: [member(4, 'Eilis')],
    },
  ],
  paceOptions: [
    { value: 'slow', label: 'Slow' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
  ],
};
