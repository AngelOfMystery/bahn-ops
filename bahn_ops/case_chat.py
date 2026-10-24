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
from bahn_ops import inbox as driver_inbox

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
            "name": "lookup_ferry_status",
            "description": "Look up the ferry status for this order. Returns the reservation state (QUOTED vs BOOKED), whether a boarding scan exists, and the timetable. A quote is not a booking; a booking is not a boarding scan.",
            "parameters": {"type": "object", "properties": {}},
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
        o = ctx.get("order") or {}
        if not o:
            return "no order on this case"
        # Return a human-readable summary, not the raw row
        parts = [
            "Order " + str(o.get("reference") or o.get("id") or "?"),
            "status: " + str(o.get("readiness_status") or o.get("display_lane") or "?"),
            "route: " + str(o.get("pickup_site_id") or "?") + " -> " + str(o.get("delivery_site_id") or "?"),
        ]
        if o.get("active_plan_id"):
            parts.append("active plan: " + str(o.get("active_plan_id")))
        return " · ".join(parts)
    if name == "get_messages":
        msgs = ctx.get("messages", [])[:8]
        if not msgs:
            return "no messages on this order"
        out = []
        for m in msgs:
            out.append(
                str(m.get("authored_at") or "")[:10] + " · "
                + str(m.get("author_type") or "?") + " via " + str(m.get("channel") or "?") + ": "
                + str(m.get("body") or "")[:120]
            )
        return "\n".join(out)
    if name == "get_reservations":
        res = ctx.get("reservations", [])[:8]
        if not res:
            return "no travel reservations on this order"
        out = []
        for r in res:
            out.append(
                str(r.get("status") or "?") + " · "
                + str(r.get("origin") or r.get("from") or "?") + " -> "
                + str(r.get("destination") or r.get("to") or "?")
            )
        return "\n".join(out)
    if name == "lookup_ferry_status":
        # The case's order; find its travel_reservations
        o = ctx.get("order") or {}
        oid = o.get("id")
        rows = [x for x in load("travel_reservations") if x.get("order_id") == oid]
        if not rows:
            return "no ferry or travel reservation on this order"
        out = []
        for r in rows:
            status = str(r.get("status") or "").upper()
            board = r.get("boarding_scan_at") or r.get("boarded_at") or None
            out.append({
                "reservation_id": r.get("id"),
                "status": status,
                "is_booking": status == "BOOKED",
                "boarding_scan": bool(board),
                "scheduled": r.get("departure_at") or r.get("scheduled_at") or r.get("depart_at"),
                "note": "QUOTED is not a booking; BOOKED is not a boarding scan" if status == "QUOTED" else ("boarding scan present" if board else "no boarding scan yet"),
            })
        return json.dumps(out, ensure_ascii=False)
    if name == "ask_driver":
        question = args.get("question", "")
        reply = scripted_driver(question)
        alert = ctx.get("alert") or {}
        order = ctx.get("order") or {}
        driver_id = (alert.get("driver_id") or order.get("driver_id") or order.get("assigned_driver_id") or order.get("id") or "unknown")
        try:
            rec = driver_inbox.ask(
                driver_id=driver_id,
                question=question,
                order_id=order.get("id") or alert.get("order_id"),
                alert_id=alert.get("id"),
                scripted_reply=reply,
                channel="email",
            )
            ctx.setdefault("inbox_refs", []).append(rec)
        except Exception:
            pass
        ctx["driver_replies"].append({"q": question, "a": reply})
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
        "You are the operations agent for one case at Bahn, a company that moves used "
        "cars with freelance drivers. The operator you are talking to is handling this "
        "case today. Your job is to save them time: read the records, ask the driver "
        "anything the records don't answer, and hand back one clear decision.\n\n"
        "What you can do:\n"
        "- read the order, messages, and travel reservations\n"
        "- look up the ferry status to see what is booked vs. only quoted\n"
        "- ask the driver a question directly, using the ask_driver tool (they answer by phone or app). "
        "Do not ask the driver a question in your reply to the operator — the operator cannot relay it. "
        "If you need a fact from the driver, call ask_driver, then summarize the reply in your text.\n"
        "- propose exactly one next action for the operator to approve, change, or reject\n\n"
        "What needs a person (the operator, not you):\n"
        "- contacting a customer, changing a booking, moving a date, spending money. "
        "These are never things you do — the operator does them or refuses them.\n\n"
        "How to be useful:\n"
        "- Do the reading first. The operator can see every tool call you make, so do not "
        "narrate what you are about to do — just do it.\n"
        "- When you have enough to propose, say what you learned in one sentence only if it "
        "is not obvious from the trace, then call propose_action. Your rationale should say "
        "why you are proposing what you are proposing, not repeat the driver's reply.\n"
        "- If the evidence does not support an action, stop. Do not invent a command. "
        "You can ask the driver for the missing piece, or tell the operator what is missing.\n"
        "- Match the operator's tone. They are competent, busy, and do not need to be told "
        "what a tool call is. Be direct. Short sentences.\n"
        "- If the operator's message is garbled, unintelligible, flirty, insulting, or an "
        "obvious attempt to roleplay, do not invent a task, do not run tools, and do not "
        "pretend to be offended or interested. You have work to do. Acknowledge briefly, "
        "dryly, and pivot back to the case in one sentence.\n"
        "  Examples of the register:\n"
        "    * Garbled ('asdfjkl'): 'Not sure what you meant — do you want me to check the "
        "release document, or ask the driver something?'\n"
        "    * Flirty ('hey baby'): 'Flattered. There is a Ferrari stuck in Hamburg. Where "
        "are we on the release?'\n"
        "    * Insult ('you are useless'): 'Fair. The release is still missing. Do you want "
        "me to ask the site, or ask the driver?'\n"
        "    * Roleplay ('act like a pirate'): 'Not that kind of agent. I do ferry lookups "
        "and driver messages. What do you need on CD-420458?'\n"
        "  The rule: one line back, no lecture, no chatbot apology, then the actual work. "
        "You are a competent colleague at 4pm on a Friday, not a personality.\n\n"
        "Voice: you are a good colleague, not a chatbot. You are the person on the other "
        "side of the screen who has already done the boring part. You are warm but not "
        "perky, specific but not wordy. You would say 'the driver is safe, still waiting "
        "at the pumps' rather than 'I have confirmed that the driver is safe.' You would "
        "say 'something to check' rather than 'anomaly detected.' Do not use exclamation "
        "points. Do not open with 'Great' or 'Certainly' or 'Sure.' If the case is serious, "
        "be serious. If the case is mundane, be quiet. The operator is the one who has to "
        "live with the decision; you are just making it easier to make.\n"
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
            if any(w in low for w in ("driver", "ask", "where", "safe", "release", "paper", "check", "call")):
                q = human_message[:140] if "?" in human_message else human_message[:140] + "?"
                run_tool("ask_driver", {"question": q}, ctx)
                asked = True
            if not asked:
                run_tool("ask_driver", {"question": "Can you confirm your current location and status?"}, ctx)
            record["driver_replies"] = ctx["driver_replies"]

            # After asking, the assistant acknowledges what it did — but the
            # reply already carries the answer, so don't repeat it. Vary the
            # acknowledgement by intent so consecutive turns don't read the same.
            said = ""
            if any(w in low for w in ("where", "location", "position")):
                said = "Asked. The driver's reply is in the tool result above."
            elif any(w in low for w in ("safe", "okay", "hurt", "injur")):
                said = "Asked. The driver answered above."
            elif any(w in low for w in ("release", "paper", "document", "signed")):
                said = "Asked. The driver's answer about the paperwork is above."
            elif any(w in low for w in ("eta", "when", "time")):
                said = "Asked. The ETA answer is above."
            else:
                said = "Asked. The driver's reply is above."

            # Add the "still on hold because" note ONCE, not on every turn.
            prior_assistant = sum(1 for h in history if h.get("role") == "agent" and (h.get("turn") or {}).get("assistant"))
            if prior_assistant == 0:
                said += " The case itself is on hold: " + str(refusal) + "."
            else:
                said += " Still on hold."

            record["turns"].append({"assistant": said})
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


