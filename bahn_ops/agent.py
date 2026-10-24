import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DATA = Path("board/dataset/data")
OUT = Path("bahn_ops/ours.jsonl")
ENV = Path(".env")

FALLBACK_COMMAND = "alert.resolve"


def load_env():
    if not ENV.exists():
        return
    for line in ENV.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def load(name):
    p = DATA / (name + ".jsonl")
    if not p.exists():
        return []
    rows = []
    for line in p.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s:
            continue
        try:
            rows.append(json.loads(s))
        except json.JSONDecodeError:
            continue
    return rows


def load_ours():
    if not OUT.exists():
        return []
    rows = []
    for line in OUT.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s:
            continue
        try:
            rows.append(json.loads(s))
        except json.JSONDecodeError:
            continue
    return rows


def by_order(rows, order_id):
    return [r for r in rows if r.get("order_id") == order_id]


def evidence_for(alert, order):
    refs = []
    for r in alert.get("evidence_refs") or []:
        if isinstance(r, str):
            refs.append(r)
        elif isinstance(r, dict):
            for k in ("id", "ref", "document_id", "message_id"):
                if r.get(k):
                    refs.append(str(r[k]))
                    break
    if alert.get("id"):
        refs.append(str(alert["id"]))
    if order:
        if order.get("reference"):
            refs.append(str(order["reference"]))
        for k in ("pickup_address_id", "delivery_address_id", "vehicle_id", "customer_id"):
            if order.get(k):
                refs.append(str(order[k]))
    seen = []
    for r in refs:
        if r not in seen:
            seen.append(r)
    return seen


def context_block(alert, order, notes, msgs, docs, reservations, drivers):
    parts = []
    parts.append("ALERT " + json.dumps(alert, ensure_ascii=False))
    if order:
        parts.append("ORDER " + json.dumps(order, ensure_ascii=False))
    for n in notes[:5]:
        parts.append("NOTE " + json.dumps(n, ensure_ascii=False))
    for m in msgs[:5]:
        parts.append("MESSAGE " + json.dumps(m, ensure_ascii=False))
    for d in docs[:5]:
        parts.append("DOCUMENT " + json.dumps(d, ensure_ascii=False))
    for r in reservations[:3]:
        parts.append("RESERVATION " + json.dumps(r, ensure_ascii=False))
    for d in drivers[:3]:
        parts.append("DRIVER " + json.dumps(d, ensure_ascii=False))
    return "\n".join(parts)


def build_prompt(alert, block):
    return (
        "You are an operations agent for Bahn, a car delivery company.\n"
        "One alert needs a person. Read the facts below and propose ONE next action.\n"
        "Rules: never message a customer; only propose, never execute; cite the ids you relied on.\n"
        "Do the cheap work first: read, look up, compare. Then hand a person one clear decision.\n\n"
        + block
        + "\n\nReturn JSON only, no prose, no fences, with exactly these keys:\n"
        '{"summary": "one sentence, what happened", '
        '"rationale": "why this action, one or two sentences", '
        '"evidence_refs": ["ids you used"], '
        '"command": "dotted.command.name", '
        '"needs_approval": true}\n'
    )


def call_model(prompt):
    key = os.environ.get("BAHN_MODEL_API_KEY", "").strip()
    base = os.environ.get("BAHN_MODEL_BASE_URL", "").strip() or "https://api.openai.com/v1"
    name = os.environ.get("BAHN_MODEL_NAME", "").strip() or "gpt-4o-mini"
    if not key:
        return None, "no key"
    url = base.rstrip("/") + "/chat/completions"
    body = json.dumps(
        {
            "model": name,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
            "max_tokens": 600,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return None, "http " + str(e.code) + " " + e.read().decode("utf-8", "replace")[:300]
    except Exception as e:
        return None, "call failed " + str(e)[:300]
    try:
        text = payload["choices"][0]["message"]["content"]
    except Exception:
        return None, "unexpected response shape"
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None, "no json in reply"
    try:
        return json.loads(text[start : end + 1]), None
    except json.JSONDecodeError as e:
        return None, "bad json " + str(e)[:200]


def deterministic(alert, order, refs):
    sev = str(alert.get("severity", "")).upper()
    where = ""
    if order:
        where = str(order.get("reference") or order.get("id") or "")
    summary = str(alert.get("summary") or "alert needs a decision")
    if sev in ("CRITICAL", "HIGH"):
        action = "escalate to the operator now and hold the delivery until a person confirms"
    else:
        action = "gather the missing fact and hand the operator one decision"
    if where:
        rationale = action + " on " + where + " because severity is " + (sev or "unknown") + " and the chain cannot continue without a decision."
    else:
        rationale = action + " because severity is " + (sev or "unknown") + "."
    return {
        "summary": summary,
        "rationale": rationale,
        "evidence_refs": refs,
        "command": FALLBACK_COMMAND,
        "needs_approval": True,
        "source": "deterministic",
    }


def main():
    load_env()
    if not DATA.is_dir():
        print("DATA_MISSING:", DATA)
        return 1

    alerts = load("alerts")
    orders = {o.get("id"): o for o in load("orders") if o.get("id")}
    notes = load("order_notes")
    msgs = load("messages")
    docs = load("documents")
    reservations = load("travel_reservations")
    drivers = load("drivers")
    ours = load_ours()
    done = {r.get("alert_id") for r in ours if r.get("alert_id")}

    open_alerts = [a for a in alerts if a.get("status") == "OPEN"]
    todo = [a for a in open_alerts if a.get("id") not in done]
    print("alerts_total:", len(alerts), "open:", len(open_alerts), "already_proposed:", len(done), "todo:", len(todo))

    made = 0
    failed = 0
    for alert in todo:
        order_id = alert.get("order_id")
        order = orders.get(order_id)
        refs = evidence_for(alert, order)
        block = context_block(
            alert,
            order,
            by_order(notes, order_id),
            by_order(msgs, order_id),
            by_order(docs, order_id),
            by_order(reservations, order_id),
            drivers,
        )
        prompt = build_prompt(alert, block)
        result, err = call_model(prompt)
        if result is None:
            result = deterministic(alert, order, refs)
            result["model_error"] = err
            failed += 1
        else:
            result.setdefault("evidence_refs", refs)
            result.setdefault("command", FALLBACK_COMMAND)
            result.setdefault("needs_approval", True)
            result["source"] = "model"
        result["alert_id"] = alert.get("id")
        result["order_id"] = order_id
        result["generated_at"] = datetime.now(timezone.utc).isoformat()
        result["status"] = "PENDING_REVIEW"
        with OUT.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(result, ensure_ascii=False) + "\n")
        made += 1
        print("PROPOSED", alert.get("id"), "->", str(result.get("summary"))[:70])

    print("written:", made, "deterministic_fallback:", failed, "file:", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
