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

export const prepNextSession: PromptDefinition = {
  name: 'prep-next-session',
  title: 'Prep the next session',
  set: 'prep',
  description:
    'Gather what happened last session and what is still open, then help you prepare the next one.',
  arguments: [
    {
      name: 'focus',
      description:
        'Optional: what you most want to prepare, for example "the heist at the docks". Leave empty for a general prep.',
      required: false,
      maxLength: 300,
    },
  ],
  build: args => {
    const focus = args.focus;
    return assemble({
      goal: 'Help me prepare my next session. First find out what happened last session and what is still open, then help me prepare.',
      input: focus
        ? [`What I want the prep to focus on (my words, quoted): ${quoted(focus)}`]
        : ['I gave no focus, so make it a general prep.'],
      steps: [
        'Call `get-world-info` to confirm Foundry is connected and to learn the world and the system. If it fails, tell me Foundry is not connected and stop.',
        'Call `get-play-session`. If a session is open right now, say so, and treat everything below as "the session so far".',
        'Call `get-play-stats` with no arguments (it defaults to the latest session). Note who took damage, who went down, which spells and resources were spent, and the loot and XP.',
        'Call `get-session-log` with `limit` set to 300 for the story beats: scene changes, fights, deaths, journal changes. It only holds events since my Foundry window last loaded, so if it is empty or thin, say that and do not guess what happened.',
        'Call `list-journals` to see the campaign journals, and read the ones that matter by calling it again with `journalId` (and `pageId` for one page). Set `filterQuests` to list only quest journals. Use `search-journals` with `searchQuery` for names and places that came up in the log. Look for open quests, my own prep notes and anything I wrote for the next session.',
        'Call `get-tarokka-reading`. It is for me only: use the cards to suggest prep and keep them in this chat. If it reports no reading, skip it.',
        'Call `list-revealed-pages` to see which handouts my players already have, and `list-recent-changes` to see which AI changes were applied lately.',
        'Show me, as short bullet lists in this order:\n(a) what happened last session, 5 to 8 beats;\n(b) what is still open: quests, threats, promises made, unfinished fights, each with the journal or log line it came from;\n(c) what the players know and what only I know, where the journals make that clear;\n(d) a prep list for the next session, most important first, with a rough time for each;\n(e) two or three questions about where I want the story to go.\nIf I gave a focus, make it the first item in (d) and let (d) center on it.',
        'Ask me which prep item to start with. Offer, do not do: this prompt writes nothing.',
      ],
      rules: [
        RULE_PLAIN,
        RULE_HONEST,
        RULE_GM_ONLY,
        RULE_PLAN,
        ...(focus ? [RULE_TYPED_TEXT] : []),
      ],
    });
  },
};
