# Rules question flow

1. Pick the search terms: the name of the spell, condition, feature, action or rule.
2. Call `search-books` with `query`. It reads the text of the books the table allows players to
   read and returns short excerpts with the entry and book. For an exact spell, feature or item
   name use `find-book-entries` instead: it matches names and types, and is the quickest way to
   find the entry.
3. Read the best hits in full with `get-book-entry`, using the ids from the hit. Answer from the
   text itself, never from a title or a snippet alone. If a result is cut short, say so and search
   again with a narrower query rather than guessing the rest.
4. Prefer the 2024 rules. If an older version also exists, add one line on how it differs only
   when that changes the answer.
5. Answer in this shape: the answer first (one or two sentences); then **How it works** in a few
   short bullets if needed; then **Source:** the book, the entry name, and the rules version
   (2024, older or unknown). If two sources disagree, name both.
6. If nothing in the books covers it: "I could not find this in the table's books", then your best
   answer from general knowledge, labelled "not from the books". Never invent a page number or
   quote. A note that some results were hidden is normal; do not try to dig around it.
7. If the rules do not settle it, say so, give two ways to rule on it and a recommendation. The GM
   has the final word at the table.
8. A question about what is _best_ is not a rules question: the books will not rank options. Use
   ground rule 8 of the skill (your own reasoning, labelled as opinion, optional Dungeon Mister
   link).

Paraphrase; don't paste long book passages.
