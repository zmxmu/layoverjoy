#!/usr/bin/env python3
"""
Nosana vLLM 流式基准（流式实施任务 §10.2/§10.3）。

对固定 fixture 逐个发 stream=true 请求，记录：
首 token 延迟、首个完整 NDJSON 区块延迟、总耗时、输出字符数、
7 个区块的 Schema 是否有效、是否需要降级。

只读环境：不写任何项目文件；发送的事实里没有 PII。
用法：
  python3 scripts/nosana-stream-bench.py                 # 新 1.5B 部署
  python3 scripts/nosana-stream-bench.py --endpoint URL --model ID
"""
import argparse
import json
import statistics
import sys
import time
import urllib.request

NEW_ENDPOINT = "https://2F4cK5iT3Kngu4ayvM4ETKBq153chTkG7Xa7sASMg4jM.node.k8s.prd.nos.ci"

SECTIONS = [
    "cityAdvantages",
    "interestMatch",
    "scheduleFit",
    "miniItinerary",
    "convenience",
    "travelerGains",
    "travelerAccepts",
]

SYSTEM_PROMPT = "\n".join(
    [
        "You are the LayoverJoy stopover experience editor, not a flight, price or visa decision maker.",
        "Output format: one complete standalone JSON object per line (NDJSON), 7 lines in this exact order, "
        "no line breaks inside a line, no code fences, no prose before or after:",
        '{"section":"cityAdvantages","text":"..."}',
        '{"section":"interestMatch","text":"..."}',
        '{"section":"scheduleFit","text":"..."}',
        '{"section":"miniItinerary","items":["...","..."]}',
        '{"section":"convenience","score":88,"reasons":["...","..."]}',
        '{"section":"travelerGains","items":["...","..."]}',
        '{"section":"travelerAccepts","items":["...","..."]}',
        "items and reasons must be arrays of plain strings (never nested objects or arrays of objects); "
        "2-3 entries each, each entry under 90 characters; each text under 120 characters.",
        "Hard rules: use only cityEvidence and feasibleExperienceBlocks from the input; never invent sights, "
        "transit durations or opening hours; never mention amounts, fares, currency or savings; never restate "
        "stay days, usable hours or JoyScore; visa conclusions come from the local rule engine — never re-judge "
        "policy; the convenience score is supplied by the system, you only write reasons; never output reasoning "
        "steps, model names, vendors, GPU or deployment details; emit each section exactly once.",
        "Language: English only, concise and decision-useful, no marketing filler.",
    ]
)


def facts(city, arrival, departure, same_airport, ease, evidence, blocks, interests, risks, eligibility):
    """与后端 buildInsightFacts 同口径的匿名事实（无 PII、无金额、无分钟数）。"""
    return {
        "city": {"nameEn": city},
        "schedule": {
            "arrivalPeriod": arrival,
            "departurePeriod": departure,
            "sameAirport": same_airport,
            "arrivalAirport": blocks[0]["airport"],
            "departureAirport": blocks[0]["airport"],
            "confidence": "HIGH",
        },
        "ease": {"score": ease, "level": "EASY" if ease >= 80 else "PLAN_CAREFULLY"},
        "cityEvidence": [{"evidenceKey": k, "titleEn": t} for k, t in evidence],
        "feasibleExperienceBlocks": [
            {"evidenceKey": b["key"], "titleEn": b["title"], "areaEn": b["area"], "slot": b["slot"]} for b in blocks
        ],
        "matchedInterests": interests,
        "riskFlags": risks,
        "eligibilityDisplayStatus": eligibility,
    }


