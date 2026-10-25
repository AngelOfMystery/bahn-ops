"""The driver inbox.

When the agent asks the driver a question, it goes through this module:

  1. The question is appended to bahn_ops/inbox_out/{driver_id}.jsonl with
     status SENT and a fresh question_id.
  2. A scripted reply is appended to bahn_ops/inbox_in/{driver_id}.jsonl with
     status RECEIVED and a fresh reply_id, linked to the question_id.
  3. The outbox question is marked ANSWERED with the reply_id.

A human on /phone can override the reply: mark the scripted answer superseded,
append their own RECEIVED record, and update the case. The newest RECEIVED
record for a given question wins when the case page renders.

Nothing here talks to the network. The whole transport is local files.
"""

import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

OUT_DIR = Path("bahn_ops/inbox_out")
IN_DIR = Path("bahn_ops/inbox_in")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _new_id(prefix):
    return prefix + "-" + secrets.token_hex(8)


def _append(path, row):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def _read(path):
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s:
            continue
        try:
            rows.append(json.loads(s))
        except json.JSONDecodeError:
            continue
    return rows


def _rewrite(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def _out_path(driver_id):
    safe = "".join(c for c in str(driver_id) if c.isalnum() or c in "-_")
    return OUT_DIR / (safe + ".jsonl")


def _in_path(driver_id):
    safe = "".join(c for c in str(driver_id) if c.isalnum() or c in "-_")
    return IN_DIR / (safe + ".jsonl")


def ask(driver_id, question, order_id, alert_id, scripted_reply, channel="email"):
    """Record a question to the driver and a scripted reply.

    Returns {question_id, reply_id, driver_id, question, reply, asked_at, replied_at}
    """
    asked_at = _now()
    qid = _new_id("q")
    rid = _new_id("r")

    q_row = {
        "question_id": qid,
        "driver_id": driver_id,
        "order_id": order_id,
        "alert_id": alert_id,
        "channel": channel,
        "body": question,
        "asked_at": asked_at,
        "status": "ANSWERED",
        "reply_id": rid,
    }
    _append(_out_path(driver_id), q_row)

    r_row = {
        "reply_id": rid,
        "question_id": qid,
        "driver_id": driver_id,
        "order_id": order_id,
        "channel": channel,
        "body": scripted_reply,
        "received_at": asked_at,
        "source": "scripted",
        "superseded": False,
    }
    _append(_in_path(driver_id), r_row)

    return {
        "question_id": qid,
        "reply_id": rid,
        "driver_id": driver_id,
        "question": question,
        "reply": scripted_reply,
        "asked_at": asked_at,
        "replied_at": asked_at,
        "channel": channel,
    }


def override(question_id, human_reply):
    """A human has replied as the driver. Appends a new RECEIVED, marks prior as superseded."""
    out_rows = []
    found = None
    for name in OUT_DIR.glob("*.jsonl") if OUT_DIR.exists() else []:
        for r in _read(name):
            if r.get("question_id") == question_id:
                found = r
                break
        if found:
            break
    if not found:
        return {"ok": False, "error": "unknown question_id"}

    driver_id = found["driver_id"]
    in_path = _in_path(driver_id)
    replies = _read(in_path)
    for r in replies:
        if r.get("question_id") == question_id:
            r["superseded"] = True
    new_row = {
        "reply_id": _new_id("r"),
        "question_id": question_id,
        "driver_id": driver_id,
        "order_id": found.get("order_id"),
        "channel": found.get("channel", "email"),
        "body": human_reply,
        "received_at": _now(),
        "source": "operator_override",
        "superseded": False,
    }
    replies.append(new_row)
    _rewrite(in_path, replies)

    # refresh the outbox row
    for name in OUT_DIR.glob("*.jsonl"):
        rows = _read(name)
        changed = False
        for r in rows:
            if r.get("question_id") == question_id:
                r["reply_id"] = new_row["reply_id"]
                r["status"] = "ANSWERED"
                changed = True
        if changed:
            _rewrite(name, rows)

    return {"ok": True, "reply": new_row}


def thread(driver_id):
    """All messages for a driver, newest last."""
    outs = _read(_out_path(driver_id))
    ins = _read(_in_path(driver_id))
    by_q = {}
    for r in ins:
        qid = r.get("question_id")
        if qid and not r.get("superseded"):
            by_q[qid] = r
    merged = []
    for q in outs:
        qid = q.get("question_id")
        ans = by_q.get(qid)
        merged.append({
            "question_id": qid,
            "question": q.get("body"),
            "asked_at": q.get("asked_at"),
            "channel": q.get("channel"),
            "order_id": q.get("order_id"),
            "alert_id": q.get("alert_id"),
            "reply": ans.get("body") if ans else None,
            "reply_at": ans.get("received_at") if ans else None,
            "reply_source": ans.get("source") if ans else None,
        })
    return merged


def all_drivers():
    ids = set()
    for d in (OUT_DIR, IN_DIR):
        if d.exists():
            for f in d.glob("*.jsonl"):
                ids.add(f.stem)
    return sorted(ids)




def latest_reply_for(driver_id, question_id=None):
    """Return the most recent reply body for a driver, or None.

    If question_id is given, return the latest reply for that question
    (operator overrides win). Otherwise return the newest reply across
    all questions.
    """
    replies = _read(_in_path(driver_id))
    # Filter to non-superseded
    live = [r for r in replies if not r.get("superseded")]
    if not live:
        return None
    if question_id:
        matching = [r for r in live if r.get("question_id") == question_id]
        if matching:
            # newest wins
            matching.sort(key=lambda r: r.get("received_at") or "")
            return matching[-1]
    live.sort(key=lambda r: r.get("received_at") or "")
    return live[-1] if live else None


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "list":
        for d in all_drivers():
            t = thread(d)
            print(d, "|", len(t), "messages |", (t[-1]["question"] if t else ""))
    elif len(sys.argv) > 1 and sys.argv[1] == "thread":
        print(json.dumps(thread(sys.argv[2]), indent=2))
