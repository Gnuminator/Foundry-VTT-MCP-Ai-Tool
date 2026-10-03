# Credits

This project was forked from [adambdooley/foundry-vtt-mcp](https://github.com/adambdooley/foundry-vtt-mcp)
(MIT license) at commit dba53ec (2026-06-07). The `packages/mcp-server` and `packages/foundry-module`
packages are derived from that upstream work and remain subject to Adam Dooley's original copyright.

`packages/cogm-dashboard` — the co-GM control surface and live session dashboard — is original work
by Gnuminator, written from scratch and not derived from the upstream repository.

`tools/session-pipeline/src/session_pipeline/merge.py` adapts the interleaving approach of
[TASMAS](https://github.com/KaddaOK/TASMAS) (MIT license, Copyright (c) 2024 Kadda OK); the full
notice is in `tools/session-pipeline/README.md`.

`tools/session-pipeline/src/session_pipeline/data/words_da.txt` and `words_en.txt` (the ordinary-word
lists that guard the automatic name fix) are derived from the Leipzig Corpora Collection
(Universitaet Leipzig), <https://wortschatz.uni-leipzig.de/en/download>, corpora `dan_news_2020_100K` and
`eng_news_2020_100K`, licensed under Creative Commons Attribution 4.0 International (CC BY 4.0). Changes:
only lower-case words of 4 or more letters, the top 30,000 (Danish) and 10,000 (English) by frequency.
Cite: D. Goldhahn, T. Eckart, U. Quasthoff, "Building Large Monolingual Dictionaries at the Leipzig
Corpora Collection: From 100 to 200 Languages", LREC 2012.
