---
description: Every tool in the Player set with its description and parameters. Generated from the tool catalog.
---

<!-- Generated from the tool catalog by packages/mcp-server/src/tool-reference.ts. Do not edit by hand: run `npm run docs:tools` after changing a tool. CI fails when this page is stale. -->

# Player tools

A player's own read-only view: their character sheet, what their next level grants, and short passages from the books their Foundry user can see. Served only on /mcp/player, never on stdio. Part of the [tool reference](../tools.md); [Tool sets](../TOOL-SETS.md) explains how Claude Desktop loads the sets. Claude Desktop entry: `none (served on /mcp/player only)`.

## get-my-character

Your own character sheet(s): abilities, class and level, hit points, proficiencies, spells, features and inventory. Only characters you own. Read-only.

Kind: read-only. Title: Get my character.

Parameters:

- `name` (string)

## get-my-level-up-options

Advice only, changes nothing: what your next class level grants and the choices still open (hit points, ASI or feat, subclass, spells). Only your own characters.

Kind: read-only. Title: Get my level-up options.

Parameters:

- `name` (string)
- `className` (string)

## search-books

Search the rulebooks you can read for a rule or term. Returns short excerpts; open one with get-book-entry.

Kind: read-only. Title: Search the books.

Parameters:

- `query` (string, required)
- `limit` (integer): Results, 1 to 10 (default 5).

## find-book-entries

Find entries by name or type (classes, species, backgrounds, feats, spells, items) for building a character. Open one with get-book-entry.

Kind: read-only. Title: Find book entries.

Parameters:

- `query` (string)
- `type` (string)
- `limit` (integer): Results, 1 to 20 (default 10).

## get-book-entry

One book entry with its description (cut at about 6,000 characters). Use the packId and entryId from search-books or find-book-entries.

Kind: read-only. Title: Get a book entry.

Parameters:

- `packId` (string, required)
- `entryId` (string, required)
