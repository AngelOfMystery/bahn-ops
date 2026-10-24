"""One-alert conversation loop with real tool calls.

Two entry points:

  run_case(alert_id)                      -> one-shot: read, maybe ask driver, propose or refuse
  continue_case(alert_id, human_message)  -> continue an existing conversation with a human turn

Both use the same tool set, the same refusal guard, and the same
persistence (bahn_ops/case_history/{alert_id}.json). The one-shot path is
what the "Run agent on this case" button calls. The continue path is what
the operator's input box calls.

No dependencies outside the standard library. Runs with no model key by
falling back to a deterministic scripted turn, which keeps the demo working
when the network or the free tier does not.
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
MAX_TOKENS = 3000
HIST_DIR = Path("bahn_ops/case_history")


# ---------- persistence ----------

def _hist_path(alert_id):
    HIST_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c for c in str(alert_id) if c.isalnum() or c in "-_")
    return HIST_DIR / (safe + ".json")


def load_history(alert_id):
    p = _hist_path(alert_id)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_history(alert_id, history):
    p = _hist_path(alert_id)
    p.write_text(json.dumps(history, indent=2, ensure_ascii=False), encoding="utf-8")


# ---------- scripted driver ----------

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


# ---------- tools ----------

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


# ---------- model ----------

def model_turn(messages, tools):
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
            "messages": messages,
            "tools": [{"type": "function", "function": t} for t in tools],
            "temperature": 0.2,
            "max_tokens": MAX_TOKENS,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as e:
        return None, "http " + str(e.code) + " " + e.read().decode("utf-8", "replace")[:200]
    except Exception as e:
        return None, str(e)[:200]


# ---------- shared context ----------

def _build_ctx(alert_id):
    load_env()
    alerts = load("alerts")
    alert = next((a for a in alerts if a.get("id") == alert_id), None)
    if alert is None:
        return None, {"ok": False, "error": "unknown alert: " + str(alert_id), "alert_id": alert_id}
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
    return ctx, None


def _system_message(alert, order, refusal):
    base = (
        "You are the Bahn operations agent for one case. Do the cheap work first: "
        "read the order and messages, ask the driver before changing any promise, "
        "then hand a person exactly one decision with propose_action. "
        "Never contact a customer. Never execute anything. "
    )
    if refusal:
        base += (
            "This case is on hold: the evidence does not support a write action yet. "
            "You MAY still: read the order, read messages, read reservations, ask the driver "
            "questions, and answer the operator. You MAY NOT propose_action or claim you "
            "have changed anything. When the operator asks you to ask the driver something, "
            "call ask_driver. When they ask what would unblock the case, answer that. "
        )
    base += "Case: " + json.dumps({"alert": alert, "order": order}, ensure_ascii=False)
    return {"role": "system", "content": base}


def _run_loop(messages, tools, ctx, record):
    """Drive the model loop. Mutates record['turns'], record['proposal'], record['driver_replies']."""
    proposed = False
    for _ in range(MAX_TURNS):
        payload, err = model_turn(messages, tools)
        if payload is None or "choices" not in payload:
            record["model_error"] = err or "no payload"
            return proposed
        choice = payload["choices"][0]
        msg = choice.get("message") or {}
        finish = choice.get("finish_reason") or ""
        tool_calls = msg.get("tool_calls") or []
        assistant_entry = {"role": "assistant", "content": msg.get("content") or ""}
        if tool_calls:
            assistant_entry["tool_calls"] = tool_calls
        messages.append(assistant_entry)
        if not tool_calls:
            if msg.get("content"):
                record["turns"].append({"assistant": str(msg["content"])[:800]})
            if finish == "length":
                record["model_error"] = "truncated at max_tokens"
            return proposed
        for c in tool_calls:
            fn = (c.get("function") or {}).get("name")
            raw = (c.get("function") or {}).get("arguments") or "{}"
            try:
                args = json.loads(raw)
            except json.JSONDecodeError:
                args = {}
            if fn == "propose_action":
                record["turns"].append({"tool": "propose_action", "args": args})
                record["proposal"] = {
                    "kind": "propose",
                    "summary": args.get("summary", ""),
                    "rationale": args.get("rationale", ""),
                    "needs_approval": True,
                }
                proposed = True
                messages.append({
                    "role": "tool",
                    "tool_call_id": c.get("id") or "",
                    "content": "proposal recorded, awaiting human approval",
                })
                break
            result = run_tool(fn, args, ctx)
            record["turns"].append({"tool": fn, "args": args, "result": str(result)[:400]})
            messages.append({
                "role": "tool",
                "tool_call_id": c.get("id") or "",
                "content": str(result)[:2000],
            })
        if proposed:
            return True
    record["model_error"] = record.get("model_error") or "no proposal within " + str(MAX_TURNS) + " turns"
    return proposed


# ---------- entry: one-shot run (existing behaviour) ----------

def deterministic_turn(ctx):
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
        "tool_calls": ["get_order", "get_messages", "get_reservations", "ask_driver x2"],
    }


def run_case(alert_id):
    ctx, err = _build_ctx(alert_id)
    if err:
        return err
    alert = ctx["alert"]
    order = ctx["order"]
    refusal = ctx["refusal"]
    record = {
        "ok": True,
        "alert_id": alert_id,
        "order_id": alert.get("order_id"),
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
        if not load_history(alert_id):
            save_history(alert_id, [{"role": "agent", "at": record["generated_at"], "turn": record["turns"][-1]}])
        return record

    tools = tool_definitions()
    messages = [_system_message(alert, order, None)]
    record["mode"] = "model"
    proposed = _run_loop(messages, tools, ctx, record)
    record["driver_replies"] = ctx["driver_replies"]
    if not proposed and record.get("proposal") is None:
        record["turns"].append(deterministic_turn(ctx))
        record["mode"] = "deterministic"
        record["model_error"] = record.get("model_error") or "no proposal within " + str(MAX_TURNS) + " turns"
    record["proposal"] = record.get("proposal") or record["turns"][-1]
    if not load_history(alert_id):
        save_history(alert_id, [{"role": "agent", "at": record["generated_at"], "turn": t} for t in record["turns"]])
    return record


# ---------- entry: continue an existing conversation ----------

def continue_case(alert_id, human_message):
    ctx, err = _build_ctx(alert_id)
    if err:
        return err
    alert = ctx["alert"]
    order = ctx["order"]
    refusal = ctx["refusal"]

    history = load_history(alert_id)
    now = datetime.now(timezone.utc).isoformat()

    # Reconstruct the model-facing message list from stored history.
    tools = tool_definitions() if not refusal else []
    sys_msg = _system_message(alert, order, refusal)
    messages = [sys_msg]
    for h in history:
        if h.get("role") == "operator":
            messages.append({"role": "user", "content": str(h.get("content", ""))})
        elif h.get("role") == "agent":
            t = h.get("turn") or {}
            if t.get("tool"):
                messages.append({"role": "tool", "tool_call_id": "", "content": str(t.get("result", ""))[:2000]})
            elif t.get("assistant"):
                messages.append({"role": "assistant", "content": t["assistant"]})
            elif t.get("kind"):
                messages.append({
                    "role": "assistant",
                    "content": "[prior " + str(t["kind"]) + "] " + str(t.get("summary", "")),
                })
    messages.append({"role": "user", "content": str(human_message)})

    record = {
        "ok": True,
        "alert_id": alert_id,
        "order_id": alert.get("order_id"),
        "reference": (order or {}).get("reference"),
        "source_class": source_class(alert),
        "fact_state": fact_state(alert),
        "refusal": refusal,
        "tools": [t["name"] for t in tools],
        "driver_replies": [],
        "turns": [],
        "proposal": None,
        "generated_at": now,
        "mode": "model" if tools else "deterministic",
        "human_message": human_message,
    }

    if not tools:
        # Refused case: no propose_action available, but ask_driver and read tools
        # ARE safe to offer. The refusal guard blocks writes, not questions.
        read_tools = [t for t in tool_definitions() if t["name"] in ("get_order", "get_messages", "get_reservations", "ask_driver")]
        record["tools"] = [t["name"] for t in read_tools]
        payload, merr = model_turn(messages, read_tools)
        if payload and payload.get("choices"):
            choice = payload["choices"][0]
            msg = choice.get("message") or {}
            tcs = msg.get("tool_calls") or []
            for c in tcs:
                fn = (c.get("function") or {}).get("name")
                raw = (c.get("function") or {}).get("arguments") or "{}"
                try:
                    args = json.loads(raw)
                except json.JSONDecodeError:
                    args = {}
                result = run_tool(fn, args, ctx)
                record["turns"].append({"tool": fn, "args": args, "result": str(result)[:400]})
                record["driver_replies"] = ctx["driver_replies"]
            content = msg.get("content") or ""
            if content:
                record["turns"].append({"assistant": content[:1200]})
            if not record["turns"]:
                record["turns"].append({"assistant": "I read the records but found nothing new to report."})
        if not record["turns"]:
            # Real fallback: DO the work, don't explain that we can't.
            # If the operator's message is about the driver, ask the driver.
            asked = False
            low = (human_message or "").lower()
            if any(w in low for w in ("driver", "ask", "where", "safe", "release", "paper")):
                q = human_message[:140] if "?" in human_message else human_message[:140] + "?"
                run_tool("ask_driver", {"question": q}, ctx)
                asked = True
            if not asked:
                run_tool("ask_driver", {"question": "Can you confirm your current location and status?"}, ctx)
            record["driver_replies"] = ctx["driver_replies"]
            record["turns"].append({
                "assistant": (
                    "I sent the driver your question. Reply is above. "
                    "The case itself is still on hold: " + str(refusal) + ". "
                    "To lift the hold I need a signed release document from the site "
                    "or a fresh position signal from the driver app."
                )
            })
            record["mode"] = "deterministic"
            if merr:
                record["model_error"] = merr
    else:
        proposed = _run_loop(messages, tools, ctx, record)
        record["driver_replies"] = ctx["driver_replies"]
        if not record["turns"]:
            record["turns"].append(deterministic_turn(ctx))
            record["mode"] = "deterministic"
            record["model_error"] = record.get("model_error") or "no turns"
        if proposed:
            record["proposal"] = record["proposal"] or {"kind": "propose", "summary": "", "rationale": "", "needs_approval": True}
        else:
            record["proposal"] = record.get("proposal") or record["turns"][-1]

    # Persist: prior history + this human turn + this agent turn
    new_hist = list(history)
    new_hist.append({"role": "operator", "at": now, "content": human_message})
    for t in record["turns"]:
        new_hist.append({"role": "agent", "at": now, "turn": t})
    save_history(alert_id, new_hist)
    record["history"] = new_hist
    return record


if __name__ == "__main__":
    import sys
    aid = sys.argv[1] if len(sys.argv) > 1 else None
    if not aid:
        alerts = load("alerts")
        open_alerts = [a for a in alerts if a.get("status") == "OPEN"]
        aid = open_alerts[0].get("id") if open_alerts else None
    msg = sys.argv[2] if len(sys.argv) > 2 else None
    if msg:
        print(json.dumps(continue_case(aid, msg), indent=2, ensure_ascii=False))
    else:
        print(json.dumps(run_case(aid), indent=2, ensure_ascii=False))