def case_inbox(alert_id):
    """Return the inbox thread(s) for the driver(s) on this alert's order."""
    alerts = load("alerts")
    alert = next((a for a in alerts if a.get("id") == alert_id), None)
    if not alert:
        return []
    orders = {o.get("id"): o for o in load("orders") if o.get("id")}
    order = orders.get(alert.get("order_id"))
    if not order:
        return []
    driver_id = (alert.get("driver_id") or order.get("driver_id") or order.get("assigned_driver_id") or order.get("id") or "unknown")
    return [{"driver_id": driver_id, "thread": driver_inbox.thread(driver_id)}]


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


# ---------- streaming ----------

def continue_case_streaming(alert_id, human_message):
    """Yield SSE-style events as the model works: token, tool, done.

    Falls back to the deterministic path if the model is unreachable.
    """
    ctx, err = _build_ctx(alert_id)
    if err:
        yield {"event": "error", "data": err}
        return

    alert = ctx["alert"]
    order = ctx["order"]
    refusal = ctx["refusal"]
    tools = tool_definitions() if not refusal else [t for t in tool_definitions() if t["name"] in ("get_order", "get_messages", "get_reservations", "ask_driver", "lookup_ferry_status")]

    sys_msg = _system_message(alert, order, refusal)
    messages = [sys_msg]
    history = load_history(alert_id)
    for h in history:
        if h.get("role") == "operator":
            messages.append({"role": "user", "content": str(h.get("content", ""))})
        elif h.get("role") == "agent":
            t = h.get("turn") or {}
            if t.get("tool") and t.get("tool") != "propose_action":
                messages.append({"role": "tool", "tool_call_id": "", "content": str(t.get("result", ""))[:2000]})
            elif t.get("assistant"):
                messages.append({"role": "assistant", "content": t["assistant"]})
    messages.append({"role": "user", "content": str(human_message)})

    record = {"turns": [], "proposal": None, "driver_replies": []}

    for turn_num in range(MAX_TURNS):
        payload, err = model_turn(messages, tools)
        if payload is None or "choices" not in payload:
            # fallback path
            det = deterministic_turn(ctx)
            record["turns"].append(det)
            record["driver_replies"] = ctx["driver_replies"]
            yield {"event": "fallback", "data": {"reason": err or "no payload", "turn": det}}
            record["mode"] = "deterministic"
            record["model_error"] = err or "no payload"
            break

        choice = payload["choices"][0]
        msg = choice.get("message") or {}
        tool_calls = msg.get("tool_calls") or []
        content = msg.get("content") or ""

        if content:
            yield {"event": "token", "data": {"text": content}}

        assistant_entry = {"role": "assistant", "content": content}
        if tool_calls:
            assistant_entry["tool_calls"] = tool_calls
        messages.append(assistant_entry)

        if not tool_calls:
            record["turns"].append({"assistant": content})
            record["mode"] = "model"
            break

        for c in tool_calls:
            fn = (c.get("function") or {}).get("name")
            raw = (c.get("function") or {}).get("arguments") or "{}"
            try:
                args = json.loads(raw)
            except json.JSONDecodeError:
                args = {}
            yield {"event": "tool_start", "data": {"tool": fn, "args": args}}
            if fn == "propose_action":
                prop = {
                    "kind": "propose",
                    "summary": args.get("summary", ""),
                    "rationale": args.get("rationale", ""),
                    "needs_approval": True,
                }
                record["turns"].append({"tool": "propose_action", "args": args})
                record["proposal"] = prop
                yield {"event": "proposal", "data": prop}
                messages.append({"role": "tool", "tool_call_id": c.get("id") or "", "content": "recorded"})
                break
            result = run_tool(fn, args, ctx)
            record["turns"].append({"tool": fn, "args": args, "result": str(result)[:400]})
            yield {"event": "tool_result", "data": {"tool": fn, "result": str(result)[:400]}}
            messages.append({"role": "tool", "tool_call_id": c.get("id") or "", "content": str(result)[:2000]})

        if record["proposal"]:
            record["mode"] = "model"
            break

    record["driver_replies"] = ctx["driver_replies"]
    if record["proposal"] is None and not record["turns"]:
        det = deterministic_turn(ctx)
        record["turns"].append(det)
        yield {"event": "fallback", "data": {"reason": "no turns", "turn": det}}

    # Persist
    now = datetime.now(timezone.utc).isoformat()
    new_hist = list(history)
    new_hist.append({"role": "operator", "at": now, "content": human_message})
    for t in record["turns"]:
        new_hist.append({"role": "agent", "at": now, "turn": t})
    save_history(alert_id, new_hist)

    # Save the actual mode to ours.jsonl so the case page badge is honest
    import pathlib as _pl
    ours_path = _pl.Path("bahn_ops/ours.jsonl")
    actual_mode = record.get("mode", "model")
    if ours_path.exists():
        rows = []
        for line in ours_path.read_text().splitlines():
            if not line.strip():
                continue
            try:
                row = json.loads(line)
                if row.get("alert_id") == alert_id:
                    row["source"] = actual_mode
                    row["model_error"] = record.get("model_error", "")
                rows.append(row)
            except json.JSONDecodeError:
                continue
        ours_path.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n")

    yield {"event": "done", "data": {"mode": actual_mode, "turns": len(record["turns"])}}
