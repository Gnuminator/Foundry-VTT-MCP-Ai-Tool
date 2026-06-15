# Brand brief — Foundry AI Tool

A concrete, paste-ready kit for generating the project's visual identity in **Claude's Design tool**
(claude.ai). It commits to **one specific concept** and walks you through it in **focused passes** —
that's what produces a coherent, ownable result instead of generic clip-art. Don't paste it all at
once; go pass by pass and iterate.

---

## How to use this (read first)

**Where to start in the Design tool.** You do **not** need to upload any file — every asset is generated
from the text brief below. The goal is just to reach a **blank design chat** and paste Pass 0:

- **Simplest:** a plain new design chat / project (a "Design System" project works fine — it'll treat
  this brief as its system). If you already opened one and pasted Pass 0, **just stay there.**
- The **"Start anywhere — Add a file and design"** tile asks you to **upload a seed file first** — skip
  it for a from-scratch logo (you have nothing to seed it with). _Optional:_ if a tile insists on a file,
  upload `docs/images/cogm/overview.png` (your dashboard screenshot) purely as a color/vibe reference.
- _Don't_ use Slides / Prototype / Product wireframe / Doc (decks, clickable UI, lo-fi screens,
  documents). The **Animation — Motion & video** tile is for the demo later (see §6).

**Where to paste.** Once the blank canvas opens, paste each prompt below into the **chat / "describe
what you want" message box** (the compose field where you talk to the design model), one pass at a
time. Send Pass 0 first to set the brief, then Pass 1, etc. After each result:

> **Heads-up:** after Pass 0 the model will reply with something like _"brief locked — ready, send me
> the first asset."_ That means **"paste your next prompt (Pass 1)"** — it is **not** asking you to
> upload a file. Just paste Pass 1 into the same box and hit Send. (If it ever literally asks for an
> upload, reply: _"I'm not uploading anything — generate it from the brief."_)

- **Iterate in the same thread** with short nudges: _"simpler — fewer internal lines,"_ _"show it at
  16px next to the full size,"_ _"more negative space,"_ _"make the active node glow softer,"_ _"tighten
  the letter-spacing."_ Two or three rounds per asset beats one big ask.
