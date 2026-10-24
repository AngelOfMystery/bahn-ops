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

COMMAND_BY_KIND = {
    "condition": "condition.compare_evidence",
    "travel": "travel.verify_booking_outcome",
    "assignment": "assignment.review_positioning",
    "invoice": "alert.resolve",
    "identity": "pickup.verify_identity",
}


def command_for(alert):
    kind = str(alert.get("kind") or alert.get("category") or "").lower()
    for key, cmd in COMMAND_BY_KIND.items():
        if key in kind:
            return cmd
    text = str(alert.get("summary") or "").lower()
    for key, cmd in COMMAND_BY_KIND.items():
        if key in text:
            return cmd
    return FALLBACK_COMMAND


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


SOURCE_BY_SIGNAL = {
    "TRACKING_GAP": "app",
    "RELEASE_DOCUMENT_UNCLEAR": "site",
    "SITE_ACCESS_UNCONFIRMED": "site",
    "DRIVER_AVAILABILITY_RISK": "driver",
    "FERRY_CONNECTION_RISK": "ferry",
    "DELIVERY_ACCESS_RISK": "site",
    "PROOF_REVIEW": "document",
    "CONDITION_CLAIM_REVIEW": "document",
    "INVOICE_REFERENCE_QUERY": "billing",
    "CONDITION_CLAIM": "customer",
    "SITE_ACCESS_CONFLICT": "site",
    "DELIVERY_PROMISE_UNACHIEVABLE": "site",
    "EMPTY_PICKUP": "site",
    "FERRY_SOLD_OUT": "ferry",
    "SAFETY_STOP": "driver",
    "FR_IMPORT_TRAVEL_DECISION": "planner",
    "POSITIONING_AT_RISK": "driver",
    "PICKUP_PROOF_REJECTED": "site",
    "FERRY_TRACKING_GAP_CONTEXT": "app",
}

STATE_BY_SIGNAL = {
    "TRACKING_GAP": "stale",
    "RELEASE_DOCUMENT_UNCLEAR": "reported",
    "SITE_ACCESS_UNCONFIRMED": "reported",
    "DRIVER_AVAILABILITY_RISK": "reported",
    "FERRY_CONNECTION_RISK": "quoted",
    "DELIVERY_ACCESS_RISK": "reported",
    "PROOF_REVIEW": "missing",
    "CONDITION_CLAIM_REVIEW": "disputed",
    "INVOICE_REFERENCE_QUERY": "disputed",
    "CONDITION_CLAIM": "disputed",
    "SITE_ACCESS_CONFLICT": "conflicting",
    "DELIVERY_PROMISE_UNACHIEVABLE": "conflicting",
    "EMPTY_PICKUP": "reported",
    "FERRY_SOLD_OUT": "quoted",
    "SAFETY_STOP": "reported",
    "FR_IMPORT_TRAVEL_DECISION": "quoted",
    "POSITIONING_AT_RISK": "reported",
    "PICKUP_PROOF_REJECTED": "disputed",
    "FERRY_TRACKING_GAP_CONTEXT": "stale",
}


PREFIX_CLASS = {
    "track": "app",
    "conv": "conversation",
    "msg": "message",
    "doc": "document",
    "asg": "assignment",
    "ord": "order",
    "drv": "driver",
    "site": "site",
}


def ref_class(ref):
    head = str(ref).split("-")[0].lower()
    return PREFIX_CLASS.get(head)


def source_class(alert):
    sig = str(alert.get("signal") or "").upper()
    if sig in SOURCE_BY_SIGNAL:
        return SOURCE_BY_SIGNAL[sig]
    for ref in (alert.get("evidence_refs") or []):
        c = ref_class(ref)
        if c:
            return c
    if alert.get("driver_report_message_id"):
        return "driver"
    if alert.get("latest_site_conversation_id"):
        return "site"
    if alert.get("conversation_id"):
        return "conversation"
    if alert.get("assignment_id"):
        return "assignment"
    if alert.get("owner") == "ops-readiness":
        return "operator"
    return "unknown"


def fact_state(alert):
    sig = str(alert.get("signal") or "").upper()
    if sig in STATE_BY_SIGNAL:
        return STATE_BY_SIGNAL[sig]
    if alert.get("resolved_at"):
        return "confirmed"
    return "reported"


def stops_because(alert, order, refs):
    sig = str(alert.get("signal") or "").upper()
    if sig == "RELEASE_DOCUMENT_UNCLEAR":
        return "release document unclear; a quote is not a release"
    if sig == "SITE_ACCESS_UNCONFIRMED":
        return "site access unconfirmed; vehicle presence is not pickup authority"
    if sig == "TRACKING_GAP":
        return "position signal stale; ask the driver before changing a promise"
    if not refs:
        return "no evidence refs on the alert"
    return None


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
            "max_tokens": 6000,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return None, "http " + str(e.code) + " " + e.read().decode("utf-8", "replace")[:300]
    except Exception as e:
        return None, "call failed " + str(e)[:300]
    try:
        choice = (payload.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        text = msg.get("content")
        if not text:
            text = msg.get("reasoning_content") or msg.get("reasoning") or ""
        finish = choice.get("finish_reason") or "unknown"
    except Exception:
        return None, "unexpected response shape"
    if not text:
        return None, "empty content, finish=" + str(finish)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None, "no json in reply, finish=" + str(finish) + " head=" + text[:80].replace("\n", " ")
    try:
        return json.loads(text[start : end + 1]), None
    except json.JSONDecodeError as e:
        return None, "bad json " + str(e)[:120]

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
        "command": command_for(alert),
        "needs_approval": True,
        "source_class": source_class(alert),
        "fact_state": fact_state(alert),
        "stops_because": stops_because(alert, order, refs),
        "stop_enforced": bool(stops_because(alert, order, refs)),
        "source": "deterministic",
    }


PLACEHOLDER_MARKERS = (
    "dotted.command",
    "one sentence, what happened",
    "why this action",
    "one or two sentences",
)


def is_placeholder(result):
    blob = json.dumps(result, ensure_ascii=False).lower()
    for m in PLACEHOLDER_MARKERS:
        if m in blob:
            return m
    return None


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
            echo = is_placeholder(result)
            if echo:
                result = deterministic(alert, order, refs)
                result["model_error"] = "model echoed schema placeholder: " + echo
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
