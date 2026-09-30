"""Rebuild the ordinary-word lists in ``src/session_pipeline/data``.

The lists are top-N word lists derived from the Leipzig Corpora Collection (CC BY 4.0) news
corpora ``dan_news_2020_100K`` and ``eng_news_2020_100K``. This script downloads nothing: fetch and
unpack the two ``*.tar.gz`` from https://wortschatz.uni-leipzig.de/en/download first, then

    python scripts/build_wordlists.py <folder with the unpacked dan_ and eng_ folders>

Only words written in lower case in the corpus count (that leaves out most proper names), at least
4 letters long (shorter words are never auto-fixed), ranked by corpus frequency.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HEADER = """\
# Ordinary {language} words: the {n} most frequent lower-case words of at least 4 letters
# in the Leipzig Corpora Collection corpus {corpus}, ordered by frequency (most frequent first).
# Source: https://wortschatz.uni-leipzig.de/en/download
# Licence: Creative Commons Attribution 4.0 International (CC BY 4.0),
#   https://creativecommons.org/licenses/by/4.0/ . This file is a derived list; you may use it
#   under the same licence, with the attribution below.
# Attribution: Leipzig Corpora Collection (Universitaet Leipzig). D. Goldhahn, T. Eckart,
#   U. Quasthoff: Building Large Monolingual Dictionaries at the Leipzig Corpora Collection:
#   From 100 to 200 Languages. LREC 2012.
# Changes: filtered to lower-case alphabetic words of 4+ letters, cut to the top {n}.
# Built by tools/session-pipeline/scripts/build_wordlists.py
"""

LISTS = {
    "da": ("Danish", "dan_news_2020_100K", 30000, re.compile(r"^[a-zæøåéèüöäëï]{4,}$")),
    "en": ("English", "eng_news_2020_100K", 10000, re.compile(r"^[a-z]{4,}$")),
}


def build(src: Path, out: Path) -> None:
    for code, (language, corpus, n, rx) in LISTS.items():
        rows = []
        for line in (src / corpus / f"{corpus}-words.txt").read_text(encoding="utf-8").splitlines():
            parts = line.split("\t")
            if len(parts) == 3 and rx.match(parts[1]):
                rows.append((parts[1], int(parts[2])))
        words: list[str] = []
        seen: set[str] = set()
        for w, _c in sorted(rows, key=lambda r: -r[1]):
            if w not in seen:
                seen.add(w)
                words.append(w)
        words = words[:n]
        (out / f"words_{code}.txt").write_text(
            HEADER.format(language=language, n=len(words), corpus=corpus) + "\n".join(words) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(f"{code}: {len(words)} words")


if __name__ == "__main__":
    build(Path(sys.argv[1]), Path(__file__).resolve().parents[1] / "src" / "session_pipeline" / "data")
