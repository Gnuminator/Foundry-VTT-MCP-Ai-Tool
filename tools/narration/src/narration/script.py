"""Read a narration script: Markdown with a small front matter, split into numbered sentences.

Each sentence has two forms: ``shown`` (what the captions say) and ``spoken`` (what the voice
reads). They differ where the script uses an inline override ``{shown|spoken}`` or where a
pronunciation list (``lexicon/<lang>.txt``) rewrites a word.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

LANGS = ("da", "en")

# Gaps in seconds; the front matter may override each one.
DEFAULT_GAPS = {
    "lead_in": 0.3,
    "sentence_gap": 0.25,
    "paragraph_gap": 0.6,
    "heading_gap": 1.0,
    "tail": 0.6,
}

# Words that end with a period but do not end a sentence (compared in lower case).
ABBREVIATIONS = {
    "f.eks", "fx", "bl.a", "dvs", "d.v.s", "osv", "ca", "evt", "mht", "pga", "nr", "jf", "inkl",
    "e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "st", "no",
}

_PH_OPEN, _PH_CLOSE, _PH_BASE = "", "", 0xE100
_OVERRIDE = re.compile(r"\{([^{}|]+)\|([^{}|]+)\}")
_PAUSE = re.compile(r"\[pause\s+(\d+(?:\.\d+)?)\s*s?\]", re.IGNORECASE)
_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_EMPHASIS = re.compile(r"(\*\*|__|\*|_|`)(.+?)\1")
_LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")
_BOUNDARY = re.compile(r"[.!?…]+[\"'”»)]*\s+")


@dataclass
class Sentence:
    index: int  # 1-based, in script order
    shown: str
    spoken: str
    paragraph: int
    heading: str | None
    gap_after: float  # silence after this sentence, in seconds


@dataclass
class Script:
    path: Path
    name: str  # file name without .md, for example "intro.da"
    lang: str
    voice: str | None
    speed: float | None
    gaps: dict[str, float]
    lead_in: float
    sentences: list[Sentence]
    chapters: list[tuple[int, str]] = field(default_factory=list)  # (first sentence index, title)
    warnings: list[str] = field(default_factory=list)


def load_lexicon(path: Path) -> dict[str, str]:
    """``term = spoken`` per line; ``#`` starts a comment. Later files override earlier ones."""
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        if "=" not in line:
            raise ValueError(f"{path}:{n}: expected 'term = spoken', got {raw!r}")
        term, spoken = (p.strip() for p in line.split("=", 1))
        if not term or not spoken:
            raise ValueError(f"{path}:{n}: empty term or spoken form")
        out[term] = spoken
    return out


def apply_lexicon(text: str, lexicon: dict[str, str]) -> str:
    """Replace whole words, longest term first, ignoring case.

    A term joined to the next word by a hyphen ("dnd5e-systemet") is followed by a space in the
    spoken form instead: a spelled-out term glued to a word made the Danish voice slur both
    (heard as "d n die" on 2026-10-03).
    """
    if not lexicon:
        return text
    terms = sorted(lexicon, key=len, reverse=True)
    lookup = {t.lower(): lexicon[t] for t in terms}
    pattern = re.compile(
        r"(?<![\w])(" + "|".join(re.escape(t) for t in terms) + r")(?![\w])(-(?=\w))?",
        re.IGNORECASE,
    )
    return pattern.sub(lambda m: lookup[m.group(1).lower()] + (" " if m.group(2) else ""), text)