FIXTURES = {
    # Demo 主线：HKG → BKK → ZRH
    "HKG-BKK-ZRH": facts(
        "Bangkok", "MORNING", "MORNING", True, 83,
        [("BKK_STREET_FOOD", "Deep street-food scene"), ("BKK_RIVER_TEMPLES", "River temples and old town")],
        [
            {"key": "BKK_NIGHT_MARKET", "title": "Night market block", "area": "Siam / Silom", "slot": "ARRIVAL_DAY", "airport": "BKK"},
            {"key": "BKK_GRAND_PALACE", "title": "River temples day", "area": "Grand Palace", "slot": "FULL_DAY", "airport": "BKK"},
        ],
        ["FOOD", "LOCAL_CULTURE"], ["SEPARATE_TICKETS", "RECHECK_BAGGAGE"], "READY",
    ),
    "SIN-KUL-PVG": facts(
        "Kuala Lumpur", "EVENING", "EVENING", True, 76,
        [("KUL_FOOD_DIVERSITY", "Layered food cultures"), ("KUL_CITY_CORE", "Compact city core")],
        [
            {"key": "KUL_JALAN_ALOR", "title": "Street food lane", "area": "Bukit Bintang", "slot": "ARRIVAL_DAY", "airport": "KUL"},
            {"key": "KUL_BATU_CAVES", "title": "Cave temple morning", "area": "Batu Caves", "slot": "FULL_DAY", "airport": "KUL"},
        ],
        ["FOOD"], ["SEPARATE_TICKETS"], "READY",
    ),
    "HKG-SIN-LHR": facts(
        "Singapore", "AFTERNOON", "LATE_NIGHT", True, 91,
        [("SIN_AIRPORT_CITY", "Fast airport-to-core rail"), ("SIN_HAWKER", "Hawker centre culture")],
        [
            {"key": "SIN_MARINA", "title": "Waterfront evening", "area": "Marina Bay", "slot": "ARRIVAL_DAY", "airport": "SIN"},
            {"key": "SIN_KAMPONG_GLAM", "title": "Heritage quarter walk", "area": "Kampong Glam", "slot": "FULL_DAY", "airport": "SIN"},
        ],
        ["WALKING", "FOOD"], [], "READY",
    ),
    "PVG-HKG-BKK": facts(
        "Hong Kong", "LATE_NIGHT", "EARLY_MORNING", True, 54,
        [("HKG_HARBOUR", "Harbour skyline"), ("HKG_DIM_SUM", "Dim sum tradition")],
        [
            {"key": "HKG_TST", "title": "Harbourfront night", "area": "Tsim Sha Tsui", "slot": "ARRIVAL_DAY", "airport": "HKG"},
            {"key": "HKG_CENTRAL", "title": "Central and mid-levels", "area": "Central", "slot": "FULL_DAY", "airport": "HKG"},
        ],
        ["FOOD"], ["SEPARATE_TICKETS", "RED_EYE_SEGMENTS"], "NEEDS_REVIEW",
    ),
    "CAN-SGN-CDG": facts(
        "Ho Chi Minh City", "MORNING", "EVENING", True, 68,
        [("SGN_COFFEE", "Coffee culture"), ("SGN_MARKETS", "Dense market streets")],
        [
            {"key": "SGN_DISTRICT1", "title": "District 1 walk", "area": "District 1", "slot": "ARRIVAL_DAY", "airport": "SGN"},
            {"key": "SGN_CHOLON", "title": "Cholon market day", "area": "Cholon", "slot": "FULL_DAY", "airport": "SGN"},
        ],
        ["FOOD", "LOCAL_CULTURE"], ["SEPARATE_TICKETS"], "CONDITIONAL",
    ),
}

MONEY_HINTS = ("SGD", "USD", "THB", "$", "€", "¥")
TECH_HINTS = ("nosana", "qwen", "gpu", "deployment", "vllm")


def resolve_model(endpoint):
    started = time.monotonic()
    req = urllib.request.Request(f"{endpoint}/v1/models")
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read().decode()
        data = json.loads(body)
        ids = [d.get("id") for d in data.get("data", []) if d.get("id")]
        root = data.get("data", [{}])[0].get("root")
        return {
            "status": resp.status,
            "ids": ids,
            "root": root,
            "max_model_len": data.get("data", [{}])[0].get("max_model_len"),
            "latency_ms": round((time.monotonic() - started) * 1000),
        }


