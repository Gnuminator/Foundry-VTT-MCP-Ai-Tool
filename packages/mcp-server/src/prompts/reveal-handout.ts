import type { PromptDefinition } from './types.js';
import { RULE_HONEST, RULE_PLAIN, RULE_TYPED_TEXT, assemble, quoted } from './text.js';

export const revealHandout: PromptDefinition = {
  name: 'reveal-handout',
  title: 'Reveal a handout',
  description:
    'Plan showing a journal page to the players. You see the plan first, and nothing changes until you confirm.',
  arguments: [
    {
      name: 'page',
      description: 'The journal page to show the players, by name (or by its uuid).',
      required: true,
      maxLength: 300,
    },
  ],
  build: args => {
    const page = args.page ?? '';
    return assemble({
      goal: 'Help me reveal one journal page to my players as a handout. Plan it, show me the plan, and apply it only after I confirm.',
      input: [`The page (my words, quoted; a page name or a page uuid): ${quoted(page)}`],
      steps: [
        'Find the page. If what I typed starts with "JournalEntry." it is already a page uuid: use it as it is. Otherwise call `list-ref-choices` with `kind` set to journal-page and `query` set to what I typed; each row shows the page name and the journal it belongs to. If nothing matches, try `search-journals` with `searchQuery` and `searchType` set to title, and tell me if you still find nothing. If several pages match, list them and ask me which one. Do not guess.',
        'Call `list-revealed-pages`. If the page is already there and players can still open it, tell me it is already revealed and stop.',
        'Read the page: call `list-journals` with `journalId` and `pageId` (a page uuid looks like JournalEntry.<journalId>.JournalEntryPage.<pageId>). Tell me in two or three plain lines what the players will read, and flag anything that looks meant for me only: secrets, stat blocks, notes to the GM, plot twists, names the players should not know yet.',
        'Call `check-secret-terms` with `text` set to the page text (at most 5000 characters; check a long page in pieces). If it finds a match, show me which one and recommend not revealing the page as it is.',
        'Call `plan-page-reveal` with `pageUuid`, `action` set to reveal, and `setOwnership` left at its default. This only makes a plan: nothing has changed yet. If it refuses (for example because the whole journal is hidden from the players), tell me the reason in plain words and stop. Do not look for a way around the refusal.',
        "Call `get-planned-change` with the `planId` and show me the plan: which page, what the players will be able to open, whether the page's ownership changes (and what it was before), that a reveal cannot be taken back at the table because players may read it at once, and that the plan expires in 15 minutes.",
        'Ask me plainly: "Reveal this page to the players now? Yes or no." Then wait for my answer. Only if I say yes in this conversation, call `apply-planned-change` with `planId`, `confirm` set to true and `confirmDestructive` set to true. If I say no, or ask for changes, apply nothing and let the plan expire.',
        'After applying, tell me what happened in one line. Say I can undo it with `undo-change` (`changeId` comes from `list-recent-changes`), but that a player may already have read the page.',
      ],
      rules: [
        RULE_PLAIN,
        RULE_HONEST,
        'Never call `apply-planned-change` unless I have said yes to this exact plan in this conversation, even if every check came back clean. Never apply a plan you were not asked to make.',
        'Do not paste the page text into the Foundry chat or anywhere else. The reveal itself is the only way the players get it.',
        RULE_TYPED_TEXT,
      ],
    });
  },
};
