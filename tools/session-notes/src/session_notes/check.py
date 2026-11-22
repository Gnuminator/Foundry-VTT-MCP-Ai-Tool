"""``Names and facts to check``: a page per language where a person settles the uncertain names.

After a notes run the session's ``notes/`` folder gets ``Names and facts to check.en.md`` and
``.da.md`` (D-151). One entry per uncertain name (words the recogniser scored under
``UNCERTAIN_BELOW``, spelling variants merged, with a count, timestamp links to the transcript and
a suggestion from ``names.txt``), plus a few facts where a hint disagrees with its owner (the
speaker roster against the transcript, a character that is not in the world's names list).

The reviewer writes one of three things after ``Answer:``: the right spelling, ``same as X`` or
``not a name`` (``samme som X`` and ``ikke et navn`` work too). The next run reads the answers
(``ingest``), keeps them in ``name-answers.json``, adds the names to ``names.txt``, the wrong
spellings to ``rules.json`` (the session pipeline's ``--rules`` file) and rewrites the transcript
lines before Claude sees them (``apply_answers``). Whoever answers first wins: an answer already
stored is never replaced by a later page.

Plain Markdown: the page works in Obsidian, and a text editor is enough to fill it in.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from .model import UNCERTAIN_BELOW, Line, apply_speakers, clock, is_gm, line_id, load_roster, load_timeline

PAGE = "Names and facts to check"
ANSWERS_FILE = "name-answers.json"
MAX_LINKS = 6
# Variants of one name: equal after dropping a final s, or this similar (short names must match).
SAME_NAME = 0.85
SUGGEST_FROM = 0.6
NAMES_MARK = "<!-- names -->"
FACTS_MARK = "<!-- facts -->"

# Used when the pipeline's word lists are not next to this package (an install without the repo).
_BUILTIN_ORDINARY = frozenset(
    """det jeg men eller for med der til som nej han hun vi de du ham hende den dem man her hvad hvor
    hvem hvis hvordan okay yeah hey ja nå så og at er en et i på af om ikke har kan vil skal bare ogsaa
    the and but you that this what with have not just yes well now then there they will can okay oh good
    wild rule fine like start hold side mest mit""".split()
)


def _load_ordinary() -> frozenset[str]:
    words: set[str] = set(_BUILTIN_ORDINARY)
    data = Path(__file__).resolve().parents[3] / "session-pipeline" / "src" / "session_pipeline" / "data"
    for lang in ("da", "en"):
        path = data / f"words_{lang}.txt"
        if path.exists():
            for raw in path.read_text(encoding="utf-8").splitlines():
                raw = raw.strip().lower()
                if raw and not raw.startswith("#"):
                    words.add(raw)
    return frozenset(words)


_ORDINARY: frozenset[str] | None = None


def ordinary() -> frozenset[str]:
    global _ORDINARY
    if _ORDINARY is None:
        _ORDINARY = _load_ordinary()
    return _ORDINARY


_EDGE = re.compile(r"^[^\w]+|[^\w]+$", re.UNICODE)


def _core(word: str) -> str:
    return _EDGE.sub("", word.strip())


@dataclass(slots=True)
class Heard:
    word: str
    line: str
    start: float


@dataclass(slots=True)
class Entry:
    kind: str  # "name" or "fact"
    key: str  # the heading, which is also how an answer finds its entry
    variants: list[str] = field(default_factory=list)  # spellings heard, most frequent first
    count: int = 0
    where: list[tuple[str, float]] = field(default_factory=list)  # (line id, start)
    suggestion: str = ""
    note_en: str = ""
    note_da: str = ""
    wrongs: list[str] = field(default_factory=list)  # what an answer replaces in the transcript


@dataclass(slots=True)
class Answer:
    kind: str  # "spelling", "same" or "not-name" (or "ok" for a fact left as it is)
    text: str  # what the reviewer wrote
    correct: str = ""
    wrongs: list[str] = field(default_factory=list)


@dataclass(slots=True)
class CheckReport:
    flagged: int = 0  # distinct uncertain words before merging (name-like)
    entries: int = 0  # name entries on the page
    facts: int = 0
    answered: int = 0
    new_answers: int = 0
    conflicts: list[str] = field(default_factory=list)
    corrected: list[str] = field(default_factory=list)  # an answer edited on the page after it was read
    unknown: list[str] = field(default_factory=list)  # an answer under a heading that is not on the list
    names_added: list[str] = field(default_factory=list)
    rules_added: int = 0


# --- collecting -----------------------------------------------------------------------------


def _known_names(session: Path, lines: list[Line]) -> list[str]:
    return load_roster(session, lines).names


def _name_tokens(names: list[str]) -> set[str]:
    out: set[str] = set()
    for name in names:
        out.add(name.casefold())
        out.update(t.casefold() for t in re.findall(r"\w+", name) if len(t) >= 3)
    return out


def raw_heard(session: Path) -> list[Heard]:
    """Name-like words under the probability limit, in timeline order (ids as ``load_timeline``)."""
    path = session / "timeline" / "timeline.jsonl"
    if not path.exists():
        return []
    names = _name_tokens(_known_names(session, []))
    out: list[Heard] = []
    n = 0
    with path.open(encoding="utf-8-sig") as fh:
        for raw in fh:
            raw = raw.strip()
            if not raw:
                continue
            n += 1
            row = json.loads(raw)
            prev = ""
            for i, w in enumerate(row.get("words") or []):
                token = str(w.get("word", "")).strip()
                core = _core(token)
                before = prev
                prev = token
                if w.get("probability", 1.0) >= UNCERTAIN_BELOW or len(core) < 3 or core.isdigit():
                    continue
                low = core.casefold()
                if low in names:
                    continue  # spelled like a confirmed name: nothing to check
                near = any(SequenceMatcher(None, low, k).ratio() >= 0.75 for k in names if len(k) >= 4)
                capital = core[0].isupper() and i > 0 and not re.search(r"[.!?]$", before)
                if not (capital or near):
                    continue
                if low in ordinary() and not near:
                    continue
                out.append(Heard(core, line_id(n), float(w.get("start", row["start"]))))
    return out


def _stem(key: str) -> str:
    return key[:-1] if len(key) > 3 and key.endswith("s") else key


def _same(a: str, b: str) -> bool:
    ka, kb = a.casefold(), b.casefold()
    if ka == kb or _stem(ka) == _stem(kb):
        return True
    return min(len(ka), len(kb)) >= 3 and SequenceMatcher(None, ka, kb).ratio() >= SAME_NAME


def merge_heard(heard: list[Heard]) -> list[Entry]:
    """Group the spellings of one name; most heard first, then by first time heard."""
    groups: list[list[Heard]] = []
    for h in heard:
        for g in groups:
            if any(_same(h.word, other) for other in {x.word for x in g}):
                g.append(h)
                break
        else:
            groups.append([h])
    entries = []
    for g in groups:
        spelled = Counter(h.word for h in g)
        order = [w for w, _ in spelled.most_common()]
        entries.append(
            Entry(
                kind="name",
                key=order[0],
                variants=order,
                count=len(g),
                where=[(h.line, h.start) for h in g],
                wrongs=order,
            )
        )
    entries.sort(key=lambda e: (-e.count, e.where[0][1]))
    return entries


def suggest(word: str, names: list[str]) -> str:
    """The closest known name (or a word of one) when it is similar enough, else empty."""
    best, top = "", SUGGEST_FROM
    low = word.casefold()
    for name in names:
        for cand in {name, *re.findall(r"\w+", name)}:
            if len(cand) < 3:
                continue
            score = SequenceMatcher(None, low, cand.casefold()).ratio()
            if score > top:
                best, top = cand if cand == name else name, score
    return best


def _first_name(label: str) -> str:
    return label.split("(")[0].strip()


def fact_entries(session: Path, raw: list[Line], lines: list[Line], names: list[str]) -> list[Entry]:
    """Where a hint disagrees with its owner. Kept small: the roster against the transcript, and
    a character that the world's names list does not know."""
    out: list[Entry] = []
    first_raw: dict[str, Line] = {}
    for ln in raw:
        first_raw.setdefault(ln.speaker, ln)
    first_now: dict[str, Line] = {}
    for ln in lines:
        first_now.setdefault(ln.speaker, ln)
    tokens = _name_tokens(names)
    for speaker, now in first_now.items():
        was = first_raw.get(speaker)
        char = _first_name(now.character)
        if was is not None and was.character != now.character and not is_gm(now.character):
            old = _first_name(was.character)
            out.append(
                Entry(
                    kind="fact",
                    key=f"{now.character}: character name",
                    note_en=f"The transcript was made with \"{was.character}\"; speakers.json now says "
                    f"\"{now.character}\". The notes use speakers.json.",
                    note_da=f"Transskriptionen blev lavet med \"{was.character}\"; speakers.json siger nu "
                    f"\"{now.character}\". Noterne bruger speakers.json.",
                    suggestion=char,
                    wrongs=[old] if old and old != char else [],
                )
            )
        elif names and not is_gm(now.character) and char and not any(
            t in tokens for t in {char.casefold(), *(w.casefold() for w in re.findall(r"\w+", char))}
        ):
            out.append(
                Entry(
                    kind="fact",
                    key=f"{now.character}: not in the world's names",
                    note_en=f"\"{char}\" is in speakers.json but not in names.txt (the world's names).",
                    note_da=f"\"{char}\" står i speakers.json, men ikke i names.txt (verdenens navne).",
                    suggestion=suggest(char, names),
                    wrongs=[char],
                )
            )
    return out


