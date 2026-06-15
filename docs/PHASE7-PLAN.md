# Phase 7 — Presentation (plan & scope)

> **Goal (from DETACH-PLAN Phase 7):** turn a working tool into something that _presents_ well —
> a polished GitHub landing README with branding + a short demo capture, and a standalone showcase
> page/site. In-app visual polish is a "given but later." **Mobile/tablet stays deferred** per the
> priority rule. Do this now that the functionality (incl. Phase 6) is in.

---

## 1. Where we're starting (current state)

Better than the original plan assumed — there's real material already:

| Asset                        | State                                                                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root `README.md` (147 lines) | Rebranded to "Foundry AI Tool"; has a one-liner, feature list, an MCP-tools table, install steps, attribution, and **5 embedded screenshots**. Solid bones. |
| `docs/COGM-DASHBOARD.md`     | A good narrative showcase of the dashboard with the same screenshots.                                                                                       |
| `docs/images/cogm/*.png`     | `overview`, `combat-control`, `tool-runner`, `confirm`, `mobile` — real screenshots.                                                                        |
| Branding                     | None beyond text — no logo, wordmark, banner, color palette, or badges.                                                                                     |
| Demo motion                  | None — static screenshots only; no GIF/video.                                                                                                               |
| Standalone site              | None.                                                                                                                                                       |

**Gap to "presents well":** branding/visual identity, a hero banner, status/license/version badges, a
short **demo GIF/video**, a tighter visual hierarchy, coverage of the **new Phase 6 capabilities**
(standalone bridge, remote access, player/GM split — none are in the README yet), and an optional
**showcase site**.

---

## 2. Deliverables — split by what blocks them

### A. Buildable now (no new assets, no external infra)

1. **Landing README redesign.** Hero section, badges (license, release, CI, Foundry version), a
   crisp value proposition, a "three parts" diagram, a feature grid reusing existing screenshots,
   and a new **Phase 6 section** (standalone bridge, remote access via Cloudflare, player/GM split).
   Keep the install steps + attribution. (Replaces/augments the current README in place.)
2. **Showcase site scaffold.** A single static page (`site/index.html` + CSS, no build step) suitable
   for **GitHub Pages**, reusing the existing screenshots, with a demo-embed placeholder. Self-contained;
   deploy is a later toggle (GitHub Pages from `/docs` or a `site/` branch).
3. **A simple SVG wordmark/logo** (if wanted) — generatable inline, no external designer.

### B. Needs assets (a capture step — partly user-driven)

4. **Demo motion.** Two-stage:
   - **Interim (buildable now):** a **designed feature sizzle** from the Animation tile (built from the
     existing screenshots, no live app), exported as a **looping GIF → `docs/images/brand/demo.gif`** in
     the README's DEMO SLOT. GitHub autoplays/loops GIFs inline. See `docs/BRAND-BRIEF.md` §6 (Motion B).
   - **Real screen-capture (deferred — after Phases 7–8):** a 10–15s recording of the live app
     (Foundry + bridge + dashboard) from a shot-list I'll write; it _replaces_ the designed GIF when
     ready. Recording is user-driven (OBS / ShareX).
5. **Refreshed screenshots** if the UI has changed since the current ones (e.g. to show the `/player`
   view). Optional; the existing set is still representative.

### C. Needs decisions (yours — see §4)

6. **Brand identity** — name treatment, logo/wordmark, color palette, voice. Drives A1/A2/A3.
7. **Scope/hosting** — README-only, or README + a GitHub Pages site? If a site, where is it hosted.

### D. Deferred (explicitly later)

- **In-app visual polish** beyond the current "Modern Command Center" pass — a given, but after all
  functionality is in.
- **Mobile/tablet** — deferred per the priority rule (the responsive layout that came for free stays;
  no further investment yet).

---

## 3. Suggested task order

1. Lock the few decisions in §4.
2. README redesign (A1) — highest impact, fully buildable now.
3. Showcase site scaffold (A2) + wordmark (A3) — reuses the README content + screenshots.
4. Write the demo shot-list (B4); user records the GIF; drop it into README + site.
5. (Later) refreshed screenshots incl. `/player`; in-app polish; GitHub Pages deploy toggle.

Each step ends with the docs building/rendering cleanly (markdown + static HTML — no test suite, but
verify links/images resolve and the page renders).

---

### Decisions taken (2026‑06‑15)

- **Scope now:** redesign the landing README (done). Showcase site deferred.
- **Branding:** user drives it via Claude's design tool — see `docs/BRAND-BRIEF.md` (a ready-to-paste
  prompt). README has marked slots for the banner/logo; badges + screenshots carry it until then.
- **Demo motion:** static screenshots for now; a 10–15s GIF is a later pass (shot-list TBD).

## 4. Decisions to confirm before executing

1. **How far to take Phase 7 now** — just this plan, or also redesign the README, and/or scaffold the
   showcase site?
2. **Branding** — do you have a logo/wordmark/palette, or should I propose a minimal one (simple SVG
   wordmark + a 2–3 color palette derived from the dashboard's dark theme)?
3. **Demo asset** — you record a 10–15s GIF from a shot-list I write, or keep static screenshots for
   now and add motion later? (I cannot screen-record the live app from here.)
4. **Showcase site** — yes/no, and if yes, host on **GitHub Pages** (free, from the repo)?

---

## 5. Asset & deploy checklist (fill in as we go)

- [x] **Badges:** license, latest release, CI status, Foundry version, system — in the README hero
- [x] **README redesign merged** — hero, badges, three-parts, feature grid, Phase 6 section, docs index
- [x] **Brand brief written** (`docs/BRAND-BRIEF.md`) — prompt for the user to generate assets
- [ ] Brand assets generated (logo/wordmark SVG, hero banner) → drop in `docs/images/brand/`, uncomment the README slot
- [ ] Demo GIF (interim) — designed feature sizzle (Animation tile) → `docs/images/brand/demo.gif`, embedded in the README DEMO SLOT
- [ ] Real screen-capture demo — deferred until after Phases 7–8, then swap it in
- [ ] `/player` view screenshot (new in Phase 6)
- [ ] Showcase site scaffold (`site/`) — built (deferred)
- [ ] GitHub Pages enabled (if chosen) + custom domain (optional)
- [ ] Cross-link README ↔ site ↔ docs

> Nothing here touches the code or the green baseline — Phase 7 is docs/assets/site only.
