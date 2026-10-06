"""Sum Claude Code token usage per session since the weekly reset.

Usage: python scripts/dev/usage-report.py [since, default the last weekly reset]. Cost units are relative (API list-price ratios): input 1, output 5, cache read 0.1,
cache write 5 min 1.25, cache write 1 h 2; Sonnet x0.6, Haiku x0.2 of Opus.

Cost analysis (this repo's project folder only, main thread and subagents apart, one count per API response):
  --curve      cost per request by context size (buckets and a least-squares fit)
  --startup    what a fresh session costs in its first hour
  --breakeven  when a handover to a fresh session pays off, and what cache expiry cost
  --all        all three; --json FILE writes the numbers (implies --all); --since TS (default 2026-09-28);
  --project SUBSTR (default Foundry-VTT-AI-Tool); --reread K (re-read tokens in a fresh session, default measured)
"""
import json, os, sys, glob, collections, statistics, datetime

ROOT = os.path.expanduser(r"~\.claude\projects")
_VAL = ("--json", "--since", "--project", "--reread")
_A = sys.argv[1:]
_POS = [a for i, a in enumerate(_A) if not a.startswith("--") and not (i and _A[i - 1] in _VAL)]
def _opt(name, default=None):
    return _A[_A.index(name) + 1] if name in _A and _A.index(name) + 1 < len(_A) else default
MODES = {m for m in ("curve", "startup", "breakeven") if "--" + m in _A}
if "--all" in _A or "--json" in _A:
    MODES = {"curve", "startup", "breakeven"}
SINCE = _opt("--since") or (_POS[0] if _POS else ("2026-09-28T00:00:00" if MODES else "2026-10-03T05:00:00"))
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

def parts(u, model):
    """Cost split into input/output/cache read/cache write, same weights as cost()."""
    cc = u.get("cache_creation") or {}
    w1h = cc.get("ephemeral_1h_input_tokens", 0) or 0
    w5m = cc.get("ephemeral_5m_input_tokens", 0) or 0
    if not (w1h or w5m):
        w1h = u.get("cache_creation_input_tokens", 0) or 0
    m = mult(model) / 1e6
    return {"inp": (u.get("input_tokens", 0) or 0) * m, "out": (u.get("output_tokens", 0) or 0) * 5 * m,
            "cr": (u.get("cache_read_input_tokens", 0) or 0) * 0.1 * m, "cw": (w5m * 1.25 + w1h * 2) * m}, w5m, w1h

def epoch(ts):
    return datetime.datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()