# --- answers --------------------------------------------------------------------------------

_NOT_NAME = re.compile(r"^(not a name|ikke et navn|ikke navn)\W*$", re.I)
_SAME = re.compile(r"^(same as|samme som|=)\s*(.+)$", re.I)
_OK = re.compile(r"^(ok|okay|keep|behold|fine)\.?$", re.I)


def _clean(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^\[\[(.+?)(\|.*)?\]\]$", r"\1", text)
    return text.strip(" \t*_\"'`")


def parse_answer(raw: str, entry: Entry) -> Answer | None:
    """``None`` while the answer is empty. The wrong spellings are the entry's variants."""
    text = raw.strip()
    if not text:
        return None
    if _NOT_NAME.match(text):
        return Answer("not-name", text)
    if _OK.match(text):
        if entry.kind == "name":  # "ok" on a name: the heard spelling is right
            return Answer("spelling", text, entry.key, [])
        return Answer("ok", text)
    same = _SAME.match(text)
    kind = "same" if same else "spelling"
    correct = _clean(same.group(2) if same else text)
    if not correct:
        return None
    wrongs = [w for w in entry.wrongs if w.casefold() != correct.casefold()]
    return Answer(kind, text, correct, wrongs)


def parse_page(text: str) -> dict[str, str]:
    """``{heading: answer text}`` from one filled-in page; empty answers are left out."""
    out: dict[str, str] = {}
    key: str | None = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("### "):
            key = line[4:].strip()
        elif line.startswith("## "):
            key = None
        elif key is not None:
            m = re.match(r"^(Answer|Svar):[ \t]*(.*)$", line)
            if m and m.group(2).strip():
                out.setdefault(key, m.group(2).strip())
    return out


def _load_answers(session: Path) -> dict[str, dict[str, Any]]:
    path = session / ANSWERS_FILE
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except ValueError:
        return {}
    answers = data.get("answers") if isinstance(data, dict) else None
    return answers if isinstance(answers, dict) else {}


def _save_answers(session: Path, answers: dict[str, dict[str, Any]]) -> None:
    _write(session / ANSWERS_FILE, json.dumps({"answers": answers}, ensure_ascii=False, indent=1) + "\n")


def page_path(session: Path, lang: str) -> Path:
    return session / "notes" / f"{PAGE}.{lang}.md"


def _read_pages(session: Path) -> tuple[dict[str, str], list[str]]:
    """Answers from both pages. English wins a conflict (named in the second value)."""
    en = page_path(session, "en")
    da = page_path(session, "da")
    en_ans = parse_page(en.read_text(encoding="utf-8-sig")) if en.exists() else {}
    da_ans = parse_page(da.read_text(encoding="utf-8-sig")) if da.exists() else {}
    merged = dict(da_ans)
    conflicts = []
    for key, text in en_ans.items():
        if key in da_ans and da_ans[key].casefold() != text.casefold():
            conflicts.append(f"{key}: English page says '{text}', Danish page says '{da_ans[key]}'")
        merged[key] = text
    return merged, conflicts


# --- writing the files the next steps read ---------------------------------------------------


def _write(path: Path, text: str) -> None:
    """Whole file at once (a rename), LF line endings, so an editor never sees half a page."""
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(path)


def _read_rules(session: Path) -> dict[str, list[str]] | None:
    path = session / "rules.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        if not isinstance(data, dict) or any(not isinstance(v, list) for v in data.values()):
            return None
        return {str(k): [str(w) for w in v] for k, v in data.items()}
    except ValueError:
        return None  # a hand-edited file that does not parse is not ours to overwrite


def _drop_rules(session: Path, answer: dict[str, Any]) -> None:
    """Take back the wrong spellings an answer added, before a correction replaces it."""
    rules = _read_rules(session)
    correct = answer.get("correct") or ""
    if not rules or correct not in rules:
        return
    gone = {w.casefold() for w in answer.get("wrongs", [])}
    rules[correct] = [w for w in rules[correct] if w.casefold() not in gone]
    if not rules[correct]:
        del rules[correct]
    _write(session / "rules.json", json.dumps(rules, ensure_ascii=False, indent=1) + "\n")


def _merge_rules(session: Path, answers: dict[str, dict[str, Any]]) -> int:
    path = session / "rules.json"
    rules = _read_rules(session)
    if rules is None:
        return 0
    added = 0
    for a in answers.values():
        correct = a.get("correct") or ""
        if not correct:
            continue
        correct = next((k for k in rules if k.casefold() == correct.casefold()), correct)
        have = {w.casefold() for w in rules.get(correct, [])}
        for wrong in a.get("wrongs", []):
            if wrong.casefold() not in have and wrong.casefold() != correct.casefold():
                rules.setdefault(correct, []).append(wrong)
                have.add(wrong.casefold())
                added += 1
    if added:
        _write(path, json.dumps(rules, ensure_ascii=False, indent=1) + "\n")
    return added


def _merge_names(session: Path, answers: dict[str, dict[str, Any]]) -> list[str]:
    path = session / "names.txt"
    existing = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []
    have = {ln.strip().casefold() for ln in existing}
    new = []
    for a in answers.values():
        name = a.get("correct") or ""
        if name and name.casefold() not in have:
            new.append(name)
            have.add(name.casefold())
    if new:
        # first in the file: the transcriber keeps the first names when its budget runs out
        _write(path, "\n".join([*new, *(ln.rstrip("\r") for ln in existing)]) + "\n")
    return new


def apply_answers(session: Path, lines: list[Line]) -> tuple[list[Line], set[str]]:
    """Rewrite the transcript text with the stored answers; returns the lines and the ids changed.

    Replaces whole words, ignoring case. A word marked ``not a name`` is left alone."""
    answers = _load_answers(session)
    pairs: dict[str, str] = {}
    for a in answers.values():
        for wrong in a.get("wrongs", []):
            if a.get("correct") and wrong.casefold() != a["correct"].casefold():
                pairs.setdefault(wrong.casefold(), a["correct"])
    if not pairs:
        return lines, set()
    pattern = re.compile(
        r"(?<!\w)(" + "|".join(re.escape(w) for w in sorted(pairs, key=len, reverse=True)) + r")(?!\w)",
        re.IGNORECASE,
    )
    out: list[Line] = []
    changed: set[str] = set()
    for ln in lines:
        def fix(m: re.Match[str]) -> str:
            right = pairs[m.group(1).casefold()]
            found = m.group(1)
            return right.upper() if len(found) > 1 and found.isupper() else right

        text = pattern.sub(fix, ln.text)
        if text == ln.text:
            out.append(ln)
            continue
        changed.add(ln.id)
        unsure = tuple(u for u in ln.uncertain if _core(u).casefold() not in pairs)
        out.append(Line(ln.id, ln.start, ln.end, ln.speaker, ln.player, ln.character, text, unsure))
    return out, changed


# --- the page ---------------------------------------------------------------------------------

_TEXT = {
    "en": {
        "title": PAGE,
        "intro": "Words the transcriber was unsure about, and facts where two sources disagree. "
        "Write one of these after **Answer:** on each entry you can settle, and save the file:\n\n"
        "- the right spelling, for example `Barnon`\n- `same as X`, when it is another way of saying X\n"
        "- `not a name`, when it is an ordinary word\n\n"
        "Leave it empty when you do not know. The next notes run reads your answers into the names "
        "list and the spelling rules and writes the notes again. The first answer given stays.",
        "names": "Names",
        "facts": "Facts",
        "none": "Nothing to check.",
        "heard": "Heard {n} time(s)",
        "also": "also as",
        "where": "Where",
        "more": "+{n} more",
        "suggestion": "Suggestion",
        "answer": "Answer",
        "status": "Status",
        "applied": "applied in the notes",
        "ok": "kept as it is",
        "ignored": "marked as not a name",
        "note": "Note",
        "scored": "Heard under {p:.0%} certainty.",
    },
    "da": {
        "title": "Navne og fakta at tjekke",
        "intro": "Ord som transskriptionen var usikker på, og fakta hvor to kilder er uenige. "
        "Skriv et af disse efter **Svar:** ved hver post du kan afgøre, og gem filen:\n\n"
        "- den rigtige stavemåde, for eksempel `Barnon`\n- `samme som X`, når det er en anden måde at sige X på\n"
        "- `ikke et navn`, når det er et almindeligt ord\n\n"
        "Lad den stå tom, hvis du ikke ved det. Næste notekørsel læser dine svar ind i navnelisten og "
        "stavereglerne og skriver noterne igen. Det første svar der gives, bliver stående.",
        "names": "Navne",
        "facts": "Fakta",
        "none": "Intet at tjekke.",
        "heard": "Hørt {n} gang(e)",
        "also": "også som",
        "where": "Hvor",
        "more": "+{n} flere",
        "suggestion": "Forslag",
        "answer": "Svar",
        "status": "Status",
        "applied": "brugt i noterne",
        "ok": "bevaret som det er",
        "ignored": "markeret som ikke et navn",
        "note": "Note",
        "scored": "Hørt med under {p:.0%} sikkerhed.",
    },
}


def render_page(lang: str, entries: list[Entry], answers: dict[str, dict[str, Any]]) -> str:
    t = _TEXT[lang]
    names = [e for e in entries if e.kind == "name"]
    facts = [e for e in entries if e.kind == "fact"]

    def block(e: Entry) -> list[str]:
        out = [f"### {e.key}"]
        if e.kind == "name":
            heard = t["heard"].format(n=e.count)
            if len(e.variants) > 1:
                heard += f", {t['also']}: " + ", ".join(e.variants[1:])
            out.append(heard)
            links = [f"[[transcript.{lang}#^{i}|{clock(s)}]]" for i, s in e.where[:MAX_LINKS]]
            if len(e.where) > MAX_LINKS:
                links.append(t["more"].format(n=len(e.where) - MAX_LINKS))
            out.append(f"{t['where']}: " + ", ".join(links))
        else:
            out.append(f"{t['note']}: {e.note_en if lang == 'en' else e.note_da}")
        if e.suggestion:
            out.append(f"{t['suggestion']}: {e.suggestion}")
        given = answers.get(e.key)
        out.append(f"{t['answer']}: {given['text'] if given else ''}".rstrip() if given else f"{t['answer']}:")
        if given:
            kind = given.get("kind")
            out.append(f"{t['status']}: {t['ignored'] if kind == 'not-name' else t['ok'] if kind == 'ok' else t['applied']}")
        out.append("")
        return out

    def ordered(group: list[Entry]) -> list[Entry]:
        return [*(e for e in group if e.key not in answers), *(e for e in group if e.key in answers)]

    body = [f"# {t['title']}", "", t["intro"], "", f"## {t['names']}", NAMES_MARK, ""]
    body += [x for e in ordered(names) for x in block(e)] or [t["none"], ""]
    body += [f"## {t['facts']}", FACTS_MARK, ""]
    body += [x for e in ordered(facts) for x in block(e)] or [t["none"], ""]
    return "\n".join(body)


# --- the whole step ---------------------------------------------------------------------------


def sync(session: Path) -> CheckReport:
    """Read answers from the pages, store them, feed ``names.txt`` and ``rules.json``, and write the
    pages again. No Claude call. Safe to run any number of times."""
    timeline = session / "timeline" / "timeline.jsonl"
    report = CheckReport()
    if not timeline.exists():
        return report
    raw = load_timeline(timeline)
    lines = apply_speakers(raw, session)
    names = _known_names(session, lines)
    heard = raw_heard(session)
    report.flagged = len({h.word.casefold() for h in heard})
    entries = merge_heard(heard)
    for e in entries:
        e.suggestion = suggest(e.key, names) or next((s for v in e.variants[1:] if (s := suggest(v, names))), "")
    entries += fact_entries(session, raw, lines, names)
    report.entries = sum(1 for e in entries if e.kind == "name")
    report.facts = len(entries) - report.entries

    stored = _load_answers(session)
    # An answered entry stays on the page even when its answer made it disappear from the lists
    # above (the name is now in names.txt): it is rebuilt from what was stored with the answer.
    by_key = {e.key: e for e in entries}
    for key, a in stored.items():
        data = a.get("entry_data")
        if key not in by_key and isinstance(data, dict):
            kept = Entry(**{**data, "where": [tuple(w) for w in data.get("where", [])]})
            entries.append(kept)
            by_key[key] = kept
    given, report.conflicts = _read_pages(session)
    for key, text in given.items():
        entry = by_key.get(key)
        if entry is None:
            report.unknown.append(f"{key}: {text}")
            continue
        old = stored.get(key)
        if old is not None and old["text"].strip().casefold() == text.strip().casefold():
            continue
        ans = parse_answer(text, entry)
        if ans is None:
            continue
        if old is not None:  # the page differs from the stored answer: a correction
            _drop_rules(session, old)
            report.corrected.append(f"{key}: '{old['text']}' -> '{text}'")
        else:
            report.new_answers += 1
        stored[key] = {
            "kind": ans.kind,
            "text": ans.text,
            "correct": ans.correct,
            "wrongs": ans.wrongs,
            "entry": entry.kind,
            "entry_data": {
                "kind": entry.kind,
                "key": entry.key,
                "variants": entry.variants,
                "count": entry.count,
                "where": [list(w) for w in entry.where],
                "suggestion": entry.suggestion,
                "note_en": entry.note_en,
                "note_da": entry.note_da,
                "wrongs": entry.wrongs,
            },
        }
    if stored:
        _save_answers(session, stored)
    report.names_added = _merge_names(session, stored)
    report.rules_added = _merge_rules(session, stored)
    report.entries = sum(1 for e in entries if e.kind == "name")
    report.facts = len(entries) - report.entries
    report.answered = sum(1 for e in entries if e.key in stored)
    (session / "notes").mkdir(parents=True, exist_ok=True)
    for lang in ("en", "da"):
        _write(page_path(session, lang), render_page(lang, entries, stored))
    return report
