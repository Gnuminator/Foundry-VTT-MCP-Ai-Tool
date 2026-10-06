# Foundry AI Tool: Obsidian plugin

A small desktop plugin for the GM's Obsidian vault (idea I-059, `docs/design/OBSIDIAN-PLAN.md`
section 10, P1). It talks only to the dashboard, never to Foundry or the bridge directly.

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

- **Theme** (I-099): the whole vault in the dashboard's look, **Neutral** or **The Veil**, one
  theme per world shared with the dashboard (`GET /api/theme`, `POST /api/control` `set-theme`).
  A pick here sets the dashboard's theme; a pick in the dashboard reaches Obsidian within 30
  seconds; **Off** turns the styling off here only. The styles key on the note's front-matter
  `type` (as `aitool-type-<type>` on the view) and on the callouts the tool writes
  (`[!statblock]`, `[!secret]`, `[!info]`, `[!quote]`), never on folders. In reading view the
  plugin also turns a session's stats line into cards and the d20 spread into bars.

- **Graph colours** (I-105): the command and settings button **Apply AI Tool graph colours**
  gives each adventure its own colour in the graph view (the hub note under
  `AI Tool/Foundry/Adventures/` plus the folders it lists) and colours the Library grey. It
  merges into the vault's `graph.json`: your own colour groups stay first and keep winning, the
  tool's groups are replaced on every run, and a colour you change for one of them is kept.
  The mirror itself never edits `.obsidian`; this runs only when you press it. Open graph views
  reload in place (sidebar, split and pin kept) with the new colours. A local graph keeps its
  own colour groups.

Settings: the dashboard address (default `http://localhost:3000`), the theme and, only when the
dashboard's player split is on, the GM token, kept in Obsidian's secret storage. For a dashboard
behind Cloudflare Access (the Pi, D-094 R1), a service token's Client ID and Client Secret, also in
secret storage, sent as `CF-Access-Client-Id` and `CF-Access-Client-Secret` to https addresses
only; the GM token then gives the GM role. GM steps: [docs/gm/obsidian.md](../../docs/gm/obsidian.md).

The theme CSS is `theme/obsidian-theme.css`; the build inlines the dashboard's OFL fonts
(`packages/cogm-dashboard/public/fonts`) into `dist/styles.css`, writes `dist/FONT-LICENSES.txt`,
and writes `dist/snippets/aitool-theme-neutral.css` and `aitool-theme-veil.css`: the same theme
without the plugin, for a vault that has no plugin (the player vault). A snippet goes into the
vault's `.obsidian/snippets` folder and is switched on under Settings, Appearance, CSS snippets.

Install: `pwsh scripts/install-obsidian-plugin.ps1 -Vault <vault folder>` (builds and copies), or
`-From foundry-ai-tool-obsidian.zip` from a release. The GM's guide is the "Open in Obsidian" part of `docs/gm/dashboard.md`.

Code: `src/dashboard.ts` (the dashboard client, no `obsidian` import), `src/note.ts` (frontmatter
and status text), `src/theme.ts` and `src/theme-sync.ts` (theme classes and the shared theme), `src/graph-colours.ts` (the graph
colour groups and the graph.json merge),
`src/main.ts` (the Obsidian glue), `theme/build-css.mjs` (the CSS build). `npm run build -w @gnuminator/obsidian-plugin`
writes `dist/`.
