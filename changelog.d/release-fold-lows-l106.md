### Tooling

- **Changelog fold files repeated headings under one:** `changelog:fold` now compares section headings
  by their base, so several `### Tooling (...)` fragments land under one `### Tooling`, and Testing, Test
  kit and Test environment land under `### Tests`. RELEASING also says to mention additive dashboard
  `/api/health` fields in the wire-contract line and to word the headline differently from the last
  release.
- **Orphan story baselines are caught:** the story shots (`stories.spec.ts`) now fail when a baseline
  PNG has no story that produces it; the leftover `components-combat-strip--combat-buttons-on.png` is deleted.
