# Foundry AI Tool: Obsidian plugin

A small desktop plugin for the GM's Obsidian vault (idea I-059, `docs/design/OBSIDIAN-PLAN.md`
section 10, P1). It talks only to the co-GM dashboard, never to Foundry or the bridge directly.

For a note with `fvtt_uuid` in its frontmatter (the Obsidian mirror writes it on every note):

- **Open in Foundry**: a command, an item in the note's file menu, and a click on the status bar.
  When several GMs are logged in, it asks whose screen to use.
- **Reveal status** in the status bar for journal page notes: not revealed, queued, revealed (or
  revealed as a copy), and how many players have seen it. It asks the dashboard live, so it is
  right even before the mirror's next cycle updates the `revealed` frontmatter.
- **Reveal to players / Hide from players**: makes the plan and opens the dashboard at
  `/?plan=<id>`, where the GM confirms it. The plugin never applies a change itself (D-067).
- **Add to / Remove from the handout reveal queue**: stages the page for the dashboard's handout
  drawer ("Reveal next"); nothing changes in Foundry.

Settings: the dashboard address (default `http://localhost:3000`) and, only when the dashboard's
player split is on, the GM token, kept in Obsidian's secret storage.

Install: `pwsh scripts/install-obsidian-plugin.ps1 -Vault <vault folder>` (builds and copies), or
`-From foundry-ai-tool-obsidian.zip` from a release. The GM's guide is the "Open in Obsidian" part of `docs/gm/dashboard.md`.

Code: `src/dashboard.ts` (the dashboard client, no `obsidian` import), `src/note.ts` (frontmatter
and status text), `src/main.ts` (the Obsidian glue). `npm run build -w @gnuminator/obsidian-plugin`
writes `dist/`.
