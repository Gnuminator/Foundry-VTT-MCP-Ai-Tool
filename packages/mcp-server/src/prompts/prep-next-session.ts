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
        'Call `get-prep-digest` with no arguments. It gathers the facts in one go: last session (scenes, fights, deaths, story beats, handouts revealed; read from the bridge vault, so it still works after a Foundry reload), open quests and unfinished campaign parts, my "Next session" journal, the handout reveal queue, bosses on scenes, the pre-flight summary and the latest AI changes. Read the warnings in it out to me: they say what is missing, for example when Foundry is not connected. If the story beats look thin, call it again with `action` set to "last-session" for up to 200 beats. Build everything below from this digest first.',
        'Only now drill in where the digest is not enough. Call `get-play-stats` with no arguments (it defaults to the latest session) for who took damage, who went down, which spells and resources were spent, and the loot and XP. Call `get-play-session`: if a session is open right now, say so, treat the digest as "the session so far", and use `get-session-log` with `limit` set to 300 for what just happened (it only holds events since my Foundry window last loaded, so if it is empty or thin, say that and do not guess).',
        'Read the journals the digest points at, not all of them: call `list-journals` and then again with `journalId` (and `pageId` for one page) for my "Next session" journal and for any open quest that needs detail. Set `filterQuests` to list only quest journals. Use `search-journals` with `searchQuery` for names and places that came up in the beats.',
        'If the digest says a Tarokka reading exists, call `get-tarokka-reading`. It is for me only: use the cards to suggest prep and keep them in this chat. If there is no reading, skip it.',
        'Call `list-revealed-pages` or `list-recent-changes` only if the handout queue or the latest changes in the digest are not enough for what I ask.',
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
