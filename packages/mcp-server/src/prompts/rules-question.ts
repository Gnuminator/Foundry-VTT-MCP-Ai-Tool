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

export const rulesQuestion: PromptDefinition = {
  name: 'rules-question',
  title: 'Rules question',
  set: 'core',
  description:
    'Answer a rules question from the books your table has in Foundry, with the source. The 2024 rules come first.',
  arguments: [
    {
      name: 'question',
      description:
        'Your rules question, for example "Can I grapple while I am prone?" or "How does the Help action work?".',
      required: true,
      maxLength: 500,
    },
  ],
  build: args => {
    const question = args.question ?? '';
    return assemble({
      goal: "Answer this rules question from the books my table has in Foundry's compendiums and journals, and tell me where the answer came from. The 2024 rules come first.",
      input: [`My question (my words, quoted): ${quoted(question)}`],
      steps: [
        'Call `list-compendium-packs` to see which books and packs are installed. From the pack names and labels, note which look like 2024 rules and which look like 2014 rules. Do not assume: if you cannot tell, say "version unknown".',
        'Pick the search terms: the name of the spell, condition, feature, action or rule. `search-compendium` with `query` only matches names, so search for the exact name first, then close variants. Use `search-journals` with `searchQuery` (and `searchType` set to both) for rules text that lives in journals, such as imported rulebook chapters.',
        'Read the best hits in full: `get-compendium-item` with `packId` and `itemId` for a compendium entry, `list-journals` with `journalId` and `pageId` for a journal page. Answer from the text itself, never from a title alone.',
        'Prefer the 2024 rules. If both a 2024 and a 2014 version exist, answer with the 2024 one, and add one line on how 2014 differs only if that changes the answer. If only 2014 text exists, use it and say it is the 2014 version.',
        'Answer in this shape: the answer first, in one or two sentences; then "How it works" in a few short bullets if needed; then a line "Source:" with the book or pack, the entry or page name, and the rules version (2024, 2014 or unknown). If two sources disagree, say so and name both.',
        'If nothing in my books covers it, say "I could not find this in your books", then give your best answer from general knowledge of the D&D 5e rules and label it "not from your books". Never invent a page number, a quote or a source.',
        'If the rules do not settle it and it is a judgment call, say so and give two ways to rule on it, with a recommendation.',
      ],
      rules: [RULE_PLAIN, RULE_HONEST, RULE_PARAPHRASE, RULE_GM_ONLY, RULE_PLAN, RULE_TYPED_TEXT],
    });
  },
};
