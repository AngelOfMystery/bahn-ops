import json
from collections import Counter
from pathlib import Path

D = Path("board/dataset/data")
print("PROBE_START")
print("CWD:", Path.cwd())
print("DATA_DIR_EXISTS:", D.is_dir())


def load(n):
 p = D / (n + ".jsonl")
 if not p.exists():
 print("MISSING:", p)
 return []
 rows = []
 for line in p.read_text(encoding="utf-8").splitlines():
 s = line.strip()
 if not s:
 continue
 try:
 rows.append(json.loads(s))
 except json.JSONDecodeError:
 pass
 return rows


for n in ["agent_proposals", "alerts", "orders", "messages", "documents"]:
 rows = load(n)
 print("== " + n + " count " + str(len(rows)))
 if rows:
 print("keys:", ",".join(sorted(rows[0].keys())))

P = load("agent_proposals")
A = load("alerts")

print("== review shape ==")
seen = []
for r in P:
 rv = r.get("review")
 if isinstance(rv, dict):
 k = ",".join(sorted(rv.keys()))
 if k not in seen:
 seen.append(k)
for k in seen:
 print("review_keys:", k)
for r in P:
 if isinstance(r.get("review"), dict):
 print("review_sample:", json.dumps(r["review"], ensure_ascii=False)[:300])
 break

print("== proposals ==")
print("total:", len(P))
print("superseded:", sum(1 for r in P if r.get("superseded_by_proposal_id") or r.get("superseded_at")))
print("statuses:", dict(Counter(r.get("status") for r in P)))

print("== alerts ==")
print("total:", len(A))
print("statuses:", dict(Counter(r.get("status") for r in A)))
oa = [r for r in A if r.get("status") == "OPEN"]
print("open:", len(oa))
print("open_with_evidence:", sum(1 for r in oa if r.get("evidence_refs")))
linked = set()
for p in P:
 if p.get("alert_id"):
 linked.add(p["alert_id"])
 if p.get("order_id"):
 linked.add(p["order_id"])
print("open_with_proposal:", sum(1 for r in oa if r.get("id") in linked or r.get("order_id") in linked))

if oa:
 print("== sample alert ==")
 print(json.dumps(oa[0], ensure_ascii=False)[:700])
if P:
 print("== sample proposal ==")
 print(json.dumps(P[0], ensure_ascii=False)[:700])
O = load("orders")
if O:
 print("== sample order ==")
 print(json.dumps(O[0], ensure_ascii=False)[:500])
M = load("messages")
if M:
 print("== sample message ==")
 print(json.dumps(M[0], ensure_ascii=False)[:400])
print("PROBE_END")
