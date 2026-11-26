### Tests

- **Token budget per PR:** a Stop hook (`.claude/hooks/budget.mjs`) keeps a running token total per session, counted like `npm run usage:week`, and prints "lane at 12.6 M of 18 M" once at 70% and once at 100%; the lane keeps working. `npm run token:budget` groups the totals by branch and PR into the vault note `Token budget.md` for the PM board.
