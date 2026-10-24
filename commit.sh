cd /c/Users/kiami/IdeaProjects/TESTING/Bahn || { echo "REPO_MISSING"; exit 1; }

REMOTE_URL="https://github.com/AngelOfMystery/bahn-ops.git"
echo "TARGET: $REMOTE_URL"
echo "HEAD_BEFORE=$(git rev-parse HEAD)"
echo "BRANCH=$(git rev-parse --abbrev-ref HEAD)"
echo "DIRTY_BEFORE=$(git status --short | wc -l | tr -d ' ')"
git status --short | head -25
echo

if [ -n "$(git remote)" ]; then
 echo "REMOTE_EXISTS:"
 git remote -v
else
 git remote add origin "$REMOTE_URL"
 echo "ADD_EXIT=$?"
fi
echo

git add -A
git commit -m "board reads our agent proposals; pickup-readiness agent and evidence refs" || echo "NOTHING_TO_COMMIT"
echo "HEAD_AFTER=$(git rev-parse HEAD)"
echo

git push -u origin master
echo "PUSH_EXIT=$?"
echo
echo "REMOTE_HEAD=$(git ls-remote origin refs/heads/master | cut -f1)"
echo "LOCAL_HEAD=$(git rev-parse HEAD)"