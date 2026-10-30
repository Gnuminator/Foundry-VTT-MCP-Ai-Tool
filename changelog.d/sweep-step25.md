### Tooling

- **Live sweep step 25 explains its rare failure:** when "an AI-ended concentration" finds no
  "Also restored" note, the message now names the cause seen on 2026-10-30: a second GM browser
  logged in as the same user on the test server also runs dnd5e's dependent delete and can win the
  race, so the journal files the dependent under that browser's own action. The foundry-test-env
  skill says to keep one GM browser per test server. No product code changed.
