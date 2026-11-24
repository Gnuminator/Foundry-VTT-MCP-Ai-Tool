"""Campaign merge plan (D-151): what one session adds to the Campaign journals.

After a notes run, one Claude call (subscription, D-066) turns the worth-remembering layer, the
cleaned transcript lines it cites and, when there is one, the Foundry chat log into entries for the
``plan-campaign-merge`` tool: a page per NPC, creature, place, thread and so on, each with a short
summary, relations and timeline lines that link to the transcript. Claude only proposes; this module
then applies the ownership table of the design (section 3) in plain code, so the rules do not
depend on the model:

* **Spelling of a name:** the confirmed names list owns it (``names.txt`` and the answers on the
  check page). An entry whose name is not on that list is *held*: it is not in ``entries`` and goes
  to the check page as a name to confirm, so the next run adds it once someone answers.
* **Stats, items, level, ownership:** Foundry owns them. A claim from the talk never reaches a
  page. With a ``foundry-facts.json`` it is compared and a difference goes to the check page; the
  page keeps Foundry's version.
* **What happened:** transcript and chat log. A timeline line needs a link to a transcript line
  (or a chat time); a line citing nothing real is dropped.
* **Rulings and house rules:** only Danni confirms, so every ``Table`` entry is written as
  *proposed*.
* **Plans and secrets:** never "happened"; the notes layers they come from are not an input here.

Only additions are planned. Rewriting or removing text, merging or renaming pages is left to
whoever reads the page; ``replaceSummary`` is never set. The Claude session that applies the file
passes ``entries`` to ``plan-campaign-merge``; the tool splits them into additions (at once when
the GM's switch is on) and changes (always confirmed).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .claude_runner import ClaudeError, Runner, UsageLimitError
from .model import Line, apply_speakers, clock, load_timeline
from .prompts import _IDS, _STR, _list, _obj

PLAN_FILE = "campaign-merge.json"
CHECKS_FILE = "campaign-checks.json"
FACTS_FILE = "foundry-facts.json"
CHAT_FILE = "chat-log.json"

KINDS = ("brothers", "npcs", "creatures", "locations", "lore", "threads", "sessions", "table")
# Kinds whose page name is a proper name that the confirmed names list owns. Threads, the session
# page and the table are titles in plain words.
NAMED_KINDS = frozenset({"brothers", "npcs", "creatures", "locations", "lore"})
FACT_FIELDS = ("stats", "items", "level", "ownership")
MAX_TIMELINE = 40
MAX_CITED_LINES = 3

RELATION = _obj(to=_STR, da=_STR, en=_STR)
TIMELINE = _obj(da=_STR, en=_STR, cites=_IDS)
ENTRY = _obj(
    kind={"type": "string", "enum": list(KINDS)},
    name=_STR,
    summary_da=_STR,
    summary_en=_STR,
    relations=_list(RELATION),
    timeline=_list(TIMELINE),
)
CLAIM = _obj(
    about=_STR,
    field={"type": "string", "enum": list(FACT_FIELDS)},
    value=_STR,
    cites=_IDS,
)
CAMPAIGN_SCHEMA = _obj(entries=_list(ENTRY), claims=_list(CLAIM))

CAMPAIGN_RULES = """\
You get what one Dungeons & Dragons session added to a campaign: a list of worth-remembering items
(each with the transcript lines it rests on and the lines' text) and, when there is one, the chat
log of the virtual tabletop. Decide which campaign pages the session adds to and write the new
material for each page. Produce the JSON described by the schema.

- entries: one entry per page. `kind` is the page's journal: brothers (the four player characters),
  npcs, creatures (monsters), locations, lore (history, items of story weight, the world), threads
  (quests and open questions), sessions (one entry named like the session label you are given: what
  happened in the session, in a few timeline lines), table (house rules and agreements).
- `name` is the page: the person, place or thing, spelled as in the notes. Use one name per thing;
  never two entries for the same page.
- summary_da / summary_en: two or three sentences about the thing as the campaign knows it now;
  leave both empty when this session says too little. Never copy the stat block.
- relations: links to other pages by name, one line each (who is whose sibling, who owes what).
- timeline: one line per fact this session shows about the page, in Danish and English, with the
  line ids it rests on in `cites` (1 to 3 ids taken from the items; chat lines are ids starting
  with "c"). A line without a real id is dropped, so cite.
- Quotes stay in the spoken language in both texts; the English text adds a translation.
- claims: anything the talk says about stats, items, level or who owns an actor
  (`field` stats, items, level, ownership) as `about` (the character or creature) and the `value`
  said. These are hints only: Foundry owns them and they never reach a page.
- Plans and secrets of the GM are not facts that happened. Do not write them into a timeline.
- A house rule or agreement goes in a table entry as what was said or proposed; do not write that it
  was confirmed.
- Game terms stay English as the table says them (attack, saving throw, hit points, armor class,
  initiative, spell slot, advantage, token). Danish text is Danish sentences with these words.
- Use only what is in the input. Never invent a name, a number or a quote. Fewer, sharper entries
  beat many thin ones.
"""

CHANGES_HEAD = {
    "da": "Foreslået (Danni bekræfter): ",
    "en": "Proposed (Danni confirms): ",
}


@dataclass(slots=True)
class Context:
    """Everything the plan is built from, read from the session folder."""

    session: Path
    label: str
    lines: list[Line]
    remember: list[dict[str, Any]]
    chat: list[dict[str, Any]]  # {"id": "c0001", "time": "01:42", "who": ..., "text": ...}
    confirmed: set[str] = field(default_factory=set)  # casefolded confirmed names
    foundry: dict[str, dict[str, Any]] = field(default_factory=dict)  # casefolded name -> facts


@dataclass(slots=True)
class CampaignResult:
    plan: dict[str, Any]
    paused: str | None = None
    login_needed: bool = False


# --- reading the session folder ------------------------------------------------------------------


def session_label(session: Path) -> str:
    """``Session 00`` from a folder name that carries a number, else the folder name."""
    m = re.search(r"(?:session|sess|s)[ _-]?(\d{1,3})", session.name, re.I)
    return f"Session {int(m.group(1)):02d}" if m else f"Session {session.name}"


def confirmed_names(session: Path, lines: list[Line]) -> set[str]:
    """The confirmed names list: ``names.txt`` plus the corrected spellings from the check page,
    plus the characters on the roster. A name answered ``not a name`` is not on it."""
    from . import check
    from .model import is_gm, load_roster

    names: set[str] = set()
    roster = load_roster(session, lines)
    for name in roster.names:
        names.add(name.casefold())
    for character in roster.players.values():
        if character and not is_gm(character):
            names.add(re.sub(r"\s*\(.*\)\s*$", "", character).strip().casefold())
    for answer in check._load_answers(session).values():
        if answer.get("kind") in ("spelling", "same") and answer.get("correct"):
            names.add(str(answer["correct"]).casefold())
    names.discard("")
    return names


def _tokens(name: str) -> set[str]:
    return {t.casefold() for t in re.findall(r"\w+", name) if len(t) >= 3}


def is_confirmed(name: str, confirmed: set[str]) -> bool:
    """The page name equals a confirmed name, or its words all belong to one confirmed name
    ("Barnon" on the list as "Barnon Vesperholt")."""
    key = name.strip().casefold()
    if key in confirmed:
        return True
    mine = _tokens(name)
    if not mine:
        return False
    return any(mine <= _tokens(c) for c in confirmed)


def load_chat(session: Path, path: Path | None = None) -> list[dict[str, Any]]:
    """The Foundry chat log of the session, from ``chat-log.json`` (a list of ``{time, who,
    text}``; ``get-chat-log`` output saved by the Claude session). No file: no chat input."""
    source = path or session / CHAT_FILE
    if not source.exists():
        return []
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    rows = data.get("messages") if isinstance(data, dict) else data
    out: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict) or not str(row.get("text", "")).strip():
            continue
        out.append(
            {
                "id": f"c{len(out) + 1:04d}",
                "time": str(row.get("time", "")).strip(),
                "who": str(row.get("who") or row.get("speaker") or "").strip(),
                "text": str(row["text"]).strip(),
            }
        )
    return out


def load_foundry_facts(session: Path, path: Path | None = None) -> dict[str, dict[str, Any]]:
    """``foundry-facts.json``: ``{"Name": {"level": "3", "items": [...], ...}}``, Foundry's side of
    the stats, items, level and ownership claims. Absent: every such claim stays a hint."""
    source = path or session / FACTS_FILE
    if not source.exists():
        return {}
    data = json.loads(source.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        return {}
    return {str(k).casefold(): v for k, v in data.items() if isinstance(v, dict)}


def build_context(
    session: Path, label: str | None = None, chat: Path | None = None, facts: Path | None = None
) -> Context:
    """Read the notes, the cleaned transcript and the optional chat log and Foundry facts."""
    from . import check

    notes = session / "notes" / "notes.json"
    if not notes.exists():
        raise FileNotFoundError(f"No notes in {notes.parent}; run session-notes run --layers first.")
    data = json.loads(notes.read_text(encoding="utf-8"))
    if not data.get("complete"):
        raise FileNotFoundError("The notes are not finished; run session-notes run --layers again.")
    remember = data.get("remember")
    if remember is None or remember.get("fallback"):
        raise FileNotFoundError("The worth-remembering layer is missing; run session-notes run --layers.")
    lines = apply_speakers(load_timeline(session / "timeline" / "timeline.jsonl"), session)
    lines, _changed = check.apply_answers(session, lines)
    return Context(
        session=session,
        label=label or session_label(session),
        lines=lines,
        remember=list(remember.get("items") or []),
        chat=load_chat(session, chat),
        confirmed=confirmed_names(session, lines),
        foundry=load_foundry_facts(session, facts),
    )


# --- the Claude call -----------------------------------------------------------------------------


def _short_time(seconds: float) -> str:
    """01:42 for under an hour, 1:02:03 after."""
    text = clock(seconds)
    return text[3:] if text.startswith("00:") else text.lstrip("0")


def prompt(ctx: Context) -> str:
    by_id = {ln.id: ln for ln in ctx.lines}
    items = []
    for item in ctx.remember:
        cites = [c for c in item.get("cites", []) if c in by_id]
        items.append(
            {
                "kind": item.get("kind"),
                "en": item.get("en"),
                "da": item.get("da"),
                "cites": cites,
                "lines": [
                    f"{c} [{_short_time(by_id[c].start)}] {by_id[c].character}: {by_id[c].text}"
                    for c in cites[:MAX_CITED_LINES]
                ],
            }
        )
    parts = [
        CAMPAIGN_RULES,
        f"Session label: {ctx.label}",
        "Worth-remembering items (JSON):",
        json.dumps(items, ensure_ascii=False, indent=1),
    ]
    if ctx.chat:
        parts += [
            "Chat log of the virtual tabletop (id, time, who: text):",
            "\n".join(f"{c['id']} [{c['time']}] {c['who']}: {c['text']}" for c in ctx.chat),
        ]
    return "\n".join(parts)


def input_key(ctx: Context) -> str:
    """Cache key: the call depends on the notes, the chat log, the label and the rules, not on the
    confirmed names (those are applied afterwards), so answering a name never costs a new call."""
    blob = json.dumps(
        [
            ctx.label,
            ctx.remember,
            [(ln.id, ln.text) for ln in ctx.lines if ln.id in _cited(ctx)],
            ctx.chat,
            hashlib.sha256(CAMPAIGN_RULES.encode("utf-8")).hexdigest(),
        ],
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _cited(ctx: Context) -> set[str]:
    return {c for item in ctx.remember for c in item.get("cites", [])}


def check_result(result: dict[str, Any]) -> list[str]:
    entries = result.get("entries")
    if not isinstance(entries, list):
        return ["no entries list"]
    problems = []
    if any(e.get("kind") not in KINDS or not str(e.get("name", "")).strip() for e in entries):
        problems.append("an entry without a valid kind or name")
    return problems


def ask_claude(ctx: Context, runner: Runner, model: str = "sonnet", effort: str = "medium") -> dict[str, Any]:
    """The call, cached in ``notes/.work/campaign.json`` under ``input_key``."""
    work = ctx.session / "notes" / ".work"
    cache = work / "campaign.json"
    key = input_key(ctx)
    try:
        data = json.loads(cache.read_text(encoding="utf-8"))
        if data.get("key") == key and isinstance(data.get("result"), dict):
            return data["result"]
    except (ValueError, OSError, AttributeError):
        pass
    last: list[str] = []
    for _attempt in range(2):
        result = runner(prompt(ctx), CAMPAIGN_SCHEMA, model, effort)
        last = check_result(result)
        if not last:
            work.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps({"key": key, "result": result}, ensure_ascii=False), encoding="utf-8")
            return result
    raise ClaudeError("The campaign merge answer failed its check: " + "; ".join(last))


# --- the ownership table -------------------------------------------------------------------------


def _ref(line: Line) -> dict[str, str]:
    return {"ref": f"transcript.en#^{line.id}", "time": _short_time(line.start)}


def _timeline(ctx: Context, raw: list[dict[str, Any]], dropped: list[str]) -> list[dict[str, Any]]:
    by_id = {ln.id: ln for ln in ctx.lines}
    chat = {c["id"]: c for c in ctx.chat}
    out: list[dict[str, Any]] = []
    for row in raw[:MAX_TIMELINE]:
        da, en = str(row.get("da", "")).strip(), str(row.get("en", "")).strip()
        if not (da or en):
            continue
        cites = [c for c in row.get("cites", [])]
        source = next((by_id[c] for c in cites if c in by_id), None)
        item: dict[str, Any] = {"session": ctx.label, "da": da, "en": en}
        if source is not None:
            item.update(_ref(source))
        else:
            said = next((chat[c] for c in cites if c in chat), None)
            if said is None:
                dropped.append(en or da)
                continue
            if said["time"]:
                item["time"] = said["time"]
        out.append(item)
    return out


def _relations(raw: list[dict[str, Any]]) -> list[dict[str, str]]:
    out = []
    for row in raw:
        to = str(row.get("to", "")).strip()
        if to:
            out.append({"to": to, "da": str(row.get("da", "")).strip(), "en": str(row.get("en", "")).strip()})
    return out


def _check_name(entry: dict[str, Any], ctx: Context, name: str, cites: list[str]) -> dict[str, Any]:
    """The check page's ``name`` entry for a held page: where the name was heard."""
    by_id = {ln.id: ln for ln in ctx.lines}
    where = [[c, by_id[c].start] for c in cites if c in by_id]
    return {"key": name, "variants": [name], "count": max(1, len(where)), "where": where}


def _fact_claims(
    ctx: Context, claims: list[dict[str, Any]], checks: dict[str, list[dict[str, Any]]], hints: list[dict[str, Any]]
) -> None:
    """Claims about what Foundry owns: never merged; a difference from Foundry goes to the check page."""
    for claim in claims:
        about = str(claim.get("about", "")).strip()
        field_name = str(claim.get("field", ""))
        value = str(claim.get("value", "")).strip()
        if not about or field_name not in FACT_FIELDS or not value:
            continue
        theirs = ctx.foundry.get(about.casefold())
        if theirs is None or field_name not in theirs:
            hints.append({"about": about, "field": field_name, "value": value, "why": "Foundry owns it; no value to compare"})
            continue
        owned = theirs[field_name]
        owned_text = " ".join(str(x) for x in owned) if isinstance(owned, list) else str(owned)
        if value.casefold() in owned_text.casefold():
            continue
        checks["facts"].append(
            {
                "key": f"{about}: {field_name} (campaign merge)",
                "note_en": f"The talk says {field_name} is \"{value}\"; Foundry says \"{owned_text}\". "
                "The campaign page keeps Foundry's version.",
                "note_da": f"Samtalen siger {field_name} er \"{value}\"; Foundry siger \"{owned_text}\". "
                "Kampagnesiden beholder Foundrys version.",
                "suggestion": "",
            }
        )


def build_plan(ctx: Context, result: dict[str, Any], switch: bool = False) -> dict[str, Any]:
    """Apply the ownership table to what Claude proposed; the dict is ``campaign-merge.json``."""
    entries: list[dict[str, Any]] = []
    held: list[dict[str, str]] = []
    dropped: list[str] = []
    hints: list[dict[str, Any]] = []
    checks: dict[str, list[dict[str, Any]]] = {"names": [], "facts": []}
    seen: set[tuple[str, str]] = set()
    for raw in result.get("entries", []):
        kind, name = str(raw.get("kind")), str(raw.get("name", "")).strip()
        if kind not in KINDS or not name or (kind, name.casefold()) in seen:
            continue
        seen.add((kind, name.casefold()))
        cites = [c for row in raw.get("timeline", []) for c in row.get("cites", [])]
        entry: dict[str, Any] = {"kind": kind, "name": name, "nameConfirmed": True}
        summary = {"da": str(raw.get("summary_da", "")).strip(), "en": str(raw.get("summary_en", "")).strip()}
        timeline = _timeline(ctx, raw.get("timeline", []), dropped)
        if kind == "table":
            summary = {k: (CHANGES_HEAD[k] + v if v else v) for k, v in summary.items()}
            for line in timeline:
                line["da"] = CHANGES_HEAD["da"] + line["da"] if line["da"] else line["da"]
                line["en"] = CHANGES_HEAD["en"] + line["en"] if line["en"] else line["en"]
        if summary["da"] or summary["en"]:
            entry["summary"] = summary
        relations = _relations(raw.get("relations", []))
        if relations:
            entry["relations"] = relations
        if timeline:
            entry["timeline"] = timeline
        if not ("summary" in entry or relations or timeline):
            continue  # nothing to add: no page, and no question for the check page
        if kind in NAMED_KINDS and not is_confirmed(name, ctx.confirmed):
            held.append({"kind": kind, "name": name, "reason": "the name is not confirmed yet (names and facts to check)"})
            checks["names"].append(_check_name(raw, ctx, name, cites))
            continue
        entries.append(entry)
    _fact_claims(ctx, result.get("claims", []), checks, hints)
    return {
        "session": ctx.session.name,
        "label": ctx.label,
        "switch": switch,
        "sources": {
            "remember_items": len(ctx.remember),
            "transcript_lines": len(ctx.lines),
            "chat_messages": len(ctx.chat),
            "foundry_facts": len(ctx.foundry),
        },
        "entries": entries,
        "held": held,
        "checks": checks,
        "hints": hints,
        "dropped_timeline_lines": dropped,
        "next": (
            "Call plan-campaign-merge with `entries`. Additions apply at once only when the GM's "
            "'apply additions without confirming' switch is on in Foundry; otherwise confirm the "
            "plan. Held entries wait for the names and facts to check page: answer it, run "
            "`session_notes check` and `session_notes campaign` again."
        ),
    }


# --- writing -------------------------------------------------------------------------------------


def write_plan(session: Path, plan: dict[str, Any]) -> list[Path]:
    """``notes/campaign-merge.json`` (the entries for the tool) and ``campaign-checks.json`` (what
    ``check.sync`` adds to the check page); a readable page for the person who reviews it."""
    notes = session / "notes"
    notes.mkdir(parents=True, exist_ok=True)
    out = []
    path = notes / PLAN_FILE
    path.write_text(json.dumps(plan, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    out.append(path)
    checks = session / CHECKS_FILE
    checks.write_text(json.dumps(plan["checks"], ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    out.append(checks)
    page = notes / "Campaign merge plan.en.md"
    page.write_text(render(plan), encoding="utf-8", newline="\n")
    out.append(page)
    return out


def render(plan: dict[str, Any]) -> str:
    lines = [f"# Campaign merge plan: {plan['label']}", ""]
    on = "on: additions for known names apply at once" if plan.get("switch") else "off: the whole merge is a plan to confirm"
    lines += [f"The additions switch is {on}.", "", "## Goes to the campaign pages", ""]
    for e in plan["entries"]:
        count = len(e.get("timeline", []))
        lines.append(f"- **{e['kind']} / {e['name']}**: {count} timeline line(s)"
                     + (", summary" if e.get("summary") else "")
                     + (f", {len(e['relations'])} relation(s)" if e.get("relations") else ""))
    if not plan["entries"]:
        lines.append("- nothing")
    lines += ["", "## Waiting for a confirmed name", ""]
    lines += [f"- {h['kind']} / {h['name']}: {h['reason']}" for h in plan["held"]] or ["- nothing"]
    lines += ["", "## Sent to the check page", ""]
    for n in plan["checks"]["names"]:
        lines.append(f"- name: {n['key']}")
    for f in plan["checks"]["facts"]:
        lines.append(f"- fact: {f['key']}")
    if not (plan["checks"]["names"] or plan["checks"]["facts"]):
        lines.append("- nothing")
    if plan["hints"]:
        lines += ["", "## Hints only (Foundry owns these)", ""]
        lines += [f"- {h['about']}: {h['field']} \"{h['value']}\"" for h in plan["hints"]]
    lines.append("")
    return "\n".join(lines)


def pending_entries(session: Path) -> list[Any]:
    """The names and facts the last campaign plan put on the check page, as ``check.Entry`` objects."""
    from .check import Entry

    path = session / CHECKS_FILE
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except ValueError:
        return []
    out: list[Any] = []
    for n in data.get("names", []):
        out.append(
            Entry(
                kind="name",
                key=n["key"],
                variants=list(n.get("variants") or [n["key"]]),
                count=int(n.get("count", 1)),
                where=[(str(i), float(s)) for i, s in n.get("where", [])],
            )
        )
    for f in data.get("facts", []):
        out.append(
            Entry(
                kind="fact",
                key=f["key"],
                note_en=f.get("note_en", ""),
                note_da=f.get("note_da", ""),
                suggestion=f.get("suggestion", ""),
            )
        )
    return out


def run(
    session: Path,
    runner: Runner,
    *,
    model: str = "sonnet",
    effort: str = "medium",
    label: str | None = None,
    chat: Path | None = None,
    facts: Path | None = None,
    switch: bool = False,
) -> CampaignResult:
    """Build and write the merge plan, then refresh the check page. A usage limit pauses it."""
    from . import check

    ctx = build_context(session, label, chat, facts)
    try:
        result = ask_claude(ctx, runner, model, effort)
    except UsageLimitError as exc:
        return CampaignResult({}, paused=str(exc), login_needed=type(exc).__name__ == "AuthError")
    plan = build_plan(ctx, result, switch)
    write_plan(session, plan)
    check.sync(session)
    return CampaignResult(plan)