GUIDED_KEYS = {
    "cityAdvantages": "cityAdvantages",
    "interestMatch": "interestMatch",
    "scheduleFit": "scheduleFit",
    "miniItinerary": "miniItinerary",
    "convenienceReasons": "convenience",
    "travelerGains": "travelerGains",
    "travelerAccepts": "travelerAccepts",
}

# 与后端 guidedInsightSchema() 一致：切勿加 minLength/maxLength（会把总耗时从 ~8s 拉到 ~28s）
GUIDED_SCHEMA = {
    "type": "object",
    "properties": {
        "cityAdvantages": {"type": "string"},
        "interestMatch": {"type": "string"},
        "scheduleFit": {"type": "string"},
        "miniItinerary": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 3},
        "convenienceReasons": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 3},
        "travelerGains": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2},
        "travelerAccepts": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 2},
    },
    "required": list(GUIDED_KEYS),
    "additionalProperties": False,
}

GUIDED_SYSTEM = "\n".join(
    [
        "You are the LayoverJoy stopover experience editor, not a flight, price or visa decision maker.",
        "Output one JSON object. Field meanings:",
        "cityAdvantages: why this city is worth the stop; interestMatch: how it ties to the traveler interest tags; "
        "scheduleFit: whether the arrival and departure periods create a workable rhythm; miniItinerary: 2-3 executable "
        "blocks; convenienceReasons: 2-3 grounds for the transfer ease; travelerGains: what the traveler gets; "
        "travelerAccepts: the objective costs they must accept.",
        "Hard rules: use only cityEvidence and feasibleExperienceBlocks from the input; never invent sights, transit "
        "durations, opening hours or city facts; never mention amounts, fares, currency or savings; never restate stay "
        "days, usable hours, JoyScore or the convenience score; visa and entry conclusions come from the local rule "
        "engine \u2014 you may only explain eligibilityDisplayStatus, never re-judge policy and never promise admission; "
        "never output reasoning steps, self-description, model names, vendors, GPU or deployment details.",
        "Language: English only, concrete and decision-useful, no marketing filler.",
    ]
)


def coerce_item(raw):
    """与后端 coerceItem 同口径：对象条目按字符串值拼回一条，只重组不补造。"""
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, dict):
        parts = [v.strip() for v in raw.values() if isinstance(v, str) and v.strip()]
        return " — ".join(parts) if parts else None
    return None


def unclosed(line):
    """与后端 isUnclosedJson 同口径：引号外括号未闭合则可拼下一行。"""
    depth = 0
    in_str = False
    esc = False
    for ch in line:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
    return depth > 0 or in_str


