cd /c/Users/kiami/IdeaProjects/TESTING/Bahn || { echo "REPO_MISSING"; exit 1; }
[ -d board/dataset/data ] && echo "DATA_OK" || echo "DATA_MISSING"

PY=$(command -v python3 || command -v python)
echo "PY=$PY"
"$PY" --version

echo "-- run --"
"$PY" bahn_ops/agent.py 2>&1 | tail -20

echo "-- verify --"
"$PY" - <<'VIBE_VERIFY_020'
import json
from pathlib import Path

p = Path("bahn_ops/ours.jsonl")
if not p.exists():
 raise SystemExit("OURS_MISSING")

rows = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
print("ROWS:", len(rows))
print("KEYS:", ",".join(sorted(rows[0].keys())) if rows else "none")
print("WITH_SUMMARY:", sum(1 for r in rows if r.get("summary")))
print("WITH_EVIDENCE:", sum(1 for r in rows if r.get("evidence_refs")))
print("SOURCES:", sorted({str(r.get("source")) for r in rows}))
print("FIRST_ALERT:", rows[0].get("alert_id") if rows else "none")
print("FIRST_CMD:", rows[0].get("command") if rows else "none")
VIBE_VERIFY_020