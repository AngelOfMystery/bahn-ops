cd ~/IdeaProjects/TESTING/Bahn
echo "=== ours.jsonl has 18 rows? ==="
wc -l bahn_ops/ours.jsonl

echo ""
echo "=== restart clean and check board ==="
taskkill //F //IM node.exe 2>/dev/null || true
sleep 1
node board/server.cjs > /tmp/board.log 2>&1 &
SRV=$!
sleep 2
head -2 /tmp/board.log
curl -s http://127.0.0.1:4317/ | grep -o '[0-9]* ready for your call[^<]*' | head -1
curl -s http://127.0.0.1:4317/ | grep -o 'The agent has not reached this case yet' | wc -l | xargs echo "  'not reached' cards:"
curl -s http://127.0.0.1:4317/ | grep -o 'The agent suggests' | wc -l | xargs echo "  'suggests' cards:"
curl -s http://127.0.0.1:4317/ | grep -o 'Not ready for action' | wc -l | xargs echo "  'not ready' cards:"
kill $SRV 2>/dev/null
