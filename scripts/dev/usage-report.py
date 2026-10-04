"""Sum Claude Code token usage per session since the weekly reset.

Usage: python scripts/dev/usage-report.py [since, default the last weekly reset]. Cost units are relative (API list-price ratios): input 1, output 5, cache read 0.1,
cache write 5 min 1.25, cache write 1 h 2; Sonnet x0.6, Haiku x0.2 of Opus.
"""
import json, os, sys, glob, collections

ROOT = os.path.expanduser(r"~\.claude\projects")
SINCE = sys.argv[1] if len(sys.argv) > 1 else "2026-10-03T05:00:00"
MODEL_MULT = {"opus": 1.0, "sonnet": 0.6, "haiku": 0.2, "fable": 1.0}

def mult(model):
    for k, v in MODEL_MULT.items():
        if k in (model or ""):
            return v
    return 1.0

def cost(u, model):
    cc = u.get("cache_creation") or {}
    w1h = cc.get("ephemeral_1h_input_tokens", 0) or 0
    w5m = cc.get("ephemeral_5m_input_tokens", 0) or 0
    total_w = u.get("cache_creation_input_tokens", 0) or 0
    if not (w1h or w5m):
        w1h = total_w
    c = (u.get("input_tokens", 0) or 0) * 1 + (u.get("output_tokens", 0) or 0) * 5 \
        + (u.get("cache_read_input_tokens", 0) or 0) * 0.1 + w5m * 1.25 + w1h * 2
    return c * mult(model) / 1e6

sessions = {}
for path in glob.glob(os.path.join(ROOT, "**", "*.jsonl"), recursive=True):
    if os.path.getmtime(path) < 0:
        continue
    rel = os.path.relpath(path, ROOT)
    parts = rel.split(os.sep)
    # top-level session id: <project>/<session>.jsonl or <project>/<session>/subagents/x.jsonl
    sess = parts[1].replace(".jsonl", "")
    key = (parts[0][-40:], sess)
    s = sessions.setdefault(key, {"first": None, "last": None, "title": "", "seen": set(),
                                  "models": collections.Counter(), "tok": collections.Counter(),
                                  "cost": 0.0, "sub_cost": 0.0, "days": collections.Counter(),
                                  "n": 0, "ctx": 0, "max": 0})
    is_sub = len(parts) > 2
    try:
        f = open(path, encoding="utf-8")
    except OSError:
        continue
    with f:
        for line in f:
            try:
                d = json.loads(line)
            except ValueError:
                continue
            ts = d.get("timestamp", "")
            if not s["title"] and d.get("type") == "user" and not is_sub:
                m = d.get("message", {}).get("content")
                if isinstance(m, str):
                    s["title"] = m[:90].replace("\n", " ")
                elif isinstance(m, list):
                    for b in m:
                        if isinstance(b, dict) and b.get("type") == "text":
                            s["title"] = b["text"][:90].replace("\n", " ")
                            break
            msg = d.get("message") or {}
            u = msg.get("usage")
            if not u or ts < SINCE:
                continue
            mid = msg.get("id") or d.get("uuid")
            if mid in s["seen"]:
                continue
            s["seen"].add(mid)
            model = msg.get("model", "?")
            c = cost(u, model)
            s["cost"] += c
            if not is_sub:
                ctx = sum(u.get(k, 0) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
                s["n"] += 1; s["ctx"] += ctx; s["max"] = max(s["max"], ctx)
            if is_sub:
                s["sub_cost"] += c
            s["models"][model] += c
            s["days"][ts[:10]] += c
            for k in ("input_tokens", "output_tokens", "cache_read_input_tokens",
                      "cache_creation_input_tokens"):
                s["tok"][k] += u.get(k, 0) or 0
            s["first"] = min(filter(None, [s["first"], ts]))
            s["last"] = max(filter(None, [s["last"], ts]))

rows = [(k, v) for k, v in sessions.items() if v["cost"] > 0]
rows.sort(key=lambda kv: -kv[1]["cost"])
total = sum(v["cost"] for _, v in rows)
print(f"since {SINCE}: total {total:.1f} units over {len(rows)} sessions")
models = collections.Counter()
days = collections.Counter()
for _, v in rows:
    models.update(v["models"]); days.update(v["days"])
print("by model:", {k: round(x, 1) for k, x in models.most_common()})
print("by day:", {k: round(x, 1) for k, x in sorted(days.items())})
for (proj, sess), v in rows[:30]:
    t = v["tok"]
    print(f"{v['cost']:7.1f} ({v['cost']/total*100:4.1f}%) sub {v['sub_cost']:6.1f} "
          f"{v['first'][5:16]}..{v['last'][5:16]} {sess[:8]} "
          f"{v['n']:5d} req avg {v['ctx']/max(v['n'],1)/1e3:4.0f}k max {v['max']/1e3:4.0f}k "
          f"out {t['output_tokens']/1e3:6.0f}k cr {t['cache_read_input_tokens']/1e6:6.1f}M "
          f"cw {t['cache_creation_input_tokens']/1e6:5.1f}M | {v['title'][:70]}")
