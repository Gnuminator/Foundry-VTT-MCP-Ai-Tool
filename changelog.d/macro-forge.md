### Tools

- **Macro forge (`plan-macro`):** the AI can plan a script macro for the GM. The plan shows the full source and a plain-English summary, the macro is created GM-only and flagged, and undo deletes it. It sits behind its own off-by-default switch "AI Tool: Macro forge (writes)". The source is scanned when planned and again when applied: no network, browser storage, window or document, other pages, `eval`, module loading or computed member names. A plan can never edit a macro's script or owners (I-189).
