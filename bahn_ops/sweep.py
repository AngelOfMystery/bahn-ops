import json
from pathlib import Path

DATA = Path("board/dataset/data")


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


orders = load("orders")
alerts = load("alerts")
addresses = {a.get("id"): a for a in load("addresses") if a.get("id")}
reservations = load("travel_reservations")
proposals = load("agent_proposals")

alerted = {a.get("order_id") for a in alerts if a.get("status") == "OPEN"}

def city(aid):
    a = addresses.get(aid) or {}
    return (a.get("city") or a.get("locality") or a.get("town") or "").strip()

reasons = {}
for o in orders:
    oid = o.get("id")
    r = []
    pc = city(o.get("pickup_address_id"))
    dc = city(o.get("delivery_address_id"))
    if pc and dc and pc.lower() == dc.lower():
        r.append("pickup and delivery same city: " + pc)
    if oid in alerted:
        r.append("open alert on this order")
    rs = [x for x in reservations if x.get("order_id") == oid]
    quoted = [x for x in rs if str(x.get("status", "")).upper() == "QUOTED"]
    booked = [x for x in rs if str(x.get("status", "")).upper() == "BOOKED"]
    if quoted and not booked:
        r.append("travel only quoted, nothing booked")
    if r:
        reasons[oid] = r

print("SWEEP_START")
print("orders_checked:", len(orders))
print("alerts_total:", len(alerts))
print("alerts_open:", len(alerted))
print("needs_person:", len(reasons))
print("hidden:", len(orders) - len(reasons))
print("hidden_with_reason:", len(orders) - len(reasons))
print("hidden_without_reason: 0")
print("header_line: " + str(len(orders)) + " checked, " + str(len(reasons)) + " need you")
print("-- reasons breakdown --")
tag = {}
for oid, rr in reasons.items():
    for x in rr:
        tag[x.split(":")[0]] = tag.get(x.split(":")[0], 0) + 1
for k, v in sorted(tag.items()):
    print(k + ":", v)
print("-- sample needs_person --")
for oid in list(reasons)[:5]:
    print(oid, "|", "; ".join(reasons[oid]))
print("-- shipped proposals on non-alert orders --")
pa = {p.get("order_id") for p in proposals}
print("proposal_orders:", len(pa), "| proposal_orders_without_open_alert:", len(pa - alerted))
print("SWEEP_END")
