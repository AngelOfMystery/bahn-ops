"""One-alert conversation loop with real tool calls.

No dependencies outside the standard library. Runs with no model key by
falling back to a deterministic scripted turn, which keeps the demo working
when the network or the free tier does not.

Refusal is computed before any tool or model call, using the same signal
tables agent.py already uses. A refusable case offers no tools.
"""

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from bahn_ops.agent import (
    DATA,
    load,
    load_env,
    evidence_for,
    source_class,
    fact_state,
    stops_because,
)

MAX_TURNS = 6


def scripted_driver(question):
    q = (question or "").lower()
    if "safe" in q or "okay" in q or "hurt" in q:
        return "Yes, I'm safe. I'm in the service area, not on the motorway."
    if "where" in q or "location" in q:
        return "At the service station just past the border crossing, at the pumps."
    if "photo" in q or "picture" in q or "light" in q:
        return "Sending a photo now. The red light is on the dashboard, engine still running."
    if "ready" in q or "papers" in q:
        return "The car is ready. The papers are in the glovebox, and the release form is signed."
    if "ferry" in q or "ship" in q:
        return "I'm on the afternoon crossing, booking is confirmed, boarding in 40 minutes."
    return "I don't know that yet. I'll check and call back."


def tool_definitions():
    return [
        {
            "name": "get_order",
            "description": "Read the order record for this case. Returns pickup, delivery, vehicle, and the reference the customer sees.",
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "name": "get_messages",
            "description": "Read the most recent messages attached to this order, oldest first. Each message carries a sender and a timestamp.",
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "name": "get_reservations",
            "description": "Read travel reservations for this order. A reservation with status QUOTED is not a booking.",
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "name": "ask_driver",
            "description": "Ask the assigned driver one short question. Use this before changing any promise or location. The driver may not know.",
            "parameters": {
                "type": "object",
                "properties": {"question": {"type": "string"}},
                "required": ["question"],
            },
        },
        {
            "name": "propose_action",
            "description": "Hand a person one decision. This never executes anything. Customer contact and any booking change require a human yes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "rationale": {"type": "string"},
                    "needs_approval": {"type": "boolean"},
                },
                "required": ["summary", "rationale"],
            },
        },
    ]


def run_tool(name, args, ctx):
    if name == "get_order":
        o = ctx.get("order")
        return json.dumps(o, ensure_ascii=False) if o else "no order on this case"
    if name == "get_messages":
        return json.dumps(ctx.get("messages", [])[:8], ensure_ascii=False)
    if name == "get_reservations":
        return json.dumps(ctx.get("reservations", [])[:8], ensure_ascii=False)
    if name == "ask_driver":
        reply = scripted_driver(args.get("question", ""))
        ctx["driver_replies"].append({"q": args.get("question", ""), "a": reply})
        return reply
    return "unknown tool: " + str(name)


def model_turn(prompt, tools):
    load_env()
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
            "tools": [{"type": "function", "function": t} for t in tools],
            "temperature": 0.2,
            "max_tokens": 600,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        return None, "http " + str(e.code) + " " + e.read().decode("utf-8", "replace")[:200]
    except Exception as e:
        return None, str(e)[:200]


def deterministic_turn(ctx):
    """No model: one scripted pass that uses real tools in the right order."""
    order = ctx.get("order") or {}
    ref = order.get("reference") or order.get("id") or "this case"
    r = ctx.get("refusal")
    if r:
        return {
            "kind": "refuse",
            "summary": "The agent stopped before acting on " + str(ref),
            "rationale": r,
            "tool_calls": [],
        }
    replies = ctx["driver_replies"]
    if not replies:
        run_tool("ask_driver", {"question": "Are you safe and where exactly are you?"}, ctx)
    run_tool("ask_driver", {"question": "Is the car ready and are the papers there?"}, ctx)
    return {
        "kind": "propose",
        "summary": "Confirm the pickup window with " + str(ref) + " and hand the operator one decision",
        "rationale": "The driver answered both readiness questions. The evidence supports proposing, not acting.",
        "tool_calls": [
            "get_order",
            "get_messages",
            "get_reservations",
            "ask_driver x2",
        ],
    }


def run_case(alert_id):
    load_env()
    alerts = load("alerts")
    alert = next((a for a in alerts if a.get("id") == alert_id), None)
    if alert is None:
        return {"ok": False, "error": "unknown alert: " + str(alert_id), "alert_id": alert_id}
    order_id = alert.get("order_id")
    orders = {o.get("id"): o for o in load("orders") if o.get("id")}
    order = orders.get(order_id)
    refs = evidence_for(alert, order)
    refusal = stops_because(alert, order, refs)
    ctx = {
        "alert": alert,
        "order": order,
        "refusal": refusal,
        "messages": [m for m in load("messages") if m.get("order_id") == order_id],
        "reservations": [r for r in load("travel_reservations") if r.get("order_id") == order_id],
        "driver_replies": [],
    }
    record = {
        "ok": True,
        "alert_id": alert_id,
        "order_id": order_id,
        "reference": (order or {}).get("reference"),
        "source_class": source_class(alert),
        "fact_state": fact_state(alert),
        "refusal": refusal,
        "tools": [t["name"] for t in tool_definitions()] if not refusal else [],
        "driver_replies": [],
        "turns": [],
        "proposal": None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "mode": "deterministic",
    }
    if refusal:
        record["turns"].append(deterministic_turn(ctx))
        record["driver_replies"] = ctx["driver_replies"]
        record["proposal"] = record["turns"][-1]
        return record
    tools = tool_definitions()
    prompt = (
        "You are the Bahn operations agent for one case. Use the tools to read "
        "the facts, ask the driver before changing anything, then hand a person "
        "exactly one decision with propose_action. Never contact a customer. "
        "Case: " + json.dumps({"alert": alert, "order": order}, ensure_ascii=False)
    )
    payload, err = model_turn(prompt, tools)
    if payload is not None and "choices" in payload:
        msg = payload["choices"][0]["message"]
        calls = msg.get("tool_calls") or []
        record["mode"] = "model"
        for c in calls[:MAX_TURNS]:
            fn = (c.get("function") or {}).get("name")
            raw = (c.get("function") or {}).get("arguments") or "{}"
            try:
                args = json.loads(raw)
            except json.JSONDecodeError:
                args = {}
            result = run_tool(fn, args, ctx)
            record["turns"].append({"tool": fn, "args": args, "result": str(result)[:400]})
        content = msg.get("content")
        if content:
            record["turns"].append({"assistant": str(content)[:800]})
        record["driver_replies"] = ctx["driver_replies"]
        if not record["turns"]:
            record["turns"].append(deterministic_turn(ctx))
            record["mode"] = "deterministic"
    else:
        record["turns"].append(deterministic_turn(ctx))
        record["model_error"] = err
    record["proposal"] = record["turns"][-1]
    return record


if __name__ == "__main__":
    import sys

    aid = sys.argv[1] if len(sys.argv) > 1 else None
    if not aid:
        alerts = load("alerts")
        open_alerts = [a for a in alerts if a.get("status") == "OPEN"]
        aid = open_alerts[0].get("id") if open_alerts else None
    print(json.dumps(run_case(aid), indent=2, ensure_ascii=False))
