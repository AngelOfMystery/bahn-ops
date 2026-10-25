"""Execute an accepted decision.

Reads bahn_ops/decisions.jsonl, looks up the command for the alert, applies
a simulated effect, and writes a row to bahn_ops/executions.jsonl.

Every command has an explicit effect. Commands that would contact a
customer are refused. No external side effects occur — everything lands in
executions.jsonl and is visible on the board.

Run from the repo root:
    python3 -m bahn_ops.execute <alert_id>

Exit codes:
    0  execution recorded (SUCCESS or REFUSED or FAILED)
    1  no decision found for the alert
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

DEC = Path("bahn_ops/decisions.jsonl")
EXE = Path("bahn_ops/executions.jsonl")
OURS = Path("bahn_ops/ours.jsonl")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _read_jsonl(path):
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


def _append_jsonl(path, row):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


# Commands that would contact a customer. Refused by policy.
CUSTOMER_CONTACT_PREFIXES = ("customer.", "notify.customer", "email.customer", "sms.customer")


# Every executable command: prefix -> (kind, description, what_it_writes)
EXECUTABLE_EFFECTS = {
    "alert.resolve": (
        "alert_marked_resolved",
        "Alert marked resolved. No customer contacted.",
    ),
    "pickup.verify_identity": (
        "identity_verification_requested",
        "Site has been asked to reconcile vehicle identity. No customer contacted.",
    ),
    "assignment.prepare_backup": (
        "backup_assignment_prepared",
        "A backup driver slot has been prepared without cancelling the current driver.",
    ),
    "assignment.review_positioning": (
        "positioning_review_requested",
        "The driver's current position is being re-checked before any reassignment.",
    ),
    "travel.verify_booking_outcome": (
        "travel_verification_requested",
        "Ferry/train booking status is being re-verified against the reservation record.",
    ),
    "travel.rebook": (
        "rebook_requested",
        "Rebooking request prepared. Awaiting confirmation from the ferry line. No customer contacted.",
    ),
    "condition.compare_evidence": (
        "condition_evidence_compared",
        "Photo evidence for the condition claim has been compared and logged.",
    ),
    "condition.compare_mark_photos": (
        "condition_evidence_compared",
        "Photo evidence for the mark comparison has been compared and logged.",
    ),
    "invoice.reference.verify": (
        "invoice_verified",
        "Invoice reference has been checked against the billing record.",
    ),
    "handover.trail.search": (
        "handover_evidence_searched",
        "Handover trail has been searched for the missing signed document.",
    ),
    "ops.driver.backup_allocation": (
        "backup_allocation_queued",
        "Backup driver allocation has been queued. No customer contacted.",
    ),
    "ops.ferry.confirm_alternative_crossing": (
        "alternative_crossing_confirmed",
        "Alternative ferry crossing has been confirmed against the timetable.",
    ),
    "ops.delivery.access.review": (
        "delivery_access_review_requested",
        "Delivery access has been reviewed. Awaiting confirmation from the receiving site.",
    ),
    "ops.handover.trail.search": (
        "handover_evidence_searched",
        "Handover trail has been searched for the missing evidence.",
    ),
    "ops.condition_claim.compare_mark_photos": (
        "condition_evidence_compared",
        "Photo evidence has been compared and logged.",
    ),
    "ops.invoice.reference.verify": (
        "invoice_verified",
        "Invoice reference has been verified.",
    ),
    "ops.claim.compare_photo_evidence": (
        "claim_evidence_compared",
        "Claim evidence has been compared and logged.",
    ),
    # Route and delivery adjustments — the model proposes these, and none
    # of them contact a customer.
    "ops.route.replan_delivery": (
        "route_replan_requested",
        "Route replan requested. Awaiting driver confirmation. No customer is contacted.",
    ),
    "ops.delivery.respond_to_window": (
        "delivery_window_acknowledged",
        "New delivery window acknowledged. Route adjusted. No customer is contacted.",
    ),
    "ops.handover.confirm_receiver": (
        "handover_receiver_confirmed",
        "Receiving contact confirmed. Handover trail updated. No customer is contacted.",
    ),
    "ops.driver.notify_route_change": (
        "driver_notified_route_change",
        "Driver notified of the route change. No customer is contacted.",
    ),
    "ops.readiness.confirm_desk_access": (
        "desk_access_confirmed",
        "Pickup desk access confirmed. Driver can proceed. No customer is contacted.",
    ),
    "ops.pickup.confirm_slot": (
        "pickup_slot_confirmed",
        "Pickup slot confirmed with the site. No customer is contacted.",
    ),
    "ops.condition.log_claim": (
        "condition_claim_logged",
        "Condition claim logged for review. No customer is contacted.",
    ),
    "ops.invoice.reference.confirm": (
        "invoice_reference_confirmed",
        "Invoice reference confirmed against the billing record. No customer is contacted.",
    ),
}


def _classify(command):
    """Return (kind, description, refused_reason, pending) for a command.

    Four outcomes:
      - empty command             -> SUCCESS (no_command)
      - customer-contact prefix   -> REFUSED (customer_contact_requires_approval)
      - known command             -> SUCCESS (kind from EXECUTABLE_EFFECTS)
      - unknown command           -> PENDING (awaiting operator allowlist review)
    """
    cmd = str(command or "").strip()
    if not cmd:
        return ("no_command", "No command recorded for this decision.", None, False)
    for prefix in CUSTOMER_CONTACT_PREFIXES:
        if cmd.startswith(prefix):
            return (
                "refused_customer_contact",
                "Refused: this command would contact a customer. Customer contact requires explicit operator approval.",
                "customer_contact_requires_approval",
                False,
            )
    if cmd in EXECUTABLE_EFFECTS:
        kind, desc = EXECUTABLE_EFFECTS[cmd]
        return (kind, desc, None, False)
    # Unknown command: do not invent an effect, and do not run it.
    # Flag for operator review — this is the "start with approvals" path.
    return (
        "pending_operator_allowlist",
        "Not executed: command " + cmd + " is not on the executor's allowlist. An operator must confirm before it runs.",
        "pending_operator_allowlist",
        True,
    )


def find_decision(alert_id):
    """Return the latest decision row for an alert (by `at` timestamp), not the first.

    The old version returned the first matching row. If the operator clicked
    Change and then Accept, the executor would see the Change, not the Accept.
    Newest-first is the only correct order for a decision log.
    """
    matching = [row for row in _read_jsonl(DEC) if row.get("alert_id") == alert_id]
    if not matching:
        return None
    # Sort by `at` (ISO8601) and return the newest
    matching.sort(key=lambda r: r.get("at") or "")
    return matching[-1]


def find_proposal(alert_id):
    for row in _read_jsonl(OURS):
        if row.get("alert_id") == alert_id:
            return row
    return None


def already_executed(alert_id, command, decided_at=None):
    """Idempotency per (alert, command, decided_at).

    Two different accepted decisions with the same command are different
    events and must both be recorded. Only a replay of the *same* decision
    is deduplicated.
    """
    for row in _read_jsonl(EXE):
        if row.get("alert_id") != alert_id:
            continue
        if row.get("command") != command:
            continue
        if decided_at and row.get("decided_at") and row.get("decided_at") != decided_at:
            continue
        return row
    return None


def execute(alert_id):
    decision = find_decision(alert_id)
    if not decision:
        return {"ok": False, "error": "no decision for " + str(alert_id), "alert_id": alert_id}

    # The executor must independently validate that the operator said 'accept'.
    # Relying on the HTTP handler to gate this is not enough — a direct
    # `python3 -m bahn_ops.execute <alert_id>` should also refuse a Change.
    if decision.get("decision") != "accept":
        refusal_row = {
            "alert_id": alert_id,
            "decision": decision.get("decision"),
            "command": decision.get("command") or "",
            "kind": "refused_not_an_acceptance",
            "status": "REFUSED",
            "description": "Not executed: the latest decision for this alert is '" + str(decision.get("decision")) + "', not 'accept'. Only an explicit acceptance may run.",
            "refused_reason": "decision_not_accept",
            "executed_at": _now(),
            "decided_at": decision.get("at"),
        }
        _append_jsonl(EXE, refusal_row)
        return {"ok": True, "execution": refusal_row}

    command = decision.get("command") or ""
    # If the decision has no command, pull from the proposal
    if not command:
        prop = find_proposal(alert_id) or {}
        command = prop.get("command") or ""

    # Idempotent per (alert, command, decided_at). A replay of the same
    # acceptance returns the prior row. A different acceptance with the same
    # command still gets executed.
    decided_at = decision.get("at")
    prior = already_executed(alert_id, command, decided_at)
    if prior:
        return {"ok": True, "already_executed": True, "execution": prior}

    kind, description, refused_reason, pending = _classify(command)
    if pending:
        status = "PENDING"
    elif refused_reason:
        status = "REFUSED"
    else:
        # If the description honestly says "awaiting" or "requested", the
        # executor's success is a request being recorded, not a resolution.
        low = (description or "").lower()
        if "awaiting" in low or "requested" in low or "queued" in low:
            status = "REQUESTED"
        else:
            status = "SUCCESS"
    row = {
        "alert_id": alert_id,
        "decision": decision.get("decision"),
        "command": command,
        "kind": kind,
        "status": status,
        "description": description,
        "refused_reason": refused_reason,
        "executed_at": _now(),
        "decided_at": decision.get("at"),
    }
    _append_jsonl(EXE, row)
    return {"ok": True, "execution": row}


def latest_for(alert_id):
    latest = None
    for row in _read_jsonl(EXE):
        if row.get("alert_id") == alert_id:
            latest = row
    return latest


def all_executions():
    return _read_jsonl(EXE)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        # print all executions for the board to pick up
        print(json.dumps({"executions": all_executions()}, indent=2))
        raise SystemExit(0)
    aid = sys.argv[1]
    result = execute(aid)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    raise SystemExit(0 if result.get("ok") else 1)
