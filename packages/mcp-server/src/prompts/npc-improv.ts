import type { PromptDefinition } from './types.js';
import {
  RULE_GM_ONLY,
  RULE_HONEST,
  RULE_PARAPHRASE,
  RULE_PLAIN,
  RULE_PLAN,
  RULE_TYPED_TEXT,
  assemble,
  quoted,
} from './text.js';

export const npcImprov: PromptDefinition = {
  name: 'npc-improv',
  title: 'NPC improv card',
  description: 'A quick card for an NPC, for your eyes only: voice, mannerism, want and secret.',
  arguments: [
    {
      name: 'npc',
      description: 'The NPC, by name, for example "Old Marta the innkeeper".',
      required: true,
      maxLength: 200,
    },
  ],
  build: args => {
    const npc = args.npc ?? '';
    return assemble({
      goal: 'Give me a quick improv card for one NPC that I can read in ten seconds at the table. It is for me only.',
      input: [`The NPC (my words, quoted): ${quoted(npc)}`],
      steps: [
        "Call `search-journals` with `searchQuery` set to the NPC's name (and `searchType` set to both). Read the best matches with `list-journals` using `journalId` and `pageId`. These are my campaign notes on the NPC, and they win over anything you invent.",
        "Call `list-characters` with `type` set to npc and look for an actor with that name. If there is one, call `get-character` with `identifier` set to the actor's name, and use its stats and traits as flavor: a low Charisma, a notable feature, a language.",
        'Write the card, short enough to read in ten seconds:\nName and role (one line).\nVoice: pitch, pace, accent, and one line to say out loud.\nMannerism: one physical habit I can act out.\nWant: what they want from the party right now.\nSecret: what they hide, and what would make them slip.\nIf pushed: one line on what they do when the party leans on them.',
        'Mark each part "from notes" with the journal or page name, or "invented". If my notes say nothing about this NPC, say so in the first line and build the card from the name, the role and the setting.',
        'End the card with this line: "GM only. Nothing was sent to the players and nothing was changed."',
      ],
      rules: [RULE_PLAIN, RULE_HONEST, RULE_PARAPHRASE, RULE_GM_ONLY, RULE_PLAN, RULE_TYPED_TEXT],
    });
  },
};
