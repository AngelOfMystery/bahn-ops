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
AID=$(python3 -c "
import json, pathlib
props=[json.loads(l) for l in pathlib.Path('bahn_ops/ours.jsonl').read_text().splitlines() if l.strip()]
print(next(p['alert_id'] for p in props if p.get('summary') and not p.get('stops_because')))
" 2>/dev/null)

if [ -n "$AID" ]; then
  rm -f bahn_ops/decisions.jsonl bahn_ops/executions.jsonl

  # Test 1: change never executes
  curl -s -X POST http://127.0.0.1:4317/decide -H 'content-type: application/json' \
    -d "{\"alert_id\":\"$AID\",\"decision\":\"change\",\"command\":\"alert.resolve\"}" > /dev/null
  CHANGE_COUNT=$(wc -l < bahn_ops/executions.jsonl 2>/dev/null || echo 0)
  if [ "$CHANGE_COUNT" -eq 0 ]; then echo "  PASS: change does not execute"; else echo "  FAIL: change executed"; fi

  # Test 2: accept executes
  curl -s -X POST http://127.0.0.1:4317/decide -H 'content-type: application/json' \
    -d "{\"alert_id\":\"$AID\",\"decision\":\"accept\",\"command\":\"ops.route.replan_delivery\"}" > /dev/null
  sleep 1
  ACCEPT_COUNT=$(wc -l < bahn_ops/executions.jsonl 2>/dev/null || echo 0)
  if [ "$ACCEPT_COUNT" -eq 1 ]; then echo "  PASS: accept executes"; else echo "  FAIL: accept did not execute"; fi

  # Test 3: executor reads the accept, not the earlier change
  DEC=$(tail -1 bahn_ops/executions.jsonl | python3 -c "import sys,json;print(json.load(sys.stdin).get('decision'))" 2>/dev/null)
  if [ "$DEC" = "accept" ]; then echo "  PASS: executor reads the accept"; else echo "  FAIL: executor read '$DEC'"; fi

  # Test 4: idempotency — replay the same accept
  BEFORE=$(wc -l < bahn_ops/executions.jsonl 2>/dev/null || echo 0)
  python3 -m bahn_ops.execute "$AID" > /dev/null 2>&1
  AFTER=$(wc -l < bahn_ops/executions.jsonl 2>/dev/null || echo 0)
  if [ "$BEFORE" -eq "$AFTER" ]; then echo "  PASS: idempotent replay"; else echo "  FAIL: duplicate execution"; fi
fi