def run_fixture(endpoint, model, name, payload_facts):
    body = json.dumps(
        {
            "model": model,
            "stream": True,
            "temperature": 0.2,
            "top_p": 0.8,
            "max_tokens": 480,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload_facts)},
            ],
        }
    ).encode()
    req = urllib.request.Request(
        f"{endpoint}/v1/chat/completions", data=body, headers={"Content-Type": "application/json"}
    )

    started = time.monotonic()
    first_token_ms = None
    first_section_ms = None
    text = ""
    line_buf = ""
    pending = None
    joins = 0
    parsed_lines = []
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            for raw in resp:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content") or ""
                if not delta:
                    continue
                if first_token_ms is None:
                    first_token_ms = round((time.monotonic() - started) * 1000)
                text += delta
                line_buf += delta
                while "\n" in line_buf:
                    one, line_buf = line_buf.split("\n", 1)
                    one = one.strip().strip("`")
                    if not one:
                        continue
                    candidate = one
                    # 以 {"section" 开头即新记录：先丢掉之前的残片，避免级联吞行
                    starts_new = one.startswith('{"section"') or one.startswith('{ "section"')
                    if pending and not starts_new:
                        candidate = f"{pending} {one}"
                    elif pending:
                        parsed_lines.append({"__malformed__": pending[:80]})
                        pending = None
                    try:
                        parsed_lines.append(json.loads(candidate))
                        pending = None
                        joins = 0
                        if first_section_ms is None:
                            first_section_ms = round((time.monotonic() - started) * 1000)
                    except json.JSONDecodeError:
                        # 模型在一个 JSON 对象中间换了行：有限次数内拼回去
                        if unclosed(candidate) and joins < 2 and len(candidate) < 4000:
                            pending = candidate
                            joins += 1
                        else:
                            pending = None
                            joins = 0
                            parsed_lines.append({"__malformed__": candidate[:80]})
    except Exception as e:  # noqa: BLE001 - 基准脚本要如实报告任何失败
        return {"fixture": name, "error": f"{type(e).__name__}: {e}", "total_ms": round((time.monotonic() - started) * 1000)}

    tail = line_buf.strip().strip("`")
    if tail or pending:
        candidate = f"{pending} {tail}".strip() if pending else tail
        try:
            parsed_lines.append(json.loads(candidate))
        except json.JSONDecodeError:
            parsed_lines.append({"__malformed__": candidate[:80]})

    total_ms = round((time.monotonic() - started) * 1000)
    good = {}
    malformed = 0
    for obj in parsed_lines:
        if "__malformed__" in obj:
            malformed += 1
            continue
        s = obj.get("section")
        if s not in SECTIONS or s in good:
            continue
        if s in ("cityAdvantages", "interestMatch", "scheduleFit"):
            if isinstance(obj.get("text"), str) and len(obj["text"]) >= 8:
                good[s] = obj
        elif s == "convenience":
            reasons = [coerce_item(r) for r in obj.get("reasons") or []]
            if [r for r in reasons if r and len(r) >= 4]:
                good[s] = obj
        else:
            items = [coerce_item(i) for i in obj.get("items") or []]
            if [i for i in items if i and len(i) >= 4]:
                good[s] = obj

    blob = json.dumps(good)
    return {
        "fixture": name,
        "first_token_ms": first_token_ms,
        "first_section_ms": first_section_ms,
        "total_ms": total_ms,
        "chars": len(text),
        "sections_ok": len(good),
        "schema_valid": len(good) == len(SECTIONS),
        "malformed_lines": malformed,
        "needs_fallback": len(good) < len(SECTIONS),
        "money_leak": [h for h in MONEY_HINTS if h in blob],
        "tech_leak": [h for h in TECH_HINTS if h.lower() in blob.lower()],
        "missing": [s for s in SECTIONS if s not in good],
    }


