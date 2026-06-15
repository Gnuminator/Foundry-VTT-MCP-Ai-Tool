# Brand brief — Foundry AI Tool

This is a **ready-to-paste prompt** for Claude's design tool (claude.ai → Design / artifacts). It
generates the visual identity the README has slots for. Paste §"Prompt" as-is, or tweak the
bracketed choices first. When you get assets back, drop them in `docs/images/brand/` and uncomment
the banner/logo slots in `README.md`.

---

## Context (for you, the human — trim before pasting if you like)

- **Product:** Foundry AI Tool — gives AI models live access to a Foundry VTT game, plus a real-time
  browser "co-GM dashboard" that watches the table and lets you run it.
- **Audience:** tabletop RPG GMs (D&D 5e) who are technical enough to install a module + run Node.
- **Personality:** sharp, capable, a little arcane. A "command center for your table" — competent and
  modern, not cutesy, not corporate. Think mission-control meets spellbook.
- **Existing visual language:** the dashboard is a **dark "Modern Command Center"** UI. The brand
  should sit on top of that look, not fight it.

### Palette (taken from the live dashboard — keep the brand consistent with it)

| Role                 | Hex                   | Use                              |
| -------------------- | --------------------- | -------------------------------- |
| Background           | `#0f1115`             | near-black base                  |
| Panel                | `#171a21` / `#1d212b` | raised surfaces                  |
| Hairline             | `#272c38`             | borders                          |
| Text                 | `#e6e9ef`             | primary text                     |
| Muted                | `#9aa3b2`             | secondary text                   |
| Accent — arcane blue | `#4ea1ff`             | primary brand accent (PC/active) |
| Signal — green       | `#46c46a`             | healthy / success                |
| Signal — amber       | `#e0a106`             | caution / conditions             |
| Signal — red         | `#ff6b6b` / `#e63946` | enemy / destructive              |
| Foundry orange       | `#fe6a1f`             | nods to Foundry VTT              |

Suggested primary accent: **arcane blue `#4ea1ff`** with a thin **Foundry-orange `#fe6a1f`** as a
secondary spark. (Swap if you prefer orange-led.)

---

## Prompt (paste this into Claude's design tool)

> Design a small brand identity for an open-source developer tool called **"Foundry AI Tool"** — it
> gives AI models live access to a Foundry VTT tabletop RPG game and provides a real-time browser
> "co-GM dashboard." The vibe is a **dark, modern command center meets arcane spellbook**: sharp,
> capable, a little mystical, never cutesy or corporate. Target users are technical Dungeon Masters.
>
> Use this dark palette (match the existing app): background `#0f1115`, surfaces `#171a21`/`#1d212b`,
> text `#e6e9ef`, muted `#9aa3b2`. **Primary accent: arcane blue `#4ea1ff`**; secondary spark:
> **Foundry orange `#fe6a1f`**; signal colors green `#46c46a` / amber `#e0a106` / red `#e63946`.
>
> Produce, as clean exportable assets:
>
> 1. **A logo / app mark** — a compact, geometric glyph that reads at 32px (favicon-safe) and scales
>    up cleanly. Lean into one idea: e.g. an arcane sigil / rune fused with a circuit node, or a d20
>    silhouette merged with a signal/AI motif. **Flat or subtle-gradient SVG**, no photoreal, no heavy
>    drop shadows. Provide it on both dark and transparent backgrounds.
> 2. **A horizontal wordmark** — "Foundry AI Tool" set in a confident geometric/grotesk sans
>    (or a tasteful display face), with the mark to its left. Provide light-on-dark and a mono version.
> 3. **A GitHub README hero banner** — **1280×400px** (also export **2560×800 @2x**). Dark background,
>    the wordmark + mark, the tagline _"Live AI access to your Foundry VTT game — and a real-time
>    co-GM dashboard,"_ and a faint command-center/grid or arcane-circuit texture. Leave breathing room;
>    it must look good scaled down to README width.
> 4. **A favicon** — 32×32 and 16×16, derived from the app mark, legible at tiny size.
>
> Deliver SVGs for the logo/wordmark and PNGs for the banner + favicon, plus the final hex palette and
> the font name(s) used. Keep it cohesive — one mark, one type system, one accent.

---

## Where the assets go

Save the exports here, then wire them into the README:

```
docs/images/brand/
  logo.svg            # app mark (transparent)
  logo-dark.svg       # app mark on dark
  wordmark.svg        # horizontal logo + name
  banner.png          # 1280×400 README hero  (banner@2x.png optional)
  favicon-32.png      favicon-16.png
```

Then in `README.md`, replace the `BRAND SLOT` comment at the top with:

```html
<p align="center"><img src="docs/images/brand/banner.png" alt="Foundry AI Tool" width="100%" /></p>
```

(Optional) add the favicon to any future showcase site `<head>`.

## Notes

- Keep the logo **simple** — it has to survive a 16px favicon and a monochrome GitHub render.
- Don't use the actual Foundry VTT logo/trademark; an orange _nod_ is fine, a copy is not.
- If you want motion later (Phase 7 also wants a 10–15s demo GIF), that's a separate capture from the
  running app — see `docs/PHASE7-PLAN.md` §2-B.
