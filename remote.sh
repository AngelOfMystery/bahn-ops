cd /c/Users/kiami/IdeaProjects/TESTING/Bahn || { echo "REPO_MISSING"; exit 1; }

REMOTE_URL="$1"
if [ -z "$REMOTE_URL" ]; then
 echo "MISSING_ARG: pass the repo URL as the first argument"
 echo "USAGE: bash repo.sh https://github.com/AngelOfMystery/bahn-ops.git"
 exit 1
fi
echo "TARGET: $REMOTE_URL"
echo "LOCAL_HEAD=$(git rev-parse HEAD)"

if [ -n "$(git remote)" ]; then
 echo "REMOTE_EXISTS:"
 git remote -v
 exit 0
fi

git remote add origin "$REMOTE_URL"
echo "ADD_EXIT=$?"
git remote -v
echo

git push -u origin master
echo "PUSH_EXIT=$?"
echo
echo "REMOTE_HEAD=$(git ls-remote origin refs/heads/master | cut -f1)"