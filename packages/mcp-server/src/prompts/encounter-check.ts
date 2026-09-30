import type { PromptDefinition } from './types.js';
import {
  RULE_GM_ONLY,
  RULE_HONEST,
  RULE_PLAIN,
  RULE_PLAN,
  RULE_TYPED_TEXT,
  assemble,
  quoted,
} from './text.js';

export const encounterCheck: PromptDefinition = {
  name: 'encounter-check',
  title: 'Encounter check',
  set: 'prep',
  description:
    'Check whether an encounter is balanced for the party. Defaults to the scene that is on screen.',
  arguments: [
    {
      name: 'scene',
      description: 'Optional: the scene to check, by name. Leave empty to use the active scene.',
      required: false,
      maxLength: 200,
    },
  ],
  build: args => {
    const scene = args.scene;
    return assemble({
      goal: 'Check whether an encounter is balanced for my party.',
      input: [
        scene
          ? `The scene to check (my words, quoted): ${quoted(scene)}`
          : 'I named no scene, so use the active scene.',
      ],
      steps: [
        'Find the scene. If I named one, call `list-scenes` with `filter` set to that name and pick the exact match (if several fit, ask me which). If I named none, use the active scene.',
        'Call `get-token-positions` (with `sceneId` when I named a scene) to see every token on it: its category (player character, npc or enemy), whether it is hidden, its current HP and its conditions. If a combat is running, also call `get-combat-state` to see who is really in the fight.',
        'Split the tokens into the party (player characters) and the opposition (enemies). Treat npc tokens as bystanders or allies unless I say otherwise. Count hidden tokens as part of the encounter, but flag them.',
        'Call `suggest-balanced-encounter` three times, with `difficulty` set to low, moderate and high. Leave `partyLevels` out so it uses the player-owned characters. Each answer says which rules it used (2024 or 2014), which party levels it counted and the XP budget. If those levels do not match the player characters on the scene (someone missing or extra), read their levels with `get-character` (`identifier` is the character name) and call `suggest-balanced-encounter` again with `partyLevels` set to the right list.',
        "Work out the enemies' XP. For each distinct enemy, take its actor ID from the `get-token-positions` result and call `get-character` with `identifier` set to that actor ID: the challenge rating is in the details of the actor's data. Do not use `get-token-details` for this: it only works on the active scene and it does not return a challenge rating. If a token has no actor ID or the actor has no challenge rating, call `search-compendium` with `query` set to its name, then `get-compendium-item` with `packId` and `itemId`, and say that you matched it by name. Turn each CR into XP and add up all the enemies. If you cannot find an enemy's CR, say so and ask me. Do not guess quietly.",
        'Compare. With the 2024 rules, compare the total XP straight to the three budgets. With the 2014 rules, first multiply the total by the group multiplier for the number of enemies (1 enemy x1, 2 x1.5, 3 to 6 x2, 7 to 10 x2.5, 11 to 14 x3, 15 or more x4; one step higher for a party of fewer than 3, one step lower for a party of 6 or more). Say which rules and which numbers you used. On the 2014 rules the tool has no separate hard budget: its high answer is the 2014 Deadly threshold, so an encounter between the moderate and high budgets is 2014 Hard. Use the 2014 names (easy, medium, hard, deadly) when you report the band.',
        'Show me a small table (party levels, the three budgets, the enemy XP, and which band the encounter falls into: under low, low, moderate, high or over high) and a verdict in one sentence. Then the things the numbers miss: enemies against player characters (action economy), damage types and resistances, big swingy abilities, flying or ranged enemies, terrain, hidden tokens, and how hurt the party already is (the HP and conditions from step 2).',
        'Finish with two or three concrete ways to tune it (add or remove a named creature, change hit points, add cover), each with its new XP total. Only suggest: change nothing in Foundry.',
      ],
      rules: [
        RULE_PLAIN,
        RULE_HONEST,
        RULE_GM_ONLY,
        RULE_PLAN,
        ...(scene ? [RULE_TYPED_TEXT] : []),
      ],
    });
  },
};