def run_guided(endpoint, model, name, payload_facts):
    """guided_json 模式：单对象 + 结构化解码，按 key 完成度统计逐区块到达时间。"""
    user = (
        "DETERMINISTIC FACTS (read-only, do not echo or copy this JSON):\n"
        + json.dumps(payload_facts)
        + "\n\nNow write that JSON object for this city. Write conclusions only; do not repeat the fact field names."
    )
    body = json.dumps(
        {
            "model": model,
            "stream": True,
            "temperature": 0.2,
            "top_p": 0.8,
            "max_tokens": 480,
            "guided_json": GUIDED_SCHEMA,
            "messages": [{"role": "system", "content": GUIDED_SYSTEM}, {"role": "user", "content": user}],
        }
    ).encode()
    req = urllib.request.Request(
        f"{endpoint}/v1/chat/completions", data=body, headers={"Content-Type": "application/json"}
    )

    started = time.monotonic()
    first_token_ms = None
    first_section_ms = None
    text = ""
    try:
        with urllib.request.urlopen(req, timeout=40) as resp:
            for raw in resp:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content") or ""
                if not delta:
                    continue
                if first_token_ms is None:
                    first_token_ms = round((time.monotonic() - started) * 1000)
                text += delta
                # 第一个 key 的值闭合即“首个完整区块”
                if first_section_ms is None and text.count('"') >= 4 and "cityAdvantages" in text:
                    after = text.split('"cityAdvantages"', 1)[1]
                    if after.count('"') >= 2:
                        first_section_ms = round((time.monotonic() - started) * 1000)
    except Exception as e:  # noqa: BLE001
        return {"fixture": name, "mode": "guided", "error": f"{type(e).__name__}: {e}",
                "total_ms": round((time.monotonic() - started) * 1000)}

    total_ms = round((time.monotonic() - started) * 1000)
    good = {}
    parse_ok = True
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        obj = {}
        parse_ok = False
    for key, section in GUIDED_KEYS.items():
        v = obj.get(key)
        if section in ("cityAdvantages", "interestMatch", "scheduleFit"):
            if isinstance(v, str) and len(v) >= 8:
                good[section] = v
        else:
            items = [coerce_item(i) for i in v or []] if isinstance(v, list) else []
            if [i for i in items if i and len(i) >= 4]:
                good[section] = items

    blob = json.dumps(good)
    return {
        "fixture": name,
        "mode": "guided",
        "first_token_ms": first_token_ms,
        "first_section_ms": first_section_ms,
        "total_ms": total_ms,
        "chars": len(text),
        "json_parse_ok": parse_ok,
        "sections_ok": len(good),
        "schema_valid": len(good) == len(SECTIONS),
        "malformed_lines": 0 if parse_ok else 1,
        "needs_fallback": len(good) < len(SECTIONS),
        "money_leak": [h for h in MONEY_HINTS if h in blob],
        "tech_leak": [h for h in TECH_HINTS if h.lower() in blob.lower()],
        "missing": [s for s in SECTIONS if s not in good],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", default=NEW_ENDPOINT)
    ap.add_argument("--model", default=None, help="缺省时用 /v1/models 的实际 id")
    ap.add_argument("--only", default=None, help="只跑一个 fixture")
    ap.add_argument("--mode", default="guided", choices=["guided", "ndjson"], help="输出约束方式")
    ap.add_argument("--repeat", type=int, default=1)
    args = ap.parse_args()

    probe = resolve_model(args.endpoint)
    model = args.model or (probe["ids"][0] if probe["ids"] else None)
    print(f"/v1/models  HTTP={probe['status']}  ids={probe['ids']}  root={probe['root']}  "
          f"max_model_len={probe['max_model_len']}  latency={probe['latency_ms']}ms")
    print(f"using model = {model}\n")
    if not model:
        sys.exit("no served model id")

    rows = []
    names = [args.only] if args.only else list(FIXTURES)
    runner = run_guided if args.mode == "guided" else run_fixture
    for _ in range(args.repeat):
        for name in names:
            r = runner(args.endpoint, model, name, FIXTURES[name])
            rows.append(r)
            print(json.dumps(r, ensure_ascii=False))

    ok = [r for r in rows if r.get("schema_valid")]
    fts = [r["first_token_ms"] for r in rows if r.get("first_token_ms") is not None]
    fss = [r["first_section_ms"] for r in rows if r.get("first_section_ms") is not None]
    tots = [r["total_ms"] for r in rows if r.get("total_ms") is not None]
    print("\n---- summary ----")
    print(f"fixtures            : {len(rows)}")
    print(f"schema valid        : {len(ok)}/{len(rows)} = {100 * len(ok) / max(1, len(rows)):.0f}%")
    if fts:
        print(f"first token   ms    : median={statistics.median(fts):.0f} min={min(fts)} max={max(fts)}")
    if fss:
        print(f"first section ms    : median={statistics.median(fss):.0f} min={min(fss)} max={max(fss)}")
    if tots:
        print(f"total         ms    : median={statistics.median(tots):.0f} min={min(tots)} max={max(tots)}")
    print(f"needs fallback      : {sum(1 for r in rows if r.get('needs_fallback'))}")
    print(f"money/tech leaks    : {sum(1 for r in rows if r.get('money_leak') or r.get('tech_leak'))}")


if __name__ == "__main__":
    main()
