#!/usr/bin/env bash
set -u

cd "$(dirname "$0")" || exit 1

echo "PWD=$(pwd)"
echo "UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

PY=$(command -v python3 || command -v python || command -v py)
if [ -z "$PY" ]; then
  echo "PYTHON_MISSING"
  exit 1
fi
echo "PY=$PY"

if [ ! -f bahn_ops/ours.jsonl ]; then
  echo "AGENT_RUN: ours.jsonl absent, generating"
  "$PY" bahn_ops/agent.py 2>&1 | tail -5
else
  echo "AGENT_RUN: skipped, ours.jsonl present"
fi

if [ ! -f bahn_ops/ours.jsonl ]; then
  echo "FAIL: agent wrote nothing"
  exit 1
fi
ROWS=$(grep -c . bahn_ops/ours.jsonl)
echo "OURS_ROWS=$ROWS"
if [ "$ROWS" -lt 1 ]; then
  echo "FAIL: zero proposals"
  exit 1
fi

node -c board/server.cjs || { echo "FAIL: board syntax"; exit 1; }
echo "BOARD_SYNTAX_OK"

node board/server.cjs > /tmp/verify_board.log 2>&1 &
BPID=$!
i=0
CODE=000
while [ "$i" -lt 20 ]; do
  CODE=$(curl -s -o /tmp/verify_board.html -w '%{http_code}' http://127.0.0.1:4317 2>/dev/null || echo 000)
  [ "$CODE" = "200" ] && break
  i=$((i + 1))
  sleep 0.5
done
kill "$BPID" 2>/dev/null
wait "$BPID" 2>/dev/null

echo "BOARD_STATUS=$CODE"
echo "BOARD_BYTES=$(wc -c < /tmp/verify_board.html 2>/dev/null || echo 0)"
echo "PROPOSES_RENDERED=$(grep -o 'Agent proposes' /tmp/verify_board.html | wc -l | tr -d ' ')"
echo "-- board log --"
cat /tmp/verify_board.log

if [ "$CODE" != "200" ]; then
  echo "FAIL: board did not serve"
  exit 1
fi

echo "VERIFY_OK"

# --- Approval boundary regression tests ---
echo "=== approval boundary ==="

# Do not assume the browser-supplied command is trusted.
# Capture the API responses so a rejected request cannot look like a pass.
set -u
AID="${AID:-}"
if [ -z "$AID" ] && [ -f ours.jsonl ]; then
  AID=$(python3 - <<'PYID'
import json
from pathlib import Path

def find_id(obj):
    if isinstance(obj, dict):
        for key in ("alert_id", "alertId"):
            value = obj.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        for value in obj.values():
            found = find_id(value)
            if found:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = find_id(value)
            if found:
                return found
    return ""

for line in Path("ours.jsonl").read_text(encoding="utf-8").splitlines():
    try:
        result = find_id(json.loads(line))
        if result:
            print(result)
            break
    except json.JSONDecodeError:
        continue
PYID
)
fi
if [ -z "$AID" ]; then
  echo "FAIL: no alert ID available for approval tests"
  exit 1
fi

mkdir -p _scratch
CHANGE_HTTP=$(curl -sS -o _scratch/approval-change.json -w '%{http_code}' \
  -X POST http://127.0.0.1:4317/decide \
  -H 'content-type: application/json' \
  -d "{\"alert_id\":\"$AID\",\"decision\":\"change\",\"command\":\"alert.resolve\"}") || exit 1
echo "CHANGE_HTTP=$CHANGE_HTTP"
cat _scratch/approval-change.json
echo

ACCEPT_HTTP=$(curl -sS -o _scratch/approval-accept.json -w '%{http_code}' \
  -X POST http://127.0.0.1:4317/decide \
  -H 'content-type: application/json' \
  -d "{\"alert_id\":\"$AID\",\"decision\":\"accept\",\"command\":\"ops.route.replan_delivery\"}") || exit 1
echo "ACCEPT_HTTP=$ACCEPT_HTTP"
cat _scratch/approval-accept.json
echo

sleep 1
if [ -f bahn_ops/executions.jsonl ]; then
  echo "EXECUTIONS:"
  tail -5 bahn_ops/executions.jsonl
else
  echo "NO_EXECUTIONS_FILE"
fi

echo "Approval test diagnostics complete; do not treat this as a pass until the responses and executor result are verified."
