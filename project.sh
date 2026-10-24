mkdir -p "$HOME/vibeforge/hackathon-04"
cat > "$HOME/vibeforge/hackathon-04/read_repo.sh" <<'VIBE_READ_001'
#!/usr/bin/env bash
set -u

BASE="$HOME/IdeaProjects"
DIR="$HOME/vibeforge/hackathon-04"
OUT="$DIR/PROJECT_DUMP.txt"
LIST="$DIR/files.txt"
BUDGET=180000
MAXBYTES=150000
used=0
echoed=0
too_big=""
not_echoed=""

mkdir -p "$DIR"

ROOT="${1:-}"
if [ -n "$ROOT" ] && [ ! -d "$ROOT" ]; then
 echo "NOT_A_DIR: $ROOT"
 exit 1
fi

if [ -z "$ROOT" ]; then
 echo "===== DISCOVERY ====="
 echo "SEARCHING: $BASE"
 if [ ! -d "$BASE" ]; then
 echo "MISSING_BASE: $BASE"
 echo "RERUN: bash $0 /full/path/to/project"
 exit 1
 fi
 CAND=""
 while IFS= read -r d; do CAND="$d"; break; done < <(find "$BASE" -maxdepth 4 -type d -iname '*bahn*' 2>/dev/null | sort)
 if [ -z "$CAND" ]; then
 while IFS= read -r d; do
 if [ -f "$d/pom.xml" ] || [ -f "$d/build.gradle.kts" ] || [ -f "$d/build.gradle" ] || [ -f "$d/package.json" ] || [ -f "$d/pyproject.toml" ]; then
 CAND="$d"
 break
 fi
 done < <(find "$BASE" -maxdepth 3 -mindepth 1 -type d 2>/dev/null | sort)
 fi
 if [ -z "$CAND" ]; then
 echo "NO_PROJECT_FOUND_UNDER: $BASE"
 echo "TOP_LEVEL:"
 ls -1 "$BASE" 2>/dev/null | head -40
 echo "RERUN: bash $0 /full/path/to/project"
 exit 1
 fi
 ROOT="$CAND"
fi

ROOT="${ROOT%/}"
echo "USING: $ROOT"
echo "UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

: > "$OUT"
{
 echo "ROOT: $ROOT"
 echo "UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
 echo
} >> "$OUT"

echo "===== GIT ====="
if [ -d "$ROOT/.git" ]; then
 echo "BRANCH: $(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null)"
 echo "HEAD: $(git -C "$ROOT" log -1 --oneline 2>/dev/null)"
 echo "--- status ---"
 git -C "$ROOT" status --short 2>/dev/null
 echo "--- file count by extension ---"
 git -C "$ROOT" ls-files 2>/dev/null | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -20
else
 echo "NO_GIT_DIR"
fi
echo

echo "===== MANIFESTS ====="
for m in pom.xml build.gradle build.gradle.kts settings.gradle settings.gradle.kts gradle.properties package.json tsconfig.json pyproject.toml requirements.txt README.md .env.example; do
 if [ -f "$ROOT/$m" ]; then
 echo "--- $m ---"
 cat "$ROOT/$m"
 echo
 { echo "--- $m ---"; cat "$ROOT/$m"; echo; } >> "$OUT"
 fi
done
echo

find "$ROOT" \
 -path '*/.git' -prune -o \
 -path '*/.idea' -prune -o \
 -path '*/.gradle' -prune -o \
 -path '*/build' -prune -o \
 -path '*/target' -prune -o \
 -path '*/out' -prune -o \
 -path '*/node_modules' -prune -o \
 -path '*/.venv' -prune -o \
 -path '*/venv' -prune -o \
 -path '*/__pycache__' -prune -o \
 -path '*/dist' -prune -o \
 -path '*/.next' -prune -o \
 -path '*/coverage' -prune -o \
 -type f -print 2>/dev/null | sort > "$LIST"

TOTAL=$(wc -l < "$LIST" | tr -d ' ')
echo "===== FILE INVENTORY ($TOTAL files) ====="
while IFS= read -r f; do
 echo "$(wc -c < "$f" | tr -d ' ') ${f#$ROOT/}"
done < "$LIST"
echo

echo "===== FILE CONTENTS ====="
while IFS= read -r f; do
 case "$f" in
 *.java|*.kt|*.kts|*.groovy|*.gradle|*.xml|*.json|*.yml|*.yaml|*.md|*.txt|*.sql|*.ts|*.tsx|*.js|*.jsx|*.mjs|*.css|*.scss|*.html|*.py|*.sh|*.properties|*.toml|*.cs|*.csproj|*.vue|*.svelte|*.graphql|*.prisma|*.env*|*.gitignore) ;;
 *) continue ;;
 esac
 sz=$(wc -c < "$f" | tr -d ' ')
 rel="${f#$ROOT/}"
 if [ "$sz" -gt "$MAXBYTES" ]; then
 too_big="$too_big $rel($sz)"
 continue
 fi
 { echo "===== FILE: $rel ($sz bytes) ====="; cat "$f"; echo; echo "===== END: $rel ====="; echo; } >> "$OUT"
 if [ $((used + sz)) -le "$BUDGET" ]; then
 echo "===== FILE: $rel ($sz bytes) ====="
 cat "$f"
 echo
 echo "===== END: $rel ====="
 echo
 used=$((used + sz))
 echoed=$((echoed + 1))
 else
 not_echoed="$not_echoed $rel"
 fi
done < "$LIST"

echo "===== SUMMARY ====="
echo "FILES_TOTAL: $TOTAL"
echo "ECHOED: $echoed"
echo "TERMINAL_BYTES: $used"
echo "DUMP_FILE: $OUT"
echo "DUMP_BYTES: $(wc -c < "$OUT" | tr -d ' ')"
if [ -n "$too_big" ]; then echo "TOO_BIG:$too_big"; else echo "TOO_BIG: none"; fi
if [ -n "$not_echoed" ]; then echo "IN_FILE_ONLY:$not_echoed"; else echo "IN_FILE_ONLY: none"; fi
VIBE_READ_001
bash "$HOME/vibeforge/hackathon-04/read_repo.sh"