- **Export** when happy: download the **mark/wordmark as SVG** and the **banner/favicon as PNG**
  (use the canvas's export/download control). Ask explicitly: _"export this as an SVG"_ /
  _"export at 2560×800 PNG."_

**Where the results go** in this repo — see §5. (TL;DR: `docs/images/brand/`, then uncomment the
banner slot in `README.md`.)

---

## The concept — "Arcane Node"

> One idea, committed: **a hex-bound sigil that doubles as a network node.** The hexagon nods to VTT
> map grids and to a containment/summoning glyph; the lines inside read as both a rune and a circuit/
> node graph; a single node lights up — the "AI" spark coming alive inside the table. Command center
> meets spellbook, in one mark. Monoline, geometric, crisp, mostly dark.

**Why this works:** it's distinct (not a robot head, brain-circuit, or dice-with-a-face cliché),
it survives a 16px favicon (a hexagon + one glowing node), and it ties straight to the dashboard's
dark "command center" UI.

_(Alternative direction if you dislike the hex: a **low-poly d20 rendered as a wireframe/constellation**
with one glowing vertex as the AI node. Same palette, same rules. Pick one and commit — don't blend.)_

### Palette (match the live dashboard exactly)

| Role                                 | Hex                               | Where it goes                                                      |
| ------------------------------------ | --------------------------------- | ------------------------------------------------------------------ |
| Base / canvas                        | `#0f1115`                         | the dark background everything sits on                             |
| Surface                              | `#171a21` / `#1d212b`             | any raised panels/cards                                            |
| Line / structure                     | `#e6e9ef` at ~70–85%              | the hex outline + inactive glyph lines (off-white, not pure white) |
| Muted                                | `#9aa3b2`                         | secondary text, faint grid                                         |
| **Primary accent — arcane blue**     | `#4ea1ff`                         | the **active node** + its glow; the "AI" in the wordmark           |
| **Secondary spark — Foundry orange** | `#fe6a1f`                         | exactly **one** small accent (one edge or one node). Use sparingly |
| Signal greens/ambers/reds            | `#46c46a` / `#e0a106` / `#e63946` | _not_ for the logo — reserved for the app UI                       |

Accent rule: **arcane blue leads; orange is a single spark.** Never a rainbow.

### Typography

- **Wordmark:** **Space Grotesk** (primary pick — geometric, technical, a little characterful).
  Alternatives: **Sora** or **Chakra Petch** (more "arcane-techno"). Medium/Semibold weight, slightly
  open letter-spacing (~+2%). Set **"AI"** in arcane blue `#4ea1ff` (or a heavier weight) so the hook
  reads; "Foundry" and "Tool" in off-white `#e6e9ef`.
- **Tagline / technical bits:** a mono — **Space Mono** or **JetBrains Mono** — small, muted `#9aa3b2`,
  for that command-line/console feel.

### Hard rules (do / don't)

- **Do:** flat / monoline (consistent ~2–2.5px stroke at base), geometric, one glowing accent, generous
  dark negative space, legible when tiny.
- **Don't:** robot/android faces, brain-with-circuits, glowing-swirl "AI" tropes, a literal die with a
  face, parchment/skeuomorphism, drop shadows, busy gradients, or copying the real **Foundry VTT**
  logo/trademark (an orange _nod_ is fine; a copy is not).

---

## Pass 0 — set the brief (paste this first)

> You are my brand designer. We're building one cohesive identity for an open-source developer tool,
> **"Foundry AI Tool"** — it gives AI models live, GM-controlled access to a Foundry VTT tabletop RPG
> game, plus a real-time browser "co-GM dashboard." Audience: technically-minded Dungeon Masters (D&D
> 5e). Personality: **dark modern command center meets arcane spellbook** — sharp, capable, a little
> mystical; never cute, corporate, or sci-fi-kitsch.
>
> The single committed concept is **"Arcane Node": a hex-bound sigil that doubles as a network node** —
> a hexagon containing a minimal angular glyph (like a small summoning diagram / constellation) where
> one node lights up as the "AI" spark.
>
> Palette, on a near-black `#0f1115` base: structure lines in off-white `#e6e9ef` (~80%), **primary
> accent arcane blue `#4ea1ff`** for the active node + glow, and **one** small **Foundry-orange
> `#fe6a1f`** spark. Wordmark type: **Space Grotesk**, with the letters **"AI"** in arcane blue. Tagline
> type: a mono (Space Mono / JetBrains Mono), muted `#9aa3b2`.
>
> Style: **flat, monoline, geometric, lots of dark negative space, no drop shadows, no gradients beyond
> a soft node glow, no AI/robot clichés.** Confirm you've captured the brief in your own words, then
> stop and wait — **I'll paste the next instruction (Pass 1) myself. Don't ask me to upload anything;
> generate every asset from this brief.**

## Pass 1 — the app mark (logo glyph)

> Design just the **app mark** now. A **flat-top hexagon outline** (stroke, not filled) containing a
> minimal node-graph glyph: **3 nodes** connected by **2–3 straight segments** forming a clean angular
> rune. The **top/apex node is "active"** — a filled arcane-blue `#4ea1ff` dot with a **soft circular
> glow**; the other nodes are small off-white `#e6e9ef` rings. Accent exactly **one** segment or node in
> Foundry orange `#fe6a1f`. Monoline ~2px stroke, rounded line joins, perfectly centered, on a dark
> `#0f1115` square.
>
> Show it three ways side by side: **large (256px)**, **small (32px)**, and **tiny (16px)** — it must
> stay legible at 16px, so if 3 nodes are too busy at that size, simplify to the hexagon + the one
> glowing node. Also give me a version on a **transparent** background. Keep iterating with me until the
> 16px version is crisp.

## Pass 2 — the wordmark + lockup

> Now the **wordmark**. Set **"Foundry AI Tool"** in **Space Grotesk Semibold**, ~+2% letter-spacing,
> with **"AI" in arcane blue `#4ea1ff`** and the rest in off-white `#e6e9ef`. Build the **horizontal
> lockup**: the Pass-1 mark on the left, optically balanced with the wordmark to its right, on a dark
> `#0f1115` field. Provide: (a) the horizontal lockup, (b) a **stacked** version (mark above wordmark)
> for square spaces, and (c) a **monochrome off-white** version for single-color use. Keep the spacing
> and the cap-height alignment tight.

## Pass 3 — the GitHub README hero banner

> Now a **README hero banner**, **1280×400px** (also export **2560×800 @2x**). Layout: on the **left
> third**, the horizontal lockup from Pass 2, with the tagline beneath it in muted mono `#9aa3b2`:
> **"Live AI access to your Foundry VTT game — and a real-time co-GM dashboard."** Fill the **right two
> thirds** with an atmospheric field: a faint **hex-grid that dissolves into a node/constellation
> network**, a few **arcane-blue glowing nodes** linked by thin lines (like a tactical map meeting a
> star chart), over the near-black `#0f1115` base with a **soft blue radial glow** from one side. Keep
> ~80px safe padding and lots of negative space — it has to still read when scaled down to ~900px README
> width. One orange spark somewhere, no more.

## Pass 4 — the favicon

> Finally, a **favicon** derived from the mark: the **hexagon + the single glowing arcane-blue node**,
> simplified for clarity. Export **32×32** and **16×16 PNG** on transparent and on `#0f1115`. Confirm
> it's still recognizable at 16px.

---

## 5. Where the results go (in this repo)

Save the exports here:

```
docs/images/brand/
  logo.svg            ← Pass 1, transparent app mark
  logo-dark.svg       ← Pass 1, on #0f1115 (optional)
  wordmark.svg        ← Pass 2, horizontal lockup
  wordmark-stacked.svg← Pass 2, stacked (optional)
  banner.png          ← Pass 3, 1280×400   (+ banner@2x.png for 2560×800)
  favicon-32.png  favicon-16.png   ← Pass 4
```

Then wire the banner into the README: open `README.md` and **replace the `BRAND SLOT` comment block at
the very top** with:

```html
<p align="center"><img src="docs/images/brand/banner.png" alt="Foundry AI Tool" width="100%" /></p>
```

(Ping me and I'll wire the banner + favicon in for you once the files are in `docs/images/brand/`.)

---

## 6. Motion — the animated brand pieces (Animation tile)

Same approach as the image passes: **one committed concept, broken into timed beats, with concrete
motion direction.** Two real-vs-designed things to keep straight first:

- **Designed motion** (polished brand, built in the **Animation — Motion & video** tile): an **Ignition**
  logo reveal and a **feature sizzle** built from the dashboard screenshots. **For now this is the
  README's demo** — export the sizzle as a looping GIF (see the export spec at the end of §6). Buildable
  today, no live app needed.
- **A real demo capture** (authentic — the actual app running): a 10–15s screen recording of Foundry +
  the dashboard during combat, recorded on your machine (OBS Studio / ShareX / Xbox Game Bar).
  **Deferred — not until after Phases 7–8.** When you have it, it _replaces_ the designed GIF in the
  README; I'll write you a shot-list then (`docs/PHASE7-PLAN.md` §2-B).

### How to use

Open the **Animation — Motion & video** tile. **First import your finished brand assets** into that
canvas — `docs/images/brand/logo.svg`, `wordmark.svg`, and for the sizzle the screenshots in
`docs/images/cogm/` — so it animates the real marks, not redrawn approximations. Then paste **Motion 0**
to set the brief, then **Motion A**, iterate, and only then **Motion B** (it reuses A's opening).

> **Reality check on motion clichés.** The whole point is _restraint_. If a result feels like a crypto
> ad — fast whooshes, neon bloom, spinning, bouncy overshoot, lens flares — push back hard: _"slower,
> calmer, no whoosh, ease in-out only, the glow is the only effect."_

> **GitHub note.** A README can't autoplay an MP4, but it **does autoplay & loop a GIF inline** — so
> export the **feature sizzle (Motion B)** as a looping GIF and that becomes the README's demo for now.
> Keep the MP4 too for a showcase site / social / the repo's social-preview image.

---

### Motion 0 — set the motion brief (paste first)

> You're now animating an existing brand, "Foundry AI Tool" (a dark "command center meets arcane
> spellbook" identity for an AI-driven Foundry VTT tool). I've imported the mark and wordmark. Palette
> on a near-black `#0f1115` base: structure off-white `#e6e9ef`, **primary accent arcane blue
> `#4ea1ff`** (the glowing "active node"), one small **Foundry-orange `#fe6a1f`** spark; wordmark in
> Space Grotesk with "AI" in blue; any captions in a muted mono (`#9aa3b2`).
>
> **Motion principles, hold to these:** calm, precise, premium. **Cubic ease-in-out only — no overshoot,
> no bounce, no motion blur, no whoosh/swoosh, no lens flare, no fast zoom-punches.** Deliberate timing.
> **The node glow is the only "effect."** Think a high-end instrument booting up, not an ad. Confirm,
> then wait — I'll send each scene.

### Motion A — "Ignition" logo reveal (~8s)

> Animate an **8-second logo reveal**, 1920×1080 (also export 1280×720), 30fps, on `#0f1115`. Concept:
> the sigil is **inscribed**, then the AI node **comes online**. Beat sheet (timecodes):
>
> - **0.0–0.6s** — black; a faint hex grid fades up to ~12% across the frame (the "table").
> - **0.6–2.6s** — the **hexagon outline draws on** as one continuous stroke (stroke-dashoffset draw),
>   off-white, ease-in-out; it settles gently as it closes.
> - **2.2–3.6s** — the **inner glyph lines draw on**, node to node (the rune being inscribed); inactive
>   nodes appear as small off-white rings.
> - **3.6–4.2s** — a held **beat of stillness** on the unlit sigil. (Don't skip this — the pause sells it.)
> - **4.2–5.0s** — **IGNITION** (the hero moment): the apex node fills **arcane blue `#4ea1ff`** and a
>   **soft radial glow blooms** outward (scale + fade), one quick **orange `#fe6a1f` spark** flicks on the
>   accent edge, and a subtle pulse of light travels along the connecting lines once.
> - **5.0–6.6s** — the **wordmark resolves** to the right of the mark via a left-to-right mask wipe
>   (Space Grotesk); **"AI" tints blue a beat after** the rest.
> - **6.0–6.8s** — the **tagline** fades in beneath in muted mono: _"Live AI access to your Foundry VTT
>   game."_
> - **6.8–8.0s** — hold the full lockup; the node glow **breathes once**, then a slow fade to black.
>
> Also produce a **3-second seamless loop** of just the ignition + glow-breath (4.2–6.6s eased back to
> start) for a badge/hero loop. Export **MP4 (H.264)** + a **looping GIF** of the 3s loop; if possible a
> **transparent-background WebM** of the mark animation alone (for overlaying on a site).

### Motion B — "The Table, Live" feature sizzle (~16s)

> Now a **16-second feature sizzle**, 1920×1080, 30fps, on `#0f1115`. Use my imported dashboard
> screenshots as the content, each framed inside the dark brand world (thin `#272c38` hairline frame,
> generous dark margin). Rhythm ~3s per feature, **cross-dissolves not hard cuts**, a slow ≤5% Ken-Burns
> scale on each still — no spinning, no zoom-punches. Beat sheet:
>
> - **0.0–2.0s** — a compressed version of the **Ignition** mark; then the lockup shrinks to a small
>   bottom-corner watermark and stays.
> - **2.0–5.0s** — `overview.png` eases in; mono caption types in lower-left: **"Live combat tracker"**,
>   a thin **blue underline draws** beneath it.
> - **5.0–8.0s** — `combat-control.png`; caption **"Run the game from the dashboard"**; a soft blue
>   highlight ring pulses once over the multi-select area.
> - **8.0–11.0s** — `tool-runner.png`; caption **"Every Foundry tool, one form"**.
> - **11.0–14.0s** — `confirm.png`; caption **"Safe by default — confirm before you act"**. _(Swap in a
>   `/player` screenshot when it exists: **"Player view — server-filtered"**.)_
> - **14.0–16.0s** — stills cross-dissolve back to the **centered lockup + tagline**, with a final mono
>   call-to-action line: **`github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool`**; hold, slow fade.
>
> Captions: muted mono `#9aa3b2`, the keyword tinted blue. Keep one orange spark total across the whole
> piece. Export **MP4** + a **muted ≤15s version** suitable for autoplay on a site/social.

**Audio (optional):** a low, quiet drone bed + a single soft "power-up" chime exactly on the 4.2s
ignition; otherwise silent (site/README playback is muted anyway).

**Where it goes:** export **Motion B as a looping, README-optimized GIF → `docs/images/brand/demo.gif`**
— **this is the README demo for now** (GitHub autoplays & loops it; there's a marked DEMO SLOT in the
README). Also keep the MP4 for a site / social, and export a **still frame of the lit lockup** for the
repo's **Settings → Social preview** image. Swap the GIF for a real screen-capture once you have one
(post Phase 8).

> **README GIF export spec.** ~1200–1280px wide, **loop forever**, target **≤ ~6 MB** (GitHub gets
> sluggish above that). The Animation tile likely exports MP4 — convert to an optimized GIF with
> **gifski** (`gifski --fps 20 --width 1200 -o demo.gif in.mp4`), ffmpeg, or ezgif.com, dialing fps
> (15–20) and colors down until it fits the budget. Ping me and I'll wire `demo.gif` into the README
> DEMO SLOT for you.

---

## Notes

- Keep the **mark dead simple** — it must survive a 16px favicon and a monochrome render.
- Generate **one pass at a time** and iterate; that is the single biggest lever on quality.
- If a result feels generic, push back with specifics ("too symmetrical," "the glow is too strong,"
  "lose one node") rather than re-rolling the whole thing.