def _front_matter(text: str) -> tuple[dict[str, str], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text
    for end in range(1, len(lines)):
        if lines[end].strip() == "---":
            meta = {}
            for line in lines[1:end]:
                if ":" in line and not line.lstrip().startswith("#"):
                    key, value = line.split(":", 1)
                    meta[key.strip().lower()] = value.strip().strip("\"'")
            return meta, "\n".join(lines[end + 1 :])
    return {}, text


def _clean_markdown(text: str) -> str:
    text = _LINK.sub(r"\1", text)
    for _ in range(2):  # nested emphasis such as ***word***
        text = _EMPHASIS.sub(r"\2", text)
    return text


def split_sentences(text: str) -> list[str]:
    """Split at . ! ? and the ellipsis, but not after a known abbreviation or a lone initial."""
    out: list[str] = []
    start = 0
    for m in _BOUNDARY.finditer(text):
        before = text[start : m.start()].split()
        last = before[-1].lower().rstrip(".") if before else ""
        if text[m.start()] == "." and (last in ABBREVIATIONS or (len(last) == 1 and last.isalpha())):
            continue
        out.append(text[start : m.end()].strip())
        start = m.end()
    tail = text[start:].strip()
    if tail:
        out.append(tail)
    return out


def _lang_from_name(path: Path) -> str | None:
    suffixes = path.name.lower().split(".")
    for part in reversed(suffixes[:-1]):
        if part in LANGS:
            return part
    return None


def parse_script(path: Path, lexicon: dict[str, str] | None = None, text: str | None = None) -> Script:
    """Parse a script file. ``lexicon`` rewrites words in the spoken form only."""
    raw = path.read_text(encoding="utf-8") if text is None else text
    meta, body = _front_matter(raw)
    lang = (meta.get("lang") or _lang_from_name(path) or "").lower()
    if lang not in LANGS:
        raise ValueError(
            f"{path.name}: set 'lang: da' or 'lang: en' in the front matter, or name it <name>.da.md"
        )
    gaps = dict(DEFAULT_GAPS)
    for key in gaps:
        if key in meta:
            gaps[key] = float(meta[key])
    speed = float(meta["speed"]) if meta.get("speed") else None
    name = path.name[:-3] if path.name.lower().endswith(".md") else path.stem

    body = _COMMENT.sub("", body)
    overrides: list[tuple[str, str]] = []

    def hold(m: re.Match[str]) -> str:
        overrides.append((m.group(1).strip(), m.group(2).strip()))
        return _PH_OPEN + chr(_PH_BASE + len(overrides) - 1) + _PH_CLOSE

    body = _OVERRIDE.sub(hold, body)

    # Blocks: ("heading", title) | ("para", text) | ("pause", seconds)
    blocks: list[tuple[str, object]] = []
    para: list[str] = []

    def flush() -> None:
        if para:
            blocks.append(("para", " ".join(para)))
            para.clear()

    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            flush()
            continue
        if stripped.startswith("#"):
            flush()
            blocks.append(("heading", stripped.lstrip("#").strip()))
            continue
        if _LIST_ITEM.match(line):
            flush()  # every list item is its own paragraph
            stripped = _LIST_ITEM.sub("", line).strip()
        pos = 0
        for m in _PAUSE.finditer(stripped):
            before = stripped[pos : m.start()].strip()
            if before:
                para.append(before)
            flush()
            blocks.append(("pause", float(m.group(1))))
            pos = m.end()
        after = stripped[pos:].strip()
        if after:
            para.append(after)
    flush()

    def render(chunk: str, spoken: bool) -> str:
        chunk = _clean_markdown(chunk)
        if spoken and lexicon:
            chunk = apply_lexicon(chunk, lexicon)

        def put(m: re.Match[str]) -> str:
            shown_text, spoken_text = overrides[ord(m.group(1)) - _PH_BASE]
            return spoken_text if spoken else shown_text

        chunk = re.sub(_PH_OPEN + "(.)" + _PH_CLOSE, put, chunk)
        return re.sub(r"\s+", " ", chunk).strip()

    script = Script(
        path=path,
        name=name,
        lang=lang,
        voice=meta.get("voice") or None,
        speed=speed,
        gaps=gaps,
        lead_in=gaps["lead_in"],
        sentences=[],
    )
    heading: str | None = None
    paragraph = 0
    pending_heading = False
    for kind, value in blocks:
        if kind == "heading":
            heading = str(value)
            pending_heading = True
            if script.sentences:
                script.sentences[-1].gap_after = max(script.sentences[-1].gap_after, gaps["heading_gap"])
            continue
        if kind == "pause":
            if script.sentences:
                script.sentences[-1].gap_after += float(value)  # type: ignore[arg-type]
            else:
                script.lead_in += float(value)  # type: ignore[arg-type]
            continue
        paragraph += 1
        parts = split_sentences(str(value))
        if script.sentences and script.sentences[-1].paragraph != paragraph:
            last = script.sentences[-1]
            last.gap_after = max(last.gap_after, gaps["paragraph_gap"])
        for part in parts:
            shown, spoken = render(part, False), render(part, True)
            if not spoken:
                continue
            s = Sentence(
                index=len(script.sentences) + 1,
                shown=shown,
                spoken=spoken,
                paragraph=paragraph,
                heading=heading,
                gap_after=gaps["sentence_gap"],
            )
            script.sentences.append(s)
            if pending_heading and heading:
                script.chapters.append((s.index, heading))
                pending_heading = False
            if len(spoken) > 250:
                script.warnings.append(
                    f"sentence {s.index} is {len(spoken)} characters; the voices do best under"
                    " about 250, so split it"
                )
    if script.sentences:
        script.sentences[-1].gap_after = gaps["tail"]
    if not script.sentences:
        script.warnings.append("the script has no sentences")
    return script
