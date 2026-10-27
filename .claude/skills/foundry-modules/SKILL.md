---
name: foundry-modules
description: What each Foundry module in the Curse of Strahd world and the test kit does, where its UI is, the settings we use and why, how it interacts with the AI Tool, its Foundry 14 / dnd5e 6 gotchas and the keep-or-drop verdict. Use when a task touches a third-party module (changing its settings, adding or dropping it, writing a guide or kit scenario that names it, debugging a module error, deciding what to install for Danni), or when writing a new module reference page.
---

# Foundry modules: one verified page per module

Each module has a page in `references/<module-id>.md` (the id is the folder name in
`Data/modules`, which is also the id Foundry and the AI Tool use). The pages are written in our own
words from the module's README, its manifest and source on disk, and by driving it on a test
server. Foundry's own UI is `foundry-core-ui`; the test servers are `foundry-test-env`.

## Index

| Module id                 | Page                                    | Verdict  |
| ------------------------- | --------------------------------------- | -------- |
| `foundryvtt-actor-studio` | `references/foundryvtt-actor-studio.md` | see page |
| `ddb-importer`            | `references/ddb-importer.md`            | see page |
| `dnd-players-handbook`    | `references/dnd-players-handbook.md`    | see page |
| `token-action-hud-core`   | `references/token-action-hud-core.md`   | see page |
| `token-action-hud-dnd5e`  | `references/token-action-hud-dnd5e.md`  | see page |
| `dice-so-nice`            | `references/dice-so-nice.md`            | see page |
| `NotYourTurn`             | `references/NotYourTurn.md`             | see page |
| `automated-conditions-5e` | `references/automated-conditions-5e.md` | see page |
| `monks-player-settings`   | `references/monks-player-settings.md`   | see page |
| `vtta-tokenizer`          | `references/vtta-tokenizer.md`          | see page |
| `tarokka-reading`         | `references/tarokka-reading.md`         | see page |

Batches B and C add their own rows here after batch A merges. Batch E (after G0) adds the
candidates. `Dev/Foundry AI Tool/Backlog.md` in the vault lists the batches.

## Page format (follow it exactly; every page uses these headings in this order)

```markdown
# <Module title> (`<module-id>`)

Verified on Foundry <core version> / dnd5e <version>, module <version>, <YYYY-MM-DD>.
(or: Not verified live: <why>. Mark every unverified claim in place with "(not verified)".)

**Verdict: keep | drop | optional.** <one or two sentences why.>

**For Danni's guides:** <one line a guide can link or quote, plain words, no jargon.>

## What it does

## Where its UI is

## Settings we use and why

## How it interacts with the AI Tool

## Gotchas on Foundry 14 / dnd5e 6

## Sources
```

Rules for a page:

- Short and concrete: about one screen per section. Say what you saw, not what the README promises.
  A claim you did not click through gets "(not verified)" next to it.
- **Settings:** the setting's label as the client shows it, its key (`<module-id>.<key>`), the value
  we use and the reason. List only settings we set or that bite; do not transcribe the whole menu.
- **AI Tool:** name the tools or handlers that read or change what the module touches (for
  example a journal flag, an actor flag, an item activity), say whether our writes survive the
  module's own hooks, and whether the module needs `foundry-mcp-bridge` settings. "No interaction"
  is a valid answer; say so.
- **Gotchas:** version limits (`compatibility.verified`), conflicts with other modules, what breaks
  on a world without the module (data left behind), anything the Pi (Linux, headless) changes.
- **Sources:** the README or repo URL, the manifest path, and the source files you read. No book or
  campaign text anywhere (CLAUDE.md: nothing from licensed content in the public repo).
- Keep the title, the stamp line and the Verdict line exactly as above; the index row copies the
  verdict word.
- Public text reads human: no em dashes, no filler.

## Adding a module

1. Read its manifest, README and source in `C:\FoundryTest\data\Data\modules\<id>` (server B and C
   have their own copies under their data folders).
2. Take a test server through `scripts/test-env/lock.ps1 take -Server B` (or C), enable the module
   in the `ai-tool-test` world, drive it by hand in the browser pane, release the lock.
3. Write the page, add the index row, add a kit scenario under `scripts/test-kit/scenarios/` only
   where the module earns one (it changes something the AI Tool reads or writes, or it can break a
   kit run).
