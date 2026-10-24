cd /c/Users/kiami/IdeaProjects/TESTING/Bahn || { echo "REPO_MISSING"; exit 1; }
PKT=/c/Users/kiami/IdeaProjects/TESTING/bahn-packet

echo "== PRE =="
pwd
git rev-parse --abbrev-ref HEAD
git status --short
echo

mkdir -p board

if [ -f "$PKT/server.cjs" ]; then
 cp "$PKT/server.cjs" board/server.cjs
 echo "COPIED_SERVER: $(wc -c < board/server.cjs) bytes"
else
 echo "SERVER_MISSING_AT_PACKET"
fi

if [ -d "$PKT/dataset" ]; then
 cp -R "$PKT/dataset" board/dataset
 echo "COPIED_DATASET: $(du -sk board/dataset | cut -f1) KB"
 echo "-- dataset/data --"
 ls -1 board/dataset/data
else
 echo "DATASET_MISSING_AT_PACKET"
fi

if [ -f "$PKT/PROCESS.md" ]; then
 cp "$PKT/PROCESS.md" PROCESS.md
 echo "COPIED_PROCESS: $(wc -c < PROCESS.md) bytes"
else
 echo "PROCESS_MISSING_AT_PACKET"
fi
echo

git add board PROCESS.md 2>/dev/null
echo "== STAGED =="
git status --short
echo

echo "== RUN BOARD =="
if command -v node >/dev/null 2>&1; then
 node -c board/server.cjs && echo "SYNTAX_OK"
 node board/server.cjs > /tmp/board.log 2>&1 &
 BPID=$!
 sleep 2
 CODE=$(curl -s -o /tmp/board.html -w '%{http_code}' http://127.0.0.1:4317 2>/dev/null || echo 000)
 echo "BOARD_STATUS=$CODE"
 echo "HTML_BYTES=$(wc -c < /tmp/board.html 2>/dev/null || echo 0)"
 echo "-- server log --"
 cat /tmp/board.log
 kill "$BPID" 2>/dev/null
 wait "$BPID" 2>/dev/null
else
 echo "NODE_MISSING"
fi