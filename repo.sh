cd /c/Users/kiami/IdeaProjects/TESTING/Bahn || { echo "REPO_MISSING"; exit 1; }

echo "== BEFORE =="
git remote -v
git log --oneline -1
echo "DIRTY_FILES: $(git status --short | wc -l | tr -d ' ')"
echo

if ! command -v gh >/dev/null 2>&1; then
 echo "GH_NOT_INSTALLED"
 echo "Manual route: create the repo on github.com, then:"
 echo " git remote add origin https://github.com/<account>/bahn-ops.git"
 echo " git push -u origin master"
 exit 1
fi
gh --version | head -1
if ! gh auth status >/dev/null 2>&1; then
 echo "GH_NOT_AUTHENTICATED: run 'gh auth login' once, then rerun"
 exit 1
fi
echo "GH_AUTH_OK"

if [ -n "$(git remote)" ]; then
 echo "REMOTE_ALREADY_SET:"
 git remote -v
 echo "URL=$(git remote get-url origin)"
 exit 0
fi

echo
echo "== COMMIT =="
git add -A
git status --short | head -30
git commit -m "bahn_ops: control room board, pickup-readiness agent, synthetic dataset" || echo "NOTHING_TO_COMMIT"
echo "HEAD_NOW: $(git log --oneline -1)"
echo

echo "== CREATE + PUSH =="
gh repo create bahn-ops --public --source . --remote origin --push \
 --description "Bahn Ops control room and pickup-readiness agent. Prompt Operations Hackathon 2026."
echo "CREATE_EXIT=$?"
echo
echo "REPO_URL=$(gh repo view --json url -q .url 2>/dev/null)"
echo "LOCAL_HEAD=$(git rev-parse HEAD)"
echo "REMOTE_HEAD=$(git ls-remote origin refs/heads/master 2>/dev/null | cut -f1)"