def load(project):
    """Every assistant response with usage in the project's transcripts, one per message id.
    Returns (records, stats). A record is one API response (streamed blocks share a message id)."""
    occ, st = {}, collections.Counter()
    for path in glob.glob(os.path.join(ROOT, "**", "*.jsonl"), recursive=True):
        parts_ = os.path.relpath(path, ROOT).split(os.sep)
        if project.lower() not in parts_[0].lower():
            continue
        sid = parts_[1].replace(".jsonl", "")
        sub = len(parts_) > 2
        best = {}
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
                msg = d.get("message") or {}
                u = msg.get("usage")
                if d.get("type") != "assistant" or not u or not d.get("timestamp"):
                    continue
                model = msg.get("model", "?")
                p, w5m, w1h = parts(u, model)
                ctx = sum(u.get(k, 0) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
                if ctx == 0 and not u.get("output_tokens"):
                    st["empty_skipped"] += 1
                    continue
                mid = msg.get("id") or d.get("requestId") or d.get("uuid")
                r = {"sid": sid, "agent": parts_[-1] if sub else None, "sub": sub, "ts": d["timestamp"],
                     "t": epoch(d["timestamp"]), "model": model, "ctx": ctx, "p": p, "c": sum(p.values()),
                     "cr": u.get("cache_read_input_tokens", 0) or 0, "w5m": w5m, "w1h": w1h,
                     "nobd": not ((u.get("cache_creation") or {}).get("ephemeral_1h_input_tokens") or
                                  (u.get("cache_creation") or {}).get("ephemeral_5m_input_tokens")),
                     "out": u.get("output_tokens", 0) or 0}
                if mid in best:
                    st["dup_blocks"] += 1
                    if r["out"] <= best[mid]["out"]:
                        continue
                best[mid] = r
        if best:
            first = min(r["ts"] for r in best.values())
            for mid, r in best.items():
                occ.setdefault(mid, []).append((first, path, r))
    recs, forked = [], set()
    for lst in occ.values():
        lst.sort(key=lambda x: (x[0], x[1]))
        recs.append(lst[0][2])
        for _, _, r in lst[1:]:
            forked.add(r["sid"]); st["dup_files"] += 1
    st["forked_sessions"] = len(forked)
    return recs, forked, st

def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None

def mean(xs):
    return sum(xs) / len(xs) if xs else None

def ols(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    syy = sum((y - my) ** 2 for y in ys)
    b = sxy / sxx if sxx else 0.0
    return {"slope_per_100k": b * 1e5, "slope_per_token": b, "intercept": my - b * mx,
            "r2": (sxy * sxy / (sxx * syy)) if sxx and syy else 0.0, "n": n}

def is_cold(r):
    return r["cr"] < 0.5 * r["ctx"]

def analyse(recs, forked, st, project, reread):
    out = {"since": SINCE, "project": project}
    allrecs = recs
    recs = [r for r in recs if r["ts"] >= SINCE]
    main = [r for r in recs if not r["sub"]]
    # summary: main thread and subagents apart
    summ = {}
    for label, grp in (("main", main), ("subagent", [r for r in recs if r["sub"]])):
        bym = collections.defaultdict(list)
        for r in grp:
            bym[r["model"]].append(r)
        summ[label] = {m: {"requests": len(v), "cost": round(sum(r["c"] for r in v), 2),
                           "mean_ctx": round(mean([r["ctx"] for r in v]))} for m, v in bym.items()}
        summ[label + "_total"] = {"requests": len(grp), "cost": round(sum(r["c"] for r in grp), 2)}
    sa = collections.defaultdict(list)
    for r in recs:
        if r["sub"]:
            sa[(r["sid"], r["agent"])].append(r)
    for v in sa.values():
        v.sort(key=lambda r: r["t"])
    summ["subagent_runs"] = {"count": len(sa), "median_requests": med([len(v) for v in sa.values()]),
                             "median_first_ctx": med([v[0]["ctx"] for v in sa.values()]),
                             "median_cost": round(med([sum(r["c"] for r in v) for v in sa.values()]) or 0, 3)}
    w5 = sum(r["w5m"] for r in recs); w1 = sum(r["w1h"] for r in recs)
    summ["cache_write_tokens"] = {"5m": w5, "1h": w1, "records_without_ttl_split": sum(1 for r in recs if r["nobd"])}
    summ["data"] = dict(st, records_in_period=len(recs), main_sessions=len({r["sid"] for r in main}))
    out["summary"] = summ
    opus = [r for r in main if "opus" in r["model"]]
    # 1. cost per request by context size
    edges = [0, 50e3, 100e3, 150e3, 200e3, 250e3, 300e3, 400e3, 500e3, 600e3, 800e3, float("inf")]
    cur = {"buckets": []}
    for lo, hi in zip(edges, edges[1:]):
        g = [r for r in opus if lo <= r["ctx"] < hi]
        if not g:
            continue
        tot = sum(r["c"] for r in g)
        warm = [r["c"] for r in g if not is_cold(r)]
        cur["buckets"].append({
            "range": f"{lo/1e3:.0f}k-{'' if hi == float('inf') else format(hi/1e3, '.0f') + 'k'}", "n": len(g),
            "median": med([r["c"] for r in g]), "mean": mean([r["c"] for r in g]), "warm_mean": mean(warm),
            "cold_pct": 100 * (len(g) - len(warm)) / len(g), "total": tot,
            **{"share_" + k: 100 * sum(r["p"][k] for r in g) / tot for k in ("cr", "cw", "out", "inp")}})
    cur["fit_all"] = ols([r["ctx"] for r in opus], [r["c"] for r in opus])
    wr = [r for r in opus if not is_cold(r)]
    cur["fit_warm"] = ols([r["ctx"] for r in wr], [r["c"] for r in wr])
    out["curve"] = cur
    fit = cur["fit_warm"] or {"slope_per_token": 1e-7, "intercept": 0.0}
    warm_cost = lambda ctx: fit["intercept"] + fit["slope_per_token"] * ctx
    # 2. startup of a fresh session
    bysess = collections.defaultdict(list)
    for r in main:
        bysess[r["sid"]].append(r)
    first_seen = {}
    for r in allrecs:
        if not r["sub"]:
            first_seen[r["sid"]] = min(first_seen.get(r["sid"], r["ts"]), r["ts"])
    rows = []
    for sid, v in bysess.items():
        v.sort(key=lambda r: r["t"])
        if sid in forked or len(v) < 2 or "opus" not in v[0]["model"] or first_seen.get(sid, "") < SINCE:
            continue
        t0 = v[0]["t"]
        h = [r for r in v if r["t"] - t0 <= 3600]
        n20 = v[:20]
        d = [b["ctx"] - a["ctx"] for a, b in zip(v, v[1:])]
        rows.append({
            "sid": sid, "n": len(v), "ctx1": v[0]["ctx"], "cr1": v[0]["cr"], "cost1": v[0]["c"], "cw1_cost": v[0]["p"]["cw"],
            "n60": len(h), "cost60": sum(r["c"] for r in h),
            "cost20": sum(r["c"] for r in n20) if len(v) >= 20 else None,
            "cw20_cost": sum(r["p"]["cw"] for r in n20) if len(v) >= 20 else None,
            "ctx_1h": h[-1]["ctx"] if v[-1]["t"] - t0 >= 3600 else None,
            "d10": v[9]["ctx"] - v[0]["ctx"] if len(v) >= 10 else None,
            "d20": v[19]["ctx"] - v[0]["ctx"] if len(v) >= 20 else None,
            "growth": sum(x for x in d if x > 0) / len(d) if len(v) >= 20 else None,
            "premium": v[0]["c"] - warm_cost(v[0]["ctx"])})
    keys = ("ctx1", "cr1", "cost1", "cw1_cost", "n60", "cost60", "cost20", "cw20_cost", "ctx_1h", "d10", "d20", "growth", "premium")
    stp = {"sessions": len(rows), **{"median_" + k: med([x[k] for x in rows]) for k in keys},
           "with_1h_data": sum(1 for x in rows if x["ctx_1h"] is not None), "with_20_requests": sum(1 for x in rows if x["cost20"] is not None)}
    pooled = [b["ctx"] - a["ctx"] for v in bysess.values() for a, b in zip(v, v[1:]) if b["ctx"] >= a["ctx"]]
    stp["pooled_mean_growth"] = sum(pooled) / max(1, sum(len(v) - 1 for v in bysess.values()))
    out["startup"] = stp
    # 3. break-even
    S = stp["median_ctx1"] or 0
    R = reread if reread is not None else (stp["median_d10"] or 0)
    g = stp["median_growth"] or stp["pooled_mean_growth"]
    E = max(0.0, stp["median_premium"] or 0.0) + R * 2 / 1e6
    prem = max(0.0, stp["median_premium"] or 0.0)
    def saving(C, n, R=R):  # cost continuing minus cost starting fresh over n requests (fresh pays its one-off cost once)
        return sum(warm_cost(C + g * i) - warm_cost(S + R + g * i) for i in range(1, n + 1)) - (prem + R * 2 / 1e6)
    be = {"S": S, "reread": R, "growth": g, "one_off_cost": E, "table": []}
    for C in (150e3, 200e3, 250e3, 300e3, 400e3, 600e3, 800e3):
        n = next((n for n in range(1, 5001) if saving(C, n) >= 0), None)
        be["table"].append({"ctx": C, "break_even_requests": n, "saving_50": saving(C, 50),
                            "saving_100": saving(C, 100), "saving_200": saving(C, 200)})
    be["pays_off_at_ctx"] = {}
    for W in (50, 100, 200):
        be["pays_off_at_ctx"][W] = next((C for C in range(int(S + R) + 1000, 1_000_000, 1000) if saving(C, W) >= 0), None)
    be["sensitivity"] = [{"reread": R_, "break_even_at": {int(C / 1e3): next((n for n in range(1, 5001) if saving(C, n, R_) >= 0), None)
                          for C in (250e3, 400e3, 600e3)},
                          "pays_off_100": next((C for C in range(int(S + R_) + 1000, 1_000_000, 1000) if saving(C, 100, R_) >= 0), None)}
                         for R_ in (0, 50e3, 100e3, 150e3)]
    gaps = collections.defaultdict(list)
    for v in bysess.values():
        for a, b in zip(v, v[1:]):
            if "opus" in b["model"]:
                gaps["<=5 min" if b["t"] - a["t"] <= 300 else "5-60 min" if b["t"] - a["t"] <= 3600 else ">60 min"].append(b)
    ex = {}
    for k in ("<=5 min", "5-60 min", ">60 min"):
        g_ = gaps.get(k, [])
        cold = [r for r in g_ if is_cold(r)]
        ex[k] = {"n": len(g_), "cold": len(cold), "cold_pct": 100 * len(cold) / max(1, len(g_)),
                 "mean_cost": mean([r["c"] for r in g_]),
                 "excess_total": sum(r["c"] - warm_cost(r["ctx"]) for r in cold)}
    tot = sum(r["c"] for r in opus)
    be["cache_expiry"] = {"by_gap": ex, "excess_total": sum(x["excess_total"] for x in ex.values()),
                          "share_of_main_opus_cost_pct": 100 * sum(x["excess_total"] for x in ex.values()) / tot if tot else 0.0,
                          "first_requests_cold": sum(1 for v in bysess.values() if is_cold(v[0]))}
    out["breakeven"] = be
    return out

def report(o):
    L = []
    s = o["summary"]
    L.append(f"Claude Code cost report, project '{o['project']}', since {o['since']} (units: 1 = one million Opus input tokens)")
    L.append("\nMain thread vs subagents (cost / requests / mean context):")
    for lab in ("main", "subagent"):
        t = s[lab + "_total"]
        L.append(f"  {lab:9s} total {t['cost']:8.1f} units, {t['requests']:6d} requests")
        for m, v in sorted(s[lab].items(), key=lambda kv: -kv[1]["cost"]):
            L.append(f"      {m:28s} {v['cost']:8.1f} {v['requests']:6d} req  mean ctx {v['mean_ctx']/1e3:5.0f}k")
    r = s["subagent_runs"]
    L.append(f"  subagent runs {r['count']}: median {r['median_requests']} requests, first ctx {r['median_first_ctx']/1e3:.0f}k, cost {r['median_cost']}")
    L.append(f"  cache write tokens: 5m {s['cache_write_tokens']['5m']/1e6:.1f}M, 1h {s['cache_write_tokens']['1h']/1e6:.1f}M "
             f"(no TTL split in {s['cache_write_tokens']['records_without_ttl_split']} records, counted as 1h)")
    L.append("  data: " + ", ".join(f"{k} {v}" for k, v in s["data"].items()))
    if "curve" in MODES:
        c = o["curve"]
        L.append("\n1. Cost per request by context size (main thread, Opus; cold = cache read < half the context)")
        L.append("  context      n   median    mean  warm mean  cold%  | share of cost: read  write   out  input")
        for b in c["buckets"]:
            L.append(f"  {b['range']:9s} {b['n']:5d} {b['median']:8.4f} {b['mean']:7.4f} {b['warm_mean'] or 0:9.4f} {b['cold_pct']:6.1f}  |"
                     f"  {b['share_cr']:11.0f}% {b['share_cw']:5.0f}% {b['share_out']:4.0f}% {b['share_inp']:5.0f}%")
        for k, lab in (("fit_all", "all requests"), ("fit_warm", "warm requests only")):
            f = c[k]
            if f:
                L.append(f"  fit ({lab}, n={f['n']}): cost = {f['intercept']:.5f} + {f['slope_per_100k']:.5f} per 100k context, R2 {f['r2']:.2f}")
    if "startup" in MODES:
        t = o["startup"]
        L.append(f"\n2. Startup of a fresh session (main thread, Opus, {t['sessions']} sessions, not forked; medians)")
        L.append(f"  first request: context {t['median_ctx1']/1e3:.0f}k (of which cache read {t['median_cr1']/1e3:.0f}k), "
                 f"cost {t['median_cost1']:.3f}, cache write cost {t['median_cw1_cost']:.3f}")
        L.append(f"  first 60 min: {t['median_n60']:.0f} requests, cost {t['median_cost60']:.2f}; context after 1 h {((t['median_ctx_1h'] or 0)/1e3):.0f}k "
                 f"({t['with_1h_data']} sessions lasted 1 h)")
        L.append(f"  first 20 requests: cost {t['median_cost20'] or 0:.2f}, of which cache write {t['median_cw20_cost'] or 0:.2f} ({t['with_20_requests']} sessions with 20+)")
        L.append(f"  context added in first 10 / 20 requests: {(t['median_d10'] or 0)/1e3:.0f}k / {(t['median_d20'] or 0)/1e3:.0f}k; "
                 f"growth per request: median per session {(t['median_growth'] or 0)/1e3:.1f}k, pooled mean {t['pooled_mean_growth']/1e3:.1f}k")
        L.append(f"  startup premium (first request cost minus a warm request at that context): {t['median_premium']:.4f}")
    if "breakeven" in MODES:
        b = o["breakeven"]
        L.append(f"\n3. Break-even: continue at context C, or hand over to a fresh session (warm-fit cost curve)")
        L.append(f"  fresh start: prefix S {b['S']/1e3:.0f}k, re-read {b['reread']/1e3:.0f}k, growth {b['growth']/1e3:.1f}k per request, one-off cost {b['one_off_cost']:.3f}")
        L.append("  context C   requests until fresh is cheaper | saving over 50 / 100 / 200 further requests")
        for r_ in b["table"]:
            n = r_["break_even_requests"]
            L.append(f"  {r_['ctx']/1e3:7.0f}k   {('never' if n is None else str(n)):>10s}                       | "
                     f"{r_['saving_50']:7.2f} {r_['saving_100']:7.2f} {r_['saving_200']:7.2f}")
        L.append("  handover pays off above context: " + ", ".join(
            f"{w} requests left: {(v / 1e3 if v else float('nan')):.0f}k" for w, v in b["pays_off_at_ctx"].items()))
        L.append("  sensitivity to the re-read size (requests until fresh is cheaper at C = 250k / 400k / 600k; context where a handover pays off with 100 requests left):")
        for x in b["sensitivity"]:
            L.append(f"    re-read {x['reread']/1e3:4.0f}k: " + " / ".join(str(v) if v else "never" for v in x["break_even_at"].values())
                     + f"; pays off above {(x['pays_off_100'] or 0)/1e3:.0f}k")
        e = b["cache_expiry"]
        L.append("  cache expiry (main Opus requests by gap to the previous request; excess = cost above a warm request):")
        L.append("    gap          requests   cold  cold%  mean cost  excess total")
        for k, v in e["by_gap"].items():
            L.append(f"    {k:9s} {v['n']:9d} {v['cold']:6d} {v['cold_pct']:6.1f} {v['mean_cost'] or 0:10.4f} {v['excess_total']:12.2f}")
        L.append(f"    total excess {e['excess_total']:.2f} units = {e['share_of_main_opus_cost_pct']:.1f}% of main Opus cost; "
                 f"sessions whose first request was cold: {e['first_requests_cold']}")
    return "\n".join(L)

if MODES:
    project = _opt("--project", "Foundry-VTT-AI-Tool")
    recs_all, forked, st = load(project)
    o = analyse(recs_all, forked, st, project, float(_opt("--reread")) if _opt("--reread") else None)
    print(report(o))
    if _opt("--json"):
        with open(_opt("--json"), "w", encoding="utf-8", newline="") as fh:
            json.dump(o, fh, indent=1)
    sys.exit(0)

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
