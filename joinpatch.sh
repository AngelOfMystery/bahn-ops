cd /c/Users/kiami/IdeaProjects/TESTING/Bahn || { echo "REPO_MISSING"; exit 1; }
python3 - <<'VIBE_PATCH_021'
from pathlib import Path
import shutil

p = Path("board/server.cjs")
text = p.read_text(encoding="utf-8")

old = ",P=L('agent_proposals');"
new = (",P=(()=>{const o=p.join(__dirname,'..','bahn_ops','ours.jsonl');"
 "try{if(f.existsSync(o)){const r=f.readFileSync(o,'utf8')"
 ".split('\\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}"
 "catch(e){return null}}).filter(Boolean)"
 ".map(q=>Object.assign({},q,{created_at:q.created_at||q.generated_at}));"
 "if(r.length)return r}}catch(e){}"
 "return L('agent_proposals')})();")

count = text.count(old)
print("ANCHOR_MATCHES:", count)
if count != 1:
 raise SystemExit("PATCH ABORTED: expected 1 match, found " + str(count))

backup = p.with_suffix(p.suffix + ".bak")
shutil.copyfile(p, backup)
p.write_text(text.replace(old, new, 1), encoding="utf-8")
print("PATCHED:", p, "| backup:", backup)
VIBE_PATCH_021

node -c board/server.cjs && echo "SYNTAX_OK" || { echo "SYNTAX_FAIL"; exit 1; }

node board/server.cjs > /tmp/b021.log 2>&1 &
BPID=$!
sleep 2
CODE=$(curl -s -o /tmp/b021.html -w '%{http_code}' http://127.0.0.1:4317 2>/dev/null || echo 000)
echo "BOARD_STATUS=$CODE"
echo "HTML_BYTES=$(wc -c < /tmp/b021.html 2>/dev/null || echo 0)"
echo "AGENT_PROPOSES=$(grep -o 'Agent proposes' /tmp/b021.html | wc -l | tr -d ' ')"
echo "EVIDENCE_REFS=$(grep -o 'from <code>' /tmp/b021.html | wc -l | tr -d ' ')"
echo "-- log --"
cat /tmp/b021.log
kill "$BPID" 2>/dev/null
wait "$BPID" 2>/dev/null