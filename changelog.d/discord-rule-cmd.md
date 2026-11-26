### Discord bot

- **`/rule` lookup:** `/rule <words>` answers from the revealed pages by plain text search, no AI:
  a page whose title holds the words answers whole (`/rule house` gives the house rules), otherwise
  the lines that hold the words. Only pages revealed to everyone are searched, answers are cut at
  1800 characters, and a miss says to ask the GM. Book rules are not included (item
  discord-rule-cmd).
