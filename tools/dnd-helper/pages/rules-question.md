# Rules question flow

The same steps as the connector's `rules-question` prompt, so the answers look alike.

0. Check the table house rules first. The world journal **Table** in the **Campaign** folder holds
   what this table agreed to do differently from the book (the GM edits it). Find it with
   `search-journals` (`searchQuery` "Table", `searchType` "title"), use only a journal named exactly
   "Table", and read it whole with `list-journals` (`journalId`, then each page by `pageId`): it is
   short. If the journal does not exist yet or says nothing on the question, say nothing about it
   and go on. A house rule beats the book: answer with it and put "house rule" in the **Source**
   line. A line marked as not yet agreed or open is a proposal: call it one, never the rule.
1. `list-compendium-packs` to see which books are installed, and which look like 2024 and which
   2014 rules. If you cannot tell, say "version unknown".
2. Pick the search terms: the name of the spell, condition, feature, action or rule. Call
   `search-rules` with `query` first: it reads the text of the rulebook chapters and of item, spell
   and feature descriptions in the rules packs, and returns the page or item id with a short
   snippet. `search-compendium` matches **names only**, so use it for an exact spell or item name.
   `search-journals` (rules terms only, skip and do not open adventure or campaign journals) covers
   rules text that sits in **world** journals, such as a book imported into the world.
3. Read the best hits in full. For a journal page, call `search-rules` again with `limit` 3 and
   `excerptChars` 3000: that returns the matching page text, while a whole journal is far too long
   to open. For a compendium item or spell use `get-compendium-item` with the hit's ids; for a page
   of a world journal use `list-journals` (only with a journal id from a search hit, never to browse
   all titles) with the journal and page. Answer from the text itself, never from a title alone.
4. Prefer the 2024 rules. If a 2014 version also exists, add one line on how it differs only when
   that changes the answer.
5. Answer in this shape: the answer first (one or two sentences); then **How it works** in a few
   short bullets if needed; then **Source:** the book or pack, the entry or page name, and the rules
   version (2024, 2014 or unknown). If two sources disagree, name both.
6. If nothing in the books covers it: "I could not find this in your books", then your best answer
   from general knowledge, labelled "not from your books". Never invent a page number or quote.
7. If the rules do not settle it, say so, give two ways to rule on it and a recommendation. The GM
   has the final word at the table.

Paraphrase; don't paste long book passages.
