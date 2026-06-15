# Brand brief — Foundry AI Tool

A concrete, paste-ready kit for generating the project's visual identity in **Claude's Design tool**
(claude.ai). It commits to **one specific concept** and walks you through it in **focused passes** —
that's what produces a coherent, ownable result instead of generic clip-art. Don't paste it all at
once; go pass by pass and iterate.

---

## How to use this (read first)

**Where to start in the Design tool.** On the **"Make something new"** screen, click the first tile —
**"Start anywhere — Add a file and design"** (the blank canvas). It is the right surface for logo/brand
graphics. _Don't_ use Slides / Prototype / Product wireframe / Doc (those are for decks, clickable UI,
lo-fi screens, and documents). The **Animation — Motion & video** tile is for the demo later (see §6).

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

## 6. Later — the demo motion piece (Animation tile)

You spotted the **Animation — Motion & video** tile. Two different things to keep straight:

- **A real demo capture** (authentic — the actual app running): a 10–15s screen recording of Foundry +
  the dashboard during combat. That is _not_ made in the Design tool — record it on your machine
  (OBS Studio / ShareX / Xbox Game Bar), then we optimize it to a GIF/MP4 and embed it. I'll write you a
  shot-list when you're ready (see `docs/PHASE7-PLAN.md` §2-B).
- **A stylized motion graphic** (polished — brand, not live footage): the **Animation** tile is great for
  an **animated logo reveal** or a short **feature montage** built from the brand + your screenshots.
  Use it for the top of a future showcase site or a social clip, _in addition to_ the real capture.

Starter prompt for the Animation tile (use it **after** the brand assets exist, and import the mark/
banner/screenshots into that canvas first):

> Make a **6–8 second animated logo reveal** for "Foundry AI Tool," 1280×720, dark `#0f1115`. Sequence:
> (1) faint **hex-grid** fades in; (2) thin lines **draw on** to form the Arcane-Node mark; (3) the apex
> node **ignites** in arcane blue `#4ea1ff` with a soft pulse + a single orange `#fe6a1f` spark;
> (4) the **"Foundry AI Tool"** wordmark types/fades in beside it (Space Grotesk, "AI" in blue);
> (5) hold, then a slow fade. Calm, precise, premium — easing in/out, no bouncy motion, no sci-fi
> whoosh. Export as MP4 (and a looping GIF if available).
>
> _(For a feature montage instead: import the dashboard screenshots from `docs/images/cogm/` and ask for
> a 12–15s sequence that pans/cross-fades between them with short blue-accented captions —
> "Live combat tracker," "AI co-GM," "Tool Runner," "Player view" — over the dark brand background.)_

---

## Notes

- Keep the **mark dead simple** — it must survive a 16px favicon and a monochrome render.
- Generate **one pass at a time** and iterate; that is the single biggest lever on quality.
- If a result feels generic, push back with specifics ("too symmetrical," "the glow is too strong,"
  "lose one node") rather than re-rolling the whole thing.
