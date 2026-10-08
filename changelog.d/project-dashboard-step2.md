### Developer tools (D-103)

- **Project dashboard, step 2:** a versions panel (Foundry, dnd5e and every module on the PC test
  server, on the Orange Pi through one read-only `cat` over SSH, and the newest online, four times
  a day; `npm run project-dashboard -- --versions`), measured Usage rows and a weekly summary that
  the page writes to the vault notes `Usage log (measured).md` and `Usage weekly (measured).md`
  (each PC owns its own section), and a session-notes watchdog (red when a recording has no notes
  within 24 hours, amber when paused on the usage limit).
- **Vault wrapper (D-102):** `npm run vault:sync -- push -m "message" <paths>` pulls with autostash,
  commits only the given paths and pushes. The dashboard uses it hourly at most, and only while
  the rest of the vault is clean and nothing is left unpushed (it waits and warns otherwise); its
  pull never stashes, only fast-forwards.
